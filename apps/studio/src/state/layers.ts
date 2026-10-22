import type { Channel, FrameId, ImageLayer, LayerId, Transform2D } from "@gepetta/core";
import { create } from "zustand";
import { useEditor } from "./editor";

/** What the layers panel and the stage handles act on. */
export type LayerTarget = { kind: "layer"; frameId: FrameId; id: LayerId } | { kind: "channel"; id: LayerId };

interface LayersState {
  target: LayerTarget | null;
  /** Transform shown while a handle is dragged; committed to the history on release. */
  preview: { id: LayerId; transform: Transform2D } | null;
  select(target: LayerTarget | null): void;
  setPreview(preview: LayersState["preview"]): void;
}

export const useLayers = create<LayersState>((set) => ({
  target: null,
  preview: null,
  select: (target) => set({ target, preview: null }),
  setPreview: (preview) => set({ preview }),
}));

/** The selected layer or channel, if it still exists (undo may have removed it). */
export function resolveTarget(target: LayerTarget | null): ImageLayer | Channel | null {
  const film = useEditor.getState().film;
  if (!film || !target) return null;
  if (target.kind === "channel") return film.channels.find((c) => c.id === target.id) ?? null;
  return film.frames[target.frameId]?.layers.find((l) => l.id === target.id) ?? null;
}

/** Commits a transform for the target as one history step. */
export function commitTransform(target: LayerTarget, transform: Transform2D) {
  const { commit } = useEditor.getState();
  if (target.kind === "channel") commit([{ type: "channel.update", channelId: target.id, patch: { transform } }]);
  else commit([{ type: "layer.update", frameId: target.frameId, layerId: target.id, patch: { transform } }]);
}
