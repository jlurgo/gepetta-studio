import { useEditor } from "../state/editor";
import { type SoundRange, shapeRange, soundRange } from "../state/soundEdit";

/** The cells being worked on, as a key that only changes with them (see soundRange). */
function useRange(): SoundRange | null {
  const key = useEditor((s) => {
    const r = soundRange(s);
    return r ? `${r.track}|${r.start}|${r.end}` : "";
  });
  if (!key) return null;
  const [track, start, end] = key.split("|");
  return { track: track!, start: Number(start), end: Number(end) };
}

/**
 * The «Volumen» and «Parlante» tools: painting on the stage each sound
 * cell's volume or speaker, and quick shapes for the cells shown there.
 */
export function SoundEditPanel({ tool }: { tool: "gain" | "pan" }) {
  const range = useRange();
  if (!range) {
    return (
      <p className="hint">
        Tocá una celda de un track de sonido (con ⇧, varias; con doble clic, todo el sonido): se ve grande en la pantalla, y ahí pintás {tool === "gain" ? "su volumen" : "de qué parlante sale"}.
      </p>
    );
  }
  const n = range.end - range.start;
  const which = n === 1 ? `la celda ${range.start + 1}` : `las celdas ${range.start + 1}–${range.end}`;
  const shape = (f: (t: number) => number, label: string) => () => shapeRange(range, tool === "gain" ? "gains" : "pans", f, label);
  return (
    <div className="tool-options">
      <p className="hint">
        {tool === "gain"
          ? "Pintá en la pantalla grande, de un lado al otro: arriba más fuerte (hasta el doble), al medio como es, abajo nada."
          : "Pintá en la pantalla grande, de un lado al otro: arriba sale por el parlante izquierdo, al medio por los dos, abajo por el derecho."}
      </p>
      <p className="hint">Para {which}:</p>
      <div className="action-row wrap">
        {tool === "gain" ? (
          <>
            <button className="btn small" onClick={shape((t) => t, "Fundido de entrada")}>
              Fundido de entrada
            </button>
            <button className="btn small" onClick={shape((t) => 1 - t, "Fundido de salida")}>
              Fundido de salida
            </button>
            <button className="btn small" onClick={shape(() => 1, "Volumen parejo")}>
              Como es
            </button>
            <button className="btn small" onClick={shape(() => 0, "Silencio")}>
              Silencio
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={shape(() => -1, "Por la izquierda")}>
              Izquierda
            </button>
            <button className="btn small" onClick={shape(() => 0, "Por los dos parlantes")}>
              Los dos
            </button>
            <button className="btn small" onClick={shape(() => 1, "Por la derecha")}>
              Derecha
            </button>
            <button className="btn small" onClick={shape((t) => t * 2 - 1, "De izquierda a derecha")}>
              Pasa de izquierda a derecha
            </button>
            <button className="btn small" onClick={shape((t) => 1 - t * 2, "De derecha a izquierda")}>
              Pasa de derecha a izquierda
            </button>
          </>
        )}
      </div>
    </div>
  );
}
