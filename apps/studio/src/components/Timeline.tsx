import { type CellIndex, type Clip, type ClipId, type GroupId, type Op, PEAKS_PER_SECOND, type TimelineRow, type Track, type TrackId, cellIndex, groupTracks, groupWithin, timelineRows, clipEnd, composeTransforms, columnsContain, fadeAt, extendColumns, playedCell, stackAt, toggleColumns } from "@gepetta/core";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type CellItem, CellCanvas } from "./CellCanvas";
import { addTrack, extendFilm, resizeDrum, importImages, importSounds, moveClips, moveColumns, setCellImage, spanCells } from "../state/actions";
import { SFX_DRAG, insertSfx } from "../media/sfx";
import { isSoundFile, peaksNow, useSoundPeaks } from "../media/sound";
import { useSound } from "../state/sound";
import { toggleVoice, useVoice } from "../state/voice";
import { renameGroup, setLinked, toggleGroup, useGroups } from "../state/groups";
import { playbackCell, useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { type Rig, rigColor, shotOn, useCamera } from "../state/camera";
import { Icon } from "./Icon";
import { sequenceColor } from "./SequencePanel";
import { pickPlateAt } from "../state/lasso";
import { capturePointer } from "./pointer";
import { OpacitySlider } from "./TrackPanel";

const RULER_H = 22;
/** Every row (results and tracks) has the same height: a uniform grid. */
const RESULT_H = 54;
const TRACK_H = RESULT_H;
const ROW_GAP = 4;
/** A group's title row: open (its tracks below it), or closed (one row for all of them, with marks where they have pictures). */
const GROUP_OPEN_H = 22;
const GROUP_SHUT_H = 30;
/** How far in a group's tracks and groups go, per group they are in. */
const INDENT = 12;
/** Marks of a closed group's tracks, one color each. */
const MARK_COLORS = ["#7aa2ff", "#5cc8b5", "#e7c35a", "#ffb067", "#c58cff", "#ff7a9a"];

const rowHeight = (row: TimelineRow) => (row.kind === "track" ? TRACK_H : row.collapsed ? GROUP_SHUT_H : GROUP_OPEN_H);
/** Cell width in pixels: the timeline's zoom. */
const MIN_CW = 4;
const MAX_CW = 240;
const ZOOM_KEY = "gepetta.timelineZoom";
/** Empty cells shown past the end, to place pictures there. */
const TAIL_SECONDS = 2;

const mod = (v: number, n: number) => ((v % n) + n) % n;

/** A track's or group's head being dragged up or down to put it elsewhere. */
type HeadDrag = { kind: "track" | "group"; id: string; y0: number; dy: number; moved: boolean };

/** Pointer handlers of a head: a click picks (`pick`), a drag moves it (`drop`, where the pointer is let go). */
function useHeadPointer(kind: HeadDrag["kind"], id: string, setDrag: (d: HeadDrag | null) => void, pick: (e: React.PointerEvent) => void, drop: (d: HeadDrag, clientY: number) => void) {
  // This head's own press (state updates may come after the next event).
  const press = useRef<HeadDrag | null>(null);
  const follow = (d: HeadDrag | null) => {
    press.current = d;
    setDrag(d);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button:not(.tl-name), input")) return;
      capturePointer(e);
      follow({ kind, id, y0: e.clientY, dy: 0, moved: false });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = press.current;
      if (!d) return;
      const dy = e.clientY - d.y0;
      follow({ ...d, dy, moved: d.moved || Math.abs(dy) > 4 });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = press.current;
      if (!d) return;
      follow(null);
      if (!d.moved) return pick(e);
      drop(d, e.clientY);
    },
    onPointerCancel: () => follow(null),
  };
}

interface HeadProps {
  depth: number;
  drag: HeadDrag | null;
  setDrag(d: HeadDrag | null): void;
  drop(d: HeadDrag, clientY: number): void;
}

/**
 * A track's head: a click anywhere on it (but its buttons) picks the track
 * (⇧ or ⌘/Ctrl: picks several, to group them with Ctrl + G); dragging it up
 * or down puts the track elsewhere (onto a group's title: into the group).
 */
function TrackHead({ track, current, picked, pickTo, depth, drag, setDrag, drop }: HeadProps & { track: Track; current: boolean; picked: boolean; pickTo(id: TrackId, range: boolean): void }) {
  const selected = useLayers((s) => s.trackId === track.id && s.detail === "track" && s.panel === "detail");
  const dragging = drag?.moved && drag.kind === "track" && drag.id === track.id;
  const pick = (e?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e && (e.shiftKey || e.metaKey || e.ctrlKey)) return pickTo(track.id, e.shiftKey);
    useGroups.getState().setPicked([]);
    useLayers.getState().select(track.id);
    const { cursor, moveTo } = useEditor.getState();
    moveTo(cursor.cell, track.id);
  };
  const handlers = useHeadPointer("track", track.id, setDrag, pick, drop);
  return (
    <div
      className={`tl-head track${selected ? " selected" : ""}${picked ? " picked" : ""}${current ? " current" : ""}${track.visible ? "" : " off"}${dragging ? " dragging" : ""}`}
      style={{ height: TRACK_H, paddingLeft: depth * INDENT, transform: dragging ? `translateY(${drag!.dy}px)` : undefined }}
      title={`${track.name}${track.exported ? "" : " (solo referencia: no se exporta)"} — tocá para ver sus ajustes (⇧ o ⌘/Ctrl: elegir varios para agruparlos con Ctrl + G); arrastralo para cambiarlo de lugar`}
      {...handlers}
    >
      {track.kind === "sound" ? (
        <button className="icon-btn small" onClick={() => updateTrack(track.id, { visible: !track.visible })} title={track.visible ? "Silenciar" : "Que suene"}>
          <Icon name={track.visible ? "sound" : "mute"} size={15} />
        </button>
      ) : (
        <button className="icon-btn small" onClick={() => updateTrack(track.id, { visible: !track.visible })} title={track.visible ? "Ocultar" : "Mostrar"}>
          <Icon name={track.visible ? "eye" : "eyeOff"} size={15} />
        </button>
      )}
      <button className="tl-name" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick()}>
        {track.name}
        {!track.exported && <span className="ref-dot" aria-hidden />}
      </button>
      <OpacitySlider label={false} value={track.opacity} onCommit={(opacity) => updateTrack(track.id, { opacity })} />
    </div>
  );
}

/**
 * A group's title: open or close it, link or unlink its tracks, rename it
 * (double click), undo it; dragging it moves all its tracks.
 */
function GroupHead({ row, current, height, pickTo, depth, drag, setDrag, drop }: HeadProps & { row: Extract<TimelineRow, { kind: "group" }>; current: boolean; height: number; pickTo(id: TrackId, range: boolean): void }) {
  const { group, collapsed } = row;
  const [editing, setEditing] = useState(false);
  const dragging = drag?.moved && drag.kind === "group" && drag.id === group.id;
  const pick = (e: React.PointerEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) return pickTo(row.tracks.at(-1)!, e.shiftKey);
    useGroups.getState().setPicked([]);
    // A closed group is a row of its own: the cursor goes there (to its top track).
    if (collapsed) {
      const { cursor, moveTo } = useEditor.getState();
      moveTo(cursor.cell, row.tracks.at(-1)!);
    }
  };
  const handlers = useHeadPointer("group", group.id, setDrag, pick, drop);
  return (
    <div
      className={`tl-head group${collapsed ? " collapsed" : ""}${current ? " current" : ""}${dragging ? " dragging" : ""}`}
      style={{ height, paddingLeft: depth * INDENT, transform: dragging ? `translateY(${drag!.dy}px)` : undefined }}
      title={`Grupo «${group.name}» (${row.tracks.length} tracks) — arrastralo para moverlo entero; doble clic en el nombre para cambiarlo; Ctrl + ⇧ + G lo deshace`}
      {...handlers}
    >
      <button className="icon-btn small" onClick={() => toggleGroup(group.id)} title={collapsed ? "Abrir el grupo" : "Cerrar el grupo (queda una fila)"}>
        <Icon name={collapsed ? "right" : "more"} size={14} />
      </button>
      {editing ? (
        <input
          className="tl-rename"
          defaultValue={group.name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            renameGroup(group.id, e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button className="tl-name group-name" onDoubleClick={() => setEditing(true)}>
          {group.name}
        </button>
      )}
      <button
        className={`icon-btn small${group.linked ? " on" : ""}`}
        onClick={() => setLinked(group.id, !group.linked)}
        title={group.linked ? "Vinculado: lo que metas, borres, cortes o pegues en un track pasa en todos (con Alt, solo en uno). Tocá para desvincular" : "Sin vincular: cada track se edita solo. Tocá para vincular"}
      >
        <Icon name={group.linked ? "link" : "unlink"} size={14} />
      </button>
      <button className="icon-btn small" onClick={() => useEditor.getState().commit([{ type: "group.remove", id: group.id }], `Desagrupar "${group.name}"`)} title="Desagrupar (los tracks quedan donde están)">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/**
 * A sound clip's cells on screen: in each, its slice's loudness as a few
 * bars (more when the cells are wider).
 */
function SoundStrip({ filmId, clip, from, count, cw, fps }: { filmId: string; clip: Clip; from: number; count: number; cw: number; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSoundPeaks((s) => s.version);
  const h = TRACK_H - 10;
  useLayoutEffect(() => {
    const canvas = ref.current;
    const sound = clip.sound;
    if (!canvas || !sound) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(count * cw * dpr));
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const peaks = peaksNow(filmId, sound.ref);
    ctx.fillStyle = getComputedStyle(canvas).color;
    const bars = Math.max(1, Math.min(8, Math.floor(cw / 5)));
    const bw = Math.max(1, (cw - 2) / bars - 1);
    for (let i = 0; i < count; i++) {
      const t0 = sound.from + (from + i - clip.start) / fps;
      for (let b = 0; b < bars; b++) {
        const a = Math.floor((t0 + b / (bars * fps)) * PEAKS_PER_SECOND);
        const e = Math.max(a + 1, Math.floor((t0 + (b + 1) / (bars * fps)) * PEAKS_PER_SECOND));
        let m = 0;
        if (peaks) for (let k = a; k < e; k++) m = Math.max(m, peaks[k] ?? 0);
        const bh = Math.max(1, (m / 255) * (h - 2));
        ctx.fillRect(i * cw + 1 + b * (bw + 1), (h - bh) / 2, bw, bh);
      }
    }
  }, [version, clip, from, count, cw, fps, filmId, h]);
  return <canvas ref={ref} className="tl-sound" style={{ left: (from - clip.start) * cw, width: count * cw, height: h }} />;
}

/** Records with the microphone while the film plays from the cursor (again, or Esc / the bar: stops). */
function VoiceButton() {
  const recording = useVoice((s) => !!s.recording);
  const level = useVoice((s) => s.level);
  return (
    <button
      className={`btn small ghost tl-add${recording ? " recording" : ""}`}
      onClick={() => void toggleVoice()}
      title={recording ? "Parar de grabar (Esc o la barra)" : "Grabar con el micrófono desde la celda del cursor, mientras la película se reproduce (voces, ruidos); con auriculares no se graba el sonido de la película"}
    >
      <Icon name={recording ? "stop" : "mic"} size={14} /> {recording ? "Parar" : "Grabar"}
      {recording && <span className="tl-level" style={{ width: `${Math.round(level * 100)}%` }} aria-hidden />}
    </button>
  );
}

/** Opens or closes the sound effects library. */
function EffectsButton() {
  const open = useSound((s) => s.effects);
  return (
    <button className={`btn small ghost tl-add${open ? " active" : ""}`} onClick={() => useSound.getState().setEffects(!open)} title="Efectos de sonido que vienen con la app: golpes, pasos, puertas, boings, música…">
      <Icon name="sound" size={14} /> Efectos
    </button>
  );
}

type Gesture =
  | { kind: "move"; x0: number; y0: number; id: ClipId; ids: ClipId[]; moved: boolean; dx: number; dy: number }
  | { kind: "resize"; x0: number; id: ClipId; length0: number; dx: number }
  | { kind: "band"; x0: number; y0: number; x1: number; y1: number; add: boolean; base: ClipId[] }
  | { kind: "columns"; x0: number; dx: number; moved: boolean }
  /** A loop film: turning the drum (dragging the ruler), or its length (dragging the mark where the drum ends). */
  | { kind: "turn"; cx0: number; rot0: number; moved: boolean }
  | { kind: "length"; x0: number; dx: number }
  /** Dragging a camera's live cell (where its photos go) to another cell. */
  | { kind: "live"; rig: string; x0: number; y0: number; moved: boolean; to: { track: TrackId; cell: number; v: number } | null };

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

/**
 * The track cell under the pointer, if it moved there after the cursor last
 * moved (null otherwise), for the 1–9 keys that send a camera there.
 */
let hovered: { track: TrackId; cell: number } | null = null;
// Moving the cursor (arrows, a click, the controller) makes it the place again, until the pointer moves.
useEditor.subscribe((s, prev) => {
  if (s.cursor !== prev.cursor) hovered = null;
});

export function hoveredCell(): { track: TrackId; cell: number } | null {
  return hovered;
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
  const span = useEditor((s) => s.span);
  const collapsed = useGroups((s) => s.collapsed);
  const picked = useGroups((s) => s.picked);
  const headsRef = useRef<HTMLDivElement>(null);
  const shownSeq = useLayers((s) => (s.detail === "sequence" ? s.seq : null));
  /** While picking a camera's cell: the cell under the pointer. */
  const [hover, setHover] = useState<{ track: string; cell: number; v: number } | null>(null);
  const [cw, setCw] = useState(loadZoom);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 1200 });
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const [headDrag, setHeadDrag] = useState<HeadDrag | null>(null);
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
  const soundInput = useRef<HTMLInputElement>(null);
  const scrub = useSound((s) => s.scrub);
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
  // Top first, like the picture: groups' titles above their tracks (hidden while closed).
  const rows = timelineRows(film, collapsed);
  const tracks = rows.flatMap((row) => (row.kind === "track" ? [row.track] : []));
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
  /** Cells of the drum on screen: all of it, or as many whole ones as fit. Its end is a fixed mark after them. */
  const shown = loop ? (whole ? period : Math.max(1, Math.min(period, Math.floor(scroll.width / cw)))) : 0;
  const lastCell = loop ? r + shown : Math.min(cells, Math.ceil((scroll.left + scroll.width) / cw) + 1);
  /** How far the drum is turned, in pixels. */
  const shiftX = r * cw;
  /** The laps on screen (just one, the film, when it is not a loop), and where each starts. */
  const laps: number[] = [];
  if (loop) for (let l = Math.floor(firstCell / period); l <= Math.floor(Math.max(firstCell, lastCell - 1) / period); l++) laps.push(l);
  else laps.push(0);
  const lapX = (lap: number) => lap * period * cw;
  const rowsTop = RULER_H + ROW_GAP + RESULT_H + ROW_GAP;
  const tops: number[] = [];
  let height = rowsTop;
  for (const row of rows) {
    tops.push(height);
    height += rowHeight(row) + ROW_GAP;
  }
  /** Each track's row: its own, or its closed group's. */
  const rowIndex = new Map<TrackId, number>();
  rows.forEach((row, i) => {
    if (row.kind === "track") rowIndex.set(row.track.id, i);
    else if (row.collapsed) for (const t of row.tracks) rowIndex.set(t, i);
  });
  const rowOf = (track: TrackId) => rowIndex.get(track) ?? -1;
  const topOf = (track: TrackId) => tops[rowOf(track)] ?? 0;
  const heightOf = (track: TrackId) => (rowOf(track) < 0 ? TRACK_H : rowHeight(rows[rowOf(track)]!));
  /** The row at a height in the timeline (from its top), -1 above the tracks. */
  const rowAtY = (y: number) => {
    if (y < rowsTop) return -1;
    const i = tops.findIndex((t, k) => y < t + rowHeight(rows[k]!) + ROW_GAP);
    return i < 0 ? rows.length - 1 : i;
  };
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
    const row = rowAtY(y);
    const shown = rows[row];
    // A closed group's row stands for its top track.
    const track = !shown || y >= height ? null : shown.kind === "track" ? shown.track : shown.collapsed ? film.tracks.find((t) => t.id === shown.tracks.at(-1)) ?? null : null;
    return { x, y, v, cell: wrap(v), row, track };
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

  /**
   * Adds (or takes out) cells where the drum ends on screen, keeping the drum
   * turned so that it still starts with the same cell.
   */
  const resizeAtEnd = (delta: number) => {
    const at = wrap(r + shown);
    const end = at === 0 ? period : at;
    let next = r;
    if (delta > 0) next = end <= r ? r + delta : r;
    else {
      const k = Math.min(period - 1, -delta);
      // Cells taken out before the first one shown move it back.
      for (let i = 1; i <= k; i++) if (mod(end - i, period) < r) next--;
    }
    resizeDrum(at, delta);
    rotRef.current = -1;
    turn(next);
  };

  // -- pointer gestures ------------------------------------------------------

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // A click lets picked cells go, as in a text.
    useEditor.getState().setSpan(null);
    const p = at(e);
    if (picking) {
      // Picking where a camera's photos go: this click only does that.
      if (p.track) useCamera.getState().pick({ track: p.track.id, cell: p.cell });
      setHover(null);
      return;
    }
    // Picking the lasso's background plate: this click only does that.
    if (p.track && pickPlateAt(p.track.id, p.cell)) return;
    if (p.y < RULER_H) {
      if (loop) {
        // A loop: drag where it starts again to make it longer or shorter; drag the ruler to turn the drum.
        capturePointer(e);
        if ((e.target as HTMLElement).closest("[data-drum-end]")) setGesture({ kind: "length", x0: p.x, dx: 0 });
        else setGesture({ kind: "turn", cx0: e.clientX, rot0: r, moved: false });
        return;
      }
      // Ruler: pick the moment and show the film there.
      useEditor.getState().moveTo(p.cell, undefined);
      return;
    }
    // Past where a drum ends there are no cells.
    if (loop && p.v >= r + shown) return;
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
    // A camera's live cell: dragging it takes its photos elsewhere.
    const liveRig = rigs.find((r) => r.target.track === p.track!.id && wrap(r.target.cell) === p.cell);
    if (liveRig) {
      capturePointer(e);
      setGesture({ kind: "live", rig: liveRig.id, x0: p.x, y0: p.y, moved: false, to: null });
      return;
    }
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
      if (ids.length === 1) useLayers.getState().showCell(clip.track);
      if (ids.includes(id)) setGesture({ kind: "move", x0: p.x, y0: p.y, id, ids, moved: false, dx: 0, dy: 0 });
      return;
    }
    lastDown.current = null;
    setGesture({ kind: "band", x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey || e.metaKey || e.ctrlKey, base: selection });
  }

  function onPointerMove(e: React.PointerEvent) {
    {
      const p = at(e);
      hovered = p.track && !(loop && p.v >= r + shown) ? { track: p.track.id, cell: p.cell } : null;
    }
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
    if (gesture.kind === "live") {
      const moved = gesture.moved || Math.abs(p.x - gesture.x0) + Math.abs(p.y - gesture.y0) > 4;
      const to = p.track && moved ? { track: p.track.id, cell: p.cell, v: p.v } : gesture.to;
      if (moved !== gesture.moved || to?.track !== gesture.to?.track || to?.v !== gesture.to?.v) setGesture({ ...gesture, moved, to });
      return;
    }
    if (gesture.kind === "length") {
      const dx = Math.max(1 - shown, Math.round((p.x - gesture.x0) / cw));
      if (dx !== gesture.dx) setGesture({ ...gesture, dx });
      return;
    }
    if (gesture.kind === "move") {
      const dx = Math.round((p.x - gesture.x0) / cw);
      // Rows of tracks between where it was taken and the track under the pointer.
      const from = tracks.findIndex((t) => t.id === film!.clips[gesture.id]?.track);
      const over = p.track ? tracks.findIndex((t) => t.id === p.track!.id) : -1;
      const dy = from >= 0 && over >= 0 && rows[p.row]?.kind === "track" ? over - from : gesture.dy;
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
          if (rows[rowOf(c.track)]?.kind !== "track") return false;
          const top = topOf(c.track);
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
      if (!g.moved && p.v < r + shown) useEditor.getState().moveTo(p.cell, undefined);
      return;
    }
    if (g.kind === "length") {
      if (g.dx) resizeAtEnd(g.dx);
      return;
    }
    if (g.kind === "live") {
      const rig = rigs.find((r) => r.id === g.rig);
      if (g.moved && g.to && rig && (g.to.track !== rig.target.track || g.to.cell !== wrap(rig.target.cell))) {
        // As picking its cell again: it becomes the camera in use, and starts a new sequence there.
        const camera = useCamera.getState();
        camera.startPicking(rig.id);
        camera.pick({ track: g.to.track, cell: g.to.cell });
      } else if (!g.moved && p.track) {
        useEditor.getState().setSelection([]);
        useEditor.getState().setColumns(null);
        useEditor.getState().moveTo(p.cell, p.track.id);
        useLayers.getState().showCell(p.track.id);
      }
      return;
    }
    if (g.kind === "move" && g.moved && (g.dx || g.dy)) {
      const moves = g.ids.map((id) => {
        const c = film!.clips[id]!;
        const row = tracks.findIndex((t) => t.id === c.track);
        const to = row < 0 ? c.track : tracks[Math.max(0, Math.min(tracks.length - 1, row + g.dy))]!.id;
        return { id, track: to, start: wrap(c.start + g.dx) };
      });
      if (moves.every((m) => m.start >= 0)) moveClips(moves);
    } else if (g.kind === "move" && !g.moved && !(e.shiftKey || e.metaKey || e.ctrlKey) && e.detail < 2) {
      // A plain click on a picture of a group picks just that one.
      useEditor.getState().setSelection([g.id]);
      useLayers.getState().showCell(film!.clips[g.id]!.track);
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
      if (!g.add) useLayers.getState().showCell(p.track.id);
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
    const sfx = e.dataTransfer.getData(SFX_DRAG);
    if (sfx) {
      const { name, file } = JSON.parse(sfx) as { name: string; file: string };
      void insertSfx(name, file, { track: p.track?.id ?? cursor.track, cell: p.cell }).catch((err) => console.error("[gepetta] sound effect", err));
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.some(isSoundFile)) void importSounds(files.filter(isSoundFile), { track: p.track?.id ?? cursor.track, cell: p.cell });
    if (!p.track || !files.some((f) => !isSoundFile(f))) return;
    void importImages(files.filter((f) => !isSoundFile(f)), { track: p.track.id, cell: p.cell });
  }

  // Where moved clips are drawn while dragging.
  const shift = (c: Clip, lap: number): { left: number; top: number } | null => {
    if (!gesture || gesture.kind !== "move" || !gesture.moved || !selected.has(c.id)) return null;
    const row = tracks.findIndex((t) => t.id === c.track);
    const to = Math.max(0, Math.min(tracks.length - 1, row + gesture.dy));
    return { left: Math.max(0, c.start + gesture.dx) * cw + lapX(lap), top: topOf(tracks[to]!.id) };
  };

  const ticks: number[] = [];
  // Labels at least ~28 px apart: every cell, or every 2, 3, 6 or 12…
  const every = [1, 2, 3, 6, 12, 24, 48, 96].find((n) => n * cw >= 28) ?? 96;
  for (let c = firstCell - (firstCell % every); c < lastCell; c += every) ticks.push(c);
  /** The picked cells' rows (a linked group's are picked whole). */
  const spanned = span ? spanCells() : null;

  /** ⇧ or ⌘/Ctrl on a head: picks several tracks (⇧: every one from the last picked; ⌘/Ctrl: one more, or one less). */
  const pickHeads = (id: TrackId, range: boolean) => {
    const { picked: now, setPicked } = useGroups.getState();
    if (range) {
      const from = tracks.findIndex((t) => t.id === (now.at(-1) ?? cursor.track));
      const to = tracks.findIndex((t) => t.id === id);
      const between = from < 0 || to < 0 ? [id] : tracks.slice(Math.min(from, to), Math.max(from, to) + 1).map((t) => t.id);
      // A closed group's row brings its tracks.
      const rowOfId = rows[rowOf(id)];
      const extra = rowOfId?.kind === "group" ? rowOfId.tracks : [];
      setPicked([...new Set([...now, ...between, ...extra])]);
    } else {
      const row = rows[rowOf(id)];
      const ids = row?.kind === "group" ? row.tracks : [id];
      setPicked(ids.every((x) => now.includes(x)) ? now.filter((x) => !ids.includes(x)) : [...new Set([...now, ...ids])]);
    }
  };

  /**
   * Where a dragged head goes, from the row it is let go on: above that row
   * (going up) or below it (going down); onto a group's open title, into the
   * group (a track) or above it (a group).
   */
  const headPlace = (d: HeadDrag, clientY: number): { to: number; join?: GroupId; row: number } | null => {
    const box = headsRef.current?.getBoundingClientRect();
    if (!box) return null;
    const i = rowAtY(clientY - box.top);
    const target = rows[i];
    if (!target) return null;
    const moving = new Set(d.kind === "track" ? [d.id] : groupTracks(film, d.id).map((t) => t.id));
    if (target.kind === "track" && moving.has(target.track.id)) return null;
    if (target.kind === "group" && d.kind === "group" && groupWithin(film, target.group.id, d.id)) return null;
    const rest = film.tracks.filter((t) => !moving.has(t.id));
    const at = (id: TrackId) => rest.findIndex((t) => t.id === id);
    const up = d.dy < 0;
    if (target.kind === "track") return { to: up ? at(target.track.id) + 1 : at(target.track.id), row: i };
    const members = target.tracks.filter((t) => !moving.has(t));
    if (!members.length) return null;
    if (target.collapsed) return { to: up ? at(members.at(-1)!) + 1 : at(members[0]!), row: i };
    return { to: at(members.at(-1)!) + 1, row: i, ...(d.kind === "track" ? { join: target.group.id } : {}) };
  };
  const dropHead = (d: HeadDrag, clientY: number) => {
    const place = headPlace(d, clientY);
    if (!place) return;
    const { commit } = useEditor.getState();
    if (d.kind === "group") return commit([{ type: "group.move", id: d.id, index: place.to }]);
    const ops: Op[] = [{ type: "track.move", trackId: d.id, index: place.to }];
    if (place.join) ops.push({ type: "track.update", trackId: d.id, patch: { group: place.join } });
    commit(ops, place.join ? `Meter "${film.tracks.find((t) => t.id === d.id)?.name}" en "${film.groups?.[place.join]?.name}"` : "Ordenar tracks");
  };
  // While dragging a head: a line where it would go (or a box around the group it would go into).
  let headMark: React.CSSProperties | null = null;
  if (headDrag?.moved) {
    const place = headPlace(headDrag, headDrag.y0 + headDrag.dy);
    if (place) {
      const top = tops[place.row]!;
      const h = rowHeight(rows[place.row]!);
      headMark = place.join ? { top, height: h } : { top: headDrag.dy < 0 ? top - ROW_GAP / 2 - 1 : top + h + ROW_GAP / 2 - 1, height: 2 };
    }
  }

  const pickIndex = rigs.findIndex((r) => r.id === picking);
  const pickColor = rigColor(pickIndex);

  return (
    <div className="timeline-wrap">
      {picking && pickIndex >= 0 && <PickingBar index={pickIndex} rig={rigs[pickIndex]!} color={pickColor} />}
      <div className={`timeline${picking ? " picking" : ""}${loop ? " drum" : ""}`} style={{ ["--thumb-aspect" as string]: aspect, ...(picking && { ["--rig" as string]: pickColor }) }}>
        <div className="tl-heads" ref={headsRef} style={{ minHeight: height + 40 }}>
          <div className="tl-head ruler" style={{ height: RULER_H }}>
            <button className="icon-btn small" onClick={() => zoomBy(1 / 1.5)} title="Alejar (⌘ + rueda, o pellizcar en el pad)">
              <Icon name="minus" size={14} />
            </button>
            <button className="icon-btn small" onClick={() => zoomBy(1.5)} title="Acercar (⌘ + rueda, o pellizcar en el pad)">
              <Icon name="plus" size={14} />
            </button>
            {film.tracks.some((t) => t.kind === "sound") && (
              <button
                className={`icon-btn small${scrub ? " on" : ""}`}
                onClick={() => useSound.getState().setScrub(!scrub)}
                title={scrub ? "Al moverte de celda suena su pedacito de sonido (tocá para que no suene)" : "Al moverte de celda no suena nada (tocá para escuchar el pedacito de cada celda)"}
              >
                <Icon name={scrub ? "sound" : "mute"} size={14} />
              </button>
            )}
          </div>
          <div className="tl-head main" style={{ height: RESULT_H }}>
            Resultado
          </div>
          {rows.map((row) =>
            row.kind === "track" ? (
              <TrackHead
                key={row.track.id}
                track={row.track}
                current={row.track.id === cursor.track}
                picked={picked.includes(row.track.id)}
                pickTo={pickHeads}
                depth={row.depth}
                drag={headDrag}
                setDrag={setHeadDrag}
                drop={dropHead}
              />
            ) : (
              <GroupHead
                key={`g:${row.group.id}`}
                row={row}
                current={row.collapsed && row.tracks.includes(cursor.track)}
                height={rowHeight(row)}
                pickTo={pickHeads}
                depth={row.depth}
                drag={headDrag}
                setDrag={setHeadDrag}
                drop={dropHead}
              />
            ),
          )}
          {headMark && <div className="tl-drop" style={headMark} />}
          <div className="tl-adds">
            <button className="btn small ghost tl-add" onClick={() => addTrack()} title="Agregar un track vacío arriba (imágenes y videos: herramienta «Imágenes y videos»)">
              <Icon name="plus" size={14} /> Track
            </button>
            <button className="btn small ghost tl-add" onClick={() => soundInput.current?.click()} title="Importar música, efectos o voces (mp3, wav, ogg, m4a…) desde la celda del cursor; también se pueden soltar los archivos en la línea de tiempo">
              <Icon name="sound" size={14} /> Sonido
            </button>
            <VoiceButton />
            <EffectsButton />
          </div>
        </div>

        <div className="tl-body" ref={scroller} style={{ minHeight: height + 40 }} onScroll={(e) => onScroll(e.currentTarget)}>
          <div
            className="tl-canvas"
            style={{ width: loop ? scroll.width : cells * cw + 120, height: height + 40 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => (hovered = null)}
            onPointerUp={onPointerUp}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <div
              className="tl-drum"
              style={
                loop
                  ? {
                      transform: `translateX(${-shiftX}px)`,
                      // Only the drum's cells show: nothing past its end.
                      clipPath: `polygon(${shiftX}px 0, ${shiftX + shown * cw}px 0, ${shiftX + shown * cw}px 100%, ${shiftX}px 100%)`,
                    }
                  : undefined
              }
            >
            <div className="tl-ruler" style={{ height: RULER_H }}>
              {ticks.map((v) => {
                const c = wrap(v);
                return (
                  <span key={v} className={c % fps === 0 ? "sec" : ""} style={{ left: v * cw }}>
                    {c % fps === 0 ? `${c / fps}s` : c + 1}
                  </span>
                );
              })}
            </div>

            {resultCells.map(({ cell, items }) => (
              <div key={cell} className="tl-result" style={{ left: cell * cw + 1, width: cw - 2, top: RULER_H + ROW_GAP, height: RESULT_H }}>
                <CellCanvas filmId={filmId} film={film.settings} items={items} />
              </div>
            ))}

            {rows.map((row, i) =>
              row.kind === "track" ? (
                <div
                  key={row.track.id}
                  className={`tl-row${row.track.id === cursor.track ? " current" : ""}${row.track.visible ? "" : " off"}`}
                  style={{ top: tops[i], height: TRACK_H, backgroundSize: `${cw}px 100%` }}
                />
              ) : (
                <div key={`g:${row.group.id}`} className={`tl-row group${row.collapsed ? " collapsed" : ""}`} style={{ top: tops[i], height: rowHeight(row), backgroundSize: `${cw}px 100%` }} />
              ),
            )}

            {/* A closed group: a mark in each cell for each of its tracks with a picture there. */}
            {laps.map((l) =>
              rows.map((row, i) => {
                if (row.kind !== "group" || !row.collapsed) return null;
                const out = [];
                for (let v = Math.max(firstCell, l * period); v < (loop ? Math.min(lastCell, (l + 1) * period) : lastCell); v++) {
                  const c = wrap(v);
                  const marks = row.tracks.flatMap((t, k) => ((index.get(t) ?? []).some((x) => x.start <= c && clipEnd(x) > c) ? [k] : []));
                  if (!marks.length) continue;
                  out.push(
                    <div key={`m:${l}:${row.group.id}:${v}`} className="tl-marks" style={{ left: v * cw + lapX(0) + 1, width: cw - 2, top: tops[i]! + 4, height: GROUP_SHUT_H - 8 }}>
                      {marks.map((k) => (
                        <span key={k} style={{ background: MARK_COLORS[k % MARK_COLORS.length] }} />
                      ))}
                    </div>,
                  );
                }
                return out;
              }),
            )}

            {/* Cells picked with ⇧ + arrows, as picked text. */}
            {spanned &&
              laps.map((l) => {
                const shownRows = spanned.tracks.map(rowOf).filter((i) => i >= 0);
                if (!shownRows.length) return null;
                const r0 = Math.min(...shownRows);
                const r1 = Math.max(...shownRows);
                return (
                  <div
                    key={`span-${l}`}
                    className="tl-span"
                    style={{ left: spanned.start * cw + lapX(l), width: (spanned.end - spanned.start) * cw, top: tops[r0], height: tops[r1]! + rowHeight(rows[r1]!) - tops[r0]! }}
                  />
                );
              })}

            {/* The cell looked at (where an import goes). */}
            {laps.map((l) => (
              <div key={l} className="tl-cursor-cell" style={{ left: wrap(cursor.cell) * cw + lapX(l), width: cw, top: topOf(cursor.track), height: heightOf(cursor.track) }} />
            ))}

            {laps.map((lap) =>
              tracks.map((t) =>
              visibleClips(t, lap).map((c) => {
                const moving = shift(c, lap);
                const length = gesture?.kind === "resize" && gesture.id === c.id ? Math.max(1, gesture.length0 + gesture.dx) : c.length;
                return (
                  <div
                    key={`${lap}:${c.id}`}
                    data-clip={c.id}
                    className={`tl-clip${selected.has(c.id) ? " selected" : ""}${moving ? " moving" : ""}${c.visible ? "" : " off"}`}
                    style={{ left: (moving?.left ?? c.start * cw + lapX(lap)) + 1, top: moving?.top ?? topOf(t.id), width: length * cw - 2, height: TRACK_H }}
                    title={`${c.name} · celdas ${c.start + 1}–${c.start + c.length}`}
                  >
                    {c.sound
                      ? (() => {
                          const shownCells = cellsOf(c, length, lap);
                          return shownCells.length ? <SoundStrip filmId={filmId} clip={c} from={shownCells[0]!} count={shownCells.length} cw={cw} fps={fps} /> : null;
                        })()
                      : cellsOf(c, length, lap).map((cell) => (
                          <div key={cell} className="tl-clip-cell" style={{ left: (cell - c.start) * cw, width: cw - (cell === c.start + length - 1 ? 2 : 0) }}>
                            <CellCanvas filmId={filmId} film={film.settings} items={[clipItem(t, c, cell)]} />
                          </div>
                        ))}
                    {c.sound && cw * length >= 60 && <span className="tl-sound-name">{c.name}</span>}
                    {!c.sound && length > 1 && cw * length >= 40 && <span className="tl-len">×{length}</span>}
                    {/* Pictures of one sequence: a bar of its color under them, joined from one to the next. */}
                    {c.seq && (
                      <span
                        className={`tl-seq${shownSeq === c.seq ? " shown" : ""}`}
                        style={{ background: sequenceColor(c.seq) }}
                        title="Parte de una secuencia"
                      />
                    )}
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
              const v = wrap(target.cell) + l * period;
              const track = film.tracks.find((t) => t.id === target.track);
              if (!track || rowOf(track.id) < 0 || v < firstCell || v > lastCell) return null;
              return (
                <div key={`live-${l}-${r.id}`} className="tl-livecell" style={{ left: v * cw + 1, width: cw - 2, top: topOf(track.id), height: heightOf(track.id) }}>
                  <CellCanvas filmId={filmId} film={film.settings} items={[liveItem(r.id, { ...track, opacity: 1 })]} />
                </div>
              );
            }))}

            {/* Where each camera puts its photos (not while its cell is being picked again). */}
            {laps.map((l) => rigs.map((r, i) => {
              if (r.id === picking) return null;
              if (rowOf(r.target.track) < 0) return null;
              const color = rigColor(i);
              return (
                <div key={`${l}-${r.id}`} className={`tl-rig${r.id === activeRig ? " active" : ""}`} style={{ left: wrap(r.target.cell) * cw + lapX(l), width: cw, top: topOf(r.target.track), height: heightOf(r.target.track), borderColor: color }}>
                  <span style={{ background: color }}>{i + 1}</span>
                </div>
              );
            }))}

            {/* Dragging a camera's live cell: where it would go. */}
            {gesture?.kind === "live" && gesture.moved && gesture.to && (
              <div
                className="tl-pick"
                style={{
                  left: gesture.to.v * cw,
                  width: cw,
                  top: topOf(gesture.to.track),
                  height: heightOf(gesture.to.track),
                  ["--rig" as string]: rigColor(rigs.findIndex((r) => r.id === gesture.rig)),
                }}
              >
                <Icon name="camera" size={Math.min(18, cw - 6)} />
              </div>
            )}

            {/* While picking a camera's cell: where it would go. */}
            {picking && hover && (
              <div className="tl-pick" style={{ left: hover.v * cw, width: cw, top: topOf(hover.track), height: heightOf(hover.track) }}>
                <Icon name="camera" size={Math.min(18, cw - 6)} />
              </div>
            )}

            {/* The selected cell, across every row; it stays marked while playing. */}
            {laps.map((l) => (
              <div key={l} className={`tl-selected${playing ? " playing" : ""}`} style={{ left: wrap(cursor.cell) * cw + lapX(l), width: cw, height }} />
            ))}
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
            {/* Where the drum ends: a fixed mark (it does not turn with the drum); drag it to add or take out cells there. */}
            {loop && (
              <div className={`tl-drum-end${gesture?.kind === "length" ? " dragging" : ""}`} style={{ left: shown * cw, height }}>
                <span data-drum-end="1" title={`El loop tiene ${period} celdas: arrastrá para agregar celdas vacías acá o quitar las de antes`}>
                  ↻ {period}
                </span>
              </div>
            )}
            {gesture?.kind === "length" && (
              <div className="tl-seam ghost" style={{ left: Math.min(scroll.width - 2, (shown + gesture.dx) * cw), height }}>
                <span>
                  {period + gesture.dx} celdas ({gesture.dx > 0 ? `+${gesture.dx}` : gesture.dx})
                </span>
              </div>
            )}
          </div>
        </div>

        <input
          ref={soundInput}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) void importSounds(files);
            e.target.value = "";
          }}
        />
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
