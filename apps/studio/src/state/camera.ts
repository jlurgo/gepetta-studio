import { create } from "zustand";
import {
  type CameraControl,
  type CameraDevice,
  RESOLUTIONS,
  applyControl,
  listCameras,
  openCamera,
  readControls,
  stopStream,
} from "../capture/webcam";

/** The single <video> the live view is drawn from and captures are taken from. */
export const liveVideo = Object.assign(document.createElement("video"), {
  muted: true,
  playsInline: true,
  autoplay: true,
});

interface CameraState {
  devices: CameraDevice[];
  deviceId: string | null;
  resolutionId: string;
  stream: MediaStream | null;
  controls: CameraControl[];
  error: string | null;
  start(): Promise<void>;
  stop(): void;
  selectDevice(id: string): Promise<void>;
  selectResolution(id: string): Promise<void>;
  setControl(control: CameraControl, value: number | string): Promise<void>;
  refreshDevices(): Promise<void>;
}

const PREFS_KEY = "gepetta.camera";

/** Bumped by every start/stop so a slow, superseded getUserMedia does not win. */
let generation = 0;

function loadPrefs(): { deviceId: string | null; resolutionId: string } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { deviceId: p.deviceId ?? null, resolutionId: p.resolutionId ?? "1080" };
  } catch {
    return { deviceId: null, resolutionId: "1080" };
  }
}

function savePrefs(deviceId: string | null, resolutionId: string) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ deviceId, resolutionId }));
  } catch {
    // Preferences are a convenience only.
  }
}

function describeError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "No hay permiso para usar la cámara.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No se encontró la cámara.";
  if (name === "NotReadableError") return "La cámara está siendo usada por otra aplicación.";
  return "No se pudo abrir la cámara.";
}

export const useCamera = create<CameraState>((set, get) => ({
  devices: [],
  ...loadPrefs(),
  stream: null,
  controls: [],
  error: null,

  async start() {
    const gen = ++generation;
    const { deviceId, resolutionId, stream: old } = get();
    stopStream(old);
    const res = RESOLUTIONS.find((r) => r.id === resolutionId) ?? RESOLUTIONS[1]!;
    try {
      let stream: MediaStream;
      try {
        stream = await openCamera(deviceId, res);
      } catch (e) {
        // The remembered camera may be unplugged: fall back to the default one.
        if (!deviceId) throw e;
        stream = await openCamera(null, res);
      }
      if (gen !== generation) return stopStream(stream);
      const track = stream.getVideoTracks()[0]!;
      liveVideo.srcObject = stream;
      await liveVideo.play().catch(() => undefined);
      const actualId = track.getSettings().deviceId ?? deviceId;
      set({ stream, deviceId: actualId, controls: readControls(track), error: null });
      await get().refreshDevices();
    } catch (e) {
      if (gen !== generation) return;
      console.error("[gepetta] camera", e);
      set({ stream: null, controls: [], error: describeError(e) });
    }
  },

  stop() {
    generation++;
    stopStream(get().stream);
    liveVideo.srcObject = null;
    set({ stream: null, controls: [] });
  },

  async selectDevice(id) {
    set({ deviceId: id });
    savePrefs(id, get().resolutionId);
    await get().start();
  },

  async selectResolution(id) {
    set({ resolutionId: id });
    savePrefs(get().deviceId, id);
    await get().start();
  },

  async setControl(control, value) {
    const track = get().stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await applyControl(track, control, value);
    } catch (e) {
      console.warn("[gepetta] control not applied", control.key, e);
    }
    set({ controls: readControls(track) });
  },

  async refreshDevices() {
    set({ devices: await listCameras() });
  },
}));

navigator.mediaDevices?.addEventListener("devicechange", () => void useCamera.getState().refreshDevices());
