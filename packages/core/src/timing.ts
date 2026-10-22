import type { FilmState } from "./model";

export function durationSeconds(film: FilmState): number {
  return film.length / film.settings.fps;
}

/** First cell of the last `seconds` of the film. */
export function tailStartCell(film: FilmState, seconds: number): number {
  return Math.max(0, film.length - Math.round(seconds * film.settings.fps));
}
