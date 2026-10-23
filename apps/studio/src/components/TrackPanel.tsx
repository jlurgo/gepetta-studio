import { type Clip, type ClipPatch, IDENTITY_TRANSFORM, PHOTO_TRACK, type Track, clipAt, newId, setSequenceOps } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { useCamera } from "../state/camera";
import { selectStrokes, strokeName } from "../state/strokes";
import { commitShot, shotOf, useShotPreview } from "../state/shot";
import { FrameInfo } from "./FrameInfo";
import { ShotEditor } from "./ShotEditor";
import { STROKE_ICONS, StrokesPanel } from "./StrokesPanel";
import { SequenceLink, SequencePanel, sequenceColor } from "./SequencePanel";
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

/**
 * Settings of the one picture picked (an object of a cell, picked on the
 * stage or from its cell), with a way back to the cell and to its sequence.
 */
function ClipDetails({ clip }: { clip: Clip }) {
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
      <button className="btn small ghost go-track" onClick={() => showCellOf(clip)} title="Ver la celda donde está">
        ← Celda <strong>{cellShown(clip) + 1}</strong>
      </button>
      {clip.seq && <SequenceLink seq={clip.seq} />}
      <p className="hint">
        Celdas {clip.start + 1}–{clip.start + clip.length} · desde {seconds(clip.start)} s, dura {seconds(clip.length)} s
      </p>
      <label className="control toggle">
        <input type="checkbox" checked={clip.visible} onChange={(e) => update({ visible: e.target.checked })} />
        <span>Visible</span>
      </label>
      <StrokesPanel clip={clip} />
      <h4>Imagen</h4>
      <p className="hint">Arrastrala sobre la imagen grande para moverla; las esquinas la agrandan y el círculo la gira (con ⇧, en pasos).</p>
      <ShotEditor value={shotOf(clip)} onPreview={(change) => useShotPreview.setState({ preview: { ids: [clip.id], change } })} onCommit={(change) => commitShot([clip.id], change)} />
      <FadeControls clip={clip} />
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

/** The cell of a picture to go back to: the one looked at, if it is in the picture. */
function cellShown(clip: Clip): number {
  const { cursor } = useEditor.getState();
  return cursor.track === clip.track && cursor.cell >= clip.start && cursor.cell < clip.start + clip.length ? cursor.cell : clip.start;
}

function showCellOf(clip: Clip) {
  const { moveTo, setSelection } = useEditor.getState();
  moveTo(cellShown(clip), clip.track);
  setSelection([clip.id]);
  selectStrokes(null, []);
  useLayers.getState().showCell(clip.track);
}

/** Picks an object of a cell: its picture, or one of the picture's strokes. */
function pickObject(clip: Clip, strokeId?: string) {
  useEditor.getState().setSelection([clip.id]);
  selectStrokes(strokeId ? clip.id : null, strokeId ? [strokeId] : []);
  useLayers.getState().showClip(clip.track);
}

/**
 * The cell picked in a track's row (the one at the cursor): where it is, what
 * is in it (its picture and the picture's strokes, each one to pick), how many
 * cells the picture lasts, and a way to its track.
 */
function CellDetails() {
  const film = useEditor((s) => s.film)!;
  const cursor = useEditor((s) => s.cursor);
  const live = useCamera((s) => s.rigs.find((r) => {
    if (!r.source) return false;
    const t = s.targetOf(r);
    return t.track === cursor.track && t.cell === cursor.cell;
  }));
  const liveName = useCamera((s) => (live ? s.labelOf(live.source?.id ?? live.deviceId) : null));
  const track = film.tracks.find((t) => t.id === cursor.track);
  if (!track) return null;
  const clip = clipAt(film, track.id, cursor.cell);
  const fps = film.settings.fps;
  const commit = useEditor.getState().commit;
  const update = (patch: ClipPatch) => clip && commit([{ type: "clip.update", id: clip.id, patch }]);
  const strokes = [...(clip?.strokes ?? [])].reverse();

  return (
    <div className="layer-details">
      <p className="hint">
        {(cursor.cell / fps).toFixed(2).replace(/\.?0+$/, "")} s
      </p>
      <button className="btn small ghost go-track" onClick={() => useLayers.getState().select(track.id)} title="Ver los ajustes del track">
        Track: <strong>{track.name}</strong> →
      </button>
      {live && <p className="hint">Acá está en vivo la cámara {liveName ?? ""}: lo que saques va en esta celda.</p>}
      {!clip ? (
        !live && <p className="hint">Vacía. Lo que saques con la cámara, dibujes o importes va acá.</p>
      ) : (
        <>
          <h4>En la celda</h4>
          <ul className="stroke-list cell-objects">
            <li>
              <button className="stroke-pick" onClick={() => pickObject(clip)} title="Ver sus ajustes (también: tocala en la imagen grande con «Elegir»)">
                <Icon name="image" size={14} />
                <span>{clip.name}</span>
              </button>
              {clip.seq && <span className="seq-dot" style={{ ["--seq" as string]: sequenceColor(clip.seq) }} title="Parte de una secuencia" />}
            </li>
            {strokes.map((st) => (
              <li key={st.id} className={st.hidden ? "off" : ""}>
                <button className="stroke-pick" onClick={() => pickObject(clip, st.id)}>
                  <Icon name={STROKE_ICONS[st.tool]} size={14} />
                  <span>{strokeName(st)}</span>
                  {st.color && st.tool !== "erase" && <span className="stroke-color" style={{ background: st.color }} />}
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">Tocá un objeto acá o en la imagen grande (con «Elegir») para ver sus ajustes.</p>
          <div className="control">
            <span>Se ve durante</span>
            <span className="hold-control">
              <button className="icon-btn small" onClick={() => update({ length: clip.length - 1 })} disabled={clip.length <= 1}>
                <Icon name="minus" size={14} />
              </button>
              <span>
                {clip.length} {clip.length === 1 ? "celda" : "celdas"}
              </span>
              <button className="icon-btn small" onClick={() => update({ length: clip.length + 1 })}>
                <Icon name="plus" size={14} />
              </button>
            </span>
          </div>
          {clip.length > 1 && (
            <p className="hint">
              La misma imagen, de la celda {clip.start + 1} a la {clip.start + clip.length}.
            </p>
          )}
          <label className="control toggle">
            <input type="checkbox" checked={clip.visible} onChange={(e) => update({ visible: e.target.checked })} />
            <span>Visible</span>
          </label>
          <button className="btn small danger" onClick={() => commit([{ type: "clip.remove", ids: [clip.id] }], "Vaciar la celda", { selection: [] })}>
            <Icon name="trash" size={14} /> Vaciar{clip.length > 1 ? ` (las ${clip.length} celdas)` : ""}
          </button>
        </>
      )}
    </div>
  );
}

/** A number of cells, changed with − and +. */
function CellCount({ label, value, max, onChange }: { label: string; value: number; max: number; onChange(v: number): void }) {
  return (
    <div className="control">
      <span>{label}</span>
      <span className="hold-control">
        <button className="icon-btn small" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>
          <Icon name="minus" size={14} />
        </button>
        <span>{value === 0 ? "no" : `${value} ${value === 1 ? "celda" : "celdas"}`}</span>
        <button className="icon-btn small" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
          <Icon name="plus" size={14} />
        </button>
      </span>
    </div>
  );
}

/** A picture fading in over its first cells and out over its last ones (one that lasts several cells). */
function FadeControls({ clip }: { clip: Clip }) {
  const commit = useEditor.getState().commit;
  const fade = clip.fade ?? {};
  const set = (patch: { in?: number; out?: number }) => {
    const next = { ...fade, ...patch };
    commit([{ type: "clip.update", id: clip.id, patch: { fade: next.in || next.out ? next : undefined } }]);
  };
  return (
    <>
      <h4>Fundido</h4>
      {clip.length < 2 ? (
        <p className="hint">Dura una sola celda: para un fundido elegí varias imágenes seguidas (un video grabado, por ejemplo), o alargala.</p>
      ) : (
        <>
          <CellCount label="Aparece en" value={fade.in ?? 0} max={clip.length - 1} onChange={(v) => set({ in: v })} />
          <CellCount label="Desaparece en" value={fade.out ?? 0} max={clip.length - 1} onChange={(v) => set({ out: v })} />
        </>
      )}
    </>
  );
}

/**
 * Several pictures in a row fading: the first `n` appear little by little and
 * the last `n` go away (each picture's transparency, changeable after).
 */
function fadeSequence(ids: string[], how: "in" | "out", n: number) {
  const { film, commit } = useEditor.getState();
  if (!film) return;
  const clips = ids.map((id) => film.clips[id]!).filter(Boolean).sort((a, b) => a.start - b.start);
  const ends = how === "in" ? clips.slice(0, n) : clips.slice(-n).reverse();
  const ops = ends.map((c, i) => ({ type: "clip.update" as const, id: c.id, patch: { opacity: Math.round(((i + 1) / (n + 1)) * 100) / 100 } }));
  if (ops.length) commit(ops, how === "in" ? `Fundido de entrada en ${ops.length} imágenes` : `Fundido de salida en ${ops.length} imágenes`);
}

export function SequenceFade({ ids }: { ids: string[] }) {
  const [n, setN] = useState(Math.min(6, ids.length));
  return (
    <>
      <h4>Fundido</h4>
      <CellCount label="En" value={n} max={ids.length} onChange={(v) => setN(Math.max(1, v))} />
      <div className="action-row">
        <button className="btn small" onClick={() => fadeSequence(ids, "in", n)}>
          Aparecer al principio
        </button>
        <button className="btn small" onClick={() => fadeSequence(ids, "out", n)}>
          Desaparecer al final
        </button>
      </div>
      <p className="hint">Cambia la transparencia de las primeras o últimas imágenes, de a poco.</p>
    </>
  );
}

/** Several pictures picked (a recorded video, for one): their settings changed together. */
function ManyDetails() {
  const selection = useEditor((s) => s.selection);
  const first = useEditor((s) => s.film?.clips[s.selection[0]!]);
  const film = useEditor((s) => s.film);
  const commit = useEditor.getState().commit;
  // The sequence they all are in, if one.
  const seq = first?.seq;
  const shared = seq && film && selection.every((id) => film.clips[id]?.seq === seq) ? seq : null;
  if (!first) return null;
  return (
    <div className="layer-details">
      <p className="hint">
        <strong>{selection.length} imágenes</strong> elegidas. Moverlas o alargarlas se hace en la línea de tiempo.
      </p>
      {shared ? (
        <SequenceLink seq={shared} />
      ) : (
        <button
          className="btn small"
          onClick={() => {
            const seq = newId();
            commit(setSequenceOps(selection, seq), `Secuencia de ${selection.length} imágenes`);
            useLayers.getState().showSequence(seq);
          }}
          title="Para cambiarlas juntas desde su panel"
        >
          Hacer una secuencia con estas imágenes
        </button>
      )}
      <ShotEditor
        mixed
        value={shotOf(first)}
        onPreview={(change) => useShotPreview.setState({ preview: { ids: selection, change } })}
        onCommit={(change) => commitShot(selection, change)}
      />
      <SequenceFade ids={selection} />
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
  const seqId = useLayers((s) => s.seq);
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === trackId) ?? null);
  const clip = useEditor((s) => (s.selection.length === 1 ? (s.film?.clips[s.selection[0]!] ?? null) : null));
  const many = useEditor((s) => s.selection.length > 1);
  const cursorCell = useEditor((s) => s.cursor.cell);

  // Undo can remove the selected track.
  useEffect(() => {
    if (trackId && !track) useLayers.getState().select(null);
  }, [trackId, track]);

  if (detail === "sequence" && seqId) {
    return (
      <div className="layers-panel">
        <h3>Secuencia</h3>
        <SequencePanel key={seqId} seq={seqId} />
      </div>
    );
  }
  if (detail === "clip" && many) {
    return (
      <div className="layers-panel">
        <h3>Imágenes</h3>
        <ManyDetails />
      </div>
    );
  }
  if (detail === "cell" && !many) {
    return (
      <div className="layers-panel">
        <h3>Celda {cursorCell + 1}</h3>
        <CellDetails />
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
            <button className="btn small ghost go-track" onClick={() => showCellOf(clip)}>
              ← Volver a la celda <strong>{cellShown(clip) + 1}</strong>
            </button>
          )}
          <Details key={track.id} track={track} />
        </>
      ) : (
        <p className="hint">
          Tocá una celda o el nombre de un track en la línea de tiempo para ver sus ajustes. Con «+ Track» agregás una capa vacía, una imagen fija o un video para rotoscopia.
        </p>
      )}
    </div>
  );
}
