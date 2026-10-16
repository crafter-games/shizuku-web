import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { GameFiles, SavePoint } from '@shizuku/engine';
import { openGame } from './game-files.ts';
import { Importer } from './components/Importer.tsx';
import { Title } from './components/Title.tsx';
import { Game } from './components/Game.tsx';
import { loadProgress, loadSettings, type Progress, type Settings } from './storage.ts';
import './style.css';

type Screen = { t: 'loading' } | { t: 'import' } | { t: 'title' } | { t: 'game'; start: SavePoint };

function App() {
  const [screen, setScreen] = useState<Screen>({ t: 'loading' });
  const [game, setGame] = useState<GameFiles>();
  const [settings, setSettings] = useState<Settings>();
  const [progress, setProgress] = useState<Progress>();

  const boot = async () => {
    setSettings(await loadSettings());
    setProgress(await loadProgress());
    const g = await openGame();
    setGame(g);
    setScreen(g ? { t: 'title' } : { t: 'import' });
  };
  useEffect(() => void boot(), []);

  if (screen.t === 'loading' || !settings || !progress) return <div class="loading">雫</div>;
  if (screen.t === 'import' || !game) return <Importer onReady={boot} />;
  if (screen.t === 'title') {
    return (
      <Title
        game={game}
        progress={progress}
        settings={settings}
        onSettings={setSettings}
        onStart={(start) => setScreen({ t: 'game', start })}
      />
    );
  }
  return (
    <Game
      game={game}
      start={screen.start}
      settings={settings}
      progress={progress}
      onSettings={setSettings}
      onExit={() => setScreen({ t: 'title' })}
    />
  );
}

render(<App />, document.getElementById('app')!);
