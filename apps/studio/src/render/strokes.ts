import type { AssetId, Stroke, StrokeTool } from "@gepetta/core";

/**
 * Drawing strokes, shared by the painting tools (drawn as the pointer moves)
 * and by every place that shows a picture with its strokes (drawn again from
 * what was kept). Points are in the picture's own pixels; the context's
 * transform takes them to the canvas.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type StrokePoint = [x: number, y: number, w: number, p: number];

/** Airbrush: soft round dabs instead of a hard line. */
export function isSoft(stroke: Pick<Stroke, "tool" | "brush">): boolean {
  return stroke.tool === "draw" && stroke.brush === "airbrush";
}

/** How a stroke's layer goes on the picture: erasing cuts it, tinting only colors what is there. */
export function strokeOperation(tool: StrokeTool): GlobalCompositeOperation {
  return tool === "erase" ? "destination-out" : tool === "tint" ? "source-atop" : "source-over";
}

/** A soft round dab (airbrush), denser with more pen pressure. */
function softDab(ctx: Ctx, color: string, [x, y, w, p]: StrokePoint) {
  const r = Math.max(1, w / 2);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, `${color}00`);
  ctx.globalAlpha = 0.12 * p;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Points between two, close enough for dabs to make a continuous line. */
export function* along(a: StrokePoint, b: StrokePoint, spacing: number): Generator<StrokePoint> {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(0.5, spacing)));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    yield [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
}

/**
 * Draws a line stroke from point `from` on (0: from its start, with the dot a
 * click alone leaves), at full strength.
 */
export function drawLine(ctx: Ctx, stroke: Pick<Stroke, "tool" | "brush" | "color">, points: readonly StrokePoint[], from = 0) {
  const color = stroke.color ?? "#000000";
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineCap = ctx.lineJoin = "round";
  const soft = isSoft(stroke);
  if (from === 0 && points[0]) {
    const p = points[0];
    if (soft) softDab(ctx, color, p);
    else {
      ctx.beginPath();
      ctx.arc(p[0], p[1], p[2] / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let i = Math.max(1, from); i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (soft) for (const q of along(a, b, Math.min(a[2], b[2]) / 8)) softDab(ctx, color, q);
    else {
      ctx.lineWidth = (a[2] + b[2]) / 2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A shape between its two corners. */
export function drawShape(ctx: Ctx, stroke: Pick<Stroke, "shape" | "filled" | "color">, points: readonly StrokePoint[]) {
  const a = points[0];
  const b = points[points.length - 1];
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = stroke.color ?? "#000000";
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = a[2];
  ctx.beginPath();
  if (stroke.shape === "box") ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  else if (stroke.shape === "ellipse") ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
  else {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  if (stroke.filled && stroke.shape !== "line") ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a whole stroke at full strength on a clear layer whose transform takes
 * picture pixels to the layer's. A fill or clone stroke is its kept image
 * (`layer`), stretched over its box of the picture; a fill takes its color again.
 */
export function drawStroke(ctx: Ctx, stroke: Stroke, picture: { width: number; height: number }, layer?: CanvasImageSource) {
  if (stroke.layer) {
    if (!layer) return;
    const b = stroke.box ?? { x: 0, y: 0, ...picture };
    ctx.drawImage(layer, b.x, b.y, b.width, b.height);
    if (stroke.tool === "fill" && stroke.color) {
      ctx.save();
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = stroke.color;
      ctx.fillRect(0, 0, picture.width, picture.height);
      ctx.restore();
    }
    return;
  }
  const points = stroke.points ?? [];
  if (stroke.tool === "shape") drawShape(ctx, stroke, points);
  else drawLine(ctx, stroke, points);
}

/** The kept images fill and clone strokes need. */
export function layerAssets(strokes: readonly Stroke[]): AssetId[] {
  return strokes.flatMap((s) => (s.layer && !s.hidden ? [s.layer] : []));
}

/**
 * Lays strokes on a canvas already showing the picture (`scale`: canvas pixels
 * per picture pixel). Each stroke is drawn alone first, then laid at its
 * strength, so a see-through marker stays even where it crosses itself.
 */
export function composeStrokes(
  canvas: OffscreenCanvas,
  strokes: readonly Stroke[],
  picture: { width: number; height: number },
  layers: (asset: AssetId) => CanvasImageSource | undefined,
) {
  const ctx = canvas.getContext("2d")!;
  const scratch = new OffscreenCanvas(canvas.width, canvas.height);
  const sctx = scratch.getContext("2d")!;
  const sx = canvas.width / picture.width;
  const sy = canvas.height / picture.height;
  for (const stroke of strokes) {
    if (stroke.hidden) continue;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.setTransform(sx, 0, 0, sy, 0, 0);
    drawStroke(sctx, stroke, picture, stroke.layer ? layers(stroke.layer) : undefined);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = stroke.strength;
    ctx.globalCompositeOperation = strokeOperation(stroke.tool);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }
}
