import { describe, expect, it } from "vitest";
import {
  createHistory,
  makeEntry,
  pushEntry,
  redo,
  removeEntry,
  replay,
  setEntryEnabled,
  undo,
  updateEntryOp,
} from "./history";
import type { MediaRef } from "./model";
import type { Op } from "./ops";
import { frameIndexAtTick, tailStartTick, timeline } from "./timing";

const media: MediaRef = { original: "o", proxy: "p", thumb: "t", width: 10, height: 10 };
const insert = (frameId: string, afterFrameId: string | null): Op => ({
  type: "frame.insert",
  afterFrameId,
  frameId,
  layerId: `${frameId}-l`,
  media,
  label: "Foto",
});

function build(...ops: Op[]) {
  return ops.reduce((h, op) => pushEntry(h, makeEntry([op])), createHistory({ name: "t", fps: 12, width: 10, height: 10 }));
}

describe("history", () => {
  it("replays inserts by anchor id", () => {
    const h = build(insert("a", null), insert("c", "a"), insert("b", "a"));
    expect(replay(h).film.frameOrder).toEqual(["a", "b", "c"]);
  });

  it("undo/redo move the cursor and new steps insert at the cursor", () => {
    let h = build(insert("a", null), insert("b", "a"));
    h = undo(h);
    expect(replay(h).film.frameOrder).toEqual(["a"]);
    h = pushEntry(h, makeEntry([insert("x", null)]));
    expect(h.cursor).toBe(2);
    expect(replay(h).film.frameOrder).toEqual(["x", "a"]);
    h = redo(h);
    expect(replay(h).film.frameOrder).toEqual(["x", "a", "b"]);
  });

  it("disabling a past step recomputes and flags steps that no longer apply", () => {
    const h = build(insert("a", null), insert("b", "a"), { type: "frame.setHold", frameId: "b", hold: 3 });
    const off = setEntryEnabled(h, h.entries[1]!.id, false);
    const r = replay(off);
    expect(r.film.frameOrder).toEqual(["a"]);
    expect(Object.keys(r.errors)).toEqual([h.entries[2]!.id]);
  });

  it("edits parameters of a past step", () => {
    const h = build(insert("a", null), { type: "frame.setHold", frameId: "a", hold: 2 }, insert("b", "a"));
    const edited = updateEntryOp(h, h.entries[1]!.id, 0, { type: "frame.setHold", frameId: "a", hold: 4 });
    expect(replay(edited).film.frames["a"]!.hold).toBe(4);
    expect(edited.entries[1]!.label).toContain("×4");
  });

  it("removing a past step keeps the cursor on the same future", () => {
    const h = build(insert("a", null), insert("b", "a"), insert("c", "b"));
    const r = removeEntry(undo(h), h.entries[0]!.id);
    expect(r.cursor).toBe(1);
    expect(replay(r).errors[h.entries[1]!.id]).toBeDefined();
  });

  it("duplicate places the copy right after its source", () => {
    const h = build(insert("a", null), insert("b", "a"), {
      type: "frame.duplicate",
      sourceFrameId: "a",
      frameId: "a2",
      layerIds: ["a2-l"],
    });
    const film = replay(h).film;
    expect(film.frameOrder).toEqual(["a", "a2", "b"]);
    expect(film.frames["a2"]!.layers[0]!.id).toBe("a2-l");
  });
});

describe("timing", () => {
  it("maps ticks to frames honoring holds", () => {
    const h = build(insert("a", null), insert("b", "a"), { type: "frame.setHold", frameId: "a", hold: 2 });
    const film = replay(h).film;
    const { frames, totalTicks } = timeline(film);
    expect(totalTicks).toBe(3);
    expect([0, 1, 2, 3].map((t) => frameIndexAtTick(frames, t))).toEqual([0, 0, 1, -1]);
    expect(tailStartTick(film, 1 / 12)).toBe(2);
  });
});
