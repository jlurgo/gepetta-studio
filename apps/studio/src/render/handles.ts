import type { Point, Transform2D } from "@gepetta/core";
import type { Size } from "./frame";

/**
 * Handles of one layer on the stage, in film coordinates: drag the body to
 * move it, a corner to scale it, the knob to turn it, and (for a picture) the
 * middle of a side to crop it there. `corners` are the shown part of the
 * picture, clockwise from its own top-left (see pictureMatrix and the crop).
 */

export type CropSide = "top" | "right" | "bottom" | "left";
export type HandleKind = "move" | "scale" | "rotate" | `crop-${CropSide}`;

/** Corner handle size and rotation-knob distance, in CSS pixels. */
const CORNER = 7;
const KNOB_GAP = 28;

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Each side's middle, where it is cropped: top, right, bottom, left. */
function sides(corners: Point[]): [CropSide, Point][] {
  const [a, b, c, d] = corners as [Point, Point, Point, Point];
  return [
    ["top", mid(a, b)],
    ["right", mid(b, c)],
    ["bottom", mid(c, d)],
    ["left", mid(d, a)],
  ];
}

/** Rotation knob: beyond the middle of the top side, at a fixed screen distance. */
function knob(corners: Point[], px: number): Point {
  const [a, b, , d] = corners as [Point, Point, Point, Point];
  const m = mid(a, b);
  const up = { x: a.x - d.x, y: a.y - d.y };
  const len = Math.hypot(up.x, up.y) || 1;
  return { x: m.x + (up.x / len) * KNOB_GAP * px, y: m.y + (up.y / len) * KNOB_GAP * px };
}

export function drawHandles(ctx: CanvasRenderingContext2D, corners: Point[], px: number, crop: boolean) {
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
  if (crop) {
    // Crop handles: a bar along each side.
    for (const [side, p] of sides(corners)) {
      const [from, to] = side === "top" ? [corners[0]!, corners[1]!] : side === "right" ? [corners[1]!, corners[2]!] : side === "bottom" ? [corners[2]!, corners[3]!] : [corners[3]!, corners[0]!];
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const ux = (to.x - from.x) / len;
      const uy = (to.y - from.y) / len;
      const half = 12 * px;
      ctx.lineWidth = 5 * px;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#1b1916";
      ctx.beginPath();
      ctx.moveTo(p.x - ux * half, p.y - uy * half);
      ctx.lineTo(p.x + ux * half, p.y + uy * half);
      ctx.stroke();
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = "#ff7a45";
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(k.x, k.y, CORNER * px, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = "#ff7a45";
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
export function hitHandle(corners: Point[], p: Point, px: number, crop: boolean): HandleKind | null {
  const reach = (CORNER + 5) * px;
  const k = knob(corners, px);
  if (Math.hypot(p.x - k.x, p.y - k.y) <= reach) return "rotate";
  if (corners.some((c) => Math.hypot(p.x - c.x, p.y - c.y) <= reach)) return "scale";
  if (crop) for (const [side, m] of sides(corners)) if (Math.hypot(p.x - m.x, p.y - m.y) <= reach + 4 * px) return `crop-${side}`;
  return insidePolygon(p, corners) ? "move" : null;
}

/** New transform for dragging a move, scale or rotate handle from `start` to `now` (film coordinates). */
export function dragTransform(kind: HandleKind, t0: Transform2D, film: Size, start: Point, now: Point, snap: boolean): Transform2D {
  const center = { x: film.width / 2 + t0.x, y: film.height / 2 + t0.y };
  if (kind === "move") return { ...t0, x: t0.x + now.x - start.x, y: t0.y + now.y - start.y };
  if (kind === "scale") {
    const d0 = Math.hypot(start.x - center.x, start.y - center.y) || 1;
    const d1 = Math.hypot(now.x - center.x, now.y - center.y);
    const scale = Math.max(0.02, t0.scale * (d1 / d0));
    return { ...t0, scale: snap ? Math.round(scale * 20) / 20 : scale };
  }
  if (kind !== "rotate") return t0;
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(now.y - center.y, now.x - center.x);
  let rotation = t0.rotation + a1 - a0;
  if (snap) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
  return { ...t0, rotation };
}

/**
 * New crop for dragging a side to `q`, a point in the picture's own pixels
 * (`size`): that side goes there, never past the other one.
 */
export function dragCrop(side: CropSide, crop: { x: number; y: number; width: number; height: number }, q: Point, size: Size) {
  const fx = Math.min(1, Math.max(0, q.x / size.width));
  const fy = Math.min(1, Math.max(0, q.y / size.height));
  const min = 0.05;
  let { x, y, width, height } = crop;
  if (side === "left") {
    const nx = Math.min(fx, x + width - min);
    width += x - nx;
    x = nx;
  } else if (side === "right") width = Math.max(min, fx - x);
  else if (side === "top") {
    const ny = Math.min(fy, y + height - min);
    height += y - ny;
    y = ny;
  } else height = Math.max(min, fy - y);
  return { x, y, width, height };
}
