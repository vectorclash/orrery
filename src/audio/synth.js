import { audio } from './context.js';
import { midiToHz, clamp, random } from '../state.js';
import { seeded, hashSeed } from '../random.js';

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

// Wander: no player holds a pitch perfectly still. A singer's or a string
// player's pitch drifts by a few cents, slowly and never the same way twice,
// and that, more than vibrato, is what separates a performed note from an
// oscillator: a chord of oscillators sharing one vibrato is a choir of
// robots. Smoothed noise below a few Hz, ±1 at `depth` (connect it to a
// detune, in cents). One loop of it is made once, from its own seed, so it
// takes no draws from the music; each use starts at its own place in the
// loop, from its start time and `key`, so every player drifts on their own.
const WANDER_SECONDS = 29, WANDER_RATE = 8000;
let wanderLoop = null;
function wanderBuffer() {
  if (wanderLoop) return wanderLoop;
  const n = WANDER_SECONDS * WANDER_RATE, fade = WANDER_RATE;
  const raw = new Float32Array(n + fade), white = seeded(hashSeed('wander'));
  const c = Math.exp(-2 * Math.PI * 3 / WANDER_RATE); // two poles at 3 Hz
  let a = 0, b = 0;
  for (let i = -WANDER_RATE * 2; i < n + fade; i++) {
    a = c * a + (1 - c) * (white() * 2 - 1);
    b = c * b + (1 - c) * a;
    if (i >= 0) raw[i] = b;
  }
  // Crossfade the tail into the head so the loop has no seam.
  for (let i = 0; i < fade; i++) raw[i] = raw[i] * (i / fade) + raw[n + i] * (1 - i / fade);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(raw[i]));
  const buf = audio.ctx.createBuffer(1, n, WANDER_RATE), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = raw[i] / (peak || 1);
  return (wanderLoop = buf);
}

export function wander(t, stop, depth, key = 0) {
  const src = audio.ctx.createBufferSource();
  src.buffer = wanderBuffer();
  src.loop = true;
  const at = ((t * 0.618034 + key * 0.381966) % 1 + 1) % 1;
  src.start(t, at * WANDER_SECONDS);
  src.stop(stop);
  const g = gain(depth);
  src.connect(g);
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

// ─── Plucked string ───────────────────────────────────────────────────────────
// Karplus–Strong with the Jaffe–Smith extensions: a burst of energy
// circulates in a delay line one period long, and a two-point averaging
// filter in the loop removes a little high end on every pass, so upper
// partials die away faster than the fundamental — which is exactly what a real
// string does, and why this sounds like a string rather than a beep.
//
// A bare string is only half an instrument, though. What reaches a listener
// from an acoustic guitar is the string's force on the bridge filtered by the
// body, a few dozen wooden and air resonances; from an electric guitar it's
// the string as one pickup hears it. Without either, a modelled string sounds
// like a toy. Three optional stages put them back:
//
//   body   — commuted synthesis (Smith; Karjalainen and Välimäki, 1993). The
//            body is linear, so instead of filtering every note's output
//            through it, its impulse response is fed into the string as the
//            pluck: the output is the same, and costs no more than the bare
//            string. See BODIES.
//   pol    — the second polarisation. A string vibrates both parallel to the
//            top and into it; the two are tuned a hair apart and the one
//            pressing into the bridge loses energy faster. Their sum has the
//            two-stage decay and the slow beating of a real string, where one
//            loop alone decays as a perfectly smooth, synthetic exponential.
//            { cents, t60 (× the main t60), mix }.
//   pickup — a magnetic pickup's place along the string, 0–0.5: it hears the
//            string as the difference of the two waves passing it, a comb
//            that gives each pickup position its tone.
//
// And the basics:
//   t60    — seconds for the fundamental to decay by 60 dB
//   bright — 0…1, lowpass on the excitation (finger/felt ≈ 0.2, pick ≈ 0.8)
//   pick   — pluck position along the string (0.5 = middle: hollow, 0.08 =
//            near the bridge: nasal/twangy); comb-filters the excitation
//   stretch— loop-filter weight; < 0.5 keeps the highs ringing longer
//   seed   — excitation noise from its own seeded stream instead of the
//            voice's, for strings nobody plays (see the sitar's tarab), so
//            they don't move the voice's musical draws
//
// Rendered into an AudioBuffer (the loop runs faster than real time), with a
// first-order allpass supplying the fractional part of the delay so the pitch
// is in tune rather than rounded to a whole-sample period. Every call draws
// the same number of randoms whatever the options, so turning a stage on for
// an instrument never changes the notes it plays.

// Resonances as [Hz, Q, peak gain in dB above the direct sound]; `air` is the
// dense, overlapping modes above them, as decaying noise: [energy relative to
// the direct sound, decay ms, high-pass Hz]. Values follow published bridge
// mobility measurements in shape -- the Helmholtz air mode and the top
// plate's first modes strongest -- and are voiced by ear rather than copied
// from any one instrument.
const BODIES = {
  // Steel-string flat-top: air mode near 100 Hz, top plate at 200, then the
  // plate's higher modes thinning out towards 2 kHz.
  acoustic: {
    modes: [[98, 12, 9], [204, 22, 9], [245, 18, 5], [390, 20, 9], [490, 22, 4], [580, 20, 6],
            [720, 25, 3], [880, 25, 4], [1050, 28, 2], [1300, 30, 2], [1650, 30, 1], [2100, 30, 0]],
    air: [0.6, 5, 1200],
  },
  // Gourd (tumba) and the long hollow neck: lower Q, a strong nasal region
  // between 1 and 3 kHz.
  sitar: {
    modes: [[125, 14, 8], [232, 18, 7], [380, 18, 8], [560, 20, 5], [800, 22, 7], [1150, 24, 5],
            [1600, 24, 7], [2300, 24, 6], [3100, 22, 4]],
    air: [0.8, 6, 1500],
  },
  // Concert harp soundboard: soft and warm, little above 2 kHz.
  harp: {
    modes: [[140, 14, 8], [250, 18, 9], [420, 20, 7], [650, 22, 5], [900, 22, 4], [1300, 24, 3], [1900, 24, 1]],
    air: [0.25, 4, 900],
  },
};

const bodies = new Map();
function bodyResponse(name, sr) {
  const key = `${name}|${sr}`;
  if (bodies.has(key)) return bodies.get(key);
  const { modes, air } = BODIES[name];
  const longest = Math.max(...modes.map(([f, q]) => q / (Math.PI * f)), air[1] / 1000);
  const len = Math.ceil(sr * longest * 5);
  const ir = new Float32Array(len);
  ir[0] = 1; // the direct path: the bridge itself
  // A damped sinusoid a·e^(−t/τ)·sin(ωt) peaks at a·τ·sr/2 above a unit
  // impulse's flat spectrum, so a = 2G / (τ·sr) puts the peak at G.
  for (const [f, q, db] of modes) {
    const tau = q / (Math.PI * f), a = 2 * Math.pow(10, db / 20) / (tau * sr);
    const w = 2 * Math.PI * f / sr, k = Math.exp(-1 / (tau * sr));
    for (let n = 0, e = a; n < len; n++, e *= k) ir[n] += e * Math.sin(w * n);
  }
  const white = seeded(hashSeed('body', name, sr));
  const hf = new Float32Array(len), k = Math.exp(-1 / (air[1] / 1000 * sr));
  const c = Math.exp(-2 * Math.PI * air[2] / sr);
  let e = 1, lp = 0, energy = 0;
  for (let n = 0; n < len; n++, e *= k) {
    const x = white() * 2 - 1;
    lp = c * lp + (1 - c) * x;  // one-pole lowpass; x − lp is the high-pass
    hf[n] = (x - lp) * e;
    energy += hf[n] * hf[n];
  }
  const s = Math.sqrt(air[0] / (energy || 1));
  for (let n = 0; n < len; n++) ir[n] += hf[n] * s;
  bodies.set(key, ir);
  return ir;
}

// One string loop, run for out.length samples with `x` fed in, adding its
// output (× `level`) into `out`. With `x` one period long this is classic
// Karplus–Strong: the period is filled and left to ring.
function stringLoop(out, x, period, S, g, level) {
  const len = out.length, xl = x.length;
  let N = Math.floor(period - S);
  let d = period - S - N;          // fractional delay for the allpass
  if (d < 0.1) { N -= 1; d += 1; } // keep the allpass away from its unstable edge
  N = Math.max(2, N);
  const C = (1 - d) / (1 + d);
  const line = new Float32Array(N);
  let idx = 0, prev = 0, apIn = 0, apOut = 0;
  for (let n = 0; n < len; n++) {
    const v = line[idx] + (n < xl ? x[n] : 0);
    out[n] += level * v;
    const y  = g * ((1 - S) * v + S * prev);
    prev = v;
    const ap = C * (y - apOut) + apIn; // fractional-delay allpass
    apIn = y; apOut = ap;
    line[idx] = ap;
    idx = idx + 1 === N ? 0 : idx + 1;
  }
}

export function pluckBuffer(midi, { t60 = 1.5, bright = 0.5, pick = 0.25, stretch = 0.5, length = t60,
  body = null, pol = null, pickup = 0, seed = null } = {}) {
  const ctx = audio.ctx;
  const sr  = ctx.sampleRate;
  const f   = midiToHz(midi);
  const len = Math.max(1, Math.floor(sr * length));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  const S      = clamp(stretch, 0.05, 0.5);
  const period = sr / f;
  let N = Math.floor(period - S);
  if (period - S - N < 0.1) N -= 1;
  N = Math.max(2, N);
  const g = Math.pow(0.001, 1 / (f * t60)); // per-period loss for the requested T60

  // Excitation: filtered noise, comb-filtered at the pluck position, zero-mean.
  const draw = seed === null ? random : seeded(hashSeed('string', seed, midi, sr));
  const line = new Float32Array(N);
  const k    = 0.05 + 0.95 * clamp(bright, 0, 1);
  let lp = 0, mean = 0;
  for (let i = 0; i < N; i++) {
    lp += k * ((draw() * 2 - 1) - lp);
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

  // With a body, the pluck is the body's response shaped the way the noise
  // was -- lowpassed by the pick's hardness, comb-filtered at its position --
  // with a little of the noise kept for the scrape of the pick itself, at the
  // noise's energy: a body changes the tone, not the level.
  let x = line;
  if (body) {
    const ir = bodyResponse(body, sr);
    x = new Float32Array(ir.length);
    let y = 0, ex = 0, el = 0;
    for (let i = 0; i < ir.length; i++) { y += k * (ir[i] - y); x[i] = y; }
    for (let i = ir.length - 1; i >= p; i--) x[i] -= x[i - p];
    for (let i = 0; i < x.length; i++) ex += x[i] * x[i];
    for (let i = 0; i < N; i++) el += line[i] * line[i];
    const s = Math.sqrt(el / (ex || 1));
    for (let i = 0; i < x.length; i++) x[i] *= s;
    for (let i = 0; i < N && i < x.length; i++) x[i] += 0.3 * line[i];
  }

  if (!pol) {
    stringLoop(out, x, period, S, g, 1);
  } else {
    const p2 = sr / (f * Math.pow(2, pol.cents / 1200));
    const g2 = Math.pow(0.001, 1 / (f * t60 * pol.t60));
    stringLoop(out, x, period, S, g, 1 - pol.mix);
    stringLoop(out, x, p2, S, g2, pol.mix);
  }

  if (pickup > 0) {
    const m = Math.max(1, Math.round(clamp(pickup, 0.02, 0.5) * period));
    for (let n = len - 1; n >= m; n--) out[n] -= out[n - m];
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

// A plucked string starts a little sharp: the pluck stretches it, raising its
// tension, and the pitch settles as the vibration dies down. A few cents, gone
// in a few tens of milliseconds -- heard as the snap of a real string.
export function settle(src, t, cents, tau) {
  src.detune.setValueAtTime(cents, t);
  src.detune.setTargetAtTime(0, t, tau);
}
