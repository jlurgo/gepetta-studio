import { useEffect, useRef, useState } from "react";
import { type VideoInfo, loadVideo, sampleTimes } from "../media/video";
import { importVideoChannel, importVideoStills } from "../state/actions";
import { useBusy } from "../state/busy";
import { useEditor } from "../state/editor";
import { Dialog } from "./Dialog";

/** "frames": the video's pictures become frames. "channel": a channel to rotoscope over. */
export function VideoImportDialog({ file, mode = "frames", onClose }: { file: File; mode?: "frames" | "channel"; onClose(): void }) {
  const filmFps = useEditor((s) => s.film!.settings.fps);
  const loaded = useRef<Awaited<ReturnType<typeof loadVideo>> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [fps, setFps] = useState(filmFps);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let disposed = false;
    loadVideo(file).then(
      (v) => {
        if (disposed) return v.dispose();
        loaded.current = v;
        v.video.controls = true;
        previewRef.current?.appendChild(v.video);
        setInfo(v.info);
        setTo(Number(v.info.duration.toFixed(2)));
      },
      (e) => {
        useBusy.getState().notify(e.message, "error");
        closeRef.current();
      },
    );
    return () => {
      disposed = true;
      loaded.current?.dispose();
      loaded.current?.video.remove();
    };
  }, [file]);

  const times = info ? sampleTimes(from, Math.min(to, info.duration), fps) : [];

  async function run() {
    const v = loaded.current;
    if (!v) return;
    // Take ownership so closing the dialog does not dispose the video mid-import.
    loaded.current = null;
    v.video.pause();
    v.video.remove();
    onClose();
    try {
      if (mode === "channel") await importVideoChannel(v.video, times, file.name, fps);
      else await importVideoStills(v.video, times, file.name);
    } finally {
      v.dispose();
    }
  }

  const markFromPlayhead = (set: (n: number) => void) => () => {
    const t = loaded.current?.video.currentTime;
    if (t !== undefined) set(Number(t.toFixed(2)));
  };

  return (
    <Dialog title={`${mode === "channel" ? "Video como canal" : "Importar video"}: ${file.name}`} onClose={onClose}>
      <div className="video-preview" ref={previewRef} />
      {info && (
        <>
          <div className="row">
            <label className="control">
              <span>Desde (s)</span>
              <input type="number" min={0} max={to} step={0.1} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
            </label>
            <button className="btn small" onClick={markFromPlayhead(setFrom)}>
              Marcar inicio aquí
            </button>
            <label className="control">
              <span>Hasta (s)</span>
              <input type="number" min={from} max={info.duration} step={0.1} value={to} onChange={(e) => setTo(Number(e.target.value))} />
            </label>
            <button className="btn small" onClick={markFromPlayhead(setTo)}>
              Marcar fin aquí
            </button>
          </div>
          <label className="control">
            <span>Cuadros por segundo a extraer</span>
            <input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Number(e.target.value)))} />
          </label>
          <p className="hint">
            {mode === "channel" ? (
              <>
                Se va a crear un canal de <strong>{times.length}</strong> imágenes que empieza en el cuadro seleccionado
                y avanza con la película.
              </>
            ) : (
              <>
                Se van a insertar <strong>{times.length}</strong> cuadros después del cuadro seleccionado.
              </>
            )}
          </p>
        </>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn primary" disabled={times.length === 0} onClick={run}>
          Importar
        </button>
      </div>
    </Dialog>
  );
}
