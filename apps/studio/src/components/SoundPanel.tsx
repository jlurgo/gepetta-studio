import { type Clip, cellGain, clipAt, clipEnd } from "@gepetta/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { makeBus } from "../media/mixer";
import { audio, playRun, soundBuffer } from "../media/sound";
import { sampleSpectrum, spectrumImage, spectrumNow, useSpectra } from "../media/spectrum";
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
  // As it sounds in the film: through its track's volume and place.
  const out = track ? makeBus(ctx, track, ctx.destination).input : ctx.destination;
  playRun(ctx, out, buffer, { track: clip.track, clip, at: 0, cell: clip.start, count: clip.length }, film.settings.fps, ctx.currentTime, clip.opacity);
}

const SPECTRUM_W = 252;
const SPECTRUM_H = 96;

/** The clip's spectrum, cell by cell: low sounds at the bottom, high ones at the top. */
function ClipSpectrum({ filmId, clip, fps }: { filmId: string; clip: Clip; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSpectra((s) => s.version);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !clip.sound) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(SPECTRUM_W * dpr);
    canvas.height = Math.round(SPECTRUM_H * dpr);
    const ctx = canvas.getContext("2d")!;
    const spectrum = spectrumNow(filmId, clip.sound.ref);
    if (!spectrum) return;
    const levels = new Uint8Array(canvas.width * canvas.height);
    const t0 = clip.sound.from;
    sampleSpectrum(levels, canvas.width, 0, canvas.width, spectrum, t0, t0 + clip.length / fps);
    ctx.putImageData(spectrumImage(levels, canvas.width), 0, 0);
    // Where each cell starts, when they are not too close together.
    const cw = canvas.width / clip.length;
    if (cw >= 4 * dpr) {
      ctx.fillStyle = "rgb(0 0 0 / 0.45)";
      for (let i = 1; i < clip.length; i++) ctx.fillRect(Math.round(i * cw), 0, 1, canvas.height);
    }
  }, [filmId, clip, fps, version]);
  return (
    <div className="sound-spectrum" title="Espectro: abajo los sonidos graves, arriba los agudos; más claro, más fuerte">
      <canvas ref={ref} style={{ width: SPECTRUM_W, height: SPECTRUM_H }} />
      <span className="top">agudos</span>
      <span className="bottom">graves</span>
    </div>
  );
}

/** The cells of a sound clip that the volume buttons change: the picked ones in it, or all of it. */
function volumeCells(clip: Clip, span: { start: number; end: number } | null): [number, number] {
  if (span && span.start < clipEnd(clip) && span.end > clip.start) return [Math.max(span.start, clip.start), Math.min(span.end, clipEnd(clip))];
  return [clip.start, clipEnd(clip)];
}

/** The clip's volumes with cells [a, b) set by `f` (0 at a, 1 at the last one). */
function withGains(clip: Clip, a: number, b: number, f: (t: number) => number): number[] {
  const gains = Array.from({ length: clip.length }, (_, i) => cellGain(clip, clip.start + i));
  for (let c = a; c < b; c++) gains[c - clip.start] = Math.round(f(b - a > 1 ? (c - a) / (b - a - 1) : 1) * 100) / 100;
  return gains;
}

/**
 * The volume of each cell: the cursor's one, and fading in or out the picked
 * cells (or the whole sound).
 */
function CellVolume({ clip }: { clip: Clip }) {
  const cell = useEditor((s) => s.cursor.cell);
  const span = useEditor((s) => s.span);
  // Cells picked with ⇧ in the clip's track: from where the picking started to the cursor.
  const picked = span && span.track === clip.track && span.anchor !== cell ? { start: Math.min(span.anchor, cell), end: Math.max(span.anchor, cell) + 1 } : null;
  const [a, b] = volumeCells(clip, picked);
  const inClip = cell >= clip.start && cell < clipEnd(clip);
  const set = (gains: number[], label: string) => useEditor.getState().commit([{ type: "clip.update", id: clip.id, patch: { sound: { ...clip.sound!, gains } } }], label);
  const what = a === clip.start && b === clipEnd(clip) ? "todo el sonido" : `las celdas ${a + 1}–${b}`;
  return (
    <>
      {inClip && (
        <OpacitySlider
          key={`${clip.id}-${cell}`}
          what={`Volumen de la celda ${cell + 1}`}
          value={cellGain(clip, cell)}
          onCommit={(g) => set(withGains(clip, cell, cell + 1, () => g), "Volumen de una celda")}
        />
      )}
      <div className="action-row" title={`Cambia ${what} (elegí celdas en la línea de tiempo para cambiar solo esas)`}>
        <button className="btn small" onClick={() => set(withGains(clip, a, b, (t) => t), "Fundido de entrada")}>
          Fundido de entrada
        </button>
        <button className="btn small" onClick={() => set(withGains(clip, a, b, (t) => 1 - t), "Fundido de salida")}>
          Fundido de salida
        </button>
        <button className="btn small" onClick={() => set(withGains(clip, a, b, () => 1), "Volumen parejo")}>
          Parejo
        </button>
      </div>
      <p className="hint">Con la herramienta «Sonidos», arrastrá sobre las celdas del sonido para dibujar su volumen (arriba, fuerte; abajo, nada).</p>
    </>
  );
}

/**
 * A sound clip's settings (the one picked, or the one at the cursor in a
 * sound track): its name, its own volume, how long it is and where in its
 * sound it starts; listening to it; making it last to the sound's end.
 */
export function SoundDetails({ clip: picked }: { clip: Clip | null }) {
  const film = useEditor((s) => s.film)!;
  const filmId = useEditor((s) => s.filmId)!;
  const cursor = useEditor((s) => s.cursor);
  const clip = picked ?? clipAt(film, cursor.track, cursor.cell) ?? null;
  const [name, setName] = useState(clip?.name ?? "");
  useEffect(() => setName(clip?.name ?? ""), [clip?.name]);
  if (!clip?.sound) {
    return (
      <p className="hint">
        Celda vacía de un track de sonido. Con la herramienta «Sonidos» ponés acá música o efectos; con un micrófono (en la barra, al lado de las cámaras) grabás mientras se reproduce la película.
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
      <ClipSpectrum filmId={filmId} clip={clip} fps={fps} />
      <OpacitySlider key={clip.id} what="Volumen de todo el sonido" value={clip.opacity} onCommit={(opacity) => commit([{ type: "clip.update", id: clip.id, patch: { opacity } }])} />
      <CellVolume clip={clip} />
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
