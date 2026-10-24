import { type Clip, type ClipId, type FilmState, type Op, type Stroke, type StrokePatch, composeTransforms, cropRect, insideOutline } from "@gepetta/core";
import { create } from "zustand";
import { proxyCache } from "../media/cache";
import { type Size, pictureMatrix } from "../render/frame";
import { storage } from "../storage";
import { useEditor } from "./editor";

/**
 * Strokes picked to change or remove them (Blender's edit mode): on the stage
 * with the move tool, or from a picture's list of strokes. They belong to the
 * one picture selected.
 */
export const useStrokes = create<{ clip: ClipId | null; ids: string[] }>(() => ({ clip: null, ids: [] }));

export function selectStrokes(clip: ClipId | null, ids: string[]) {
  useStrokes.setState({ clip, ids });
}

/** The picked strokes that still exist (undo may remove them). */
export function pickedStrokes(film: FilmState | null): { clip: Clip; strokes: Stroke[] } | null {
  const { clip: id, ids } = useStrokes.getState();
  const clip = id ? film?.clips[id] : undefined;
  if (!clip || !ids.length) return null;
  const strokes = (clip.strokes ?? []).filter((s) => ids.includes(s.id));
  return strokes.length ? { clip, strokes } : null;
}

// Picking other pictures leaves their strokes.
useEditor.subscribe((state, prev) => {
  if (state.selection === prev.selection) return;
  const { clip } = useStrokes.getState();
  if (clip && !(state.selection.length === 1 && state.selection[0] === clip)) selectStrokes(null, []);
});

/** Strokes being moved, scaled or turned on the stage, shown before they are kept. */
export const useStrokePreview = create<{ preview: { clip: ClipId; strokes: Stroke[] } | null }>(() => ({ preview: null }));

/** The film with the strokes being moved, for showing. */
export function withStrokePreview<F extends { clips: Record<ClipId, Clip> }>(film: F): F {
  const { preview } = useStrokePreview.getState();
  const clip = preview && film.clips[preview.clip];
  return clip ? { ...film, clips: { ...film.clips, [clip.id]: { ...clip, strokes: preview.strokes } } } : film;
}

/** Bounds of line and shape strokes, with their width, in picture pixels (null: none of them has points). */
export function strokesBounds(strokes: readonly Stroke[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let b: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const s of strokes) {
    for (const [x, y, w] of s.points ?? []) {
      const r = w / 2;
      b = b
        ? { x0: Math.min(b.x0, x - r), y0: Math.min(b.y0, y - r), x1: Math.max(b.x1, x + r), y1: Math.max(b.y1, y + r) }
        : { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
    }
  }
  return b;
}

/** The strokes `ids` with their points taken through `m` (picture pixels to picture pixels) and widths scaled. */
export function transformStrokes(strokes: readonly Stroke[], ids: readonly string[], m: DOMMatrix, widthScale: number): Stroke[] {
  const round = (v: number) => Math.round(v * 100) / 100;
  return strokes.map((s) => {
    if (!ids.includes(s.id) || !s.points) return s;
    return {
      ...s,
      points: s.points.map(([x, y, w, p]) => {
        const q = m.transformPoint(new DOMPoint(x, y));
        return [round(q.x), round(q.y), round(w * widthScale), p] as [number, number, number, number];
      }),
    };
  });
}

/** Changes strokes of a picture as one history step. */
export function updateStrokes(clip: ClipId, patches: { id: string; patch: StrokePatch }[], label?: string) {
  const ops: Op[] = patches.map(({ id, patch }) => ({ type: "stroke.update", clip, id, patch }));
  if (ops.length) useEditor.getState().commit(ops, label);
}

export function removeStrokes(clip: ClipId, ids: string[]) {
  if (!ids.length) return;
  useEditor.getState().commit([{ type: "stroke.remove", clip, ids }]);
  selectStrokes(null, []);
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a line or shape stroke passes within `reach` of a point (picture pixels). */
export function touchesStroke(stroke: Stroke, x: number, y: number, reach: number): boolean {
  const pts = stroke.points ?? [];
  if (!pts.length) return false;
  if (stroke.tool === "shape") {
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    const r = a[2] / 2 + reach;
    if (stroke.shape === "line") return distanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= r;
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    if (stroke.shape === "ellipse") {
      const rx = (x1 - x0) / 2 || 1;
      const ry = (y1 - y0) / 2 || 1;
      const d = Math.hypot((x - (x0 + rx)) / rx, (y - (y0 + ry)) / ry);
      return stroke.filled ? d <= 1 + r / Math.min(rx, ry) : Math.abs(d - 1) * Math.min(rx, ry) <= r;
    }
    const inside = x >= x0 - r && x <= x1 + r && y >= y0 - r && y <= y1 + r;
    if (stroke.filled) return inside;
    const nearEdge = Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1)) <= r;
    return inside && nearEdge;
  }
  if (pts.length === 1) return Math.hypot(x - pts[0]![0], y - pts[0]![1]) <= pts[0]![2] / 2 + reach;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (distanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= Math.max(a[2], b[2]) / 2 + reach) return true;
  }
  return false;
}

/** Whether a fill or clone stroke has paint at a point (its kept pixels). */
async function paintedAt(filmId: string, stroke: Stroke, picture: Size, x: number, y: number): Promise<boolean> {
  if (!stroke.layer) return false;
  const bmp = await createImageBitmap(await storage.getAsset(filmId, stroke.layer));
  const b = stroke.box ?? { x: 0, y: 0, ...picture };
  const px = Math.floor(((x - b.x) / b.width) * bmp.width);
  const py = Math.floor(((y - b.y) / b.height) * bmp.height);
  if (px < 0 || py < 0 || px >= bmp.width || py >= bmp.height) return false;
  const c = new OffscreenCanvas(1, 1);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, px, py, 1, 1, 0, 0, 1, 1);
  bmp.close();
  return ctx.getImageData(0, 0, 1, 1).data[3]! > 16;
}

/** Whether a picture's own image is painted (not see-through) at a point of its pixels, inside its crop and what its lasso keeps. */
async function pictureAt(filmId: string, clip: Clip, x: number, y: number): Promise<boolean> {
  const r = cropRect(clip.media, clip.look);
  if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) return false;
  // Cut out with the lasso: only what it keeps.
  const mask = clip.look?.mask;
  if (mask && insideOutline([x / clip.media.width, y / clip.media.height], mask.points) === !!mask.invert) return false;
  const bmp = await proxyCache.load(filmId, clip.media.proxy);
  const c = new OffscreenCanvas(1, 1);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, Math.floor((x / clip.media.width) * bmp.width), Math.floor((y / clip.media.height) * bmp.height), 1, 1, 0, 0, 1, 1);
  return ctx.getImageData(0, 0, 1, 1).data[3]! > 16;
}

/** Something on the stage that can be picked: a picture, or one of its strokes. */
export interface StageObject {
  clip: Clip;
  stroke?: Stroke;
}

/**
 * Everything under a film point at a cell, topmost first: each picture's
 * strokes there, then the picture itself (where it is not see-through, or
 * where one of its strokes is). `reach` is how near counts, in film pixels;
 * `onlyTrack` keeps to one track's cell.
 */
export async function objectsAt(film: FilmState, cell: number, p: { x: number; y: number }, reach: number, onlyTrack?: string): Promise<StageObject[]> {
  const { filmId } = useEditor.getState();
  if (!filmId) return [];
  const out: StageObject[] = [];
  for (const track of [...film.tracks].reverse()) {
    if (!track.visible || (onlyTrack && track.id !== onlyTrack)) continue;
    const clip = Object.values(film.clips).find((c) => c.track === track.id && c.visible && cell >= c.start && cell < c.start + c.length);
    if (!clip) continue;
    const transform = composeTransforms(track.transform, clip.transform);
    const m = pictureMatrix({ media: clip.media, transform, look: clip.look }, film.settings, clip.media);
    const q = m.inverse().transformPoint(new DOMPoint(p.x, p.y));
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    let touched = false;
    for (const stroke of [...(clip.strokes ?? [])].reverse()) {
      if (stroke.hidden || stroke.tool === "erase") continue;
      const hit = stroke.layer ? await paintedAt(filmId, stroke, clip.media, q.x, q.y) : touchesStroke(stroke, q.x, q.y, reach / scale);
      if (hit) {
        out.push({ clip, stroke });
        touched = true;
      }
    }
    if (touched || (await pictureAt(filmId, clip, q.x, q.y).catch(() => false))) out.push({ clip });
  }
  return out;
}

/** The topmost stroke under a film point at a cell, or null. */
export async function strokeAt(film: FilmState, cell: number, p: { x: number; y: number }, reach: number): Promise<{ clip: Clip; stroke: Stroke } | null> {
  const hit = (await objectsAt(film, cell, p, reach)).find((o) => o.stroke);
  return hit ? { clip: hit.clip, stroke: hit.stroke! } : null;
}

/** Strokes as shown in a picture's list: name of the tool used. */
export function strokeName(s: Stroke): string {
  switch (s.tool) {
    case "draw":
      return { pencil: "Lápiz", ink: "Tinta", marker: "Marcador", airbrush: "Aerógrafo" }[s.brush ?? "pencil"];
    case "erase":
      return "Goma";
    case "tint":
      return "Teñido";
    case "shape":
      return `${{ line: "Línea", box: "Rectángulo", ellipse: "Elipse" }[s.shape ?? "line"]}${s.filled ? " rellena" : ""}`;
    case "fill":
      return "Relleno";
    case "clone":
      return "Sello";
  }
}

import.meta.hot?.accept(() => location.reload());
