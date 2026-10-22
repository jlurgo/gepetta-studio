import type { CaptureInfo } from "./exif";

/** Content hash (SHA-256 hex) of an immutable binary asset stored with the film. */
export type AssetId = string;
export type FrameId = string;
export type LayerId = string;

/** What is known about how a picture was taken: EXIF plus what the app knew at the moment. */
export interface CaptureMeta extends CaptureInfo {
  /** Camera name as shown in the app, e.g. "Canon EOS 500D / Rebel T1i". */
  source?: string;
  sourceKind?: "webcam" | "phone" | "dslr" | "import";
  /** Lens focus position in fine steps when the shot was taken, and what it counts from. */
  focusPosition?: number;
  focusOrigin?: "infinity" | "autofocus";
}

/** An imported image: the untouched original plus derived, cheaper versions. */
export interface MediaRef {
  original: AssetId;
  /** Downscaled copy (≤1920 px) used for editing and playback. */
  proxy: AssetId;
  /** Small copy used in the timeline. */
  thumb: AssetId;
  /** Camera RAW file (CR2, CR3, NEF…) kept alongside, when the camera produced one. */
  raw?: AssetId;
  capture?: CaptureMeta;
  width: number;
  height: number;
}

export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export const IDENTITY_TRANSFORM: Transform2D = { x: 0, y: 0, rotation: 0, scale: 1 };

export interface ImageLayer {
  id: LayerId;
  kind: "image";
  name: string;
  media: MediaRef;
  visible: boolean;
  opacity: number;
  transform: Transform2D;
}

export type Layer = ImageLayer;

/** What a channel shows: one picture, or a sequence (e.g. video frames) that advances with the film. */
export type ChannelSource =
  | { kind: "image"; media: MediaRef }
  | {
      kind: "sequence";
      media: MediaRef[];
      /** Pictures per second of the sequence (the video's rate when it was imported). */
      fps: number;
    };

/**
 * A layer that spans frames ("canal"): a background, an overlay, or a video
 * to rotoscope. It starts at the beginning of frame `from` (null = the film's
 * start) and ends after frame `to` (null = the film's end, or the sequence's).
 */
export interface Channel {
  id: LayerId;
  name: string;
  source: ChannelSource;
  visible: boolean;
  opacity: number;
  transform: Transform2D;
  /** Under or over the frames' own layers. */
  placement: "below" | "above";
  /** false = reference only: seen while animating, left out of exports. */
  exported: boolean;
  from: FrameId | null;
  to: FrameId | null;
}

export interface Frame {
  id: FrameId;
  /** How many timeline ticks (1/fps) the frame stays on screen. 1 = "on ones". */
  hold: number;
  /** Bottom to top. */
  layers: Layer[];
}

export interface FilmSettings {
  name: string;
  fps: number;
  width: number;
  height: number;
}

export interface FilmState {
  settings: FilmSettings;
  frameOrder: FrameId[];
  frames: Record<FrameId, Frame>;
  /** Bottom to top within each placement. */
  channels: Channel[];
}

export const DEFAULT_FPS = 12;

export function emptyFilm(settings: FilmSettings): FilmState {
  return { settings, frameOrder: [], frames: {}, channels: [] };
}

export function orderedFrames(film: FilmState): Frame[] {
  return film.frameOrder.map((id) => film.frames[id]!);
}

export function frameIndex(film: FilmState, id: FrameId): number {
  return film.frameOrder.indexOf(id);
}
