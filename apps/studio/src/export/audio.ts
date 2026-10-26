import { type FilmState, type TrackId, soundRuns } from "@gepetta/core";
import { playRun, soundBuffer } from "../media/sound";

const RATE = 48000;

/**
 * The film's sound for the given cells played one after another (an export):
 * every sound track that goes out, mixed. Null when nothing sounds.
 */
export async function mixSound(filmId: string, film: FilmState, cells: readonly number[], tracks?: TrackId[]): Promise<AudioBuffer | null> {
  const out = new Set(film.tracks.filter((t) => t.kind === "sound" && t.exported && (!tracks || tracks.includes(t.id))).map((t) => t.id));
  const runs = soundRuns(film, cells).filter((r) => out.has(r.track));
  if (!runs.length) return null;
  const fps = film.settings.fps;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((cells.length / fps) * RATE)), RATE);
  const volume = new Map(film.tracks.map((t) => [t.id, t.opacity]));
  for (const run of runs) {
    const buffer = await soundBuffer(filmId, run.clip.sound!.ref);
    playRun(ctx, ctx.destination, buffer, run, fps, run.at / fps, volume.get(run.track) ?? 1);
  }
  return ctx.startRendering();
}
