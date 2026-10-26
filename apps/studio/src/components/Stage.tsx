import {
  type CellIndex,
  type FilmState,
  type Look,
  type MediaRef,
  type Stroke,
  type Point,
  type Transform2D,
  cellIndex,
  clipAt,
  IDENTITY_TRANSFORM,
  composeTransforms,
  cropRect,
  lookBox,
  moveVanishingPoint,
  outerTransform,
  relativeTransform,
  previousClips,
  stackAt,
  vanishingPoints,
  playedCell,
} from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { ZOOM_MAX, ZOOM_MIN, fitStage, panBy, setStageLayout, useStageView, viewTransform, zoomBy } from "../state/stageView";
import { Icon } from "./Icon";
import { StageSound } from "./StageSound";
import { StageSoundView } from "./StageSoundView";
import { proxyCache } from "../media/cache";
import { peekPicture } from "../media/composed";
import type { LiveFrame } from "../capture/types";
import { type Drawable, type Size, containScale, drawStack, pictureMatrix } from "../render/frame";
import { beginLasso, drawLassoOutline, endLasso, lassoActive, lassoGhost, moveLasso } from "../state/lasso";
import { objectsAt, pickedStrokes, selectStrokes, strokesBounds, transformStrokes, updateStrokes, useStrokePreview, useStrokes, withStrokePreview } from "../state/strokes";
import { type CropSide, type HandleKind, dragCrop, drawHandles, dragTransform, hitHandle } from "../render/handles";
import { type HandleTarget, commitTransform, selectedClipId, sequenceMoved, useLayers } from "../state/layers";
import { shotOn, useCamera } from "../state/camera";
import { measureProbes, probeColor, probeSize, readings, useFocusProbes } from "../state/focusProbes";
import { playbackCell, useEditor } from "../state/editor";
import { useGuides } from "../state/guides";
import { beginStroke, brushOutline, cloneMarker, currentSettings, endStroke, isPainting, leaveStage, moveStroke, surfaceAt, usePaint } from "../state/paint";
import { drawGuides, hitVanishingPoint } from "../render/guides";
import { magnifyControl } from "./MagnifyPanel";
import { capturePointer } from "./pointer";
import { StageTools } from "./StageTools";
import { beginSculpt, endSculpt, moveSculpt, sculpting } from "../state/sculpt";
import { useBusy } from "../state/busy";
import { type ShotChange, commitShot, useShotPreview, withShotPreview } from "../state/shot";

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
  const film = withStrokePreview(withShotPreview(raw));
  const preview = useLayers.getState().preview;
  if (!preview) return film;
  const { target, transform } = preview;
  if (target.kind === "sequence") return { ...film, clips: sequenceMoved(film.clips, target.id, target.ref, transform) };
  if (target.kind === "track") return { ...film, tracks: film.tracks.map((t) => (t.id === target.id ? { ...t, transform } : t)) };
  const clip = film.clips[target.id];
  return clip ? { ...film, clips: { ...film.clips, [clip.id]: { ...clip, transform } } } : film;
}

/** The picture in the cell picked in a track's row (the cell at the cursor), unless a camera is live there. */
function cellClip(film: FilmState) {
  const { cursor } = useEditor.getState();
  const track = film.tracks.find((t) => t.id === cursor.track);
  const clip = track?.visible ? clipAt(film, track.id, cursor.cell) : undefined;
  // A sound is not a picture: it shows apart (see StageSoundView).
  if (!clip || !track || clip.sound || liveRigAt(track.id, cursor.cell)) return null;
  return { clip, track };
}

/**
 * The picture selected in the timeline, when the cursor is on it: it shows on
 * top of everything (at the viewing opacity), to work on it.
 */
function focusedClip(film: FilmState) {
  const id = selectedClipId();
  const clip = id ? film.clips[id] : undefined;
  const { cursor } = useEditor.getState();
  if (!clip || clip.sound || cursor.cell < clip.start || cursor.cell >= clip.start + clip.length) return null;
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

/** What the stage handles act on: the shown part's corners, how it is drawn, and how a drag is kept. */
interface OnStage {
  corners: Point[];
  transform: Transform2D;
  target: HandleTarget;
  stored(composite: Transform2D): Transform2D;
  /** Pictures and cameras can be cropped from their sides (tracks cannot). */
  crop?: { media: Size; look: Look };
}

/** Corners of the shown part (the crop) of a picture drawn with `transform`, in film coordinates. */
function shownCorners(media: Size, look: Look | undefined, transform: Transform2D, film: Size): Point[] {
  const m = pictureMatrix({ media: media as MediaRef, transform, look }, film, media);
  const r = cropRect(media, look);
  return [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ].map(([x, y]) => {
    const q = m.transformPoint(new DOMPoint(x, y));
    return { x: q.x, y: q.y };
  });
}

/**
 * What the handles act on now, or null: the camera's live picture (camera
 * tool), the picture picked in the timeline (when the cursor is on it), or a
 * track picked by its name. Never while columns are picked.
 */
function targetOnStage(): OnStage | null {
  const { film: raw, cursor, playback, columns } = useEditor.getState();
  if (!raw || playback || columns) return null;
  const film = withPreview(raw);
  const layers = useLayers.getState();
  // The camera tool: the active camera's live picture, to place it.
  if (usePaint.getState().tool === "camera") {
    const camera = useCamera.getState();
    const rig = camera.rigs.find((r) => r.id === camera.activeRig);
    const live = rig ? camera.liveOf(rig) : null;
    const track = rig && film.tracks.find((t) => t.id === rig.target.track);
    const magnified = (magnifyControl(camera.controls)?.value ?? "1") !== "1";
    if (!rig || !live || !track?.visible || camera.targetOf(rig).cell !== cursor.cell || camera.pointerTool !== "none" || magnified) return null;
    const transform = composeTransforms(track.transform, rig.shot.transform);
    const media = { width: live.width, height: live.height };
    return {
      corners: shownCorners(media, rig.shot.look, transform, film.settings),
      transform,
      target: { kind: "rig", id: rig.id },
      stored: (composite) => relativeTransform(track.transform, composite),
      crop: { media, look: rig.shot.look },
    };
  }
  // A sequence shown: its picture at the cursor, moving all of the sequence (or just that picture).
  if (layers.detail === "sequence" && layers.seq) {
    const clip = Object.values(film.clips).find((c) => c.seq === layers.seq && cursor.cell >= c.start && cursor.cell < c.start + c.length);
    const track = clip && film.tracks.find((t) => t.id === clip.track);
    if (!clip || !track?.visible) return null;
    const transform = composeTransforms(track.transform, clip.transform);
    const one = layers.seqHandles === "one";
    return {
      corners: shownCorners(clip.media, clip.look, transform, film.settings),
      transform,
      target: one ? { kind: "clip", id: clip.id } : { kind: "sequence", id: layers.seq, ref: clip.id },
      stored: (composite) => relativeTransform(track.transform, composite),
      ...(one && { crop: { media: clip.media, look: clip.look ?? {} } }),
    };
  }
  // The picture picked in the timeline: its handles change just that picture.
  const focus = layers.detail === "clip" ? focusedClip(film) : layers.detail === "cell" ? cellClip(film) : null;
  if (focus) {
    const { clip, track } = focus;
    const transform = composeTransforms(track.transform, clip.transform);
    return {
      corners: shownCorners(clip.media, clip.look, transform, film.settings),
      transform,
      target: { kind: "clip", id: clip.id },
      stored: (composite) => relativeTransform(track.transform, composite),
      crop: { media: clip.media, look: clip.look ?? {} },
    };
  }
  // A track picked by its name, through its picture at the cursor: moving it moves all its pictures.
  if (layers.detail !== "track" || layers.panel !== "detail") return null;
  const track = film.tracks.find((t) => t.id === layers.trackId);
  if (!track || !track.visible || liveRigAt(track.id, cursor.cell)) return null;
  const clip = clipAt(film, track.id, cursor.cell);
  if (!clip) return null;
  const transform = composeTransforms(track.transform, clip.transform);
  return {
    corners: shownCorners(clip.media, clip.look, transform, film.settings),
    transform,
    target: { kind: "track", id: track.id },
    stored: (composite) => outerTransform(clip.transform, composite),
  };
}

/** Moving, scaling, turning and cropping the picked layer with its handles. */
function useLayerDrag(filmRect: React.RefObject<FilmRect | null>) {
  const drag = useRef<{ kind: HandleKind; start: Point; t0: Transform2D; target: HandleTarget; stored(c: Transform2D): Transform2D; crop?: OnStage["crop"]; change?: ShotChange } | null>(null);

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
    const kind = hitHandle(shown.corners, p, 1 / filmRect.current.s, !!shown.crop);
    if (!kind) return false;
    capturePointer(e);
    drag.current = { kind, start: p, t0: shown.transform, target: shown.target, stored: shown.stored, crop: shown.crop };
    return true;
  };

  const onPointerMove = (e: React.PointerEvent): boolean => {
    const d = drag.current;
    const { film } = useEditor.getState();
    if (!d || !film) return false;
    if (d.kind.startsWith("crop-") && d.crop) {
      // The side goes where the pointer is, in the picture's own pixels.
      const { media, look } = d.crop;
      const m = pictureMatrix({ media: media as MediaRef, transform: d.t0, look }, film.settings, media).inverse();
      const p = filmPoint(e);
      const q = m.transformPoint(new DOMPoint(p.x, p.y));
      const crop0 = look.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      const c = dragCrop(d.kind.slice(5) as CropSide, crop0, q, media);
      const whole = c.x < 0.001 && c.y < 0.001 && c.width > 0.999 && c.height > 0.999;
      d.change = { look: { crop: whole ? undefined : c } };
      if (d.target.kind === "rig") useCamera.getState().setShot(d.target.id, { look: { ...look, crop: d.change.look!.crop } });
      else if (d.target.kind === "clip") useShotPreview.setState({ preview: { ids: [d.target.id], change: d.change } });
      return true;
    }
    const composite = dragTransform(d.kind, d.t0, film.settings, d.start, filmPoint(e), e.shiftKey);
    // A camera changes live, outside the history.
    if (d.target.kind === "rig") useCamera.getState().setShot(d.target.id, { transform: d.stored(composite) });
    else useLayers.getState().setPreview({ target: d.target, transform: d.stored(composite) });
    return true;
  };

  const onPointerUp = (): boolean => {
    const d = drag.current;
    if (!d) return false;
    drag.current = null;
    if (d.kind.startsWith("crop-")) {
      if (d.target.kind === "clip" && d.change) commitShot([d.target.id], d.change);
      return true;
    }
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

/** Dragging with the middle button (the wheel) moves the zoomed picture. */
function usePanDrag() {
  const last = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown(e: React.PointerEvent): boolean {
      if (e.button !== 1) return false;
      e.preventDefault();
      capturePointer(e);
      last.current = { x: e.clientX, y: e.clientY };
      return true;
    },
    onPointerMove(e: React.PointerEvent): boolean {
      const l = last.current;
      if (!l) return false;
      panBy(e.clientX - l.x, e.clientY - l.y);
      last.current = { x: e.clientX, y: e.clientY };
      return true;
    },
    onPointerUp(): boolean {
      if (!last.current) return false;
      last.current = null;
      return true;
    },
  };
}

/**
 * Zoom with the trackpad (pinch) or Ctrl/⌘/Alt + the mouse wheel, about the
 * pointer; scrolling (two fingers, or the wheel) moves the zoomed picture.
 */
function useStageGestures(wrapRef: React.RefObject<HTMLDivElement | null>) {
  const filmId = useEditor((s) => s.filmId);
  // Another film starts fitted.
  useEffect(() => fitStage(), [filmId]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      // Pinching a trackpad comes as a wheel with Ctrl.
      const lines = e.deltaMode === 1 ? 16 : 1;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const box = wrap.getBoundingClientRect();
        zoomBy(Math.exp(-Math.max(-50, Math.min(50, e.deltaY * lines)) * 0.01), { x: e.clientX - box.left, y: e.clientY - box.top });
      } else if (e.shiftKey && !e.deltaX) panBy(-e.deltaY * lines, 0);
      else panBy(-e.deltaX * lines, -e.deltaY * lines);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [wrapRef]);
}

/** − / percent (back to fitting) / + over the big picture. */
function ZoomControl() {
  const zoom = useStageView((s) => s.zoom);
  return (
    <div className="zoom-control" onPointerDown={(e) => e.stopPropagation()}>
      <button className="icon-btn small" title="Alejar (Ctrl + −)" onClick={() => zoomBy(1 / 1.5)} disabled={zoom <= ZOOM_MIN}>
        <Icon name="minus" size={14} />
      </button>
      <button className="zoom-value" title="Ver todo el cuadro (Ctrl + 0)" onClick={fitStage}>
        {zoom === 1 ? "Ajustado" : `${Math.round(zoom * 100)} %`}
      </button>
      <button className="icon-btn small" title="Acercar (Ctrl + +; o pellizcá el trackpad, o Ctrl + rueda)" onClick={() => zoomBy(1.5)} disabled={zoom >= ZOOM_MAX}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
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
    // No text selection or drag-and-drop starting under the pen (which also keeps focus where it was: let it go).
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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

/**
 * The pick tool: a click (not a drag) picks what is under the pointer at the
 * cell, topmost first: a stroke or a picture. Clicking the same spot again
 * picks the next one down, to reach what is under. ⇧ adds strokes of the same
 * picture. A click on nothing lets go.
 */
function usePick(filmRect: React.RefObject<FilmRect | null>) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
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
    const again = last.current && Math.hypot(e.clientX - last.current.x, e.clientY - last.current.y) <= 4;
    last.current = { x: e.clientX, y: e.clientY };
    const shift = e.shiftKey;
    // A cell picked in a track's row (or an object of it): only what is in that cell.
    const { detail } = useLayers.getState();
    const inCell = (detail === "cell" || detail === "clip") && useEditor.getState().selection.length <= 1;
    void objectsAt(film, cursor.cell, p, 6 / r.s, inCell ? cursor.track : undefined).then((found) => {
      const editor = useEditor.getState();
      const picked = useStrokes.getState();
      if (!found.length) {
        selectStrokes(null, []);
        // Nothing of the cell there: back to the cell.
        if (inCell) useLayers.getState().showCell(cursor.track);
        else editor.setSelection([]);
        return;
      }
      if (shift && picked.clip) {
        // Adding (or taking out) a stroke of the picture already picked.
        const hit = found.find((o) => o.stroke && o.clip.id === picked.clip);
        if (hit) {
          const id = hit.stroke!.id;
          selectStrokes(picked.clip, picked.ids.includes(id) ? picked.ids.filter((i) => i !== id) : [...picked.ids, id]);
          return;
        }
      }
      // What is picked now, among what is here: the next one down, on a second click.
      const current = found.findIndex((o) =>
        o.stroke ? picked.clip === o.clip.id && picked.ids.includes(o.stroke.id) : !picked.ids.length && editor.selection.length === 1 && editor.selection[0] === o.clip.id,
      );
      const next = found[again && current >= 0 ? (current + 1) % found.length : 0]!;
      editor.setSelection([next.clip.id]);
      useLayers.getState().showClip(next.clip.track);
      selectStrokes(next.stroke ? next.clip.id : null, next.stroke ? [next.stroke.id] : []);
    });
  };
  return { onPointerDown, onPointerUp };
}

/** Where the sculpt brush is over the film, to draw its circle. */
let sculptHover: Point | null = null;

/** The sculpt tool on the strokes of the picture at the cursor. */
function useSculptPointer(filmRect: React.RefObject<FilmRect | null>) {
  const filmPoint = (e: React.PointerEvent): Point | null => {
    const r = filmRect.current;
    if (!r) return null;
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left - r.x) / r.s, y: (e.clientY - box.top - r.y) / r.s };
  };
  const onPointerDown = (e: React.PointerEvent): boolean => {
    if (usePaint.getState().tool !== "sculpt" || e.button !== 0) return false;
    const p = filmPoint(e);
    if (!p) return true;
    if (beginSculpt(p)) capturePointer(e);
    else useBusy.getState().notify("Acá no hay trazos para esculpir: elegí en la línea de tiempo la celda de un dibujo.");
    return true;
  };
  const onPointerMove = (e: React.PointerEvent): boolean => {
    if (usePaint.getState().tool !== "sculpt") return false;
    const p = filmPoint(e);
    sculptHover = p;
    if (p && sculpting()) moveSculpt(p);
    return true;
  };
  const onPointerUp = (): boolean => {
    if (usePaint.getState().tool !== "sculpt") return false;
    endSculpt();
    return true;
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

/** The lasso on the picture of the cell picked: drawing, pushing or moving its outline. */
function useLassoPointer(filmRect: React.RefObject<FilmRect | null>) {
  const filmPoint = (e: React.PointerEvent): { p: Point; px: number } | null => {
    const r = filmRect.current;
    if (!r) return null;
    const box = e.currentTarget.getBoundingClientRect();
    return { p: { x: (e.clientX - box.left - r.x) / r.s, y: (e.clientY - box.top - r.y) / r.s }, px: 1 / r.s };
  };
  const onPointerDown = (e: React.PointerEvent): boolean => {
    if (usePaint.getState().tool !== "lasso" || e.button !== 0) return false;
    const at = filmPoint(e);
    if (at && beginLasso(at.p, at.px)) capturePointer(e);
    return true;
  };
  const onPointerMove = (e: React.PointerEvent): boolean => {
    if (usePaint.getState().tool !== "lasso") return false;
    const at = filmPoint(e);
    if (at && lassoActive()) moveLasso(at.p);
    return true;
  };
  const onPointerUp = (): boolean => {
    if (usePaint.getState().tool !== "lasso") return false;
    endLasso();
    return true;
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

/** The picked strokes as the handles move them: their corners on the stage, and the picture's mapping. */
function strokesOnStage(): { corners: Point[]; matrix: DOMMatrix; clip: string; ids: string[] } | null {
  const { film: raw, cursor, playback } = useEditor.getState();
  if (!raw || playback || usePaint.getState().tool !== "move") return null;
  const picked = pickedStrokes(raw);
  if (!picked || cursor.cell < picked.clip.start || cursor.cell >= picked.clip.start + picked.clip.length) return null;
  const track = raw.tracks.find((t) => t.id === picked.clip.track);
  const lines = picked.strokes.filter((st) => st.points?.length);
  const b = strokesBounds(lines);
  if (!track || !b) return null;
  const { clip } = picked;
  const matrix = pictureMatrix({ media: clip.media, transform: composeTransforms(track.transform, clip.transform), look: clip.look }, raw.settings, clip.media);
  const corners = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ].map(([x, y]) => {
    const q = matrix.transformPoint(new DOMPoint(x, y));
    return { x: q.x, y: q.y };
  });
  return { corners, matrix, clip: clip.id, ids: lines.map((st) => st.id) };
}

/** The point of the one picked stroke under `p` (film coordinates), if any. */
function pointAt(on: NonNullable<ReturnType<typeof strokesOnStage>>, strokes: readonly Stroke[], p: Point, reach: number): number | null {
  if (on.ids.length !== 1) return null;
  const pts = strokes.find((st) => st.id === on.ids[0])?.points ?? [];
  let best: number | null = null;
  let bestD = reach;
  pts.forEach(([x, y], i) => {
    const q = on.matrix.transformPoint(new DOMPoint(x, y));
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** The points of the one picked stroke, as dots to drag. */
function drawStrokePoints(ctx: CanvasRenderingContext2D, film: FilmState, on: NonNullable<ReturnType<typeof strokesOnStage>>, px: number) {
  if (on.ids.length !== 1) return;
  const pts = film.clips[on.clip]?.strokes?.find((st) => st.id === on.ids[0])?.points ?? [];
  ctx.save();
  for (const [x, y] of pts) {
    const q = on.matrix.transformPoint(new DOMPoint(x, y));
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3.5 * px, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = "#ff7a45";
    ctx.stroke();
  }
  ctx.restore();
}

/** The handles' corners as the strokes being dragged are now. */
function withStrokePreviewCorners(on: NonNullable<ReturnType<typeof strokesOnStage>>): Point[] {
  const { preview } = useStrokePreview.getState();
  const b = preview && preview.clip === on.clip ? strokesBounds(preview.strokes.filter((st) => on.ids.includes(st.id))) : null;
  if (!b) return on.corners;
  return [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ].map(([x, y]) => {
    const q = on.matrix.transformPoint(new DOMPoint(x, y));
    return { x: q.x, y: q.y };
  });
}

/** Moving, scaling and turning the picked strokes with their handles (Blender's edit mode). */
function useStrokeDrag(filmRect: React.RefObject<FilmRect | null>) {
  const drag = useRef<{ kind: HandleKind | "point"; start: Point; center: Point; matrix: DOMMatrix; clip: string; ids: string[]; base: Stroke[]; point?: number } | null>(null);
  const filmPoint = (e: React.PointerEvent): Point => {
    const r = filmRect.current!;
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left - r.x) / r.s, y: (e.clientY - box.top - r.y) / r.s };
  };

  const onPointerDown = (e: React.PointerEvent): boolean => {
    const on = strokesOnStage();
    const clip = on && useEditor.getState().film?.clips[on.clip];
    if (!on || !clip || !filmRect.current) return false;
    const p = filmPoint(e);
    const [a, , c] = on.corners as [Point, Point, Point];
    const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    // One stroke: its points can be dragged one by one (they win over the handles).
    const point = pointAt(on, clip.strokes ?? [], p, 8 / filmRect.current.s);
    if (point !== null) {
      capturePointer(e);
      drag.current = { kind: "point", point, start: p, center, matrix: on.matrix, clip: on.clip, ids: on.ids, base: clip.strokes ?? [] };
      return true;
    }
    const kind = hitHandle(on.corners, p, 1 / filmRect.current.s, false);
    if (!kind) return false;
    capturePointer(e);
    drag.current = { kind, start: p, center, matrix: on.matrix, clip: on.clip, ids: on.ids, base: clip.strokes ?? [] };
    return true;
  };

  const onPointerMove = (e: React.PointerEvent): boolean => {
    const d = drag.current;
    if (!d) return false;
    const p = filmPoint(e);
    const { center: c, start } = d;
    if (d.kind === "point") {
      const q = d.matrix.inverse().transformPoint(new DOMPoint(p.x, p.y));
      const id = d.ids[0]!;
      const strokes = d.base.map((st) =>
        st.id !== id || !st.points ? st : { ...st, points: st.points.map((pt, i): [number, number, number, number] => (i === d.point ? [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100, pt[2], pt[3]] : pt)) },
      );
      useStrokePreview.setState({ preview: { clip: d.clip, strokes } });
      return true;
    }
    // The change, in film coordinates, then taken to the picture's pixels.
    let f = new DOMMatrix();
    if (d.kind === "move") f = f.translate(p.x - start.x, p.y - start.y);
    else if (d.kind === "scale") {
      let k = Math.hypot(p.x - c.x, p.y - c.y) / (Math.hypot(start.x - c.x, start.y - c.y) || 1);
      if (e.shiftKey) k = Math.max(0.05, Math.round(k * 20) / 20);
      f = f.translate(c.x, c.y).scale(k).translate(-c.x, -c.y);
    } else if (d.kind === "rotate") {
      let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      f = f.translate(c.x, c.y).rotate((a * 180) / Math.PI).translate(-c.x, -c.y);
    }
    const m = d.matrix.inverse().multiply(f).multiply(d.matrix);
    const widthScale = Math.sqrt(Math.abs(f.a * f.d - f.b * f.c));
    useStrokePreview.setState({ preview: { clip: d.clip, strokes: transformStrokes(d.base, d.ids, m, widthScale) } });
    return true;
  };

  const onPointerUp = (): boolean => {
    const d = drag.current;
    if (!d) return false;
    drag.current = null;
    const { preview } = useStrokePreview.getState();
    useStrokePreview.setState({ preview: null });
    if (!preview) return true;
    const patches = preview.strokes.filter((st) => d.ids.includes(st.id)).map((st) => ({ id: st.id, patch: { points: st.points } }));
    updateStrokes(d.clip, patches, d.kind === "point" ? "Mover un punto del trazo" : d.ids.length === 1 ? "Transformar trazo" : `Transformar ${d.ids.length} trazos`);
    return true;
  };

  return { onPointerDown, onPointerMove, onPointerUp };
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
  const strokePick = usePick(filmRect);
  const strokeDrag = useStrokeDrag(filmRect);
  const sculptPointer = useSculptPointer(filmRect);
  const lassoPointer = useLassoPointer(filmRect);
  const panDrag = usePanDrag();
  useStageGestures(wrapRef);
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
    return !!c && !c.sound && s.cursor.cell >= c.start && s.cursor.cell < c.start + c.length;
  });
  // Whether the big picture shows a camera live: one aimed at the cell on screen (or magnified).
  const cursorCell = useEditor((s) => s.cursor.cell);
  const liveHere = useCamera((s) => s.rigs.some((r) => r.source && s.targetOf(r).cell === cursorCell));
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
      // Fitted in the stage, then zoomed and moved as the view says (see stageView).
      const layout = { width: cw, height: ch, area, fit: containScale(area, { width: cw, height: ch }) * (placing ? 0.9 : 0.98), dpr };
      setStageLayout(layout);
      const { s, ox, oy } = viewTransform(layout);
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
        const cell = playedCell(film, playbackCell(playback, size.fps));
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
      // The lasso: what its outline leaves out, faintly, to see what to take.
      if (tool === "lasso" && !playback) {
        const ghost = lassoGhost(film);
        if (ghost) drawProxies(ctx, filmId, film, [ghost], 0.3);
      }
      ctx.restore();
      // The film's edge, just outside it, so it stands out from the stage around it.
      const edge = dpr / s;
      ctx.lineWidth = 1.5 * edge;
      ctx.strokeStyle = "rgb(255 255 255 / 0.32)";
      ctx.strokeRect(-0.75 * edge, -0.75 * edge, size.width + 1.5 * edge, size.height + 1.5 * edge);
      if (showGuides) drawGuides(ctx, guides, size, dpr / s, placing);
      const handles = layerHandles.current();
      // Picked strokes have their own handles, instead of their picture's.
      const strokeHandles = strokesOnStage();
      if (tool === "move") drawPickedStrokes(ctx, shown, dpr / s);
      if (strokeHandles && !placing) {
        drawHandles(ctx, withStrokePreviewCorners(strokeHandles), dpr / s, false);
        drawStrokePoints(ctx, shown, strokeHandles, dpr / s);
      }
      if (tool === "lasso" && !playback) drawLassoOutline(ctx, film, dpr / s);
      if (tool === "sculpt" && sculptHover) {
        // The sculpt brush's size, visible over light and dark.
        ctx.beginPath();
        ctx.arc(sculptHover.x, sculptHover.y, Math.max(currentSettings().size / 2, 1), 0, Math.PI * 2);
        ctx.lineWidth = (3 * dpr) / s;
        ctx.strokeStyle = "rgb(0 0 0 / 0.6)";
        ctx.stroke();
        ctx.lineWidth = (1.2 * dpr) / s;
        ctx.strokeStyle = "#5cc8b5";
        ctx.stroke();
      }
      else if (handles && !placing && !isPainting(tool) && tool !== "lasso") drawHandles(ctx, handles.corners, dpr / s, !!handles.crop);
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
        if (panDrag.onPointerDown(e)) return;
        if (!playing) strokePick.onPointerDown(e);
        if (playing || guideDrag.onPointerDown(e) || paintPointer.onPointerDown(e) || sculptPointer.onPointerDown(e) || lassoPointer.onPointerDown(e) || strokeDrag.onPointerDown(e) || layerDrag.onPointerDown(e)) return;
        if (hasSource) handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        if (panDrag.onPointerMove(e)) return;
        if (playing || guideDrag.onPointerMove(e) || paintPointer.onPointerMove(e) || sculptPointer.onPointerMove(e) || lassoPointer.onPointerMove(e) || strokeDrag.onPointerMove(e) || layerDrag.onPointerMove(e)) return;
        if (hasSource) handlers.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        if (panDrag.onPointerUp()) return;
        if (!playing) strokePick.onPointerUp(e);
        if (playing || guideDrag.onPointerUp() || paintPointer.onPointerUp() || sculptPointer.onPointerUp() || lassoPointer.onPointerUp() || strokeDrag.onPointerUp() || layerDrag.onPointerUp()) return;
        if (hasSource) handlers.onPointerUp(e);
      }}
      onPointerCancel={() => paintPointer.onPointerUp()}
      onDragStart={(e) => e.preventDefault()}
      onPointerLeave={() => {
        leaveStage();
        sculptHover = null;
      }}
    >
      <canvas ref={canvasRef} />
      {!playing && <StageTools />}
      <ZoomControl />
      <StageSound />
      <StageSoundView />
      {marker && <div className="focus-marker" style={{ left: marker.x, top: marker.y }} />}
      {!playing && magnified && <div className="stage-badge zoom">🔍 Lupa · arrastrá para mover</div>}
      {!playing && !hasSource && (
        <div className="stage-note">{cameraError ?? "Conectando la cámara…"}</div>
      )}
      {playing && <div className="stage-badge">▶ Reproduciendo</div>}
      {!playing && (liveHere || magnified || recording) && (
        <div className="stage-badge live">
          <span className="live-dot" />
          {recording ? "Grabando · espacio o el botón grande para detener" : "En vivo"}
        </div>
      )}
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
