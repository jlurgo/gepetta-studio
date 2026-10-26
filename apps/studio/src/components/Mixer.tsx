import type { Track } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { updateTrack } from "../state/layers";
import { trackLevel, useSound } from "../state/sound";
import { Icon } from "./Icon";
import { OpacitySlider } from "./TrackPanel";

/** Left (-1) to right (1), back to the middle near it; committed when let go. */
function PanSlider({ value, onCommit }: { value: number; onCommit(v: number): void }) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const finish = () => {
    if (dirty.current) onCommit(draft);
    dirty.current = false;
  };
  const where = Math.abs(draft) < 0.05 ? "al medio" : draft < 0 ? `izquierda ${Math.round(-draft * 100)} %` : `derecha ${Math.round(draft * 100)} %`;
  return (
    <label className="control mix-pan">
      <span>Parlante: {where}</span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={draft}
        onChange={(e) => {
          dirty.current = true;
          const v = Number(e.target.value);
          setDraft(Math.abs(v) < 0.08 ? 0 : v);
        }}
        onDoubleClick={() => {
          dirty.current = true;
          setDraft(0);
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
    </label>
  );
}

function Strip({ track, soloed, anySolo, meter }: { track: Track; soloed: boolean; anySolo: boolean; meter(el: HTMLSpanElement | null): void }) {
  const quiet = !track.visible || (anySolo && !soloed);
  return (
    <div className={`mix-strip${quiet ? " quiet" : ""}`}>
      <div className="mix-head">
        <strong title={track.name}>{track.name}</strong>
        <button
          className={`icon-btn small${track.visible ? "" : " on"}`}
          onClick={() => updateTrack(track.id, { visible: !track.visible })}
          title={track.visible ? "Silenciarlo (también en el video)" : "Que suene"}
          aria-pressed={!track.visible}
        >
          <Icon name={track.visible ? "sound" : "mute"} size={14} />
        </button>
        <button
          className={`mix-solo${soloed ? " on" : ""}`}
          onClick={() => useSound.getState().toggleSolo(track.id)}
          title="Escuchar solo este (y los otros marcados); no cambia el video"
          aria-pressed={soloed}
        >
          S
        </button>
      </div>
      <OpacitySlider key={`v-${track.id}`} what="Volumen" value={track.opacity} onCommit={(opacity) => updateTrack(track.id, { opacity })} />
      <PanSlider value={track.pan ?? 0} onCommit={(pan) => updateTrack(track.id, { pan: pan || undefined })} />
      <div className="mix-meter" title="Lo fuerte que suena ahora">
        <span ref={meter} />
      </div>
    </div>
  );
}

/**
 * The sound tracks side by side: each one's volume, speaker (left or right),
 * silencing it, hearing it alone, and how loud it plays now.
 */
export function Mixer() {
  const tracks = useEditor((s) => s.film?.tracks);
  const solo = useSound((s) => s.solo);
  const meters = useRef(new Map<string, HTMLSpanElement>());
  const sounds = (tracks ?? []).filter((t) => t.kind === "sound");

  useEffect(() => {
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      for (const [id, el] of meters.current) {
        const level = trackLevel(id);
        el.style.width = `${Math.round(level * 100)}%`;
        el.style.background = level > 0.97 ? "#ff5b5b" : "";
      }
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!sounds.length) return <p className="hint">Todavía no hay tracks de sonido.</p>;
  return (
    <div className="mixer">
      {sounds.map((t) => (
        <Strip
          key={t.id}
          track={t}
          soloed={solo.includes(t.id)}
          anySolo={solo.length > 0}
          meter={(el) => (el ? meters.current.set(t.id, el) : meters.current.delete(t.id))}
        />
      ))}
    </div>
  );
}
