import type { CameraControl } from "@gepetta/protocol";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { CameraControls } from "./CameraControls";

/** Settings used constantly while animating, shown over the live view instead of in the side panel. */
export const QUICK_KEYS = ["autofocusdrive", "manualfocusdrive", "eoszoom", "zoom", "focusMode", "focusDistance"];

export function isQuick(control: CameraControl) {
  return QUICK_KEYS.includes(control.key);
}

export function QuickControls() {
  const controls = useCamera((s) => s.controls);
  const kind = useCamera((s) => s.source?.kind);
  const view = useEditor((s) => s.view);
  const playing = useEditor((s) => s.playback !== null);
  const quick = QUICK_KEYS.flatMap((k) => controls.filter((c) => c.key === k));
  if (view !== "live" || playing || quick.length === 0) return null;
  return (
    <div className="quick-controls">
      <CameraControls
        controls={quick}
        slow={kind === "dslr"}
        compact
        onChange={(c, v) => void useCamera.getState().setControl(c, v)}
      />
    </div>
  );
}
