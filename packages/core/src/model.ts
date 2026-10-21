/** Content hash (SHA-256 hex) of an immutable binary asset stored with the film. */
export type AssetId = string;
export type FrameId = string;
export type LayerId = string;

/** An imported image: the untouched original plus derived, cheaper versions. */
export interface MediaRef {
  original: AssetId;
  /** Downscaled copy (≤1920 px) used for editing and playback. */
  proxy: AssetId;
  /** Small copy used in the timeline. */
  thumb: AssetId;
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
}

export const DEFAULT_FPS = 12;

export function emptyFilm(settings: FilmSettings): FilmState {
  return { settings, frameOrder: [], frames: {} };
}

export function orderedFrames(film: FilmState): Frame[] {
  return film.frameOrder.map((id) => film.frames[id]!);
}

export function frameIndex(film: FilmState, id: FrameId): number {
  return film.frameOrder.indexOf(id);
}
