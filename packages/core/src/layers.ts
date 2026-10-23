import { type Clip, type ClipId, type FilmState, type Look, type MediaRef, type Stroke, type TrackId, type Transform2D, clipEnd } from "./model";

/** One picture to draw, bottom to top, with where it came from. */
export interface StackItem {
  key: string;
  media: MediaRef;
  opacity: number;
  transform: Transform2D;
  look?: Look;
  strokes?: Stroke[];
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

/** The inner transform that, composed with `outer`, gives `composite` (inverse of composeTransforms). */
export function relativeTransform(outer: Transform2D, composite: Transform2D): Transform2D {
  const cos = Math.cos(-outer.rotation) / outer.scale;
  const sin = Math.sin(-outer.rotation) / outer.scale;
  const dx = composite.x - outer.x;
  const dy = composite.y - outer.y;
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
    rotation: composite.rotation - outer.rotation,
    scale: composite.scale / outer.scale,
  };
}

/** The outer transform that, composed over `inner`, gives `composite` (a track's, from how one of its pictures looks). */
export function outerTransform(inner: Transform2D, composite: Transform2D): Transform2D {
  const rotation = composite.rotation - inner.rotation;
  const scale = composite.scale / inner.scale;
  const cos = Math.cos(rotation) * scale;
  const sin = Math.sin(rotation) * scale;
  return {
    x: composite.x - (inner.x * cos - inner.y * sin),
    y: composite.y - (inner.x * sin + inner.y * cos),
    rotation,
    scale,
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
      ...(clip.look && { look: clip.look }),
      ...(clip.strokes?.length && { strokes: clip.strokes }),
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

/**
 * The pictures of `track` before `cell`, nearest first (for onion skin). In a
 * loop film the ones at the end come before the first cell.
 */
export function previousClips(film: FilmState, track: TrackId, cell: number, count: number, index?: CellIndex): Clip[] {
  const clips = (index ?? cellIndex(film)).get(track) ?? [];
  const before = clips
    .filter((c) => c.start < cell && !(cell < clipEnd(c)))
    .slice(-count)
    .reverse();
  if (!film.settings.loop || before.length >= count) return before;
  // Wrapping around: the last pictures of the film, last first (not the one at the cell itself).
  const after = clips.filter((c) => c.start > cell).reverse();
  return [...before, ...after].slice(0, count);
}

/**
 * The cell shown at step `n` of playing (counted from cell 0): a loop starts
 * over, a ping-pong goes back from the end (…, last-1, last, last-1, …, 1, 0, 1…).
 */
export function playedCell(film: FilmState, n: number): number {
  const length = film.length;
  if (!film.settings.loop || length === 0) return n;
  if (film.settings.pingpong && length > 1) {
    const period = 2 * length - 2;
    const k = ((n % period) + period) % period;
    return k < length ? k : period - k;
  }
  return ((n % length) + length) % length;
}

/** The cells an export goes through, in order: a ping-pong goes there and back once (it repeats from there). */
export function exportedCells(film: FilmState): number[] {
  const cells = Array.from({ length: film.length }, (_, i) => i);
  if (!film.settings.loop || !film.settings.pingpong || film.length < 3) return cells;
  return [...cells, ...cells.slice(1, -1).reverse()];
}

/** A cell of a loop film counted from anywhere (negative, or past the end): back inside it. */
export function wrapCell(film: FilmState, cell: number): number {
  if (!film.settings.loop || film.length === 0) return cell;
  return ((cell % film.length) + film.length) % film.length;
}
