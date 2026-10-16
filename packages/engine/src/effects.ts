import type { GameFiles } from './game.ts';
import { decodeKcode } from './kcode.ts';
import { DISSOLVE_ORDER } from './opening.ts';
import { HEIGHT, WIDTH, type Frame } from './scene.ts';

/**
 * The PC-98's screen transitions, as MAX_ADV.EXE runs them. Scripts name them
 * by number (0-12): op 15 n and the first two digits of inline B/E/V/H/S
 * commands *clear* the picture to black with routine n; op 38 n and the last
 * two digits *show* the new picture with routine n, from black. 99 skips the
 * step. Most are masks drawn in the text layer: 16x16 cells, blank, solid or
 * one of KCODE.SDT's user-defined glyphs, over the graphics.
 *
 * | n | clear (old picture to black) | show (black to the new picture) |
 * |---|---|---|
 * | 0 fade | palette: dims, then fades to black, 3 vsyncs a step | fades in from black, 3 a step |
 * | 1 spiral | 16x16 cells go black in a spiral from the top left inward, 8 per vsync | cells open in a spiral from the centre out |
 * | 2 random | 1000 cells in a pseudo-random order, 32 per vsync | same, opening |
 * | 3 diamonds | KCODE diamonds grow over the whole screen, 32 sizes x 2 vsyncs | diamond holes grow |
 * | 4 diamond-wipe | the diamonds grow column by column from the left | same, opening |
 * | 5 dither | KCODE dither, 17 steps x 2 vsyncs | same, opening |
 * | 6 lines | lines go black in a 16-line interleave, top to bottom | the new picture replaces the old line by line, same order |
 * | 7 bar-wipe | KCODE bars sweep from the left, 56 steps x 2 | same, opening |
 * | 8 dither-wipe | the dither sweeps from the left | same, opening |
 * | 9 squash | the picture shrinks to a line at the centre, 16 vsyncs | grows from the centre line |
 * | 10 bars | KCODE bars over the whole screen, 17 steps x 2 | same, opening |
 * | 11 cut | at once | at once |
 * | 12 dissolve | (none) | ordered 4x4 dissolve from what is on screen, 16 steps x 3 |
 */
export const EFFECTS = [
  'fade', 'spiral', 'random', 'diamonds', 'diamond-wipe', 'dither', 'lines', 'bar-wipe', 'dither-wipe', 'squash',
  'bars', 'cut', 'dissolve',
] as const;
export type Effect = (typeof EFFECTS)[number];

/** The effect a script number names; undefined for 99 (skip) and numbers the game ignores. */
export const effectFromNumber = (n: number): Effect | undefined => EFFECTS[n];

/** What the transitions need from the disks. */
export interface TransitionData {
  /** KCODE.SDT: 162 16x16 glyphs, 0/1 per pixel. */
  kcode: Uint8Array[];
  /** Line masks for 'squash': entry i keeps 15 - i lines of every 16 (bit n = line n). */
  squash: number[];
}

/** MAX_ADV.EXE's data segment starts here in the load image. */
const EXE_DATA = 0x111c0;
/** The squash masks, in the data segment. */
const EXE_SQUASH = 0x1566;

export function loadTransitionData(files: GameFiles): TransitionData {
  return { kcode: decodeKcode(files.read('KCODE.SDT')), squash: squashMasks(files.read('MAX_ADV.EXE')) };
}

const popcount = (v: number) => {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
};

/** Reads the squash masks from the EXE; spreads the lines evenly if they are not where expected. */
export function squashMasks(exe: Uint8Array): number[] {
  const at = (exe[8] | (exe[9] << 8)) * 16 + EXE_DATA + EXE_SQUASH;
  const masks = Array.from({ length: 16 }, (_, i) => exe[at + i * 2] | (exe[at + i * 2 + 1] << 8));
  if (masks.every((m, i) => popcount(m) === 15 - i)) return masks;
  return Array.from({ length: 16 }, (_, i) => {
    const keep = 15 - i;
    let m = 0;
    for (let line = 0; line < 16; line++) if (Math.floor(((line + 1) * keep) / 16) > Math.floor((line * keep) / 16)) m |= 1 << line;
    return m;
  });
}

/** The game's pseudo-random bytes (a 16-bit shift register seeded from the clock). */
export function gameRandom(seed = Math.floor(Math.random() * 0x10000)): () => number {
  let s = seed & 0xffff || 1;
  return () => {
    const fb = ((s >> 4) & 1) ^ ((s >> 15) & 1);
    s = ((s << 1) + fb) & 0xffff;
    s = fb ? s & ~0x80 : s | 0x80;
    return (s & 0xff) ^ (s >> 8);
  };
}

/** One RGBA pixel as ImageData stores it, read as a little-endian u32. */
export const rgba32 = (r: number, g: number, b: number) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const BLACK32 = rgba32(0, 0, 0);

/** Paints an indexed frame with `palette` (8-bit RGB triplets) into `out`. */
export function paint(frame: Frame, palette: Uint8Array, out: Uint32Array) {
  const lut = new Uint32Array(16);
  for (let c = 0; c < 16; c++) lut[c] = rgba32(palette[c * 3], palette[c * 3 + 1], palette[c * 3 + 2]);
  for (let i = 0; i < out.length; i++) out[i] = lut[frame.pixels[i]];
}

/**
 * The palette behind text: colours 0-14 at (15-k)/15 per 4-bit channel,
 * floored; colour 15 (the text) unchanged. k = 5 is the full dim (10/15);
 * the PC-98 dims and undims in 5 steps of 2 vsyncs.
 */
export function dimPalette(palette: Uint8Array, k = 5): Uint8Array {
  return palette.map((v, i) => (i >= 45 ? v : Math.floor(((v >> 4) * (15 - k)) / 15) * 0x11));
}

/** Step k of 15 of the PC-98's linear, floored fade between two palettes (8-bit RGB). */
export function fadeRgb(from: Uint8Array, to: Uint8Array, k: number): Uint8Array {
  return from.map((v, i) => Math.floor(((v >> 4) * (15 - k) + (to[i] >> 4) * k) / 15) * 0x11);
}

/** The graphics and the text-layer mask over them, as the transitions draw them. */
export interface Layers {
  /** The graphics, RGBA. */
  screen: Uint32Array;
  /** 1 where the text layer hides the graphics (black). */
  cover: Uint8Array;
}

export interface TransitionInput extends TransitionData {
  /** The picture on screen, with the palette it is shown with. */
  from: Frame;
  /** The picture to show (ignored when clearing). */
  to: Frame;
  random: () => number;
}

/** Vsyncs each squash / expand step stays on screen (the large copies take two). */
const SQUASH_HOLD = [1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const EXPAND_HOLD = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1];
/** The dissolve copies the rows above this one a vsync before the rest. */
export const DISSOLVE_SPLIT = 184;

const CELLS_X = 40;
const CELLS_Y = 25;

/** Composes the layers into RGBA. */
export function compose(l: Layers, out: Uint32Array) {
  for (let i = 0; i < out.length; i++) out[i] = l.cover[i] ? BLACK32 : l.screen[i];
}

/** Sets 16x16 cell (cx, cy) of the cover: solid, or a glyph whose lit pixels get `lit`. */
function cell(cover: Uint8Array, cx: number, cy: number, glyph?: Uint8Array, lit = 1) {
  const x0 = cx * 16;
  for (let y = 0; y < 16; y++) {
    const row = (cy * 16 + y) * WIDTH + x0;
    if (!glyph) cover.fill(lit, row, row + 16);
    else for (let x = 0; x < 16; x++) cover[row + x] = glyph[y * 16 + x] ? lit : 1 - lit;
  }
}

/**
 * Runs a transition. The generator changes `layers`, then yields how many
 * vsyncs that state stays on screen; when it returns, the layers show the
 * final picture (black for a clear). The caller paints `from` into
 * `layers.screen` and clears `layers.cover` before starting.
 */
export function* transition(effect: Effect, phase: 'clear' | 'show', io: TransitionInput, layers: Layers): Generator<number> {
  const { screen, cover } = layers;
  const clearing = phase === 'clear';
  /** Text-layer effects start from a clear (clearing) or fully masked (showing) text layer. */
  const lit = clearing ? 1 : 0;
  const glyphs = io.kcode;
  const to = new Uint32Array(WIDTH * HEIGHT);
  if (!clearing) paint(io.to, io.to.palette, to);
  const textMask = () => {
    if (!clearing) {
      screen.set(to);
      cover.fill(1);
    }
  };
  const finish = () => {
    if (clearing) screen.fill(BLACK32);
    else screen.set(to);
    cover.fill(0);
  };
  const diamond = (size: number, cx: number, cy: number) => glyphs[size * 4 + (cy & 1) + 2 * (cx & 1)];

  switch (effect) {
    case 'cut':
      break;
    case 'fade': {
      // Clearing starts from the dimmed palette whether text was shown or not.
      const base = clearing ? dimPalette(io.from.palette) : new Uint8Array(48);
      const target = clearing ? new Uint8Array(48) : io.to.palette;
      const frame = clearing ? io.from : io.to;
      if (clearing) {
        paint(frame, base, screen);
        yield 3;
      }
      for (let k = 1; k <= 15; k++) {
        paint(frame, fadeRgb(base, target, k), screen);
        yield 3;
      }
      break;
    }
    case 'spiral':
      textMask();
      if (clearing) {
        // Down the left edge, along the bottom, up, back, inward; one wait per 8 cells of a leg.
        let rows = CELLS_Y, cols = CELLS_X - 1, x = 0, y = -1, d = 1;
        while (rows > 0) {
          for (let i = 0; i < rows; i++) {
            y += d;
            cell(cover, x, y);
            if (i % 8 === 0) yield 1;
          }
          rows--;
          for (let i = 0; i < cols; i++) {
            x += d;
            cell(cover, x, y);
            if (i % 8 === 0) yield 1;
          }
          cols--;
          d = -d;
        }
      } else {
        // The same spiral's corners, walked back from the centre, 8 cells per vsync.
        const corner = (k: number): [number, number] => {
          const m = k >> 2;
          switch (k & 3) {
            case 0: return k ? [m - 1, m] : [0, 0];
            case 1: return [CELLS_X - 1 - m, m];
            case 2: return [CELLS_X - 1 - m, CELLS_Y - 1 - m];
            default: return [m, CELLS_Y - 1 - m];
          }
        };
        let [x, y] = corner(49);
        let n = 0;
        for (let k = 48; k >= 0; k--) {
          const [tx, ty] = corner(k);
          while (x !== tx || y !== ty) {
            cell(cover, x, y, undefined, 0);
            if (x !== tx) x += Math.sign(tx - x);
            else y += Math.sign(ty - y);
            if (++n % 8 === 0) yield 1;
          }
        }
      }
      break;
    case 'random': {
      textMask();
      const used = new Uint8Array(CELLS_X * CELLS_Y);
      for (let n = 0; n < used.length; n++) {
        const cx = (io.random() * CELLS_X) >> 8;
        const cy = (io.random() * CELLS_Y) >> 8;
        let i = cy * CELLS_X + cx;
        while (used[i]) i = (i + 1) % used.length;
        used[i] = 1;
        cell(cover, i % CELLS_X, Math.floor(i / CELLS_X), undefined, lit);
        if (n % 32 === 0) yield 1;
      }
      break;
    }
    case 'diamonds':
      textMask();
      yield 2;
      for (let size = 0; size < 32; size++) {
        for (let cy = 0; cy < CELLS_Y; cy++) for (let cx = 0; cx < CELLS_X; cx++) cell(cover, cx, cy, diamond(size, cx, cy), lit);
        yield 2;
      }
      break;
    case 'diamond-wipe':
      textMask();
      yield 2;
      // Each pair of columns runs one step behind the pair to its left. No waits in
      // the original: the CPU takes about 2 vsyncs a step.
      for (let t = 0; t < 52; t++) {
        for (let cx = 0; cx < CELLS_X; cx++) {
          const size = t - (cx >> 1);
          if (size >= 0 && size < 32) for (let cy = 0; cy < CELLS_Y; cy++) cell(cover, cx, cy, diamond(size, cx, cy), lit);
        }
        yield 2;
      }
      break;
    case 'dither':
    case 'bars': {
      textMask();
      const last = effect === 'dither' ? 161 : 144;
      for (let k = 0; k <= 16; k++) {
        for (let cy = 0; cy < CELLS_Y; cy++) for (let cx = 0; cx < CELLS_X; cx++) cell(cover, cx, cy, glyphs[last - k], lit);
        yield 2;
      }
      break;
    }
    case 'bar-wipe':
    case 'dither-wipe': {
      textMask();
      const last = effect === 'dither-wipe' ? 161 : 144;
      for (let t = 0; t < 56; t++) {
        for (let k = 0; k <= 16; k++) {
          const cx = t - k;
          if (cx >= 0 && cx < CELLS_X) for (let cy = 0; cy < CELLS_Y; cy++) cell(cover, cx, cy, glyphs[last - k], lit);
        }
        yield 2;
      }
      break;
    }
    case 'lines':
      // Step t touches lines t, t-17, t-34... (16 of them): every line once, top to bottom.
      for (let t = 0; t < 0x290; t += 16) {
        for (let j = 0, y = t; j < 16; j++, y -= 17) {
          if (y < 0 || y >= HEIGHT) continue;
          if (clearing) screen.fill(BLACK32, y * WIDTH, (y + 1) * WIDTH);
          else screen.set(to.subarray(y * WIDTH, (y + 1) * WIDTH), y * WIDTH);
        }
        yield 2;
      }
      break;
    case 'squash': {
      const src = new Uint32Array(WIDTH * HEIGHT);
      if (clearing) src.set(screen);
      else src.set(to);
      // Keep the lines a mask selects from each group of 16, packed, centred.
      const draw = (mask: number, top: number) => {
        screen.fill(BLACK32);
        let dy = top;
        for (let y = 0; y < HEIGHT; y++) {
          if (!((mask >> (y & 15)) & 1)) continue;
          screen.set(src.subarray(y * WIDTH, (y + 1) * WIDTH), dy * WIDTH);
          dy++;
        }
      };
      // One step per vsync, but the bigger copies take two.
      const hold = clearing ? SQUASH_HOLD : EXPAND_HOLD;
      for (let i = 0; i < hold.length; i++) {
        if (clearing) draw(io.squash[i], 13 * (i + 1));
        else draw(io.squash[14 - i], 195 - 13 * i);
        yield hold[i];
      }
      break;
    }
    case 'dissolve': {
      if (clearing) return;
      // Each step waits 3 vsyncs, then copies its pixels: the rows above 184 show a vsync before the rest.
      const copy = (ry: number, rx: number, y0: number, y1: number) => {
        for (let y = y0 + ((ry - y0) & 3); y < y1; y += 4) for (let x = rx; x < WIDTH; x += 4) screen[y * WIDTH + x] = to[y * WIDTH + x];
      };
      for (const [ry, rx] of DISSOLVE_ORDER) {
        yield 2;
        copy(ry, rx, 0, DISSOLVE_SPLIT);
        yield 1;
        copy(ry, rx, DISSOLVE_SPLIT, HEIGHT);
      }
      yield 1;
      break;
    }
  }
  finish();
}
