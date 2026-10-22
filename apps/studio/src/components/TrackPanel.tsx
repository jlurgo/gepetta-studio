import { IDENTITY_TRANSFORM, PHOTO_TRACK, type Track } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { Icon } from "./Icon";

/** Slider that shows changes live and records one history step when released. */
export function OpacitySlider({ value, onCommit, label = true }: { value: number; onCommit(v: number): void; label?: boolean }) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const finish = () => {
    if (dirty.current) onCommit(draft);
    dirty.current = false;
  };
  const input = (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={draft}
      title={`Opacidad ${Math.round(draft * 100)} %`}
      onChange={(e) => {
        dirty.current = true;
        setDraft(Number(e.target.value));
      }}
      onPointerUp={finish}
      onKeyUp={finish}
      onBlur={finish}
    />
  );
  if (!label) return input;
  return (
    <label className="control">
      <span>Opacidad: {Math.round(draft * 100)} %</span>
      {input}
    </label>
  );
}

function frameLabel(frameOrder: string[], id: string | null, fallback: string) {
  if (!id) return fallback;
  const i = frameOrder.indexOf(id);
  return i < 0 ? fallback : `el cuadro ${i + 1}`;
}

const KIND_LABEL: Record<Track["source"]["kind"], string> = {
  cells: "Un dibujo o imagen por cuadro",
  image: "Imagen fija",
  sequence: "Video que avanza con la película",
};

function Details({ track }: { track: Track }) {
  const film = useEditor((s) => s.film)!;
  const selectedFrame = useEditor((s) => s.selected);
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  const update = (patch: Partial<Track>) => updateTrack(track.id, patch);
  const index = film.tracks.findIndex((t) => t.id === track.id);
  const commit = useEditor.getState().commit;
  const t = track.transform;
  const moved = t.x !== 0 || t.y !== 0 || t.rotation !== 0 || t.scale !== 1;
  const spans = track.source.kind !== "cells";

  return (
    <div className="layer-details">
      <label className="control">
        <span>Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== track.name && update({ name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <p className="hint">{KIND_LABEL[track.source.kind]}</p>
      <OpacitySlider value={track.opacity} onCommit={(opacity) => update({ opacity })} />
      <label className="control toggle">
        <input type="checkbox" checked={track.visible} onChange={(e) => update({ visible: e.target.checked })} />
        <span>Visible</span>
      </label>
      <label className="control toggle">
        <input type="checkbox" checked={track.exported} onChange={(e) => update({ exported: e.target.checked })} />
        <span>Sale en la exportación</span>
      </label>

      <div className="control">
        <span>Lugar: {index === film.tracks.length - 1 ? "arriba de todo" : index === 0 ? "abajo de todo" : `${index + 1}.º desde abajo`}</span>
        <div className="action-row">
          <button
            className="btn small"
            onClick={() => commit([{ type: "track.move", trackId: track.id, index: index + 1 }])}
            disabled={index >= film.tracks.length - 1}
          >
            ▲ Subir
          </button>
          <button className="btn small" onClick={() => commit([{ type: "track.move", trackId: track.id, index: index - 1 }])} disabled={index <= 0}>
            ▼ Bajar
          </button>
        </div>
      </div>

      <div className="control">
        <span>Posición</span>
        <p className="hint">
          Arrastrá el track sobre la imagen para moverlo; las esquinas lo agrandan y el círculo lo gira (con ⇧, en pasos).
          {moved && ` Ahora: ${Math.round(t.scale * 100)} % · ${Math.round((t.rotation * 180) / Math.PI)}°.`}
        </p>
        <button className="btn small" onClick={() => update({ transform: IDENTITY_TRANSFORM })} disabled={!moved}>
          Restablecer posición
        </button>
      </div>

      {spans && (
        <div className="control">
          <span>
            Desde {frameLabel(film.frameOrder, track.from, "el principio")} hasta{" "}
            {frameLabel(film.frameOrder, track.to, track.source.kind === "sequence" ? "que termina" : "el final")}
          </span>
          <div className="action-row">
            <button className="btn small" disabled={!selectedFrame} onClick={() => update({ from: selectedFrame })}>
              Empieza acá
            </button>
            <button className="btn small" disabled={!selectedFrame} onClick={() => update({ to: selectedFrame })}>
              Termina acá
            </button>
            <button className="btn small ghost" disabled={!track.from && !track.to} onClick={() => update({ from: null, to: null })}>
              Toda
            </button>
          </div>
        </div>
      )}

      {track.id !== PHOTO_TRACK && (
        <button
          className="btn small danger"
          onClick={() => {
            commit([{ type: "track.remove", trackId: track.id }]);
            useLayers.getState().select(null);
          }}
        >
          <Icon name="trash" size={14} /> Borrar track
        </button>
      )}
    </div>
  );
}

/** Settings of the track selected in the timeline. */
export function TrackPanel() {
  const trackId = useLayers((s) => s.trackId);
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === trackId) ?? null);

  // Undo can remove the selected track.
  useEffect(() => {
    if (trackId && !track) useLayers.getState().select(null);
  }, [trackId, track]);

  return (
    <div className="layers-panel">
      <h3>Track</h3>
      {track ? (
        <Details key={track.id} track={track} />
      ) : (
        <p className="hint">Tocá el nombre de un track, abajo en la línea de tiempo, para ajustarlo. Con «+ Track» agregás capas, imágenes fijas o un video para rotoscopia.</p>
      )}
    </div>
  );
}
