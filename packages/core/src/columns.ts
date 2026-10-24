import { type FilmState, type TrackId, clipEnd } from "./model";
import { type Op, applyOp } from "./ops";

/** Cells [start, end) of every track: a stretch of the film as it comes out. */
export interface ColumnRange {
  start: number;
  end: number;
}

/** Sorted, with touching or overlapping stretches joined. */
export function normalizeColumns(ranges: readonly ColumnRange[]): ColumnRange[] {
  const out: ColumnRange[] = [];
  for (const r of [...ranges].filter((x) => x.end > x.start).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** ⌘/Ctrl+click: adds a stretch, or takes it out if it was all picked. */
export function toggleColumns(ranges: readonly ColumnRange[], r: ColumnRange): ColumnRange[] {
  const inside = ranges.some((x) => x.start <= r.start && x.end >= r.end);
  if (!inside) return normalizeColumns([...ranges, r]);
  const out: ColumnRange[] = [];
  for (const x of ranges) {
    if (x.end <= r.start || x.start >= r.end) out.push(x);
    else {
      if (x.start < r.start) out.push({ start: x.start, end: r.start });
      if (x.end > r.end) out.push({ start: r.end, end: x.end });
    }
  }
  return out;
}

/** ⇧+click: from the first picked cell to the clicked stretch, as one. */
export function extendColumns(ranges: readonly ColumnRange[], r: ColumnRange): ColumnRange[] {
  if (!ranges.length) return [r];
  const start = Math.min(ranges[0]!.start, r.start);
  const end = Math.max(ranges[ranges.length - 1]!.end, r.end);
  return [{ start, end }];
}

export function cellsInColumns(ranges: readonly ColumnRange[]): number {
  return ranges.reduce((n, r) => n + r.end - r.start, 0);
}

export function columnsContain(ranges: readonly ColumnRange[], cell: number): boolean {
  return ranges.some((r) => cell >= r.start && cell < r.end);
}

/**
 * Ops that take stretches out of the film: their cells go from every track
 * and what comes after moves back to close the gap, so the film gets shorter.
 */
export function removeColumnsOps(film: FilmState, ranges: readonly ColumnRange[]): Op[] {
  const ops: Op[] = [];
  let length = film.length;
  // From the last stretch back, so the earlier ones stay where they are.
  for (const r of [...normalizeColumns(ranges)].reverse()) {
    const end = Math.min(r.end, length);
    if (end <= r.start) continue;
    ops.push({ type: "cells.clear", start: r.start, length: end - r.start });
    if (length > end) ops.push({ type: "cells.move", start: end, length: length - end, to: r.start });
    length -= end - r.start;
  }
  if (ops.length) ops.push({ type: "film.setLength", length });
  return ops;
}

/**
 * Ops that put `count` empty cells in the film at `at`: what comes from there
 * on moves later (a picture held across `at` is split there), so the film gets longer.
 */
export function insertColumnsOps(film: FilmState, at: number, count: number): Op[] {
  const n = Math.max(0, Math.round(count));
  const start = Math.max(0, Math.min(film.length, Math.round(at)));
  if (!n) return [];
  const ops: Op[] = [];
  if (film.length > start) ops.push({ type: "cells.move", start, length: film.length - start, to: start + n });
  ops.push({ type: "film.setLength", length: film.length + n });
  return ops;
}

/** Where a cell ends up once the stretches are taken out (null: it was taken out). */
export function cellAfterRemoving(ranges: readonly ColumnRange[], cell: number): number | null {
  let shift = 0;
  for (const r of normalizeColumns(ranges)) {
    if (cell >= r.end) shift += r.end - r.start;
    else if (cell >= r.start) return null;
  }
  return cell - shift;
}

/** The cell right after the last picture of a track (where a camera goes next). */
export function afterLastPicture(film: FilmState, track: TrackId): number {
  let end = 0;
  for (const c of Object.values(film.clips)) if (c.track === track) end = Math.max(end, clipEnd(c));
  return end;
}

/**
 * Ops that take one cell out of a track, as a letter out of a word: what comes
 * after it in that track moves one cell earlier (a picture held across it gets
 * one cell shorter). The other tracks and the film's length stay.
 */
export function removeCellOps(film: FilmState, track: TrackId, cell: number): Op[] {
  if (cell < 0 || cell >= film.length) return [];
  const held = Object.values(film.clips).find((c) => c.track === track && c.start <= cell && cell < clipEnd(c) && c.length > 1);
  // A held picture just gets shorter (it stays one picture).
  const ops: Op[] = held ? [{ type: "clip.update", id: held.id, patch: { length: held.length - 1 } }] : [{ type: "cells.clear", start: cell, length: 1, tracks: [track] }];
  const from = held ? clipEnd(held) : cell + 1;
  if (film.length > from) ops.push({ type: "cells.move", start: from, length: film.length - from, to: from - 1, tracks: [track] });
  return ops;
}

/** Whether a track shows a picture at a cell. */
function filled(film: FilmState, track: TrackId, cell: number): boolean {
  return Object.values(film.clips).some((c) => c.track === track && c.start <= cell && cell < clipEnd(c));
}

/** The run a cell is in: pictures one after another, or empty cells ([start, end), within [0, end]). */
export function runAt(film: FilmState, track: TrackId, cell: number, end = film.length): { start: number; end: number; filled: boolean } {
  const kind = filled(film, track, cell);
  let a = cell;
  while (a > 0 && filled(film, track, a - 1) === kind) a--;
  let b = cell + 1;
  while (b < end && filled(film, track, b) === kind) b++;
  return { start: a, end: Math.max(b, cell + 1), filled: kind };
}

/**
 * Where Ctrl + arrow goes, as from word to word in a text: runs of pictures
 * are words and runs of empty cells the spaces between them. Forward
 * (`dir` 1): the first cell of the next run; back: the first cell of this run,
 * or of the one before if already there. Stays within [0, end].
 */
export function nextRunEdge(film: FilmState, track: TrackId, cell: number, dir: -1 | 1, end = film.length): number {
  if (dir > 0) {
    if (cell >= end) return end;
    const here = filled(film, track, cell);
    let c = cell + 1;
    while (c < end && filled(film, track, c) === here) c++;
    return c;
  }
  if (cell <= 0) return 0;
  let c = cell - 1;
  const kind = filled(film, track, c);
  while (c > 0 && filled(film, track, c - 1) === kind) c--;
  return c;
}

/** Ops that take `count` cells out of a track from `start` on, closing up (see removeCellOps). */
export function removeCellsOps(film: FilmState, track: TrackId, start: number, count: number): Op[] {
  const ops: Op[] = [];
  let f = film;
  for (let i = 0; i < count; i++) {
    const step = removeCellOps(f, track, start);
    if (!step.length) break;
    for (const op of step) f = applyOp(f, op);
    ops.push(...step);
  }
  return ops;
}

/**
 * Ops that open `count` empty cells in a track at `at`, as typing into a
 * text: what comes from there on moves later (a picture held across `at` is
 * split there), and the film gets longer if that track then needs it.
 */
export function insertCellsOps(film: FilmState, track: TrackId, at: number, count: number): Op[] {
  if (count <= 0) return [];
  const ops: Op[] = [];
  if (film.length > at) ops.push({ type: "cells.move", start: at, length: film.length - at, to: at + count, tracks: [track] });
  let end = 0;
  for (const c of Object.values(film.clips)) if (c.track === track) end = Math.max(end, clipEnd(c));
  if (end + count > film.length && end > at) ops.push({ type: "film.setLength", length: end + count });
  return ops;
}
