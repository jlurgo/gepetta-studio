import { describe, expect, it } from "vitest";
import { type Channel, type FilmState, type MediaRef, IDENTITY_TRANSFORM, emptyFilm } from "./model";
import { applyOp } from "./ops";
import { channelMediaAt, frameSpans, frameStack } from "./layers";

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

function channel(patch: Partial<Channel>): Channel {
  return {
    id: "c",
    name: "Video",
    source: { kind: "sequence", media: ["v0", "v1", "v2", "v3", "v4", "v5"].map(media), fps: 12 },
    visible: true,
    opacity: 0.5,
    transform: IDENTITY_TRANSFORM,
    placement: "above",
    exported: false,
    from: null,
    to: null,
    ...patch,
  };
}

describe("channels", () => {
  it("advance a sequence with the film's time, holds included", () => {
    let film = filmWith(4);
    film = applyOp(film, { type: "frame.setHold", frameId: "f1", hold: 2 }); // f0:0 f1:1-2 f2:3 f3:4
    film = applyOp(film, { type: "channel.add", channel: channel({}) });
    const spans = frameSpans(film);
    const at = (tick: number) => channelMediaAt(film, film.channels[0]!, tick, spans)?.original ?? null;
    expect([0, 1, 2, 3, 4, 5, 6].map(at)).toEqual(["v0", "v1", "v2", "v3", "v4", "v5", null]);
  });

  it("start at their first frame and resample a different rate", () => {
    let film = filmWith(5);
    film = applyOp(film, { type: "channel.add", channel: channel({ from: "f2", source: { kind: "sequence", media: ["a", "b", "c", "d"].map(media), fps: 24 } }) });
    const spans = frameSpans(film);
    const at = (tick: number) => channelMediaAt(film, film.channels[0]!, tick, spans)?.original ?? null;
    // 24 fps video on a 12 fps film: every other picture, from frame 2 (tick 2).
    expect([0, 1, 2, 3, 4].map(at)).toEqual([null, null, "a", "c", null]);
  });

  it("stack below, own layers, above; reference channels left out of exports", () => {
    let film = filmWith(1);
    film = applyOp(film, { type: "layer.add", frameId: "f0", layerId: "top", media: media("drawing"), name: "Dibujo" });
    film = applyOp(film, { type: "channel.add", channel: channel({ id: "bg", placement: "below", exported: true, source: { kind: "image", media: media("sky") } }) });
    film = applyOp(film, { type: "channel.add", channel: channel({ id: "ref" }) });
    const keys = (exportOnly: boolean) => frameStack(film, film.frames.f0!, 0, { exportOnly }).map((i) => i.media.original);
    expect(keys(false)).toEqual(["sky", "p0", "drawing", "v0"]);
    expect(keys(true)).toEqual(["sky", "p0", "drawing"]);
    // The live view (no frame) shows only channels.
    expect(frameStack(film, null, 0).map((i) => i.media.original)).toEqual(["sky", "v0"]);
  });

  it("keep their span when a boundary frame is deleted", () => {
    let film = filmWith(4);
    film = applyOp(film, { type: "channel.add", channel: channel({ from: "f1", to: "f2", source: { kind: "image", media: media("x") } }) });
    film = applyOp(film, { type: "frame.delete", frameId: "f1" });
    film = applyOp(film, { type: "frame.delete", frameId: "f2" });
    // Both its frames are gone: the ends moved to the neighbors, leaving an empty span.
    expect([film.channels[0]!.from, film.channels[0]!.to]).toEqual(["f3", "f0"]);
  });
});

describe("layer ops", () => {
  it("add, update, reorder and remove layers within a frame", () => {
    let film = filmWith(1);
    film = applyOp(film, { type: "layer.add", frameId: "f0", layerId: "a", media: media("a"), name: "A" });
    film = applyOp(film, { type: "layer.update", frameId: "f0", layerId: "a", patch: { opacity: 0.3 } });
    film = applyOp(film, { type: "layer.move", frameId: "f0", layerId: "a", index: 0 });
    expect(film.frames.f0!.layers.map((l) => [l.id, l.opacity])).toEqual([
      ["a", 0.3],
      ["b0", 1],
    ]);
    film = applyOp(film, { type: "layer.remove", frameId: "f0", layerId: "a" });
    expect(film.frames.f0!.layers.map((l) => l.id)).toEqual(["b0"]);
  });
});
