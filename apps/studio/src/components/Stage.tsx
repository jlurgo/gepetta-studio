import { type FilmState, type Frame, type ImageLayer, frameIndexAtTick, timeline } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { proxyCache } from "../media/cache";
import { containScale, drawContained, drawFrame } from "../render/frame";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { magnifyControl } from "./MagnifyPanel";
import { capturePointer } from "./pointer";

const PREFETCH = 12;

/** Draws a frame's proxies, requesting the ones not decoded yet. Returns false if something was missing. */
function drawProxyFrame(ctx: CanvasRenderingContext2D, filmId: string, film: FilmState, frame: Frame, alpha = 1): boolean {
  let complete = true;
  drawFrame(ctx, frame, film.settings, (layer: ImageLayer) => {
    const bmp = proxyCache.peek(filmId, layer.media.proxy);
    if (!bmp) {
      complete = false;
      void proxyCache.load(filmId, layer.media.proxy);
    }
    return bmp;
  }, alpha);
  return complete;
}

function prefetch(filmId: string, frames: Frame[]) {
  for (const f of frames) for (const l of f.layers) void proxyCache.load(filmId, l.media.proxy);
}

/** Previous frames (nearest first) for onion skinning, ending at `anchorIndex`. */
function onionFrames(film: FilmState, anchorIndex: number, count: number): Frame[] {
  const out: Frame[] = [];
  for (let i = anchorIndex; i >= 0 && out.length < count; i--) out.push(film.frames[film.frameOrder[i]!]!);
  return out;
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

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveRect = useRef<Rect | null>(null);
  const { marker, handlers } = useLivePointer(liveRect);
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

      // Film area: letterboxed in the stage, in film pixel coordinates.
      const size = film.settings;
      const s = containScale(size, { width: cw, height: ch }) * 0.98;
      ctx.setTransform(s, 0, 0, s, (cw - size.width * s) / 2, (ch - size.height * s) / 2);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.imageSmoothingQuality = "high";

      const { playback, onion, selected, view } = state;
      if (playback) {
        const { frames, totalTicks } = timeline(film);
        const tick = playback.startTick + Math.floor(((performance.now() - playback.startedAt) * size.fps) / 1000);
        if (tick >= totalTicks) {
          if (playback.loop) useEditor.setState({ playback: { ...playback, startedAt: performance.now() } });
          else state.stop();
          return;
        }
        const index = frameIndexAtTick(frames, tick);
        const current = frames[index];
        if (current) {
          drawProxyFrame(ctx, filmId, film, current.frame);
          prefetch(filmId, frames.slice(index + 1, index + 1 + PREFETCH).map((f) => f.frame));
        }
        return;
      }

      const selIndex = selected ? film.frameOrder.indexOf(selected) : -1;
      let onionAnchor: number;
      liveRect.current = null;
      if (view === "live") {
        const live = useCamera.getState().source?.live();
        if (live) {
          drawContained(ctx, live.image, live, size);
          // Where the picture landed, in CSS pixels of the stage, for pointer interactions.
          const c = containScale(live, size);
          const ox = (cw - size.width * s) / 2 + ((size.width - live.width * c) / 2) * s;
          const oy = (ch - size.height * s) / 2 + ((size.height - live.height * c) / 2) * s;
          liveRect.current = { x: ox / dpr, y: oy / dpr, w: (live.width * c * s) / dpr, h: (live.height * c * s) / dpr };
        }
        // A magnified view does not line up with earlier frames.
        const magnify = magnifyControl(useCamera.getState().controls);
        onionAnchor = magnify && magnify.value !== "1" ? -1 : selIndex;
      } else {
        if (selected) drawProxyFrame(ctx, filmId, film, film.frames[selected]!);
        onionAnchor = selIndex - 1;
      }

      if (onion.enabled && onionAnchor >= 0) {
        const skins = onionFrames(film, onionAnchor, onion.count);
        // Farthest first so the nearest frame ends on top.
        skins.reverse().forEach((frame, i) => {
          const distance = skins.length - i - 1;
          drawProxyFrame(ctx, filmId, film, frame, onion.opacity * (1 - distance / (onion.count + 1)));
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`stage${view === "live" && pointerTool === "focus" ? " tool-focus" : ""}${view === "live" && magnified ? " magnified" : ""}`}
      ref={wrapRef}
      {...(view === "live" && !playing ? handlers : {})}
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
