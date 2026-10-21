import { useEffect, useState } from "react";
import { type CameraControl, MODE_VALUE_LABELS, RESOLUTIONS } from "../capture/webcam";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";

function formatValue(c: Extract<CameraControl, { kind: "range" }>, v: number) {
  return c.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
}

function RangeControl({ control }: { control: Extract<CameraControl, { kind: "range" }> }) {
  const setControl = useCamera((s) => s.setControl);
  const [value, setValue] = useState(control.value);
  useEffect(() => setValue(control.value), [control.value]);
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
          void setControl(control, v);
        }}
      />
    </label>
  );
}

export function CameraPanel() {
  const { devices, deviceId, resolutionId, controls, stream, error } = useCamera();
  const { selectDevice, selectResolution, setControl, start } = useCamera.getState();
  const captureAverage = useEditor((s) => s.captureAverage);
  const [advanced, setAdvanced] = useState(false);
  const settings = stream?.getVideoTracks()[0]?.getSettings();

  return (
    <aside className="side-panel">
      <h3>Cámara</h3>
      <label className="control">
        <span>Dispositivo</span>
        <select value={deviceId ?? ""} onChange={(e) => void selectDevice(e.target.value)}>
          {devices.length === 0 && <option value="">(ninguna)</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>
          Resolución {settings?.width ? <small>{settings.width}×{settings.height}</small> : null}
        </span>
        <select value={resolutionId} onChange={(e) => void selectResolution(e.target.value)}>
          {RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <div className="panel-error">
          {error}{" "}
          <button className="btn small" onClick={() => void start()}>
            Reintentar
          </button>
        </div>
      )}

      <button className="disclosure" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {advanced ? "▾" : "▸"} Ajustes avanzados
      </button>
      {advanced && (
        <div className="advanced">
          {controls.length === 0 && (
            <p className="hint">
              Esta cámara no permite ajustes desde acá. (En Mac las webcams exponen pocos controles; el control
              completo llegará con el módulo nativo.)
            </p>
          )}
          {controls.map((c) =>
            c.kind === "mode" ? (
              <label key={c.key} className="control">
                <span>{c.label}</span>
                <select value={c.value} onChange={(e) => void setControl(c, e.target.value)}>
                  {c.options.map((o) => (
                    <option key={o} value={o}>
                      {MODE_VALUE_LABELS[o] ?? o}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <RangeControl key={c.key} control={c} />
            ),
          )}
          <label className="control">
            <span>Promediar fotos (menos ruido)</span>
            <select value={captureAverage} onChange={(e) => useEditor.getState().set({ captureAverage: Number(e.target.value) })}>
              <option value={1}>No</option>
              <option value={2}>2 fotos</option>
              <option value={4}>4 fotos</option>
              <option value={8}>8 fotos</option>
            </select>
          </label>
        </div>
      )}
    </aside>
  );
}
