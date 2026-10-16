// Leaf's LZSS: a 4 KB ring buffer, zero-filled, written from 0xFEE. Flag bits
// are read MSB first and a set bit means a literal. A reference is a 16-bit LE
// word: ring position = word >> 4, length = (word & 0xF) + 3.
// The "inverted" variant (scenarios, music, fonts, sounds) stores every byte
// bit-complemented; LFG images use the plain one. Ported from XLVNS leafpack.c.
export function lzss(src: Uint8Array, offset: number, size: number, inverted: boolean): Uint8Array {
  const out = new Uint8Array(size);
  const ring = new Uint8Array(0x1000);
  const mask = inverted ? 0xff : 0;
  let r = 0xfee;
  let i = offset;
  let o = 0;
  let flag = 0;
  let bits = 0;
  while (o < size) {
    if (bits === 0) {
      flag = src[i++] ^ mask;
      bits = 8;
    }
    if (flag & 0x80) {
      const b = src[i++] ^ mask;
      out[o++] = b;
      ring[r] = b;
      r = (r + 1) & 0xfff;
    } else {
      const word = (src[i] ^ mask) | ((src[i + 1] ^ mask) << 8);
      i += 2;
      let p = word >> 4;
      for (let n = (word & 0xf) + 3; n > 0 && o < size; n--) {
        const b = ring[p];
        out[o++] = b;
        ring[r] = b;
        r = (r + 1) & 0xfff;
        p = (p + 1) & 0xfff;
      }
    }
    flag = (flag << 1) & 0xff;
    bits--;
    if (i > src.length) throw new Error('lzss: compressed data ends early');
  }
  return out;
}

/** The packed-file container used by .FM, .MD, .VD, .LFD, .SDT and scenario sections: u32 size, then inverted LZSS. */
export function unpack(src: Uint8Array, offset = 0): Uint8Array {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return lzss(src, offset + 4, view.getUint32(offset, true), true);
}
