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
  let rotation: number | null = null;
  const pending = new Map<string, { resolve(b: Blob): void; reject(e: Error): void }>();

  // The preview as video (when this app can decode it): much smoother than JPEG after JPEG.
  const canVideo = typeof VideoDecoder === "function";
  let decoder: VideoDecoder | null = null;
  let decoderCodec = "";
  let videoFrame: VideoFrame | null = null;
  let waitingKey = true;
  let closed = false;
  const askVideo = () => canVideo && void sendToPhone(sessionId, { t: "previewVideo" });

  function decode(header: { key: boolean; ts: number; codec: string }, payload: Uint8Array) {
    if (!decoder || decoder.state === "closed" || decoderCodec !== header.codec) {
      if (decoder && decoder.state !== "closed") decoder.close();
      const made = new VideoDecoder({
        output: (frame) => {
          if (closed) return frame.close();
          const first = !videoFrame;
          videoFrame?.close();
          videoFrame = frame;
          if (first) listeners.emit();
        },
        error: (e) => {
          console.warn("[gepetta] phone video", e);
          if (decoder === made) decoder = null;
          waitingKey = true;
          askVideo();
        },
      });
      made.configure({ codec: header.codec, optimizeForLatency: true });
      decoder = made;
      decoderCodec = header.codec;
      waitingKey = true;
    }
    // Behind: let go of what is queued and start again from the next key frame.
    if (decoder.decodeQueueSize > 4) {
      waitingKey = true;
      askVideo();
    }
    if (waitingKey && !header.key) return;
    waitingKey = false;
    decoder.decode(new EncodedVideoChunk({ type: header.key ? "key" : "delta", timestamp: header.ts, data: payload }));
  }

  const unsubscribe = onRemoteMessage((sid, header, payload) => {
    if (sid !== sessionId) return;
    switch (header.t) {
      case "video":
        if (payload && canVideo) {
          try {
            decode(header, payload);
          } catch (e) {
            console.warn("[gepetta] phone video", e);
            decoder = null;
            waitingKey = true;
          }
        }
        if ((header.rotation ?? null) !== rotation) {
          rotation = header.rotation ?? null;
          listeners.emit();
        }
        break;
      case "preview":
        // JPEG again (the phone reconnected, or can't make video): ask for video once more.
        if (videoFrame) {
          videoFrame.close();
          videoFrame = null;
          askVideo();
        }
        if (payload) frames.push(payload.slice(), () => listeners.emit());
        if ((header.rotation ?? null) !== rotation) {
          rotation = header.rotation ?? null;
          listeners.emit();
        }
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

  askVideo();

  return {
    id: `phone:${sessionId}`,
    kind: "phone",
    live: () => (videoFrame ? { image: videoFrame, width: videoFrame.displayWidth, height: videoFrame.displayHeight } : frames.get()),
    autoRotation: () => rotation,
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
      closed = true;
      unsubscribe();
      if (decoder && decoder.state !== "closed") decoder.close();
      videoFrame?.close();
      videoFrame = null;
      frames.close();
      pending.forEach((p) => p.reject(new Error("Se cambió de cámara")));
      pending.clear();
    },
  };
}
