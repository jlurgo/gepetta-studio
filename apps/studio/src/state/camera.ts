import type { CameraControl, ControlValue } from "@gepetta/protocol";
import { create } from "zustand";
import { dslrAvailable, listDslrs, openDslr } from "../capture/dslr";
import { openPhone } from "../capture/phone";
import { useRemote } from "../capture/remote";
import type { CameraSource, SourceOption } from "../capture/types";
import { RESOLUTIONS, describeMediaError, listWebcams, openWebcam } from "../capture/webcam";
import type { DslrErrorCode } from "../native";
import { useBusy } from "./busy";

interface CameraState {
  /** Webcams and DSLRs found; phones come from useRemote. */
  webcams: SourceOption[];
  dslrs: SourceOption[];
  /** The chosen camera, e.g. "webcam:abc"; null = default webcam. */
  selectedId: string | null;
  resolutionId: string;
  source: CameraSource | null;
  controls: CameraControl[];
  opening: boolean;
  error: { message: string; code?: DslrErrorCode } | null;
  start(): Promise<void>;
  stop(): void;
  select(id: string): Promise<void>;
  selectResolution(id: string): Promise<void>;
  setControl(control: CameraControl, value: ControlValue): Promise<void>;
  refreshDevices(): Promise<void>;
}

const PREFS_KEY = "gepetta.camera";
const MODEL_KEY = "gepetta.camera.dslrModel";

function loadPrefs(): { selectedId: string | null; resolutionId: string } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    // Phones get a new session id on every connection, so they are never restored.
    const selectedId = typeof p.selectedId === "string" && !p.selectedId.startsWith("phone:") ? p.selectedId : null;
    return { selectedId, resolutionId: p.resolutionId ?? "1080" };
  } catch {
    return { selectedId: null, resolutionId: "1080" };
  }
}

function savePrefs(selectedId: string | null, resolutionId: string) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ selectedId, resolutionId }));
  } catch {
    // Preferences are a convenience only.
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof DOMException) return describeMediaError(e);
  // Electron prefixes errors thrown in the main process.
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
}

/** Bumped by every start/stop so a slow, superseded open does not win. */
let generation = 0;
let offChange: (() => void) | null = null;
let reconnectTimer: ReturnType<typeof setInterval> | undefined;

const RECONNECT_MS = 3000;

function stopReconnecting() {
  clearInterval(reconnectTimer);
  reconnectTimer = undefined;
}

export const useCamera = create<CameraState>((set, get) => {
  function attach(source: CameraSource | null) {
    offChange?.();
    offChange = null;
    get().source?.close();
    set({ source, controls: source?.controls() ?? [] });
    if (source) offChange = source.onChange(() => set({ controls: source.controls() }));
  }

  async function open(id: string | null): Promise<CameraSource> {
    const [kind, ...rest] = (id ?? "webcam:").split(":");
    const ref = rest.join(":");
    if (kind === "phone") return openPhone(ref);
    if (kind === "dslr") {
      const port = await resolveDslrPort(ref);
      return openDslr(port, (message, code) => {
        if (get().source?.id !== `dslr:${port}`) return;
        set({ error: { message, code } });
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
      const { selectedId, source } = get();
      if (!selectedId?.startsWith("dslr:") || (source && !get().error)) return stopReconnecting();
      const dslrs = await listDslrs().catch(() => []);
      if (dslrs.length === 0) return;
      stopReconnecting();
      await get().start();
    }, RECONNECT_MS);
  }

  return {
    webcams: [],
    dslrs: [],
    ...loadPrefs(),
    source: null,
    controls: [],
    opening: false,
    error: null,

    async start() {
      const gen = ++generation;
      stopReconnecting();
      attach(null);
      set({ opening: true, error: null });
      try {
        const source = await open(get().selectedId);
        if (gen !== generation) return source.close();
        attach(source);
        if (source.kind === "dslr") {
          const label = get().dslrs.find((d) => d.id === source.id)?.label;
          if (label) localStorage.setItem(MODEL_KEY, label);
          // Remember the camera by its current port too.
          set({ selectedId: source.id });
          savePrefs(source.id, get().resolutionId);
        }
      } catch (e) {
        if (gen !== generation) return;
        console.error("[gepetta] camera", e);
        set({ error: { message: errorMessage(e) } });
        if (get().selectedId?.startsWith("dslr:")) reconnect();
      } finally {
        if (gen === generation) set({ opening: false });
      }
      void get().refreshDevices();
    },

    stop() {
      generation++;
      stopReconnecting();
      attach(null);
      set({ opening: false });
    },

    async select(id) {
      set({ selectedId: id });
      savePrefs(id, get().resolutionId);
      await get().start();
    },

    async selectResolution(id) {
      set({ resolutionId: id });
      savePrefs(get().selectedId, id);
      if (get().source?.kind === "webcam") await get().start();
    },

    async setControl(control, value) {
      try {
        await get().source?.setControl(control, value);
      } catch (e) {
        set({ error: { message: errorMessage(e) } });
      }
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

/** When the selected phone disconnects, fall back to the default webcam. */
useRemote.subscribe((state, prev) => {
  if (state.devices === prev.devices) return;
  const { source } = useCamera.getState();
  if (source?.kind !== "phone") return;
  const sessionId = source.id.slice("phone:".length);
  if (!state.devices.some((d) => d.sessionId === sessionId)) {
    useBusy.getState().notify("Se desconectó el celular. Volvemos a la webcam.");
    void useCamera.getState().select("webcam:");
  }
});

navigator.mediaDevices?.addEventListener("devicechange", () => void useCamera.getState().refreshDevices());
