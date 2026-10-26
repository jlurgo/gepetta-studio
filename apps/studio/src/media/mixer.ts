import type { Track } from "@gepetta/core";
import { makeVoice } from "./voices";

/**
 * Where a sound track's sound goes before the speakers (or an export): its
 * volume, its voice effect, its place between left and right, and a meter of
 * how loud it is playing.
 */
export interface Bus {
  /** What the track's sounds play into. */
  input: AudioNode;
  analyser: AnalyserNode | null;
  /** Follows the track's volume (with its groups', see trackVolume) and place now, smoothly while it plays. */
  update(track: Track, volume: number): void;
  dispose(): void;
}

/** What a bus is built from: when it changes, the bus is made again (the rest is updated). */
export function busKey(track: Track): string {
  return track.voice ?? "";
}

export function makeBus(ctx: BaseAudioContext, track: Track, volume: number, dest: AudioNode, meter = false): Bus {
  const input = ctx.createGain();
  input.gain.value = volume;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, track.pan ?? 0));
  const voice = track.voice ? makeVoice(ctx, track.voice) : null;
  if (voice) {
    input.connect(voice.input);
    voice.output.connect(pan);
  } else input.connect(pan);
  pan.connect(dest);
  let analyser: AnalyserNode | null = null;
  if (meter) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    pan.connect(analyser);
  }
  return {
    input,
    analyser,
    update(t, v) {
      input.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, t.pan ?? 0)), ctx.currentTime, 0.02);
    },
    dispose() {
      voice?.dispose();
      input.disconnect();
      pan.disconnect();
    },
  };
}

/** How loud a bus is playing now (0–1). */
const data = new Float32Array(512);
export function busLevel(bus: Bus | undefined): number {
  if (!bus?.analyser) return 0;
  bus.analyser.getFloatTimeDomainData(data);
  let m = 0;
  for (const v of data) m = Math.max(m, Math.abs(v));
  return Math.min(1, Math.sqrt(m));
}
