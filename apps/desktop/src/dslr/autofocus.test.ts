import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { type FocusSearchIo, contrastFocus, jpegSharpness, peakOf, sharpness } from "./autofocus";

function checkerboard(size: number, blur: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Smooth the edges more as blur grows.
      const fx = Math.sin((x / 8) * Math.PI);
      const fy = Math.sin((y / 8) * Math.PI);
      const sharp = Math.sign(fx * fy);
      const v = 128 + 100 * (blur === 0 ? sharp : Math.tanh((fx * fy * 4) / blur));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

const ROI = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

describe("sharpness", () => {
  it("is higher for sharper images and ignores brightness scale", () => {
    const sharp = sharpness(checkerboard(64, 0), 64, 64, ROI);
    const soft = sharpness(checkerboard(64, 3), 64, 64, ROI);
    expect(sharp).toBeGreaterThan(soft * 1.5);
  });

  it("works on JPEG data", () => {
    const enc = (blur: number) => new Uint8Array(jpeg.encode({ data: checkerboard(64, blur), width: 64, height: 64 }, 90).data);
    expect(jpegSharpness(enc(0), ROI)).toBeGreaterThan(jpegSharpness(enc(3), ROI));
  });
});

/**
 * A simulated lens: sharpness peaks at `peak`, falls to a texture floor far
 * away, with relative noise, and live-view frames that lag the lens by `lag`.
 */
function lens(start: number, peak: number, lag = 3, noise = 0.015): FocusSearchIo & { moved: number } {
  let pos = start;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const shown: number[] = Array(lag).fill(start);
  return {
    moved: 0,
    max: 400,
    lag,
    position: () => pos,
    async near(n) {
      pos = Math.min(400, pos + n);
      this.moved += n;
    },
    async zero() {
      pos = 0;
    },
    async frame() {
      shown.push(pos);
      const p = shown.shift()!;
      return (0.05 + 1 / (1 + ((p - peak) / 10) ** 2)) * (1 + noise * rand());
    },
  };
}

describe("contrastFocus", () => {
  it.each([
    [0, 160],
    [100, 160],
    [200, 160],
    [300, 61],
    [20, 380],
    [158, 160],
  ])("from %i lands on the peak at %i", async (start, peak) => {
    const io = lens(start, peak);
    const { best } = await contrastFocus(io);
    expect(Math.abs(best - peak)).toBeLessThanOrEqual(2);
    expect(io.position()).toBe(best);
  });

  it("finds the vertex between samples", () => {
    expect(peakOf([[0, 1], [6, 3], [12, 1]], 6)).toBeCloseTo(6);
    expect(peakOf([[0, 2], [6, 3], [12, 1]], 6)).toBeLessThan(6);
  });
});
