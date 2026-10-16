import type { GameFiles } from './game.ts';
import { decodeOp, parseScenario, segmentMessage, tokenizeText, type Scenario, type Segment } from './scn.ts';
import { emptyVisual, type Visual } from './scene.ts';

/**
 * Screen transitions. Numbers index the game's effect table (from XLVNS
 * sizuku.c); scripts also use 99 for a plain cut.
 */
export type Effect =
  | 'palette' | 'spiral' | 'slant-tiles' | 'diamonds' | 'diamond-wipe' | 'mask' | 'wipe-down'
  | 'wipe-right' | 'mask-wipe-right' | 'vertical-close' | 'slide-right' | 'cut';

const EFFECTS: Effect[] = [
  'palette', 'spiral', 'slant-tiles', 'diamonds', 'diamond-wipe', 'mask', 'wipe-down',
  'wipe-right', 'mask-wipe-right', 'vertical-close', 'slide-right', 'cut', 'mask',
];
export const effectFromTable = (n: number): Effect => EFFECTS[n] ?? 'cut';

/** Where in the story we are; enough to resume. Saved games store this. */
export interface SavePoint {
  scn: number;
  /** Byte offset of the instruction to run, in the scenario's code section. */
  pc: number;
  /** Text segments of that instruction's message already read (resume mid-message). */
  segment: number;
  flags: number[];
  visual: Visual;
  music: number | null;
}

/** A text segment as the host receives it. */
export interface TextSegment extends Segment {
  scn: number;
  msg: number;
}

export interface MessageRef {
  scn: number;
  msg: number;
}

export type MusicCommand =
  | { t: 'play'; no: number }
  | { t: 'next'; no: number }
  | { t: 'fade' }
  | { t: 'wait-fade' }
  | { t: 'stop' };

export type SoundCommand =
  | { t: 'load'; no: number }
  | { t: 'play'; arg: string }
  | { t: 'wait' }
  | { t: 'stop' }
  | { t: 'fade' };

/** One vsync of the PC-98's 400-line mode, the unit of the scripts' waits. */
export const VSYNC_MS = 1000 / 56.42;

/**
 * Palette operations (opcodes 5a-69 on the PC-98; see docs/DESIGN.md).
 * `steps` fades take 16 steps of `vsyncs` each.
 */
export type PaletteOp =
  | { t: 'normal' }
  | { t: 'black' }
  | { t: 'white' }
  | { t: 'fade-to'; color: 'black' | 'white'; vsyncs: number }
  | { t: 'fade-from'; color: 'black' | 'white'; vsyncs: number }
  | { t: 'dim'; on: boolean }
  | { t: 'grey'; amount: number }
  | { t: 'fade-grey'; on: boolean };

/** What the interpreter needs from the player (renderer, audio, input). */
export interface Host {
  /** Called whenever a save would be allowed to resume from here. */
  savePoint(point: SavePoint): void;
  hideText(): void;
  /** Transition to black. */
  clear(effect: Effect): Promise<void>;
  /** Transition from what is on screen to `visual`. */
  show(visual: Visual, effect: Effect): Promise<void>;
  text(segment: TextSegment): Promise<void>;
  choose(prompt: MessageRef, options: MessageRef[]): Promise<number>;
  music(cmd: MusicCommand): void | Promise<void>;
  sound(cmd: SoundCommand): void | Promise<void>;
  shake(): Promise<void>;
  flash(): Promise<void>;
  /** The background ripple effect ('ぐにゃり'). */
  ripple(on: boolean): void;
  /** The teardrop animation (opcode 01 03). */
  teardrop(variant: number): Promise<void>;
  ending(no: number): Promise<void>;
  wait(ms: number): Promise<void>;
  palette(op: PaletteOp): Promise<void>;
}

const FLAG_SLOTS = 14;

/** Script flag number -> slot (XLVNS flagmap). 0: endings seen, 1: scratch, 0x40-0x4b: story. */
function flagSlot(no: number): number {
  if (no === 0 || no === 1) return no;
  if (no >= 0x40 && no <= 0x4b) return 2 + no - 0x40;
  throw new Error(`Flag desconocido 0x${no.toString(16)}`);
}

/** Flags that survive starting a new game (endings seen, Ruriko's endings). */
const PERSISTENT_SLOTS = [0, 7, 8];

export const NEW_GAME = { scn: 1, block: 1 };

const hex = (s: string) => Number.parseInt(s, 16);
const dec = (s: string) => Number.parseInt(s, 10);

/** Runs the MAX engine bytecode (after XLVNS SizukuMain). */
export class Interpreter {
  private readonly cache = new Map<number, Scenario>();
  private scnNo = 0;
  private scn!: Scenario;
  private pc = 0;
  flags = new Array<number>(FLAG_SLOTS).fill(0);
  visual: Visual = emptyVisual();
  music: number | null = null;
  /** Set to stop run() at the next instruction (returning to the title). */
  stopped = false;

  private readonly files: GameFiles;
  private readonly host: Host;

  constructor(files: GameFiles, host: Host) {
    this.files = files;
    this.host = host;
  }

  scenario(no: number): Scenario {
    let s = this.cache.get(no);
    if (!s) {
      s = parseScenario(this.files.read(`SCN/SCN${String(no).padStart(3, '0')}.DAT`));
      this.cache.set(no, s);
    }
    return s;
  }

  private jump(scn: number, block: number) {
    this.scnNo = scn;
    this.scn = this.scenario(scn);
    this.pc = this.scn.blocks[block];
  }

  /** A new game: keeps the persistent flags. */
  static newGame(persistent: number[] = []): SavePoint {
    const flags = new Array<number>(FLAG_SLOTS).fill(0);
    for (const slot of PERSISTENT_SLOTS) flags[slot] = persistent[slot] ?? 0;
    const scn = NEW_GAME.scn;
    return { scn, pc: -NEW_GAME.block - 1, segment: 0, flags, visual: emptyVisual(), music: null };
  }

  private point(segment: number, pc = this.pc): SavePoint {
    return {
      scn: this.scnNo, pc, segment, flags: [...this.flags],
      visual: structuredClone(this.visual), music: this.music,
    };
  }

  /** Runs from a save point until the story ends or stop() is called. */
  async run(start: SavePoint): Promise<void> {
    this.flags = [...start.flags];
    this.visual = structuredClone(start.visual);
    this.music = start.music;
    if (start.pc < 0) this.jump(start.scn, -start.pc - 1);
    else {
      this.scnNo = start.scn;
      this.scn = this.scenario(start.scn);
      this.pc = start.pc;
    }
    if (this.music !== null) await this.host.music({ t: 'play', no: this.music });
    if (start.visual.bg.no !== 0 || Object.values(start.visual.chars).some((c) => c !== null)) {
      await this.host.show(this.visual, 'wipe-down');
    }
    let skip = start.segment;
    while (!this.stopped) {
      const done = await this.step(skip);
      skip = 0;
      if (done) return;
    }
  }

  stop() {
    this.stopped = true;
  }

  /** Runs one instruction. Returns true at the end of the story. */
  private async step(skip: number): Promise<boolean> {
    const at = this.pc;
    const op = decodeOp(this.scn.code, at);
    const a = op.args;
    this.pc += op.length;
    const h = this.host;
    switch (op.op) {
      case 0x00: // end of block: the story is over
      case 0xff:
        return true;
      case 0x01:
        switch (a[0]) {
          case 0x01: // ripple, text, then fade to black
            h.ripple(true);
            await this.message(a[1], at, skip);
            h.ripple(false);
            await h.clear('palette');
            break;
          case 0x02: // from black into the ripple, with text
            await h.show(this.visual, 'palette');
            h.ripple(true);
            await this.message(a[1], at, skip);
            h.ripple(false);
            break;
          case 0x03:
            await h.teardrop(a[1]);
            break;
          case 0x04:
            await this.message(a[1], at, skip);
            break;
        }
        break;
      case 0x04:
        this.jump(a[0], a[1]);
        break;
      case 0x05: {
        const count = a[1];
        const options = Array.from({ length: count }, (_, i) => ({ scn: this.scnNo, msg: a[2 + i * 2] }));
        h.savePoint(this.point(0, at));
        const i = await h.choose({ scn: this.scnNo, msg: a[0] }, options);
        this.pc = at + 3 + count * 2 + a[3 + i * 2];
        break;
      }
      case 0x0a:
        this.setBackground('bg', a[0]);
        break;
      case 0x14:
        h.hideText();
        await h.clear(effectFromTable(a[0]));
        break;
      case 0x16:
        h.hideText();
        this.setBackground('hvs', a[0]);
        await h.show(this.visual, 'cut');
        break;
      case 0x22:
      case 0x24:
        h.hideText();
        this.setCharacter(op.op === 0x24 ? 'c' : String.fromCharCode(a[1]), a[0]);
        await h.show(this.visual, 'mask');
        break;
      case 0x38:
        await h.show(this.visual, effectFromTable(a[0]));
        break;
      case 0x3d:
        if (this.flags[flagSlot(a[0])] === a[1]) this.pc += a[2];
        break;
      case 0x3e:
        if (this.flags[flagSlot(a[0])] !== a[1]) this.pc += a[2];
        break;
      case 0x47:
        this.flags[flagSlot(a[0])] = a[1];
        break;
      case 0x48:
        this.flags[flagSlot(a[0])] = (this.flags[flagSlot(a[0])] + a[1]) & 0xff;
        break;
      case 0x54:
        await this.message(a[0], at, skip);
        break;
      case 0x6e:
        this.music = a[0];
        await h.music({ t: 'play', no: a[0] });
        break;
      case 0x7d:
        await h.music({ t: 'play', no: a[0] });
        await h.ending(this.flags[0]);
        return true;
      case 0x7e: // which ending: records it in the persistent flag 0
        if (this.flags[flagSlot(0x46)] === 1) this.flags[0] = 3;
        else this.flags[0] = this.flags[0] === 0 ? 2 : 1;
        break;
      case 0x03:
        await h.wait(a[0] * VSYNC_MS);
        break;
      case 0x5a: await h.palette({ t: 'normal' }); break;
      case 0x5b: await h.palette({ t: 'black' }); break;
      case 0x5c: await h.palette({ t: 'fade-to', color: 'black', vsyncs: a[0] - 1 }); break;
      case 0x5d: await h.palette({ t: 'fade-from', color: 'black', vsyncs: a[0] - 1 }); break;
      case 0x60: await h.palette({ t: 'white' }); break;
      case 0x61: await h.palette({ t: 'fade-to', color: 'white', vsyncs: a[0] - 1 }); break;
      case 0x62: await h.palette({ t: 'fade-from', color: 'white', vsyncs: a[0] - 1 }); break;
      case 0x63: await h.palette({ t: 'dim', on: false }); break;
      case 0x64: await h.palette({ t: 'dim', on: true }); break;
      case 0x65: // from black into the dimmed palette
        await h.palette({ t: 'dim', on: true });
        await h.palette({ t: 'fade-from', color: 'black', vsyncs: 3 });
        break;
      case 0x66: await h.palette({ t: 'fade-to', color: 'black', vsyncs: 3 }); break;
      case 0x67: await h.palette({ t: 'grey', amount: a[0] / 15 }); break;
      case 0x68: await h.palette({ t: 'fade-grey', on: true }); break;
      case 0x69: await h.palette({ t: 'fade-grey', on: false }); break;
      case 0x6f:
        await h.music({ t: 'fade' });
        break;
      case 0x70:
        this.music = null;
        await h.music({ t: 'stop' });
        break;
      case 0x73:
        this.music = null;
        await h.music({ t: 'fade' });
        await h.music({ t: 'wait-fade' });
        break;
      default: // 06, 07, 28, 5e/5f (palette save/restore), 71/72 (FM/SSG effects, unused), 7c
        break;
    }
    return false;
  }

  private setBackground(kind: Visual['bg']['kind'], no: number) {
    this.visual = { bg: { kind, no }, chars: { l: null, c: null, r: null } };
  }

  private setCharacter(slot: string, no: number | null) {
    const s = slot.toLowerCase();
    if (s === 'a') this.visual.chars = { l: null, c: null, r: null };
    if (no === 0x99) return;
    const key = s === 'c' ? 'c' : s === 'r' ? 'r' : 'l';
    if (s !== 'a') this.visual.chars[key] = no;
    else if (no !== null) this.visual.chars.l = no;
  }

  /** Shows a message, running its inline commands at their places. */
  private async message(msg: number, at: number, skip: number) {
    for (const item of segmentMessage(tokenizeText(this.scn.texts[msg]))) {
      if (item.kind === 'cmd') {
        // Commands before the resume point are already in the saved visual.
        if (item.before >= skip) await this.inline(item.op, item.raw);
      } else if (item.index >= skip) {
        this.host.savePoint(this.point(item.index, at));
        await this.host.text({ scn: this.scnNo, msg, ...item });
      }
    }
  }

  /** Inline commands inside messages (XLVNS SizukuDispText). */
  private async inline(op: string, raw: string) {
    const h = this.host;
    const show = async (clear: string, disp: string, change: () => void) => {
      h.hideText();
      await h.clear(this.textEffect(clear));
      change();
      await h.show(this.visual, this.textEffect(disp));
    };
    switch (op) {
      case 'C':
        h.hideText();
        this.visual.chars[raw[1].toLowerCase() as 'l'] = null;
        this.setCharacter(raw[1], hex(raw.slice(2, 4)));
        await h.show(this.visual, 'mask');
        break;
      case 'D':
        h.hideText();
        this.visual.chars = { l: null, c: null, r: null };
        this.setCharacter(raw[1], hex(raw.slice(2, 4)));
        await h.show(this.visual, 'mask');
        break;
      case 'A':
      case 'a':
        h.hideText();
        this.visual.chars = { l: null, c: null, r: null };
        for (let i = 1; i < 10; i += 3) this.setCharacter(raw[i], hex(raw.slice(i + 1, i + 3)));
        await h.show(this.visual, 'mask');
        break;
      case 'B':
      case 'E':
        await show(raw.slice(3, 5), raw.slice(5, 7), () => this.setBackground('bg', dec(raw.slice(1, 3))));
        break;
      case 'V':
        await show(raw.slice(3, 5), raw.slice(5, 7), () => this.setBackground('vis', dec(raw.slice(1, 3))));
        break;
      case 'H':
        await show(raw.slice(3, 5), raw.slice(5, 7), () => this.setBackground('hvs', dec(raw.slice(1, 3))));
        break;
      case 'S':
        await show(raw.slice(6, 8), raw.slice(8, 10), () => {
          this.setBackground('bg', dec(raw.slice(4, 6)));
          this.setCharacter(raw[1], hex(raw.slice(2, 4)));
        });
        break;
      case 'Q':
        await h.shake();
        break;
      case 'F':
        await h.flash();
        break;
      case 'M': {
        const sub = raw[1];
        if (sub === 'f') await h.music({ t: 'fade' });
        else if (sub === 'w') await h.music({ t: 'wait-fade' });
        else if (sub === 's') {
          this.music = null;
          await h.music({ t: 'stop' });
        } else if (sub === 'n') {
          this.music = dec(raw.slice(2, 4));
          await h.music({ t: 'next', no: this.music });
        } else {
          this.music = dec(raw.slice(1, 3));
          await h.music({ t: 'play', no: this.music });
        }
        break;
      }
      case 'P': {
        const sub = raw[1];
        if (sub === 'l') await h.sound({ t: 'load', no: dec(raw.slice(2, 4)) });
        else if (sub === 'w') await h.sound({ t: 'wait' });
        else if (sub === 's') await h.sound({ t: 'stop' });
        else if (sub === 'f') await h.sound({ t: 'fade' });
        else await h.sound({ t: 'play', arg: raw.slice(1) });
        break;
      }
      // X (text offset) and s (text speed) only matter to the original's text layout.
    }
  }

  private textEffect(digits: string): Effect {
    const n = dec(digits);
    return n === 99 ? 'cut' : effectFromTable(n);
  }
}
