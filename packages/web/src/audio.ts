// Music and sound effects. Music is the game's PMD data (MUS/SZ_FMnn.FM)
// played by the WASM PMD driver in @shizuku/pmd.
import { decodeVd, parseVdPlay, unpack, type GameFiles, type MusicCommand, type SoundCommand } from '@shizuku/engine';
import { PmdPlayer } from '@shizuku/pmd/player';
import workletUrl from '@shizuku/pmd/pmd-worklet.js?url';

const FADE_MS = 1500;

export class Audio {
  private player: Promise<PmdPlayer> | undefined;
  private ctx: AudioContext | undefined;
  /** The song playing (or that should be, before audio is unlocked). */
  current: number | null = null;
  /** Passes before the current song stops (undefined: it loops). */
  private loops: number | undefined;
  private next: number | null = null;
  private fadeDone: Promise<void> = Promise.resolve();
  private musicVolume = 0.8;
  soundVolume = 0.8;
  private readonly files: GameFiles;

  constructor(files: GameFiles) {
    this.files = files;
    // Browsers only start audio after a click or key press.
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void this.start();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // A click earlier on this page (e.g. importing the disks) already allows it.
    if (navigator.userActivation?.hasBeenActive) unlock();
  }

  private start(): Promise<PmdPlayer> {
    this.player ??= (async () => {
      this.ctx = new AudioContext();
      const p = await PmdPlayer.create(this.ctx, { workletUrl });
      p.pmd.volume = this.musicVolume;
      if (this.current !== null) p.play(this.song(this.current), { loops: this.loops });
      return p;
    })();
    return this.player;
  }

  setVolume(music: number, sound: number) {
    this.musicVolume = music;
    this.soundVolume = sound;
    if (this.effectGain) this.effectGain.gain.value = sound;
    void this.player?.then((p) => (p.pmd.volume = music));
  }

  private song(no: number): Uint8Array {
    return unpack(this.files.read(`MUS/SZ_FM${String(no).padStart(2, '0')}.FM`));
  }

  /** Plays a song unless it is already playing. `loops` fades it out after that many passes. */
  play(no: number, loops?: number) {
    if (this.current === no && !this.fading) return;
    this.current = no;
    this.loops = loops;
    this.fading = false;
    void this.player?.then((p) => p.play(this.song(no), { loops }));
  }

  private fading = false;

  music(cmd: MusicCommand): void | Promise<void> {
    switch (cmd.t) {
      case 'play':
        this.play(cmd.no);
        break;
      case 'next':
        // The next song starts once the fade in progress ends.
        this.next = cmd.no;
        if (!this.fading) this.play(cmd.no);
        else void this.fadeDone.then(() => this.next === cmd.no && this.play(cmd.no));
        break;
      case 'fade':
        this.fading = true;
        void this.player?.then((p) => p.fadeOut(FADE_MS));
        this.fadeDone = new Promise((r) => setTimeout(r, FADE_MS));
        break;
      case 'wait-fade':
        return this.fadeDone;
      case 'stop':
        this.stopAll();
        break;
    }
  }

  private loaded: AudioBuffer | undefined;
  private loadedNo: number | null = null;
  private effect: { source: AudioBufferSourceNode; done: Promise<void>; endless: boolean } | undefined;
  private effectGain: GainNode | undefined;

  /** PCM effects (SZ_VDnn.VD): Plnn loads, Paabb plays aa times (00 = loop) with a gap, Pw waits, Ps stops. */
  sound(cmd: SoundCommand): void | Promise<void> {
    const ctx = this.ctx;
    switch (cmd.t) {
      case 'load': {
        this.loadedNo = cmd.no;
        this.loaded = undefined;
        if (!ctx) return;
        const vd = decodeVd(this.files.read(`SZ_VD${String(cmd.no).padStart(2, '0')}.VD`));
        const buffer = ctx.createBuffer(1, vd.samples.length, vd.sampleRate);
        buffer.copyToChannel(vd.samples as Float32Array<ArrayBuffer>, 0);
        this.loaded = buffer;
        return;
      }
      case 'play': {
        if (!ctx || !this.loaded) return;
        if (!/^\d{4}$/.test(cmd.arg)) return; // Pc/Pd: in the EXE, unused by the scripts
        this.stopEffect();
        const { loops, gapSamples } = parseVdPlay(`P${cmd.arg}`);
        // One pass is the sample plus its gap; loops repeat that pass.
        const pass = ctx.createBuffer(1, this.loaded.length + gapSamples, this.loaded.sampleRate);
        pass.copyToChannel(this.loaded.getChannelData(0), 0);
        const source = ctx.createBufferSource();
        source.buffer = pass;
        this.effectGain ??= ctx.createGain();
        this.effectGain.gain.value = this.soundVolume;
        this.effectGain.connect(ctx.destination);
        source.connect(this.effectGain);
        source.loop = loops !== 1;
        if (loops > 1) source.stop(ctx.currentTime + (pass.duration * loops) - gapSamples / pass.sampleRate);
        const done = new Promise<void>((r) => (source.onended = () => r()));
        source.start();
        this.effect = { source, done, endless: loops === 0 };
        return;
      }
      case 'wait':
        // Looping effects never end on their own: don't wait for them.
        return this.effect && !this.effect.endless ? this.effect.done : undefined;
      case 'stop':
        this.stopEffect();
        return;
      case 'fade':
        return;
    }
  }

  private stopEffect() {
    try {
      this.effect?.source.stop();
    } catch {
      // already stopped
    }
    this.effect = undefined;
  }

  stopAll() {
    this.current = null;
    this.next = null;
    this.fading = false;
    this.stopEffect();
    void this.player?.then((p) => p.stop());
  }
}
