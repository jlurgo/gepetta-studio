import { describe, expect, it } from "vitest";
import { type Clip, IDENTITY_TRANSFORM, PHOTO_TRACK, emptyFilm } from "./model";
import { applyOp } from "./ops";
import { interpolateOps, relayOps, sequenceClips } from "./sequences";

const pic = (id: string, start: number, seq?: string): Clip => ({
  id,
  track: PHOTO_TRACK,
  start,
  length: 1,
  media: { original: id, proxy: id, thumb: id, width: 10, height: 10 },
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
  ...(seq && { seq }),
});

function film() {
  let f = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
  f = applyOp(f, { type: "clip.place", clips: [pic("a", 2, "s"), pic("b", 3, "s"), pic("c", 4, "s"), pic("x", 8)] });
  return f;
}

describe("sequences", () => {
  it("lists a sequence's pictures in time order", () => {
    expect(sequenceClips(film(), "s").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("gives every picture a new length, one after another", () => {
    let f = film();
    for (const op of relayOps(f, "s", 2)) f = applyOp(f, op);
    expect(sequenceClips(f, "s").map((c) => [c.id, c.start, c.length])).toEqual([
      ["a", 2, 2],
      ["b", 4, 2],
      ["c", 6, 2],
    ]);
    expect(f.clips.x!.start).toBe(8);
  });

  it("reverses the order", () => {
    let f = film();
    for (const op of relayOps(f, "s", undefined, true)) f = applyOp(f, op);
    expect(sequenceClips(f, "s").map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("moves part way from the first picture to the last", () => {
    let f = film();
    f = applyOp(f, { type: "clip.update", id: "c", patch: { transform: { x: 100, y: 0, rotation: 0, scale: 2 } } });
    for (const op of interpolateOps(f, "s")) f = applyOp(f, op);
    expect(f.clips.b!.transform).toEqual({ x: 50, y: 0, rotation: 0, scale: 1.5 });
  });
});
