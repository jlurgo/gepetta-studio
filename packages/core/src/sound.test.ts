import { describe, expect, it } from "vitest";
import { insertCellsOps, removeCellOps } from "./columns";
import { cellIndex, stackAt } from "./layers";
import { duckedAt, soundRuns, trackSounds, trackVolume } from "./sound";
import { type Clip, type FilmState, IDENTITY_TRANSFORM, PHOTO_TRACK, cellGain, cellValue, emptyFilm } from "./model";
import { type Op, applyOp } from "./ops";

const media = { original: "w", proxy: "w", thumb: "w", width: 10, height: 10 };
const ref = { original: "snd", peaks: "pk", duration: 5 };

const clip = (id: string, track: string, start: number, length: number, from?: number): Clip => ({
  id,
  track,
  start,
  length,
  media,
  name: id,
  visible: true,
  opacity: 1,
  transform: IDENTITY_TRANSFORM,
  ...(from !== undefined && { sound: { ref, from } }),
});

/** A sound track "s" with a 10-cell sound from cell 2, and a picture at cell 4. */
function film(...ops: Op[]): FilmState {
  let f = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
  f = applyOp(f, { type: "track.add", track: { id: "s", name: "Sonido", kind: "sound", visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true } });
  f = applyOp(f, { type: "clip.place", clips: [clip("a", "s", 2, 10, 0), clip("p", PHOTO_TRACK, 4, 1)] });
  for (const op of ops) f = applyOp(f, op);
  return f;
}

const sounds = (f: FilmState) =>
  Object.values(f.clips)
    .filter((c) => c.sound)
    .sort((a, b) => a.start - b.start)
    .map((c) => `${c.start}+${c.length}@${Math.round(c.sound!.from * 12)}`);

describe("sound clips", () => {
  it("are slices of their sound: taking a cell out drops that slice", () => {
    let f = film();
    for (const op of removeCellOps(f, "s", 5)) f = applyOp(f, op);
    // Cells 2–4 are slices 0–2; slice 3 is gone; 5–10 are slices 4–9.
    expect(sounds(f)).toEqual(["2+3@0", "5+6@4"]);
  });

  it("an empty cell put in splits the sound, which goes on after it", () => {
    let f = film();
    for (const op of insertCellsOps(f, "s", 4, 2)) f = applyOp(f, op);
    expect(sounds(f)).toEqual(["2+2@0", "6+8@2"]);
  });

  it("moving part of a sound takes those slices", () => {
    const f = film({ type: "cells.move", start: 6, length: 3, to: 20, tracks: ["s"] });
    expect(sounds(f)).toEqual(["2+4@0", "9+3@7", "20+3@4"]);
  });

  it("keeps its moment and length in seconds when the speed changes", () => {
    const f = film({ type: "film.setFps", fps: 24 });
    expect(Object.values(f.clips).find((c) => c.sound)).toMatchObject({ start: 4, length: 20, sound: { from: 0 } });
    // Pictures keep their cells.
    expect(f.clips.p).toMatchObject({ start: 4, length: 1 });
  });

  it("is not drawn, and only goes in sound tracks", () => {
    const f = film();
    expect(stackAt(f, 4).map((s) => s.clipId)).toEqual(["p"]);
    expect(() => applyOp(f, { type: "clip.place", clips: [clip("x", "s", 20, 1)] })).toThrow();
    expect(() => applyOp(f, { type: "clip.place", clips: [clip("y", PHOTO_TRACK, 20, 1, 0)] })).toThrow();
  });

  it("plays as runs: cells one after another in a clip go on without a cut", () => {
    const f = film();
    const runs = (cells: number[]) => soundRuns(f, cells).map((r) => `${r.at}:${r.cell}+${r.count}`);
    expect(runs([0, 1, 2, 3, 4, 5])).toEqual(["2:2+4"]);
    // Going back (ping-pong) or jumping: one run per cell.
    expect(runs([5, 4, 3])).toEqual(["0:5+1", "1:4+1", "2:3+1"]);
    expect(soundRuns(f, [3, 4], ["photos"])).toEqual([]);
  });

  it("keeps each cell's volume when it is cut, moved or the speed changes", () => {
    const gains = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    let f = film({ type: "clip.update", id: "a", patch: { sound: { ref, from: 0, gains } } });
    const volumes = (g: FilmState) => {
      const out: number[] = [];
      for (const c of Object.values(g.clips).filter((c) => c.sound).sort((x, y) => x.start - y.start)) for (let i = c.start; i < c.start + c.length; i++) out.push(cellGain(c, i));
      return out;
    };
    expect(cellGain(f.clips.a!, 4)).toBe(0.2);
    // Taking cell 5 (the fourth) out: the cells after it keep theirs.
    let g = f;
    for (const op of removeCellOps(g, "s", 5)) g = applyOp(g, op);
    expect(volumes(g)).toEqual([0, 0.1, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    // Moving part of it.
    g = applyOp(f, { type: "cells.move", start: 6, length: 3, to: 20, tracks: ["s"] });
    expect(volumes(g)).toEqual([0, 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 0.4, 0.5, 0.6]);
    // Twice the speed: each cell's volume in two cells.
    f = applyOp(f, { type: "film.setFps", fps: 24 });
    expect(volumes(f).slice(0, 6)).toEqual([0, 0, 0.1, 0.1, 0.2, 0.2]);
    // The speaker of each cell goes along the same way.
    let p = film({ type: "clip.update", id: "a", patch: { sound: { ref, from: 0, pans: [-1, -0.5, 0, 0.5, 1] } } });
    for (const op of removeCellOps(p, "s", 3)) p = applyOp(p, op);
    const pans: number[] = [];
    for (const c of Object.values(p.clips).filter((c) => c.sound).sort((x, y) => x.start - y.start)) for (let i = c.start; i < c.start + c.length; i++) pans.push(cellValue(c, "pans", i));
    expect(pans.slice(0, 5)).toEqual([-1, 0, 0.5, 1, 0]);
    // Only a sound has a sound's volume.
    expect(() => applyOp(f, { type: "clip.update", id: "p", patch: { sound: { ref, from: 0 } } })).toThrow();
  });

  it("goes by its groups' volume and silence too", () => {
    let f = film({ type: "track.add", track: { id: "s2", name: "Música", kind: "sound", visible: true, opacity: 0.5, transform: IDENTITY_TRANSFORM, exported: true } });
    f = applyOp(f, { type: "group.add", group: { id: "g", name: "Sonidos", linked: false }, tracks: ["s", "s2"] });
    f = applyOp(f, { type: "group.add", group: { id: "h", name: "Todo", linked: false }, groups: ["g"] });
    f = applyOp(f, { type: "group.update", id: "g", patch: { volume: 0.5 } });
    f = applyOp(f, { type: "group.update", id: "h", patch: { volume: 0.8 } });
    expect(trackVolume(f, f.tracks.find((t) => t.id === "s2")!)).toBeCloseTo(0.2);
    expect(soundRuns(f, [2])).toHaveLength(1);
    f = applyOp(f, { type: "group.update", id: "h", patch: { muted: true } });
    expect(trackSounds(f, f.tracks.find((t) => t.id === "s")!)).toBe(false);
    expect(soundRuns(f, [2])).toEqual([]);
  });

  it("a track that ducks goes down where another one sounds", () => {
    let f = film({ type: "track.add", track: { id: "m", name: "Música", kind: "sound", visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true, duck: true } });
    f = applyOp(f, { type: "clip.place", clips: [clip("mu", "m", 0, 20, 0)] });
    const music = f.tracks.find((t) => t.id === "m")!;
    const index = cellIndex(f);
    // The voice ("s") sounds in cells 2–11.
    expect([1, 2, 11, 12].map((c) => duckedAt(f, index, music, c))).toEqual([false, true, true, false]);
    expect(duckedAt(f, index, f.tracks.find((t) => t.id === "s")!, 2)).toBe(false);
  });
});
