import { describe, expect, it } from "vitest";
import { groupTracks, linkedTracks, timelineRows } from "./groups";
import { type FilmState, IDENTITY_TRANSFORM, type Track, emptyFilm } from "./model";
import { type Op, applyOp } from "./ops";

const track = (id: string): Track => ({ id, name: id, visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true });

/** Tracks a…e above the photos track: [photos, a, b, c, d, e] bottom to top. */
function film(...ops: Op[]): FilmState {
  let f = emptyFilm({ name: "t", fps: 12, width: 160, height: 90 });
  for (const id of ["a", "b", "c", "d", "e"]) f = applyOp(f, { type: "track.add", track: track(id) });
  for (const op of ops) f = applyOp(f, op);
  return f;
}

const order = (f: FilmState) => f.tracks.map((t) => (t.group ? `${t.id}:${t.group}` : t.id)).join(" ");

describe("groups of tracks", () => {
  it("puts a group's tracks together, where the top one was", () => {
    const f = film({ type: "group.add", group: { id: "G", name: "Personaje", linked: true }, tracks: ["a", "c"] });
    expect(order(f)).toBe("photos b a:G c:G d e");
    expect(groupTracks(f, "G").map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("only groups tracks that are in the same group", () => {
    const f = film({ type: "group.add", group: { id: "G", name: "G", linked: true }, tracks: ["a", "b"] });
    expect(() => applyOp(f, { type: "group.add", group: { id: "H", name: "H", linked: true }, tracks: ["b", "c"] })).toThrow();
  });

  it("groups inside groups, and undoing one leaves what it had in the one around it", () => {
    let f = film(
      { type: "group.add", group: { id: "P", name: "Personaje", linked: true }, tracks: ["a", "b"] },
      { type: "group.add", group: { id: "S", name: "Escena", linked: false }, tracks: ["c"], groups: ["P"] },
    );
    expect(f.groups!.P!.parent).toBe("S");
    expect(groupTracks(f, "S").map((t) => t.id)).toEqual(["a", "b", "c"]);
    f = applyOp(f, { type: "group.remove", id: "P" });
    expect(order(f)).toBe("photos a:S b:S c:S d e");
    expect(f.groups!.P).toBeUndefined();
  });

  it("a moved track joins the group it lands inside of, and stays in its own next to it", () => {
    let f = film({ type: "group.add", group: { id: "G", name: "G", linked: true }, tracks: ["b", "c", "d"] });
    f = applyOp(f, { type: "track.move", trackId: "e", index: 3 });
    expect(order(f)).toBe("photos a b:G e:G c:G d:G");
    // To the top of its own group: still in it.
    f = applyOp(f, { type: "track.move", trackId: "b", index: 5 });
    expect(order(f)).toBe("photos a e:G c:G d:G b:G");
    // Away from it: out.
    f = applyOp(f, { type: "track.move", trackId: "b", index: 0 });
    expect(order(f)).toBe("b photos a e:G c:G d:G");
  });

  it("an empty group goes away", () => {
    let f = film({ type: "group.add", group: { id: "G", name: "G", linked: true }, tracks: ["a"] });
    f = applyOp(f, { type: "track.update", trackId: "a", patch: { group: null } });
    expect(f.groups).toEqual({});
    f = film({ type: "group.add", group: { id: "G", name: "G", linked: true }, tracks: ["a"] });
    expect(applyOp(f, { type: "track.remove", trackId: "a" }).groups).toEqual({});
  });

  it("moves a group's tracks together", () => {
    let f = film({ type: "group.add", group: { id: "G", name: "G", linked: true }, tracks: ["a", "b"] });
    f = applyOp(f, { type: "group.move", id: "G", index: 4 });
    expect(order(f)).toBe("photos c d e a:G b:G");
    f = applyOp(f, { type: "group.move", id: "G", index: 0 });
    expect(order(f)).toBe("a:G b:G photos c d e");
  });

  it("a group moved inside another one goes into it", () => {
    let f = film({ type: "group.add", group: { id: "G", name: "G", linked: true }, tracks: ["a"] }, { type: "group.add", group: { id: "H", name: "H", linked: true }, tracks: ["c", "d"] });
    f = applyOp(f, { type: "group.move", id: "G", index: 3 });
    expect(order(f)).toBe("photos b c:H a:G d:H e");
    expect(f.groups!.G!.parent).toBe("H");
  });

  it("links tracks in time through the outermost linked group", () => {
    let f = film(
      { type: "group.add", group: { id: "P", name: "P", linked: false }, tracks: ["a", "b"] },
      { type: "group.add", group: { id: "S", name: "S", linked: true }, tracks: ["c"], groups: ["P"] },
    );
    expect(linkedTracks(f, ["a"])).toEqual(["a", "b", "c"]);
    expect(linkedTracks(f, ["d"])).toEqual(["d"]);
    f = applyOp(f, { type: "group.update", id: "S", patch: { linked: false } });
    expect(linkedTracks(f, ["a"])).toEqual(["a"]);
  });

  it("lists the timeline's rows top first, hiding a closed group's tracks", () => {
    const f = film(
      { type: "group.add", group: { id: "P", name: "P", linked: true }, tracks: ["a", "b"] },
      { type: "group.add", group: { id: "S", name: "S", linked: true }, tracks: ["c"], groups: ["P"] },
    );
    const show = (collapsed: Record<string, boolean>) =>
      timelineRows(f, collapsed).map((r) => (r.kind === "group" ? `[${r.group.id}${r.collapsed ? "+" : ""}]${r.depth}` : `${r.track.id}${r.depth}`));
    expect(show({})).toEqual(["e0", "d0", "[S]0", "c1", "[P]1", "b2", "a2", "photos0"]);
    expect(show({ P: true })).toEqual(["e0", "d0", "[S]0", "c1", "[P+]1", "photos0"]);
    expect(show({ S: true })).toEqual(["e0", "d0", "[S+]0", "photos0"]);
  });
});
