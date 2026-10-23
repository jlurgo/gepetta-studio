import {
  type AssetId,
  type Clip,
  type ClipId,
  type FilmState,
  type Point,
  type Track,
  type TrackId,
  IDENTITY_TRANSFORM,
  clipAt,
  composeTransforms,
  newId,
} from "@gepetta/core";
import { create } from "zustand";
import { ingestImage } from "../media/ingest";
import { type Size, containScale } from "../render/frame";
import { storage } from "../storage";
import { useBusy } from "./busy";
import { useEditor } from "./editor";

/**
 * Drawing tools: they paint on the picture at the cursor (the track and cell
 * chosen in the timeline), like a camera puts a photo there. Painting on an
 * empty cell starts a new drawing there; each stroke is one history step.
 */
export type StageTool = "move" | "brush" | "eraser";

export const PAINT_COLORS = ["#1b1916", "#ffffff", "#ef5b5b", "#ff7a45", "#f5c542", "#5cc8b5", "#4a90e2", "#9b6dd6"];

interface PaintState {
  tool: StageTool;
  color: string;
  /** Widths in film pixels. */
  brushSize: number;
  eraserSize: number;
  setTool(tool: StageTool): void;
  set(patch: Partial<Pick<PaintState, "color" | "brushSize" | "eraserSize">>): void;
}

function remembered<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`gepetta.paint.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(`gepetta.paint.${key}`, JSON.stringify(value));
  } catch {
    // Not remembered.
  }
}

export const usePaint = create<PaintState>((set) => ({
  tool: "move",
  color: remembered("color", PAINT_COLORS[0]!),
  brushSize: remembered("brushSize", 8),
  eraserSize: remembered("eraserSize", 40),
  setTool: (tool) => {
    if (tool === "move") dropSurface();
    set({ tool });
  },
  set: (patch) => {
    for (const [k, v] of Object.entries(patch)) remember(k, v);
    set(patch);
  },
}));

export function isPainting(tool: StageTool): tool is "brush" | "eraser" {
  return tool !== "move";
}

export function toolSize(): number {
  const p = usePaint.getState();
  return p.tool === "eraser" ? p.eraserSize : p.brushSize;
}

/** Biggest side of a picture painted on: bigger photos are painted on a reduced copy. */
const SURFACE_MAX = 3840;

/** The picture being painted, decoded into a canvas. */
interface Surface {
  track: TrackId;
  cell: number;
  /** The picture it is (null: a new drawing not saved yet). */
  clipId: ClipId | null;
  /** The image it was loaded from or last saved as, to notice an undo. */
  original: AssetId | null;
  canvas: OffscreenCanvas;
  /** Keeps see-through pixels (PNG) rather than a photo's JPEG. */
  alpha: boolean;
}

let surface: Surface | null = null;
let loading: { key: string; promise: Promise<Surface | null> } | null = null;

function dropSurface() {
  surface = null;
  loading = null;
}

/** Where the painting goes now: the cursor's track and cell, and the picture there. */
function target(film: FilmState): { track: Track; cell: number; clip: Clip | undefined } | null {
  const { cursor } = useEditor.getState();
  const track = film.tracks.find((t) => t.id === cursor.track);
  return track ? { track, cell: cursor.cell, clip: clipAt(film, track.id, cursor.cell) } : null;
}

function matches(s: Surface, track: TrackId, cell: number, clip: Clip | undefined): boolean {
  if (s.track !== track) return false;
  if (clip) return s.clipId === clip.id && s.original === clip.media.original;
  return s.clipId === null && s.cell === cell;
}

/** The canvas being painted for a track's picture at a cell, while it is the one there. */
export function surfaceAt(film: FilmState, track: TrackId, cell: number): OffscreenCanvas | null {
  if (!surface || !isPainting(usePaint.getState().tool)) return null;
  return matches(surface, track, cell, clipAt(film, track, cell)) ? surface.canvas : null;
}

/** The surface for the current target, loading the picture there if needed. */
function ensureSurface(): Promise<Surface | null> {
  const { film, filmId } = useEditor.getState();
  if (!film || !filmId) return Promise.resolve(null);
  const at = target(film);
  if (!at) return Promise.resolve(null);
  const { track, cell, clip } = at;
  if (surface && matches(surface, track.id, cell, clip)) return Promise.resolve(surface);
  const key = `${track.id}:${clip ? `${clip.id}:${clip.media.original}` : cell}`;
  if (loading?.key === key) return loading.promise;
  // Started after `loading` is set, so the check below sees it.
  const promise = Promise.resolve().then(async (): Promise<Surface | null> => {
    let made: Surface;
    if (!clip) {
      made = { track: track.id, cell, clipId: null, original: null, canvas: new OffscreenCanvas(film.settings.width, film.settings.height), alpha: true };
    } else {
      const blob = await storage.getAsset(filmId, clip.media.original);
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const k = Math.min(1, SURFACE_MAX / Math.max(bmp.width, bmp.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      made = { track: track.id, cell, clipId: clip.id, original: clip.media.original, canvas, alpha: blob.type !== "image/jpeg" };
    }
    // Only if still the one wanted (the cursor may have moved meanwhile).
    if (loading?.key !== key) return null;
    loading = null;
    surface = made;
    return made;
  });
  loading = { key, promise };
  promise.catch(() => {
    if (loading?.key === key) loading = null;
  });
  return promise;
}

/** Film coordinates → the surface's pixels, as the stage draws that picture. */
function filmToSurface(film: FilmState, s: Surface): DOMMatrix {
  const track = film.tracks.find((t) => t.id === s.track);
  const clip = s.clipId ? film.clips[s.clipId] : undefined;
  const t = composeTransforms(track?.transform ?? IDENTITY_TRANSFORM, clip?.transform ?? IDENTITY_TRANSFORM);
  const { width: W, height: H } = film.settings;
  const media: Size = { width: s.canvas.width, height: s.canvas.height };
  const c = containScale(media, film.settings);
  return new DOMMatrix()
    .translate(W / 2 + t.x, H / 2 + t.y)
    .rotate((t.rotation * 180) / Math.PI)
    .scale(t.scale)
    .translate(-W / 2, -H / 2)
    .translate((W - media.width * c) / 2, (H - media.height * c) / 2)
    .scale(c)
    .inverse();
}

interface StrokePoint extends Point {
  /** Width here, in film pixels. */
  w: number;
}

interface Stroke {
  points: StrokePoint[];
  /** Points already on the surface. */
  drawn: number;
  erase: boolean;
  color: string;
  surface: Surface | null;
}

let stroke: Stroke | null = null;
/** Where the pointer is over the film, for the brush outline. */
let hover: Point | null = null;

export function brushOutline(): { at: Point; size: number } | null {
  return hover && isPainting(usePaint.getState().tool) ? { at: hover, size: toolSize() } : null;
}

function drawPending(s: Stroke) {
  const surf = s.surface;
  const { film } = useEditor.getState();
  if (!surf || !film || s.drawn >= s.points.length) return;
  const ctx = surf.canvas.getContext("2d")!;
  ctx.save();
  ctx.setTransform(filmToSurface(film, surf));
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineCap = ctx.lineJoin = "round";
  if (s.drawn === 0) {
    // A dot where the stroke starts (a click alone leaves one).
    const p = s.points[0]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
    ctx.fill();
    s.drawn = 1;
  }
  for (let i = s.drawn; i < s.points.length; i++) {
    const a = s.points[i - 1]!;
    const b = s.points[i]!;
    ctx.lineWidth = (a.w + b.w) / 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  s.drawn = s.points.length;
  ctx.restore();
}

function width(pressure: number, pen: boolean): number {
  // A pen draws thinner when pressed lightly; a mouse or finger always full width.
  return toolSize() * (pen ? Math.max(0.15, pressure) : 1);
}

/** Starts a stroke at a film point. Returns false when there is nowhere to paint. */
export function beginStroke(p: Point, pressure: number, pen: boolean): boolean {
  const { film } = useEditor.getState();
  const tool = usePaint.getState().tool;
  if (!film || !isPainting(tool)) return false;
  const at = target(film);
  if (!at) return false;
  if (!at.track.visible) {
    useBusy.getState().notify(`El track "${at.track.name}" está oculto: mostralo para dibujar en él.`, "error");
    return true;
  }
  if (tool === "eraser" && !at.clip) return true;
  const s: Stroke = { points: [{ ...p, w: width(pressure, pen) }], drawn: 0, erase: tool === "eraser", color: usePaint.getState().color, surface: null };
  stroke = s;
  void ensureSurface().then((surf) => {
    if (!surf) return;
    if (s.erase) surf.alpha = true;
    s.surface = surf;
    drawPending(s);
    if (stroke !== s) void save(s);
  });
  return true;
}

export function moveStroke(points: Point[], pressure: number, pen: boolean) {
  hover = points[points.length - 1] ?? hover;
  if (!stroke) {
    // Hovering: have the picture ready for the next stroke.
    if (isPainting(usePaint.getState().tool)) void ensureSurface();
    return;
  }
  for (const p of points) stroke.points.push({ ...p, w: width(pressure, pen) });
  drawPending(stroke);
}

export function endStroke() {
  const s = stroke;
  stroke = null;
  // Saved once its picture is ready (right away, unless it is still loading).
  if (s?.surface) void save(s);
}

export function leaveStage() {
  hover = null;
}

/** Strokes are saved one after another, in order. */
let saving: Promise<unknown> = Promise.resolve();

function save(s: Stroke): Promise<void> {
  const surf = s.surface!;
  // The picture as it is now; the next stroke may already be changing it.
  const encoded = surf.canvas.convertToBlob(surf.alpha ? { type: "image/png" } : { type: "image/jpeg", quality: 0.95 });
  const run = async () => {
    const { filmId } = useEditor.getState();
    if (!filmId) return;
    const media = await ingestImage(filmId, await encoded, null, { sourceKind: "drawing" });
    const state = useEditor.getState();
    if (state.filmId !== filmId || !state.film) return;
    const clip = surf.clipId ? state.film.clips[surf.clipId] : undefined;
    if (clip) {
      if (clip.media.original === media.original) return;
      state.commit([{ type: "clip.update", id: clip.id, patch: { media } }], s.erase ? "Borrar en la imagen" : "Dibujar en la imagen");
    } else {
      const placed: Clip = {
        id: newId(),
        track: surf.track,
        start: surf.cell,
        length: state.captureStep,
        media,
        name: "Dibujo",
        visible: true,
        opacity: 1,
        transform: IDENTITY_TRANSFORM,
      };
      state.commit([{ type: "clip.place", clips: [placed], label: "Dibujo" }], "Dibujo nuevo");
      surf.clipId = placed.id;
    }
    surf.original = media.original;
  };
  const next = saving.then(run);
  saving = next.catch((e: unknown) => {
    console.error(e);
    useBusy.getState().notify("No se pudo guardar el dibujo.", "error");
  });
  return next.catch(() => undefined);
}

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
