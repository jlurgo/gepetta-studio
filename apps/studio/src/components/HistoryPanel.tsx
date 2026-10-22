import type { HistoryEntry, Op } from "@gepetta/core";
import { canRedo, canUndo, cellOfOp } from "@gepetta/core";
import { useState } from "react";
import { useEditor } from "../state/editor";
import { Icon } from "./Icon";

/** The single numeric/text parameter an op exposes for editing, if any. */
function editableParam(op: Op): { label: string; value: string; numeric: boolean; apply(v: string): Op | null } | null {
  switch (op.type) {
    case "clip.update":
      if (op.patch.length === undefined || Object.keys(op.patch).length !== 1) return null;
      return {
        label: "Duración (celdas)",
        value: String(op.patch.length),
        numeric: true,
        apply: (v) => (Number(v) >= 1 ? { ...op, patch: { length: Math.round(Number(v)) } } : null),
      };
    case "film.setLength":
      return {
        label: "Largo (celdas)",
        value: String(op.length),
        numeric: true,
        apply: (v) => (Number(v) >= 0 ? { ...op, length: Math.round(Number(v)) } : null),
      };
    case "film.setFps":
      return { label: "Cuadros/s", value: String(op.fps), numeric: true, apply: (v) => (Number(v) > 0 ? { ...op, fps: Number(v) } : null) };
    case "film.rename":
      return { label: "Nombre", value: op.name, numeric: false, apply: (v) => (v.trim() ? { ...op, name: v.trim() } : null) };
    default:
      return null;
  }
}

function EntryRow({ entry, index, active, error }: { entry: HistoryEntry; index: number; active: boolean; error?: string }) {
  const { setCursor, setEntryEnabled, removeEntry, updateEntryOp, moveTo } = useEditor.getState();
  const [open, setOpen] = useState(false);
  const op = entry.ops.length === 1 ? entry.ops[0]! : null;
  const param = op ? editableParam(op) : null;
  const [draft, setDraft] = useState(param?.value ?? "");

  return (
    <li className={`entry${active ? "" : " future"}${entry.enabled ? "" : " disabled"}${error ? " error" : ""}`}>
      <div className="entry-row">
        <input
          type="checkbox"
          checked={entry.enabled}
          title={entry.enabled ? "Desactivar este paso" : "Activar este paso"}
          onChange={(e) => setEntryEnabled(entry.id, e.target.checked)}
        />
        <button
          className="entry-label"
          title="Ir a este punto de la historia"
          onClick={() => {
            setCursor(index + 1);
            const cell = op ? cellOfOp(op) : null;
            if (cell !== null) moveTo(cell);
          }}
        >
          <span>{entry.label}</span>
          {error && <small className="entry-error">⚠ {error}</small>}
        </button>
        {param && (
          <button
            className="icon-btn"
            title="Editar"
            onClick={() => {
              setDraft(param.value);
              setOpen(!open);
            }}
          >
            <Icon name="settings" size={16} />
          </button>
        )}
        <button className="icon-btn" title="Quitar este paso" onClick={() => removeEntry(entry.id)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {open && param && op && (
        <form
          className="entry-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const next = param.apply(draft);
            if (next) updateEntryOp(entry.id, 0, next);
            setOpen(false);
          }}
        >
          <label>
            {param.label}
            <input type={param.numeric ? "number" : "text"} min={1} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          </label>
          <button className="btn small primary">Aplicar</button>
        </form>
      )}
    </li>
  );
}

export function HistoryPanel() {
  const history = useEditor((s) => s.history);
  const errors = useEditor((s) => s.errors);
  const { undo, redo, setCursor } = useEditor.getState();
  if (!history) return null;

  return (
    <aside className="side-panel history">
      <div className="row spread">
        <h3>Historial</h3>
        <div className="row">
          <button className="icon-btn" disabled={!canUndo(history)} onClick={undo} title="Deshacer (⌘Z)">
            <Icon name="undo" size={18} />
          </button>
          <button className="icon-btn" disabled={!canRedo(history)} onClick={redo} title="Rehacer (⇧⌘Z)">
            <Icon name="redo" size={18} />
          </button>
        </div>
      </div>
      <p className="hint">Tocá un paso para volver a ese momento. Podés desactivar, quitar o editar cualquier paso y el resto se recalcula.</p>
      <ol className="entries">
        <li className={`entry start${history.cursor === 0 ? " at-cursor" : ""}`}>
          <button className="entry-label" onClick={() => setCursor(0)}>
            Película vacía
          </button>
        </li>
        {history.entries.map((entry, i) => (
          <EntryRowWithCursor key={entry.id} entry={entry} index={i} cursor={history.cursor} error={errors[entry.id]} />
        ))}
      </ol>
    </aside>
  );
}

function EntryRowWithCursor({ entry, index, cursor, error }: { entry: HistoryEntry; index: number; cursor: number; error?: string }) {
  return (
    <>
      <EntryRow entry={entry} index={index} active={index < cursor} error={error} />
      {index === cursor - 1 && <li className="cursor-marker" aria-label="Estado actual" />}
    </>
  );
}
