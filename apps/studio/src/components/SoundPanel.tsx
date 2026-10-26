import { type Clip, clipAt, clipEnd } from "@gepetta/core";
import { useEffect, useState } from "react";
import { audio, playRun, soundBuffer } from "../media/sound";
import { useEditor } from "../state/editor";
import { OpacitySlider } from "./TrackPanel";

const seconds = (s: number) => `${s.toLocaleString("es-AR", { maximumFractionDigits: 1 })} s`;

/** Plays a sound clip whole, from its first cell. */
async function listen(clip: Clip) {
  const { filmId, film } = useEditor.getState();
  if (!filmId || !film || !clip.sound) return;
  const ctx = audio();
  const buffer = await soundBuffer(filmId, clip.sound.ref);
  const track = film.tracks.find((t) => t.id === clip.track);
  playRun(ctx, ctx.destination, buffer, { track: clip.track, clip, at: 0, cell: clip.start, count: clip.length }, film.settings.fps, ctx.currentTime, (track?.opacity ?? 1) * clip.opacity);
}

/**
 * A sound clip's settings (the one picked, or the one at the cursor in a
 * sound track): its name, its own volume, how long it is and where in its
 * sound it starts; listening to it; making it last to the sound's end.
 */
export function SoundDetails({ clip: picked }: { clip: Clip | null }) {
  const film = useEditor((s) => s.film)!;
  const cursor = useEditor((s) => s.cursor);
  const clip = picked ?? clipAt(film, cursor.track, cursor.cell) ?? null;
  const [name, setName] = useState(clip?.name ?? "");
  useEffect(() => setName(clip?.name ?? ""), [clip?.name]);
  if (!clip?.sound) {
    return (
      <p className="hint">
        Celda vacía de un track de sonido. Con «Sonido» (abajo de los tracks) importás música o efectos acá; con «Grabar», grabás con el micrófono mientras se reproduce la película.
      </p>
    );
  }
  const fps = film.settings.fps;
  const { ref, from } = clip.sound;
  const commit = useEditor.getState().commit;
  const rest = Math.max(1, Math.ceil((ref.duration - from) * fps - 1e-6));
  return (
    <div className="layer-details">
      <label className="control">
        <span>Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== clip.name && commit([{ type: "clip.update", id: clip.id, patch: { name: name.trim() } }])}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <OpacitySlider key={clip.id} what="Volumen" value={clip.opacity} onCommit={(opacity) => commit([{ type: "clip.update", id: clip.id, patch: { opacity } }])} />
      <p className="hint">
        Celdas {clip.start + 1}–{clipEnd(clip)} ({clip.length} {clip.length === 1 ? "celda" : "celdas"}, {seconds(clip.length / fps)}) · desde el segundo {seconds(from)} de un sonido de {seconds(ref.duration)}.
      </p>
      <div className="action-row">
        <button className="btn small" onClick={() => void listen(clip)}>
          ▶ Escuchar
        </button>
        <button
          className="btn small"
          disabled={clip.length === rest}
          onClick={() => commit([{ type: "clip.update", id: clip.id, patch: { length: rest } }], "Sonido hasta el final")}
          title="Que dure hasta que se termina el sonido (tapa lo que haya después en el track)"
        >
          Hasta el final
        </button>
      </div>
      <p className="hint">
        Cada celda es un pedacito del sonido: ⌫ saca el de la celda, la barra mete silencio, Ctrl + X / C / V lo cortan, copian y pegan, y arrastrando el borde se alarga o se
        acorta.
      </p>
    </div>
  );
}
