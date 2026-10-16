// Minimal WAV (RIFF PCM) reading and writing for the dev scripts.

/** Interleaved stereo float32 -> 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const data = samples.length * 2;
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  }
  return buf;
}

/** 16-bit PCM WAV -> mono float32 (channels averaged). */
export function decodeWavMono(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, channels = 0, sampleRate = 0, bits = 0;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(p, p + 4));
    const size = v.getUint32(p + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(p + 10, true);
      sampleRate = v.getUint32(p + 12, true);
      bits = v.getUint16(p + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`${bits}-bit WAV not supported`);
      const frames = Math.floor(size / 2 / channels);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += v.getInt16(p + 8 + (i * channels + c) * 2, true);
        samples[i] = s / channels / 32768;
      }
      return { sampleRate, samples };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}
