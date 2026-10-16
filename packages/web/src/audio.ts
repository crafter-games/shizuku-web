// Music and sound effects. Music: PMD data (MUS/SZ_FMnn.FM) played by the
// WASM PMD driver; until it lands this only tracks what should be playing.
import type { MusicCommand, SoundCommand } from '@shizuku/engine';

export class Audio {
  current: number | null = null;
  private next: number | null = null;
  musicVolume = 0.8;
  soundVolume = 0.8;

  music(cmd: MusicCommand): void | Promise<void> {
    switch (cmd.t) {
      case 'play':
        this.current = cmd.no;
        break;
      case 'next':
        this.next = cmd.no;
        break;
      case 'fade':
        break;
      case 'wait-fade':
        this.current = this.next;
        this.next = null;
        break;
      case 'stop':
        this.current = null;
        break;
    }
  }

  sound(_cmd: SoundCommand): void | Promise<void> {}

  stopAll() {
    this.current = null;
    this.next = null;
  }
}
