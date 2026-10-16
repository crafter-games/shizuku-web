import { useEffect, useRef, useState } from 'preact/hooks';
import { Interpreter, type GameFiles, type SavePoint } from '@shizuku/engine';
import { Stage } from '../stage.ts';
import { layered } from '../game-files.ts';
import { listSaves, type Progress, type SaveGame, type Settings } from '../storage.ts';
import { SaveLoad, SettingsPanel } from './Panels.tsx';
import { Gallery } from './Gallery.tsx';

export function Title({ game, progress, settings, onSettings, onStart }: {
  game: GameFiles;
  progress: Progress;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onStart: (p: SavePoint) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [panel, setPanel] = useState<'load' | 'settings' | 'gallery' | null>(null);
  const [latest, setLatest] = useState<SaveGame>();

  useEffect(() => {
    const stage = new Stage(canvas.current!);
    void stage.transition(layered(game, ['TITLE0.LFG', 'TITLE.LFG']), 'palette');
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
