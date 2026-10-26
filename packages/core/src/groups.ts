import type { FilmState, Group, GroupId, Track, TrackId } from "./model";

/** A group and the ones it is in, innermost first. */
export function groupChain(film: FilmState, id: GroupId | undefined): Group[] {
  const out: Group[] = [];
  const seen = new Set<GroupId>();
  for (let g = id ? film.groups?.[id] : undefined; g && !seen.has(g.id); g = g.parent ? film.groups?.[g.parent] : undefined) {
    seen.add(g.id);
    out.push(g);
  }
  return out;
}

/** Whether the group `id` is `outer` or inside it. */
export function groupWithin(film: FilmState, id: GroupId | undefined, outer: GroupId): boolean {
  return groupChain(film, id).some((g) => g.id === outer);
}

/** The tracks in a group (in groups inside it too), bottom to top. */
export function groupTracks(film: FilmState, id: GroupId): Track[] {
  return film.tracks.filter((t) => groupWithin(film, t.group, id));
}

/**
 * The tracks edited along with these (in time): every track of the outermost
 * linked group each one is in. Bottom to top, these included.
 */
export function linkedTracks(film: FilmState, ids: readonly TrackId[]): TrackId[] {
  const out = new Set(ids);
  for (const id of ids) {
    const track = film.tracks.find((t) => t.id === id);
    const outer = groupChain(film, track?.group).filter((g) => g.linked).at(-1);
    if (outer) for (const t of groupTracks(film, outer.id)) out.add(t.id);
  }
  return film.tracks.filter((t) => out.has(t.id)).map((t) => t.id);
}

/** The deepest group both are in (none: the top level). */
function commonGroup(film: FilmState, a: GroupId | undefined, b: GroupId | undefined): GroupId | undefined {
  const outer = new Set(groupChain(film, b).map((g) => g.id));
  return groupChain(film, a).find((g) => outer.has(g.id))?.id;
}

/**
 * The group a track at `index` of `tracks` belongs in, from its neighbors, so
 * that every group's tracks stay together: inside a group's tracks it joins
 * the group; next to its own group's tracks it stays in it.
 */
export function groupAtPlace(film: FilmState, tracks: readonly Track[], index: number): GroupId | undefined {
  const track = tracks[index]!;
  const below = tracks[index - 1]?.group;
  const above = tracks[index + 1]?.group;
  const inside = commonGroup(film, below, above);
  const near = new Set([...groupChain(film, below), ...groupChain(film, above)].map((g) => g.id));
  const own = groupChain(film, track.group).find((g) => near.has(g.id))?.id;
  // Both are groups of one neighbor: the deeper one.
  if (!own) return inside;
  if (!inside) return own;
  return groupWithin(film, inside, own) ? inside : own;
}

/** Groups with no tracks left go away (their subgroups too). */
export function pruneGroups(film: FilmState): FilmState {
  if (!film.groups) return film;
  const used = new Set<GroupId>();
  for (const t of film.tracks) for (const g of groupChain(film, t.group)) used.add(g.id);
  const ids = Object.keys(film.groups);
  if (ids.every((id) => used.has(id))) return film;
  return { ...film, groups: Object.fromEntries(Object.entries(film.groups).filter(([id]) => used.has(id))) };
}

/** A row of the timeline, top first: a group's title row, or a track. */
export type TimelineRow =
  | { kind: "group"; group: Group; depth: number; collapsed: boolean; tracks: TrackId[] }
  | { kind: "track"; track: Track; depth: number };

/**
 * The timeline's rows, top first: each group's title row above its tracks,
 * which are hidden while it is closed (`collapsed`).
 */
export function timelineRows(film: FilmState, collapsed: Readonly<Record<GroupId, boolean>>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  // Groups open on the way down, outermost first.
  let open: Group[] = [];
  for (const track of [...film.tracks].reverse()) {
    const chain = groupChain(film, track.group).reverse();
    let same = 0;
    while (same < open.length && same < chain.length && open[same]!.id === chain[same]!.id) same++;
    open = open.slice(0, same);
    let hidden = open.some((g) => collapsed[g.id]);
    for (const g of chain.slice(same)) {
      if (!hidden) rows.push({ kind: "group", group: g, depth: open.length, collapsed: !!collapsed[g.id], tracks: groupTracks(film, g.id).map((t) => t.id) });
      open.push(g);
      hidden ||= !!collapsed[g.id];
    }
    if (!hidden) rows.push({ kind: "track", track, depth: chain.length });
  }
  return rows;
}
