import { type Clip, type ClipId, type FilmState, type MediaRef, type TrackId, type Transform2D, clipEnd } from "./model";

/** One picture to draw, bottom to top, with where it came from. */
export interface StackItem {
  key: string;
  media: MediaRef;
  opacity: number;
  transform: Transform2D;
  trackId: TrackId;
  clipId: ClipId;
}

/**
 * `outer` applied after `inner`, both about the film's center: what a clip
 * looks like once its track's transform is added.
 */
export function composeTransforms(outer: Transform2D, inner: Transform2D): Transform2D {
  const cos = Math.cos(outer.rotation) * outer.scale;
  const sin = Math.sin(outer.rotation) * outer.scale;
  return {
    x: outer.x + inner.x * cos - inner.y * sin,
    y: outer.y + inner.x * sin + inner.y * cos,
    rotation: outer.rotation + inner.rotation,
    scale: outer.scale * inner.scale,
  };
}

/** For each track, its clips in time order: lookups by cell without scanning every clip. */
export type CellIndex = Map<TrackId, Clip[]>;

export function cellIndex(film: FilmState): CellIndex {
  const index: CellIndex = new Map(film.tracks.map((t) => [t.id, []]));
  for (const c of Object.values(film.clips)) index.get(c.track)?.push(c);
  for (const list of index.values()) list.sort((a, b) => a.start - b.start);
  return index;
}

/** The clip covering `cell` in a track's sorted clips. */
export function clipIn(clips: Clip[], cell: number): Clip | undefined {
  let lo = 0;
  let hi = clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = clips[mid]!;
    if (cell < c.start) hi = mid - 1;
    else if (cell >= clipEnd(c)) lo = mid + 1;
    else return c;
  }
  return undefined;
}

export interface StackOptions {
  /** Leave out reference-only tracks (for export). */
  exportOnly?: boolean;
  /** Only these tracks (exporting one track on its own). */
  tracks?: TrackId[];
  /** Precomputed cellIndex(film), when drawing many cells. */
  index?: CellIndex;
}

/** Everything visible at `cell`, bottom to top: the film's tracks combined. */
export function stackAt(film: FilmState, cell: number, options: StackOptions = {}): StackItem[] {
  const index = options.index ?? cellIndex(film);
  const out: StackItem[] = [];
  for (const track of film.tracks) {
    if (!track.visible || (options.exportOnly && !track.exported)) continue;
    if (options.tracks && !options.tracks.includes(track.id)) continue;
    const clip = clipIn(index.get(track.id) ?? [], cell);
    if (!clip || !clip.visible) continue;
    out.push({
      key: clip.id,
      media: clip.media,
      opacity: track.opacity * clip.opacity,
      transform: composeTransforms(track.transform, clip.transform),
      trackId: track.id,
      clipId: clip.id,
    });
  }
  return out;
}

/** Items under and over `track`: where the live camera goes, in place of that track's picture. */
export function splitAtTrack(film: FilmState, items: StackItem[], track: TrackId): { below: StackItem[]; above: StackItem[] } {
  const order = new Map(film.tracks.map((t, i) => [t.id, i]));
  const at = order.get(track) ?? film.tracks.length;
  return {
    below: items.filter((i) => (order.get(i.trackId) ?? 0) < at),
    above: items.filter((i) => (order.get(i.trackId) ?? 0) > at),
  };
}

/** The pictures of `track` before `cell`, nearest first (for onion skin). */
export function previousClips(film: FilmState, track: TrackId, cell: number, count: number, index?: CellIndex): Clip[] {
  const clips = (index ?? cellIndex(film)).get(track) ?? [];
  return clips
    .filter((c) => c.start < cell && !(cell < clipEnd(c)))
    .slice(-count)
    .reverse();
}
