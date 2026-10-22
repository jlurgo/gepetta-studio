import {
  type CaptureMeta,
  type Clip,
  type ClipId,
  type FilmState,
  IDENTITY_TRANSFORM,
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
import { useCamera } from "./camera";
import { type GridCursor, useEditor } from "./editor";
import { useLayers } from "./layers";

/** Clips for pictures placed one after another from `at`, each `length` cells long. */
function clipsFrom(at: GridCursor, media: MediaRef[], length: number, name: string): Clip[] {
  return media.map((m, i) => ({
    id: newId(),
    track: at.track,
    start: at.cell + i * length,
    length,
    media: m,
    name,
    visible: true,
    opacity: 1,
    transform: IDENTITY_TRANSFORM,
  }));
}

let capturing = false;
/** Stills are placed one after another, in arrival order. */
let placeQueue: Promise<unknown> = Promise.resolve();

/**
 * Puts a photo at the cursor (replacing what was in that cell) and moves the
 * cursor past it, ready for the next one.
 */
function placeStill(image: Blob, raw: Blob | null, label: string, meta?: CaptureMeta): Promise<void> {
  const run = async () => {
    const { filmId } = useEditor.getState();
    if (!filmId) return;
    const media = await ingestImage(filmId, image, raw, meta);
    const state = useEditor.getState();
    if (state.filmId !== filmId) return;
    const [clip] = clipsFrom(state.cursor, [media], state.captureStep, label);
    state.commit([{ type: "clip.place", clips: [clip!], label }], undefined, {
      cursor: { track: clip!.track, cell: clipEnd(clip!) },
      selection: [],
    });
    if (state.view === "live" || state.playback) state.setView("live");
  };
  const next = placeQueue.then(run);
  placeQueue = next.catch(() => undefined);
  return next;
}

export async function capture() {
  const { filmId, captureAverage } = useEditor.getState();
  const { source, controls } = useCamera.getState();
  if (!filmId || !source || capturing) return;
  capturing = true;
  try {
    // Snapshot what the app knows before the shot (the lens may move right after).
    const meta: CaptureMeta = { source: useCamera.getState().sourceLabel() ?? undefined, sourceKind: source.kind };
    const focus = controls.find((c) => c.kind === "focus");
    if (focus?.kind === "focus" && focus.position !== null && focus.origin) {
      meta.focusPosition = focus.position;
      meta.focusOrigin = focus.origin;
    }
    const rotation = useCamera.getState().rotation();
    const still = await source.capture(captureAverage);
    await placeStill(await rotateBlob(still.image, rotation), still.raw?.blob ?? null, "Foto", meta);
  } catch (e) {
    useBusy.getState().notify(e instanceof Error ? e.message : "No se pudo sacar la foto", "error");
  } finally {
    capturing = false;
  }
}

// Photos shot from a phone (its own shutter or photo mode) go straight into the film.
onRemoteMessage((_sessionId, header, payload) => {
  if (header.t !== "photo" || header.requestId !== null || !payload) return;
  if (!useEditor.getState().filmId) return;
  const photo = new Blob([payload.slice()], { type: header.mime || "image/jpeg" });
  rotateBlob(photo, header.rotation ?? 0)
    .then((upright) => placeStill(upright, null, "Foto del celular", { sourceKind: "phone" }))
    .catch((e) => useBusy.getState().notify(e instanceof Error ? e.message : "No se pudo agregar la foto", "error"));
});

/** Images in a row from the cursor (or `at`), in name order. */
export async function importImages(files: File[], at?: GridCursor) {
  const { filmId, cursor, captureStep } = useEditor.getState();
  const images = sortFiles(files.filter(isImageFile));
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
  const name = images.length === 1 ? images[0]!.name.replace(/\.[^.]+$/, "") : "Imagen importada";
  const clips = clipsFrom(from, media, captureStep, name);
  const label = `Importar ${media.length} ${media.length === 1 ? "imagen" : "imágenes"}`;
  useEditor.getState().commit([{ type: "clip.place", clips, label }], label, {
    cursor: { track: from.track, cell: clipEnd(clips.at(-1)!) },
    selection: clips.map((c) => c.id),
  });
  useEditor.getState().setView("frame");
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
export function addTrack() {
  const film = useEditor.getState().film;
  if (!film) return;
  const { id, op } = newTrackOp(`Capa ${film.tracks.length}`);
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

export function deleteSelected() {
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
  const clips = targets();
  moveClips(clips.map((c) => ({ id: c.id, track: c.track, start: c.start + dir })));
  const { cursor, moveTo } = useEditor.getState();
  if (clips.length) moveTo(cursor.cell + dir);
}

/** Moves the cursor one cell, showing the film there. */
export function selectRelative(dir: -1 | 1) {
  const { cursor, moveTo } = useEditor.getState();
  moveTo(Math.max(0, cursor.cell + dir), undefined, "frame");
}

/** Adds seconds of empty cells at the end. */
export function extendFilm(film: FilmState, seconds: number) {
  useEditor.getState().commit([{ type: "film.setLength", length: film.length + Math.round(seconds * film.settings.fps) }]);
}
