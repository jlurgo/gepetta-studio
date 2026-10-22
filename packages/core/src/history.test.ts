import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
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
import { type Clip, IDENTITY_TRANSFORM, type MediaRef, PHOTO_TRACK } from "./model";
import type { Op } from "./ops";
import { isLegacyHistory, migrateHistory } from "./legacy/convert";

const SETTINGS = { name: "t", fps: 12, width: 1600, height: 900 };
const media = (id: string): MediaRef => ({ original: id, proxy: id, thumb: id, width: 100, height: 100 });
const clip = (id: string, start: number, length = 1, track = PHOTO_TRACK): Clip => ({
  id,
  track,
  start,
  length,
  media: media(id),
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
});
const place = (...clips: Clip[]): Op => ({ type: "clip.place", clips });
const cells = (h: ReturnType<typeof createHistory>) =>
  Object.values(replay(h).film.clips)
    .sort((a, b) => a.start - b.start)
    .map((c) => `${c.id}@${c.start}+${c.length}`);

describe("history", () => {
  it("undo/redo move the cursor and new steps insert at the cursor", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([place(clip("a", 0))]));
    h = pushEntry(h, makeEntry([place(clip("b", 1))]));
    expect(cells(h)).toEqual(["a@0+1", "b@1+1"]);
    h = undo(h);
    expect(cells(h)).toEqual(["a@0+1"]);
    expect(canRedo(h)).toBe(true);
    h = pushEntry(h, makeEntry([place(clip("c", 1))]));
    expect(cells(h)).toEqual(["a@0+1", "c@1+1"]);
    // Redo brings back "b", which now overwrites "c" in the same cell.
    h = redo(h);
    expect(cells(h)).toEqual(["a@0+1", "b@1+1"]);
    expect(canUndo(h)).toBe(true);
  });

  it("disabling a past step recomputes and flags steps that no longer apply", () => {
    let h = createHistory(SETTINGS);
    const add = makeEntry([place(clip("a", 0, 3))]);
    h = pushEntry(h, add);
    h = pushEntry(h, makeEntry([{ type: "clip.update", id: "a", patch: { length: 2 } }]));
    h = setEntryEnabled(h, add.id, false);
    const { film, errors } = replay(h);
    expect(Object.keys(film.clips)).toEqual([]);
    expect(Object.keys(errors)).toHaveLength(1);
  });

  it("edits parameters of a past step", () => {
    let h = createHistory(SETTINGS);
    const step = makeEntry([{ type: "film.setFps", fps: 12 }]);
    h = pushEntry(h, step);
    h = updateEntryOp(h, step.id, 0, { type: "film.setFps", fps: 24 });
    expect(replay(h).film.settings.fps).toBe(24);
  });

  it("removing a past step keeps the cursor on the same future", () => {
    let h = createHistory(SETTINGS);
    const first = makeEntry([place(clip("a", 0))]);
    h = pushEntry(h, first);
    h = pushEntry(h, makeEntry([place(clip("b", 1))]));
    h = removeEntry(h, first.id);
    expect(h.cursor).toBe(1);
    expect(cells(h)).toEqual(["b@1+1"]);
  });
});

describe("grid", () => {
  it("placing overwrites: trims, splits and removes what it lands on", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([place(clip("long", 0, 6), clip("x", 7))]));
    h = pushEntry(h, makeEntry([place(clip("mid", 2, 2), clip("y", 7))]));
    // "long" is cut around "mid"; its tail keeps a derived id; "x" is replaced by "y".
    expect(cells(h)).toEqual(["long@0+2", "mid@2+2", "long@4@4+2", "y@7+1"]);
    expect(replay(h).film.length).toBe(8);
  });

  it("moves clips together across cells and tracks", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([{ type: "track.add", track: { id: "t2", name: "Capa", visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true } }]));
    h = pushEntry(h, makeEntry([place(clip("a", 0), clip("b", 1), clip("c", 3))]));
    // a and b swap places with each other's cells and go to the other track; c is overwritten by nothing.
    h = pushEntry(h, makeEntry([{ type: "clip.move", moves: [{ id: "a", track: "t2", start: 3 }, { id: "b", track: "t2", start: 4 }] }]));
    const film = replay(h).film;
    expect(Object.values(film.clips).map((c) => `${c.id}:${c.track}@${c.start}`).sort()).toEqual(["a:t2@3", "b:t2@4", `c:${PHOTO_TRACK}@3`]);
  });

  it("moving clips onto each other's old cells does not erase them", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([place(clip("a", 0), clip("b", 1))]));
    h = pushEntry(h, makeEntry([{ type: "clip.move", moves: [{ id: "a", track: PHOTO_TRACK, start: 1 }, { id: "b", track: PHOTO_TRACK, start: 2 }] }]));
    expect(cells(h)).toEqual(["a@1+1", "b@2+1"]);
  });

  it("a longer clip overwrites the cells it grows into", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([place(clip("a", 0), clip("b", 1), clip("c", 2))]));
    h = pushEntry(h, makeEntry([{ type: "clip.update", id: "a", patch: { length: 2 } }]));
    expect(cells(h)).toEqual(["a@0+2", "c@2+1"]);
  });

  it("the grid can be extended but never cuts clips", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([place(clip("a", 0, 3))]));
    h = pushEntry(h, makeEntry([{ type: "film.setLength", length: 24 }]));
    expect(replay(h).film.length).toBe(24);
    h = pushEntry(h, makeEntry([{ type: "film.setLength", length: 1 }]));
    expect(replay(h).film.length).toBe(3);
  });
});

describe("columns", () => {
  const capa = { id: "t2", name: "Capa", visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true };
  const byTrack = (h: ReturnType<typeof createHistory>) =>
    Object.values(replay(h).film.clips)
      .map((c) => `${c.track === PHOTO_TRACK ? "F" : c.track}:${c.id}@${c.start}+${c.length}`)
      .sort();

  it("move every track's cells together, cutting pictures that reach outside", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([{ type: "track.add", track: capa }]));
    h = pushEntry(h, makeEntry([place(clip("a", 0), clip("b", 1), clip("c", 2), clip("bg", 0, 4, "t2"))]));
    // Column 1 goes to cell 6: "b" moves whole; the background's cell 1 is cut out and goes along.
    h = pushEntry(h, makeEntry([{ type: "cells.move", start: 1, length: 1, to: 6 }]));
    expect(byTrack(h)).toEqual(["F:a@0+1", "F:b@6+1", "F:c@2+1", "t2:bg@0+1", "t2:bg@2@2+2", "t2:bg~1@6+1"]);
  });

  it("overwrite where they land and can be emptied", () => {
    let h = createHistory(SETTINGS);
    h = pushEntry(h, makeEntry([place(clip("a", 0), clip("b", 1), clip("c", 2))]));
    h = pushEntry(h, makeEntry([{ type: "cells.move", start: 0, length: 1, to: 2 }]));
    expect(byTrack(h)).toEqual(["F:a@2+1", "F:b@1+1"]);
    h = pushEntry(h, makeEntry([{ type: "cells.clear", start: 1, length: 2 }]));
    expect(byTrack(h)).toEqual([]);
  });
});

describe("films made before the grid", () => {
  const entry = (ops: unknown[]) => ({ id: Math.random().toString(36), label: "", ops, enabled: true, createdAt: 0 }) as never;
  const legacyMedia = (id: string) => media(id);
  const old = {
    initial: SETTINGS,
    entries: [
      entry([{ type: "frame.insert", afterFrameId: null, frameId: "f1", layerId: "l1", media: legacyMedia("p1"), label: "Foto" }]),
      entry([{ type: "frame.insert", afterFrameId: "f1", frameId: "f2", layerId: "l2", media: legacyMedia("p2"), label: "Foto" }]),
      entry([{ type: "frame.setHold", frameId: "f1", hold: 3 }]),
      entry([{ type: "frame.duplicate", sourceFrameId: "f2", frameId: "f3", layerIds: ["l3"] }]),
    ],
    cursor: 4,
  };

  it("are recognized and converted to clips in the photo track, holds as lengths", () => {
    expect(isLegacyHistory(old)).toBe(true);
    const h = migrateHistory(old);
    expect(h.entries).toEqual([]);
    expect(cells(h)).toEqual(["l1@0+3", "l2@3+1", "l3@4+1"]);
    expect(replay(h).film.clips.l3!.media.original).toBe("p2");
    expect(replay(h).film.length).toBe(5);
  });

  it("keep working after conversion", () => {
    let h = migrateHistory(old);
    h = pushEntry(h, makeEntry([place(clip("new", 5))]));
    expect(cells(h).at(-1)).toBe("new@5+1");
  });
});
