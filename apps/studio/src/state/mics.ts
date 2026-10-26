import { type Clip, IDENTITY_TRANSFORM, type Op, type TrackId, newId } from "@gepetta/core";
import { create } from "zustand";
import { ingestSound } from "../media/sound";
import { newTrackOp } from "./actions";
import { runTask, useBusy } from "./busy";
import { type GridCursor, useEditor } from "./editor";

/**
 * Microphones in use, like the cameras: each one has its own target (a sound
 * track and a cell), shown live there in the timeline, where what it records
 * goes; its own settings (volume, which input of a sound card, cleaning up
 * the sound, hearing it, a delay to make up for); and a color.
 *
 * «Grabar» records with every enabled microphone at once while the film plays
 * from the first of their cells; each recording goes from its microphone's
 * cell, and the cell moves on to after it.
 */
export interface MicSettings {
  /** Volume of what it records (1 = as it comes). */
  gain: number;
  /** The browser's echo cancelling (takes out the film playing in the speakers). */
  echo: boolean;
  noise: boolean;
  autoGain: boolean;
  /** Plays what it hears in the speakers or headphones. */
  monitor: boolean;
  /** Moves what it records earlier by this many milliseconds (devices that lag). */
  delayMs: number;
}

export const DEFAULT_MIC: MicSettings = { gain: 1, echo: true, noise: true, autoGain: true, monitor: false, delayMs: 0 };

export interface Mic {
  id: string;
  /** Which input; null = the computer's default one. */
  deviceId: string | null;
  /** One input of a sound card with several (0 = the first), or null for all of them mixed. */
  channel: number | null;
  /** Inputs the device has. */
  channels: number;
  /** Where what it records goes (a sound track and a cell; track "" = a new track). */
  target: GridCursor;
  /** Records with «Grabar». */
  enabled: boolean;
  settings: MicSettings;
  opening: boolean;
  error: string | null;
}

/** One color per microphone (other than the cameras' ones). */
export const MIC_COLORS = ["#4fc3f7", "#f06292", "#aed581", "#ffb74d", "#9fa8da"];

export function micColor(index: number): string {
  return MIC_COLORS[Math.max(0, index) % MIC_COLORS.length]!;
}

interface Recording {
  /** The film plays from this cell. */
  startCell: number;
  playedAt: number;
  takes: { micId: string; target: GridCursor; recorder: MediaRecorder; chunks: Blob[]; startedAt: number; delayMs: number }[];
}

interface MicsState {
  devices: { id: string; label: string }[];
  mics: Mic[];
  /** The one whose panel is shown. */
  activeMic: string | null;
  /** The microphone whose cell is being picked in the timeline. */
  picking: string | null;
  recording: Recording | null;
}

export const useMics = create<MicsState>(() => ({ devices: [], mics: [], activeMic: null, picking: null, recording: null }));

/** How loud each open microphone hears now (0–1), apart so it can change often. */
export const useMicLevels = create<Record<string, number>>(() => ({}));

const PREFS_KEY = "gepetta.mics";

interface Pref {
  deviceId: string | null;
  channel: number | null;
  enabled: boolean;
  settings: MicSettings;
}

function savePrefs() {
  try {
    const prefs: Pref[] = useMics.getState().mics.map(({ deviceId, channel, enabled, settings }) => ({ deviceId, channel, enabled, settings }));
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Only a convenience.
  }
}

function loadPrefs(): Pref[] {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "[]");
    return Array.isArray(p) ? p.map((m) => ({ deviceId: m.deviceId ?? null, channel: m.channel ?? null, enabled: m.enabled !== false, settings: { ...DEFAULT_MIC, ...m.settings } })) : [];
  } catch {
    return [];
  }
}

function patch(id: string, changes: Partial<Mic>) {
  useMics.setState((s) => ({ mics: s.mics.map((m) => (m.id === id ? { ...m, ...changes } : m)) }));
}

const micOf = (id: string) => useMics.getState().mics.find((m) => m.id === id);

// -- the sound graph of each open microphone -----------------------------------

let context: AudioContext | null = null;

function micContext(): AudioContext {
  context ??= new AudioContext({ latencyHint: "interactive" });
  if (context.state === "suspended") void context.resume();
  return context;
}

interface Live {
  stream: MediaStream;
  gain: GainNode;
  monitor: GainNode;
  analyser: AnalyserNode;
  /** What is recorded: the chosen input, at its volume. */
  out: MediaStreamAudioDestinationNode;
}

const lives = new Map<string, Live>();
const generations = new Map<string, number>();

/** The analyser of an open microphone (to draw what it hears). */
export function micAnalyser(id: string): AnalyserNode | null {
  return lives.get(id)?.analyser ?? null;
}

function close(id: string) {
  const live = lives.get(id);
  lives.delete(id);
  if (!live) return;
  for (const t of live.stream.getTracks()) t.stop();
  live.gain.disconnect();
  live.monitor.disconnect();
}

async function open(id: string) {
  const mic = micOf(id);
  if (!mic) return;
  const generation = (generations.get(id) ?? 0) + 1;
  generations.set(id, generation);
  close(id);
  patch(id, { opening: true, error: null });
  try {
    const { echo, noise, autoGain } = mic.settings;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(mic.deviceId && { deviceId: { exact: mic.deviceId } }),
        echoCancellation: echo,
        noiseSuppression: noise,
        autoGainControl: autoGain,
        channelCount: { ideal: 8 },
      },
    });
    if (generations.get(id) !== generation || !micOf(id)) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const ctx = micContext();
    const source = ctx.createMediaStreamSource(stream);
    const channels = stream.getAudioTracks()[0]?.getSettings().channelCount ?? source.channelCount ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = mic.settings.gain;
    const channel = mic.channel !== null && mic.channel < channels ? mic.channel : null;
    if (channel === null) source.connect(gain);
    else {
      const splitter = ctx.createChannelSplitter(Math.max(channels, 1));
      source.connect(splitter);
      splitter.connect(gain, channel);
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    const out = ctx.createMediaStreamDestination();
    const monitor = ctx.createGain();
    monitor.gain.value = mic.settings.monitor ? 1 : 0;
    gain.connect(analyser);
    gain.connect(out);
    gain.connect(monitor).connect(ctx.destination);
    lives.set(id, { stream, gain, monitor, analyser, out });
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (lives.get(id)?.stream === stream) patch(id, { error: "Se desconectó el micrófono." });
    });
    patch(id, { opening: false, channels, channel });
    meter();
    void refreshMics();
  } catch (e) {
    if (generations.get(id) !== generation) return;
    console.error("[gepetta] microphone", e);
    const denied = e instanceof DOMException && e.name === "NotAllowedError";
    patch(id, {
      opening: false,
      error: denied ? "La app no tiene permiso para usar el micrófono." : "No se pudo abrir el micrófono: fijate que esté conectado.",
    });
  }
}

let meterTimer: number | undefined;

/** Keeps every open microphone's level up to date (while any is open). */
function meter() {
  if (meterTimer !== undefined) return;
  const data = new Float32Array(1024);
  meterTimer = window.setInterval(() => {
    if (lives.size === 0) {
      clearInterval(meterTimer);
      meterTimer = undefined;
      useMicLevels.setState({}, true);
      return;
    }
    const levels: Record<string, number> = {};
    for (const [id, live] of lives) {
      live.analyser.getFloatTimeDomainData(data);
      let m = 0;
      for (const v of data) m = Math.max(m, Math.abs(v));
      levels[id] = Math.min(1, Math.sqrt(m));
    }
    useMicLevels.setState(levels, true);
  }, 60);
}

// -- microphones in use --------------------------------------------------------

/** The sound inputs connected (their names show once a microphone was allowed). */
export async function refreshMics() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const devices = all
      .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Micrófono ${i + 1}` }));
    useMics.setState({ devices });
  } catch (e) {
    console.error("[gepetta] microphones", e);
  }
}

/** A name for a microphone: its device's, and which input. */
export function micLabel(mic: Mic): string {
  const name = mic.deviceId ? (useMics.getState().devices.find((d) => d.id === mic.deviceId)?.label ?? "Micrófono") : "Micrófono de la compu";
  return mic.channel === null ? name : `${name} · entrada ${mic.channel + 1}`;
}

/**
 * Where a new microphone points: a sound track no other microphone uses (the
 * cursor's first), at the cursor's cell; "" when there is none.
 */
function freeTarget(taken: TrackId[], named?: string): GridCursor {
  const { film, cursor } = useEditor.getState();
  const free = (film?.tracks ?? []).filter((t) => t.kind === "sound" && !taken.includes(t.id));
  const track = (named && free.find((t) => t.name === named)) || free.find((t) => t.id === cursor.track) || free[0];
  return { track: track?.id ?? "", cell: cursor.cell };
}

/** Opens one more microphone, in a sound track of its own (a new one if needed), and makes it the one shown. */
export async function addMic(deviceId: string | null, channel: number | null = null, settings: MicSettings = DEFAULT_MIC) {
  const target = freeTarget(useMics.getState().mics.map((m) => m.target.track));
  if (!target.track && useEditor.getState().film) {
    const name = `Micrófono ${useMics.getState().mics.length + 1}`;
    const made = newTrackOp(name, { kind: "sound" });
    useEditor.getState().commit([made.op, { type: "track.move", trackId: made.id, index: 0 }], `Track de sonido «${name}»`, { cursor: { track: made.id, cell: target.cell } });
    target.track = made.id;
  }
  const mic: Mic = { id: newId(), deviceId, channel, channels: 1, target, enabled: true, settings, opening: true, error: null };
  useMics.setState((s) => ({ mics: [...s.mics, mic], activeMic: mic.id }));
  savePrefs();
  await open(mic.id);
}

export function removeMic(id: string) {
  generations.set(id, (generations.get(id) ?? 0) + 1);
  close(id);
  useMics.setState((s) => {
    const mics = s.mics.filter((m) => m.id !== id);
    return { mics, activeMic: s.activeMic === id ? (mics[0]?.id ?? null) : s.activeMic, picking: s.picking === id ? null : s.picking };
  });
  savePrefs();
}

/** Opens the microphones used last time (none the first time). */
export async function startMics() {
  if (useMics.getState().mics.length) return;
  const prefs = loadPrefs();
  if (!prefs.length) return;
  const taken: TrackId[] = [];
  const mics = prefs.map((p, i): Mic => {
    // The track made for it last time, when the film has it.
    const target = freeTarget(taken, `Micrófono ${i + 1}`);
    taken.push(target.track);
    return { id: newId(), ...p, channels: 1, target, opening: true, error: null };
  });
  useMics.setState({ mics, activeMic: mics[0]!.id });
  await refreshMics();
  await Promise.all(mics.map((m) => open(m.id)));
}

/** Closes every microphone (leaving the film). */
export function stopMics() {
  if (useMics.getState().recording) void stopRecording();
  for (const id of [...lives.keys()]) close(id);
  useMics.setState({ mics: [], activeMic: null, picking: null });
}

export function setMicSettings(id: string, changes: Partial<MicSettings>) {
  const mic = micOf(id);
  if (!mic) return;
  const settings = { ...mic.settings, ...changes };
  patch(id, { settings });
  savePrefs();
  const live = lives.get(id);
  if (live && changes.gain !== undefined) live.gain.gain.setTargetAtTime(settings.gain, live.gain.context.currentTime, 0.02);
  if (live && changes.monitor !== undefined) live.monitor.gain.setTargetAtTime(settings.monitor ? 1 : 0, live.monitor.context.currentTime, 0.02);
  // The browser's cleaning up is chosen when the microphone opens.
  if ((changes.echo !== undefined || changes.noise !== undefined || changes.autoGain !== undefined) && !useMics.getState().recording) void open(id);
}

/** Another device, or another input of it. */
export function setMicInput(id: string, deviceId: string | null, channel: number | null) {
  patch(id, { deviceId, channel });
  savePrefs();
  void open(id);
}

export function setMicEnabled(id: string, enabled: boolean) {
  patch(id, { enabled });
  savePrefs();
}

export function showMic(id: string) {
  useMics.setState({ activeMic: id });
}

export function startPickingMic(id: string) {
  useMics.setState({ activeMic: id, picking: id });
}

export function cancelPickingMic() {
  useMics.setState({ picking: null });
}

/** Moves a microphone's cell (only to a sound track). */
export function setMicTarget(id: string, target: GridCursor): boolean {
  const track = useEditor.getState().film?.tracks.find((t) => t.id === target.track);
  if (track?.kind !== "sound") {
    useBusy.getState().notify("Lo que graba un micrófono va en un track de sonido: elegí una celda de uno (o grabá y se hace uno nuevo).");
    return false;
  }
  patch(id, { target });
  useEditor.getState().moveTo(target.cell, target.track);
  return true;
}

/** Picks the cell for the microphone being picked for. */
export function pickMic(target: GridCursor) {
  const id = useMics.getState().picking;
  if (id && setMicTarget(id, target)) useMics.setState({ picking: null });
}

// -- recording ------------------------------------------------------------------

function pickMime(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Records with the enabled microphones (or only `only`) while the film plays
 * from the first of their cells; with none yet, opens the computer's one.
 */
export async function startRecording(only?: string) {
  const { film } = useEditor.getState();
  if (!film || useMics.getState().recording) return;
  if (!useMics.getState().mics.length) await addMic(null);
  const mics = useMics.getState().mics.filter((m) => (only ? m.id === only : m.enabled) && lives.has(m.id));
  if (!mics.length) {
    const failed = useMics.getState().mics.find((m) => m.error);
    useBusy.getState().notify(failed?.error ?? "No hay micrófonos habilitados para grabar.");
    return;
  }
  micContext();
  const mime = pickMime();
  const takes = await Promise.all(
    mics.map(async (mic) => {
      const recorder = new MediaRecorder(lives.get(mic.id)!.out.stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      await new Promise<void>((resolve) => {
        recorder.onstart = () => resolve();
        recorder.start(250);
      });
      return { micId: mic.id, target: mic.target, recorder, chunks, startedAt: performance.now(), delayMs: mic.settings.delayMs };
    }),
  );
  const startCell = Math.min(...takes.map((t) => t.target.cell));
  const playedAt = performance.now();
  useMics.setState({ recording: { startCell, playedAt, takes } });
  // The film plays from there once (not round and round), to record over it.
  useEditor.setState({ playback: { startCell, loopFrom: 0, loop: false, startedAt: playedAt } });
  useBusy
    .getState()
    .notify(
      `Grabando${takes.length > 1 ? ` con ${takes.length} micrófonos` : ""}… (con auriculares el sonido de la película no se graba). Para parar: «Parar», Esc o la barra.`,
    );
}

/** Stops recording and puts what each microphone recorded in the film. */
export async function stopRecording() {
  const rec = useMics.getState().recording;
  if (!rec) return;
  useMics.setState({ recording: null });
  useEditor.getState().stop();
  const blobs = await Promise.all(
    rec.takes.map(
      (t) =>
        new Promise<Blob>((resolve) => {
          t.recorder.addEventListener("stop", () => resolve(new Blob(t.chunks, { type: t.recorder.mimeType || "audio/webm" })), { once: true });
          t.recorder.stop();
        }),
    ),
  );
  const { filmId } = useEditor.getState();
  if (!filmId) return;
  const read = await runTask("Guardando lo grabado", rec.takes.length, async (progress) => {
    const out: (Awaited<ReturnType<typeof ingestSound>> | null)[] = [];
    for (const blob of blobs) {
      out.push(blob.size ? await ingestSound(filmId, blob).catch(() => null) : null);
      progress(out.length);
    }
    return out;
  });
  const film = useEditor.getState().film;
  if (!read || !film || useEditor.getState().filmId !== filmId) return;
  const fps = film.settings.fps;
  const ops: Op[] = [];
  const clips: Clip[] = [];
  const moved: { micId: string; target: GridCursor }[] = [];
  let voices = film.tracks.filter((t) => t.kind === "sound" && t.name.startsWith("Voz")).length;
  const used = new Set<TrackId>();
  rec.takes.forEach((take, i) => {
    const got = read[i];
    if (!got) return;
    // The recording began a moment before the film started playing, and before the film reached this microphone's cell.
    const from = Math.max(0, (rec.playedAt - take.startedAt + take.delayMs) / 1000 + (take.target.cell - rec.startCell) / fps);
    const length = Math.round((got.ref.duration - from) * fps);
    if (length < 1) return;
    // Two microphones in one track would cover each other: the second gets a new one.
    let track: TrackId | undefined = film.tracks.find((t) => t.id === take.target.track && t.kind === "sound" && !used.has(t.id))?.id;
    const name = `Voz ${++voices}`;
    if (!track) {
      const made = newTrackOp(name, { kind: "sound" });
      ops.push(made.op, { type: "track.move", trackId: made.id, index: 0 });
      track = made.id;
    }
    used.add(track);
    clips.push({ id: newId(), track, start: take.target.cell, length, media: got.media, name, visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, sound: { ref: got.ref, from } });
    moved.push({ micId: take.micId, target: { track, cell: take.target.cell + length } });
  });
  if (!clips.length) return;
  const label = clips.length === 1 ? `Grabar «${clips[0]!.name}»` : `Grabar con ${clips.length} micrófonos`;
  ops.push({ type: "clip.place", clips, label });
  const first = clips[0]!;
  useEditor.getState().commit(ops, label, { cursor: { track: first.track, cell: first.start }, selection: clips.length === 1 ? [first.id] : [] });
  // Each microphone's cell moves on to after what it recorded, as a camera's after a photo.
  for (const m of moved) patch(m.micId, { target: m.target });
}

/** Records with the enabled microphones, or stops. */
export function toggleRecording() {
  void (useMics.getState().recording ? stopRecording() : startRecording());
}
