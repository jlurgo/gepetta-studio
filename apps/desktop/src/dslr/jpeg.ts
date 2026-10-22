/**
 * JPEG stream helpers. Instead of hunting for the first FFD9 (which also ends
 * an EXIF thumbnail), we walk the marker segments: segment lengths skip over
 * anything embedded in APPn blocks, and entropy-coded data cannot contain a
 * bare FFxx marker (0xFF is stuffed as FF00), so the EOI we find is the outer one.
 */

export type JpegScan =
  | { status: "complete"; end: number; /** SOF marker (0xC0..0xCF), -1 if none was seen. */ sof: number }
  | { status: "incomplete" }
  | { status: "invalid" };

const SOI = Buffer.from([0xff, 0xd8, 0xff]);

/** Where the next JPEG start (FFD8FF) is at or after `from`, or -1. */
export function findSoi(buf: Buffer, from = 0): number {
  return buf.indexOf(SOI, from);
}

/** Walks the JPEG that starts at `start` (an FFD8) to its EOI. */
export function scanJpeg(buf: Buffer, start = 0): JpegScan {
  if (buf.length - start < 2) return { status: "incomplete" };
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8) return { status: "invalid" };
  let p = start + 2;
  let sof = -1;
  for (;;) {
    if (p + 1 >= buf.length) return { status: "incomplete" };
    if (buf[p] !== 0xff) return { status: "invalid" };
    // Any number of 0xFF fill bytes may precede a marker.
    while (p + 1 < buf.length && buf[p + 1] === 0xff) p++;
    if (p + 1 >= buf.length) return { status: "incomplete" };
    const m = buf[p + 1]!;
    if (m === 0xd9) return { status: "complete", end: p + 2, sof };
    // A new SOI (or a stuffed byte) where a marker should be: truncated frame.
    if (m === 0xd8 || m === 0x00) return { status: "invalid" };
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      p += 2;
      continue;
    }
    if (p + 3 >= buf.length) return { status: "incomplete" };
    const len = buf.readUInt16BE(p + 2);
    if (len < 2) return { status: "invalid" };
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && sof < 0) sof = m;
    p += 2 + len;
    if (m !== 0xda) continue;
    // Start of scan: skip entropy-coded data up to the next real marker.
    for (;;) {
      p = buf.indexOf(0xff, p);
      if (p < 0 || p + 1 >= buf.length) return { status: "incomplete" };
      const n = buf[p + 1]!;
      if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) p += 2;
      else if (n === 0xff) p += 1;
      else break;
    }
  }
}

/**
 * Splits a stream of concatenated JPEGs (gphoto2 --capture-movie --stdout)
 * into frames, whatever the chunk boundaries. Junk between frames is skipped;
 * a broken frame is dropped and the splitter resyncs on the next SOI.
 */
export class MjpegSplitter {
  private buf: Buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameBytes = 32 * 1024 * 1024) {}

  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames: Buffer[] = [];
    for (;;) {
      const soi = findSoi(this.buf);
      if (soi < 0) {
        // Keep a possible partial "FF D8" at the end for the next chunk.
        this.buf = Buffer.from(this.buf.subarray(Math.max(0, this.buf.length - 2)));
        break;
      }
      if (soi > 0) this.buf = this.buf.subarray(soi);
      const scan = scanJpeg(this.buf);
      if (scan.status === "complete") {
        frames.push(Buffer.from(this.buf.subarray(0, scan.end)));
        this.buf = this.buf.subarray(scan.end);
      } else if (scan.status === "invalid") {
        this.buf = this.buf.subarray(1);
      } else {
        if (this.buf.length > this.maxFrameBytes) this.buf = this.buf.subarray(1);
        else break;
      }
    }
    return frames;
  }
}

/**
 * The largest displayable JPEG embedded in a RAW file (Canon CR2/CR3, NEF, ARW
 * and DNG all carry a full or large preview). Lossless JPEG (SOF3, the RAW data
 * itself in CR2/DNG) is skipped since browsers cannot show it.
 */
export function extractEmbeddedJpeg(buf: Buffer): Buffer | null {
  let best: { start: number; end: number } | null = null;
  let from = 0;
  for (;;) {
    const start = findSoi(buf, from);
    if (start < 0) break;
    const scan = scanJpeg(buf, start);
    if (scan.status === "complete") {
      if ((scan.sof === 0xc0 || scan.sof === 0xc1 || scan.sof === 0xc2) && (!best || scan.end - start > best.end - best.start)) {
        best = { start, end: scan.end };
      }
      // Thumbnails inside this JPEG are smaller by definition: jump past it.
      from = scan.end;
    } else {
      from = start + 1;
    }
  }
  return best ? Buffer.from(buf.subarray(best.start, best.end)) : null;
}
