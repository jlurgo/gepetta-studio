import { create } from "zustand";

/**
 * How the big picture is zoomed and moved, only to look closer: the film does
 * not change. `zoom` 1 fits the film in the stage; `x`, `y` move it (CSS pixels).
 */
interface StageView {
  zoom: number;
  x: number;
  y: number;
}

export const useStageView = create<StageView>(() => ({ zoom: 1, x: 0, y: 0 }));

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 16;

/** Where the stage put the film last time it drew (device pixels), to zoom about a point. */
interface Layout {
  width: number;
  height: number;
  area: { x: number; y: number; width: number; height: number };
  /** Device pixels per film pixel when it fits. */
  fit: number;
  dpr: number;
}

let layout: Layout | null = null;

export function setStageLayout(l: Layout) {
  layout = l;
}

/** Scale (device pixels per film pixel) and where the film's origin goes, for the current view. */
export function viewTransform(l: Layout): { s: number; ox: number; oy: number } {
  const { zoom, x, y } = useStageView.getState();
  const s = l.fit * zoom;
  return {
    s,
    ox: (l.width - l.area.width * s) / 2 - l.area.x * s + x * l.dpr,
    oy: (l.height - l.area.height * s) / 2 - l.area.y * s + y * l.dpr,
  };
}

/** Zooms to `zoom`, keeping what is under a point of the stage (CSS pixels; its middle by default) where it is. */
export function zoomTo(zoom: number, at?: { x: number; y: number }) {
  const l = layout;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  if (!l || Math.abs(z - 1) < 0.01) return useStageView.setState({ zoom: 1, x: 0, y: 0 });
  const px = (at?.x ?? l.width / l.dpr / 2) * l.dpr;
  const py = (at?.y ?? l.height / l.dpr / 2) * l.dpr;
  const { s, ox, oy } = viewTransform(l);
  // The film point under the pointer…
  const fx = (px - ox) / s;
  const fy = (py - oy) / s;
  // …stays under it at the new scale.
  const s2 = l.fit * z;
  const cx = (l.width - l.area.width * s2) / 2 - l.area.x * s2;
  const cy = (l.height - l.area.height * s2) / 2 - l.area.y * s2;
  useStageView.setState({ zoom: z, x: (px - fx * s2 - cx) / l.dpr, y: (py - fy * s2 - cy) / l.dpr });
}

/** Zooms in (> 1) or out (< 1) by a factor. */
export function zoomBy(factor: number, at?: { x: number; y: number }) {
  zoomTo(useStageView.getState().zoom * factor, at);
}

/** Moves the zoomed picture (CSS pixels). */
export function panBy(dx: number, dy: number) {
  const v = useStageView.getState();
  if (v.zoom === 1) return;
  useStageView.setState({ x: v.x + dx, y: v.y + dy });
}

export function fitStage() {
  useStageView.setState({ zoom: 1, x: 0, y: 0 });
}
