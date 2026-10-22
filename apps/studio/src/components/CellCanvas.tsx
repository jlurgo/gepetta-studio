import type { MediaRef, Transform2D } from "@gepetta/core";
import { memo, useEffect, useRef } from "react";
import type { LiveFrame } from "../capture/types";
import { thumbUrl } from "../media/cache";
import { type Size, drawStack } from "../render/frame";

/**
 * One timeline cell drawn like the film shows it: the film's frame shape,
 * letterboxed, with pictures at their opacity and position (so a picture
 * made smaller shows smaller), and cameras live where they aim.
 */
export type CellItem =
  | { kind: "picture"; media: MediaRef; opacity: number; transform: Transform2D }
  | { kind: "live"; frame: () => LiveFrame | null; opacity: number; transform: Transform2D };

/** Decoded thumbnails, shared by every cell that shows them. */
const loading = new Map<string, Promise<HTMLImageElement>>();
const ready = new Map<string, HTMLImageElement>();

function thumbImage(filmId: string, asset: string): Promise<HTMLImageElement> {
  const key = `${filmId}/${asset}`;
  let p = loading.get(key);
  if (!p) {
    p = thumbUrl(filmId, asset).then(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            ready.set(key, img);
            resolve(img);
          };
          img.onerror = () => reject(new Error("thumb"));
          img.src = url;
        }),
    );
    p.catch(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

/** Live cells redraw this often (the big picture is the smooth one). */
const LIVE_FPS = 8;

function draw(canvas: HTMLCanvasElement, filmId: string, film: Size, items: CellItem[]) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // The film's frame, letterboxed in the cell.
  const s = Math.min(w / film.width, h / film.height);
  const ox = (w - film.width * s) / 2;
  const oy = (h - film.height * s) / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(ox, oy, film.width * s, film.height * s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, film.width * s, film.height * s);
  ctx.clip();
  ctx.setTransform(s, 0, 0, s, ox, oy);
  for (const item of items) {
    if (item.kind === "picture") {
      drawStack(ctx, [item], film, (m) => ready.get(`${filmId}/${m.thumb}`));
    } else {
      const frame = item.frame();
      if (frame) {
        const media = { width: frame.width, height: frame.height } as MediaRef;
        drawStack(ctx, [{ media, opacity: item.opacity, transform: item.transform }], film, () => frame.image);
      }
    }
  }
  ctx.restore();
}

export const CellCanvas = memo(function CellCanvas({ filmId, film, items }: { filmId: string; film: Size; items: CellItem[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = items.some((i) => i.kind === "live");
  // Redraw only when what is drawn changes (live cells redraw on their own).
  const key = JSON.stringify(items.map((i) => (i.kind === "picture" ? [i.media.thumb, i.opacity, i.transform] : ["live", i.opacity, i.transform])));

  useEffect(() => {
    let alive = true;
    const canvas = ref.current;
    if (!canvas) return;
    const pictures = items.filter((i): i is Extract<CellItem, { kind: "picture" }> => i.kind === "picture");
    void Promise.all(pictures.map((p) => thumbImage(filmId, p.media.thumb).catch(() => undefined))).then(() => {
      if (alive && !live) draw(canvas, filmId, film, items);
    });
    if (!live) {
      draw(canvas, filmId, film, items);
      // Zooming the timeline resizes the cell: draw again at the new size, never stretched.
      const ro = new ResizeObserver(() => alive && draw(canvas, filmId, film, items));
      ro.observe(canvas);
      return () => {
        alive = false;
        ro.disconnect();
      };
    }
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 1000 / LIVE_FPS) return;
      last = t;
      draw(canvas, filmId, film, items);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // `items` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmId, key, film.width, film.height, live]);

  return <canvas ref={ref} className="cell-canvas" />;
});
