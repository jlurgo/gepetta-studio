import { type Clip, IDENTITY_TRANSFORM, type Op, type TrackId, newId } from "@gepetta/core";
import { create } from "zustand";
import { ingestSound } from "../media/sound";
import { newTrackOp } from "./actions";
import { runTask, useBusy } from "./busy";
import { useEditor } from "./editor";

/**
 * Recording sound with the microphone, over the film: it plays from the
 * cursor while recording, so a voice or a noise lands on the frames it goes
 * with. What was recorded goes from that cell into the cursor's sound track
 * (or a new one, «Voz N»).
 */
interface VoiceState {
  /** Recording since that cell (into that track, when it is a sound track). */
  recording: { cell: number; track: TrackId } | null;
  /** Microphone level now (0–1), to show it is hearing. */
  level: number;
}

export const useVoice = create<VoiceState>(() => ({ recording: null, level: 0 }));

let session: { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; playedAt: number; meter: number } | null = null;

function pickMime(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
}

/** Starts (or stops) recording from the cursor. */
export async function toggleVoice() {
  if (useVoice.getState().recording) return stopVoice();
  const { film, cursor } = useEditor.getState();
  if (!film) return;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    console.error("[gepetta] microphone", e);
    useBusy.getState().notify("No se pudo usar el micrófono: fijate que esté conectado y que la app tenga permiso.");
    return;
  }
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // A level meter, so it shows the microphone hears.
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const meter = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let m = 0;
    for (const v of data) m = Math.max(m, Math.abs(v));
    useVoice.setState({ level: Math.min(1, Math.sqrt(m)) });
  }, 60);
  recorder.onstop = () => {
    clearInterval(meter);
    void ctx.close();
  };
  await new Promise<void>((resolve) => {
    recorder.onstart = () => resolve();
    recorder.start(250);
  });
  const startedAt = performance.now();
  session = { recorder, stream, chunks, startedAt, playedAt: startedAt, meter };
  const track = film.tracks.find((t) => t.id === cursor.track && t.kind === "sound")?.id ?? "";
  useVoice.setState({ recording: { cell: cursor.cell, track } });
  // The film plays from there once (not round and round), to record over it.
  session.playedAt = performance.now();
  useEditor.setState({ playback: { startCell: cursor.cell, loopFrom: 0, loop: false, startedAt: session.playedAt } });
  useBusy.getState().notify("Grabando… (con auriculares el sonido de la película no se graba). Para parar: el botón, Esc o la barra.");
}

/** Stops recording and puts what was recorded in the film. */
export async function stopVoice() {
  const s = session;
  const rec = useVoice.getState().recording;
  session = null;
  useVoice.setState({ recording: null, level: 0 });
  if (!s || !rec) return;
  useEditor.getState().stop();
  await new Promise<void>((resolve) => {
    s.recorder.addEventListener("stop", () => resolve(), { once: true });
    s.recorder.stop();
  });
  for (const t of s.stream.getTracks()) t.stop();
  const { filmId, film } = useEditor.getState();
  if (!filmId || !film || !s.chunks.length) return;
  const blob = new Blob(s.chunks, { type: s.recorder.mimeType || "audio/webm" });
  const read = await runTask("Guardando lo grabado", 1, () => ingestSound(filmId, blob));
  const now = useEditor.getState().film;
  if (!read || !now || useEditor.getState().filmId !== filmId) return;
  // The recording began a moment before the film started playing: that moment is left out.
  const from = Math.max(0, (s.playedAt - s.startedAt) / 1000);
  const fps = now.settings.fps;
  const length = Math.max(1, Math.round((read.ref.duration - from) * fps));
  const ops: Op[] = [];
  let track = now.tracks.find((t) => t.id === rec.track)?.id;
  const count = now.tracks.filter((t) => t.kind === "sound" && t.name.startsWith("Voz")).length;
  const name = `Voz ${count + 1}`;
  if (!track) {
    const made = newTrackOp(name, { kind: "sound" });
    ops.push(made.op, { type: "track.move", trackId: made.id, index: 0 });
    track = made.id;
  }
  const clip: Clip = { id: newId(), track, start: rec.cell, length, media: read.media, name, visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, sound: { ref: read.ref, from } };
  ops.push({ type: "clip.place", clips: [clip], label: `Grabar «${name}»` });
  useEditor.getState().commit(ops, `Grabar «${name}»`, { cursor: { track, cell: rec.cell }, selection: [clip.id] });
}
