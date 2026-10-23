import { type Look, type Mask, type MediaRef, type Stroke, type Transform2D, compositeOf, cropRect, effectsFilter, lookBox } from "@gepetta/core";

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
    const plate = look?.mask?.plate ? lookup({ media: look.mask.plate.media, opacity: 1, transform: item.transform }) : undefined;
    const src = look?.mask ? masked(img, real, look.mask, plate) : img;
    ctx.drawImage(src, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    ctx.restore();
  }
}

function matrixArgs(m: DOMMatrix): [number, number, number, number, number, number] {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

/** The lasso's outline as a path in pixels of a picture of `size`. */
export function maskPath(mask: Mask, size: Size): Path2D {
  const path = new Path2D();
  mask.points.forEach(([x, y], i) => (i ? path.lineTo(x * size.width, y * size.height) : path.moveTo(x * size.width, y * size.height)));
  path.closePath();
  return path;
}

/** The last masked copy of each image (masks are replaced, never changed, so the mask itself tells if it is still good). */
const maskedCopies = new WeakMap<object, { mask: Mask; width: number; plate: CanvasImageSource | undefined; canvas: OffscreenCanvas }>();

/**
 * An image with only what its mask keeps: inside the outline (soft-edged if
 * it says so) and, with a background plate, only what differs from it —
 * or all the rest, inverted. Without the plate decoded yet, just the outline
 * (not kept, so it is done again once the plate is there).
 */
function masked(img: CanvasImageSource, real: Size, mask: Mask, plate: CanvasImageSource | undefined): CanvasImageSource {
  const width = Math.max(1, Math.round(real.width));
  const height = Math.max(1, Math.round(real.height));
  const hit = maskedCopies.get(img as object);
  if (hit && hit.mask === mask && hit.width === width && hit.plate === plate) return hit.canvas;
  // What is kept, as alpha.
  const keep = new OffscreenCanvas(width, height);
  const k = keep.getContext("2d")!;
  if (mask.plate && plate) {
    k.drawImage(differs(img, plate, mask.plate.tolerance), 0, 0, width, height);
    k.globalCompositeOperation = "destination-in";
  }
  const blur = (mask.feather ?? 0) * Math.max(width, height);
  if (blur > 0.5) k.filter = `blur(${blur.toFixed(1)}px)`;
  k.fill(maskPath(mask, { width, height }));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);
  ctx.globalCompositeOperation = mask.invert ? "destination-out" : "destination-in";
  ctx.drawImage(keep, 0, 0);
  if (!mask.plate || plate) maskedCopies.set(img as object, { mask, width, plate, canvas });
  return canvas;
}

/** Size the comparison with the background plate is done at (enough for an outline, and quick). */
const DIFF_MAX = 1024;

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Where an image differs from the background plate, as alpha: opaque where a
 * color differs more than `tolerance`, then softened and thresholded again so
 * specks of noise go and small holes close.
 */
function differs(img: CanvasImageSource, plate: CanvasImageSource, tolerance: number): OffscreenCanvas {
  const real = imageSize(img, { width: DIFF_MAX, height: DIFF_MAX });
  const k = Math.min(1, DIFF_MAX / Math.max(real.width, real.height));
  const w = Math.max(1, Math.round(real.width * k));
  const h = Math.max(1, Math.round(real.height * k));
  const read = (src: CanvasImageSource) => {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const a = read(img);
  const b = read(plate);
  const out = new ImageData(w, h);
  const lo = tolerance;
  const hi = tolerance * 1.5 + 0.03;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!)) / 255;
    out.data[i + 3] = smoothstep(lo, hi, d) * 255;
  }
  const raw = new OffscreenCanvas(w, h);
  raw.getContext("2d")!.putImageData(out, 0, 0);
  // Soften, then threshold again: lone specks fade under the cut, small holes fill.
  const soft = new OffscreenCanvas(w, h);
  const s = soft.getContext("2d", { willReadFrequently: true })!;
  s.filter = `blur(${Math.max(1, w / 400).toFixed(1)}px)`;
  s.drawImage(raw, 0, 0);
  const px = s.getImageData(0, 0, w, h);
  for (let i = 3; i < px.data.length; i += 4) px.data[i] = smoothstep(0.3, 0.6, px.data[i]! / 255) * 255;
  s.putImageData(px, 0, 0);
  return soft;
}
