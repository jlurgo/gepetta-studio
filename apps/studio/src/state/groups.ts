import { type FilmState, type GroupId, type TrackId, groupChain, groupTracks, linkedTracks, newId, timelineRows } from "@gepetta/core";
import { create } from "zustand";
import { useBusy } from "./busy";
import { useEditor } from "./editor";

/**
 * Groups of tracks in the timeline: which are closed (shown as one row), the
 * track heads picked to make a group, and whether edits keep to one track of
 * a linked group (Alt held) instead of going to all of them.
 */
interface GroupsState {
  /** Closed groups: their tracks hide behind the group's row. */
  collapsed: Record<GroupId, boolean>;
  /** Track heads picked with ⇧ or ⌘/Ctrl (to group them). */
  picked: TrackId[];
  toggle(id: GroupId): void;
  setPicked(picked: TrackId[]): void;
}

const COLLAPSED_KEY = "gepetta.collapsedGroups";

function loadCollapsed(): Record<GroupId, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const useGroups = create<GroupsState>((set, get) => ({
  collapsed: loadCollapsed(),
  picked: [],
  toggle: (id) => {
    const collapsed = { ...get().collapsed };
    if (collapsed[id]) delete collapsed[id];
    else collapsed[id] = true;
    set({ collapsed });
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      // Not remembered.
    }
  },
  setPicked: (picked) => set({ picked }),
}));

/** Alt held: edits keep to the track they are made in, even in a linked group. */
let alone = false;
if (typeof window !== "undefined") {
  const track = (e: KeyboardEvent | PointerEvent) => {
    alone = e.altKey;
  };
  window.addEventListener("keydown", track, true);
  window.addEventListener("keyup", track, true);
  window.addEventListener("pointerdown", track, true);
  window.addEventListener("blur", () => (alone = false));
}

/** The tracks an edit in these goes to: their linked groups' too (not with Alt held). */
export function reach(film: FilmState, tracks: readonly TrackId[]): TrackId[] {
  return alone ? film.tracks.filter((t) => tracks.includes(t.id)).map((t) => t.id) : linkedTracks(film, tracks);
}

/** The outermost closed group a track is hidden in, if any. */
export function hiddenIn(film: FilmState, track: TrackId, collapsed = useGroups.getState().collapsed): GroupId | null {
  const t = film.tracks.find((x) => x.id === track);
  return (
    groupChain(film, t?.group)
      .filter((g) => collapsed[g.id])
      .at(-1)?.id ?? null
  );
}

/**
 * The rows ↑ ↓ go through, bottom to top: each track shown, and each closed
 * group as its top track (an edit there goes to the whole group when linked).
 */
export function rowStops(film: FilmState): TrackId[] {
  const { collapsed } = useGroups.getState();
  const out: TrackId[] = [];
  for (const row of timelineRows(film, collapsed).reverse()) {
    if (row.kind === "track") out.push(row.track.id);
    else if (row.collapsed) out.push(row.tracks.at(-1)!);
  }
  return out;
}

/**
 * Ctrl + G: groups the picked track heads (or the tracks of the picked cells,
 * or the cursor's track), with what is in the same group as them; a track in
 * a group inside that one brings its whole group along.
 */
export function groupPicked(tracks: TrackId[]) {
  const { film, commit } = useEditor.getState();
  if (!film || !tracks.length) return;
  const chains = tracks.map((id) => groupChain(film, film.tracks.find((t) => t.id === id)?.group).map((g) => g.id));
  // The deepest group they are all in.
  const parent = chains[0]!.find((g) => chains.every((c) => c.includes(g)));
  const items = { tracks: new Set<TrackId>(), groups: new Set<GroupId>() };
  tracks.forEach((id, i) => {
    const chain = chains[i]!;
    const k = parent ? chain.indexOf(parent) : chain.length;
    if (k === 0) items.tracks.add(id);
    else items.groups.add(chain[k - 1]!);
  });
  const count = Object.keys(film.groups ?? {}).length;
  const group = { id: newId(), name: `Grupo ${count + 1}`, linked: true, ...(parent ? { parent } : {}) };
  commit([{ type: "group.add", group, tracks: [...items.tracks], groups: [...items.groups] }], `Agrupar en "${group.name}"`);
  useGroups.getState().setPicked([]);
  useBusy.getState().notify(`«${group.name}»: sus tracks quedan vinculados (lo que metas, borres, cortes o pegues en uno pasa en todos; con Alt, solo en uno).`);
}

/** Ctrl + ⇧ + G: undoes the innermost group the track is in. */
export function ungroup(track: TrackId) {
  const { film, commit } = useEditor.getState();
  const t = film?.tracks.find((x) => x.id === track);
  if (!film || !t?.group) return;
  commit([{ type: "group.remove", id: t.group }], `Desagrupar "${film.groups?.[t.group]?.name ?? ""}"`);
}

export function setLinked(id: GroupId, linked: boolean) {
  useEditor.getState().commit([{ type: "group.update", id, patch: { linked } }]);
}

export function renameGroup(id: GroupId, name: string) {
  const film = useEditor.getState().film;
  if (!film?.groups?.[id] || !name.trim() || film.groups[id]!.name === name.trim()) return;
  useEditor.getState().commit([{ type: "group.update", id, patch: { name: name.trim() } }]);
}

/** Opens or closes a group; closing it with the cursor inside takes the cursor to its row. */
export function toggleGroup(id: GroupId) {
  useGroups.getState().toggle(id);
  const { film, cursor, moveTo } = useEditor.getState();
  if (!film || !useGroups.getState().collapsed[id]) return;
  const members = groupTracks(film, id);
  if (members.some((t) => t.id === cursor.track)) moveTo(cursor.cell, members.at(-1)!.id);
}
