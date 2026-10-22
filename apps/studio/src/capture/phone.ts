import type { CameraControl, ControlValue } from "@gepetta/protocol";
import { newId } from "@gepetta/core";
import { onRemoteMessage, phoneControls, sendToPhone } from "./remote";
import { type CameraSource, type CapturedStill, FrameSlot, Listeners } from "./types";

const CAPTURE_TIMEOUT_MS = 20_000;

/** A phone in live mode: preview frames and photos arrive over the LAN server. */
export function openPhone(sessionId: string): CameraSource {
  const frames = new FrameSlot();
  const listeners = new Listeners();
  let controls: CameraControl[] = phoneControls(sessionId);
  const pending = new Map<string, { resolve(b: Blob): void; reject(e: Error): void }>();

  const unsubscribe = onRemoteMessage((sid, header, payload) => {
    if (sid !== sessionId) return;
    switch (header.t) {
      case "preview":
        if (payload) frames.push(payload.slice(), () => listeners.emit());
        break;
      case "controls":
        controls = header.controls;
        listeners.emit();
        break;
      case "photo": {
        const waiter = header.requestId ? pending.get(header.requestId) : undefined;
        if (waiter && payload) {
          pending.delete(header.requestId!);
          waiter.resolve(new Blob([payload.slice()], { type: header.mime || "image/jpeg" }));
        }
        break;
      }
      case "error": {
        const waiter = header.requestId ? pending.get(header.requestId) : undefined;
        if (waiter) {
          pending.delete(header.requestId!);
          waiter.reject(new Error(`El celular no pudo sacar la foto: ${header.message}`));
        }
        break;
      }
    }
  });

  return {
    id: `phone:${sessionId}`,
    kind: "phone",
    live: () => frames.get(),
    controls: () => controls,
    async setControl(control: CameraControl, value: ControlValue) {
      await sendToPhone(sessionId, { t: "setControl", key: control.key, value });
    },
    capture(): Promise<CapturedStill> {
      const requestId = newId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("El celular no respondió. ¿Sigue conectado?"));
        }, CAPTURE_TIMEOUT_MS);
        pending.set(requestId, {
          resolve: (image) => {
            clearTimeout(timer);
            resolve({ image, raw: null });
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        void sendToPhone(sessionId, { t: "capture", requestId });
      });
    },
    onChange: (cb) => listeners.add(cb),
    close() {
      unsubscribe();
      frames.close();
      pending.forEach((p) => p.reject(new Error("Se cambió de cámara")));
      pending.clear();
    },
  };
}
