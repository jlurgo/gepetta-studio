import { describe, expect, it } from "vitest";
import { formatDistance, formatExposure, readCaptureInfo } from "./exif";

// --- Synthetic EXIF builder -------------------------------------------------

interface TestEntry {
  tag: number;
  type: number;
  count: number;
  /** Value bytes; a function receives the absolute offset where they will be stored. */
  bytes: number[] | ((at: number) => number[]);
}

function enc(le: boolean) {
  const u16 = (v: number) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => {
    const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    return le ? b.reverse() : b;
  };
  return {
    u16,
    u32,
    ascii: (tag: number, s: string): TestEntry => {
      const bytes = [...s].map((c) => c.charCodeAt(0)).concat(0);
      return { tag, type: 2, count: bytes.length, bytes };
    },
    short: (tag: number, ...vs: number[]): TestEntry => ({
      tag,
      type: 3,
      count: vs.length,
      bytes: vs.flatMap(u16),
    }),
    long: (tag: number, v: number): TestEntry => ({ tag, type: 4, count: 1, bytes: u32(v) }),
    rational: (tag: number, num: number, den: number): TestEntry => ({
      tag,
      type: 5,
      count: 1,
      bytes: [...u32(num), ...u32(den)],
    }),
    /** Serializes an IFD placed at absolute offset `start`, out-of-line data right after it. */
    ifd(entries: TestEntry[], start: number): number[] {
      const head: number[] = [...u16(entries.length)];
      const data: number[] = [];
      const dataStart = start + 2 + entries.length * 12 + 4;
      for (const e of entries) {
        const size = typeof e.bytes === "function" ? e.bytes(0).length : e.bytes.length;
        head.push(...u16(e.tag), ...u16(e.type), ...u32(e.count));
        if (size <= 4) {
          const b = typeof e.bytes === "function" ? e.bytes(0) : e.bytes;
          head.push(...b, ...new Array(4 - b.length).fill(0));
        } else {
          const at = dataStart + data.length;
          head.push(...u32(at));
          data.push(...(typeof e.bytes === "function" ? e.bytes(at) : e.bytes));
          if (data.length % 2) data.push(0);
        }
      }
      head.push(...u32(0));
      return [...head, ...data];
    },
  };
}

type Enc = ReturnType<typeof enc>;

/** TIFF = header + IFD0 + Exif IFD (+ whatever the exif entries embed). */
function buildTiff(le: boolean, ifd0: (e: Enc) => TestEntry[], exif: (e: Enc) => TestEntry[]) {
  const e = enc(le);
  const header = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...e.u16(42), ...e.u32(8)];
  const withPointer = (exifAt: number) => [...ifd0(e), e.long(0x8769, exifAt)];
  const ifd0Size = e.ifd(withPointer(0), 8).length;
  const exifAt = 8 + ifd0Size;
  return [...header, ...e.ifd(withPointer(exifAt), 8), ...e.ifd(exif(e), exifAt)];
}

/** Wraps a TIFF payload in a JPEG with an unrelated APP0 before APP1 Exif. */
function jpegWithExif(tiff: number[]): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...payload];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

/** Canon MakerNote: an IFD whose offsets are relative to the TIFF start. */
function canonMakerNote(e: Enc, upperCm: number, lowerCm: number, lens?: string): TestEntry {
  const fileInfo = new Array(26).fill(0);
  fileInfo[0] = 52;
  fileInfo[0x14] = upperCm;
  fileInfo[0x15] = lowerCm;
  const entries = [e.short(0x0093, ...fileInfo)];
  if (lens) entries.push(e.ascii(0x0095, lens));
  const length = e.ifd(entries, 0).length;
  return { tag: 0x927c, type: 7, count: length, bytes: (at) => e.ifd(entries, at) };
}

function canonPhoto(le: boolean, upperCm = 27, lowerCm = 25, withExifLens = false) {
  return jpegWithExif(
    buildTiff(
      le,
      (e) => [e.ascii(0x010f, "Canon"), e.ascii(0x0110, "Canon EOS REBEL T1i")],
      (e) => [
        e.rational(0x829a, 1, 13),
        e.rational(0x829d, 71, 10),
        e.short(0x8827, 1600),
        e.ascii(0x9003, "2025:10:22 12:06:27"),
        e.rational(0x920a, 34, 1),
        canonMakerNote(e, upperCm, lowerCm, "EF-S18-55mm f/3.5-5.6 IS"),
        e.short(0xa403, 1),
        ...(withExifLens ? [e.ascii(0xa434, "EF-S18-55mm (exif)")] : []),
      ],
    ),
  );
}

// --- Tests ------------------------------------------------------------------

describe("readCaptureInfo", () => {
  for (const le of [true, false]) {
    it(`reads a Canon capture (${le ? "II" : "MM"} byte order)`, () => {
      expect(readCaptureInfo(canonPhoto(le))).toEqual({
        make: "Canon",
        model: "Canon EOS REBEL T1i",
        lens: "EF-S18-55mm f/3.5-5.6 IS",
        exposureTime: 1 / 13,
        aperture: 7.1,
        iso: 1600,
        focalLength: 34,
        takenAt: "2025-10-22T12:06:27",
        whiteBalance: "Manual",
        focusDistance: { near: 0.25, far: 0.27 },
      });
    });
  }

  it("prefers the EXIF LensModel over the Canon one", () => {
    expect(readCaptureInfo(canonPhoto(true, 27, 25, true)).lens).toBe("EF-S18-55mm (exif)");
  });

  it("maps 0xffff to infinity and skips unknown (0) distances", () => {
    expect(readCaptureInfo(canonPhoto(false, 0xffff, 150)).focusDistance).toEqual({
      near: 1.5,
      far: Infinity,
    });
    expect(readCaptureInfo(canonPhoto(true, 0, 0)).focusDistance).toBeUndefined();
  });

  it("falls back to SubjectDistance without a Canon MakerNote", () => {
    const jpeg = jpegWithExif(
      buildTiff(
        false,
        (e) => [e.ascii(0x010f, "NIKON")],
        (e) => [e.rational(0x9206, 3, 2), e.short(0xa403, 0)],
      ),
    );
    expect(readCaptureInfo(jpeg)).toEqual({
      make: "NIKON",
      whiteBalance: "Auto",
      focusDistance: { near: 1.5, far: 1.5 },
    });
  });

  it("returns {} for input without EXIF", () => {
    expect(readCaptureInfo(new Uint8Array())).toEqual({});
    expect(readCaptureInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({});
    expect(readCaptureInfo(new TextEncoder().encode("not a jpeg at all"))).toEqual({});
  });

  it("never throws on truncated or corrupted input", () => {
    const good = canonPhoto(true);
    for (let n = 0; n < good.length; n++) {
      expect(() => readCaptureInfo(good.subarray(0, n))).not.toThrow();
    }
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 500; i++) {
      const bad = good.slice();
      for (let k = 0; k < 8; k++) bad[Math.floor(rand() * bad.length)] = Math.floor(rand() * 256);
      expect(() => readCaptureInfo(bad)).not.toThrow();
    }
  });

  it("returns {} when the EXIF segment is cut short", () => {
    const good = canonPhoto(false);
    expect(readCaptureInfo(good.subarray(0, 30))).toEqual({});
  });
});

describe("formatExposure", () => {
  it("formats fractions and seconds", () => {
    expect(formatExposure(1 / 13)).toBe("1/13");
    expect(formatExposure(1 / 250)).toBe("1/250");
    expect(formatExposure(0.5)).toBe("0.5 s");
    expect(formatExposure(2)).toBe("2 s");
    expect(formatExposure(30)).toBe("30 s");
  });
});

describe("formatDistance", () => {
  it("uses cm below a meter and a decimal comma above", () => {
    expect(formatDistance(0.27)).toBe("27 cm");
    expect(formatDistance(1.5)).toBe("1,5 m");
    expect(formatDistance(2)).toBe("2 m");
    expect(formatDistance(Infinity)).toBe("∞");
  });
});
