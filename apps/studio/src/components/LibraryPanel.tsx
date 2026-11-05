import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { thumbUrl } from "../media/cache";
import { placeImageTrack } from "../state/actions";
import { useEditor } from "../state/editor";
import {
  LIBRARY_DRAG,
  type LibraryItem,
  type LibraryKind,
  addToLibrary,
  libraryFile,
  moveInLibrary,
  openVideo,
  placeFromLibrary,
  removeFromLibrary,
  renameInLibrary,
  useDownloads,
} from "../state/library";
import { AnimationCollection, SoundCollection } from "./Collections";
import { Icon, type IconName } from "./Icon";
import { WebVideoDialog } from "./WebVideoDialog";

type Tab = "mine" | "effects" | "music" | "animations";

const TABS: { id: Tab; label: string }[] = [
  { id: "mine", label: "Recursos" },
  { id: "effects", label: "Efectos" },
  { id: "music", label: "Música" },
  { id: "animations", label: "Animaciones" },
];

const KINDS: { id: LibraryKind; label: string; icon: IconName }[] = [
  { id: "video", label: "Videos", icon: "video" },
  { id: "image", label: "Imágenes", icon: "image" },
  { id: "vector", label: "Vectores", icon: "shape" },
  { id: "sound", label: "Sonidos", icon: "sound" },
  { id: "animation", label: "Animaciones", icon: "film" },
];

/** What the panel shows, kept while other tools are used. */
const useLibraryView = create<{ tab: Tab; kind: LibraryKind | null; selected: string[] }>(() => ({ tab: "mine", kind: null, selected: [] }));

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const mb = (bytes: number) => (bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`);

function Thumb({ item }: { item: LibraryItem }) {
  const filmId = useEditor((s) => s.filmId);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!filmId || !item.thumb) return;
    let live = true;
    thumbUrl(filmId, item.thumb).then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [filmId, item.thumb]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="lib-noimg" />;
}

let listening: HTMLAudioElement | null = null;

/** Plays a library sound (stopping the one before; touching the same again stops it). */
async function listen(item: LibraryItem) {
  const again = listening?.dataset.id === item.id;
  if (listening) {
    listening.pause();
    URL.revokeObjectURL(listening.src);
    listening = null;
  }
  if (again) return;
  const audio = new Audio(URL.createObjectURL(await libraryFile(item)));
  audio.dataset.id = item.id;
  audio.onended = () => listening === audio && (listening = null);
  listening = audio;
  await audio.play();
}

/** What the selected items can do, and what they are. */
function Details({ items }: { items: LibraryItem[] }) {
  const cursor = useEditor((s) => s.cursor);
  const [confirm, setConfirm] = useState(false);
  const ids = items.map((i) => i.id).join();
  useEffect(() => setConfirm(false), [ids]);
  const one = items.length === 1 ? items[0]! : null;
  const placeable = items.filter((i) => i.kind !== "video");
  const kindLabel = (k: LibraryKind) => ({ video: "Video", image: "Imagen", vector: "Dibujo vectorial", sound: "Sonido", animation: "Animación" })[k];

  return (
    <div className="lib-details">
      {one ? (
        <>
          <input
            key={one.id}
            className="lib-rename"
            defaultValue={one.name}
            title="Su nombre (cambialo acá)"
            onBlur={(e) => renameInLibrary(one.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
          <p className="lib-info">
            {kindLabel(one.kind)}
            {one.width && one.kind !== "sound" ? ` · ${one.width}×${one.height}` : ""}
            {one.duration ? ` · ${one.kind === "animation" ? `${one.frames?.length} cuadros` : mmss(one.duration)}` : ""}
            {one.bytes ? ` · ${mb(one.bytes)}` : ""}
            {one.from ? ` · de ${/^https?:/.test(one.from) ? new URL(one.from).hostname : one.from}` : ""}
          </p>
        </>
      ) : (
        <p className="lib-info">{items.length} elegidos</p>
      )}
      <div className="lib-actions">
        {one?.kind === "video" ? (
          <>
            <button className="btn small primary" onClick={() => void openVideo(one, "frames")} title="Elegir un tramo y ponerlo cuadro por cuadro desde la celda elegida">
              <Icon name="video" size={14} /> Cuadro por cuadro…
            </button>
            <button className="btn small" onClick={() => void openVideo(one, "track")} title="Un track nuevo semitransparente, solo de referencia, para calcar encima">
              En un track para calcar…
            </button>
          </>
        ) : (
          placeable.length > 0 && (
            <button className="btn small primary" onClick={() => placeFromLibrary(placeable, cursor)} title="Desde la celda elegida en la línea de tiempo">
              <Icon name="plus" size={14} /> Poner en la celda {cursor.cell + 1}
            </button>
          )
        )}
        {one?.kind === "sound" && (
          <button className="btn small" onClick={() => void listen(one)}>
            <Icon name="play" size={12} /> Escuchar
          </button>
        )}
        {one?.media && (
          <button className="btn small" onClick={() => placeImageTrack(one.media!, one.name)} title="Un track nuevo con esta imagen en toda la película (un fondo, un marco, un logo…)">
            Fondo para toda la película
          </button>
        )}
      </div>
      <div className="lib-actions">
        {confirm ? (
          <>
            <span className="lib-confirm">¿Sacar{items.length > 1 ? ` ${items.length}` : ""} de la biblioteca? Lo que ya está en la película queda.</span>
            <button
              className="btn small danger"
              onClick={() => {
                removeFromLibrary(items.map((i) => i.id));
                useLibraryView.setState({ selected: [] });
              }}
            >
              Sacar
            </button>
            <button className="btn small ghost" onClick={() => setConfirm(false)}>
              No
            </button>
          </>
        ) : (
          <button className="btn small ghost" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={12} /> Sacar de la biblioteca
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The library tool: the film's resources (videos, pictures, vector drawings,
 * sounds, animations) brought in once from the computer, the internet or the
 * collections that come with the app, and dragged from here to the timeline
 * as many times as wanted. Adding or taking them out is not undone.
 */
export function LibraryPanel() {
  const { tab, kind, selected } = useLibraryView();
  const library = useEditor((s) => s.library);
  const downloads = useDownloads((s) => s.items);
  const input = useRef<HTMLInputElement>(null);
  const [web, setWeb] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const last = useRef<string | null>(null);

  const kinds = KINDS.filter((k) => library.some((i) => i.kind === k.id));
  const shown = library.filter((i) => !kind || i.kind === kind);
  const chosen = library.filter((i) => selected.includes(i.id));

  async function add(files: File[]) {
    const items = await addToLibrary(files);
    if (items.length) useLibraryView.setState({ tab: "mine", kind: null, selected: items.map((i) => i.id) });
  }

  function pick(e: React.MouseEvent, id: string) {
    let next: string[];
    if (e.shiftKey && last.current) {
      const ids = shown.map((i) => i.id);
      const [a, b] = [ids.indexOf(last.current), ids.indexOf(id)].sort((x, y) => x - y);
      next = [...new Set([...selected, ...ids.slice(a, b! + 1)])];
    } else if (e.metaKey || e.ctrlKey) next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    else next = [id];
    last.current = id;
    useLibraryView.setState({ selected: next });
  }

  return (
    <div
      className={`tool-options library-panel${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      <div className="lib-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => useLibraryView.setState({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mine" && (
        <>
          <div className="action-row">
            <button className="btn small" onClick={() => input.current?.click()} title="Videos, imágenes, dibujos vectoriales (SVG) o sonidos de la compu">
              <Icon name="folder" size={14} /> Desde la compu…
            </button>
            <button className="btn small" onClick={() => setWeb(true)} title="Un link a un video, o buscar en YouTube">
              <Icon name="globe" size={14} /> De internet…
            </button>
          </div>

          {downloads.map((d) => (
            <div key={d.id} className="web-progress">
              <span title={d.name}>
                {d.status ?? `Bajando «${d.name}»…`}
                {d.received > 0 && d.unit === "s" ? ` ${mmss(d.received)} de ${mmss(d.total)}` : d.received > 0 ? ` ${mb(d.received)}${d.total ? ` de ${mb(d.total)}` : ""}` : ""}
              </span>
              {d.total > 0 && <progress value={d.received} max={d.total} />}
            </div>
          ))}

          {kinds.length > 1 && (
            <div className="fx-cats">
              <button className={`fx-cat${!kind ? " active" : ""}`} onClick={() => useLibraryView.setState({ kind: null })}>
                Todo
              </button>
              {kinds.map((k) => (
                <button key={k.id} className={`fx-cat${kind === k.id ? " active" : ""}`} onClick={() => useLibraryView.setState({ kind: k.id })}>
                  {k.label}
                </button>
              ))}
            </div>
          )}

          {library.length === 0 ? (
            <p className="hint">
              Traé acá videos, fotos, dibujos vectoriales (SVG) y sonidos, desde la compu (o soltándolos en este panel) o de internet, o de las colecciones de efectos, música y
              animaciones. Después arrastralos a la línea de tiempo: se pueden poner todas las veces que quieras.
            </p>
          ) : (
            <ul
              className="lib-grid"
              onClick={(e) => e.target === e.currentTarget && useLibraryView.setState({ selected: [] })}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(LIBRARY_DRAG)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                const ids = e.dataTransfer.getData(LIBRARY_DRAG);
                setDropBefore(null);
                if (!ids) return;
                e.preventDefault();
                moveInLibrary(JSON.parse(ids) as string[], dropBefore);
              }}
            >
              {shown.map((item) => {
                const k = KINDS.find((x) => x.id === item.kind)!;
                return (
                  <li
                    key={item.id}
                    className={`lib-tile${selected.includes(item.id) ? " selected" : ""}${dropBefore === item.id ? " drop-before" : ""}`}
                    draggable
                    title={`${item.name}: arrastralo a la línea de tiempo${item.kind === "video" ? " para elegir qué tramo poner" : ""}. Doble clic: ${item.kind === "video" ? "elegir un tramo" : "ponerlo en la celda elegida"}.`}
                    onClick={(e) => pick(e, item.id)}
                    onDoubleClick={() => (item.kind === "video" ? void openVideo(item, "frames") : placeFromLibrary([item], useEditor.getState().cursor))}
                    onDragStart={(e) => {
                      // Dragging one of the chosen drags them all, in the library's order.
                      const ids = selected.includes(item.id) ? library.filter((i) => selected.includes(i.id)).map((i) => i.id) : [item.id];
                      if (!selected.includes(item.id)) useLibraryView.setState({ selected: ids });
                      e.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify(ids));
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(LIBRARY_DRAG)) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      const after = e.clientX > r.left + r.width / 2;
                      const i = shown.indexOf(item);
                      setDropBefore(after ? (shown[i + 1]?.id ?? null) : item.id);
                    }}
                    onDragEnd={() => setDropBefore(null)}
                  >
                    <Thumb item={item} />
                    <span className="lib-kind">
                      <Icon name={k.icon} size={11} />
                      {item.duration && item.kind !== "animation" ? mmss(item.duration) : ""}
                    </span>
                    <span className="lib-name">{item.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {chosen.length > 0 && <Details items={chosen} />}
          {library.length > 0 && chosen.length === 0 && (
            <p className="hint">Arrastrá a la línea de tiempo lo que quieras poner, o elegilo para ver qué se puede hacer. Con ⇧ o Ctrl elegís varios.</p>
          )}
        </>
      )}
      {tab === "effects" && <SoundCollection />}
      {tab === "music" && <SoundCollection music />}
      {tab === "animations" && <AnimationCollection />}

      <input
        ref={input}
        type="file"
        accept="image/*,video/*,audio/*,.svg,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.mkv,.mov"
        multiple
        hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {web && <WebVideoDialog onClose={() => setWeb(false)} />}
    </div>
  );
}
