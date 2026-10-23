import {
  type CaptureMeta,
  type Clip,
  type ClipId,
  type FilmState,
  IDENTITY_TRANSFORM,
  isPlainLook,
  type MediaRef,
  type Op,
  type Track,
  type TrackId,
  clipAt,
  clipEnd,
  newId,
} from "@gepetta/core";
import { onRemoteMessage } from "../capture/remote";
import { rotateBlob } from "../capture/types";
import { ingestImage, isImageFile, sortFiles } from "../media/ingest";
import { grabStill } from "../media/video";
import { runTask, useBusy } from "./busy";
import { PLAIN_SHOT, type Rig, type Shot, useCamera } from "./camera";
import { type GridCursor, useEditor } from "./editor";
import { useLayers } from "./layers";
import { pickedStrokes, removeStrokes } from "./strokes";

/** Clips for pictures placed one after another from `at`, each `length` cells long (with a camera's settings, if from one). */
function clipsFrom(at: GridCursor, media: MediaRef[], length: number, name: string, shot: Shot = PLAIN_SHOT): Clip[] {
  return media.map((m, i) => ({
    id: newId(),
    track: at.track,
    start: at.cell + i * length,
    length,
    media: m,
    name,
    visible: true,
    opacity: shot.opacity,
    transform: shot.transform,
    ...(!isPlainLook(shot.look) && { look: shot.look }),
  }));
}

/** Cameras taking a photo right now (one shot at a time per camera). */
const capturing = new Set<string>();
/** Stills are placed one after another, in arrival order. */
let placeQueue: Promise<unknown> = Promise.resolve();

/** The camera to use: the given one, or the active one. */
function rigFor(rigId?: string): Rig | undefined {
  const { rigs, activeRig } = useCamera.getState();
  return rigs.find((r) => r.id === (rigId ?? activeRig));
}

/**
 * Puts a photo at the camera's target (replacing what was in that cell) and
 * moves the target past it, ready for the next one.
 */
function placeStill(rigId: string | null, image: Blob, raw: Blob | null, label: string, meta?: CaptureMeta, shot?: Shot): Promise<void> {
  const run = async () => {
    const { filmId } = useEditor.getState();
    if (!filmId) return;
    const media = await ingestImage(filmId, image, raw, meta);
    const state = useEditor.getState();
    if (state.filmId !== filmId) return;
    const rig = rigId ? rigFor(rigId) : undefined;
    const target = rig ? useCamera.getState().targetOf(rig) : state.cursor;
    const [clip] = clipsFrom(target, [media], state.captureStep, label, shot ?? rig?.shot);
    state.commit([{ type: "clip.place", clips: [clip!], label }], undefined, { selection: [] });
    const next = { track: clip!.track, cell: clipEnd(clip!) };
    if (rig) useCamera.getState().setTarget(rig.id, next);
    else state.moveTo(next.cell, next.track, true);
  };
  const next = placeQueue.then(run);
  placeQueue = next.catch(() => undefined);
  return next;
}

/** Takes a photo with a camera (the active one by default) into its target cell. */
export async function capture(rigId?: string) {
  const { filmId, captureAverage } = useEditor.getState();
  const rig = rigFor(rigId);
  const source = rig?.source;
  if (!filmId || !rig || !source || capturing.has(rig.id) || rig.recording) return;
  capturing.add(rig.id);
  try {
    // Snapshot what the app knows before the shot (the lens may move right after).
    const meta: CaptureMeta = { source: useCamera.getState().labelOf(source.id) ?? undefined, sourceKind: source.kind };
    const focus = rig.controls.find((c) => c.kind === "focus");
    if (focus?.kind === "focus" && focus.position !== null && focus.origin) {
      meta.focusPosition = focus.position;
      meta.focusOrigin = focus.origin;
    }
    const rotation = useCamera.getState().rotationOf(rig);
    // The settings as seen when the shot is taken.
    const shot = rig.shot;
    const still = await source.capture(captureAverage);
    await placeStill(rig.id, await rotateBlob(still.image, rotation), still.raw?.blob ?? null, "Foto", meta, shot);
  } catch (e) {
    useBusy.getState().notify(e instanceof Error ? e.message : "No se pudo sacar la foto", "error");
  } finally {
    capturing.delete(rig.id);
  }
}

/** The cameras the big camera button shoots with: enabled, open and not recording. */
export function readyRigs(rigs: Rig[]): Rig[] {
  return rigs.filter((r) => r.enabled && r.source && !r.recording);
}

/** Takes a photo with every enabled camera at once, each into its own target. */
export async function captureAll() {
  const rigs = readyRigs(useCamera.getState().rigs);
  if (rigs.length === 0) {
    useBusy.getState().notify("No hay ninguna cámara habilitada para sacar la foto.", "error");
    return;
  }
  await Promise.all(rigs.map((r) => capture(r.id)));
}

// Photos shot from a phone (its own shutter or photo mode) go to that phone's target.
onRemoteMessage((sessionId, header, payload) => {
  if (header.t !== "photo" || header.requestId !== null || !payload) return;
  if (!useEditor.getState().filmId) return;
  const rig = useCamera.getState().rigs.find((r) => r.deviceId === `phone:${sessionId}`);
  const photo = new Blob([payload.slice()], { type: header.mime || "image/jpeg" });
  rotateBlob(photo, header.rotation ?? 0)
    .then((upright) => placeStill(rig?.id ?? null, upright, null, "Foto del celular", { sourceKind: "phone" }))
    .catch((e) => useBusy.getState().notify(e instanceof Error ? e.message : "No se pudo agregar la foto", "error"));
});

interface Recorder {
  timer: ReturnType<typeof setInterval>;
  /** Next cell to fill. */
  next: GridCursor;
  /** Pictures stored and placed one after another, in order. */
  chain: Promise<unknown>;
  /** The history step the pictures join, once the first is placed. */
  step: string | null;
  cells: number;
  meta: CaptureMeta;
}
const recorders = new Map<string, Recorder>();

/**
 * Records video with a camera: one picture per cell, at the film's speed,
 * from the camera's live view (on a DSLR that is its live-view size). Each
 * picture goes into the next cell as soon as it is stored, and the camera's
 * target moves along, so the timeline fills while recording. The whole
 * recording is one history step.
 */
export function startRecording(rigId?: string) {
  const { filmId, film } = useEditor.getState();
  const rig = rigFor(rigId);
  if (!filmId || !film || !rig?.source || rig.recording || recorders.has(rig.id)) return;
  const id = rig.id;
  const camera = useCamera.getState();
  const rec: Recorder = {
    timer: 0 as unknown as ReturnType<typeof setInterval>,
    next: camera.targetOf(rig),
    chain: Promise.resolve(),
    step: null,
    cells: 0,
    meta: { source: camera.labelOf(rig.source.id) ?? undefined, sourceKind: rig.source.kind },
  };
  const name = `Video de ${rec.meta.source ?? "la cámara"}`;
  const grab = () => {
    const current = rigFor(id);
    const live = current ? useCamera.getState().liveOf(current) : null;
    if (!live) return;
    const canvas = new OffscreenCanvas(live.width, live.height);
    canvas.getContext("2d")!.drawImage(live.image, 0, 0, live.width, live.height);
    const encoded = canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const shot = current!.shot;
    rec.chain = rec.chain
      .then(async () => {
        const media = await ingestImage(filmId, await encoded, null, rec.meta);
        const state = useEditor.getState();
        if (state.filmId !== filmId) return;
        const [clip] = clipsFrom(rec.next, [media], 1, name, shot);
        rec.step = state.commit([{ type: "clip.place", clips: [clip!], label: "Video grabado" }], `Video grabado (${rec.cells + 1} imágenes)`, {
          amend: rec.step ?? undefined,
        });
        rec.cells++;
        rec.next = { track: rec.next.track, cell: clipEnd(clip!) };
        useCamera.getState().setTarget(id, rec.next);
        // Only while still recording (pictures stored after the stop leave it stopped).
        if (recorders.get(id) === rec) useCamera.getState().setRecording(id, { cells: rec.cells });
      })
      .catch((e) => console.warn("[gepetta] recording", e));
  };
  rec.timer = setInterval(grab, 1000 / film.settings.fps);
  recorders.set(id, rec);
  useCamera.getState().setRecording(id, { cells: 0 });
  grab();
}

/**
 * Stops a recording at once: no more pictures are taken. The ones already
 * taken and still being stored go in after it, in the background.
 */
export async function stopRecording(rigId?: string) {
  const rig = rigFor(rigId);
  const rec = rig && recorders.get(rig.id);
  if (!rig || !rec) return;
  clearInterval(rec.timer);
  recorders.delete(rig.id);
  useCamera.getState().setRecording(rig.id, null);
  await rec.chain;
}

/** The big camera button (and the space bar): a photo with every enabled camera, or video (started, then stopped). */
export function shoot() {
  const rigs = useCamera.getState().rigs;
  if (rigs.some((r) => r.recording)) return stopAllRecordings();
  if (useEditor.getState().captureMode === "photo") return void captureAll();
  const ready = readyRigs(rigs);
  if (ready.length === 0) return useBusy.getState().notify("No hay ninguna cámara habilitada para grabar.", "error");
  for (const r of ready) startRecording(r.id);
}

/** Stops every recording (e.g. when leaving the film). */
export function stopAllRecordings() {
  for (const id of recorders.keys()) void stopRecording(id);
}

/** Images in a row from the cursor (or `at`), in name order. */
export async function importImages(files: File[], at?: GridCursor, ordered = false) {
  const { filmId, cursor, captureStep } = useEditor.getState();
  // In name order, unless already put in order (the import tool's list).
  const images = ordered ? files.filter(isImageFile) : sortFiles(files.filter(isImageFile));
  if (!filmId || images.length === 0) return;
  const media = await runTask("Importando imágenes", images.length, async (progress) => {
    const out: MediaRef[] = [];
    for (const file of images) {
      out.push(await ingestImage(filmId, file, null, { sourceKind: "import" }));
      progress(out.length);
    }
    return out;
  });
  if (!media || useEditor.getState().filmId !== filmId) return;
  const from = at ?? cursor;
  // Each picture named after its file.
  const clips = clipsFrom(from, media, captureStep, "").map((c, i) => ({ ...c, name: images[i]!.name.replace(/\.[^.]+$/, "") }));
  const label = `Importar ${media.length} ${media.length === 1 ? "imagen" : "imágenes"}`;
  useEditor.getState().commit([{ type: "clip.place", clips, label }], label, {
    cursor: { track: from.track, cell: clipEnd(clips.at(-1)!) },
    selection: clips.map((c) => c.id),
  });
}

/**
 * A video's pictures, one after another from the cursor. With `newTrack`
 * they go to a new track meant to rotoscope over: half transparent and left
 * out of exports.
 */
export async function importVideoStills(video: HTMLVideoElement, times: number[], name: string, fps: number, newTrack = false) {
  const { filmId } = useEditor.getState();
  if (!filmId || times.length === 0) return;
  const media = await runTask("Importando cuadros del video", times.length, async (progress) => {
    const out: MediaRef[] = [];
    for (const t of times) {
      out.push(await ingestImage(filmId, await grabStill(video, t)));
      progress(out.length);
    }
    return out;
  });
  const state = useEditor.getState();
  if (!media || state.filmId !== filmId || !state.film) return;
  const title = name.replace(/\.[^.]+$/, "");
  const ops: Op[] = [];
  let track = state.cursor.track;
  if (newTrack) {
    track = newId();
    ops.push({ type: "track.add", track: { id: track, name: title, visible: true, opacity: 0.5, transform: IDENTITY_TRANSFORM, exported: false } });
  }
  // Each picture lasts as long as it lasted in the video, in cells of the film.
  const length = Math.max(1, Math.round(state.film.settings.fps / fps));
  const clips = clipsFrom({ track, cell: state.cursor.cell }, media, length, title);
  ops.push({ type: "clip.place", clips, label: `Video "${title}"` });
  state.commit(ops, `Video "${title}" (${media.length} imágenes)`, { cursor: { track, cell: clipEnd(clips.at(-1)!) }, selection: [] });
  if (newTrack) useLayers.getState().select(track);
}

/** Puts one picture in a cell (replacing what was there). */
export async function setCellImage(file: File, at: GridCursor) {
  const { filmId } = useEditor.getState();
  if (!filmId) return;
  const media = await ingestImage(filmId, file, null, { sourceKind: "import" });
  const state = useEditor.getState();
  if (state.filmId !== filmId) return;
  const clips = clipsFrom(at, [media], state.captureStep, file.name.replace(/\.[^.]+$/, ""));
  state.commit([{ type: "clip.place", clips }], undefined, { cursor: at, selection: clips.map((c) => c.id) });
}

function newTrackOp(name: string, patch: Partial<Track> = {}): { op: Op; id: TrackId } {
  const id = newId();
  return { id, op: { type: "track.add", track: { id, name, visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, exported: true, ...patch } } };
}

/** An empty track on top of the others; the cursor goes to it. */
export function addTrack(name?: string) {
  const film = useEditor.getState().film;
  if (!film) return;
  const { id, op } = newTrackOp(name ?? `Capa ${film.tracks.length}`);
  useEditor.getState().commit([op], undefined, { cursor: { track: id, cell: useEditor.getState().cursor.cell } });
  useLayers.getState().select(id);
}

/** A new track with one picture over the whole film (a background, a frame, a logo…). */
export async function addImageTrack(file: File) {
  const { filmId } = useEditor.getState();
  if (!filmId) return;
  const media = await ingestImage(filmId, file, null, { sourceKind: "import" });
  const state = useEditor.getState();
  if (state.filmId !== filmId || !state.film) return;
  const name = file.name.replace(/\.[^.]+$/, "");
  const { id, op } = newTrackOp(name);
  const [clip] = clipsFrom({ track: id, cell: 0 }, [media], Math.max(1, state.film.length), name);
  state.commit([op, { type: "clip.place", clips: [clip!] }], `Agregar "${name}"`, { selection: [clip!.id] });
  useLayers.getState().select(id);
}

/** The selected pictures, or the one at the cursor when none is selected. */
function targets(): Clip[] {
  const { film, selection, cursor } = useEditor.getState();
  if (!film) return [];
  if (selection.length) return selection.map((id) => film.clips[id]!).filter(Boolean);
  const at = clipAt(film, cursor.track, cursor.cell);
  return at ? [at] : [];
}

/** Moves the selected columns `by` cells (every track's cells there, as a whole). */
export function moveColumns(by: number) {
  const { columns, commit, cursor } = useEditor.getState();
  if (!columns || by === 0 || columns.start + by < 0) return;
  const length = columns.end - columns.start;
  commit([{ type: "cells.move", start: columns.start, length, to: columns.start + by }], undefined, {
    cursor: { ...cursor, cell: columns.start + by },
  });
  useEditor.getState().setColumns({ start: columns.start + by, end: columns.end + by });
}

export function deleteSelected() {
  const { columns, commit, film } = useEditor.getState();
  // Picked strokes go first: the picture stays.
  const picked = pickedStrokes(film);
  if (picked) {
    removeStrokes(picked.clip.id, picked.strokes.map((st) => st.id));
    return;
  }
  if (columns) {
    commit([{ type: "cells.clear", start: columns.start, length: columns.end - columns.start }]);
    return;
  }
  const clips = targets();
  if (clips.length) useEditor.getState().commit([{ type: "clip.remove", ids: clips.map((c) => c.id) }], undefined, { selection: [] });
}

/** Copies the selected pictures right after themselves (as a block), and selects the copies. */
export function duplicateSelected() {
  const clips = targets();
  if (!clips.length) return;
  const start = Math.min(...clips.map((c) => c.start));
  const span = Math.max(...clips.map(clipEnd)) - start;
  const copies = clips.map((c) => ({ ...c, id: newId(), start: c.start + span }));
  useEditor.getState().commit([{ type: "clip.place", clips: copies, label: copies.length === 1 ? "Repetir imagen" : "Repetir imágenes" }], undefined, {
    selection: copies.map((c) => c.id),
    cursor: { track: useEditor.getState().cursor.track, cell: start + span },
  });
}

/** Makes the selected pictures last one cell more (+1) or less (-1). */
export function changeHold(delta: number) {
  const ops: Op[] = targets()
    .filter((c) => c.length + delta >= 1)
    .map((c) => ({ type: "clip.update", id: c.id, patch: { length: c.length + delta } }));
  if (ops.length) useEditor.getState().commit(ops);
}

/** Moves pictures together; `moves` gives each one's new track and first cell. */
export function moveClips(moves: { id: ClipId; track: TrackId; start: number }[]) {
  const film = useEditor.getState().film;
  if (!film || moves.length === 0) return;
  const changed = moves.some((m) => film.clips[m.id] && (film.clips[m.id]!.start !== m.start || film.clips[m.id]!.track !== m.track));
  if (!changed || moves.some((m) => m.start < 0)) return;
  useEditor.getState().commit([{ type: "clip.move", moves }], undefined, { selection: moves.map((m) => m.id) });
}

/** Moves the selected pictures one cell left (-1) or right (+1). */
export function nudgeSelected(dir: -1 | 1) {
  if (useEditor.getState().columns) return moveColumns(dir);
  const clips = targets();
  moveClips(clips.map((c) => ({ id: c.id, track: c.track, start: c.start + dir })));
  const { cursor, moveTo } = useEditor.getState();
  if (clips.length) moveTo(cursor.cell + dir);
}

/** Moves the cursor one cell, showing the film there. */
export function selectRelative(dir: -1 | 1) {
  const { cursor, moveTo } = useEditor.getState();
  moveTo(Math.max(0, cursor.cell + dir));
}

/** Adds seconds of empty cells at the end. */
export function extendFilm(film: FilmState, seconds: number) {
  useEditor.getState().commit([{ type: "film.setLength", length: film.length + Math.round(seconds * film.settings.fps) }]);
}

/** A loop film's length in cells: longer adds empty cells; shorter cuts what is past the new end (one step, undoable). */
export function setLoopLength(length: number) {
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const to = Math.max(1, Math.round(length));
  if (to === film.length) return;
  const label = `Largo del loop: ${to} ${to === 1 ? "celda" : "celdas"}`;
  if (to > film.length) commit([{ type: "film.setLength", length: to }], label);
  else commit([{ type: "cells.clear", start: to, length: film.length - to }, { type: "film.setLength", length: to }], label);
}

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
