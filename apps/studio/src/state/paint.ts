import {
  type Clip,
  type ClipId,
  type FilmState,
  type MediaRef,
  type Point,
  type Stroke,
  type StrokeTool,
  type Track,
  type TrackId,
  IDENTITY_TRANSFORM,
  clipAt,
  composeTransforms,
  fillMask,
  newId,
} from "@gepetta/core";
import { create } from "zustand";
import { picture, seedPicture, strokesKey } from "../media/composed";
import { ingestImage, storeBlob } from "../media/ingest";
import { type Size, drawStack, pictureMatrix } from "../render/frame";
import { type StrokePoint, along, composeStrokes, drawLine, drawShape, layerAssets, strokeOperation } from "../render/strokes";
import { storage } from "../storage";
import { useBusy } from "./busy";
import { useEditor } from "./editor";

/**
 * Drawing tools, after Blender's Grease Pencil: they paint on the picture at
 * the cursor (the track and cell chosen in the timeline), like a camera puts a
 * photo there. Painting on an empty cell starts a new drawing there.
 *
 * Each stroke is kept as a stroke of the picture (core `Stroke`: its points,
 * color, width…), one history step, so it can be picked, changed or removed
 * later; the picture's image itself is never changed. A fill or a clone stamp
 * keeps its own pixels, as they depend on what was under them.
 *
 * While painting, the stroke is drawn on its own layer at full strength and
 * laid on the picture at the tool's strength when it ends (so a marker does
 * not darken where it crosses itself); meanwhile the stage shows the two together.
 */
/** "camera": the active camera (see useCamera), as a tool among the others; "addCamera": choosing one more;
 * "mic", "addMic": the same for microphones (see useMics); "import": putting images and videos into cells; "sound": sound files and effects; "gain", "pan": painting each sound cell's volume or speaker on the stage; "sculpt": reshaping the strokes of the picture at the cursor. */
export type StageTool = "move" | "camera" | "addCamera" | "mic" | "addMic" | "import" | "sound" | "gain" | "pan" | "sculpt" | "lasso" | "draw" | "erase" | "fill" | "tint" | "shape" | "clone" | "picker";
export type BrushKind = "pencil" | "ink" | "marker" | "airbrush";
export type ShapeKind = "line" | "box" | "ellipse";

export const BRUSHES: Record<BrushKind, { label: string; size: number; strength: number; /** How much a light pen press thins the line, 0–1. */ pressure: number; soft: boolean }> = {
  pencil: { label: "Lápiz", size: 4, strength: 1, pressure: 0.5, soft: false },
  ink: { label: "Tinta", size: 10, strength: 1, pressure: 1, soft: false },
  marker: { label: "Marcador", size: 24, strength: 0.6, pressure: 0, soft: false },
  airbrush: { label: "Aerógrafo", size: 80, strength: 0.5, pressure: 0, soft: true },
};

export const SHAPES: Record<ShapeKind, string> = { line: "Línea", box: "Rectángulo", ellipse: "Elipse" };

/** What the sculpt tool does to the strokes under it (Blender's sculpt mode). */
export type SculptMode = "push" | "smooth" | "thicken" | "thin";
export const SCULPT_MODES: Record<SculptMode, string> = { push: "Empujar", smooth: "Suavizar", thicken: "Engrosar", thin: "Afinar" };

/** Each brush and tool keeps its own width (film pixels) and strength (0–1). */
type SettingsKey = BrushKind | "erase" | "tint" | "shape" | "clone" | "sculpt";
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
  sculpt: { size: 80, strength: 0.6 },
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
  sculpt: SculptMode;
  setTool(tool: StageTool): void;
  set(patch: Partial<Pick<PaintState, "brush" | "shape" | "shapeFill" | "color" | "smooth" | "fillTolerance" | "sculpt">>): void;
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
    case "sculpt":
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
  sculpt: remembered("sculpt", "push"),
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
export function isPainting(tool: StageTool): tool is Exclude<StageTool, "move" | "camera" | "addCamera" | "mic" | "addMic" | "import" | "sound" | "gain" | "pan" | "sculpt" | "lasso"> {
  return tool !== "move" && tool !== "camera" && tool !== "addCamera" && tool !== "mic" && tool !== "addMic" && tool !== "import" && tool !== "sound" && tool !== "gain" && tool !== "pan" && tool !== "sculpt" && tool !== "lasso";
}

/** Whether the tool has a width and a strength. */
export function hasSettings(tool: StageTool): boolean {
  return tool === "draw" || tool === "erase" || tool === "tint" || tool === "shape" || tool === "clone" || tool === "sculpt";
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

/** The picture being painted (its image with its strokes), decoded into a canvas. */
interface Surface {
  track: TrackId;
  cell: number;
  /** The picture it is (null: a new drawing not saved yet). */
  clipId: ClipId | null;
  /** What it was drawn from (image and strokes), to notice an undo or a change. */
  key: string | null;
  /** The picture's own size (a new drawing: the film's); the canvas may be smaller. */
  picture: Size;
  canvas: OffscreenCanvas;
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
  // Nothing to draw on in a sound track.
  if (track?.kind === "sound") return null;
  return track ? { track, cell: cursor.cell, clip: clipAt(film, track.id, cursor.cell) } : null;
}

function clipKey(clip: Clip): string {
  return `${clip.id}:${clip.media.original}#${strokesKey(clip.strokes)}`;
}

function matches(s: Surface, track: TrackId, cell: number, clip: Clip | undefined): boolean {
  if (s.track !== track) return false;
  if (clip) return s.clipId === clip.id && s.key === clipKey(clip);
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
  const key = `${track.id}:${clip ? clipKey(clip) : cell}`;
  if (loading?.key === key) return loading.promise;
  // Started after `loading` is set, so the check below sees it.
  const promise = Promise.resolve().then(async (): Promise<Surface | null> => {
    let made: Surface;
    if (!clip) {
      const { width, height } = film.settings;
      made = { track: track.id, cell, clipId: null, key: null, picture: { width, height }, canvas: new OffscreenCanvas(width, height) };
    } else {
      const [bmp, layers] = await Promise.all([
        storage.getAsset(filmId, clip.media.original).then((b) => createImageBitmap(b, { imageOrientation: "from-image" })),
        Promise.all(layerAssets(clip.strokes ?? []).map(async (a) => [a, await createImageBitmap(await storage.getAsset(filmId, a))] as const)),
      ]);
      const k = Math.min(1, SURFACE_MAX / Math.max(bmp.width, bmp.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      const byAsset = new Map(layers);
      composeStrokes(canvas, clip.strokes ?? [], clip.media, (a) => byAsset.get(a));
      layers.forEach(([, b]) => b.close());
      made = { track: track.id, cell, clipId: clip.id, key: clipKey(clip), picture: { width: clip.media.width, height: clip.media.height }, canvas };
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

/** Film coordinates → a picture's own pixels, as the stage draws it (`picture`: its size; a new drawing is the film's). */
function filmToPicture(film: FilmState, track: TrackId, clip: Clip | undefined): DOMMatrix {
  const t = film.tracks.find((x) => x.id === track);
  const transform = composeTransforms(t?.transform ?? IDENTITY_TRANSFORM, clip?.transform ?? IDENTITY_TRANSFORM);
  const size = clip?.media ?? film.settings;
  return pictureMatrix({ media: size as MediaRef, transform, look: clip?.look }, film.settings, size).inverse();
}

/** Picture pixels → the surface's (a reduced copy for big photos). */
function surfaceScale(s: Surface): number {
  return s.canvas.width / s.picture.width;
}

interface LiveStroke {
  tool: "draw" | "erase" | "tint" | "shape" | "clone";
  brush: BrushKind;
  shape: ShapeKind;
  shapeFill: boolean;
  /** Shapes: square, circle, or lines at 45°. */
  constrain: boolean;
  /**
   * Along the stroke, in the picture's pixels; a clone stamp's are in film
   * coordinates (it copies what the stage shows, and keeps only its pixels).
   */
  points: StrokePoint[];
  /** Points already on the layer. */
  drawn: number;
  color: string;
  strength: number;
  /** Film coordinates → the picture's pixels, and picture pixels per film pixel (for widths). */
  toPicture: DOMMatrix;
  widthScale: number;
  /** The stroke alone, at the surface's size; laid on it when the stroke ends. */
  layer: OffscreenCanvas | null;
  /** Clone stamp: the picture copied from, in film coordinates, and how far from the brush. */
  clone?: { picture: OffscreenCanvas; offset: Point };
  surface: Surface | null;
}

let stroke: LiveStroke | null = null;
/** The last stroke's layer, cleared, for the next one of the same size (a new one each time piles up memory with big photos). */
let spareLayer: OffscreenCanvas | null = null;

function takeLayer(width: number, height: number): OffscreenCanvas {
  const spare = spareLayer;
  spareLayer = null;
  return spare && spare.width === width && spare.height === height ? spare : new OffscreenCanvas(width, height);
}

function giveBackLayer(layer: OffscreenCanvas) {
  layer.getContext("2d")!.clearRect(0, 0, layer.width, layer.height);
  spareLayer = layer;
}

type Box = { x: number; y: number; width: number; height: number };

/** The part of a surface a clone stroke went over, in its pixels (whole pixels, inside it), or null if none. */
function cloneBox(s: LiveStroke, surf: Surface): Box | null {
  const { film } = useEditor.getState();
  if (!film) return null;
  const clip = surf.clipId ? film.clips[surf.clipId] : undefined;
  const m = new DOMMatrix().scale(surfaceScale(surf)).multiply(filmToPicture(film, surf.track, clip));
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w] of s.points) {
    const q = m.transformPoint(new DOMPoint(x, y));
    const r = (w / 2) * k + 2;
    x0 = Math.min(x0, q.x - r);
    y0 = Math.min(y0, q.y - r);
    x1 = Math.max(x1, q.x + r);
    y1 = Math.max(y1, q.y + r);
  }
  return clampBox(x0, y0, x1, y1, surf.canvas);
}

function clampBox(x0: number, y0: number, x1: number, y1: number, size: Size): Box | null {
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  const width = Math.min(size.width, Math.ceil(x1)) - x;
  const height = Math.min(size.height, Math.ceil(y1)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** A box of a surface in its picture's pixels. */
function pictureBox(b: Box, surf: Surface): Box {
  const k = surfaceScale(surf);
  const r = (v: number) => Math.round((v / k) * 100) / 100;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) };
}

/** Says in the console when keeping a stroke took long (to find out where painting lags). */
function timed(what: string, t0: number) {
  const ms = performance.now() - t0;
  if (ms > 30) console.info(`[gepetta] paint: ${what} ${Math.round(ms)} ms`);
}
/** The picture with the stroke on it, as the stage shows it while painting. */
let view: { canvas: OffscreenCanvas; dirty: boolean } | null = null;
/** Where the pointer is over the film, for the brush outline. */
let hover: Point | null = null;

/** Lays the stroke's layer on a canvas showing the picture. */
function layOn(ctx: OffscreenCanvasRenderingContext2D, s: LiveStroke) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = s.strength;
  ctx.globalCompositeOperation = strokeOperation(s.tool);
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

/** Copies the clone source into a round dab at `p` (film coordinates). */
function stamp(ctx: OffscreenCanvasRenderingContext2D, clone: NonNullable<LiveStroke["clone"]>, [x0, y0, w]: StrokePoint) {
  const r = w / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x0, y0, r, 0, Math.PI * 2);
  ctx.clip();
  // Only the square under the dab, to keep each dab cheap.
  const x = Math.floor(x0 - r - 1);
  const y = Math.floor(y0 - r - 1);
  const size = Math.ceil(2 * r + 2);
  ctx.drawImage(clone.picture, x + clone.offset.x, y + clone.offset.y, size, size, x, y, size, size);
  ctx.restore();
}

/** A shape's two corners, with ⇧ making squares, circles and lines at 45°. */
function shapeCorners(s: LiveStroke): StrokePoint[] {
  const a = s.points[0]!;
  const last = s.points[s.points.length - 1]!;
  if (!s.constrain) return [a, last];
  const dx = last[0] - a[0];
  const dy = last[1] - a[1];
  if (s.shape === "line") {
    // The nearest multiple of 45°.
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [a, [a[0] + Math.cos(angle) * len, a[1] + Math.sin(angle) * len, last[2], last[3]]];
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [a, [a[0] + Math.sign(dx || 1) * side, a[1] + Math.sign(dy || 1) * side, last[2], last[3]]];
}

/** Draws the points not drawn yet onto the stroke's layer (a shape is drawn anew each time). */
function drawPending(s: LiveStroke) {
  const surf = s.surface;
  const { film } = useEditor.getState();
  if (!surf || !film || !s.layer || s.drawn >= s.points.length) return;
  if (s.tool === "clone" && !s.clone) return;
  const ctx = s.layer.getContext("2d")!;
  ctx.save();
  if (s.tool === "clone") {
    const clone = s.clone!;
    const clip = surf.clipId ? film.clips[surf.clipId] : undefined;
    ctx.setTransform(new DOMMatrix().scale(surfaceScale(surf)).multiply(filmToPicture(film, surf.track, clip)));
    if (s.drawn === 0) stamp(ctx, clone, s.points[0]!);
    for (let i = Math.max(1, s.drawn); i < s.points.length; i++) {
      const a = s.points[i - 1]!;
      const b = s.points[i]!;
      for (const q of along(a, b, Math.min(a[2], b[2]) / 6)) stamp(ctx, clone, q);
    }
  } else {
    const k = surfaceScale(surf);
    if (s.tool === "shape") ctx.clearRect(0, 0, s.layer.width, s.layer.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (s.tool === "shape") drawShape(ctx, { shape: s.shape, filled: s.shapeFill, color: s.color }, shapeCorners(s));
    else drawLine(ctx, s, s.points, s.drawn);
  }
  s.drawn = s.points.length;
  ctx.restore();
  if (view) view.dirty = true;
}

/** A point of the stroke under the pointer (film point `p`), with its width. */
function pointAt(s: Pick<LiveStroke, "tool" | "brush" | "toPicture" | "widthScale">, p: Point, pressure: number, pen: boolean): StrokePoint {
  const { size } = currentSettings();
  const press = pen ? Math.max(0.05, pressure) : 1;
  // A pen draws thinner when pressed lightly (as much as the brush says); a mouse or finger always full width.
  const thins = s.tool === "draw" ? BRUSHES[s.brush].pressure : s.tool === "shape" ? 0 : 0.5;
  const w = size * (1 - thins + thins * press);
  if (s.tool === "clone") return [p.x, p.y, w, press];
  const q = s.toPicture.transformPoint(new DOMPoint(p.x, p.y));
  return [q.x, q.y, w * s.widthScale, press];
}

/** A track's picture at a cell as the stage shows it, in film coordinates (no transparency of the track). */
async function pictureInFilm(film: FilmState, track: TrackId, cell: number): Promise<OffscreenCanvas | null> {
  const { filmId } = useEditor.getState();
  const t = film.tracks.find((x) => x.id === track);
  const clip = clipAt(film, track, cell);
  if (!filmId || !t || !clip) return null;
  // The picture being painted, as it is now; otherwise the stored one with its strokes.
  const painted = surface && matches(surface, track, cell, clip) ? surface.canvas : null;
  const image: CanvasImageSource = painted ?? (await picture(filmId, clip.media, clip.strokes ?? [], "original"));
  const out = new OffscreenCanvas(film.settings.width, film.settings.height);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  drawStack(ctx, [{ media: clip.media, opacity: 1, transform: composeTransforms(t.transform, clip.transform), look: clip.look }], film.settings, () => image);
  return out;
}

/** Starts a stroke (or fills) at a film point. Returns false when there is nowhere to paint. */
export function beginStroke(p: Point, pressure: number, pen: boolean, mods: { alt?: boolean; shift?: boolean } = {}): boolean {
  const { film } = useEditor.getState();
  const paint = usePaint.getState();
  const tool = paint.tool;
  if (!film || !isPainting(tool) || tool === "picker") return false;
  const at = target(film);
  if (!at) {
    if (film.tracks.find((t) => t.id === useEditor.getState().cursor.track)?.kind === "sound") useBusy.getState().notify("Es un track de sonido: para dibujar, elegí un track de imágenes.");
    return false;
  }
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
  const toPicture = filmToPicture(film, at.track.id, at.clip);
  const s: LiveStroke = {
    tool,
    brush: paint.brush,
    shape: paint.shape,
    shapeFill: paint.shapeFill,
    constrain: !!mods.shift,
    points: [],
    drawn: 0,
    color: paint.color,
    strength: currentSettings().strength,
    toPicture,
    // How long a film pixel is in the picture (scaling and rotation alike).
    widthScale: Math.sqrt(Math.abs(toPicture.a * toPicture.d - toPicture.b * toPicture.c)),
    layer: null,
    surface: null,
  };
  s.points.push(pointAt(s, p, pressure, pen));
  stroke = s;
  const copied = source ? ensureSurface().then(() => pictureInFilm(film, source.track, source.cell)) : null;
  void Promise.all([ensureSurface(), copied]).then(([surf, pic]) => {
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
    s.layer = takeLayer(surf.canvas.width, surf.canvas.height);
    s.surface = surf;
    drawPending(s);
    if (stroke !== s) finish(s);
  });
  return true;
}

const LABELS: Record<StrokeTool, string> = {
  draw: "Dibujar en la imagen",
  erase: "Borrar en la imagen",
  tint: "Teñir la imagen",
  shape: "Dibujar una forma",
  clone: "Sello de clonar",
  fill: "Rellenar",
};

const round = (v: number) => Math.round(v * 100) / 100;

/** Lays a finished stroke on its picture and keeps it as a stroke of the picture. */
function finish(s: LiveStroke) {
  const surf = s.surface!;
  if (!s.layer) return;
  const t0 = performance.now();
  layOn(surf.canvas.getContext("2d")!, s);
  const layer = s.layer;
  s.layer = null;
  const base = { id: newId(), tool: s.tool, strength: s.strength } as const;
  if (s.tool === "clone") {
    // Its pixels (it copied what was there): only the part it went over.
    const box = cloneBox(s, surf);
    let png: Promise<Blob> | null = null;
    if (box) {
      const part = new OffscreenCanvas(box.width, box.height);
      part.getContext("2d")!.drawImage(layer, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      png = part.convertToBlob({ type: "image/png" });
    }
    giveBackLayer(layer);
    timed("sello", t0);
    if (box && png) void keep(surf, png.then((blob) => ({ ...base, layer: blob, box: pictureBox(box, surf) })));
    return;
  }
  giveBackLayer(layer);
  const points = (s.tool === "shape" ? shapeCorners(s) : s.points).map(([x, y, w, p]): StrokePoint => [round(x), round(y), round(w), round(p)]);
  const kept: Omit<Stroke, "layer"> = {
    ...base,
    points,
    ...(s.tool !== "erase" && { color: s.color }),
    ...(s.tool === "draw" && { brush: s.brush }),
    ...(s.tool === "shape" && { shape: s.shape, filled: s.shapeFill }),
  };
  void keep(surf, Promise.resolve(kept));
  timed("trazo", t0);
}

function hexColor(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Paint bucket: fills the area around a film point with the color (kept as the filled pixels). */
async function fillAt(p: Point) {
  const surf = await ensureSurface();
  const { film } = useEditor.getState();
  if (!surf || !film) return;
  const { color, fillTolerance } = usePaint.getState();
  const clip = surf.clipId ? film.clips[surf.clipId] : undefined;
  const q = filmToPicture(film, surf.track, clip).transformPoint(new DOMPoint(p.x, p.y));
  const k = surfaceScale(surf);
  const { width: w, height: h } = surf.canvas;
  const x = Math.floor(q.x * k);
  const y = Math.floor(q.y * k);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const ctx = surf.canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, w, h);
  const mask = fillMask(img.data, w, h, x, y, Math.round(fillTolerance * 2.55));
  const [r, g, b] = hexColor(color);
  // Only the part filled is kept.
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const px = i % w;
    const py = (i - px) / w;
    if (px < x0) x0 = px;
    if (px >= x1) x1 = px + 1;
    if (py < y0) y0 = py;
    if (py >= y1) y1 = py + 1;
  }
  const box = clampBox(x0, y0, x1, y1, surf.canvas);
  if (!box) return;
  const layer = new ImageData(box.width, box.height);
  const d = layer.data;
  for (let yy = 0; yy < box.height; yy++) {
    for (let xx = 0; xx < box.width; xx++) {
      if (!mask[(box.y + yy) * w + box.x + xx]) continue;
      const o = (yy * box.width + xx) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(box.width, box.height);
  canvas.getContext("2d")!.putImageData(layer, 0, 0);
  ctx.drawImage(canvas, box.x, box.y);
  void keep(
    surf,
    canvas
      .convertToBlob({ type: "image/png" })
      .then((png) => ({ id: newId(), tool: "fill" as const, strength: 1, color, layer: png, box: pictureBox(box, surf) })),
  );
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
    const next = pointAt(s, p, pressure, pen);
    // Steadying: each point goes only part of the way towards the pointer.
    const last = s.points[s.points.length - 1]!;
    if (smooth) {
      next[0] = last[0] + (next[0] - last[0]) * (1 - smooth);
      next[1] = last[1] + (next[1] - last[1]) * (1 - smooth);
    }
    s.points.push(next);
  }
  if (s.tool === "shape") s.drawn = 1;
  drawPending(s);
}

export function endStroke() {
  const s = stroke;
  stroke = null;
  // Kept once its picture is ready (right away, unless it is still loading).
  if (s?.surface) finish(s);
}

export function leaveStage() {
  hover = null;
}

/** A blank picture the film's size, for drawings started on an empty cell (stored once per size). */
const blanks = new Map<string, Promise<MediaRef>>();

function blankMedia(filmId: string, size: Size): Promise<MediaRef> {
  const key = `${filmId}/${size.width}x${size.height}`;
  let p = blanks.get(key);
  if (!p) {
    const canvas = new OffscreenCanvas(size.width, size.height);
    // A canvas is only encoded once it has a context.
    canvas.getContext("2d");
    p = canvas.convertToBlob({ type: "image/png" }).then((png) => ingestImage(filmId, png, null, { sourceKind: "drawing" }));
    p.catch(() => blanks.delete(key));
    blanks.set(key, p);
  }
  return p;
}

/** Strokes are kept one after another, in order. */
let saving: Promise<unknown> = Promise.resolve();

/**
 * Keeps a stroke on the surface's picture as one history step: added to the
 * picture there, or a new drawing in that cell. `pending` gives the stroke
 * (with a fill or clone's pixels still to be stored).
 */
function keep(surf: Surface, pending: Promise<Omit<Stroke, "layer"> & { layer?: Blob }>): Promise<void> {
  const run = async () => {
    const { filmId } = useEditor.getState();
    if (!filmId) return;
    const { layer, ...rest } = await pending;
    const stroke: Stroke = { ...rest, ...(layer && { layer: await storeBlob(filmId, layer) }) };
    const state = useEditor.getState();
    if (state.filmId !== filmId || !state.film) return;
    const t0 = performance.now();
    const label = LABELS[stroke.tool];
    let clip = surf.clipId ? state.film.clips[surf.clipId] : undefined;
    if (clip) {
      state.commit([{ type: "stroke.add", clip: clip.id, stroke, label }], label);
    } else {
      const media = await blankMedia(filmId, surf.picture);
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
        strokes: [stroke],
      };
      useEditor.getState().commit([{ type: "clip.place", clips: [placed], label: "Dibujo" }], "Dibujo nuevo");
      surf.clipId = placed.id;
    }
    // The surface already shows it: it stays the picture's, and the stage shows it at once.
    clip = useEditor.getState().film?.clips[surf.clipId!];
    if (!clip) return;
    surf.key = clipKey(clip);
    seedPicture(filmId, clip.media, clip.strokes ?? [], surf.canvas);
    timed("guardar el trazo", t0);
  };
  const next = saving.then(run);
  saving = next.catch((e: unknown) => {
    console.error(e);
    useBusy.getState().notify("No se pudo guardar el trazo.", "error");
  });
  return next.catch(() => undefined);
}

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
