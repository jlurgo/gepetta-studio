import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { type VideoInfo, loadVideo, sampleTimes } from "../media/video";
import { importVideoStills } from "../state/actions";
import { type GridCursor, useEditor } from "../state/editor";
import { useVideoImport } from "../state/library";
import { Dialog } from "./Dialog";

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "—");

/** How long a stretch lasts, to read: "8 s", "1 min 20 s", "1 h 05 min". */
export function lengthText(s: number): string {
  if (s < 10) return `${Number(s.toFixed(1)).toLocaleString("es-AR")} s`;
  const t = Math.round(s);
  if (t < 60) return `${t} s`;
  if (t < 3600) return t % 60 ? `${Math.floor(t / 60)} min ${t % 60} s` : `${t / 60} min`;
  return `${Math.floor(t / 3600)} h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")} min`;
}

/** How near (px) a handle has to be touched to grab it. */
const GRAB = 10;

type Drag = { kind: "from" | "to" | "move"; x0: number; from0: number; moved: boolean } | { kind: "seek" };

/**
 * A bar for the whole video with the stretch chosen on it, over the
 * playhead. The handles change where it starts or ends (the preview shows
 * that frame); dragging the stretch moves it without changing how long it is;
 * a click (on it or anywhere) shows that frame. Times are rounded to `step`.
 */
export function RangeBar({
  duration,
  from,
  to,
  current,
  step = 0.01,
  onChange,
  onSeek,
}: {
  duration: number;
  from: number;
  to: number;
  current: number;
  step?: number;
  onChange(from: number, to: number): void;
  onSeek(t: number): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  const round = (t: number) => Number((Math.round(t / step) * step).toFixed(2));
  const width = () => ref.current!.getBoundingClientRect().width || 1;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const length = to - from;

  /** What a touch at `clientX` grabs: the nearest handle when close, else the stretch, or the bar. */
  function grabAt(clientX: number): "from" | "to" | "move" | "seek" {
    const t = timeAt(clientX);
    const px = (t2: number) => Math.abs(((t - t2) / duration) * width());
    if (Math.min(px(from), px(to)) <= GRAB) return px(from) < px(to) || (px(from) === px(to) && t < from) ? "from" : "to";
    return t > from && t < to ? "move" : "seek";
  }

  function onDown(e: ReactPointerEvent) {
    const t = timeAt(e.clientX);
    const what = grabAt(e.clientX);
    if (what !== "seek") drag.current = { kind: what, x0: e.clientX, from0: from, moved: false };
    else {
      drag.current = { kind: "seek" };
      onSeek(t);
    }
    ref.current!.setPointerCapture(e.pointerId);
  }

  function onMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) {
      const what = grabAt(e.clientX);
      ref.current!.style.cursor = what === "move" ? "grab" : what === "seek" ? "pointer" : "ew-resize";
      return;
    }
    const t = timeAt(e.clientX);
    if (d.kind !== "seek") {
      // A few pixels of wobble is still a click.
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
    }
    if (d.kind === "from") {
      const f = Math.min(round(t), to);
      onChange(f, to);
      onSeek(f);
    } else if (d.kind === "to") {
      const end = Math.max(round(t), from);
      onChange(from, end);
      onSeek(end);
    } else if (d.kind === "move") {
      ref.current!.style.cursor = "grabbing";
      const f = Math.max(0, Math.min(duration - length, round(d.from0 + ((e.clientX - d.x0) / width()) * duration)));
      onChange(f, Number((f + length).toFixed(2)));
      onSeek(f);
    } else onSeek(t);
  }

  function onUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    // A click on the stretch or a handle (without moving it) shows that frame.
    if (d && d.kind !== "seek" && !d.moved) onSeek(timeAt(e.clientX));
  }

  return (
    <div className="range-bar" ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)}>
      <div className="range-sel" style={{ left: pct(from), width: pct(length) }} title="Arrastralo para moverlo sin cambiar cuánto dura">
        <span className="range-len">{lengthText(length)}</span>
      </div>
      <div className="range-play" style={{ left: pct(current) }} />
      <div className="range-handle start" style={{ left: pct(from) }} title="Inicio" />
      <div className="range-handle end" style={{ left: pct(to) }} title="Fin" />
    </div>
  );
}

/**
 * Previewing a video (of the library) and importing a stretch of it as
 * frames, or as a track to trace over: watch it, pick the start and end on the
 * bar (or type the seconds), choose how many frames a second. They go from
 * `at` (the cursor when not given).
 */
export function VideoImportDialog({ file, mode = "frames", at, onClose }: { file: File; mode?: "frames" | "track"; at?: GridCursor; onClose(): void }) {
  const name = file.name;
  const filmFps = useEditor((s) => s.film!.settings.fps);
  const loaded = useRef<Awaited<ReturnType<typeof loadVideo>> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [current, setCurrent] = useState(0);
  const [fps, setFps] = useState(filmFps);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    loadVideo(file).then(
      (v) => {
        if (disposed) return v.dispose();
        loaded.current = v;
        v.video.controls = true;
        v.video.ontimeupdate = () => setCurrent(v.video.currentTime);
        previewRef.current?.appendChild(v.video);
        setInfo(v.info);
        if (Number.isFinite(v.info.duration)) setTo(Number(v.info.duration.toFixed(2)));
        else setError("Este video no tiene una duración conocida: no se puede importar un tramo.");
      },
      (e) => setError((e as Error).message),
    );
    return () => {
      disposed = true;
      loaded.current?.dispose();
      loaded.current?.video.remove();
    };
  }, [file]);

  const ok = !!info && Number.isFinite(info.duration);
  const times = ok ? sampleTimes(from, Math.min(to, info!.duration), fps) : [];
  const seek = (t: number) => loaded.current && (loaded.current.video.currentTime = t);

  async function run() {
    const v = loaded.current;
    if (!times.length || !v) return;
    // Take ownership so closing the dialog does not dispose the video mid-import.
    loaded.current = null;
    v.video.pause();
    v.video.remove();
    onClose();
    try {
      await importVideoStills(v.video, times, name.replace(/\.[^.]+$/, ""), fps, mode === "track", at);
    } finally {
      v.dispose();
    }
  }

  const title = `${mode === "track" ? "Video como track" : "Importar video"}: ${name.replace(/\.[^.]+$/, "")}`;
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="video-preview" ref={previewRef} />
      {error && <p className="panel-error">{error}</p>}
      {ok && (
        <>
          <RangeBar duration={info!.duration} from={from} to={Math.min(to, info!.duration)} current={current} onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
            onSeek={seek}
          />
          <div className="range-times">
            <span>
              Tramo: <strong>{mmss(from)}</strong> → <strong>{mmss(Math.min(to, info!.duration))}</strong> (dura {lengthText(Math.max(0, Math.min(to, info!.duration) - from))})
            </span>
          </div>
          <div className="row">
            <label className="control">
              <span>Desde (s)</span>
              <input type="number" min={0} max={to} step={0.1} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
            </label>
            <button className="btn small" onClick={() => info && seek(from)} title="Ver el inicio">
              ↦ Ver inicio
            </button>
            <button className="btn small" onClick={() => loaded.current && setFrom(Number(loaded.current.video.currentTime.toFixed(2)))}>
              Marcar inicio aquí
            </button>
          </div>
          <div className="row">
            <label className="control">
              <span>Hasta (s)</span>
              <input type="number" min={from} max={info!.duration} step={0.1} value={to} onChange={(e) => setTo(Number(e.target.value))} />
            </label>
            <button className="btn small" onClick={() => info && seek(Math.min(to, info.duration))} title="Ver el fin">
              ↤ Ver fin
            </button>
            <button className="btn small" onClick={() => loaded.current && setTo(Number(loaded.current.video.currentTime.toFixed(2)))}>
              Marcar fin aquí
            </button>
          </div>
          <label className="control">
            <span>Cuadros por segundo a extraer</span>
            <input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Number(e.target.value)))} />
          </label>
          <p className="hint">
            {mode === "track" ? (
              <>
                Se va a crear un track nuevo con <strong>{times.length}</strong> imágenes desde la celda elegida, semitransparente y solo de referencia (no sale en la exportación).
              </>
            ) : (
              <>
                Se van a poner <strong>{times.length}</strong> imágenes desde la celda elegida, en el track elegido (reemplazan lo que haya ahí).
              </>
            )}
          </p>
        </>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn primary" disabled={times.length === 0} onClick={() => void run()}>
          Importar
        </button>
      </div>
    </Dialog>
  );
}

/** The dialog for the library video being put in the film, if any (see openVideo). */
export function LibraryVideoDialog() {
  const open = useVideoImport((s) => s.open);
  if (!open) return null;
  return <VideoImportDialog file={open.file} mode={open.mode} at={open.at} onClose={() => useVideoImport.setState({ open: null })} />;
}
