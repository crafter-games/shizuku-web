import { listFiles, type DiskFile } from './disk.ts';

export type DiskId = 'A' | 'B' | 'C' | 'D' | 'E';
export const DISK_IDS: readonly DiskId[] = ['A', 'B', 'C', 'D', 'E'];

export interface GameFile extends DiskFile {
  disk: DiskId;
}

/** Which Shizuku disk an image is, from the 1-byte DISK_A..DISK_E marker file on each one. */
export function identifyDisk(files: DiskFile[]): DiskId | undefined {
  for (const id of DISK_IDS) if (files.some((f) => f.path === `DISK_${id}`)) return id;
  return undefined;
}

/**
 * All of the game's files from the player's disk images, merged into one tree.
 * The PC-98 asks for disk swaps; we have every disk at once, so a path is
 * looked up across all of them (C and D share the CHR/ folder and some BCK/).
 */
export class GameFiles {
  readonly disks = new Map<DiskId, DiskFile[]>();
  private readonly byPath = new Map<string, GameFile>();

  addImage(image: Uint8Array): DiskId {
    const files = listFiles(image);
    const id = identifyDisk(files);
    if (!id) throw new Error('Esta imagen no es un disco de Shizuku');
    this.disks.set(id, files);
    for (const f of files) {
      if (!this.byPath.has(f.path)) this.byPath.set(f.path, { ...f, disk: id });
    }
    return id;
  }

  missingDisks(): DiskId[] {
    return DISK_IDS.filter((id) => !this.disks.has(id));
  }

  has(path: string): boolean {
    return this.byPath.has(path.toUpperCase());
  }

  read(path: string): Uint8Array {
    const f = this.byPath.get(path.toUpperCase());
    if (!f) throw new Error(`Falta el archivo ${path}`);
    return f.read();
  }

  files(): GameFile[] {
    return [...this.byPath.values()];
  }
}
