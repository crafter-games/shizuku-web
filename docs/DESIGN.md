# Design

Settled with the user on 2026-10-16.

## Goal and constraints

- A native TypeScript engine (ScummVM-style) that plays PC-98 Shizuku **in Spanish**, on desktop and phones.
- Private: for the user and friends, at `shizuku.crafter.games`, unlisted and `noindex`. Spanish-only UI.
- Each player loads their own disk images (`.hdm`, `.fdi`, `.d88`). They stay in the browser (OPFS / IndexedDB) and are never uploaded. No game bytes are committed, hosted or deployed.
- The emulator (`@pc98-web/core`, Neko Project II) is only a dev dependency: the reference that the engine's screenshots and flags are compared against.

## Translation

- Claude translates from the Japanese, with Her-Saki's English as a cross-reference. The user reviews it once in a dev-only review page.
- Neutral Latin American Spanish; *tú* between students, *usted* with adults; honorifics dropped except a selective *-senpai*; names in Japanese order with Her-Saki's spellings.
- The translation lives in a separate private repo (`shizuku-es`), contains only Spanish, and is keyed by scenario + message id plus a hash of the original message. It is bundled only at deploy time.

## Features

- 640x400 16-colour art, nearest-neighbour scaling, optional 4:3 aspect correction.
- Landscape: text over the picture, as in the original. Portrait: picture on top, text panel below.
- FM music (PMD data played by a WASM build of 98fmplayer, `packages/pmd`) and `.VD` PCM effects. No MIDI.
- Saves in IndexedDB: unlimited slots, quick save, auto-save at choices, export/import. Backlog, skip read text, auto-advance, CG gallery.
- Effects (fades, flashes, ripples, shakes, the opening) must look right next to the emulator, checked by screenshot tests at key frames.

## Milestones

1. A CLI that decodes every format on the disks (`pnpm decode`).
2. A vertical slice: the title to the rooftop choice, playable in Spanish.
3. The whole game and every ending.
4. The translation review.

## Disks

Five PC-98 2HD floppies, FAT12 (1024-byte sectors, 8 per track, 77 cylinders, 2 heads). Each has a 1-byte marker file `DISK_A` … `DISK_E`, which is how images are identified. The game asks for disk swaps; we load all five at once and merge their trees (C and D share `CHR/` and some `BCK/`).

| Disk | Contents |
|---|---|
| A | `MAX_ADV.EXE`, `PMD.COM`, `SCN/` (192 scenarios), `MUS/` (`SZ_FM*.FM`, `SZ_GS*.MD`), `VIS/`, a few `CHR/` and `BCK/` |
| B | Title and opening (`TITLE*.LFG`, `OP_*`), `VIS/`, font `KNJ_ALL.KCD`, sounds `SZ_VD*.VD`, `SZEF.EFC` |
| C, D | Backgrounds `BCK/MAX_S*.LFG`, characters `CHR/MAX_C*.LFG` |
| E | `HVS/` |

## Formats

**LZSS.** 4 KB ring buffer, zero-filled, written from 0xFEE. Flag bits MSB first, 1 = literal. A reference is a u16 LE: position = word >> 4, length = (word & 0xF) + 3. LFG uses it as is; everything else uses the *inverted* variant, where every input byte is bit-complemented.

**Packed files** (`.FM`, `.MD`, `.VD`, `.LFD`, `.SDT`, scenario sections): u32 unpacked size, then inverted LZSS.

**LFG images.** `LEAFCODE`; 24-byte palette (16 colours × R,G,B nibbles); at 32: u16 x0/8, y0, x1/8, y1 (inclusive); 40: scan order (0 = column pairs top to bottom, 1 = rows); 41: transparent index (0xFF none); 44: u32 unpacked size; 48: LZSS. Two pixels per byte, bit-interleaved like planar VRAM (bits 7,5,3,1 and 6,4,2,0).

**Scenarios** (`SCN/SCNnnn.DAT`). u16 code offset / 16, u16 text offset / 16, each a packed section. Not encrypted on PC-98 (the Windows release's 11-byte key does not apply). Code: u16 block count + u16 block offsets, then bytecode (opcodes in `packages/tools/src/ops.ts`, semantics in XLVNS `sizuku.c`). Text: u16 message count + u16 offsets. A message is font indices (two bytes with the high bit set: `(b0 & 0x7F) << 8 | b1`) mixed with ASCII control codes (`r` newline, `p` page, `K` key wait, `$` end, and inline commands `B`, `C`, `S`, `V`, `H`, `M`, `P`, …). 3,757 messages in all.

**Font** (`KNJ_ALL.KCD`). u24 glyph count (1849), u24 offsets, then a per-glyph compressed bitmap in a scheme not yet decoded (not LZSS). The engine does not need it: Spanish is drawn with web fonts. The dev tools show the Japanese through the index → character table from Her-Saki's tools, kept in the private translation repo.

**Music.** `SZ_FM*.FM` unpack to compiled PMD (`.M`) data for Kajihara's PMD driver. `SZ_GS*.MD` are for the M.M.D. MIDI driver (unused). After the sound-board menu the game plays `SZ_FM00` (a 5 s jingle; `SZ_FM14` is the same file), then `SZ_FM15` over the opening and the title screen: 78 s, played once, so the title is silent after it. Songs 05, 08, 11, 13, 16, 19, 20 and 21 use the OPNA rhythm section, whose samples are in a Yamaha ROM we do not ship; `@shizuku/pmd` synthesizes stand-ins, or takes a ROM dump from the player.

**Still unknown.** `.VD` sample format (PCM for the 86 board's PCM), `.LFD` animation layout (`OP_S0`, `OP_L2`), `KCODE.SDT`, `SZEF.EFC`, and the opcodes XLVNS marks as unknown (`03`, `5a`, `5c`, `60`–`66`, `6f`, `73`).
