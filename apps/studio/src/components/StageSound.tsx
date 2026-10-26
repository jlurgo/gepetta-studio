import { type FilmState, PEAKS_PER_SECOND, cellIndex, clipIn, playedCell, wrapCell } from "@gepetta/core";
import { useEffect, useRef } from "react";
import { peaksNow, useSoundPeaks } from "../media/sound";
import { playbackCell, useEditor } from "../state/editor";
import { useSound } from "../state/sound";
import { Icon } from "./Icon";

/** Cells shown before and after the one on screen. */
const AROUND = 8;
const CELL_W = 22;
const BARS = 4;
const H = 40;

/** Draws the sound around `cell`: each sound track's slices, mixed (the loudest), the cell on screen marked. */
function draw(canvas: HTMLCanvasElement, filmId: string, film: FilmState, cell: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = (2 * AROUND + 1) * CELL_W;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  const fps = film.settings.fps;
  const index = cellIndex(film);
  const tracks = film.tracks.filter((t) => t.kind === "sound" && t.visible);
  const bw = (CELL_W - 2) / BARS - 1;
  for (let i = -AROUND; i <= AROUND; i++) {
    const c = film.settings.loop ? wrapCell(film, cell + i) : cell + i;
    const x = (i + AROUND) * CELL_W;
    if (i === 0) {
      ctx.fillStyle = "rgb(255 122 69 / 0.28)";
      ctx.fillRect(x, 0, CELL_W, H);
    }
    if (c < 0 || c >= film.length) continue;
    const level = new Array<number>(BARS).fill(0);
    for (const t of tracks) {
      const clip = clipIn(index.get(t.id) ?? [], c);
      const peaks = clip?.sound && peaksNow(filmId, clip.sound.ref);
      if (!clip?.sound || !peaks) continue;
      const t0 = clip.sound.from + (c - clip.start) / fps;
      for (let b = 0; b < BARS; b++) {
        const a = Math.floor((t0 + b / (BARS * fps)) * PEAKS_PER_SECOND);
        const e = Math.max(a + 1, Math.floor((t0 + (b + 1) / (BARS * fps)) * PEAKS_PER_SECOND));
        for (let k = a; k < e; k++) level[b] = Math.max(level[b]!, ((peaks[k] ?? 0) / 255) * t.opacity * clip.opacity);
      }
    }
    ctx.fillStyle = i === 0 ? "#ffb38f" : `rgb(92 200 181 / ${1 - Math.abs(i) * 0.06})`;
    level.forEach((v, b) => {
      const bh = Math.max(1, v * (H - 4));
      ctx.fillRect(x + 1 + b * (bw + 1), (H - bh) / 2, bw, bh);
    });
  }
}

/**
 * Under the picture: the sound of the cells around the one shown, following
 * the cursor or the film while it plays. Hides with its ×.
 */
export function StageSound() {
  const film = useEditor((s) => s.film);
  const filmId = useEditor((s) => s.filmId);
  const cursorCell = useEditor((s) => s.cursor.cell);
  const playback = useEditor((s) => s.playback);
  const shown = useSound((s) => s.strip);
  const version = useSoundPeaks((s) => s.version);
  const ref = useRef<HTMLCanvasElement>(null);
  const hasSound = !!film?.tracks.some((t) => t.kind === "sound");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !film || !filmId) return;
    if (!playback) {
      draw(canvas, filmId, film, cursorCell);
      return;
    }
    // While playing: the cell being shown, drawn again when it changes.
    let raf = 0;
    let last = -1;
    const step = () => {
      raf = requestAnimationFrame(step);
      const cell = playedCell(film, playbackCell(playback, film.settings.fps));
      if (cell !== last) draw(canvas, filmId, film, (last = Math.min(cell, film.length - 1)));
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [film, filmId, cursorCell, playback, version, shown]);

  if (!hasSound) return null;
  if (!shown)
    return (
      <button className="stage-sound-show icon-btn small" onClick={() => useSound.getState().setStrip(true)} title="Mostrar el sonido de las celdas de alrededor">
        <Icon name="sound" size={15} />
      </button>
    );
  return (
    <div className="stage-sound" title="El sonido de las celdas de alrededor (la naranja es la que se ve)">
      <canvas ref={ref} style={{ width: (2 * AROUND + 1) * CELL_W, height: H }} />
      <button className="icon-btn small" onClick={() => useSound.getState().setStrip(false)} title="Ocultar el sonido" aria-label="Ocultar el sonido">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
