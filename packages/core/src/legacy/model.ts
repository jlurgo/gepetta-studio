import type { CaptureInfo } from "../exif";

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

/** A frame's picture in one track (a "cell"). */
export interface ImageLayer {
  id: LayerId;
  kind: "image";
  /** Track the cell belongs to; missing in films made before tracks = the photo track. */
  track?: TrackId;
  name: string;
  media: MediaRef;
  visible: boolean;
  opacity: number;
  transform: Transform2D;
}

export type Layer = ImageLayer;

export type TrackId = string;

/** The track every photo goes to. Films always have it (it can be hidden or moved, not removed). */
export const PHOTO_TRACK: TrackId = "photos";

/**
 * What a track shows: a picture per frame ("cells", like the photos), one
 * picture over a stretch of frames, or a sequence (e.g. video frames) that
 * advances with the film's time.
 */
export type TrackSource =
  | { kind: "cells" }
  | { kind: "image"; media: MediaRef }
  | {
      kind: "sequence";
      media: MediaRef[];
      /** Pictures per second of the sequence (the video's rate when it was imported). */
      fps: number;
    };

/**
 * A row of the timeline. The film is all tracks combined, bottom to top, each
 * with its own visibility, opacity and placement. Image and sequence tracks
 * start at the beginning of frame `from` (null = the film's start) and end
 * after frame `to` (null = the film's end, or the sequence's).
 */
export interface Track {
  id: TrackId;
  name: string;
  source: TrackSource;
  visible: boolean;
  opacity: number;
  /** Applied to everything in the track, on top of each cell's own transform. */
  transform: Transform2D;
  /** false = reference only: seen while animating, left out of exports. */
  exported: boolean;
  from: FrameId | null;
  to: FrameId | null;
}

export function photoTrack(): Track {
  return {
    id: PHOTO_TRACK,
    name: "Fotos",
    source: { kind: "cells" },
    visible: true,
    opacity: 1,
    transform: IDENTITY_TRANSFORM,
    exported: true,
    from: null,
    to: null,
  };
}

export interface Frame {
  id: FrameId;
  /** How many timeline ticks (1/fps) the frame stays on screen. 1 = "on ones". */
  hold: number;
  /** Its cells, at most one per track. */
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
  /** Bottom to top. */
  tracks: Track[];
}

export const DEFAULT_FPS = 12;

export function emptyFilm(settings: FilmSettings): FilmState {
  return { settings, frameOrder: [], frames: {}, tracks: [photoTrack()] };
}

export function orderedFrames(film: FilmState): Frame[] {
  return film.frameOrder.map((id) => film.frames[id]!);
}

export function trackOf(layer: Layer): TrackId {
  return layer.track ?? PHOTO_TRACK;
}

/** The frame's photo (what thumbnails and capture info show). */
export function photoOf(frame: Frame): Layer | undefined {
  return frame.layers.find((l) => trackOf(l) === PHOTO_TRACK) ?? frame.layers[0];
}

export function frameIndex(film: FilmState, id: FrameId): number {
  return film.frameOrder.indexOf(id);
}
