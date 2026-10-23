import type { Clip, Stroke, StrokePatch } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { BRUSHES, type BrushKind, PAINT_COLORS } from "../state/paint";
import { removeStrokes, selectStrokes, strokeName, updateStrokes, useStrokes } from "../state/strokes";
import { Icon, type IconName } from "./Icon";

export const STROKE_ICONS: Record<Stroke["tool"], IconName> = {
  draw: "brush",
  erase: "eraser",
  tint: "tint",
  shape: "shape",
  fill: "fill",
  clone: "stamp",
};

/** A slider that shows its value while dragged and keeps it (one history step) when let go. */
function CommitSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format(v: number): string;
  onCommit(v: number): void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const finish = () => {
    if (dirty.current) onCommit(draft);
    dirty.current = false;
  };
  return (
    <label className="tool-size">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          dirty.current = true;
          setDraft(Number(e.target.value));
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
      <span>{format(draft)}</span>
    </label>
  );
}

const widthOf = (s: Stroke) => {
  const pts = s.points ?? [];
  return pts.length ? Math.max(...pts.map((p) => p[2])) : 0;
};

/** Changes the picked strokes together (color, width, strength…), or removes them. */
function StrokeEditor({ clip, strokes }: { clip: Clip; strokes: Stroke[] }) {
  const first = strokes[0]!;
  const colored = strokes.filter((s) => s.tool !== "erase" && s.tool !== "clone");
  const lines = strokes.filter((s) => s.points?.length);
  const each = (patch: (s: Stroke) => StrokePatch | null, among = strokes, label?: string) =>
    updateStrokes(
      clip.id,
      among.flatMap((s) => {
        const p = patch(s);
        return p ? [{ id: s.id, patch: p }] : [];
      }),
      label,
    );
  const width = lines.length ? widthOf(lines[0]!) : 0;

  return (
    <div className="stroke-editor">
      <strong>{strokes.length === 1 ? strokeName(first) : `${strokes.length} trazos`}</strong>
      {colored.length > 0 && (
        <div className="swatches">
          <span className="swatch-current" style={{ background: colored[0]!.color ?? "#000" }} />
          {PAINT_COLORS.map((c) => (
            <button key={c} className={c === colored[0]!.color ? "active" : ""} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => each(() => ({ color: c }), colored, "Color del trazo")} />
          ))}
          <label className="swatch-custom" title="Otro color">
            <input type="color" value={colored[0]!.color ?? "#000000"} onChange={(e) => each(() => ({ color: e.target.value }), colored, "Color del trazo")} />
          </label>
        </div>
      )}
      {lines.length > 0 && (
        <CommitSlider
          label="Grosor"
          value={Math.round(width)}
          min={1}
          max={Math.max(300, Math.round(width))}
          format={(v) => String(Math.round(v))}
          onCommit={(w) =>
            each((s) => {
              // Every point keeps its share of the width (pen pressure).
              const k = w / (widthOf(s) || 1);
              return { points: s.points!.map(([x, y, pw, p]) => [x, y, Math.round(pw * k * 100) / 100, p]) };
            }, lines, "Grosor del trazo")
          }
        />
      )}
      <CommitSlider
        label="Fuerza"
        value={first.strength}
        min={0.05}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)} %`}
        onCommit={(strength) => each(() => ({ strength }), strokes, "Fuerza del trazo")}
      />
      {strokes.every((s) => s.tool === "draw") && (
        <div className="segmented tool-choice">
          {(Object.keys(BRUSHES) as BrushKind[]).map((b) => (
            <button key={b} className={first.brush === b ? "active" : ""} onClick={() => each(() => ({ brush: b }), strokes, "Pincel del trazo")}>
              {BRUSHES[b].label}
            </button>
          ))}
        </div>
      )}
      {strokes.every((s) => s.tool === "shape" && s.shape !== "line") && (
        <label className="control toggle">
          <input type="checkbox" checked={!!first.filled} onChange={(e) => each(() => ({ filled: e.target.checked }), strokes, "Relleno de la forma")} />
          <span>Rellena</span>
        </label>
      )}
      <button className="btn small danger" onClick={() => removeStrokes(clip.id, strokes.map((s) => s.id))}>
        <Icon name="trash" size={14} /> {strokes.length === 1 ? "Borrar trazo" : `Borrar ${strokes.length} trazos`}
      </button>
    </div>
  );
}

/**
 * A picture's strokes, top first (like the picture shows them): pick one (⇧ or
 * ⌘/Ctrl to add) to change or remove it; the eye hides it.
 */
export function StrokesPanel({ clip }: { clip: Clip }) {
  const pickedClip = useStrokes((s) => s.clip);
  const ids = useStrokes((s) => s.ids);
  const strokes = clip.strokes ?? [];
  if (!strokes.length) return null;
  const picked = pickedClip === clip.id ? strokes.filter((s) => ids.includes(s.id)) : [];
  const toggle = (s: Stroke, add: boolean) => {
    const current = pickedClip === clip.id ? ids : [];
    if (add) selectStrokes(clip.id, current.includes(s.id) ? current.filter((i) => i !== s.id) : [...current, s.id]);
    else selectStrokes(clip.id, current.length === 1 && current[0] === s.id ? [] : [s.id]);
  };

  return (
    <div className="strokes-panel">
      <h4>Trazos ({strokes.length})</h4>
      <ul className="stroke-list">
        {[...strokes].reverse().map((s) => (
          <li key={s.id} className={`${picked.includes(s) ? "active" : ""}${s.hidden ? " off" : ""}`}>
            <button className="stroke-pick" onClick={(e) => toggle(s, e.shiftKey || e.metaKey || e.ctrlKey)}>
              <Icon name={STROKE_ICONS[s.tool]} size={14} />
              <span>{strokeName(s)}</span>
              {s.color && s.tool !== "erase" && <span className="stroke-color" style={{ background: s.color }} />}
            </button>
            <button
              className="icon-btn small"
              title={s.hidden ? "Mostrar" : "Ocultar"}
              onClick={() => updateStrokes(clip.id, [{ id: s.id, patch: { hidden: !s.hidden || undefined } }])}
            >
              <Icon name={s.hidden ? "eyeOff" : "eye"} size={14} />
            </button>
            <button className="icon-btn small" title="Borrar" onClick={() => removeStrokes(clip.id, [s.id])}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {picked.length > 0 ? <StrokeEditor clip={clip} strokes={picked} /> : <p className="hint">Tocá un trazo (acá o en la imagen, con «Elegir») para cambiarlo o borrarlo.</p>}
    </div>
  );
}
