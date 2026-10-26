import { type AssetId, type FilmState, type MediaRef, PEAKS_PER_SECOND, type SoundRef, type SoundRun, cellGain, cellValue, clipEnd } from "@gepetta/core";
import { create } from "zustand";
import { storage } from "../storage";
import { storeBlob } from "./ingest";

/**
 * Sound files: reading them in (their loudness kept to draw them, and a
 * picture of their waveform), decoding them to play, and playing runs of
 * slices (see soundRuns) on an audio context.
 */

let context: AudioContext | null = null;

export function audio(): AudioContext {
  context ??= new AudioContext({ latencyHint: "interactive" });
  if (context.state === "suspended") void context.resume();
  return context;
}

const SOUND_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|weba|aif|aiff)$/i;

export function isSoundFile(file: File): boolean {
  return file.type.startsWith("audio/") || SOUND_EXT.test(file.name);
}

/** Loudness every 1/PEAKS_PER_SECOND s, 0–255 (square root, so quiet parts still show). */
function peaksOf(buffer: AudioBuffer): Uint8Array {
  const step = buffer.sampleRate / PEAKS_PER_SECOND;
  const n = Math.ceil(buffer.duration * PEAKS_PER_SECOND);
  const out = new Uint8Array(n);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(buffer.length, Math.floor((i + 1) * step));
    let m = 0;
    for (const d of channels) for (let j = a; j < b; j++) m = Math.max(m, Math.abs(d[j]!));
    out[i] = Math.min(255, Math.round(Math.sqrt(m) * 255));
  }
  return out;
}

/** A picture of the whole waveform (what a sound clip shows where a picture is expected). */
async function waveformPicture(peaks: Uint8Array): Promise<Blob> {
  const w = 480;
  const h = 96;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1f1c19";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#5cc8b5";
  const per = peaks.length / w;
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = Math.floor(x * per); i < Math.max(Math.floor(x * per) + 1, Math.floor((x + 1) * per)); i++) m = Math.max(m, peaks[i] ?? 0);
    const bar = Math.max(1, (m / 255) * (h - 8));
    ctx.fillRect(x, (h - bar) / 2, 1, bar);
  }
  return canvas.convertToBlob({ type: "image/png" });
}

/** Keeps a sound file in the film: the file, its loudness and its picture. */
export async function ingestSound(filmId: string, file: Blob): Promise<{ ref: SoundRef; media: MediaRef }> {
  const buffer = await audio().decodeAudioData(await file.arrayBuffer());
  const peaks = peaksOf(buffer);
  const [original, peaksId, picture] = await Promise.all([
    storeBlob(filmId, file),
    storeBlob(filmId, new Blob([peaks as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" })),
    waveformPicture(peaks).then((b) => storeBlob(filmId, b)),
  ]);
  buffers.set(original, Promise.resolve(buffer));
  loudness.set(peaksId, peaks);
  return { ref: { original, peaks: peaksId, duration: buffer.duration }, media: { original: picture, proxy: picture, thumb: picture, width: 480, height: 96 } };
}

const buffers = new Map<AssetId, Promise<AudioBuffer>>();

/** The decoded sound (read once per file). */
export function soundBuffer(filmId: string, ref: SoundRef): Promise<AudioBuffer> {
  let p = buffers.get(ref.original);
  if (!p) {
    p = storage
      .getAsset(filmId, ref.original)
      .then((b) => b.arrayBuffer())
      .then((a) => audio().decodeAudioData(a));
    p.catch(() => buffers.delete(ref.original));
    buffers.set(ref.original, p);
  }
  return p;
}

/** Decoded already (null while it is being read). */
const ready = new Map<AssetId, AudioBuffer>();
export function soundBufferNow(filmId: string, ref: SoundRef): AudioBuffer | null {
  const b = ready.get(ref.original);
  if (b) return b;
  void soundBuffer(filmId, ref).then((buf) => ready.set(ref.original, buf));
  return null;
}

/** Starts reading every sound of a film, so it plays from the start. */
export function preloadSounds(filmId: string, film: FilmState) {
  for (const c of Object.values(film.clips)) if (c.sound) soundBufferNow(filmId, c.sound.ref);
}

const loudness = new Map<AssetId, Uint8Array>();
const loading = new Set<AssetId>();

/** Changes when more loudness arrives (to draw it again). */
export const useSoundPeaks = create<{ version: number }>(() => ({ version: 0 }));

/** A sound's loudness, if read already (it starts reading it otherwise). */
export function peaksNow(filmId: string, ref: SoundRef): Uint8Array | null {
  const p = loudness.get(ref.peaks);
  if (p || loading.has(ref.peaks)) return p ?? null;
  loading.add(ref.peaks);
  void storage
    .getAsset(filmId, ref.peaks)
    .then((b) => b.arrayBuffer())
    .then((a) => {
      loudness.set(ref.peaks, new Uint8Array(a));
      useSoundPeaks.setState((s) => ({ version: s.version + 1 }));
    })
    .catch((e) => console.error("[gepetta] sound peaks", e))
    .finally(() => loading.delete(ref.peaks));
  return null;
}

/** A short fade at each end of a run, so a cut does not click (seconds). */
const EDGE = 0.004;

/** A run being played: `stop` fades it out and ends it at a time of its context. */
export interface Voice {
  stop(at: number): void;
}

/**
 * Plays a run on `ctx` (into `out`) starting at `when` (its time), at the
 * film's speed, each cell at its own volume (times `volume`), fading in and
 * out at its ends so a cut does not click.
 */
export function playRun(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, run: SoundRun, fps: number, when: number, volume: number): Voice | null {
  const sound = run.clip.sound!;
  const offset = sound.from + (run.cell - run.clip.start) / fps;
  const length = Math.min(run.count, clipEnd(run.clip) - run.cell) / fps;
  const start = Math.max(when, ctx.currentTime);
  const skip = start - when;
  if (offset + skip >= buffer.duration || skip >= length) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  const end = when + length;
  const cells = Math.max(1, Math.round(length * fps));
  // The volume of the cell playing at a time of the context.
  const volumeAt = (t: number) => volume * cellGain(run.clip, run.cell + Math.max(0, Math.min(cells - 1, Math.floor((t - when) * fps + 1e-6))));
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volumeAt(start), start + EDGE);
  // From one cell's volume to the next one's, quickly, as each cell starts.
  for (let i = 1; i < cells; i++) {
    const t = when + i / fps;
    const [a, b] = [volumeAt(t - EDGE), volumeAt(t)];
    if (t - EDGE <= start + EDGE || a === b) continue;
    gain.gain.setValueAtTime(a, t - EDGE);
    gain.gain.linearRampToValueAtTime(b, t + EDGE);
  }
  gain.gain.setValueAtTime(volumeAt(end - EDGE), Math.max(start + EDGE, end - EDGE));
  gain.gain.linearRampToValueAtTime(0, end);
  src.connect(gain);
  // Each cell from its own speaker, when the clip has them.
  if (sound.pans?.some((p) => p)) {
    const panner = ctx.createStereoPanner();
    const panAt = (t: number) => cellValue(run.clip, "pans", run.cell + Math.max(0, Math.min(cells - 1, Math.floor((t - when) * fps + 1e-6))));
    panner.pan.setValueAtTime(panAt(start), start);
    for (let i = 1; i < cells; i++) {
      const t = when + i / fps;
      const [a, b] = [panAt(t - EDGE), panAt(t)];
      if (t - EDGE <= start || a === b) continue;
      panner.pan.setValueAtTime(a, t - EDGE);
      panner.pan.linearRampToValueAtTime(b, t + EDGE);
    }
    gain.connect(panner).connect(out);
  } else gain.connect(out);
  src.start(start, offset + skip, length - skip);
  let stopped = false;
  return {
    stop(at) {
      if (stopped) return;
      stopped = true;
      const t = Math.max(at, ctx.currentTime);
      if (t >= end) return;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(volumeAt(t), t);
      gain.gain.linearRampToValueAtTime(0, t + EDGE);
      src.stop(t + EDGE);
    },
  };
}
