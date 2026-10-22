import type { Track, TrackId, Transform2D } from "@gepetta/core";
import { create } from "zustand";
import { useEditor } from "./editor";

interface LayersState {
  /** Track selected in the timeline: the stage shows its handles, the side panel its settings. */
  trackId: TrackId | null;
  /** Transform shown while a handle is dragged; committed to the history on release. */
  preview: { trackId: TrackId; transform: Transform2D } | null;
  select(trackId: TrackId | null): void;
  setPreview(preview: LayersState["preview"]): void;
}

export const useLayers = create<LayersState>((set) => ({
  trackId: null,
  preview: null,
  select: (trackId) => set({ trackId, preview: null }),
  setPreview: (preview) => set({ preview }),
}));

/** The selected track, if it still exists (undo may have removed it). */
export function selectedTrack(): Track | null {
  const { trackId } = useLayers.getState();
  return useEditor.getState().film?.tracks.find((t) => t.id === trackId) ?? null;
}

/** Changes a track as one history step. */
export function updateTrack(trackId: TrackId, patch: Partial<Track>) {
  useEditor.getState().commit([{ type: "track.update", trackId, patch }]);
}
