import { useRef, useState } from "react";
import { create } from "zustand";
import { isImageFile, isVideoFile, sortFiles } from "../media/ingest";
import { addImageTrack, importImages } from "../state/actions";
import { useEditor } from "../state/editor";
import { Icon } from "./Icon";
import { VideoImportDialog } from "./VideoImportDialog";

interface Pending {
  id: number;
  file: File;
  url: string;
}

/** Images chosen and put in order, waiting to go into the cells (kept while other tools are used). */
const usePending = create<{ items: Pending[] }>(() => ({ items: [] }));
let nextId = 1;

function addFiles(files: File[]) {
  const images = sortFiles(files.filter(isImageFile));
  const items = images.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file) }));
  usePending.setState({ items: [...usePending.getState().items, ...items] });
}

function setItems(items: Pending[]) {
  const keep = new Set(items.map((i) => i.id));
  for (const i of usePending.getState().items) if (!keep.has(i.id)) URL.revokeObjectURL(i.url);
  usePending.setState({ items });
}

/**
 * The import tool: images put in order and placed in the cells from the
 * cursor on (one after another, each lasting as photos do), a video's images
 * one per cell, or a picture for the whole film on a track of its own.
 */
export function ImportPanel() {
  const items = usePending((s) => s.items);
  const cursor = useEditor((s) => s.cursor);
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === s.cursor.track));
  const captureStep = useEditor((s) => s.captureStep);
  const imagesInput = useRef<HTMLInputElement>(null);
  const stillInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<{ file: File; mode: "frames" | "track" } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const videoMode = useRef<"frames" | "track">("frames");
  const dragged = useRef<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    setItems(next);
  };

  async function insert() {
    const files = items.map((i) => i.file);
    setItems([]);
    await importImages(files, cursor, true);
  }

  const cells = items.length * captureStep;

  return (
    <div
      className={`tool-options import-panel${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (dragged.current === null) addFiles([...e.dataTransfer.files]);
      }}
    >
      <p className="tool-where">
        Desde <strong>{track?.name}</strong>, celda {cursor.cell + 1} <small>(tocá otra celda en la línea de tiempo para cambiarla)</small>
      </p>

      <button className="btn small" onClick={() => imagesInput.current?.click()}>
        <Icon name="image" size={14} /> {items.length ? "Agregar más imágenes…" : "Elegir imágenes…"}
      </button>
      {items.length === 0 ? (
        <p className="hint">Elegí varias imágenes (o arrastralas acá): quedan en una lista para ordenarlas antes de ponerlas, una por celda.</p>
      ) : (
        <>
          <div className="action-row">
            <button className="btn small ghost" onClick={() => setItems(sortFiles(items.map((i) => i.file)).map((f) => items.find((i) => i.file === f)!))}>
              Ordenar por nombre
            </button>
            <button className="btn small ghost" onClick={() => setItems(items.slice().reverse())}>
              Invertir
            </button>
            <button className="btn small ghost" onClick={() => setItems([])}>
              Vaciar
            </button>
          </div>
          <ol className="import-list">
            {items.map((it, i) => (
              <li
                key={it.id}
                draggable
                onDragStart={() => (dragged.current = i)}
                onDragEnd={() => (dragged.current = null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragged.current !== null) move(dragged.current, i);
                  dragged.current = null;
                }}
                title="Arrastrala para cambiar su lugar"
              >
                <span className="import-cell">{cursor.cell + i * captureStep + 1}</span>
                <img src={it.url} alt="" />
                <span className="import-name">{it.file.name}</span>
                <button className="icon-btn small" onClick={() => move(i, i - 1)} disabled={i === 0} title="Antes">
                  ▲
                </button>
                <button className="icon-btn small" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} title="Después">
                  ▼
                </button>
                <button className="icon-btn small" onClick={() => setItems(items.filter((x) => x.id !== it.id))} title="Sacar de la lista">
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ol>
          <button className="btn primary" onClick={() => void insert()}>
            Poner {items.length} {items.length === 1 ? "imagen" : "imágenes"} en las celdas {cursor.cell + 1}–{cursor.cell + cells}
          </button>
          <p className="hint">Cada una dura {captureStep === 1 ? "una celda" : `${captureStep} celdas`} (como las fotos: «en unos», «en dos»…). Lo que haya en esas celdas de este track se reemplaza.</p>
        </>
      )}

      <h4>Video</h4>
      <button
        className="btn small"
        onClick={() => {
          videoMode.current = "frames";
          videoInput.current?.click();
        }}
      >
        <Icon name="video" size={14} /> Video cuadro por cuadro, desde la celda elegida…
      </button>
      <button
        className="btn small"
        onClick={() => {
          videoMode.current = "track";
          videoInput.current?.click();
        }}
      >
        <Icon name="video" size={14} /> Video en un track nuevo, para calcar…
      </button>

      <h4>Imagen fija</h4>
      <button className="btn small" onClick={() => stillInput.current?.click()}>
        <Icon name="image" size={14} /> Fondo, marco o logo para toda la película…
      </button>

      <input
        ref={imagesInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={stillInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImageTrack(f);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && isVideoFile(f)) setVideo({ file: f, mode: videoMode.current });
          e.target.value = "";
        }}
      />
      {video && <VideoImportDialog file={video.file} mode={video.mode} onClose={() => setVideo(null)} />}
    </div>
  );
}
