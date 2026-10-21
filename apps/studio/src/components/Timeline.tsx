import type { Frame, FrameId } from "@gepetta/core";
import { memo, useEffect, useRef, useState } from "react";
import { thumbUrl } from "../media/cache";
import { importImages, moveFrame } from "../state/actions";
import { useEditor } from "../state/editor";
import { Icon } from "./Icon";

const DRAG_TYPE = "application/x-gepetta-frame";

const FrameThumb = memo(function FrameThumb({ filmId, frame }: { filmId: string; frame: Frame }) {
  const [url, setUrl] = useState<string | null>(null);
  const thumb = frame.layers[0]?.media.thumb;
  useEffect(() => {
    let alive = true;
    if (thumb) thumbUrl(filmId, thumb).then((u) => alive && setUrl(u), () => undefined);
    return () => {
      alive = false;
    };
  }, [filmId, thumb]);
  return url ? <img src={url} alt="" draggable={false} /> : <div className="thumb-placeholder" />;
});

export function Timeline() {
  const film = useEditor((s) => s.film);
  const filmId = useEditor((s) => s.filmId);
  const selected = useEditor((s) => s.selected);
  const view = useEditor((s) => s.view);
  const select = useEditor((s) => s.select);
  const setView = useEditor((s) => s.setView);
  const stripRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<{ after: FrameId | null } | null>(null);

  useEffect(() => {
    const el = stripRef.current?.querySelector(view === "live" ? ".cell.live" : ".cell.selected");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, view, film?.frameOrder.length]);

  if (!film || !filmId) return null;
  const aspect = film.settings.width / film.settings.height;

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

  const liveAfter = view === "live" ? selected : undefined;

  return (
    <div
      className="timeline"
      ref={stripRef}
      style={{ ["--thumb-aspect" as string]: aspect }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDrop(e, film.frameOrder.at(-1) ?? null)}
    >
      {liveAfter === null && <div className="insert-marker" title="La próxima foto va acá" />}
      {film.frameOrder.map((id, i) => {
        const frame = film.frames[id]!;
        const isDrop = dropTarget?.after === id || (dropTarget?.after === null && i === 0);
        return (
          <div key={id} className="cell-wrap">
            {isDrop && dropTarget?.after === null && <div className="drop-marker" />}
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
              <FrameThumb filmId={filmId} frame={frame} />
              <span className="cell-index">{i + 1}</span>
              {frame.hold > 1 && <span className="cell-hold">×{frame.hold}</span>}
            </button>
            {isDrop && dropTarget?.after === id && <div className="drop-marker" />}
            {liveAfter === id && <div className="insert-marker" title="La próxima foto va acá" />}
          </div>
        );
      })}
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
    </div>
  );
}
