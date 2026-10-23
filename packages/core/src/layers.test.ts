import { describe, expect, it } from "vitest";
import { type Clip, type FilmState, IDENTITY_TRANSFORM, type MediaRef, PHOTO_TRACK, type Track, emptyFilm } from "./model";
import { applyOp } from "./ops";
import { composeTransforms, outerTransform, previousClips, relativeTransform, splitAtTrack, stackAt } from "./layers";

const media = (id: string): MediaRef => ({ original: id, proxy: id, thumb: id, width: 100, height: 100 });
const clip = (id: string, start: number, length = 1, track = PHOTO_TRACK, patch: Partial<Clip> = {}): Clip => ({
  id,
  track,
  start,
  length,
  media: media(id),
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
  ...patch,
});
const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
  exported: true,
  ...patch,
});

function film(): FilmState {
  let f = emptyFilm({ name: "t", fps: 12, width: 1600, height: 900 });
  f = applyOp(f, { type: "track.add", track: track("sky") });
  f = applyOp(f, { type: "track.move", trackId: "sky", index: 0 });
  f = applyOp(f, { type: "track.add", track: track("ref", { exported: false, opacity: 0.5 }) });
  f = applyOp(f, { type: "clip.place", clips: [clip("bg", 0, 10, "sky"), clip("p0", 0), clip("p1", 1, 2), clip("v0", 0, 1, "ref"), clip("v1", 1, 1, "ref")] });
  return f;
}

const originals = (items: { media: MediaRef }[]) => items.map((i) => i.media.original);

describe("stackAt", () => {
  it("combines tracks bottom to top; references are left out of exports", () => {
    expect(originals(stackAt(film(), 0))).toEqual(["bg", "p0", "v0"]);
    expect(originals(stackAt(film(), 2))).toEqual(["bg", "p1"]);
    expect(originals(stackAt(film(), 1, { exportOnly: true }))).toEqual(["bg", "p1"]);
    expect(originals(stackAt(film(), 1, { tracks: [PHOTO_TRACK] }))).toEqual(["p1"]);
  });

  it("applies the track's opacity and transform to its clips", () => {
    let f = film();
    f = applyOp(f, { type: "track.update", trackId: PHOTO_TRACK, patch: { opacity: 0.5, transform: { x: 10, y: 0, rotation: Math.PI / 2, scale: 2 } } });
    f = applyOp(f, { type: "clip.update", id: "p0", patch: { opacity: 0.5, transform: { x: 5, y: 0, rotation: 0, scale: 1 } } });
    const item = stackAt(f, 0, { tracks: [PHOTO_TRACK] })[0]!;
    expect(item.opacity).toBe(0.25);
    // The clip's 5 px right, turned 90° and doubled by the track: 10 px down, plus the track's 10 px right.
    expect(item.transform.x).toBeCloseTo(10);
    expect(item.transform.y).toBeCloseTo(10);
  });

  it("puts the live camera in place of the target track", () => {
    const f = film();
    const { below, above } = splitAtTrack(f, stackAt(f, 0), PHOTO_TRACK);
    expect([originals(below), originals(above)]).toEqual([["bg"], ["v0"]]);
  });

  it("finds the previous pictures of a track for onion skin", () => {
    const f = film();
    expect(previousClips(f, PHOTO_TRACK, 3, 2).map((c) => c.id)).toEqual(["p1", "p0"]);
    // Inside a picture, onion skin shows the ones before it.
    expect(previousClips(f, PHOTO_TRACK, 2, 2).map((c) => c.id)).toEqual(["p0"]);
  });

  it("finds the inner transform back from a composite", () => {
    const outer = { x: 10, y: -5, rotation: 0.7, scale: 1.5 };
    const inner = { x: 3, y: 4, rotation: -0.2, scale: 0.5 };
    const back = relativeTransform(outer, composeTransforms(outer, inner));
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(4);
    expect(back.rotation).toBeCloseTo(-0.2);
    expect(back.scale).toBeCloseTo(0.5);
  });

  it("finds the outer transform back from a composite", () => {
    const outer = { x: 10, y: -5, rotation: 0.7, scale: 1.5 };
    const inner = { x: 3, y: 4, rotation: -0.2, scale: 0.5 };
    const back = outerTransform(inner, composeTransforms(outer, inner));
    expect(back.x).toBeCloseTo(10);
    expect(back.y).toBeCloseTo(-5);
    expect(back.rotation).toBeCloseTo(0.7);
    expect(back.scale).toBeCloseTo(1.5);
  });

  it("composes transforms like nested drawing", () => {
    expect(composeTransforms(IDENTITY_TRANSFORM, { x: 3, y: 4, rotation: 1, scale: 2 })).toEqual({ x: 3, y: 4, rotation: 1, scale: 2 });
  });
});

describe("loop films", () => {
  it("shows the last pictures as the ones before the first", async () => {
    const { previousClips } = await import("./layers");
    const { applyOp } = await import("./ops");
    const { emptyFilm, IDENTITY_TRANSFORM, PHOTO_TRACK } = await import("./model");
    const pic = (id: string, start: number) => ({
      id,
      track: PHOTO_TRACK,
      start,
      length: 1,
      media: { original: id, proxy: id, thumb: id, width: 10, height: 10 },
      name: id,
      visible: true,
      opacity: 1,
      transform: IDENTITY_TRANSFORM,
    });
    let film = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
    film = applyOp(film, { type: "clip.place", clips: [pic("a", 0), pic("b", 1), pic("c", 2), pic("d", 3)] });
    expect(previousClips(film, PHOTO_TRACK, 1, 3).map((c) => c.id)).toEqual(["a"]);
    film = applyOp(film, { type: "film.setLoop", loop: true });
    expect(previousClips(film, PHOTO_TRACK, 1, 3).map((c) => c.id)).toEqual(["a", "d", "c"]);
    expect(previousClips(film, PHOTO_TRACK, 0, 2).map((c) => c.id)).toEqual(["d", "c"]);
  });
});

describe("ping-pong", () => {
  it("goes to the end and back", async () => {
    const { playedCell, exportedCells } = await import("./layers");
    const { emptyFilm } = await import("./model");
    const film = { ...emptyFilm({ name: "t", fps: 12, width: 160, height: 90, loop: true, pingpong: true }), length: 4 };
    expect(Array.from({ length: 9 }, (_, n) => playedCell(film, n))).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2]);
    expect(exportedCells(film)).toEqual([0, 1, 2, 3, 2, 1]);
    const loop = { ...film, settings: { ...film.settings, pingpong: false } };
    expect(Array.from({ length: 6 }, (_, n) => playedCell(loop, n))).toEqual([0, 1, 2, 3, 0, 1]);
  });
});

describe("fades", () => {
  it("shows a picture less at the start and end of its fade", async () => {
    const { fadeAt } = await import("./model");
    const clip = { start: 10, length: 8, fade: { in: 3, out: 1 } };
    expect([10, 11, 12, 13, 16, 17].map((c) => fadeAt(clip, c))).toEqual([0.25, 0.5, 0.75, 1, 1, 0.5]);
    expect(fadeAt({ start: 0, length: 3 }, 1)).toBe(1);
  });
});
