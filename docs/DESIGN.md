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

**Font** (`KNJ_ALL.KCD`). u24 glyph count (1849), u24 offsets, then each glyph LZ77-compressed: a flag byte per 8 items (MSB first, 1 = literal), a reference byte `dddd llll` copies l+2 bytes from d+1 back. The window is the whole output, so references can reach earlier glyphs. A glyph is 72 bytes: three 8-px column strips, 24 rows each, MSB left (documented by Her-Saki's KCDCONV.ps1). The engine draws Spanish with web fonts and only needs this for the original look of the menus. The dev tools show the Japanese through the index → character table from Her-Saki's tools, kept in the private translation repo.

**Music.** `SZ_FM*.FM` unpack to compiled PMD (`.M`) data for Kajihara's PMD driver. `SZ_GS*.MD` are for the M.M.D. MIDI driver (unused). After the sound-board menu the game plays `SZ_FM00` (a 5 s jingle; `SZ_FM14` is the same file), then `SZ_FM15` over the opening and the title screen: 78 s, played once, so the title is silent after it. Songs 05, 08, 11, 13, 16, 19, 20 and 21 use the OPNA rhythm section, whose samples are in a Yamaha ROM we do not ship; `@shizuku/pmd` synthesizes stand-ins, or takes a ROM dump from the player.

**Sound effects** (`SZ_VDnn.VD`). Packed; headerless **8-bit signed mono PCM at 16537.5 Hz**. The 86 board is set to rate code 3 and 8-bit stereo, with each byte sent to both channels. Checked against emulator audio: SZ_VD11, the scream in SCN004, correlates only at 16537.5 Hz. Text commands: `Plnn` loads SZ_VDnn, `Paabb` plays it aa times (00 = until `Ps`) with bb × 320 samples of silence between repeats (decimal), `Pw` waits for the end, `Ps` stops, `Pf` frees. `Pcnn`/`Pdnn` exist in the EXE but no script uses them. On real hardware the PCM is only enabled under DOS ≥ 3 (`int 21h/30h`), so a floppy boot (whose DOS reports less) plays no effects. To hear them in the emulator, patch the check once MAX_ADV.EXE is in memory: overwrite image offset 0x6F3 (`mov ah,30h; int 21h`) with `mov al,3; xor ah,ah; retf` (`B0 03 32 E4 CB`).

**LFD** (`OP_S0.LFD`, `OP_L2.LFD`). Packed raw bit planes, no header or palette; the geometry is fixed per file. OP_S0 is one 640x400 plane: ten 128x200 cells of a drop falling and rippling. OP_L2 is six 224x224 frames of 4 planes (B, R, G, E = index bits 0–3, 28 bytes per row), Ruriko turning her head, using OP_L0.LFG's palette. Their use is in [OPENING.md](OPENING.md).

**KCODE.SDT.** Packed; 162 user-defined 16x16 text characters (32 bytes each, big-endian rows), used for transitions drawn in the text layer: a diamond iris (0–127, 32 sizes × 4 quadrants), a bar wipe (128–144) and a dither fade (145–161).

**SZEF.EFC.** Not packed. A PMD FM effect bank: 128 u16 offsets to sequences ending in `80h`, then FM voices. Bytecode `71 n` / `72 n` would play FM / SSG effect n, but no scenario uses them.

**Opening, title and menus.** See [OPENING.md](OPENING.md).

**Bytecode on PC-98.** MAX_ADV.EXE dispatches opcodes 00–88h through a jump table (image offset 0xA340 + 0xA12). The palette routines keep a state: 0 black, 1 normal, 2 white, 3 dimmed. "Fade" means 16 steps of the linear, floored mix. A wait of n is n vsyncs (56.4 Hz).

| Op | PC-98 meaning |
|---|---|
| `03 n` | wait n vsyncs |
| `5a` | set the palette at once (state 1) |
| `5b` | black at once (state 0) |
| `5c n` | fade to black, n−1 vsyncs per step |
| `5d n` | fade in from black, n−1 vsyncs per step |
| `5e` / `5f` | save / restore the palette |
| `60` | white at once (state 2) |
| `61 n` | fade to white, n−1 per step |
| `62 n` | fade in from white, n−1 per step |
| `63` | from dimmed back to normal (5 steps × 2 vsyncs) |
| `64` | dim colours 0–14 to 10/15, colour 15 kept: step k is `floor(c*(15-k)/15)`, k = 1..5, 2 vsyncs each |
| `65` | from black, fade in to the palette dimmed to 10/15 except colour 15 (3 per step) |
| `66` | from the dimmed palette, fade to black |
| `67 n` | mix n/15 of grey into the palette, at once |
| `68` / `69` | fade to grey / back to colour (16 steps × 2 vsyncs) |
| `6e n` | play music n |
| `6f` | start a music fade-out |
| `70` | stop music |
| `73` | fade music out and wait until it ends |
| `71 n` / `72 n` | PMD FM / SSG effect n (unused) |
| `01 03 n` | teardrop: the opening's drop and ripples (OP_S0/OP_S1) on black, with the loaded PCM effect when the drop lands (cell 4). n = 0: the whole 19-step sequence twice. n = 1: once, the last steps slowing (7, 9, 11, 13 vsyncs), stopping on step 14, which stays on screen as the background (the scripts then dissolve VIS25 over it) |
| `14 n` | fill the screen with colour n at once (scripts: 0) |
| `15 n` | clear to black with transition n |
| `38 n` | show the background with transition n |

**Transitions.** Op `15 n` and the clear digits of inline `B`/`E`/`V`/`H`/`S` run one of twelve clear routines (0–11, image 0xB1C2); op `38 n` and the display digits one of thirteen show routines (0–12, image 0xC94E); 99 skips the step. Before a clear other than 0 and 11 the dim lifts. Most draw a mask in the text layer: 16x16 cells, solid or a KCODE.SDT glyph, black where lit when clearing, reversed when showing. Each is reimplemented in `packages/engine/src/effects.ts` (table there) and matches the emulator frame for frame, except the CPU-bound split row of the dissolve: fade (palette, 3 vsyncs a step), spiral, pseudo-random cells (the game's 16-bit LFSR), KCODE diamonds, diamond wipe, dither, a 16-line interleaved line wipe, bar wipe, dither wipe, a vertical squash through 16 line masks in the EXE's data, KCODE bars, cut, and (show only) the ordered 4x4 dissolve of the title. Character changes (`C`, `D`, `A`, ops 22/24) are drawn at once after the dim lifts.

XLVNS gives `61` three bytes; the PC-98 handler reads one, and the scripts' disassembly agrees with OP_LENGTH. The text command `F` is a white flash: fade to white, hold 30 vsyncs, fade back to the dimmed palette.

**Still unknown.** How the opening's letterbox bands are drawn. The FM effect sequence format in detail. What op `16` (H scenes) does on screen.
