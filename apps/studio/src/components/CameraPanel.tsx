import { useEffect, useMemo, useState } from "react";
import { useRemote } from "../capture/remote";
import { RESOLUTIONS, webcamSettings } from "../capture/webcam";
import type { DslrStatus } from "../native";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { CameraControls } from "./CameraControls";
import { FocusMeterPanel } from "./FocusMeterPanel";
import { FOCUS_KEYS, FocusPanel } from "./FocusPanel";
import { FrameInfo } from "./FrameInfo";
import { MagnifyPanel, ZOOM_KEYS } from "./MagnifyPanel";
import { PhoneConnect } from "./PhoneConnect";

/** Shown in their own sections, not under "Ajustes de la cámara". */
const isSectioned = (c: { kind: string; key: string }) =>
  c.kind === "focus" || c.kind === "magnify" || FOCUS_KEYS.includes(c.key) || ZOOM_KEYS.includes(c.key);

function useDslrStatus(): DslrStatus | null {
  const [status, setStatus] = useState<DslrStatus | null>(null);
  useEffect(() => {
    window.gepetta?.dslr.status().then(setStatus, () => setStatus(null));
  }, []);
  return status;
}

export function CameraPanel() {
  const { webcams, dslrs, selectedId, resolutionId, source, controls, error, opening } = useCamera();
  const { select, selectResolution, setControl, start, refreshDevices } = useCamera.getState();
  const devices = useRemote((s) => s.devices);
  const phones = useMemo(() => devices.filter((d) => d.mode === "live"), [devices]);
  const captureAverage = useEditor((s) => s.captureAverage);
  const dslrStatus = useDslrStatus();
  const [advanced, setAdvanced] = useState(false);
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const current = source?.id ?? selectedId ?? "";
  const size = webcamSettings(source);
  const kind = source?.kind ?? (selectedId?.split(":")[0] as string | undefined) ?? "webcam";

  async function search() {
    setSearching(true);
    await refreshDevices();
    setSearching(false);
  }

  return (
    <aside className="side-panel">
      <FrameInfo />
      <h3>Cámara</h3>
      <label className="control">
        <span>Fuente {opening && <small>abriendo…</small>}</span>
        <select value={current} onChange={(e) => void select(e.target.value)}>
          {!webcams.some((w) => w.id === current) &&
            !dslrs.some((d) => d.id === current) &&
            !phones.some((p) => `phone:${p.sessionId}` === current) && <option value={current}>(elegí una cámara)</option>}
          {webcams.length > 0 && (
            <optgroup label="Webcams">
              {webcams.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </optgroup>
          )}
          {dslrs.length > 0 && (
            <optgroup label="Cámaras réflex">
              {dslrs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          )}
          {phones.length > 0 && (
            <optgroup label="Celulares">
              {phones.map((p) => (
                <option key={p.sessionId} value={`phone:${p.sessionId}`}>
                  {p.device}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <button className="btn small ghost" onClick={() => void search()} disabled={searching}>
        {searching ? "Buscando…" : "Buscar cámaras conectadas"}
      </button>
      {dslrStatus && !dslrStatus.available && dslrStatus.hint && <p className="hint">{dslrStatus.hint}</p>}

      {kind === "webcam" && (
        <label className="control">
          <span>
            Resolución {size.width ? <small>{size.width}×{size.height}</small> : null}
          </span>
          <select value={resolutionId} onChange={(e) => void selectResolution(e.target.value)}>
            {RESOLUTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <div className="panel-error">
          {error.message}
          <div className="action-row">
            {error.code === "busy" && (
              <button
                className="btn small"
                onClick={async () => {
                  await window.gepetta?.dslr.releaseUsb();
                  await start();
                }}
              >
                Liberar cámara
              </button>
            )}
            <button className="btn small" onClick={() => void start()}>
              Reintentar
            </button>
          </div>
        </div>
      )}

      <FocusMeterPanel />
      <FocusPanel />
      <MagnifyPanel />

      <button className="disclosure" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {advanced ? "▾" : "▸"} Ajustes de la cámara
      </button>
      {advanced && (
        <div className="advanced">
          {source && controls.filter((c) => !isSectioned(c)).length === 0 && (
            <p className="hint">
              {source.kind === "webcam"
                ? "Esta webcam no permite ajustes desde acá. (En Mac las webcams exponen pocos controles.)"
                : "Esta cámara no informó ajustes."}
            </p>
          )}
          <CameraControls controls={controls.filter((c) => !isSectioned(c))} slow={source?.kind === "dslr"} onChange={(c, v) => void setControl(c, v)} />
          {source?.kind === "webcam" && (
            <label className="control">
              <span>Promediar fotos (menos ruido)</span>
              <select value={captureAverage} onChange={(e) => useEditor.getState().set({ captureAverage: Number(e.target.value) })}>
                <option value={1}>No</option>
                <option value={2}>2 fotos</option>
                <option value={4}>4 fotos</option>
                <option value={8}>8 fotos</option>
              </select>
            </label>
          )}
        </div>
      )}

      <button className="disclosure" onClick={() => setPhonesOpen(!phonesOpen)} aria-expanded={phonesOpen}>
        {phonesOpen ? "▾" : "▸"} Conectar celular
      </button>
      {phonesOpen && <PhoneConnect />}
    </aside>
  );
}
