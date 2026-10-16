// Finds which song an emulator recording is, and compares loudness and
// spectrum of our render against it over the matching stretch.
//
//   pnpm --filter @shizuku/pmd compare [recording.wav] [--from S] [--length S] [--seconds S]
//
// Default recording: title-fm.wav next to the private disks. --from/--length
// pick the stretch of the recording to look for (default: all of it);
// --seconds is how much of each song to search.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createPmd } from '../src/index.ts';
import { bestChromaMatch, centroid, chroma, HOP, octaveBands, rmsDb, spectrogram } from './analysis.ts';
import { decodeWavMono } from './wav.ts';
import { disksDir, loadSong, SONG_COUNT, songName } from './songs.ts';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: 'string', default: '120' },
    from: { type: 'string', default: '0' },
    length: { type: 'string' },
  },
});
const refPath = positionals[0] ?? join(disksDir, 'title-fm.wav');
const wav = decodeWavMono(readFileSync(refPath));
const rate = wav.sampleRate;
const from = Math.round(Number(args.from) * rate);
const ref = { samples: wav.samples.subarray(from, args.length ? from + Math.round(Number(args.length) * rate) : undefined) };
if (rmsDb(ref.samples) < -80) {
  console.error(`${refPath}: the recording is silent (${rmsDb(ref.samples).toFixed(0)} dBFS); nothing to compare.`);
  process.exit(1);
}
const refSpec = spectrogram(ref.samples);
const refChroma = chroma(refSpec, rate);

const pmd = await createPmd({ sampleRate: rate });

function renderMono(n: number, seconds: number): Float32Array {
  pmd.load(loadSong(n)!);
  const frames = Math.round(seconds * rate);
  const st = pmd.render(frames);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = (st[i * 2] + st[i * 2 + 1]) / 2;
  return mono;
}

const results = [];
for (let n = 0; n < SONG_COUNT; n++) {
  if (!loadSong(n)) throw new Error(`${songName(n)} not found`);
  const mono = renderMono(n, Number(args.seconds));
  const match = bestChromaMatch(refChroma, chroma(spectrogram(mono), rate));
  results.push({ n, mono, ...match });
}
results.sort((a, b) => b.score - a.score);
console.log(`${refPath}: ${(ref.samples.length / rate).toFixed(1)} s from ${args.from} s, ${rate} Hz\n`);
console.log('best chroma matches (mean cosine similarity, 1 = identical pitch content):');
for (const r of results.slice(0, 5)) {
  console.log(`  ${songName(r.n)}  ${r.score.toFixed(3)}  at ${((r.offset * HOP) / rate).toFixed(1)} s`);
}

const best = results[0];
const start = best.offset * HOP;
const seg = best.mono.subarray(start, start + ref.samples.length);
const segSpec = spectrogram(seg);
const fmt = (b: number[]) => b.map((v) => v.toFixed(0).padStart(4)).join('');
console.log(`\n${songName(best.n)} from ${(start / rate).toFixed(1)} s vs the recording:`);
console.log(`  RMS            ours ${rmsDb(seg).toFixed(1)} dBFS   recording ${rmsDb(ref.samples).toFixed(1)} dBFS`);
console.log(`  centroid       ours ${centroid(segSpec, rate).toFixed(0)} Hz   recording ${centroid(refSpec, rate).toFixed(0)} Hz`);
console.log('  octave bands     63 125 250 500  1k  2k  4k  8k 16k  (dB vs loudest)');
console.log(`  ours         ${fmt(octaveBands(segSpec, rate))}`);
console.log(`  recording    ${fmt(octaveBands(refSpec, rate))}`);
