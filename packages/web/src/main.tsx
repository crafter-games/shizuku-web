import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { GameFiles, SavePoint } from '@shizuku/engine';
import { openGame } from './game-files.ts';
import { Audio } from './audio.ts';
import { Importer } from './components/Importer.tsx';
import { Title } from './components/Title.tsx';
import { Game } from './components/Game.tsx';
import { Opening } from './components/Opening.tsx';
import { getItem, loadProgress, loadSettings, setItem, type Progress, type Settings } from './storage.ts';
import './style.css';

type Screen =
  | { t: 'loading' } | { t: 'import' } | { t: 'opening' } | { t: 'title'; instant?: boolean } | { t: 'game'; start: SavePoint };

/** The opening plays by itself only the first time; the title menu replays it. */
const OPENING_SEEN = 'opening-seen';

function App() {
  const [screen, setScreen] = useState<Screen>({ t: 'loading' });
  const [game, setGame] = useState<GameFiles>();
  const [audio, setAudio] = useState<Audio>();
  const [settings, setSettings] = useState<Settings>();
  const [progress, setProgress] = useState<Progress>();

  const boot = async () => {
    setSettings(await loadSettings());
    setProgress(await loadProgress());
    const g = await openGame();
    setGame(g);
    if (g) setAudio((a) => a ?? new Audio(g));
    if (!g) return setScreen({ t: 'import' });
    setScreen((await getItem<boolean>('meta', OPENING_SEEN)) ? { t: 'title' } : { t: 'opening' });
  };
  useEffect(() => void boot(), []);

  if (screen.t === 'loading' || !settings || !progress) return <div class="loading">雫</div>;
  if (screen.t === 'import' || !game || !audio) return <Importer onReady={boot} />;
  if (screen.t === 'opening') {
    const done = (skipped: boolean) => {
      void setItem('meta', OPENING_SEEN, true);
      setScreen({ t: 'title', instant: !skipped });
    };
    return <Opening game={game} audio={audio} settings={settings} onDone={done} />;
  }
  if (screen.t === 'title') {
    return (
      <Title
        game={game}
        audio={audio}
        progress={progress}
        settings={settings}
        instant={screen.instant}
        onSettings={setSettings}
        onStart={(start) => setScreen({ t: 'game', start })}
        onOpening={() => setScreen({ t: 'opening' })}
      />
    );
  }
  return (
    <Game
      game={game}
      audio={audio}
      start={screen.start}
      settings={settings}
      progress={progress}
      onSettings={setSettings}
      onExit={() => setScreen({ t: 'title' })}
    />
  );
}

render(<App />, document.getElementById('app')!);
