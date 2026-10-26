import {
  type ColumnRange,
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
  playedCell,
  wrapCell,
  trackClips,
  undo as historyUndo,
  updateEntryOp,
} from "@gepetta/core";
import { create } from "zustand";
import { type FilmFile, type FilmMeta, storage } from "../storage";
import type { Release } from "./releases";

export interface OnionSettings {
  enabled: boolean;
  /** How many previous pictures to show. */
  count: number;
  /** Opacity of the nearest one; farther ones fade out. */
  opacity: number;
}

export interface Playback {
  startCell: number;
  /** Where a loop starts over: the film's start, or the start of the last seconds. */
  loopFrom: number;
  loop: boolean;
  /** performance.now() when playback (or the current loop) began. */
  startedAt: number;
}

/** The cell tools act on: a moment (cell) in a track. */
export interface GridCursor {
  track: TrackId;
  cell: number;
}

/** The cell being shown now during playback. */
export function playbackCell(playback: Playback, fps: number, now = performance.now()): number {
  return playback.startCell + Math.floor(((now - playback.startedAt) * fps) / 1000);
}

export type SaveStatus = "saved" | "pending" | "error";

export interface EditorState {
  filmId: string | null;
  history: History | null;
  /** A converted film's original history, saved along so nothing is lost. */
  legacy: History | null;
  /** Published versions, oldest first. */
  releases: Release[];
  film: FilmState | null;
  /** History entries that no longer apply, with the reason. */
  errors: Record<string, string>;
  /** Where the camera (and later every tool) puts its picture. */
  cursor: GridCursor;
  /** The cursor last moved on by itself (photos, recording): the timeline keeps it centered. */
  cursorAlong: boolean;
  /** Pictures selected in the timeline (to move, delete, lengthen…). */
  selection: ClipId[];
  /**
   * Columns selected in the results row: stretches of cells [start, end) of
   * every track, the film as it comes out there (sorted, apart; one stretch
   * can be moved as a whole; effects will go here).
   */
  columns: ColumnRange[] | null;
  /**
   * Cells picked with ⇧ + arrows, as text is: from the `anchor` cell of the
   * `track` it started in to the cursor (both corners in), across the tracks
   * between them.
   */
  span: { track: TrackId; anchor: number } | null;
  onion: OnionSettings;
  loop: boolean;
  tailSeconds: number;
  /** How many photos to average per capture (1 = off). */
  captureAverage: number;
  /**
   * How opaque the selected picture shows on top of everything, to see what is
   * under it. Only for looking: it changes nothing in the film.
   */
  focusOpacity: number;
  /** Cells each new photo lasts, and the cursor then moves: 1 = "on ones", 2 = "on twos". */
  captureStep: number;
  /** What the big camera button does: a photo, or start and stop recording video. */
  captureMode: "photo" | "video";
  playback: Playback | null;
  saveStatus: SaveStatus;

  open(id: string): Promise<void>;
  close(): Promise<void>;
  /**
   * Records a step; `after` moves the cursor or changes the selection in the
   * same go. With `amend` (the id this returned before), the ops join that step
   * if it is still the last one done, e.g. pictures of a video being recorded.
   * Returns the step's id.
   */
  commit(ops: Op[], label?: string, after?: { cursor?: GridCursor; selection?: ClipId[]; amend?: string }): string | null;
  undo(): void;
  redo(): void;
  /** History cursor (undo position), not the grid cursor. */
  setCursor(cursor: number): void;
  setEntryEnabled(id: string, enabled: boolean): void;
  removeEntry(id: string): void;
  updateEntryOp(id: string, opIndex: number, op: Op): void;
  /** Moves the grid cursor; keeps the track when not given. `along`: it moves on by itself. */
  moveTo(cell: number, track?: TrackId, along?: boolean): void;
  setSelection(ids: ClipId[]): void;
  addRelease(release: Release): void;
  setColumns(columns: ColumnRange[] | null): void;
  setSpan(span: EditorState["span"]): void;
  setOnion(patch: Partial<OnionSettings>): void;
  set(patch: Partial<Pick<EditorState, "loop" | "tailSeconds" | "captureAverage" | "captureStep" | "captureMode" | "focusOpacity">>): void;
  /** Plays from the cursor (from the start if the cursor is past the end), or the last seconds. */
  play(tail?: boolean): void;
  /** Stops where it is: the cursor moves to the cell being shown. */
  pause(): void;
  /** Stops and goes back to the cursor (the selected cell). */
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
  // A loop film has no cells past its end: they are its first ones again.
  return { track, cell: wrapCell(film, Math.max(0, cursor.cell)) };
}

/** The first free cell after the last photo: where shooting continues when a film opens (a loop: its first cell). */
function nextPhotoCell(film: FilmState): number {
  const last = trackClips(film, PHOTO_TRACK).at(-1);
  return wrapCell(film, last ? last.start + last.length : 0);
}

export const useEditor = create<EditorState>((set, get) => {
  function scheduleSave(id: string, history: History, film: FilmState) {
    const legacy = get().legacy;
    pendingSave = async () => {
      try {
        const releases = get().releases;
        const file: FilmFile = { version: 2, id, history, ...(legacy && { legacy }), ...(releases.length && { releases }) };
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
      cursorAlong: false,
      selection,
      saveStatus: "pending",
    });
    scheduleSave(id, history, film);
  }

  return {
    filmId: null,
    history: null,
    legacy: null,
    releases: [],
    film: null,
    errors: {},
    cursor: { track: PHOTO_TRACK, cell: 0 },
    cursorAlong: false,
    selection: [],
    columns: null,
    span: null,
    onion: { enabled: true, count: 1, opacity: 0.4 },
    loop: true,
    tailSeconds: 3,
    captureAverage: 1,
    captureStep: 1,
    captureMode: "photo",
    focusOpacity: 1,
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
        releases: file.releases ?? [],
        film,
        errors,
        cursor: { track: PHOTO_TRACK, cell: nextPhotoCell(film) },
        cursorAlong: false,
        selection: [],
        columns: null,
        span: null,
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
      set({ filmId: null, history: null, legacy: null, releases: [], film: null, errors: {}, selection: [], playback: null });
    },

    commit(ops, label, after) {
      const { history } = get();
      if (!history || ops.length === 0) return null;
      const last = history.entries[history.cursor - 1];
      if (after?.amend && last?.id === after.amend) {
        const entry = { ...last, ops: [...last.ops, ...ops], ...(label && { label }) };
        setHistory({ ...history, entries: history.entries.map((e) => (e.id === last.id ? entry : e)) }, after);
        return last.id;
      }
      const entry = makeEntry(ops, label);
      setHistory(pushEntry(history, entry), after);
      return entry.id;
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

    moveTo(cell, track, along = false) {
      const film = get().film;
      const at = Math.max(0, cell);
      const cursor = { track: track ?? get().cursor.track, cell: film ? wrapCell(film, at) : at };
      // Moving on by itself (shooting, recording) lets picked cells go.
      set({ cursor, cursorAlong: along, playback: null, ...(along && { span: null }) });
    },
    setSelection(ids) {
      // Pictures or columns: one kind of selection at a time.
      set({ selection: ids, ...(ids.length && { columns: null }) });
    },
    addRelease(release) {
      const { filmId, history, film } = get();
      if (!filmId || !history || !film) return;
      set({ releases: [...get().releases, release], saveStatus: "pending" });
      scheduleSave(filmId, history, film);
    },
    setSpan(span) {
      set({ span });
    },
    setColumns(columns) {
      const picked = columns?.length ? columns : null;
      set({ columns: picked, ...(picked && { selection: [] }) });
    },
    setOnion(patch) {
      set({ onion: { ...get().onion, ...patch } });
    },
    set(patch) {
      set(patch);
    },

    play(tail = false) {
      const { film, tailSeconds, loop, cursor } = get();
      if (!film || film.length === 0) return;
      const tailStart = tailStartCell(film, tailSeconds);
      const from = tail ? tailStart : cursor.cell < film.length - 1 ? cursor.cell : 0;
      set({ playback: { startCell: from, loopFrom: tail ? tailStart : 0, loop, startedAt: performance.now() } });
    },
    pause() {
      const { playback, film, cursor } = get();
      if (!playback || !film) return;
      const cell = Math.min(film.length - 1, playedCell(film, playbackCell(playback, film.settings.fps)));
      set({ playback: null, cursor: { ...cursor, cell }, cursorAlong: false });
    },
    stop() {
      set({ playback: null });
    },
  };
});

window.addEventListener("beforeunload", () => void flushSave());

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
