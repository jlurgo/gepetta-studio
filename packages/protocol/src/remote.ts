import type { CameraControl, ControlValue } from "./controls";

/**
 * Messages between the desktop app and a remote camera (the phone page today, a
 * native phone app later). Every message is one WebSocket binary frame:
 *   [u32 LE header length][header JSON, UTF-8][optional payload bytes]
 * The payload carries JPEG previews and photos without base64 overhead.
 */

export const PROTOCOL_VERSION = 1;

export type RemoteMode = "live" | "photo";

export type PhoneMessage =
  | { t: "hello"; protocol: number; device: string; mode: RemoteMode }
  | { t: "controls"; controls: CameraControl[] }
  /** Payload: JPEG preview frame. */
  | { t: "preview"; w: number; h: number }
  /** Payload: full-resolution photo. requestId is null when shot from the phone itself. */
  | { t: "photo"; requestId: string | null; mime: string }
  | { t: "error"; requestId?: string; message: string };

export type DesktopMessage =
  | { t: "welcome"; sessionId: string; filmName: string | null }
  | { t: "capture"; requestId: string }
  | { t: "setControl"; key: string; value: ControlValue }
  /** Payload: JPEG of the previous frame for onion skinning on the phone; no payload clears it. */
  | { t: "onion"; filmName: string | null }
  | { t: "previewSettings"; maxWidth: number; fps: number };

export interface Envelope<M> {
  header: M;
  payload: Uint8Array | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(header: PhoneMessage | DesktopMessage, payload?: Uint8Array | null): Uint8Array {
  const json = encoder.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + (payload?.length ?? 0));
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  if (payload) out.set(payload, 4 + json.length);
  return out;
}

export function decodeMessage<M>(data: ArrayBuffer | Uint8Array): Envelope<M> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4) throw new Error("Mensaje inválido");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + headerLength > bytes.length) throw new Error("Mensaje inválido");
  const header = JSON.parse(decoder.decode(bytes.subarray(4, 4 + headerLength))) as M;
  const payload = bytes.length > 4 + headerLength ? bytes.subarray(4 + headerLength) : null;
  return { header, payload };
}
