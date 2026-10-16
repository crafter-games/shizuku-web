import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { AUTO_SLOT, QUICK_SLOT, SLOTS, deleteItem, listSaves, saveSettings, setItem, type SaveGame, type Settings } from '../storage.ts';
import type { BacklogEntry } from '../player.ts';

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div class="panel" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <header>
        <h2>{title}</h2>
        <button class="close" onClick={onClose} aria-label="Cerrar">×</button>
      </header>
      <div class="panel-body">{children}</div>
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });

/** Save or load slots. `current` is what a save would store (absent when only loading). */
export function SaveLoad({ mode, current, onLoad, onClose }: {
  mode: 'save' | 'load';
  current?: () => SaveGame | undefined;
  onLoad: (s: SaveGame) => void;
  onClose: () => void;
}) {
  const [saves, setSaves] = useState<Map<string, SaveGame>>(new Map());
  const refresh = () => listSaves().then(setSaves);
  useEffect(() => void refresh(), []);

  const slots = [...(mode === 'load' ? [AUTO_SLOT, QUICK_SLOT] : []), ...Array.from({ length: SLOTS }, (_, i) => String(i + 1))];
  const label = (k: string) => (k === AUTO_SLOT ? 'Autoguardado' : k === QUICK_SLOT ? 'Guardado rápido' : `Ranura ${k}`);

  const choose = async (key: string) => {
    const existing = saves.get(key);
    if (mode === 'load') {
      if (existing) onLoad(existing);
      return;
    }
    const save = current?.();
    if (!save) return;
    if (existing && !confirm(`¿Sobrescribir ${label(key).toLowerCase()}?`)) return;
    await setItem('saves', key, save);
    await refresh();
  };

  return (
    <Panel title={mode === 'save' ? 'Guardar' : 'Cargar'} onClose={onClose}>
      <ol class="slots">
        {slots.map((key) => {
          const s = saves.get(key);
          if (mode === 'load' && !s) return null;
          return (
            <li key={key}>
              <button class="slot" onClick={() => choose(key)}>
                {s ? <img src={s.thumb} alt="" /> : <div class="empty-thumb" />}
                <span class="slot-text">
                  <strong>{label(key)}</strong>
                  {s ? <small>{dateFmt.format(s.date)}</small> : <small>Vacía</small>}
                  {s && <span class="excerpt">{s.excerpt}</span>}
                </span>
              </button>
              {s && key !== AUTO_SLOT && (
                <button class="delete" aria-label="Borrar" onClick={async () => {
                  if (confirm(`¿Borrar ${label(key).toLowerCase()}?`)) {
                    await deleteItem('saves', key);
                    await refresh();
                  }
                }}>🗑</button>
              )}
            </li>
          );
        })}
      </ol>
      {mode === 'load' && saves.size === 0 && <p>No hay partidas guardadas.</p>}
      <SaveFiles onImported={refresh} />
    </Panel>
  );
}

/** Export all saves to a file, or import them on another device. */
function SaveFiles({ onImported }: { onImported: () => void }) {
  const exportAll = async () => {
    const saves = Object.fromEntries(await listSaves());
    const blob = new Blob([JSON.stringify({ shizuku: 1, saves })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shizuku-partidas.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importAll = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      for (const [k, v] of Object.entries(data.saves ?? {})) await setItem('saves', k, v);
      onImported();
    } catch {
      alert('Ese archivo no contiene partidas de Shizuku.');
    }
  };
  return (
    <div class="save-files">
      <button onClick={exportAll}>Exportar partidas</button>
      <label class="button">
        Importar partidas
        <input type="file" accept=".json" hidden onChange={(e) => e.currentTarget.files?.[0] && importAll(e.currentTarget.files[0])} />
      </label>
    </div>
  );
}

export function Backlog({ entries, onClose }: { entries: BacklogEntry[]; onClose: () => void }) {
  return (
    <Panel title="Historial" onClose={onClose}>
      <div class="backlog" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
        {entries.map((e, i) => <p key={i}>{e.text}</p>)}
      </div>
    </Panel>
  );
}

export function SettingsPanel({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    onChange(next);
    void saveSettings(next);
  };
  return (
    <Panel title="Opciones" onClose={onClose}>
      <form class="settings" onSubmit={(e) => e.preventDefault()}>
        <label>
          Velocidad del texto
          <input type="range" min={0} max={80} step={5} value={80 - settings.textSpeed}
            onInput={(e) => update({ textSpeed: 80 - Number(e.currentTarget.value) })} />
        </label>
        <label>
          Pausa en modo automático
          <input type="range" min={500} max={4000} step={250} value={settings.autoDelay}
            onInput={(e) => update({ autoDelay: Number(e.currentTarget.value) })} />
        </label>
        <label>
          Música
          <input type="range" min={0} max={1} step={0.05} value={settings.musicVolume}
            onInput={(e) => update({ musicVolume: Number(e.currentTarget.value) })} />
        </label>
        <label>
          Efectos de sonido
          <input type="range" min={0} max={1} step={0.05} value={settings.soundVolume}
            onInput={(e) => update({ soundVolume: Number(e.currentTarget.value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.skipUnread} onChange={(e) => update({ skipUnread: e.currentTarget.checked })} />
          Saltar también el texto no leído
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.aspect43} onChange={(e) => update({ aspect43: e.currentTarget.checked })} />
          Proporción 4:3 del monitor PC-98
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.smooth} onChange={(e) => update({ smooth: e.currentTarget.checked })} />
          Suavizar los píxeles
        </label>
      </form>
      <p class="credits">
        Shizuku © 1996 Leaf. Motor y traducción: proyecto de fans, sin relación con Leaf/AQUAPLUS.{' '}
        <a href="LICENSES.txt" target="_blank">Licencias de terceros</a>
      </p>
    </Panel>
  );
}
