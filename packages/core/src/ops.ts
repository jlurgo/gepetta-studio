import type { FilmState, FrameId, LayerId, MediaRef } from "./model";
import { IDENTITY_TRANSFORM } from "./model";

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
  | { type: "frame.move"; frameId: FrameId; afterFrameId: FrameId | null };

export type OpType = Op["type"];

export class OpError extends Error {}

function requireFrame(film: FilmState, id: FrameId) {
  const frame = film.frames[id];
  if (!frame) throw new OpError("El cuadro ya no existe");
  return frame;
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
                name: "Base",
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
      return { ...film, frameOrder: film.frameOrder.filter((id) => id !== op.frameId), frames };
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
      return op.frameId;
    default:
      return null;
  }
}
