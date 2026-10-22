import type { GuideSettings, PerspectivePoints } from "@gepetta/core";
import { useEffect, useMemo } from "react";
import { useEditor } from "../state/editor";
import { guidesOf, useGuides } from "../state/guides";
import { Icon } from "./Icon";

const COLORS = ["#5cc8b5", "#ff7a45", "#ffd84a", "#ff5ca8", "#ffffff"];
const GRID_SIZES = [2, 3, 4, 6, 8, 10, 12, 16];
const PERSPECTIVES: { points: PerspectivePoints; label: string }[] = [
  { points: 0, label: "No" },
  { points: 1, label: "1" },
  { points: 2, label: "2" },
  { points: 3, label: "3" },
];

/** Transport-bar button that shows the guides, plus their options panel. */
export function GuidesControl() {
  const filmId = useEditor((s) => s.filmId)!;
  const stored = useGuides((s) => s.byFilm[filmId]);
  const g = useMemo(() => guidesOf(stored), [stored]);
  const open = useGuides((s) => s.editing);
  const { update, setEditing } = useGuides.getState();
  const set = (patch: Partial<GuideSettings>) => update(filmId, patch);

  // Leaving the editor must not leave the stage zoomed out for placing points.
  useEffect(() => () => useGuides.getState().setEditing(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setEditing]);

  return (
    <div className="group guides">
      <button className={`icon-btn${g.visible ? " active" : ""}`} onClick={() => set({ visible: !g.visible })} title="Guías (G)">
        <Icon name="grid" />
      </button>
      <button
        className={`icon-btn small${open ? " active" : ""}`}
        onClick={() => {
          if (!open && !g.visible) set({ visible: true });
          setEditing(!open);
        }}
        title="Elegir guías"
      >
        <Icon name="more" size={16} />
      </button>

      {open && (
        <div className="popover guides-panel" role="dialog" aria-label="Guías">
          <div className="popover-head">
            <strong>Guías</strong>
            <button className="icon-btn small" onClick={() => setEditing(false)} title="Cerrar (Esc)">
              <Icon name="close" size={16} />
            </button>
          </div>

          <label className="control toggle">
            <input type="checkbox" checked={g.thirds} onChange={(e) => set({ thirds: e.target.checked })} />
            <span>Tercios</span>
          </label>
          <label className="control toggle">
            <input type="checkbox" checked={g.center} onChange={(e) => set({ center: e.target.checked })} />
            <span>Centro</span>
          </label>
          <label className="control toggle">
            <input type="checkbox" checked={g.safe} onChange={(e) => set({ safe: e.target.checked })} />
            <span>Márgenes seguros</span>
          </label>
          <div className="control toggle">
            <label className="control toggle">
              <input type="checkbox" checked={g.grid.enabled} onChange={(e) => set({ grid: { ...g.grid, enabled: e.target.checked } })} />
              <span>Grilla</span>
            </label>
            <select
              value={g.grid.cols}
              disabled={!g.grid.enabled}
              onChange={(e) => set({ grid: { ...g.grid, cols: Number(e.target.value) } })}
              title="Columnas"
            >
              {GRID_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            ×
            <select
              value={g.grid.rows}
              disabled={!g.grid.enabled}
              onChange={(e) => set({ grid: { ...g.grid, rows: Number(e.target.value) } })}
              title="Filas"
            >
              {GRID_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="control">
            <span>Perspectiva: puntos de fuga</span>
            <div className="segmented">
              {PERSPECTIVES.map((p) => (
                <button
                  key={p.points}
                  className={g.perspective.points === p.points ? "active" : ""}
                  onClick={() => set({ perspective: { ...g.perspective, points: p.points } })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {g.perspective.points > 0 && (
            <>
              <label className="control">
                <span>Líneas por punto: {g.perspective.rays}</span>
                <input
                  type="range"
                  min={4}
                  max={40}
                  step={2}
                  value={g.perspective.rays}
                  onChange={(e) => set({ perspective: { ...g.perspective, rays: Number(e.target.value) } })}
                />
              </label>
              <p className="hint">Arrastrá los puntos numerados sobre la imagen. Los puntos 1 y 2 comparten el horizonte.</p>
            </>
          )}

          <div className="control">
            <span>Color</span>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${g.color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => set({ color: c })}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
          <label className="control">
            <span>Intensidad</span>
            <input type="range" min={0.15} max={1} step={0.05} value={g.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
          </label>
        </div>
      )}
    </div>
  );
}
