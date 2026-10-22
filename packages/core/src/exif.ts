/**
 * Minimal, dependency-free EXIF reader for JPEG captures. Only extracts the
 * handful of fields the studio shows next to a frame (camera, lens, exposure,
 * focus distance). Every read is bounds-checked: malformed input yields
 * partial or empty results, never an exception.
 */

export interface CaptureInfo {
  make?: string;
  model?: string;
  lens?: string;
  /** Millimeters. */
  focalLength?: number;
  /** f-number, e.g. 7.1. */
  aperture?: number;
  /** Seconds. */
  exposureTime?: number;
  iso?: number;
  /** "Auto" | "Manual" (EXIF WhiteBalance tag). */
  whiteBalance?: string;
  /** Local time from DateTimeOriginal, "YYYY-MM-DDTHH:MM:SS" (no timezone). */
  takenAt?: string;
  /** Focus distance range in meters reported by the camera; Infinity allowed. */
  focusDistance?: { near: number; far: number };
}

const MAX_IFD_ENTRIES = 512;
const MAX_JPEG_SEGMENTS = 256;

const TAG = {
  make: 0x010f,
  model: 0x0110,
  exifIfd: 0x8769,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  subjectDistance: 0x9206,
  focalLength: 0x920a,
  makerNote: 0x927c,
  whiteBalance: 0xa403,
  lensModel: 0xa434,
  canonFileInfo: 0x0093,
  canonLensModel: 0x0095,
} as const;

/** Byte size of one component for each TIFF field type. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

interface Entry {
  type: number;
  count: number;
  /** Absolute offset (in the TIFF view) of the value bytes. */
  valueOffset: number;
  /** The raw 4-byte value/offset field, for types that store an offset. */
  rawOffset: number;
}

class Tiff {
  constructor(
    readonly view: DataView,
    readonly little: boolean,
  ) {}

  inRange(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset + length <= this.view.byteLength;
  }

  u16(offset: number): number | undefined {
    return this.inRange(offset, 2) ? this.view.getUint16(offset, this.little) : undefined;
  }

  u32(offset: number): number | undefined {
    return this.inRange(offset, 4) ? this.view.getUint32(offset, this.little) : undefined;
  }

  /** Reads the IFD at `offset` into a tag → entry map. */
  ifd(offset: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    const n = this.u16(offset);
    if (n === undefined) return entries;
    const count = Math.min(n, MAX_IFD_ENTRIES);
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      if (!this.inRange(at, 12)) break;
      const tag = this.view.getUint16(at, this.little);
      const type = this.view.getUint16(at + 2, this.little);
      const num = this.view.getUint32(at + 4, this.little);
      const rawOffset = this.view.getUint32(at + 8, this.little);
      const size = TYPE_SIZE[type];
      if (size === undefined) continue;
      const valueOffset = size * num <= 4 ? at + 8 : rawOffset;
      if (!entries.has(tag)) entries.set(tag, { type, count: num, valueOffset, rawOffset });
    }
    return entries;
  }

  ascii(e: Entry | undefined): string | undefined {
    if (!e || (e.type !== 2 && e.type !== 7 && e.type !== 1)) return undefined;
    if (!this.inRange(e.valueOffset, e.count)) return undefined;
    let s = "";
    for (let i = 0; i < e.count; i++) {
      const c = this.view.getUint8(e.valueOffset + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    s = s.trim();
    return s || undefined;
  }

  /** First numeric component of an entry (SHORT, LONG or RATIONAL family). */
  number(e: Entry | undefined): number | undefined {
    if (!e || e.count < 1) return undefined;
    const o = e.valueOffset;
    switch (e.type) {
      case 1:
        return this.inRange(o, 1) ? this.view.getUint8(o) : undefined;
      case 3:
        return this.u16(o);
      case 8:
        return this.inRange(o, 2) ? this.view.getInt16(o, this.little) : undefined;
      case 4:
        return this.u32(o);
      case 9:
        return this.inRange(o, 4) ? this.view.getInt32(o, this.little) : undefined;
      case 5:
      case 10: {
        if (!this.inRange(o, 8)) return undefined;
        const signed = e.type === 10;
        const num = signed ? this.view.getInt32(o, this.little) : this.view.getUint32(o, this.little);
        const den = signed
          ? this.view.getInt32(o + 4, this.little)
          : this.view.getUint32(o + 4, this.little);
        if (den === 0) return num === 0 ? undefined : Infinity;
        return num / den;
      }
      default:
        return undefined;
    }
  }

  /** The `index`-th SHORT of an int16u array entry. */
  u16At(e: Entry | undefined, index: number): number | undefined {
    if (!e || e.type !== 3 || index >= e.count) return undefined;
    return this.u16(e.valueOffset + index * 2);
  }
}

/** Finds the TIFF payload of the APP1 "Exif\0\0" segment. */
function findExifTiff(jpeg: Uint8Array): Uint8Array | undefined {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return undefined;
  let pos = 2;
  for (let seg = 0; seg < MAX_JPEG_SEGMENTS && pos + 4 <= jpeg.length; seg++) {
    if (jpeg[pos] !== 0xff) return undefined;
    const marker = jpeg[pos + 1]!;
    if (marker === 0xff) {
      pos++; // fill byte
      continue;
    }
    // Start of scan / end of image: no more metadata segments.
    if (marker === 0xda || marker === 0xd9) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const len = (jpeg[pos + 2]! << 8) | jpeg[pos + 3]!;
    if (len < 2) return undefined;
    const start = pos + 4;
    const end = pos + 2 + len;
    if (end > jpeg.length) return undefined;
    if (
      marker === 0xe1 &&
      end - start >= 6 &&
      jpeg[start] === 0x45 && // E
      jpeg[start + 1] === 0x78 && // x
      jpeg[start + 2] === 0x69 && // i
      jpeg[start + 3] === 0x66 && // f
      jpeg[start + 4] === 0 &&
      jpeg[start + 5] === 0
    ) {
      return jpeg.subarray(start + 6, end);
    }
    pos = end;
  }
  return undefined;
}

function openTiff(bytes: Uint8Array): { tiff: Tiff; ifd0: number } | undefined {
  if (bytes.length < 8) return undefined;
  let little: boolean;
  if (bytes[0] === 0x49 && bytes[1] === 0x49) little = true;
  else if (bytes[0] === 0x4d && bytes[1] === 0x4d) little = false;
  else return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tiff = new Tiff(view, little);
  if (tiff.u16(2) !== 42) return undefined;
  const ifd0 = tiff.u32(4);
  if (ifd0 === undefined) return undefined;
  return { tiff, ifd0 };
}

/** "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS". */
function exifDateToIso(s: string | undefined): string | undefined {
  const m = s && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  if (m[1] === "0000") return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function positive(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Canon FileInfo focus distance (cm): 0 = unknown, 0xffff = infinity. */
function canonDistance(raw: number | undefined): number | undefined {
  if (raw === undefined || raw === 0) return undefined;
  if (raw === 0xffff) return Infinity;
  return raw / 100;
}

function readCanonMakerNote(tiff: Tiff, entry: Entry, info: CaptureInfo): void {
  const notes = tiff.ifd(entry.rawOffset);
  if (!info.lens) info.lens = tiff.ascii(notes.get(TAG.canonLensModel));
  const fileInfo = notes.get(TAG.canonFileInfo);
  const far = canonDistance(tiff.u16At(fileInfo, 0x14));
  const near = canonDistance(tiff.u16At(fileInfo, 0x15));
  if (far !== undefined || near !== undefined) {
    info.focusDistance = { near: near ?? far!, far: far ?? near! };
  }
}

/** Extracts capture metadata from a JPEG. Never throws; `{}` when there is no EXIF. */
export function readCaptureInfo(jpeg: Uint8Array): CaptureInfo {
  const info: CaptureInfo = {};
  try {
    const bytes = findExifTiff(jpeg);
    if (!bytes) return info;
    const opened = openTiff(bytes);
    if (!opened) return info;
    const { tiff, ifd0 } = opened;

    const main = tiff.ifd(ifd0);
    info.make = tiff.ascii(main.get(TAG.make));
    info.model = tiff.ascii(main.get(TAG.model));

    const exifOffset = tiff.number(main.get(TAG.exifIfd));
    if (exifOffset !== undefined && exifOffset !== ifd0) {
      const exif = tiff.ifd(exifOffset);
      info.exposureTime = positive(tiff.number(exif.get(TAG.exposureTime)));
      info.aperture = positive(tiff.number(exif.get(TAG.fNumber)));
      info.iso = positive(tiff.number(exif.get(TAG.iso)));
      info.focalLength = positive(tiff.number(exif.get(TAG.focalLength)));
      info.takenAt = exifDateToIso(tiff.ascii(exif.get(TAG.dateTimeOriginal)));
      info.lens = tiff.ascii(exif.get(TAG.lensModel));

      const wb = tiff.number(exif.get(TAG.whiteBalance));
      if (wb === 0) info.whiteBalance = "Auto";
      else if (wb === 1) info.whiteBalance = "Manual";

      const makerNote = exif.get(TAG.makerNote);
      if (makerNote && info.make?.startsWith("Canon")) {
        readCanonMakerNote(tiff, makerNote, info);
      }

      if (!info.focusDistance) {
        const d = tiff.number(exif.get(TAG.subjectDistance));
        if (d !== undefined && d > 0) info.focusDistance = { near: d, far: d };
      }
    }
  } catch {
    // Defensive: bounds checks should make this unreachable.
  }
  for (const key of Object.keys(info) as (keyof CaptureInfo)[]) {
    if (info[key] === undefined) delete info[key];
  }
  return info;
}

/** 1/13 → "1/13", 0.5 → "0.5 s", 2 → "2 s". */
export function formatExposure(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return "";
  if (seconds < 0.4) {
    const den = Math.round(1 / seconds);
    if (Math.abs(1 / den - seconds) / seconds < 0.05) return `1/${den}`;
  }
  return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))} s`;
}

/** Spanish style: 0.27 → "27 cm", 1.5 → "1,5 m", Infinity → "∞". */
export function formatDistance(m: number): string {
  if (m === Infinity) return "∞";
  if (!Number.isFinite(m) || m < 0) return "";
  if (m < 1) return `${Math.round(m * 100)} cm`;
  const rounded = Number(m.toFixed(m < 10 ? 2 : 1));
  return `${String(rounded).replace(".", ",")} m`;
}
