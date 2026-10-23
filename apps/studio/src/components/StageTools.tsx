import { addTrack } from "../state/actions";
import { useEditor } from "../state/editor";
import { PAINT_COLORS, type StageTool, isPainting, usePaint } from "../state/paint";
import { Icon, type IconName } from "./Icon";

const TOOLS: { id: StageTool; icon: IconName; label: string; key: string }[] = [
  { id: "move", icon: "pointer", label: "Mover y elegir", key: "V" },
  { id: "brush", icon: "brush", label: "Pincel", key: "B" },
  { id: "eraser", icon: "eraser", label: "Borrador", key: "E" },
];

/** Tools of the big picture: moving pictures with their handles, or painting on the cell at the cursor. */
export function StageTools() {
  const tool = usePaint((s) => s.tool);
  const color = usePaint((s) => s.color);
  const size = usePaint((s) => (s.tool === "eraser" ? s.eraserSize : s.brushSize));
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === s.cursor.track));
  const cell = useEditor((s) => s.cursor.cell);
  const where = track ? { name: track.name, cell, hidden: !track.visible } : null;
  const paint = usePaint.getState();
  const setSize = (v: number) => paint.set(tool === "eraser" ? { eraserSize: v } : { brushSize: v });

  return (
    <div className="stage-tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-buttons" role="toolbar" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "active" : ""}
            aria-pressed={tool === t.id}
            title={`${t.label} (${t.key})`}
            onClick={() => paint.setTool(t.id)}
          >
            <Icon name={t.icon} size={18} />
          </button>
        ))}
      </div>
      {isPainting(tool) && (
        <div className="tool-options">
          {tool === "brush" && (
            <div className="swatches">
              {PAINT_COLORS.map((c) => (
                <button
                  key={c}
                  className={c === color ? "active" : ""}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => paint.set({ color: c })}
                />
              ))}
              <label className="swatch-custom" title="Otro color">
                <input type="color" value={color} onChange={(e) => paint.set({ color: e.target.value })} />
              </label>
            </div>
          )}
          <label className="tool-size" title="Grosor ([ y ])">
            <span>Grosor</span>
            <input type="range" min={1} max={200} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <span>{size}</span>
          </label>
          {where && (
            <p className={`tool-where${where.hidden ? " warn" : ""}`}>
              {where.hidden ? "Track oculto: " : "Dibuja en "}
              <strong>{where.name}</strong>, celda {where.cell + 1}
            </p>
          )}
          <button className="btn small" onClick={() => addTrack(`Dibujo ${(useEditor.getState().film?.tracks.length ?? 0)}`)}>
            <Icon name="plus" size={14} /> Capa de dibujo nueva
          </button>
          <p className="hint">← → cambia de celda (con papel de cebolla).</p>
        </div>
      )}
    </div>
  );
}
