import { type FilmState, type TrackId, soundRuns, trackVolume } from "@gepetta/core";
import { makeBus } from "../media/mixer";
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
  const byId = new Map(film.tracks.map((t) => [t.id, t]));
  // Each track through its own bus, as heard while working.
  const buses = new Map([...out].map((id) => [id, makeBus(ctx, byId.get(id)!, trackVolume(film, byId.get(id)!), ctx.destination)]));
  for (const run of runs) {
    const buffer = await soundBuffer(filmId, run.clip.sound!.ref);
    playRun(ctx, buses.get(run.track)!.input, buffer, run, fps, run.at / fps, run.clip.opacity);
  }
  return ctx.startRendering();
}
