import type { FilmState, Frame, FrameId, ImageLayer, LayerId, MediaRef, Track, TrackId } from "./model";
import { IDENTITY_TRANSFORM, PHOTO_TRACK, trackOf } from "./model";

/**
 * Every change to a film is one of these serializable operations. They address
 * frames by stable id (never by index) so they stay meaningful when earlier
 * history entries are disabled, removed or edited.
 */
export type Op =
  | { type: "film.rename"; name: string }
  | { type: "film.setFps"; fps: number }
  | { type: "film.setSize"; width: number; height: number }
  | {
      type: "frame.insert";
      /** null = insert at the start. */
      afterFrameId: FrameId | null;
      frameId: FrameId;
      layerId: LayerId;
      media: MediaRef;
      label: string;
    }
  | { type: "frame.delete"; frameId: FrameId }
  | { type: "frame.duplicate"; sourceFrameId: FrameId; frameId: FrameId; layerIds: LayerId[] }
  | { type: "frame.setHold"; frameId: FrameId; hold: number }
  | { type: "frame.move"; frameId: FrameId; afterFrameId: FrameId | null }
  /** Puts a picture in a frame's cell of a "cells" track (replacing what was there). */
  | { type: "layer.add"; frameId: FrameId; layerId: LayerId; media: MediaRef; name: string; trackId?: TrackId }
  | { type: "layer.remove"; frameId: FrameId; layerId: LayerId }
  | { type: "layer.update"; frameId: FrameId; layerId: LayerId; patch: LayerPatch }
  | { type: "track.add"; track: Track }
  | { type: "track.remove"; trackId: TrackId }
  | { type: "track.update"; trackId: TrackId; patch: TrackPatch }
  /** Moves a track to `index` in the stack (0 = bottom). */
  | { type: "track.move"; trackId: TrackId; index: number };

export type LayerPatch = Partial<Pick<ImageLayer, "name" | "visible" | "opacity" | "transform">>;
export type TrackPatch = Partial<Pick<Track, "name" | "visible" | "opacity" | "transform" | "exported" | "from" | "to">>;

export type OpType = Op["type"];

export class OpError extends Error {}

function requireFrame(film: FilmState, id: FrameId) {
  const frame = film.frames[id];
  if (!frame) throw new OpError("El cuadro ya no existe");
  return frame;
}

function requireLayer(frame: Frame, id: LayerId) {
  const i = frame.layers.findIndex((l) => l.id === id);
  if (i < 0) throw new OpError("La capa ya no existe");
  return i;
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

function withFrame(film: FilmState, frame: Frame): FilmState {
  return { ...film, frames: { ...film.frames, [frame.id]: frame } };
}

/** Tracks that started or ended on a deleted frame move to its neighbors. */
function tracksWithout(film: FilmState, frameId: FrameId): Track[] {
  const i = film.frameOrder.indexOf(frameId);
  const next = film.frameOrder[i + 1] ?? null;
  const prev = i > 0 ? film.frameOrder[i - 1]! : null;
  return film.tracks.map((c) => {
    if (c.from !== frameId && c.to !== frameId) return c;
    return { ...c, from: c.from === frameId ? next : c.from, to: c.to === frameId ? prev : c.to };
  });
}

function insertAfter(order: FrameId[], afterId: FrameId | null, id: FrameId): FrameId[] {
  if (afterId === null) return [id, ...order];
  const i = order.indexOf(afterId);
  if (i < 0) throw new OpError("El cuadro de referencia ya no existe");
  return [...order.slice(0, i + 1), id, ...order.slice(i + 1)];
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
    case "frame.insert": {
      if (film.frames[op.frameId]) throw new OpError("El cuadro ya existe");
      return {
        ...film,
        frameOrder: insertAfter(film.frameOrder, op.afterFrameId, op.frameId),
        frames: {
          ...film.frames,
          [op.frameId]: {
            id: op.frameId,
            hold: 1,
            layers: [
              {
                id: op.layerId,
                kind: "image",
                track: PHOTO_TRACK,
                name: "Foto",
                media: op.media,
                visible: true,
                opacity: 1,
                transform: IDENTITY_TRANSFORM,
              },
            ],
          },
        },
      };
    }
    case "frame.delete": {
      requireFrame(film, op.frameId);
      const { [op.frameId]: _removed, ...frames } = film.frames;
      return {
        ...film,
        frameOrder: film.frameOrder.filter((id) => id !== op.frameId),
        frames,
        tracks: tracksWithout(film, op.frameId),
      };
    }
    case "frame.duplicate": {
      const source = requireFrame(film, op.sourceFrameId);
      if (film.frames[op.frameId]) throw new OpError("El cuadro ya existe");
      const layers = source.layers.map((layer, i) => ({
        ...layer,
        id: op.layerIds[i] ?? `${op.frameId}:${i}`,
      }));
      return {
        ...film,
        frameOrder: insertAfter(film.frameOrder, op.sourceFrameId, op.frameId),
        frames: { ...film.frames, [op.frameId]: { ...source, id: op.frameId, layers } },
      };
    }
    case "frame.setHold": {
      const frame = requireFrame(film, op.frameId);
      const hold = Math.max(1, Math.round(op.hold));
      return { ...film, frames: { ...film.frames, [op.frameId]: { ...frame, hold } } };
    }
    case "frame.move": {
      requireFrame(film, op.frameId);
      if (op.afterFrameId === op.frameId) return film;
      const without = film.frameOrder.filter((id) => id !== op.frameId);
      return { ...film, frameOrder: insertAfter(without, op.afterFrameId, op.frameId) };
    }
    case "layer.add": {
      const frame = requireFrame(film, op.frameId);
      if (frame.layers.some((l) => l.id === op.layerId)) throw new OpError("La capa ya existe");
      const trackId = op.trackId ?? PHOTO_TRACK;
      const track = film.tracks[requireTrack(film, trackId)]!;
      if (track.source.kind !== "cells") throw new OpError("Ese track no tiene cuadros propios");
      const layer: ImageLayer = {
        id: op.layerId,
        kind: "image",
        track: trackId,
        name: op.name,
        media: op.media,
        visible: true,
        opacity: 1,
        transform: IDENTITY_TRANSFORM,
      };
      const others = frame.layers.filter((l) => trackOf(l) !== trackId);
      return withFrame(film, { ...frame, layers: [...others, layer] });
    }
    case "layer.remove": {
      const frame = requireFrame(film, op.frameId);
      const i = requireLayer(frame, op.layerId);
      return withFrame(film, { ...frame, layers: frame.layers.filter((_, j) => j !== i) });
    }
    case "layer.update": {
      const frame = requireFrame(film, op.frameId);
      const i = requireLayer(frame, op.layerId);
      const layers = frame.layers.map((l, j) => (j === i ? { ...l, ...op.patch } : l));
      return withFrame(film, { ...frame, layers });
    }
    case "track.add": {
      if (film.tracks.some((t) => t.id === op.track.id)) throw new OpError("El track ya existe");
      return { ...film, tracks: [...film.tracks, op.track] };
    }
    case "track.remove": {
      if (op.trackId === PHOTO_TRACK) throw new OpError("El track de fotos no se puede borrar");
      const i = requireTrack(film, op.trackId);
      // Its cells go with it.
      const frames = Object.fromEntries(
        Object.entries(film.frames).map(([id, f]) => [id, { ...f, layers: f.layers.filter((l) => trackOf(l) !== op.trackId) }]),
      );
      return { ...film, frames, tracks: film.tracks.filter((_, j) => j !== i) };
    }
    case "track.update": {
      const i = requireTrack(film, op.trackId);
      return { ...film, tracks: film.tracks.map((t, j) => (j === i ? { ...t, ...op.patch } : t)) };
    }
    case "track.move":
      return { ...film, tracks: moveItem(film.tracks, requireTrack(film, op.trackId), op.index) };
    default:
      // Ops from a newer or older version of the app.
      throw new OpError("Este paso no se reconoce");
  }
}

function describePatch(patch: LayerPatch | TrackPatch, what: string): string {
  const keys = Object.keys(patch);
  if (keys.length !== 1) return `Cambiar ${what}`;
  switch (keys[0]) {
    case "transform":
      return `Mover ${what}`;
    case "opacity":
      return `Transparencia de ${what}`;
    case "visible":
      return patch.visible ? `Mostrar ${what}` : `Ocultar ${what}`;
    case "name":
      return `Renombrar ${what}`;
    case "exported":
      return (patch as TrackPatch).exported ? `Exportar ${what}` : `${what[0]!.toUpperCase()}${what.slice(1)} solo de referencia`;
    case "from":
    case "to":
      return `Cambiar el tramo del ${what}`;
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
    case "frame.insert":
      return op.label;
    case "frame.delete":
      return "Borrar cuadro";
    case "frame.duplicate":
      return "Repetir cuadro";
    case "frame.setHold":
      return `Duración del cuadro: ×${op.hold}`;
    case "frame.move":
      return "Mover cuadro";
    case "layer.add":
      return `Agregar capa "${op.name}"`;
    case "layer.remove":
      return "Borrar capa";
    case "layer.update":
      return describePatch(op.patch, "capa");
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

/** Ids of frames an op refers to — used to jump from a history entry to its frame. */
export function frameOfOp(op: Op): FrameId | null {
  switch (op.type) {
    case "frame.insert":
    case "frame.delete":
    case "frame.duplicate":
    case "frame.setHold":
    case "frame.move":
    case "layer.add":
    case "layer.remove":
    case "layer.update":
      return op.frameId;
    default:
      return null;
  }
}
