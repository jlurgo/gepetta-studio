import type { Clip, ClipId, Op, Track, TrackId, Transform2D } from "@gepetta/core";
import { create } from "zustand";
import { useCamera } from "./camera";
import { useEditor } from "./editor";
import { usePaint } from "./paint";

/**
 * What the stage handles move: a whole track, one picture, a camera's live
 * picture (its shot settings), or a whole sequence (through its picture `ref`).
 */
export type HandleTarget =
  | { kind: "track"; id: TrackId }
  | { kind: "clip"; id: ClipId }
  | { kind: "rig"; id: string }
  | { kind: "sequence"; id: string; ref: ClipId };

interface LayersState {
  /** Track picked in the timeline (by its name, or as the track of the picture shown). */
  trackId: TrackId | null;
  /**
   * What the detail panel shows: the cell at the cursor (picked in a track's
   * row), the picture picked (an object in a cell, or several pictures), a
   * track, or a sequence.
   */
  detail: "cell" | "clip" | "track" | "sequence";
  /** The sequence shown, and whether the handles move all of it or just the picture at the cursor. */
  seq: string | null;
  seqHandles: "all" | "one";
  /** What the detail panel shows: the tool in use, or what is selected (picture, pictures, track). */
  panel: "tool" | "detail";
  /** Transform shown while a handle is dragged; committed to the history on release. */
  preview: { target: HandleTarget; transform: Transform2D } | null;
  /** Shows a track's settings. */
  select(trackId: TrackId | null): void;
  /** Shows the cell at the cursor (picked in its track's row). */
  showCell(trackId: TrackId): void;
  /** Shows the selected picture's settings (its track is remembered to go there). */
  showClip(trackId: TrackId): void;
  setPreview(preview: LayersState["preview"]): void;
  /** Shows a sequence's settings. */
  showSequence(seq: string): void;
}

export const useLayers = create<LayersState>((set) => ({
  trackId: null,
  detail: "track",
  seq: null,
  seqHandles: "all",
  panel: "tool",
  preview: null,
  select: (trackId) => set({ trackId, detail: "track", preview: null, panel: trackId ? "detail" : "tool" }),
  // With the lasso, going from cell to cell (to draw its outline on several pictures) keeps its panel.
  showCell: (trackId) => set({ trackId, detail: "cell", preview: null, panel: usePaint.getState().tool === "lasso" ? "tool" : "detail" }),
  showClip: (trackId) => set({ trackId, detail: "clip", preview: null, panel: "detail" }),
  setPreview: (preview) => set({ preview }),
  showSequence: (seq) => set({ seq, detail: "sequence", preview: null, panel: "detail" }),
}));

/** A sequence's pictures moved as the handles move `ref` to `transform`: the same move, turn and scaling for each. */
export function sequenceMoved(clips: Record<ClipId, Clip>, seq: string, ref: ClipId, transform: Transform2D): Record<ClipId, Clip> {
  const r = clips[ref];
  if (!r) return clips;
  const t0 = r.transform;
  const dx = transform.x - t0.x;
  const dy = transform.y - t0.y;
  const k = transform.scale / (t0.scale || 1);
  const dr = transform.rotation - t0.rotation;
  const out = { ...clips };
  for (const c of Object.values(clips)) {
    if (c.seq !== seq) continue;
    const t = c.transform;
    out[c.id] = { ...c, transform: { x: t.x + dx, y: t.y + dy, scale: t.scale * k, rotation: t.rotation + dr } };
  }
  return out;
}

// Picking several pictures shows them (their settings change together).
useEditor.subscribe((state, prev) => {
  if (state.selection === prev.selection || state.selection.join() === prev.selection.join()) return;
  // The lasso keeps its panel while pictures are picked (see showCell).
  if (usePaint.getState().tool === "lasso") return;
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
  if (target.kind === "sequence") {
    const film = useEditor.getState().film;
    if (!film) return;
    const moved = sequenceMoved(film.clips, target.id, target.ref, transform);
    const ops: Op[] = Object.values(moved)
      .filter((c) => c.seq === target.id)
      .map((c) => ({ type: "clip.update", id: c.id, patch: { transform: c.transform } }));
    useEditor.getState().commit(ops, "Mover la secuencia");
  } else if (target.kind === "rig") useCamera.getState().setShot(target.id, { transform });
  else if (target.kind === "track") updateTrack(target.id, { transform });
  else useEditor.getState().commit([{ type: "clip.update", id: target.id, patch: { transform } }]);
}

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
