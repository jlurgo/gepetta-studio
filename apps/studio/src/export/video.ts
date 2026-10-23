import { type FilmState, type TrackId, exportedCells } from "@gepetta/core";
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
import { renderCells } from "./frames";

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
  const output = new Output({
    format: opts.format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: CODEC[opts.format], bitrate: QUALITY[opts.quality] });
  const { fps } = film.settings;
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  try {
    // A ping-pong goes there and back once (a player repeating it keeps going).
    // The canvas only changes when the picture does; a held one is added again.
    for await (const { index } of renderCells(filmId, film, { width, height, cells: exportedCells(film), tracks: opts.tracks, canvas })) {
      await source.add(index / fps, 1 / fps);
      progress(index + 1);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  }
  const mime = opts.format === "mp4" ? "video/mp4" : "video/webm";
  return new Blob([output.target.buffer!], { type: mime });
}
