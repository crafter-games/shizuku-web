// Renders a Shizuku song to out/music/SZ_FMnn.wav (git-ignored).
//
//   pnpm --filter @shizuku/pmd render <nn>… [--loops N] [--seconds S] [--rate HZ] [--fade MS] [--rhythm synth|off|ROM]
//
// By default plays N (1) passes through the song, then fades out over 5 s
// (songs without a loop play to their end). --seconds overrides the length.
// --rhythm takes 'synth' (default), 'off', or the path of a YM2608 rhythm ROM dump.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createPmd } from '../src/index.ts';
import { encodeWav } from './wav.ts';
import { loadSong, root, songName } from './songs.ts';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    loops: { type: 'string', default: '1' },
    seconds: { type: 'string' },
    rate: { type: 'string', default: '48000' },
    fade: { type: 'string', default: '5000' },
    rhythm: { type: 'string', default: 'synth' },
  },
});

const nums = positionals.length ? positionals.map(Number) : [];
if (!nums.length || nums.some((n) => !(n >= 0 && n < 25))) {
  console.error('usage: render <nn>… [--loops N] [--seconds S] [--rate HZ] [--fade MS] [--rhythm synth|off|ROM]');
  process.exit(1);
}

const rate = Number(args.rate);
const rhythm = args.rhythm === 'synth' || args.rhythm === 'off' ? args.rhythm : new Uint8Array(readFileSync(args.rhythm));
const pmd = await createPmd({ sampleRate: rate, rhythm });
for (const n of nums) {
  const m = loadSong(n);
  if (!m) {
    console.error(`${songName(n)}: not found (run pnpm decode, or set SHIZUKU_DISKS)`);
    process.exit(1);
  }
  pmd.load(m);
  const fadeMs = Number(args.fade);
  const loops = Number(args.loops);
  const maxSeconds = args.seconds ? Number(args.seconds) : 600;
  const chunks: Float32Array[] = [];
  const block = 4096;
  let frames = 0;
  while (frames < maxSeconds * rate && pmd.playing) {
    if (!args.seconds && !pmd.fading && pmd.loopCount >= loops) pmd.fadeOut(fadeMs);
    if (args.seconds && !pmd.fading && frames >= maxSeconds * rate - (fadeMs / 1000) * rate) pmd.fadeOut(fadeMs);
    chunks.push(pmd.render(block));
    frames += block;
  }
  const all = new Float32Array(frames * 2);
  chunks.forEach((c, i) => all.set(c, i * block * 2));
  const path = join(root, 'out/music', `${songName(n)}.wav`);
  mkdirSync(join(root, 'out/music'), { recursive: true });
  writeFileSync(path, encodeWav(all, rate));
  const fmt = (s: number | null) => (s === null ? '—' : `${s.toFixed(1)} s`);
  console.log(
    `${songName(n)}: ${(frames / rate).toFixed(1)} s -> ${path}  (first pass ${fmt(pmd.firstPassSeconds)}, loop ${fmt(pmd.loopSeconds)}, rhythm mask 0x${pmd.rhythm.mask.toString(16)} / ${pmd.rhythm.keyOns} key-ons)`,
  );
}
