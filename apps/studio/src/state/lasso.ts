import {
  type Clip,
  type ClipId,
  type FilmState,
  type Look,
  type Mask,
  type Op,
  type Point,
  applyOp,
  blendSequenceMasksOps,
  clipAt,
  composeTransforms,
  insideOutline,
  newId,
  normalizeOutline,
  rectOutline,
  sequenceClips,
} from "@gepetta/core";
import { create } from "zustand";
import { type Drawable, pictureMatrix } from "../render/frame";
import { newTrackOp } from "./actions";
import { useBusy } from "./busy";
import { useEditor } from "./editor";
import { useLayers } from "./layers";

/**
 * The lasso: an outline drawn around part of the picture in the cell picked
 * (freehand or a rectangle) keeps only that part, without touching the photo
 * (see Look.mask). Its points can be pushed to fit it better, and in a
 * sequence the outlines drawn on some pictures are blended for the ones in
 * between, to cut out something that moves. What is cut out can go to a
 * track of its own (one per character).
 */

type Pt = [number, number];
export type LassoMode = "free" | "rect";

/** Soft edge a new outline gets, in fractions of the picture's longer side. */
const DEFAULT_FEATHER = 0.002;
/** How near (CSS pixels) a press must be to the outline to push its points, and how far around the push reaches. */
const GRAB = 14;
const PUSH_RADIUS = 70;

function remembered<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`gepetta.lasso.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

interface LassoState {
  mode: LassoMode;
  /** In a sequence: the outline is for all of it (blended between the ones drawn by hand). */
  whole: boolean;
  /** The outline being drawn or pushed, in fractions of the picture, before it is kept. */
  draft: { clip: ClipId; points: Pt[]; closed: boolean } | null;
  set(patch: Partial<Pick<LassoState, "mode" | "whole">>): void;
}

export const useLasso = create<LassoState>((set) => ({
  mode: remembered<LassoMode>("mode", "free"),
  whole: remembered("whole", true),
  draft: null,
  set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      try {
        localStorage.setItem(`gepetta.lasso.${k}`, JSON.stringify(v));
      } catch {
        // Not remembered.
      }
    }
    set(patch);
  },
}));

/** The picture the lasso works on (the one in the cell picked), and where its pixels land in the film. */
export function lassoTarget(film: FilmState): { clip: Clip; matrix: DOMMatrix } | null {
  const { cursor } = useEditor.getState();
  const clip = clipAt(film, cursor.track, cursor.cell);
  const track = film.tracks.find((t) => t.id === cursor.track);
  if (!clip || !track?.visible) return null;
  const transform = composeTransforms(track.transform, clip.transform);
  return { clip, matrix: pictureMatrix({ media: clip.media, transform, look: clip.look }, film.settings, clip.media) };
}

/** A film point in fractions of the picture, and back. */
function toPicture(inverse: DOMMatrix, clip: Clip, p: Point): Pt {
  const q = inverse.transformPoint(new DOMPoint(p.x, p.y));
  return [q.x / clip.media.width, q.y / clip.media.height];
}
export function toFilm(matrix: DOMMatrix, clip: Clip, [x, y]: Pt): Point {
  const q = matrix.transformPoint(new DOMPoint(x * clip.media.width, y * clip.media.height));
  return { x: q.x, y: q.y };
}

interface Session {
  kind: "free" | "rect" | "push" | "move";
  clip: Clip;
  matrix: DOMMatrix;
  inverse: DOMMatrix;
  start: Pt;
  base: Pt[];
  /** Push: how much each point follows the pointer. */
  weights: number[];
  points: Pt[];
}

let session: Session | null = null;

function falloff(d: number, r: number): number {
  if (d >= r) return 0;
  const t = 1 - (d / r) ** 2;
  return t * t;
}

/**
 * Starts a lasso gesture at a film point (`px`: film units per CSS pixel):
 * near the outline it pushes its points, inside it moves it, elsewhere it
 * draws a new one. False when there is no picture to work on.
 */
export function beginLasso(p: Point, px: number): boolean {
  const { film } = useEditor.getState();
  const target = film && lassoTarget(film);
  if (!target) {
    useBusy.getState().notify("Elegí en la línea de tiempo la celda de una imagen para recortarla con el lazo.");
    return false;
  }
  const { clip, matrix } = target;
  const inverse = matrix.inverse();
  const start = toPicture(inverse, clip, p);
  const mask = clip.look?.mask;
  let kind: Session["kind"] = useLasso.getState().mode;
  let weights: number[] = [];
  if (mask) {
    const dist = mask.points.map((q) => {
      const f = toFilm(matrix, clip, q);
      return Math.hypot(f.x - p.x, f.y - p.y);
    });
    if (Math.min(...dist) <= GRAB * px) {
      kind = "push";
      weights = dist.map((d) => falloff(d, PUSH_RADIUS * px));
    } else if (insideOutline(start, mask.points)) kind = "move";
  }
  const base = mask?.points ?? [];
  session = { kind, clip, matrix, inverse, start, base, weights, points: kind === "push" || kind === "move" ? base : [start] };
  showDraft();
  return true;
}

export function moveLasso(p: Point) {
  const s = session;
  if (!s) return;
  const q = toPicture(s.inverse, s.clip, p);
  const dx = q[0] - s.start[0];
  const dy = q[1] - s.start[1];
  if (s.kind === "free") {
    const last = s.points[s.points.length - 1]!;
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.002) return;
    s.points = [...s.points, q];
  } else if (s.kind === "rect") s.points = [s.start, q];
  else if (s.kind === "move") s.points = s.base.map(([x, y]) => [x + dx, y + dy]);
  else s.points = s.base.map(([x, y], i) => [x + dx * s.weights[i]!, y + dy * s.weights[i]!]);
  showDraft();
}

function showDraft() {
  const s = session;
  if (!s) return useLasso.setState({ draft: null });
  const points = s.kind === "rect" && s.points.length === 2 ? rectOutline(s.points[0]!, s.points[1]!) : s.points;
  useLasso.setState({ draft: { clip: s.clip.id, points, closed: s.kind !== "free" } });
}

/** Keeps the outline drawn, pushed or moved (one history step). */
export function endLasso() {
  const s = session;
  session = null;
  useLasso.setState({ draft: null });
  if (!s) return;
  let points: Pt[] | null = null;
  if (s.kind === "free" && s.points.length >= 3) points = normalizeOutline(s.points);
  else if (s.kind === "rect" && s.points.length === 2) {
    const [a, b] = s.points as [Pt, Pt];
    if (Math.abs(a[0] - b[0]) > 0.005 && Math.abs(a[1] - b[1]) > 0.005) points = rectOutline(a, b);
  } else if ((s.kind === "push" || s.kind === "move") && s.points !== s.base) {
    points = s.points.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
  }
  if (points) setOutline(s.clip.id, points);
}

export function lassoActive(): boolean {
  return session !== null;
}

/** Puts an outline drawn by hand on a picture (and, for a whole sequence, blends the others). */
function setOutline(id: ClipId, points: Pt[]) {
  const { film, commit } = useEditor.getState();
  const clip = film?.clips[id];
  if (!film || !clip) return;
  const prev = clip.look?.mask;
  const mask: Mask = { points, key: true, feather: prev?.feather ?? DEFAULT_FEATHER, ...(prev?.invert && { invert: true }) };
  const ops: Op[] = [{ type: "clip.update", id, patch: { look: { ...clip.look, mask } } }];
  if (clip.seq && useLasso.getState().whole) ops.push(...blendSequenceMasksOps(applyOp(film, ops[0]!), clip.seq));
  commit(ops, prev ? "Ajustar el lazo" : "Lazo");
}

/** The pictures a change of the lasso panel goes to: the whole sequence, or just this one. */
export function lassoScope(film: FilmState, clip: Clip): Clip[] {
  return clip.seq && useLasso.getState().whole ? sequenceClips(film, clip.seq) : [clip];
}

function withMask(look: Look | undefined, mask: Mask | undefined): Look {
  const next = { ...look };
  if (mask) next.mask = mask;
  else delete next.mask;
  return next;
}

/** Changes how the outlines cut (what is kept, the soft edge) on the pictures that have one. */
export function setMaskOptions(clip: Clip, patch: Partial<Pick<Mask, "invert" | "feather">>) {
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const ops: Op[] = lassoScope(film, clip)
    .filter((c) => c.look?.mask)
    .map((c) => ({ type: "clip.update", id: c.id, patch: { look: withMask(c.look, { ...c.look!.mask!, ...patch }) } }));
  if (ops.length) commit(ops, patch.invert !== undefined ? "Lazo: qué se deja" : "Lazo: borde");
}

/** Takes the outlines off (the pictures show whole again). */
export function clearMasks(clip: Clip) {
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const ops: Op[] = lassoScope(film, clip)
    .filter((c) => c.look?.mask)
    .map((c) => ({ type: "clip.update", id: c.id, patch: { look: withMask(c.look, undefined) } }));
  if (ops.length) commit(ops, "Quitar el lazo");
}

/** A sequence's outlines blended again from the ones drawn by hand. */
export function reblend(clip: Clip) {
  const { film, commit } = useEditor.getState();
  if (!film || !clip.seq) return;
  const ops = blendSequenceMasksOps(film, clip.seq);
  if (ops.length) commit(ops, "Repartir el lazo en la secuencia");
}

/** Marks (or unmarks) the outline of this picture as drawn by hand. */
export function setKey(clip: Clip, key: boolean) {
  const mask = clip.look?.mask;
  if (!mask) return;
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const next: Mask = { ...mask };
  if (key) next.key = true;
  else delete next.key;
  const ops: Op[] = [{ type: "clip.update", id: clip.id, patch: { look: withMask(clip.look, next) } }];
  if (clip.seq) ops.push(...blendSequenceMasksOps(applyOp(film, ops[0]!), clip.seq));
  commit(ops, key ? "Lazo: cuadro clave" : "Lazo: ya no es clave");
}

/**
 * What the lasso cut out goes to a new track right above (one per
 * character): a copy of each picture with its outline. The pictures it came
 * from show whole again, or keep a hole where it was (`hole`).
 */
export function takeToNewTrack(clip: Clip, hole: boolean) {
  const { film, commit, cursor } = useEditor.getState();
  if (!film) return;
  const clips = lassoScope(film, clip).filter((c) => c.look?.mask);
  const track = film.tracks.find((t) => t.id === clip.track);
  if (!clips.length || !track) return;
  const taken = film.tracks.filter((t) => t.name.startsWith("Personaje")).length;
  const { id: trackId, op } = newTrackOp(`Personaje ${taken + 1}`, { transform: track.transform, opacity: track.opacity });
  const seq = clips.length > 1 ? newId() : undefined;
  const copies: Clip[] = clips.map((c) => {
    const copy: Clip = { ...c, id: newId(), track: trackId };
    if (seq) copy.seq = seq;
    else delete copy.seq;
    return copy;
  });
  const ops: Op[] = [op, { type: "track.move", trackId, index: film.tracks.indexOf(track) + 1 }, { type: "clip.place", clips: copies }];
  for (const c of clips) {
    const mask = c.look!.mask!;
    ops.push({ type: "clip.update", id: c.id, patch: { look: withMask(c.look, hole ? { ...mask, invert: !mask.invert } : undefined) } });
  }
  const here = copies.find((c) => cursor.cell >= c.start && cursor.cell < c.start + c.length) ?? copies[0]!;
  commit(ops, `Llevar a «Personaje ${taken + 1}»`, { cursor: { track: trackId, cell: cursor.cell }, selection: [here.id] });
  useLayers.getState().showCell(trackId);
}

/**
 * While the lasso is in use, what its outline leaves out, to draw faintly:
 * the picture with its outline turned the other way and a hard edge.
 */
export function lassoGhost(film: FilmState): Drawable | null {
  const { cursor } = useEditor.getState();
  const clip = clipAt(film, cursor.track, cursor.cell);
  const track = film.tracks.find((t) => t.id === cursor.track);
  const mask = clip?.look?.mask;
  if (!clip || !mask || !track?.visible) return null;
  return {
    media: clip.media,
    opacity: 1,
    transform: composeTransforms(track.transform, clip.transform),
    look: { ...clip.look, mask: { points: mask.points, invert: !mask.invert } },
    strokes: clip.strokes,
  };
}

/** Draws the lasso's outline (or the one being drawn) over the picture, with its points; `px` is film units per CSS pixel. */
export function drawLassoOutline(ctx: CanvasRenderingContext2D, film: FilmState, px: number) {
  const target = lassoTarget(film);
  if (!target) return;
  const { clip, matrix } = target;
  const draft = useLasso.getState().draft;
  const own = draft?.clip === clip.id ? draft : null;
  const points = own?.points ?? clip.look?.mask?.points;
  if (!points?.length) return;
  const closed = own ? own.closed : true;
  const path = new Path2D();
  points.forEach((q, i) => {
    const f = toFilm(matrix, clip, q);
    if (i) path.lineTo(f.x, f.y);
    else path.moveTo(f.x, f.y);
  });
  if (closed) path.closePath();
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3 * px;
  ctx.strokeStyle = "rgb(0 0 0 / 0.7)";
  ctx.stroke(path);
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([6 * px, 4 * px]);
  ctx.strokeStyle = clip.look?.mask?.key || !clip.seq ? "#ff7a45" : "#5cc8b5";
  ctx.stroke(path);
  ctx.setLineDash([]);
  if (closed) {
    ctx.fillStyle = "#fff";
    for (const q of points) {
      const f = toFilm(matrix, clip, q);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 2.2 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

import.meta.hot?.accept(() => location.reload());
