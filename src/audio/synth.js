import { audio } from './context.js';
import { midiToHz, clamp } from '../state.js';

// ─── Small synthesis toolkit shared by the voices ─────────────────────────────

export function osc(type, hz, t, stop, detune = 0) {
  const o = audio.ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  o.detune.value = detune;
  o.start(t);
  o.stop(stop);
  return o;
}

export function gain(value = 1) {
  const g = audio.ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filter(type, hz, q = 0.7) {
  const f = audio.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

// Route `node` into a send bus (reverb/echo) at `level`.
export function send(node, dest, level) {
  if (!(level > 0)) return;
  const g = gain(level);
  node.connect(g);
  g.connect(dest);
}

// Percussive envelope: a short linear attack from silence (so no waveform
// starts on a step), then an exponential fall to -60 dB over `decay` seconds.
export function perc(param, t, peak, decay, attack = 0.002) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(Math.max(peak * 1e-3, 1e-6), t + attack + decay);
  return t + attack + decay;
}

// Attack / hold / release. `hold` is measured from `t`. Returns the end time.
export function ahr(param, t, peak, attack, hold, release) {
  const h = Math.max(attack, hold);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + h);
  param.linearRampToValueAtTime(0, t + h + release);
  return t + h + release;
}

// Sine LFO whose output (±depth) can be connected to any AudioParam.
// `delay` fades the modulation in — players add vibrato after the attack.
export function lfo(hz, depth, t, stop, delay = 0, fadeIn = 0.3) {
  const o = osc('sine', hz, t, stop);
  const g = gain(delay > 0 ? 0 : depth);
  if (delay > 0) {
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(depth, t + delay + fadeIn);
  }
  o.connect(g);
  return g;
}

// ─── Modulation effects ───────────────────────────────────────────────────────
// Built into an instrument the way they were built into the hardware, one per
// chord or note, so they stop with it. Each returns { input, output }; the
// input is mono, the output stereo.

// A free-running LFO: a cached one-cycle buffer, looped, and started at the
// phase it would have reached had it been running since time zero. Effects
// made per chord therefore sweep on continuously from one chord to the next,
// as a single hardware LFO would, instead of restarting at every change.
// `shift` offsets the phase by a fraction of a cycle. Output is ±1.
const cycles = new Map();
function freeLfo(shape, hz, t, stop, shift = 0) {
  const ctx = audio.ctx, key = `${shape}|${hz}|${ctx.sampleRate}`;
  if (!cycles.has(key)) {
    const n = Math.round(ctx.sampleRate / hz), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      d[i] = shape === 'triangle' ? (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4) : Math.sin(2 * Math.PI * p);
    }
    cycles.set(key, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = cycles.get(key);
  src.loop = true;
  const period = src.buffer.duration;
  src.start(t, (((t / period + shift) % 1) + 1) % 1 * period);
  src.stop(stop);
  return src;
}

// Juno-60 chorus: the signal through a short delay swept by a triangle LFO,
// mixed with the dry sound. The right channel's sweep runs opposite the
// left's, so the two sides detune in opposite directions and the sound
// spreads wide without any second oscillator. Mode I is slow and gentle
// (0.51 Hz), mode II faster (0.86 Hz); the delay swings 1.66–5.35 ms.
export function chorus(t, stop, mode = 1) {
  const ctx = audio.ctx;
  const input = gain(1), output = ctx.createChannelMerger(2);
  const sweep = gain(0.00185), inverse = gain(-1);
  freeLfo('triangle', mode === 2 ? 0.863 : 0.513, t, stop).connect(sweep);
  sweep.connect(inverse);
  [sweep, inverse].forEach((mod, ch) => {
    const d = ctx.createDelay(0.01), dry = gain(0.7), wet = gain(0.7);
    d.delayTime.value = 0.0035;
    mod.connect(d.delayTime);
    input.connect(dry); input.connect(d); d.connect(wet);
    dry.connect(output, 0, ch); wet.connect(output, 0, ch);
  });
  return { input, output };
}

// String-machine ensemble (the Solina's): three delay lines, each swept by a
// slow and a fast sine, the three a third of a cycle apart, wet only. The
// slow sweep is the chorus, the fast one the shimmer that makes a single
// oscillator per note sound like a section.
export function ensemble(t, stop) {
  const ctx = audio.ctx;
  const input = gain(1), output = ctx.createChannelMerger(2);
  const lines = [0, 1, 2].map(k => {
    const d = ctx.createDelay(0.02);
    d.delayTime.value = 0.007;
    for (const [hz, depth] of [[0.63, 0.0016], [6.3, 0.0001]]) {
      const g = gain(depth);
      freeLfo('sine', hz, t, stop, k / 3).connect(g);
      g.connect(d.delayTime);
    }
    input.connect(d);
    return d;
  });
  // Outer lines to their own side, the middle one to both.
  const mid = gain(0.7);
  lines[0].connect(output, 0, 0);
  lines[2].connect(output, 0, 1);
  lines[1].connect(mid); mid.connect(output, 0, 0); mid.connect(output, 0, 1);
  return { input, output };
}

// Two-stage phaser (an Electro-Harmonix Small Stone, more or less): allpass
// filters swept by a slow LFO, mixed with the dry sound, so two notches glide
// up and down the spectrum. The sweep is in cents, so it's even in pitch.
// Takes and returns stereo.
export function phaser(t, stop, rate = 0.22) {
  const input = gain(1), output = gain(0.7);
  const sweep = gain(1900);
  freeLfo('sine', rate, t, stop).connect(sweep);
  let node = input;
  for (let i = 0; i < 2; i++) {
    const ap = filter('allpass', 650, 0.5);
    sweep.connect(ap.detune);
    node.connect(ap);
    node = ap;
  }
  input.connect(output); node.connect(output);
  return { input, output };
}

// ─── Waveshaping ──────────────────────────────────────────────────────────────
const curves = new Map();
// Soft saturation (tanh). `bias` adds asymmetry → even harmonics.
export function shaper(drive = 2, bias = 0) {
  const key = `${drive}|${bias}`;
  let curve = curves.get(key);
  if (!curve) {
    curve = new Float32Array(1024);
    const norm = Math.tanh(drive * (1 + Math.abs(bias)));
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = (Math.tanh(drive * (x + bias)) - Math.tanh(drive * bias)) / norm;
    }
    curves.set(key, curve);
  }
  const ws = audio.ctx.createWaveShaper();
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

// ─── Plucked string (Karplus–Strong, Jaffe–Smith extensions) ─────────────────
// A burst of noise circulates in a delay line one period long. A two-point
// averaging filter in the loop removes a little high end on every pass, so
// upper partials die away faster than the fundamental — which is exactly what
// a real string does, and why this sounds like a string rather than a beep.
//
//   t60    — seconds for the fundamental to decay by 60 dB
//   bright — 0…1, lowpass on the excitation (finger/felt ≈ 0.2, pick ≈ 0.8)
//   pick   — pluck position along the string (0.5 = middle: hollow, 0.08 =
//            near the bridge: nasal/twangy); comb-filters the excitation
//   stretch— loop-filter weight; < 0.5 keeps the highs ringing longer
//
// Rendered into an AudioBuffer (the loop runs faster than real time), with a
// first-order allpass supplying the fractional part of the delay so the pitch
// is in tune rather than rounded to a whole-sample period.
export function pluckBuffer(midi, { t60 = 1.5, bright = 0.5, pick = 0.25, stretch = 0.5, length = t60 } = {}) {
  const ctx = audio.ctx;
  const sr  = ctx.sampleRate;
  const f   = midiToHz(midi);
  const len = Math.max(1, Math.floor(sr * length));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  const S      = clamp(stretch, 0.05, 0.5);
  const period = sr / f;
  let N = Math.floor(period - S);
  let d = period - S - N;          // fractional delay for the allpass
  if (d < 0.1) { N -= 1; d += 1; } // keep the allpass away from its unstable edge
  N = Math.max(2, N);
  const C = (1 - d) / (1 + d);
  const g = Math.pow(0.001, 1 / (f * t60)); // per-period loss for the requested T60

  // Excitation: filtered noise, comb-filtered at the pluck position, zero-mean.
  const line = new Float32Array(N);
  const k    = 0.05 + 0.95 * clamp(bright, 0, 1);
  let lp = 0, mean = 0;
  for (let i = 0; i < N; i++) {
    lp += k * ((Math.random() * 2 - 1) - lp);
    line[i] = lp;
  }
  const p = Math.max(1, Math.round(clamp(pick, 0.02, 0.5) * N));
  const exc = new Float32Array(N);
  for (let i = 0; i < N; i++) exc[i] = line[i] - line[(i - p + N) % N];
  let peak = 0;
  for (let i = 0; i < N; i++) mean += exc[i];
  mean /= N;
  for (let i = 0; i < N; i++) { exc[i] -= mean; peak = Math.max(peak, Math.abs(exc[i])); }
  for (let i = 0; i < N; i++) line[i] = exc[i] / (peak || 1);

  let idx = 0, prev = 0, apIn = 0, apOut = 0;
  for (let n = 0; n < len; n++) {
    const x = line[idx];
    out[n] = x;
    const y  = g * ((1 - S) * x + S * prev);
    prev = x;
    const ap = C * (y - apOut) + apIn; // fractional-delay allpass
    apIn = y; apOut = ap;
    line[idx] = ap;
    idx = idx + 1 === N ? 0 : idx + 1;
  }
  return buf;
}

// Play a rendered buffer. Returns the source so callers can bend its pitch
// (source.detune) or connect it onward.
export function playBuffer(buf, t, stop) {
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.start(t);
  src.stop(Math.min(stop, t + buf.duration));
  return src;
}
