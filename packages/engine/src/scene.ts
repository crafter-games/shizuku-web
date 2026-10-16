import type { GameFiles } from './game.ts';
import { decodeLfg, type Lfg } from './lfg.ts';

export const WIDTH = 640;
export const HEIGHT = 400;

/** What is on screen, as the scripts describe it. Saved with the game. */
export interface Visual {
  /** bg: MAX_Snn backgrounds (0 = black); vis: VISnn event pictures; hvs: HVSnn. */
  bg: { kind: 'bg' | 'vis' | 'hvs'; no: number };
  /** Character sprites MAX_Cxx at the left, centre and right slots. */
  chars: { l: number | null; c: number | null; r: number | null };
}

export const emptyVisual = (): Visual => ({ bg: { kind: 'bg', no: 0 }, chars: { l: null, c: null, r: null } });

/** A composed 640x400 frame: palette indices plus the 16-colour palette (RGB). */
export interface Frame {
  pixels: Uint8Array;
  palette: Uint8Array;
}

// The rest of this file follows XLVNS sizuku_etc.c. On the PC-98 there is one
// 16-colour palette: backgrounds use entries 0-3 (time-of-day variants of a
// picture are palette swaps), sprites use 4-15 with 15 transparent.

/** Background numbers that reuse another picture with a different palette. */
const BG_FILE: Record<number, number> = {
  4: 2, 5: 2, 6: 3, 32: 31, 33: 31, 35: 34, 36: 34, 38: 11, 41: 15, 42: 15, 43: 10, 44: 10,
  45: 30, 46: 30, 47: 22, 48: 22, 49: 12, 50: 12, 51: 24, 52: 24, 53: 12, 54: 18, 55: 19,
};

const DAY = 0, DUSK = 1, NIGHT = 2, MIDNIGHT2 = 3, MIDNIGHT = 4, SUNSET = 5, DARK = 6, NIGHT2 = 7, DUSK2 = 8;
const BG_PALETTE: Record<number, number> = {
  4: DUSK2, 5: MIDNIGHT, 6: DUSK2, 32: SUNSET, 33: NIGHT2, 35: SUNSET, 36: NIGHT2, 38: DUSK, 41: DUSK,
  42: DAY, 43: DUSK, 44: MIDNIGHT, 45: DUSK, 46: MIDNIGHT2, 47: DUSK, 48: MIDNIGHT, 49: DUSK,
  50: MIDNIGHT, 51: DUSK, 52: NIGHT, 53: DARK, 54: DUSK, 55: DUSK,
};

/** Replacement colours 0-3 for each time of day. */
const TIME_PALETTES = [
  [0x000000, 0x665522, 0x888844, 0xbbcc88], // day
  [0x000000, 0x774433, 0xcc8844, 0xeecc55], // dusk (outside)
  [0x000000, 0x224466, 0x5588bb, 0xbbccff], // night
  [0x000000, 0x002233, 0x004455, 0x008899], // midnight
  [0x000000, 0x333355, 0x305088, 0x7788bb], // midnight classroom
  [0x000000, 0xbb0000, 0xff5500, 0xff7700], // red rooftop
  [0x000000, 0x000011, 0x000044, 0x112266], // pitch-dark corridor
  [0x000000, 0x222277, 0x4455bb, 0x7777ff], // rooftop at night
  [0x000000, 0x773333, 0xaa6633, 0xffbb66], // classroom at dusk
];

const DEFAULT_PALETTE = [
  0x000000, 0x000000, 0x000000, 0x000000, 0xffffff, 0x334444, 0x227777, 0xaabbff,
  0x7788ee, 0xffffaa, 0xee0033, 0x663333, 0xbb7755, 0xffbbbb, 0xffdddd, 0xffffff,
];

const CHAR_X = { l: 0, c: 160, r: 320 } as const;

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
const dec2 = (n: number) => String(n).padStart(2, '0');

export function backgroundFile(visual: Visual['bg']): string | undefined {
  switch (visual.kind) {
    case 'bg': return visual.no === 0 ? undefined : `BCK/MAX_S${dec2(BG_FILE[visual.no] ?? visual.no)}.LFG`;
    case 'vis': return `VIS/VIS${dec2(visual.no === 21 ? 2 : visual.no)}.LFG`;
    case 'hvs': return `HVS/HVS${dec2(visual.no)}.LFG`;
  }
}

export const characterFile = (no: number) => `CHR/MAX_C${hex2(no)}.LFG`;

function setRgb(palette: Uint8Array, index: number, rgb: number) {
  palette[index * 3] = rgb >> 16;
  palette[index * 3 + 1] = (rgb >> 8) & 0xff;
  palette[index * 3 + 2] = rgb & 0xff;
}

function blit(frame: Frame, img: Lfg, dx: number) {
  for (let y = 0; y < img.height; y++) {
    const row = (img.y + y) * WIDTH + img.x + dx;
    for (let x = 0; x < img.width; x++) {
      const c = img.pixels[y * img.width + x];
      if (c !== img.transparent && img.x + dx + x < WIDTH) frame.pixels[row + x] = c;
    }
  }
}

/** Builds the indexed frame for a visual state. `load` caches decoded LFGs. */
export function composeScene(visual: Visual, load: (path: string) => Lfg): Frame {
  const frame: Frame = { pixels: new Uint8Array(WIDTH * HEIGHT), palette: new Uint8Array(48) };
  DEFAULT_PALETTE.forEach((rgb, i) => setRgb(frame.palette, i, rgb));
  const bgPath = backgroundFile(visual.bg);
  if (bgPath) {
    const bg = load(bgPath);
    blit(frame, bg, 0);
    frame.palette.set(bg.palette);
    const time = visual.bg.kind === 'bg' ? BG_PALETTE[visual.bg.no] : undefined;
    if (time !== undefined) TIME_PALETTES[time].forEach((rgb, i) => setRgb(frame.palette, i, rgb));
  }
  for (const slot of ['l', 'c', 'r'] as const) {
    const no = visual.chars[slot];
    if (no === null) continue;
    const img = load(characterFile(no));
    blit(frame, img, CHAR_X[slot]);
    frame.palette.set(img.palette.subarray(12), 12); // sprites own colours 4-15
  }
  return frame;
}

export function frameToRgba(frame: Frame, palette = frame.palette, out = new Uint8ClampedArray(WIDTH * HEIGHT * 4)) {
  for (let i = 0; i < frame.pixels.length; i++) {
    const c = frame.pixels[i] * 3;
    out[i * 4] = palette[c];
    out[i * 4 + 1] = palette[c + 1];
    out[i * 4 + 2] = palette[c + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Caches decoded LFGs from the player's disks. */
export function lfgLoader(files: GameFiles): (path: string) => Lfg {
  const cache = new Map<string, Lfg>();
  return (path) => {
    let img = cache.get(path);
    if (!img) cache.set(path, (img = decodeLfg(files.read(path))));
    return img;
  };
}
