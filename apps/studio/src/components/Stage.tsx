import {
  type CellIndex,
  type FilmState,
  type Look,
  type MediaRef,
  type Point,
  type Transform2D,
  cellIndex,
  clipAt,
  IDENTITY_TRANSFORM,
  composeTransforms,
  lookBox,
  moveVanishingPoint,
  outerTransform,
  relativeTransform,
  previousClips,
  stackAt,
  vanishingPoints,
  wrapCell,
} from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { proxyCache } from "../media/cache";
import { peekPicture } from "../media/composed";
import type { LiveFrame } from "../capture/types";
import { type Drawable, type Size, containScale, drawStack, pictureMatrix } from "../render/frame";
import { pickedStrokes, selectStrokes, strokeAt, useStrokes } from "../state/strokes";
import { drawHandles, dragTransform, hitHandle, type HandleKind } from "../render/handles";
import { type HandleTarget, commitTransform, selectedClipId, useLayers } from "../state/layers";
import { shotOn, useCamera } from "../state/camera";
import { measureProbes, probeColor, probeSize, readings, useFocusProbes } from "../state/focusProbes";
import { playbackCell, useEditor } from "../state/editor";
import { useGuides } from "../state/guides";
import { beginStroke, brushOutline, cloneMarker, endStroke, isPainting, leaveStage, moveStroke, surfaceAt, usePaint } from "../state/paint";
import { drawGuides, hitVanishingPoint } from "../render/guides";
import { magnifyControl } from "./MagnifyPanel";
import { capturePointer } from "./pointer";
import { StageTools } from "./StageTools";
import { withShotPreview } from "../state/shot";

const PREFETCH = 12;

/** Draws pictures from their proxies, requesting the ones not decoded yet. Returns false if something was missing. */
function drawProxies(ctx: CanvasRenderingContext2D, filmId: string, film: FilmState, items: readonly Drawable[], alpha = 1): boolean {
  let complete = true;
  drawStack(
    ctx,
    items,
    film.settings,
    ({ media, strokes }) => {
      const bmp = strokes?.length ? peekPicture(filmId, media, strokes, "proxy") : proxyCache.peek(filmId, media.proxy);
      if (!bmp) {
        complete = false;
        if (!strokes?.length) void proxyCache.load(filmId, media.proxy);
      }
      return bmp;
    },
    alpha,
  );
  return complete;
}

/** Loads the proxies the next cells will show. */
function prefetch(filmId: string, film: FilmState, cell: number, index: CellIndex) {
  for (let c = cell + 1; c <= cell + PREFETCH; c++) for (const item of stackAt(film, c, { index })) void proxyCache.load(filmId, item.media.proxy);
}

/** The film with the transform being dragged applied, so pictures follow the pointer before the change is committed. */
function withPreview(raw: FilmState): FilmState {
  const film = withShotPreview(raw);
  const preview = useLayers.getState().preview;
  if (!preview) return film;
  const { target, transform } = preview;
  if (target.kind === "track") return { ...film, tracks: film.tracks.map((t) => (t.id === target.id ? { ...t, transform } : t)) };
  const clip = film.clips[target.id];
  return clip ? { ...film, clips: { ...film.clips, [clip.id]: { ...clip, transform } } } : film;
}

/**
 * The picture selected in the timeline, when the cursor is on it: it shows on
 * top of everything (at the viewing opacity), to work on it.
 */
function focusedClip(film: FilmState) {
  const id = selectedClipId();
  const clip = id ? film.clips[id] : undefined;
  const { cursor } = useEditor.getState();
  if (!clip || cursor.cell < clip.start || cursor.cell >= clip.start + clip.length) return null;
  const track = film.tracks.find((t) => t.id === clip.track);
  return track ? { clip, track } : null;
}

function drawProbes(ctx: CanvasRenderingContext2D, live: LiveFrame, film: Size, scale: number) {
  const { probes } = useFocusProbes.getState();
  if (probes.length === 0) return;
  const c = containScale(live, film);
  const ox = (film.width - live.width * c) / 2;
  const oy = (film.height - live.height * c) / 2;
  const px = 1 / scale; // one screen pixel, in film units
  const box = probeSize(live) * c;
  ctx.save();
  ctx.font = `bold ${16 * px}px system-ui, sans-serif`;
  for (const p of probes) {
    const r = readings.get(p.id);
    const q = r && r.peak > 0 ? r.value / r.peak : 0;
    const color = probeColor(q);
    const x = ox + p.x * live.width * c - box / 2;
    const y = oy + p.y * live.height * c - box / 2;
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, box, box);
    const label = `${p.name} ${r ? Math.round(q * 100) : "…"}%`;
    const w = ctx.measureText(label).width + 12 * px;
    ctx.fillStyle = "rgb(0 0 0 / 0.8)";
    ctx.fillRect(x, y - 24 * px, Math.max(w, box), 22 * px);
    ctx.fillStyle = color;
    ctx.fillText(label, x + 6 * px, y - 7 * px);
    // History under the box, scaled to the peak.
    if (r && r.history.length > 1) {
      const hw = Math.max(box, 120 * px);
      const hh = 36 * px;
      const hy = y + box + 4 * px;
      ctx.fillStyle = "rgb(0 0 0 / 0.8)";
      ctx.fillRect(x, hy, hw, hh);
      // Dotted line at the peak: the target to reach.
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = "rgb(255 255 255 / 0.5)";
      ctx.beginPath();
      ctx.moveTo(x, hy + 2 * px);
      ctx.lineTo(x + hw, hy + 2 * px);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = color;
      ctx.beginPath();
      r.history.forEach((v, i) => {
        const hx = x + (i / (r.history.length - 1)) * hw;
        const vy = hy + hh - (v / r.peak) * (hh - 4 * px);
        if (i === 0) ctx.moveTo(hx, vy);
        else ctx.lineTo(hx, vy);
      });
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
  }
  ctx.restore();
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Live-view interactions: drag to move the magnifier, click to focus at a point. */
function useLivePointer(liveRect: React.RefObject<Rect | null>) {
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; center: [number, number]; moved: boolean; sentAt: number } | null>(null);

  /** Normalized point of the live picture under the pointer (null outside it). */
  const pointAt = (e: React.PointerEvent): [number, number] | null => {
    const r = liveRect.current;
    if (!r) return null;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left - r.x) / r.w;
    const y = (e.clientY - box.top - r.y) / r.h;
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : [x, y];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const magnify = magnifyControl(useCamera.getState().controls);
    if (!magnify || magnify.value === "1" || !liveRect.current) return;
    capturePointer(e);
    drag.current = { x: e.clientX, y: e.clientY, center: magnify.center, moved: false, sentAt: 0 };
  };

  const onPointerMove = (e: React.PointerEvent, final = false) => {
    const d = drag.current;
    const r = liveRect.current;
    const magnify = magnifyControl(useCamera.getState().controls);
    if (!d || !r || !magnify) return;
    const level = Number(magnify.value);
    const dx = (e.clientX - d.x) / r.w / level;
    const dy = (e.clientY - d.y) / r.h / level;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    const now = performance.now();
    if (!d.moved || (!final && now - d.sentAt < 200)) return;
    d.sentAt = now;
    // Dragging the picture right shows what is to its left.
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const target = `at:${clamp(d.center[0] - dx).toFixed(3)},${clamp(d.center[1] - dy).toFixed(3)}`;
    void useCamera.getState().setControl(magnify, target);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    onPointerMove(e, true);
    drag.current = null;
    if (d?.moved) return;
    const { pointerTool, controls, setControl } = useCamera.getState();
    if (pointerTool === "probe") {
      const p = pointAt(e);
      const magnify = magnifyControl(controls);
      if (p && (!magnify || magnify.value === "1")) useFocusProbes.getState().toggleAt(p[0], p[1]);
      return;
    }
    if (pointerTool !== "focus") return;
    const focus = controls.find((c) => c.kind === "focus");
    const p = pointAt(e);
    if (!focus || !p) return;
    // While magnified the click is inside the magnified area.
    const magnify = magnifyControl(controls);
    const level = magnify ? Number(magnify.value) : 1;
    const [cx, cy] = magnify && level > 1 ? magnify.center : [0.5, 0.5];
    const gx = level > 1 ? cx + (p[0] - 0.5) / level : p[0];
    const gy = level > 1 ? cy + (p[1] - 0.5) / level : p[1];
    const box = e.currentTarget.getBoundingClientRect();
    setMarker({ x: e.clientX - box.left, y: e.clientY - box.top });
    setTimeout(() => setMarker(null), 1800);
    void setControl(focus, `af:${gx.toFixed(3)},${gy.toFixed(3)}`);
  };

  return { marker, handlers: { onPointerDown, onPointerMove: (e: React.PointerEvent) => onPointerMove(e), onPointerUp } };
}

/** Where the film sits in the stage, in CSS pixels (s: CSS pixels per film pixel). */
interface FilmRect {
  x: number;
  y: number;
  s: number;
}

/** Dragging vanishing points while the guides panel is open. */
function useGuideDrag(filmRect: React.RefObject<FilmRect | null>) {
  const drag = useRef<number | null>(null);

  const filmPoint = (e: React.PointerEvent) => {
    const r = filmRect.current!;
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left - r.x) / r.s, y: (e.clientY - box.top - r.y) / r.s };
  };

  /** Returns true when the event was a guide drag (and must not reach the camera tools). */
  const onPointerDown = (e: React.PointerEvent): boolean => {
    const { film, filmId } = useEditor.getState();
    const guides = useGuides.getState();
    if (!film || !filmId || !guides.editing || !filmRect.current) return false;
    const g = guides.get(filmId);
    if (!g.visible) return false;
    const hit = hitVanishingPoint(g, film.settings, filmPoint(e), 1 / filmRect.current.s);
    if (hit === null) return false;
    capturePointer(e);
    drag.current = hit;
    return true;
  };

  const onPointerMove = (e: React.PointerEvent): boolean => {
    const { film, filmId } = useEditor.getState();
    if (drag.current === null || !film || !filmId) return false;
    const { width, height } = film.settings;
    const p = filmPoint(e);
    const guides = useGuides.getState();
    const perspective = moveVanishingPoint(guides.get(filmId).perspective, drag.current, { x: p.x / width, y: p.y / height });
    guides.update(filmId, { perspective });
    return true;
  };

  const onPointerUp = (): boolean => {
    if (drag.current === null) return false;
    drag.current = null;
    return true;
  };

  return { onPointerDown, onPointerMove, onPointerUp, dragging: () => drag.current !== null };
}

/** The open camera aimed at a track's cell, if any. */
function liveRigAt(track: string, cell: number) {
  const camera = useCamera.getState();
  return camera.rigs.find((r) => {
    if (!r.source) return false;
    const t = camera.targetOf(r);
    return t.track === track && t.cell === cell;
  });
}

/**
 * The selected track as it shows on the stage now (its picture, and the
 * transform it is drawn with), or null when nothing of it is on screen.
 * `trackTransform` is what dragging changes.
 */
function targetOnStage(): { box: Size; transform: Transform2D; target: HandleTarget; stored(composite: Transform2D): Transform2D } | null {
  const { film: raw, cursor, playback } = useEditor.getState();
  if (!raw || playback) return null;
  const film = withPreview(raw);
  // The selected picture: its handles move just that picture.
  const focus = useLayers.getState().detail === "clip" ? focusedClip(film) : null;
  if (focus) {
    const { clip, track } = focus;
    return {
      box: lookBox(clip.media, clip.look, film.settings),
      transform: composeTransforms(track.transform, clip.transform),
      target: { kind: "clip", id: clip.id },
      stored: (composite) => relativeTransform(track.transform, composite),
    };
  }
  // The camera tool: the active camera's live picture, to place it.
  if (usePaint.getState().tool === "camera") {
    const camera = useCamera.getState();
    const rig = camera.rigs.find((r) => r.id === camera.activeRig);
    const live = rig ? camera.liveOf(rig) : null;
    const track = rig && film.tracks.find((t) => t.id === rig.target.track);
    const magnified = (magnifyControl(camera.controls)?.value ?? "1") !== "1";
    if (!rig || !live || !track?.visible || rig.target.cell !== cursor.cell || camera.pointerTool !== "none" || magnified) return null;
    return {
      box: lookBox(live, rig.shot.look, film.settings),
      transform: composeTransforms(track.transform, rig.shot.transform),
      target: { kind: "rig", id: rig.id },
      stored: (composite) => relativeTransform(track.transform, composite),
    };
  }
  // Otherwise the selected track, through its picture at the cursor.
  const track = film.tracks.find((t) => t.id === useLayers.getState().trackId);
  if (!track || !track.visible || liveRigAt(track.id, cursor.cell)) return null;
  const clip = clipAt(film, track.id, cursor.cell);
  if (!clip) return null;
  return {
    box: lookBox(clip.media, clip.look, film.settings),
    transform: composeTransforms(track.transform, clip.transform),
    target: { kind: "track", id: track.id },
    // Moving the track moves its pictures: the track's transform is what changes.
    stored: (composite) => outerTransform(clip.transform, composite),
  };
}

/** Moving, scaling and rotating the selected layer with its handles. */
function useLayerDrag(filmRect: React.RefObject<FilmRect | null>) {
  const drag = useRef<{ kind: HandleKind; start: Point; t0: Transform2D; target: HandleTarget; stored(c: Transform2D): Transform2D } | null>(null);

  const filmPoint = (e: React.PointerEvent): Point => {
    const r = filmRect.current!;
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left - r.x) / r.s, y: (e.clientY - box.top - r.y) / r.s };
  };

  const onPointerDown = (e: React.PointerEvent): boolean => {
    const film = useEditor.getState().film;
    const shown = targetOnStage();
    if (!film || !shown || !filmRect.current) return false;
    const p = filmPoint(e);
    const kind = hitHandle(shown.box, shown.transform, film.settings, p, 1 / filmRect.current.s);
    if (!kind) return false;
    capturePointer(e);
    drag.current = { kind, start: p, t0: shown.transform, target: shown.target, stored: shown.stored };
    return true;
  };

  const onPointerMove = (e: React.PointerEvent): boolean => {
    const d = drag.current;
    const { film } = useEditor.getState();
    if (!d || !film) return false;
    const composite = dragTransform(d.kind, d.t0, film.settings, d.start, filmPoint(e), e.shiftKey);
    // A camera changes live, outside the history.
    if (d.target.kind === "rig") useCamera.getState().setShot(d.target.id, { transform: d.stored(composite) });
    else useLayers.getState().setPreview({ target: d.target, transform: d.stored(composite) });
    return true;
  };

  const onPointerUp = (): boolean => {
    if (!drag.current) return false;
    drag.current = null;
    const { preview, setPreview } = useLayers.getState();
    if (preview) commitTransform(preview.target, preview.transform);
    setPreview(null);
    return true;
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}

/** The color of the stage under the pointer, as "#rrggbb". */
function stageColor(canvas: HTMLCanvasElement, e: React.PointerEvent): string | null {
  const box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = Math.floor((e.clientX - box.left) * dpr);
  const y = Math.floor((e.clientY - box.top) * dpr);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const [r, g, b] = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
}

/** Painting tools on the cell at the cursor. */
function usePaintPointer(filmRect: React.RefObject<FilmRect | null>, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const down = useRef(false);

  const filmPoints = (e: React.PointerEvent): Point[] => {
    const r = filmRect.current;
    if (!r) return [];
    const box = e.currentTarget.getBoundingClientRect();
    // Every position the pointer went through since the last event, for smooth lines.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    return (events.length ? events : [e]).map((ev) => ({ x: (ev.clientX - box.left - r.x) / r.s, y: (ev.clientY - box.top - r.y) / r.s }));
  };

  const onPointerDown = (e: React.PointerEvent): boolean => {
    const { tool, pickColor } = usePaint.getState();
    if (!isPainting(tool) || e.button !== 0) return false;
    // Eyedropper: the tool, or Alt+click with a tool that paints a color.
    if (tool === "picker" || (e.altKey && tool !== "clone" && tool !== "erase")) {
      const color = canvasRef.current && stageColor(canvasRef.current, e);
      if (color) pickColor(color);
      return true;
    }
    const [p] = filmPoints(e);
    if (!p || !beginStroke(p, e.pressure, e.pointerType === "pen", { alt: e.altKey, shift: e.shiftKey })) return false;
    capturePointer(e);
    down.current = true;
    return true;
  };

  const onPointerMove = (e: React.PointerEvent): boolean => {
    if (!isPainting(usePaint.getState().tool)) return false;
    moveStroke(filmPoints(e), e.pressure, e.pointerType === "pen", e.shiftKey);
    return down.current;
  };

  const onPointerUp = (): boolean => {
    if (!down.current) return false;
    down.current = false;
    endStroke();
    return true;
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}

/** With the move tool, a click (not a drag) on a stroke picks it, and its picture. */
function useStrokePick(filmRect: React.RefObject<FilmRect | null>) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = usePaint.getState().tool === "move" && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    const r = filmRect.current;
    const { film, cursor } = useEditor.getState();
    if (!d || !r || !film || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const box = e.currentTarget.getBoundingClientRect();
    const p = { x: (e.clientX - box.left - r.x) / r.s, y: (e.clientY - box.top - r.y) / r.s };
    void strokeAt(film, cursor.cell, p, 6 / r.s).then((hit) => {
      if (!hit) {
        if (useStrokes.getState().ids.length) selectStrokes(null, []);
        return;
      }
      const add = e.shiftKey && useStrokes.getState().clip === hit.clip.id;
      const ids = useStrokes.getState().ids;
      useEditor.getState().setSelection([hit.clip.id]);
      useLayers.getState().showClip(hit.clip.track);
      selectStrokes(hit.clip.id, add ? (ids.includes(hit.stroke.id) ? ids.filter((i) => i !== hit.stroke.id) : [...ids, hit.stroke.id]) : [hit.stroke.id]);
    });
  };
  return { onPointerDown, onPointerUp };
}

/** Outlines the picked strokes, over the picture. */
function drawPickedStrokes(ctx: CanvasRenderingContext2D, film: FilmState, px: number) {
  const picked = pickedStrokes(film);
  const { cursor } = useEditor.getState();
  if (!picked || cursor.cell < picked.clip.start || cursor.cell >= picked.clip.start + picked.clip.length) return;
  const track = film.tracks.find((t) => t.id === picked.clip.track);
  if (!track) return;
  const { clip } = picked;
  const m = pictureMatrix({ media: clip.media, transform: composeTransforms(track.transform, clip.transform), look: clip.look }, film.settings, clip.media);
  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  const k = 1 / (Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1);
  for (const s of picked.strokes) {
    const pts = s.points;
    ctx.beginPath();
    if (pts?.length) {
      if (s.tool === "shape" && s.shape !== "line") {
        const [a, b] = [pts[0]!, pts[pts.length - 1]!];
        if (s.shape === "box") ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        else ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      } else pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    } else {
      // Fill and clone: the picture's frame (their pixels are not traced).
      ctx.rect(0, 0, clip.media.width, clip.media.height);
    }
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.setLineDash([6 * px * k, 4 * px * k]);
    ctx.lineWidth = 3 * px * k;
    ctx.strokeStyle = "rgb(0 0 0 / 0.7)";
    ctx.stroke();
    ctx.lineWidth = 1.5 * px * k;
    ctx.strokeStyle = "#ff7a45";
    ctx.stroke();
  }
  ctx.restore();
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveRect = useRef<Rect | null>(null);
  const { marker, handlers } = useLivePointer(liveRect);
  const filmRect = useRef<FilmRect | null>(null);
  const guideDrag = useGuideDrag(filmRect);
  const layerDrag = useLayerDrag(filmRect);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintPointer = usePaintPointer(filmRect, canvasRef);
  const strokePick = useStrokePick(filmRect);
  const painting = usePaint((s) => isPainting(s.tool));
  const layerHandles = useRef(targetOnStage);
  const guideEditing = useGuides((s) => s.editing);
  const pointerTool = useCamera((s) => s.pointerTool);
  const magnified = useCamera((s) => (magnifyControl(s.controls)?.value ?? "1") !== "1");
  const hasSource = useCamera((s) => s.source !== null);
  const focusOpacity = useEditor((s) => s.focusOpacity);
  const focused = useEditor((s) => {
    const id = s.selection.length === 1 ? s.selection[0]! : null;
    const c = id ? s.film?.clips[id] : undefined;
    return !!c && s.cursor.cell >= c.start && s.cursor.cell < c.start + c.length;
  });
  // Whether a camera shows live at the cell on screen (the chosen one always aims at the cursor).
  const liveHere = useCamera((s) => s.rigs.some((r) => r.source));
  const cameraError = useCamera((s) => s.error?.message ?? null);
  const recording = useCamera((s) => s.rigs.some((r) => r.recording));
  const playing = useEditor((s) => s.playback !== null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let placingArea: { x: number; y: number; width: number; height: number } | null = null;
    let indexOf: FilmState | null = null;
    let index: CellIndex = new Map();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const state = useEditor.getState();
      const { film, filmId } = state;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(wrap.clientWidth * dpr);
      const ch = Math.round(wrap.clientHeight * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (!film || !filmId) return;

      // Film area: letterboxed in the stage, in film pixel coordinates. While
      // vanishing points are being placed it shrinks, so points beside it show.
      const size = film.settings;
      const guidesState = useGuides.getState();
      const guides = guidesState.get(filmId);
      const placing = guidesState.editing && guides.visible && guides.perspective.points > 0 && !state.playback;
      // Shown area, in film units: the film, plus the vanishing points while placing them.
      let area = { x: 0, y: 0, width: size.width, height: size.height };
      // Frozen while a point is dragged, so the view does not rescale under the pointer.
      if (placing && placingArea && guideDrag.dragging()) area = placingArea;
      else if (placing) {
        const xs = [0, 1, ...vanishingPoints(guides.perspective).map((p) => p.x)];
        const ys = [0, 1, ...vanishingPoints(guides.perspective).map((p) => p.y)];
        const x0 = Math.min(...xs) * size.width;
        const y0 = Math.min(...ys) * size.height;
        area = { x: x0, y: y0, width: Math.max(...xs) * size.width - x0, height: Math.max(...ys) * size.height - y0 };
        placingArea = area;
      }
      const s = containScale(area, { width: cw, height: ch }) * (placing ? 0.9 : 0.98);
      const ox = (cw - area.width * s) / 2 - area.x * s;
      const oy = (ch - area.height * s) / 2 - area.y * s;
      ctx.setTransform(s, 0, 0, s, ox, oy);
      filmRect.current = { x: ox / dpr, y: oy / dpr, s: s / dpr };
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.imageSmoothingQuality = "high";
      // Pictures stay inside the film; guides and handles may go beyond it.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size.width, size.height);
      ctx.clip();

      if (indexOf !== film) {
        index = cellIndex(film);
        indexOf = film;
      }
      const { playback, onion, cursor } = state;
      if (playback) {
        // A loop film goes on from its first cell, until stopped.
        const cell = wrapCell(film, playbackCell(playback, size.fps));
        if (cell >= film.length) {
          if (playback.loop) useEditor.setState({ playback: { ...playback, startCell: playback.loopFrom, startedAt: performance.now() } });
          else state.stop();
          ctx.restore();
          return;
        }
        drawProxies(ctx, filmId, film, stackAt(film, cell, { index }));
        prefetch(filmId, film, cell, index);
        ctx.restore();
        return;
      }

      let probesToDraw: LiveFrame | null = null;
      let showGuides = guides.visible;
      let showOnion = onion.enabled;
      liveRect.current = null;
      const shown = withPreview(film);
      const drawPainted = (canvas: OffscreenCanvas, opacity: number, transform: Transform2D, look?: Look) =>
        drawStack(ctx, [{ media: { width: canvas.width, height: canvas.height } as MediaRef, opacity, transform, look }], size, () => canvas);
      const tool = usePaint.getState().tool;
      {
        const camera = useCamera.getState();
        const active = camera.rigs.find((r) => r.id === camera.activeRig);
        const magnify = magnifyControl(camera.controls);
        const magnified = magnify !== undefined && magnify.value !== "1";
        let activeLive: LiveFrame | null = null;
        /** Draws a camera's live picture as its track shows pictures (transparency, position). */
        const drawLive = (live: LiveFrame, transform: Transform2D, opacity: number, isActive: boolean, look?: Look) => {
          drawStack(ctx, [{ media: { width: live.width, height: live.height } as MediaRef, opacity, transform, look }], size, () => live.image);
          if (!isActive) return;
          activeLive = live;
          // Where the picture landed, in CSS pixels of the stage, for pointer interactions (rotation and crop aside).
          const c = (lookBox(live, look, size).width / live.width) * transform.scale;
          const lx = ox + (size.width / 2 + transform.x - (live.width * c) / 2) * s;
          const ly = oy + (size.height / 2 + transform.y - (live.height * c) / 2) * s;
          liveRect.current = { x: lx / dpr, y: ly / dpr, w: (live.width * c * s) / dpr, h: (live.height * c * s) / dpr };
        };
        if (magnified && active) {
          // A magnified view does not line up with the film: only the camera, plain.
          const live = camera.liveOf(active);
          if (live) drawLive(live, IDENTITY_TRANSFORM, 1, true);
          showGuides = false;
          showOnion = false;
        } else {
          // The film at the cursor, bottom to top; every camera aimed at this cell shows
          // live in its track, with the track's transparency and position.
          // While a change is previewed the index (built from the film) has the old pictures.
          const items = stackAt(shown, cursor.cell, shown === film ? { index } : {});
          const here = camera.rigs.filter((r) => r.source && camera.targetOf(r).cell === cursor.cell);
          for (const t of shown.tracks) {
            // While drawing, the cell drawn on shows its drawing, not the camera aimed there.
            const drawingHere = isPainting(tool) && t.id === cursor.track;
            const rig = drawingHere ? undefined : here.find((r) => camera.targetOf(r).track === t.id);
            if (rig) {
              const live = t.visible ? camera.liveOf(rig) : null;
              if (live) {
                const shot = shotOn(rig, t);
                drawLive(live, shot.transform, shot.opacity, rig.id === camera.activeRig, shot.look);
              }
              continue;
            }
            const item = items.find((i) => i.trackId === t.id);
            const painted = t.visible ? surfaceAt(film, t.id, cursor.cell) : null;
            if (painted) {
              // The picture being painted, as it is right now.
              const clip = clipAt(shown, t.id, cursor.cell);
              drawPainted(painted, t.opacity * (clip?.opacity ?? 1), composeTransforms(t.transform, clip?.transform ?? IDENTITY_TRANSFORM), clip?.look);
            } else if (item) drawProxies(ctx, filmId, film, [item]);
          }
        }
        if (activeLive && !magnified) {
          measureProbes(activeLive);
          probesToDraw = activeLive;
        }
      }

      // The selected picture on top, whole, to work on it (its viewing opacity changes nothing).
      const focus = focusedClip(shown);
      if (focus) {
        const transform = composeTransforms(focus.track.transform, focus.clip.transform);
        const painted = surfaceAt(film, focus.track.id, cursor.cell);
        if (painted) drawPainted(painted, state.focusOpacity, transform, focus.clip.look);
        else drawProxies(ctx, filmId, film, [{ media: focus.clip.media, opacity: state.focusOpacity, transform, look: focus.clip.look, strokes: focus.clip.strokes }]);
      }

      // Onion skin: the previous pictures of the track being worked on. Looking at
      // the film, only over a picture of that track (an empty cell shows just the film).
      const track = shown.tracks.find((t) => t.id === cursor.track);
      // Onion skin over a camera live in that track, or over a picture of it (an empty cell shows just the film).
      // While drawing, also over an empty cell: the drawings before guide the next one.
      if (!isPainting(tool) && !liveRigAt(cursor.track, cursor.cell) && !clipAt(film, cursor.track, cursor.cell)) showOnion = false;
      if (showOnion && track) {
        const skins = previousClips(film, cursor.track, cursor.cell, onion.count, index);
        // Farthest first so the nearest one ends on top.
        skins.reverse().forEach((clip, i) => {
          const distance = skins.length - i - 1;
          const item = { media: clip.media, opacity: 1, transform: composeTransforms(track.transform, clip.transform), look: clip.look, strokes: clip.strokes };
          drawProxies(ctx, filmId, film, [item], onion.opacity * (1 - distance / (onion.count + 1)));
        });
      }
      ctx.restore();
      if (showGuides) drawGuides(ctx, guides, size, dpr / s, placing);
      const handles = layerHandles.current();
      if (handles && !placing && !isPainting(tool)) drawHandles(ctx, handles.box, handles.transform, size, dpr / s);
      if (tool === "move") drawPickedStrokes(ctx, shown, dpr / s);
      const outline = brushOutline();
      if (outline) {
        // The brush's size where it would paint, visible over light and dark.
        ctx.beginPath();
        ctx.arc(outline.at.x, outline.at.y, Math.max(outline.size / 2, 1), 0, Math.PI * 2);
        ctx.lineWidth = (3 * dpr) / s;
        ctx.strokeStyle = "rgb(0 0 0 / 0.6)";
        ctx.stroke();
        ctx.lineWidth = (1.2 * dpr) / s;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
      const source = cloneMarker();
      if (source) {
        // Where the clone stamp copies from: a cross.
        const r = (10 * dpr) / s;
        ctx.beginPath();
        ctx.moveTo(source.x - r, source.y);
        ctx.lineTo(source.x + r, source.y);
        ctx.moveTo(source.x, source.y - r);
        ctx.lineTo(source.x, source.y + r);
        ctx.lineWidth = (3 * dpr) / s;
        ctx.strokeStyle = "rgb(0 0 0 / 0.6)";
        ctx.stroke();
        ctx.lineWidth = (1.5 * dpr) / s;
        ctx.strokeStyle = "#5cc8b5";
        ctx.stroke();
      }
      if (probesToDraw) drawProbes(ctx, probesToDraw, size, s);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`stage${guideEditing ? " guides-editing" : ""}${painting ? " painting" : hasSource && pointerTool !== "none" ? " tool-focus" : ""}${hasSource && magnified ? " magnified" : ""}`}
      ref={wrapRef}
      onPointerDown={(e) => {
        if (!playing) strokePick.onPointerDown(e);
        if (playing || guideDrag.onPointerDown(e) || paintPointer.onPointerDown(e) || layerDrag.onPointerDown(e)) return;
        if (hasSource) handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        if (playing || guideDrag.onPointerMove(e) || paintPointer.onPointerMove(e) || layerDrag.onPointerMove(e)) return;
        if (hasSource) handlers.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        if (!playing) strokePick.onPointerUp(e);
        if (playing || guideDrag.onPointerUp() || paintPointer.onPointerUp() || layerDrag.onPointerUp()) return;
        if (hasSource) handlers.onPointerUp(e);
      }}
      onPointerCancel={() => paintPointer.onPointerUp()}
      onPointerLeave={leaveStage}
    >
      <canvas ref={canvasRef} />
      {!playing && <StageTools />}
      {marker && <div className="focus-marker" style={{ left: marker.x, top: marker.y }} />}
      {!playing && magnified && <div className="stage-badge zoom">🔍 Lupa · arrastrá para mover</div>}
      {!playing && !hasSource && (
        <div className="stage-note">{cameraError ?? "Conectando la cámara…"}</div>
      )}
      {playing && <div className="stage-badge">▶ Reproduciendo</div>}
      {!playing && liveHere && <div className="stage-badge live">{recording ? "● Grabando · espacio o el botón grande para detener" : "● En vivo"}</div>}
      {!playing && focused && (
        <label className="focus-opacity" onPointerDown={(e) => e.stopPropagation()} title="Solo para ver lo que hay debajo: no cambia la película">
          <span>Imagen elegida</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={focusOpacity}
            onChange={(e) => useEditor.getState().set({ focusOpacity: Number(e.target.value) })}
          />
          <span>{Math.round(focusOpacity * 100)} %</span>
        </label>
      )}
    </div>
  );
}
