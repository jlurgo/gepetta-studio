import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog card" role="dialog" aria-label={title}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
