import { useEffect, useState } from "react";
import { RESOLUTIONS, webcamSettings } from "../capture/webcam";
import type { DslrStatus } from "../native";
import { addTrack, capture, startRecording, stopRecording } from "../state/actions";
import { type Rig, rigColor, useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { BRUSHES, type BrushKind, PAINT_COLORS, SHAPES, type ShapeKind, type StageTool, currentSettings, hasSettings, usePaint } from "../state/paint";
import { CameraControls } from "./CameraControls";
import { FocusMeterPanel } from "./FocusMeterPanel";
import { FOCUS_KEYS, FocusPanel } from "./FocusPanel";
import { Icon } from "./Icon";
import { MagnifyPanel, ZOOM_KEYS } from "./MagnifyPanel";
import { PhoneConnect } from "./PhoneConnect";
import { applyChange } from "../state/shot";
import { ShotEditor } from "./ShotEditor";
import { TOOLS, chooseCamera, useFreeCameras } from "./StageTools";

const HINTS: Partial<Record<StageTool, string>> = {
  draw: "⌥/Alt+clic toma un color.",
  erase: "Fuerza baja: borra de a poco.",
  fill: "Rellena la zona cerrada donde hacés clic. ⌥/Alt+clic toma un color.",
  tint: "Cambia el color de lo ya dibujado, sin pintar afuera.",
  shape: "Arrastrá. ⇧ hace cuadrados, círculos y líneas a 45°.",
  clone: "⌥/Alt+clic elige de dónde copiar; puede ser otra celda (por ejemplo la foto anterior, para borrar un soporte).",
  picker: "Clic en la imagen para tomar su color.",
};

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange(v: T): void }) {
  return (
    <div className="segmented tool-choice">
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} className={k === value ? "active" : ""} onClick={() => onChange(k)}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

function Section({ title, open: initial = true, children }: { title: string; open?: boolean; children: React.ReactNode }) {
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

const BRUSH_LABELS = Object.fromEntries(Object.entries(BRUSHES).map(([k, b]) => [k, b.label])) as Record<BrushKind, string>;

/** Brushes, colors, width and strength of the drawing tools. */
function PaintOptions() {
  const p = usePaint();
  const { tool } = p;
  const { size, strength } = currentSettings();
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === s.cursor.track));
  const cell = useEditor((s) => s.cursor.cell);
  const usesColor = tool === "draw" || tool === "fill" || tool === "tint" || tool === "shape" || tool === "picker";

  return (
    <div className="tool-options">
      {tool === "draw" && <Choice value={p.brush} options={BRUSH_LABELS} onChange={(brush) => p.set({ brush })} />}
      {tool === "shape" && (
        <>
          <Choice value={p.shape} options={SHAPES} onChange={(shape: ShapeKind) => p.set({ shape })} />
          <label className="control toggle">
            <input type="checkbox" checked={p.shapeFill} onChange={(e) => p.set({ shapeFill: e.target.checked })} />
            <span>Rellena</span>
          </label>
        </>
      )}
      {usesColor && (
        <div className="swatches">
          <span className="swatch-current" style={{ background: p.color }} title={`Color: ${p.color}`} />
          {PAINT_COLORS.map((c) => (
            <button key={c} className={c === p.color ? "active" : ""} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => p.set({ color: c })} />
          ))}
          <label className="swatch-custom" title="Otro color">
            <input type="color" value={p.color} onChange={(e) => p.set({ color: e.target.value })} />
          </label>
        </div>
      )}
      {hasSettings(tool) && (
        <>
          <label className="tool-size" title="Grosor ([ y ])">
            <span>Grosor</span>
            <input type="range" min={1} max={300} value={size} onChange={(e) => p.setCurrent({ size: Number(e.target.value) })} />
            <span>{size}</span>
          </label>
          <label className="tool-size">
            <span>Fuerza</span>
            <input type="range" min={0.05} max={1} step={0.05} value={strength} onChange={(e) => p.setCurrent({ strength: Number(e.target.value) })} />
            <span>{Math.round(strength * 100)} %</span>
          </label>
        </>
      )}
      {tool !== "shape" && hasSettings(tool) && (
        <label className="tool-size" title="Estabiliza el pulso">
          <span>Suavizado</span>
          <input type="range" min={0} max={1} step={0.05} value={p.smooth} onChange={(e) => p.set({ smooth: Number(e.target.value) })} />
          <span>{Math.round(p.smooth * 100)} %</span>
        </label>
      )}
      {tool === "fill" && (
        <label className="tool-size" title="Cuánto puede variar el color de lo que se rellena">
          <span>Tolerancia</span>
          <input type="range" min={0} max={100} value={p.fillTolerance} onChange={(e) => p.set({ fillTolerance: Number(e.target.value) })} />
          <span>{p.fillTolerance}</span>
        </label>
      )}
      {tool === "clone" && (
        <p className="tool-where">
          {p.cloneSource ? `Copia de la celda ${p.cloneSource.cell + 1}` : "Sin origen todavía"}
          {p.cloneSource && (
            <button className="link" onClick={() => p.setCloneSource(null)}>
              Quitar
            </button>
          )}
        </p>
      )}
      {HINTS[tool] && <p className="hint">{HINTS[tool]}</p>}
      {tool !== "picker" && track && (
        <p className={`tool-where${track.visible ? "" : " warn"}`}>
          {track.visible ? "En " : "Track oculto: "}
          <strong>{track.name}</strong>, celda {cell + 1}
        </p>
      )}
      {tool !== "picker" && (
        <button className="btn small" onClick={() => addTrack(`Dibujo ${useEditor.getState().film?.tracks.length ?? 0}`)}>
          <Icon name="plus" size={14} /> Capa de dibujo nueva
        </button>
      )}
    </div>
  );
}

/** Shown in their own sections, not under "Ajustes de la cámara". */
const isSectioned = (c: { kind: string; key: string }) =>
  c.kind === "focus" || c.kind === "magnify" || FOCUS_KEYS.includes(c.key) || ZOOM_KEYS.includes(c.key);

function useDslrStatus(): DslrStatus | null {
  const [status, setStatus] = useState<DslrStatus | null>(null);
  useEffect(() => {
    window.gepetta?.dslr.status().then(setStatus, () => setStatus(null));
  }, []);
  return status;
}

/** Turn the picture of cameras mounted or held sideways; phones can follow their motion sensor. */
function OrientationControl() {
  const label = useCamera((s) => s.sourceLabel());
  const chosen = useCamera((s) => (label ? s.rotations[label] : undefined));
  const canAuto = useCamera((s) => typeof s.source?.autoRotation === "function");
  const rotation = useCamera((s) => s.rotation());
  // Re-render when a phone reports a new orientation.
  useCamera((s) => s.autoRotation);
  const auto = typeof chosen !== "number";
  const { rotate } = useCamera.getState();
  return (
    <div className="control">
      <span>Orientación de la cámara</span>
      <div className="action-row rotation">
        <button className="btn small" onClick={() => rotate(-90)} title="Girar a la izquierda">
          ⟲
        </button>
        <span className="rotation-value">{auto && canAuto ? `Automática · ${rotation}°` : `${rotation}°`}</span>
        <button className="btn small" onClick={() => rotate(90)} title="Girar a la derecha">
          ⟳
        </button>
        {canAuto && !auto && (
          <button className="btn small ghost" onClick={() => rotate("auto")} title="Seguir cómo se sostiene el celular">
            Auto
          </button>
        )}
      </div>
    </div>
  );
}

/** Where the camera's photos go, and the cell picking. */
function CameraTarget({ rig, color }: { rig: Rig; color: string }) {
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === rig.target.track));
  const picking = useCamera((s) => s.picking === rig.id);
  return (
    <div className="camera-target" style={{ ["--rig" as string]: color }}>
      <span>
        Sus fotos van a <strong>{track?.name ?? "—"}</strong>, celda {rig.target.cell + 1}
      </span>
      <button className={`btn small${picking ? " active" : ""}`} onClick={() => chooseCamera(rig.id)}>
        {picking ? "Elegí la celda… (Esc)" : "Elegir celda"}
      </button>
    </div>
  );
}

/** The active camera as a tool: where its photos go, how they look, and the camera's own settings. */
function CameraToolPanel() {
  const rig = useCamera((s) => s.rigs.find((r) => r.id === s.activeRig));
  const index = useCamera((s) => s.rigs.findIndex((r) => r.id === s.activeRig));
  const label = useCamera((s) => (rig ? s.labelOf(rig.source?.id ?? rig.deviceId) : null)) ?? "Cámara";
  const many = useCamera((s) => s.rigs.length > 1);
  const { resolutionId, source, controls, error } = useCamera();
  const { selectResolution, setControl, start } = useCamera.getState();
  const captureAverage = useEditor((s) => s.captureAverage);
  if (!rig) return <AddCameraPanel />;
  const color = rigColor(index);
  const size = webcamSettings(source);
  const kind = source?.kind ?? (rig.deviceId?.split(":")[0] as string | undefined) ?? "webcam";
  const extra = controls.filter((c) => !isSectioned(c));

  return (
    <div className="tool-options camera-panel">
      <div className="camera-head">
        <span className="rig-dot" style={{ background: color }}>
          {index + 1}
        </span>
        <strong>{label}</strong>
        {rig.opening && <small>abriendo…</small>}
      </div>
      <CameraTarget rig={rig} color={color} />
      <label className="control toggle" title="Las cámaras habilitadas sacan juntas con el botón grande y la barra espaciadora">
        <input type="checkbox" checked={rig.enabled} onChange={(e) => useCamera.getState().setEnabled(rig.id, e.target.checked)} />
        <span>Saca con el botón grande</span>
      </label>
      <div className="action-row">
        <button className="btn small" onClick={() => void capture(rig.id)} disabled={!rig.source || !!rig.recording}>
          <Icon name="camera" size={14} /> Foto solo con esta
        </button>
        <button
          className={`btn small${rig.recording ? " recording" : ""}`}
          onClick={() => void (rig.recording ? stopRecording(rig.id) : startRecording(rig.id))}
          disabled={!rig.source}
          title="Una imagen por celda, a la velocidad de la película"
        >
          <Icon name={rig.recording ? "stop" : "record"} size={14} /> {rig.recording ? `Detener (${rig.recording.cells})` : "Grabar video"}
        </button>
      </div>

      {error && (
        <div className="panel-error">
          {error.message}
          <div className="action-row">
            {error.code === "busy" && window.gepetta?.platform !== "win32" && (
              <button
                className="btn small"
                onClick={async () => {
                  await window.gepetta?.dslr.releaseUsb();
                  await start();
                }}
              >
                Liberar cámara
              </button>
            )}
            <button className="btn small" onClick={() => void start()}>
              Reintentar
            </button>
          </div>
        </div>
      )}

      <Section title="Imagen: tamaño, recorte, giro, transparencia, efectos">
        <p className="hint">Se ve en vivo y queda en cada foto o cuadro grabado; después se puede cambiar en cada uno. En la pantalla grande la arrastrás, la agrandás con las esquinas y la girás con el círculo.</p>
        <ShotEditor value={rig.shot} onPreview={(c) => useCamera.getState().setShot(rig.id, applyChange(rig.shot, c))} onCommit={() => undefined} />
      </Section>

      <Section title="Cámara: orientación, resolución" open={false}>
        {source && <OrientationControl />}
        {kind === "webcam" && (
          <label className="control">
            <span>Resolución {size.width ? <small>{size.width}×{size.height}</small> : null}</span>
            <select value={resolutionId} onChange={(e) => void selectResolution(e.target.value)}>
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {source?.kind === "webcam" && (
          <label className="control">
            <span>Promediar fotos (menos ruido)</span>
            <select value={captureAverage} onChange={(e) => useEditor.getState().set({ captureAverage: Number(e.target.value) })}>
              <option value={1}>No</option>
              <option value={2}>2 fotos</option>
              <option value={4}>4 fotos</option>
              <option value={8}>8 fotos</option>
            </select>
          </label>
        )}
      </Section>

      <Section title="Enfoque y lupa" open={false}>
        <FocusMeterPanel />
        <FocusPanel />
        <MagnifyPanel />
      </Section>

      <Section title="Ajustes de la cámara" open={false}>
        {source && extra.length === 0 && (
          <p className="hint">
            {source.kind === "webcam" ? "Esta webcam no permite ajustes desde acá. (En Mac las webcams exponen pocos controles.)" : "Esta cámara no informó ajustes."}
          </p>
        )}
        <CameraControls controls={extra} slow={source?.kind === "dslr"} onChange={(c, v) => void setControl(c, v)} />
      </Section>

      {many && (
        <button className="btn small danger" onClick={() => useCamera.getState().removeCamera(rig.id)} disabled={!!rig.recording}>
          <Icon name="close" size={14} /> Dejar de usar esta cámara
        </button>
      )}
    </div>
  );
}

/** Cameras found and not in use, phones, and looking for more. */
function AddCameraPanel() {
  const free = useFreeCameras();
  const dslrStatus = useDslrStatus();
  const [searching, setSearching] = useState(false);
  const [phones, setPhones] = useState(false);
  async function search() {
    setSearching(true);
    await useCamera.getState().refreshDevices();
    setSearching(false);
  }
  return (
    <div className="tool-options">
      <p className="hint">Cada cámara es una herramienta: aparece en la barra, con sus fotos en su propio track y celda.</p>
      {free.length === 0 ? (
        <p className="hint">No hay otras cámaras conectadas.</p>
      ) : (
        <div className="free-cameras">
          {free.map((d) => (
            <button key={d.id} className="btn small" onClick={() => void useCamera.getState().addCamera(d.id).then(() => usePaint.getState().setTool("camera"))}>
              <Icon name="plus" size={14} /> {d.label} <small>({d.group.toLowerCase()})</small>
            </button>
          ))}
        </div>
      )}
      <button className="btn small ghost" onClick={() => void search()} disabled={searching}>
        {searching ? "Buscando…" : "Buscar cámaras conectadas"}
      </button>
      {dslrStatus && !dslrStatus.available && dslrStatus.hint && <p className="hint">{dslrStatus.hint}</p>}
      <button className="disclosure" onClick={() => setPhones(!phones)} aria-expanded={phones}>
        {phones ? "▾" : "▸"} Conectar celular
      </button>
      {phones && <PhoneConnect />}
    </div>
  );
}

/** The properties of the tool in use (the detail panel's "Herramienta" tab). */
export function ToolPanel() {
  const tool = usePaint((s) => s.tool);
  const meta = TOOLS.find((t) => t.id === tool);
  return (
    <div className="tool-panel">
      <h3>{tool === "camera" ? "Cámara" : tool === "addCamera" ? "Agregar cámara" : (meta?.label ?? "Herramienta")}</h3>
      {tool === "move" ? (
        <p className="hint">
          Tocá una imagen en la línea de tiempo para elegirla: en la pantalla grande la movés, la agrandás con las esquinas y la girás con el círculo. Sus ajustes están en
          «Detalle».
        </p>
      ) : tool === "camera" ? (
        <CameraToolPanel />
      ) : tool === "addCamera" ? (
        <AddCameraPanel />
      ) : (
        <PaintOptions />
      )}
    </div>
  );
}
