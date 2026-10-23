/**
 * Paint-bucket fill: the area connected to a pixel whose color is close to
 * it, on RGBA pixels (as canvas `getImageData` gives them).
 */

/**
 * Pixels to fill (1) from (x, y), with `tolerance` 0–255 as the largest
 * difference in any channel. On a see-through pixel only the transparency
 * counts, so an empty drawing fills up to its lines whatever color is hidden
 * behind clear pixels. The area grows one pixel so the soft edges of lines are
 * covered too.
 */
export function fillMask(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, tolerance: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return mask;
  const i0 = (y * width + x) * 4;
  const r0 = data[i0]!;
  const g0 = data[i0 + 1]!;
  const b0 = data[i0 + 2]!;
  const a0 = data[i0 + 3]!;
  const clear = a0 === 0;
  const near = (p: number): boolean => {
    const j = p * 4;
    if (Math.abs(data[j + 3]! - a0) > tolerance) return false;
    if (clear) return true;
    return Math.abs(data[j]! - r0) <= tolerance && Math.abs(data[j + 1]! - g0) <= tolerance && Math.abs(data[j + 2]! - b0) <= tolerance;
  };

  // Scanline flood fill: whole runs of a row at a time.
  const stack = [y * width + x];
  while (stack.length) {
    const p = stack.pop()!;
    if (mask[p]) continue;
    const row = Math.floor(p / width);
    let left = p;
    while (left % width > 0 && !mask[left - 1] && near(left - 1)) left--;
    let right = p;
    while ((right + 1) % width > 0 && !mask[right + 1] && near(right + 1)) right++;
    for (let q = left; q <= right; q++) {
      mask[q] = 1;
      if (row > 0 && !mask[q - width] && near(q - width)) stack.push(q - width);
      if (row < height - 1 && !mask[q + width] && near(q + width)) stack.push(q + width);
    }
  }

  // Grow by one pixel (marked 2 so the growth does not spread further).
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== 1) continue;
    const col = p % width;
    if (col > 0 && !mask[p - 1]) mask[p - 1] = 2;
    if (col < width - 1 && !mask[p + 1]) mask[p + 1] = 2;
    if (p >= width && !mask[p - width]) mask[p - width] = 2;
    if (p + width < mask.length && !mask[p + width]) mask[p + width] = 2;
  }
  return mask;
}
