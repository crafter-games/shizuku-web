import { useEffect, useRef, useState } from 'preact/hooks';
import { Interpreter, titleFrame, type GameFiles, type SavePoint } from '@shizuku/engine';
import { Stage } from '../stage.ts';
import type { Audio } from '../audio.ts';
import { listSaves, type Progress, type SaveGame, type Settings } from '../storage.ts';
import { SaveLoad, SettingsPanel } from './Panels.tsx';
import { Gallery } from './Gallery.tsx';

/** SZ_FM15 plays over the PC-98's opening and title screen. */
const TITLE_MUSIC = 15;

export function Title({ game, audio, progress, settings, instant, onSettings, onStart, onOpening }: {
  game: GameFiles;
  audio: Audio;
  progress: Progress;
  settings: Settings;
  /** Coming from the end of the opening, which already shows the title. */
  instant?: boolean;
  onSettings: (s: Settings) => void;
  onStart: (p: SavePoint) => void;
  onOpening: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [panel, setPanel] = useState<'load' | 'settings' | 'gallery' | null>(null);
  const [latest, setLatest] = useState<SaveGame>();

  useEffect(() => {
    const stage = new Stage(canvas.current!);
    void stage.transition(titleFrame(game), instant ? 'cut' : 'fade');
    audio.play(TITLE_MUSIC, 1); // the opening theme, once, as on the PC-98
    void listSaves().then((saves) => {
      const newest = [...saves.values()].sort((a, b) => b.date - a.date)[0];
      setLatest(newest);
    });
  }, [game]);

  const items: [string, () => void, boolean?][] = [
    ['Nueva partida', () => onStart(Interpreter.newGame(progress.persistentFlags))],
    ['Continuar', () => latest && onStart(latest.point), !latest],
    ['Cargar partida', () => setPanel('load'), !latest],
    ['Galería', () => setPanel('gallery')],
    ['Ver la introducción', onOpening],
    ['Opciones', () => setPanel('settings')],
  ];

  return (
    <main class={`screen ${settings.smooth ? 'smooth' : ''} ${settings.aspect43 ? 'aspect43' : ''}`}>
      <div class="stage">
        <canvas ref={canvas} />
        <nav class="title-menu">
          {items.map(([label, go, disabled]) => (
            <button key={label} onClick={go} disabled={disabled}>{label}</button>
          ))}
        </nav>
      </div>
      {panel === 'load' && <SaveLoad mode="load" onLoad={(s) => onStart(s.point)} onClose={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel settings={settings} onChange={onSettings} onClose={() => setPanel(null)} />}
      {panel === 'gallery' && <Gallery game={game} progress={progress} onClose={() => setPanel(null)} />}
    </main>
  );
}
