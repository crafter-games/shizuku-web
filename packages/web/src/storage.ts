// Everything the player keeps lives in this browser's IndexedDB: their disk
// images (never uploaded), saves, settings and which lines they have read.
import type { DiskId, SavePoint } from '@shizuku/engine';

const DB = 'shizuku';
const STORES = ['disks', 'saves', 'meta'] as const;
type Store = (typeof STORES)[number];

let opened: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await db()).transaction(store, mode);
  const req = fn(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const getItem = <T>(store: Store, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key));
export const setItem = (store: Store, key: string, value: unknown) => run(store, 'readwrite', (s) => s.put(value, key));
export const deleteItem = (store: Store, key: string) => run(store, 'readwrite', (s) => s.delete(key));
export const allKeys = (store: Store) => run(store, 'readonly', (s) => s.getAllKeys()) as Promise<string[]>;

export async function loadDisks(): Promise<Map<DiskId, Uint8Array>> {
  const disks = new Map<DiskId, Uint8Array>();
  for (const key of await allKeys('disks')) {
    const bytes = await getItem<Uint8Array>('disks', key);
    if (bytes) disks.set(key as DiskId, bytes);
  }
  return disks;
}

export interface SaveGame {
  point: SavePoint;
  date: number;
  /** The line on screen when saved. */
  excerpt: string;
  /** A small JPEG of the screen, as a data URL. */
  thumb: string;
}

export const SLOTS = 60;
export const QUICK_SLOT = 'quick';
export const AUTO_SLOT = 'auto';

export async function listSaves(): Promise<Map<string, SaveGame>> {
  const saves = new Map<string, SaveGame>();
  for (const key of await allKeys('saves')) {
    const s = await getItem<SaveGame>('saves', key);
    if (s) saves.set(key, s);
  }
  return saves;
}

export interface Settings {
  /** Milliseconds per character; 0 shows text at once. */
  textSpeed: number;
  /** Auto mode: pause after a line, in ms. */
  autoDelay: number;
  /** Skip also lines not read yet. */
  skipUnread: boolean;
  musicVolume: number;
  soundVolume: number;
  /** Show 640x400 at the PC-98 monitor's 4:3 (pixels 1.2x taller). */
  aspect43: boolean;
  /** Smooth scaling instead of sharp pixels. */
  smooth: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  textSpeed: 25, autoDelay: 1500, skipUnread: false, musicVolume: 0.8, soundVolume: 0.8, aspect43: true, smooth: false,
};

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getItem<Partial<Settings>>('meta', 'settings')) };
}

export const saveSettings = (s: Settings) => setItem('meta', 'settings', s);

/** Global progress, across saves: lines read, persistent flags (endings), pictures seen. */
export interface Progress {
  read: string[];
  persistentFlags: number[];
  seen: string[];
}

export async function loadProgress(): Promise<Progress> {
  return (await getItem<Progress>('meta', 'progress')) ?? { read: [], persistentFlags: [], seen: [] };
}

export const saveProgress = (p: Progress) => setItem('meta', 'progress', p);
