import { type FilmState, frameSpans, frameStack, orderedFrames } from "@gepetta/core";
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
import { drawStack } from "../render/frame";
import { storage } from "../storage";

export type VideoFormat = "mp4" | "webm";
export type VideoQuality = "medium" | "high" | "max";

export interface VideoExportOptions {
  format: VideoFormat;
  width: number;
  height: number;
  quality: VideoQuality;
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
  let tick = 0;
  try {
    const spans = frameSpans(film);
    const frames = orderedFrames(film);
    // Decoded originals, kept while consecutive ticks still show them.
    let bitmaps = new Map<string, ImageBitmap>();
    let shown = "";
    for (const [i, frame] of frames.entries()) {
      for (let h = 0; h < frame.hold; h++) {
        const stack = frameStack(film, frame, tick, { exportOnly: true, spans });
        // A video channel can change during a held frame; otherwise the canvas stays as it is.
        const key = stack.map((s) => s.key + s.media.original).join("|");
        if (key !== shown) {
          const next = new Map<string, ImageBitmap>();
          for (const item of stack) {
            const id = item.media.original;
            if (next.has(id)) continue;
            next.set(id, bitmaps.get(id) ?? (await createImageBitmap(await storage.getAsset(filmId, id))));
          }
          bitmaps.forEach((b, id) => !next.has(id) && b.close());
          bitmaps = next;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
          ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
          drawStack(ctx, stack, film.settings, (m) => bitmaps.get(m.original));
          shown = key;
        }
        await source.add(tick / fps, 1 / fps);
        tick++;
      }
      progress(i + 1);
    }
    bitmaps.forEach((b) => b.close());
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  }
  const mime = opts.format === "mp4" ? "video/mp4" : "video/webm";
  return new Blob([output.target.buffer!], { type: mime });
}
