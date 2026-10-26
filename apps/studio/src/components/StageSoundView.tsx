import { type CellValues, type FilmState, clipAt } from "@gepetta/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { soundBuffer, soundBufferNow } from "../media/sound";
import { sampleSpectrum, spectrumImage, spectrumNow, useSpectra } from "../media/spectrum";
import { useEditor } from "../state/editor";
import { usePaint } from "../state/paint";
import { useSound } from "../state/sound";
import { type CellDraft, type SoundRange, commitCells, draftValue, paintCells, soundRange } from "../state/soundEdit";
import { capturePointer } from "./pointer";

const WAVE = "#5cc8b5";
const GAIN = "#ffd84a";
const PAN = "#b98cff";
/** The highest volume that can be painted (2 = twice as loud). */
export const MAX_GAIN = 2;

/** What each painting tool changes, and how a height in the view stands for a value. */
const PAINT: Record<"gain" | "pan", { what: CellValues; label: string; value(y: number, h: number): number; y(v: number, h: number): number }> = {
  gain: {
    what: "gains",
    label: "Volumen del sonido",
    // Bottom: silent; middle: as it is; top: twice as loud.
    value: (y, h) => Math.round(Math.max(0, Math.min(MAX_GAIN, (1 - y / h) * MAX_GAIN)) * 20) / 20,
    y: (v, h) => (1 - Math.min(MAX_GAIN, v) / MAX_GAIN) * h,
  },
  pan: {
    what: "pans",
    label: "Parlante del sonido",
    // Top: left; middle: both; bottom: right.
    value: (y, h) => {
      const v = Math.round(Math.max(-1, Math.min(1, (y / h) * 2 - 1)) * 20) / 20;
      return Math.abs(v) < 0.08 ? 0 : v;
    },
    y: (v, h) => ((v + 1) / 2) * h,
  },
};

function draw(canvas: HTMLCanvasElement, filmId: string, film: FilmState, r: SoundRange, spectrum: boolean, tool: "gain" | "pan" | null, draft: CellDraft) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  const n = r.end - r.start;
  const cw = w / n;
  const fps = film.settings.fps;
  const track = film.tracks.find((t) => t.id === r.track);
  const volume = (cell: number) => {
    const clip = clipAt(film, r.track, cell);
    return clip ? clip.opacity * (track?.opacity ?? 1) * draftValue(clip, "gains", cell, tool === "gain" ? draft : undefined) : 0;
  };

  if (spectrum) {
    const levels = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < n; i++) {
      const clip = clipAt(film, r.track, r.start + i);
      const s = clip?.sound && spectrumNow(filmId, clip.sound.ref);
      if (!clip?.sound || !s) continue;
      const t0 = clip.sound.from + (r.start + i - clip.start) / fps;
      const x = Math.round(i * cw * dpr);
      sampleSpectrum(levels, canvas.width, x, Math.max(1, Math.round((i + 1) * cw * dpr) - x), s, t0, t0 + 1 / fps, Math.min(1, volume(r.start + i)));
    }
    ctx.putImageData(spectrumImage(levels, canvas.width), 0, 0);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!spectrum) {
    // The waveform as it sounds (each cell at its volume), drawn finely from the sound itself.
    ctx.fillStyle = WAVE;
    const mid = h / 2;
    for (let i = 0; i < n; i++) {
      const cell = r.start + i;
      const clip = clipAt(film, r.track, cell);
      const buffer = clip?.sound && soundBufferNow(filmId, clip.sound.ref);
      if (!clip?.sound || !buffer) continue;
      const data = buffer.getChannelData(0);
      const v = volume(cell);
      const t0 = clip.sound.from + (cell - clip.start) / fps;
      const x0 = Math.round(i * cw);
      const x1 = Math.round((i + 1) * cw);
      for (let x = x0; x < x1; x++) {
        const a = Math.floor((t0 + ((x - x0) / (x1 - x0)) / fps) * buffer.sampleRate);
        const b = Math.max(a + 1, Math.floor((t0 + ((x + 1 - x0) / (x1 - x0)) / fps) * buffer.sampleRate));
        let lo = 0;
        let hi = 0;
        for (let k = Math.max(0, a); k < Math.min(b, data.length); k++) {
          const s = data[k]!;
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
        const top = mid - Math.min(1, hi * v) * (mid - 4);
        const bottom = mid - Math.max(-1, lo * v) * (mid - 4);
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    }
  }

  // Where each cell starts, and its number when there is room.
  ctx.fillStyle = "rgb(255 255 255 / 0.12)";
  for (let i = 1; i < n; i++) ctx.fillRect(Math.round(i * cw), 0, 1, h);
  ctx.fillStyle = "rgb(255 255 255 / 0.5)";
  ctx.font = "11px system-ui, sans-serif";
  const every = Math.max(1, Math.ceil(36 / cw));
  for (let i = 0; i < n; i += every) ctx.fillText(String(r.start + i + 1), i * cw + 4, 13);

  // The lines of what each cell has: always when some cell has its own, and to paint.
  for (const which of ["gain", "pan"] as const) {
    const { what, y } = PAINT[which];
    const clips = new Set<string>();
    for (let c = r.start; c < r.end; c++) {
      const clip = clipAt(film, r.track, c);
      if (clip?.sound?.[what]?.length) clips.add(clip.id);
    }
    if (tool !== which && !clips.size) continue;
    ctx.strokeStyle = which === "gain" ? GAIN : PAN;
    ctx.lineWidth = tool === which ? 2.5 : 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const clip = clipAt(film, r.track, r.start + i);
      if (!clip?.sound) continue;
      const yy = y(draftValue(clip, what, r.start + i, tool === which ? draft : undefined), h);
      ctx[i && clipAt(film, r.track, r.start + i - 1) ? "lineTo" : "moveTo"](i * cw + 1, yy);
      ctx.lineTo((i + 1) * cw - 1, yy);
    }
    ctx.stroke();
  }
  if (tool) {
    ctx.fillStyle = "rgb(255 255 255 / 0.18)";
    ctx.fillRect(0, Math.round(h / 2), w, 1);
    // What the heights mean, on the right, over a dark label.
    const [top, middle, bottom] = tool === "gain" ? ["200 %", "100 %", "nada"] : ["izquierda", "los dos", "derecha"];
    ctx.textAlign = "right";
    for (const [text, y] of [[top, 14], [middle, h / 2 - 4], [bottom, h - 6]] as const) {
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgb(20 18 16 / 0.9)";
      ctx.fillRect(w - tw - 12, y - 11, tw + 10, 15);
      ctx.fillStyle = tool === "gain" ? GAIN : PAN;
      ctx.fillText(text, w - 7, y);
    }
    ctx.textAlign = "left";
  }
}

/**
 * On the stage, when the cursor is in a sound track: the sound of the cell,
 * of the cells picked, or of the whole sound picked, big, cell by cell. The
 * «Volumen» and «Parlante» tools paint there each cell's volume or speaker.
 */
export function StageSoundView() {
  const film = useEditor((s) => s.film);
  const filmId = useEditor((s) => s.filmId);
  const playing = useEditor((s) => !!s.playback);
  const key = useEditor((s) => {
    const r = soundRange(s);
    return r ? `${r.track}|${r.start}|${r.end}` : "";
  });
  const spectrum = useSound((s) => s.view === "spectrum");
  const spectra = useSpectra((s) => s.version);
  const tool = usePaint((s) => (s.tool === "gain" || s.tool === "pan" ? s.tool : null));
  const [draft, setDraft] = useState<CellDraft>({});
  const [loaded, setLoaded] = useState(0);
  const painting = useRef<{ cell: number; value: number } | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const range: SoundRange | null = key ? { track: key.split("|")[0]!, start: Number(key.split("|")[1]), end: Number(key.split("|")[2]) } : null;

  // The sounds shown, read (then drawn again).
  useEffect(() => {
    if (!film || !filmId || !range) return;
    let alive = true;
    for (let c = range.start; c < range.end; c++) {
      const clip = clipAt(film, range.track, c);
      if (clip?.sound && !soundBufferNow(filmId, clip.sound.ref)) void soundBuffer(filmId, clip.sound.ref).then(() => alive && setLoaded((v) => v + 1));
    }
    return () => {
      alive = false;
    };
  }, [film, filmId, key]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (canvas && film && filmId && range) draw(canvas, filmId, film, range, spectrum, tool, draft);
  });

  // Drawn again when the stage changes size.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setLoaded((v) => v + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [key]);

  if (!film || !filmId || !range || playing) return null;
  void spectra;
  void loaded;
  const n = range.end - range.start;
  const names = [...new Set(Array.from({ length: n }, (_, i) => clipAt(film, range.track, range.start + i)?.name).filter(Boolean))];

  const at = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const cell = range.start + Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left) / box.width) * n)));
    return { cell, value: PAINT[tool!].value(e.clientY - box.top, box.height) };
  };

  return (
    <div className="stage-sound-view" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ssv-head">
        <strong>{n === 1 ? `Celda ${range.start + 1}` : `Celdas ${range.start + 1}–${range.end}`}</strong>
        <span>{names.length ? names.join(", ") : "sin sonido"}</span>
        {!tool && <small>⇧ + clic en la línea de tiempo elige varias celdas; doble clic, todo el sonido. Volumen y parlante: herramientas de la barra.</small>}
      </div>
      <canvas
        ref={ref}
        className={tool ? "painting" : ""}
        onPointerDown={(e) => {
          if (!tool || e.button !== 0) return;
          capturePointer(e);
          const p = at(e);
          painting.current = p;
          setDraft(paintCells(film, range.track, PAINT[tool].what, p.cell, p.cell, () => p.value));
        }}
        onPointerMove={(e) => {
          const last = painting.current;
          if (!tool || !last) return;
          const p = at(e);
          if (p.cell === last.cell && p.value === last.value) return;
          // The cells in between, in a straight line.
          const span = p.cell - last.cell;
          const f = (c: number) => (span ? Math.round((last.value + ((p.value - last.value) * (c - last.cell)) / span) * 20) / 20 : p.value);
          painting.current = p;
          setDraft((d) => paintCells(film, range.track, PAINT[tool].what, last.cell, p.cell, f, d));
        }}
        onPointerUp={() => {
          if (!tool || !painting.current) return;
          painting.current = null;
          commitCells(draft, PAINT[tool].what, PAINT[tool].label);
          setDraft({});
        }}
      />
    </div>
  );
}
