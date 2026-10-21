import {
  type FilmState,
  type FrameId,
  type History,
  type Op,
  makeEntry,
  pushEntry,
  redo as historyRedo,
  removeEntry as historyRemove,
  replay,
  setCursor as historySetCursor,
  setEntryEnabled as historySetEnabled,
  tailStartTick,
  undo as historyUndo,
  updateEntryOp,
} from "@gepetta/core";
import { create } from "zustand";
import { type FilmMeta, storage } from "../storage";

export interface OnionSettings {
  enabled: boolean;
  /** How many previous frames to show. */
  count: number;
  /** Opacity of the nearest one; farther ones fade out. */
  opacity: number;
}

export interface Playback {
  startTick: number;
  loop: boolean;
  /** performance.now() when playback (or the current loop) began. */
  startedAt: number;
}

export type SaveStatus = "saved" | "pending" | "error";

interface EditorState {
  filmId: string | null;
  history: History | null;
  film: FilmState | null;
  /** History entries that no longer apply, with the reason. */
  errors: Record<string, string>;
  /** The selected frame; captures and imports go right after it. null = before the first frame. */
  selected: FrameId | null;
  view: "live" | "frame";
  onion: OnionSettings;
  loop: boolean;
  tailSeconds: number;
  /** How many photos to average per capture (1 = off). */
  captureAverage: number;
  playback: Playback | null;
  saveStatus: SaveStatus;

  open(id: string): Promise<void>;
  close(): Promise<void>;
  commit(ops: Op[], label?: string, select?: FrameId | null): void;
  undo(): void;
  redo(): void;
  setCursor(cursor: number): void;
  setEntryEnabled(id: string, enabled: boolean): void;
  removeEntry(id: string): void;
  updateEntryOp(id: string, opIndex: number, op: Op): void;
  select(id: FrameId | null, view?: "live" | "frame"): void;
  setView(view: "live" | "frame"): void;
  setOnion(patch: Partial<OnionSettings>): void;
  set(patch: Partial<Pick<EditorState, "loop" | "tailSeconds" | "captureAverage">>): void;
  play(tail?: boolean): void;
  stop(): void;
}

const SAVE_DELAY_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: (() => Promise<void>) | null = null;

function metaOf(id: string, film: FilmState): FilmMeta {
  const first = film.frameOrder[0];
  return {
    id,
    name: film.settings.name,
    updatedAt: Date.now(),
    frameCount: film.frameOrder.length,
    thumb: first ? (film.frames[first]!.layers[0]?.media.thumb ?? null) : null,
  };
}

async function flushSave() {
  clearTimeout(saveTimer);
  const save = pendingSave;
  pendingSave = null;
  await save?.();
}

/** Keeps the selection on an existing frame after the film changed. */
function fixSelection(film: FilmState, selected: FrameId | null): FrameId | null {
  if (selected && film.frames[selected]) return selected;
  return film.frameOrder.at(-1) ?? null;
}

export const useEditor = create<EditorState>((set, get) => {
  /** Recomputes the film from history and schedules a save. */
  function setHistory(history: History, select?: FrameId | null) {
    const { film, errors } = replay(history);
    const id = get().filmId!;
    set({
      history,
      film,
      errors,
      selected: fixSelection(film, select === undefined ? get().selected : select),
      saveStatus: "pending",
    });
    pendingSave = async () => {
      try {
        await storage.saveFilm({ version: 1, id, history }, metaOf(id, film));
        if (get().filmId === id && get().history === history) set({ saveStatus: "saved" });
      } catch (e) {
        console.error("[gepetta] save failed", e);
        set({ saveStatus: "error" });
      }
    };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  return {
    filmId: null,
    history: null,
    film: null,
    errors: {},
    selected: null,
    view: "live",
    onion: { enabled: true, count: 1, opacity: 0.4 },
    loop: true,
    tailSeconds: 3,
    captureAverage: 1,
    playback: null,
    saveStatus: "saved",

    async open(id) {
      await flushSave();
      const file = await storage.loadFilm(id);
      const { film, errors } = replay(file.history);
      set({
        filmId: id,
        history: file.history,
        film,
        errors,
        selected: film.frameOrder.at(-1) ?? null,
        view: "live",
        playback: null,
        saveStatus: "saved",
      });
    },

    async close() {
      await flushSave();
      set({ filmId: null, history: null, film: null, errors: {}, selected: null, playback: null });
    },

    commit(ops, label, select) {
      const { history } = get();
      if (!history || ops.length === 0) return;
      setHistory(pushEntry(history, makeEntry(ops, label)), select);
    },

    undo() {
      const { history } = get();
      if (history) setHistory(historyUndo(history));
    },
    redo() {
      const { history } = get();
      if (history) setHistory(historyRedo(history));
    },
    setCursor(cursor) {
      const { history } = get();
      if (history) setHistory(historySetCursor(history, cursor));
    },
    setEntryEnabled(id, enabled) {
      const { history } = get();
      if (history) setHistory(historySetEnabled(history, id, enabled));
    },
    removeEntry(id) {
      const { history } = get();
      if (history) setHistory(historyRemove(history, id));
    },
    updateEntryOp(id, opIndex, op) {
      const { history } = get();
      if (history) setHistory(updateEntryOp(history, id, opIndex, op));
    },

    select(id, view = "frame") {
      set({ selected: id, view, playback: null });
    },
    setView(view) {
      set({ view, playback: null });
    },
    setOnion(patch) {
      set({ onion: { ...get().onion, ...patch } });
    },
    set(patch) {
      set(patch);
    },

    play(tail = false) {
      const { film, tailSeconds, loop } = get();
      if (!film || film.frameOrder.length === 0) return;
      set({
        playback: {
          startTick: tail ? tailStartTick(film, tailSeconds) : 0,
          loop,
          startedAt: performance.now(),
        },
      });
    },
    stop() {
      set({ playback: null });
    },
  };
});

window.addEventListener("beforeunload", () => void flushSave());
