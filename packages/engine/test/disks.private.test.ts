// Decodes every file on the user's own Shizuku disks. Skipped when the private
// dump is not present (CI never has it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { GameFiles, decodeLfg, parseScenario, tokenizeText, disassembleBlock, unpack } from '../src/index.ts';

const dir = process.env.SHIZUKU_DISKS ?? new URL('../../../../pc98/fixtures/private/shizuku/', import.meta.url).pathname;
const present = existsSync(`${dir}/sizuku_a.hdm`);

test('all five disks decode', { skip: !present && 'no private Shizuku dump' }, () => {
  const game = new GameFiles();
  for (const d of 'abcde') game.addImage(readFileSync(`${dir}/sizuku_${d}.hdm`));
  assert.deepEqual(game.missingDisks(), []);

  const files = game.files();
  const lfg = files.filter((f) => f.path.endsWith('.LFG'));
  const scn = files.filter((f) => /^SCN\/SCN\d+\.DAT$/.test(f.path));
  assert.equal(lfg.length, 163);
  assert.equal(scn.length, 192);

  for (const f of lfg) {
    const img = decodeLfg(f.read());
    assert.ok(img.x + img.width <= 640 && img.y + img.height <= 400, f.path);
  }
  let messages = 0;
  for (const f of scn) {
    const s = parseScenario(f.read());
    for (const t of s.texts) {
      assert.equal(tokenizeText(t).at(-1)?.t, 'end', `${f.path}: message without $`);
      messages++;
    }
    for (let b = 0; b < s.blocks.length; b++) disassembleBlock(s, b);
  }
  assert.equal(messages, 3757);
  for (const f of files.filter((f) => /\.(FM|VD|LFD)$/.test(f.path))) assert.ok(unpack(f.read()).length > 0, f.path);
});
