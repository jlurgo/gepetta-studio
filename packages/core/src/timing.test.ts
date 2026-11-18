import { describe, expect, it } from "vitest";
import { type FilmState, emptyFilm } from "./model";
import { playedEnd, tailStartCell } from "./timing";

/** A film at 12 fps whose pictures end at `content`, `length` cells long. */
function film(content: number, length: number): FilmState {
  const f = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
  const clips = content ? { a: { id: "a", track: f.tracks[0]!.id, start: 0, length: content } } : {};
  return { ...f, length, clips } as unknown as FilmState;
}

describe("the last seconds of a film", () => {
  it("are counted from its last picture, not from empty cells left at the end", () => {
    expect(playedEnd(film(34, 36))).toBe(34);
    expect(tailStartCell(film(34, 36), 1)).toBe(22);
  });
  it("start at the first cell when the film is shorter", () => {
    expect(tailStartCell(film(20, 20), 3)).toBe(0);
  });
  it("of a film with nothing are its last cells", () => {
    expect(playedEnd(film(0, 24))).toBe(24);
    expect(tailStartCell(film(0, 24), 1)).toBe(12);
  });
});
