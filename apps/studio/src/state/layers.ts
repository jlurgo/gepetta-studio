import type { ClipId, Track, TrackId, Transform2D } from "@gepetta/core";
import { create } from "zustand";
import { useCamera } from "./camera";
import { useEditor } from "./editor";

/** What the stage handles move: a whole track, one picture, or a camera's live picture (its shot settings). */
export type HandleTarget = { kind: "track"; id: TrackId } | { kind: "clip"; id: ClipId } | { kind: "rig"; id: string };

interface LayersState {
  /** Track picked in the timeline (by its name, or as the track of the picture shown). */
  trackId: TrackId | null;
  /** What the detail panel shows: the selected picture, or its track. */
  detail: "clip" | "track";
  /** What the detail panel shows: the tool in use, or what is selected (picture, pictures, track). */
  panel: "tool" | "detail";
  /** Transform shown while a handle is dragged; committed to the history on release. */
  preview: { target: HandleTarget; transform: Transform2D } | null;
  /** Shows a track's settings. */
  select(trackId: TrackId | null): void;
  /** Shows the selected picture's settings (its track is remembered to go there). */
  showClip(trackId: TrackId): void;
  setPreview(preview: LayersState["preview"]): void;
}

export const useLayers = create<LayersState>((set) => ({
  trackId: null,
  detail: "track",
  panel: "tool",
  preview: null,
  select: (trackId) => set({ trackId, detail: "track", preview: null, panel: trackId ? "detail" : "tool" }),
  showClip: (trackId) => set({ trackId, detail: "clip", preview: null, panel: "detail" }),
  setPreview: (preview) => set({ preview }),
}));

// Picking several pictures shows them (their settings change together).
useEditor.subscribe((state, prev) => {
  if (state.selection === prev.selection || state.selection.join() === prev.selection.join()) return;
  if (state.selection.length > 1) useLayers.setState({ detail: "clip", panel: "detail" });
  else if (state.selection.length === 1) useLayers.setState({ panel: "detail" });
  // Nothing picked any more: the panel goes back to the tool.
  else if (useLayers.getState().detail === "clip") useLayers.setState({ panel: "tool" });
});

/** The selected track, if it still exists (undo may have removed it). */
export function selectedTrack(): Track | null {
  const { trackId } = useLayers.getState();
  return useEditor.getState().film?.tracks.find((t) => t.id === trackId) ?? null;
}

/** The one selected picture, if exactly one is selected. */
export function selectedClipId(): ClipId | null {
  const { selection, film } = useEditor.getState();
  return selection.length === 1 && film?.clips[selection[0]!] ? selection[0]! : null;
}

/** Changes a track as one history step. */
export function updateTrack(trackId: TrackId, patch: Partial<Track>) {
  useEditor.getState().commit([{ type: "track.update", trackId, patch }]);
}

/** Commits a dragged transform as one history step. */
export function commitTransform(target: HandleTarget, transform: Transform2D) {
  if (target.kind === "rig") useCamera.getState().setShot(target.id, { transform });
  else if (target.kind === "track") updateTrack(target.id, { transform });
  else useEditor.getState().commit([{ type: "clip.update", id: target.id, patch: { transform } }]);
}

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
