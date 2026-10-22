import { describe, expect, it } from "vitest";
import { type Clip, type FilmState, IDENTITY_TRANSFORM, type MediaRef, PHOTO_TRACK, type Track, emptyFilm } from "./model";
import { applyOp } from "./ops";
import { composeTransforms, previousClips, splitAtTrack, stackAt } from "./layers";

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

  it("composes transforms like nested drawing", () => {
    expect(composeTransforms(IDENTITY_TRANSFORM, { x: 3, y: 4, rotation: 1, scale: 2 })).toEqual({ x: 3, y: 4, rotation: 1, scale: 2 });
  });
});
