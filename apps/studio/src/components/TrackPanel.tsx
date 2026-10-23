import { type Clip, type ClipPatch, IDENTITY_TRANSFORM, PHOTO_TRACK, type Track } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { commitShot, shotOf, useShotPreview } from "../state/shot";
import { FrameInfo } from "./FrameInfo";
import { ShotEditor } from "./ShotEditor";
import { StrokesPanel } from "./StrokesPanel";
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

function Details({ track }: { track: Track }) {
  const film = useEditor((s) => s.film)!;
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  const update = (patch: Partial<Track>) => updateTrack(track.id, patch);
  const index = film.tracks.findIndex((t) => t.id === track.id);
  const commit = useEditor.getState().commit;
  const t = track.transform;
  const moved = t.x !== 0 || t.y !== 0 || t.rotation !== 0 || t.scale !== 1;

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

/** Settings of the one selected picture, with a way to its track. */
function ClipDetails({ clip }: { clip: Clip }) {
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === clip.track));
  const fps = useEditor((s) => s.film?.settings.fps ?? 12);
  const [name, setName] = useState(clip.name);
  useEffect(() => setName(clip.name), [clip.name]);
  const commit = useEditor.getState().commit;
  const update = (patch: ClipPatch) => commit([{ type: "clip.update", id: clip.id, patch }]);
  const seconds = (cells: number) => (cells / fps).toFixed(2).replace(/\.?0+$/, "");

  return (
    <div className="layer-details">
      <label className="control">
        <span>Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== clip.name && update({ name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      {track && (
        <button className="btn small ghost go-track" onClick={() => useLayers.getState().select(track.id)} title="Ver los ajustes del track">
          Track: <strong>{track.name}</strong> →
        </button>
      )}
      <p className="hint">
        Celdas {clip.start + 1}–{clip.start + clip.length} · desde {seconds(clip.start)} s, dura {seconds(clip.length)} s
      </p>
      <div className="control">
        <span>Duración</span>
        <span className="hold-control">
          <button className="icon-btn small" onClick={() => update({ length: clip.length - 1 })} disabled={clip.length <= 1}>
            <Icon name="minus" size={14} />
          </button>
          <span>
            ×{clip.length} {clip.length === 1 ? "celda" : "celdas"}
          </span>
          <button className="icon-btn small" onClick={() => update({ length: clip.length + 1 })}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </div>
      <label className="control toggle">
        <input type="checkbox" checked={clip.visible} onChange={(e) => update({ visible: e.target.checked })} />
        <span>Visible</span>
      </label>
      <StrokesPanel clip={clip} />
      <h4>Imagen</h4>
      <p className="hint">Arrastrala sobre la imagen grande para moverla; las esquinas la agrandan y el círculo la gira (con ⇧, en pasos).</p>
      <ShotEditor value={shotOf(clip)} onPreview={(change) => useShotPreview.setState({ preview: { ids: [clip.id], change } })} onCommit={(change) => commitShot([clip.id], change)} />
      <FrameInfo clip={clip} />
      <button
        className="btn small danger"
        onClick={() => commit([{ type: "clip.remove", ids: [clip.id] }], undefined, { selection: [] })}
      >
        <Icon name="trash" size={14} /> Borrar imagen
      </button>
    </div>
  );
}

/** Several pictures picked (a recorded video, for one): their settings changed together. */
function ManyDetails() {
  const selection = useEditor((s) => s.selection);
  const first = useEditor((s) => s.film?.clips[s.selection[0]!]);
  const commit = useEditor.getState().commit;
  if (!first) return null;
  return (
    <div className="layer-details">
      <p className="hint">
        <strong>{selection.length} imágenes</strong> elegidas. Moverlas o alargarlas se hace en la línea de tiempo.
      </p>
      <ShotEditor
        mixed
        value={shotOf(first)}
        onPreview={(change) => useShotPreview.setState({ preview: { ids: selection, change } })}
        onCommit={(change) => commitShot(selection, change)}
      />
      <button className="btn small danger" onClick={() => commit([{ type: "clip.remove", ids: selection }], undefined, { selection: [] })}>
        <Icon name="trash" size={14} /> Borrar las {selection.length} imágenes
      </button>
    </div>
  );
}

/**
 * The detail panel: the selected picture's settings, or a track's (from its
 * name in the timeline, or from "Track: …" in a picture's settings).
 */
export function DetailPanel() {
  const trackId = useLayers((s) => s.trackId);
  const detail = useLayers((s) => s.detail);
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === trackId) ?? null);
  const clip = useEditor((s) => (s.selection.length === 1 ? (s.film?.clips[s.selection[0]!] ?? null) : null));
  const many = useEditor((s) => s.selection.length > 1);

  // Undo can remove the selected track.
  useEffect(() => {
    if (trackId && !track) useLayers.getState().select(null);
  }, [trackId, track]);

  if (detail === "clip" && many) {
    return (
      <div className="layers-panel">
        <h3>Imágenes</h3>
        <ManyDetails />
      </div>
    );
  }
  if (detail === "clip" && clip) {
    return (
      <div className="layers-panel">
        <h3>Imagen</h3>
        <ClipDetails key={clip.id} clip={clip} />
      </div>
    );
  }
  return (
    <div className="layers-panel">
      <h3>Track</h3>
      {track ? (
        <>
          {clip && clip.track === track.id && (
            <button className="btn small ghost go-track" onClick={() => useLayers.getState().showClip(track.id)}>
              ← Volver a la imagen <strong>{clip.name}</strong>
            </button>
          )}
          <Details key={track.id} track={track} />
        </>
      ) : (
        <p className="hint">
          Tocá una imagen o el nombre de un track en la línea de tiempo para ver sus ajustes. Con «+ Track» agregás una capa vacía, una imagen fija o un video para rotoscopia.
        </p>
      )}
    </div>
  );
}
