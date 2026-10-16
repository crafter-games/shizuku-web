import { unpack } from './lzss.ts';

/**
 * LFD files are packed (u32 size + inverted LZSS) raw planar bitmaps with no
 * header and no palette: the game copies them straight into VRAM planes. The
 * geometry is fixed per file, so it is recognised by the unpacked size:
 *
 * - OP_S0.LFD (disk A, 32000 bytes): one 640x400 bit plane holding a sheet of
 *   ten 128x200 cells (5 per row, 2 rows): a drop falling, the splash and
 *   the first ripples. The opening loads it into plane B of a VRAM bank and
 *   shows cell k by scrolling, through a 128x208 window at (256,160), with
 *   colour 1 = #3311BB.
 * - OP_L2.LFD (disk B, 150528 bytes): six 224x224 frames of Ruriko turning
 *   her head and opening her eyes, 4 planes each (B, R, G, E = index bits
 *   0..3), each plane 224 rows of 28 bytes. Uses OP_L0.LFG's palette; drawn at
 *   (224,16) on screen over the OP_L0/OP_L1 hair frames.
 */
export interface LfdFrames {
  kind: 'drop-sheet' | 'head-frames';
  width: number;
  height: number;
  /** Palette indices, row-major, width * height each. */
  frames: Uint8Array[];
}

export const OP_S0_CELL = { width: 128, height: 200, columns: 5, count: 10 } as const;

/** Decodes an LFD file as stored on the disk. */
export function decodeLfd(file: Uint8Array): LfdFrames {
  return lfdFromRaw(unpack(file));
}

export function lfdFromRaw(raw: Uint8Array): LfdFrames {
  if (raw.length === 32000) {
    return { kind: 'drop-sheet', width: 640, height: 400, frames: [planarToIndices(raw, 640, 400, 1)] };
  }
  if (raw.length === 150528) {
    const size = 28 * 224 * 4;
    const frames: Uint8Array[] = [];
    for (let k = 0; k < 6; k++) frames.push(planarToIndices(raw.subarray(k * size, (k + 1) * size), 224, 224, 4));
    return { kind: 'head-frames', width: 224, height: 224, frames };
  }
  throw new Error(`LFD de tamaño desconocido: ${raw.length}`);
}

/** Cell k (0..9) of the OP_S0 drop sheet, as 0/1 values, 128x200. */
export function opS0Cell(sheet: LfdFrames, k: number): Uint8Array {
  const { width, height, columns } = OP_S0_CELL;
  const x0 = (k % columns) * width;
  const y0 = Math.floor(k / columns) * height;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) out.set(sheet.frames[0].subarray((y0 + y) * 640 + x0, (y0 + y) * 640 + x0 + width), y * width);
  return out;
}

/**
 * Converts consecutive bit planes (plane 0 first, MSB = leftmost pixel) to
 * palette indices: plane p supplies bit p.
 */
export function planarToIndices(data: Uint8Array, width: number, height: number, planes: number): Uint8Array {
  const stride = width >> 3;
  const planeSize = stride * height;
  if (data.length < planeSize * planes) throw new Error('Datos planares incompletos');
  const out = new Uint8Array(width * height);
  for (let p = 0; p < planes; p++) {
    const plane = data.subarray(p * planeSize, (p + 1) * planeSize);
    for (let i = 0; i < planeSize; i++) {
      const b = plane[i];
      if (!b) continue;
      for (let bit = 0; bit < 8; bit++) if (b & (0x80 >> bit)) out[i * 8 + bit] |= 1 << p;
    }
  }
  return out;
}
