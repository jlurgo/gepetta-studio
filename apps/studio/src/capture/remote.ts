import type { CameraControl, DesktopMessage, PhoneMessage } from "@gepetta/protocol";
import { create } from "zustand";
import type { RemoteDevice, RemoteServerInfo } from "../native";

/** The phone server (desktop app only) and the phones connected to it. */

interface RemoteState {
  server: RemoteServerInfo | null;
  devices: RemoteDevice[];
  starting: boolean;
  error: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const remoteAvailable = Boolean(window.gepetta);

type MessageHandler = (sessionId: string, header: PhoneMessage, payload: Uint8Array | null) => void;
const handlers = new Set<MessageHandler>();

export function onRemoteMessage(cb: MessageHandler): () => void {
  handlers.add(cb);
  return () => void handlers.delete(cb);
}

/** Latest controls each phone reported, so a phone picked later starts with them. */
const lastControls = new Map<string, CameraControl[]>();

export function phoneControls(sessionId: string): CameraControl[] {
  return lastControls.get(sessionId) ?? [];
}

export function sendToPhone(sessionId: string, header: DesktopMessage, payload?: Uint8Array | null) {
  return window.gepetta?.remote.send(sessionId, header, payload ?? null);
}

export const useRemote = create<RemoteState>((set, get) => ({
  server: null,
  devices: [],
  starting: false,
  error: null,
  async start() {
    if (!window.gepetta || get().server || get().starting) return;
    set({ starting: true, error: null });
    try {
      set({ server: await window.gepetta.remote.start() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e) });
    } finally {
      set({ starting: false });
    }
  },
  async stop() {
    await window.gepetta?.remote.stop();
    set({ server: null, devices: [] });
  },
}));

window.gepetta?.remote.onEvent((e) => {
  if (e.type === "devices") {
    useRemote.setState({ devices: e.devices });
    for (const id of lastControls.keys()) if (!e.devices.some((d) => d.sessionId === id)) lastControls.delete(id);
    return;
  }
  if (e.header.t === "controls") lastControls.set(e.sessionId, e.header.controls);
  handlers.forEach((h) => h(e.sessionId, e.header, e.payload));
});

// App state lives here (open cameras, the film being edited): a hot update would
// start an empty copy beside the old one, so a change here reloads the app instead.
import.meta.hot?.accept(() => location.reload());
