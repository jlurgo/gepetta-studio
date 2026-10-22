/**
 * Composition guides drawn over the stage: rule of thirds, grid, center,
 * safe areas and 1/2/3-point perspective. Pure geometry in film pixels;
 * drawing is up to the UI.
 *
 * Positions are normalized to the film (0..1 inside the picture). Vanishing
 * points may sit far outside it, as they usually do in two-point perspective.
 */

export interface Point {
  x: number;
  y: number;
}

export type PerspectivePoints = 0 | 1 | 2 | 3;

export interface PerspectiveGuide {
  points: PerspectivePoints;
  /** Height of the horizon, where the first two vanishing points sit. */
  horizon: number;
  /** x of the first vanishing point (the only one in one-point perspective). */
  a: number;
  /** x of the second vanishing point. */
  b: number;
  /** Third vanishing point (above or below, for looking up or down). */
  c: Point;
  /** Lines drawn from each vanishing point. */
  rays: number;
}

export interface GuideSettings {
  visible: boolean;
  thirds: boolean;
  center: boolean;
  /** Action-safe (90 %) and title-safe (80 %) frames. */
  safe: boolean;
  grid: { enabled: boolean; cols: number; rows: number };
  perspective: PerspectiveGuide;
  color: string;
  opacity: number;
}

export const DEFAULT_GUIDES: GuideSettings = {
  visible: false,
  thirds: true,
  center: false,
  safe: false,
  grid: { enabled: false, cols: 8, rows: 6 },
  perspective: { points: 0, horizon: 0.45, a: 0.5, b: 1.6, c: { x: 0.5, y: -1.2 }, rays: 16 },
  color: "#5cc8b5",
  opacity: 0.7,
};

/** "strong": thirds, center, horizon. "soft": grid, rays, safe areas. */
export interface GuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: "strong" | "soft";
}

export interface GuideOptions {
  /** Rays start at their vanishing point instead of at the picture's edge (to place the points). */
  fromVanishingPoints?: boolean;
}

/** Vanishing points in use, in normalized film coordinates. */
export function vanishingPoints(p: PerspectiveGuide): Point[] {
  const points: Point[] = [];
  if (p.points >= 1) points.push({ x: p.a, y: p.horizon });
  if (p.points >= 2) points.push({ x: p.b, y: p.horizon });
  if (p.points >= 3) points.push(p.c);
  return points;
}

/** Moves vanishing point `index` (0, 1 or 2): the first two stay on one horizon. */
export function moveVanishingPoint(p: PerspectiveGuide, index: number, to: Point): PerspectiveGuide {
  if (index === 0) return { ...p, a: to.x, horizon: to.y };
  if (index === 1) return { ...p, b: to.x, horizon: to.y };
  return { ...p, c: to };
}

export function guideSegments(
  g: GuideSettings,
  size: { width: number; height: number },
  options: GuideOptions = {},
): GuideSegment[] {
  const { width: w, height: h } = size;
  const out: GuideSegment[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, weight: GuideSegment["weight"]) =>
    out.push({ x1, y1, x2, y2, weight });
  const rect = (inset: number) => {
    const dx = w * inset;
    const dy = h * inset;
    line(dx, dy, w - dx, dy, "soft");
    line(w - dx, dy, w - dx, h - dy, "soft");
    line(w - dx, h - dy, dx, h - dy, "soft");
    line(dx, h - dy, dx, dy, "soft");
  };

  if (g.grid.enabled) {
    for (let i = 1; i < g.grid.cols; i++) line((w * i) / g.grid.cols, 0, (w * i) / g.grid.cols, h, "soft");
    for (let i = 1; i < g.grid.rows; i++) line(0, (h * i) / g.grid.rows, w, (h * i) / g.grid.rows, "soft");
  }
  if (g.safe) {
    rect(0.05);
    rect(0.1);
  }
  if (g.thirds) {
    for (const f of [1 / 3, 2 / 3]) {
      line(w * f, 0, w * f, h, "strong");
      line(0, h * f, w, h * f, "strong");
    }
  }
  if (g.center) {
    const arm = Math.min(w, h) * 0.04;
    line(w / 2 - arm, h / 2, w / 2 + arm, h / 2, "strong");
    line(w / 2, h / 2 - arm, w / 2, h / 2 + arm, "strong");
  }

  const p = g.perspective;
  if (p.points > 0) {
    const y = p.horizon * h;
    if (y >= 0 && y <= h) line(0, y, w, y, "strong");
    for (const vp of vanishingPoints(p)) {
      for (const s of raysFrom({ x: vp.x * w, y: vp.y * h }, p.rays, w, h, options.fromVanishingPoints ?? false)) {
        out.push(s);
      }
    }
  }
  return out;
}

/** `count` rays from `o` spread evenly over the directions that cross the picture, clipped to it. */
function raysFrom(o: Point, count: number, w: number, h: number, fromOrigin: boolean): GuideSegment[] {
  const inside = o.x >= 0 && o.x <= w && o.y >= 0 && o.y <= h;
  let start: number;
  let span: number;
  if (inside) {
    start = 0;
    span = 2 * Math.PI;
  } else {
    // The corners' directions, seen from outside, fit in less than half a turn:
    // the arc that covers them is the circle minus its largest gap.
    const angles = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]
      .map(([x, y]) => Math.atan2(y! - o.y, x! - o.x))
      .sort((m, n) => m - n);
    let gapEnd = 0;
    let gap = -1;
    for (let i = 0; i < angles.length; i++) {
      const from = angles[i]!;
      const to = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
      if (to - from > gap) {
        gap = to - from;
        gapEnd = i + 1 < angles.length ? i + 1 : 0;
      }
    }
    start = angles[gapEnd]!;
    span = 2 * Math.PI - gap;
  }

  const out: GuideSegment[] = [];
  // Centered in equal slices: the arc's ends only graze a corner.
  for (let i = 0; i < count; i++) {
    const angle = start + (span * (i + (inside ? 0 : 0.5))) / count;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const hit = clipRay(o, dx, dy, w, h);
    if (!hit) continue;
    const t0 = fromOrigin ? 0 : hit[0];
    out.push({ x1: o.x + dx * t0, y1: o.y + dy * t0, x2: o.x + dx * hit[1], y2: o.y + dy * hit[1], weight: "soft" });
  }
  return out;
}

/** Liang–Barsky: the [t0, t1] part of the ray o + t·d (t ≥ 0) inside the picture, or null. */
function clipRay(o: Point, dx: number, dy: number, w: number, h: number): [number, number] | null {
  let t0 = 0;
  let t1 = Number.POSITIVE_INFINITY;
  const edges: [number, number][] = [
    [-dx, o.x],
    [dx, w - o.x],
    [-dy, o.y],
    [dy, h - o.y],
  ];
  for (const [pq, q] of edges) {
    if (Math.abs(pq) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / pq;
    if (pq < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t0 < t1 && Number.isFinite(t1) ? [t0, t1] : null;
}
