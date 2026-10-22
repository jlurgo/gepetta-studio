import type { CameraControl } from "@gepetta/protocol";

/**
 * DSLR support behind one interface, so the gphoto2 driver (macOS/Linux) can
 * later be joined by a Canon EDSDK one (which is also what will bring Windows).
 * Mirrors `GepettaNative.dslr` in apps/studio/src/native.d.ts.
 */

export interface DslrStatus {
  available: boolean;
  /** Why DSLRs cannot be used, when they cannot. */
  reason?: "not-installed" | "unsupported-os";
  /** Spanish help text, e.g. how to install gphoto2. */
  hint?: string;
}

export interface DslrCamera {
  /** Driver-specific camera id; for gphoto2 the port, e.g. "usb:020,005". */
  id: string;
  model: string;
}

export interface DslrCapture {
  /** JPEG for display/editing (camera JPEG, or the preview embedded in the RAW). */
  jpeg: Buffer;
  raw: { data: Buffer; mime: string; name: string } | null;
}

export type DslrErrorCode = "busy" | "disconnected" | "failed";

/** An error whose message is ready to show (in Spanish). */
export class DslrError extends Error {
  constructor(
    message: string,
    readonly code: DslrErrorCode,
    /** Raw tool output, for logs. */
    readonly detail = "",
  ) {
    super(message);
    this.name = "DslrError";
  }
}

export type FrameListener = (jpeg: Buffer) => void;
export type ErrorListener = (message: string, code: DslrErrorCode) => void;

export interface DslrDriver {
  status(): Promise<DslrStatus>;
  detect(): Promise<DslrCamera[]>;
  /** Starts live view. Resolves once it runs (or rejects with a DslrError). */
  open(id: string, onFrame: FrameListener, onError: ErrorListener): Promise<void>;
  /** Stops live view. */
  close(id: string): Promise<void>;
  capture(id: string): Promise<DslrCapture>;
  getControls(id: string): Promise<CameraControl[]>;
  /** Applies a setting (or triggers an action) and returns the refreshed controls. */
  setControl(id: string, key: string, value: string): Promise<CameraControl[]>;
  /** macOS: stops the system daemons that grab cameras over USB. */
  releaseUsb(): Promise<void>;
  /** Stops every live view (app quit). */
  dispose(): Promise<void>;
}
