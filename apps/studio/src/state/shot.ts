import type { Clip, ClipId, ClipPatch, Look, Op, Transform2D } from "@gepetta/core";
import { create } from "zustand";
import { useEditor } from "./editor";

/** What a picture's settings are: where it goes, how see-through, and its look. */
export interface ShotValue {
  transform: Transform2D;
  opacity: number;
  look: Look;
}

/** Only what was changed, so editing many pictures at once keeps the rest of each one. */
export interface ShotChange {
  transform?: Partial<Transform2D>;
  opacity?: number;
  look?: Partial<Look>;
}

export function applyChange(base: ShotValue, change: ShotChange): ShotValue {
  const look = { ...base.look, ...change.look };
  for (const k of Object.keys(look) as (keyof Look)[]) if (look[k] === undefined) delete look[k];
  return {
    transform: { ...base.transform, ...change.transform },
    opacity: change.opacity ?? base.opacity,
    look,
  };
}

/** A picture's settings as a ShotValue. */
export function shotOf(clip: Clip): ShotValue {
  return { transform: clip.transform, opacity: clip.opacity, look: clip.look ?? {} };
}

/** The patch that applies a change to a picture: only what changed, kept as a whole field. */
export function patchFor(clip: Clip, change: ShotChange): ClipPatch {
  const next = applyChange(shotOf(clip), change);
  const patch: ClipPatch = {};
  if (change.transform && Object.keys(change.transform).length) patch.transform = next.transform;
  if (change.opacity !== undefined) patch.opacity = next.opacity;
  if (change.look && Object.keys(change.look).length) patch.look = next.look;
  return patch;
}

/** Settings being changed on pictures, shown on the stage before they are kept. */
export const useShotPreview = create<{ preview: { ids: ClipId[]; change: ShotChange } | null }>(() => ({ preview: null }));

/** The film with the settings being changed applied, for showing. */
export function withShotPreview<F extends { clips: Record<ClipId, Clip> }>(film: F): F {
  const { preview } = useShotPreview.getState();
  if (!preview) return film;
  const clips = { ...film.clips };
  for (const id of preview.ids) {
    const c = clips[id];
    if (c) clips[id] = { ...c, ...patchFor(c, preview.change) };
  }
  return { ...film, clips };
}

/** Keeps a change on pictures, as one history step. */
export function commitShot(ids: ClipId[], change: ShotChange) {
  useShotPreview.setState({ preview: null });
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const ops: Op[] = [];
  for (const id of ids) {
    const c = film.clips[id];
    if (!c) continue;
    const patch = patchFor(c, change);
    if (Object.keys(patch).length) ops.push({ type: "clip.update", id, patch });
  }
  if (ops.length) commit(ops, ids.length > 1 ? `Ajustes de ${ids.length} imágenes` : undefined);
}

