import type { BlendMode, Effect, Look } from "./model";

interface Size {
  width: number;
  height: number;
}

/** The part of a picture of `size` that is kept, in its pixels. */
export function cropRect(size: Size, look?: Look): { x: number; y: number; width: number; height: number } {
  const c = look?.crop;
  if (!c) return { x: 0, y: 0, width: size.width, height: size.height };
  const x = Math.min(Math.max(c.x, 0), 1);
  const y = Math.min(Math.max(c.y, 0), 1);
  const w = Math.min(Math.max(c.width, 0.01), 1 - x);
  const h = Math.min(Math.max(c.height, 0.01), 1 - y);
  return { x: x * size.width, y: y * size.height, width: w * size.width, height: h * size.height };
}

/**
 * Size the whole picture is drawn at in the film (before its own scale):
 * inside the film, or filling it. A crop only hides part of it, in place.
 */
export function lookBox(size: Size, look: Look | undefined, film: Size): Size {
  const fits = [film.width / size.width, film.height / size.height];
  const s = look?.fit === "cover" ? Math.max(...fits) : Math.min(...fits);
  return { width: size.width * s, height: size.height * s };
}

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  difference: "difference",
};

/** Canvas composite operation for a blend mode. */
export function compositeOf(blend: BlendMode | undefined): GlobalCompositeOperation {
  return COMPOSITE[blend ?? "normal"] ?? "source-over";
}

/** Canvas filter for the effects ("none" when there are none). */
export function effectsFilter(effects: Effect[] | undefined): string {
  const parts: string[] = [];
  for (const e of effects ?? []) {
    if (!e.amount) continue;
    const pct = Math.round(Math.max(0, 1 + e.amount) * 100);
    if (e.kind === "brightness") parts.push(`brightness(${pct}%)`);
    else if (e.kind === "contrast") parts.push(`contrast(${pct}%)`);
    else if (e.kind === "saturation") parts.push(`saturate(${e.amount > 0 ? Math.round(100 + e.amount * 200) : pct}%)`);
  }
  return parts.length ? parts.join(" ") : "none";
}

/** Whether a look changes nothing. */
export function isPlainLook(look: Look | undefined): boolean {
  return (
    !look ||
    (!look.crop && (look.fit ?? "contain") === "contain" && !look.flipX && !look.flipY && (look.blend ?? "normal") === "normal" && !(look.effects ?? []).some((e) => e.amount))
  );
}
