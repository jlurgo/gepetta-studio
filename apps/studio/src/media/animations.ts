/**
 * Effect animations that come with the app (rain, snow, sparkles, an
 * explosion…): drawn here, frame by frame, on a see-through background, to
 * go on a track of their own over the film.
 */

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface EffectAnimation {
  id: string;
  name: string;
  /** How long it lasts, in seconds. */
  seconds: number;
  /** It can be repeated one after another without a jump (rain, snow…). */
  loop: boolean;
  /** Draws the frame at `t` (0 to 1, not including 1) on a w×h see-through picture. */
  draw(ctx: Ctx, w: number, h: number, t: number): void;
}

/** The same random numbers every time (so every frame sees the same drops). */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const wrap = (v: number) => v - Math.floor(v);

/** Things falling (or rising) the whole height a whole number of times, so it loops. */
function particles(seed: number, count: number) {
  const r = random(seed);
  return Array.from({ length: count }, () => ({ x: r(), y: r(), size: r(), laps: 1 + Math.floor(r() * 3), phase: r(), hue: r() }));
}

const RAIN = particles(1, 160);
const SNOW = particles(2, 140);
const CONFETTI = particles(3, 120);
const BUBBLES = particles(4, 40);
const SPARKLES = particles(5, 50);
const HEARTS = particles(6, 24);
const BURST = particles(7, 70);
const SMOKE = particles(8, 14);

function star(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const d = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.35, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s, y - s * 0.35, x, y + s * 0.35);
  ctx.fill();
}

export const ANIMATIONS: EffectAnimation[] = [
  {
    id: "lluvia",
    name: "Lluvia",
    seconds: 1,
    loop: true,
    draw(ctx, w, h, t) {
      const u = Math.max(w, h) / 1000;
      ctx.strokeStyle = "rgba(190, 215, 255, 0.75)";
      ctx.lineCap = "round";
      for (const p of RAIN) {
        const len = (25 + p.size * 35) * u;
        const y = wrap(p.y + t * (p.laps + 1)) * (h + len) - len;
        const x = wrap(p.x + 0.08 * (y / h)) * w;
        ctx.lineWidth = (1 + p.size * 1.5) * u;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.15, y + len);
        ctx.stroke();
      }
    },
  },
  {
    id: "nieve",
    name: "Nieve",
    seconds: 4,
    loop: true,
    draw(ctx, w, h, t) {
      const u = Math.max(w, h) / 1000;
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      for (const p of SNOW) {
        const r = (2 + p.size * 5) * u;
        const y = wrap(p.y + t * p.laps) * (h + 2 * r) - r;
        const x = p.x * w + Math.sin((t * p.laps + p.phase) * TAU * 2) * 18 * u;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    },
  },
  {
    id: "confeti",
    name: "Confeti",
    seconds: 3,
    loop: true,
    draw(ctx, w, h, t) {
      const u = Math.max(w, h) / 1000;
      for (const p of CONFETTI) {
        const s = (8 + p.size * 8) * u;
        const y = wrap(p.y + t * p.laps) * (h + 2 * s) - s;
        const x = p.x * w + Math.sin((t * p.laps + p.phase) * TAU) * 30 * u;
        const spin = (t * p.laps * 2 + p.phase) * TAU;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(spin);
        ctx.scale(1, Math.cos(spin * 1.5));
        ctx.fillStyle = `hsl(${Math.round(p.hue * 360)} 85% 60%)`;
        ctx.fillRect(-s / 2, -s / 4, s, s / 2);
        ctx.restore();
      }
    },
  },
  {
    id: "burbujas",
    name: "Burbujas",
    seconds: 4,
    loop: true,
    draw(ctx, w, h, t) {
      const u = Math.max(w, h) / 1000;
      for (const p of BUBBLES) {
        const r = (12 + p.size * 30) * u;
        const y = h + r - wrap(p.y + t * p.laps) * (h + 2 * r);
        const x = p.x * w + Math.sin((t * p.laps + p.phase) * TAU) * 20 * u;
        ctx.fillStyle = "rgba(180, 225, 255, 0.18)";
        ctx.strokeStyle = "rgba(220, 245, 255, 0.8)";
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.18, 0, TAU);
        ctx.fill();
      }
    },
  },
  {
    id: "brillos",
    name: "Brillitos",
    seconds: 2,
    loop: true,
    draw(ctx, w, h, t) {
      const u = Math.max(w, h) / 1000;
      for (const p of SPARKLES) {
        const k = Math.max(0, Math.sin((t * p.laps + p.phase) * TAU));
        if (k <= 0.02) continue;
        ctx.fillStyle = `hsla(${45 + Math.round(p.hue * 20)} 100% ${70 + 25 * k}% / ${k})`;
        star(ctx, p.x * w, p.y * h, (8 + p.size * 22) * u * k);
      }
    },
  },
  {
    id: "corazones",
    name: "Corazones",
    seconds: 4,
    loop: true,
    draw(ctx, w, h, t) {
      const u = Math.max(w, h) / 1000;
      for (const p of HEARTS) {
        const s = (20 + p.size * 30) * u;
        const y = h + s - wrap(p.y + t * p.laps) * (h + 2 * s);
        const x = p.x * w + Math.sin((t * p.laps + p.phase) * TAU) * 25 * u;
        ctx.fillStyle = `hsla(${340 + Math.round(p.hue * 25)} 85% 62% / 0.9)`;
        heart(ctx, x, y, s);
      }
    },
  },
  {
    id: "explosion",
    name: "Explosión",
    seconds: 1,
    loop: false,
    draw(ctx, w, h, t) {
      const u = Math.min(w, h) / 1000;
      const cx = w / 2;
      const cy = h / 2;
      const ease = 1 - (1 - t) ** 3;
      // The flash, quick.
      if (t < 0.35) {
        const k = 1 - t / 0.35;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 380 * u * (0.4 + ease));
        g.addColorStop(0, `rgba(255, 255, 220, ${k})`);
        g.addColorStop(0.4, `rgba(255, 190, 60, ${0.9 * k})`);
        g.addColorStop(1, "rgba(255, 90, 20, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // The ring.
      ctx.strokeStyle = `rgba(255, 220, 150, ${Math.max(0, 0.8 - t)})`;
      ctx.lineWidth = 18 * u * (1 - t);
      ctx.beginPath();
      ctx.arc(cx, cy, 450 * u * ease, 0, TAU);
      ctx.stroke();
      // Bits flying out.
      for (const p of BURST) {
        const a = p.phase * TAU;
        const d = (150 + p.size * 400) * u * ease;
        const r = (6 + p.size * 10) * u * (1 - t);
        ctx.fillStyle = `hsla(${20 + Math.round(p.hue * 35)} 100% ${55 + 30 * (1 - t)}% / ${1 - t})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d + 120 * u * t * t, r, 0, TAU);
        ctx.fill();
      }
    },
  },
  {
    id: "humo",
    name: "Humo",
    seconds: 2,
    loop: false,
    draw(ctx, w, h, t) {
      const u = Math.min(w, h) / 1000;
      for (const p of SMOKE) {
        const start = p.phase * 0.4;
        const k = (t - start) / (1 - start);
        if (k <= 0) continue;
        const r = (60 + p.size * 90) * u * (0.4 + k);
        const x = w / 2 + (p.x - 0.5) * 260 * u * (0.5 + k);
        const y = h * 0.62 - k * (250 + p.y * 250) * u;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const a = 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.1)) * (1 - k * 0.6);
        g.addColorStop(0, `rgba(200, 200, 205, ${a})`);
        g.addColorStop(1, "rgba(200, 200, 205, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    },
  },
];

/** What is dragged from the collection to the timeline: the animation's id. */
export const ANIMATION_DRAG = "application/x-gepetta-animation";

/** How many frames it has at `fps`. */
export function frameCount(anim: EffectAnimation, fps: number): number {
  return Math.max(1, Math.round(anim.seconds * fps));
}

/** Its frames at `fps`, as pictures of w×h with a see-through background. */
export async function renderFrames(anim: EffectAnimation, w: number, h: number, fps: number, progress?: (done: number) => void): Promise<Blob[]> {
  const n = frameCount(anim, fps);
  const out: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const canvas = new OffscreenCanvas(w, h);
    anim.draw(canvas.getContext("2d")!, w, h, i / n);
    out.push(await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }));
    progress?.(i + 1);
  }
  return out;
}
