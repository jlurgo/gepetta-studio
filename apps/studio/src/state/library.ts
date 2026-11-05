import { type AssetId, type MediaRef, type SoundRef, newId } from "@gepetta/core";
import { create } from "zustand";
import { ingestImage, sortFiles, storeBlob, storeThumb } from "../media/ingest";
import { ingestSound, isSoundFile } from "../media/sound";
import { grabStill, loadVideo } from "../media/video";
import { storage } from "../storage";
import { type EffectAnimation, frameCount, renderFrames } from "../media/animations";
import { placeAnimation, placeImages, placeSounds } from "./actions";
import { runTask, useBusy } from "./busy";
import { type GridCursor, useEditor } from "./editor";

/**
 * The film's resource library: files brought in once (from the computer, the
 * internet or the collections that come with the app) to put in the film as
 * many times as wanted, by dragging them to the timeline. Adding or taking
 * them out is not undone: the library is saved with the film, outside its
 * history. Taking one out leaves the cells it was put in as they are.
 */
export type LibraryKind = "video" | "image" | "vector" | "sound" | "animation";

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  /** The file untouched, as it came. */
  file: AssetId;
  mime: string;
  bytes: number;
  /** When it was added (ms). */
  added: number;
  /** Where it came from, when it is not the computer: a link, or «YouTube». */
  from?: string;
  thumb?: AssetId;
  width?: number;
  height?: number;
  /** Videos and sounds, in seconds. */
  duration?: number;
  /** Pictures (a vector one drawn at the film's size): ready to go in cells. */
  media?: MediaRef;
  sound?: { ref: SoundRef; media: MediaRef };
  /** An effect animation of the collection: its frames, drawn for the film's size and speed. */
  frames?: MediaRef[];
  /** The collection's animation it was drawn from, and at how many frames a second. */
  animation?: { id: string; fps: number; width: number; height: number };
}

/** What is dragged from the library to the timeline: the items' ids, as JSON. */
export const LIBRARY_DRAG = "application/x-gepetta-library";

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i;

export function kindOf(file: File): LibraryKind | null {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return "vector";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/") || VIDEO_EXT.test(file.name)) return "video";
  if (isSoundFile(file)) return "sound";
  return null;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** An SVG drawn as a picture as big as the film (its longer side), keeping its shape. */
async function rasterize(file: File, film: { width: number; height: number }): Promise<Blob> {
  const text = await file.text();
  const num = (attr: string) => {
    const m = new RegExp(`<svg[^>]*\\s${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(text);
    return m ? Number(m[1]) : 0;
  };
  const box = /<svg[^>]*\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  const w0 = num("width") || Number(box?.[1]) || 0;
  const h0 = num("height") || Number(box?.[2]) || 0;
  const aspect = w0 > 0 && h0 > 0 ? w0 / h0 : 1;
  const side = Math.max(film.width, film.height);
  const w = Math.round(aspect >= 1 ? side : side * aspect);
  const h = Math.round(aspect >= 1 ? side / aspect : side);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error(`No se pudo leer el dibujo vectorial «${file.name}».`);
    });
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function ingest(filmId: string, file: File, kind: LibraryKind, film: { width: number; height: number }): Promise<Omit<LibraryItem, "id" | "added" | "from">> {
  const base = { kind, name: stem(file.name), mime: file.type || "application/octet-stream", bytes: file.size };
  if (kind === "image") {
    const media = await ingestImage(filmId, file, null, { sourceKind: "import" });
    return { ...base, file: media.original, thumb: media.thumb, width: media.width, height: media.height, media };
  }
  if (kind === "vector") {
    const [svg, media] = await Promise.all([storeBlob(filmId, file), rasterize(file, film).then((png) => ingestImage(filmId, png, null, { sourceKind: "import" }))]);
    return { ...base, mime: "image/svg+xml", file: svg, thumb: media.thumb, width: media.width, height: media.height, media };
  }
  if (kind === "sound") {
    const sound = await ingestSound(filmId, file);
    return { ...base, file: sound.ref.original, thumb: sound.media.thumb, duration: sound.ref.duration, sound };
  }
  const v = await loadVideo(file);
  try {
    if (!Number.isFinite(v.info.duration)) throw new Error(`«${file.name}» no tiene una duración conocida.`);
    const [id, thumb] = await Promise.all([storeBlob(filmId, file), grabStill(v.video, Math.min(1, v.info.duration / 10)).then((b) => storeThumb(filmId, b))]);
    return { ...base, file: id, thumb, width: v.info.width, height: v.info.height, duration: v.info.duration };
  } finally {
    v.dispose();
  }
}

/**
 * Files into the library (pictures, vector drawings, videos, sounds), in name
 * order. A file already there is not added again. Returns their items (the
 * ones already there included), in the same order.
 */
export async function addToLibrary(files: File[], from?: string): Promise<LibraryItem[]> {
  const { filmId, film } = useEditor.getState();
  const known = files.map((f) => [f, kindOf(f)] as const).filter((x): x is [File, LibraryKind] => x[1] !== null);
  const skipped = files.length - known.length;
  if (skipped) useBusy.getState().notify(skipped === 1 ? `«${files.find((f) => !kindOf(f))!.name}» no es una imagen, un video ni un sonido.` : `${skipped} archivos no son imágenes, videos ni sonidos.`, "error");
  if (!filmId || !film || known.length === 0) return [];
  const byFile = new Map(known.map(([f, k]) => [f, k]));
  const sorted = sortFiles(known.map(([f]) => f));
  const items = await runTask(sorted.length === 1 ? "Agregando a la biblioteca" : `Agregando ${sorted.length} archivos a la biblioteca`, sorted.length, async (progress) => {
    const out: LibraryItem[] = [];
    for (const file of sorted) {
      try {
        const got = await ingest(filmId, file, byFile.get(file)!, film.settings);
        const same = [...useEditor.getState().library, ...out].find((i) => i.file === got.file && i.kind === got.kind);
        out.push(same ?? { ...got, id: newId(), added: Date.now(), ...(from && { from }) });
      } catch (e) {
        console.error("[gepetta] library", file.name, e);
        useBusy.getState().notify(e instanceof Error && e.message.startsWith("No se") ? e.message : `No se pudo agregar «${file.name}».`, "error");
      }
      progress(out.length);
    }
    return out;
  });
  if (!items?.length || useEditor.getState().filmId !== filmId) return [];
  useEditor.getState().setLibrary((now) => {
    const have = new Set(now.map((i) => i.id));
    return [...now, ...items.filter((i) => !have.has(i.id))];
  });
  return items;
}

export function removeFromLibrary(ids: string[]) {
  const drop = new Set(ids);
  useEditor.getState().setLibrary((now) => now.filter((i) => !drop.has(i.id)));
}

/** Moves items to before `before` (or to the end). */
export function moveInLibrary(ids: string[], before: string | null) {
  useEditor.getState().setLibrary((now) => {
    const moving = now.filter((i) => ids.includes(i.id));
    const rest = now.filter((i) => !ids.includes(i.id));
    const at = before ? rest.findIndex((i) => i.id === before) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, ...moving);
    return rest;
  });
}

export function renameInLibrary(id: string, name: string) {
  if (!name.trim()) return;
  useEditor.getState().setLibrary((now) => now.map((i) => (i.id === id ? { ...i, name: name.trim() } : i)));
}

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "image/svg+xml": "svg" };

/** The item's file as it came. */
export async function libraryFile(item: LibraryItem): Promise<File> {
  const filmId = useEditor.getState().filmId;
  if (!filmId) throw new Error("No hay película abierta");
  const blob = await storage.getAsset(filmId, item.file);
  const ext = EXT[item.mime] ?? item.mime.split("/")[1] ?? "bin";
  return new File([blob], `${item.name}.${ext}`, { type: item.mime });
}

/**
 * Items into the film from `at`: pictures one after another (each lasting
 * as photos do), sounds into a sound track. Videos are not put here (they
 * need their stretch chosen): the first one is returned for that.
 */
export function placeFromLibrary(items: LibraryItem[], at: GridCursor): LibraryItem | null {
  const film = useEditor.getState().film;
  if (!film) return null;
  for (const a of items.filter((i) => i.frames)) placeAnimation(a.frames!, a.name, at);
  const pictures = items.filter((i) => i.media);
  const sounds = items.filter((i) => i.sound);
  const video = items.find((i) => i.kind === "video") ?? null;
  if (pictures.length) {
    const track = film.tracks.find((t) => t.id === at.track);
    if (track?.kind === "sound") useBusy.getState().notify("Las imágenes van en un track de imágenes, no en uno de sonido.", "error");
    else placeImages(pictures.map((i) => i.media!), pictures.map((i) => i.name), at);
  }
  if (sounds.length) placeSounds(sounds.map((i) => i.sound!), sounds.map((i) => i.name), pictures.length ? useEditor.getState().cursor : at);
  return video;
}

/**
 * An effect animation of the collection into the library, drawn at the film's
 * size and speed (once: the one already there is returned).
 */
export async function animationToLibrary(anim: EffectAnimation): Promise<LibraryItem | null> {
  const { filmId, film, library } = useEditor.getState();
  if (!filmId || !film) return null;
  const { fps, width, height } = film.settings;
  const same = library.find((i) => i.animation?.id === anim.id && i.animation.fps === fps && i.animation.width === width && i.animation.height === height);
  if (same) return same;
  const count = frameCount(anim, fps);
  const frames = await runTask(`Dibujando «${anim.name}»`, count * 2, async (progress) => {
    const blobs = await renderFrames(anim, width, height, fps, progress);
    const out: MediaRef[] = [];
    for (const b of blobs) {
      out.push(await ingestImage(filmId, b, null, { sourceKind: "import" }));
      progress(count + out.length);
    }
    return out;
  });
  if (!frames?.length || useEditor.getState().filmId !== filmId) return null;
  const item: LibraryItem = {
    id: newId(),
    kind: "animation",
    name: anim.name,
    file: frames[0]!.original,
    mime: "image/webp",
    bytes: 0,
    added: Date.now(),
    from: "Animaciones de Gepetta",
    thumb: frames[Math.floor(frames.length / 2)]!.thumb,
    width,
    height,
    duration: anim.seconds,
    frames,
    animation: { id: anim.id, fps, width, height },
  };
  useEditor.getState().setLibrary((now) => [...now, item]);
  return item;
}

/** A video being downloaded into the library. */
export interface Download {
  id: number;
  name: string;
  /** Bytes, or seconds of the stretch when `unit` is "s". */
  received: number;
  total: number;
  unit?: "s";
  status?: string;
}

export const useDownloads = create<{ items: Download[] }>(() => ({ items: [] }));

let queue: Promise<void> = Promise.resolve();
let nextDownload = 1;

const clock = (s: number) => `${Math.floor(s / 60)}.${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Downloads a video into the library, whole or only a stretch (seconds): from
 * the link of a video file or from YouTube. One at a time; the rest wait
 * their turn.
 */
export function downloadToLibrary(source: { kind: "web"; url: string; name: string } | { kind: "youtube"; id: string; name: string }, section?: { from: number; to: number }) {
  const native = window.gepetta;
  if (!native) return;
  const label = section ? `${source.name} (${clock(section.from)} a ${clock(section.to)})` : source.name;
  const job: Download = { id: nextDownload++, name: label, received: 0, total: 0 };
  const update = (patch: Partial<Download>) => useDownloads.setState({ items: useDownloads.getState().items.map((d) => (d.id === job.id ? { ...d, ...patch } : d)) });
  useDownloads.setState({ items: [...useDownloads.getState().items, job] });
  const filmId = useEditor.getState().filmId;
  queue = queue.then(async () => {
    const onProgress = (received: number, total: number, unit?: "s") => update({ received, total, unit });
    const onStatus = (status: string) => update({ status });
    const offs = source.kind === "web" ? [native.video.onProgress(onProgress), native.video.onStatus?.(onStatus)] : [native.youtube.onProgress?.(onProgress), native.youtube.onStatus?.(onStatus)];
    try {
      let got: { name: string; mime: string; data: ArrayBuffer };
      if (source.kind === "youtube") got = await native.youtube.download(source.id, section);
      else if (!section) got = await native.video.download(source.url);
      else if (native.video.downloadSection) got = await native.video.downloadSection(source.url, section.from, section.to);
      else throw new Error("La app se actualizó: cerrala y volvé a abrirla para bajar solo un tramo.");
      if (useEditor.getState().filmId !== filmId) return;
      const ext = got.mime.split("/")[1] ?? "mp4";
      update({ status: "Guardándolo en la biblioteca…", unit: undefined, total: 0 });
      await addToLibrary([new File([got.data], `${label}.${ext}`, { type: got.mime })], source.kind === "web" ? source.url : "YouTube");
    } catch (e) {
      console.error("[gepetta] download", e);
      const text = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
      useBusy.getState().notify(`No se pudo bajar «${source.name}»: ${text}`, "error");
    } finally {
      offs.forEach((off) => off?.());
      useDownloads.setState({ items: useDownloads.getState().items.filter((d) => d.id !== job.id) });
    }
  });
}

/** A library video being put in the film: its stretch is chosen in a dialog (see VideoImportDialog). */
export const useVideoImport = create<{ open: { file: File; mode: "frames" | "track"; at?: GridCursor } | null }>(() => ({ open: null }));

export async function openVideo(item: LibraryItem, mode: "frames" | "track", at?: GridCursor) {
  try {
    useVideoImport.setState({ open: { file: await libraryFile(item), mode, at } });
  } catch (e) {
    console.error("[gepetta] library video", e);
    useBusy.getState().notify(`No se encontró el archivo de «${item.name}».`, "error");
  }
}
