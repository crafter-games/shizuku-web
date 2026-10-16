import { useEffect, useState } from 'preact/hooks';
import type { DiskId } from '@shizuku/engine';
import { importDisk, storedDisks } from '../game-files.ts';

const ALL: DiskId[] = ['A', 'B', 'C', 'D', 'E'];

/** Asks for the player's own five disk images; they stay in this browser. */
export function Importer({ onReady }: { onReady: () => void }) {
  const [have, setHave] = useState<DiskId[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  useEffect(() => void storedDisks().then(setHave), []);

  const add = async (files: FileList | File[]) => {
    const errs: string[] = [];
    for (const f of Array.from(files)) {
      try {
        await importDisk(new Uint8Array(await f.arrayBuffer()));
      } catch {
        errs.push(`${f.name}: no es un disco de Shizuku`);
      }
    }
    setErrors(errs);
    const now = await storedDisks();
    setHave(now);
    if (now.length === 5) onReady();
  };

  return (
    <main
      class={`importer ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer) void add(e.dataTransfer.files);
      }}
    >
      <h1>雫</h1>
      <p class="lead">Shizuku (Leaf, 1996), en español.</p>
      <p>
        Para jugar necesitas tus propias imágenes de los cinco disquetes de la versión PC-98
        (<code>.hdm</code>, <code>.fdi</code> o <code>.d88</code>). Se guardan solo en este navegador: no se suben a ningún sitio.
      </p>
      <ul class="disks">
        {ALL.map((id) => (
          <li class={have.includes(id) ? 'ok' : ''} key={id}>
            Disco {id} {have.includes(id) ? '✓' : ''}
          </li>
        ))}
      </ul>
      <label class="button">
        Elegir archivos…
        <input type="file" multiple accept=".hdm,.fdi,.d88" onChange={(e) => e.currentTarget.files && add(e.currentTarget.files)} hidden />
      </label>
      <p class="hint">También puedes arrastrarlos aquí.</p>
      {errors.map((e) => (
        <p class="error" key={e}>{e}</p>
      ))}
    </main>
  );
}
