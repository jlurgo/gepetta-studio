import { type Look, type MediaRef, type Stroke, type Transform2D, compositeOf, cropRect, effectsFilter, lookBox } from "@gepetta/core";

export interface Size {
  width: number;
  height: number;
}

/** Scale that fits `src` entirely inside `dst`. */
export function containScale(src: Size, dst: Size): number {
  return Math.min(dst.width / src.width, dst.height / src.height);
}

/** A picture to draw: a frame's layer or a channel's current picture. */
export interface Drawable {
  media: MediaRef;
  opacity: number;
  transform: Transform2D;
  look?: Look;
  /** Drawing strokes on the picture: `lookup` returns the picture with them. */
  strokes?: readonly Stroke[];
}

/** Pixel size of a decoded image (it may be a smaller copy of the picture: proxy, thumbnail). */
export function imageSize(img: CanvasImageSource, fallback: Size): Size {
  if (img instanceof HTMLVideoElement) return { width: img.videoWidth, height: img.videoHeight };
  if (img instanceof HTMLImageElement) return { width: img.naturalWidth, height: img.naturalHeight };
  if ("width" in img && typeof img.width === "number" && img.width > 0) return { width: img.width, height: img.height as number };
  return fallback;
}

/**
 * Where a picture's pixels land in the film: from an image of `real` size (the
 * picture, or a copy of it at another size) to film coordinates. The crop does
 * not move it: it only hides what is outside (see drawStack).
 */
export function pictureMatrix(item: Omit<Drawable, "opacity">, film: Size, real: Size): DOMMatrix {
  const { x, y, rotation, scale } = item.transform;
  const box = lookBox(item.media, item.look, film);
  return new DOMMatrix()
    .translate(film.width / 2 + x, film.height / 2 + y)
    .rotate((rotation * 180) / Math.PI)
    .scale(scale * (item.look?.flipX ? -1 : 1), scale * (item.look?.flipY ? -1 : 1))
    .translate(-box.width / 2, -box.height / 2)
    .scale(box.width / real.width, box.height / real.height);
}

/**
 * Draws pictures bottom to top in film coordinates. Each is cropped and fitted
 * to the film as its look says (inside it by default), then moved, rotated,
 * scaled and mirrored about the film's center, and mixed with what is under it.
 * `lookup` returns the decoded image (proxy on screen, original on export), or
 * undefined while it is still loading.
 */
export function drawStack(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  items: readonly Drawable[],
  film: Size,
  lookup: (item: Drawable) => CanvasImageSource | undefined,
  alpha = 1,
) {
  for (const item of items) {
    const img = lookup(item);
    if (!img) continue;
    const look = item.look;
    // Only the part shown (the crop), in the decoded image's own pixels, where it is.
    const real = imageSize(img, item.media);
    const r = cropRect(real, look);
    ctx.save();
    ctx.globalAlpha = alpha * item.opacity;
    if (look?.blend) ctx.globalCompositeOperation = compositeOf(look.blend);
    if (look?.effects) ctx.filter = effectsFilter(look.effects);
    ctx.transform(...matrixArgs(pictureMatrix(item, film, real)));
    ctx.drawImage(img, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    ctx.restore();
  }
}

function matrixArgs(m: DOMMatrix): [number, number, number, number, number, number] {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}
