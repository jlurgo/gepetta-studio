import type { CameraControl, ControlValue } from "@gepetta/protocol";
import { useEffect, useState } from "react";

type Range = Extract<CameraControl, { kind: "range" }>;

function formatValue(c: Range, v: number) {
  return c.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
}

function RangeControl({ control, onChange, applyOnRelease }: { control: Range; onChange(v: number): void; applyOnRelease: boolean }) {
  const [value, setValue] = useState(control.value);
  useEffect(() => setValue(control.value), [control.value]);
  const commit = () => value !== control.value && onChange(value);
  return (
    <label className="control">
      <span>
        {control.label} <small>{formatValue(control, value)}</small>
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
