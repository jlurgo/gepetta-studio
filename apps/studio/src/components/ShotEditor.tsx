import { type BlendMode, type Effect, IDENTITY_TRANSFORM, type Look, isPlainLook } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { type ShotChange, type ShotValue, applyChange } from "../state/shot";

export const BLENDS: Record<BlendMode, string> = {
  normal: "Normal",
  multiply: "Multiplicar (oscurece)",
  screen: "Trama (aclara)",
  overlay: "Superponer",
  darken: "Oscurecer",
  lighten: "Aclarar",
  difference: "Diferencia",
};

const EFFECTS: { kind: Effect["kind"]; label: string }[] = [
  { kind: "brightness", label: "Brillo" },
  { kind: "contrast", label: "Contraste" },
  { kind: "saturation", label: "Saturación" },
];

const DEG = 180 / Math.PI;

/** Crop as the four sides cut, in fractions. */
function sidesOf(look: Look) {
  const c = look.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return { left: c.x, top: c.y, right: 1 - c.x - c.width, bottom: 1 - c.y - c.height };
}

function cropOf(s: { left: number; top: number; right: number; bottom: number }): Look["crop"] {
  if (s.left + s.top + s.right + s.bottom < 0.001) return undefined;
  return { x: s.left, y: s.top, width: Math.max(0.05, 1 - s.left - s.right), height: Math.max(0.05, 1 - s.top - s.bottom) };
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(v: number): void;
}) {
  return (
    <label className="tool-size">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span>
        {Math.round(value)}
        {unit}
      </span>
    </label>
  );
}

/**
 * Size, crop, rotation, mirror, see-through, mixing and effects of a picture
 * (or of a camera's pictures). Changes show right away (`onPreview`) and are
 * kept when a control is let go (`onCommit`), so a slider drag is one step.
 */
export function ShotEditor({
  value,
  onPreview,
  onCommit,
  mixed = false,
}: {
  value: ShotValue;
  onPreview(change: ShotChange): void;
  onCommit(change: ShotChange): void;
  /** Several pictures: the controls show the first one; a change goes to all of them. */
  mixed?: boolean;
}) {
  const [change, setChange] = useState<ShotChange>({});
  const pending = useRef<ShotChange | null>(null);
  // A new value from outside (undo, another picture, a camera changed live) starts over.
  const key = JSON.stringify(value);
  useEffect(() => {
    setChange({});
    pending.current = null;
  }, [key]);

  const shown = applyChange(value, change);
  const update = (next: ShotChange) => {
    const merged: ShotChange = {
      transform: { ...change.transform, ...next.transform },
      ...(next.opacity !== undefined ? { opacity: next.opacity } : change.opacity !== undefined && { opacity: change.opacity }),
      look: { ...change.look, ...next.look },
    };
    setChange(merged);
    pending.current = merged;
    onPreview(merged);
  };
  const finish = () => {
    if (!pending.current) return;
    onCommit(pending.current);
    pending.current = null;
  };
  /** Buttons and selects change and keep at once. */
  const now = (next: ShotChange) => {
    update(next);
    finish();
  };

  const t = shown.transform;
  const look = shown.look;
  const sides = sidesOf(look);
  const setSide = (side: keyof typeof sides, pct: number) => update({ look: { crop: cropOf({ ...sides, [side]: pct / 100 }) } });
  const effect = (kind: Effect["kind"]) => look.effects?.find((e) => e.kind === kind)?.amount ?? 0;
  const setEffect = (kind: Effect["kind"], pct: number) => {
    const effects = (look.effects ?? []).filter((e) => e.kind !== kind);
    if (pct) effects.push({ kind, amount: pct / 100 });
    update({ look: { effects: effects.length ? effects : undefined } });
  };
  const changed =
    !isPlainLook(look) || t.x !== 0 || t.y !== 0 || t.rotation !== 0 || t.scale !== 1 || shown.opacity !== 1;

  return (
    <div className="shot-editor" onPointerUp={finish} onKeyUp={finish} onBlur={finish}>
      {mixed && <p className="hint">Los cambios van a todas las imágenes elegidas.</p>}

      <h4>Tamaño</h4>
      <Slider label="Escala" value={t.scale * 100} min={10} max={400} unit=" %" onChange={(v) => update({ transform: { scale: v / 100 } })} />
      <div className="segmented tool-choice">
        <button className={(look.fit ?? "contain") === "contain" ? "active" : ""} onClick={() => now({ look: { fit: undefined } })} title="Se ve entera, con bordes si no tiene la forma de la película">
          Entera
        </button>
        <button className={look.fit === "cover" ? "active" : ""} onClick={() => now({ look: { fit: "cover" } })} title="Llena la película, cortando lo que sobra">
          Llenar
        </button>
      </div>

      <h4>Recorte</h4>
      <Slider label="Izquierda" value={sides.left * 100} min={0} max={90} unit=" %" onChange={(v) => setSide("left", v)} />
      <Slider label="Derecha" value={sides.right * 100} min={0} max={90} unit=" %" onChange={(v) => setSide("right", v)} />
      <Slider label="Arriba" value={sides.top * 100} min={0} max={90} unit=" %" onChange={(v) => setSide("top", v)} />
      <Slider label="Abajo" value={sides.bottom * 100} min={0} max={90} unit=" %" onChange={(v) => setSide("bottom", v)} />

      <h4>Rotación y espejo</h4>
      <Slider label="Rotación" value={t.rotation * DEG} min={-180} max={180} unit="°" onChange={(v) => update({ transform: { rotation: v / DEG } })} />
      <div className="action-row">
        <button className={`btn small${look.flipX ? " active" : ""}`} aria-pressed={!!look.flipX} onClick={() => now({ look: { flipX: !look.flipX || undefined } })}>
          ⇋ Espejo
        </button>
        <button className={`btn small${look.flipY ? " active" : ""}`} aria-pressed={!!look.flipY} onClick={() => now({ look: { flipY: !look.flipY || undefined } })}>
          ⇵ Dar vuelta
        </button>
      </div>

      <h4>Transparencia y mezcla</h4>
      <Slider label="Opacidad" value={shown.opacity * 100} min={0} max={100} unit=" %" onChange={(v) => update({ opacity: v / 100 })} />
      <label className="control">
        <span>Mezcla con lo de abajo</span>
        <select value={look.blend ?? "normal"} onChange={(e) => now({ look: { blend: e.target.value === "normal" ? undefined : (e.target.value as BlendMode) } })}>
          {Object.entries(BLENDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <h4>Efectos</h4>
      {EFFECTS.map((e) => (
        <Slider key={e.kind} label={e.label} value={effect(e.kind) * 100} min={-100} max={100} onChange={(v) => setEffect(e.kind, v)} />
      ))}

      <button
        className="btn small"
        disabled={!changed}
        onClick={() =>
          now({
            transform: IDENTITY_TRANSFORM,
            opacity: 1,
            look: { crop: undefined, fit: undefined, flipX: undefined, flipY: undefined, blend: undefined, effects: undefined },
          })
        }
      >
        Restablecer todo
      </button>
    </div>
  );
}
