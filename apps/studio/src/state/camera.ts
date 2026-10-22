import { newId } from "@gepetta/core";
import type { CameraControl, ControlValue } from "@gepetta/protocol";
import { create } from "zustand";
import { dslrAvailable, listDslrs, openDslr } from "../capture/dslr";
import { openPhone } from "../capture/phone";
import { useRemote } from "../capture/remote";
import { type CameraSource, type LiveFrame, type SourceOption, quarterTurns, rotateFrame } from "../capture/types";
import { RESOLUTIONS, describeMediaError, listWebcams, openWebcam } from "../capture/webcam";
import type { DslrErrorCode } from "../native";
import { useBusy } from "./busy";
import { type GridCursor, useEditor } from "./editor";
import { useFocusProbes } from "./focusProbes";

/**
 * Cameras in use. Each one is a tool with its own target (a track and a cell)
 * where its photos go; the target moves on after each photo. Several can be
 * open at once: every one whose target is the cell on screen shows live there.
 *
 * One is "active": the panels (settings, focus, magnifier) act on it, and its
 * target is the grid cursor. The top-level fields (`source`, `controls`, …)
 * mirror the active camera, so those panels need not know about the others.
 */
export interface Rig {
  id: string;
  /** Which device, e.g. "webcam:abc", "dslr:usb:001,005", "phone:<session>"; null = default webcam. */
  deviceId: string | null;
  source: CameraSource | null;
  controls: CameraControl[];
  opening: boolean;
  error: { message: string; code?: DslrErrorCode } | null;
  /** A 1× snapshot of the live view, taken when the magnifier turns on, to steer it. */
  overview: string | null;
  /** What the device last said about its orientation (phones). */
  autoRotation: number | null;
  /** Where its photos go while it is not the active one (the active one uses the grid cursor). */
  target: GridCursor;
  /** Video being recorded: pictures taken so far. */
  recording: { cells: number } | null;
}

interface CameraState {
  /** Webcams and DSLRs found; phones come from useRemote. */
  webcams: SourceOption[];
  dslrs: SourceOption[];
  rigs: Rig[];
  activeRig: string | null;
  resolutionId: string;

  // The active camera, mirrored (see Rig).
  selectedId: string | null;
  source: CameraSource | null;
  controls: CameraControl[];
  opening: boolean;
  error: { message: string; code?: DslrErrorCode } | null;
  overview: string | null;
  autoRotation: number | null;

  /** What a click on the live view does. */
  pointerTool: "none" | "focus" | "probe";
  setPointerTool(tool: "none" | "focus" | "probe"): void;
  /** The active camera's name as listed. */
  sourceLabel(): string | null;
  labelOf(deviceId: string | null): string | null;
  /** Turn chosen for each camera (by name): "auto" follows the device when it knows (phones). */
  rotations: Record<string, "auto" | number>;
  /** Clockwise degrees applied to the active camera's picture. */
  rotation(): 0 | 90 | 180 | 270;
  rotationOf(rig: Rig): 0 | 90 | 180 | 270;
  /** Turns the active camera's picture a quarter turn (±90) from what is shown now, or back to automatic. */
  rotate(delta: 90 | -90 | "auto"): void;
  /** The active camera's live picture, upright. */
  live(): LiveFrame | null;
  liveOf(rig: Rig): LiveFrame | null;
  /** Where a camera's photos go now. */
  targetOf(rig: Rig): GridCursor;
  setTarget(rigId: string, target: GridCursor): void;

  /** Opens the cameras used last time (or the default webcam). */
  start(): Promise<void>;
  /** Closes every camera. */
  stop(): void;
  /** Switches the active camera to another device. */
  select(deviceId: string): Promise<void>;
  /** Opens one more camera and makes it the active one. */
  addCamera(deviceId: string): Promise<void>;
  removeCamera(rigId: string): void;
  activate(rigId: string): void;
  selectResolution(id: string): Promise<void>;
  setControl(control: CameraControl, value: ControlValue): Promise<void>;
  setRecording(rigId: string, recording: Rig["recording"]): void;
  refreshDevices(): Promise<void>;
}

const PREFS_KEY = "gepetta.camera";
const MODEL_KEY = "gepetta.camera.dslrModel";
const ROTATIONS_KEY = "gepetta.camera.rotations";
const RECONNECT_MS = 3000;

interface Prefs {
  /** Devices open last time (phones are never restored: their session changes). */
  devices: (string | null)[];
  resolutionId: string;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    const listed: unknown[] = Array.isArray(p.devices) ? p.devices : [p.selectedId ?? null];
    const devices = listed.filter((d): d is string | null => d === null || (typeof d === "string" && !d.startsWith("phone:")));
    return { devices: devices.length ? devices : [null], resolutionId: p.resolutionId ?? "1080" };
  } catch {
    return { devices: [null], resolutionId: "1080" };
  }
}

function savePrefs(rigs: Rig[], resolutionId: string) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ devices: rigs.map((r) => r.deviceId), resolutionId }));
  } catch {
    // Preferences are a convenience only.
  }
}

function loadRotations(): Record<string, "auto" | number> {
  try {
    return JSON.parse(localStorage.getItem(ROTATIONS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveRotations(rotations: Record<string, "auto" | number>) {
  try {
    localStorage.setItem(ROTATIONS_KEY, JSON.stringify(rotations));
  } catch {
    // Only a convenience.
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof DOMException) return describeMediaError(e);
  // Electron prefixes errors thrown in the main process.
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
}

/** Bumped by every (re)open of a camera, so a slow, superseded open does not win. */
const generations = new Map<string, number>();
const unsubscribes = new Map<string, () => void>();
let reconnectTimer: ReturnType<typeof setInterval> | undefined;

function newRig(deviceId: string | null, target: GridCursor): Rig {
  return {
    id: newId(),
    deviceId,
    source: null,
    controls: [],
    opening: false,
    error: null,
    overview: null,
    autoRotation: null,
    target,
    recording: null,
  };
}

export const useCamera = create<CameraState>((set, get) => {
  /** Copies the active camera's fields to the top level. */
  function mirror() {
    const rig = get().rigs.find((r) => r.id === get().activeRig);
    set({
      selectedId: rig?.deviceId ?? null,
      source: rig?.source ?? null,
      controls: rig?.controls ?? [],
      opening: rig?.opening ?? false,
      error: rig?.error ?? null,
      overview: rig?.overview ?? null,
      autoRotation: rig?.autoRotation ?? null,
    });
  }

  function patch(rigId: string, changes: Partial<Rig>) {
    set({ rigs: get().rigs.map((r) => (r.id === rigId ? { ...r, ...changes } : r)) });
    if (rigId === get().activeRig) mirror();
  }

  function rig(rigId: string): Rig | undefined {
    return get().rigs.find((r) => r.id === rigId);
  }

  function detach(rigId: string) {
    unsubscribes.get(rigId)?.();
    unsubscribes.delete(rigId);
    rig(rigId)?.source?.close();
  }

  function attach(rigId: string, source: CameraSource | null) {
    detach(rigId);
    if (rigId === get().activeRig) {
      // A different camera frames differently: old measuring spots no longer apply.
      useFocusProbes.getState().clear();
      set({ pointerTool: "none" });
    }
    patch(rigId, { source, controls: source?.controls() ?? [], overview: null });
    if (source) {
      unsubscribes.set(
        rigId,
        source.onChange(() => patch(rigId, { controls: source.controls(), autoRotation: source.autoRotation?.() ?? null })),
      );
    }
  }

  async function openDevice(rigId: string, deviceId: string | null): Promise<CameraSource> {
    const [kind, ...rest] = (deviceId ?? "webcam:").split(":");
    const ref = rest.join(":");
    if (kind === "phone") return openPhone(ref);
    if (kind === "dslr") {
      const port = await resolveDslrPort(ref);
      return openDslr(port, (message, code) => {
        if (rig(rigId)?.source?.id !== `dslr:${port}`) return;
        patch(rigId, { error: { message, code } });
        if (code === "disconnected") reconnect();
      });
    }
    const res = RESOLUTIONS.find((r) => r.id === get().resolutionId) ?? RESOLUTIONS[1]!;
    try {
      return await openWebcam(ref || null, res);
    } catch (e) {
      // The remembered webcam may be unplugged: fall back to the default one.
      if (!ref) throw e;
      return openWebcam(null, res);
    }
  }

  /** Opens (or reopens) a camera's device. */
  async function open(rigId: string) {
    const gen = (generations.get(rigId) ?? 0) + 1;
    generations.set(rigId, gen);
    attach(rigId, null);
    patch(rigId, { opening: true, error: null });
    try {
      const source = await openDevice(rigId, rig(rigId)?.deviceId ?? null);
      if (generations.get(rigId) !== gen || !rig(rigId)) return source.close();
      attach(rigId, source);
      if (source.kind === "dslr") {
        const label = get().dslrs.find((d) => d.id === source.id)?.label;
        if (label) localStorage.setItem(MODEL_KEY, label);
        // Remember the camera by its current port too.
        patch(rigId, { deviceId: source.id });
        savePrefs(get().rigs, get().resolutionId);
      }
    } catch (e) {
      if (generations.get(rigId) !== gen) return;
      console.error("[gepetta] camera", e);
      patch(rigId, { error: { message: errorMessage(e) } });
      if (rig(rigId)?.deviceId?.startsWith("dslr:")) reconnect();
    } finally {
      if (generations.get(rigId) === gen) patch(rigId, { opening: false });
    }
  }

  /**
   * USB ports change when a camera is replugged or wakes up, so a remembered
   * "dslr:<port>" that is gone falls back to the camera of the same model (or any).
   */
  async function resolveDslrPort(port: string): Promise<string> {
    const dslrs = await listDslrs().catch(() => []);
    set({ dslrs });
    if (dslrs.some((d) => d.id === `dslr:${port}`)) return port;
    const model = localStorage.getItem(MODEL_KEY);
    const match = dslrs.find((d) => d.label === model) ?? dslrs[0];
    if (!match) throw new Error("No encuentro la cámara réflex. Revisá que esté prendida y enchufada.");
    return match.id.slice("dslr:".length);
  }

  /** While a DSLR is gone (asleep, unplugged), look for it again every few seconds. */
  function reconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(async () => {
      const lost = get().rigs.filter((r) => r.deviceId?.startsWith("dslr:") && (r.error || !r.source) && !r.opening);
      if (lost.length === 0) {
        clearInterval(reconnectTimer);
        reconnectTimer = undefined;
        return;
      }
      const dslrs = await listDslrs().catch(() => []);
      if (dslrs.length === 0) return;
      for (const r of lost) void open(r.id);
    }, RECONNECT_MS);
  }

  /** The grid cursor follows the active camera's target. */
  function becomeActive(rigId: string) {
    const prev = rig(get().activeRig ?? "");
    if (prev && prev.id !== rigId) patch(prev.id, { target: useEditor.getState().cursor });
    set({ activeRig: rigId, pointerTool: "none" });
    useFocusProbes.getState().clear();
    mirror();
    const next = rig(rigId);
    if (next && prev && prev.id !== rigId) useEditor.getState().moveTo(next.target.cell, next.target.track);
  }

  return {
    webcams: [],
    dslrs: [],
    rigs: [],
    activeRig: null,
    resolutionId: loadPrefs().resolutionId,
    selectedId: null,
    source: null,
    controls: [],
    opening: false,
    error: null,
    overview: null,
    autoRotation: null,
    pointerTool: "none",
    rotations: loadRotations(),

    rotationOf(r) {
      const label = get().labelOf(r.source?.id ?? r.deviceId);
      const chosen = label ? get().rotations[label] : undefined;
      if (typeof chosen === "number") return quarterTurns(chosen);
      return quarterTurns(r.source?.autoRotation?.() ?? 0);
    },

    rotation() {
      const r = rig(get().activeRig ?? "");
      return r ? get().rotationOf(r) : 0;
    },

    rotate(delta) {
      const label = get().sourceLabel();
      if (!label) return;
      const value: "auto" | number = delta === "auto" ? "auto" : quarterTurns(get().rotation() + delta);
      const rotations = { ...get().rotations, [label]: value };
      set({ rotations });
      if (get().activeRig) patch(get().activeRig!, { overview: null });
      saveRotations(rotations);
    },

    liveOf(r) {
      const frame = r.source?.live();
      return frame ? rotateFrame(frame, get().rotationOf(r)) : null;
    },

    live() {
      const r = rig(get().activeRig ?? "");
      return r ? get().liveOf(r) : null;
    },

    targetOf(r) {
      return r.id === get().activeRig ? useEditor.getState().cursor : r.target;
    },

    setTarget(rigId, target) {
      if (rigId === get().activeRig) useEditor.getState().moveTo(target.cell, target.track);
      else patch(rigId, { target });
    },

    setPointerTool(tool) {
      set({ pointerTool: tool });
    },

    labelOf(deviceId) {
      if (!deviceId) return get().webcams[0]?.label ?? "Webcam";
      const phone = useRemote.getState().devices.find((d) => `phone:${d.sessionId}` === deviceId);
      return phone?.device ?? [...get().webcams, ...get().dslrs].find((o) => o.id === deviceId)?.label ?? null;
    },

    sourceLabel() {
      const r = rig(get().activeRig ?? "");
      return r ? get().labelOf(r.source?.id ?? r.deviceId) : null;
    },

    async start() {
      const cursor = useEditor.getState().cursor;
      if (get().rigs.length === 0) {
        const rigs = loadPrefs().devices.map((d) => newRig(d, cursor));
        set({ rigs, activeRig: rigs[0]!.id });
        mirror();
      }
      await Promise.all(get().rigs.map((r) => open(r.id)));
      void get().refreshDevices();
    },

    stop() {
      clearInterval(reconnectTimer);
      reconnectTimer = undefined;
      for (const r of get().rigs) {
        generations.set(r.id, (generations.get(r.id) ?? 0) + 1);
        detach(r.id);
      }
      // Targets belong to a film: the next one starts from its own cursor.
      set({ rigs: [], activeRig: null, pointerTool: "none" });
      mirror();
    },

    async select(deviceId) {
      const active = get().activeRig;
      // Already open as another camera: switch to it.
      const existing = get().rigs.find((r) => r.deviceId === deviceId);
      if (existing) return get().activate(existing.id);
      if (!active) return get().addCamera(deviceId);
      patch(active, { deviceId });
      savePrefs(get().rigs, get().resolutionId);
      await open(active);
    },

    async addCamera(deviceId) {
      const r = newRig(deviceId, useEditor.getState().cursor);
      set({ rigs: [...get().rigs, r] });
      becomeActive(r.id);
      savePrefs(get().rigs, get().resolutionId);
      await open(r.id);
    },

    removeCamera(rigId) {
      generations.set(rigId, (generations.get(rigId) ?? 0) + 1);
      detach(rigId);
      const rigs = get().rigs.filter((r) => r.id !== rigId);
      set({ rigs });
      if (get().activeRig === rigId) {
        set({ activeRig: null });
        if (rigs[0]) becomeActive(rigs[0].id);
        else mirror();
      }
      savePrefs(rigs, get().resolutionId);
    },

    activate(rigId) {
      if (rig(rigId)) becomeActive(rigId);
    },

    async selectResolution(id) {
      set({ resolutionId: id });
      savePrefs(get().rigs, id);
      const active = rig(get().activeRig ?? "");
      if (active?.source?.kind === "webcam") await open(active.id);
    },

    async setControl(control, value) {
      const active = get().activeRig;
      if (!active) return;
      // Remember the whole picture before magnifying, to show where the magnifier is looking.
      if (control.kind === "magnify" && value !== "1" && control.value === "1") patch(active, { overview: snapshot() });
      try {
        await rig(active)?.source?.setControl(control, value);
      } catch (e) {
        patch(active, { error: { message: errorMessage(e) } });
      }
    },

    setRecording(rigId, recording) {
      patch(rigId, { recording });
    },

    async refreshDevices() {
      const [webcams, dslrs] = await Promise.all([
        listWebcams().catch(() => []),
        dslrAvailable ? listDslrs().catch(() => []) : Promise.resolve([]),
      ]);
      set({ webcams, dslrs });
    },
  };
});

/** A small JPEG data URL of the active camera's live frame. */
function snapshot(): string | null {
  const live = useCamera.getState().live();
  if (!live) return null;
  const scale = Math.min(1, 480 / live.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(live.width * scale);
  canvas.height = Math.round(live.height * scale);
  canvas.getContext("2d")!.drawImage(live.image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** A phone that disconnects stops being a camera. */
useRemote.subscribe((state, prev) => {
  if (state.devices === prev.devices) return;
  for (const r of useCamera.getState().rigs) {
    if (!r.deviceId?.startsWith("phone:")) continue;
    const sessionId = r.deviceId.slice("phone:".length);
    if (state.devices.some((d) => d.sessionId === sessionId)) continue;
    useBusy.getState().notify("Se desconectó el celular.");
    if (useCamera.getState().rigs.length > 1) useCamera.getState().removeCamera(r.id);
    else void useCamera.getState().select("webcam:");
  }
});

navigator.mediaDevices?.addEventListener("devicechange", () => void useCamera.getState().refreshDevices());
