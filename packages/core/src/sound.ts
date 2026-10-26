import { groupChain } from "./groups";
import { cellIndex, clipIn } from "./layers";
import type { Clip, FilmState, Track, TrackId } from "./model";

/** A sound track sounds: it is not silenced, nor is any group it is in. */
export function trackSounds(film: FilmState, track: Track): boolean {
  return track.kind === "sound" && track.visible && !groupChain(film, track.group).some((g) => g.muted);
}

/** A sound track's volume: its own, times that of every group it is in. */
export function trackVolume(film: FilmState, track: Track): number {
  return groupChain(film, track.group).reduce((v, g) => v * (g.volume ?? 1), track.opacity);
}

/** A stretch of sound to play: `clip`'s slices from `cell` on, `count` of them, from the `at`-th cell played. */
export interface SoundRun {
  track: TrackId;
  clip: Clip;
  at: number;
  cell: number;
  count: number;
}

/**
 * What sounds while the given cells play one after another: for each sound
 * track (heard, and among `tracks` when given), runs of its slices. Cells
 * that follow each other in the same clip make one run, so it plays on
 * without a cut.
 */
export function soundRuns(film: FilmState, cells: readonly number[], tracks?: readonly TrackId[]): SoundRun[] {
  const index = cellIndex(film);
  const runs: SoundRun[] = [];
  for (const track of film.tracks) {
    if (!trackSounds(film, track) || (tracks && !tracks.includes(track.id))) continue;
    const list = index.get(track.id) ?? [];
    let run: SoundRun | null = null;
    cells.forEach((cell, at) => {
      const clip = clipIn(list, cell);
      if (run && clip?.id === run.clip.id && cell === run.cell + run.count) {
        run.count++;
        return;
      }
      run = clip ? { track: track.id, clip, at, cell, count: 1 } : null;
      if (run) runs.push(run);
    });
  }
  return runs;
}
