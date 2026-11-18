import { type FilmState, contentEnd } from "./model";

export function durationSeconds(film: FilmState): number {
  return film.length / film.settings.fps;
}

/** Where what is played of a film ends: after its last picture or sound (empty cells left at the end do not count); its length when it has nothing. */
export function playedEnd(film: FilmState): number {
  return Math.min(film.length, contentEnd(film)) || film.length;
}

/** First cell of the last `seconds` of the film's content. */
export function tailStartCell(film: FilmState, seconds: number): number {
  return Math.max(0, playedEnd(film) - Math.round(seconds * film.settings.fps));
}
