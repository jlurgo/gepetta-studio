import { type CellIndex, type Clip, type ClipId, type Track, cellIndex, clipEnd, composeTransforms, columnsContain, fadeAt, extendColumns, playedCell, stackAt, toggleColumns } from "@gepetta/core";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type CellItem, CellCanvas } from "./CellCanvas";
import { addTrack, extendFilm, setLoopLength, importImages, moveClips, moveColumns, setCellImage } from "../state/actions";
import { playbackCell, useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { type Rig, rigColor, shotOn, useCamera } from "../state/camera";
import { Icon } from "./Icon";
import { capturePointer } from "./pointer";
import { OpacitySlider } from "./TrackPanel";

const RULER_H = 22;
/** Every row (results and tracks) has the same height: a uniform grid. */
const RESULT_H = 54;
const TRACK_H = RESULT_H;
const ROW_GAP = 4;
/** Cell width in pixels: the timeline's zoom. */
const MIN_CW = 4;
const MAX_CW = 240;
const ZOOM_KEY = "gepetta.timelineZoom";
/** Empty cells shown past the end, to place pictures there. */
const TAIL_SECONDS = 2;

const mod = (v: number, n: number) => ((v % n) + n) % n;

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

type Gesture =
  | { kind: "move"; x0: number; y0: number; id: ClipId; ids: ClipId[]; moved: boolean; dx: number; dy: number }
  | { kind: "resize"; x0: number; id: ClipId; length0: number; dx: number }
  | { kind: "band"; x0: number; y0: number; x1: number; y1: number; add: boolean; base: ClipId[] }
  | { kind: "columns"; x0: number; dx: number; moved: boolean }
  /** A loop film: turning the drum (dragging the ruler), or its length (dragging where it starts again). */
  | { kind: "turn"; cx0: number; rot0: number; moved: boolean }
  | { kind: "length"; x0: number; seam: number; dx: number };

function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z >= MIN_CW && z <= MAX_CW ? z : 32;
  } catch {
    return 32;
  }
}

function saveZoom(z: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(Math.round(z)));
  } catch {
    // Not remembered.
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
  const picking = useCamera((s) => s.picking);
  /** While picking a camera's cell: the cell under the pointer. */
  const [hover, setHover] = useState<{ track: string; cell: number; v: number } | null>(null);
  const [cw, setCw] = useState(loadZoom);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 1200 });
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  /** The picture ranges start from (the last one picked), and the last one pressed (for double/triple clicks). */
  const anchorRef = useRef<ClipId | null>(null);
  const lastDown = useRef<ClipId | null>(null);
  // Pointer events can arrive faster than React re-renders: handlers read the ref.
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = (g: Gesture | null) => {
    gestureRef.current = g;
    setGestureState(g);
  };
  const cellInput = useRef<HTMLInputElement>(null);
  const pickAt = useRef<{ track: string; cell: number } | null>(null);
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

  // Zoom with ⌘/Ctrl + wheel, or pinching on a trackpad (which arrives as a wheel with Ctrl),
  // keeping the cell under the pointer where it is.
  const zoomAnchor = useRef<{ cell: number; x: number } | null>(null);
  const cwRef = useRef(cw);
  cwRef.current = cw;

  /**
   * A loop film is a drum: one turn of it, the film once, turned so that cell
   * `rot` shows first. Turning it shows the cells after the last one, from the first.
   */
  const [rot, setRot] = useState(0);
  const rotRef = useRef(0);
  const turn = (to: number) => {
    const length = useEditor.getState().film?.length ?? 0;
    if (!length) return;
    const r = mod(Math.round(to), length);
    if (r === rotRef.current) return;
    rotRef.current = r;
    setRot(r);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let turning = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Sideways scrolling turns a loop film's drum.
        const f = useEditor.getState().film;
        const d = e.deltaX || (e.shiftKey ? e.deltaY : 0);
        if (!f?.settings.loop || !d) return;
        e.preventDefault();
        turning += d;
        const steps = Math.trunc(turning / cwRef.current);
        if (steps) {
          turning -= steps * cwRef.current;
          turn(rotRef.current + steps);
        }
        return;
      }
      e.preventDefault();
      const x = e.clientX - el.getBoundingClientRect().left;
      const current = cwRef.current;
      const next = Math.max(MIN_CW, Math.min(MAX_CW, current * Math.exp(-e.deltaY * 0.01)));
      if (next === current) return;
      zoomAnchor.current = { cell: (el.scrollLeft + x) / current, x };
      setCw(next);
      saveZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, a.cell * cw - a.x);
  }, [cw]);

  // Keep the cursor in view when it moves: centered when it moves on by itself
  // (photos, recording), the timeline running under it; just in view otherwise (keys, clicks).
  const cursorAlong = useEditor((s) => s.cursorAlong);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const f = useEditor.getState().film;
    if (f?.settings.loop && f.length) {
      // A drum turns instead (when it does not fit whole).
      const view = Math.floor(el.clientWidth / cw);
      if (f.length <= view) return;
      const shown = mod(cursor.cell - rotRef.current, f.length);
      if (cursorAlong || shown >= view - 1) turn(cursor.cell - Math.floor(view / 2));
      return;
    }
    const x = cursor.cell * cw;
    if (cursorAlong) el.scrollLeft = Math.max(0, x + cw / 2 - el.clientWidth / 2);
    else if (x < el.scrollLeft) el.scrollLeft = x - cw;
    else if (x + cw > el.scrollLeft + el.clientWidth) el.scrollLeft = x + 2 * cw - el.clientWidth;
  }, [cursor.cell, cw, cursorAlong]);

  // A drum does not scroll sideways (it turns): back to the start when the film becomes a loop.
  const isLoop = useEditor((s) => !!s.film?.settings.loop);
  useLayoutEffect(() => {
    if (isLoop && scroller.current) scroller.current.scrollLeft = 0;
  }, [isLoop]);

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
      if (f.settings.loop && f.length) {
        // The drum turns under the line, which stays in the middle (a drum that fits whole stays still).
        const now = playedCell(f, playbackCell(playback, f.settings.fps));
        const view = Math.floor(el.clientWidth / cw);
        if (f.length > view) turn(now - Math.floor(view / 2));
        line.style.transform = `translateX(${(rotRef.current + mod(now - rotRef.current, f.length)) * cw}px)`;
        line.style.width = `${cw}px`;
        return;
      }
      const cell = Math.max(0, Math.min(f.length - 1, playbackCell(playback, f.settings.fps)));
      const x = cell * cw;
      line.style.transform = `translateX(${x}px)`;
      line.style.width = `${cw}px`;
      // The line stays in the middle and the timeline runs under it.
      el.scrollLeft = Math.max(0, x + cw / 2 - el.clientWidth / 2);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, cw]);

  if (!film || !filmId) return null;
  const fps = film.settings.fps;
  const tracks = [...film.tracks].reverse(); // top first, like the picture
  // A loop film is a drum (see `rot`): cells of the timeline from `r` on, `wrap` takes them to the film's.
  const loop = !!film.settings.loop && film.length > 0;
  const period = loop ? film.length : 0;
  const wrap = (v: number) => (loop ? mod(v, period) : v);
  const r = loop ? mod(rot, period) : 0;
  const viewCells = Math.max(1, Math.ceil(scroll.width / cw));
  /** The whole drum fits: it shows once, with room after it to make it longer. */
  const whole = loop && period < viewCells;
  const cells = loop ? period : film.length + TAIL_SECONDS * fps;
  const firstCell = loop ? r : Math.max(0, Math.floor(scroll.left / cw) - 1);
  const lastCell = loop ? r + Math.min(period, viewCells + 1) : Math.min(cells, Math.ceil((scroll.left + scroll.width) / cw) + 1);
  /** How far the drum is turned, in pixels. */
  const shiftX = r * cw;
  /** The laps on screen (just one, the film, when it is not a loop), and where each starts. */
  const laps: number[] = [];
  if (loop) for (let l = Math.floor(firstCell / period); l <= Math.floor(Math.max(firstCell, lastCell - 1) / period); l++) laps.push(l);
  else laps.push(0);
  const lapX = (lap: number) => lap * period * cw;
  const rowsTop = RULER_H + ROW_GAP + RESULT_H + ROW_GAP;
  const rowTop = (i: number) => rowsTop + i * (TRACK_H + ROW_GAP);
  const height = rowTop(tracks.length);
  const selected = new Set(selection);
  const aspect = film.settings.width / film.settings.height;

  const onScroll = (el: HTMLDivElement) => setScroll({ left: el.scrollLeft, width: el.clientWidth });

  /** Zoom buttons: around the cursor. */
  const zoomBy = (factor: number) => {
    const el = scroller.current;
    const next = Math.max(MIN_CW, Math.min(MAX_CW, cw * factor));
    if (el && !loop) zoomAnchor.current = { cell: cursor.cell + 0.5, x: (cursor.cell + 0.5) * cw - el.scrollLeft };
    setCw(next);
    saveZoom(next);
  };

  /** Cell and track row under a pointer event, in the canvas. */
  const at = (e: { clientX: number; clientY: number }) => {
    const box = scroller.current!.getBoundingClientRect();
    const x = e.clientX - box.left + scroller.current!.scrollLeft + shiftX;
    const y = e.clientY - box.top + scroller.current!.scrollTop;
    const v = Math.max(0, Math.floor(x / cw));
    const row = Math.floor((y - rowsTop) / (TRACK_H + ROW_GAP));
    return { x, y, v, cell: wrap(v), row, track: y >= rowsTop && row < tracks.length ? tracks[row]! : null };
  };

  // Results row: one box per run of cells that look the same (empty cells get none).
  const runs: { start: number; end: number }[] = [];
  {
    let prev = "";
    for (let c = firstCell; c < (loop ? lastCell : Math.min(lastCell, film.length)); c++) {
      // A loop's runs end where it starts again.
      if (loop && wrap(c) === 0) prev = "";
      const key = stackAt(film, wrap(c), { index })
        .map((s) => s.clipId)
        .join("|");
      if (key && runs.length && key === prev && runs[runs.length - 1]!.end === c) runs[runs.length - 1]!.end = c + 1;
      else if (key) runs.push({ start: c, end: c + 1 });
      prev = key;
    }
  }

  /** Pictures in the block between two pictures: the rows from one to the other, and the cells they span. */
  const rangeBetween = (a: Clip, b: Clip): ClipId[] => {
    const ra = tracks.findIndex((t) => t.id === a.track);
    const rb = tracks.findIndex((t) => t.id === b.track);
    const rows = new Set(tracks.slice(Math.min(ra, rb), Math.max(ra, rb) + 1).map((t) => t.id));
    const from = Math.min(a.start, b.start);
    const to = Math.max(clipEnd(a), clipEnd(b));
    return Object.values(film.clips)
      .filter((c) => rows.has(c.track) && c.start < to && clipEnd(c) > from)
      .map((c) => c.id);
  };
  /** The picture and the ones right after it in its track, up to the first empty cell. */
  const runFrom = (c: Clip): ClipId[] => {
    const list = index.get(c.track) ?? [];
    const out: ClipId[] = [];
    let end = c.start;
    for (const x of list) {
      if (x.start < c.start) continue;
      if (x.start !== end) break;
      out.push(x.id);
      end = clipEnd(x);
    }
    return out;
  };
  /** The picture and every one after it in its track. */
  const forwardFrom = (c: Clip): ClipId[] => (index.get(c.track) ?? []).filter((x) => x.start >= c.start).map((x) => x.id);

  /** A camera's live picture as a cell item, drawn as its track draws pictures. */
  const liveItem = (rigId: string, track: Track): CellItem => ({
    kind: "live",
    frame: () => {
      const camera = useCamera.getState();
      const rig = camera.rigs.find((r) => r.id === rigId);
      return rig ? camera.liveOf(rig) : null;
    },
    ...shotOn(rigs.find((r) => r.id === rigId), track),
  });
  const clipItem = (track: Track, c: Clip, cell: number): CellItem => ({
    kind: "picture",
    media: c.media,
    opacity: c.opacity * fadeAt(c, cell),
    transform: composeTransforms(track.transform, c.transform),
    look: c.look,
    strokes: c.strokes,
  });
  /** Cells of a clip that are on screen. */
  const cellsOf = (c: Clip, length: number, lap: number): number[] => {
    const out: number[] = [];
    const from = firstCell - lap * period;
    const to = lastCell - lap * period;
    for (let cell = Math.max(c.start, from); cell < Math.min(c.start + length, to); cell++) out.push(cell);
    return out;
  };
  // Results row: the film at each cell on screen, with every camera live where it aims.
  // A loop film: a camera aims inside the drum.
  const liveTargets = rigs.filter((r) => r.source).map((r) => ({ id: r.id, target: { ...r.target, cell: wrap(r.target.cell) } }));
  const resultCells: { cell: number; items: CellItem[] }[] = [];
  for (let c = firstCell; c < lastCell; c++) {
    const stack = wrap(c) < film.length ? stackAt(film, wrap(c), { index }) : [];
    const lives = liveTargets.filter((l) => l.target.cell === wrap(c));
    if (!stack.length && !lives.length) continue;
    const items: CellItem[] = [];
    for (const t of film.tracks) {
      if (!t.visible) continue;
      const live = lives.find((l) => l.target.track === t.id);
      if (live) items.push(liveItem(live.id, t));
      else {
        const it = stack.find((i) => i.trackId === t.id);
        if (it) items.push({ kind: "picture", media: it.media, opacity: it.opacity, transform: it.transform, look: it.look, strokes: it.strokes });
      }
    }
    resultCells.push({ cell: c, items });
  }

  const visibleClips = (track: Track, lap: number): Clip[] =>
    (index.get(track.id) ?? []).filter((c) => clipEnd(c) > firstCell - lap * period && c.start < lastCell - lap * period);

  // -- pointer gestures ------------------------------------------------------

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = at(e);
    if (picking) {
      // Picking where a camera's photos go: this click only does that.
      if (p.track) useCamera.getState().pick({ track: p.track.id, cell: p.cell });
      setHover(null);
      return;
    }
    if (p.y < RULER_H) {
      if (loop) {
        // A loop: drag where it starts again to make it longer or shorter; drag the ruler to turn the drum.
        capturePointer(e);
        const seam = (e.target as HTMLElement).closest<HTMLElement>("[data-seam]");
        if (seam) setGesture({ kind: "length", x0: p.x, seam: Number(seam.dataset.seam), dx: 0 });
        else setGesture({ kind: "turn", cx0: e.clientX, rot0: r, moved: false });
        return;
      }
      // Ruler: pick the moment and show the film there.
      useEditor.getState().moveTo(p.cell, undefined);
      return;
    }
    if (p.y < rowsTop) {
      // Results: pick the column (the film as it comes out there); ⇧ extends, ⌘/Ctrl adds or takes out; drag one stretch to move it.
      const { setColumns, moveTo } = useEditor.getState();
      const shownRun = runs.find((r) => p.v >= r.start && p.v < r.end);
      // An empty cell (or a camera's live one) is a column of its own.
      const live = rigs.some((r) => r.source && wrap(r.target.cell) === p.cell);
      const run = shownRun
        ? { start: wrap(shownRun.start), end: wrap(shownRun.start) + shownRun.end - shownRun.start }
        : p.cell < film!.length || live
          ? { start: p.cell, end: p.cell + 1 }
          : null;
      moveTo(p.cell, undefined);
      if (!run) return setColumns(null);
      const picked = columns ?? [];
      if (e.shiftKey) return setColumns(extendColumns(picked, run));
      if (e.metaKey || e.ctrlKey) return setColumns(toggleColumns(picked, run));
      if (!columnsContain(picked, p.cell)) setColumns([run]);
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
      const add = e.metaKey || e.ctrlKey;
      const anchor = anchorRef.current ? film!.clips[anchorRef.current] : undefined;
      let ids = selection;
      if (e.shiftKey && anchor) {
        // ⇧: everything between the last picked picture and this one (⌘/Ctrl too: added).
        const range = rangeBetween(anchor, clip);
        ids = add ? [...new Set([...selection, ...range])] : range;
      } else if (add) {
        ids = selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id];
        anchorRef.current = id;
      } else {
        if (!selected.has(id)) ids = [id];
        anchorRef.current = id;
      }
      lastDown.current = id;
      setSelection(ids);
      useEditor.getState().moveTo(Math.max(clip.start, Math.min(p.cell, clipEnd(clip) - 1)), clip.track);
      if (ids.length === 1) useLayers.getState().showClip(clip.track);
      if (ids.includes(id)) setGesture({ kind: "move", x0: p.x, y0: p.y, id, ids, moved: false, dx: 0, dy: 0 });
      return;
    }
    lastDown.current = null;
    setGesture({ kind: "band", x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey || e.metaKey || e.ctrlKey, base: selection });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (picking) {
      const p = at(e);
      const next = p.track ? { track: p.track.id, cell: p.cell, v: p.v } : null;
      if (next?.track !== hover?.track || next?.v !== hover?.v) setHover(next);
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    const p = at(e);
    if (gesture.kind === "turn") {
      const dx = e.clientX - gesture.cx0;
      if (gesture.moved || Math.abs(dx) > 4) {
        if (!gesture.moved) setGesture({ ...gesture, moved: true });
        turn(gesture.rot0 - Math.round(dx / cw));
      }
      return;
    }
    if (gesture.kind === "length") {
      const dx = Math.max(1 - period, Math.round((p.x - gesture.x0) / cw));
      if (dx !== gesture.dx) setGesture({ ...gesture, dx });
      return;
    }
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
          return laps.some((l) => c.start * cw + lapX(l) < x1 && clipEnd(c) * cw + lapX(l) > x0) && top < y1 && top + TRACK_H > y0;
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
    if (g.kind === "turn") {
      if (!g.moved) useEditor.getState().moveTo(p.cell, undefined);
      return;
    }
    if (g.kind === "length") {
      if (g.dx) setLoopLength(film!.length + g.dx);
      return;
    }
    if (g.kind === "move" && g.moved && (g.dx || g.dy)) {
      const moves = g.ids.map((id) => {
        const c = film!.clips[id]!;
        const row = tracks.findIndex((t) => t.id === c.track);
        const to = tracks[Math.max(0, Math.min(tracks.length - 1, row + g.dy))]!;
        return { id, track: to.id, start: wrap(c.start + g.dx) };
      });
      if (moves.every((m) => m.start >= 0)) moveClips(moves);
    } else if (g.kind === "move" && !g.moved && !(e.shiftKey || e.metaKey || e.ctrlKey) && e.detail < 2) {
      // A plain click on a picture of a group picks just that one.
      useEditor.getState().setSelection([g.id]);
      useLayers.getState().showClip(film!.clips[g.id]!.track);
    } else if (g.kind === "columns") {
      if (g.moved && g.dx) moveColumns(g.dx);
    } else if (g.kind === "resize" && g.dx) {
      const length = Math.max(1, g.length0 + g.dx);
      useEditor.getState().commit([{ type: "clip.update", id: g.id, patch: { length } }]);
    } else if (g.kind === "band" && Math.abs(p.x - g.x0) + Math.abs(p.y - g.y0) <= 4 && p.track) {
      // A click on an empty cell: that is where the next picture goes.
      if (!g.add) useEditor.getState().setSelection([]);
      useEditor.getState().setColumns(null);
      useEditor.getState().moveTo(p.cell, p.track.id);
    }
  }

  /** Double click: the connected row from the picture on; triple: the whole track from it on. */
  function onClick(e: React.MouseEvent) {
    if (e.detail < 2 || !lastDown.current) return;
    const clip = film!.clips[lastDown.current];
    if (!clip) return;
    const ids = e.detail === 2 ? runFrom(clip) : forwardFrom(clip);
    useEditor.getState().setSelection(ids);
    anchorRef.current = clip.id;
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
  const shift = (c: Clip, lap: number): { left: number; top: number } | null => {
    if (!gesture || gesture.kind !== "move" || !gesture.moved || !selected.has(c.id)) return null;
    const row = tracks.findIndex((t) => t.id === c.track);
    const to = Math.max(0, Math.min(tracks.length - 1, row + gesture.dy));
    return { left: Math.max(0, c.start + gesture.dx) * cw + lapX(lap), top: rowTop(to) };
  };

  const ticks: number[] = [];
  // Labels at least ~28 px apart: every cell, or every 2, 3, 6 or 12…
  const every = [1, 2, 3, 6, 12, 24, 48, 96].find((n) => n * cw >= 28) ?? 96;
  for (let c = firstCell - (firstCell % every); c < lastCell; c += every) ticks.push(c);
  const cursorRow = Math.max(0, tracks.findIndex((t) => t.id === cursor.track));

  const pickIndex = rigs.findIndex((r) => r.id === picking);
  const pickColor = rigColor(pickIndex);

  return (
    <div className="timeline-wrap">
      {picking && pickIndex >= 0 && <PickingBar index={pickIndex} rig={rigs[pickIndex]!} color={pickColor} />}
      <div className={`timeline${picking ? " picking" : ""}${loop ? " drum" : ""}`} style={{ ["--thumb-aspect" as string]: aspect, ...(picking && { ["--rig" as string]: pickColor }) }}>
        <div className="tl-heads" style={{ minHeight: height + 40 }}>
          <div className="tl-head ruler" style={{ height: RULER_H }}>
            <button className="icon-btn small" onClick={() => zoomBy(1 / 1.5)} title="Alejar (⌘ + rueda, o pellizcar en el pad)">
              <Icon name="minus" size={14} />
            </button>
            <button className="icon-btn small" onClick={() => zoomBy(1.5)} title="Acercar (⌘ + rueda, o pellizcar en el pad)">
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div className="tl-head main" style={{ height: RESULT_H }}>
            Resultado
          </div>
          {tracks.map((t) => (
            <TrackHead key={t.id} track={t} current={t.id === cursor.track} />
          ))}
          <button className="btn small ghost tl-add" onClick={() => addTrack()} title="Agregar un track vacío arriba (imágenes y videos: herramienta «Imágenes y videos»)">
            <Icon name="plus" size={14} /> Track
          </button>
        </div>

        <div className="tl-body" ref={scroller} onScroll={(e) => onScroll(e.currentTarget)}>
          <div
            className="tl-canvas"
            style={{ width: loop ? (whole ? period * cw + 120 : scroll.width) : cells * cw + 120, height: height + 40 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <div className="tl-drum" style={loop ? { transform: `translateX(${-shiftX}px)` } : undefined}>
            <div className="tl-ruler" style={{ height: RULER_H }}>
              {ticks.map((v) => {
                const c = wrap(v);
                return (
                  <span key={v} className={c % fps === 0 ? "sec" : ""} style={{ left: v * cw }}>
                    {c % fps === 0 ? `${c / fps}s` : c + 1}
                  </span>
                );
              })}
              {/* Where a loop starts again. */}
              {loop &&
                laps.map((l) => (
                  <span
                    key={`seam-${l}`}
                    data-seam={l * period}
                    className="tl-seam-label"
                    style={{ left: lapX(l) }}
                    title={`Acá la película vuelve a empezar (${period} celdas): arrastralo para alargarla o acortarla`}
                  >
                    ↻ {period}
                  </span>
                ))}
            </div>

            {resultCells.map(({ cell, items }) => (
              <div key={cell} className="tl-result" style={{ left: cell * cw + 1, width: cw - 2, top: RULER_H + ROW_GAP, height: RESULT_H }}>
                <CellCanvas filmId={filmId} film={film.settings} items={items} />
              </div>
            ))}

            {tracks.map((t, i) => (
              <div
                key={t.id}
                className={`tl-row${t.id === cursor.track ? " current" : ""}${t.visible ? "" : " off"}`}
                style={{ top: rowTop(i), height: TRACK_H, backgroundSize: `${cw}px 100%` }}
              />
            ))}

            {/* The cell looked at (where an import goes). */}
            {laps.map((l) => (
              <div key={l} className="tl-cursor-cell" style={{ left: wrap(cursor.cell) * cw + lapX(l), width: cw, top: rowTop(cursorRow), height: TRACK_H }} />
            ))}

            {laps.map((lap) =>
              tracks.map((t, row) =>
              visibleClips(t, lap).map((c) => {
                const moving = shift(c, lap);
                const length = gesture?.kind === "resize" && gesture.id === c.id ? Math.max(1, gesture.length0 + gesture.dx) : c.length;
                return (
                  <div
                    key={`${lap}:${c.id}`}
                    data-clip={c.id}
                    className={`tl-clip${selected.has(c.id) ? " selected" : ""}${moving ? " moving" : ""}${c.visible ? "" : " off"}`}
                    style={{ left: (moving?.left ?? c.start * cw + lapX(lap)) + 1, top: moving?.top ?? rowTop(row), width: length * cw - 2, height: TRACK_H }}
                    title={`${c.name} · celdas ${c.start + 1}–${c.start + c.length}`}
                  >
                    {cellsOf(c, length, lap).map((cell) => (
                      <div key={cell} className="tl-clip-cell" style={{ left: (cell - c.start) * cw, width: cw - (cell === c.start + length - 1 ? 2 : 0) }}>
                        <CellCanvas filmId={filmId} film={film.settings} items={[clipItem(t, c, cell)]} />
                      </div>
                    ))}
                    {length > 1 && cw * length >= 40 && <span className="tl-len">×{length}</span>}
                    <span className="tl-edge" data-edge="1" />
                  </div>
                );
              }),
              ),
            )}

            {columns &&
              laps.map((l) =>
                columns.map((c) => (
                  <Fragment key={`${l}:${c.start}`}>
                    <div
                      className={`tl-colsel${gesture?.kind === "columns" && gesture.moved ? " from" : ""}`}
                      style={{ left: c.start * cw + lapX(l), width: (c.end - c.start) * cw, top: RULER_H, height: height - RULER_H }}
                    />
                    {gesture?.kind === "columns" && gesture.moved && columns.length === 1 && (
                      <div
                        className="tl-colsel ghost"
                        style={{ left: Math.max(0, c.start + gesture.dx) * cw + lapX(l), width: (c.end - c.start) * cw, top: RULER_H, height: height - RULER_H }}
                      />
                    )}
                  </Fragment>
                )),
              )}

            {/* Each camera live in the cell it aims at. */}
            {laps.map((l) => rigs.map((r) => {
              if (!r.source) return null;
              const target = r.target;
              const row = tracks.findIndex((t) => t.id === target.track);
              const v = wrap(target.cell) + l * period;
              if (row < 0 || v < firstCell || v > lastCell) return null;
              const track = tracks[row]!;
              return (
                <div key={`live-${l}-${r.id}`} className="tl-livecell" style={{ left: v * cw + 1, width: cw - 2, top: rowTop(row), height: TRACK_H }}>
                  <CellCanvas filmId={filmId} film={film.settings} items={[liveItem(r.id, { ...track, opacity: 1 })]} />
                </div>
              );
            }))}

            {/* Where each camera puts its photos (not while its cell is being picked again). */}
            {laps.map((l) => rigs.map((r, i) => {
              if (r.id === picking) return null;
              const row = tracks.findIndex((t) => t.id === r.target.track);
              if (row < 0) return null;
              const color = rigColor(i);
              return (
                <div key={`${l}-${r.id}`} className={`tl-rig${r.id === activeRig ? " active" : ""}`} style={{ left: wrap(r.target.cell) * cw + lapX(l), width: cw, top: rowTop(row), height: TRACK_H, borderColor: color }}>
                  <span style={{ background: color }}>{i + 1}</span>
                </div>
              );
            }))}

            {/* While picking a camera's cell: where it would go. */}
            {picking && hover && (
              <div className="tl-pick" style={{ left: hover.v * cw, width: cw, top: rowTop(tracks.findIndex((t) => t.id === hover.track)), height: TRACK_H }}>
                <Icon name="camera" size={Math.min(18, cw - 6)} />
              </div>
            )}

            {/* The selected cell, across every row; it stays marked while playing. */}
            {laps.map((l) => (
              <div key={l} className={`tl-selected${playing ? " playing" : ""}`} style={{ left: wrap(cursor.cell) * cw + lapX(l), width: cw, height }} />
            ))}
            {loop && laps.map((l) => <div key={`seam-${l}`} className="tl-seam" style={{ left: lapX(l), height }} />)}
            {gesture?.kind === "length" && (
              <div className="tl-seam ghost" style={{ left: (gesture.seam + gesture.dx) * cw, height }}>
                <span>{period + gesture.dx} celdas</span>
              </div>
            )}
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

            {!loop && <button
              className="btn small ghost tl-extend"
              style={{ left: cells * cw + 8, top: rowsTop }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => extendFilm(film, 1)}
              title="Agregar un segundo de celdas vacías al final"
            >
              + 1 s
            </button>}
            </div>
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
      </div>
    </div>
  );
}

/** Says which camera's cell is being picked, until one is (or Esc). */
function PickingBar({ index, rig, color }: { index: number; rig: Rig; color: string }) {
  const label = useCamera((s) => s.labelOf(rig.source?.id ?? rig.deviceId)) ?? "la cámara";
  return (
    <div className="tl-picking-bar" style={{ ["--rig" as string]: color }}>
      <span className="rig-dot" style={{ background: color }}>
        {index + 1}
      </span>
      <span>
        Tocá la celda donde van las fotos de <strong>{label}</strong>
      </span>
      <button className="btn small" onClick={() => useCamera.getState().cancelPicking()}>
        Cancelar (Esc)
      </button>
    </div>
  );
}
