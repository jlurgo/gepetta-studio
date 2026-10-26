import { CELL_VALUES, type CellValues, type Clip, type ClipId, type FilmState, type Op, type TrackId, clipAt, clipEnd, cellValue } from "@gepetta/core";
import { type EditorState, useEditor } from "./editor";

/**
 * The sound cells being worked on, shown big on the stage: the cells picked
 * with ⇧ in a sound track, or the whole sound picked (double click), or the
 * cursor's cell.
 */
export interface SoundRange {
  track: TrackId;
  start: number;
  end: number;
}

export function soundRange(s: Pick<EditorState, "film" | "cursor" | "span" | "selection">): SoundRange | null {
  const { film, cursor, span, selection } = s;
  const track = film?.tracks.find((t) => t.id === cursor.track);
  if (!film || track?.kind !== "sound") return null;
  if (span?.track === track.id && span.anchor !== cursor.cell) return { track: track.id, start: Math.min(span.anchor, cursor.cell), end: Math.max(span.anchor, cursor.cell) + 1 };
  const picked = selection.length === 1 ? film.clips[selection[0]!] : undefined;
  if (picked?.sound && picked.track === track.id && cursor.cell >= picked.start && cursor.cell < clipEnd(picked)) return { track: track.id, start: picked.start, end: clipEnd(picked) };
  return { track: track.id, start: cursor.cell, end: cursor.cell + 1 };
}

/** The sound clips with cells in a range. */
export function rangeClips(film: FilmState, r: SoundRange): Clip[] {
  const out: Clip[] = [];
  for (let c = r.start; c < r.end; c++) {
    const clip = clipAt(film, r.track, c);
    if (clip?.sound && !out.includes(clip)) out.push(clip);
  }
  return out;
}

/** Values of each clip's cells being changed (not yet committed), by clip. */
export type CellDraft = Record<ClipId, number[]>;

/** A cell's value, as being changed or as it is. */
export function draftValue(clip: Clip, what: CellValues, cell: number, draft?: CellDraft): number {
  return draft?.[clip.id]?.[cell - clip.start] ?? cellValue(clip, what, cell);
}

/** Sets `what` of the sound cells from `a` to `b` (both included) of a track to `f(cell)`, on top of `draft`. */
export function paintCells(film: FilmState, track: TrackId, what: CellValues, a: number, b: number, f: (cell: number) => number, draft: CellDraft = {}): CellDraft {
  const out = { ...draft };
  for (let cell = Math.min(a, b); cell <= Math.max(a, b); cell++) {
    const clip = clipAt(film, track, cell);
    if (!clip?.sound) continue;
    const values = (out[clip.id] ?? clip.sound[what] ?? []).slice();
    while (values.length < clip.length) values.push(CELL_VALUES[what]);
    values[cell - clip.start] = f(cell);
    out[clip.id] = values;
  }
  return out;
}

/** Keeps the changed values as one history step. */
export function commitCells(draft: CellDraft, what: CellValues, label: string) {
  const film = useEditor.getState().film;
  if (!film) return;
  const ops: Op[] = Object.entries(draft).flatMap(([id, values]) => {
    const c = film.clips[id];
    return c?.sound ? [{ type: "clip.update" as const, id, patch: { sound: { ...c.sound, [what]: values } } }] : [];
  });
  if (ops.length) useEditor.getState().commit(ops, label);
}

/** Sets the range's cells along a line: `f(t)`, t from 0 (first cell) to 1 (last). */
export function shapeRange(r: SoundRange, what: CellValues, f: (t: number) => number, label: string) {
  const film = useEditor.getState().film;
  if (!film) return;
  const n = r.end - r.start;
  commitCells(paintCells(film, r.track, what, r.start, r.end - 1, (c) => Math.round(f(n > 1 ? (c - r.start) / (n - 1) : 1) * 100) / 100), what, label);
}
