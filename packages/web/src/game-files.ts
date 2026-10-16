import {
  GameFiles, loadRipple, loadTransitionData, type DiskId, type RippleAssets, type TransitionData,
} from '@shizuku/engine';
import { getItem, loadDisks, setItem } from './storage.ts';

/** Loads the player's disks from IndexedDB (or, in `pnpm dev`, from the developer's private dump). */
export async function openGame(): Promise<GameFiles | undefined> {
  let disks = await loadDisks();
  if (disks.size < 5 && import.meta.env.DEV) {
    const names: string[] = await fetch('/__dev/disks/').then((r) => r.json()).catch(() => []);
    for (const name of names) {
      const bytes = new Uint8Array(await (await fetch(`/__dev/disks/${name}`)).arrayBuffer());
      await importDisk(bytes).catch(() => undefined);
    }
    disks = await loadDisks();
  }
  if (disks.size < 5) return undefined;
  const game = new GameFiles();
  for (const bytes of disks.values()) game.addImage(bytes);
  return game;
}

/** Checks an image is a Shizuku disk and stores it. Returns which disk it is. */
export async function importDisk(bytes: Uint8Array): Promise<DiskId> {
  const probe = new GameFiles();
  const id = probe.addImage(bytes);
  await setItem('disks', id, bytes);
  return id;
}

export async function storedDisks(): Promise<DiskId[]> {
  const ids: DiskId[] = [];
  for (const id of ['A', 'B', 'C', 'D', 'E'] as DiskId[]) if (await getItem('disks', id)) ids.push(id);
  return ids;
}

const cached = <T>(load: (game: GameFiles) => T) => {
  const cache = new WeakMap<GameFiles, T>();
  return (game: GameFiles): T => {
    let v = cache.get(game);
    if (v === undefined) cache.set(game, (v = load(game)));
    return v;
  };
};

/** KCODE.SDT's glyphs and MAX_ADV.EXE's tables for the screen transitions. */
export const transitionData: (game: GameFiles) => TransitionData = cached(loadTransitionData);

/** OP_S0 and OP_S1, for the teardrop. */
export const rippleAssets: (game: GameFiles) => RippleAssets = cached(loadRipple);
