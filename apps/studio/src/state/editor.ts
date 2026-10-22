import {
  type ClipId,
  type FilmState,
  type History,
  type Op,
  PHOTO_TRACK,
  type TrackId,
  isLegacyHistory,
  makeEntry,
  migrateHistory,
  pushEntry,
  redo as historyRedo,
  removeEntry as historyRemove,
  replay,
  setCursor as historySetCursor,
  setEntryEnabled as historySetEnabled,
  tailStartCell,
  trackClips,
  undo as historyUndo,
  updateEntryOp,
} from "@gepetta/core";
import { create } from "zustand";
import { type FilmFile, type FilmMeta, storage } from "../storage";

export interface OnionSettings {
  enabled: boolean;
  /** How many previous pictures to show. */
  count: number;
  /** Opacity of the nearest one; farther ones fade out. */
  opacity: number;
}

export interface Playback {
  startCell: number;
  loop: boolean;
  /** performance.now() when playback (or the current loop) began. */
  startedAt: number;
}

/** The cell tools act on: a moment (cell) in a track. */
export interface GridCursor {
  track: TrackId;
  cell: number;
}

export type SaveStatus = "saved" | "pending" | "error";

interface EditorState {
  filmId: string | null;
  history: History | null;
  /** A converted film's original history, saved along so nothing is lost. */
  legacy: History | null;
  film: FilmState | null;
  /** History entries that no longer apply, with the reason. */
  errors: Record<string, string>;
  /** Where the camera (and later every tool) puts its picture. */
  cursor: GridCursor;
  /** Pictures selected in the timeline (to move, delete, lengthen…). */
  selection: ClipId[];
  /** "live": the camera at the cursor. "frame": the film as it is at the cursor. */
  view: "live" | "frame";
  onion: OnionSettings;
  loop: boolean;
  tailSeconds: number;
  /** How many photos to average per capture (1 = off). */
  captureAverage: number;
  /** Cells each new photo lasts, and the cursor then moves: 1 = "on ones", 2 = "on twos". */
  captureStep: number;
  playback: Playback | null;
  saveStatus: SaveStatus;

  open(id: string): Promise<void>;
  close(): Promise<void>;
  /** Records a step; `after` moves the cursor or changes the selection in the same go. */
  commit(ops: Op[], label?: string, after?: { cursor?: GridCursor; selection?: ClipId[] }): void;
  undo(): void;
  redo(): void;
  /** History cursor (undo position), not the grid cursor. */
  setCursor(cursor: number): void;
  setEntryEnabled(id: string, enabled: boolean): void;
  removeEntry(id: string): void;
  updateEntryOp(id: string, opIndex: number, op: Op): void;
  /** Moves the grid cursor; keeps the track when not given. */
  moveTo(cell: number, track?: TrackId, view?: "live" | "frame"): void;
  setSelection(ids: ClipId[]): void;
  setView(view: "live" | "frame"): void;
  setOnion(patch: Partial<OnionSettings>): void;
  set(patch: Partial<Pick<EditorState, "loop" | "tailSeconds" | "captureAverage" | "captureStep">>): void;
  play(tail?: boolean): void;
  stop(): void;
}

const SAVE_DELAY_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: (() => Promise<void>) | null = null;

function metaOf(id: string, film: FilmState): FilmMeta {
  const photos = trackClips(film, PHOTO_TRACK);
  const first = photos[0] ?? Object.values(film.clips).sort((a, b) => a.start - b.start)[0];
  return {
    id,
    name: film.settings.name,
    updatedAt: Date.now(),
    frameCount: Object.keys(film.clips).length,
    thumb: first?.media.thumb ?? null,
  };
}

async function flushSave() {
  clearTimeout(saveTimer);
  const save = pendingSave;
  pendingSave = null;
  await save?.();
}

/** Keeps the cursor on an existing track, and the selection on existing pictures. */
function fixCursor(film: FilmState, cursor: GridCursor): GridCursor {
  const track = film.tracks.some((t) => t.id === cursor.track) ? cursor.track : PHOTO_TRACK;
  return { track, cell: Math.max(0, cursor.cell) };
}

/** The first free cell after the last photo: where shooting continues when a film opens. */
function nextPhotoCell(film: FilmState): number {
  const last = trackClips(film, PHOTO_TRACK).at(-1);
  return last ? last.start + last.length : 0;
}

export const useEditor = create<EditorState>((set, get) => {
  function scheduleSave(id: string, history: History, film: FilmState) {
    const legacy = get().legacy;
    pendingSave = async () => {
      try {
        const file: FilmFile = { version: 2, id, history, ...(legacy && { legacy }) };
        await storage.saveFilm(file, metaOf(id, film));
        if (get().filmId === id && get().history === history) set({ saveStatus: "saved" });
      } catch (e) {
        console.error("[gepetta] save failed", e);
        set({ saveStatus: "error" });
      }
    };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  /** Recomputes the film from history and schedules a save. */
  function setHistory(history: History, after?: { cursor?: GridCursor; selection?: ClipId[] }) {
    const { film, errors } = replay(history);
    const id = get().filmId!;
    const selection = (after?.selection ?? get().selection).filter((c) => film.clips[c]);
    set({
      history,
      film,
      errors,
      cursor: fixCursor(film, after?.cursor ?? get().cursor),
      selection,
      saveStatus: "pending",
    });
    scheduleSave(id, history, film);
  }

  return {
    filmId: null,
    history: null,
    legacy: null,
    film: null,
    errors: {},
    cursor: { track: PHOTO_TRACK, cell: 0 },
    selection: [],
    view: "live",
    onion: { enabled: true, count: 1, opacity: 0.4 },
    loop: true,
    tailSeconds: 3,
    captureAverage: 1,
    captureStep: 1,
    playback: null,
    saveStatus: "saved",

    async open(id) {
      await flushSave();
      const file = await storage.loadFilm(id);
      // Films from before the grid timeline are converted once; their old history stays in the file.
      const converted = isLegacyHistory(file.history);
      const history = converted ? migrateHistory(file.history) : file.history;
      const legacy = converted ? file.history : (file.legacy ?? null);
      const { film, errors } = replay(history);
      set({
        filmId: id,
        history,
        legacy,
        film,
        errors,
        cursor: { track: PHOTO_TRACK, cell: nextPhotoCell(film) },
        selection: [],
        view: "live",
        playback: null,
        saveStatus: converted ? "pending" : "saved",
      });
      if (converted) {
        scheduleSave(id, history, film);
        await flushSave();
      }
    },

    async close() {
      await flushSave();
      set({ filmId: null, history: null, legacy: null, film: null, errors: {}, selection: [], playback: null });
    },

    commit(ops, label, after) {
      const { history } = get();
      if (!history || ops.length === 0) return;
      setHistory(pushEntry(history, makeEntry(ops, label)), after);
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

    moveTo(cell, track, view) {
      const cursor = { track: track ?? get().cursor.track, cell: Math.max(0, cell) };
      set({ cursor, playback: null, ...(view && { view }) });
    },
    setSelection(ids) {
      set({ selection: ids });
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
      if (!film || film.length === 0) return;
      set({
        playback: {
          startCell: tail ? tailStartCell(film, tailSeconds) : 0,
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
