import type { AssetId, SoundRef } from "@gepetta/core";
import { create } from "zustand";
import { soundBuffer } from "./sound";

/**
 * A sound's spectrum over time (a spectrogram): every 1/COLUMNS_PER_SECOND s,
 * how loud it is in each of BANDS frequency bands (low to high, spaced as we
 * hear them), 0–255. Worked out from the decoded sound when first drawn and
 * kept in memory only.
 */
export const COLUMNS_PER_SECOND = 120;
export const BANDS = 48;
const LOW_HZ = 50;
const HIGH_HZ = 14000;
const SIZE = 1024;
/** Loudness shown: from FLOOR_DB (nothing) to FLOOR_DB + RANGE_DB (full). */
const FLOOR_DB = -95;
const RANGE_DB = 75;

export interface Spectrogram {
  columns: number;
  /** Column after column, BANDS values each (low band first). */
  data: Uint8Array;
}

/** In-place radix-2 FFT of (re, im), whose length is a power of two. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** The FFT bins (from, to) each band takes, for a sample rate. */
function bandBins(rate: number): [number, number][] {
  const high = Math.min(HIGH_HZ, rate / 2);
  const hz = (b: number) => LOW_HZ * Math.pow(high / LOW_HZ, b / BANDS);
  return Array.from({ length: BANDS }, (_, b) => {
    const a = Math.max(1, Math.floor((hz(b) * SIZE) / rate));
    return [a, Math.max(a + 1, Math.floor((hz(b + 1) * SIZE) / rate))];
  });
}

/** Levels (0–255) of each band in the bins given (magnitudes of an FFT of SIZE). */
export function bandLevels(magnitude: (bin: number) => number, rate: number, out: Uint8Array, at = 0) {
  const bins = bandBins(rate);
  for (let b = 0; b < BANDS; b++) {
    const [a, e] = bins[b]!;
    let m = 0;
    for (let k = a; k < e; k++) m = Math.max(m, magnitude(k));
    const db = 20 * Math.log10(m + 1e-9);
    out[at + b] = Math.max(0, Math.min(255, Math.round(((db - FLOOR_DB) / RANGE_DB) * 255)));
  }
}

async function compute(buffer: AudioBuffer): Promise<Spectrogram> {
  const rate = buffer.sampleRate;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const columns = Math.max(1, Math.ceil(buffer.duration * COLUMNS_PER_SECOND));
  const data = new Uint8Array(columns * BANDS);
  const window = Float32Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1)));
  const re = new Float32Array(SIZE);
  const im = new Float32Array(SIZE);
  // Magnitudes scaled so a full-scale sine reads about 0 dB.
  const scale = 4 / SIZE;
  for (let c = 0; c < columns; c++) {
    const center = Math.round(((c + 0.5) / COLUMNS_PER_SECOND) * rate);
    for (let i = 0; i < SIZE; i++) {
      const s = center - SIZE / 2 + i;
      let v = 0;
      if (s >= 0 && s < buffer.length) for (const d of channels) v += d[s]!;
      re[i] = (v / channels.length) * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    bandLevels((k) => Math.hypot(re[k]!, im[k]!) * scale, rate, data, c * BANDS);
    // Long sounds: let the page breathe now and then.
    if (c % 400 === 399) await new Promise((r) => setTimeout(r));
  }
  return { columns, data };
}

/** Changes when another spectrogram is ready (to draw again). */
export const useSpectra = create<{ version: number }>(() => ({ version: 0 }));

const ready = new Map<AssetId, Spectrogram>();
const working = new Set<AssetId>();

/** A sound's spectrogram, if worked out already (it starts working it out otherwise). */
export function spectrumNow(filmId: string, ref: SoundRef): Spectrogram | null {
  const s = ready.get(ref.original);
  if (s || working.has(ref.original)) return s ?? null;
  working.add(ref.original);
  void soundBuffer(filmId, ref)
    .then(compute)
    .then((s) => {
      ready.set(ref.original, s);
      useSpectra.setState((v) => ({ version: v.version + 1 }));
    })
    .catch((e) => console.error("[gepetta] sound spectrum", e))
    .finally(() => working.delete(ref.original));
  return null;
}

/** Colors for 0–255: dark blue, teal, yellow, white (as RGBA bytes). */
export const SPECTRUM_COLORS: Uint8ClampedArray = (() => {
  const stops: [number, number, number, number, number][] = [
    [0, 20, 18, 30, 0],
    [60, 30, 40, 90, 255],
    [130, 40, 170, 160, 255],
    [200, 250, 210, 70, 255],
    [255, 255, 255, 235, 255],
  ];
  const out = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) {
    const i = Math.max(0, stops.findIndex((s) => s[0] >= v) - 1);
    const [a, b] = [stops[i]!, stops[Math.min(i + 1, stops.length - 1)]!];
    const t = b[0] === a[0] ? 0 : (v - a[0]) / (b[0] - a[0]);
    for (let k = 0; k < 4; k++) out[v * 4 + k] = a[k + 1]! + (b[k + 1]! - a[k + 1]!) * t;
  }
  return out;
})();

/**
 * Samples a stretch of a spectrogram (from second t0 to t1) into a w×h
 * rectangle at column x of `levels` (rows of `width` values, low frequencies
 * at the bottom), keeping the louder of what is there and this, so several
 * sounds mix.
 */
export function sampleSpectrum(levels: Uint8Array, width: number, x: number, w: number, s: Spectrogram, t0: number, t1: number, gain = 1) {
  const h = levels.length / width;
  for (let px = 0; px < w; px++) {
    const col = Math.floor((t0 + ((px + 0.5) / w) * (t1 - t0)) * COLUMNS_PER_SECOND);
    if (col < 0 || col >= s.columns) continue;
    for (let py = 0; py < h; py++) {
      const band = Math.min(BANDS - 1, Math.floor(((h - 1 - py) / h) * BANDS));
      const o = py * width + x + px;
      levels[o] = Math.max(levels[o]!, Math.round(s.data[col * BANDS + band]! * gain));
    }
  }
}

/** Levels (rows of `width`) as a picture, in SPECTRUM_COLORS. */
export function spectrumImage(levels: Uint8Array, width: number): ImageData {
  const img = new ImageData(width, levels.length / width);
  for (let i = 0; i < levels.length; i++) img.data.set(SPECTRUM_COLORS.subarray(levels[i]! * 4, levels[i]! * 4 + 4), i * 4);
  return img;
}
