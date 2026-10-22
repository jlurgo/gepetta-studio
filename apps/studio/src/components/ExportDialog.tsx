import { type FilmState, durationSeconds, newId } from "@gepetta/core";
import { useEffect, useMemo, useState } from "react";
import { type VideoExportOptions, type VideoFormat, type VideoQuality, canExport, exportVideo } from "../export/video";
import { saveBlob } from "../storage";
import { runTask, useBusy } from "../state/busy";
import { useEditor } from "../state/editor";
import { type Release, nextVersions, snapshotFilm } from "../state/releases";
import { Dialog } from "./Dialog";

const HEIGHTS = [
  { id: "film", label: "Original de la película" },
  { id: "2160", label: "4K (2160 p)" },
  { id: "1080", label: "Full HD (1080 p)" },
  { id: "720", label: "HD (720 p)" },
  { id: "480", label: "Liviano (480 p)" },
];

/** Name of a saved file from its path (desktop) or name (browser). */
function baseName(saved: string): string {
  return saved.split(/[\\/]/).pop() ?? saved;
}

/**
 * Exports the film (or, with `past`, a published version as it was). The
 * current film's export can be published as a new version.
 */
export function ExportDialog({ onClose, past }: { onClose(): void; past?: { film: FilmState; release: Release } }) {
  const current = useEditor((s) => s.film)!;
  const film = past?.film ?? current;
  const filmId = useEditor((s) => s.filmId)!;
  const releases = useEditor((s) => s.releases);
  const [format, setFormat] = useState<VideoFormat>(past?.release.export.format ?? "mp4");
  const [heightId, setHeightId] = useState(() => {
    const h = past?.release.export.height;
    return h === undefined || h === film.settings.height ? "film" : String(h);
  });
  const [quality, setQuality] = useState<VideoQuality>(past?.release.export.quality ?? "high");
  const [supported, setSupported] = useState<boolean | null>(null);
  /** "result": every visible exported track combined; "each": one file per track; else a track id. */
  const [what, setWhat] = useState<string>(past?.release.export.tracks?.[0] ?? "result");

  // Publishing (current film only).
  const next = nextVersions(releases);
  const [publish, setPublish] = useState(false);
  const [bump, setBump] = useState<"major" | "minor" | "custom">(releases.length ? "minor" : "major");
  const [custom, setCustom] = useState(next.major);
  const [title, setTitle] = useState(film.settings.name);
  const [notes, setNotes] = useState("");
  const version = bump === "major" ? next.major : bump === "minor" ? next.minor : custom.trim();
  const canPublish = !past && what !== "each";

  const opts: VideoExportOptions = useMemo(() => {
    const { width, height } = film.settings;
    const h = heightId === "film" ? height : Number(heightId);
    return { format, quality, height: h, width: Math.round((width / height) * h) };
  }, [film.settings, heightId, format, quality]);

  useEffect(() => {
    setSupported(null);
    canExport(opts).then(setSupported, () => setSupported(false));
  }, [opts]);

  /** Exports and saves one file; returns what was saved, or null if cancelled. */
  async function exportOne(name: string, label: string, tracks?: string[]) {
    const blob = await runTask(label, film.length, (progress) => exportVideo(filmId, film, { ...opts, tracks }, progress));
    if (!blob) return null;
    const saved = await saveBlob(blob, `${name}.${format}`);
    if (saved) useBusy.getState().notify(`Video guardado: ${saved}`);
    return saved ? { saved, size: blob.size } : null;
  }

  async function run() {
    onClose();
    const name = film.settings.name;
    if (what === "each") {
      // One file per track, top to bottom; stops if a save is cancelled.
      for (const t of [...film.tracks].reverse()) {
        if (!(await exportOne(`${name} - ${t.name}`, `Exportando "${t.name}"`, [t.id]))) break;
      }
      return;
    }
    const track = film.tracks.find((x) => x.id === what);
    const tracks = track ? [track.id] : undefined;
    const fileName = [name, track?.name, past ? `v${past.release.version}` : publish ? `v${version}` : null].filter(Boolean).join(" - ");

    if (!publish || !canPublish) {
      await exportOne(fileName, past ? `Exportando la versión ${past.release.version}` : "Exportando video", tracks);
      return;
    }
    // The film as it is when publishing, kept to export this version again later.
    const { history } = useEditor.getState();
    const snapshot = await snapshotFilm(filmId, film);
    const result = await exportOne(fileName, `Publicando la versión ${version}`, tracks);
    if (!result) return;
    useEditor.getState().addRelease({
      id: newId(),
      version,
      title: title.trim() || name,
      notes: notes.trim(),
      createdAt: Date.now(),
      entryId: history ? (history.entries[history.cursor - 1]?.id ?? null) : null,
      snapshot,
      export: { format, quality, width: opts.width, height: opts.height, ...(tracks && { tracks }) },
      file: { name: baseName(result.saved), path: window.gepetta ? result.saved : null, size: result.size },
    });
    useBusy.getState().notify(`Versión ${version} publicada`);
  }

  return (
    <Dialog title={past ? `Exportar la versión ${past.release.version}` : "Exportar video"} onClose={onClose}>
      {past && (
        <p className="hint">
          La película como estaba el {new Date(past.release.createdAt).toLocaleString("es-AR")}, aunque después haya cambiado.
        </p>
      )}
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
        {opts.width}×{opts.height} · {film.settings.fps} cuadros/s · {durationSeconds(film).toFixed(1)} s · {film.length} celdas
      </p>

      {canPublish && (
        <fieldset className="publish">
          <label className="control toggle">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            <span>
              <strong>Publicar como versión</strong> — queda en «Versiones» con la fecha, el archivo y la película como está ahora
            </span>
          </label>
          {publish && (
            <>
              <div className="control">
                <span>Número</span>
                <div className="segmented">
                  <button className={bump === "major" ? "active" : ""} onClick={() => setBump("major")} title="Una versión nueva">
                    Nueva {next.major}
                  </button>
                  {releases.length > 0 && (
                    <button className={bump === "minor" ? "active" : ""} onClick={() => setBump("minor")} title="Una revisión de la última">
                      Revisión {next.minor}
                    </button>
                  )}
                  <button className={bump === "custom" ? "active" : ""} onClick={() => setBump("custom")}>
                    Otro
                  </button>
                </div>
                {bump === "custom" && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ej.: 1.0-taller" />}
              </div>
              <label className="control">
                <span>Título</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="control">
                <span>Notas (qué cambió, para quién es…)</span>
                <textarea value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
              </label>
              {releases.some((r) => r.version === version) && <p className="panel-error">Ya hay una versión {version}.</p>}
            </>
          )}
        </fieldset>
      )}

      {supported === false && <p className="panel-error">Este equipo no puede codificar ese formato a ese tamaño. Probá otro.</p>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn primary"
          disabled={!supported || film.length === 0 || (publish && canPublish && (!version || releases.some((r) => r.version === version)))}
          onClick={run}
        >
          {publish && canPublish ? `Exportar y publicar ${version}` : "Exportar"}
        </button>
      </div>
    </Dialog>
  );
}
