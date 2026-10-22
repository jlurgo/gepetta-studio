import { useCamera } from "../state/camera";
import { probeColor, ratio, useFocusProbes } from "../state/focusProbes";
import { magnifyControl } from "./MagnifyPanel";

/** Focus meter: place up to three spots on the live view and watch how sharp each one is. */
export function FocusMeterPanel() {
  const hasSource = useCamera((s) => s.source !== null);
  const active = useCamera((s) => s.pointerTool === "probe");
  const magnified = useCamera((s) => (magnifyControl(s.controls)?.value ?? "1") !== "1");
  const probes = useFocusProbes((s) => s.probes);
  const shown = useFocusProbes((s) => s.shown);
  if (!hasSource) return null;
  const { clear, resetPeaks } = useFocusProbes.getState();

  return (
    <section className="panel-section">
      <h4>Medidor de foco</h4>
      <button
        className={`btn small${active ? " active" : ""}`}
        onClick={() => useCamera.getState().setPointerTool(active ? "none" : "probe")}
      >
        {active ? "Listo" : "◎ Medir un punto"}
      </button>
      {active && <p className="hint">Tocá la imagen en vivo para poner un medidor (hasta 3). Tocá uno para quitarlo.</p>}
      {magnified && probes.length > 0 && <p className="hint">Los medidores se pausan mientras usás la lupa.</p>}
      {probes.length > 0 && (
        <>
          <ul className="probe-list">
            {probes.map((p) => {
              const r = shown[p.id];
              const q = r ? ratio(r) : 0;
              return (
                <li key={p.id}>
                  <b>{p.name}</b>
                  <span className="probe-bar">
                    <span style={{ width: `${Math.round(q * 100)}%`, background: probeColor(q) }} />
                  </span>
                  <span className="probe-value">{r ? `${Math.round(q * 100)}%` : "…"}</span>
                </li>
              );
            })}
          </ul>
          <p className="hint">100% = lo más nítido que se vio en ese punto. Mové el foco hasta llegar al máximo.</p>
          <div className="action-row">
            <button className="btn small" onClick={resetPeaks} title="Volver a medir el máximo desde ahora">
              Reiniciar máximos
            </button>
            <button className="btn small ghost" onClick={clear}>
              Quitar todos
            </button>
          </div>
        </>
      )}
    </section>
  );
}
