import { type GuideSettings, type Point, guideSegments, vanishingPoints } from "@gepetta/core";
import type { Size } from "./frame";

/** Radius of a vanishing-point handle, in CSS pixels. */
export const HANDLE_RADIUS = 9;

/**
 * Draws the guides in film coordinates. `px` is one CSS pixel in film units,
 * so lines keep their width at any zoom. With `editing`, rays start at their
 * vanishing points and the points get draggable handles.
 */
export function drawGuides(ctx: CanvasRenderingContext2D, g: GuideSettings, film: Size, px: number, editing: boolean) {
  const segments = guideSegments(g, film, { fromVanishingPoints: editing });
  ctx.save();
  ctx.strokeStyle = g.color;
  ctx.lineCap = "round";
  for (const weight of ["soft", "strong"] as const) {
    ctx.globalAlpha = g.opacity * (weight === "soft" ? 0.55 : 1);
    ctx.lineWidth = (weight === "soft" ? 1 : 1.5) * px;
    ctx.beginPath();
    for (const s of segments) {
      if (s.weight !== weight) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
  }

  if (editing && g.perspective.points > 0) {
    const { width: w, height: h } = film;
    const y = g.perspective.horizon * h;
    // The horizon continues outside the picture so it reaches the points beside it.
    ctx.globalAlpha = g.opacity * 0.5;
    ctx.setLineDash([6 * px, 6 * px]);
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(-w * 3, y);
    ctx.lineTo(w * 4, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.font = `bold ${11 * px}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    vanishingPoints(g.perspective).forEach((p, i) => {
      const x = p.x * w;
      const yy = p.y * h;
      ctx.beginPath();
      ctx.arc(x, yy, HANDLE_RADIUS * px, 0, Math.PI * 2);
      ctx.fillStyle = g.color;
      ctx.fill();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = "#1b1916";
      ctx.stroke();
      ctx.fillStyle = "#1b1916";
      ctx.fillText(String(i + 1), x, yy + 0.5 * px);
    });
  }
  ctx.restore();
}

/** Vanishing point under a film-coordinate position, if any (index into vanishingPoints). */
export function hitVanishingPoint(g: GuideSettings, film: Size, at: Point, px: number): number | null {
  const points = vanishingPoints(g.perspective);
  let best: number | null = null;
  let bestDist = (HANDLE_RADIUS + 6) * px;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x * film.width - at.x, p.y * film.height - at.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
