// Hand-built data only: no game bytes in public tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeVd, parseVdPlay, VD_SAMPLE_RATE, lfdFromRaw, opS0Cell, planarToIndices, kcodeFromRaw,
  decodeKcd, parseEfc, tokenizeText,
} from '../src/index.ts';

/** Packs bytes as an all-literal inverted LZSS container (u32 size + data). */
function pack(raw: Uint8Array): Uint8Array {
  const out: number[] = [raw.length & 0xff, (raw.length >> 8) & 0xff, (raw.length >> 16) & 0xff, raw.length >>> 24];
  for (let i = 0; i < raw.length; i += 8) {
    out.push(~0xff & 0xff);
    for (const b of raw.subarray(i, i + 8)) out.push(~b & 0xff);
  }
  return Uint8Array.from(out);
}

test('VD: signed 8-bit mono at 16537.5 Hz', () => {
  const vd = decodeVd(pack(Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x40])));
  assert.equal(vd.sampleRate, VD_SAMPLE_RATE);
  assert.deepEqual([...vd.samples], [0, 127 / 128, -1, -1 / 128, 0.5]);
});

test('P command: loops and gap', () => {
  assert.deepEqual(parseVdPlay('P0100'), { loops: 1, gapSamples: 0 });
  assert.deepEqual(parseVdPlay('P0220'), { loops: 2, gapSamples: 6400 });
  assert.deepEqual(parseVdPlay('P0040'), { loops: 0, gapSamples: 12800 });
  const t = tokenizeText(Uint8Array.from([...'Pl11Pc03P0100PwPs$'].map((c) => c.charCodeAt(0))));
  assert.deepEqual(t.filter((x) => x.t === 'cmd').map((x) => (x as { raw: string }).raw), ['Pl11', 'Pc03', 'P0100', 'Pw', 'Ps']);
});

test('planar bitmaps: plane p is bit p', () => {
  // 8x1, two planes: plane 0 = 0b1000_0001, plane 1 = 0b1100_0000
  assert.deepEqual([...planarToIndices(Uint8Array.from([0x81, 0xc0]), 8, 1, 2)], [3, 2, 0, 0, 0, 0, 0, 1]);
});

test('LFD: OP_S0 sheet cells and OP_L2 head frames', () => {
  const sheet = new Uint8Array(32000);
  sheet[200 * 80 + 16] = 0x80; // pixel (128, 200): top-left of cell 6
  const s0 = lfdFromRaw(sheet);
  assert.equal(s0.kind, 'drop-sheet');
  assert.equal(opS0Cell(s0, 6)[0], 1);
  assert.equal(opS0Cell(s0, 5).reduce((a, b) => a + b, 0), 0);

  const heads = new Uint8Array(150528);
  heads[28 * 224 * 4 * 5 + 28 * 224 * 3] = 0x80; // frame 5, plane 3 (E), pixel (0,0)
  const l2 = lfdFromRaw(heads);
  assert.equal(l2.frames.length, 6);
  assert.equal(l2.frames[5][0], 8);
  assert.throws(() => lfdFromRaw(new Uint8Array(10)));
});

test('KCODE: 16x16 big-endian rows', () => {
  const raw = new Uint8Array(64);
  raw[32 + 2] = 0x80; // glyph 1, row 1, x 0
  raw[32 + 3] = 0x01; // glyph 1, row 1, x 15
  const g = kcodeFromRaw(raw);
  assert.equal(g.length, 2);
  assert.equal(g[1][16], 1);
  assert.equal(g[1][31], 1);
  assert.equal(g[0].reduce((a, b) => a + b, 0), 0);
});

test('KCD: LZ77 glyphs in three column strips', () => {
  // One glyph: flag 0b1000_0000, literal 0x80, then references of distance 1:
  // length 16 (0x0e) four times and 7 (0x05): 1 + 64 + 7 = 72 bytes.
  const glyph = [0b1000_0000, 0x80, 0x0e, 0x0e, 0x0e, 0x0e, 0x05];
  const file = Uint8Array.from([1, 0, 0, 6, 0, 0, ...glyph]);
  const [g] = decodeKcd(file);
  // every byte is 0x80: the leftmost pixel of each strip on every row
  assert.equal(g[0], 1);
  assert.equal(g[8], 1);
  assert.equal(g[16], 1);
  assert.equal(g[23 * 24 + 16], 1);
  assert.equal(g.reduce((a, b) => a + b, 0), 72);
});

test('EFC: offset table and 0x80-terminated sequences', () => {
  const file = new Uint8Array(260).fill(0x80);
  for (let i = 0; i < 128; i++) { file[i * 2] = 0; file[i * 2 + 1] = 1; }
  file[2] = 1; // effect 1 at 0x101
  file[0x101] = 0xfe; file[0x102] = 0x00; file[0x103] = 0x80;
  const efc = parseEfc(file);
  assert.deepEqual([...efc.effects[0]], [0x80]);
  assert.deepEqual([...efc.effects[1]], [0xfe, 0x00, 0x80]);
});
