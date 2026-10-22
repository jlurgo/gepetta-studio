import type { CameraControl, DesktopMessage, PhoneMessage } from "@gepetta/protocol";

/**
 * API exposed by the Electron preload script (apps/desktop/src/preload.ts).
 * Absent in the browser. IPC channel names are listed next to each method.
 */
export interface NativeFilmMeta {
  id: string;
  name: string;
  updatedAt: number;
  frameCount: number;
  thumb: string | null;
}

export interface RemoteDevice {
  sessionId: string;
  device: string;
  mode: "live" | "photo";
  connectedAt: number;
}

export interface RemoteServerInfo {
  /** Plain-HTTP landing page (works everywhere; photo mode, setup help). Includes the pairing token. */
  httpUrl: string;
  /** HTTPS page for live mode (needs the local certificate trusted on iPhone). */
  httpsUrl: string;
  /** Local root certificate to install on the phone. */
  caUrl: string;
  addresses: string[];
  /** QR code (data: URL, PNG) for httpUrl. */
  qrDataUrl: string;
}

export type RemoteEvent =
  | { type: "devices"; devices: RemoteDevice[] }
  | { type: "message"; sessionId: string; header: PhoneMessage; payload: Uint8Array | null };

export interface DslrStatus {
  available: boolean;
  /** Why DSLRs cannot be used, when they cannot. */
  reason?: "not-installed" | "unsupported-os";
  /** Spanish help text, e.g. how to install gphoto2. */
  hint?: string;
}

export interface DslrCamera {
  /** gphoto2 port, e.g. "usb:020,005". */
  id: string;
  model: string;
}

export interface DslrCapture {
  /** JPEG for display/editing (camera JPEG, or the preview embedded in the RAW). */
  jpeg: Uint8Array;
  raw: { data: Uint8Array; mime: string; name: string } | null;
}

export type DslrErrorCode = "busy" | "disconnected" | "failed";

export interface GepettaNative {
  platform: string;
  films: {
    list(): Promise<NativeFilmMeta[]>; // films:list
    load(id: string): Promise<string>; // films:load
    save(id: string, meta: NativeFilmMeta, json: string): Promise<void>; // films:save
    remove(id: string): Promise<void>; // films:remove
    reveal(id: string): Promise<void>; // films:reveal
  };
  assets: {
    has(filmId: string, assetId: string): Promise<boolean>; // assets:has
    put(filmId: string, assetId: string, mime: string, data: ArrayBuffer): Promise<void>; // assets:put
    get(filmId: string, assetId: string): Promise<ArrayBuffer>; // assets:get
  };
  saveFile(defaultName: string, data: ArrayBuffer): Promise<string | null>; // file:save
  fileExists(filePath: string): Promise<boolean>; // file:exists
  /** Shows the file in Finder / Explorer. */
  revealFile(filePath: string): Promise<void>; // file:reveal
  remote: {
    start(): Promise<RemoteServerInfo>; // remote:start
    stop(): Promise<void>; // remote:stop
    send(sessionId: string, header: DesktopMessage, payload?: Uint8Array | null): Promise<void>; // remote:send
    /** Event channel remote:event. Returns an unsubscribe function. */
    onEvent(cb: (e: RemoteEvent) => void): () => void;
  };
  dslr: {
    status(): Promise<DslrStatus>; // dslr:status
    detect(): Promise<DslrCamera[]>; // dslr:detect
    /** Starts live view; frames arrive through onFrame. */
    open(id: string): Promise<void>; // dslr:open
    close(id: string): Promise<void>; // dslr:close
    capture(id: string): Promise<DslrCapture>; // dslr:capture
    getControls(id: string): Promise<CameraControl[]>; // dslr:getControls
    /** Applies a setting (or triggers an action) and returns the refreshed controls. */
    setControl(id: string, key: string, value: string): Promise<CameraControl[]>; // dslr:setControl
    /** macOS: stops the system daemon that grabs cameras over USB (PTPCamera). */
    releaseUsb(): Promise<void>; // dslr:releaseUsb
    onFrame(cb: (id: string, jpeg: Uint8Array) => void): () => void; // event dslr:frame
    onError(cb: (id: string, message: string, code: DslrErrorCode) => void): () => void; // event dslr:error
  };
  updates: {
    /** Version already downloaded and waiting to install, if any. */
    pending(): Promise<string | null>; // update:pending
    /** Closes the app, installs the downloaded version and opens it again. */
    install(): Promise<void>; // update:install
    onReady(cb: (version: string) => void): () => void; // event update:ready
  };
}

declare global {
  interface Window {
    gepetta?: GepettaNative;
  }
}
