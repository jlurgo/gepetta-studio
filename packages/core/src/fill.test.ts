import { describe, expect, it } from "vitest";
import { fillMask } from "./fill";

/** A w×h picture, see-through, with opaque black pixels where `ink` says. */
function picture(rows: string[]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === "#") data[(y * w + x) * 4 + 3] = 255;
    }),
  );
  return { data, w, h };
}

function show(mask: Uint8Array, w: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < mask.length; i += w) out.push([...mask.slice(i, i + w)].map((v) => ".12"[v]).join(""));
  return out;
}

describe("fillMask", () => {
  it("fills inside a closed line, growing one pixel over it", () => {
    const { data, w, h } = picture([
      ".......", //
      ".#####.",
      ".#...#.",
      ".#...#.",
      ".#####.",
      ".......",
    ]);
    expect(show(fillMask(data, w, h, 3, 2, 10), w)).toEqual([
      ".......", //
      "..222..",
      ".21112.",
      ".21112.",
      "..222..",
      ".......",
    ]);
  });

  it("does not leak through a closed line, and fills the outside separately", () => {
    const { data, w, h } = picture([
      ".....", //
      ".###.",
      ".#.#.",
      ".###.",
      ".....",
    ]);
    const mask = fillMask(data, w, h, 0, 0, 10);
    expect(mask[2 * w + 2]).toBe(0);
    expect(mask[0]).toBe(1);
    expect(mask[4 * w + 4]).toBe(1);
  });

  it("compares colors within the tolerance", () => {
    const data = new Uint8ClampedArray([100, 0, 0, 255, 110, 0, 0, 255, 200, 0, 0, 255]);
    expect([...fillMask(data, 3, 1, 0, 0, 20)]).toEqual([1, 1, 2]);
    expect([...fillMask(data, 3, 1, 0, 0, 5)]).toEqual([1, 2, 0]);
  });

  it("returns nothing outside the picture", () => {
    expect([...fillMask(new Uint8ClampedArray(4), 1, 1, 5, 5, 0)]).toEqual([0]);
  });
});
