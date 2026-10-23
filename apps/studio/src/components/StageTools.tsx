import { addTrack } from "../state/actions";
import { useEditor } from "../state/editor";
import {
  BRUSHES,
  type BrushKind,
  PAINT_COLORS,
  SHAPES,
  type ShapeKind,
  type StageTool,
  currentSettings,
  hasSettings,
  isPainting,
  usePaint,
} from "../state/paint";
import { Icon, type IconName } from "./Icon";

export const TOOLS: { id: StageTool; icon: IconName; label: string; key: string }[] = [
  { id: "move", icon: "pointer", label: "Mover y elegir", key: "V" },
  { id: "draw", icon: "brush", label: "Dibujar", key: "B" },
  { id: "erase", icon: "eraser", label: "Borrar", key: "E" },
  { id: "fill", icon: "fill", label: "Rellenar", key: "F" },
  { id: "tint", icon: "tint", label: "Teñir", key: "T" },
  { id: "shape", icon: "shape", label: "Formas", key: "U" },
  { id: "clone", icon: "stamp", label: "Sello de clonar", key: "S" },
  { id: "picker", icon: "picker", label: "Cuentagotas", key: "I" },
];

const HINTS: Partial<Record<StageTool, string>> = {
  draw: "⌥/Alt+clic toma un color.",
  erase: "Fuerza baja: borra de a poco.",
  fill: "Rellena la zona cerrada donde hacés clic. ⌥/Alt+clic toma un color.",
  tint: "Cambia el color de lo ya dibujado, sin pintar afuera.",
  shape: "Arrastrá. ⇧ hace cuadrados, círculos y líneas a 45°.",
  clone: "⌥/Alt+clic elige de dónde copiar; puede ser otra celda (por ejemplo la foto anterior, para borrar un soporte).",
  picker: "Clic en la imagen para tomar su color.",
};

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange(v: T): void }) {
  return (
    <div className="segmented tool-choice">
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} className={k === value ? "active" : ""} onClick={() => onChange(k)}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

const BRUSH_LABELS = Object.fromEntries(Object.entries(BRUSHES).map(([k, b]) => [k, b.label])) as Record<BrushKind, string>;

/** Tools of the big picture (after Blender's Grease Pencil): moving pictures, or painting on the cell at the cursor. */
export function StageTools() {
  const p = usePaint();
  const { tool } = p;
  const { size, strength } = currentSettings();
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === s.cursor.track));
  const cell = useEditor((s) => s.cursor.cell);
  const usesColor = tool === "draw" || tool === "fill" || tool === "tint" || tool === "shape" || tool === "picker";

  return (
    <div className="stage-tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-buttons" role="toolbar" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? "active" : ""} aria-pressed={tool === t.id} title={`${t.label} (${t.key})`} onClick={() => p.setTool(t.id)}>
            <Icon name={t.icon} size={18} />
          </button>
        ))}
      </div>
      {isPainting(tool) && (
        <div className="tool-options">
          <strong className="tool-title">{TOOLS.find((t) => t.id === tool)?.label}</strong>
          {tool === "draw" && <Choice value={p.brush} options={BRUSH_LABELS} onChange={(brush) => p.set({ brush })} />}
          {tool === "shape" && (
            <>
              <Choice value={p.shape} options={SHAPES} onChange={(shape: ShapeKind) => p.set({ shape })} />
              <label className="control toggle">
                <input type="checkbox" checked={p.shapeFill} onChange={(e) => p.set({ shapeFill: e.target.checked })} />
                <span>Rellena</span>
              </label>
            </>
          )}
          {usesColor && (
            <div className="swatches">
              <span className="swatch-current" style={{ background: p.color }} title={`Color: ${p.color}`} />
              {PAINT_COLORS.map((c) => (
                <button key={c} className={c === p.color ? "active" : ""} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => p.set({ color: c })} />
              ))}
              <label className="swatch-custom" title="Otro color">
                <input type="color" value={p.color} onChange={(e) => p.set({ color: e.target.value })} />
              </label>
            </div>
          )}
          {hasSettings(tool) && (
            <>
              <label className="tool-size" title="Grosor ([ y ])">
                <span>Grosor</span>
                <input type="range" min={1} max={300} value={size} onChange={(e) => p.setCurrent({ size: Number(e.target.value) })} />
                <span>{size}</span>
              </label>
              <label className="tool-size">
                <span>Fuerza</span>
                <input type="range" min={0.05} max={1} step={0.05} value={strength} onChange={(e) => p.setCurrent({ strength: Number(e.target.value) })} />
                <span>{Math.round(strength * 100)} %</span>
              </label>
            </>
          )}
          {tool !== "shape" && hasSettings(tool) && (
            <label className="tool-size" title="Estabiliza el pulso">
              <span>Suavizado</span>
              <input type="range" min={0} max={1} step={0.05} value={p.smooth} onChange={(e) => p.set({ smooth: Number(e.target.value) })} />
              <span>{Math.round(p.smooth * 100)} %</span>
            </label>
          )}
          {tool === "fill" && (
            <label className="tool-size" title="Cuánto puede variar el color de lo que se rellena">
              <span>Tolerancia</span>
              <input type="range" min={0} max={100} value={p.fillTolerance} onChange={(e) => p.set({ fillTolerance: Number(e.target.value) })} />
              <span>{p.fillTolerance}</span>
            </label>
          )}
          {tool === "clone" && (
            <p className="tool-where">
              {p.cloneSource ? `Copia de la celda ${p.cloneSource.cell + 1}` : "Sin origen todavía"}
              {p.cloneSource && (
                <button className="link" onClick={() => p.setCloneSource(null)}>
                  Quitar
                </button>
              )}
            </p>
          )}
          {HINTS[tool] && <p className="hint">{HINTS[tool]}</p>}
          {tool !== "picker" && track && (
            <p className={`tool-where${track.visible ? "" : " warn"}`}>
              {track.visible ? "En " : "Track oculto: "}
              <strong>{track.name}</strong>, celda {cell + 1}
            </p>
          )}
          {tool !== "picker" && (
            <button className="btn small" onClick={() => addTrack(`Dibujo ${useEditor.getState().film?.tracks.length ?? 0}`)}>
              <Icon name="plus" size={14} /> Capa de dibujo nueva
            </button>
          )}
        </div>
      )}
    </div>
  );
}
