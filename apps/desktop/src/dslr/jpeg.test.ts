import { describe, expect, it } from "vitest";
import { MjpegSplitter, extractEmbeddedJpeg, scanJpeg } from "./jpeg";

function segment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

/** A structurally valid JPEG; entropy data has stuffed FF00 bytes and RST markers. */
function fakeJpeg(opts: { seed: number; size?: number; sof?: number; thumbnail?: Buffer }): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")));
  if (opts.thumbnail) parts.push(segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), opts.thumbnail])));
  parts.push(segment(0xdb, Buffer.alloc(65, 1)));
  parts.push(segment(opts.sof ?? 0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])));
  parts.push(segment(0xc4, Buffer.alloc(20, 2)));
  parts.push(segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])));
  const size = opts.size ?? 300;
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31 + opts.seed) & 0xfe; // never 0xFF
  data[10] = 0xff;
  data[11] = 0x00; // stuffed
  data[50] = 0xff;
  data[51] = 0xd3; // restart marker
  data[90] = 0xff;
  data[91] = 0x00;
  parts.push(data, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function splitInto(buf: Buffer, sizes: number[]): Buffer[] {
  const chunks: Buffer[] = [];
  let p = 0;
  let i = 0;
  while (p < buf.length) {
    const n = sizes[i++ % sizes.length]!;
    chunks.push(buf.subarray(p, p + n));
    p += n;
  }
  return chunks;
}

describe("scanJpeg", () => {
  it("finds the outer EOI past an embedded thumbnail", () => {
    const thumb = fakeJpeg({ seed: 7, size: 40 });
    const img = fakeJpeg({ seed: 1, thumbnail: thumb });
    expect(scanJpeg(img)).toEqual({ status: "complete", end: img.length, sof: 0xc0 });
  });

  it("reports incomplete data and garbage", () => {
    const img = fakeJpeg({ seed: 1 });
    expect(scanJpeg(img.subarray(0, img.length - 1)).status).toBe("incomplete");
    expect(scanJpeg(Buffer.from([1, 2, 3])).status).toBe("invalid");
  });
});

describe("MjpegSplitter", () => {
  const frames = [
    fakeJpeg({ seed: 1, thumbnail: fakeJpeg({ seed: 9, size: 50 }) }),
    fakeJpeg({ seed: 2, size: 1000 }),
    fakeJpeg({ seed: 3, thumbnail: fakeJpeg({ seed: 8, size: 30 }) }),
    fakeJpeg({ seed: 4, size: 10 }),
  ];
  const garbage = Buffer.from([0x00, 0xff, 0xd8, 0x12, 0xff, 0x00, 0xd9, 0xff]);
  const stream = Buffer.concat([garbage, ...frames]);

  it.each([[[1]], [[2]], [[3, 7, 1]], [[64]], [[4096]], [[stream.length]], [[13, 1, 200, 2]]])(
    "splits the stream with chunk sizes %j",
    (sizes) => {
      const splitter = new MjpegSplitter();
      const out = splitInto(stream, sizes).flatMap((c) => splitter.push(c));
      expect(out).toEqual(frames);
    },
  );

  it("drops a truncated frame and resyncs on the next one", () => {
    const cut = frames[1]!.subarray(0, 500);
    const splitter = new MjpegSplitter();
    const out = splitter.push(Buffer.concat([frames[0]!, cut, frames[2]!]));
    expect(out).toEqual([frames[0], frames[2]]);
  });

  it("returns copies that do not alias the input", () => {
    const splitter = new MjpegSplitter();
    const input = Buffer.from(frames[3]!);
    const [frame] = splitter.push(input);
    input.fill(0);
    expect(frame).toEqual(frames[3]);
  });
});

describe("extractEmbeddedJpeg", () => {
  it("returns the largest baseline preview, skipping lossless RAW data and thumbnails", () => {
    const small = fakeJpeg({ seed: 5, size: 100 });
    const full = fakeJpeg({ seed: 6, size: 5000, thumbnail: fakeJpeg({ seed: 2, size: 20 }) });
    const lossless = fakeJpeg({ seed: 7, size: 20000, sof: 0xc3 });
    const tiffHeader = Buffer.from("II*\0\x10\0\0\0CR\x02\0", "latin1");
    const raw = Buffer.concat([tiffHeader, Buffer.alloc(100, 0xab), small, Buffer.alloc(33), full, Buffer.alloc(7, 0xff), lossless]);
    expect(extractEmbeddedJpeg(raw)).toEqual(full);
  });

  it("returns null when there is no displayable JPEG", () => {
    expect(extractEmbeddedJpeg(Buffer.alloc(1000, 0x42))).toBeNull();
    expect(extractEmbeddedJpeg(fakeJpeg({ seed: 1, sof: 0xc3 }))).toBeNull();
  });
});
