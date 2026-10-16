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
  decodeVd, decodeLfd, decodeKcode, decodeKcd,
  type FontTable, type Scenario, type TextToken, type Vd, type LfdFrames,
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
      if (ext === 'VD') {
        write(`sounds/${f.path}.wav`, wav(decodeVd(f.read())));
        count('sonidos');
      } else if (ext === 'LFD') {
        writeLfd(f.path, decodeLfd(f.read()));
      } else if (ext === 'SDT') {
        const glyphs = decodeKcode(f.read());
        write(`images/${f.path}.png`, glyphSheet(glyphs, 16, 18));
      }
    } else if (f.path === 'KNJ_ALL.KCD') {
      write(`images/${f.path}.png`, glyphSheet(decodeKcd(f.read()), 24, 64));
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

/** 16-bit mono WAV; the rate (16537.5 Hz) is rounded to 16538 for the header. */
function wav(vd: Vd): Uint8Array {
  const n = vd.samples.length;
  const b = Buffer.alloc(44 + n * 2);
  const rate = Math.round(vd.sampleRate);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(vd.samples[i] * 32767), 44 + i * 2);
  return b;
}

/** OP_S0: the drop sheet in the opening's blue; OP_L2: each head frame with OP_L0.LFG's palette. */
function writeLfd(path: string, lfd: LfdFrames) {
  if (lfd.kind === 'drop-sheet') {
    const pal = new Uint8Array(48);
    pal.set([0x33, 0x11, 0xbb], 3);
    write(`images/${path}.png`, encodePng(lfd.width, lfd.height, indexedRgba(lfd.frames[0], pal)));
    return;
  }
  const pal = game.has('OP_L0.LFG') ? decodeLfg(game.read('OP_L0.LFG')).palette : grey();
  lfd.frames.forEach((fr, k) => write(`images/${path}.${k}.png`, encodePng(lfd.width, lfd.height, indexedRgba(fr, pal))));
}

function grey(): Uint8Array {
  return Uint8Array.from({ length: 48 }, (_, i) => Math.floor(i / 3) * 17);
}

function indexedRgba(px: Uint8Array, pal: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length * 4);
  for (let i = 0; i < px.length; i++) {
    out.set(pal.subarray(px[i] * 3, px[i] * 3 + 3), i * 4);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Square 1-bit glyphs (size x size) laid out `cols` per row, white on black, 1px gaps. */
function glyphSheet(glyphs: Uint8Array[], size: number, cols: number): Uint8Array {
  const cell = size + 1;
  const w = cols * cell;
  const h = Math.ceil(glyphs.length / cols) * cell;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(64);
  glyphs.forEach((g, i) => {
    const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cell;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = ((y0 + y) * w + x0 + x) * 4;
      rgba.fill(g[y * size + x] ? 255 : 0, o, o + 3);
    }
  });
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return encodePng(w, h, rgba);
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
