// Sounds, opening animations, user font, main font and FM effects from the
// user's own disks. Skipped when the private dump is not present (CI never has it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { GameFiles, decodeVd, VD_SAMPLE_RATE, decodeLfd, opS0Cell, decodeKcode, KCODE_GROUPS, decodeKcd, parseEfc } from '../src/index.ts';

const dir = process.env.SHIZUKU_DISKS ?? new URL('../../../../pc98/fixtures/private/shizuku/', import.meta.url).pathname;
const present = existsSync(`${dir}/sizuku_a.hdm`);

function load(): GameFiles {
  const game = new GameFiles();
  for (const d of 'abcde') game.addImage(readFileSync(`${dir}/sizuku_${d}.hdm`));
  return game;
}

test('media formats decode', { skip: !present && 'no private Shizuku dump' }, () => {
  const game = load();
  const vds = game.files().filter((f) => /^SZ_VD\d\d\.VD$/.test(f.path));
  assert.equal(vds.length, 11);
  for (const f of vds) {
    const vd = decodeVd(f.read());
    assert.equal(vd.sampleRate, VD_SAMPLE_RATE);
    assert.ok(vd.samples.length > 1000, f.path);
    // signed PCM centred on zero
    const mean = vd.samples.reduce((a, b) => a + b, 0) / vd.samples.length;
    assert.ok(Math.abs(mean) < 0.05, `${f.path} mean ${mean}`);
  }

  const s0 = decodeLfd(game.read('OP_S0.LFD'));
  assert.equal(s0.kind, 'drop-sheet');
  for (let k = 0; k < 10; k++) assert.ok(opS0Cell(s0, k).some((v) => v), `cell ${k} empty`);
  const l2 = decodeLfd(game.read('OP_L2.LFD'));
  assert.equal(l2.kind, 'head-frames');
  assert.equal(l2.frames.length, 6);
  assert.ok(l2.frames.every((fr) => fr.some((v) => v === 15)));

  const kcode = decodeKcode(game.read('KCODE.SDT'));
  assert.equal(kcode.length, 162);
  const lit = (g: Uint8Array) => g.reduce((a, b) => a + b, 0);
  assert.equal(lit(kcode[KCODE_GROUPS.diamond.first]), 0);
  assert.equal(lit(kcode[KCODE_GROUPS.bars.first]), 256);
  assert.equal(lit(kcode[KCODE_GROUPS.dither.first + 16]), 0);

  const font = decodeKcd(game.read('KNJ_ALL.KCD'));
  assert.equal(font.length, 1849);

  const efc = parseEfc(game.read('SZEF.EFC'));
  assert.ok(efc.effects.filter((e) => e.length > 1).length >= 10);
});
