import type { MediaRef, Point, Transform2D } from "@gepetta/core";
import { type Size, containScale } from "./frame";

/**
 * Move / scale / rotate handles for one layer, in film coordinates. A layer
 * is its picture fitted inside the film, then moved, rotated and scaled about
 * the film's center (see drawStack).
 */

export type HandleKind = "move" | "scale" | "rotate";

/** Corner handle size and rotation-knob distance, in CSS pixels. */
const CORNER = 7;
const KNOB_GAP = 28;

/** The four corners of the drawn picture, clockwise from top-left. */
export function layerCorners(media: MediaRef, t: Transform2D, film: Size): Point[] {
  const s = containScale(media, film);
  const hw = (media.width * s) / 2;
  const hh = (media.height * s) / 2;
  const cos = Math.cos(t.rotation) * t.scale;
  const sin = Math.sin(t.rotation) * t.scale;
  const cx = film.width / 2 + t.x;
  const cy = film.height / 2 + t.y;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: cx + x! * cos - y! * sin, y: cy + x! * sin + y! * cos }));
}

/** Rotation knob: above the middle of the top edge, at a fixed screen distance. */
function knob(corners: Point[], px: number): Point {
  const [a, b, , d] = corners as [Point, Point, Point, Point];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const up = { x: a.x - d.x, y: a.y - d.y };
  const len = Math.hypot(up.x, up.y) || 1;
  return { x: mid.x + (up.x / len) * KNOB_GAP * px, y: mid.y + (up.y / len) * KNOB_GAP * px };
}

export function drawHandles(ctx: CanvasRenderingContext2D, media: MediaRef, t: Transform2D, film: Size, px: number) {
  const corners = layerCorners(media, t, film);
  const k = knob(corners, px);
  const [a, b] = corners as [Point, Point];
  ctx.save();
  ctx.strokeStyle = "#ff7a45";
  ctx.fillStyle = "#1b1916";
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([6 * px, 4 * px]);
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
  ctx.lineTo(k.x, k.y);
  ctx.stroke();
  for (const p of corners) {
    ctx.fillRect(p.x - CORNER * px, p.y - CORNER * px, CORNER * 2 * px, CORNER * 2 * px);
    ctx.strokeRect(p.x - CORNER * px, p.y - CORNER * px, CORNER * 2 * px, CORNER * 2 * px);
  }
  ctx.beginPath();
  ctx.arc(k.x, k.y, CORNER * px, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Which handle (if any) is under `p`. Handles win over the body. */
export function hitHandle(media: MediaRef, t: Transform2D, film: Size, p: Point, px: number): HandleKind | null {
  const corners = layerCorners(media, t, film);
  const reach = (CORNER + 5) * px;
  const k = knob(corners, px);
  if (Math.hypot(p.x - k.x, p.y - k.y) <= reach) return "rotate";
  if (corners.some((c) => Math.hypot(p.x - c.x, p.y - c.y) <= reach)) return "scale";
  return insidePolygon(p, corners) ? "move" : null;
}

/** New transform for dragging handle `kind` from `start` to `now` (film coordinates). */
export function dragTransform(kind: HandleKind, t0: Transform2D, film: Size, start: Point, now: Point, snap: boolean): Transform2D {
  const center = { x: film.width / 2 + t0.x, y: film.height / 2 + t0.y };
  if (kind === "move") return { ...t0, x: t0.x + now.x - start.x, y: t0.y + now.y - start.y };
  if (kind === "scale") {
    const d0 = Math.hypot(start.x - center.x, start.y - center.y) || 1;
    const d1 = Math.hypot(now.x - center.x, now.y - center.y);
    const scale = Math.max(0.02, t0.scale * (d1 / d0));
    return { ...t0, scale: snap ? Math.round(scale * 20) / 20 : scale };
  }
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(now.y - center.y, now.x - center.x);
  let rotation = t0.rotation + a1 - a0;
  if (snap) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
  return { ...t0, rotation };
}
