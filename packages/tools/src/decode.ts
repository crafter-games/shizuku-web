// Decodes every file on the player's Shizuku disks into out/ (git-ignored):
// raw files, LFG images as PNG, scenarios as readable listings + JSON, and
// packed files (music, sounds, animations) unpacked.
//
//   pnpm decode [--disks DIR] [--font-table FILE] [--out DIR]
//
// Defaults: the private dump in ../pc98/fixtures/private/shizuku and the font
// table in ../shizuku-es/reference/font-table.jp.txt, next to this repo.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  GameFiles, decodeLfg, lfgToRgba, parseScenario, tokenizeText, disassembleBlock, unpack, parseFontTable,
  type FontTable, type Scenario, type TextToken,
} from '@shizuku/engine';
import { encodePng } from './png.ts';
import { OP_NAMES } from './ops.ts';

const root = resolve(import.meta.dirname, '../../..');
const { values: args } = parseArgs({
  options: {
    disks: { type: 'string', default: join(root, '../pc98/fixtures/private/shizuku') },
    'font-table': { type: 'string', default: join(root, '../shizuku-es/reference/font-table.jp.txt') },
    out: { type: 'string', default: join(root, 'out') },
  },
});

const game = new GameFiles();
for (const name of readdirSync(args.disks).sort()) {
  if (!/\.(hdm|fdi|d88)$/i.test(name)) continue;
  try {
    console.log(`${name}: disco ${game.addImage(readFileSync(join(args.disks, name)))}`);
  } catch (e) {
    console.log(`${name}: ${(e as Error).message}`);
  }
}
const missing = game.missingDisks();
if (missing.length) console.warn(`Faltan discos: ${missing.join(', ')}`);

const font: FontTable | undefined = existsSync(args['font-table'])
  ? parseFontTable(readFileSync(args['font-table'], 'utf8'))
  : undefined;
if (!font) console.warn(`Sin tabla de fuente (${args['font-table']}): el texto japonés saldrá como códigos.`);

const write = (path: string, data: string | Uint8Array) => {
  const full = join(args.out, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
};

const counts: Record<string, number> = {};
const failures: string[] = [];
const count = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);

for (const [disk, files] of game.disks) {
  for (const f of files) write(`files/${disk}/${f.path}`, f.read());
}

for (const f of game.files()) {
  const ext = f.path.split('.').pop()!;
  try {
    if (ext === 'LFG') {
      const img = decodeLfg(f.read());
      write(`images/${f.path}.png`, encodePng(img.width, img.height, lfgToRgba(img)));
      count('imágenes');
    } else if (/^SCN\/SCN\d+\.DAT$/.test(f.path)) {
      const name = f.path.slice(4, -4);
      const scn = parseScenario(f.read());
      write(`scenario/${name}.txt`, listing(name, scn));
      write(`scenario/${name}.json`, JSON.stringify(messages(scn), null, 1));
      count('escenarios');
    } else if (['FM', 'MD', 'VD', 'LFD', 'SDT'].includes(ext)) {
      write(`unpacked/${f.path}${ext === 'FM' ? '.M' : '.bin'}`, unpack(f.read()));
      count('empaquetados');
    }
  } catch (e) {
    failures.push(`${f.path}: ${(e as Error).message}`);
  }
}

console.log(`Listo en ${args.out}:`, counts);
if (failures.length) {
  console.error(`${failures.length} errores:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}

function textOf(tokens: TextToken[]): string {
  return tokens
    .map((t) => {
      switch (t.t) {
        case 'char': return font ? font(t.code) : `〈${t.code.toString(16)}〉`;
        case 'newline': return '⏎';
        case 'page': return '¶';
        case 'key': return '▼';
        case 'cmd': return `[${t.raw}]`;
        case 'end': return '';
      }
    })
    .join('');
}

function messages(scn: Scenario) {
  return scn.texts.map((bytes, id) => ({ id, text: textOf(tokenizeText(bytes)) }));
}

function listing(name: string, scn: Scenario): string {
  const lines = [`# ${name}: ${scn.blocks.length} bloques, ${scn.texts.length} mensajes`, ''];
  for (let b = 0; b < scn.blocks.length; b++) {
    lines.push(`## bloque ${b} @${scn.blocks[b]}`);
    for (const op of disassembleBlock(scn, b)) {
      const hex = op.args.map((a) => a.toString(16).padStart(2, '0')).join(' ');
      let line = `  ${String(op.at).padStart(5)}  ${op.op.toString(16).padStart(2, '0')} ${(OP_NAMES[op.op] ?? '?').padEnd(14)} ${hex}`;
      const shown = op.op === 0x54 ? [op.args[0]] : op.op === 0x05 ? [op.args[0], ...op.args.slice(2).filter((_, i) => i % 2 === 0)] : op.op === 0x01 && op.args[0] !== 3 ? [op.args[1]] : [];
      for (const id of shown) line += `\n           «${id}» ${textOf(tokenizeText(scn.texts[id]))}`;
      lines.push(line);
    }
    lines.push('');
  }
  return lines.join('\n');
}
