import { describe, expect, it } from "vitest";
import { cellAfterRemoving, extendColumns, insertCellsOps, insertColumnsOps, nextRunEdge, removeCellOps, removeCellsOps, removeColumnsOps, toggleColumns } from "./columns";
import { type Clip, type FilmState, IDENTITY_TRANSFORM, PHOTO_TRACK, emptyFilm } from "./model";
import { applyOp } from "./ops";

const pic = (id: string, start: number, length = 1): Clip => ({
  id,
  track: PHOTO_TRACK,
  start,
  length,
  media: { original: id, proxy: id, thumb: id, width: 10, height: 10 },
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
});

function film(): FilmState {
  const f = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
  return applyOp(f, { type: "clip.place", clips: ["a", "b", "c", "d", "e", "f"].map((id, i) => pic(id, i)) });
}

const order = (f: FilmState) =>
  Object.values(f.clips)
    .sort((x, y) => x.start - y.start)
    .map((c) => `${c.id}@${c.start}`);

describe("picking columns", () => {
  it("adds and takes out stretches with ⌘/Ctrl, joining the ones that touch", () => {
    let cols = toggleColumns([], { start: 1, end: 2 });
    cols = toggleColumns(cols, { start: 4, end: 5 });
    cols = toggleColumns(cols, { start: 2, end: 3 });
    expect(cols).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 5 },
    ]);
    expect(toggleColumns(cols, { start: 1, end: 2 })).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it("extends from the first one with ⇧", () => {
    expect(extendColumns([{ start: 2, end: 3 }], { start: 6, end: 7 })).toEqual([{ start: 2, end: 7 }]);
  });
});

describe("removing columns", () => {
  it("takes the cells out and closes the gap, in every stretch", () => {
    let f = film();
    const cols = [
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ];
    for (const op of removeColumnsOps(f, cols)) f = applyOp(f, op);
    expect(order(f)).toEqual(["a@0", "c@1", "f@2"]);
    expect(f.length).toBe(3);
  });

  it("cuts a picture that goes across the stretch", () => {
    let f = applyOp(emptyFilm({ name: "t", fps: 12, width: 160, height: 90 }), { type: "clip.place", clips: [pic("a", 0, 4), pic("b", 4)] });
    for (const op of removeColumnsOps(f, [{ start: 1, end: 3 }])) f = applyOp(f, op);
    expect(Object.values(f.clips).map((c) => [c.start, c.length]).sort()).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(f.length).toBe(3);
  });

  it("puts empty cells in, moving what comes after", () => {
    let f = film();
    for (const op of insertColumnsOps(f, 2, 3)) f = applyOp(f, op);
    expect(order(f)).toEqual(["a@0", "b@1", "c@5", "d@6", "e@7", "f@8"]);
    expect(f.length).toBe(9);
    let g = film();
    for (const op of insertColumnsOps(g, 6, 2)) g = applyOp(g, op);
    expect(order(g)).toEqual(order(film()));
    expect(g.length).toBe(8);
  });

  it("splits a picture held across where cells go in", () => {
    let f = applyOp(emptyFilm({ name: "t", fps: 12, width: 160, height: 90 }), { type: "clip.place", clips: [pic("a", 0, 4)] });
    for (const op of insertColumnsOps(f, 2, 1)) f = applyOp(f, op);
    expect(Object.values(f.clips).map((c) => [c.start, c.length]).sort()).toEqual([
      [0, 2],
      [3, 2],
    ]);
    expect(f.length).toBe(5);
  });

  it("says where a cell goes", () => {
    const cols = [
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ];
    expect(cellAfterRemoving(cols, 0)).toBe(0);
    expect(cellAfterRemoving(cols, 1)).toBeNull();
    expect(cellAfterRemoving(cols, 2)).toBe(1);
    expect(cellAfterRemoving(cols, 6)).toBe(3);
  });
});

describe("removing one cell of a track", () => {
  const two = () => {
    let f = film();
    f = applyOp(f, { type: "track.add", track: { id: "t2", name: "2", visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true } });
    return applyOp(f, { type: "clip.place", clips: [{ ...pic("x", 3), track: "t2" }] });
  };

  it("pulls back what comes after, in that track only", () => {
    let f = two();
    for (const op of removeCellOps(f, PHOTO_TRACK, 1)) f = applyOp(f, op);
    expect(order(f)).toEqual(["a@0", "c@1", "d@2", "x@3", "e@3", "f@4"]);
    expect(f.length).toBe(6);
  });

  it("an empty cell closes up too", () => {
    let f = applyOp(emptyFilm({ name: "t", fps: 12, width: 160, height: 90 }), { type: "clip.place", clips: [pic("a", 0), pic("b", 3)] });
    for (const op of removeCellOps(f, PHOTO_TRACK, 1)) f = applyOp(f, op);
    expect(order(f)).toEqual(["a@0", "b@2"]);
  });

  it("a held picture gets one cell shorter and stays one picture", () => {
    let f = applyOp(emptyFilm({ name: "t", fps: 12, width: 160, height: 90 }), { type: "clip.place", clips: [pic("a", 0, 3), pic("b", 3)] });
    for (const op of removeCellOps(f, PHOTO_TRACK, 1)) f = applyOp(f, op);
    expect(Object.values(f.clips).map((c) => [c.id, c.start, c.length]).sort()).toEqual([
      ["a", 0, 2],
      ["b", 2, 1],
    ]);
  });
});

describe("moving and editing a track as a text", () => {
  // a b _ _ c d _ (a@0 b@1 c@4 d@5), length 7
  const words = () =>
    applyOp(emptyFilm({ name: "t", fps: 12, width: 160, height: 90 }), { type: "clip.place", clips: [pic("a", 0), pic("b", 1), pic("c", 4), pic("d", 5)] });
  const sized = () => applyOp(words(), { type: "film.setLength", length: 7 });

  it("Ctrl + arrow goes from run to run", () => {
    const f = sized();
    expect(nextRunEdge(f, PHOTO_TRACK, 0, 1)).toBe(2);
    expect(nextRunEdge(f, PHOTO_TRACK, 2, 1)).toBe(4);
    expect(nextRunEdge(f, PHOTO_TRACK, 4, 1)).toBe(6);
    expect(nextRunEdge(f, PHOTO_TRACK, 6, 1)).toBe(7);
    expect(nextRunEdge(f, PHOTO_TRACK, 5, -1)).toBe(4);
    expect(nextRunEdge(f, PHOTO_TRACK, 4, -1)).toBe(2);
    expect(nextRunEdge(f, PHOTO_TRACK, 3, -1)).toBe(2);
    expect(nextRunEdge(f, PHOTO_TRACK, 2, -1)).toBe(0);
  });

  it("takes out a stretch of cells, closing up", () => {
    let f = sized();
    for (const op of removeCellsOps(f, PHOTO_TRACK, 1, 3)) f = applyOp(f, op);
    expect(order(f)).toEqual(["a@0", "c@1", "d@2"]);
  });

  it("opens empty cells, the film growing if needed", () => {
    let f = words();
    expect(f.length).toBe(6);
    for (const op of insertCellsOps(f, PHOTO_TRACK, 4, 3)) f = applyOp(f, op);
    expect(order(f)).toEqual(["a@0", "b@1", "c@7", "d@8"]);
    expect(f.length).toBe(9);
  });
});
