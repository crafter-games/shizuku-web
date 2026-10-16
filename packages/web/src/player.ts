// The Host the interpreter talks to: turns script events into what the UI
// shows (text pages, choices) and waits for the player.
import {
  Interpreter, composeScene, emptyVisual, lfgLoader, type GameFiles, type Host, type MessageRef,
  type SavePoint, type TextSegment, type Visual, type Effect, type MusicCommand, type SoundCommand,
  type PaletteOp, VSYNC_MS,
  tokenizeText,
} from '@shizuku/engine';
import { japanese, spanish } from './translation.ts';
import type { Stage } from './stage.ts';
import type { Audio } from './audio.ts';
import type { Progress, Settings } from './storage.ts';

export interface Choice {
  prompt: string;
  options: string[];
}

export interface UiState {
  /** Paragraphs on the current page. */
  page: string[];
  /** Characters of the last paragraph shown so far (typewriter). */
  typed: number;
  textVisible: boolean;
  waiting: boolean;
  choice: Choice | null;
  mode: 'normal' | 'auto' | 'skip';
  ended: boolean;
}

export interface BacklogEntry {
  text: string;
  /** Lets "replay" jump back... not yet; kept for display only. */
  ref: string;
}

export class Player implements Host {
  readonly interp: Interpreter;
  private readonly load: ReturnType<typeof lfgLoader>;
  state: UiState = { page: [], typed: 0, textVisible: false, waiting: false, choice: null, mode: 'normal', ended: false };
  backlog: BacklogEntry[] = [];
  lastPoint: SavePoint | undefined;
  private listeners = new Set<() => void>();
  private resume: (() => void) | undefined;
  private choose_: ((i: number) => void) | undefined;
  private typing: { resolve: () => void; timer: number } | undefined;
  /** Called at each choice with the save point, for the auto-save. */
  onChoice?: (point: SavePoint) => void;
  onEnd?: () => void;

  readonly stage: Stage;
  readonly audio: Audio;
  readonly shakeTarget: () => HTMLElement;
  settings: Settings;
  readonly progress: Progress;

  constructor(files: GameFiles, stage: Stage, audio: Audio, shakeTarget: () => HTMLElement, settings: Settings, progress: Progress) {
    this.stage = stage;
    this.audio = audio;
    this.shakeTarget = shakeTarget;
    this.settings = settings;
    this.progress = progress;
    this.interp = new Interpreter(files, this);
    this.load = lfgLoader(files);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<UiState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  async start(point: SavePoint) {
    this.stage.setDim(false);
    await this.interp.run(point);
    if (!this.interp.stopped) {
      this.set({ ended: true });
      this.onEnd?.();
    }
  }

  stop() {
    this.interp.stop();
    this.resume?.();
    this.choose_?.(0);
    this.audio.stopAll();
  }

  setMode(mode: UiState['mode']) {
    this.set({ mode: this.state.mode === mode ? 'normal' : mode });
    this.stage.fast = this.state.mode === 'skip';
    if (this.state.mode !== 'normal') this.advance();
  }

  /** Click / tap / Enter: finish the line being typed, or continue. */
  advance() {
    if (this.typing) {
      clearInterval(this.typing.timer);
      this.typing.resolve();
      return;
    }
    const r = this.resume;
    this.resume = undefined;
    r?.();
  }

  pick(i: number) {
    const c = this.choose_;
    this.choose_ = undefined;
    c?.(i);
  }

  // --- Host ---

  savePoint(point: SavePoint) {
    this.lastPoint = point;
  }

  hideText() {
    this.set({ textVisible: false, page: [], typed: 0 });
    this.stage.setDim(false);
  }

  private frame(visual: Visual) {
    return composeScene(visual, this.load);
  }

  async clear(effect: Effect) {
    await this.stage.clear(effect);
  }

  async show(visual: Visual, effect: Effect) {
    this.markSeen(visual);
    await this.stage.transition(this.frame(visual), effect);
  }

  private markSeen(visual: Visual) {
    if (visual.bg.kind === 'bg') return;
    const key = `${visual.bg.kind}:${visual.bg.no}`;
    if (!this.progress.seen.includes(key)) this.progress.seen.push(key);
  }

  private segmentText(seg: { scn: number; msg: number; index: number; tokens: TextSegment['tokens'] }) {
    const bytes = this.interp.scenario(seg.scn).texts[seg.msg];
    return spanish(seg.scn, seg.msg, seg.index, bytes) ?? japanese(seg.tokens);
  }

  private messageText(ref: MessageRef) {
    const bytes = this.interp.scenario(ref.scn).texts[ref.msg];
    const tokens = tokenizeText(bytes);
    return spanish(ref.scn, ref.msg, 0, bytes) ?? japanese(tokens);
  }

  async text(seg: TextSegment) {
    const key = `${seg.scn}:${seg.msg}:${seg.index}`;
    const read = this.progress.read.includes(key);
    if (!read) this.progress.read.push(key);
    const skipping = this.state.mode === 'skip' && (read || this.settings.skipUnread);
    if (this.state.mode === 'skip' && !skipping) this.setMode('normal');

    const text = this.segmentText(seg);
    const page = [...this.state.page];
    const continues = !seg.newline && page.length > 0;
    if (continues) page[page.length - 1] += (/[　-鿿]$/.test(page.at(-1)!) ? '' : ' ') + text;
    else page.push(text);
    const typedFrom = continues ? page.at(-1)!.length - text.length : 0;
    this.stage.setDim(true);
    this.set({ page, typed: typedFrom, textVisible: true, waiting: false });
    this.backlog.push({ text, ref: key });
    if (this.backlog.length > 500) this.backlog.shift();

    const full = page.at(-1)!.length;
    const speed = skipping ? 0 : this.settings.textSpeed;
    if (speed > 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          const typed = Math.min(full, this.state.typed + 1);
          this.set({ typed });
          if (typed >= full) {
            clearInterval(timer);
            this.typing = undefined;
            resolve();
          }
        }, speed);
        this.typing = {
          timer,
          resolve: () => {
            this.typing = undefined;
            resolve();
          },
        };
      });
    }
    this.set({ typed: full });
    if (seg.wait === 'none') return;

    this.set({ waiting: true });
    await new Promise<void>((resolve) => {
      this.resume = resolve;
      if (skipping) setTimeout(() => this.advance(), 20);
      else if (this.state.mode === 'auto') setTimeout(() => this.resume === resolve && this.advance(), this.settings.autoDelay + text.length * 15);
    });
    this.set({ waiting: false });
    if (seg.wait === 'page') this.set({ page: [], typed: 0 });
  }

  async choose(prompt: MessageRef, options: MessageRef[]) {
    if (this.state.mode === 'skip') this.setMode('normal');
    if (this.lastPoint) this.onChoice?.(this.lastPoint);
    const promptText = this.messageText(prompt);
    this.stage.setDim(true);
    this.set({
      textVisible: true,
      page: [promptText],
      typed: promptText.length,
      choice: { prompt: promptText, options: options.map((o) => this.messageText(o)) },
    });
    const i = await new Promise<number>((resolve) => (this.choose_ = resolve));
    this.backlog.push({ text: `▶ ${this.state.choice?.options[i] ?? ''}`, ref: '' });
    this.set({ choice: null, page: [], typed: 0 });
    return i;
  }

  music(cmd: MusicCommand) {
    return this.audio.music(cmd);
  }

  sound(cmd: SoundCommand) {
    return this.audio.sound(cmd);
  }

  shake() {
    return this.stage.shake(this.shakeTarget());
  }

  flash() {
    return this.stage.flash();
  }

  ripple(on: boolean) {
    this.stage.ripple(on);
  }

  async teardrop(_variant: number) {
    // The teardrop animation (OP_S0.LFD) is not decoded yet: a short fade stands in.
    await this.stage.clear('palette');
    await this.stage.transition(this.frame(this.interp.visual.bg.no ? this.interp.visual : emptyVisual()), 'palette');
  }

  wait(ms: number) {
    if (this.state.mode === 'skip') return Promise.resolve();
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  async palette(op: PaletteOp) {
    const fade = (vsyncs: number) => Math.min(2000, 16 * Math.max(1, vsyncs) * VSYNC_MS);
    const s = this.stage;
    switch (op.t) {
      case 'normal': return s.setTint(0, 0);
      case 'black': return s.setTint(0, 1);
      case 'white': return s.setTint(255, 1);
      case 'fade-to': return s.setTint(op.color === 'white' ? 255 : 0, 1, fade(op.vsyncs));
      case 'fade-from': return s.setTint(op.color === 'white' ? 255 : 0, 0, fade(op.vsyncs));
      case 'grey': return s.setTint(128, op.amount);
      case 'fade-grey': return s.setTint(128, op.on ? 1 : 0, 16 * 2 * VSYNC_MS);
      case 'dim':
        // Text already dims the palette behind it (style of opcode 64); nothing extra.
        return;
    }
  }

  async ending(_no: number) {
    this.hideText();
    await this.stage.clear('palette');
  }
}
