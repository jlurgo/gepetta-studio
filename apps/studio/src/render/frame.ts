import type { Frame, MediaRef, Transform2D } from "@gepetta/core";

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

/** A picture to draw: a frame's layer or a channel's current picture. */
export interface Drawable {
  media: MediaRef;
  opacity: number;
  transform: Transform2D;
}

/** A frame's own visible layers (no channels), bottom to top: what onion skin shows. */
export function ownLayers(frame: Frame): Drawable[] {
  return frame.layers.filter((l) => l.visible);
}

/**
 * Draws pictures bottom to top in film coordinates. Each is fitted inside the
 * film, then moved/rotated/scaled about the film's center. `lookup` returns the
 * decoded image (proxy on screen, original on export), or undefined while it
 * is still loading.
 */
export function drawStack(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  items: readonly Drawable[],
  film: Size,
  lookup: (media: MediaRef) => CanvasImageSource | undefined,
  alpha = 1,
) {
  for (const item of items) {
    const img = lookup(item.media);
    if (!img) continue;
    const { x, y, rotation, scale } = item.transform;
    ctx.save();
    ctx.globalAlpha = alpha * item.opacity;
    ctx.translate(film.width / 2 + x, film.height / 2 + y);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.translate(-film.width / 2, -film.height / 2);
    drawContained(ctx, img, item.media, film);
    ctx.restore();
  }
}
