import { type Clip, type Point, type Stroke, clipAt, composeTransforms } from "@gepetta/core";
import { pictureMatrix } from "../render/frame";
import { useEditor } from "./editor";
import { type SculptMode, currentSettings, usePaint } from "./paint";
import { updateStrokes, useStrokePreview } from "./strokes";

/**
 * The sculpt tool (after Blender's Grease Pencil sculpt mode): a round brush
 * that reshapes the line strokes of the picture at the cursor — pushing them,
 * smoothing them, or making them thicker or thinner, more in the middle of the
 * brush. A whole drag is one history step. Fill and clone strokes (pixels) are
 * left alone.
 */

type Pt = [number, number, number, number];

interface Session {
  clip: Clip;
  mode: SculptMode;
  /** Film coordinates → the picture's pixels, and picture pixels per film pixel. */
  toPicture: DOMMatrix;
  scale: number;
  radius: number;
  strength: number;
  start: Point;
  base: Stroke[];
  current: Stroke[];
  /** Push: how much each point follows the pointer (captured when the drag starts). */
  weights: Map<string, number[]>;
}

let session: Session | null = null;

/** Brush falloff: 1 in the middle, 0 at the edge, smooth in between. */
function falloff(d: number, r: number): number {
  if (d >= r) return 0;
  const t = 1 - (d / r) ** 2;
  return t * t;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Starts sculpting at a film point; false when there is nothing to sculpt there. */
export function beginSculpt(p: Point): boolean {
  const { film, cursor } = useEditor.getState();
  if (!film) return false;
  const clip = clipAt(film, cursor.track, cursor.cell);
  const track = film.tracks.find((t) => t.id === cursor.track);
  if (!clip?.strokes?.some((s) => s.points?.length) || !track) return false;
  const m = pictureMatrix({ media: clip.media, transform: composeTransforms(track.transform, clip.transform), look: clip.look }, film.settings, clip.media);
  const toPicture = m.inverse();
  const scale = Math.sqrt(Math.abs(toPicture.a * toPicture.d - toPicture.b * toPicture.c));
  const { size, strength } = currentSettings();
  const q = toPicture.transformPoint(new DOMPoint(p.x, p.y));
  const radius = (size / 2) * scale;
  const weights = new Map<string, number[]>();
  for (const s of clip.strokes) {
    if (!s.points || s.hidden) continue;
    weights.set(
      s.id,
      s.points.map(([x, y]) => falloff(Math.hypot(x - q.x, y - q.y), radius)),
    );
  }
  session = { clip, mode: usePaint.getState().sculpt, toPicture, scale, radius, strength, start: { x: q.x, y: q.y }, base: clip.strokes, current: clip.strokes, weights };
  moveSculpt(p);
  return true;
}

export function moveSculpt(p: Point) {
  const s = session;
  if (!s) return;
  const q = s.toPicture.transformPoint(new DOMPoint(p.x, p.y));
  const { radius: r, strength } = s;
  if (s.mode === "push") {
    const dx = q.x - s.start.x;
    const dy = q.y - s.start.y;
    s.current = s.base.map((st) => {
      const w = s.weights.get(st.id);
      if (!w || !w.some((v) => v > 0)) return st;
      return { ...st, points: st.points!.map(([x, y, pw, pp], i): Pt => [round(x + dx * w[i]!), round(y + dy * w[i]!), pw, pp]) };
    });
  } else {
    s.current = s.current.map((st) => {
      if (!st.points || st.hidden) return st;
      const pts = st.points;
      const near = pts.map(([x, y]) => falloff(Math.hypot(x - q.x, y - q.y), r));
      if (!near.some((v) => v > 0)) return st;
      if (s.mode === "smooth") {
        return {
          ...st,
          points: pts.map((pt, i): Pt => {
            const k = near[i]! * strength * 0.5;
            if (!k || i === 0 || i === pts.length - 1) return pt;
            const a = pts[i - 1]!;
            const b = pts[i + 1]!;
            return [round(pt[0] + ((a[0] + b[0]) / 2 - pt[0]) * k), round(pt[1] + ((a[1] + b[1]) / 2 - pt[1]) * k), round(pt[2] + ((a[2] + b[2]) / 2 - pt[2]) * k), pt[3]];
          }),
        };
      }
      const sign = s.mode === "thicken" ? 1 : -1;
      return { ...st, points: pts.map(([x, y, w, pp], i): Pt => [x, y, round(Math.max(0.3, w * (1 + sign * 0.08 * strength * near[i]!))), pp]) };
    });
  }
  useStrokePreview.setState({ preview: { clip: s.clip.id, strokes: s.current } });
}

/** Keeps what was sculpted, as one history step. */
export function endSculpt() {
  const s = session;
  session = null;
  useStrokePreview.setState({ preview: null });
  if (!s) return;
  const patches = s.current.flatMap((st, i) => (st !== s.base[i] ? [{ id: st.id, patch: { points: st.points } }] : []));
  if (patches.length) updateStrokes(s.clip.id, patches, "Esculpir trazos");
}

export function sculpting(): boolean {
  return session !== null;
}
