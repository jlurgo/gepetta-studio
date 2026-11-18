import type { CameraControl, ControlValue } from "@gepetta/protocol";
import { useEffect, useRef, useState } from "react";

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

/** What is typed as a value: a number (comma or point); an exposure time also as "1/50" (or just "50"). */
function parseValue(c: Range, text: string): number | null {
  const t = text.trim().replace(/\s*s$/i, "").replace(",", ".");
  if (c.key === "exposureTime") {
    const m = /^(?:(\d+(?:\.\d+)?)\s*\/\s*)?(\d+(?:\.\d+)?)$/.exec(t);
    if (!m) return null;
    const seconds = m[1] ? Number(m[1]) / Number(m[2]) : 1 / Number(m[2]);
    return Number.isFinite(seconds) ? seconds * 10000 : null;
  }
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
}

/** A value within the control's range, on its steps. */
function fit(c: Range, v: number): number {
  const stepped = c.min + Math.round((v - c.min) / c.step) * c.step;
  return Number(Math.min(c.max, Math.max(c.min, stepped)).toFixed(6));
}

/**
 * How fast (units a second) the jog knob changes a value, pulled `reach` (0..1)
 * of its travel. It grows evenly all the way, each bit of travel multiplying
 * the speed by the same, so precision and range blend into each other: from
 * fine (two steps a second; or 1% of the value a second when the range spans
 * many times its start, like an exposure time, where two steps is nothing) to
 * half the range a second.
 */
export function jogSpeed(c: { min: number; max: number; step: number }, value: number, reach: number): number {
  const wide = c.min > 0 && c.max / c.min > 50;
  const slow = Math.max(c.step * 2, wide ? Math.abs(value) * 0.01 : 0);
  const fast = (c.max - c.min) / 2;
  return fast > slow ? slow * (fast / slow) ** reach : slow;
}

/** How far (px) the knob goes for its fastest speed, and the still zone around its rest. */
const JOG_REACH = 90;
const JOG_STILL = 4;

/**
 * A knob with a spring: dragged up the value grows, down it shrinks; a little
 * way it goes finely, further it runs (see jogSpeed). Let go, it comes back
 * and the value stays.
 */
function Jog({ control, value, onValue, onDone }: { control: Range; value: number; onValue(v: number): void; onDone(): void }) {
  const [pull, setPull] = useState(0);
  const state = useRef<{ y0: number; pull: number; value: number; raf: number; last: number } | null>(null);
  const live = useRef({ control, value, onValue });
  live.current = { control, value, onValue };

  const stop = () => {
    const st = state.current;
    if (!st) return;
    cancelAnimationFrame(st.raf);
    state.current = null;
    setPull(0);
    onDone();
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = (now: number) => {
    const st = state.current;
    if (!st) return;
    const c = live.current.control;
    const dt = Math.min(0.1, (now - st.last) / 1000);
    st.last = now;
    const reach = Math.min(1, Math.max(0, (Math.abs(st.pull) - JOG_STILL) / (JOG_REACH - JOG_STILL)));
    if (reach > 0) {
      const speed = jogSpeed(c, st.value, reach);
      st.value = Math.min(c.max, Math.max(c.min, st.value + Math.sign(st.pull) * speed * dt));
      const v = fit(c, st.value);
      if (v !== live.current.value) live.current.onValue(v);
    }
    st.raf = requestAnimationFrame(tick);
  };

  return (
    <span
      className={`jog${pull ? " pulled" : ""}`}
      title="Perilla: arrastrala hacia arriba o abajo; cuanto más lejos, más rápido cambia. Al soltarla vuelve."
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        state.current = { y0: e.clientY, pull: 0, value: live.current.value, raf: requestAnimationFrame(tick), last: performance.now() };
      }}
      onPointerMove={(e) => {
        const st = state.current;
        if (!st) return;
        st.pull = Math.max(-JOG_REACH, Math.min(JOG_REACH, st.y0 - e.clientY));
        setPull(st.pull);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <span className="jog-knob" style={{ transform: `translateY(${(-pull / JOG_REACH) * 9}px)` }} />
    </span>
  );
}

function RangeControl({ control, onChange, applyOnRelease }: { control: Range; onChange(v: number): void; applyOnRelease: boolean }) {
  const [value, setValue] = useState(control.value);
  useEffect(() => setValue(control.value), [control.value]);
  /** What is being typed, or null while the field shows the value. */
  const [typed, setTyped] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const commit = () => latest.current !== control.value && onChange(latest.current);
  const set = (v: number) => {
    latest.current = v;
    setValue(v);
    if (!applyOnRelease) onChange(v);
  };
  const enter = () => {
    const v = typed === null ? null : parseValue(control, typed);
    setTyped(null);
    if (v === null) return;
    const fitted = fit(control, v);
    latest.current = fitted;
    setValue(fitted);
    onChange(fitted);
  };
  const shown = control.key === "exposureTime" ? formatValue(control, value).replace(/ s$/, "") : formatValue(control, value);
  return (
    <div className="control ranged">
      <span className="control-head">
        <span>{control.label}</span>
        <input
          className="control-number"
          type="text"
          inputMode="decimal"
          aria-label={control.label}
          value={typed ?? (control.auto ? "" : shown)}
          placeholder={control.auto ? "auto" : undefined}
          title={control.key === "exposureTime" ? "Escribí el tiempo: 1/50, o solo 50 (segundos: 1/50)" : control.auto ? "La cámara lo elige sola; escribí un valor para fijarlo a mano" : "Escribí el valor y Enter"}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={enter}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            else if (e.key === "Escape") {
              setTyped(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {control.key === "exposureTime" && <small className="control-unit">s</small>}
      </span>
      <span className="control-row">
        <input
          type="range"
          aria-label={control.label}
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
          onPointerUp={applyOnRelease ? commit : undefined}
          onKeyUp={applyOnRelease ? commit : undefined}
        />
        <Jog control={control} value={value} onValue={set} onDone={() => applyOnRelease && commit()} />
      </span>
      {control.key === "exposureTime" && (
        <span className="action-row" title="Con luz de lámpara, estos tiempos no dejan franjas oscuras en la imagen (corriente de 50 Hz)">
          <small>Sin parpadeo:</small>
          {NO_FLICKER.filter((v) => v >= control.min && v <= control.max).map((v) => (
            <button
              key={v}
              type="button"
              className={`btn small${!control.auto && Math.abs(control.value - v) < 1 ? " active" : ""}`}
              onClick={() => {
                latest.current = v;
                setValue(v);
                onChange(v);
              }}
            >
              {shutter(v)}
            </button>
          ))}
        </span>
      )}
    </div>
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
