/**
 * KNJ_ALL.KCD (disk B), the game's 24x24 font. Header: u24 glyph count, then a
 * u24 offset per glyph. Each glyph is compressed with a small LZ77 whose window
 * is the whole output so far (references may reach into earlier glyphs):
 * a flag byte covers the next 8 items, MSB first, 1 = literal byte,
 * 0 = reference byte `dddd llll` copying (l + 2) bytes from (d + 1) bytes back.
 * Every glyph unpacks to 72 bytes: three 8-pixel-wide column strips (left to
 * right), each 24 bytes, one byte per row top-down, MSB = leftmost pixel.
 * Format documented by Her-Saki's KCDCONV.ps1; this is an independent
 * implementation.
 */
export function decodeKcd(file: Uint8Array): Uint8Array[] {
  const count = file[0] | (file[1] << 8) | (file[2] << 16);
  const offset = (i: number) => (i === count ? file.length : file[3 + i * 3] | (file[4 + i * 3] << 8) | (file[5 + i * 3] << 16));
  const out = new Uint8Array(count * 72);
  let o = 0;
  for (let g = 0; g < count; g++) {
    const end = offset(g + 1);
    let flag = 0;
    let left = 0;
    for (let i = offset(g); i < end; i++) {
      const b = file[i];
      if (left === 0) {
        flag = b;
        left = 8;
        continue;
      }
      left--;
      if ((flag >> left) & 1) {
        out[o++] = b;
      } else {
        let p = o - 1 - (b >> 4);
        for (let n = (b & 15) + 2; n > 0; n--) out[o++] = out[p++];
      }
    }
    if (o !== (g + 1) * 72) throw new Error(`KNJ_ALL.KCD: el glifo ${g} no ocupa 72 bytes`);
  }
  const glyphs: Uint8Array[] = [];
  for (let g = 0; g < count; g++) {
    const px = new Uint8Array(576);
    for (let strip = 0; strip < 3; strip++) {
      for (let y = 0; y < 24; y++) {
        const b = out[g * 72 + strip * 24 + y];
        for (let x = 0; x < 8; x++) px[y * 24 + strip * 8 + x] = (b >> (7 - x)) & 1;
      }
    }
    glyphs.push(px);
  }
  return glyphs;
}
