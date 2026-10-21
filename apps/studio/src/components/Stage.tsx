import { type FilmState, type Frame, type ImageLayer, frameIndexAtTick, timeline } from "@gepetta/core";
import { useEffect, useRef } from "react";
import { proxyCache } from "../media/cache";
import { containScale, drawContained, drawFrame } from "../render/frame";
import { liveVideo, useCamera } from "../state/camera";
import { useEditor } from "../state/editor";

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

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasStream = useCamera((s) => s.stream !== null);
  const cameraError = useCamera((s) => s.error);
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
      if (view === "live") {
        if (liveVideo.readyState >= 2 && liveVideo.videoWidth) {
          drawContained(ctx, liveVideo, { width: liveVideo.videoWidth, height: liveVideo.videoHeight }, size);
        }
        onionAnchor = selIndex;
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
    <div className="stage" ref={wrapRef}>
      <canvas ref={canvasRef} />
      {view === "live" && !playing && !hasStream && (
        <div className="stage-note">{cameraError ?? "Conectando la cámara…"}</div>
      )}
      {playing && <div className="stage-badge">▶ Reproduciendo</div>}
      {!playing && view === "live" && hasStream && <div className="stage-badge live">● En vivo</div>}
    </div>
  );
}
