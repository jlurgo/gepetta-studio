import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/editor";
import {
  type Mic,
  addMic,
  micAnalyser,
  micColor,
  micLabel,
  refreshMics,
  removeMic,
  setMicEnabled,
  setMicInput,
  setMicSettings,
  startPickingMic,
  startRecording,
  stopRecording,
  useMicLevels,
  useMics,
} from "../state/mics";
import { usePaint } from "../state/paint";
import { useLayers } from "../state/layers";
import { Icon } from "./Icon";
import { Section } from "./Section";

/**
 * What a microphone hears now, as bars from low (left) to high (right)
 * sounds, in its color; drawn while it is on screen.
 */
export function MicLive({ id, color, width, height, bars = 24 }: { id: string; color: string; width: number; height: number; bars?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    let data = new Uint8Array(0);
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      ctx.clearRect(0, 0, width, height);
      const analyser = micAnalyser(id);
      if (!analyser) return;
      if (data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      // Bands spaced as we hear them, from 60 Hz to 12 kHz.
      const nyquist = analyser.context.sampleRate / 2;
      const bin = (hz: number) => Math.min(data.length - 1, Math.max(1, Math.round((hz / nyquist) * data.length)));
      const bw = width / bars;
      ctx.fillStyle = color;
      for (let b = 0; b < bars; b++) {
        const a = bin(60 * Math.pow(200, b / bars));
        const e = Math.max(a + 1, bin(60 * Math.pow(200, (b + 1) / bars)));
        let m = 0;
        for (let k = a; k < e; k++) m = Math.max(m, data[k]!);
        const h = Math.max(1, (m / 255) * height);
        ctx.fillRect(b * bw + 0.5, height - h, Math.max(1, bw - 1), h);
      }
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [id, color, width, height, bars]);
  return <canvas ref={ref} className="mic-live" style={{ width, height }} />;
}

/** Choosing a microphone as the tool shows its panel; again, asks for its cell. */
export function chooseMic(id: string) {
  const tool = usePaint.getState();
  const mics = useMics.getState();
  if (tool.tool === "mic" && mics.activeMic === id) startPickingMic(id);
  else useMics.setState({ activeMic: id });
  tool.setTool("mic");
  useLayers.setState({ panel: "tool" });
}

/** Where what it records goes, and the cell picking. */
function MicTarget({ mic, color }: { mic: Mic; color: string }) {
  const track = useEditor((s) => s.film?.tracks.find((t) => t.id === mic.target.track));
  const picking = useMics((s) => s.picking === mic.id);
  return (
    <div className="camera-target" style={{ ["--rig" as string]: color }}>
      <span>
        Lo que graba va {track ? <>a <strong>{track.name}</strong></> : "a un track de sonido nuevo"}, desde la celda {mic.target.cell + 1}
      </span>
      <button className={`btn small${picking ? " active" : ""}`} onClick={() => (picking ? useMics.setState({ picking: null }) : startPickingMic(mic.id))}>
        {picking ? "Elegí la celda… (Esc)" : "Elegir celda"}
      </button>
    </div>
  );
}

function Toggle({ checked, onChange, label, title }: { checked: boolean; onChange(v: boolean): void; label: string; title?: string }) {
  return (
    <label className="control toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** The microphone in use as a tool: where what it records goes, hearing it, and its settings. */
export function MicToolPanel() {
  const mic = useMics((s) => s.mics.find((m) => m.id === s.activeMic));
  const index = useMics((s) => s.mics.findIndex((m) => m.id === s.activeMic));
  const devices = useMics((s) => s.devices);
  const recording = useMics((s) => !!s.recording);
  const together = useMics((s) => s.mics.filter((m) => m.enabled).length);
  const level = useMicLevels((s) => (mic ? (s[mic.id] ?? 0) : 0));
  if (!mic) return <AddMicPanel />;
  const color = micColor(index);
  const { settings } = mic;
  const set = (c: Partial<typeof settings>) => setMicSettings(mic.id, c);

  return (
    <div className="tool-options camera-panel">
      <div className="camera-head">
        <span className="rig-dot" style={{ background: color }}>
          {index + 1}
        </span>
        <strong>{micLabel(mic)}</strong>
        {mic.opening && <small>abriendo…</small>}
      </div>
      <MicTarget mic={mic} color={color} />
      <div className="mic-hear" title="Lo que escucha ahora: a la izquierda los graves, a la derecha los agudos">
        <MicLive id={mic.id} color={color} width={252} height={48} bars={36} />
        <span className="mic-level" style={{ width: `${Math.round(level * 100)}%`, background: level > 0.95 ? "#ff5b5b" : color }} />
      </div>
      <Toggle checked={mic.enabled} onChange={(v) => setMicEnabled(mic.id, v)} label="Graba junto con los otros" title="«Grabar» graba con todos los micrófonos que tienen esto marcado" />
      <div className="action-row">
        {recording ? (
          <button className="btn small recording" onClick={() => void stopRecording()} title="Esc o la barra también paran">
            <Icon name="stop" size={14} /> Parar
          </button>
        ) : (
          <>
            <button
              className="btn small primary"
              onClick={() => void startRecording()}
              disabled={!together}
              title="Graba con los micrófonos marcados, cada uno desde su celda, mientras la película se reproduce (Esc o la barra paran)"
            >
              <Icon name="record" size={14} /> Grabar{together > 1 ? ` (${together} micrófonos)` : ""}
            </button>
            {together > 1 && (
              <button className="btn small" onClick={() => void startRecording(mic.id)} disabled={!!mic.error || mic.opening}>
                Solo con este
              </button>
            )}
          </>
        )}
      </div>
      {mic.error && (
        <div className="panel-error">
          {mic.error}
          <div className="action-row">
            <button className="btn small" onClick={() => setMicInput(mic.id, mic.deviceId, mic.channel)}>
              Reintentar
            </button>
          </div>
        </div>
      )}

      <Section title="Entrada y volumen">
        <label className="control">
          <span>Micrófono</span>
          <select value={mic.deviceId ?? ""} onChange={(e) => setMicInput(mic.id, e.target.value || null, null)} disabled={recording}>
            <option value="">El de la compu (predeterminado)</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {mic.channels > 1 && (
          <label className="control" title="Una placa de sonido con varias entradas: cada una puede ser un micrófono aparte (agregá otro micrófono con el mismo aparato y elegí otra entrada)">
            <span>Entrada</span>
            <select value={mic.channel ?? ""} onChange={(e) => setMicInput(mic.id, mic.deviceId, e.target.value === "" ? null : Number(e.target.value))} disabled={recording}>
              <option value="">Todas juntas</option>
              {Array.from({ length: mic.channels }, (_, i) => (
                <option key={i} value={i}>
                  Entrada {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="control">
          <span>
            Volumen <small>{Math.round(settings.gain * 100)} %</small>
          </span>
          <input type="range" min={0} max={4} step={0.05} value={settings.gain} onChange={(e) => set({ gain: Number(e.target.value) })} />
        </label>
        <p className="hint">Hablá fuerte: la barrita de abajo no tiene que llegar al final (se pone roja cuando satura).</p>
      </Section>

      <Section title="Limpiar el sonido" open={false}>
        <Toggle checked={settings.echo} onChange={(v) => set({ echo: v })} label="Sacar el eco" title="Saca lo que suena en los parlantes (la película) de lo que se graba" />
        <Toggle checked={settings.noise} onChange={(v) => set({ noise: v })} label="Bajar el ruido de fondo" />
        <Toggle checked={settings.autoGain} onChange={(v) => set({ autoGain: v })} label="Volumen automático" title="Sube lo que se oye poco y baja lo fuerte; para música o efectos, mejor sin" />
        <p className="hint">Para voces, mejor todo prendido. Para música, instrumentos o ruidos, apagalos: suenan más naturales.</p>
      </Section>

      <Section title="Escuchar y sincronizar" open={false}>
        <Toggle checked={settings.monitor} onChange={(v) => set({ monitor: v })} label="Escucharlo mientras graba" title="Con auriculares: con parlantes se acopla (chilla)" />
        <label className="control" title="Si lo grabado queda atrasado respecto de la imagen, adelantalo">
          <span>
            Adelantar lo grabado <small>{settings.delayMs} ms</small>
          </span>
          <input type="range" min={0} max={500} step={10} value={settings.delayMs} onChange={(e) => set({ delayMs: Number(e.target.value) })} />
        </label>
      </Section>

      <button className="btn small danger" onClick={() => removeMic(mic.id)} disabled={recording}>
        <Icon name="close" size={14} /> Dejar de usar este micrófono
      </button>
    </div>
  );
}

/** Choosing one more microphone (the same device again, for another input of a sound card). */
export function AddMicPanel() {
  const devices = useMics((s) => s.devices);
  const [searching, setSearching] = useState(false);
  useEffect(() => void refreshMics(), []);
  const add = (id: string | null) =>
    void addMic(id).then(() => {
      usePaint.getState().setTool("mic");
      useLayers.setState({ panel: "tool" });
    });
  return (
    <div className="tool-options">
      <p className="hint">
        Cada micrófono es una herramienta, como las cámaras: tiene su celda en un track de sonido, que se ve en vivo, y sus ajustes. Varios graban juntos, cada uno en su track, y también graban el sonido de los videos de las cámaras.
      </p>
      <div className="free-cameras">
        <button className="btn small" onClick={() => add(null)}>
          <Icon name="plus" size={14} /> El de la compu <small>(predeterminado)</small>
        </button>
        {devices.map((d) => (
          <button key={d.id} className="btn small" onClick={() => add(d.id)}>
            <Icon name="plus" size={14} /> {d.label}
          </button>
        ))}
      </div>
      <button
        className="btn small ghost"
        onClick={async () => {
          setSearching(true);
          await refreshMics();
          setSearching(false);
        }}
        disabled={searching}
      >
        {searching ? "Buscando…" : "Buscar micrófonos conectados"}
      </button>
      <p className="hint">Con una placa de sonido de varias entradas, agregala varias veces y elegí una entrada distinta en cada una.</p>
    </div>
  );
}
