import { useMemo } from "react";
import { useRemote } from "../capture/remote";
import { type Rig, rigColor, useCamera } from "../state/camera";
import { useLayers } from "../state/layers";
import { type StageTool, usePaint } from "../state/paint";
import { Icon, type IconName } from "./Icon";

export const TOOLS: { id: StageTool; icon: IconName; label: string; key: string }[] = [
  { id: "move", icon: "pointer", label: "Elegir", key: "V" },
  { id: "import", icon: "image", label: "Imágenes y videos", key: "M" },
  { id: "draw", icon: "brush", label: "Dibujar", key: "B" },
  { id: "erase", icon: "eraser", label: "Borrar", key: "E" },
  { id: "fill", icon: "fill", label: "Rellenar", key: "F" },
  { id: "tint", icon: "tint", label: "Teñir", key: "T" },
  { id: "shape", icon: "shape", label: "Formas", key: "U" },
  { id: "clone", icon: "stamp", label: "Sello de clonar", key: "S" },
  { id: "sculpt", icon: "sculpt", label: "Esculpir trazos", key: "K" },
  { id: "lasso", icon: "lasso", label: "Lazo", key: "A" },
  { id: "picker", icon: "picker", label: "Cuentagotas", key: "I" },
];

/** Cameras found but not in use: a webcam, a DSLR or a connected phone. */
export function useFreeCameras(): { id: string; label: string; group: string }[] {
  const rigs = useCamera((s) => s.rigs);
  const webcams = useCamera((s) => s.webcams);
  const dslrs = useCamera((s) => s.dslrs);
  const devices = useRemote((s) => s.devices);
  return useMemo(() => {
    const inUse = new Set(rigs.map((r) => r.source?.id ?? r.deviceId));
    return [
      ...webcams.map((w) => ({ id: w.id, label: w.label, group: "Webcam" })),
      ...dslrs.map((d) => ({ id: d.id, label: d.label, group: "Cámara réflex" })),
      ...devices.filter((d) => d.mode === "live").map((p) => ({ id: `phone:${p.sessionId}`, label: p.device, group: "Celular" })),
    ].filter((d) => !inUse.has(d.id));
  }, [rigs, webcams, dslrs, devices]);
}

/**
 * Choosing a tool shows its properties in the detail panel; choosing the one
 * in use lets it go, back to «Elegir».
 */
function showTool(tool: StageTool) {
  usePaint.getState().setTool(usePaint.getState().tool === tool ? "move" : tool);
  // "Elegir" stays chosen (it is where the others go back to).
  useLayers.setState({ panel: "tool" });
}

/** Choosing a camera as the tool asks where its photos go (the cell is picked in the timeline). */
export function chooseCamera(rigId: string) {
  const camera = useCamera.getState();
  usePaint.getState().setTool("camera");
  useLayers.setState({ panel: "tool" });
  if (camera.picking === rigId) camera.cancelPicking();
  else camera.startPicking(rigId);
}

function CameraTool({ rig, index }: { rig: Rig; index: number }) {
  const label = useCamera((s) => s.labelOf(rig.source?.id ?? rig.deviceId)) ?? "Cámara";
  const isActive = useCamera((s) => s.activeRig === rig.id);
  const cameraTool = usePaint((s) => s.tool === "camera");
  const active = isActive && cameraTool;
  const picking = useCamera((s) => s.picking === rig.id);
  const state = rig.recording ? "grabando" : rig.error ? "con un problema" : rig.opening ? "abriendo" : rig.enabled ? "" : "deshabilitada";
  return (
    <button
      className={`camera-tool${active ? " active" : ""}${picking ? " picking" : ""}${rig.enabled ? "" : " off"}${rig.recording ? " recording" : ""}${rig.error ? " error" : ""}`}
      style={{ ["--rig" as string]: rigColor(index) }}
      aria-pressed={active}
      title={`${label}${state ? ` (${state})` : ""}: tocala y después la celda donde van sus fotos (C)`}
      onClick={() => chooseCamera(rig.id)}
    >
      <Icon name="camera" size={18} />
      <span className="camera-tool-badge">{index + 1}</span>
    </button>
  );
}

/** The toolbar of the big picture (after Blender's Grease Pencil): moving pictures, cameras, and painting tools. */
export function StageTools() {
  const tool = usePaint((s) => s.tool);
  const rigs = useCamera((s) => s.rigs);
  const free = useFreeCameras();
  const [pick, importer, ...paint] = TOOLS;
  const button = (t: (typeof TOOLS)[number]) => (
    <button key={t.id} className={tool === t.id ? "active" : ""} aria-pressed={tool === t.id} title={`${t.label} (${t.key})`} onClick={() => showTool(t.id)}>
      <Icon name={t.icon} size={18} />
    </button>
  );

  return (
    <div className="stage-tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-buttons" role="toolbar" aria-label="Herramientas">
        {button(pick!)}
        {button(importer!)}
        <span className="tool-sep" />
        {rigs.map((r, i) => (
          <CameraTool key={r.id} rig={r} index={i} />
        ))}
        <button
          className={`camera-tool add${tool === "addCamera" ? " active" : ""}`}
          title={free.length ? `Agregar una cámara (${free.length} sin usar)` : "Agregar una cámara o conectar un celular"}
          onClick={() => showTool("addCamera")}
        >
          <Icon name="camera" size={18} />
          <span className="camera-tool-badge">+</span>
        </button>
        <span className="tool-sep" />
        {paint.map(button)}
      </div>
    </div>
  );
}
