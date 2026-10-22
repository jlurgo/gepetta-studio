import {
  type FilmState,
  type Frame,
  type FrameId,
  type LayerId,
  type MediaRef,
  PHOTO_TRACK,
  type Track,
  type TrackId,
  type Transform2D,
  trackOf,
} from "./model";
import { timeline } from "./timing";

/** One picture to draw, bottom to top, with where it came from. */
export interface StackItem {
  key: string;
  media: MediaRef;
  opacity: number;
  transform: Transform2D;
  trackId: TrackId;
  /** Set for a frame's own cell. */
  layerId?: LayerId;
}

/** Ticks each frame occupies: [start, end). */
export type FrameSpans = Map<FrameId, { start: number; end: number }>;

export function frameSpans(film: FilmState): FrameSpans {
  const spans: FrameSpans = new Map();
  for (const t of timeline(film).frames) spans.set(t.frame.id, { start: t.start, end: t.start + t.frame.hold });
  return spans;
}

/**
 * `outer` applied after `inner`, both about the film's center: what a cell
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

/** Ticks an image or sequence track covers: [start, end). A sequence ends with its last picture unless `to` cuts it earlier. */
export function trackSpan(film: FilmState, track: Track, spans: FrameSpans): { start: number; end: number } {
  const start = track.from ? (spans.get(track.from)?.start ?? 0) : 0;
  let end = track.to ? (spans.get(track.to)?.end ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
  if (track.source.kind === "sequence") {
    const length = Math.ceil((track.source.media.length * film.settings.fps) / track.source.fps);
    end = Math.min(end, start + length);
  }
  return { start, end };
}

/** An image or sequence track's picture at `tick`, or null when it is not on then (always null for cells tracks). */
export function trackMediaAt(film: FilmState, track: Track, tick: number, spans: FrameSpans): MediaRef | null {
  const source = track.source;
  if (source.kind === "cells") return null;
  const { start, end } = trackSpan(film, track, spans);
  if (tick < start || tick >= end) return null;
  if (source.kind === "image") return source.media;
  const i = Math.floor(((tick - start) * source.fps) / film.settings.fps + 1e-9);
  return source.media[i] ?? null;
}

/** What one track shows on a frame at `tick` (its cell, or its picture then). */
export function trackItem(film: FilmState, track: Track, frame: Frame | null, tick: number, spans: FrameSpans): StackItem | null {
  if (track.source.kind === "cells") {
    const cell = frame?.layers.find((l) => trackOf(l) === track.id);
    if (!cell || !cell.visible) return null;
    return {
      key: `l:${cell.id}`,
      media: cell.media,
      opacity: track.opacity * cell.opacity,
      transform: composeTransforms(track.transform, cell.transform),
      trackId: track.id,
      layerId: cell.id,
    };
  }
  const media = trackMediaAt(film, track, tick, spans);
  return media ? { key: `t:${track.id}`, media, opacity: track.opacity, transform: track.transform, trackId: track.id } : null;
}

export interface StackOptions {
  /** Leave out reference-only tracks (for export). */
  exportOnly?: boolean;
  /** Only tracks with their own cells (what onion skin shows of earlier frames). */
  cellsOnly?: boolean;
  /** Precomputed frameSpans(film), when drawing many frames. */
  spans?: FrameSpans;
}

/**
 * Everything visible on `frame` at `tick`, bottom to top: the film's tracks
 * combined. `frame` is null for the live view, where the camera takes the
 * photo track's place (see splitAtPhotos).
 */
export function frameStack(film: FilmState, frame: Frame | null, tick: number, options: StackOptions = {}): StackItem[] {
  const spans = options.spans ?? frameSpans(film);
  return film.tracks.flatMap((track) => {
    if (!track.visible || (options.exportOnly && !track.exported)) return [];
    if (options.cellsOnly && track.source.kind !== "cells") return [];
    const item = trackItem(film, track, frame, tick, spans);
    return item ? [item] : [];
  });
}

/** Items under and over the photo track: where the live camera goes between. */
export function splitAtPhotos(film: FilmState, items: StackItem[]): { below: StackItem[]; above: StackItem[] } {
  const order = new Map(film.tracks.map((t, i) => [t.id, i]));
  const photos = order.get(PHOTO_TRACK) ?? -1;
  return {
    below: items.filter((i) => (order.get(i.trackId) ?? 0) < photos),
    above: items.filter((i) => (order.get(i.trackId) ?? 0) > photos),
  };
}
