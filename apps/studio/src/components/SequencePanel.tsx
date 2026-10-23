import { type Clip, interpolateOps, relayOps, sequenceClips, setSequenceOps } from "@gepetta/core";
import { useEditor } from "../state/editor";
import { useLayers } from "../state/layers";
import { commitShot, shotOf, useShotPreview } from "../state/shot";
import { Icon } from "./Icon";
import { ShotEditor } from "./ShotEditor";
import { SequenceFade } from "./TrackPanel";

/** A color per sequence, to tell them apart in the timeline. */
export function sequenceColor(seq: string): string {
  let h = 0;
  for (let i = 0; i < seq.length; i++) h = (h * 31 + seq.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 60%)`;
}

/** How a sequence is called: after its first picture, with how many it has. */
export function sequenceName(clips: Clip[]): string {
  const first = clips[0];
  return first ? `${first.name} · ${clips.length} ${clips.length === 1 ? "imagen" : "imágenes"}` : "Secuencia";
}

/** A way from a picture (or several) to its sequence's details. */
export function SequenceLink({ seq }: { seq: string }) {
  const film = useEditor((s) => s.film);
  const clips = film ? sequenceClips(film, seq) : [];
  if (clips.length < 2) return null;
  return (
    <button className="btn small ghost go-track seq-link" style={{ ["--seq" as string]: sequenceColor(seq) }} onClick={() => useLayers.getState().showSequence(seq)} title="Ver la secuencia: cambios para todas sus imágenes">
      <span className="seq-dot" /> Secuencia: <strong>{sequenceName(clips)}</strong> →
    </button>
  );
}

/**
 * A sequence's details: its pictures as a whole — picking them, how long each
 * lasts, their order, a movement from the first to the last, fades, their
 * look — and taking it apart.
 */
export function SequencePanel({ seq }: { seq: string }) {
  const film = useEditor((s) => s.film);
  const seqHandles = useLayers((s) => s.seqHandles);
  if (!film) return null;
  const clips = sequenceClips(film, seq);
  if (!clips.length) return <p className="hint">Esta secuencia ya no tiene imágenes.</p>;
  const ids = clips.map((c) => c.id);
  const { commit, moveTo, setSelection } = useEditor.getState();
  const first = clips[0]!;
  const last = clips[clips.length - 1]!;
  const lengths = new Set(clips.map((c) => c.length));
  const each = lengths.size === 1 ? first.length : null;
  const tracks = [...new Set(clips.map((c) => film.tracks.find((t) => t.id === c.track)?.name ?? ""))];
  const relay = (length?: number, reverse = false) => commit(relayOps(film, seq, length, reverse), reverse ? "Invertir la secuencia" : `Secuencia: cada imagen ${length} ${length === 1 ? "celda" : "celdas"}`);

  return (
    <div className="layer-details sequence-panel" style={{ ["--seq" as string]: sequenceColor(seq) }}>
      <p className="seq-title">
        <span className="seq-dot" /> <strong>{sequenceName(clips)}</strong>
      </p>
      <p className="hint">
        Celdas {first.start + 1}–{last.start + last.length} · {tracks.join(", ")}
      </p>
      <div className="action-row">
        <button className="btn small" onClick={() => setSelection(ids)}>
          Elegir sus imágenes
        </button>
        <button className="btn small" onClick={() => moveTo(first.start, first.track)}>
          ⇤ Primera
        </button>
        <button className="btn small" onClick={() => moveTo(last.start, last.track)}>
          Última ⇥
        </button>
      </div>

      <h4>Tiempo</h4>
      <div className="control">
        <span>Cada imagen dura</span>
        <span className="hold-control">
          <button className="icon-btn small" onClick={() => relay(Math.max(1, (each ?? 2) - 1))} disabled={each === 1}>
            <Icon name="minus" size={14} />
          </button>
          <span>{each === null ? "distinto" : `${each} ${each === 1 ? "celda" : "celdas"}`}</span>
          <button className="icon-btn small" onClick={() => relay((each ?? 0) + 1)}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </div>
      <button className="btn small" onClick={() => relay(undefined, true)}>
        ⇆ Invertir el orden
      </button>

      <h4>Movimiento</h4>
      <div className="segmented tool-choice">
        <button className={seqHandles === "all" ? "active" : ""} onClick={() => useLayers.setState({ seqHandles: "all" })} title="Las manijas mueven todas las imágenes juntas">
          Mover toda
        </button>
        <button className={seqHandles === "one" ? "active" : ""} onClick={() => useLayers.setState({ seqHandles: "one" })} title="Las manijas mueven solo la imagen de la celda elegida">
          Solo esta imagen
        </button>
      </div>
      <p className="hint">
        Para un movimiento: con «Solo esta imagen», ubicá la primera (⇤) y la última (⇥) con sus manijas; después repartilo entre las del medio.
      </p>
      <button className="btn small" disabled={clips.length < 3} onClick={() => commit(interpolateOps(film, seq), "Movimiento de la secuencia")}>
        Repartir el movimiento de la primera a la última
      </button>

      <SequenceFade ids={ids} />

      <h4>Imagen</h4>
      <ShotEditor
        mixed
        value={shotOf(first)}
        onPreview={(change) => useShotPreview.setState({ preview: { ids, change } })}
        onCommit={(change) => commitShot(ids, change)}
      />

      <div className="action-row">
        <button
          className="btn small"
          onClick={() => {
            commit(setSequenceOps(ids, null), "Separar la secuencia");
            useLayers.setState({ detail: "clip", seq: null, panel: "tool" });
          }}
          title="Las imágenes quedan, cada una por su cuenta"
        >
          Separar
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            commit([{ type: "clip.remove", ids }], `Borrar la secuencia (${ids.length} imágenes)`, { selection: [] });
            useLayers.setState({ detail: "clip", seq: null, panel: "tool" });
          }}
        >
          <Icon name="trash" size={14} /> Borrar la secuencia
        </button>
      </div>
    </div>
  );
}
