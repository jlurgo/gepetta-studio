import { useState } from "react";

/** A part of a panel that opens and closes with its title. */
export function Section({ title, open: initial = true, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <button className="disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "▾" : "▸"} {title}
      </button>
      {open && <div className="tool-section">{children}</div>}
    </>
  );
}
