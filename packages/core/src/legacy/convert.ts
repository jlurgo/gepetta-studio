import type { History, HistoryEntry } from "../history";
import type { Clip, FilmState, Track } from "../model";
import { frameSpans, trackMediaAt } from "./layers";
import * as L from "./model";
import { OpError, type Op as LegacyOp, applyOp } from "./ops";
import { timeline } from "./timing";

/**
 * Films made before the grid timeline: frames in a row, each with a hold and
 * its pictures. Their history cannot replay on the grid, so they are replayed
 * the old way and converted once into clips.
 */

const LEGACY_OP = /^(frame|layer|channel)\./;

function isLegacyOp(op: { type: string; track?: unknown }): boolean {
  if (LEGACY_OP.test(op.type)) return true;
  // Tracks of the first track version carried their own pictures.
  return op.type === "track.add" && typeof op.track === "object" && op.track !== null && "source" in op.track;
}

export function isLegacyHistory(history: History): boolean {
  return history.entries.some((e) => e.ops.some((op) => isLegacyOp(op as { type: string })));
}

function replayLegacy(history: History): L.FilmState {
  let film = L.emptyFilm(history.initial);
  for (const entry of history.entries.slice(0, history.cursor)) {
    if (!entry.enabled) continue;
    try {
      film = (entry.ops as unknown as LegacyOp[]).reduce(applyOp, film);
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
    }
  }
  return film;
}

export function legacyToGrid(old: L.FilmState): FilmState {
  const { frames, totalTicks } = timeline(old);
  const clips: Record<string, Clip> = {};
  const add = (clip: Clip) => {
    let id = clip.id;
    for (let n = 2; clips[id]; n++) id = `${clip.id}#${n}`;
    clips[id] = { ...clip, id };
  };
  const tracks: Track[] = (old.tracks ?? [L.photoTrack()]).map((t) => ({
    id: t.id,
    name: t.name,
    visible: t.visible,
    opacity: t.opacity,
    transform: t.transform,
    exported: t.exported,
  }));

  for (const { frame, start } of frames) {
    for (const layer of frame.layers) {
      add({
        id: layer.id,
        track: L.trackOf(layer),
        start,
        length: frame.hold,
        media: layer.media,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        transform: layer.transform,
      });
    }
  }

  // Image and video tracks become one clip per run of cells showing the same picture.
  const spans = frameSpans(old);
  for (const track of old.tracks ?? []) {
    if (track.source.kind === "cells") continue;
    let run: Clip | null = null;
    for (let cell = 0; cell < totalTicks; cell++) {
      const media = trackMediaAt(old, track, cell, spans);
      if (run && media && media.original === run.media.original) {
        run.length++;
        continue;
      }
      if (run) add(run);
      run = media
        ? { id: `${track.id}:${cell}`, track: track.id, start: cell, length: 1, media, name: track.name, visible: true, opacity: 1, transform: { x: 0, y: 0, rotation: 0, scale: 1 } }
        : null;
    }
    if (run) add(run);
  }

  return { settings: old.settings, tracks, clips, length: totalTicks };
}

/**
 * The grid version of an old history: its converted content as the starting
 * point, with no steps yet. The caller keeps the old history next to it.
 */
export function migrateHistory(history: History): History {
  return { initial: history.initial, base: legacyToGrid(replayLegacy(history)), entries: [] as HistoryEntry[], cursor: 0 };
}
