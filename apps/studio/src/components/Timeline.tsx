import { type CellIndex, type Clip, type ClipId, type FilmState, type Track, cellIndex, clipEnd, stackAt } from "@gepetta/core";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { thumbUrl } from "../media/cache";
import { drawStack } from "../render/frame";
import { addImageTrack, addTrack, extendFilm, importImages, moveClips, moveColumns, setCellImage } from "../state/actions";
import { playbackCell, useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { useCamera } from "../state/camera";
import { RIG_COLORS } from "./CamerasList";
import { Icon } from "./Icon";
import { capturePointer } from "./pointer";
import { OpacitySlider } from "./TrackPanel";
import { VideoImportDialog } from "./VideoImportDialog";

const RULER_H = 22;
const RESULT_H = 64;
const TRACK_H = 44;
const ROW_GAP = 4;
const ZOOMS = [12, 20, 32, 48, 72, 108];
const ZOOM_KEY = "gepetta.timelineZoom";
/** Empty cells shown past the end, to place pictures there. */
const TAIL_SECONDS = 2;

/** Decoded thumbnails, shared by every place that shows them. */
const thumbImages = new Map<string, Promise<HTMLImageElement>>();
function thumbImage(filmId: string, assetId: string): Promise<HTMLImageElement> {
  const key = `${filmId}/${assetId}`;
  let p = thumbImages.get(key);
  if (!p) {
    p = thumbUrl(filmId, assetId).then(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("thumb"));
          img.src = url;
        }),
    );
    p.catch(() => thumbImages.delete(key));
    thumbImages.set(key, p);
  }
  return p;
}

const Thumb = memo(function Thumb({ filmId, asset }: { filmId: string; asset: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    thumbUrl(filmId, asset).then((u) => alive && setUrl(u), () => undefined);
    return () => {
      alive = false;
    };
  }, [filmId, asset]);
  return url ? <img src={url} alt="" draggable={false} /> : null;
});

/** The film as it comes out at `cell`: every visible track combined, drawn from thumbnails. */
const CompositeThumb = memo(function CompositeThumb({ filmId, film, cell, index }: { filmId: string; film: FilmState; cell: number; index: CellIndex }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stack = stackAt(film, cell, { index });
  // Redraw only when what is drawn changes, not on every edit of the film.
  const key = JSON.stringify(stack.map((s) => [s.media.thumb, s.opacity, s.transform]));
  const { width, height } = film.settings;
  useEffect(() => {
    let alive = true;
    Promise.all(stack.map((s) => thumbImage(filmId, s.media.thumb).catch(() => undefined))).then((images) => {
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const h = 120;
      const w = Math.round((h * width) / height);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
      const byThumb = new Map(stack.map((s, i) => [s.media.thumb, images[i]]));
      drawStack(ctx, stack, film.settings, (m) => byThumb.get(m.thumb));
    });
    return () => {
      alive = false;
    };
    // `stack` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmId, key, width, height]);
  return <canvas ref={ref} />;
});

function TrackHead({ track, current }: { track: Track; current: boolean }) {
  const selected = useLayers((s) => s.trackId === track.id);
  return (
    <div className={`tl-head track${selected ? " selected" : ""}${current ? " current" : ""}${track.visible ? "" : " off"}`} style={{ height: TRACK_H }}>
      <button className="icon-btn small" onClick={() => updateTrack(track.id, { visible: !track.visible })} title={track.visible ? "Ocultar" : "Mostrar"}>
        <Icon name={track.visible ? "eye" : "eyeOff"} size={15} />
      </button>
      <button
        className="tl-name"
        onClick={() => {
          useLayers.getState().select(selected ? null : track.id);
          const { cursor, moveTo } = useEditor.getState();
          moveTo(cursor.cell, track.id);
        }}
        title={`${track.name}${track.exported ? "" : " (solo referencia: no se exporta)"} — tocá para elegirlo y ver sus ajustes`}
      >
        {track.name}
        {!track.exported && <span className="ref-dot" aria-hidden />}
      </button>
      <OpacitySlider label={false} value={track.opacity} onCommit={(opacity) => updateTrack(track.id, { opacity })} />
    </div>
  );
}

function AddTrackMenu({ onVideo }: { onVideo(): void }) {
  const [open, setOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const item = (title: string, text: string, run: () => void) => (
    <button
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <strong>{title}</strong>
      <span>{text}</span>
    </button>
  );
  return (
    <div className="tl-add">
      <button className="btn small ghost" onClick={() => setOpen(!open)}>
        <Icon name="plus" size={14} /> Track
      </button>
      {open && (
        <div className="menu" onPointerDown={(e) => e.stopPropagation()}>
          {item("Capa vacía", "Para fotos, dibujos o recortes", addTrack)}
          {item("Imagen fija", "Un fondo, un marco o un logo para toda la película", () => imageInput.current?.click())}
          {item("Video", "Sus imágenes, una por celda: para rotoscopia", onVideo)}
        </div>
      )}
      <input
        ref={imageInput}
        data-role="image-track"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImageTrack(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

type Gesture =
  | { kind: "move"; x0: number; y0: number; id: ClipId; ids: ClipId[]; moved: boolean; dx: number; dy: number }
  | { kind: "resize"; x0: number; id: ClipId; length0: number; dx: number }
  | { kind: "band"; x0: number; y0: number; x1: number; y1: number; add: boolean; base: ClipId[] }
  | { kind: "columns"; x0: number; dx: number; moved: boolean };

function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOMS.includes(z) ? z : 32;
  } catch {
    return 32;
  }
}

export function Timeline() {
  const film = useEditor((s) => s.film);
  const filmId = useEditor((s) => s.filmId);
  const cursor = useEditor((s) => s.cursor);
  const selection = useEditor((s) => s.selection);
  const columns = useEditor((s) => s.columns);
  const rigs = useCamera((s) => s.rigs);
  const activeRig = useCamera((s) => s.activeRig);
  const view = useEditor((s) => s.view);
  const [cw, setCw] = useState(loadZoom);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 1200 });
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  // Pointer events can arrive faster than React re-renders: handlers read the ref.
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = (g: Gesture | null) => {
    gestureRef.current = g;
    setGestureState(g);
  };
  const cellInput = useRef<HTMLInputElement>(null);
  const pickAt = useRef<{ track: string; cell: number } | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<{ file: File; mode: "frames" | "track" } | null>(null);
  const index: CellIndex = useMemo(() => (film ? cellIndex(film) : new Map()), [film]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setScroll({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the cursor in view when it moves (by keys, captures…).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = cursor.cell * cw;
    if (x < el.scrollLeft) el.scrollLeft = x - cw;
    else if (x + cw > el.scrollLeft + el.clientWidth) el.scrollLeft = x + 2 * cw - el.clientWidth;
  }, [cursor.cell, cw]);

  // While playing, a line runs over the cells being shown (outside React: it moves every frame).
  const playing = useEditor((s) => s.playback !== null);
  const playRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const { playback, film: f } = useEditor.getState();
      const line = playRef.current;
      const el = scroller.current;
      if (!playback || !f || !line || !el) return;
      const cell = Math.max(0, Math.min(f.length - 1, playbackCell(playback, f.settings.fps)));
      const x = cell * cw;
      line.style.transform = `translateX(${x}px)`;
      line.style.width = `${cw}px`;
      // Page along, like a video editor, when the line reaches an edge.
      if (x < el.scrollLeft || x + cw > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, cw]);

  if (!film || !filmId) return null;
  const fps = film.settings.fps;
  const tracks = [...film.tracks].reverse(); // top first, like the picture
  const cells = film.length + TAIL_SECONDS * fps;
  const firstCell = Math.max(0, Math.floor(scroll.left / cw) - 1);
  const lastCell = Math.min(cells, Math.ceil((scroll.left + scroll.width) / cw) + 1);
  const rowsTop = RULER_H + ROW_GAP + RESULT_H + ROW_GAP;
  const rowTop = (i: number) => rowsTop + i * (TRACK_H + ROW_GAP);
  const height = rowTop(tracks.length);
  const selected = new Set(selection);
  const aspect = film.settings.width / film.settings.height;

  const setZoom = (z: number) => {
    setCw(z);
    try {
      localStorage.setItem(ZOOM_KEY, String(z));
    } catch {
      // Not remembered.
    }
  };

  /** Cell and track row under a pointer event, in the canvas. */
  const at = (e: { clientX: number; clientY: number }) => {
    const box = scroller.current!.getBoundingClientRect();
    const x = e.clientX - box.left + scroller.current!.scrollLeft;
    const y = e.clientY - box.top + scroller.current!.scrollTop;
    const cell = Math.max(0, Math.floor(x / cw));
    const row = Math.floor((y - rowsTop) / (TRACK_H + ROW_GAP));
    return { x, y, cell, row, track: y >= rowsTop && row < tracks.length ? tracks[row]! : null };
  };

  // Results row: one box per run of cells that look the same (empty cells get none).
  const runs: { start: number; end: number }[] = [];
  {
    let prev = "";
    for (let c = firstCell; c < Math.min(lastCell, film.length); c++) {
      const key = stackAt(film, c, { index })
        .map((s) => s.clipId)
        .join("|");
      if (key && runs.length && key === prev && runs[runs.length - 1]!.end === c) runs[runs.length - 1]!.end = c + 1;
      else if (key) runs.push({ start: c, end: c + 1 });
      prev = key;
    }
  }

  const visibleClips = (track: Track): Clip[] => (index.get(track.id) ?? []).filter((c) => clipEnd(c) > firstCell && c.start < lastCell);

  // -- pointer gestures ------------------------------------------------------

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = at(e);
    if (p.y < RULER_H) {
      // Ruler: pick the moment and show the film there.
      useEditor.getState().moveTo(p.cell, undefined, "frame");
      return;
    }
    if (p.y < rowsTop) {
      // Results: select the column (the film as it comes out there); drag it to move it.
      const { setColumns, moveTo } = useEditor.getState();
      const run = runs.find((r) => p.cell >= r.start && p.cell < r.end);
      moveTo(p.cell, undefined, "frame");
      if (!run) return setColumns(null);
      if (e.shiftKey && columns) setColumns({ start: Math.min(columns.start, run.start), end: Math.max(columns.end, run.end) });
      else if (!(columns && p.cell >= columns.start && p.cell < columns.end)) setColumns(run);
      capturePointer(e);
      setGesture({ kind: "columns", x0: p.x, dx: 0, moved: false });
      return;
    }
    if (!p.track) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-clip]");
    const id = target?.dataset.clip;
    const { setSelection } = useEditor.getState();
    capturePointer(e);
    if (id) {
      const clip = film!.clips[id]!;
      if ((e.target as HTMLElement).dataset.edge) {
        setGesture({ kind: "resize", x0: p.x, id, length0: clip.length, dx: 0 });
        return;
      }
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids = selection;
      if (add) ids = selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id];
      else if (!selected.has(id)) ids = [id];
      setSelection(ids);
      useEditor.getState().moveTo(Math.max(clip.start, Math.min(p.cell, clipEnd(clip) - 1)), clip.track, "frame");
      if (ids.includes(id)) setGesture({ kind: "move", x0: p.x, y0: p.y, id, ids, moved: false, dx: 0, dy: 0 });
      return;
    }
    setGesture({ kind: "band", x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey || e.metaKey || e.ctrlKey, base: selection });
  }

  function onPointerMove(e: React.PointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const p = at(e);
    if (gesture.kind === "move") {
      const dx = Math.round((p.x - gesture.x0) / cw);
      const dy = Math.round((p.y - gesture.y0) / (TRACK_H + ROW_GAP));
      const moved = gesture.moved || Math.abs(p.x - gesture.x0) + Math.abs(p.y - gesture.y0) > 4;
      if (dx !== gesture.dx || dy !== gesture.dy || moved !== gesture.moved) setGesture({ ...gesture, dx, dy, moved });
    } else if (gesture.kind === "resize") {
      const dx = Math.round((p.x - gesture.x0) / cw);
      if (dx !== gesture.dx) setGesture({ ...gesture, dx });
    } else if (gesture.kind === "columns") {
      const dx = Math.round((p.x - gesture.x0) / cw);
      const moved = gesture.moved || Math.abs(p.x - gesture.x0) > 4;
      if (dx !== gesture.dx || moved !== gesture.moved) setGesture({ ...gesture, dx, moved });
    } else {
      setGesture({ ...gesture, x1: p.x, y1: p.y });
      const [x0, x1] = [Math.min(gesture.x0, p.x), Math.max(gesture.x0, p.x)];
      const [y0, y1] = [Math.min(gesture.y0, p.y), Math.max(gesture.y0, p.y)];
      if (x1 - x0 + (y1 - y0) <= 4) return;
      const inside = Object.values(film!.clips)
        .filter((c) => {
          const top = rowTop(tracks.findIndex((t) => t.id === c.track));
          return c.start * cw < x1 && clipEnd(c) * cw > x0 && top < y1 && top + TRACK_H > y0;
        })
        .map((c) => c.id);
      useEditor.getState().setSelection(gesture.add ? [...new Set([...gesture.base, ...inside])] : inside);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gestureRef.current;
    setGesture(null);
    if (!g) return;
    const p = at(e);
    if (g.kind === "move" && g.moved && (g.dx || g.dy)) {
      const moves = g.ids.map((id) => {
        const c = film!.clips[id]!;
        const row = tracks.findIndex((t) => t.id === c.track);
        const to = tracks[Math.max(0, Math.min(tracks.length - 1, row + g.dy))]!;
        return { id, track: to.id, start: c.start + g.dx };
      });
      if (moves.every((m) => m.start >= 0)) moveClips(moves);
    } else if (g.kind === "move" && !g.moved && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
      // A plain click on a picture of a group picks just that one.
      useEditor.getState().setSelection([g.id]);
    } else if (g.kind === "columns") {
      if (g.moved && g.dx) moveColumns(g.dx);
    } else if (g.kind === "resize" && g.dx) {
      const length = Math.max(1, g.length0 + g.dx);
      useEditor.getState().commit([{ type: "clip.update", id: g.id, patch: { length } }]);
    } else if (g.kind === "band" && Math.abs(p.x - g.x0) + Math.abs(p.y - g.y0) <= 4 && p.track) {
      // A click on an empty cell: that is where the next picture goes.
      if (!g.add) useEditor.getState().setSelection([]);
      useEditor.getState().setColumns(null);
      useEditor.getState().moveTo(p.cell, p.track.id, "frame");
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    const p = at(e);
    if (!p.track || (e.target as HTMLElement).closest("[data-clip]")) return;
    pickAt.current = { track: p.track.id, cell: p.cell };
    cellInput.current?.click();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const p = at(e);
    if (!p.track || !e.dataTransfer.files.length) return;
    void importImages([...e.dataTransfer.files], { track: p.track.id, cell: p.cell });
  }

  // Where moved clips are drawn while dragging.
  const shift = (c: Clip): { left: number; top: number } | null => {
    if (!gesture || gesture.kind !== "move" || !gesture.moved || !selected.has(c.id)) return null;
    const row = tracks.findIndex((t) => t.id === c.track);
    const to = Math.max(0, Math.min(tracks.length - 1, row + gesture.dy));
    return { left: Math.max(0, c.start + gesture.dx) * cw, top: rowTop(to) };
  };

  const ticks: number[] = [];
  const every = cw >= 32 ? 1 : cw >= 20 ? 2 : 6;
  for (let c = firstCell - (firstCell % every); c < lastCell; c += every) ticks.push(c);
  const cursorRow = Math.max(0, tracks.findIndex((t) => t.id === cursor.track));

  return (
    <div className="timeline" style={{ ["--thumb-aspect" as string]: aspect }}>
      <div className="tl-heads" style={{ minHeight: height + 40 }}>
        <div className="tl-head ruler" style={{ height: RULER_H }}>
          <select value={cw} onChange={(e) => setZoom(Number(e.target.value))} title="Ancho de las celdas">
            {ZOOMS.map((z, i) => (
              <option key={z} value={z}>
                zoom {i + 1}
              </option>
            ))}
          </select>
        </div>
        <div className="tl-head main" style={{ height: RESULT_H }}>
          Resultado
        </div>
        {tracks.map((t) => (
          <TrackHead key={t.id} track={t} current={t.id === cursor.track} />
        ))}
        <AddTrackMenu onVideo={() => videoInput.current?.click()} />
      </div>

      <div className="tl-body" ref={scroller} onScroll={(e) => setScroll({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}>
        <div
          className="tl-canvas"
          style={{ width: cells * cw + 120, height: height + 40 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <div className="tl-ruler" style={{ height: RULER_H }}>
            {ticks.map((c) => (
              <span key={c} className={c % fps === 0 ? "sec" : ""} style={{ left: c * cw }}>
                {c % fps === 0 ? `${c / fps}s` : c + 1}
              </span>
            ))}
          </div>

          {runs.map((r) => (
            <div key={r.start} className="tl-result" style={{ left: r.start * cw + 1, width: (r.end - r.start) * cw - 2, top: RULER_H + ROW_GAP, height: RESULT_H }}>
              <CompositeThumb filmId={filmId} film={film} cell={r.start} index={index} />
            </div>
          ))}

          {tracks.map((t, i) => (
            <div
              key={t.id}
              className={`tl-row${t.id === cursor.track ? " current" : ""}${t.visible ? "" : " off"}`}
              style={{ top: rowTop(i), height: TRACK_H, backgroundSize: `${cw}px 100%` }}
            />
          ))}

          {/* The cell where the camera (or the next import) puts its picture. */}
          <div className={`tl-cursor-cell${view === "live" ? " live" : ""}`} style={{ left: cursor.cell * cw, width: cw, top: rowTop(cursorRow), height: TRACK_H }} />

          {tracks.map((t, row) =>
            visibleClips(t).map((c) => {
              const moving = shift(c);
              const length = gesture?.kind === "resize" && gesture.id === c.id ? Math.max(1, gesture.length0 + gesture.dx) : c.length;
              return (
                <div
                  key={c.id}
                  data-clip={c.id}
                  className={`tl-clip${selected.has(c.id) ? " selected" : ""}${moving ? " moving" : ""}${c.visible ? "" : " off"}`}
                  style={{ left: (moving?.left ?? c.start * cw) + 1, top: moving?.top ?? rowTop(row), width: length * cw - 2, height: TRACK_H }}
                  title={`${c.name} · celdas ${c.start + 1}–${c.start + c.length}`}
                >
                  {length * cw >= 20 && <Thumb filmId={filmId} asset={c.media.thumb} />}
                  {length > 1 && cw * length >= 40 && <span className="tl-len">×{length}</span>}
                  <span className="tl-edge" data-edge="1" />
                </div>
              );
            }),
          )}

          {columns && (
            <>
              <div
                className={`tl-colsel${gesture?.kind === "columns" && gesture.moved ? " from" : ""}`}
                style={{ left: columns.start * cw, width: (columns.end - columns.start) * cw, top: RULER_H, height: height - RULER_H }}
              />
              {gesture?.kind === "columns" && gesture.moved && (
                <div
                  className="tl-colsel ghost"
                  style={{ left: Math.max(0, columns.start + gesture.dx) * cw, width: (columns.end - columns.start) * cw, top: RULER_H, height: height - RULER_H }}
                />
              )}
            </>
          )}

          {/* Where each of the other cameras puts its photos. */}
          {rigs.map((r, i) => {
            if (r.id === activeRig) return null;
            const row = tracks.findIndex((t) => t.id === r.target.track);
            if (row < 0) return null;
            const color = RIG_COLORS[i % RIG_COLORS.length];
            return (
              <div key={r.id} className="tl-rig" style={{ left: r.target.cell * cw, width: cw, top: rowTop(row), height: TRACK_H, borderColor: color }}>
                <span style={{ background: color }}>{i + 1}</span>
              </div>
            );
          })}

          {/* The selected cell, across every row; it stays marked while playing. */}
          <div className={`tl-selected${playing ? " playing" : ""}`} style={{ left: cursor.cell * cw, width: cw, height }} />
          {playing && <div className="tl-play" ref={playRef} style={{ height }} />}

          {gesture?.kind === "band" && (
            <div
              className="tl-band"
              style={{
                left: Math.min(gesture.x0, gesture.x1),
                top: Math.min(gesture.y0, gesture.y1),
                width: Math.abs(gesture.x1 - gesture.x0),
                height: Math.abs(gesture.y1 - gesture.y0),
              }}
            />
          )}

          <button
            className="btn small ghost tl-extend"
            style={{ left: cells * cw + 8, top: rowsTop }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => extendFilm(film, 1)}
            title="Agregar un segundo de celdas vacías al final"
          >
            + 1 s
          </button>
        </div>
      </div>

      <input
        ref={cellInput}
        data-role="cell-image"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && pickAt.current) void setCellImage(f, pickAt.current);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInput}
        data-role="video-track"
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setVideo({ file: f, mode: "track" });
          e.target.value = "";
        }}
      />
      {video && <VideoImportDialog file={video.file} mode={video.mode} onClose={() => setVideo(null)} />}
    </div>
  );
}
