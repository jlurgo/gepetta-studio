import type { FilmState } from "@gepetta/core";
import { useEffect, useState } from "react";
import { useBusy } from "../state/busy";
import { useEditor } from "../state/editor";
import { type Release, fileStillThere, loadSnapshot } from "../state/releases";
import { Dialog } from "./Dialog";

function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

function ReleaseRow({ release, onExport }: { release: Release; onExport(film: FilmState): void }) {
  const filmId = useEditor((s) => s.filmId)!;
  const [there, setThere] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fileStillThere(release).then((v) => alive && setThere(v));
    return () => {
      alive = false;
    };
  }, [release]);

  const file = release.file;
  const status =
    !file ? null : there === undefined ? "…" : there === null ? "descargado (el navegador no dice dónde)" : there ? "✓ está donde se guardó" : "✗ ya no está donde se guardó";

  async function exportAgain() {
    try {
      onExport(await loadSnapshot(filmId, release.snapshot));
    } catch {
      useBusy.getState().notify("No encuentro cómo estaba la película en esa versión.", "error");
    }
  }

  return (
    <li className="release">
      <div className="release-head">
        <span className="release-version">{release.version}</span>
        <div className="release-title">
          <strong>{release.title}</strong>
          <small>{new Date(release.createdAt).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}</small>
        </div>
      </div>
      {release.notes && <p className="release-notes">{release.notes}</p>}
      {file && (
        <p className="hint">
          {file.name} · {size(file.size)} · {release.export.width}×{release.export.height} {release.export.format.toUpperCase()}
          <br />
          <span className={there === false ? "missing" : ""}>{status}</span>
          {file.path && there !== false && <br />}
          {file.path && <small className="release-path">{file.path}</small>}
        </p>
      )}
      <div className="action-row">
        {file?.path && there && (
          <button className="btn small" onClick={() => void window.gepetta?.revealFile(file.path!)}>
            Mostrar archivo
          </button>
        )}
        <button className="btn small" onClick={() => void exportAgain()} title="La película como estaba en esta versión, con las opciones que quieras">
          Exportar de nuevo
        </button>
      </div>
    </li>
  );
}

/** Published versions, newest first: date, file (and whether it is still there), export again. */
export function VersionsDialog({ onClose, onExport }: { onClose(): void; onExport(film: FilmState, release: Release): void }) {
  const releases = useEditor((s) => s.releases);
  const list = [...releases].reverse();
  return (
    <Dialog title="Versiones publicadas" onClose={onClose}>
      {list.length === 0 ? (
        <p className="hint">
          Todavía no hay versiones. Al exportar, marcá «Publicar como versión» para guardar una: queda la fecha, el archivo y la
          película como estaba, para poder exportarla de nuevo aunque después cambie.
        </p>
      ) : (
        <ul className="releases">
          {list.map((r) => (
            <ReleaseRow key={r.id} release={r} onExport={(film) => onExport(film, r)} />
          ))}
        </ul>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
