import { useEffect, useRef, useState } from "react";
import { isVideoFile } from "../media/ingest";
import {
  capture,
  changeHold,
  deleteSelected,
  duplicateSelected,
  importImages,
  nudgeSelected,
  selectRelative,
} from "../state/actions";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { CameraPanel } from "./CameraPanel";
import { ExportDialog } from "./ExportDialog";
import { HistoryPanel } from "./HistoryPanel";
import { Icon } from "./Icon";
import { Stage } from "./Stage";
import { Timeline } from "./Timeline";
import { VideoImportDialog } from "./VideoImportDialog";

const FPS_OPTIONS = [6, 8, 10, 12, 15, 24, 25, 30];

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector(".dialog-backdrop")) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") s[e.shiftKey ? "redo" : "undo"]();
      else if (mod && key === "y") s.redo();
      else if (mod) return;
      else if (e.key === " ") void capture();
      else if (e.key === "Enter") (s.playback ? s.stop() : s.play());
      else if (key === "p") (s.playback ? s.stop() : s.play(true));
      else if (e.key === "ArrowLeft") (e.altKey ? nudgeSelected(-1) : selectRelative(-1));
      else if (e.key === "ArrowRight") (e.altKey ? nudgeSelected(1) : selectRelative(1));
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (key === "d") duplicateSelected();
      else if (e.key === "+" || e.key === "=") changeHold(1);
      else if (e.key === "-") changeHold(-1);
      else if (key === "o") s.setOnion({ enabled: !s.onion.enabled });
      else if (key === "l") s.set({ loop: !s.loop });
      else if (key === "c") s.setView("live");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function TopBar({ onExport, onToggleHistory, historyOpen }: { onExport(): void; onToggleHistory(): void; historyOpen: boolean }) {
  const film = useEditor((s) => s.film)!;
  const saveStatus = useEditor((s) => s.saveStatus);
  const { close, commit } = useEditor.getState();
  const [name, setName] = useState(film.settings.name);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  useEffect(() => setName(film.settings.name), [film.settings.name]);

  const rename = () => {
    const n = name.trim();
    if (n && n !== film.settings.name) commit([{ type: "film.rename", name: n }]);
    else setName(film.settings.name);
  };

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => void close()} title="Volver a mis películas">
        <Icon name="back" />
      </button>
      <input
        className="film-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label="Nombre de la película"
      />
      <span className={`save-status ${saveStatus}`}>
        {saveStatus === "saved" ? "Guardado" : saveStatus === "pending" ? "Guardando…" : "Error al guardar"}
      </span>
      <div className="spacer" />
      <label className="inline-control" title="Cuadros por segundo de esta película">
        <select
          value={film.settings.fps}
          onChange={(e) => commit([{ type: "film.setFps", fps: Number(e.target.value) }])}
        >
          {[...new Set([...FPS_OPTIONS, film.settings.fps])].sort((a, b) => a - b).map((f) => (
            <option key={f} value={f}>
              {f} cuadros/s
            </option>
          ))}
        </select>
      </label>
      <button className="btn" onClick={() => imageInput.current?.click()} title="Importar imágenes después del cuadro seleccionado">
        <Icon name="image" /> Imágenes
      </button>
      <button className="btn" onClick={() => videoInput.current?.click()} title="Importar cuadros de un video">
        <Icon name="video" /> Video
      </button>
      <button className={`btn${historyOpen ? " active" : ""}`} onClick={onToggleHistory} title="Historial de cambios">
        <Icon name="history" /> Historial
      </button>
      <button className="btn primary" onClick={onExport} disabled={film.frameOrder.length === 0}>
        <Icon name="export" /> Exportar
      </button>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void importImages([...(e.target.files ?? [])]);
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
          if (f && isVideoFile(f)) setVideoFile(f);
          e.target.value = "";
        }}
      />
      {videoFile && <VideoImportDialog file={videoFile} onClose={() => setVideoFile(null)} />}
    </header>
  );
}

function Transport() {
  const film = useEditor((s) => s.film)!;
  const selected = useEditor((s) => s.selected);
  const view = useEditor((s) => s.view);
  const playing = useEditor((s) => s.playback !== null);
  const onion = useEditor((s) => s.onion);
  const loop = useEditor((s) => s.loop);
  const tailSeconds = useEditor((s) => s.tailSeconds);
  const hasStream = useCamera((s) => s.stream !== null);
  const { play, stop, setOnion, set, setView } = useEditor.getState();
  const frame = selected ? film.frames[selected] : undefined;
  const frameTools = view === "frame" && frame;

  return (
    <div className="transport">
      <div className="group">
        <button className="capture-btn" onClick={() => void capture()} disabled={!hasStream} title="Sacar foto (barra espaciadora)">
          <Icon name="camera" size={28} />
        </button>
        {view === "frame" && (
          <button className="btn" onClick={() => setView("live")} title="Ver la cámara; la foto se inserta después de este cuadro (C)">
            <Icon name="camera" /> Cámara aquí
          </button>
        )}
      </div>

      <div className="group">
        {frameTools ? (
          <>
            <button className="icon-btn" onClick={() => nudgeSelected(-1)} title="Mover a la izquierda (⌥←)">
              <Icon name="left" />
            </button>
            <button className="icon-btn" onClick={() => nudgeSelected(1)} title="Mover a la derecha (⌥→)">
              <Icon name="right" />
            </button>
            <span className="hold-control" title="Cuánto dura el cuadro (+ / −)">
              <button className="icon-btn" onClick={() => changeHold(-1)} disabled={frame.hold <= 1}>
                <Icon name="minus" size={16} />
              </button>
              <span>×{frame.hold}</span>
              <button className="icon-btn" onClick={() => changeHold(1)}>
                <Icon name="plus" size={16} />
              </button>
            </span>
            <button className="icon-btn" onClick={duplicateSelected} title="Repetir cuadro (D)">
              <Icon name="copy" />
            </button>
            <button className="icon-btn danger" onClick={deleteSelected} title="Borrar cuadro (Supr)">
              <Icon name="trash" />
            </button>
          </>
        ) : (
          <span className="hint">
            {film.frameOrder.length} cuadros · {film.settings.fps} cuadros/s
          </span>
        )}
      </div>

      <div className="group">
        <button
          className={`icon-btn${playing ? " active" : ""}`}
          onClick={() => (playing ? stop() : play())}
          title="Reproducir todo (Enter)"
          disabled={film.frameOrder.length === 0}
        >
          <Icon name={playing ? "stop" : "play"} />
        </button>
        <button className="icon-btn" onClick={() => play(true)} title="Reproducir los últimos segundos (P)" disabled={film.frameOrder.length === 0}>
          <Icon name="tail" />
        </button>
        <select value={tailSeconds} onChange={(e) => set({ tailSeconds: Number(e.target.value) })} title="Segundos a reproducir">
          {[1, 2, 3, 5, 10].map((s) => (
            <option key={s} value={s}>
              últimos {s} s
            </option>
          ))}
        </select>
        <button className={`icon-btn${loop ? " active" : ""}`} onClick={() => set({ loop: !loop })} title="Repetir en loop (L)">
          <Icon name="loop" />
        </button>
      </div>

      <div className="group onion">
        <button
          className={`icon-btn${onion.enabled ? " active" : ""}`}
          onClick={() => setOnion({ enabled: !onion.enabled })}
          title="Papel de cebolla (O)"
        >
          <Icon name="onion" />
        </button>
        <select value={onion.count} onChange={(e) => setOnion({ count: Number(e.target.value) })} title="Cuántos cuadros anteriores ver" disabled={!onion.enabled}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "cuadro" : "cuadros"}
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0.05}
          max={0.9}
          step={0.05}
          value={onion.opacity}
          disabled={!onion.enabled}
          onChange={(e) => setOnion({ opacity: Number(e.target.value) })}
          title="Transparencia"
        />
      </div>
    </div>
  );
}

export function Editor() {
  const [exporting, setExporting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  useShortcuts();

  useEffect(() => {
    void useCamera.getState().start();
    return () => useCamera.getState().stop();
  }, []);

  return (
    <div className="editor">
      <TopBar onExport={() => setExporting(true)} onToggleHistory={() => setHistoryOpen(!historyOpen)} historyOpen={historyOpen} />
      <div className="workspace">
        {historyOpen && <HistoryPanel />}
        <Stage />
        <CameraPanel />
      </div>
      <Transport />
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
