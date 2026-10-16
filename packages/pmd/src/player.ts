// Browser playback: renders on the main thread a little ahead of the audio
// clock and streams the PCM to an AudioWorklet ring buffer (src/pmd-worklet.js).
import { createPmd, type Pmd, type PmdOptions } from './index.ts';

export interface PmdPlayerOptions extends Omit<PmdOptions, 'sampleRate'> {
  /** URL of pmd-worklet.js. Default: next to this module (bundlers such as Vite resolve it). */
  workletUrl?: string | URL;
  /** Seconds of audio to keep queued in the worklet (default 0.15). */
  lead?: number;
}

export interface PlayOptions {
  /** Fade out after this many passes through the song's loop (default: play forever). */
  loops?: number;
  /** Fade length in ms when `loops` is reached (default 3000). */
  fadeMs?: number;
}

const PUMP_MS = 20;

export class PmdPlayer {
  readonly ctx: AudioContext;
  readonly node: AudioWorkletNode;
  readonly pmd: Pmd;
  /** Called once when a song stops by itself (it ended, or faded out). */
  onEnd?: () => void;

  private readonly lead: number;
  private queued = 0; // frames in the worklet at the last report
  private reportedAt = 0; // ctx.currentTime of that report
  private inFlight = 0; // frames posted since that report
  private timer?: ReturnType<typeof setInterval>;
  private loops = Infinity;
  private fadeMs = 3000;
  private wasPlaying = false;

  private constructor(ctx: AudioContext, node: AudioWorkletNode, pmd: Pmd, lead: number) {
    this.ctx = ctx;
    this.node = node;
    this.pmd = pmd;
    this.lead = lead;
    node.port.onmessage = (e: MessageEvent<number>) => {
      this.queued = e.data;
      this.reportedAt = ctx.currentTime;
      this.inFlight = 0;
    };
  }

  /** Sets up the worklet on `ctx` and connects it to the destination. */
  static async create(ctx: AudioContext, options: PmdPlayerOptions = {}): Promise<PmdPlayer> {
    await ctx.audioWorklet.addModule(options.workletUrl ?? new URL('./pmd-worklet.js', import.meta.url));
    const node = new AudioWorkletNode(ctx, 'pmd-output', { numberOfInputs: 0, outputChannelCount: [2] });
    node.connect(ctx.destination);
    const pmd = await createPmd({ ...options, sampleRate: ctx.sampleRate });
    return new PmdPlayer(ctx, node, pmd, options.lead ?? 0.15);
  }

  /** Starts a song (compiled PMD data), replacing whatever is playing. */
  play(m: Uint8Array, options: PlayOptions = {}): void {
    this.clear();
    this.pmd.load(m);
    this.loops = options.loops ?? Infinity;
    this.fadeMs = options.fadeMs ?? 3000;
    this.wasPlaying = true;
    this.pump();
    this.timer ??= setInterval(() => this.pump(), PUMP_MS);
  }

  /** Stops at once. */
  stop(): void {
    this.pmd.stop();
    this.clear();
    this.idle();
  }

  /** Fades the current song out over `ms`, then stops. */
  fadeOut(ms: number): void {
    this.pmd.fadeOut(ms);
  }

  get playing(): boolean {
    return this.pmd.playing;
  }

  /** Stops and disconnects the worklet. */
  dispose(): void {
    this.stop();
    this.node.disconnect();
  }

  private clear(): void {
    this.node.port.postMessage('clear');
    this.queued = this.inFlight = 0;
    this.reportedAt = this.ctx.currentTime;
  }

  private idle(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.wasPlaying = false;
  }

  private pump(): void {
    const rate = this.ctx.sampleRate;
    if (this.pmd.loopCount >= this.loops && !this.pmd.fading) this.pmd.fadeOut(this.fadeMs);
    const played = Math.max(0, (this.ctx.currentTime - this.reportedAt) * rate);
    const queued = Math.max(0, this.queued - played) + this.inFlight;
    const want = Math.floor(this.lead * rate - queued);
    if (want > 0 && this.pmd.playing) {
      const pcm = this.pmd.render(want);
      this.inFlight += want;
      this.node.port.postMessage(pcm, [pcm.buffer]);
    }
    if (this.wasPlaying && !this.pmd.playing) {
      this.idle();
      this.onEnd?.();
    }
  }
}
