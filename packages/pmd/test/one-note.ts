// A tiny hand-assembled PMD song for tests that run without game data.

/**
 * Compiled PMD with one SSG note (v15, A 440 Hz, 192 ticks) and a 192-tick
 * rest in every other part. Byte 0 is the sound-chip flag; the rest is
 * addressed from byte 1: 11 part pointers, the rhythm table pointer, then the
 * part data (0x0f is a rest, 0x80 ends a part, and with no loop point the
 * song ends; 0x18 as the first pointer means no tone data).
 */
export function oneNote(): Uint8Array {
  const d = new Uint8Array(1 + 0x18 + 8);
  const v = new DataView(d.buffer);
  const REST = 0x18, SSG1 = 0x1b;
  for (let p = 0; p < 11; p++) v.setUint16(1 + p * 2, p === 6 ? SSG1 : REST, true);
  v.setUint16(1 + 0x16, REST, true);
  d.set([0x0f, 0xc0, 0x80, 0xfd, 15, 0x39, 0xc0, 0x80], 1 + REST);
  return d;
}
