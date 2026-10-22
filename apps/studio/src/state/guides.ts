import { DEFAULT_GUIDES, type GuideSettings } from "@gepetta/core";
import { create } from "zustand";

/**
 * Guides per film. They belong to the set and camera position, not to the
 * animation, so they live outside the film's history (and outside undo).
 * Kept in this browser's localStorage.
 */

const STORAGE_KEY = "gepetta.guides";

function load(): Record<string, GuideSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GuideSettings>) : {};
  } catch {
    return {};
  }
}

function save(all: Record<string, GuideSettings>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private window or full storage: guides just are not remembered.
  }
}

/**
 * A film's guides, with fields added after they were saved filled in.
 * Components select `byFilm[filmId]` (stable) and call this in a useMemo:
 * a selector that builds a new object every time re-renders forever.
 */
export function guidesOf(g: Partial<GuideSettings> | undefined): GuideSettings {
  return {
    ...DEFAULT_GUIDES,
    ...g,
    grid: { ...DEFAULT_GUIDES.grid, ...g?.grid },
    perspective: { ...DEFAULT_GUIDES.perspective, ...g?.perspective },
  };
}

interface GuidesState {
  byFilm: Record<string, GuideSettings>;
  /** The guides panel is open: vanishing points can be dragged and the view zooms out to show them. */
  editing: boolean;
  get(filmId: string): GuideSettings;
  update(filmId: string, patch: Partial<GuideSettings>): void;
  setEditing(editing: boolean): void;
}

export const useGuides = create<GuidesState>((set, get) => ({
  byFilm: load(),
  editing: false,
  get: (filmId) => guidesOf(get().byFilm[filmId]),
  update(filmId, patch) {
    const byFilm = { ...get().byFilm, [filmId]: { ...get().get(filmId), ...patch } };
    set({ byFilm });
    save(byFilm);
  },
  setEditing: (editing) => set({ editing }),
}));
