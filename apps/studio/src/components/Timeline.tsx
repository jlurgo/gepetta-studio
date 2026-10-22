import {
  type FilmState,
  type Frame,
  type FrameId,
  type FrameSpans,
  type MediaRef,
  PHOTO_TRACK,
  type Track,
  frameSpans,
  frameStack,
  trackItem,
} from "@gepetta/core";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { thumbUrl } from "../media/cache";
import { drawStack } from "../render/frame";
import { addCellsTrack, addImageTrack, importImages, moveFrame, setCellImage } from "../state/actions";
import { useEditor } from "../state/editor";
import { updateTrack, useLayers } from "../state/layers";
import { Icon } from "./Icon";
import { OpacitySlider } from "./TrackPanel";
import { VideoImportDialog } from "./VideoImportDialog";

const DRAG_TYPE = "application/x-gepetta-frame";

/** Decoded thumbnails, shared by every cell that shows them. */
const thumbImages = new Map<string, Promise<HTMLImageElement>>();
function thumbImage(filmId: string, assetId: string): Promise<HTMLImageElement> {
  const key = `${filmId}/${assetId}`;
  let p = thumbImages.get(key);
  if (!p) {
    p = thumbUrl(filmId, assetId).then(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("thumb"));
          img.src = url;
        }),
    );
    p.catch(() => thumbImages.delete(key));
    thumbImages.set(key, p);
  }
  return p;
}

const Thumb = memo(function Thumb({ filmId, media }: { filmId: string; media: MediaRef }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    thumbUrl(filmId, media.thumb).then((u) => alive && setUrl(u), () => undefined);
    return () => {
      alive = false;
    };
  }, [filmId, media.thumb]);
  return url ? <img src={url} alt="" draggable={false} /> : <div className="thumb-placeholder" />;
});

/** The frame as it comes out: every visible track combined, drawn from thumbnails. */
const CompositeThumb = memo(function CompositeThumb({ filmId, film, frame, tick, spans }: { filmId: string; film: FilmState; frame: Frame; tick: number; spans: FrameSpans }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stack = frameStack(film, frame, tick, { spans });
  // Redraw only when what is drawn changes, not on every edit of the film.
  const key = JSON.stringify(stack.map((s) => [s.media.thumb, s.opacity, s.transform]));
  const { width, height } = film.settings;
  useEffect(() => {
    let alive = true;
    Promise.all(stack.map((s) => thumbImage(filmId, s.media.thumb).catch(() => undefined))).then((images) => {
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const w = 240;
      const h = Math.round((w * height) / width);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
      const byThumb = new Map(stack.map((s, i) => [s.media.thumb, images[i]]));
      drawStack(ctx, stack, film.settings, (m) => byThumb.get(m.thumb));
    });
    return () => {
      alive = false;
    };
    // `stack` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmId, key, width, height]);
  return <canvas ref={ref} />;
});

function TrackHead({ track }: { track: Track }) {
  const selected = useLayers((s) => s.trackId === track.id);
  return (
    <div className={`tl-head track${selected ? " selected" : ""}${track.visible ? "" : " off"}`}>
      <button
        className="icon-btn small"
        onClick={() => updateTrack(track.id, { visible: !track.visible })}
        title={track.visible ? "Ocultar" : "Mostrar"}
      >
        <Icon name={track.visible ? "eye" : "eyeOff"} size={15} />
      </button>
      <button
        className="tl-name"
        onClick={() => useLayers.getState().select(selected ? null : track.id)}
        title={track.exported ? track.name : `${track.name} (solo referencia: no se exporta)`}
      >
        {track.name}
        {!track.exported && <span className="ref-dot" aria-hidden />}
      </button>
      <OpacitySlider label={false} value={track.opacity} onCommit={(opacity) => updateTrack(track.id, { opacity })} />
    </div>
  );
}

function TrackCell({
  filmId,
  film,
  track,
  frame,
  tick,
  spans,
  onPick,
}: {
  filmId: string;
  film: FilmState;
  track: Track;
  frame: Frame | null;
  tick: number;
  spans: FrameSpans;
  onPick(frameId: FrameId, track: Track): void;
}) {
  const item = trackItem(film, { ...track, visible: true }, frame, tick, spans);
  const selectedTrack = useLayers((s) => s.trackId === track.id);
  const canFill = frame && track.source.kind === "cells" && track.id !== PHOTO_TRACK;
  return (
    <button
      className={`tl-cell${item ? " filled" : ""}${track.source.kind !== "cells" && item ? " span" : ""}${selectedTrack ? " selected" : ""}${track.visible ? "" : " off"}`}
      onClick={() => {
        useLayers.getState().select(track.id);
        if (!frame) return;
        useEditor.getState().select(frame.id);
        if (!item && canFill) onPick(frame.id, track);
      }}
      title={!item && canFill ? "Agregar una imagen en este cuadro" : track.name}
    >
      {item ? <Thumb filmId={filmId} media={item.media} /> : canFill ? <Icon name="plus" size={14} /> : null}
    </button>
  );
}

function AddTrackMenu({ onVideo }: { onVideo(): void }) {
  const [open, setOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="tl-add">
      <button className="btn small ghost" onClick={() => setOpen(!open)}>
        <Icon name="plus" size={14} /> Track
      </button>
      {open && (
        <div className="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setOpen(false);
              addCellsTrack();
            }}
          >
            <strong>Capa</strong>
            <span>Una imagen o dibujo por cuadro</span>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              imageInput.current?.click();
            }}
          >
            <strong>Imagen fija</strong>
            <span>Un fondo, un marco o un logo para toda la película</span>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onVideo();
            }}
          >
            <strong>Video</strong>
            <span>Avanza con la película: para rotoscopia</span>
          </button>
        </div>
      )}
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImageTrack(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function Timeline() {
  const film = useEditor((s) => s.film);
  const filmId = useEditor((s) => s.filmId);
  const selected = useEditor((s) => s.selected);
  const view = useEditor((s) => s.view);
  const select = useEditor((s) => s.select);
  const setView = useEditor((s) => s.setView);
  const stripRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<{ after: FrameId | null } | null>(null);
  const cellInput = useRef<HTMLInputElement>(null);
  const pickFor = useRef<{ frameId: FrameId; trackId: string } | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);
  const spans = useMemo(() => (film ? frameSpans(film) : new Map()), [film]);

  useEffect(() => {
    const el = stripRef.current?.querySelector(view === "live" ? ".cell.live" : ".cell.selected");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, view, film?.frameOrder.length]);

  if (!film || !filmId) return null;
  const aspect = film.settings.width / film.settings.height;
  const tracks = [...film.tracks].reverse(); // top first, like the picture

  /** Where a drop over `id` lands: before it on its left half, after it on its right half. */
  function dropAnchor(e: React.DragEvent, id: FrameId): FrameId | null {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    if (!before) return id;
    const i = film!.frameOrder.indexOf(id);
    return film!.frameOrder[i - 1] ?? null;
  }

  function onDrop(e: React.DragEvent, after: FrameId | null) {
    e.preventDefault();
    setDropTarget(null);
    const moving = e.dataTransfer.getData(DRAG_TYPE);
    if (moving) moveFrame(moving, after);
    else if (e.dataTransfer.files.length) {
      useEditor.getState().select(after, "frame");
      void importImages([...e.dataTransfer.files]);
    }
  }

  const pick = (frameId: FrameId, track: Track) => {
    pickFor.current = { frameId, trackId: track.id };
    cellInput.current?.click();
  };
  const liveAfter = view === "live" ? selected : undefined;
  const liveTick = selected ? (spans.get(selected)?.end ?? 0) : 0;

  return (
    <div className="timeline" style={{ ["--thumb-aspect" as string]: aspect }}>
      <div className="tl-heads">
        <div className="tl-head main">Resultado</div>
        {tracks.map((t) => (
          <TrackHead key={t.id} track={t} />
        ))}
        <AddTrackMenu onVideo={() => videoInput.current?.click()} />
      </div>

      <div
        className="tl-columns"
        ref={stripRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop(e, film.frameOrder.at(-1) ?? null)}
      >
        {liveAfter === null && <div className="insert-marker" title="La próxima foto va acá" />}
        {film.frameOrder.map((id, i) => {
          const frame = film.frames[id]!;
          const tick = spans.get(id)?.start ?? 0;
          const isDrop = dropTarget?.after === id || (dropTarget?.after === null && i === 0);
          return (
            <div key={id} className="cell-wrap">
              {isDrop && dropTarget?.after === null && <div className="drop-marker" />}
              <div className="tl-col">
                <button
                  className={`cell${id === selected && view === "frame" ? " selected" : ""}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const after = dropAnchor(e, id);
                    if (dropTarget?.after !== after) setDropTarget({ after });
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    e.stopPropagation();
                    onDrop(e, dropAnchor(e, id));
                  }}
                  onClick={() => select(id)}
                  title={`Cuadro ${i + 1}${frame.hold > 1 ? ` (dura ×${frame.hold})` : ""}`}
                >
                  <CompositeThumb filmId={filmId} film={film} frame={frame} tick={tick} spans={spans} />
                  <span className="cell-index">{i + 1}</span>
                  {frame.hold > 1 && <span className="cell-hold">×{frame.hold}</span>}
                </button>
                {tracks.map((t) => (
                  <TrackCell key={t.id} filmId={filmId} film={film} track={t} frame={frame} tick={tick} spans={spans} onPick={pick} />
                ))}
              </div>
              {isDrop && dropTarget?.after === id && <div className="drop-marker" />}
              {liveAfter === id && <div className="insert-marker" title="La próxima foto va acá" />}
            </div>
          );
        })}
        <div className="tl-col">
          <button
            className={`cell live${view === "live" ? " selected" : ""}`}
            onClick={() => {
              if (view !== "live") select(film.frameOrder.at(-1) ?? null, "live");
              else setView("live");
            }}
            title="Cámara en vivo: la próxima foto va al final"
          >
            <Icon name="camera" size={28} />
            <span>En vivo</span>
          </button>
          {tracks.map((t) => (
            <TrackCell key={t.id} filmId={filmId} film={film} track={t} frame={null} tick={liveTick} spans={spans} onPick={pick} />
          ))}
        </div>
      </div>

      <input
        ref={cellInput}
        data-role="cell-image"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const target = pickFor.current;
          if (f && target) void setCellImage(f, target.frameId, target.trackId);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setVideo(f);
          e.target.value = "";
        }}
      />
      {video && <VideoImportDialog file={video} mode="track" onClose={() => setVideo(null)} />}
    </div>
  );
}
