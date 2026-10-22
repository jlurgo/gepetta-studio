import { describe, expect, it } from "vitest";
import { type FilmState, IDENTITY_TRANSFORM, type MediaRef, PHOTO_TRACK, type Track, emptyFilm } from "./model";
import { applyOp } from "./ops";
import { composeTransforms, frameSpans, frameStack, splitAtPhotos, trackMediaAt } from "./layers";
import { replay } from "./history";

const media = (id: string): MediaRef => ({ original: id, proxy: id, thumb: id, width: 100, height: 100 });

function filmWith(frames: number): FilmState {
  let film = emptyFilm({ name: "t", fps: 12, width: 1600, height: 900 });
  let after: string | null = null;
  for (let i = 0; i < frames; i++) {
    film = applyOp(film, { type: "frame.insert", afterFrameId: after, frameId: `f${i}`, layerId: `b${i}`, media: media(`p${i}`), label: "" });
    after = `f${i}`;
  }
  return film;
}

function track(patch: Partial<Track>): Track {
  return {
    id: "v",
    name: "Video",
    source: { kind: "sequence", media: ["v0", "v1", "v2", "v3", "v4", "v5"].map(media), fps: 12 },
    visible: true,
    opacity: 0.5,
    transform: IDENTITY_TRANSFORM,
    exported: false,
    from: null,
    to: null,
    ...patch,
  };
}

const originals = (items: { media: MediaRef }[]) => items.map((i) => i.media.original);

describe("tracks", () => {
  it("films start with the photo track, and photos go to it", () => {
    const film = filmWith(1);
    expect(film.tracks.map((t) => t.id)).toEqual([PHOTO_TRACK]);
    expect(film.frames.f0!.layers[0]!.track).toBe(PHOTO_TRACK);
  });

  it("advance a sequence with the film's time, holds included", () => {
    let film = filmWith(4);
    film = applyOp(film, { type: "frame.setHold", frameId: "f1", hold: 2 });
    film = applyOp(film, { type: "track.add", track: track({}) });
    const spans = frameSpans(film);
    const at = (tick: number) => trackMediaAt(film, film.tracks[1]!, tick, spans)?.original ?? null;
    expect([0, 1, 2, 3, 4, 5, 6].map(at)).toEqual(["v0", "v1", "v2", "v3", "v4", "v5", null]);
  });

  it("start at their first frame and resample a different rate", () => {
    let film = filmWith(5);
    film = applyOp(film, { type: "track.add", track: track({ from: "f2", source: { kind: "sequence", media: ["a", "b", "c", "d"].map(media), fps: 24 } }) });
    const spans = frameSpans(film);
    const at = (tick: number) => trackMediaAt(film, film.tracks[1]!, tick, spans)?.original ?? null;
    expect([0, 1, 2, 3, 4].map(at)).toEqual([null, null, "a", "c", null]);
  });

  it("stack in track order; reference tracks are left out of exports", () => {
    let film = filmWith(1);
    film = applyOp(film, { type: "track.add", track: track({ id: "sky", exported: true, source: { kind: "image", media: media("sky") } }) });
    film = applyOp(film, { type: "track.move", trackId: "sky", index: 0 });
    film = applyOp(film, { type: "track.add", track: track({ id: "draw", source: { kind: "cells" }, exported: true }) });
    film = applyOp(film, { type: "layer.add", frameId: "f0", layerId: "d", media: media("drawing"), name: "Dibujo", trackId: "draw" });
    film = applyOp(film, { type: "track.add", track: track({ id: "ref" }) });
    const stack = (exportOnly: boolean) => originals(frameStack(film, film.frames.f0!, 0, { exportOnly }));
    expect(stack(false)).toEqual(["sky", "p0", "drawing", "v0"]);
    expect(stack(true)).toEqual(["sky", "p0", "drawing"]);
    // Live view: no frame, so the camera goes between what is under and over the photos.
    const live = splitAtPhotos(film, frameStack(film, null, 0));
    expect([originals(live.below), originals(live.above)]).toEqual([["sky"], ["v0"]]);
  });

  it("apply the track's opacity and transform to its cells", () => {
    let film = filmWith(1);
    film = applyOp(film, { type: "track.update", trackId: PHOTO_TRACK, patch: { opacity: 0.5, transform: { x: 10, y: 0, rotation: Math.PI / 2, scale: 2 } } });
    film = applyOp(film, { type: "layer.update", frameId: "f0", layerId: "b0", patch: { opacity: 0.5, transform: { x: 5, y: 0, rotation: 0, scale: 1 } } });
    const [item] = frameStack(film, film.frames.f0!, 0);
    expect(item!.opacity).toBe(0.25);
    // The cell's 5 px to the right, rotated 90° and doubled by the track: 10 px down, plus the track's own 10 px right.
    expect(item!.transform.x).toBeCloseTo(10);
    expect(item!.transform.y).toBeCloseTo(10);
    expect(item!.transform.scale).toBe(2);
  });

  it("keep one cell per track: adding to a filled cell replaces it", () => {
    let film = filmWith(1);
    film = applyOp(film, { type: "layer.add", frameId: "f0", layerId: "x", media: media("x"), name: "x" });
    expect(film.frames.f0!.layers.map((l) => l.id)).toEqual(["x"]);
  });

  it("remove their cells with them; the photo track stays", () => {
    let film = filmWith(1);
    film = applyOp(film, { type: "track.add", track: track({ id: "draw", source: { kind: "cells" } }) });
    film = applyOp(film, { type: "layer.add", frameId: "f0", layerId: "d", media: media("d"), name: "d", trackId: "draw" });
    film = applyOp(film, { type: "track.remove", trackId: "draw" });
    expect(film.frames.f0!.layers.map((l) => l.id)).toEqual(["b0"]);
    expect(() => applyOp(film, { type: "track.remove", trackId: PHOTO_TRACK })).toThrow();
  });

  it("keep their span when a boundary frame is deleted", () => {
    let film = filmWith(4);
    film = applyOp(film, { type: "track.add", track: track({ from: "f1", to: "f2", source: { kind: "image", media: media("x") } }) });
    film = applyOp(film, { type: "frame.delete", frameId: "f1" });
    expect([film.tracks[1]!.from, film.tracks[1]!.to]).toEqual(["f2", "f2"]);
  });
});

describe("compatibility", () => {
  it("replays films saved before tracks; unknown ops become errors, not crashes", () => {
    const initial = { name: "t", fps: 12, width: 1600, height: 900 };
    const old = { type: "frame.insert", afterFrameId: null, frameId: "f", layerId: "l", media: media("p"), label: "" };
    const unknown = { type: "channel.add", channel: {} };
    const entry = (ops: unknown[], id: string) => ({ id, label: "", ops, enabled: true, createdAt: 0 });
    const { film, errors } = replay({ initial, entries: [entry([old], "a"), entry([unknown], "b")] as never, cursor: 2 });
    expect(Object.keys(film.frames)).toEqual(["f"]);
    expect(Object.keys(errors)).toEqual(["b"]);
  });

  it("composes transforms like nested drawing", () => {
    const t = composeTransforms({ x: 0, y: 0, rotation: 0, scale: 1 }, { x: 3, y: 4, rotation: 1, scale: 2 });
    expect(t).toEqual({ x: 3, y: 4, rotation: 1, scale: 2 });
  });
});
