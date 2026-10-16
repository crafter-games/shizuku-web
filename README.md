# shizuku-web

A browser reimplementation of Leaf's MAX engine that plays the PC-98 visual
novel **Shizuku** (雫, Leaf, 1996) in Spanish, from the player's own disks.

No game data is in this repository, and none is ever hosted. Players load
their own five floppy images; they stay in the browser. A pre-commit hook and
CI reject disk images and anything decoded from them.

```sh
pnpm install
git config core.hooksPath .githooks
pnpm decode      # decode the disks in ../pc98/fixtures/private/shizuku into out/
pnpm test
```

See [docs/DESIGN.md](docs/DESIGN.md) for the design and the file formats.

## Credits

- File formats and scenario bytecode: XLVNS by Go Watanabe (BSD), ported to TypeScript.
- PC-98 specifics cross-checked against Her-Saki's English patch tools (used as documentation).
- FM music: the PMD driver and YM2608 emulator of 98fmplayer by Takamichi Horikawa (BSD-2-Clause), built to WebAssembly in `packages/pmd` (see its LICENSE).
