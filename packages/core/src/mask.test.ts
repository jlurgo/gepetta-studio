import { describe, expect, it } from "vitest";
import { MASK_POINTS, blendSequenceMasksOps, insideOutline, normalizeOutline, rectOutline } from "./mask";
import { type Clip, type FilmState, IDENTITY_TRANSFORM, PHOTO_TRACK, emptyFilm } from "./model";
import { applyOp } from "./ops";

const square: [number, number][] = [
  [0.2, 0.2],
  [0.6, 0.2],
  [0.6, 0.6],
  [0.2, 0.6],
];

const pic = (id: string, start: number, mask?: Clip["look"]): Clip => ({
  id,
  track: PHOTO_TRACK,
  start,
  length: 1,
  media: { original: id, proxy: id, thumb: id, width: 10, height: 10 },
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
  seq: "s",
  ...(mask && { look: mask }),
});

describe("outlines", () => {
  it("keeps MASK_POINTS points, the same whichever way it was drawn", () => {
    const a = normalizeOutline(square);
    const b = normalizeOutline([...square].reverse());
    expect(a).toHaveLength(MASK_POINTS);
    expect(b).toEqual(a);
    // Starts at the top, in the middle.
    expect(a[0]![1]).toBeCloseTo(0.2);
    expect(a[0]![0]).toBeCloseTo(0.4, 1);
  });

  it("tells inside from outside", () => {
    const o = rectOutline([0.6, 0.6], [0.2, 0.2]);
    expect(insideOutline([0.4, 0.4], o)).toBe(true);
    expect(insideOutline([0.7, 0.4], o)).toBe(false);
  });

  it("blends a sequence's outlines between the ones drawn by hand", () => {
    const a = rectOutline([0, 0], [0.2, 0.2]);
    const b = rectOutline([0.4, 0], [0.6, 0.2]);
    let film: FilmState = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
    film = applyOp(film, {
      type: "clip.place",
      clips: [pic("a", 0, { mask: { points: a, key: true } }), pic("b", 1), pic("c", 2), pic("d", 3), pic("e", 4, { mask: { points: b, key: true } }), pic("f", 5)],
    });
    for (const op of blendSequenceMasksOps(film, "s")) film = applyOp(film, op);
    const mid = film.clips.c!.look!.mask!;
    expect(mid.key).toBeUndefined();
    expect(mid.points[0]![0]).toBeCloseTo((a[0]![0] + b[0]![0]) / 2);
    expect(film.clips.f!.look!.mask!.points).toEqual(b);
    expect(film.clips.a!.look!.mask!.points).toEqual(a);
  });
});
