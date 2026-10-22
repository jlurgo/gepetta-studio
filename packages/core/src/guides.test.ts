import { describe, expect, it } from "vitest";
import { DEFAULT_GUIDES, type GuideSettings, guideSegments, moveVanishingPoint, vanishingPoints } from "./guides";

const SIZE = { width: 1600, height: 900 };

function settings(patch: Partial<GuideSettings>): GuideSettings {
  return { ...DEFAULT_GUIDES, visible: true, thirds: false, ...patch };
}

const inside = (s: { x1: number; y1: number; x2: number; y2: number }) =>
  [s.x1, s.x2].every((x) => x >= -1e-6 && x <= SIZE.width + 1e-6) &&
  [s.y1, s.y2].every((y) => y >= -1e-6 && y <= SIZE.height + 1e-6);

describe("guideSegments", () => {
  it("draws the rule of thirds", () => {
    const segs = guideSegments(settings({ thirds: true }), SIZE);
    expect(segs).toHaveLength(4);
    expect(segs.map((s) => Math.round(s.x1))).toContain(533);
    expect(segs.map((s) => Math.round(s.y1))).toContain(600);
  });

  it("draws cols-1 + rows-1 grid lines", () => {
    const segs = guideSegments(settings({ grid: { enabled: true, cols: 4, rows: 3 } }), SIZE);
    expect(segs).toHaveLength(3 + 2);
  });

  it("spreads one-point rays all around a point inside the picture, clipped to it", () => {
    const perspective = { ...DEFAULT_GUIDES.perspective, points: 1 as const, a: 0.5, horizon: 0.5, rays: 12 };
    const segs = guideSegments(settings({ perspective }), SIZE).filter((s) => s.weight === "soft");
    expect(segs).toHaveLength(12);
    expect(segs.every(inside)).toBe(true);
    // Every ray starts at the vanishing point (it is inside the picture).
    expect(segs.every((s) => Math.hypot(s.x1 - 800, s.y1 - 450) < 1e-6)).toBe(true);
  });

  it("aims rays from an outside point only at the picture, spread from corner to corner", () => {
    const perspective = { ...DEFAULT_GUIDES.perspective, points: 2 as const, a: -0.5, b: 1.5, horizon: 0.4, rays: 9 };
    const segs = guideSegments(settings({ perspective }), SIZE).filter((s) => s.weight === "soft");
    expect(segs).toHaveLength(18);
    expect(segs.every(inside)).toBe(true);
    // From the left point, the extreme rays enter near the top-left and bottom-left corners.
    const left = segs.slice(0, 9);
    const near = (x: number, y: number) => left.some((s) => Math.hypot(s.x1 - x, s.y1 - y) < 80);
    expect(near(0, 0)).toBe(true);
    expect(near(0, 900)).toBe(true);
  });

  it("can start rays at the vanishing point, for placing it", () => {
    const perspective = { ...DEFAULT_GUIDES.perspective, points: 1 as const, a: -0.5, horizon: 0.5, rays: 5 };
    const segs = guideSegments(settings({ perspective }), SIZE, { fromVanishingPoints: true }).filter((s) => s.weight === "soft");
    expect(segs.every((s) => Math.hypot(s.x1 + 800, s.y1 - 450) < 1e-6)).toBe(true);
  });

  it("handles a point straight above the picture (three-point)", () => {
    const perspective = { ...DEFAULT_GUIDES.perspective, points: 3 as const, c: { x: 0.5, y: -2 }, rays: 7 };
    const segs = guideSegments(settings({ perspective }), SIZE).filter((s) => s.weight === "soft");
    expect(segs.length).toBe(21);
    expect(segs.every(inside)).toBe(true);
  });
});

describe("vanishing points", () => {
  it("keeps the first two on one horizon", () => {
    const p = { ...DEFAULT_GUIDES.perspective, points: 2 as const };
    const moved = moveVanishingPoint(p, 0, { x: -0.2, y: 0.3 });
    expect(vanishingPoints(moved)).toEqual([
      { x: -0.2, y: 0.3 },
      { x: p.b, y: 0.3 },
    ]);
  });
});
