import type { Clip, FilmState, Mask } from "./model";
import type { Op } from "./ops";

/** Points of every outline (see Mask). */
export const MASK_POINTS = 48;

type Pt = [number, number];

const round = (v: number) => Math.round(v * 10000) / 10000;

/** A closed outline taken to `n` points evenly spaced along it. */
export function resampleOutline(points: readonly Pt[], n = MASK_POINTS): Pt[] {
  const pts = points.length ? points : [[0, 0] as Pt];
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d);
    total += d;
  }
  if (!total) return Array.from({ length: n }, () => [pts[0]![0], pts[0]![1]] as Pt);
  const out: Pt[] = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const at = (k / n) * total;
    while (walked + seg[i]! < at && i < pts.length - 1) walked += seg[i++]!;
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const t = seg[i] ? (at - walked) / seg[i]! : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function centroid(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/**
 * An outline as masks keep it: MASK_POINTS points, clockwise on screen (y
 * down), starting from the one straight above its middle — so two outlines
 * of the same thing line up point by point.
 */
export function normalizeOutline(points: readonly Pt[]): Pt[] {
  let pts = resampleOutline(points);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) pts = pts.reverse();
  const [cx, cy] = centroid(pts);
  let start = 0;
  let best = Infinity;
  pts.forEach(([x, y], i) => {
    // Angle from straight up, going clockwise.
    const off = Math.abs(Math.atan2(x - cx, cy - y));
    if (off < best) {
      best = off;
      start = i;
    }
  });
  return [...pts.slice(start), ...pts.slice(0, start)].map(([x, y]) => [round(x), round(y)]);
}

/** A rectangle as an outline, from two opposite corners. */
export function rectOutline(a: Pt, b: Pt): Pt[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return normalizeOutline([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
}

/** The outline part way (`t`, 0–1) from `a` to `b`. */
export function blendOutlines(a: readonly Pt[], b: readonly Pt[], t: number): Pt[] {
  return a.map(([x, y], i) => {
    const q = b[i] ?? [x, y];
    return [round(x + (q[0] - x) * t), round(y + (q[1] - y) * t)];
  });
}

/** Whether a point is inside an outline. */
export function insideOutline(p: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Ops that give every picture of a sequence an outline from the ones drawn
 * by hand (key): blended between two of them, the same as the nearest one
 * before the first or after the last. Nothing when none has one.
 */
export function blendSequenceMasksOps(film: FilmState, seq: string): Op[] {
  const clips = Object.values(film.clips)
    .filter((c) => c.seq === seq)
    .sort((a, b) => a.start - b.start || a.track.localeCompare(b.track));
  const keys = clips.map((c, i) => [i, c] as const).filter(([, c]) => c.look?.mask?.key);
  if (!keys.length) return [];
  const ops: Op[] = [];
  clips.forEach((c, i) => {
    if (c.look?.mask?.key) return;
    const after = keys.find(([k]) => k > i);
    const before = [...keys].reverse().find(([k]) => k < i);
    let mask: Mask;
    if (before && after) {
      const [ka, a] = before;
      const [kb, b] = after;
      const ma = a.look!.mask!;
      const mb = b.look!.mask!;
      const t = (i - ka) / (kb - ka);
      mask = { ...ma, points: blendOutlines(ma.points, mb.points, t), feather: ma.feather, key: undefined };
    } else {
      const near = (before ?? after)![1].look!.mask!;
      mask = { ...near, key: undefined };
    }
    delete mask.key;
    ops.push({ type: "clip.update", id: c.id, patch: { look: { ...c.look, mask } } });
  });
  return ops;
}

/** A sequence's pictures without their outlines. */
export function clearSequenceMasksOps(clips: readonly Clip[]): Op[] {
  return clips
    .filter((c) => c.look?.mask)
    .map((c) => {
      const look = { ...c.look };
      delete look.mask;
      return { type: "clip.update", id: c.id, patch: { look } } as Op;
    });
}
