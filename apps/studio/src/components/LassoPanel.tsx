import { type Clip, clipAt, sequenceClips } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { clearMasks, reblend, setKey, setMaskOptions, takeToNewTrack, useLasso } from "../state/lasso";
import { Icon } from "./Icon";

/** Soft edge, changed live and kept when let go. */
function FeatherSlider({ clip }: { clip: Clip }) {
  const value = clip.look?.mask?.feather ?? 0;
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const finish = () => {
    if (dirty.current) setMaskOptions(clip, { feather: draft });
    dirty.current = false;
  };
  return (
    <label className="control">
      <span>Borde suave: {Math.round(draft * 1000)}</span>
      <input
        type="range"
        min={0}
        max={0.03}
        step={0.001}
        value={draft}
        onChange={(e) => {
          dirty.current = true;
          setDraft(Number(e.target.value));
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
    </label>
  );
}

/** The lasso's options and what to do with what it cut out (see state/lasso). */
export function LassoPanel() {
  const mode = useLasso((s) => s.mode);
  const whole = useLasso((s) => s.whole);
  const film = useEditor((s) => s.film);
  const cursor = useEditor((s) => s.cursor);
  const [hole, setHole] = useState(false);
  const set = useLasso.getState().set;
  const clip = film ? clipAt(film, cursor.track, cursor.cell) : undefined;
  const mask = clip?.look?.mask;
  const seq = clip?.seq && film ? sequenceClips(film, clip.seq) : [];
  const keys = seq.filter((c) => c.look?.mask?.key).length;

  return (
    <div className="lasso-panel">
      <div className="segmented tool-choice">
        <button className={mode === "free" ? "active" : ""} onClick={() => set({ mode: "free" })}>
          Lazo libre
        </button>
        <button className={mode === "rect" ? "active" : ""} onClick={() => set({ mode: "rect" })}>
          Rectángulo
        </button>
      </div>
      {!clip ? (
        <p className="hint">Elegí en la línea de tiempo la celda de una imagen y dibujá alrededor de lo que quieras dejar (un personaje, un objeto).</p>
      ) : !mask ? (
        <p className="hint">Dibujá alrededor de lo que quieras dejar. La foto no se toca: el lazo se cambia o se quita cuando quieras.</p>
      ) : (
        <>
          <p className="hint">
            Arrastrá cerca del contorno para empujar sus puntos, adentro para moverlo, o dibujá otro afuera. Lo que queda afuera se ve tenue mientras usás el lazo.
          </p>
          {seq.length > 1 && (
            <>
              <h4>Secuencia</h4>
              <label className="control toggle">
                <input type="checkbox" checked={whole} onChange={(e) => set({ whole: e.target.checked })} />
                <span>En toda la secuencia ({seq.length} imágenes)</span>
              </label>
              {whole && (
                <>
                  <p className="hint">
                    Dibujado a mano en {keys} de {seq.length} (contorno naranja); los demás (verde) se reparten entre esos. Para algo que se mueve: ajustá el contorno
                    en algunos cuadros, por ejemplo el primero, el del medio y el último.
                  </p>
                  <label className="control toggle">
                    <input type="checkbox" checked={!!mask.key} onChange={(e) => setKey(clip, e.target.checked)} />
                    <span>Esta imagen es clave (contorno a mano)</span>
                  </label>
                  <button className="btn small" onClick={() => reblend(clip)} disabled={!keys}>
                    Repartir de nuevo
                  </button>
                </>
              )}
            </>
          )}
          <h4>Recorte</h4>
          <div className="segmented tool-choice">
            <button className={!mask.invert ? "active" : ""} onClick={() => mask.invert && setMaskOptions(clip, { invert: false })}>
              Dejar lo de adentro
            </button>
            <button className={mask.invert ? "active" : ""} onClick={() => !mask.invert && setMaskOptions(clip, { invert: true })}>
              Dejar lo de afuera
            </button>
          </div>
          <FeatherSlider key={clip.id} clip={clip} />
          <h4>Llevar a otro track</h4>
          <p className="hint">Lo recortado pasa a un track nuevo arriba («Personaje»), donde lo podés mover, agrandar o girar. Uno por personaje.</p>
          <label className="control toggle">
            <input type="checkbox" checked={hole} onChange={(e) => setHole(e.target.checked)} />
            <span>Dejar un hueco en la imagen original</span>
          </label>
          <button className="btn small" onClick={() => takeToNewTrack(clip, hole)}>
            Llevar a un track nuevo
          </button>
          <button className="btn small danger" onClick={() => clearMasks(clip)}>
            <Icon name="trash" size={14} /> Quitar el lazo
          </button>
        </>
      )}
    </div>
  );
}
