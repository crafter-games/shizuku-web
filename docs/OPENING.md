# Opening, title and menus (PC-98)

Observed in the emulator (`@pc98-web/core`, NP2, PC-9801VX, 86 board) by tracing every frame:
the screen, both VRAM banks, the graphics GDC's scroll registers, the shown bank and the text
layer's attributes. Times are frames at 56.42 Hz, counted from the first frame after RETURN
on the sound-source menu. Palette values are PC-98 4-bit RGB (`#RGB` below).

## How the PC-98 animates

The opening barely redraws anything. Each sheet is loaded once into a VRAM bank and animated with:

- **GDC scroll.** The graphics GDC start address shifts the whole bank; screen pixel (x, y) shows
  VRAM byte `(y*80 + x/8 + SAD*2) mod 32768`. That picks a cell out of a sheet.
- **Text-layer mask.** Text cells with attribute `05h` (visible, reversed, black) cover the
  graphics in 8x16 blocks; everything outside a window is masked this way.
- **Palette plane select.** A 4-plane image holds four 1-bit frames. A palette that lights only
  the indices with bit p set shows frame p.
- **Bank flipping.** The two banks alternate, so one is loaded while the other is shown.

To reproduce it we only need "draw frame k of sheet S into window W with colour C". The tables
below give that directly.

**Palette fades** are linear, floored, in 15 steps: `c = floor((from*(15-k) + to*k) / 15)`,
k = 1..15. Fading from black is `floor(to*k/15)`.

## Timeline

| Frames | What is shown |
|---|---|
| 0–80 | Black. LEAF.LFG is loaded from disk B. |
| 81–137 | All 16 colours step together from black to white (`#kkk`, k = 1..15), one step every 4 frames. |
| 137–175 | Plain white. LEAF.LFG is drawn at **(80,148)** (its header says 0,0). |
| 175–231 | Palette fades from white to LEAF's palette, 15 steps × 4 frames. |
| 261–280 | Letterbox: the band y 0–79 turns black from the right edge and the band y 320–399 from the left, both 32 px per frame, 20 frames. The bands stay. |
| 379–435 | LEAF fades to black, 15 steps × 4 frames. |
| 435–480 | OP_S0.LFD and OP_S1.LFG are loaded from disk A. |
| 483–614 | **Ripple** (below). |
| 660–716 | OP_V0.LFG (Mizuho, at 248,0) fades in from black, 15 steps × 4 frames. |
| 716–784 | Hold. |
| 784–840 | OP_V0 fades out, 15 steps × 4 frames. |
| 883–1015 | Ripple again. |
| 1054–1110 / 1178–1234 | OP_V1.LFG (Saori, at 88,0): fade in, hold, fade out, same timing. |
| 1277–1409 | Ripple again. |
| 1496–2116 | **Ruriko** (below). |
| 2116–2185 | Black. TITLE0.LFG is loaded. |
| 2185–2241 | TITLE0 fades in from black, 15 steps × 4 frames. |
| 2300–2346 | TITLE.LFG (雫/しずく, at 224,31) **dissolves in** (below). |
| 2346– | Static; waits for a key (tested for 100 s: nothing else happens, no demo loop). |

FM music starts with the RETURN on the sound menu (its track number is still to be identified).

### Ripple (each time, 19 steps, a new step every 7 frames, ±1)

Lit pixels are **#31B**; everything else is black. The rest of the screen is masked black.

| Step | Source | Window on screen |
|---|---|---|
| 0–9 | OP_S0.LFD cell k: the 128x200 cell at sheet position ((k mod 5)·128, ⌊k/5⌋·200) | (256,160)–(384,368) |
| 10 | OP_S1.LFG plane 0 (blue bit), x 0–319, y 0–199 | (160,160)–(480,368) |
| 11 | OP_S1 plane 0, x 320–639, y 0–199 | (160,160)–(480,368) |
| 12 | OP_S1 plane 0, y 200–399 | (0,160)–(640,368) |
| 13, 14 | OP_S1 plane 1 (red bit), y 0–199, then y 200–399 | (0,160)–(640,368) |
| 15, 16 | plane 2 (green bit), top then bottom | same |
| 17, 18 | plane 3 (intensity bit), top then bottom | same |

The windows are 208 rows tall for 200-row frames: the extra 8 rows are blank.
So OP_S1.LFG is not meant to be shown as it is. It holds nine 1-bit frames in the planes of one
640x400 picture: the top half of plane 0 as two 320-wide frames, then plane 0's bottom half, then
the top and bottom halves of planes 1–3.

### Ruriko (1496–2116)

Window x 160–479, full height; the sides are masked black. Three hair-in-the-wind frames, each
320x400: **A** = OP_L0.LFG x 0–319, **B** = OP_L0.LFG x 320–639, **C** = OP_L1.LFG. They play in
the order C, A, B, … (the first shown, at 1496, is A for 6 frames).

- 1496–1580: palette fades in (OP_L0's palette), 15 steps × **6** frames, while the frames change
  every 12 frames.
- Hold: a new frame every 12 frames.
- Head turn: OP_L2.LFD frames 0–5 (224x224) are pasted at screen **(224,16)** into the frames
  shown next, A, B, C, A, B, C. They appear at 1778, 1787, 1795, 1804, 1816 and 1828. From then
  on the cycle shows head frames 3, 4, 5 (eyes open).
- 2032–2110: fade out, 15 steps × 6 frames, still animating.

### Title dissolve (2300–2346)

16 steps × 3 frames. Step i draws the pixels of TITLE.LFG whose (y mod 4, x mod 4) is the i-th of:
(0,0) (2,2) (0,2) (2,0) (1,1) (3,3) (1,3) (3,1) (0,1) (2,3) (0,3) (2,1) (1,0) (3,2) (1,2) (3,0).
Each step draws rows y < 184 on one frame and the rest on the next. Only the logo's pixels change.
The logo uses colours 9–14 of the shared palette (#000, #575, #700, #B00, #F00, #537).

## Menus

All menu text comes from the 24x24 font (KNJ_ALL.KCD). It is stored in MAX_ADV.EXE as font-index
strings in the same format as the scenario text (`s0` … `r$`), next to a table of far pointers
and one enable byte per item. Selected item **#FFF**, others **#AAA**. Cursor ▶ is a font glyph.

| Menu | Layout |
|---|---|
| Sound source (on black, at boot) | heading 音源を選択して下さい at (201,160) #FFF; items ＭＩＤＩ音源 / ＦＭ音源 / 音源なし at x 240, y 224/258/292; cursor x 213; FM preselected. |
| Title (RETURN on the title) | colours 0–14 dimmed to `floor(c*10/15)`, colour 15 kept; items ゲームを始める / 音源選択 / しおりの初期化 / 回想モード at x 240, y 246 + 34n; cursor x 213; 1-px black shadow down-right. A fifth item, ＤＯＳに戻る, exists in the EXE but is not shown when booting from floppy. |
| Bookmarks (ゲームを始める) | black screen; しおり　１/２/３ at x ≈ 228, y 137/171/205; cursor x 197. |
| Continue or new | 続きから始める / 初めから始める at x 201, y 136/170; cursor x 173. Choosing fades the menu out. |
| Disk request | text layer, bottom row, red: `ドライブにディスク Ｃ を挿入して下さい [C:BCK\MAX_S01.LFG]`. We never need it. |

## Not yet pinned down

- Which FM track plays during the opening, and the exact frame it starts.
- How the letterbox bands are drawn: the screen differs from the shown VRAM there, so it is not plain VRAM.
- Whether the title-menu dim is instant or animated (op 64h dims over 6 steps × 2 frames).
