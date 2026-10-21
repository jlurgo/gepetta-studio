/**
 * Webcams through getUserMedia. Which controls exist depends on the browser,
 * OS and driver: Chrome on Windows exposes most UVC controls, macOS very few.
 * Native UVC control (and DSLRs) will plug in later behind the same shape.
 */

export interface CameraDevice {
  id: string;
  label: string;
}

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

export type CameraControl =
  | { kind: "range"; key: string; label: string; min: number; max: number; step: number; value: number; manualMode?: string }
  | { kind: "mode"; key: string; label: string; options: string[]; value: string };

const RANGE_LABELS: Record<string, { label: string; manualMode?: string }> = {
  zoom: { label: "Zoom" },
  focusDistance: { label: "Foco", manualMode: "focusMode" },
  colorTemperature: { label: "Balance de blancos (K)", manualMode: "whiteBalanceMode" },
  exposureTime: { label: "Tiempo de exposición", manualMode: "exposureMode" },
  exposureCompensation: { label: "Compensación de exposición" },
  iso: { label: "ISO", manualMode: "exposureMode" },
  brightness: { label: "Brillo" },
  contrast: { label: "Contraste" },
  saturation: { label: "Saturación" },
  sharpness: { label: "Nitidez" },
  pan: { label: "Paneo" },
  tilt: { label: "Inclinación" },
};

const MODE_LABELS: Record<string, string> = {
  focusMode: "Modo de foco",
  whiteBalanceMode: "Modo de balance de blancos",
  exposureMode: "Modo de exposición",
};

export const MODE_VALUE_LABELS: Record<string, string> = {
  continuous: "Automático",
  "single-shot": "Una vez",
  manual: "Manual",
  none: "Ninguno",
};

export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}` }));
}

export async function openCamera(deviceId: string | null, res: ResolutionPreset): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: res.width },
      height: { ideal: res.height },
    },
  });
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

type Caps = Record<string, unknown>;

export function readControls(track: MediaStreamTrack): CameraControl[] {
  const caps = (track.getCapabilities?.() ?? {}) as Caps;
  const settings = track.getSettings() as Caps;
  const controls: CameraControl[] = [];
  for (const [key, label] of Object.entries(MODE_LABELS)) {
    const options = caps[key];
    if (Array.isArray(options) && options.length > 1) {
      controls.push({ kind: "mode", key, label, options, value: String(settings[key] ?? options[0]) });
    }
  }
  for (const [key, meta] of Object.entries(RANGE_LABELS)) {
    const range = caps[key] as { min?: number; max?: number; step?: number } | undefined;
    if (!range || typeof range.min !== "number" || typeof range.max !== "number" || range.min === range.max) continue;
    const step = range.step && range.step > 0 ? range.step : (range.max - range.min) / 100;
    const value = typeof settings[key] === "number" ? (settings[key] as number) : range.min;
    controls.push({ kind: "range", key, label: meta.label, min: range.min, max: range.max, step, value, manualMode: meta.manualMode });
  }
  return controls;
}

export async function applyControl(track: MediaStreamTrack, control: CameraControl, value: number | string) {
  const constraint: Caps = { [control.key]: value };
  // A manual value only sticks if its mode is manual (e.g. focus distance needs focusMode=manual).
  if (control.kind === "range" && control.manualMode) constraint[control.manualMode] = "manual";
  await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
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
export async function captureStill(video: HTMLVideoElement, average = 1): Promise<Blob> {
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
