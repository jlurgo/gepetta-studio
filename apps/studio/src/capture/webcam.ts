import { type CameraControl, type ControlValue, applyTrackControl, readTrackControls } from "@gepetta/protocol";
import { type CameraSource, type CapturedStill, Listeners, type SourceOption } from "./types";

/** Webcams through getUserMedia. Controls depend on what the browser/driver exposes. */

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTIONS: ResolutionPreset[] = [
  { id: "4k", label: "4K (3840×2160)", width: 3840, height: 2160 },
  { id: "1080", label: "Full HD (1920×1080)", width: 1920, height: 1080 },
  { id: "720", label: "HD (1280×720)", width: 1280, height: 720 },
  { id: "480", label: "VGA (640×480)", width: 640, height: 480 },
];

export async function listWebcams(): Promise<SourceOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ id: `webcam:${d.deviceId}`, kind: "webcam" as const, label: d.label || `Cámara ${i + 1}` }));
}

export function describeMediaError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "No hay permiso para usar la cámara.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No se encontró la cámara.";
  if (name === "NotReadableError") return "La cámara está siendo usada por otra aplicación.";
  return "No se pudo abrir la cámara.";
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => resolve());
    else requestAnimationFrame(() => resolve());
  });
}

/**
 * Grabs the current video frame at full sensor resolution. With `average` > 1 it
 * averages that many consecutive frames, which cleans up sensor noise in dim light.
 */
async function captureStill(video: HTMLVideoElement, average: number): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("La cámara todavía no está lista");
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: average > 1 })!;
  ctx.drawImage(video, 0, 0, w, h);
  if (average > 1) {
    const sum = new Float32Array(w * h * 4);
    for (let n = 0; n < average; n++) {
      if (n > 0) {
        await nextVideoFrame(video);
        ctx.drawImage(video, 0, 0, w, h);
      }
      const px = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < px.length; i++) sum[i]! += px[i]!;
    }
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < sum.length; i++) out.data[i] = sum[i]! / average;
    ctx.putImageData(out, 0, 0);
  }
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
}

/** Opens a webcam. `deviceId` null = the system default. */
export async function openWebcam(deviceId: string | null, res: ResolutionPreset): Promise<CameraSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: res.width },
      height: { ideal: res.height },
    },
  });
  const track = stream.getVideoTracks()[0]!;
  const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true });
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  const listeners = new Listeners();
  let controls = readTrackControls(track);

  return {
    id: `webcam:${track.getSettings().deviceId ?? deviceId ?? "default"}`,
    kind: "webcam",
    live: () =>
      video.readyState >= 2 && video.videoWidth ? { image: video, width: video.videoWidth, height: video.videoHeight } : null,
    controls: () => controls,
    async setControl(control: CameraControl, value: ControlValue) {
      try {
        await applyTrackControl(track, control, value);
      } catch (e) {
        console.warn("[gepetta] control not applied", control.key, e);
      }
      controls = readTrackControls(track);
      listeners.emit();
    },
    async capture(average: number): Promise<CapturedStill> {
      return { image: await captureStill(video, average), raw: null };
    },
    onChange: (cb) => listeners.add(cb),
    close() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

export function webcamSettings(source: CameraSource | null): { width?: number; height?: number } {
  if (source?.kind !== "webcam") return {};
  const frame = source.live();
  return frame ? { width: frame.width, height: frame.height } : {};
}
