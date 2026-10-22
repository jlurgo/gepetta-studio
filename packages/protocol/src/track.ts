import type { CameraControl, ControlValue } from "./controls";

/**
 * Controls of a getUserMedia video track (webcams, phone cameras). What exists
 * depends on browser, OS and driver: Chrome on Android/Windows exposes most,
 * Safari and macOS very few.
 */

const RANGES: Record<string, { label: string; manualMode?: string }> = {
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

const MODES: Record<string, string> = {
  focusMode: "Modo de foco",
  whiteBalanceMode: "Modo de balance de blancos",
  exposureMode: "Modo de exposición",
};

const MODE_VALUES: Record<string, string> = {
  continuous: "Automático",
  "single-shot": "Una vez",
  manual: "Manual",
  none: "Ninguno",
};

type Caps = Record<string, unknown>;

export function readTrackControls(track: MediaStreamTrack): CameraControl[] {
  const caps = (track.getCapabilities?.() ?? {}) as Caps;
  const settings = track.getSettings() as Caps;
  const controls: CameraControl[] = [];
  for (const [key, label] of Object.entries(MODES)) {
    const options = caps[key];
    if (Array.isArray(options) && options.length > 1) {
      controls.push({
        kind: "choice",
        key,
        label,
        options: options.map((o: string) => ({ value: o, label: MODE_VALUES[o] ?? o })),
        value: String(settings[key] ?? options[0]),
      });
    }
  }
  for (const [key, meta] of Object.entries(RANGES)) {
    const range = caps[key] as { min?: number; max?: number; step?: number } | undefined;
    if (!range || typeof range.min !== "number" || typeof range.max !== "number" || range.min === range.max) continue;
    const step = range.step && range.step > 0 ? range.step : (range.max - range.min) / 100;
    const value = typeof settings[key] === "number" ? (settings[key] as number) : range.min;
    controls.push({ kind: "range", key, label: meta.label, min: range.min, max: range.max, step, value, manualMode: meta.manualMode });
  }
  if (caps.torch === true) controls.push({ kind: "toggle", key: "torch", label: "Linterna", value: settings.torch === true });
  return controls;
}

export async function applyTrackControl(track: MediaStreamTrack, control: CameraControl, value: ControlValue) {
  const constraint: Caps = { [control.key]: value };
  // A manual value only sticks if its mode is manual (e.g. focus distance needs focusMode=manual).
  if (control.kind === "range" && control.manualMode) constraint[control.manualMode] = "manual";
  await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
}
