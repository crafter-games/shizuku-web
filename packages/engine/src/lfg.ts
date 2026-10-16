import { lzss } from './lzss.ts';

/** A decoded LFG image: 4-bit indexed pixels placed on the 640x400 screen. */
export interface Lfg {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 16 colours as RGB triplets, 8 bits per channel. */
  palette: Uint8Array;
  /** Palette index drawn as transparent, or undefined for none. */
  transparent: number | undefined;
  /** One palette index per pixel, row-major, width * height. */
  pixels: Uint8Array;
}

const MAGIC = 'LEAFCODE';

/**
 * Decodes Leaf's LFG format (ported from XLVNS lfg.c). Header:
 *   0  "LEAFCODE"
 *   8  palette, 16 colours x 3 nibbles (R G B), each nibble doubled to 8 bits
 *   32 u16 x0 / 8, u16 y0, u16 x1 / 8, u16 y1 (inclusive)
 *   40 scan order (0 = column-major, 1 = row-major), 41 transparent index (0xFF = none)
 *   44 u32 unpacked size, 48 LZSS data
 * Pixels are packed two per byte, bit-interleaved like PC-98 planar VRAM.
 */
export function decodeLfg(data: Uint8Array): Lfg {
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC.charCodeAt(i)) throw new Error('No es una imagen LFG');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const x = view.getUint16(32, true) * 8;
  const y = view.getUint16(34, true);
  const width = (view.getUint16(36, true) + 1) * 8 - x;
  const height = view.getUint16(38, true) + 1 - y;
  const rowMajor = data[40] !== 0;
  const transparent = data[41] < 16 ? data[41] : undefined;
  const size = view.getUint32(44, true);

  const palette = new Uint8Array(48);
  for (let i = 0; i < 24; i++) {
    const b = data[8 + i];
    palette[i * 2] = (b >> 4) * 0x11;
    palette[i * 2 + 1] = (b & 0xf) * 0x11;
  }

  const packed = lzss(data, 48, size, false);
  const pixels = new Uint8Array(width * height);
  let px = 0;
  let py = 0;
  for (let i = 0; i < packed.length; i++) {
    const b = packed[i];
    const left = ((b & 0x80) >> 4) | ((b & 0x20) >> 3) | ((b & 0x08) >> 2) | ((b & 0x02) >> 1);
    const right = ((b & 0x40) >> 3) | ((b & 0x10) >> 2) | ((b & 0x04) >> 1) | (b & 0x01);
    if (rowMajor) {
      pixels[i * 2] = left;
      pixels[i * 2 + 1] = right;
    } else {
      // Column-major: pairs of columns, top to bottom.
      pixels[py * width + px] = left;
      pixels[py * width + px + 1] = right;
      if (++py >= height) {
        py = 0;
        px += 2;
      }
    }
  }
  return { x, y, width, height, palette, transparent, pixels };
}

/** Expands an LFG to RGBA, with the transparent colour as alpha 0. */
export function lfgToRgba(img: Lfg, palette: Uint8Array = img.palette): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.pixels.length; i++) {
    const c = img.pixels[i];
    rgba[i * 4] = palette[c * 3];
    rgba[i * 4 + 1] = palette[c * 3 + 1];
    rgba[i * 4 + 2] = palette[c * 3 + 2];
    rgba[i * 4 + 3] = c === img.transparent ? 0 : 255;
  }
  return rgba;
}
