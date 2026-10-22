import type { FilmState, Frame } from "./model";
import { orderedFrames } from "./model";

export interface TimedFrame {
  frame: Frame;
  index: number;
  /** In ticks of 1/fps. */
  start: number;
}

export function timeline(film: FilmState): { frames: TimedFrame[]; totalTicks: number } {
  let start = 0;
  const frames = orderedFrames(film).map((frame, index) => {
    const timed = { frame, index, start };
    start += frame.hold;
    return timed;
  });
  return { frames, totalTicks: start };
}

export function durationSeconds(film: FilmState): number {
  return timeline(film).totalTicks / film.settings.fps;
}

/** Index of the frame showing at `tick`, or -1 if past the end. */
export function frameIndexAtTick(frames: TimedFrame[], tick: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.start <= tick) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  const f = frames[found]!;
  return tick < f.start + f.frame.hold ? found : -1;
}

/** First tick of the last `seconds` of the film. */
export function tailStartTick(film: FilmState, seconds: number): number {
  const { totalTicks } = timeline(film);
  return Math.max(0, totalTicks - Math.round(seconds * film.settings.fps));
}
