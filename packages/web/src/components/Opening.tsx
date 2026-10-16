import { useEffect, useRef } from 'preact/hooks';
import { OPENING_END, OPENING_MUSIC, loadOpening, renderOpening, type GameFiles } from '@shizuku/engine';
import { Stage } from '../stage.ts';
import type { Audio } from '../audio.ts';
import type { Settings } from '../storage.ts';

/**
 * The PC-98 opening, vsync by vsync, with its music (SZ_FM00, then SZ_FM15).
 * A click, tap or key skips it; `onDone(true)` then, `onDone(false)` when it
 * reaches the title on its own.
 */
export function Opening({ game, audio, settings, onDone }: {
  game: GameFiles;
  audio: Audio;
  settings: Settings;
  onDone: (skipped: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const skip = useRef<() => void>(() => undefined);

  useEffect(() => {
    const stage = new Stage(canvas.current!);
    const assets = loadOpening(game);
    audio.stopAll();
    let cue = 0;
    const anim = stage.play((t, s) => {
      while (cue < OPENING_MUSIC.length && t >= OPENING_MUSIC[cue].vsync) audio.play(OPENING_MUSIC[cue++].song, 1);
      renderOpening(assets, t, s);
      return t <= OPENING_END;
    });
    let skipped = false;
    let mounted = true;
    skip.current = () => {
      skipped = true;
      anim.stop();
    };
    void anim.done.then(() => mounted && onDone(skipped));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        skip.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      mounted = false;
      window.removeEventListener('keydown', key);
      anim.stop();
    };
  }, [game]);

  return (
    <main class={`screen ${settings.smooth ? 'smooth' : ''} ${settings.aspect43 ? 'aspect43' : ''}`} onClick={() => skip.current()}>
      <div class="stage opening" aria-label="Introducción (pulsa para saltar)">
        <canvas ref={canvas} />
      </div>
    </main>
  );
}
