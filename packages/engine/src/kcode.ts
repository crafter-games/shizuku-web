import { unpack } from './lzss.ts';

/**
 * KCODE.SDT (disk B): the "user font", 16x16 1-bit glyphs the game loads as
 * PC-98 user-defined characters so that transitions can be drawn in the text
 * layer over the graphics. A packed file; unpacked it is 162 glyphs of 32
 * bytes (16 rows of a big-endian 16-bit word, MSB = leftmost pixel).
 *
 * Groups (by lit pixel count):
 * - 0..127: a diamond iris, 32 sizes x 4 quadrants (glyph 4s + q is size s,
 *   quadrant q), from empty to full.
 * - 128..144: a vertical-bar wipe, 17 steps from full to empty.
 * - 145..161: an ordered-dither fade, 17 steps from full to empty.
 */
export const KCODE_GROUPS = {
  diamond: { first: 0, count: 128 },
  bars: { first: 128, count: 17 },
  dither: { first: 145, count: 17 },
} as const;

/** Returns one 256-byte array (0/1, row-major 16x16) per glyph. */
export function decodeKcode(file: Uint8Array): Uint8Array[] {
  return kcodeFromRaw(unpack(file));
}

export function kcodeFromRaw(raw: Uint8Array): Uint8Array[] {
  if (raw.length % 32) throw new Error('KCODE.SDT: tamaño no múltiplo de 32');
  const glyphs: Uint8Array[] = [];
  for (let g = 0; g < raw.length / 32; g++) {
    const px = new Uint8Array(256);
    for (let y = 0; y < 16; y++) {
      const row = (raw[g * 32 + y * 2] << 8) | raw[g * 32 + y * 2 + 1];
      for (let x = 0; x < 16; x++) px[y * 16 + x] = (row >> (15 - x)) & 1;
    }
    glyphs.push(px);
  }
  return glyphs;
}
