import { type FilmState, type TrackId, cellIndex, exportedCells, stackAt } from "@gepetta/core";
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  canEncodeVideo,
} from "mediabunny";
import { picture, strokesKey } from "../media/composed";
import { type Drawable, drawStack } from "../render/frame";
import { storage } from "../storage";

/** One decoded picture per image and strokes. */
function pictureId(item: Pick<Drawable, "media" | "strokes">): string {
  return `${item.media.original}#${strokesKey(item.strokes)}`;
}

export type VideoFormat = "mp4" | "webm";
export type VideoQuality = "medium" | "high" | "max";

export interface VideoExportOptions {
  format: VideoFormat;
  width: number;
  height: number;
  quality: VideoQuality;
  /** Only these tracks (e.g. one track on its own); all exported tracks when missing. */
  tracks?: TrackId[];
}

const QUALITY = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, max: QUALITY_VERY_HIGH };
const CODEC = { mp4: "avc", webm: "vp9" } as const;

export async function canExport(opts: VideoExportOptions): Promise<boolean> {
  return canEncodeVideo(CODEC[opts.format], { width: opts.width, height: opts.height });
}

/**
 * Renders every frame from the full-resolution originals. Held frames are
 * repeated so the file has a constant frame rate, which every player handles.
 */
export async function exportVideo(
  filmId: string,
  film: FilmState,
  opts: VideoExportOptions,
  progress: (done: number) => void,
): Promise<Blob> {
  // H.264 needs even dimensions.
  const width = opts.width - (opts.width % 2);
  const height = opts.height - (opts.height % 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  const output = new Output({
    format: opts.format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: CODEC[opts.format], bitrate: QUALITY[opts.quality] });
  const { fps } = film.settings;
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const scale = { x: width / film.settings.width, y: height / film.settings.height };
  try {
    const index = cellIndex(film);
    const only = opts.tracks;
    // Decoded originals, kept while consecutive cells still show them.
    let bitmaps = new Map<string, CanvasImageSource>();
    let shown: string | null = null;
    // A ping-pong goes there and back once (a player repeating it keeps going).
    const order = exportedCells(film);
    for (let i = 0; i < order.length; i++) {
      const cell = order[i]!;
      // A track exported on its own goes out even if it is only a reference.
      const stack = stackAt(film, cell, { index, ...(only ? { tracks: only } : { exportOnly: true }) });
      const key = stack.map((s) => `${s.clipId}:${pictureId(s)}`).join("|");
      if (key !== shown) {
        const next = new Map<string, CanvasImageSource>();
        for (const item of stack) {
          const id = pictureId(item);
          if (next.has(id)) continue;
          // A picture with drawing strokes goes out with them, at full size.
          next.set(
            id,
            bitmaps.get(id) ??
              (item.strokes?.length
                ? await picture(filmId, item.media, item.strokes, "original")
                : await createImageBitmap(await storage.getAsset(filmId, item.media.original))),
          );
        }
        // A lasso's background plate goes at full size too (see Mask.plate).
        for (const item of stack) {
          const plate = item.look?.mask?.plate;
          const id = plate && pictureId({ media: plate.media });
          if (plate && id && !next.has(id)) next.set(id, bitmaps.get(id) ?? (await createImageBitmap(await storage.getAsset(filmId, plate.media.original))));
        }
        bitmaps.forEach((b, id) => !next.has(id) && b instanceof ImageBitmap && b.close());
        bitmaps = next;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
        drawStack(ctx, stack, film.settings, (item) => bitmaps.get(pictureId(item)));
        shown = key;
      }
      await source.add(i / fps, 1 / fps);
      progress(i + 1);
    }
    bitmaps.forEach((b) => b instanceof ImageBitmap && b.close());
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  }
  const mime = opts.format === "mp4" ? "video/mp4" : "video/webm";
  return new Blob([output.target.buffer!], { type: mime });
}
