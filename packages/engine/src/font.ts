/**
 * Maps the game's font indices to Unicode, for showing the original Japanese
 * in the dev tools. The engine never needs it to play: Spanish is drawn with
 * web fonts. The table is not part of this repo; it is a text file with one
 * "8000=　" line per glyph (code = 0x8000 + index), kept with the translation.
 */
export type FontTable = (code: number) => string;

export function parseFontTable(text: string): FontTable {
  const chars = new Map<number, string>();
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    chars.set(Number.parseInt(line.slice(0, eq), 16) & 0x7fff, line.slice(eq + 1));
  }
  return (code) => chars.get(code) ?? `〈${code.toString(16)}〉`;
}
