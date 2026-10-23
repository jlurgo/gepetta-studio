import { type Clip, clipAt, sequenceClips } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { clearMasks, clearPlate, reblend, setKey, setMaskOptions, setTolerance, takeToNewTrack, useLasso } from "../state/lasso";
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

/** How different from the background plate a color must be to stay, changed live and kept when let go. */
function ToleranceSlider({ clip }: { clip: Clip }) {
  const value = clip.look?.mask?.plate?.tolerance ?? 0.12;
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const finish = () => {
    if (dirty.current) setTolerance(clip, draft);
    dirty.current = false;
  };
  return (
    <label className="control">
      <span>Sensibilidad: {Math.round((1 - draft / 0.4) * 100)} %</span>
      <input
        type="range"
        min={0.02}
        max={0.4}
        step={0.01}
        value={0.42 - draft}
        title="Más: deja también lo que cambió poco (sombras); menos: solo lo que cambió mucho"
        onChange={(e) => {
          dirty.current = true;
          setDraft(Math.round((0.42 - Number(e.target.value)) * 100) / 100);
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
    </label>
  );
}

/**
 * Taking the background away: with a photo of the empty set (from the same
 * place), only what differs from it stays, inside the outline.
 */
function PlateSection({ clip }: { clip: Clip }) {
  const plate = clip.look?.mask?.plate;
  const picking = useLasso((s) => s.pickingPlate === clip.id);
  const plateName = useEditor((s) => (plate ? Object.values(s.film?.clips ?? {}).find((c) => c.media.original === plate.media.original)?.name : undefined));
  return (
    <>
      <h4>Sacar el fondo</h4>
      {!plate ? (
        <p className="hint">
          Con una foto del decorado vacío, sacada desde el mismo lugar, queda solo lo que cambió: el personaje, sin el fondo (dentro del lazo, si hay uno).
        </p>
      ) : (
        <>
          <p className="hint">
            Fondo vacío: <strong>{plateName ?? "una imagen"}</strong>. Si se come partes del personaje, subí la sensibilidad; si quedan pedazos del fondo, bajala o
            ajustá el lazo.
          </p>
          <ToleranceSlider key={clip.id} clip={clip} />
        </>
      )}
      <div className="action-row">
        <button
          className={`btn small${picking ? " active" : ""}`}
          onClick={() => useLasso.setState({ pickingPlate: picking ? null : clip.id })}
        >
          {picking ? "Tocá la celda del fondo vacío… (Esc)" : plate ? "Cambiar el fondo vacío" : "Elegir el fondo vacío"}
        </button>
        {plate && (
          <button className="btn small ghost" onClick={() => clearPlate(clip)}>
            Quitar
          </button>
        )}
      </div>
    </>
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
        <>
          <p className="hint">Dibujá alrededor de lo que quieras dejar. La foto no se toca: el lazo se cambia o se quita cuando quieras.</p>
          <PlateSection clip={clip} />
        </>
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
          <PlateSection clip={clip} />
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
