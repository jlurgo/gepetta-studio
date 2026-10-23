import { describe, expect, it } from "vitest";
import {
  type DiscOptions,
  PAGE_MARGIN,
  discOutline,
  discPictures,
  discSlitAngles,
  dxf,
  everyNth,
  fitDiscPicture,
  flipbookLayout,
  pageSize,
  polar,
  printableArea,
  slitEffect,
  svgPolygon,
  zoetropeLayout,
} from "./toys";

const A4 = pageSize("a4", "portrait");

describe("pages", () => {
  it("turns paper sideways", () => {
    expect(pageSize("letter", "landscape")).toEqual({ width: 279.4, height: 215.9 });
  });
  it("keeps the margins", () => {
    const a = printableArea(A4);
    expect(a.x).toBe(PAGE_MARGIN);
    expect(a.x + a.width).toBe(210 - PAGE_MARGIN);
    expect(a.y + a.height).toBe(297 - PAGE_MARGIN);
  });
  it("takes one of every n", () => {
    expect(everyNth([0, 1, 2, 3, 4], 2)).toEqual([0, 2, 4]);
    expect(everyNth([0, 1, 2], 1)).toEqual([0, 1, 2]);
  });
});

describe("flipbookLayout", () => {
  const base = { page: A4, frames: 20, pictureWidth: 70, aspect: 16 / 9, binding: 15, cover: true };

  it("packs leaves edge to edge inside the printable area", () => {
    const l = flipbookLayout(base);
    const area = printableArea(A4);
    expect(l.leafWidth).toBe(85);
    expect(l.cols).toBe(2);
    expect(l.rows).toBe(Math.floor(area.height / (70 / (16 / 9))));
    expect(l.grid.x).toBeGreaterThanOrEqual(area.x);
    expect(l.grid.x + l.grid.width).toBeLessThanOrEqual(area.x + area.width + 1e-9);
    expect(l.grid.y + l.grid.height).toBeLessThanOrEqual(area.y + area.height + 1e-9);
    const [a, b] = l.pages[0]!;
    expect(b!.leaf.x).toBeCloseTo(a!.leaf.x + l.leafWidth);
    expect(a!.picture.x).toBe(a!.leaf.x + 15);
  });

  it("puts the cover first and every picture once, in order", () => {
    const l = flipbookLayout(base);
    const order = l.pages.flat().map((x) => x.frame);
    expect(order[0]).toBe("cover");
    expect(order.slice(1)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(l.pages.length).toBe(Math.ceil(21 / l.perPage));
  });

  it("shrinks a picture too big for the page", () => {
    const l = flipbookLayout({ ...base, pictureWidth: 500 });
    expect(l.leafWidth).toBeLessThanOrEqual(printableArea(A4).width + 1e-9);
    expect(l.cols).toBe(1);
  });
});

describe("zoetropeLayout", () => {
  const base = { page: A4, frames: 12, diameter: 150, pictureHeight: 30, slitHeight: 25, slitWidth: 3, tab: 10 };

  it("makes the strip π·d long, split between pictures", () => {
    const l = zoetropeLayout(base);
    expect(l.circumference).toBeCloseTo(Math.PI * 150);
    expect(l.pitch).toBeCloseTo((Math.PI * 150) / 12);
    expect(l.pieces.reduce((s, p) => s + p.length, 0)).toBeCloseTo(Math.PI * 150);
    expect(l.pieces.reduce((s, p) => s + p.count, 0)).toBe(12);
    // 471 mm don't fit across 190 mm: three pieces of four pictures.
    expect(l.pieces.map((p) => p.count)).toEqual([4, 4, 4]);
    const area = printableArea(A4);
    for (const p of l.pieces) expect(p.length + base.tab).toBeLessThanOrEqual(area.width);
  });

  it("lays every piece of both strips and the base on pages, inside the area", () => {
    const l = zoetropeLayout(base);
    const items = l.pages.flat();
    expect(items.filter((i) => i.kind === "pictures")).toHaveLength(3);
    expect(items.filter((i) => i.kind === "wall")).toHaveLength(3);
    expect(items.filter((i) => i.kind === "base")).toHaveLength(1);
    expect(l.baseFits).toBe(true);
    const area = printableArea(A4);
    for (const i of items) {
      if (i.kind === "base") expect(i.cy + i.r).toBeLessThanOrEqual(area.y + area.height + 1e-9);
      else expect(i.y + i.height).toBeLessThanOrEqual(area.y + area.height + 1e-9);
    }
  });

  it("keeps a whole strip in one piece when it fits", () => {
    const l = zoetropeLayout({ ...base, page: pageSize("a4", "landscape"), diameter: 80 });
    expect(l.pieces).toHaveLength(1);
  });

  it("leaves the base out when it doesn't fit", () => {
    expect(zoetropeLayout({ ...base, diameter: 300 }).baseFits).toBe(false);
  });
});

describe("phenakistoscope", () => {
  const disc: DiscOptions = { frames: 12, slits: 12, diameter: 180, innerRadius: 30, outerRadius: 72, aspect: 4 / 3, slitWidth: 3, hole: 6 };

  it("fits each picture in its slice of the ring", () => {
    const fit = fitDiscPicture(12, 30, 72, 4 / 3);
    expect(fit.height).toBeGreaterThan(10);
    expect(fit.r0).toBeGreaterThanOrEqual(30);
    // Outer corners inside the ring, inner corners inside the slice.
    expect(Math.hypot(fit.r0 + fit.height, fit.width / 2)).toBeLessThanOrEqual(72 + 1e-6);
    expect(Math.atan2(fit.width / 2, fit.r0)).toBeLessThan(Math.PI / 12);
  });

  it("spreads pictures and slits evenly, slits between pictures", () => {
    const pics = discPictures(disc);
    expect(pics).toHaveLength(12);
    expect(pics[3]!.angle).toBeCloseTo(Math.PI / 2);
    const slits = discSlitAngles(13);
    expect(slits).toHaveLength(13);
    expect(slits[0]).toBeCloseTo(Math.PI / 13);
  });

  it("measures angles clockwise from 12 o'clock", () => {
    const [x, y] = polar(10, Math.PI / 2);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(0);
    expect(polar(10, 0)[1]).toBeCloseTo(-10);
  });

  it("cuts a slot into the rim for each slit", () => {
    const pts = discOutline(disc);
    const R = disc.diameter / 2;
    const r = pts.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...r)).toBeLessThanOrEqual(R + 1e-6);
    // Each slot reaches down to just above the picture ring: 2 points per slot.
    const deep = r.filter((v) => v < R - 5);
    expect(deep).toHaveLength(2 * disc.slits);
    for (const v of deep) expect(v).toBeGreaterThan(disc.outerRadius);
  });

  it("says what the slits do", () => {
    expect(slitEffect(12, 12)).toBe("still");
    expect(slitEffect(12, 13)).toBe("backwards");
    expect(slitEffect(12, 11)).toBe("forwards");
  });
});

describe("cut files", () => {
  it("writes an SVG path", () => {
    expect(svgPolygon([[0, 0], [10, 0], [10, 5]], 1, 1)).toBe("M1.000 1.000 L11.000 1.000 L11.000 6.000 Z");
  });
  it("writes a DXF with polylines and circles, y up", () => {
    const text = dxf([[[0, 0], [10, 0], [10, 5]]], [{ cx: 0, cy: 2, r: 3 }]);
    expect(text.startsWith("0\nSECTION\n2\nHEADER")).toBe(true);
    expect(text.match(/\nVERTEX\n/g)).toHaveLength(3);
    expect(text).toContain("CIRCLE\n8\nCORTE\n10\n0.000000\n20\n-2.000000\n30\n0.000000\n40\n3.000000");
    expect(text.trimEnd().endsWith("EOF")).toBe(true);
  });
});
