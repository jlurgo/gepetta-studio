import { type CellIndex, type FilmState, type TrackId, cellIndex, clipEnd, clipIn, playedCell } from "@gepetta/core";
import { create } from "zustand";
import { type Voice, audio, playRun, preloadSounds, soundBufferNow } from "../media/sound";
import { type Playback, playbackCell, useEditor } from "./editor";

/**
 * Hearing the film's sound tracks: while it plays, in time with the pictures;
 * and, standing still, the slice of the cell the cursor goes to (to find the
 * frame where a word or a hit is).
 */
export type SoundView = "wave" | "spectrum";

interface SoundState {
  /** Moving the cursor plays the slice of its cell. */
  scrub: boolean;
  setScrub(on: boolean): void;
  /** The sound of the cells around the one shown, under the picture. */
  strip: boolean;
  setStrip(on: boolean): void;
  /** How sound shows in cells: its loudness (a waveform) or its spectrum. */
  view: SoundView;
  setView(view: SoundView): void;
}

const SCRUB_KEY = "gepetta.soundScrub";
const STRIP_KEY = "gepetta.soundStrip";
const VIEW_KEY = "gepetta.soundView";

function loadView(): SoundView {
  try {
    return localStorage.getItem(VIEW_KEY) === "spectrum" ? "spectrum" : "wave";
  } catch {
    return "wave";
  }
}

function load(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Not remembered.
  }
}

export const useSound = create<SoundState>((set) => ({
  scrub: load(SCRUB_KEY),
  setScrub: (scrub) => {
    set({ scrub });
    save(SCRUB_KEY, scrub);
  },
  strip: load(STRIP_KEY),
  setStrip: (strip) => {
    set({ strip });
    save(STRIP_KEY, strip);
  },
  view: loadView(),
  setView: (view) => {
    set({ view });
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Only a convenience.
    }
  },
}));

const hasSound = (film: FilmState) => film.tracks.some((t) => t.kind === "sound");

/** Played this far ahead (s); checked this often (ms). */
const AHEAD = 0.25;
const TICK = 30;

/** Playing: the context time of the playback's first cell, the next cell to schedule, and each track's run playing. */
let live: { playback: Playback; base: number; n: number; voices: Map<TrackId, Voice & { clipId: string; next: number }>; timer: number } | null = null;
let index: { film: FilmState; index: CellIndex } | null = null;

function indexOf(film: FilmState): CellIndex {
  if (index?.film !== film) index = { film, index: cellIndex(film) };
  return index.index;
}

function stopLive() {
  if (!live) return;
  clearInterval(live.timer);
  const now = audio().currentTime;
  for (const v of live.voices.values()) v.stop(now);
  live = null;
}

function tick() {
  const { film, filmId } = useEditor.getState();
  if (!live || !film || !filmId) return;
  const ctx = audio();
  const fps = film.settings.fps;
  const idx = indexOf(film);
  const { playback, voices } = live;
  for (;;) {
    const t = live.base + (live.n - playback.startCell) / fps;
    if (t > ctx.currentTime + AHEAD) break;
    const cell = playedCell(film, live.n);
    if (cell >= film.length) {
      // The end (a loop starts a new playback).
      for (const v of voices.values()) v.stop(t);
      voices.clear();
      clearInterval(live.timer);
      break;
    }
    for (const track of film.tracks) {
      if (track.kind !== "sound") continue;
      const clip = track.visible ? clipIn(idx.get(track.id) ?? [], cell) : undefined;
      const v = voices.get(track.id);
      // The run goes on.
      if (v && clip?.id === v.clipId && v.next === cell) {
        v.next++;
        continue;
      }
      if (v) {
        v.stop(t);
        voices.delete(track.id);
      }
      if (!clip?.sound) continue;
      const buffer = soundBufferNow(filmId, clip.sound.ref);
      if (!buffer) continue;
      // Played to the clip's end, unless cut short by what comes next.
      const voice = playRun(ctx, ctx.destination, buffer, { track: track.id, clip, at: 0, cell, count: clipEnd(clip) - cell }, fps, t, track.opacity * clip.opacity);
      if (voice) voices.set(track.id, Object.assign(voice, { clipId: clip.id, next: cell + 1 }));
    }
    live.n++;
  }
}

function startLive(playback: Playback, film: FilmState) {
  stopLive();
  if (!hasSound(film)) return;
  const ctx = audio();
  const fps = film.settings.fps;
  // Heard when the picture is seen: started earlier by the time sound takes to come out.
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  const base = ctx.currentTime - (performance.now() - playback.startedAt) / 1000 - latency;
  live = { playback, base, n: Math.max(playback.startCell, playbackCell(playback, fps)), voices: new Map(), timer: window.setInterval(tick, TICK) };
  tick();
}

/** The slice of a cell, as when going through the cells one by one. */
let scrubbing: Voice[] = [];
function scrub(cell: number) {
  const { film, filmId } = useEditor.getState();
  if (!film || !filmId || !useSound.getState().scrub || !hasSound(film)) return;
  const ctx = audio();
  for (const v of scrubbing) v.stop(ctx.currentTime);
  scrubbing = [];
  const idx = indexOf(film);
  for (const track of film.tracks) {
    if (track.kind !== "sound" || !track.visible) continue;
    const clip = clipIn(idx.get(track.id) ?? [], cell);
    const buffer = clip?.sound && soundBufferNow(filmId, clip.sound.ref);
    if (!clip || !buffer) continue;
    const v = playRun(ctx, ctx.destination, buffer, { track: track.id, clip, at: 0, cell, count: 1 }, film.settings.fps, ctx.currentTime, track.opacity * clip.opacity);
    if (v) scrubbing.push(v);
  }
}

useEditor.subscribe((s, prev) => {
  if (s.film && s.filmId && (s.film !== prev.film || s.filmId !== prev.filmId) && hasSound(s.film)) preloadSounds(s.filmId, s.film);
  if (s.playback !== prev.playback) {
    if (s.playback && s.film) startLive(s.playback, s.film);
    else stopLive();
  } else if (!s.playback && s.cursor.cell !== prev.cursor.cell && s.filmId === prev.filmId) scrub(s.cursor.cell);
});
