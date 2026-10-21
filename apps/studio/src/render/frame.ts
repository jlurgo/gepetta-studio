import type { Frame, ImageLayer } from "@gepetta/core";

export interface Size {
  width: number;
  height: number;
}

/** Scale that fits `src` entirely inside `dst`. */
export function containScale(src: Size, dst: Size): number {
  return Math.min(dst.width / src.width, dst.height / src.height);
}

/** Draws a source centered and letterboxed inside a film-sized area at the origin. */
export function drawContained(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, img: CanvasImageSource, src: Size, film: Size) {
  const s = containScale(src, film);
  const w = src.width * s;
  const h = src.height * s;
  ctx.drawImage(img, (film.width - w) / 2, (film.height - h) / 2, w, h);
}

/**
 * Draws a frame's visible layers in film coordinates. `lookup` returns the
 * decoded image for a layer (proxy on screen, original on export), or undefined
 * while it is still loading.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: Frame,
  film: Size,
  lookup: (layer: ImageLayer) => CanvasImageSource | undefined,
  alpha = 1,
) {
  for (const layer of frame.layers) {
    if (!layer.visible) continue;
    const img = lookup(layer);
    if (!img) continue;
    const { x, y, rotation, scale } = layer.transform;
    ctx.save();
    ctx.globalAlpha = alpha * layer.opacity;
    ctx.translate(film.width / 2 + x, film.height / 2 + y);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.translate(-film.width / 2, -film.height / 2);
    drawContained(ctx, img, layer.media, film);
    ctx.restore();
  }
}
