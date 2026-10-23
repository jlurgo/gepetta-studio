import type { Clip, ClipId, FilmState, Track, TrackId } from "./model";
import { PHOTO_TRACK, clipEnd } from "./model";

/**
 * Every change to a film is one of these serializable operations. They address
 * clips and tracks by stable id, so they stay meaningful when earlier history
 * entries are disabled, removed or edited.
 *
 * Placing pictures overwrites: whatever was in the cells they land on is cut
 * away (trimmed, split or removed).
 */
export type Op =
  | { type: "film.rename"; name: string }
  | { type: "film.setFps"; fps: number }
  | { type: "film.setSize"; width: number; height: number }
  /** Makes the grid at least this long (it never cuts clips). */
  | { type: "film.setLength"; length: number }
  | { type: "clip.place"; clips: Clip[]; label?: string }
  | { type: "clip.remove"; ids: ClipId[] }
  /** Moves clips to new cells and tracks, together. */
  | { type: "clip.move"; moves: { id: ClipId; track: TrackId; start: number }[] }
  | { type: "clip.update"; id: ClipId; patch: ClipPatch }
  /**
   * Moves a column of cells [start, start + length) of every track (or of
   * `tracks`) to start at `to`. Pictures that reach outside the column are
   * cut: only the part inside moves. The cells left behind are empty.
   */
  | { type: "cells.move"; start: number; length: number; to: number; tracks?: TrackId[] }
  /** Empties a column of cells in every track (or in `tracks`). */
  | { type: "cells.clear"; start: number; length: number; tracks?: TrackId[] }
  | { type: "track.add"; track: Track }
  | { type: "track.remove"; trackId: TrackId }
  | { type: "track.update"; trackId: TrackId; patch: TrackPatch }
  /** Moves a track to `index` in the stack (0 = bottom). */
  | { type: "track.move"; trackId: TrackId; index: number };

export type ClipPatch = Partial<Pick<Clip, "name" | "visible" | "opacity" | "transform" | "length" | "media">>;
export type TrackPatch = Partial<Pick<Track, "name" | "visible" | "opacity" | "transform" | "exported">>;
export type OpType = Op["type"];

export class OpError extends Error {}

function requireClip(film: FilmState, id: ClipId): Clip {
  const clip = film.clips[id];
  if (!clip) throw new OpError("La imagen ya no existe");
  return clip;
}

function requireTrack(film: FilmState, id: TrackId) {
  const i = film.tracks.findIndex((t) => t.id === id);
  if (i < 0) throw new OpError("El track ya no existe");
  return i;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const out = items.slice();
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, Math.round(to))), 0, item!);
  return out;
}

function checkPlacement(c: Pick<Clip, "start" | "length">) {
  if (!Number.isInteger(c.start) || c.start < 0) throw new OpError("Posición inválida");
  if (!Number.isInteger(c.length) || c.length < 1) throw new OpError("Duración inválida");
}

/**
 * Clears [start, end) of `track`: clips inside go, clips across an edge are
 * trimmed, a clip across both edges is split. The split-off part gets an id
 * derived from the cut, so replaying the history gives the same ids.
 */
function carve(clips: Record<ClipId, Clip>, track: TrackId, start: number, end: number, keep: Set<ClipId>): Record<ClipId, Clip> {
  const out: Record<ClipId, Clip> = {};
  for (const c of Object.values(clips)) {
    if (c.track !== track || keep.has(c.id) || clipEnd(c) <= start || c.start >= end) {
      out[c.id] = c;
      continue;
    }
    if (c.start < start) out[c.id] = { ...c, length: start - c.start };
    if (clipEnd(c) > end) {
      const id = c.start < start ? `${c.id}@${end}` : c.id;
      out[id] = { ...c, id, start: end, length: clipEnd(c) - end };
    }
  }
  return out;
}

/** Puts clips in place, overwriting what they land on (but not each other). */
function place(film: FilmState, placed: Clip[]): FilmState {
  const ids = new Set(placed.map((c) => c.id));
  let clips = film.clips;
  for (const c of placed) {
    checkPlacement(c);
    requireTrack(film, c.track);
    clips = carve(clips, c.track, c.start, clipEnd(c), ids);
  }
  clips = { ...clips };
  let length = film.length;
  for (const c of placed) {
    clips[c.id] = c;
    length = Math.max(length, clipEnd(c));
  }
  return { ...film, clips, length };
}

/**
 * Lifts the cells [start, end) out of the given tracks: returns the film
 * without them and the pieces that were there (whole pictures keep their id,
 * cut ones get one derived from the cut).
 */
function lift(film: FilmState, start: number, end: number, tracks?: TrackId[]): { film: FilmState; pieces: Clip[] } {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end <= start) throw new OpError("Celdas inválidas");
  const inTracks = (id: TrackId) => !tracks || tracks.includes(id);
  const pieces: Clip[] = [];
  for (const c of Object.values(film.clips)) {
    if (!inTracks(c.track) || clipEnd(c) <= start || c.start >= end) continue;
    const s = Math.max(start, c.start);
    const e = Math.min(end, clipEnd(c));
    const whole = s === c.start && e === clipEnd(c);
    pieces.push({ ...c, id: whole ? c.id : `${c.id}~${s}`, start: s, length: e - s });
  }
  let clips = film.clips;
  for (const t of film.tracks) if (inTracks(t.id)) clips = carve(clips, t.id, start, end, new Set());
  return { film: { ...film, clips }, pieces };
}

/** Pure: returns a new state, or throws OpError when the op no longer applies. */
export function applyOp(film: FilmState, op: Op): FilmState {
  switch (op.type) {
    case "film.rename":
      return { ...film, settings: { ...film.settings, name: op.name } };
    case "film.setFps":
      if (!(op.fps > 0)) throw new OpError("fps inválido");
      return { ...film, settings: { ...film.settings, fps: op.fps } };
    case "film.setSize":
      return { ...film, settings: { ...film.settings, width: op.width, height: op.height } };
    case "film.setLength":
      if (!Number.isInteger(op.length) || op.length < 0) throw new OpError("Duración inválida");
      return { ...film, length: Math.max(op.length, ...Object.values(film.clips).map(clipEnd), 0) };
    case "clip.place":
      for (const c of op.clips) if (film.clips[c.id]) throw new OpError("La imagen ya existe");
      return place(film, op.clips);
    case "clip.remove": {
      for (const id of op.ids) requireClip(film, id);
      const remove = new Set(op.ids);
      return { ...film, clips: Object.fromEntries(Object.entries(film.clips).filter(([id]) => !remove.has(id))) };
    }
    case "clip.move": {
      const moved = op.moves.map((m) => ({ ...requireClip(film, m.id), track: m.track, start: m.start }));
      return place(film, moved);
    }
    case "clip.update": {
      const clip = { ...requireClip(film, op.id), ...op.patch };
      // A longer clip overwrites the cells it grows into.
      return op.patch.length !== undefined ? place(film, [clip]) : { ...film, clips: { ...film.clips, [clip.id]: clip } };
    }
    case "cells.move": {
      if (!Number.isInteger(op.to) || op.to < 0) throw new OpError("Posición inválida");
      const lifted = lift(film, op.start, op.start + op.length, op.tracks);
      return place(lifted.film, lifted.pieces.map((p) => ({ ...p, start: p.start + op.to - op.start })));
    }
    case "cells.clear":
      return lift(film, op.start, op.start + op.length, op.tracks).film;
    case "track.add":
      if (film.tracks.some((t) => t.id === op.track.id)) throw new OpError("El track ya existe");
      return { ...film, tracks: [...film.tracks, op.track] };
    case "track.remove": {
      if (op.trackId === PHOTO_TRACK) throw new OpError("El track de fotos no se puede borrar");
      const i = requireTrack(film, op.trackId);
      // Its pictures go with it.
      const clips = Object.fromEntries(Object.entries(film.clips).filter(([, c]) => c.track !== op.trackId));
      return { ...film, clips, tracks: film.tracks.filter((_, j) => j !== i) };
    }
    case "track.update": {
      const i = requireTrack(film, op.trackId);
      return { ...film, tracks: film.tracks.map((t, j) => (j === i ? { ...t, ...op.patch } : t)) };
    }
    case "track.move":
      return { ...film, tracks: moveItem(film.tracks, requireTrack(film, op.trackId), op.index) };
    default:
      // Ops from another version of the app.
      throw new OpError("Este paso no se reconoce");
  }
}

function describePatch(patch: ClipPatch | TrackPatch, what: string): string {
  const keys = Object.keys(patch);
  if (keys.length !== 1) return `Cambiar ${what}`;
  switch (keys[0]) {
    case "transform":
      return `Mover ${what} en la imagen`;
    case "opacity":
      return `Transparencia de ${what}`;
    case "visible":
      return patch.visible ? `Mostrar ${what}` : `Ocultar ${what}`;
    case "name":
      return `Renombrar ${what}`;
    case "length":
      return `Duración: ${(patch as ClipPatch).length} ${(patch as ClipPatch).length === 1 ? "celda" : "celdas"}`;
    case "media":
      return `Dibujar en ${what}`;
    case "exported":
      return (patch as TrackPatch).exported ? `Exportar ${what}` : `${what[0]!.toUpperCase()}${what.slice(1)} solo de referencia`;
    default:
      return `Cambiar ${what}`;
  }
}

/** Short Spanish description for the history panel. */
export function describeOp(op: Op): string {
  switch (op.type) {
    case "film.rename":
      return `Renombrar a "${op.name}"`;
    case "film.setFps":
      return `Velocidad: ${op.fps} cuadros/s`;
    case "film.setSize":
      return `Tamaño: ${op.width}×${op.height}`;
    case "film.setLength":
      return `Largo: ${op.length} celdas`;
    case "clip.place":
      return op.label ?? (op.clips.length === 1 ? "Poner imagen" : `Poner ${op.clips.length} imágenes`);
    case "clip.remove":
      return op.ids.length === 1 ? "Borrar imagen" : `Borrar ${op.ids.length} imágenes`;
    case "clip.move":
      return op.moves.length === 1 ? "Mover imagen" : `Mover ${op.moves.length} imágenes`;
    case "clip.update":
      return describePatch(op.patch, "la imagen");
    case "cells.move":
      return op.length === 1 ? "Mover columna" : `Mover ${op.length} columnas`;
    case "cells.clear":
      return op.length === 1 ? "Vaciar columna" : `Vaciar ${op.length} columnas`;
    case "track.add":
      return `Agregar track "${op.track.name}"`;
    case "track.remove":
      return "Borrar track";
    case "track.update":
      return describePatch(op.patch, "track");
    case "track.move":
      return "Ordenar tracks";
    default:
      return "Paso desconocido";
  }
}

/** Where an op happened in time (first cell it touches), to jump there from the history. */
export function cellOfOp(op: Op): number | null {
  switch (op.type) {
    case "clip.place":
      return op.clips.length ? Math.min(...op.clips.map((c) => c.start)) : null;
    case "clip.move":
      return op.moves.length ? Math.min(...op.moves.map((m) => m.start)) : null;
    case "cells.move":
      return op.to;
    case "cells.clear":
      return op.start;
    default:
      return null;
  }
}
