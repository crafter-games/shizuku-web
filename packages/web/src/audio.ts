// Music and sound effects. Music is the game's PMD data (MUS/SZ_FMnn.FM)
// played by the WASM PMD driver in @shizuku/pmd.
import { unpack, type GameFiles, type MusicCommand, type SoundCommand } from '@shizuku/engine';
import { PmdPlayer } from '@shizuku/pmd/player';
import workletUrl from '@shizuku/pmd/pmd-worklet.js?url';

const FADE_MS = 1500;

export class Audio {
  private player: Promise<PmdPlayer> | undefined;
  private ctx: AudioContext | undefined;
  /** The song playing (or that should be, before audio is unlocked). */
  current: number | null = null;
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
  }

  private start(): Promise<PmdPlayer> {
    this.player ??= (async () => {
      this.ctx = new AudioContext();
      const p = await PmdPlayer.create(this.ctx, { workletUrl });
      p.pmd.volume = this.musicVolume;
      if (this.current !== null) p.play(this.song(this.current));
      return p;
    })();
    return this.player;
  }

  setVolume(music: number, sound: number) {
    this.musicVolume = music;
    this.soundVolume = sound;
    void this.player?.then((p) => (p.pmd.volume = music));
  }

  private song(no: number): Uint8Array {
    return unpack(this.files.read(`MUS/SZ_FM${String(no).padStart(2, '0')}.FM`));
  }

  /** Plays a song unless it is already playing. `loops` fades it out after that many passes. */
  play(no: number, loops?: number) {
    if (this.current === no && !this.fading) return;
    this.current = no;
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

  sound(_cmd: SoundCommand): void | Promise<void> {
    // .VD sound effects: waiting on the format.
  }

  stopAll() {
    this.current = null;
    this.next = null;
    this.fading = false;
    void this.player?.then((p) => p.stop());
  }
}
