import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lzss, unpack } from '../src/lzss.ts';

// Hand-built streams: no game data in public tests.
test('literals and a back-reference into the ring', () => {
  // flag 0b1110_0000: three literals "abc", then a reference to ring 0xFEE, length 6.
  const word = (0xfee << 4) | (6 - 3);
  const src = new Uint8Array([0xe0, 0x61, 0x62, 0x63, word & 0xff, word >> 8]);
  assert.equal(new TextDecoder().decode(lzss(src, 0, 9, false)), 'abcabcabc');
});

test('inverted container with a u32 size header', () => {
  const plain = new Uint8Array([0xff, 0x48, 0x6f, 0x6c, 0x61, 0x21, 0x21, 0x21, 0x21]);
  const packed = new Uint8Array(4 + plain.length);
  new DataView(packed.buffer).setUint32(0, 8, true);
  packed.set(plain.map((b) => ~b & 0xff), 4);
  assert.equal(new TextDecoder().decode(unpack(packed)), 'Hola!!!!');
});
