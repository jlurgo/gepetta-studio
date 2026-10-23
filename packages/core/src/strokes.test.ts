import { describe, expect, it } from "vitest";
import { type Clip, type FilmState, IDENTITY_TRANSFORM, type Stroke, emptyFilm, PHOTO_TRACK } from "./model";
import { OpError, applyOp } from "./ops";

const clip: Clip = {
  id: "c",
  track: PHOTO_TRACK,
  start: 0,
  length: 3,
  media: { original: "o", proxy: "p", thumb: "t", width: 100, height: 100 },
  name: "Dibujo",
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
};
const line = (id: string): Stroke => ({ id, tool: "draw", brush: "ink", color: "#000000", strength: 1, points: [[0, 0, 4, 1], [10, 10, 4, 1]] });

function film(): FilmState {
  return applyOp(emptyFilm({ name: "t", fps: 12, width: 160, height: 90 }), { type: "clip.place", clips: [clip] });
}

describe("strokes", () => {
  it("adds strokes on top, in order", () => {
    let f = applyOp(film(), { type: "stroke.add", clip: "c", stroke: line("a") });
    f = applyOp(f, { type: "stroke.add", clip: "c", stroke: line("b") });
    expect(f.clips.c!.strokes!.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("changes and removes a stroke by id", () => {
    let f = applyOp(film(), { type: "stroke.add", clip: "c", stroke: line("a") });
    f = applyOp(f, { type: "stroke.add", clip: "c", stroke: line("b") });
    f = applyOp(f, { type: "stroke.update", clip: "c", id: "a", patch: { color: "#ff0000" } });
    expect(f.clips.c!.strokes![0]!.color).toBe("#ff0000");
    f = applyOp(f, { type: "stroke.remove", clip: "c", ids: ["a"] });
    expect(f.clips.c!.strokes!.map((s) => s.id)).toEqual(["b"]);
  });

  it("no longer applies once the stroke is gone", () => {
    expect(() => applyOp(film(), { type: "stroke.update", clip: "c", id: "x", patch: { hidden: true } })).toThrow(OpError);
  });

  it("keeps the strokes on both parts of a picture that is split", () => {
    let f = applyOp(film(), { type: "stroke.add", clip: "c", stroke: line("a") });
    f = applyOp(f, { type: "cells.clear", start: 1, length: 1 });
    const parts = Object.values(f.clips);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(p.strokes!.map((s) => s.id)).toEqual(["a"]);
  });
});
