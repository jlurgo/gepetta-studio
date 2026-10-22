/** Region of an image, normalized 0..1. */
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Tenengrad sharpness (mean squared Sobel gradient) of an RGBA image's ROI,
 * divided by the squared mean brightness so exposure changes do not read as focus.
 * Only meaningful compared with itself (same spot, same scene).
 */
export function sharpness(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, roi: Roi): number {
  const x0 = Math.max(1, Math.floor(roi.x * width));
  const y0 = Math.max(1, Math.floor(roi.y * height));
  const x1 = Math.min(width - 1, Math.ceil((roi.x + roi.w) * width));
  const y1 = Math.min(height - 1, Math.ceil((roi.y + roi.h) * height));
  if (x1 - x0 < 3 || y1 - y0 < 3) return 0;
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
  };
  let sum = 0;
  let mean = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = luma(x - 1, y - 1), b = luma(x, y - 1), c = luma(x + 1, y - 1);
      const d = luma(x - 1, y), f = luma(x + 1, y);
      const g = luma(x - 1, y + 1), h = luma(x, y + 1), k = luma(x + 1, y + 1);
      const gx = c + 2 * f + k - a - 2 * d - g;
      const gy = g + 2 * h + k - a - 2 * b - c;
      sum += gx * gx + gy * gy;
      mean += luma(x, y);
      n++;
    }
  }
  mean /= n;
  return sum / n / (mean * mean + 1);
}
