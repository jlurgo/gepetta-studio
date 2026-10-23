import { useMemo } from "react";
import { useRemote } from "../capture/remote";
import { capture, startRecording, stopRecording } from "../state/actions";
import { type Rig, useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { Icon } from "./Icon";

/** One color per camera, to tell their targets apart in the timeline. */
export const RIG_COLORS = ["#ff5b5b", "#5cc8b5", "#ffd84a", "#b98cff", "#ff9a3d"];

export function rigColor(rigs: Rig[], id: string): string {
  return RIG_COLORS[rigs.findIndex((r) => r.id === id) % RIG_COLORS.length] ?? RIG_COLORS[0]!;
}

function RigRow({ rig, index }: { rig: Rig; index: number }) {
  const active = useCamera((s) => s.activeRig === rig.id);
  const label = useCamera((s) => s.labelOf(rig.source?.id ?? rig.deviceId)) ?? "Cámara";
  const many = useCamera((s) => s.rigs.length > 1);
  const picking = useCamera((s) => s.picking === rig.id);
  const film = useEditor((s) => s.film);
  const target = rig.target;
  const trackName = film?.tracks.find((t) => t.id === target.track)?.name ?? "";
  const color = RIG_COLORS[index % RIG_COLORS.length];

  return (
    <div className={`rig-row${active ? " active" : ""}${picking ? " picking" : ""}`} style={{ "--rig": color } as React.CSSProperties}>
      <input
        type="checkbox"
        className="rig-enabled"
        checked={rig.enabled}
        onChange={(e) => useCamera.getState().setEnabled(rig.id, e.target.checked)}
        title={rig.enabled ? "Habilitada: saca foto con el botón grande" : "Deshabilitada: no saca foto con el botón grande"}
      />
      <button
        className="rig-name"
        onClick={() => (picking ? useCamera.getState().cancelPicking() : useCamera.getState().startPicking(rig.id))}
        title="Elegir en la línea de tiempo la celda donde van las fotos de esta cámara"
      >
        <span className="rig-dot" style={{ background: color }}>
          {index + 1}
        </span>
        <span className="rig-text">
          <strong>{label}</strong>
          <small>
            {picking
              ? "Tocá la celda donde van sus fotos…"
              : rig.recording
                ? `● grabando · ${rig.recording.cells} ${rig.recording.cells === 1 ? "imagen" : "imágenes"}`
                : rig.error
                  ? rig.error.message
                  : rig.opening
                    ? "abriendo…"
                    : `${trackName} · celda ${target.cell + 1}`}
          </small>
        </span>
      </button>
      <button className="icon-btn small" onClick={() => void capture(rig.id)} disabled={!rig.source || !!rig.recording} title="Sacar una foto con esta cámara">
        <Icon name="camera" size={15} />
      </button>
      <button
        className={`icon-btn small${rig.recording ? " recording" : ""}`}
        onClick={() => void (rig.recording ? stopRecording(rig.id) : startRecording(rig.id))}
        disabled={!rig.source}
        title={rig.recording ? "Detener la grabación" : "Grabar video con esta cámara (una imagen por celda)"}
      >
        <Icon name={rig.recording ? "stop" : "record"} size={15} />
      </button>
      {many && (
        <button className="icon-btn small" onClick={() => useCamera.getState().removeCamera(rig.id)} disabled={!!rig.recording} title="Dejar de usar esta cámara">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** The cameras in use, each with its target; one more can be added. */
export function CamerasList() {
  const rigs = useCamera((s) => s.rigs);
  const webcams = useCamera((s) => s.webcams);
  const dslrs = useCamera((s) => s.dslrs);
  const devices = useRemote((s) => s.devices);
  const phones = useMemo(() => devices.filter((d) => d.mode === "live"), [devices]);
  const inUse = new Set(rigs.map((r) => r.source?.id ?? r.deviceId));
  const free = [
    ...webcams.map((w) => ({ id: w.id, label: w.label, group: "Webcams" })),
    ...dslrs.map((d) => ({ id: d.id, label: d.label, group: "Cámaras réflex" })),
    ...phones.map((p) => ({ id: `phone:${p.sessionId}`, label: p.device, group: "Celulares" })),
  ].filter((d) => !inUse.has(d.id));

  return (
    <div className="rigs">
      <h3>Cámaras</h3>
      {rigs.map((r, i) => (
        <RigRow key={r.id} rig={r} index={i} />
      ))}
      {free.length > 0 && (
        <select
          className="rig-add"
          value=""
          onChange={(e) => e.target.value && void useCamera.getState().addCamera(e.target.value)}
          title="Usar otra cámara a la vez, con su propio track y celda"
        >
          <option value="">+ Agregar otra cámara…</option>
          {free.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.group.toLowerCase()})
            </option>
          ))}
        </select>
      )}
      <p className="hint">
        Tocá una cámara y después, en la línea de tiempo, la celda donde van sus fotos. El botón grande saca con todas las habilitadas a la vez.
      </p>
    </div>
  );
}
