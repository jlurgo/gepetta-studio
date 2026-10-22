import { type Roi, sharpness } from "@gepetta/core";
import jpeg from "jpeg-js";

export { sharpness };

/**
 * Contrast-detection autofocus done by the app: the lens is moved with the
 * same counted steps as manual focus, so its position is never lost (the
 * camera's own autofocus moves it by an unknown amount).
 */

export function jpegSharpness(data: Uint8Array, roi: Roi): number {
  const img = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  return sharpness(img.data, img.width, img.height, roi);
}

/**
 * The lens, seen by the search. Moves only go nearer: on the EOS 500D a "far"
 * step is ~1.5× a "near" step and reversing adds backlash, so a position is
 * only exact when reached counting near steps up from the infinity end.
 */
export interface FocusSearchIo {
  /** Sharpness of the next live frame. Frames lag the lens by `lag` frames. */
  frame(): Promise<number>;
  /** Moves `steps` fine steps nearer. */
  near(steps: number): Promise<void>;
  /** Drives to the infinity end: position 0. */
  zero(): Promise<void>;
  position(): number;
  /** Farthest-in position worth searching (the travel). */
  max: number;
  /** Live-view frames that still show the lens before the last move. */
  lag: number;
}

export interface FocusSearchResult {
  best: number;
  samples: [position: number, sharpness: number][];
}

/** Sweep step: about a third of the in-focus peak's width on the 500D + EF-S 18-55. */
const STEP = 6;
/** Probe distance to tell whether the sharp spot is ahead (nearer) or behind. */
const PROBE = 12;
/** Changes smaller than this (relative) are noise. */
const FLAT = 0.04;
/** Past the peak once sharpness falls below this share of the best seen… */
const FALLEN = 0.6;
/** …and the best clearly stands above the blur floor. */
const PROMINENT = 1.4;

/** Waits out the lag and returns a sharpness that belongs to the current position. */
async function settled(io: FocusSearchIo): Promise<number> {
  let v = 0;
  for (let i = 0; i <= io.lag; i++) v = await io.frame();
  return v;
}

/**
 * Contrast autofocus with near-only moves:
 * 1. probe whether the sharp spot is nearer than the lens (else restart from infinity);
 * 2. sweep nearer in small steps, pairing each frame with the position `lag` frames
 *    earlier, until well past the peak;
 * 3. fit a parabola through the peak and land there counting up from infinity.
 */
export async function contrastFocus(io: FocusSearchIo): Promise<FocusSearchResult> {
  const samples = new Map<number, number>();
  const start = io.position();
  const here = await settled(io);
  samples.set(start, here);
  if (start + PROBE <= io.max) {
    await io.near(PROBE);
    const ahead = await settled(io);
    samples.set(io.position(), ahead);
    if (!(ahead > here * (1 + FLAT))) {
      await io.zero();
      samples.clear();
    }
  } else {
    await io.zero();
    samples.clear();
  }

  // Sweep: positions[i] is where the lens was when frame i was requested.
  const positions: number[] = [];
  const values: number[] = [];
  const record = (v: number) => {
    values.push(v);
    const i = values.length - 1 - io.lag;
    if (i >= 0) samples.set(positions[i]!, v);
  };
  const pastPeak = () => {
    if (samples.size < 4) return false;
    const vals = [...samples.values()];
    const max = Math.max(...vals);
    const floor = Math.min(...vals);
    const last = values.at(-1)!;
    return max > floor * PROMINENT && last < max * FALLEN;
  };
  for (;;) {
    positions.push(io.position());
    record(await io.frame());
    if (pastPeak() || io.position() + STEP > io.max) break;
    await io.near(STEP);
  }
  // Frames still in flight belong to the last positions.
  for (let i = 0; i < io.lag; i++) {
    positions.push(io.position());
    record(await io.frame());
  }

  const sorted = [...samples].sort((a, b) => a[0] - b[0]);
  const top = sorted.reduce((a, b) => (b[1] > a[1] ? b : a));
  const best = Math.max(0, Math.round(peakOf(sorted, top[0])));
  await io.zero();
  if (best > 0) await io.near(best);
  return { best, samples: sorted };
}

/** Vertex of the parabola through the best sample and its neighbors. */
export function peakOf(sorted: [number, number][], at: number): number {
  const i = sorted.findIndex(([p]) => p === at);
  const a = sorted[i - 1];
  const b = sorted[i]!;
  const c = sorted[i + 1];
  if (!a || !c) return at;
  const [x0, y0] = a;
  const [x1, y1] = b;
  const [x2, y2] = c;
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (denom === 0) return at;
  const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
  if (A >= 0) return at;
  const vertex = -B / (2 * A);
  return Math.min(x2, Math.max(x0, vertex));
}
