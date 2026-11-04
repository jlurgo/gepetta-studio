import { useEffect, useRef, useState } from "react";
import { type VideoInfo, loadVideo, sampleTimes } from "../media/video";
import { importVideoStills } from "../state/actions";
import { useBusy } from "../state/busy";
import { useEditor } from "../state/editor";
import { Dialog } from "./Dialog";

/** A video to import: a file chosen from disk, a link to download, or a YouTube video. */
export type VideoSource = { kind: "file"; file: File } | { kind: "web"; url: string; name: string } | { kind: "youtube"; id: string; name: string };

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "—");
const mb = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;

/** A bar for the whole video with two handles: the start and end of what gets imported, over the playhead. */
function RangeBar({ duration, from, to, current, onFrom, onTo, onSeek }: { duration: number; from: number; to: number; current: number; onFrom(t: number): void; onTo(t: number): void; onSeek(t: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<"from" | "to" | null>(null);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, Number((((clientX - r.left) / r.width) * duration).toFixed(2))));
  };
  const move = (which: "from" | "to", t: number) => {
    if (which === "from") onFrom(Math.min(t, to));
    else onTo(Math.max(t, from));
    onSeek(t);
  };
  return (
    <div
      className="range-bar"
      ref={ref}
      onPointerDown={(e) => {
        const t = timeAt(e.clientX);
        drag.current = Math.abs(t - from) <= Math.abs(t - to) ? "from" : "to";
        ref.current!.setPointerCapture(e.pointerId);
        move(drag.current, t);
      }}
      onPointerMove={(e) => drag.current && move(drag.current, timeAt(e.clientX))}
      onPointerUp={() => (drag.current = null)}
    >
      <div className="range-sel" style={{ left: pct(from), width: pct(to - from) }} />
      <div className="range-play" style={{ left: pct(current) }} />
      <div className="range-handle start" style={{ left: pct(from) }} title="Inicio" />
      <div className="range-handle end" style={{ left: pct(to) }} title="Fin" />
    </div>
  );
}

/**
 * Previewing a video and importing a stretch of it as frames (or as a track
 * to trace over): watch it, pick the start and end on the bar (or type the
 * seconds), choose how many frames a second. From a link it streams for the
 * preview and downloads only when you import, showing how far it got.
 */
export function VideoImportDialog({ source, mode = "frames", onClose }: { source: VideoSource; mode?: "frames" | "track"; onClose(): void }) {
  const name = source.kind === "file" ? source.file.name : source.name;
  const web = source.kind === "web" ? source.url : null;
  // A YouTube video can't be streamed on screen: it's downloaded first, then shown.
  const youtubeId = source.kind === "youtube" ? source.id : null;
  const filmFps = useEditor((s) => s.film!.settings.fps);
  const loaded = useRef<Awaited<ReturnType<typeof loadVideo>> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [current, setCurrent] = useState(0);
  const [fps, setFps] = useState(filmFps);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<{ received: number; total: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let disposed = false;
    const show = (v: Awaited<ReturnType<typeof loadVideo>>) => {
      if (disposed) return v.dispose();
      loaded.current = v;
      v.video.controls = true;
      v.video.ontimeupdate = () => setCurrent(v.video.currentTime);
      previewRef.current?.appendChild(v.video);
      setInfo(v.info);
      if (Number.isFinite(v.info.duration)) setTo(Number(v.info.duration.toFixed(2)));
      else setError("Este video no tiene una duración conocida (¿es una transmisión en vivo?): no se puede importar un tramo.");
    };
    const fail = (e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    if (youtubeId) {
      // YouTube streams can't play on screen: download the whole file first, then preview it.
      const native = window.gepetta;
      if (!native?.youtube?.download) setError("Esto anda en la app de escritorio.");
      else {
        setDownloading({ received: 0, total: 0 });
        native.youtube
          .download(youtubeId)
          .then((got) => loadVideo(new File([got.data], name, { type: got.mime })))
          .then(
            (v) => {
              if (disposed) return v.dispose();
              setDownloading(null);
              show(v);
            },
            (e) => {
              if (disposed) return;
              setDownloading(null);
              fail(e);
            },
          );
      }
    } else {
      loadVideo(web ?? (source as { file: File }).file).then(show, (e) => setError((e as Error).message));
    }
    return () => {
      disposed = true;
      loaded.current?.dispose();
      loaded.current?.video.remove();
    };
  }, [web, youtubeId, name, source]);

  useEffect(() => {
    const native = window.gepetta;
    const onProgress = (received: number, total: number) => setDownloading({ received, total });
    if (web) return native?.video.onProgress(onProgress);
    if (youtubeId) return native?.youtube?.onProgress?.(onProgress);
  }, [web, youtubeId]);

  const ok = !!info && Number.isFinite(info.duration);
  const times = ok ? sampleTimes(from, Math.min(to, info!.duration), fps) : [];
  const seek = (t: number) => loaded.current && (loaded.current.video.currentTime = t);

  async function run() {
    if (!times.length) return;
    try {
      if (web) {
        // Only now the whole file is downloaded, and its stills taken from it (a link can't be read on screen).
        const native = window.gepetta;
        if (!native?.video) throw new Error("Esto anda en la app de escritorio.");
        setDownloading({ received: 0, total: 0 });
        const got = await native.video.download(web);
        const extract = await loadVideo(new File([got.data], name, { type: got.mime }));
        onClose();
        try {
          await importVideoStills(extract.video, times, name, fps, mode === "track");
        } finally {
          extract.dispose();
        }
        return;
      }
      const v = loaded.current;
      if (!v) return;
      // Take ownership so closing the dialog does not dispose the video mid-import.
      loaded.current = null;
      v.video.pause();
      v.video.remove();
      onClose();
      try {
        await importVideoStills(v.video, times, name, fps, mode === "track");
      } finally {
        v.dispose();
      }
    } catch (e) {
      setDownloading(null);
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  }

  const title = `${mode === "track" ? "Video como track" : "Importar video"}: ${name}`;
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="video-preview" ref={previewRef} />
      {error && <p className="panel-error">{error}</p>}
      {ok && (
        <>
          <RangeBar duration={info!.duration} from={from} to={Math.min(to, info!.duration)} current={current} onFrom={(t) => setFrom(Number(t.toFixed(2)))} onTo={(t) => setTo(Number(t.toFixed(2)))} onSeek={seek} />
          <div className="range-times">
            <span>
              Tramo: <strong>{mmss(from)}</strong> → <strong>{mmss(Math.min(to, info!.duration))}</strong> (dura {mmss(Math.max(0, to - from))})
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
            {web && " El video se baja entero recién al importar, y se usa solo este tramo."}
          </p>
        </>
      )}
      {downloading && (
        <div className="web-progress">
          <span>Bajando el video… {mb(downloading.received)}{downloading.total ? ` de ${mb(downloading.total)}` : ""}</span>
          {downloading.total > 0 && <progress value={downloading.received} max={downloading.total} />}
        </div>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn primary" disabled={times.length === 0 || !!downloading} onClick={run}>
          {web ? "Bajar e importar el tramo" : "Importar"}
        </button>
      </div>
    </Dialog>
  );
}
