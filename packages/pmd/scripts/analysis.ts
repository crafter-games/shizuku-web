// Rough "ear proxies" for comparing renders with emulator recordings:
// loudness, a coarse spectrum, and a chroma sequence for finding a song.

export const FFT_SIZE = 4096;
export const HOP = 2048;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Power spectra of Hann-windowed frames. */
export function spectrogram(x: Float32Array): Float64Array[] {
  const win = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
  const frames: Float64Array[] = [];
  for (let s = 0; s + FFT_SIZE <= x.length; s += HOP) {
    const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) re[i] = x[s + i] * win[i];
    fft(re, im);
    const p = new Float64Array(FFT_SIZE / 2);
    for (let i = 0; i < p.length; i++) p[i] = re[i] * re[i] + im[i] * im[i];
    frames.push(p);
  }
  return frames;
}

export const rmsDb = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return 10 * Math.log10(s / x.length + 1e-20);
};

/** Average level in octave bands (63 Hz … 16 kHz), in dB relative to the loudest band. */
export function octaveBands(spec: Float64Array[], rate: number): number[] {
  const centers = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const out = centers.map((c) => {
    const lo = Math.floor((c / Math.SQRT2 / rate) * FFT_SIZE), hi = Math.ceil((c * Math.SQRT2 / rate) * FFT_SIZE);
    let s = 0;
    for (const f of spec) for (let i = lo; i < Math.min(hi, f.length); i++) s += f[i];
    return 10 * Math.log10(s + 1e-20);
  });
  const max = Math.max(...out);
  return out.map((v) => v - max);
}

/** Spectral centroid in Hz, averaged over frames weighted by power. */
export function centroid(spec: Float64Array[], rate: number): number {
  let num = 0, den = 0;
  for (const f of spec) for (let i = 1; i < f.length; i++) { num += f[i] * (i * rate) / FFT_SIZE; den += f[i]; }
  return num / den;
}

/** Per-frame unit-length 12-bin chroma (pitch classes from 55 Hz to 5 kHz). */
export function chroma(spec: Float64Array[], rate: number): Float64Array[] {
  const bin2pc = new Int8Array(FFT_SIZE / 2).fill(-1);
  for (let i = 1; i < bin2pc.length; i++) {
    const f = (i * rate) / FFT_SIZE;
    if (f < 55 || f > 5000) continue;
    bin2pc[i] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  return spec.map((p) => {
    const c = new Float64Array(12);
    for (let i = 0; i < p.length; i++) if (bin2pc[i] >= 0) c[bin2pc[i]] += Math.sqrt(p[i]);
    const n = Math.hypot(...c) || 1;
    return c.map((v) => v / n);
  });
}

/** Best mean frame-by-frame chroma similarity of `ref` slid along `seq`, and the offset in frames. */
export function bestChromaMatch(ref: Float64Array[], seq: Float64Array[]): { score: number; offset: number } {
  let best = { score: -1, offset: 0 };
  for (let off = 0; off + ref.length <= seq.length; off++) {
    let s = 0;
    for (let i = 0; i < ref.length; i++) {
      const a = ref[i], b = seq[off + i];
      let d = 0;
      for (let k = 0; k < 12; k++) d += a[k] * b[k];
      s += d;
    }
    s /= ref.length;
    if (s > best.score) best = { score: s, offset: off };
  }
  return best;
}
