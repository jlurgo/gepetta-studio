import { groupAtPlace, groupTracks, pruneGroups } from "./groups";
import type { Clip, ClipId, FilmState, Group, GroupId, Stroke, Track, TrackId } from "./model";
import { CELL_VALUES, type CellValues, PHOTO_TRACK, clipEnd, clipFrom } from "./model";

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
  | { type: "film.setLoop"; loop: boolean; pingpong?: boolean }
  | { type: "film.setSize"; width: number; height: number }
  /** Makes the grid at least this long (it never cuts clips). */
  | { type: "film.setLength"; length: number }
  | { type: "clip.place"; clips: Clip[]; label?: string }
  | { type: "clip.remove"; ids: ClipId[] }
  /** Moves clips to new cells and tracks, together. */
  | { type: "clip.move"; moves: { id: ClipId; track: TrackId; start: number }[] }
  | { type: "clip.update"; id: ClipId; patch: ClipPatch }
  /** Strokes of a drawing tool on a picture: added on top, changed, or removed. */
  | { type: "stroke.add"; clip: ClipId; stroke: Stroke; label?: string }
  | { type: "stroke.update"; clip: ClipId; id: string; patch: StrokePatch }
  | { type: "stroke.remove"; clip: ClipId; ids: string[] }
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
  /**
   * Moves a track to `index` in the stack (0 = bottom). It goes into the group
   * it lands inside of, or stays in its own if it lands next to its tracks.
   */
  | { type: "track.move"; trackId: TrackId; index: number }
  /** Makes a group of these tracks and groups (all in `group.parent`), putting its tracks together where the top one is. */
  | { type: "group.add"; group: Group; tracks?: TrackId[]; groups?: GroupId[] }
  /** Undoes a group: what was in it stays where it is, in the group around it. */
  | { type: "group.remove"; id: GroupId }
  | { type: "group.update"; id: GroupId; patch: GroupPatch }
  /** Moves a group's tracks together, to `index` among the other tracks (0 = bottom), as track.move does with one. */
  | { type: "group.move"; id: GroupId; index: number };

export type ClipPatch = Partial<Pick<Clip, "name" | "visible" | "opacity" | "transform" | "length" | "media" | "look" | "fade" | "seq" | "sound">>;
export type StrokePatch = Partial<Omit<Stroke, "id" | "tool" | "layer">>;
export type TrackPatch = Partial<Pick<Track, "name" | "visible" | "opacity" | "transform" | "exported" | "pan" | "voice" | "duck">> & {
  /** null: out of every group. */
  group?: GroupId | null;
};
export type GroupPatch = Partial<Pick<Group, "name" | "linked" | "volume" | "muted">>;
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

function requireGroup(film: FilmState, id: GroupId): Group {
  const group = film.groups?.[id];
  if (!group) throw new OpError("El grupo ya no existe");
  return group;
}

/** `tracks` with the one at `index` put in the group its neighbors say (see groupAtPlace). */
function settle(film: FilmState, tracks: Track[], index: number): Track[] {
  const group = groupAtPlace(film, tracks, index);
  const track = tracks[index]!;
  if (group === track.group) return tracks;
  const { group: _, ...rest } = track;
  const out = tracks.slice();
  out[index] = group ? { ...rest, group } : rest;
  return out;
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
function carve(clips: Record<ClipId, Clip>, track: TrackId, start: number, end: number, keep: Set<ClipId>, fps: number): Record<ClipId, Clip> {
  const out: Record<ClipId, Clip> = {};
  for (const c of Object.values(clips)) {
    if (c.track !== track || keep.has(c.id) || clipEnd(c) <= start || c.start >= end) {
      out[c.id] = c;
      continue;
    }
    if (c.start < start) out[c.id] = { ...c, length: start - c.start };
    if (clipEnd(c) > end) {
      const id = c.start < start ? `${c.id}@${end}` : c.id;
      out[id] = { ...clipFrom(c, end - c.start, fps), id, start: end, length: clipEnd(c) - end };
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
    const track = film.tracks[requireTrack(film, c.track)]!;
    if ((track.kind === "sound") !== !!c.sound) throw new OpError(c.sound ? "El sonido va en un track de sonido" : "Las imágenes no van en un track de sonido");
    clips = carve(clips, c.track, c.start, clipEnd(c), ids, film.settings.fps);
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
    pieces.push({ ...clipFrom(c, s - c.start, film.settings.fps), id: whole ? c.id : `${c.id}~${s}`, start: s, length: e - s });
  }
  let clips = film.clips;
  for (const t of film.tracks) if (inTracks(t.id)) clips = carve(clips, t.id, start, end, new Set(), film.settings.fps);
  return { film: { ...film, clips }, pieces };
}

/**
 * After a change of speed, sound clips are cut again so that they last as
 * long as before and start at the same moment (pictures keep their cells).
 */
function resliceSounds(film: FilmState, before: number): FilmState {
  const k = film.settings.fps / before;
  const sounds = Object.values(film.clips).filter((c) => c.sound);
  if (k === 1 || !sounds.length) return film;
  const others = Object.fromEntries(Object.entries(film.clips).filter(([, c]) => !c.sound));
  const moved = sounds
    .map((c) => {
      // Each cell's volume and speaker go to the cells that now take its time.
      const length = Math.max(1, Math.round(c.length * k));
      const sound = { ...c.sound! };
      for (const what of Object.keys(CELL_VALUES) as CellValues[]) {
        const values = sound[what];
        if (values) sound[what] = Array.from({ length }, (_, i) => values[Math.floor(i / k)] ?? CELL_VALUES[what]);
      }
      return { ...c, sound, start: Math.round(c.start * k), length };
    })
    .sort((a, b) => a.start - b.start);
  return place({ ...film, clips: others }, moved);
}

function withClip(film: FilmState, clip: Clip): FilmState {
  return { ...film, clips: { ...film.clips, [clip.id]: clip } };
}

/** Pure: returns a new state, or throws OpError when the op no longer applies. */
export function applyOp(film: FilmState, op: Op): FilmState {
  switch (op.type) {
    case "film.rename":
      return { ...film, settings: { ...film.settings, name: op.name } };
    case "film.setFps":
      if (!(op.fps > 0)) throw new OpError("fps inválido");
      return resliceSounds({ ...film, settings: { ...film.settings, fps: op.fps } }, film.settings.fps);
    case "film.setSize":
      return { ...film, settings: { ...film.settings, width: op.width, height: op.height } };
    case "film.setLoop":
      return { ...film, settings: { ...film.settings, loop: op.loop, pingpong: op.loop && !!op.pingpong } };
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
      const before = requireClip(film, op.id);
      if (op.patch.sound && !before.sound) throw new OpError("No es un sonido");
      const clip = { ...before, ...op.patch };
      // A longer clip overwrites the cells it grows into.
      return op.patch.length !== undefined ? place(film, [clip]) : { ...film, clips: { ...film.clips, [clip.id]: clip } };
    }
    case "stroke.add": {
      const clip = requireClip(film, op.clip);
      if (clip.strokes?.some((s) => s.id === op.stroke.id)) throw new OpError("El trazo ya existe");
      return withClip(film, { ...clip, strokes: [...(clip.strokes ?? []), op.stroke] });
    }
    case "stroke.update": {
      const clip = requireClip(film, op.clip);
      if (!clip.strokes?.some((s) => s.id === op.id)) throw new OpError("El trazo ya no existe");
      return withClip(film, { ...clip, strokes: clip.strokes.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)) });
    }
    case "stroke.remove": {
      const clip = requireClip(film, op.clip);
      const gone = new Set(op.ids);
      if (!op.ids.every((id) => clip.strokes?.some((s) => s.id === id))) throw new OpError("El trazo ya no existe");
      return withClip(film, { ...clip, strokes: clip.strokes!.filter((s) => !gone.has(s.id)) });
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
      return pruneGroups({ ...film, clips, tracks: film.tracks.filter((_, j) => j !== i) });
    }
    case "track.update": {
      const i = requireTrack(film, op.trackId);
      const { group, ...patch } = op.patch;
      if (group) requireGroup(film, group);
      const update = (t: Track): Track => {
        const next = { ...t, ...patch };
        if (group === null) delete next.group;
        else if (group) next.group = group;
        return next;
      };
      return pruneGroups({ ...film, tracks: film.tracks.map((t, j) => (j === i ? update(t) : t)) });
    }
    case "track.move": {
      const tracks = moveItem(film.tracks, requireTrack(film, op.trackId), op.index);
      return pruneGroups({ ...film, tracks: settle(film, tracks, tracks.findIndex((t) => t.id === op.trackId)) });
    }
    case "group.add": {
      const g = op.group;
      if (film.groups?.[g.id]) throw new OpError("El grupo ya existe");
      if (g.parent) requireGroup(film, g.parent);
      const tracks = new Set(op.tracks ?? []);
      const groups = new Set(op.groups ?? []);
      for (const id of tracks) if (film.tracks[requireTrack(film, id)]!.group !== g.parent) throw new OpError("Esos tracks no están en el mismo grupo");
      for (const id of groups) if (requireGroup(film, id).parent !== g.parent) throw new OpError("Esos grupos no están en el mismo grupo");
      const { parent, ...plain } = g;
      const all: Record<GroupId, Group> = { ...film.groups, [g.id]: parent ? g : plain };
      for (const id of groups) all[id] = { ...all[id]!, parent: g.id };
      let next: FilmState = { ...film, groups: all, tracks: film.tracks.map((t) => (tracks.has(t.id) ? { ...t, group: g.id } : t)) };
      const members = groupTracks(next, g.id);
      if (!members.length) throw new OpError("El grupo no tiene tracks");
      // Its tracks together, where the top one was.
      const top = next.tracks.indexOf(members.at(-1)!);
      const inside = new Set(members);
      const rest = next.tracks.filter((t) => !inside.has(t));
      const at = next.tracks.slice(0, top).filter((t) => !inside.has(t)).length;
      next = { ...next, tracks: [...rest.slice(0, at), ...members, ...rest.slice(at)] };
      return next;
    }
    case "group.remove": {
      const g = requireGroup(film, op.id);
      const groups: Record<GroupId, Group> = {};
      for (const [id, x] of Object.entries(film.groups!)) {
        if (id === g.id) continue;
        if (x.parent !== g.id) groups[id] = x;
        else {
          const { parent: _, ...rest } = x;
          groups[id] = g.parent ? { ...rest, parent: g.parent } : rest;
        }
      }
      const tracks = film.tracks.map((t) => {
        if (t.group !== g.id) return t;
        const { group: _, ...rest } = t;
        return g.parent ? { ...rest, group: g.parent } : rest;
      });
      return { ...film, groups, tracks };
    }
    case "group.update": {
      const g = requireGroup(film, op.id);
      return { ...film, groups: { ...film.groups, [g.id]: { ...g, ...op.patch } } };
    }
    case "group.move": {
      const g = requireGroup(film, op.id);
      const members = groupTracks(film, g.id);
      const inside = new Set(members);
      const rest = film.tracks.filter((t) => !inside.has(t));
      const at = Math.max(0, Math.min(rest.length, Math.round(op.index)));
      // Which group it lands in: as a track in its place would (one standing for the group).
      const stand: Track = { ...members[0]!, id: `group:${g.id}`, ...(g.parent ? { group: g.parent } : { group: undefined }) };
      const parent = groupAtPlace(film, [...rest.slice(0, at), stand, ...rest.slice(at)], at);
      const { parent: _, ...plain } = g;
      const moved = parent ? { ...plain, parent } : plain;
      return pruneGroups({ ...film, groups: { ...film.groups, [g.id]: moved }, tracks: [...rest.slice(0, at), ...members, ...rest.slice(at)] });
    }
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
    case "look":
      return `Ajustes de ${what}`;
    case "fade":
      return `Fundido de ${what}`;
    case "sound":
      return "Volumen del sonido";
    case "pan":
      return "Izquierda o derecha";
    case "duck":
      return (patch as TrackPatch).duck ? "Que baje cuando suenan los otros" : "Que no baje cuando suenan los otros";
    case "voice":
      return (patch as TrackPatch).voice ? "Efecto de voz" : "Sin efecto de voz";
    case "seq":
      return (patch as ClipPatch).seq ? `Poner ${what} en una secuencia` : `Sacar ${what} de su secuencia`;
    case "media":
      return `Dibujar en ${what}`;
    case "group":
      return (patch as TrackPatch).group ? "Meter el track en un grupo" : "Sacar el track del grupo";
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
    case "film.setLoop":
      return !op.loop ? "Película sin loop" : op.pingpong ? "Película en ping-pong" : "Película en loop";
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
    case "stroke.add":
      return op.label ?? "Trazo";
    case "stroke.update": {
      const keys = Object.keys(op.patch);
      if (keys.length === 1 && keys[0] === "hidden") return op.patch.hidden ? "Ocultar trazo" : "Mostrar trazo";
      if (keys.length === 1 && keys[0] === "color") return "Color del trazo";
      return "Cambiar trazo";
    }
    case "stroke.remove":
      return op.ids.length === 1 ? "Borrar trazo" : `Borrar ${op.ids.length} trazos`;
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
    case "group.add":
      return `Agrupar en "${op.group.name}"`;
    case "group.remove":
      return "Desagrupar";
    case "group.update":
      if (op.patch.volume !== undefined) return "Volumen del grupo";
      if (op.patch.muted !== undefined) return op.patch.muted ? "Silenciar el grupo" : "Que suene el grupo";
      return op.patch.linked !== undefined && Object.keys(op.patch).length === 1 ? (op.patch.linked ? "Vincular el grupo" : "Desvincular el grupo") : op.patch.name ? `Renombrar el grupo a "${op.patch.name}"` : "Cambiar el grupo";
    case "group.move":
      return "Mover el grupo";
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
