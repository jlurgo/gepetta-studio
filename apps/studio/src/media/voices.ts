import type { VoiceEffect } from "@gepetta/core";

/**
 * Effects for a sound track's voice, built from plain Web Audio nodes so
 * they sound the same while working and in an export (an offline context).
 * Each one keeps the sound's timing, so it stays in sync with the cells.
 */
export const VOICE_EFFECTS: { id: VoiceEffect; label: string }[] = [
  { id: "ardilla", label: "Ardilla (aguda)" },
  { id: "monstruo", label: "Monstruo (grave)" },
  { id: "robot", label: "Robot" },
  { id: "eco", label: "Eco" },
  { id: "telefono", label: "Teléfono" },
  { id: "cueva", label: "Cueva" },
];

export interface VoiceChain {
  input: AudioNode;
  output: AudioNode;
  dispose(): void;
}

/**
 * Pitch shifting without changing the timing: two delay lines whose delay
 * sweeps (faster or slower sound), crossfaded so the jumps back do not show
 * (after Chris Wilson's "Jungle"). `ratio` > 1 is higher; < 1 lower.
 */
function pitchShift(ctx: BaseAudioContext, ratio: number): VoiceChain {
  const BUFFER = 0.1;
  const FADE = 0.05;
  const rate = ctx.sampleRate;
  const active = Math.round(BUFFER * rate);
  const length = active + Math.round((BUFFER - 2 * FADE) * rate);
  const up = ratio > 1;
  // The delay over one sweep: down for a higher sound, up for a lower one.
  const sweep = ctx.createBuffer(1, length, rate);
  const fade = ctx.createBuffer(1, length, rate);
  const s = sweep.getChannelData(0);
  const f = fade.getChannelData(0);
  const fadeLength = FADE * rate;
  for (let i = 0; i < active; i++) {
    s[i] = up ? (active - i) / length : i / active;
    f[i] = i < fadeLength ? Math.sqrt(i / fadeLength) : i >= active - fadeLength ? Math.sqrt(1 - (i - (active - fadeLength)) / fadeLength) : 1;
  }
  // Delay swept over a sweep: (ratio - 1) for higher, (1 - ratio) for lower, of the sweep's time.
  const depth = Math.abs(ratio - 1) * BUFFER * (up ? length / active : 1);
  const input = ctx.createGain();
  const output = ctx.createGain();
  const sources: AudioBufferSourceNode[] = [];
  const t = ctx.currentTime + 0.05;
  for (const offset of [0, BUFFER - FADE]) {
    const mod = ctx.createBufferSource();
    mod.buffer = sweep;
    mod.loop = true;
    const modGain = ctx.createGain();
    modGain.gain.value = depth;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0;
    mod.connect(modGain).connect(delay.delayTime);
    const fader = ctx.createBufferSource();
    fader.buffer = fade;
    fader.loop = true;
    const mix = ctx.createGain();
    mix.gain.value = 0;
    fader.connect(mix.gain);
    input.connect(delay).connect(mix).connect(output);
    mod.start(t + offset);
    fader.start(t + offset);
    sources.push(mod, fader);
  }
  return {
    input,
    output,
    dispose() {
      for (const src of sources) src.stop();
      input.disconnect();
      output.disconnect();
    },
  };
}

/** A metallic voice: multiplied by a low tone, plus a short ringing echo. */
function robot(ctx: BaseAudioContext): VoiceChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const ring = ctx.createGain();
  ring.gain.value = 0;
  const osc = ctx.createOscillator();
  osc.frequency.value = 50;
  osc.connect(ring.gain);
  osc.start();
  const comb = ctx.createDelay(0.1);
  comb.delayTime.value = 0.006;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.55;
  input.connect(ring);
  ring.connect(comb).connect(feedback).connect(comb);
  ring.connect(output);
  comb.connect(output);
  output.gain.value = 0.75;
  return {
    input,
    output,
    dispose() {
      osc.stop();
      input.disconnect();
      output.disconnect();
      comb.disconnect();
    },
  };
}

/** The sound, and again and again a bit later, softer each time. */
function echo(ctx: BaseAudioContext): VoiceChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  input.connect(output);
  input.connect(delay).connect(feedback).connect(delay);
  delay.connect(wet).connect(output);
  return {
    input,
    output,
    dispose() {
      input.disconnect();
      delay.disconnect();
      output.disconnect();
    },
  };
}

/** Only the middle sounds, a little broken, as down a telephone line. */
function telephone(ctx: BaseAudioContext): VoiceChain {
  const input = ctx.createBiquadFilter();
  input.type = "highpass";
  input.frequency.value = 450;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 3000;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(3 * x);
  }
  shaper.curve = curve;
  const output = ctx.createGain();
  output.gain.value = 0.8;
  input.connect(low).connect(shaper).connect(output);
  return {
    input,
    output,
    dispose() {
      input.disconnect();
      output.disconnect();
    },
  };
}

/** A big stone room: the sound lingers a couple of seconds. */
function cave(ctx: BaseAudioContext): VoiceChain {
  const seconds = 2.6;
  const rate = ctx.sampleRate;
  const impulse = ctx.createBuffer(2, Math.round(seconds * rate), rate);
  // Seeded noise, so an export sounds as it did while working.
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = noise() * Math.pow(1 - i / d.length, 3);
  }
  const input = ctx.createGain();
  const output = ctx.createGain();
  const room = ctx.createConvolver();
  room.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  const dry = ctx.createGain();
  dry.gain.value = 0.75;
  input.connect(dry).connect(output);
  input.connect(room).connect(wet).connect(output);
  return {
    input,
    output,
    dispose() {
      input.disconnect();
      room.disconnect();
      output.disconnect();
    },
  };
}

export function makeVoice(ctx: BaseAudioContext, effect: VoiceEffect): VoiceChain {
  switch (effect) {
    case "ardilla":
      return pitchShift(ctx, 1.6);
    case "monstruo":
      return pitchShift(ctx, 0.62);
    case "robot":
      return robot(ctx);
    case "eco":
      return echo(ctx);
    case "telefono":
      return telephone(ctx);
    case "cueva":
      return cave(ctx);
  }
}
