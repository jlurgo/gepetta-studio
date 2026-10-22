import { type FilmState, orderedFrames } from "@gepetta/core";

/** A lens position whose focus distance is known from a photo taken there. */
export interface FocusRef {
  position: number;
  /** Meters (middle of the range the camera reported). */
  distance: number;
}

/**
 * Distance references for the focus slider, learned from this film's photos
 * taken with the same camera with the lens position counted from infinity.
 */
export function focusRefs(film: FilmState | null, source: string | null): FocusRef[] {
  if (!film || !source) return [];
  const byPosition = new Map<number, number>();
  for (const frame of orderedFrames(film)) {
    const c = frame.layers[0]?.media.capture;
    if (!c || c.source !== source || c.focusOrigin !== "infinity" || c.focusPosition === undefined || !c.focusDistance) continue;
    const { near, far } = c.focusDistance;
    byPosition.set(c.focusPosition, Number.isFinite(far) ? (near + far) / 2 : Infinity);
  }
  return [...byPosition].map(([position, distance]) => ({ position, distance })).sort((a, b) => a.position - b.position);
}

/**
 * Estimated distance at `position`, interpolating between references in
 * diopters (1/m), which is close to linear along a lens's focus travel.
 */
export function estimateDistance(refs: FocusRef[], position: number): number | null {
  const exact = refs.find((r) => r.position === position);
  if (exact) return exact.distance;
  const below = [...refs].reverse().find((r) => r.position < position);
  const above = refs.find((r) => r.position > position);
  if (!below || !above) return null;
  const d = (r: FocusRef) => (Number.isFinite(r.distance) ? 1 / r.distance : 0);
  const t = (position - below.position) / (above.position - below.position);
  const diopters = d(below) + t * (d(above) - d(below));
  return diopters > 0 ? 1 / diopters : Infinity;
}
