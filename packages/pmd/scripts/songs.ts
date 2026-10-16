// Finds the game's music for the dev scripts and tests: the decoded
// out/unpacked/MUS/SZ_FMnn.FM.M from `pnpm decode`, or else straight from the
// player's private disk A. Nothing here is ever committed.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameFiles, unpack } from '@shizuku/engine';

export const root = resolve(import.meta.dirname, '../../..');
export const disksDir = process.env.SHIZUKU_DISKS ?? join(root, '../pc98/fixtures/private/shizuku');
export const SONG_COUNT = 25;

export const songName = (n: number) => `SZ_FM${String(n).padStart(2, '0')}`;

let game: GameFiles | undefined;

/** The compiled PMD data of SZ_FMnn, or undefined when neither source is available. */
export function loadSong(n: number): Uint8Array | undefined {
  const decoded = join(root, 'out/unpacked/MUS', `${songName(n)}.FM.M`);
  if (existsSync(decoded)) return readFileSync(decoded);
  const diskA = join(disksDir, 'sizuku_a.hdm');
  if (!existsSync(diskA)) return undefined;
  if (!game) {
    game = new GameFiles();
    game.addImage(readFileSync(diskA));
  }
  const file = game.files().find((f) => f.path === `MUS/${songName(n)}.FM`);
  return file && unpack(file.read());
}
