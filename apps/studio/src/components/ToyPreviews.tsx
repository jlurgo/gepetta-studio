import { type DiscOptions, polar } from "@gepetta/core";
import { useEffect, useMemo, useRef } from "react";
import { paintDisc } from "../export/toys";

/** Runs `draw(seconds)` every animation frame while mounted. */
function useAnimation(ref: React.RefObject<HTMLCanvasElement | null>, draw: (ctx: CanvasRenderingContext2D, t: number) => void) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const ctx = ref.current?.getContext("2d");
      if (ctx) drawRef.current(ctx, (performance.now() - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref]);
}

const BG = "#1b1916";

/**
 * A flipbook held by its binding on the left, pages let go one by one by a
 * thumb on the right: each page bends away and shows the next.
 */
export function FlipbookPreview({ frames, aspect, fps }: { frames: readonly CanvasImageSource[]; aspect: number; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 420;
  const H = 300;
  useAnimation(ref, (ctx, t) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const n = frames.length;
    if (!n) return;
    const bind = 34;
    const pw = Math.min(W - bind - 40, (H - 50) * aspect);
    const ph = pw / aspect;
    const x0 = (W - pw - bind) / 2;
    const y0 = (H - ph) / 2 - 6;
    // The pile's edge under the pages.
    for (let i = 5; i > 0; i--) {
      ctx.fillStyle = i % 2 ? "#d9d4cc" : "#f3efe8";
      ctx.fillRect(x0 + i * 1.2, y0 + i * 1.6, pw + bind, ph);
    }
    const f = t * fps;
    const k = Math.floor(f) % n;
    // A page stays still most of the time and bends away quickly at the end.
    const q = Math.max(0, (f - Math.floor(f) - 0.55) / 0.45);
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(x0, y0, bind, ph);
    ctx.drawImage(frames[(k + 1) % n]!, x0 + bind, y0, pw, ph);
    // The page leaving: narrower as it lifts, darker as it turns.
    const w = pw * Math.cos((q * Math.PI) / 2);
    if (w > 0.5) {
      ctx.drawImage(frames[k]!, x0 + bind, y0 - q * 10, w, ph);
      ctx.fillStyle = `rgba(0,0,0,${0.35 * q})`;
      ctx.fillRect(x0 + bind, y0 - q * 10, w, ph);
    }
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(x0, y0, bind, ph);
    ctx.fillStyle = "#666";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(k + 1), x0 + bind / 2, y0 + 16);
    // The staples.
    ctx.fillStyle = "#888";
    ctx.fillRect(x0 + bind / 2 - 1, y0 + ph * 0.25, 2, 12);
    ctx.fillRect(x0 + bind / 2 - 1, y0 + ph * 0.7, 2, 12);
  });
  return <canvas ref={ref} width={W} height={H} className="toy-canvas" />;
}

/**
 * A zoetrope: the drum from above, turning at `rpm`, and what the eye sees
 * through the slits: one picture each time a slit goes by.
 */
export function ZoetropePreview({ frames, aspect, rpm }: { frames: readonly CanvasImageSource[]; aspect: number; rpm: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 460;
  const H = 260;
  useAnimation(ref, (ctx, t) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const n = frames.length;
    if (!n) return;
    const turns = (t * rpm) / 60;
    // Left: from above, turning anticlockwise, pictures inside the wall.
    const cx = 120;
    const cy = 130;
    const R = 100;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-turns * 2 * Math.PI);
    ctx.fillStyle = "#3a332c";
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#5a5047";
    ctx.beginPath();
    ctx.arc(0, 0, R - 8, 0, 2 * Math.PI);
    ctx.fill();
    const cell = Math.min(((2 * Math.PI * (R - 10)) / n) * 0.9, 40);
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -(R - 10));
      ctx.rotate(Math.PI);
      ctx.drawImage(frames[i]!, -cell / 2, -cell / aspect, cell, cell / aspect);
      ctx.restore();
      // A slit between each two pictures.
      const [sx, sy] = polar(R - 4, a + Math.PI / n);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#a89f92";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("El tambor, visto desde arriba", cx, H - 6);

    // Right: through a slit, one picture per slit that goes by.
    const slitsPassed = turns * n;
    const k = Math.floor(slitsPassed) % n;
    const phase = slitsPassed - Math.floor(slitsPassed);
    const vw = 200;
    const vh = vw / aspect;
    const vx = 245;
    const vy = (H - vh) / 2 - 6;
    ctx.drawImage(frames[k]!, vx, vy, vw, vh);
    // A slight flicker between slits, as with a real one.
    ctx.fillStyle = `rgba(0,0,0,${0.25 * Math.sin(phase * Math.PI)})`;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeRect(vx - 3, vy - 3, vw + 6, vh + 6);
    ctx.fillStyle = "#a89f92";
    ctx.fillText(`Por las ranuras: ${((rpm / 60) * n).toFixed(1)} cuadros/s`, vx + vw / 2, H - 6);
  });
  return <canvas ref={ref} width={W} height={H} className="toy-canvas" />;
}

/**
 * A phenakistoscope: the disc turning, and the disc as seen in the mirror
 * through the slits — frozen each time a slit goes by, so the pictures move.
 */
export function DiscPreview({
  frames,
  disc,
  mirror,
  rpm,
}: {
  frames: readonly CanvasImageSource[];
  disc: DiscOptions;
  mirror: boolean;
  rpm: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 460;
  const H = 260;
  const size = 220;
  // The face of the disc, painted once per change.
  const face = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.translate(size / 2, size / 2);
    paintDisc(ctx, disc, frames, size / disc.diameter, mirror, false);
    return c;
  }, [disc, frames, mirror]);
  useAnimation(ref, (ctx, t) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const turns = (t * rpm) / 60;
    const draw = (cx: number, angle: number, flip: boolean) => {
      ctx.save();
      ctx.translate(cx, 120);
      if (flip) ctx.scale(-1, 1);
      // Anticlockwise seen from the printed side.
      ctx.rotate(-angle);
      ctx.drawImage(face, -size / 2, -size / 2);
      ctx.restore();
    };
    draw(118, turns * 2 * Math.PI, false);
    // In the mirror: frozen at each slit, left and right swapped.
    const step = Math.floor(turns * disc.slits);
    draw(342, (step * 2 * Math.PI) / disc.slits, true);
    ctx.fillStyle = "#a89f92";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("El disco girando", 118, H - 6);
    ctx.fillText(`En el espejo, por las ranuras (${((rpm / 60) * disc.slits).toFixed(1)}/s)`, 342, H - 6);
  });
  return <canvas ref={ref} width={W} height={H} className="toy-canvas" />;
}
