import type { AssetId, MediaRef } from "@gepetta/core";
import { storage } from "../storage";

const PROXY_MAX = 1920;
const THUMB_MAX = 240;

async function sha256(blob: Blob): Promise<AssetId> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function storeBlob(filmId: string, blob: Blob): Promise<AssetId> {
  const id = await sha256(blob);
  if (!(await storage.hasAsset(filmId, id))) await storage.putAsset(filmId, id, blob);
  return id;
}

async function downscale(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

/**
 * Stores an image untouched plus its proxy and thumbnail, all content-addressed.
 * A camera RAW file, when given, is stored alongside untouched.
 */
export async function ingestImage(filmId: string, blob: Blob, raw?: Blob | null): Promise<MediaRef> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const [original, proxy, thumb, rawId] = await Promise.all([
      storeBlob(filmId, blob),
      downscale(bitmap, PROXY_MAX, 0.9).then((b) => storeBlob(filmId, b)),
      downscale(bitmap, THUMB_MAX, 0.8).then((b) => storeBlob(filmId, b)),
      raw ? storeBlob(filmId, raw) : undefined,
    ]);
    const media: MediaRef = { original, proxy, thumb, width: bitmap.width, height: bitmap.height };
    if (rawId) media.raw = rawId;
    return media;
  } finally {
    bitmap.close();
  }
}

/** Natural sort so "frame2.png" comes before "frame10.png". */
export function sortFiles(files: File[]): File[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}
