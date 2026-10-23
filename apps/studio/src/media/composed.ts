import type { AssetId, MediaRef, Stroke } from "@gepetta/core";
import { composeStrokes, layerAssets } from "../render/strokes";
import { storage } from "../storage";
import { proxyCache, thumbUrl } from "./cache";
import { PROXY_MAX, THUMB_MAX } from "./ingest";

/**
 * Pictures with their strokes on top, at the size each place needs: "proxy"
 * for the big picture, "thumb" for the timeline, "original" for exporting.
 * A picture without strokes is just its image (see proxyCache); these are
 * only for the ones that have some.
 */
export type Resolution = "proxy" | "thumb" | "original";

const LIMIT = 48;
/** A number per strokes list (lists are never changed, only replaced), to key what was drawn. */
const ids = new WeakMap<readonly Stroke[], number>();
let nextId = 1;

export function strokesKey(strokes: readonly Stroke[] | undefined): number {
  if (!strokes?.length) return 0;
  let id = ids.get(strokes);
  if (!id) {
    id = nextId++;
    ids.set(strokes, id);
  }
  return id;
}

const done = new Map<string, OffscreenCanvas>();
const pending = new Map<string, Promise<OffscreenCanvas>>();
/** The last version drawn of each picture, shown while a changed one is drawn (no flicker). */
const latest = new Map<string, OffscreenCanvas>();
const layerBitmaps = new Map<string, Promise<ImageBitmap>>();

function keyOf(filmId: string, media: MediaRef, strokes: readonly Stroke[], res: Resolution) {
  return `${filmId}/${res}/${media.original}#${strokesKey(strokes)}`;
}

function remember(key: string, picture: string, canvas: OffscreenCanvas) {
  done.set(key, canvas);
  latest.set(picture, canvas);
  while (done.size > LIMIT) done.delete(done.keys().next().value!);
  while (latest.size > LIMIT) latest.delete(latest.keys().next().value!);
}

function layerBitmap(filmId: string, asset: AssetId): Promise<ImageBitmap> {
  const key = `${filmId}/${asset}`;
  let p = layerBitmaps.get(key);
  if (!p) {
    p = storage.getAsset(filmId, asset).then((b) => createImageBitmap(b));
    p.catch(() => layerBitmaps.delete(key));
    layerBitmaps.set(key, p);
  }
  return p;
}

async function base(filmId: string, media: MediaRef, res: Resolution): Promise<CanvasImageSource & { width: number; height: number }> {
  if (res === "proxy") return proxyCache.load(filmId, media.proxy);
  if (res === "original") return createImageBitmap(await storage.getAsset(filmId, media.original), { imageOrientation: "from-image" });
  const url = await thumbUrl(filmId, media.thumb);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function compose(filmId: string, media: MediaRef, strokes: readonly Stroke[], res: Resolution): Promise<OffscreenCanvas> {
  const [image, layers] = await Promise.all([
    base(filmId, media, res),
    Promise.all(layerAssets(strokes).map(async (a) => [a, await layerBitmap(filmId, a)] as const)),
  ]);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0);
  if (res === "original" && image instanceof ImageBitmap) image.close();
  const byAsset = new Map(layers);
  composeStrokes(canvas, strokes, media, (a) => byAsset.get(a));
  return canvas;
}

/** The picture with its strokes, if drawn already; otherwise starts drawing it and returns its last version (or nothing). */
export function peekPicture(filmId: string, media: MediaRef, strokes: readonly Stroke[], res: Resolution): OffscreenCanvas | undefined {
  const key = keyOf(filmId, media, strokes, res);
  const ready = done.get(key);
  if (ready) return ready;
  void picture(filmId, media, strokes, res).catch(() => undefined);
  return latest.get(`${filmId}/${res}/${media.original}`);
}

/** The picture with its strokes. */
export function picture(filmId: string, media: MediaRef, strokes: readonly Stroke[], res: Resolution): Promise<OffscreenCanvas> {
  const key = keyOf(filmId, media, strokes, res);
  const ready = done.get(key);
  if (ready) return Promise.resolve(ready);
  let p = pending.get(key);
  if (!p) {
    p = compose(filmId, media, strokes, res).then((canvas) => {
      // Full-size pictures are big: only exporting uses them, one after another.
      if (res !== "original") remember(key, `${filmId}/${res}/${media.original}`, canvas);
      return canvas;
    });
    p.finally(() => pending.delete(key)).catch(() => undefined);
    pending.set(key, p);
  }
  return p;
}

/** Keeps a picture just painted as its drawn version on screen and in the timeline, so it shows at once. */
export function seedPicture(filmId: string, media: MediaRef, strokes: readonly Stroke[], source: OffscreenCanvas) {
  for (const [res, max] of [
    ["proxy", PROXY_MAX],
    ["thumb", THUMB_MAX],
  ] as const) {
    const k = Math.min(1, max / Math.max(media.width, media.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(media.width * k)), Math.max(1, Math.round(media.height * k)));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    remember(keyOf(filmId, media, strokes, res), `${filmId}/${res}/${media.original}`, canvas);
  }
}
