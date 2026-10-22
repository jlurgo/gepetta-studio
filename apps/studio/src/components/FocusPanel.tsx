import { formatDistance } from "@gepetta/core";
import type { CameraControl } from "@gepetta/protocol";
import { useEffect, useMemo, useState } from "react";
import { type FocusRef, estimateDistance, focusRefs } from "../capture/focusRefs";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { useFocusMarks } from "../state/focusMarks";
import { CameraControls } from "./CameraControls";

const NO_MARKS: never[] = [];

type Focus = Extract<CameraControl, { kind: "focus" }>;
type Scale = "all" | "mid" | "fine";

const SCALES: { id: Scale; label: string; half: number | null }[] = [
  { id: "all", label: "Todo", half: null },
  { id: "mid", label: "Medio", half: 40 },
  { id: "fine", label: "Fino", half: 8 },
];

/** Generic webcam/phone focus settings shown in this section. */
export const FOCUS_KEYS = ["focusMode", "focusDistance"];

function sliderWindow(c: Focus, scale: Scale): [number, number] {
  const pos = c.position ?? 0;
  const half = SCALES.find((s) => s.id === scale)!.half;
  if (half === null) return c.origin === "infinity" ? [0, c.range] : [-c.range / 2, c.range / 2];
  let [min, max] = [pos - half, pos + half];
  if (c.origin === "infinity" && min < 0) [min, max] = [0, 2 * half];
  return [min, max];
}

/** Ticks for distance references, with labels spread over two rows and dropped where they would collide. */
function layoutTicks(refs: FocusRef[], min: number, max: number) {
  const lastInRow = [-Infinity, -Infinity];
  return refs
    .filter((r) => r.position >= min && r.position <= max)
    .map((r) => {
      const at = ((r.position - min) / (max - min)) * 100;
      const row = lastInRow.findIndex((last) => at - last >= 16);
      if (row >= 0) lastInRow[row] = at;
      return { ...r, at, row };
    });
}

function LensFocus({ control }: { control: Focus }) {
  const setControl = useCamera((s) => s.setControl);
  const pointerTool = useCamera((s) => s.pointerTool);
  const camera = useCamera((s) => s.sourceLabel()) ?? "";
  const film = useEditor((s) => s.film);
  const marks = useFocusMarks((s) => s.byCamera[camera] ?? NO_MARKS);
  const [scale, setScale] = useState<Scale>("all");
  const [draft, setDraft] = useState(control.position ?? 0);
  useEffect(() => setDraft(control.position ?? 0), [control.position]);

  const known = control.position !== null;
  const fromInfinity = control.origin === "infinity";
  const refs = useMemo(() => (fromInfinity ? focusRefs(film, camera) : []), [film, camera, fromInfinity]);
  const [min, max] = sliderWindow(control, scale);
  const estimate = known && fromInfinity ? estimateDistance(refs, draft) : null;
  const send = (value: string) => void setControl(control, value);
  const moveTo = (target: number) => {
    const delta = Math.round(target - (control.position ?? 0));
    if (delta !== 0) send(`move:${delta > 0 ? "+" : ""}${delta}`);
  };
  const pct = (p: number) => `${((p - min) / (max - min)) * 100}%`;

  return (
    <div className="focus-panel">
      <div className="focus-buttons">
        <button className="btn small" onClick={() => send("af")} title="Autofoco en el recuadro de enfoque">
          Enfocar
        </button>
        {control.canPointFocus && (
          <button
            className={`btn small${pointerTool === "focus" ? " active" : ""}`}
            onClick={() => useCamera.getState().setPointerTool(pointerTool === "focus" ? "none" : "focus")}
            title="Tocá un punto de la imagen en vivo para enfocar ahí"
          >
            Tocar punto

          </button>
        )}
        <button className="btn small" onClick={() => send("zero")} title="Lleva el foco a infinito y empieza a contar desde ahí">
          ∞ Cero
        </button>
      </div>

      <p className="hint focus-status">
        {!known
          ? "Posición desconocida. Tocá «∞ Cero» para medirla."
          : fromInfinity
            ? `Posición ≈${draft} desde ∞${estimate !== null ? ` · ≈ ${formatDistance(estimate)}` : ""}`
            : `${draft > 0 ? "+" : ""}${draft} desde el último autofoco`}
      </p>

      <div className="segmented">
        {SCALES.map((s) => (
          <button key={s.id} className={scale === s.id ? "active" : ""} onClick={() => setScale(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="focus-track">
        {fromInfinity && (
          <div className="focus-marks-row">
            {marks
              .filter((m) => m.position >= min && m.position <= max)
              .map((m) => (
                <b key={m.id} style={{ left: pct(m.position) }} title={`Marca ${m.name}`}>
                  {m.name}
                </b>
              ))}
          </div>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={!known}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={() => moveTo(draft)}
          onKeyUp={() => moveTo(draft)}
          aria-label="Foco"
        />
        <div className="focus-ticks">
          {layoutTicks(refs, min, max).map((t) => (
            <i key={t.position} style={{ left: `${t.at}%` }} title={`Foto con foco en ${formatDistance(t.distance)}`}>
              {t.row >= 0 && <span className={`row${t.row}`}>{formatDistance(t.distance)}</span>}
            </i>
          ))}
        </div>
        <div className="focus-ends">
          <span>{fromInfinity && min === 0 ? "∞ lejos" : "← lejos"}</span>
          <span>cerca →</span>
        </div>
      </div>

      <div className="action-row nudges">
        <button className="btn small" onClick={() => send("move:-10")} title="10 pasos más lejos">
          «
        </button>
        <button className="btn small" onClick={() => send("move:-1")} title="1 paso más lejos">
          ‹
        </button>
        <button className="btn small" onClick={() => send("move:+1")} title="1 paso más cerca">
          ›
        </button>
        <button className="btn small" onClick={() => send("move:+10")} title="10 pasos más cerca">
          »
        </button>
      </div>

      {fromInfinity && (
        <p className="hint">
          La posición es aproximada: esta cámara no mueve el lente siempre igual. Para que una marca se repita,
          volvé a ella de la misma forma (desde «∞ Cero»).
        </p>
      )}
      {fromInfinity && (
        <div className="marks">
          {marks.map((m) => (
            <span key={m.id} className="mark-chip">
              <button onClick={() => moveTo(m.position)} title={`Ir a la marca ${m.name}`}>
                {m.name} · {m.position}
                {estimateDistance(refs, m.position) !== null ? ` · ≈${formatDistance(estimateDistance(refs, m.position)!)}` : ""}
              </button>
              <button onClick={() => useFocusMarks.getState().remove(camera, m.id)} title="Borrar marca">
                ×
              </button>
            </span>
          ))}
          <button className="btn small ghost" onClick={() => useFocusMarks.getState().add(camera, control.position!)}>
            + Marcar esta posición
          </button>
        </div>
      )}
      {!fromInfinity && known && (
        <p className="hint">Para guardar marcas, empezá desde «∞ Cero» (el autofoco pierde la cuenta).</p>
      )}
    </div>
  );
}

export function FocusPanel() {
  const controls = useCamera((s) => s.controls);
  const kind = useCamera((s) => s.source?.kind);
  const lens = controls.find((c): c is Focus => c.kind === "focus");
  const generic = controls.filter((c) => FOCUS_KEYS.includes(c.key));
  if (!lens && generic.length === 0) return null;
  return (
    <section className="panel-section">
      <h4>Foco</h4>
      {lens && <LensFocus control={lens} />}
      {generic.length > 0 && (
        <CameraControls controls={generic} slow={kind === "dslr"} onChange={(c, v) => void useCamera.getState().setControl(c, v)} />
      )}
    </section>
  );
}
