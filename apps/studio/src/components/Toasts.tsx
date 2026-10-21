import { useBusy } from "../state/busy";

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
    </div>
  );
}
