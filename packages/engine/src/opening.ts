import type { GameFiles } from './game.ts';
import { decodeLfg, type Lfg } from './lfg.ts';
import { decodeLfd, opS0Cell, type LfdFrames } from './lfd.ts';
import { HEIGHT, WIDTH, type Frame } from './scene.ts';

/**
 * The PC-98 opening (MAX_ADV.EXE, the routine that loads OP_*.LF?), as a
 * function of the vsync count: Leaf's logo, three drop-and-ripple sequences,
 * Mizuho, Saori, Ruriko's hair in the wind and her head turn, then the title.
 * Timings were measured in the emulator, counting from the RETURN on the
 * sound-source menu; see docs/OPENING.md.
 */

/** From this vsync on the opening shows the finished title screen. */
export const OPENING_END = 2346;

/** Songs the opening starts (SZ_FMnn) and the vsync they start at. */
export const OPENING_MUSIC: readonly { vsync: number; song: number }[] = [
  { vsync: 88, song: 0 },
  { vsync: 438, song: 15 },
];

/** A PC-98 palette: 16 colours x R, G, B, each 0-15. */
export type Palette4 = Uint8Array;

export const palette4 = (rgb: Uint8Array): Palette4 => rgb.map((v) => v >> 4);

/** Step k of 15 of the PC-98's linear, floored palette fade from `from` to `to`. */
export function fadePalette(from: Palette4, to: Palette4, k: number): Palette4 {
  return from.map((v, i) => Math.floor((v * (15 - k) + to[i] * k) / 15));
}

const solid = (r: number, g = r, b = r): Palette4 => {
  const p = new Uint8Array(48);
  for (let i = 0; i < 16; i++) p.set([r, g, b], i * 3);
  return p;
};
const BLACK = solid(0);

/** The drop and its ripples (the opening and the teardrop, opcode 01 03). */
export interface RippleAssets {
  /** OP_S0.LFD: ten 128x200 cells of a drop falling and splashing. */
  drops: Uint8Array[];
  /** OP_S1.LFG: nine 1-bit ripple frames in the bit planes of one picture. */
  ripples: Lfg;
}

export function loadRipple(files: GameFiles): RippleAssets {
  const sheet = decodeLfd(files.read('OP_S0.LFD'));
  return {
    drops: Array.from({ length: 10 }, (_, k) => opS0Cell(sheet, k)),
    ripples: decodeLfg(files.read('OP_S1.LFG')),
  };
}

export interface OpeningAssets extends RippleAssets {
  leaf: Lfg;
  mizuho: Lfg;
  saori: Lfg;
  /** OP_L0 left and right halves and OP_L1: Ruriko's hair in the wind (320x400 each). */
  hair: Uint8Array[];
  hairPalette: Palette4;
  /** OP_L2.LFD: six 224x224 frames of her head turning. */
  head: LfdFrames;
  title0: Lfg;
  title: Lfg;
}

export function loadOpening(files: GameFiles): OpeningAssets {
  const lfg = (path: string) => decodeLfg(files.read(path));
  const l0 = lfg('OP_L0.LFG');
  const l1 = lfg('OP_L1.LFG');
  const half = (img: Lfg, x0: number) => {
    const out = new Uint8Array(320 * 400);
    for (let y = 0; y < 400; y++) out.set(img.pixels.subarray(y * img.width + x0, y * img.width + x0 + 320), y * 320);
    return out;
  };
  return {
    ...loadRipple(files),
    leaf: lfg('LEAF.LFG'),
    mizuho: lfg('OP_V0.LFG'),
    saori: lfg('OP_V1.LFG'),
    hair: [half(l0, 0), half(l0, 320), half(l1, 0)],
    hairPalette: palette4(l0.palette),
    head: decodeLfd(files.read('OP_L2.LFD')),
    title0: lfg('TITLE0.LFG'),
    title: lfg('TITLE.LFG'),
  };
}

/** A 640x400 indexed picture and the palette it is shown with. */
export class Screen {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT);
  palette: Palette4 = BLACK;
  /** Pixels forced to black regardless of the palette (the text layer's mask). */
  readonly mask = new Uint8Array(WIDTH * HEIGHT);

  clear(index = 0) {
    this.pixels.fill(index);
    this.mask.fill(0);
  }

  /** Masks everything outside the rectangle (x0, y0)-(x1, y1), exclusive. */
  window(x0: number, y0: number, x1: number, y1: number) {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) if (x < x0 || x >= x1 || y < y0 || y >= y1) this.mask[y * WIDTH + x] = 1;
    }
  }

  /** Copies a w x h block of indices to (dx, dy); `skip` is a transparent index. */
  blit(src: Uint8Array, w: number, h: number, dx: number, dy: number, skip?: number) {
    for (let y = 0; y < h; y++) {
      const sy = dy + y;
      if (sy < 0 || sy >= HEIGHT) continue;
      for (let x = 0; x < w; x++) {
        const c = src[y * w + x];
        const sx = dx + x;
        if (c !== skip && sx >= 0 && sx < WIDTH) this.pixels[sy * WIDTH + sx] = c;
      }
    }
  }

  lfg(img: Lfg, dx = img.x, dy = img.y, skip = img.transparent) {
    this.blit(img.pixels, img.width, img.height, dx, dy, skip);
  }

  /** The picture as a frame (the mask is dropped). */
  toFrame(): Frame {
    return { pixels: this.pixels.slice(), palette: this.palette.map((v) => v * 0x11) };
  }

  /** Writes RGBA (8 bits per channel) into `out`. */
  toRgba(out: Uint8ClampedArray) {
    const p = this.palette;
    for (let i = 0; i < this.pixels.length; i++) {
      const o = i * 4;
      if (this.mask[i]) {
        out[o] = out[o + 1] = out[o + 2] = 0;
      } else {
        const c = this.pixels[i] * 3;
        out[o] = p[c] * 0x11;
        out[o + 1] = p[c + 1] * 0x11;
        out[o + 2] = p[c + 2] * 0x11;
      }
      out[o + 3] = 255;
    }
  }
}

/** The colour of the drop and the ripples. */
const RIPPLE_RGB = [3, 1, 11];
/** Number of steps in one drop-and-ripple sequence. */
export const RIPPLE_STEPS = 19;

/**
 * Step 0-18 of the drop and its ripples, lit pixels in colour 1 (#31B) on
 * black: OP_S0's ten cells, then the nine frames in OP_S1's bit planes.
 */
export function drawRipple(a: RippleAssets, step: number, s: Screen) {
  s.clear();
  s.palette = solid(0);
  s.palette.set(RIPPLE_RGB, 3);
  const plot = (bits: (x: number, y: number) => number, w: number, dx: number) => {
    for (let y = 0; y < 200; y++) for (let x = 0; x < w; x++) if (bits(x, y)) s.pixels[(160 + y) * WIDTH + dx + x] = 1;
  };
  if (step < 10) {
    const cell = a.drops[step];
    plot((x, y) => cell[y * 128 + x], 128, 256);
    s.window(256, 160, 384, 368);
    return;
  }
  const r = a.ripples;
  const bit = (plane: number, x0: number, y0: number) => (x: number, y: number) => (r.pixels[(y0 + y) * r.width + x0 + x] >> plane) & 1;
  if (step < 12) {
    plot(bit(0, step === 10 ? 0 : 320, 0), 320, 160);
    s.window(160, 160, 480, 368);
    return;
  }
  // 12: plane 0 bottom; 13, 14: plane 1 top, bottom; 15, 16: plane 2; 17, 18: plane 3.
  const plane = step === 12 ? 0 : (step - 11) >> 1;
  const top = step !== 12 && step % 2 === 1;
  plot(bit(plane, 0, top ? 0 : 200), 640, 0);
  s.window(0, 160, 640, 368);
}

/**
 * Which ripple step is shown `t` vsyncs into a sequence (-1: black). A new
 * step every 7 vsyncs; the first one lasts 6, the last is followed by black.
 */
export function rippleStep(t: number): number {
  if (t < 0) return -1;
  if (t < 6) return 0;
  const k = Math.floor((t + 1) / 7);
  return k < RIPPLE_STEPS ? k : -1;
}

const RIPPLES = [483, 883, 1277];
const PORTRAITS = [
  { at: 660, img: 'mizuho' },
  { at: 1054, img: 'saori' },
] as const;
const RURIKO = 1496;
/** Head-turn frames: the vsyncs at which OP_L2 frames 0-5 appear. */
const HEAD_TURN = [1778, 1787, 1795, 1804, 1816, 1828];

/** The order of the title dissolve, (y mod 4, x mod 4) per step. */
export const DISSOLVE_ORDER = [
  [0, 0], [2, 2], [0, 2], [2, 0], [1, 1], [3, 3], [1, 3], [3, 1],
  [0, 1], [2, 3], [0, 3], [2, 1], [1, 0], [3, 2], [1, 2], [3, 0],
] as const;

/** Fade step (0-15) `t` vsyncs into a fade that changes every `every` vsyncs, starting with step 1. */
const fadeStep = (t: number, every: number) => (t < 0 ? 0 : Math.min(15, Math.floor(t / every) + 1));

/** Draws vsync `n` of the opening into `s`. */
export function renderOpening(a: OpeningAssets, n: number, s: Screen) {
  s.clear();
  s.palette = BLACK;
  if (n < 81) return;

  // Leaf's logo: the screen goes white, the logo fades in, letterbox bands, fade out.
  if (n < 437) {
    s.clear(15);
    s.lfg(a.leaf, 80, 148);
    const white = solid(15);
    const leaf = palette4(a.leaf.palette);
    if (n < 175) s.palette = solid(fadeStep(n - 81, 4));
    else if (n < 379) s.palette = fadePalette(white, leaf, fadeStep(n - 175, 4));
    else s.palette = fadePalette(leaf, BLACK, fadeStep(n - 379, 4));
    if (n >= 261) {
      const w = 32 * Math.min(20, n - 260);
      for (let y = 0; y <= 80; y++) s.mask.fill(1, y * WIDTH + WIDTH - w, (y + 1) * WIDTH);
      for (let y = 320; y < HEIGHT; y++) s.mask.fill(1, y * WIDTH, y * WIDTH + w);
    }
    return;
  }

  for (const at of RIPPLES) {
    const step = rippleStep(n - at);
    if (n >= at && n < at + 140) {
      if (step >= 0) drawRipple(a, step, s);
      return;
    }
  }

  for (const { at, img } of PORTRAITS) {
    if (n >= at && n < at + 180) {
      const pic = a[img];
      s.lfg(pic);
      const pal = palette4(pic.palette);
      s.palette = n < at + 124 ? fadePalette(BLACK, pal, fadeStep(n - at, 4)) : fadePalette(pal, BLACK, fadeStep(n - at - 124, 4));
      return;
    }
  }

  if (n >= RURIKO && n < 2116) {
    renderRuriko(a, n, s);
    return;
  }

  if (n >= 2181) {
    s.lfg(a.title0);
    s.palette = fadePalette(BLACK, palette4(a.title0.palette), fadeStep(n - 2181, 4));
    if (n >= 2300) drawDissolve(a.title, s, n - 2300);
  }
}

/** The vsyncs at which Ruriko's hair moves to the next frame (A, B, C, A...; A first). */
function hairChanges(): number[] {
  const at: number[] = [];
  for (let n = RURIKO + 6; n < HEAD_TURN[0]; n += 12) at.push(n);
  at.push(...HEAD_TURN);
  for (let n = HEAD_TURN[5] + 12; n < 2116; n += 12) at.push(n);
  return at;
}
const HAIR_CHANGES = hairChanges();

/**
 * Ruriko: the hair moves every 12 vsyncs while the palette fades in and out
 * in steps of 6; the head turn is pasted over the frames shown during it,
 * then she keeps her eyes open (head frames 3-5 follow hair frames A-C).
 */
function renderRuriko(a: OpeningAssets, n: number, s: Screen) {
  const change = HAIR_CHANGES.filter((at) => at <= n).length;
  s.blit(a.hair[change % 3], 320, 400, 160, 0);
  const turned = HEAD_TURN.filter((at) => at <= n).length - 1;
  if (turned >= 0) s.blit(a.head.frames[turned < 3 ? turned : 3 + (change % 3)], 224, 224, 224, 16);
  s.window(160, 0, 480, HEIGHT);
  s.palette = n < 2032 ? fadePalette(BLACK, a.hairPalette, fadeStep(n - RURIKO, 6)) : fadePalette(a.hairPalette, BLACK, fadeStep(n - 2032, 6));
}

/** The title logo's dissolve: 16 steps of 3 vsyncs, each drawn over two vsyncs (rows < 184, then the rest). */
function drawDissolve(title: Lfg, s: Screen, t: number) {
  for (let i = 0; i < 16; i++) {
    const at = i * 3;
    if (t < at) break;
    const [ry, rx] = DISSOLVE_ORDER[i];
    const rows = t === at ? 184 : HEIGHT;
    for (let y = (ry - title.y) & 3; y < title.height; y += 4) {
      if (title.y + y >= rows) break;
      for (let x = rx; x < title.width; x += 4) {
        const c = title.pixels[y * title.width + x];
        if (c) s.pixels[(title.y + y) * WIDTH + title.x + x] = c;
      }
    }
  }
}

/** The title screen as the opening leaves it: TITLE0 with the logo (TITLE, colour 0 transparent) over it. */
export function titleFrame(files: GameFiles): Frame {
  const s = new Screen();
  const bg = decodeLfg(files.read('TITLE0.LFG'));
  s.lfg(bg);
  s.lfg(decodeLfg(files.read('TITLE.LFG')), undefined, undefined, 0);
  s.palette = palette4(bg.palette);
  return s.toFrame();
}

/**
 * The teardrop (opcode 01 03 n): the opening's drop and ripples on black.
 * n = 0 plays the whole sequence twice; n = 1 plays it once with slowing
 * steps and stops on step 14, which stays on screen (the scripts then
 * dissolve VIS25 over it). Returns the step shown at vsync t (-1: black) and
 * whether the animation is over.
 */
export function teardropStep(variant: number, t: number): { step: number; done: boolean } {
  if (variant === 0) {
    const first = rippleStep(t - TEARDROP_LOAD);
    const second = rippleStep(t - TEARDROP_LOAD - TEARDROP_AGAIN);
    return { step: first >= 0 ? first : second, done: t >= TEARDROP_LOAD + TEARDROP_AGAIN + 133 };
  }
  const at = t - TEARDROP_LOAD;
  return { step: TEARDROP_SLOW.filter((v) => v <= at).length - 1, done: at >= TEARDROP_HOLD };
}
/** Vsyncs from the opcode to the first drop (the disk load, in the emulator). */
const TEARDROP_LOAD = 45;
/** From the first sequence's start to the second's. */
const TEARDROP_AGAIN = 207;
/** Variant 1: when each step appears; the last ones slow down. */
const TEARDROP_SLOW = [0, 6, 13, 20, 27, 34, 41, 48, 55, 62, 69, 76, 85, 96, 109];
const TEARDROP_HOLD = 145;
