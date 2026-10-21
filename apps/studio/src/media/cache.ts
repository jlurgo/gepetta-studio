import type { AssetId } from "@gepetta/core";
import { storage } from "../storage";

/**
 * Decoded images, least-recently-used first out. Keyed by film + asset so a film
 * switch never shows stale pictures.
 */
class BitmapCache {
  private entries = new Map<string, Promise<ImageBitmap>>();
  private ready = new Map<string, ImageBitmap>();

  constructor(private limit: number) {}

  /** Returns the bitmap if already decoded, without starting a load. */
  peek(filmId: string, assetId: AssetId): ImageBitmap | undefined {
    return this.ready.get(`${filmId}/${assetId}`);
  }

  load(filmId: string, assetId: AssetId): Promise<ImageBitmap> {
    const key = `${filmId}/${assetId}`;
    let p = this.entries.get(key);
    if (p) {
      this.entries.delete(key);
      this.entries.set(key, p);
      return p;
    }
    p = storage
      .getAsset(filmId, assetId)
      .then((blob) => createImageBitmap(blob))
      .then((bmp) => {
        if (this.entries.has(key)) this.ready.set(key, bmp);
        return bmp;
      });
    p.catch(() => this.entries.delete(key));
    this.entries.set(key, p);
    this.evict();
    return p;
  }

  private evict() {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
      this.ready.get(oldest)?.close();
      this.ready.delete(oldest);
    }
  }
}

/** Proxies (≤1920 px, ~8 MB decoded each). */
export const proxyCache = new BitmapCache(96);

const thumbUrls = new Map<string, Promise<string>>();

export function thumbUrl(filmId: string, assetId: AssetId): Promise<string> {
  const key = `${filmId}/${assetId}`;
  let p = thumbUrls.get(key);
  if (!p) {
    p = storage.getAsset(filmId, assetId).then((b) => URL.createObjectURL(b));
    p.catch(() => thumbUrls.delete(key));
    thumbUrls.set(key, p);
  }
  return p;
}
