// Floppy images and the FAT12 file system on them. Shizuku ships on five
// PC-98 2HD disks (1024-byte sectors, 8 per track, 77 cylinders, 2 heads).

export interface DiskFile {
  /** Path inside the disk, upper-case, '/'-separated, e.g. "SCN/SCN001.DAT". */
  path: string;
  size: number;
  read(): Uint8Array;
}

const SECTOR_2HD = 1024;

/** Converts a disk image (.hdm, .fdi, .d88) to a flat array of sectors. */
export function rawSectors(image: Uint8Array): Uint8Array {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  // FDI (Anex86): 32-byte header, then the raw image after headerSize bytes.
  if (image.length > 32 && view.getUint32(0, true) === 0) {
    const headerSize = view.getUint32(8, true);
    const dataSize = view.getUint32(12, true);
    if (headerSize >= 32 && headerSize + dataSize === image.length) {
      return image.subarray(headerSize);
    }
  }
  // D88: 0x2B0-byte header holding the image size and a table of track offsets.
  if (image.length > 0x2b0 && view.getUint32(0x1c, true) === image.length) {
    return d88Sectors(image, view);
  }
  return image;
}

function d88Sectors(image: Uint8Array, view: DataView): Uint8Array {
  const tracks: Uint8Array[] = [];
  for (let t = 0; t < 164; t++) {
    let pos = view.getUint32(0x20 + t * 4, true);
    if (pos === 0) continue;
    const count = view.getUint16(pos + 4, true);
    const sectors: { r: number; data: Uint8Array }[] = [];
    for (let s = 0; s < count; s++) {
      const r = image[pos + 2];
      const size = view.getUint16(pos + 0x0e, true);
      sectors.push({ r, data: image.subarray(pos + 0x10, pos + 0x10 + size) });
      pos += 0x10 + size;
    }
    sectors.sort((a, b) => a.r - b.r);
    for (const s of sectors) tracks.push(s.data);
  }
  const out = new Uint8Array(tracks.reduce((n, s) => n + s.length, 0));
  let o = 0;
  for (const s of tracks) {
    out.set(s, o);
    o += s.length;
  }
  return out;
}

interface Bpb {
  sectorSize: number;
  clusterSectors: number;
  reserved: number;
  fats: number;
  rootEntries: number;
  fatSectors: number;
}

function readBpb(sectors: Uint8Array): Bpb {
  const view = new DataView(sectors.buffer, sectors.byteOffset, sectors.byteLength);
  const sectorSize = view.getUint16(0x0b, true);
  if ([256, 512, 1024].includes(sectorSize) && sectors[0x0d] > 0 && sectors[0x10] > 0) {
    return {
      sectorSize,
      clusterSectors: sectors[0x0d],
      reserved: view.getUint16(0x0e, true),
      fats: sectors[0x10],
      rootEntries: view.getUint16(0x11, true),
      fatSectors: view.getUint16(0x16, true),
    };
  }
  // No BPB: the standard PC-98 2HD layout.
  return { sectorSize: SECTOR_2HD, clusterSectors: 1, reserved: 1, fats: 2, rootEntries: 192, fatSectors: 2 };
}

const sjis = new TextDecoder('shift_jis');

/** Lists every file on a FAT12 floppy image, recursing into folders. */
export function listFiles(image: Uint8Array): DiskFile[] {
  const sectors = rawSectors(image);
  const bpb = readBpb(sectors);
  const fatStart = bpb.reserved * bpb.sectorSize;
  const rootStart = fatStart + bpb.fats * bpb.fatSectors * bpb.sectorSize;
  const dataStart = rootStart + bpb.rootEntries * 32;
  const clusterSize = bpb.clusterSectors * bpb.sectorSize;

  const nextCluster = (c: number): number => {
    const at = fatStart + Math.floor(c * 1.5);
    const pair = sectors[at] | (sectors[at + 1] << 8);
    return c & 1 ? pair >> 4 : pair & 0xfff;
  };
  const chain = (first: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let o = 0;
    for (let c = first; c >= 2 && c < 0xff0 && o < size; c = nextCluster(c)) {
      const start = dataStart + (c - 2) * clusterSize;
      const part = sectors.subarray(start, start + Math.min(clusterSize, size - o));
      out.set(part, o);
      o += part.length;
    }
    if (o < size) throw new Error(`FAT chain from cluster ${first} is shorter than ${size} bytes`);
    return out;
  };

  const files: DiskFile[] = [];
  const walk = (dir: Uint8Array, prefix: string) => {
    for (let e = 0; e + 32 <= dir.length; e += 32) {
      const first = dir[e];
      if (first === 0) break;
      const attr = dir[e + 11];
      if (first === 0xe5 || first === 0x2e || attr & 0x08) continue; // deleted, . and .., volume label
      const raw = dir.slice(e, e + 11);
      if (raw[0] === 0x05) raw[0] = 0xe5;
      const base = sjis.decode(raw.subarray(0, 8)).trimEnd();
      const ext = sjis.decode(raw.subarray(8, 11)).trimEnd();
      const name = (ext ? `${base}.${ext}` : base).toUpperCase();
      const cluster = dir[e + 26] | (dir[e + 27] << 8);
      const size = dir[e + 28] | (dir[e + 29] << 8) | (dir[e + 30] << 16) | (dir[e + 31] << 24);
      if (attr & 0x10) {
        let bytes = 0;
        for (let c = cluster; c >= 2 && c < 0xff0; c = nextCluster(c)) bytes += clusterSize;
        walk(chain(cluster, bytes), `${prefix}${name}/`);
      } else {
        files.push({ path: prefix + name, size, read: () => chain(cluster, size) });
      }
    }
  };
  walk(sectors.subarray(rootStart, dataStart), '');
  return files;
}
