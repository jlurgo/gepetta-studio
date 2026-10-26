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
  /** Part cut out with the lasso: only what is inside shows (or, inverted, all but it). */
  mask?: Mask;
}

/**
 * An outline drawn on a picture (lasso or rectangle), in fractions of the
 * picture (0–1), always MASK_POINTS points clockwise from its top, so the
 * outlines of a sequence can be blended from one picture to the next.
 */
export interface Mask {
  points: [number, number][];
  /** Shows all but what is inside. */
  invert?: boolean;
  /** Soft edge, in fractions of the picture's longer side. */
  feather?: number;
  /** Drawn or changed by hand on this picture (the ones between are blended from these). */
  key?: boolean;
  /**
   * The background without what is cut out (a photo of the empty set, taken
   * from the same place): only what differs from it is kept, inside the
   * outline. `tolerance` (0–1) is how different a color must be to count.
   */
  plate?: { media: MediaRef; tolerance: number };
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
  /** Fading in over its first `in` cells and out over its last `out` cells. */
  fade?: { in?: number; out?: number };
  /**
   * The sequence it belongs to: pictures made together (a recorded video,
   * photos shot one after another, images imported at once, copies of a
   * drawing), changed together from the sequence's details.
   */
  seq?: string;
  /**
   * A sound clip (in a sound track): its cells are slices of the sound one
   * after another, each 1/fps seconds long; the first starts `from` seconds
   * into it. `media` is then a picture of its waveform.
   */
  sound?: SoundSlice;
}

/** A sound file of the film and what is known about it. */
export interface SoundRef {
  original: AssetId;
  /** Loudness every 1/PEAKS_PER_SECOND seconds (0–255), to draw it. */
  peaks: AssetId;
  /** Seconds. */
  duration: number;
}

/** Peaks kept per second of sound (see SoundRef.peaks). */
export const PEAKS_PER_SECOND = 240;

export interface SoundSlice {
  ref: SoundRef;
  /** Seconds into the sound where the clip's first cell starts. */
  from: number;
  /** The volume of each of the clip's cells, from its first (1 = as it is; cells past the end are 1). */
  gains?: number[];
}

/** The volume of a sound clip's cell (1 = as it is). */
export function cellGain(clip: Clip, cell: number): number {
  return clip.sound?.gains?.[cell - clip.start] ?? 1;
}

/**
 * A clip moved `by` cells into what it shows: a sound clip starts that much
 * later in its sound, and its cells keep their volumes.
 */
export function clipFrom(clip: Clip, by: number, fps: number): Clip {
  if (!clip.sound || !by) return clip;
  const { gains } = clip.sound;
  const shifted = gains && (by > 0 ? gains.slice(by) : [...new Array<number>(-by).fill(1), ...gains]);
  return { ...clip, sound: { ...clip.sound, from: clip.sound.from + by / fps, ...(gains && { gains: shifted }) } };
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
  /** Fill and clone stamp: the stroke's own pixels, an image of the picture (or of `box` in it). */
  layer?: AssetId;
  /** Where `layer` goes, in the picture's pixels (missing: over the whole picture). */
  box?: { x: number; y: number; width: number; height: number };
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
  /** What its cells hold: pictures (absent) or sound (slices of a sound file, see Clip.sound). */
  kind?: "sound";
  /** The innermost group it is in (see Group); none = at the top level. */
  group?: GroupId;
  /** A sound track: from the left speaker (-1) to the right one (1); absent = both alike. */
  pan?: number;
  /** A sound track: an effect its sound goes through (absent = none). */
  voice?: VoiceEffect;
}

/** What a sound track's voice can be turned into. */
export type VoiceEffect = "ardilla" | "monstruo" | "robot" | "eco" | "telefono" | "cueva";

export type GroupId = string;

/**
 * Tracks kept together (a character and its hair, its voice…), inside another
 * group or at the top level. Its tracks are always next to each other in the
 * stack. A linked group is edited as one: putting cells in, taking them out,
 * cutting, pasting or moving them in one of its tracks does it in all of them.
 */
export interface Group {
  id: GroupId;
  name: string;
  parent?: GroupId;
  linked: boolean;
}

export interface FilmSettings {
  name: string;
  fps: number;
  width: number;
  height: number;
  /** A loop: the first cell comes after the last one (playing never ends, the onion skin wraps). */
  loop?: boolean;
  /** A loop that plays forward and then back (ping-pong), instead of starting over. */
  pingpong?: boolean;
}

export interface FilmState {
  settings: FilmSettings;
  /** Bottom to top. */
  tracks: Track[];
  clips: Record<ClipId, Clip>;
  /** Groups of tracks (films before groups have none). */
  groups?: Record<GroupId, Group>;
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

/** How much a picture shows at a cell, from its fade (1 outside the fade). */
export function fadeAt(clip: Pick<Clip, "start" | "length" | "fade">, cell: number): number {
  const into = cell - clip.start;
  const left = clip.start + clip.length - 1 - cell;
  let k = 1;
  if (clip.fade?.in && into < clip.fade.in) k = Math.min(k, (into + 1) / (clip.fade.in + 1));
  if (clip.fade?.out && left < clip.fade.out) k = Math.min(k, (left + 1) / (clip.fade.out + 1));
  return Math.max(0, k);
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
