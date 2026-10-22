import { useEffect, useState } from "react";
import { useBusy } from "../state/busy";

/** A downloaded update installs when the app closes; this offers to do it now. */
function UpdateNotice() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const updates = window.gepetta?.updates;
    if (!updates) return;
    void updates.pending().then((v) => v && setVersion(v));
    return updates.onReady(setVersion);
  }, []);
  if (!version) return null;
  return (
    <div className="toast update">
      <span>Hay una versión nueva de Gepetta ({version}). Se instala al cerrar.</span>
      <button className="btn small" onClick={() => void window.gepetta?.updates.install()}>
        Actualizar ahora
      </button>
      <button className="btn small ghost" onClick={() => setVersion(null)}>
        Después
      </button>
    </div>
  );
}

export function Toasts() {
  const task = useBusy((s) => s.task);
  const message = useBusy((s) => s.message);
  return (
    <div className="toasts" aria-live="polite">
      {task && (
        <div className="toast">
          <span>
            {task.label}… {task.done}/{task.total}
          </span>
          <progress max={task.total} value={task.done} />
        </div>
      )}
      {message && <div className={`toast ${message.tone}`}>{message.text}</div>}
      <UpdateNotice />
    </div>
  );
}
