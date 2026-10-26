import type { GridCursor } from "../state/editor";
import { importSounds } from "../state/actions";
import { audio } from "./sound";

/**
 * The sound effects that come with the app (public/sfx, made by
 * scripts/sfx-library.mjs): categories of sounds, each in one or more takes.
 */
export interface SfxSound {
  name: string;
  /** Its takes, relative to sfx/. */
  files: string[];
}

export interface SfxCategory {
  id: string;
  name: string;
  sounds: SfxSound[];
}

/** What is dragged from the library to the timeline. */
export const SFX_DRAG = "application/x-gepetta-sfx";

const BASE = "sfx/";

let catalog: Promise<SfxCategory[]> | null = null;

export function sfxCatalog(): Promise<SfxCategory[]> {
  catalog ??= fetch(`${BASE}catalogo.json`)
    .then((r) => r.json() as Promise<{ categories: SfxCategory[] }>)
    .then((c) => c.categories);
  catalog.catch(() => (catalog = null));
  return catalog;
}

const buffers = new Map<string, Promise<AudioBuffer>>();
let playing: AudioBufferSourceNode | null = null;

/** Plays a take to hear it (stopping the one before). */
export async function previewSfx(file: string) {
  let p = buffers.get(file);
  if (!p) {
    p = fetch(BASE + file)
      .then((r) => r.arrayBuffer())
      .then((a) => audio().decodeAudioData(a));
    p.catch(() => buffers.delete(file));
    buffers.set(file, p);
  }
  const buffer = await p;
  playing?.stop();
  const ctx = audio();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.onended = () => playing === src && (playing = null);
  src.start();
  playing = src;
}

/** Puts a take in the film, from the cursor (or `at`), like an imported sound file. */
export async function insertSfx(name: string, file: string, at?: GridCursor) {
  const blob = await fetch(BASE + file).then((r) => r.blob());
  await importSounds([new File([blob], `${name}.ogg`, { type: "audio/ogg" })], at);
}
