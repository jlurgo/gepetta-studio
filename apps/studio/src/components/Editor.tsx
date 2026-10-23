import { currentSettings, hasSettings, usePaint } from "../state/paint";
import { TOOLS } from "./StageTools";
import { type FilmState, clipAt } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { isVideoFile } from "../media/ingest";
import {
  shoot,
  changeHold,
  deleteSelected,
  duplicateSelected,
  importImages,
  nudgeSelected,
  readyRigs,
  selectRelative, stopAllRecordings } from "../state/actions";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { useGuides } from "../state/guides";
import { useLayers } from "../state/layers";
import { selectStrokes, useStrokes } from "../state/strokes";
import { ToolPanel } from "./ToolPanel";
import { GuidesControl } from "./GuidesControl";
import { DetailPanel } from "./TrackPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { ExportDialog } from "./ExportDialog";
import { VersionsDialog } from "./VersionsDialog";
import type { Release } from "../state/releases";
import { HistoryPanel } from "./HistoryPanel";
import { Icon } from "./Icon";
import { Stage } from "./Stage";
import { Timeline } from "./Timeline";
import { VideoImportDialog } from "./VideoImportDialog";

const FPS_OPTIONS = [6, 8, 10, 12, 15, 24, 25, 30];

const NON_TEXT_INPUTS = ["range", "checkbox", "radio", "button", "color", "file"];

/** Text fields keep their keys; sliders and checkboxes do not block the shortcuts (Space still shoots). */
function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  if (t.tagName !== "INPUT") return false;
  if (!NON_TEXT_INPUTS.includes((t as HTMLInputElement).type)) return true;
  // Arrow keys belong to the focused slider.
  return e.key.startsWith("Arrow") && (t as HTMLInputElement).type === "range";
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
      else if (e.key === " ") shoot();
      else if (e.key === "Enter") (s.playback ? s.pause() : s.play());
      else if (key === "p") (s.playback ? s.stop() : s.play(true));
      else if (e.key === "Escape" && useCamera.getState().picking) useCamera.getState().cancelPicking();
      else if (e.key === "Escape" && s.playback) s.stop();
      else if (e.key === "ArrowLeft") (e.altKey ? nudgeSelected(-1) : selectRelative(-1));
      else if (e.key === "ArrowRight") (e.altKey ? nudgeSelected(1) : selectRelative(1));
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (key === "d") duplicateSelected();
      else if (e.key === "+" || e.key === "=") changeHold(1);
      else if (e.key === "-") changeHold(-1);
      else if (key === "o") s.setOnion({ enabled: !s.onion.enabled });
      else if (key === "l") s.set({ loop: !s.loop });
      else if (TOOLS.some((t) => t.key.toLowerCase() === key)) usePaint.getState().setTool(TOOLS.find((t) => t.key.toLowerCase() === key)!.id);
      else if (key === "c" && useCamera.getState().activeRig) usePaint.getState().setTool("camera");
      else if ((e.key === "[" || e.key === "]") && hasSettings(usePaint.getState().tool)) {
        const { size } = currentSettings();
        usePaint.getState().setCurrent({ size: Math.min(300, Math.max(1, e.key === "]" ? Math.ceil(size * 1.25) : Math.floor(size / 1.25))) });
      }
      else if (key === "g" && s.filmId) {
        const guides = useGuides.getState();
        guides.update(s.filmId, { visible: !guides.get(s.filmId).visible });
      }
      else if (e.key === "Escape" && useStrokes.getState().ids.length) selectStrokes(null, []);
      else if (e.key === "Escape" && (s.selection.length || s.columns)) {
        s.setSelection([]);
        s.setColumns(null);
      }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function TopBar({
  onExport,
  onToggleHistory,
  onVersions,
  historyOpen,
}: {
  onExport(): void;
  onToggleHistory(): void;
  onVersions(): void;
  historyOpen: boolean;
}) {
  const releaseCount = useEditor((s) => s.releases.length);
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
      <label className="inline-control toggle" title="Película en loop: después del último cuadro viene el primero (la línea de tiempo no termina)">
        <input type="checkbox" checked={!!film.settings.loop} onChange={(e) => commit([{ type: "film.setLoop", loop: e.target.checked }])} />
        <span>↻ Loop</span>
      </label>
      <button className="btn" onClick={() => imageInput.current?.click()} title="Poner imágenes desde la celda elegida, en el track elegido">
        <Icon name="image" /> Imágenes
      </button>
      <button className="btn" onClick={() => videoInput.current?.click()} title="Poner las imágenes de un video desde la celda elegida">
        <Icon name="video" /> Video
      </button>
      <button className={`btn${historyOpen ? " active" : ""}`} onClick={onToggleHistory} title="Historial de cambios">
        <Icon name="history" /> Historial
      </button>
      <button className="btn" onClick={onVersions} title="Versiones publicadas: fecha, archivo, exportar de nuevo">
        <Icon name="tag" /> Versiones{releaseCount ? ` (${releaseCount})` : ""}
      </button>
      <button className="btn primary" onClick={onExport} disabled={film.length === 0}>
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

/** "m:ss.cc"-ish position of a cell, for the transport bar. */
function cellTime(cell: number, fps: number): string {
  const seconds = cell / fps;
  const m = Math.floor(seconds / 60);
  const sec = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

function Transport() {
  const film = useEditor((s) => s.film)!;
  const cursor = useEditor((s) => s.cursor);
  const selection = useEditor((s) => s.selection);
  const columns = useEditor((s) => s.columns);
  const playing = useEditor((s) => s.playback !== null);
  const onion = useEditor((s) => s.onion);
  const loop = useEditor((s) => s.loop);
  const tailSeconds = useEditor((s) => s.tailSeconds);
  const captureStep = useEditor((s) => s.captureStep);
  const ready = useCamera((s) => readyRigs(s.rigs).length);
  const recording = useCamera((s) => s.rigs.some((r) => r.recording));
  const captureMode = useEditor((s) => s.captureMode);
  const { play, pause, stop, setOnion, set } = useEditor.getState();
  const atCursor = clipAt(film, cursor.track, cursor.cell);
  const target = selection.length ? film.clips[selection[0]!] : atCursor;
  const trackName = film.tracks.find((t) => t.id === cursor.track)?.name ?? "";

  return (
    <div className="transport">
      <div className="group">
        {recording ? (
          // While recording, the big button stops it (so does the space bar).
          <button className="capture-btn stop" onClick={shoot} title="Detener la grabación (barra espaciadora)">
            <Icon name="stop" size={28} />
          </button>
        ) : (
          <button
            className={`capture-btn${captureMode === "video" ? " video" : ""}`}
            onClick={shoot}
            disabled={ready === 0}
            title={`${
              captureMode === "video"
                ? `Grabar video${ready > 1 ? ` con las ${ready} cámaras habilitadas a la vez` : ""}, una imagen por celda`
                : ready > 1
                  ? `Sacar foto con las ${ready} cámaras habilitadas a la vez, cada una en su celda`
                  : "Sacar foto"
            } (barra espaciadora)`}
          >
            <Icon name={captureMode === "video" ? "record" : "camera"} size={28} />
          </button>
        )}
        <div className="segmented capture-mode" role="radiogroup" aria-label="Foto o video">
          {(["photo", "video"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={captureMode === m} className={captureMode === m ? "active" : ""} disabled={recording} onClick={() => set({ captureMode: m })}>
              {m === "photo" ? "Foto" : "Video"}
            </button>
          ))}
        </div>
        {captureMode === "photo" && <select value={captureStep} onChange={(e) => set({ captureStep: Number(e.target.value) })} title="Cuántas celdas dura cada foto nueva">
          <option value={1}>en unos</option>
          <option value={2}>en dos</option>
          <option value={3}>en tres</option>
          <option value={4}>en cuatro</option>
        </select>}
      </div>

      <div className="group">
        {columns ? (
          <>
            <span className="hint">
              {columns.end - columns.start === 1 ? `Columna ${columns.start + 1}` : `Columnas ${columns.start + 1}–${columns.end}`}
            </span>
            <button className="icon-btn" onClick={() => nudgeSelected(-1)} title="Mover la columna una celda a la izquierda (⌥←)">
              <Icon name="left" />
            </button>
            <button className="icon-btn" onClick={() => nudgeSelected(1)} title="Mover la columna una celda a la derecha (⌥→)">
              <Icon name="right" />
            </button>
            <button className="icon-btn danger" onClick={deleteSelected} title="Vaciar estas celdas en todos los tracks (Supr)">
              <Icon name="trash" />
            </button>
          </>
        ) : target ? (
          <>
            <button className="icon-btn" onClick={() => nudgeSelected(-1)} title="Mover una celda a la izquierda (⌥←)">
              <Icon name="left" />
            </button>
            <button className="icon-btn" onClick={() => nudgeSelected(1)} title="Mover una celda a la derecha (⌥→)">
              <Icon name="right" />
            </button>
            <span className="hold-control" title="Cuántas celdas dura (+ / −)">
              <button className="icon-btn" onClick={() => changeHold(-1)} disabled={target.length <= 1}>
                <Icon name="minus" size={16} />
              </button>
              <span>×{target.length}</span>
              <button className="icon-btn" onClick={() => changeHold(1)}>
                <Icon name="plus" size={16} />
              </button>
            </span>
            <button className="icon-btn" onClick={duplicateSelected} title="Repetir a continuación (D)">
              <Icon name="copy" />
            </button>
            <button className="icon-btn danger" onClick={deleteSelected} title="Borrar (Supr)">
              <Icon name="trash" />
            </button>
            {selection.length > 1 && <span className="hint">{selection.length} imágenes</span>}
          </>
        ) : (
          <span className="hint">
            Celda {cursor.cell + 1} · {cellTime(cursor.cell, film.settings.fps)} · {trackName}
          </span>
        )}
      </div>

      <div className="group">
        <button
          className={`icon-btn${playing ? " active" : ""}`}
          onClick={() => (playing ? pause() : play())}
          title={playing ? "Pausa: queda en la celda que se ve (Enter)" : "Reproducir desde la celda elegida (Enter)"}
          disabled={film.length === 0}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button className="icon-btn" onClick={stop} disabled={!playing} title="Stop: vuelve a la celda elegida (Esc)">
          <Icon name="stop" />
        </button>
        <button className="icon-btn" onClick={() => play(true)} title="Reproducir los últimos segundos (P)" disabled={film.length === 0}>
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

      <GuidesControl />
    </div>
  );
}


/** Right column: camera settings or layers. Both stay mounted so switching keeps their state. */
/**
 * The detail panel: the properties of whatever was picked last — the tool in
 * use (a camera, a brush…), a track, a picture, several pictures, strokes.
 */
function SidePanel() {
  const panel = useLayers((s) => s.panel);
  // Choosing a tool shows it.
  const tool = usePaint((s) => s.tool);
  const activeRig = useCamera((s) => s.activeRig);
  useEffect(() => useLayers.setState({ panel: "tool" }), [tool, activeRig]);

  return (
    <aside className="side-panel">
      <div className="side-body">
        <ErrorBoundary label="el panel de detalle">{panel === "tool" ? <ToolPanel /> : <DetailPanel />}</ErrorBoundary>
      </div>
    </aside>
  );
}

export function Editor() {
  const [exporting, setExporting] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  /** A published version being exported again: the film as it was. */
  const [past, setPast] = useState<{ film: FilmState; release: Release } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useShortcuts();

  useEffect(() => {
    void useCamera.getState().start();
    return () => {
      stopAllRecordings();
      useCamera.getState().stop();
    };
  }, []);

  return (
    <div className="editor">
      <TopBar
        onExport={() => setExporting(true)}
        onToggleHistory={() => setHistoryOpen(!historyOpen)}
        onVersions={() => setVersionsOpen(true)}
        historyOpen={historyOpen}
      />
      <div className="workspace">
        {historyOpen && (
          <ErrorBoundary label="el historial">
            <HistoryPanel />
          </ErrorBoundary>
        )}
        <Stage />
        <SidePanel />
      </div>
      <Transport />
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {versionsOpen && (
        <VersionsDialog
          onClose={() => setVersionsOpen(false)}
          onExport={(film, release) => {
            setVersionsOpen(false);
            setPast({ film, release });
          }}
        />
      )}
      {past && <ExportDialog past={past} onClose={() => setPast(null)} />}
    </div>
  );
}
