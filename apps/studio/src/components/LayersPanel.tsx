import { type Channel, IDENTITY_TRANSFORM, type ImageLayer, type Op } from "@gepetta/core";
import { useEffect, useRef, useState } from "react";
import { addImageChannel, addLayerImage } from "../state/actions";
import { useEditor } from "../state/editor";
import { type LayerTarget, resolveTarget, useLayers } from "../state/layers";
import { Icon } from "./Icon";
import { VideoImportDialog } from "./VideoImportDialog";

const sameTarget = (a: LayerTarget | null, b: LayerTarget) => a?.kind === b.kind && a.id === b.id;

function Row({ target, item, badge }: { target: LayerTarget; item: ImageLayer | Channel; badge?: string }) {
  const selected = useLayers((s) => sameTarget(s.target, target));
  const toggle = () => {
    const op: Op =
      target.kind === "channel"
        ? { type: "channel.update", channelId: target.id, patch: { visible: !item.visible } }
        : { type: "layer.update", frameId: target.frameId, layerId: target.id, patch: { visible: !item.visible } };
    useEditor.getState().commit([op]);
  };
  return (
    <div className={`layer-row${selected ? " selected" : ""}${item.visible ? "" : " hidden"}`}>
      <button className="icon-btn small" onClick={toggle} title={item.visible ? "Ocultar" : "Mostrar"}>
        <Icon name={item.visible ? "eye" : "eyeOff"} size={16} />
      </button>
      <button className="layer-name" onClick={() => useLayers.getState().select(selected ? null : target)}>
        {item.name}
      </button>
      {badge && <span className="badge">{badge}</span>}
    </div>
  );
}

/** Slider that shows changes live and records one history step when released. */
function OpacitySlider({ value, onCommit }: { value: number; onCommit(v: number): void }) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const finish = () => {
    if (dirty.current) onCommit(draft);
    dirty.current = false;
  };
  return (
    <label className="control">
      <span>Opacidad: {Math.round(draft * 100)} %</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={draft}
        onChange={(e) => {
          dirty.current = true;
          setDraft(Number(e.target.value));
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
    </label>
  );
}

function frameLabel(frameOrder: string[], id: string | null, fallback: string) {
  if (!id) return fallback;
  const i = frameOrder.indexOf(id);
  return i < 0 ? fallback : `cuadro ${i + 1}`;
}

function Details({ target }: { target: LayerTarget }) {
  const film = useEditor((s) => s.film)!;
  const selectedFrame = useEditor((s) => s.selected);
  const item = resolveTarget(target);
  const [name, setName] = useState(item?.name ?? "");
  useEffect(() => setName(item?.name ?? ""), [item?.name]);
  if (!item) return null;

  const commit = (op: Op) => useEditor.getState().commit([op]);
  const update = (patch: Partial<ImageLayer> & Partial<Channel>) =>
    commit(
      target.kind === "channel"
        ? { type: "channel.update", channelId: target.id, patch }
        : { type: "layer.update", frameId: target.frameId, layerId: target.id, patch },
    );

  const stack = target.kind === "channel" ? film.channels : (film.frames[target.frameId]?.layers ?? []);
  const index = stack.findIndex((l) => l.id === target.id);
  const move = (delta: number) =>
    commit(
      target.kind === "channel"
        ? { type: "channel.move", channelId: target.id, index: index + delta }
        : { type: "layer.move", frameId: target.frameId, layerId: target.id, index: index + delta },
    );
  const remove = () => {
    commit(
      target.kind === "channel"
        ? { type: "channel.remove", channelId: target.id }
        : { type: "layer.remove", frameId: target.frameId, layerId: target.id },
    );
    useLayers.getState().select(null);
  };
  const t = item.transform;
  const moved = t.x !== 0 || t.y !== 0 || t.rotation !== 0 || t.scale !== 1;
  const channel = target.kind === "channel" ? (item as Channel) : null;
  const isOnlyLayer = target.kind === "layer" && stack.length <= 1;

  return (
    <div className="layer-details">
      <label className="control">
        <span>Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== item.name && update({ name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <OpacitySlider value={item.opacity} onCommit={(opacity) => update({ opacity })} />
      <p className="hint">
        Arrastrá la capa en la imagen para moverla; las esquinas la agrandan y el círculo la gira (con ⇧, en pasos).
      </p>
      <div className="action-row">
        <button className="btn small" onClick={() => move(1)} disabled={index >= stack.length - 1} title="Subir">
          ▲
        </button>
        <button className="btn small" onClick={() => move(-1)} disabled={index <= 0} title="Bajar">
          ▼
        </button>
        <button className="btn small" onClick={() => update({ transform: IDENTITY_TRANSFORM })} disabled={!moved}>
          Restablecer
        </button>
      </div>
      {moved && (
        <p className="hint">
          {Math.round(t.scale * 100)} % · {Math.round((t.rotation * 180) / Math.PI)}° · {Math.round(t.x)}, {Math.round(t.y)} px
        </p>
      )}

      {channel && (
        <>
          <div className="control">
            <span>Lugar</span>
            <div className="segmented">
              <button className={channel.placement === "below" ? "active" : ""} onClick={() => update({ placement: "below" })}>
                Debajo de los cuadros
              </button>
              <button className={channel.placement === "above" ? "active" : ""} onClick={() => update({ placement: "above" })}>
                Encima
              </button>
            </div>
          </div>
          <label className="control toggle">
            <input type="checkbox" checked={channel.exported} onChange={(e) => update({ exported: e.target.checked })} />
            <span>Sale en la exportación</span>
          </label>
          <div className="control">
            <span>
              Desde {frameLabel(film.frameOrder, channel.from, "el principio")} hasta{" "}
              {frameLabel(film.frameOrder, channel.to, channel.source.kind === "sequence" ? "que termina" : "el final")}
            </span>
            <div className="action-row">
              <button className="btn small" disabled={!selectedFrame} onClick={() => update({ from: selectedFrame })}>
                Empieza acá
              </button>
              <button className="btn small" disabled={!selectedFrame} onClick={() => update({ to: selectedFrame })}>
                Termina acá
              </button>
              <button className="btn small ghost" disabled={!channel.from && !channel.to} onClick={() => update({ from: null, to: null })}>
                Toda
              </button>
            </div>
          </div>
        </>
      )}

      <button className="btn small danger" onClick={remove} disabled={isOnlyLayer}>
        <Icon name="trash" size={14} /> Borrar {channel ? "canal" : "capa"}
      </button>
    </div>
  );
}

export function LayersPanel() {
  const film = useEditor((s) => s.film)!;
  const selected = useEditor((s) => s.selected);
  const view = useEditor((s) => s.view);
  const target = useLayers((s) => s.target);
  const frame = view === "frame" && selected ? film.frames[selected] : undefined;
  const imageInput = useRef<HTMLInputElement>(null);
  const channelInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);

  // A layer of another frame cannot stay selected: its handles would not be on screen.
  useEffect(() => {
    if (target?.kind === "layer" && target.frameId !== frame?.id) useLayers.getState().select(null);
  }, [target, frame?.id]);
  useEffect(() => {
    if (target && !resolveTarget(target)) useLayers.getState().select(null);
  }, [target, film]);

  const above = film.channels.filter((c) => c.placement === "above").reverse();
  const below = film.channels.filter((c) => c.placement === "below").reverse();
  const channelBadge = (c: Channel) => (c.source.kind === "sequence" ? "video" : "imagen") + (c.exported ? "" : " · ref");

  return (
    <div className="layers-panel">
      <h3>Capas</h3>
      <div className="action-row">
        <button className="btn small" disabled={!frame} onClick={() => imageInput.current?.click()} title="Una imagen encima de este cuadro">
          <Icon name="plus" size={14} /> Imagen en el cuadro
        </button>
        <button className="btn small" onClick={() => channelInput.current?.click()} title="Una imagen sobre toda la película">
          <Icon name="plus" size={14} /> Canal de imagen
        </button>
        <button className="btn small" onClick={() => videoInput.current?.click()} title="Un video que avanza con la película, para rotoscopia">
          <Icon name="plus" size={14} /> Canal de video
        </button>
      </div>

      <div className="layer-list">
        {above.map((c) => (
          <Row key={c.id} target={{ kind: "channel", id: c.id }} item={c} badge={channelBadge(c)} />
        ))}
        {frame ? (
          [...frame.layers].reverse().map((l, i, all) => (
            <Row
              key={l.id}
              target={{ kind: "layer", frameId: frame.id, id: l.id }}
              item={l}
              badge={i === all.length - 1 ? "foto" : undefined}
            />
          ))
        ) : (
          <div className="layer-row placeholder">{view === "live" ? "Cámara en vivo" : "Elegí un cuadro"}</div>
        )}
        {below.map((c) => (
          <Row key={c.id} target={{ kind: "channel", id: c.id }} item={c} badge={channelBadge(c)} />
        ))}
      </div>

      {target ? <Details key={target.id} target={target} /> : <p className="hint">Tocá una capa para ajustarla.</p>}

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addLayerImage(f);
          e.target.value = "";
        }}
      />
      <input
        ref={channelInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImageChannel(f);
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
      {video && <VideoImportDialog file={video} mode="channel" onClose={() => setVideo(null)} />}
    </div>
  );
}
