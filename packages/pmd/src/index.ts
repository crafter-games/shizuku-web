// PMD music player: compiled PMD `.M` data in, interleaved stereo float32 out.
//
// The driver and the YM2608 (OPNA) emulator are 98fmplayer's (BSD-2-Clause,
// Takamichi Horikawa), built to WebAssembly by native/build.sh. Works the same
// in Node and in browsers; src/player.ts adds Web Audio playback.
import createPmdModule, { type PmdModule } from '../wasm/pmd.js';

export interface PmdOptions {
  /** Output sample rate in Hz (the chip runs at 55467 Hz and is resampled). */
  sampleRate: number;
  /** The contents of pmd.wasm, if the default fetch/read next to pmd.js does not suit. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Initial rhythm samples; see Pmd.setRhythm(). Default 'synth'. */
  rhythm?: RhythmSource;
}

/**
 * Where the OPNA rhythm section (BD, SD, TOP, HH, TOM, RIM) gets its samples.
 * The real ones are in a Yamaha ROM inside the chip, which we do not ship:
 * 'synth' uses drum sounds synthesized from scratch, 'off' leaves the rhythm
 * silent, and a Uint8Array is a ROM dump the player supplies (8 KiB, MAME's
 * ym2608_adpcm_rom.bin).
 */
export type RhythmSource = 'synth' | 'off' | Uint8Array;

/** Diagnostics on the OPNA rhythm section (whose samples live in a ROM we do not ship). */
export interface RhythmUse {
  /** Voices keyed on since load: bit 0 BD, 1 SD, 2 TOP, 3 HH, 4 TOM, 5 RIM. */
  mask: number;
  /** Number of rhythm key-on writes since load. */
  keyOns: number;
}

export interface Pmd {
  readonly sampleRate: number;
  /** Starts a song from compiled PMD data (`.M`). Throws if the data is not PMD. */
  load(m: Uint8Array): void;
  /**
   * Renders the next `frames` frames as interleaved stereo (L, R, L, R…) in
   * [-1, 1]. Silence once stopped. Pass `out` to reuse a buffer.
   */
  render(frames: number, out?: Float32Array): Float32Array;
  /** Stops at once; render() then returns silence. */
  stop(): void;
  /** Fades out over `ms` milliseconds of rendered audio, then stops. */
  fadeOut(ms: number): void;
  /** Output gain, 0..1 (default 1). */
  volume: number;
  /** True while a song is loaded and has not ended, been stopped or faded out. */
  readonly playing: boolean;
  /** True while fadeOut() is in progress. */
  readonly fading: boolean;
  /** Completed passes through the song's loop: 0 during the first pass. */
  readonly loopCount: number;
  /** True when a song without a loop has played to its end. */
  readonly ended: boolean;
  /** Seconds of the current song rendered so far. */
  readonly position: number;
  /** Length of the first pass (intro + body), in seconds; null if it could not be measured. */
  readonly firstPassSeconds: number | null;
  /** Length of one loop, in seconds; null for songs that do not loop. */
  readonly loopSeconds: number | null;
  /** OPNA rhythm usage since load. */
  readonly rhythm: RhythmUse;
  /**
   * Mutes chip channels, for debugging and comparisons: a bit mask of
   * Channel values (0 unmutes everything).
   */
  mute(channels: number): void;
  /** Chooses the rhythm samples (see RhythmSource); applies from the next load(). */
  setRhythm(source: RhythmSource): void;
  /** A memo string of the song (CP932 bytes): 1 title, 2 composer, 3 arranger, … */
  memo(index: number): Uint8Array | null;
}

/** Chip channels, as bits for Pmd.mute(). */
export const Channel = {
  FM: 0x003f,
  SSG: 0x01c0,
  RHYTHM: 0x7e00,
  ADPCM: 0x8000,
  fm: (n: 1 | 2 | 3 | 4 | 5 | 6) => 1 << (n - 1),
  ssg: (n: 1 | 2 | 3) => 1 << (n + 5),
} as const;

const RHYTHM_ROM_SIZE = 0x2000;

/**
 * 98fmplayer mixes with a lot of headroom: the loudest Shizuku song peaks at
 * 0.36. +6 dB brings the opening theme level with an NP2 recording of it
 * (-37 dBFS) and keeps every song's peak under 0.75.
 */
const OUTPUT_GAIN = 2;

export async function createPmd(options: PmdOptions): Promise<Pmd> {
  const { sampleRate } = options;
  if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw new RangeError(`sampleRate ${sampleRate}`);
  const mod: PmdModule = await createPmdModule(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {});
  mod._pmdw_init(sampleRate);
  const maxFrames = mod._pmdw_max_frames();
  const outPtr = mod._pmdw_output() >> 2;

  let stopped = true;
  let fadeTotal = 0;
  let fadeLeft = 0;

  const stop = () => {
    mod._pmdw_stop();
    stopped = true;
    fadeTotal = fadeLeft = 0;
  };

  const pmd: Pmd = {
    sampleRate,
    volume: 1,

    load(m) {
      if (m.length < 2 || m.length > 0x10000) throw new Error(`PMD data of ${m.length} bytes`);
      mod.HEAPU8.set(m, mod._pmdw_input());
      fadeTotal = fadeLeft = 0;
      stopped = !mod._pmdw_load(m.length);
      if (stopped) throw new Error('not PMD data');
    },

    render(frames, out = new Float32Array(frames * 2)) {
      if (out.length < frames * 2) throw new RangeError('output buffer too small');
      if (stopped) {
        out.fill(0, 0, frames * 2);
        return out;
      }
      for (let done = 0; done < frames; ) {
        const n = Math.min(maxFrames, frames - done);
        mod._pmdw_render(n);
        const src = mod.HEAPF32.subarray(outPtr, outPtr + n * 2);
        const base = done * 2;
        if (fadeTotal) {
          for (let i = 0; i < n; i++) {
            const t = Math.max(0, fadeLeft - i) / fadeTotal;
            const g = OUTPUT_GAIN * pmd.volume * t * t;
            out[base + i * 2] = src[i * 2] * g;
            out[base + i * 2 + 1] = src[i * 2 + 1] * g;
          }
          fadeLeft -= n;
          if (fadeLeft <= 0) {
            stop();
            out.fill(0, base + n * 2, frames * 2);
            return out;
          }
        } else {
          const g = OUTPUT_GAIN * pmd.volume;
          for (let i = 0; i < n * 2; i++) out[base + i] = src[i] * g;
        }
        done += n;
      }
      return out;
    },

    stop,

    fadeOut(ms) {
      if (stopped) return;
      const frames = Math.max(1, Math.round((ms / 1000) * sampleRate));
      // A second call can only shorten a fade in progress.
      if (fadeTotal && frames >= fadeLeft) return;
      fadeTotal = fadeLeft = frames;
    },

    get playing() {
      return !stopped && mod._pmdw_playing() === 1;
    },
    get fading() {
      return !stopped && fadeTotal > 0;
    },
    get loopCount() {
      const n = mod._pmdw_loop_count();
      return n === 0xff ? 0 : n;
    },
    get ended() {
      return mod._pmdw_loop_count() === 0xff;
    },
    get position() {
      return mod._pmdw_position();
    },
    get firstPassSeconds() {
      const s = mod._pmdw_first_pass();
      return s < 0 ? null : s;
    },
    get loopSeconds() {
      const s = mod._pmdw_loop_length();
      return s < 0 ? null : s;
    },
    get rhythm() {
      return { mask: mod._pmdw_rhythm_mask(), keyOns: mod._pmdw_rhythm_count() };
    },

    mute(channels) {
      mod._pmdw_mute(channels);
    },

    setRhythm(source) {
      if (source instanceof Uint8Array) {
        if (source.length !== RHYTHM_ROM_SIZE) throw new Error(`rhythm ROM must be ${RHYTHM_ROM_SIZE} bytes`);
        mod.HEAPU8.set(source, mod._pmdw_rom());
        mod._pmdw_rhythm_mode(1);
      } else {
        mod._pmdw_rhythm_mode(source === 'off' ? 0 : 2);
      }
    },

    memo(index) {
      const p = mod._pmdw_memo(index);
      if (!p) return null;
      let end = p;
      while (mod.HEAPU8[end]) end++;
      return mod.HEAPU8.slice(p, end);
    },
  };
  pmd.setRhythm(options.rhythm ?? 'synth');
  return pmd;
}
