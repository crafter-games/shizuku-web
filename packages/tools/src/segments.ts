// Exports scenarios as translation work files: per message, its hash, the
// Japanese text of each segment and Her-Saki's English as a cross-reference.
// Output goes to out/translate/ (git-ignored: it contains the game's text).
//
//   pnpm segments [--from 1] [--to 7]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GameFiles, messageHash, parseFontTable, parseScenario, segmentMessage, tokenizeText } from '@shizuku/engine';

const root = resolve(import.meta.dirname, '../../..');
const { values: args } = parseArgs({
  options: {
    disks: { type: 'string', default: join(root, '../pc98/fixtures/private/shizuku') },
    es: { type: 'string', default: join(root, '../shizuku-es') },
    out: { type: 'string', default: join(root, 'out/translate') },
    from: { type: 'string', default: '0' },
    to: { type: 'string', default: '195' },
  },
});

const game = new GameFiles();
for (const name of readdirSync(args.disks)) if (/\.hdm$/i.test(name)) game.addImage(readFileSync(join(args.disks, name)));
const font = parseFontTable(readFileSync(join(args.es, 'reference/font-table.jp.txt'), 'utf8'));
mkdirSync(args.out, { recursive: true });

for (let n = Number(args.from); n <= Number(args.to); n++) {
  const id = String(n).padStart(3, '0');
  if (!game.has(`SCN/SCN${id}.DAT`)) continue;
  const scn = parseScenario(game.read(`SCN/SCN${id}.DAT`));
  const enPath = join(args.es, `reference/en/${id}.txt`);
  const en = existsSync(enPath) ? englishBlocks(readFileSync(enPath, 'utf8')) : [];
  const messages = scn.texts.map((bytes, msg) => {
    const items = segmentMessage(tokenizeText(bytes));
    return {
      msg,
      hash: messageHash(bytes),
      segments: items.flatMap((it) =>
        it.kind === 'text' ? [it.tokens.map((t) => (t.t === 'char' ? font(t.code) : '')).join('')] : []),
      commands: items.flatMap((it) => (it.kind === 'cmd' ? [`${it.raw}@${it.before}`] : [])),
      en: en[msg] ?? '',
    };
  });
  writeFileSync(join(args.out, `SCN${id}.json`), JSON.stringify(messages, null, 1));
}
console.log(`Escrito en ${args.out}`);

function englishBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const m of text.matchAll(/\{BLOCK:(\d+)\}\r?\n([\s\S]*?)(?=\r?\n\{BLOCK:|$)/g)) {
    blocks[Number(m[1])] = m[2].replace(/#\s*$/, '').trim();
  }
  return blocks;
}
