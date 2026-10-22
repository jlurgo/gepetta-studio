import { type FrameId, type MediaRef, type Op, newId } from "@gepetta/core";
import { onRemoteMessage } from "../capture/remote";
import { ingestImage, isImageFile, sortFiles } from "../media/ingest";
import { grabStill } from "../media/video";
import { runTask, useBusy } from "./busy";
import { useCamera } from "./camera";
import { useEditor } from "./editor";

/** Insert ops that chain each new frame after the previous one. */
function insertOps(after: FrameId | null, media: MediaRef[], label: string): { ops: Op[]; last: FrameId | null } {
  let anchor = after;
  const ops: Op[] = media.map((m) => {
    const frameId = newId();
    const op: Op = { type: "frame.insert", afterFrameId: anchor, frameId, layerId: newId(), media: m, label };
    anchor = frameId;
    return op;
  });
  return { ops, last: anchor };
}

let capturing = false;
/** Stills are inserted one after another, in arrival order. */
let insertQueue: Promise<unknown> = Promise.resolve();

function insertStill(image: Blob, raw: Blob | null, label: string): Promise<void> {
  const run = async () => {
    const { filmId } = useEditor.getState();
    if (!filmId) return;
    const media = await ingestImage(filmId, image, raw);
    const state = useEditor.getState();
    if (state.filmId !== filmId) return;
    const { ops, last } = insertOps(state.selected, [media], label);
    state.commit(ops, undefined, last);
    if (state.view === "live" || state.playback) state.setView("live");
  };
  const next = insertQueue.then(run);
  insertQueue = next.catch(() => undefined);
  return next;
}

export async function capture() {
  const { filmId, captureAverage } = useEditor.getState();
  const source = useCamera.getState().source;
  if (!filmId || !source || capturing) return;
  capturing = true;
  try {
    const still = await source.capture(captureAverage);
    await insertStill(still.image, still.raw?.blob ?? null, "Foto");
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
  insertStill(new Blob([payload.slice()], { type: header.mime || "image/jpeg" }), null, "Foto del celular").catch((e) =>
    useBusy.getState().notify(e instanceof Error ? e.message : "No se pudo agregar la foto", "error"),
  );
});

export async function importImages(files: File[]) {
  const { filmId, selected } = useEditor.getState();
  const images = sortFiles(files.filter(isImageFile));
  if (!filmId || images.length === 0) return;
  const media = await runTask("Importando imágenes", images.length, async (progress) => {
    const out: MediaRef[] = [];
    for (const file of images) {
      out.push(await ingestImage(filmId, file));
      progress(out.length);
    }
    return out;
  });
  if (!media || useEditor.getState().filmId !== filmId) return;
  const { ops, last } = insertOps(selected, media, "Imagen importada");
  useEditor.getState().commit(ops, `Importar ${media.length} ${media.length === 1 ? "imagen" : "imágenes"}`, last);
  useEditor.getState().select(last);
}

export async function importVideoStills(video: HTMLVideoElement, times: number[], name: string) {
  const { filmId, selected } = useEditor.getState();
  if (!filmId || times.length === 0) return;
  const media = await runTask("Importando cuadros del video", times.length, async (progress) => {
    const out: MediaRef[] = [];
    for (const t of times) {
      out.push(await ingestImage(filmId, await grabStill(video, t)));
      progress(out.length);
    }
    return out;
  });
  if (!media || useEditor.getState().filmId !== filmId) return;
  const { ops, last } = insertOps(selected, media, "Cuadro de video");
  useEditor.getState().commit(ops, `Video "${name}" (${media.length} cuadros)`, last);
  useEditor.getState().select(last);
}

function selectedFrame() {
  const { film, selected } = useEditor.getState();
  return film && selected ? film.frames[selected] : undefined;
}

export function deleteSelected() {
  const { film, selected, commit } = useEditor.getState();
  if (!film || !selected) return;
  const i = film.frameOrder.indexOf(selected);
  const neighbor = film.frameOrder[i - 1] ?? film.frameOrder[i + 1] ?? null;
  commit([{ type: "frame.delete", frameId: selected }], undefined, neighbor);
}

export function duplicateSelected() {
  const frame = selectedFrame();
  if (!frame) return;
  const frameId = newId();
  useEditor.getState().commit(
    [{ type: "frame.duplicate", sourceFrameId: frame.id, frameId, layerIds: frame.layers.map(() => newId()) }],
    undefined,
    frameId,
  );
}

export function changeHold(delta: number) {
  const frame = selectedFrame();
  if (!frame) return;
  const hold = Math.max(1, frame.hold + delta);
  if (hold !== frame.hold) useEditor.getState().commit([{ type: "frame.setHold", frameId: frame.id, hold }]);
}

export function moveFrame(frameId: FrameId, afterFrameId: FrameId | null) {
  if (frameId === afterFrameId) return;
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const i = film.frameOrder.indexOf(frameId);
  const currentAfter = film.frameOrder[i - 1] ?? null;
  if (currentAfter === afterFrameId) return;
  commit([{ type: "frame.move", frameId, afterFrameId }], undefined, frameId);
}

/** Moves the selected frame one place left (-1) or right (+1). */
export function nudgeSelected(dir: -1 | 1) {
  const { film, selected } = useEditor.getState();
  if (!film || !selected) return;
  const order = film.frameOrder.filter((id) => id !== selected);
  const i = film.frameOrder.indexOf(selected) + dir;
  if (i < 0 || i >= film.frameOrder.length) return;
  moveFrame(selected, i === 0 ? null : order[i - 1]!);
}

export function selectRelative(dir: -1 | 1) {
  const { film, selected, view, select } = useEditor.getState();
  if (!film || film.frameOrder.length === 0) return;
  if (view === "live") {
    if (dir === -1 && selected) select(selected);
    return;
  }
  const i = selected ? film.frameOrder.indexOf(selected) : -1;
  const next = film.frameOrder[i + dir];
  if (next) select(next);
  else if (dir === 1) useEditor.getState().setView("live");
}
