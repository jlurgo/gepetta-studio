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
  fillMask,
  newId,
} from "@gepetta/core";
import { create } from "zustand";
import { ingestImage } from "../media/ingest";
import { drawStack, pictureMatrix } from "../render/frame";
import { storage } from "../storage";
import { useBusy } from "./busy";
import { useEditor } from "./editor";

/**
 * Drawing tools, after Blender's Grease Pencil: they paint on the picture at
 * the cursor (the track and cell chosen in the timeline), like a camera puts a
 * photo there. Painting on an empty cell starts a new drawing there; each
 * stroke is one history step.
 *
 * A stroke is drawn on its own layer at full strength and laid on the picture
 * at the tool's strength when it ends (so a marker does not darken where it
 * crosses itself); meanwhile the stage shows the two together.
 */
/** "camera": the active camera (see useCamera), as a tool among the others; "addCamera": choosing one more. */
export type StageTool = "move" | "camera" | "addCamera" | "draw" | "erase" | "fill" | "tint" | "shape" | "clone" | "picker";
export type BrushKind = "pencil" | "ink" | "marker" | "airbrush";
export type ShapeKind = "line" | "box" | "ellipse";

export const BRUSHES: Record<BrushKind, { label: string; size: number; strength: number; /** How much a light pen press thins the line, 0–1. */ pressure: number; soft: boolean }> = {
  pencil: { label: "Lápiz", size: 4, strength: 1, pressure: 0.5, soft: false },
  ink: { label: "Tinta", size: 10, strength: 1, pressure: 1, soft: false },
  marker: { label: "Marcador", size: 24, strength: 0.6, pressure: 0, soft: false },
  airbrush: { label: "Aerógrafo", size: 80, strength: 0.5, pressure: 0, soft: true },
};

export const SHAPES: Record<ShapeKind, string> = { line: "Línea", box: "Rectángulo", ellipse: "Elipse" };

/** Each brush and tool keeps its own width (film pixels) and strength (0–1). */
type SettingsKey = BrushKind | "erase" | "tint" | "shape" | "clone";
type ToolSettings = Record<SettingsKey, { size: number; strength: number }>;

const DEFAULT_SETTINGS: ToolSettings = {
  pencil: { size: BRUSHES.pencil.size, strength: BRUSHES.pencil.strength },
  ink: { size: BRUSHES.ink.size, strength: BRUSHES.ink.strength },
  marker: { size: BRUSHES.marker.size, strength: BRUSHES.marker.strength },
  airbrush: { size: BRUSHES.airbrush.size, strength: BRUSHES.airbrush.strength },
  erase: { size: 40, strength: 1 },
  tint: { size: 60, strength: 0.3 },
  shape: { size: 6, strength: 1 },
  clone: { size: 40, strength: 1 },
};

/** Where the clone stamp copies from: a point of a track's picture at a cell (it can be another cell). */
export interface CloneSource {
  track: TrackId;
  cell: number;
  at: Point;
  /** From where it paints to where it copies from, fixed by the first stroke (so strokes keep lined up). */
  offset: Point | null;
}

export const PAINT_COLORS = ["#1b1916", "#ffffff", "#ef5b5b", "#ff7a45", "#f5c542", "#5cc8b5", "#4a90e2", "#9b6dd6"];

interface PaintState {
  tool: StageTool;
  /** The tool to go back to after picking a color. */
  lastTool: StageTool;
  brush: BrushKind;
  shape: ShapeKind;
  /** Shapes: filled with the color too, not just outlined. */
  shapeFill: boolean;
  color: string;
  settings: ToolSettings;
  /** Steadies the hand: 0 follows the pointer, 1 smooths the most. */
  smooth: number;
  /** Paint bucket: how different a color may be and still be filled, 0–100. */
  fillTolerance: number;
  cloneSource: CloneSource | null;
  setTool(tool: StageTool): void;
  set(patch: Partial<Pick<PaintState, "brush" | "shape" | "shapeFill" | "color" | "smooth" | "fillTolerance">>): void;
  /** Width and strength of the tool in use. */
  setCurrent(patch: Partial<{ size: number; strength: number }>): void;
  setCloneSource(source: CloneSource | null): void;
  /** Takes a color (eyedropper) and goes back to the tool that paints with it. */
  pickColor(color: string): void;
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

/** Which settings the tool uses. */
function settingsKey(p: Pick<PaintState, "tool" | "brush">): SettingsKey {
  switch (p.tool) {
    case "erase":
    case "tint":
    case "shape":
    case "clone":
      return p.tool;
    default:
      return p.brush;
  }
}

export const usePaint = create<PaintState>((set, get) => ({
  tool: "move",
  lastTool: "draw",
  brush: remembered("brush", "pencil"),
  shape: remembered("shape", "line"),
  shapeFill: remembered("shapeFill", false),
  color: remembered("color", PAINT_COLORS[0]!),
  settings: { ...DEFAULT_SETTINGS, ...remembered<Partial<ToolSettings>>("settings", {}) },
  smooth: remembered("smooth", 0.3),
  fillTolerance: remembered("fillTolerance", 15),
  cloneSource: null,
  setTool: (tool) => {
    if (!isPainting(tool)) dropSurface();
    set({ tool, lastTool: tool === "picker" ? get().lastTool : tool });
  },
  set: (patch) => {
    for (const [k, v] of Object.entries(patch)) remember(k, v);
    set(patch);
  },
  setCurrent: (patch) => {
    const key = settingsKey(get());
    const settings = { ...get().settings, [key]: { ...get().settings[key], ...patch } };
    remember("settings", settings);
    set({ settings });
  },
  setCloneSource: (cloneSource) => set({ cloneSource }),
  pickColor: (color) => {
    remember("color", color);
    const back = get().lastTool;
    set({ color, tool: back === "fill" || back === "tint" || back === "shape" ? back : "draw" });
  },
}));

/** The drawing tools work on the cell at the cursor (and hide the handles). */
export function isPainting(tool: StageTool): tool is Exclude<StageTool, "move" | "camera" | "addCamera"> {
  return tool !== "move" && tool !== "camera" && tool !== "addCamera";
}

/** Whether the tool has a width and a strength. */
export function hasSettings(tool: StageTool): boolean {
  return tool === "draw" || tool === "erase" || tool === "tint" || tool === "shape" || tool === "clone";
}

/** Width and strength of the tool in use. */
export function currentSettings(): { size: number; strength: number } {
  const p = usePaint.getState();
  return p.settings[settingsKey(p)];
}

/** Tools drawn along the pointer with a round tip. */
function tipped(tool: StageTool): boolean {
  return tool === "draw" || tool === "erase" || tool === "tint" || tool === "clone";
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
  const transform = composeTransforms(track?.transform ?? IDENTITY_TRANSFORM, clip?.transform ?? IDENTITY_TRANSFORM);
  const real = { width: s.canvas.width, height: s.canvas.height };
  // A new drawing is the film's size; a picture keeps its own proportions (the surface may be a reduced copy).
  const media = clip?.media ?? real;
  return pictureMatrix({ media: media as Clip["media"], transform, look: clip?.look }, film.settings, real).inverse();
}

interface StrokePoint extends Point {
  /** Width here, in film pixels. */
  w: number;
  /** Pen pressure, 0–1 (1 for a mouse). */
  p: number;
}

interface Stroke {
  tool: "draw" | "erase" | "tint" | "shape" | "clone";
  brush: BrushKind;
  shape: ShapeKind;
  shapeFill: boolean;
  /** Shapes: square, circle, or lines at 45°. */
  constrain: boolean;
  points: StrokePoint[];
  /** Points already on the layer. */
  drawn: number;
  color: string;
  strength: number;
  /** The stroke alone, at the surface's size; laid on it when the stroke ends. */
  layer: OffscreenCanvas | null;
  /** Clone stamp: the picture copied from, in film coordinates, and how far from the brush. */
  clone?: { picture: OffscreenCanvas; offset: Point };
  surface: Surface | null;
}

let stroke: Stroke | null = null;
/** The picture with the stroke on it, as the stage shows it while painting. */
let view: { canvas: OffscreenCanvas; dirty: boolean } | null = null;
/** Where the pointer is over the film, for the brush outline. */
let hover: Point | null = null;

/** How the stroke's layer goes on the picture. */
function operation(s: Stroke): GlobalCompositeOperation {
  return s.tool === "erase" ? "destination-out" : s.tool === "tint" ? "source-atop" : "source-over";
}

/** Lays the stroke's layer on a canvas showing the picture. */
function layOn(ctx: OffscreenCanvasRenderingContext2D, s: Stroke) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = s.strength;
  ctx.globalCompositeOperation = operation(s);
  ctx.drawImage(s.layer!, 0, 0);
  ctx.restore();
}

/** The canvas being painted for a track's picture at a cell (with the stroke in progress), while it is the one there. */
export function surfaceAt(film: FilmState, track: TrackId, cell: number): OffscreenCanvas | null {
  if (!surface || !isPainting(usePaint.getState().tool)) return null;
  if (!matches(surface, track, cell, clipAt(film, track, cell))) return null;
  const s = stroke;
  if (!s || s.surface !== surface || !s.layer) return surface.canvas;
  const { width, height } = surface.canvas;
  if (!view || view.canvas.width !== width || view.canvas.height !== height) view = { canvas: new OffscreenCanvas(width, height), dirty: true };
  if (view.dirty) {
    const ctx = view.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(surface.canvas, 0, 0);
    layOn(ctx, s);
    view.dirty = false;
  }
  return view.canvas;
}

export function brushOutline(): { at: Point; size: number } | null {
  return hover && tipped(usePaint.getState().tool) ? { at: hover, size: currentSettings().size } : null;
}

/** Where the clone stamp copies from right now, to mark it on the picture. */
export function cloneMarker(): Point | null {
  const { tool, cloneSource } = usePaint.getState();
  if (tool !== "clone" || !cloneSource) return null;
  const { cell } = useEditor.getState().cursor;
  const offset = stroke?.clone?.offset ?? cloneSource.offset;
  if (offset && hover) return { x: hover.x + offset.x, y: hover.y + offset.y };
  return cell === cloneSource.cell ? cloneSource.at : null;
}

/** Copies the clone source into a round dab at `p`. */
function stamp(ctx: OffscreenCanvasRenderingContext2D, clone: NonNullable<Stroke["clone"]>, p: Point & { w: number }) {
  const r = p.w / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();
  // Only the square under the dab, to keep each dab cheap.
  const x = Math.floor(p.x - r - 1);
  const y = Math.floor(p.y - r - 1);
  const size = Math.ceil(2 * r + 2);
  ctx.drawImage(clone.picture, x + clone.offset.x, y + clone.offset.y, size, size, x, y, size, size);
  ctx.restore();
}

/** A soft round dab (airbrush), denser with more pen pressure. */
function softDab(ctx: OffscreenCanvasRenderingContext2D, color: string, p: StrokePoint) {
  const r = Math.max(1, p.w / 2);
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, `${color}00`);
  ctx.globalAlpha = 0.12 * p.p;
  ctx.fillStyle = g;
  ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
}

/** Points between two, close enough for dabs to make a continuous line. */
function* along(a: StrokePoint, b: StrokePoint, spacing: number): Generator<StrokePoint> {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.5, spacing)));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    yield { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, p: a.p + (b.p - a.p) * t };
  }
}

/** The shape from the first point to the last one. */
function drawShape(ctx: OffscreenCanvasRenderingContext2D, s: Stroke) {
  const a = s.points[0]!;
  const last = s.points[s.points.length - 1]!;
  let b: Point = last;
  if (s.constrain) {
    const dx = last.x - a.x;
    const dy = last.y - a.y;
    if (s.shape === "line") {
      // The nearest multiple of 45°.
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      b = { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
    } else {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      b = { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
    }
  }
  ctx.lineWidth = a.w;
  ctx.beginPath();
  if (s.shape === "line") {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (s.shape === "box") {
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else {
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  }
  if (s.shapeFill && s.shape !== "line") ctx.fill();
  ctx.stroke();
}

/** Draws the points not drawn yet onto the stroke's layer (a shape is drawn anew each time). */
function drawPending(s: Stroke) {
  const surf = s.surface;
  const { film } = useEditor.getState();
  if (!surf || !film || !s.layer || s.drawn >= s.points.length) return;
  if (s.tool === "clone" && !s.clone) return;
  const ctx = s.layer.getContext("2d")!;
  ctx.save();
  if (s.tool === "shape") {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s.layer.width, s.layer.height);
  }
  ctx.setTransform(filmToSurface(film, surf));
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineCap = ctx.lineJoin = "round";
  const soft = s.tool === "draw" && BRUSHES[s.brush].soft;
  if (s.tool === "shape") {
    drawShape(ctx, s);
  } else {
    if (s.drawn === 0) {
      // A dot where the stroke starts (a click alone leaves one).
      const p = s.points[0]!;
      if (s.clone) stamp(ctx, s.clone, p);
      else if (soft) softDab(ctx, s.color, p);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      s.drawn = 1;
    }
    for (let i = s.drawn; i < s.points.length; i++) {
      const a = s.points[i - 1]!;
      const b = s.points[i]!;
      if (s.clone) for (const q of along(a, b, Math.min(a.w, b.w) / 6)) stamp(ctx, s.clone, q);
      else if (soft) for (const q of along(a, b, Math.min(a.w, b.w) / 8)) softDab(ctx, s.color, q);
      else {
        ctx.lineWidth = (a.w + b.w) / 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  s.drawn = s.points.length;
  ctx.restore();
  if (view) view.dirty = true;
}

function pointAt(s: Pick<Stroke, "tool" | "brush">, p: Point, pressure: number, pen: boolean): StrokePoint {
  const { size } = currentSettings();
  const press = pen ? Math.max(0.05, pressure) : 1;
  // A pen draws thinner when pressed lightly (as much as the brush says); a mouse or finger always full width.
  const thins = s.tool === "draw" ? BRUSHES[s.brush].pressure : s.tool === "shape" ? 0 : 0.5;
  return { x: p.x, y: p.y, w: size * (1 - thins + thins * press), p: press };
}

/** A track's picture at a cell as the stage shows it, in film coordinates (no transparency of the track). */
async function pictureInFilm(film: FilmState, track: TrackId, cell: number): Promise<OffscreenCanvas | null> {
  const { filmId } = useEditor.getState();
  const t = film.tracks.find((x) => x.id === track);
  const clip = clipAt(film, track, cell);
  if (!filmId || !t || !clip) return null;
  // The picture being painted, as it is now; otherwise the stored one.
  const painted = surface && matches(surface, track, cell, clip) ? surface.canvas : null;
  const image: CanvasImageSource = painted ?? (await createImageBitmap(await storage.getAsset(filmId, clip.media.original), { imageOrientation: "from-image" }));
  const out = new OffscreenCanvas(film.settings.width, film.settings.height);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const size = painted ? { width: painted.width, height: painted.height } : clip.media;
  drawStack(ctx, [{ media: { ...clip.media, ...size }, opacity: 1, transform: composeTransforms(t.transform, clip.transform), look: clip.look }], film.settings, () => image);
  if (image instanceof ImageBitmap) image.close();
  return out;
}

/** Starts a stroke (or fills) at a film point. Returns false when there is nowhere to paint. */
export function beginStroke(p: Point, pressure: number, pen: boolean, mods: { alt?: boolean; shift?: boolean } = {}): boolean {
  const { film } = useEditor.getState();
  const paint = usePaint.getState();
  const tool = paint.tool;
  if (!film || !isPainting(tool) || tool === "picker") return false;
  const at = target(film);
  if (!at) return false;
  if (tool === "clone" && mods.alt) {
    // Alt+click: copy from here (this cell, or go to another cell to paint).
    paint.setCloneSource({ track: at.track.id, cell: at.cell, at: p, offset: null });
    return true;
  }
  if (!at.track.visible) {
    useBusy.getState().notify(`El track "${at.track.name}" está oculto: mostralo para dibujar en él.`, "error");
    return true;
  }
  if (tool === "fill") {
    void fillAt(p);
    return true;
  }
  if ((tool === "erase" || tool === "tint") && !at.clip) return true;
  // Only the clone stamp copies; the source stays set for when it comes back.
  const source = tool === "clone" ? paint.cloneSource : null;
  if (tool === "clone" && !source) {
    useBusy.getState().notify("Primero Alt+clic (⌥+clic) donde querés copiar.");
    return true;
  }
  const s: Stroke = {
    tool,
    brush: paint.brush,
    shape: paint.shape,
    shapeFill: paint.shapeFill,
    constrain: !!mods.shift,
    points: [],
    drawn: 0,
    color: paint.color,
    strength: currentSettings().strength,
    layer: null,
    surface: null,
  };
  s.points.push(pointAt(s, p, pressure, pen));
  stroke = s;
  const picture = source ? ensureSurface().then(() => pictureInFilm(film, source.track, source.cell)) : null;
  void Promise.all([ensureSurface(), picture]).then(([surf, pic]) => {
    if (!surf) return;
    if (source) {
      if (!pic) {
        useBusy.getState().notify("No hay imagen donde elegiste copiar.", "error");
        if (stroke === s) stroke = null;
        return;
      }
      const offset = source.offset ?? { x: source.at.x - p.x, y: source.at.y - p.y };
      if (!source.offset) usePaint.getState().setCloneSource({ ...source, offset });
      s.clone = { picture: pic, offset };
    }
    if (s.tool === "erase") surf.alpha = true;
    s.layer = new OffscreenCanvas(surf.canvas.width, surf.canvas.height);
    s.surface = surf;
    drawPending(s);
    if (stroke !== s) finish(s);
  });
  return true;
}

const LABELS: Record<Stroke["tool"] | "fill", string> = {
  draw: "Dibujar en la imagen",
  erase: "Borrar en la imagen",
  tint: "Teñir la imagen",
  shape: "Dibujar una forma",
  clone: "Sello de clonar",
  fill: "Rellenar",
};

/** Lays a finished stroke on its picture and saves it. */
function finish(s: Stroke) {
  const surf = s.surface!;
  if (s.layer) layOn(surf.canvas.getContext("2d")!, s);
  s.layer = null;
  void save(surf, LABELS[s.tool]);
}

function hexColor(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Paint bucket: fills the area around a film point with the color. */
async function fillAt(p: Point) {
  const surf = await ensureSurface();
  const { film } = useEditor.getState();
  if (!surf || !film) return;
  const { color, fillTolerance } = usePaint.getState();
  const q = filmToSurface(film, surf).transformPoint(new DOMPoint(p.x, p.y));
  const { width: w, height: h } = surf.canvas;
  const x = Math.floor(q.x);
  const y = Math.floor(q.y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const ctx = surf.canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, w, h);
  const mask = fillMask(img.data, w, h, x, y, Math.round(fillTolerance * 2.55));
  const [r, g, b] = hexColor(color);
  const d = img.data;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  void save(surf, LABELS.fill);
}

export function moveStroke(points: Point[], pressure: number, pen: boolean, shift = false) {
  hover = points[points.length - 1] ?? hover;
  const s = stroke;
  if (!s) {
    // Hovering: have the picture ready for the next stroke.
    const tool = usePaint.getState().tool;
    if (isPainting(tool) && tool !== "picker") void ensureSurface();
    return;
  }
  s.constrain = shift;
  const smooth = s.tool === "shape" ? 0 : usePaint.getState().smooth * 0.85;
  for (const p of points) {
    // Steadying: each point goes only part of the way towards the pointer.
    const last = s.points[s.points.length - 1]!;
    const q = smooth ? { x: last.x + (p.x - last.x) * (1 - smooth), y: last.y + (p.y - last.y) * (1 - smooth) } : p;
    s.points.push(pointAt(s, q, pressure, pen));
  }
  if (s.tool === "shape") s.drawn = 1;
  drawPending(s);
}

export function endStroke() {
  const s = stroke;
  stroke = null;
  // Saved once its picture is ready (right away, unless it is still loading).
  if (s?.surface) finish(s);
}

export function leaveStage() {
  hover = null;
}

/** Strokes are saved one after another, in order. */
let saving: Promise<unknown> = Promise.resolve();

function save(surf: Surface, label: string): Promise<void> {
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
      state.commit([{ type: "clip.update", id: clip.id, patch: { media } }], label);
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
