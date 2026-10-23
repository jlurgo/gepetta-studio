import { type FilmState, type TrackId, clipEnd } from "./model";
import type { Op } from "./ops";

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
