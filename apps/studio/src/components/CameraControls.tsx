import type { CameraControl, ControlValue } from "@gepetta/protocol";
import { useEffect, useState } from "react";

type Range = Extract<CameraControl, { kind: "range" }>;

function formatValue(c: Range, v: number) {
  if (c.key === "exposureTime") return shutter(v);
  return c.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
}

/** A browser's exposure time (in tenths of a millisecond) as photographers say it: "1/50 s". */
function shutter(v: number): string {
  const seconds = v / 10000;
  if (!(seconds > 0)) return "—";
  return seconds >= 1 ? `${Number(seconds.toFixed(1)).toLocaleString("es-AR")} s` : `1/${Math.round(1 / seconds)} s`;
}

/**
 * Exposure times that mains lighting does not flicker with (no dark bands
 * across the picture): whole multiples of 1/100 s, where the mains are 50 Hz.
 */
const NO_FLICKER = [100, 200, 300, 400, 500, 1000];

function RangeControl({ control, onChange, applyOnRelease }: { control: Range; onChange(v: number): void; applyOnRelease: boolean }) {
  const [value, setValue] = useState(control.value);
  useEffect(() => setValue(control.value), [control.value]);
  const commit = () => value !== control.value && onChange(value);
  return (
    <label className="control">
      <span>
        {control.label} <small title={control.auto ? "La cámara lo elige sola; movelo para fijarlo a mano" : undefined}>{control.auto ? "auto" : formatValue(control, value)}</small>
      </span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          if (!applyOnRelease) onChange(v);
        }}
        onPointerUp={applyOnRelease ? commit : undefined}
        onKeyUp={applyOnRelease ? commit : undefined}
      />
      {control.key === "exposureTime" && (
        <span className="action-row" title="Con luz de lámpara, estos tiempos no dejan franjas oscuras en la imagen (corriente de 50 Hz)">
          <small>Sin parpadeo:</small>
          {NO_FLICKER.filter((v) => v >= control.min && v <= control.max).map((v) => (
            <button
              key={v}
              type="button"
              className={`btn small${!control.auto && Math.abs(control.value - v) < 1 ? " active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setValue(v);
                onChange(v);
              }}
            >
              {shutter(v)}
            </button>
          ))}
        </span>
      )}
    </label>
  );
}

/**
 * Renders any camera's settings. Slow devices (DSLRs) apply sliders on release
 * instead of continuously.
 */
export function CameraControls({
  controls,
  onChange,
  slow,
  compact = false,
}: {
  controls: CameraControl[];
  onChange(control: CameraControl, value: ControlValue): void;
  slow: boolean;
  /** Short choice lists render as segmented buttons (for the live-view bar). */
  compact?: boolean;
}) {
  return (
    <>
      {controls.map((c) => {
        switch (c.kind) {
          case "range":
            return <RangeControl key={c.key} control={c} applyOnRelease={slow} onChange={(v) => onChange(c, v)} />;
          case "choice":
            if (compact && c.options.length <= 4)
              return (
                <div key={c.key} className="control">
                  <span>{c.label}</span>
                  <div className="segmented">
                    {c.options.map((o) => (
                      <button
                        key={o.value}
                        className={o.value === c.value ? "active" : ""}
                        onClick={() => o.value !== c.value && onChange(c, o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            return (
              <label key={c.key} className="control">
                <span>{c.label}</span>
                <select value={c.value} onChange={(e) => onChange(c, e.target.value)}>
                  {!c.options.some((o) => o.value === c.value) && <option value={c.value}>{c.value}</option>}
                  {c.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          case "toggle":
            return (
              <label key={c.key} className="control toggle">
                <input type="checkbox" checked={c.value} onChange={(e) => onChange(c, e.target.checked)} />
                <span>{c.label}</span>
              </label>
            );
          case "action":
            return (
              <div key={c.key} className="control">
                <span>{c.label}</span>
                <div className="action-row">
                  {c.actions.map((a) => (
                    <button key={a.value} className="btn small" onClick={() => onChange(c, a.value)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
        }
      })}
    </>
  );
}
