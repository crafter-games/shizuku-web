import { unpack } from './lzss.ts';

/**
 * PCM sound effects, SZ_VDnn.VD on disk B. A packed file (u32 size + inverted
 * LZSS) holding headerless 8-bit signed mono PCM.
 *
 * The rate is the PC-9801-86 board's code 3, 44100 * 3 / 8 = 16537.5 Hz: the
 * game ORs 3 into port A468h and feeds each byte twice (left and right) to the
 * 8-bit stereo FIFO. Checked against the emulator: the scream in SCN004
 * (SZ_VD11) correlates with the recorded output at 16537.5 Hz and at no other
 * board rate.
 */
export const VD_SAMPLE_RATE = 16537.5;

export interface Vd {
  sampleRate: number;
  /** Mono samples in [-1, 1). */
  samples: Float32Array;
}

/** Decodes a .VD file as stored on the disk (packed). */
export function decodeVd(file: Uint8Array): Vd {
  return vdFromPcm(unpack(file));
}

/** Converts already unpacked VD data (signed 8-bit) to float samples. */
export function vdFromPcm(pcm: Uint8Array): Vd {
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = ((pcm[i] << 24) >> 24) / 128;
  return { sampleRate: VD_SAMPLE_RATE, samples };
}

/**
 * The inline text command `Paabb` (e.g. `P0100`, `P0220`, `P0040`): play the
 * loaded VD `aa` times (00 = until `Ps`), with `bb` * 20 paragraphs of silence
 * between repeats. A paragraph is 16 source bytes, so the gap is bb * 320
 * samples (about 19.35 ms per unit). Both numbers are decimal.
 * The other P commands: `Plnn` loads SZ_VDnn.VD, `Pw` waits for the end,
 * `Ps` stops, `Pf` frees the buffer.
 */
export interface VdPlay {
  /** 0 means loop until stopped. */
  loops: number;
  /** Silence between repeats, in samples at VD_SAMPLE_RATE. */
  gapSamples: number;
}

export function parseVdPlay(raw: string): VdPlay {
  const m = /^P(\d\d)(\d\d)$/.exec(raw);
  if (!m) throw new Error(`No es un comando P de reproducción: ${raw}`);
  return { loops: Number(m[1]), gapSamples: Number(m[2]) * 20 * 16 };
}
