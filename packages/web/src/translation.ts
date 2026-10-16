import { scenarios, fontTable } from 'virtual:translation';
import { parseFontTable, messageHash, type TextToken } from '@shizuku/engine';

interface Entry {
  hash: string;
  es: string[];
}

const table = scenarios as Record<string, Record<string, Entry>>;
const font = fontTable ? parseFontTable(fontTable) : undefined;

/** The Spanish for a segment, if translated and the message matches the player's disks. */
export function spanish(scn: number, msg: number, index: number, bytes: Uint8Array): string | undefined {
  const entry = table[scn]?.[msg];
  if (!entry || entry.hash !== messageHash(bytes)) return undefined;
  return entry.es[index];
}

/** The original Japanese of a segment (needs the font table from the translation repo). */
export function japanese(tokens: TextToken[]): string {
  return tokens
    .map((t) => (t.t === 'char' ? (font ? font(t.code) : '□') : ''))
    .join('')
    .replace(/^　/, '');
}

export const hasTranslation = Object.keys(table).length > 0;
