/** Frame sizes a film can have (pictures fit inside the frame, whatever its shape). */
export const FORMATS = [
  { id: "1920x1080", label: "Horizontal Full HD (16:9)", width: 1920, height: 1080 },
  { id: "3840x2160", label: "Horizontal 4K (16:9)", width: 3840, height: 2160 },
  { id: "1620x1080", label: "Réflex (3:2)", width: 1620, height: 1080 },
  { id: "1440x1080", label: "Clásico (4:3)", width: 1440, height: 1080 },
  { id: "1080x1080", label: "Cuadrado (1:1)", width: 1080, height: 1080 },
  { id: "1080x1920", label: "Vertical (9:16)", width: 1080, height: 1920 },
];

/** A frame with a picture's shape: 1080 on its short side (even sizes, as video needs). */
export function formatOf(width: number, height: number): { width: number; height: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return width >= height ? { width: even((1080 * width) / height), height: 1080 } : { width: 1080, height: even((1080 * height) / width) };
}

/** "16:9", "3:2"… for a size (or the ratio with two decimals). */
export function ratioLabel(width: number, height: number): string {
  const known: [number, number][] = [[16, 9], [3, 2], [4, 3], [1, 1], [9, 16], [2, 3], [3, 4], [5, 4], [21, 9]];
  const r = width / height;
  const k = known.find(([a, b]) => Math.abs(a / b - r) < 0.01);
  return k ? `${k[0]}:${k[1]}` : `${r.toFixed(2)}:1`;
}
