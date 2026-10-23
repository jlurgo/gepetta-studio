import { type FilmState, type TrackId, cellIndex, stackAt } from "@gepetta/core";
import { proxyCache } from "../media/cache";
import { picture, strokesKey } from "../media/composed";
import { type Drawable, drawStack } from "../render/frame";
import { storage } from "../storage";

/** One decoded picture per image and strokes. */
function pictureId(item: Pick<Drawable, "media" | "strokes">): string {
  return `${item.media.original}#${strokesKey(item.strokes)}`;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** The cells to draw, in order (e.g. exportedCells, or every other one of them). */
  cells: readonly number[];
  /** Only these tracks (e.g. one track on its own); all exported tracks when missing. */
  tracks?: TrackId[];
  /** "original" (full size, for files) or "proxy" (quicker, for previews on screen). */
  res?: "original" | "proxy";
  /** Draws on this canvas (e.g. one a video encoder reads); a new one when missing. */
  canvas?: HTMLCanvasElement;
}

/**
 * Draws the given cells of the film, one after another, on one canvas: the
 * same picture every export makes. Yields after each cell, with `changed`
 * false when it looks just like the one before (a held picture), so the
 * caller can reuse what it made from it.
 */
export async function* renderCells(
  filmId: string,
  film: FilmState,
  opts: RenderOptions,
): AsyncGenerator<{ canvas: HTMLCanvasElement; index: number; cell: number; changed: boolean }> {
  const { width, height } = opts;
  const res = opts.res ?? "original";
  const canvas = opts.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const scale = { x: width / film.settings.width, y: height / film.settings.height };
  const index = cellIndex(film);
  const only = opts.tracks;
  // Decoded pictures, kept while consecutive cells still show them; only the
  // ones decoded here are closed (cached proxies belong to the cache).
  let bitmaps = new Map<string, CanvasImageSource>();
  const owned = new Set<CanvasImageSource>();
  const release = (b: CanvasImageSource) => {
    if (owned.delete(b) && b instanceof ImageBitmap) b.close();
  };
  let shown: string | null = null;
  try {
    for (let i = 0; i < opts.cells.length; i++) {
      const cell = opts.cells[i]!;
      // A track exported on its own goes out even if it is only a reference.
      const stack = stackAt(film, cell, { index, ...(only ? { tracks: only } : { exportOnly: true }) });
      const key = stack.map((s) => `${s.clipId}:${pictureId(s)}`).join("|");
      const changed = key !== shown;
      if (changed) {
        const next = new Map<string, CanvasImageSource>();
        for (const item of stack) {
          const id = pictureId(item);
          if (next.has(id)) continue;
          let bitmap = bitmaps.get(id);
          if (!bitmap) {
            // A picture with drawing strokes goes out with them.
            if (item.strokes?.length) bitmap = await picture(filmId, item.media, item.strokes, res);
            else if (res === "proxy") bitmap = await proxyCache.load(filmId, item.media.proxy);
            else {
              bitmap = await createImageBitmap(await storage.getAsset(filmId, item.media.original));
              owned.add(bitmap);
            }
          }
          next.set(id, bitmap);
        }
        bitmaps.forEach((b, id) => !next.has(id) && release(b));
        bitmaps = next;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
        drawStack(ctx, stack, film.settings, (item) => bitmaps.get(pictureId(item)));
        shown = key;
      }
      yield { canvas, index: i, cell, changed };
    }
  } finally {
    bitmaps.forEach(release);
  }
}
