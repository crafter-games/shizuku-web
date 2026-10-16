/**
 * SZEF.EFC (disk B, not packed): a PMD FM sound-effect bank, loaded into the
 * PMD driver at start-up. Header: 128 u16 offsets (bytes 0..255), one per
 * effect; each effect is a PMD effect sequence ending in 0x80 (most entries
 * are just 0x80, i.e. empty). FM voice data follows the sequences.
 *
 * Bytecode 0x71 n plays effect n (PMD int 60h, AH=0Ch) and 0x72 n plays SSG
 * effect n (AH=03h), but no scenario uses either opcode, so the bank is never
 * heard in the story. The `P` text commands are PCM (.VD), not this file.
 */
export interface Efc {
  /** Raw sequence of each effect, including the terminating 0x80. */
  effects: Uint8Array[];
}

export function parseEfc(file: Uint8Array): Efc {
  const effects: Uint8Array[] = [];
  for (let i = 0; i < 128; i++) {
    const start = file[i * 2] | (file[i * 2 + 1] << 8);
    let end = start;
    while (end < file.length && file[end] !== 0x80) end++;
    effects.push(file.subarray(start, Math.min(end + 1, file.length)));
  }
  return { effects };
}
