import { unpack } from './lzss.ts';

/**
 * A scenario file, SCN/SCNnnn.DAT. Header: u16 code offset / 16, u16 text
 * offset / 16; each section is a packed file (u32 size + inverted LZSS).
 * The code section starts with u16 block count and u16 offsets per block;
 * the text section with u16 message count and u16 offsets per message.
 * Layout from XLVNS LvnsFile.c; the PC-98 files are not encrypted.
 */
export interface Scenario {
  code: Uint8Array;
  blocks: number[];
  texts: Uint8Array[];
}

export function parseScenario(file: Uint8Array): Scenario {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const code = unpack(file, view.getUint16(0, true) * 16);
  const text = unpack(file, view.getUint16(2, true) * 16);
  return { code, blocks: offsetTable(code), texts: splitTexts(text) };
}

function offsetTable(section: Uint8Array): number[] {
  const count = section[0] | (section[1] << 8);
  const offsets: number[] = [];
  for (let i = 1; i <= count; i++) offsets.push(section[i * 2] | (section[i * 2 + 1] << 8));
  return offsets;
}

function splitTexts(section: Uint8Array): Uint8Array[] {
  const offsets = offsetTable(section);
  return offsets.map((start, i) => section.subarray(start, offsets[i + 1] ?? section.length));
}

/** One piece of a message. Characters are indices into the game's font (KNJ_ALL). */
export type TextToken =
  | { t: 'char'; code: number }
  | { t: 'newline' }
  | { t: 'page' }
  | { t: 'key' }
  | { t: 'end' }
  /** An inline command: background, character, music, sound, effect... `raw` is its ASCII text, e.g. "B0105" or "M03". */
  | { t: 'cmd'; op: string; raw: string };

// Total length (including the letter) of the fixed-size inline commands.
const INLINE_LENGTH: Record<string, number> = {
  C: 4, D: 4, B: 7, E: 7, V: 7, H: 7, S: 10, A: 10, a: 10, Q: 1, F: 1, X: 2, s: 2,
};

/** Splits a message into characters and control codes (from XLVNS SizukuDispText). */
export function tokenizeText(bytes: Uint8Array): TextToken[] {
  const tokens: TextToken[] = [];
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b & 0x80) {
      tokens.push({ t: 'char', code: ((b & 0x7f) << 8) | bytes[i + 1] });
      i += 2;
      continue;
    }
    const op = String.fromCharCode(b);
    switch (op) {
      case '$':
        tokens.push({ t: 'end' });
        return tokens;
      case 'r':
        tokens.push({ t: 'newline' });
        i++;
        break;
      case 'p':
        tokens.push({ t: 'page' });
        i++;
        break;
      case 'k':
      case 'K':
        tokens.push({ t: 'key' });
        i++;
        break;
      case '0': // a stray '0' the original scripts contain in places
        i++;
        break;
      case 'M':
      case 'P': {
        // M: f n## w ## s   P: l## c## d## #### f w s (MAX_ADV.EXE's P handler)
        const sub = String.fromCharCode(bytes[i + 1]);
        let len = 2;
        if (sub === 'n' || sub === 'l' || (op === 'P' && (sub === 'c' || sub === 'd'))) len = 4;
        else if (op === 'M' && sub >= '0' && sub <= '2') len = 3;
        else if (op === 'P' && sub >= '0' && sub <= '9') len = 5;
        tokens.push({ t: 'cmd', op, raw: ascii(i, i + len) });
        i += len;
        break;
      }
      default: {
        const len = INLINE_LENGTH[op];
        if (!len) throw new Error(`Código de texto desconocido 0x${b.toString(16)} en ${i}`);
        tokens.push({ t: 'cmd', op, raw: ascii(i, i + len) });
        i += len;
      }
    }
  }
  return tokens;
}

/** A decoded bytecode instruction, for disassembly and the interpreter. */
export interface Op {
  at: number;
  op: number;
  args: number[];
  length: number;
}

// Instruction lengths from XLVNS SizukuMain. 0x01 is 3 bytes, 0x05 is variable.
const OP_LENGTH: Record<number, number> = {
  0x00: 1, 0x01: 3, 0x03: 2, 0x04: 3, 0x06: 1, 0x07: 1, 0x0a: 2, 0x14: 2, 0x15: 2, 0x16: 2,
  0x22: 3, 0x24: 3, 0x28: 1, 0x38: 2, 0x3d: 4, 0x3e: 4, 0x47: 3, 0x48: 3, 0x54: 2,
  0x5a: 1, 0x5c: 2, 0x60: 1, 0x61: 3, 0x62: 2, 0x63: 1, 0x64: 1, 0x65: 1, 0x66: 1,
  0x5b: 1, 0x5d: 2, 0x5e: 1, 0x5f: 1, 0x67: 2, 0x68: 1, 0x69: 1,
  0x6e: 2, 0x6f: 1, 0x70: 1, 0x71: 2, 0x72: 2, 0x73: 1, 0x7c: 1, 0x7d: 2, 0x7e: 2, 0xff: 1,
};

export function decodeOp(code: Uint8Array, at: number): Op {
  const op = code[at];
  const length = op === 0x05 ? 3 + code[at + 2] * 2 : OP_LENGTH[op];
  if (length === undefined) throw new Error(`Instrucción desconocida 0x${op.toString(16)} en ${at}`);
  return { at, op, args: [...code.subarray(at + 1, at + length)], length };
}

/** Disassembles a block linearly until its end-of-block (0x00). */
export function disassembleBlock(scn: Scenario, block: number): Op[] {
  const ops: Op[] = [];
  let at = scn.blocks[block];
  for (;;) {
    const op = decodeOp(scn.code, at);
    ops.push(op);
    if (op.op === 0x00 || op.op === 0xff || at + op.length >= scn.code.length) break;
    at += op.length;
  }
  return ops;
}

/** A run of text shown in one go, ending in a wait. Translations are per segment. */
export interface Segment {
  kind: 'text';
  /** Position among the message's segments: the translation key. */
  index: number;
  tokens: TextToken[];
  /** Starts on a new line (the original breaks the line after the previous wait). */
  newline: boolean;
  /** key: wait, keep the page; page: wait, then clear the page; none: no wait. */
  wait: 'key' | 'page' | 'none';
}

/** An inline command, to run before the segment numbered `before`. */
export interface SegmentCommand {
  kind: 'cmd';
  op: string;
  raw: string;
  before: number;
}

/**
 * Splits a message into text segments at the player's waits (K, p), with the
 * inline commands in between. A command in the middle of a line ends the
 * segment before it, so the text up to it shows first. Line breaks ('r') at
 * the start of a segment become its `newline`; others are the original's
 * hard wraps and stay as tokens for the Japanese layout.
 */
export function segmentMessage(tokens: TextToken[]): (Segment | SegmentCommand)[] {
  const out: (Segment | SegmentCommand)[] = [];
  let index = 0;
  let current: TextToken[] = [];
  let newline = false;
  const hasText = () => current.some((t) => t.t === 'char');
  const flush = (wait: Segment['wait']) => {
    if (hasText() || wait !== 'none') out.push({ kind: 'text', index: index++, tokens: current, newline, wait });
    current = [];
    newline = false;
  };
  for (const t of tokens) {
    switch (t.t) {
      case 'char':
        current.push(t);
        break;
      case 'newline':
        if (hasText()) current.push(t);
        else newline = true;
        break;
      case 'key':
        flush('key');
        break;
      case 'page':
        flush('page');
        break;
      case 'end':
        flush('none');
        return out;
      case 'cmd':
        if (hasText()) flush('none');
        out.push({ kind: 'cmd', op: t.op, raw: t.raw, before: index });
        break;
    }
  }
  flush('none');
  return out;
}

/** FNV-1a of a message's bytes: tells whether a translation still matches the player's disks. */
export function messageHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
