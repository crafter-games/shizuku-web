// Runs without game data, on a tiny hand-assembled PMD song.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPmd } from '../src/index.ts';
import { oneNote } from './one-note.ts';

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test('renders silence before a song is loaded', async () => {
  const pmd = await createPmd({ sampleRate: 48000 });
  const out = pmd.render(1000);
  assert.equal(out.length, 2000);
  assert.ok(out.every((v) => v === 0));
  assert.equal(pmd.playing, false);
});

test('plays a note, measures the song and ends', async () => {
  const pmd = await createPmd({ sampleRate: 44100 });
  pmd.load(oneNote());
  assert.equal(pmd.playing, true);
  const len = pmd.firstPassSeconds!;
  // 192 ticks at PMD's default tempo.
  assert.ok(Math.abs(len - 3.12) < 0.05, `length ${len}`);
  assert.equal(pmd.loopSeconds, null);
  const sound = pmd.render(4410);
  assert.ok(rms(sound) > 0.01, `rms ${rms(sound)}`);
  assert.ok(sound.every(Number.isFinite));
  assert.equal(pmd.loopCount, 0);
  assert.ok(Math.abs(pmd.position - 0.1) < 0.01, `position ${pmd.position}`);
  pmd.render(Math.ceil((len + 2) * 44100));
  assert.equal(pmd.ended, true);
  assert.equal(pmd.playing, false);
});

test('the note is an A at 440 Hz after resampling', async () => {
  for (const sampleRate of [22050, 44100, 48000, 96000]) {
    const pmd = await createPmd({ sampleRate });
    pmd.load(oneNote());
    pmd.render(sampleRate / 10);
    const x = pmd.render(sampleRate / 2);
    let crossings = 0;
    for (let i = 2; i < x.length; i += 2) if (x[i - 2] < 0 && x[i] >= 0) crossings++;
    const hz = crossings / 0.5;
    assert.ok(Math.abs(hz - 440) < 6, `${sampleRate} Hz output: ${hz} Hz`);
  }
});

test('fadeOut ramps down and stops', async () => {
  const pmd = await createPmd({ sampleRate: 48000 });
  pmd.load(oneNote());
  pmd.render(4800);
  pmd.fadeOut(100);
  assert.equal(pmd.fading, true);
  const x = pmd.render(9600);
  const head = rms(x.subarray(0, 960)), tail = rms(x.subarray(4800 * 2 - 960, 4800 * 2));
  assert.ok(head > 0.005 && tail < head / 10, `${head} -> ${tail}`);
  assert.ok(x.subarray(4800 * 2).every((v) => v === 0));
  assert.equal(pmd.playing, false);
});

test('rejects data that is not PMD', async () => {
  const pmd = await createPmd({ sampleRate: 48000 });
  assert.throws(() => pmd.load(new Uint8Array([7, 7, 7])));
  assert.throws(() => pmd.setRhythm(new Uint8Array(10)));
});
