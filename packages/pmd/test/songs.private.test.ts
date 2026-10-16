// Plays every SZ_FMnn song from the player's own disks (or `pnpm decode`
// output). Skipped when neither is present (CI never has them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPmd } from '../src/index.ts';
import { loadSong, SONG_COUNT, songName } from '../scripts/songs.ts';

const present = loadSong(0) !== undefined;
const RATE = 48000;

test('every song renders 10 s of sound', { skip: !present && 'no private Shizuku dump' }, async () => {
  const pmd = await createPmd({ sampleRate: RATE });
  for (let n = 0; n < SONG_COUNT; n++) {
    const name = songName(n);
    pmd.load(loadSong(n)!);
    assert.ok(pmd.firstPassSeconds! > 4, `${name}: first pass ${pmd.firstPassSeconds}`);
    // The shortest songs (the 5 s jingle) are over before 10 s.
    const seconds = Math.min(10, pmd.firstPassSeconds!);
    const x = pmd.render(Math.floor(seconds * RATE));
    let sum = 0, peak = 0;
    for (const v of x) {
      assert.ok(Number.isFinite(v), `${name}: non-finite sample`);
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rmsDb = 10 * Math.log10(sum / x.length);
    assert.ok(rmsDb > -50, `${name}: too quiet (${rmsDb.toFixed(1)} dBFS)`);
    assert.ok(peak < 1, `${name}: clips (peak ${peak})`);
  }
});

test('loop points and endings', { skip: !present && 'no private Shizuku dump' }, async () => {
  const pmd = await createPmd({ sampleRate: RATE });
  // The boot jingle plays once and stops.
  pmd.load(loadSong(0)!);
  assert.equal(pmd.loopSeconds, null);
  pmd.render(6 * RATE);
  assert.equal(pmd.ended, true);
  assert.equal(pmd.playing, false);
  // SZ_FM10 loops: count one pass, then fade.
  pmd.load(loadSong(10)!);
  const first = pmd.firstPassSeconds!, loop = pmd.loopSeconds!;
  assert.ok(first > 15 && loop > 15 && loop <= first, `${first} / ${loop}`);
  pmd.render(Math.ceil((first - 0.5) * RATE));
  assert.equal(pmd.loopCount, 0);
  pmd.render(RATE);
  assert.equal(pmd.loopCount, 1);
  pmd.render(Math.ceil(loop * RATE));
  assert.equal(pmd.loopCount, 2);
  pmd.fadeOut(1000);
  pmd.render(RATE + 100);
  assert.equal(pmd.playing, false);
});
