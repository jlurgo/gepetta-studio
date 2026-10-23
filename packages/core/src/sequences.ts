import { type Clip, type ClipId, type FilmState, type Transform2D } from "./model";
import type { Op } from "./ops";

/** The pictures of a sequence, in time order. */
export function sequenceClips(film: FilmState, seq: string): Clip[] {
  return Object.values(film.clips)
    .filter((c) => c.seq === seq)
    .sort((a, b) => a.start - b.start || a.track.localeCompare(b.track));
}

/**
 * Puts a sequence's pictures one after another from where it starts, each
 * `length` cells long (in order, or reversed). Taken out and put back in one
 * step, so they never overwrite each other on the way.
 */
export function relayOps(film: FilmState, seq: string, length?: number, reverse = false): Op[] {
  const clips = sequenceClips(film, seq);
  if (!clips.length) return [];
  const start = clips[0]!.start;
  const order = reverse ? [...clips].reverse() : clips;
  let at = start;
  const placed = order.map((c) => {
    const l = length ?? c.length;
    const out = { ...c, start: at, length: l };
    at += l;
    return out;
  });
  return [
    { type: "clip.remove", ids: clips.map((c) => c.id) },
    { type: "clip.place", clips: placed },
  ];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A movement from the sequence's first picture to its last: every picture in
 * between gets a position, size and turn part way, by its place in time.
 */
export function interpolateOps(film: FilmState, seq: string): Op[] {
  const clips = sequenceClips(film, seq);
  if (clips.length < 3) return [];
  const first = clips[0]!;
  const last = clips[clips.length - 1]!;
  const span = last.start - first.start || 1;
  const a = first.transform;
  const b = last.transform;
  return clips.slice(1, -1).map((c) => {
    const t = (c.start - first.start) / span;
    const transform: Transform2D = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), scale: lerp(a.scale, b.scale, t), rotation: lerp(a.rotation, b.rotation, t) };
    return { type: "clip.update", id: c.id, patch: { transform } };
  });
}

/** Ops that put pictures in a sequence (or take them out, with null). */
export function setSequenceOps(ids: ClipId[], seq: string | null): Op[] {
  return ids.map((id) => ({ type: "clip.update", id, patch: { seq: seq ?? undefined } }));
}
