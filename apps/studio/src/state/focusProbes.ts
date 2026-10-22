import { sharpness } from "@gepetta/core";
import { create } from "zustand";
import type { LiveFrame } from "../capture/types";

/** A spot of the live view whose sharpness is measured continuously. x, y: 0..1 of the live picture. */
export interface Probe {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface Reading {
  value: number;
  /** Highest value seen since the probe was placed or reset ("peak hold"). */
  peak: number;
  /** Recent values, oldest first. */
  history: number[];
}

const MAX_PROBES = 3;
const HISTORY = 60;
const MEASURE_EVERY_MS = 100;
const PUBLISH_EVERY_MS = 250;

/** Live readings, updated many times a second outside React; the store gets a throttled copy. */
export const readings = new Map<string, Reading>();

interface ProbeState {
  probes: Probe[];
  /** Throttled copy of `readings` for the panel. */
  shown: Record<string, { value: number; peak: number }>;
  toggleAt(x: number, y: number): void;
  clear(): void;
  resetPeaks(): void;
}

export const useFocusProbes = create<ProbeState>((set, get) => ({
  probes: [],
  shown: {},
  toggleAt(x, y) {
    const { probes } = get();
    const hit = probes.find((p) => Math.hypot(p.x - x, p.y - y) < 0.04);
    if (hit) {
      readings.delete(hit.id);
      set({ probes: probes.filter((p) => p !== hit) });
      return;
    }
    const kept = probes.length >= MAX_PROBES ? probes.slice(1) : probes;
    for (const p of probes) if (!kept.includes(p)) readings.delete(p.id);
    const used = new Set(kept.map((p) => p.name));
    const name = ["A", "B", "C"].find((n) => !used.has(n))!;
    set({ probes: [...kept, { id: crypto.randomUUID(), name, x, y }] });
  },
  clear() {
    readings.clear();
    set({ probes: [], shown: {} });
  },
  resetPeaks() {
    for (const r of readings.values()) {
      r.peak = r.value;
      r.history = [];
    }
  },
}));

/** Side of the measured square, in live-image pixels. */
export function probeSize(live: { width: number; height: number }): number {
  return Math.max(32, Math.min(160, Math.round(Math.min(live.width, live.height) * 0.08)));
}

let canvas: OffscreenCanvas | null = null;
let lastMeasure = 0;
let lastPublish = 0;

/** Measures every probe on the current live frame (throttled). Call from the render loop. */
export function measureProbes(live: LiveFrame) {
  const { probes } = useFocusProbes.getState();
  const now = performance.now();
  if (probes.length === 0 || now - lastMeasure < MEASURE_EVERY_MS) return;
  lastMeasure = now;
  const side = probeSize(live);
  canvas ??= new OffscreenCanvas(side, side);
  if (canvas.width !== side) canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const p of probes) {
    const sx = Math.min(live.width - side, Math.max(0, p.x * live.width - side / 2));
    const sy = Math.min(live.height - side, Math.max(0, p.y * live.height - side / 2));
    ctx.drawImage(live.image, sx, sy, side, side, 0, 0, side, side);
    const value = sharpness(ctx.getImageData(0, 0, side, side).data, side, side, { x: 0, y: 0, w: 1, h: 1 });
    const r = readings.get(p.id) ?? { value, peak: value, history: [] };
    r.value = value;
    r.peak = Math.max(r.peak, value);
    r.history.push(value);
    if (r.history.length > HISTORY) r.history.shift();
    readings.set(p.id, r);
  }
  if (now - lastPublish > PUBLISH_EVERY_MS) {
    lastPublish = now;
    const shown: ProbeState["shown"] = {};
    for (const p of probes) {
      const r = readings.get(p.id);
      if (r) shown[p.id] = { value: r.value, peak: r.peak };
    }
    useFocusProbes.setState({ shown });
  }
}

/** Share of the peak, 0..1. */
export function ratio(r: { value: number; peak: number }): number {
  return r.peak > 0 ? r.value / r.peak : 0;
}

export function probeColor(q: number): string {
  return q >= 0.95 ? "#5cc8b5" : q >= 0.8 ? "#f2c94c" : "#f3ede4";
}
