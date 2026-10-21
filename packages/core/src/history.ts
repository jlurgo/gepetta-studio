import { newId } from "./ids";
import type { FilmSettings, FilmState } from "./model";
import { emptyFilm } from "./model";
import type { Op } from "./ops";
import { applyOp, describeOp, OpError } from "./ops";

/**
 * One step of the history timeline. Its ops apply atomically: importing 40
 * pictures is one step that can be disabled or removed as a whole.
 */
export interface HistoryEntry {
  id: string;
  label: string;
  ops: Op[];
  enabled: boolean;
  createdAt: number;
}

/**
 * Fusion-360-style history: the film is the replay of the enabled entries before
 * `cursor`. Undo/redo move the cursor; new steps are inserted at the cursor, so
 * nothing after it is lost.
 */
export interface History {
  initial: FilmSettings;
  entries: HistoryEntry[];
  cursor: number;
}

export interface Replay {
  film: FilmState;
  /** Entries that no longer apply (e.g. their frame was deleted earlier), with the reason. */
  errors: Record<string, string>;
}

export function createHistory(initial: FilmSettings): History {
  return { initial, entries: [], cursor: 0 };
}

export function makeEntry(ops: Op[], label?: string): HistoryEntry {
  const first = ops[0];
  const fallback = first ? describeOp(first) : "Cambio";
  return {
    id: newId(),
    label: label ?? (ops.length > 1 ? `${fallback} (+${ops.length - 1})` : fallback),
    ops,
    enabled: true,
    createdAt: Date.now(),
  };
}

/** Applies one entry atomically; throws OpError if any op fails. */
export function applyEntry(film: FilmState, entry: HistoryEntry): FilmState {
  return entry.ops.reduce(applyOp, film);
}

export function replay(history: History): Replay {
  let film = emptyFilm(history.initial);
  const errors: Record<string, string> = {};
  for (const entry of history.entries.slice(0, history.cursor)) {
    if (!entry.enabled) continue;
    try {
      film = applyEntry(film, entry);
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      errors[entry.id] = e.message;
    }
  }
  return { film, errors };
}

export function pushEntry(history: History, entry: HistoryEntry): History {
  const entries = [...history.entries];
  entries.splice(history.cursor, 0, entry);
  return { ...history, entries, cursor: history.cursor + 1 };
}

export function canUndo(history: History): boolean {
  return history.cursor > 0;
}

export function canRedo(history: History): boolean {
  return history.cursor < history.entries.length;
}

export function setCursor(history: History, cursor: number): History {
  return { ...history, cursor: Math.max(0, Math.min(history.entries.length, cursor)) };
}

export function undo(history: History): History {
  return setCursor(history, history.cursor - 1);
}

export function redo(history: History): History {
  return setCursor(history, history.cursor + 1);
}

function mapEntry(history: History, id: string, fn: (e: HistoryEntry) => HistoryEntry): History {
  return { ...history, entries: history.entries.map((e) => (e.id === id ? fn(e) : e)) };
}

export function setEntryEnabled(history: History, id: string, enabled: boolean): History {
  return mapEntry(history, id, (e) => ({ ...e, enabled }));
}

export function updateEntryOp(history: History, id: string, opIndex: number, op: Op): History {
  return mapEntry(history, id, (e) => {
    const ops = [...e.ops];
    ops[opIndex] = op;
    const label = e.ops.length === 1 ? describeOp(op) : e.label;
    return { ...e, ops, label };
  });
}

export function removeEntry(history: History, id: string): History {
  const index = history.entries.findIndex((e) => e.id === id);
  if (index < 0) return history;
  return {
    ...history,
    entries: history.entries.filter((e) => e.id !== id),
    cursor: index < history.cursor ? history.cursor - 1 : history.cursor,
  };
}
