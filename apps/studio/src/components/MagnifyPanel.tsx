import type { CameraControl } from "@gepetta/protocol";
import { useRef } from "react";
import { useCamera } from "../state/camera";
import { capturePointer } from "./pointer";
import { CameraControls } from "./CameraControls";

type Magnify = Extract<CameraControl, { kind: "magnify" }>;

/** Webcam/phone optical or digital zoom, shown in this section. */
export const ZOOM_KEYS = ["zoom"];

export function magnifyControl(controls: CameraControl[]): Magnify | undefined {
  return controls.find((c): c is Magnify => c.kind === "magnify");
}

/** Whole picture with the magnified area marked; click or drag to look elsewhere. */
function Overview({ control }: { control: Magnify }) {
  const overview = useCamera((s) => s.overview);
  const ref = useRef<HTMLDivElement>(null);
  const level = Number(control.value);
  const [cx, cy] = control.center;
  const lastSent = useRef(0);

  const aim = (e: React.PointerEvent, force = false) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const now = performance.now();
    if (!force && now - lastSent.current < 200) return;
    lastSent.current = now;
    void useCamera.getState().setControl(control, `at:${x.toFixed(3)},${y.toFixed(3)}`);
  };

  return (
    <div
      ref={ref}
      className="overview"
      onPointerDown={(e) => {
        capturePointer(e);
        aim(e, true);
      }}
      onPointerMove={(e) => e.buttons === 1 && aim(e)}
      onPointerUp={(e) => aim(e, true)}
      title="Tocá o arrastrá para elegir dónde mirar"
    >
      {overview ? <img src={overview} alt="" draggable={false} /> : <div className="overview-empty">Vista completa</div>}
      <div
        className="overview-rect"
        style={{ left: `${(cx - 0.5 / level) * 100}%`, top: `${(cy - 0.5 / level) * 100}%`, width: `${100 / level}%`, height: `${100 / level}%` }}
      />
    </div>
  );
}

export function MagnifyPanel() {
  const controls = useCamera((s) => s.controls);
  const kind = useCamera((s) => s.source?.kind);
  const magnify = magnifyControl(controls);
  const zoom = controls.filter((c) => ZOOM_KEYS.includes(c.key));
  if (!magnify && zoom.length === 0) return null;
  return (
    <section className="panel-section">
      <h4>{magnify ? "Lupa" : "Zoom"}</h4>
      {magnify && (
        <>
          <div className="segmented">
            {magnify.levels.map((l) => (
              <button
                key={l.value}
                className={magnify.value === l.value ? "active" : ""}
                onClick={() => magnify.value !== l.value && void useCamera.getState().setControl(magnify, l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
          {magnify.value !== "1" && (
            <>
              <Overview control={magnify} />
              <p className="hint">Arrastrá sobre la imagen en vivo o en el recuadro para mover la lupa. Las fotos salen completas.</p>
            </>
          )}
        </>
      )}
      {zoom.length > 0 && (
        <CameraControls controls={zoom} slow={kind === "dslr"} onChange={(c, v) => void useCamera.getState().setControl(c, v)} />
      )}
    </section>
  );
}
