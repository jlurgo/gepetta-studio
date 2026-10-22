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
  /** "result": every visible exported track combined; "each": one file per track; else a track id. */
  const [what, setWhat] = useState<string>("result");

  const opts: VideoExportOptions = useMemo(() => {
    const { width, height } = film.settings;
    const h = heightId === "film" ? height : Number(heightId);
    return { format, quality, height: h, width: Math.round((width / height) * h) };
  }, [film.settings, heightId, format, quality]);

  useEffect(() => {
    setSupported(null);
    canExport(opts).then(setSupported, () => setSupported(false));
  }, [opts]);

  async function exportOne(name: string, label: string, tracks?: string[]) {
    const blob = await runTask(label, film.length, (progress) => exportVideo(filmId, film, { ...opts, tracks }, progress));
    if (!blob) return false;
    const saved = await saveBlob(blob, `${name}.${format}`);
    if (saved) useBusy.getState().notify(`Video guardado: ${saved}`);
    return Boolean(saved);
  }

  async function run() {
    onClose();
    const title = film.settings.name;
    if (what === "result") await exportOne(title, "Exportando video");
    else if (what === "each") {
      // One file per track, top to bottom; stops if a save is cancelled.
      for (const t of [...film.tracks].reverse()) {
        if (!(await exportOne(`${title} - ${t.name}`, `Exportando "${t.name}"`, [t.id]))) break;
      }
    } else {
      const t = film.tracks.find((x) => x.id === what);
      if (t) await exportOne(`${title} - ${t.name}`, `Exportando "${t.name}"`, [t.id]);
    }
  }

  return (
    <Dialog title="Exportar video" onClose={onClose}>
      <label className="control">
        <span>Qué exportar</span>
        <select value={what} onChange={(e) => setWhat(e.target.value)}>
          <option value="result">El resultado (todos los tracks que salen en la exportación)</option>
          <option value="each">Cada track por separado (un archivo por track)</option>
          {[...film.tracks].reverse().map((t) => (
            <option key={t.id} value={t.id}>
              Solo el track "{t.name}"
            </option>
          ))}
        </select>
      </label>
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
        {film.length} celdas
      </p>
      {supported === false && <p className="panel-error">Este equipo no puede codificar ese formato a ese tamaño. Probá otro.</p>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn primary" disabled={!supported || film.length === 0} onClick={run}>
          Exportar
        </button>
      </div>
    </Dialog>
  );
}
