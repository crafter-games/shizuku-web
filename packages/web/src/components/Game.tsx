import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameFiles, SavePoint } from '@shizuku/engine';
import { Stage } from '../stage.ts';
import { Audio } from '../audio.ts';
import { Player, type UiState } from '../player.ts';
import { AUTO_SLOT, QUICK_SLOT, getItem, saveProgress, setItem, type Progress, type SaveGame, type Settings } from '../storage.ts';
import { Backlog, SaveLoad, SettingsPanel } from './Panels.tsx';

type PanelName = 'save' | 'load' | 'backlog' | 'settings' | null;

export function Game({ game, start, settings, progress, onSettings, onExit }: {
  game: GameFiles;
  start: SavePoint;
  settings: Settings;
  progress: Progress;
  onSettings: (s: Settings) => void;
  onExit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const player = useRef<Player>();
  const [ui, setUi] = useState<UiState>();
  const [panel, setPanel] = useState<PanelName>(null);
  const [hidden, setHidden] = useState(false);
  const [toast, setToast] = useState<string>();
  const [run, setRun] = useState({ point: start, n: 0 });

  const snapshot = (): SaveGame | undefined => {
    const p = player.current;
    if (!p?.lastPoint) return;
    const excerpt = p.state.page.at(-1) ?? p.backlog.at(-1)?.text ?? '';
    return { point: p.lastPoint, date: Date.now(), excerpt: excerpt.slice(0, 90), thumb: p.stage.thumbnail() };
  };

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(undefined), 1500);
  };

  useEffect(() => {
    const stage = new Stage(canvas.current!);
    const p = new Player(game, stage, new Audio(), () => stageEl.current!, settings, progress);
    p.onChoice = (point) => void setItem('saves', AUTO_SLOT, { ...snapshot()!, point, date: Date.now() });
    p.onEnd = () => {
      progress.persistentFlags = [...p.interp.flags];
      void saveProgress(progress);
    };
    player.current = p;
    const off = p.subscribe(() => setUi(p.state));
    setUi(p.state);
    void p.start(run.point);
    const persist = setInterval(() => void saveProgress(progress), 10_000);
    return () => {
      off();
      p.stop();
      clearInterval(persist);
      void saveProgress(progress);
    };
  }, [run]);

  useEffect(() => {
    if (player.current) player.current.settings = settings;
  }, [settings]);

  const load = (s: SaveGame) => {
    setPanel(null);
    setRun({ point: s.point, n: run.n + 1 });
  };

  const quickSave = async () => {
    const s = snapshot();
    if (s) {
      await setItem('saves', QUICK_SLOT, s);
      notify('Guardado rápido');
    }
  };
  const quickLoad = async () => {
    const s = await getItem<SaveGame>('saves', QUICK_SLOT);
    if (s) load(s);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (panel) return;
      const p = player.current!;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (hidden) setHidden(false);
        else if (!p.state.choice) p.advance();
      } else if (e.key === 'Control' && p.state.mode !== 'skip') p.setMode('skip');
      else if (e.key === 'a' || e.key === 'A') p.setMode('auto');
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') setPanel('backlog');
      else if (e.key === 'F5') (e.preventDefault(), void quickSave());
      else if (e.key === 'F9') (e.preventDefault(), void quickLoad());
      else if (e.key === 'Escape') setHidden((h) => !h);
      else if (p.state.choice && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < p.state.choice.options.length) p.pick(i);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control' && player.current?.state.mode === 'skip') player.current.setMode('skip');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [panel, hidden]);

  const p = player.current;
  const onStageClick = () => {
    if (hidden) return setHidden(false);
    if (ui?.choice) return;
    p?.advance();
  };

  return (
    <main class={`screen ${settings.smooth ? 'smooth' : ''} ${settings.aspect43 ? 'aspect43' : ''}`}>
      <div
        class={`stage ${hidden ? 'hide-ui' : ''}`}
        ref={stageEl}
        onClick={onStageClick}
        onContextMenu={(e) => (e.preventDefault(), setHidden((h) => !h))}
        onWheel={(e) => e.deltaY < 0 && setPanel('backlog')}
      >
        <canvas ref={canvas} />
        {ui?.textVisible && !hidden && (
          <div class="text-layer" aria-live="polite">
            {ui.page.map((para, i) => (
              <p key={i}>
                {i === ui.page.length - 1 ? (
                  <>
                    {para.slice(0, ui.typed)}
                    <span class="pending">{para.slice(ui.typed)}</span>
                  </>
                ) : para}
                {i === ui.page.length - 1 && ui.waiting && <span class="cursor">▼</span>}
              </p>
            ))}
          </div>
        )}
        {ui?.choice && !hidden && (
          <div class="choices">
            {ui.choice.options.map((o, i) => (
              <button key={i} onClick={(e) => (e.stopPropagation(), p?.pick(i))}>{o.replace(/^[0-9１-９][、.．]\s*/, '')}</button>
            ))}
          </div>
        )}
        {toast && <div class="toast">{toast}</div>}
      </div>
      <nav class={`game-menu ${hidden ? 'hide-ui' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setPanel('save')}>Guardar</button>
        <button onClick={() => setPanel('load')}>Cargar</button>
        <button onClick={() => setPanel('backlog')}>Historial</button>
        <button class={ui?.mode === 'auto' ? 'on' : ''} onClick={() => p?.setMode('auto')}>Auto</button>
        <button class={ui?.mode === 'skip' ? 'on' : ''} onClick={() => p?.setMode('skip')}>Saltar</button>
        <button onClick={() => setPanel('settings')}>Opciones</button>
        <button onClick={() => confirm('¿Volver al título? Lo no guardado se perderá.') && onExit()}>Título</button>
      </nav>
      {ui?.ended && (
        <div class="ended" onClick={onExit}>
          <p>Fin</p>
          <button>Volver al título</button>
        </div>
      )}
      {panel === 'save' && <SaveLoad mode="save" current={snapshot} onLoad={load} onClose={() => setPanel(null)} />}
      {panel === 'load' && <SaveLoad mode="load" onLoad={load} onClose={() => setPanel(null)} />}
      {panel === 'backlog' && p && <Backlog entries={p.backlog} onClose={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel settings={settings} onChange={onSettings} onClose={() => setPanel(null)} />}
    </main>
  );
}
