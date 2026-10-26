import { type Group, type Track, groupChain } from "@gepetta/core";
import { Fragment, useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import { updateTrack } from "../state/layers";
import { trackLevel, useSound } from "../state/sound";
import { VOICE_EFFECTS } from "../media/voices";
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

/** A group's volume (for all its sound tracks) and silencing them all. */
function GroupStrip({ group, depth, muted }: { group: Group; depth: number; muted: boolean }) {
  const update = (patch: { volume?: number; muted?: boolean }) => useEditor.getState().commit([{ type: "group.update", id: group.id, patch }]);
  return (
    <div className={`mix-strip group${muted ? " quiet" : ""}`} style={{ marginLeft: depth * 12 }}>
      <div className="mix-head">
        <strong title={group.name}>▾ {group.name}</strong>
        <button
          className={`icon-btn small${group.muted ? " on" : ""}`}
          onClick={() => update({ muted: !group.muted })}
          title={group.muted ? "Que suene el grupo" : "Silenciar todo el grupo (también en el video)"}
          aria-pressed={!!group.muted}
        >
          <Icon name={group.muted ? "mute" : "sound"} size={14} />
        </button>
      </div>
      <OpacitySlider key={`g-${group.id}`} what="Volumen del grupo" value={group.volume ?? 1} onCommit={(volume) => update({ volume })} />
    </div>
  );
}

function Strip({ track, depth, silenced, soloed, anySolo, meter }: { track: Track; depth: number; silenced: boolean; soloed: boolean; anySolo: boolean; meter(el: HTMLSpanElement | null): void }) {
  const quiet = !track.visible || silenced || (anySolo && !soloed);
  return (
    <div className={`mix-strip${quiet ? " quiet" : ""}`} style={{ marginLeft: depth * 12 }}>
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
      <label className="control">
        <span>Efecto de voz</span>
        <select value={track.voice ?? ""} onChange={(e) => updateTrack(track.id, { voice: (e.target.value || undefined) as Track["voice"] })}>
          <option value="">Ninguno</option>
          {VOICE_EFFECTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
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
  const film = useEditor((s) => s.film);
  const tracks = film?.tracks;
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
  // Each track under the groups it is in (outermost first), each group shown where its first sound track is.
  let open: Group[] = [];
  return (
    <div className="mixer">
      {sounds.map((t) => {
        const chain = groupChain(film!, t.group).reverse();
        let same = 0;
        while (same < open.length && same < chain.length && open[same]!.id === chain[same]!.id) same++;
        const opened = chain.slice(same);
        open = chain;
        return (
          <Fragment key={t.id}>
            {opened.map((g, i) => (
              <GroupStrip key={g.id} group={g} depth={same + i} muted={chain.slice(0, same + i + 1).some((c) => c.muted)} />
            ))}
            <Strip
              track={t}
              depth={chain.length}
              silenced={chain.some((g) => g.muted)}
              soloed={solo.includes(t.id)}
              anySolo={solo.length > 0}
              meter={(el) => (el ? meters.current.set(t.id, el) : meters.current.delete(t.id))}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
