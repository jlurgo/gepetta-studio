import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/**
 * A window over the whole app (drawn at the page's top, whatever panel opens
 * it): closes with its ×, a click outside it, or Esc (which then does nothing
 * else in the editor).
 */
export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog card" role="dialog" aria-label={title}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Cerrar (Esc)">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
