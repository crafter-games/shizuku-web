// Types for the Emscripten module built by native/build.sh.
export interface PmdModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  UTF8ToString(ptr: number): string;
  _pmdw_init(rate: number): void;
  _pmdw_input(): number;
  _pmdw_rom(): number;
  _pmdw_output(): number;
  _pmdw_max_frames(): number;
  _pmdw_rhythm_mode(mode: number): void;
  _pmdw_mute(mask: number): void;
  _pmdw_load(len: number): number;
  _pmdw_stop(): void;
  _pmdw_render(frames: number): void;
  _pmdw_playing(): number;
  _pmdw_loop_count(): number;
  _pmdw_position(): number;
  _pmdw_first_pass(): number;
  _pmdw_loop_length(): number;
  _pmdw_rhythm_mask(): number;
  _pmdw_rhythm_count(): number;
  _pmdw_memo(index: number): number;
}

export interface PmdModuleOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string, prefix: string) => string;
}

export default function createPmdModule(options?: PmdModuleOptions): Promise<PmdModule>;
