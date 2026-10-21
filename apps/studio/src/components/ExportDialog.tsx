import { durationSeconds } from "@gepetta/core";
import { useEffect, useMemo, useState } from "react";
import { type VideoExportOptions, type VideoFormat, type VideoQuality, canExport, exportVideo } from "../export/video";
import { saveBlob } from "../storage";
import { runTask, useBusy } from "../state/busy";
import { useEditor } from "../state/editor";
import { Dialog } from "./Dialog";

const HEIGHTS = [
  { id: "film", label: "Original de la película" },
  { id: "2160", label: "4K (2160 p)" },
  { id: "1080", label: "Full HD (1080 p)" },
  { id: "720", label: "HD (720 p)" },
  { id: "480", label: "Liviano (480 p)" },
];

export function ExportDialog({ onClose }: { onClose(): void }) {
  const film = useEditor((s) => s.film)!;
  const filmId = useEditor((s) => s.filmId)!;
  const [format, setFormat] = useState<VideoFormat>("mp4");
  const [heightId, setHeightId] = useState("film");
  const [quality, setQuality] = useState<VideoQuality>("high");
  const [supported, setSupported] = useState<boolean | null>(null);

  const opts: VideoExportOptions = useMemo(() => {
    const { width, height } = film.settings;
    const h = heightId === "film" ? height : Number(heightId);
    return { format, quality, height: h, width: Math.round((width / height) * h) };
  }, [film.settings, heightId, format, quality]);

  useEffect(() => {
    setSupported(null);
    canExport(opts).then(setSupported, () => setSupported(false));
  }, [opts]);

  async function run() {
    onClose();
    const blob = await runTask("Exportando video", film.frameOrder.length, (progress) => exportVideo(filmId, film, opts, progress));
    if (!blob) return;
    const saved = await saveBlob(blob, `${film.settings.name}.${format}`);
    if (saved) useBusy.getState().notify(`Video guardado: ${saved}`);
  }

  return (
    <Dialog title="Exportar video" onClose={onClose}>
      <label className="control">
        <span>Formato</span>
        <select value={format} onChange={(e) => setFormat(e.target.value as VideoFormat)}>
          <option value="mp4">MP4 (H.264) — compatible con todo</option>
          <option value="webm">WebM (VP9) — para la web</option>
        </select>
      </label>
      <label className="control">
        <span>Tamaño</span>
        <select value={heightId} onChange={(e) => setHeightId(e.target.value)}>
          {HEIGHTS.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>Calidad</span>
        <select value={quality} onChange={(e) => setQuality(e.target.value as VideoQuality)}>
          <option value="medium">Normal (archivo chico)</option>
          <option value="high">Alta</option>
          <option value="max">Máxima</option>
        </select>
      </label>
      <p className="hint">
        {opts.width}×{opts.height} · {film.settings.fps} cuadros/s · {durationSeconds(film).toFixed(1)} s ·{" "}
        {film.frameOrder.length} cuadros
      </p>
      {supported === false && <p className="panel-error">Este equipo no puede codificar ese formato a ese tamaño. Probá otro.</p>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn primary" disabled={!supported || film.frameOrder.length === 0} onClick={run}>
          Exportar
        </button>
      </div>
    </Dialog>
  );
}
