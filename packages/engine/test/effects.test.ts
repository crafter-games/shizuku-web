// Hand-built data only: no game bytes in public tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFECTS, effectFromNumber, transition, compose, paint, gameRandom, squashMasks, dimPalette, fadeRgb, rgba32,
  rippleStep, teardropStep, HEIGHT, WIDTH, type Frame, type Layers,
} from '../src/index.ts';

/** Stand-ins for KCODE.SDT: diamonds 0-127 fill 8*size pixels, bars and dither fill 16*(16-k) of 256. */
function fakeKcode(): Uint8Array[] {
  const glyph = (lit: number) => Uint8Array.from({ length: 256 }, (_, i) => (i < lit ? 1 : 0));
  const out: Uint8Array[] = [];
  for (let g = 0; g < 128; g++) out.push(glyph((g >> 2) === 31 ? 256 : (g >> 2) * 8));
  for (let k = 0; k < 17; k++) out.push(glyph(256 - 16 * k));
  for (let k = 0; k < 17; k++) out.push(glyph(256 - 16 * k));
  return out;
}

const frame = (index: number, rgb: number[]): Frame => {
  const palette = new Uint8Array(48);
  palette.set(rgb, index * 3);
  return { pixels: new Uint8Array(WIDTH * HEIGHT).fill(index), palette };
};
const black: Frame = { pixels: new Uint8Array(WIDTH * HEIGHT), palette: new Uint8Array(48) };

function run(effect: (typeof EFFECTS)[number], phase: 'clear' | 'show', from: Frame, to: Frame) {
  const layers: Layers = { screen: new Uint32Array(WIDTH * HEIGHT), cover: new Uint8Array(WIDTH * HEIGHT) };
  paint(from, from.palette, layers.screen);
  const io = { kcode: fakeKcode(), squash: squashMasks(new Uint8Array(16)), from, to, random: gameRandom(1) };
  let vsyncs = 0;
  for (const n of transition(effect, phase, io, layers)) vsyncs += n;
  const out = new Uint32Array(WIDTH * HEIGHT);
  compose(layers, out);
  return { vsyncs, out };
}

test('effect numbers: 0-12 as in MAX_ADV.EXE, 99 skips', () => {
  assert.equal(effectFromNumber(1), 'spiral');
  assert.equal(effectFromNumber(12), 'dissolve');
  assert.equal(effectFromNumber(99), undefined);
});

test('every transition ends on its target, in the PC-98 number of vsyncs', () => {
  const old = frame(2, [0x55, 0x88, 0xbb]);
  const next = frame(3, [0xff, 0xcc, 0x00]);
  const lengths: Record<string, [number, number]> = {
    fade: [48, 45], spiral: [147, 124], random: [32, 32], diamonds: [66, 66], 'diamond-wipe': [106, 106],
    dither: [34, 34], lines: [82, 82], 'bar-wipe': [112, 112], 'dither-wipe': [112, 112], squash: [18, 17],
    bars: [34, 34], cut: [0, 0], dissolve: [0, 49],
  };
  for (const effect of EFFECTS) {
    const clear = run(effect, 'clear', old, black);
    assert.ok(clear.out.every((v) => v === (effect === 'dissolve' ? rgba32(0x55, 0x88, 0xbb) : rgba32(0, 0, 0))), `${effect} clear`);
    const show = run(effect, 'show', black, next);
    assert.ok(show.out.every((v) => v === rgba32(0xff, 0xcc, 0x00)), `${effect} show`);
    assert.deepEqual([clear.vsyncs, show.vsyncs], lengths[effect], effect);
  }
});

test('the game random: a 16-bit shift register', () => {
  const r = gameRandom(0x1234);
  const a = Array.from({ length: 4 }, r);
  assert.deepEqual(a, Array.from({ length: 4 }, gameRandom(0x1234)));
  assert.ok(a.every((v) => v >= 0 && v < 256));
});

test('squash masks fall back to evenly spread lines', () => {
  const masks = squashMasks(new Uint8Array(64));
  const bits = (m: number) => [...Array(16).keys()].filter((b) => (m >> b) & 1).length;
  assert.deepEqual(masks.map(bits), [...Array(16).keys()].map((i) => 15 - i));
});

test('dim keeps colour 15; fades are linear and floored on 4-bit channels', () => {
  const p = new Uint8Array(48).fill(0xbb);
  const d = dimPalette(p);
  assert.equal(d[0], 0x77); // floor(11 * 10 / 15) = 7
  assert.equal(d[45], 0xbb);
  assert.equal(dimPalette(p, 1)[0], 0xaa); // floor(11 * 14 / 15)
  assert.equal(fadeRgb(p, new Uint8Array(48), 1)[0], 0xaa);
});

test('ripple and teardrop timing', () => {
  assert.deepEqual([0, 5, 6, 12, 13, 131, 132].map(rippleStep), [0, 0, 1, 1, 2, 18, -1]);
  assert.equal(teardropStep(0, 44).step, -1);
  assert.equal(teardropStep(0, 45).step, 0);
  assert.equal(teardropStep(0, 45 + 207).step, 0);
  assert.equal(teardropStep(1, 45 + 109).step, 14);
  assert.equal(teardropStep(1, 1000).step, 14);
  assert.ok(teardropStep(1, 45 + 145).done);
});
