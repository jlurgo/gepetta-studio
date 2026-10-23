import type { CaptureInfo } from "./exif";

/** Content hash (SHA-256 hex) of an immutable binary asset stored with the film. */
export type AssetId = string;
export type TrackId = string;
export type ClipId = string;

/** What is known about how a picture was taken: EXIF plus what the app knew at the moment. */
export interface CaptureMeta extends CaptureInfo {
  /** Camera name as shown in the app, e.g. "Canon EOS 500D / Rebel T1i". */
  source?: string;
  sourceKind?: "webcam" | "phone" | "dslr" | "import" | "drawing";
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

/** How a picture mixes with what is under it (canvas composite modes). */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "difference";

/** An adjustment of the picture's colors; `amount` goes from -1 to 1 (0 changes nothing). */
export interface Effect {
  kind: "brightness" | "contrast" | "saturation";
  amount: number;
}

/**
 * How a picture is shown, leaving the picture itself untouched (so it can be
 * changed later): which part of it, which way, and how it mixes.
 */
export interface Look {
  /** Part shown, in fractions of the picture (0–1); the rest is hidden, the picture stays where it is. */
  crop?: { x: number; y: number; width: number; height: number };
  /** "contain": all of it inside the film (default); "cover": it fills the film, cut where it overflows. */
  fit?: "contain" | "cover";
  /** Mirrored left to right, and upside down. */
  flipX?: boolean;
  flipY?: boolean;
  blend?: BlendMode;
  effects?: Effect[];
}

/**
 * Time is a fixed grid: cell n shows from n/fps to (n+1)/fps. Each track is a
 * row of cells; a clip is a picture placed in a track from cell `start`,
 * staying `length` cells. Clips in one track never overlap.
 */
export interface Clip {
  id: ClipId;
  track: TrackId;
  start: number;
  length: number;
  media: MediaRef;
  name: string;
  visible: boolean;
  opacity: number;
  transform: Transform2D;
  /** Crop, mirror, mixing and effects; absent = shown as it is. */
  look?: Look;
  /** Drawing tools' strokes on the picture, bottom to top. */
  strokes?: Stroke[];
}

export type StrokeTool = "draw" | "erase" | "tint" | "shape" | "fill" | "clone";

/**
 * A stroke of a drawing tool on a picture, kept as what was done (so it can be
 * picked, changed or removed later). The picture shows its image with its
 * strokes on top, in order.
 *
 * Coordinates and widths are in the picture's own pixels (MediaRef width ×
 * height), so the stroke follows the picture wherever it goes.
 */
export interface Stroke {
  id: string;
  tool: StrokeTool;
  /** Lines and shapes: [x, y, width, pen pressure 0–1] along the stroke (a shape: its two corners). */
  points?: [number, number, number, number][];
  brush?: "pencil" | "ink" | "marker" | "airbrush";
  shape?: "line" | "box" | "ellipse";
  /** Shapes: filled with the color too. */
  filled?: boolean;
  color?: string;
  /** How strongly it is laid on, 0–1. */
  strength: number;
  /** Fill and clone stamp: the stroke's own pixels, an image the size of the picture. */
  layer?: AssetId;
  hidden?: boolean;
}

/** The track every photo goes to by default. Films always have it (it can be hidden or moved, not removed). */
export const PHOTO_TRACK: TrackId = "photos";

/** A row of the timeline. The film is all tracks combined, bottom to top. */
export interface Track {
  id: TrackId;
  name: string;
  visible: boolean;
  opacity: number;
  /** Applied to every clip of the track, on top of each clip's own transform. */
  transform: Transform2D;
  /** false = reference only (e.g. a video to rotoscope): seen while animating, left out of exports. */
  exported: boolean;
}

export interface FilmSettings {
  name: string;
  fps: number;
  width: number;
  height: number;
  /** A loop: the first cell comes after the last one (playing never ends, the onion skin wraps). */
  loop?: boolean;
}

export interface FilmState {
  settings: FilmSettings;
  /** Bottom to top. */
  tracks: Track[];
  clips: Record<ClipId, Clip>;
  /** Cells in the film; grows to fit clips, and can be extended by hand. */
  length: number;
}

export const DEFAULT_FPS = 12;

export function photoTrack(): Track {
  return { id: PHOTO_TRACK, name: "Fotos", visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true };
}

export function emptyFilm(settings: FilmSettings): FilmState {
  return { settings, tracks: [photoTrack()], clips: {}, length: 0 };
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.length;
}

/** Clips of a track, in time order. */
export function trackClips(film: FilmState, track: TrackId): Clip[] {
  return Object.values(film.clips)
    .filter((c) => c.track === track)
    .sort((a, b) => a.start - b.start);
}

/** The clip covering `cell` in `track`, if any. */
export function clipAt(film: FilmState, track: TrackId, cell: number): Clip | undefined {
  for (const c of Object.values(film.clips)) if (c.track === track && cell >= c.start && cell < clipEnd(c)) return c;
  return undefined;
}

/** End of the last clip (the film may be longer, see FilmState.length). */
export function contentEnd(film: FilmState): number {
  let end = 0;
  for (const c of Object.values(film.clips)) end = Math.max(end, clipEnd(c));
  return end;
}
