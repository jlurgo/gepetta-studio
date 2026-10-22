import type { CameraControl, ControlOption } from "@gepetta/protocol";
import type { DslrCamera, DslrErrorCode } from "./types";

/** Pure parsers for gphoto2 CLI output (run with LANG=C so it is in English). */

/**
 * `gphoto2 --auto-detect`:
 *
 *     Model                          Port
 *     ----------------------------------------------------------
 *     Canon EOS 600D                 usb:020,005
 */
export function parseAutoDetect(out: string): DslrCamera[] {
  const cameras: DslrCamera[] = [];
  let pastHeader = false;
  for (const line of out.split(/\r?\n/)) {
    if (!pastHeader) {
      if (/^-{5,}\s*$/.test(line)) pastHeader = true;
      continue;
    }
    // The port is the last token; the model is everything before it (it has spaces).
    const m = /^(.*\S)\s+(\S+:\S*)\s*$/.exec(line);
    if (!m) continue;
    const [, model, port] = m as unknown as [string, string, string];
    // Mass-storage mounts cannot be tethered.
    if (port.startsWith("disk:")) continue;
    cameras.push({ id: port, model });
  }
  return cameras;
}

export type ConfigType = "RADIO" | "MENU" | "TEXT" | "TOGGLE" | "RANGE" | "DATE" | "BUTTON";

export interface ConfigEntry {
  /** Full path, e.g. "/main/imgsettings/iso". */
  path: string;
  /** Leaf name, e.g. "iso" (what --set-config takes). */
  name: string;
  label: string;
  readonly: boolean;
  type: ConfigType | string;
  current: string;
  choices: string[];
  bottom?: number;
  top?: number;
  step?: number;
}

/**
 * `gphoto2 --list-all-config`: blocks of
 *
 *     /main/imgsettings/iso
 *     Label: ISO Speed
 *     Readonly: 0
 *     Type: RADIO
 *     Current: 100
 *     Choice: 0 Auto
 *     Choice: 1 100
 *     END
 */
export function parseConfigList(out: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  let cur: ConfigEntry | null = null;
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("/")) {
      const path = line.trim();
      cur = { path, name: path.slice(path.lastIndexOf("/") + 1), label: "", readonly: false, type: "", current: "", choices: [] };
      continue;
    }
    if (!cur) continue;
    if (line === "END") {
      entries.push(cur);
      cur = null;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    // Values may legitimately be empty or start with spaces after "Key: ".
    const value = line.slice(colon + 1).replace(/^ /, "");
    switch (field) {
      case "Label":
        cur.label = value;
        break;
      case "Readonly":
        cur.readonly = value.trim() === "1";
        break;
      case "Type":
        cur.type = value.trim();
        break;
      case "Current":
        cur.current = value;
        break;
      case "Choice": {
        const m = /^\s*(\d+)\s?(.*)$/.exec(value);
        if (m) cur.choices.push(m[2]!);
        break;
      }
      case "Bottom":
        cur.bottom = Number(value);
        break;
      case "Top":
        cur.top = Number(value);
        break;
      case "Step":
        cur.step = Number(value);
        break;
    }
  }
  return entries;
}

/** Curated settings, in display order. Several gphoto2 names may mean the same thing. */
const CURATED: { names: string[]; label: string }[] = [
  { names: ["imageformat"], label: "Formato de imagen" },
  { names: ["iso"], label: "ISO" },
  { names: ["aperture", "f-number"], label: "Diafragma" },
  { names: ["shutterspeed"], label: "Velocidad de obturación" },
  { names: ["exposurecompensation"], label: "Compensación de exposición" },
  { names: ["whitebalance"], label: "Balance de blancos" },
  { names: ["colortemperature"], label: "Temperatura de color" },
  { names: ["focusmode"], label: "Modo de foco" },
  { names: ["picturestyle"], label: "Estilo de imagen" },
  { names: ["drivemode"], label: "Modo de disparo" },
];

/** Names setControl accepts as plain value changes. */
export const SETTABLE_NAMES = new Set(CURATED.flatMap((c) => c.names));

/** Live-view magnification steps (Canon "eoszoom"): for checking focus up close. */
export const ZOOM_STEPS: ControlOption[] = [
  { value: "1", label: "Normal" },
  { value: "5", label: "Lupa 5×" },
  { value: "10", label: "Lupa 10×" },
];

/** Every config name the driver reads: the curated settings plus focus, zoom and live view. */
export const READ_NAMES = new Set([...SETTABLE_NAMES, "manualfocusdrive", "autofocusdrive", "eoszoom", "viewfinder"]);

const FOCUS_STEPS: ControlOption[] = [
  { value: "Near 3", label: "◀◀◀ Cerca" },
  { value: "Near 2", label: "◀◀ Cerca" },
  { value: "Near 1", label: "◀ Cerca" },
  { value: "Far 1", label: "Lejos ▶" },
  { value: "Far 2", label: "Lejos ▶▶" },
  { value: "Far 3", label: "Lejos ▶▶▶" },
];

const OPTION_LABELS: Record<string, string> = {
  // White balance
  Auto: "Automático",
  "AWB White": "Automático (blanco)",
  Daylight: "Luz de día",
  Shadow: "Sombra",
  Cloudy: "Nublado",
  Tungsten: "Tungsteno",
  Fluorescent: "Fluorescente",
  Flash: "Flash",
  Manual: "Manual",
  "Color Temperature": "Temperatura de color",
  // Focus mode
  "One Shot": "Un disparo (One Shot)",
  "AI Focus": "AI Focus",
  "AI Servo": "AI Servo",
  // Picture style
  Standard: "Estándar",
  Portrait: "Retrato",
  Landscape: "Paisaje",
  Neutral: "Neutro",
  Faithful: "Fiel",
  Monochrome: "Monocromo",
  "Fine Detail": "Detalle fino",
  // Drive mode
  Single: "Foto a foto",
  "Single Silent": "Foto a foto silencioso",
  Continuous: "Ráfaga",
  "Continuous high speed": "Ráfaga rápida",
  "Continuous low speed": "Ráfaga lenta",
  "Timer 10 sec": "Temporizador 10 s",
  "Timer 2 sec": "Temporizador 2 s",
};

/** Older EOS bodies (e.g. 500D) name JPEG sizes by letter; "c" is normal quality. */
const JPEG_SIZES: Record<string, string> = { L: "grande", M: "mediano", S: "chico" };

function optionLabel(name: string, value: string): string {
  const size = name === "imageformat" ? /^(c?)([LMS])$/.exec(value) : null;
  if (size) return `JPEG ${JPEG_SIZES[size[2]!]}${size[1] ? " (normal)" : " (fina)"}`;
  if ((name === "aperture" || name === "f-number") && /^\d+(\.\d+)?$/.test(value)) return `f/${value}`;
  if (name === "imageformat" && /RAW/i.test(value) && /JPEG|\+/i.test(value)) return `RAW+JPEG (${value})`;
  if (name === "imageformat" && /^[ms]?RAW$/i.test(value)) return `Solo RAW (${value})`;
  if (name === "whitebalance" && value === "Auto") return "Automático";
  if (name === "iso" && value === "Auto") return "Automático";
  return OPTION_LABELS[value] ?? value;
}

/** Maps the curated subset of the camera config to UI controls (Spanish labels). */
export function toCameraControls(entries: ConfigEntry[]): CameraControl[] {
  const byName = new Map<string, ConfigEntry>();
  for (const e of entries) {
    if (e.readonly || byName.has(e.name)) continue;
    byName.set(e.name, e);
  }
  const controls: CameraControl[] = [];
  for (const { names, label } of CURATED) {
    const e = names.map((n) => byName.get(n)).find((x) => x !== undefined);
    if (!e) continue;
    const control = entryToControl(e, label);
    if (control) controls.push(control);
  }
  const focus = byName.get("manualfocusdrive");
  if (focus && (focus.type === "RADIO" || focus.type === "MENU")) {
    const actions = FOCUS_STEPS.filter((s) => focus.choices.includes(s.value));
    if (actions.length) controls.push({ kind: "action", key: "manualfocusdrive", label: "Foco manual", actions });
  }
  const zoom = byName.get("eoszoom");
  if (zoom) {
    const value = ZOOM_STEPS.some((z) => z.value === zoom.current) ? zoom.current : "1";
    controls.push({ kind: "choice", key: "eoszoom", label: "Lupa (para enfocar)", options: ZOOM_STEPS, value });
  }
  if (byName.has("autofocusdrive")) {
    controls.push({
      kind: "action",
      key: "autofocusdrive",
      label: "Enfocar automáticamente",
      actions: [{ value: "1", label: "Enfocar" }],
    });
  }
  return controls;
}

function entryToControl(e: ConfigEntry, label: string): CameraControl | null {
  switch (e.type) {
    case "RADIO":
    case "MENU": {
      const values = [...e.choices];
      if (e.current && !values.includes(e.current)) values.unshift(e.current);
      if (values.length === 0) return null;
      return {
        kind: "choice",
        key: e.name,
        label,
        options: values.map((v) => ({ value: v, label: optionLabel(e.name, v) })),
        value: e.current,
      };
    }
    case "RANGE": {
      const min = e.bottom ?? 0;
      const max = e.top ?? 0;
      const value = Number(e.current);
      if (!(max > min) || !Number.isFinite(value)) return null;
      return { kind: "range", key: e.name, label, min, max, step: e.step && e.step > 0 ? e.step : 1, value };
    }
    case "TOGGLE":
      return { kind: "toggle", key: e.name, label, value: e.current.trim() === "1" };
    default:
      return null;
  }
}

const RAW_MIME: Record<string, string> = {
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  crw: "image/x-canon-crw",
  nef: "image/x-nikon-nef",
  nrw: "image/x-nikon-nrw",
  arw: "image/x-sony-arw",
  srf: "image/x-sony-srf",
  sr2: "image/x-sony-sr2",
  dng: "image/x-adobe-dng",
  raf: "image/x-fuji-raf",
  orf: "image/x-olympus-orf",
  rw2: "image/x-panasonic-rw2",
  pef: "image/x-pentax-pef",
  srw: "image/x-samsung-srw",
  x3f: "image/x-sigma-x3f",
};

/** RAW mime type for a file extension (without dot), or null if it is not a RAW. */
export function rawMimeOf(ext: string): string | null {
  const e = ext.toLowerCase();
  if (e in RAW_MIME) return RAW_MIME[e]!;
  if (["3fr", "erf", "kdc", "mef", "mos", "mrw", "rwl", "iiq"].includes(e)) return "image/x-raw";
  return null;
}

export const MSG_BUSY = "La cámara está tomada por otro programa (en Mac suele ser el sistema). Tocá «Liberar cámara».";
export const MSG_DISCONNECTED = "Se perdió la conexión con la cámara. Revisá el cable USB y que esté prendida.";
export const MSG_NOT_FOUND = "No encuentro la cámara. Revisá el cable USB y que esté prendida.";

/**
 * Turns gphoto2 stderr into a Spanish message and an error code.
 * `wasWorking`: the camera had already answered in this session, so I/O
 * errors most likely mean the cable was pulled or the camera turned off.
 */
export function classifyGphotoError(stderr: string, wasWorking = false): { code: DslrErrorCode; message: string } {
  const text = stderr.replace(/\*{3,}/g, " ");
  if (/Could not claim the USB device|\(-53\b/i.test(text)) return { code: "busy", message: MSG_BUSY };
  if (/Could not detect any camera|No camera found|Could not find the requested device|Unknown port|\(-52\b|\(-105\b|Unknown model/i.test(text)) {
    return { code: "disconnected", message: wasWorking ? MSG_DISCONNECTED : MSG_NOT_FOUND };
  }
  if (wasWorking && /I\/O problem|\(-(7|34|35)\b|LIBUSB_ERROR_(IO|NO_DEVICE|PIPE)|No such device/i.test(text)) {
    return { code: "disconnected", message: MSG_DISCONNECTED };
  }
  if (/Device Busy|\(-110\b/i.test(text)) {
    return { code: "failed", message: "La cámara está ocupada. Esperá un momento y probá de nuevo." };
  }
  if (/no focus|out of focus|could not focus/i.test(text)) {
    return { code: "failed", message: "La cámara no pudo enfocar. Probá con más luz o enfocá a mano." };
  }
  const detail = firstErrorLine(text);
  return { code: "failed", message: detail ? `La cámara no pudo hacerlo (${detail}).` : "La cámara no pudo hacerlo." };
}

function firstErrorLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^For debugging messages/i.test(l));
  const err = lines.find((l) => /error|could not|failed|unable/i.test(l)) ?? "";
  return err.replace(/^\*+\s*|\s*\*+$/g, "").slice(0, 160);
}
