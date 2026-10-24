import { DEFAULT_FPS, createHistory, newId } from "@gepetta/core";
import { useEffect, useState } from "react";
import { thumbUrl } from "../media/cache";
import { type FilmMeta, storage } from "../storage";
import { useEditor } from "../state/editor";
import { FORMATS } from "./formats";
import { Icon } from "./Icon";

const FPS_OPTIONS = [6, 8, 10, 12, 15, 24, 25, 30];

function Thumb({ meta }: { meta: FilmMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (meta.thumb) thumbUrl(meta.id, meta.thumb).then(setUrl, () => setUrl(null));
  }, [meta.id, meta.thumb]);
  return url ? <img src={url} alt="" /> : <Icon name="film" size={40} />;
}

function NewFilmForm({ onCancel }: { onCancel(): void }) {
  const [name, setName] = useState("");
  const [sizeId, setSizeId] = useState(FORMATS[0]!.id);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const open = useEditor((s) => s.open);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const size = FORMATS.find((s) => s.id === sizeId)!;
    const id = newId();
    const settings = { name: name.trim() || "Película sin nombre", fps, width: size.width, height: size.height };
    const history = createHistory(settings);
    await storage.saveFilm(
      { version: 1, id, history },
      { id, name: settings.name, updatedAt: Date.now(), frameCount: 0, thumb: null },
    );
    await open(id);
  }

  return (
    <form className="card new-film" onSubmit={create}>
      <h2>Nueva película</h2>
      <label>
        Nombre
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi película" />
      </label>
      <label>
        Formato
        <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
          {FORMATS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cuadros por segundo
        <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
          {FPS_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
              {f === DEFAULT_FPS ? " (recomendado)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primary">
          Crear
        </button>
      </div>
    </form>
  );
}

export function Library() {
  const [films, setFilms] = useState<FilmMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const open = useEditor((s) => s.open);

  const refresh = () => storage.listFilms().then((list) => setFilms(list.sort((a, b) => b.updatedAt - a.updatedAt)));
  useEffect(() => void refresh(), []);

  async function remove(id: string) {
    await storage.deleteFilm(id);
    setConfirmDelete(null);
    await refresh();
  }

  return (
    <div className="library">
      <header className="library-header">
        <h1>
          <img className="logo" src="./logo.png" alt="" />
          Gepetta <span>Studio</span>
        </h1>
        <button className="btn primary big" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Nueva película
        </button>
      </header>
      {creating && <NewFilmForm onCancel={() => setCreating(false)} />}
      {films && films.length === 0 && !creating && (
        <p className="empty">Todavía no hay películas. ¡Creá la primera!</p>
      )}
      <div className="film-grid">
        {films?.map((f) => (
          <div key={f.id} className="film-card">
            <button className="film-thumb" onClick={() => open(f.id)} title="Abrir">
              <Thumb meta={f} />
            </button>
            <div className="film-info">
              <strong>{f.name}</strong>
              <small>
                {f.frameCount} cuadro{f.frameCount === 1 ? "" : "s"} · {new Date(f.updatedAt).toLocaleDateString("es")}
              </small>
            </div>
            <div className="film-actions">
              {storage.reveal && (
                <button className="icon-btn" title="Mostrar carpeta" onClick={() => storage.reveal!(f.id)}>
                  <Icon name="folder" size={18} />
                </button>
              )}
              {confirmDelete === f.id ? (
                <>
                  <button className="btn danger small" onClick={() => remove(f.id)}>
                    Borrar
                  </button>
                  <button className="btn ghost small" onClick={() => setConfirmDelete(null)}>
                    No
                  </button>
                </>
              ) : (
                <button className="icon-btn" title="Borrar película" onClick={() => setConfirmDelete(f.id)}>
                  <Icon name="trash" size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
