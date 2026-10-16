// PmdPlayer and the worklet against a fake Web Audio clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PmdPlayer } from '../src/player.ts';
import { oneNote } from './one-note.ts';

const RATE = 48000;

/** Loads pmd-worklet.js with a stand-in for the AudioWorkletGlobalScope. */
async function loadWorklet() {
  let Processor: any;
  const g = globalThis as any;
  g.sampleRate = RATE;
  g.AudioWorkletProcessor = class {
    port = { onmessage: null as any, postMessage: (_: unknown) => {} };
  };
  g.registerProcessor = (_: string, cls: unknown) => (Processor = cls);
  await import(`../src/pmd-worklet.js?${Math.random()}`);
  return Processor;
}

test('the player keeps the worklet fed and reports the end of a song', async () => {
  const Processor = await loadWorklet();
  const proc = new Processor();
  const ctx = { sampleRate: RATE, currentTime: 0, destination: {}, audioWorklet: { addModule: async () => {} } };
  const node = {
    port: {
      onmessage: null as ((e: { data: number }) => void) | null,
      postMessage(data: Float32Array | 'clear') {
        proc.port.postMessage = (size: number) => node.port.onmessage?.({ data: size });
        proc.port.onmessage({ data });
      },
    },
    connect() {},
    disconnect() {},
  };
  (globalThis as any).AudioWorkletNode = function () { return node; };

  const player = await PmdPlayer.create(ctx as unknown as AudioContext, { workletUrl: 'x' });
  let ended = 0;
  player.onEnd = () => ended++;
  player.play(oneNote());
  assert.ok(Math.abs(proc.size - 0.15 * RATE) < 10, `queued ${proc.size}`);

  // Run the audio clock for 5 s, in 128-frame render quanta, pumping as a timer would.
  const out = [new Float32Array(128), new Float32Array(128)];
  let underruns = 0, energy = 0;
  for (let q = 0; q < (5 * RATE) / 128; q++) {
    if (proc.size < 128 && player.playing) underruns++;
    proc.process([], [out]);
    for (const v of out[0]) energy += v * v;
    ctx.currentTime += 128 / RATE;
    if (q % 8 === 0) (player as any).pump();
  }
  player.dispose();
  assert.equal(underruns, 0);
  assert.ok(energy > 0);
  assert.equal(ended, 1);
  assert.equal(player.playing, false);
});
