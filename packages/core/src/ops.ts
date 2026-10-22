import type { Channel, FilmState, Frame, FrameId, ImageLayer, LayerId, MediaRef } from "./model";
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
  | { type: "frame.move"; frameId: FrameId; afterFrameId: FrameId | null }
  | { type: "layer.add"; frameId: FrameId; layerId: LayerId; media: MediaRef; name: string }
  | { type: "layer.remove"; frameId: FrameId; layerId: LayerId }
  | { type: "layer.update"; frameId: FrameId; layerId: LayerId; patch: LayerPatch }
  /** Moves a layer to `index` in its frame's stack (0 = bottom). */
  | { type: "layer.move"; frameId: FrameId; layerId: LayerId; index: number }
  | { type: "channel.add"; channel: Channel }
  | { type: "channel.remove"; channelId: LayerId }
  | { type: "channel.update"; channelId: LayerId; patch: ChannelPatch }
  | { type: "channel.move"; channelId: LayerId; index: number };

export type LayerPatch = Partial<Pick<ImageLayer, "name" | "visible" | "opacity" | "transform">>;
export type ChannelPatch = Partial<
  Pick<Channel, "name" | "visible" | "opacity" | "transform" | "placement" | "exported" | "from" | "to">
>;

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

function requireChannel(film: FilmState, id: LayerId) {
  const i = film.channels.findIndex((c) => c.id === id);
  if (i < 0) throw new OpError("El canal ya no existe");
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

/** Channels that started or ended on a deleted frame move to its neighbors. */
function channelsWithout(film: FilmState, frameId: FrameId): Channel[] {
  const i = film.frameOrder.indexOf(frameId);
  const next = film.frameOrder[i + 1] ?? null;
  const prev = i > 0 ? film.frameOrder[i - 1]! : null;
  return film.channels.map((c) => {
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
      return {
        ...film,
        frameOrder: film.frameOrder.filter((id) => id !== op.frameId),
        frames,
        channels: channelsWithout(film, op.frameId),
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
      const layer: ImageLayer = {
        id: op.layerId,
        kind: "image",
        name: op.name,
        media: op.media,
        visible: true,
        opacity: 1,
        transform: IDENTITY_TRANSFORM,
      };
      return withFrame(film, { ...frame, layers: [...frame.layers, layer] });
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
    case "layer.move": {
      const frame = requireFrame(film, op.frameId);
      return withFrame(film, { ...frame, layers: moveItem(frame.layers, requireLayer(frame, op.layerId), op.index) });
    }
    case "channel.add": {
      if (film.channels.some((c) => c.id === op.channel.id)) throw new OpError("El canal ya existe");
      return { ...film, channels: [...film.channels, op.channel] };
    }
    case "channel.remove": {
      const i = requireChannel(film, op.channelId);
      return { ...film, channels: film.channels.filter((_, j) => j !== i) };
    }
    case "channel.update": {
      const i = requireChannel(film, op.channelId);
      return { ...film, channels: film.channels.map((c, j) => (j === i ? { ...c, ...op.patch } : c)) };
    }
    case "channel.move":
      return { ...film, channels: moveItem(film.channels, requireChannel(film, op.channelId), op.index) };
  }
}

function describePatch(patch: LayerPatch | ChannelPatch, what: string): string {
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
    case "placement":
      return (patch as ChannelPatch).placement === "below" ? `Canal debajo de los cuadros` : `Canal encima de los cuadros`;
    case "exported":
      return (patch as ChannelPatch).exported ? "Exportar el canal" : "Canal solo de referencia";
    case "from":
    case "to":
      return "Cambiar el tramo del canal";
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
    case "layer.move":
      return "Ordenar capas";
    case "channel.add":
      return `Agregar canal "${op.channel.name}"`;
    case "channel.remove":
      return "Borrar canal";
    case "channel.update":
      return describePatch(op.patch, "canal");
    case "channel.move":
      return "Ordenar canales";
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
    case "layer.move":
      return op.frameId;
    default:
      return null;
  }
}
