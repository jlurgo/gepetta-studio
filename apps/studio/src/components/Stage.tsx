import {
  type CellIndex,
  type FilmState,
  type MediaRef,
  type Point,
  type Transform2D,
  cellIndex,
  clipAt,
  composeTransforms,
  moveVanishingPoint,
  previousClips,
  splitAtTrack,
  stackAt,
  vanishingPoints,
} from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { proxyCache } from "../media/cache";
import type { LiveFrame } from "../capture/types";
import { type Drawable, type Size, containScale, drawContained, drawStack } from "../render/frame";
import { drawHandles, dragTransform, hitHandle, type HandleKind } from "../render/handles";
import { selectedTrack, updateTrack, useLayers } from "../state/layers";
import { useCamera } from "../state/camera";
import { measureProbes, probeColor, probeSize, readings, useFocusProbes } from "../state/focusProbes";
import { playbackCell, useEditor } from "../state/editor";
import { useGuides } from "../state/guides";
import { drawGuides, hitVanishingPoint } from "../render/guides";
import { magnifyControl } from "./MagnifyPanel";
import { capturePointer } from "./pointer";

const PREFETCH = 12;

/** Draws pictures from their proxies, requesting the ones not decoded yet. Returns false if something was missing. */
function drawProxies(ctx: CanvasRenderingContext2D, filmId: string, film: FilmState, items: readonly Drawable[], alpha = 1): boolean {
  let complete = true;
  drawStack(
    ctx,
    items,
    film.settings,
    (media) => {
      const bmp = proxyCache.peek(filmId, media.proxy);
      if (!bmp) {
        complete = false;
        void proxyCache.load(filmId, media.proxy);
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
function withPreview(film: FilmState): FilmState {
  const preview = useLayers.getState().preview;
  if (!preview) return film;
  return { ...film, tracks: film.tracks.map((t) => (t.id === preview.trackId ? { ...t, transform: preview.transform } : t)) };
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

/**
 * The selected track as it shows on the stage now (its picture, and the
 * transform it is drawn with), or null when nothing of it is on screen.
 * `trackTransform` is what dragging changes.
 */
function targetOnStage(): { media: MediaRef; transform: Transform2D; trackTransform: Transform2D } | null {
  const { film, cursor, view, playback } = useEditor.getState();
  const { preview } = useLayers.getState();
  const track = selectedTrack();
  if (!film || playback || !track || !track.visible) return null;
  // In the live view the cursor's track is the camera, which does not move.
  if (view === "live" && track.id === cursor.track) return null;
  const clip = clipAt(film, track.id, cursor.cell);
  if (!clip) return null;
  const trackTransform = preview?.trackId === track.id ? preview.transform : track.transform;
  return { media: clip.media, transform: composeTransforms(trackTransform, clip.transform), trackTransform };
}

/** Moving, scaling and rotating the selected layer with its handles. */
function useLayerDrag(filmRect: React.RefObject<FilmRect | null>) {
  const drag = useRef<{ kind: HandleKind; start: Point; t0: Transform2D } | null>(null);

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
    const kind = hitHandle(shown.media, shown.transform, film.settings, p, 1 / filmRect.current.s);
    if (!kind) return false;
    capturePointer(e);
    drag.current = { kind, start: p, t0: shown.trackTransform };
    return true;
  };

  const onPointerMove = (e: React.PointerEvent): boolean => {
    const d = drag.current;
    const { film } = useEditor.getState();
    const { trackId, setPreview } = useLayers.getState();
    if (!d || !film || !trackId) return false;
    setPreview({ trackId, transform: dragTransform(d.kind, d.t0, film.settings, d.start, filmPoint(e), e.shiftKey) });
    return true;
  };

  const onPointerUp = (): boolean => {
    if (!drag.current) return false;
    drag.current = null;
    const { preview, setPreview } = useLayers.getState();
    if (preview) updateTrack(preview.trackId, { transform: preview.transform });
    setPreview(null);
    return true;
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveRect = useRef<Rect | null>(null);
  const { marker, handlers } = useLivePointer(liveRect);
  const filmRect = useRef<FilmRect | null>(null);
  const guideDrag = useGuideDrag(filmRect);
  const layerDrag = useLayerDrag(filmRect);
  const layerHandles = useRef(targetOnStage);
  const guideEditing = useGuides((s) => s.editing);
  const pointerTool = useCamera((s) => s.pointerTool);
  const magnified = useCamera((s) => (magnifyControl(s.controls)?.value ?? "1") !== "1");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasSource = useCamera((s) => s.source !== null);
  const cameraError = useCamera((s) => s.error?.message ?? null);
  const view = useEditor((s) => s.view);
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
      const { playback, onion, cursor, view } = state;
      if (playback) {
        const cell = playbackCell(playback, size.fps);
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
      if (view === "live") {
        const live = useCamera.getState().live();
        // The film at the cursor, with the camera in place of the cursor track's picture.
        const tracks = splitAtTrack(shown, stackAt(shown, cursor.cell), cursor.track);
        drawProxies(ctx, filmId, film, tracks.below);
        if (live) {
          drawContained(ctx, live.image, live, size);
          // Where the picture landed, in CSS pixels of the stage, for pointer interactions.
          const c = containScale(live, size);
          const lx = ox + ((size.width - live.width * c) / 2) * s;
          const ly = oy + ((size.height - live.height * c) / 2) * s;
          liveRect.current = { x: lx / dpr, y: ly / dpr, w: (live.width * c * s) / dpr, h: (live.height * c * s) / dpr };
        }
        drawProxies(ctx, filmId, film, tracks.above);
        // A magnified view does not line up with earlier pictures, nor with the measuring spots.
        const magnify = magnifyControl(useCamera.getState().controls);
        const magnified = magnify !== undefined && magnify.value !== "1";
        if (magnified) {
          showGuides = false;
          showOnion = false;
        }
        if (live && !magnified) {
          measureProbes(live);
          probesToDraw = live;
        }
      } else {
        drawProxies(ctx, filmId, film, stackAt(shown, cursor.cell, { index }));
      }

      // Onion skin: the previous pictures of the track being worked on.
      const track = shown.tracks.find((t) => t.id === cursor.track);
      if (showOnion && track) {
        const skins = previousClips(film, cursor.track, cursor.cell, onion.count, index);
        // Farthest first so the nearest one ends on top.
        skins.reverse().forEach((clip, i) => {
          const distance = skins.length - i - 1;
          const item = { media: clip.media, opacity: 1, transform: composeTransforms(track.transform, clip.transform) };
          drawProxies(ctx, filmId, film, [item], onion.opacity * (1 - distance / (onion.count + 1)));
        });
      }
      ctx.restore();
      if (showGuides) drawGuides(ctx, guides, size, dpr / s, placing);
      const handles = layerHandles.current();
      if (handles && !placing) drawHandles(ctx, handles.media, handles.transform, size, dpr / s);
      if (probesToDraw) drawProbes(ctx, probesToDraw, size, s);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`stage${guideEditing ? " guides-editing" : ""}${view === "live" && pointerTool !== "none" ? " tool-focus" : ""}${view === "live" && magnified ? " magnified" : ""}`}
      ref={wrapRef}
      onPointerDown={(e) => {
        if (playing || guideDrag.onPointerDown(e) || layerDrag.onPointerDown(e)) return;
        if (view === "live") handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        if (playing || guideDrag.onPointerMove(e) || layerDrag.onPointerMove(e)) return;
        if (view === "live") handlers.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        if (playing || guideDrag.onPointerUp() || layerDrag.onPointerUp()) return;
        if (view === "live") handlers.onPointerUp(e);
      }}
    >
      <canvas ref={canvasRef} />
      {marker && <div className="focus-marker" style={{ left: marker.x, top: marker.y }} />}
      {view === "live" && !playing && magnified && <div className="stage-badge zoom">🔍 Lupa · arrastrá para mover</div>}
      {view === "live" && !playing && !hasSource && (
        <div className="stage-note">{cameraError ?? "Conectando la cámara…"}</div>
      )}
      {playing && <div className="stage-badge">▶ Reproduciendo</div>}
      {!playing && view === "live" && hasSource && <div className="stage-badge live">● En vivo</div>}
    </div>
  );
}
