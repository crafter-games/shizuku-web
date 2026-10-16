import { useEffect, useRef, useState } from 'preact/hooks';
import { composeScene, frameToRgba, lfgLoader, type GameFiles, HEIGHT, WIDTH } from '@shizuku/engine';
import type { Progress } from '../storage.ts';
import { Panel } from './Panels.tsx';

/** Event pictures seen so far (回想モード). */
export function Gallery({ game, progress, onClose }: { game: GameFiles; progress: Progress; onClose: () => void }) {
  const [open, setOpen] = useState<string>();
  const seen = [...progress.seen].sort();
  return (
    <Panel title="Galería" onClose={onClose}>
      {seen.length === 0 && <p>Las escenas que veas en el juego aparecerán aquí.</p>}
      <div class="gallery">
        {seen.map((key) => (
          <button key={key} onClick={() => setOpen(key)}><Picture game={game} id={key} small /></button>
        ))}
      </div>
      {open && (
        <div class="lightbox" onClick={() => setOpen(undefined)}>
          <Picture game={game} id={open} />
        </div>
      )}
    </Panel>
  );
}

function Picture({ game, id, small }: { game: GameFiles; id: string; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const [kind, no] = id.split(':');
    const frame = composeScene({ bg: { kind: kind as 'vis', no: Number(no) }, chars: { l: null, c: null, r: null } }, lfgLoader(game));
    const c = ref.current!;
    c.width = WIDTH;
    c.height = HEIGHT;
    c.getContext('2d')!.putImageData(new ImageData(frameToRgba(frame), WIDTH, HEIGHT), 0, 0);
  }, [id]);
  return <canvas ref={ref} class={small ? 'thumb' : ''} />;
}
