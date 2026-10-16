import { GameFiles, decodeLfg, type DiskId, type Frame, WIDTH, HEIGHT } from '@shizuku/engine';
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

/** Layers full-screen LFGs (e.g. the title: TITLE0 + TITLE) into one frame. */
export function layered(game: GameFiles, paths: string[]): Frame {
  const frame: Frame = { pixels: new Uint8Array(WIDTH * HEIGHT), palette: new Uint8Array(48) };
  for (const [i, path] of paths.entries()) {
    const img = decodeLfg(game.read(path));
    if (i === 0) frame.palette.set(img.palette);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const c = img.pixels[y * img.width + x];
        if (c !== img.transparent) frame.pixels[(img.y + y) * WIDTH + img.x + x] = c;
      }
    }
  }
  return frame;
}
