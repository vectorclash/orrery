import { audio, getVoiceBus, noise, voiceIn } from '../context.js';
import { state, beat, rand, pick, fold, midiToHz, random, rhythmChance } from '../../state.js';
import { createVoice } from '../transport.js';
import { seeded, hashSeed, restream, within, stream } from '../../random.js';
import { song } from '../song.js';
import { logHit } from '../notes.js';
import { osc, gain, filter, send, perc, shaper } from '../synth.js';
import { meter, FOUR, METER_DRUMS } from '../meter.js';

// ─── Kit ──────────────────────────────────────────────────────────────────────
// Each piece takes (t, velocity). Kick/snare/clap sit centre; the rest are
// spread across the stereo field the way a kit is miked.
const out = piece => (piece ? getVoiceBus(`kit:${piece}`).dry : voiceIn(audio.dry));

function kick(t, v) {
  const body = osc('sine', 160, t, t + 0.5);
  body.frequency.setValueAtTime(165, t);
  body.frequency.exponentialRampToValueAtTime(55, t + 0.06);
  body.frequency.exponentialRampToValueAtTime(46, t + 0.3);
  // Gentle saturation adds harmonics so the kick reads on small speakers.
  const sat = shaper(1.6), env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + 0.002);
  env.gain.setTargetAtTime(0, t + 0.002, 0.11);
  body.connect(sat); sat.connect(env); env.connect(out());
  const click = noise(t, 0.012), hp = filter('highpass', 2200), ce = gain(0);
  perc(ce.gain, t, v * 0.28, 0.008, 0.0005);
  click.connect(hp); hp.connect(ce); ce.connect(out());
}

// 909-style kick, the kick of house and techno: a harder, faster pitch drop
// than the acoustic one, more drive, a click on top, and a body that holds
// long enough to be felt between hats.
function kick909(t, v) {
  const body = osc('sine', 260, t, t + 0.6);
  body.frequency.setValueAtTime(260, t);
  body.frequency.exponentialRampToValueAtTime(62, t + 0.035);
  body.frequency.exponentialRampToValueAtTime(48, t + 0.32);
  const sat = shaper(2.6), env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + 0.0015);
  env.gain.setTargetAtTime(v * 0.6, t + 0.0015, 0.05);
  env.gain.setTargetAtTime(0, t + 0.12, 0.09);
  body.connect(sat); sat.connect(env); env.connect(out());
  const click = noise(t, 0.008), hp = filter('highpass', 3500), ce = gain(0);
  perc(ce.gain, t, v * 0.45, 0.005, 0.0003);
  click.connect(hp); hp.connect(ce); ce.connect(out());
}

// 808-style long boom, tuned to the key's root — the pitched kick of trap.
function kick808(t, v) {
  const hz = midiToHz(fold(state.rootMidi, 28, 39));
  const body = osc('sine', hz * 2.6, t, t + 1.4);
  body.frequency.setValueAtTime(hz * 2.6, t);
  body.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
  const sat = shaper(1.3), env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + 0.002);
  env.gain.setTargetAtTime(0, t + 0.002, 0.38);
  body.connect(sat); sat.connect(env); env.connect(out());
}

function snare(t, v) {
  for (const [f, level, decay] of [[185, 0.55, 0.09], [330, 0.28, 0.06]]) {
    const o = osc('triangle', f * 1.12, t, t + decay + 0.05), e = gain(0);
    o.frequency.setValueAtTime(f * 1.12, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
    perc(e.gain, t, v * level, decay, 0.001);
    o.connect(e); e.connect(out());
  }
  const wires = noise(t, 0.25), bp = filter('bandpass', 3800, 0.55), hp = filter('highpass', 1200), e = gain(0);
  perc(e.gain, t, v * 0.9, 0.17, 0.001);
  wires.connect(bp); bp.connect(hp); hp.connect(e); e.connect(out());
  send(e, audio.reverbSend, 0.18);
}

function clap(t, v) {
  // Three hands a few ms apart, then the diffuse tail of the room.
  const src = noise(t, 0.3), bp = filter('bandpass', 1150, 1.4), env = gain(0);
  env.gain.setValueAtTime(0, t);
  for (const dt of [0, 0.011, 0.022]) {
    env.gain.setValueAtTime(v, t + dt);
    env.gain.exponentialRampToValueAtTime(v * 0.12, t + dt + 0.009);
  }
  env.gain.setValueAtTime(v * 0.75, t + 0.033);
  env.gain.exponentialRampToValueAtTime(v * 1e-3, t + 0.22);
  src.connect(bp); bp.connect(env); env.connect(out());
  send(env, audio.reverbSend, 0.3);
}

// Cross-stick / rim click: a short woody knock.
function rim(t, v) {
  for (const [f, level, decay] of [[1700, 0.45, 0.025], [520, 0.4, 0.04]]) {
    const o = osc('sine', f, t, t + decay + 0.02), e = gain(0);
    perc(e.gain, t, v * level, decay, 0.0005);
    o.connect(e); e.connect(out('rim'));
  }
  const n = noise(t, 0.015), bp = filter('bandpass', 2500, 2), e = gain(0);
  perc(e.gain, t, v * 0.5, 0.01, 0.0005);
  n.connect(bp); bp.connect(e); e.connect(out('rim'));
}

// TR-808 "metal": six square waves at inharmonic frequencies, band-passed.
// Much closer to a cymbal than white noise. Per hit, so every node it makes
// stops and is released with the hit.
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(t, dur) {
  const sum = gain(1 / METAL_HZ.length);
  for (const f of METAL_HZ) osc('square', f, t, t + dur).connect(sum);
  return sum;
}

let choke = null; // the ringing open hat, cut when the hat closes
function hat(t, v, open = false) {
  const decay = open ? 0.38 : 0.05;
  const bp = filter('bandpass', 10000, 0.9), hp = filter('highpass', 7200), env = gain(0);
  perc(env.gain, t, v, decay, 0.001);
  metal(t, decay + 0.05).connect(bp);
  const sizzle = noise(t, decay + 0.05), sG = gain(0.35);
  sizzle.connect(sG); sG.connect(hp);
  bp.connect(hp); hp.connect(env);
  const c = gain(1);
  env.connect(c); c.connect(out('hat'));
  if (choke && choke.until > t) {
    choke.node.gain.setValueAtTime(1, t);
    choke.node.gain.setTargetAtTime(0, t, 0.01);
  }
  choke = open ? { node: c, until: t + decay } : null;
}

// Ride: a dense wash (noise) for the body of the cymbal, a little of the
// 808 metal for shimmer, and the clear stick "ping" that carries swing time.
function ride(t, v) {
  const n = noise(t, 1.3), nBp = filter('bandpass', 6500, 0.5), nHp = filter('highpass', 2800), env = gain(0);
  perc(env.gain, t, v * 0.55, 1.2, 0.001);
  n.connect(nBp); nBp.connect(nHp); nHp.connect(env);
  const m = metal(t, 1.0), mBp = filter('bandpass', 5200, 0.6), mG = gain(0.5);
  m.connect(mBp); mBp.connect(mG); mG.connect(env);
  env.connect(out('ride'));
  for (const f of [3150, 4420, 5850]) {
    const o = osc('sine', f, t, t + 0.4), e = gain(0);
    perc(e.gain, t, v * 0.1, 0.32, 0.001);
    o.connect(e); e.connect(out('ride'));
  }
  send(env, audio.reverbSend, 0.15);
}

function crash(t, v) {
  const n = noise(t, 2.2), hp = filter('highpass', 3500), env = gain(0);
  perc(env.gain, t, v, 1.8, 0.002);
  n.connect(hp); hp.connect(env); env.connect(out('crash'));
  send(env, audio.reverbSend, 0.3);
}

// Toms and congas are tuned to the key: low to the root, high to the fifth.
// `gated` sends them to the gated room (see gateIn) as well as the hall.
function drum(t, v, hz, piece, decay, verb, gated = 0) {
  const o = osc('sine', hz * 1.5, t, t + decay + 0.1), e = gain(0);
  o.frequency.setValueAtTime(hz * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
  perc(e.gain, t, v, decay, 0.001);
  o.connect(e); e.connect(out(piece));
  const n = noise(t, 0.03), bp = filter('bandpass', hz * 4, 1), ne = gain(0);
  perc(ne.gain, t, v * 0.25, 0.02, 0.0005);
  n.connect(bp); bp.connect(ne); ne.connect(out(piece));
  send(e, audio.reverbSend, verb);
  if (gated) { const wet = gain(gated); e.connect(wet); wet.connect(gateIn()); }
}
const tomLo   = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi, 38, 49)), 'tomLo', 0.45, 0.25);
const tomHi   = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi + 7, 45, 56)), 'tomHi', 0.32, 0.25);
const congaLo = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi, 50, 61)), 'tomLo', 0.18, 0.12);
const congaHi = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi + 7, 57, 68)), 'tomHi', 0.12, 0.12);
const taiko   = (t, v) => { drum(t, v, midiToHz(fold(state.rootMidi, 31, 42)), null, 0.9, 0.5); kick(t, v * 0.5); };

function shaker(t, v) {
  const n = noise(t, 0.1), bp = filter('bandpass', 7000, 1.2), env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + 0.012); // beads take a moment to hit the shell
  env.gain.exponentialRampToValueAtTime(v * 1e-3, t + 0.08);
  n.connect(bp); bp.connect(env); env.connect(out('shaker'));
}

// Tambourine: the jingles. The 808 metal and bright noise, band-passed high,
// struck and then shaken once more a few milliseconds later as the zils settle.
function tambourine(t, v) {
  const bp = filter('bandpass', 8500, 1.1), hp = filter('highpass', 5500);
  metal(t, 0.25).connect(bp);
  const n = noise(t, 0.25), nG = gain(0.6);
  n.connect(nG); nG.connect(bp);
  bp.connect(hp);
  for (const [dt, level, decay] of [[0, 1, 0.09], [0.014, 0.55, 0.13]]) {
    const e = gain(0);
    perc(e.gain, t + dt, v * level, decay, 0.002);
    hp.connect(e); e.connect(out('tamb'));
  }
}

// 808 cowbell (two detuned squares) — the timeline bell in the 12/8 groove.
function cowbell(t, v) {
  const bp = filter('bandpass', 1400, 1.1), env = gain(0);
  for (const f of [587, 845]) osc('square', f, t, t + 0.32).connect(bp);
  perc(env.gain, t, v, 0.28, 0.001);
  bp.connect(env); env.connect(out('perc'));
}

// Brushes. The left hand stirs the brush round the snare's coated head without
// lifting it, so the sweep never stops: one stroke a beat, each crossfading into
// the next (equal power, so the hiss holds steady through the join), swelling
// and brightening a little as the brush speeds up through the middle of its
// arc. The bristles' scratch is broad, from about 1 kHz up, and the wires under
// the head buzz with it. One noise draw a stroke, as the old swish took.
const curve = (n, f) => Float32Array.from({ length: n }, (_, i) => f(i / (n - 1)));
function sweep(t, v) {
  const len = beat(), xf = Math.min(0.08, len * 0.2), dur = len + xf, at = random();
  const speed = x => Math.sin(Math.PI * Math.min(1, x * dur / len)); // 0 → 1 → 0 across the stroke
  const env = gain(0);
  env.gain.setValueCurveAtTime(curve(64, x => {
    const s = x * dur;
    return v * Math.sin(Math.PI / 2 * Math.min(1, s / xf)) * Math.cos(Math.PI / 2 * Math.max(0, (s - len) / xf)) * (0.7 + 0.3 * speed(x));
  }), t, dur);
  const scratch = noise(t, dur + 0.02, at), hp = filter('highpass', 900, 0.6), bp = filter('bandpass', 3000, 0.45);
  bp.frequency.setValueCurveAtTime(curve(32, x => 2300 + 1700 * speed(x)), t, dur);
  scratch.connect(hp); hp.connect(bp); bp.connect(env);
  const wires = noise(t, dur + 0.02, (at + 0.5) % 1), wBp = filter('bandpass', 5200, 0.9), wG = gain(0.3);
  wires.connect(wBp); wBp.connect(wG); wG.connect(env);
  env.connect(out());
  send(env, audio.reverbSend, 0.12);
}

// A tap: the brush laid onto the head, so the bristles land over a few
// milliseconds instead of at once, the head itself barely moved (a little of
// its low note), and the wires answering a moment longer.
function brushTap(t, v) {
  const at = random();
  const land = noise(t, 0.12, at), hp = filter('highpass', 800), bp = filter('bandpass', 3600, 0.5), e = gain(0);
  perc(e.gain, t, v, 0.07, 0.004);
  land.connect(hp); hp.connect(bp); bp.connect(e); e.connect(out());
  const head = osc('triangle', 215, t, t + 0.12), hE = gain(0);
  head.frequency.setValueAtTime(230, t);
  head.frequency.exponentialRampToValueAtTime(200, t + 0.03);
  perc(hE.gain, t, v * 0.12, 0.06, 0.003);
  head.connect(hE); hE.connect(out());
  const wires = noise(t, 0.2, (at + 0.5) % 1), wBp = filter('bandpass', 5000, 0.8), wE = gain(0);
  perc(wE.gain, t, v * 0.3, 0.14, 0.006);
  wires.connect(wBp); wBp.connect(wE); wE.connect(out());
  send(e, audio.reverbSend, 0.15);
  send(wE, audio.reverbSend, 0.15);
}

// The hi-hat closed with the foot, as a brush player keeps 2 and 4: the plates
// meeting, a soft "chick", duller and shorter than a hat struck with a stick.
function chick(t, v) {
  const bp = filter('bandpass', 5000, 0.8), hp = filter('highpass', 2400), env = gain(0);
  perc(env.gain, t, v, 0.05, 0.003);
  metal(t, 0.1).connect(bp); bp.connect(hp); hp.connect(env); env.connect(out('hat'));
  const n = noise(t, 0.04), nBp = filter('bandpass', 1300, 1.1), nE = gain(0);
  perc(nE.gain, t, v * 0.4, 0.018, 0.001);
  n.connect(nBp); nBp.connect(nE); nE.connect(out('hat'));
}

// ─── 80s pieces ───────────────────────────────────────────────────────────────
// Gated reverb, the drum sound of the 80s: a big, dense room that is cut off
// dead after a third of a second, so the snare sounds enormous but never
// washes over the next beat. Rather than gating a real reverb, the impulse
// itself has the gated shape — dense noise that holds its level and then
// stops, which is what the AMS RMX16's "nonlinear" program did. One per
// session (it follows the session's dry bus), shared by the 80s pieces.
const GATE_SECONDS = 0.32;
const gateImpulses = new Map();
function gateImpulse(ctx) {
  const sr = ctx.sampleRate;
  if (!gateImpulses.has(sr)) {
    const len = Math.floor(sr * GATE_SECONDS), buf = ctx.createBuffer(2, len, sr);
    // Seeded, as context.js's impulses are: the same room in every render.
    const white = seeded(hashSeed('gate', sr));
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0, e = 0;
      for (let i = 0; i < len; i++) {
        y += 0.55 * ((white() * 2 - 1) - y);
        const build = Math.min(1, i / (sr * 0.008));
        const hold  = 1 - 0.3 * i / len;                 // sags a little, but doesn't decay
        const cut   = Math.min(1, (len - i) / (sr * 0.01)); // the gate closing
        d[i] = y * build * hold * cut;
        e += d[i] * d[i];
      }
      for (let i = 0; i < len; i++) d[i] /= Math.sqrt(e);
    }
    gateImpulses.set(sr, buf);
  }
  return gateImpulses.get(sr);
}
let gate = null;
function gateIn() {
  if (gate?.dry !== audio.dry) {
    const c = audio.ctx.createConvolver();
    c.normalize = false;
    c.buffer = gateImpulse(audio.ctx);
    c.connect(audio.dry);
    gate = { dry: audio.dry, input: c };
  }
  return voiceIn(gate.input);
}

// Snare for the gated room: a deeper body than the acoustic one, longer
// wires, and most of its size from the gate.
function gatedSnare(t, v) {
  const hit = gain(1);
  for (const [f, level, decay] of [[180, 0.6, 0.12], [320, 0.3, 0.07]]) {
    const o = osc('triangle', f * 1.15, t, t + decay + 0.05), e = gain(0);
    o.frequency.setValueAtTime(f * 1.15, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.025);
    perc(e.gain, t, v * level, decay, 0.001);
    o.connect(e); e.connect(hit);
  }
  const wires = noise(t, 0.3), bp = filter('bandpass', 3000, 0.5), hp = filter('highpass', 900), e = gain(0);
  perc(e.gain, t, v, 0.2, 0.001);
  wires.connect(bp); bp.connect(hp); hp.connect(e); e.connect(hit);
  const wet = gain(1.2);
  hit.connect(out()); hit.connect(wet); wet.connect(gateIn());
}

// Simmons SDS-V electronic tom: an oscillator whose pitch falls through the
// whole note (the "pew") -- an octave, not the laser zap a deeper bend
// gives -- a filtered-noise stick attack, and some of the gated room. Tuned
// to the key: root, fifth and octave.
function simmons(t, v, hz, piece) {
  const o = osc('triangle', hz * 1.6, t, t + 0.6), body = gain(0);
  o.frequency.setValueAtTime(hz * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(hz * 0.8, t + 0.5);
  perc(body.gain, t, v, 0.5, 0.001);
  const n = noise(t, 0.06), bp = filter('bandpass', hz * 6, 1.2), stick = gain(0);
  perc(stick.gain, t, v * 0.4, 0.04, 0.0005);
  const hit = gain(1), wet = gain(0.5);
  o.connect(body); body.connect(hit);
  n.connect(bp); bp.connect(stick); stick.connect(hit);
  hit.connect(out(piece)); hit.connect(wet); wet.connect(gateIn());
}
const simLo  = (t, v) => simmons(t, v, midiToHz(fold(state.rootMidi, 38, 49)), 'tomLo');
const simMid = (t, v) => simmons(t, v, midiToHz(fold(state.rootMidi + 7, 45, 56)), 'tomMid');
const simHi  = (t, v) => simmons(t, v, midiToHz(fold(state.rootMidi + 12, 50, 61)), 'tomHi');
// Gated toms, the 80s record's usual fill: the acoustic tom, big in the gated
// room, at the Simmons' pitches.
const gtomLo  = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi, 38, 49)), 'tomLo', 0.3, 0.1, 0.7);
const gtomMid = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi + 7, 45, 56)), 'tomMid', 0.28, 0.1, 0.7);
const gtomHi  = (t, v) => drum(t, v, midiToHz(fold(state.rootMidi + 12, 50, 61)), 'tomHi', 0.25, 0.1, 0.7);

// ─── The acoustic kit ─────────────────────────────────────────────────────────
// The pieces above are a drum machine's: an oscillator and a burst of noise each,
// the same at every level. That's the right kit for house or trap. Played by a
// drummer (styles marked `acoustic`) it's what made a jazz or funk song sound
// programmed: measured solo, those kits had almost nothing between 500 Hz and
// 2 kHz, where a snare's shell and a kit's wood live, and a ghost note was an
// accent turned down. These are drums as struck things:
//
//   - a head has several modes, not one pitch (a membrane's run 1 : 1.59 : 2.14 :
//     2.65 against the lowest, never a harmonic series), each dying at its own rate;
//   - how hard it's hit changes the sound, not just the level: a hard stroke
//     stretches the head (it starts sharper and falls further), puts more of the
//     stick into it, and opens the top; a ghost note is duller, shorter, mostly head;
//   - no two strokes land alike: each differs a little in tuning, tone and length.
//
// Each takes (t, level, vel): `vel` is the stroke, 0.15 feathered to 1.15 accented.
// Each takes exactly one draw, as the piece it stands in for does, and everything
// that varies comes from it, so a kit sounding different never moves a hit.
const hardness = vel => Math.max(0, Math.min(1, (vel - 0.15) / 0.95));

// Bass drum: a felt beater on a damped 22-inch head. The head's note barely
// falls (a drum machine's kick sweeps two octaves; a real one a few tones), a
// second mode gives it the shell's knock, and the beater is a soft thump with a
// click on top that grows with the stroke.
function kickA(t, v, vel = 1) {
  const u = random(), h = hardness(vel), o = out();
  const f = 58 * (1 + 0.03 * (u - 0.5));
  const head = osc('sine', f, t, t + 0.6), sat = shaper(1.2), e = gain(0);
  head.frequency.setValueAtTime(f * (1.6 + 0.6 * h), t);
  head.frequency.exponentialRampToValueAtTime(f * 1.07, t + 0.03);
  head.frequency.exponentialRampToValueAtTime(f, t + 0.22);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(v, t + 0.003);
  e.gain.setTargetAtTime(0, t + 0.003, 0.085 + 0.02 * h);
  head.connect(sat); sat.connect(e); e.connect(o);
  const shell = osc('sine', f * 2.3, t, t + 0.2), sE = gain(0);
  shell.frequency.setValueAtTime(f * 2.3 * (1 + 0.12 * h), t);
  shell.frequency.exponentialRampToValueAtTime(f * 2.3, t + 0.03);
  perc(sE.gain, t, v * 0.6, 0.1, 0.002);
  shell.connect(sE); sE.connect(o);
  const thump = noise(t, 0.05, (u + 0.37) % 1), tLp = filter('lowpass', 380), tE = gain(0);
  perc(tE.gain, t, v * 0.55, 0.03, 0.001);
  thump.connect(tLp); tLp.connect(tE); tE.connect(o);
  const beater = noise(t, 0.03, u), bBp = filter('bandpass', 2400 + 1800 * h, 1.1), bE = gain(0);
  perc(bE.gain, t, v * (0.18 + 0.5 * h), 0.011, 0.0005);
  beater.connect(bBp); bBp.connect(bE); bE.connect(o);
}

// Snare: the batter head's first modes, the shell's crack around 900 Hz, the
// stick, and the wires under the other head -- broad, bright on a hard stroke and
// darkening as they settle, where the machine's are one fixed band.
function snareA(t, v, vel = 1) {
  const u = random(), h = hardness(vel), o = out();
  const tune = 1 + 0.025 * (u - 0.5);
  for (const [f, level, decay] of [[192, 0.5, 0.11], [338, 0.36, 0.075], [452, 0.15, 0.05], [566, 0.1, 0.035]]) {
    const m = osc('sine', f * tune, t, t + decay * 1.3 + 0.05), e = gain(0);
    m.frequency.setValueAtTime(f * tune * (1 + 0.1 * h), t);
    m.frequency.exponentialRampToValueAtTime(f * tune, t + 0.03);
    perc(e.gain, t, v * level, decay * (0.8 + 0.4 * h), 0.001);
    m.connect(e); e.connect(o);
  }
  const crack = noise(t, 0.09, (u + 0.21) % 1), cBp = filter('bandpass', 950 * tune, 1.5), cE = gain(0);
  perc(cE.gain, t, v * (0.4 + 0.7 * h), 0.045, 0.001);
  crack.connect(cBp); cBp.connect(cE); cE.connect(o);
  const wires = noise(t, 0.34, u), hp = filter('highpass', 1500, 0.7), lp = filter('lowpass', 12000, 0.7), wE = gain(0);
  lp.frequency.setValueAtTime(5200 + 7800 * h, t);
  lp.frequency.exponentialRampToValueAtTime(3400, t + 0.22);
  perc(wE.gain, t, v * (0.62 + 0.3 * h) * (0.9 + 0.2 * u), 0.13 + 0.09 * h, 0.002);
  wires.connect(hp); hp.connect(lp); lp.connect(wE); wE.connect(o);
  const stick = noise(t, 0.012, (u + 0.63) % 1), sHp = filter('highpass', 3200), sE = gain(0);
  perc(sE.gain, t, v * 0.7 * h, 0.004, 0.0003);
  stick.connect(sHp); sHp.connect(sE); sE.connect(o);
  send(wE, audio.reverbSend, 0.18);
}

// Hi-hats: two cymbals are thousands of modes, so mostly noise, with the plates'
// own resonances as two peaks that sit a little differently on every stroke (the
// tip, the shank, nearer the edge), and a little of the metal for its shimmer.
// A soft stroke has less top. Closed, they ring a moment after the tick; open,
// they wash, the highs going first.
function hatA(t, v, vel = 1, open = false) {
  const u = random(), h = hardness(vel);
  const decay = open ? 0.5 + 0.2 * h : 0.04 + 0.025 * u;
  const dur = decay + 0.08;
  const body = gain(1);
  noise(t, dur, u).connect(body);
  const m = metal(t, dur), mG = gain(0.5);
  m.connect(mG); mG.connect(body);
  const hp = filter('highpass', 3400, 0.7), lp = filter('lowpass', 7000 + 9000 * h, 0.7);
  const p1 = filter('peaking', 4700 * (1 + 0.1 * (u - 0.5)), 2.5), p2 = filter('peaking', 9200 * (1 + 0.08 * (0.5 - u)), 2);
  p1.gain.value = 5; p2.gain.value = 6;
  if (open) { lp.frequency.setValueAtTime(7000 + 9000 * h, t); lp.frequency.exponentialRampToValueAtTime(6000, t + decay); }
  const env = gain(0);
  perc(env.gain, t, v, decay, 0.001);
  body.connect(hp); hp.connect(p1); p1.connect(p2); p2.connect(lp); lp.connect(env);
  const c = gain(1);
  env.connect(c); c.connect(out('hat'));
  if (choke && choke.until > t) {
    choke.node.gain.setValueAtTime(1, t);
    choke.node.gain.setTargetAtTime(0, t, 0.01);
  }
  choke = open ? { node: c, until: t + decay } : null;
}

// Crash: the stick's energy starts low in the cymbal and spreads upward through
// its modes, so the top blooms a few hundredths of a second after the stroke
// instead of arriving with it; then the highs die first and the wash that's left
// wobbles, the plate's modes beating. The machine's is a burst of hiss.
function crashA(t, v) {
  const u = random(), dur = 2.4;
  const body = gain(1);
  noise(t, dur, u).connect(body);
  const m = metal(t, 1.4), mBp = filter('bandpass', 5600, 0.5), mG = gain(0.9);
  m.connect(mBp); mBp.connect(mG); mG.connect(body);
  const hp = filter('highpass', 2300, 0.7), lp = filter('lowpass', 4500, 0.6);
  lp.frequency.setValueAtTime(4500, t);
  lp.frequency.exponentialRampToValueAtTime(15000, t + 0.045);
  lp.frequency.exponentialRampToValueAtTime(4800, t + 1.9);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v * 0.75, t + 0.002);
  env.gain.linearRampToValueAtTime(v, t + 0.04);
  env.gain.exponentialRampToValueAtTime(v * 1e-3, t + dur - 0.05);
  const wobble = osc('sine', 5.3 + 3 * u, t, t + dur), wG = gain(0.12), am = gain(1);
  wobble.connect(wG); wG.connect(am.gain);
  body.connect(hp); hp.connect(lp); lp.connect(env); env.connect(am); am.connect(out('crash'));
  send(am, audio.reverbSend, 0.3);
}

// Toms (and the taiko): three modes of the head, the upper ones gone in a
// moment, a note that falls further the harder it's struck, and the stick.
function drumA(t, v, vel, hz, piece, decay, verb) {
  const u = random(), h = hardness(vel), o = out(piece);
  const f = hz * (1 + 0.02 * (u - 0.5)), sum = gain(1);
  for (const [ratio, level, d] of [[1, 1, 1], [1.59, 0.35, 0.4], [2.14, 0.18, 0.25]]) {
    const m = osc('sine', f * ratio, t, t + decay * d + 0.1), e = gain(0);
    m.frequency.setValueAtTime(f * ratio * (1.2 + 0.35 * h), t);
    m.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.05);
    perc(e.gain, t, v * level, decay * d, 0.001);
    m.connect(e); e.connect(sum);
  }
  sum.connect(o);
  const stick = noise(t, 0.04, u), bp = filter('bandpass', Math.min(6000, f * 5), 0.9), sE = gain(0);
  perc(sE.gain, t, v * (0.15 + 0.4 * h), 0.02, 0.0005);
  stick.connect(bp); bp.connect(sE); sE.connect(o);
  send(sum, audio.reverbSend, verb);
}
const tomLoA = (t, v, vel) => drumA(t, v, vel, midiToHz(fold(state.rootMidi, 38, 49)), 'tomLo', 0.45, 0.25);
const tomHiA = (t, v, vel) => drumA(t, v, vel, midiToHz(fold(state.rootMidi + 7, 45, 56)), 'tomHi', 0.32, 0.25);
const congaLoA = (t, v, vel) => drumA(t, v, vel, midiToHz(fold(state.rootMidi, 50, 61)), 'tomLo', 0.18, 0.12);
const congaHiA = (t, v, vel) => drumA(t, v, vel, midiToHz(fold(state.rootMidi + 7, 57, 68)), 'tomHi', 0.12, 0.12);
// The taiko's two parts each took a draw (the drum's stick, the kick's click).
const taikoA = (t, v, vel) => { drumA(t, v, vel, midiToHz(fold(state.rootMidi, 31, 42)), null, 0.9, 0.5); kickA(t, v * 0.5, vel); };

// Ride: the stick's ping, a handful of the cymbal's modes that sit a little
// differently on every stroke, over a wash that grows and brightens the harder
// it's played and darkens as it rings. The machine's ping is three fixed tones.
function rideA(t, v, vel = 1) {
  const u = random(), h = hardness(vel), o = out('ride');
  const wash = gain(1);
  noise(t, 1.5, u).connect(wash);
  const m = metal(t, 1.0), mBp = filter('bandpass', 5200, 0.6), mG = gain(0.5);
  m.connect(mBp); mBp.connect(mG);
  const bp = filter('bandpass', 6500, 0.5), hp = filter('highpass', 2800), lp = filter('lowpass', 8000 + 6000 * h, 0.7), env = gain(0);
  lp.frequency.setValueAtTime(8000 + 6000 * h, t);
  lp.frequency.exponentialRampToValueAtTime(5500, t + 1.2);
  perc(env.gain, t, v * 0.55 * (0.75 + 0.45 * h), 1.2, 0.001);
  wash.connect(bp); bp.connect(hp); hp.connect(lp); mG.connect(lp); lp.connect(env); env.connect(o);
  const tune = 1 + 0.035 * (u - 0.5);
  for (const [f, level, decay] of [[3150, 0.1, 0.34], [4420, 0.1, 0.3], [5850, 0.09, 0.26], [7430, 0.05, 0.18]]) {
    const p = osc('sine', f * tune, t, t + decay + 0.1), e = gain(0);
    perc(e.gain, t, v * level * (0.8 + 0.4 * h), decay, 0.001);
    p.connect(e); e.connect(o);
  }
  const tick = noise(t, 0.012, (u + 0.41) % 1), tHp = filter('highpass', 5000), tE = gain(0);
  perc(tE.gain, t, v * 0.35 * h, 0.004, 0.0003);
  tick.connect(tHp); tHp.connect(tE); tE.connect(o);
  send(env, audio.reverbSend, 0.15);
}

// The acoustic piece that stands in for each machine one, in a style marked `acoustic`.
const ACOUSTIC = { kick: 'kickA', snare: 'snareA', hat: 'hatA', ohat: 'ohatA', ride: 'rideA', taiko: 'taikoA' };
// And the pieces that are struck skins and cymbals in any kit, a machine's included: a drum
// machine's crash was a recording of a real one, and nobody programs a hiss for a conga.
const STRUCK = { crash: 'crashA', tomLo: 'tomLoA', tomHi: 'tomHiA', congaLo: 'congaLoA', congaHi: 'congaHiA' };

// Per-piece loudness (before density/brightness scaling and velocity).
const KIT = {
  kick:    [kick,    0.32],  k808:  [kick808, 0.28], snare:   [snare,   0.2],
  k909:    [kick909, 0.21], // level-matched: harder and longer than the acoustic kick
  clap:    [clap,    0.17],  rim:   [rim,     0.16], hat:     [(t, v) => hat(t, v), 0.1],
  ohat:    [(t, v) => hat(t, v, true), 0.08],        ride:    [ride,    0.55],
  crash:   [crash,   0.08],  tomLo: [tomLo,   0.26], tomHi:   [tomHi,   0.22],
  congaLo: [congaLo, 0.2],   congaHi: [congaHi, 0.18], taiko: [taiko,   0.3],
  shaker:  [shaker,  0.06],  bell:  [cowbell, 0.07],
  sweep:   [sweep,   0.1],   brush: [brushTap, 0.5],  chick:   [chick,   0.24],
  swish:   [sweep,   0.1],   btap:  [brushTap, 0.5],  // ORIGINAL's brushes, the same sounds
  gsnare:  [gatedSnare, 0.2], simLo: [simLo,   0.26], simMid:  [simMid,  0.24],
  simHi:   [simHi,   0.22],  gtomLo: [gtomLo, 0.26], gtomMid: [gtomMid, 0.24],
  gtomHi:  [gtomHi,  0.22],
  tamb:    [tambourine, 0.09],
  // The acoustic kit, each level-matched (K-weighted) to the piece it stands in for.
  kickA:   [kickA,   0.365], snareA: [snareA, 0.175], hatA:    [(t, v, vel) => hatA(t, v, vel), 0.028],
  ohatA:   [(t, v, vel) => hatA(t, v, vel, true), 0.018], crashA: [crashA, 0.07],
  tomLoA:  [tomLoA,  0.26],  tomHiA: [tomHiA, 0.22],  taikoA:  [taikoA,  0.32],
  rideA:   [rideA,   0.455], congaLoA: [congaLoA, 0.2], congaHiA: [congaHiA, 0.18],
};

// ─── Patterns ─────────────────────────────────────────────────────────────────
// One bar per string, one character per step: X accent, x hit, o medium,
// g ghost, f feathered (felt more than heard), ? ghost that plays only
// sometimes (variation), . rest.
// 16 steps = sixteenths; 12 steps = eighth-note triplets (a swung or 12/8 bar).
//   swing   — MPC-style: fraction of an eighth taken by its first sixteenth
//   human   — small timing/velocity drift, for styles played by a person
//   fill    — a kind of fill from FILLS (then a crash), or { kind: weight }
//             to choose one each time
//   machine — programmed, not played: a fill only into a song's chorus or
//             drop (outside a song, now and then every 16 bars).
//             Otherwise a fill ends every 8th bar and most 4th bars.
//   rolls   — trap hi-hat rolls
//   bpm     — tempo range the style suits (Infinite mode picks by tempo)
//   acoustic — a drummer's kit, not a machine's (see ACOUSTIC)
const VEL = { X: 1.15, x: 1, o: 0.62, g: 0.35, f: 0.15 };
const SYNTH_FILLS = { gsnare: 2, gtom: 2, simmons: 1 };

const STYLES = {
  minimal: { bpm: [50, 140], tracks: {
    kick:  'x.......x.......',
    snare: '....x.......x...' } },
  four_four: { acoustic: true, bpm: [70, 140], human: true, fill: 'snare', tracks: {
    kick:  'x.......x.x.....',
    snare: '....x.......x...',
    hat:   'x.o.x.o.x.o.x.o.' } },
  jungle: { acoustic: true, bpm: [80, 140], fill: 'snare', tracks: {
    kick:  'x.....x.....x...',
    snare: '....x..g..g.x...',
    hat:   'xo.ox.oo.oo.xo.o' } },
  shuffle: { acoustic: true, steps: 12, bpm: [60, 130], human: true, fill: 'snare', tracks: {
    kick:  'x.....x.....',
    snare: '...x.....x.g',
    hat:   'x.ox.ox.ox.o' } },
  trap: { bpm: [60, 140], rolls: true, tracks: {
    k808:  'x......x.x......',
    snare: '........x.......',
    clap:  '........x.......',
    hat:   'xoxoxoxoxoxoxoxo' } },
  ghost: { acoustic: true, bpm: [50, 140], tracks: {
    kick:  'x.............x.',
    snare: '......x.....x...',
    hat:   '..x......x......' } },
  halftime: { bpm: [60, 140], fill: 'snare', tracks: {
    kick:  'x.....x.........',
    snare: '........x.....g.',
    clap:  '........x.......',
    hat:   'x.o.x.o.x.o.x.o.' } },
  breakbeat: { acoustic: true, bpm: [80, 140], swing: 0.54, human: true, fill: 'snare', tracks: {
    kick:  'x......x..x.....',
    snare: '....x.......x.g.',
    hat:   'x.og.go.xg.gx.o.' } },
  bossanova: { acoustic: true, bpm: [60, 140], human: true, tracks: {
    kick:  'x.....x.x.....x.',
    rim:   'x..x..x...x..x..',
    hat:   'o.g.o.g.o.g.o.g.' } },
  house: { bpm: [110, 140], fill: 'snare', machine: true, tracks: {
    kick:   'x...x...x...x...',
    clap:   '....x.......x...',
    ohat:   '..x...x...x...x.',
    shaker: 'ogogogogogogogog' } },
  swing: { acoustic: true, steps: 12, bpm: [60, 140], human: true, fill: 'snare', tracks: {
    ride:  'x..x.xx..x.x',
    hat:   '...o.....o..',
    kick:  'f..f..f..f..',
    snare: '..?..?..?..?' } },
  funk: { acoustic: true, bpm: [85, 125], swing: 0.53, human: true, fill: 'snare', tracks: {
    kick:  'x.x....x..x..x..',
    snare: '....X..g.g..X..g',
    hat:   'xoxoxoxoxoxoxo.o',
    ohat:  '..............x.' } },
  boombap: { acoustic: true, bpm: [70, 100], swing: 0.58, human: true, tracks: {
    kick:  'x......x..x.....',
    snare: '....x.......x...',
    hat:   'x.o.x.o.x.o.x.o.' } },
  reggae: { acoustic: true, steps: 12, bpm: [60, 100], human: true, tracks: {
    kick:  '......x.....',
    rim:   '......x.....',
    hat:   'x.ox.ox.ox.o' } },
  dembow: { bpm: [85, 110], tracks: {
    kick:  'x...x...x...x...',
    snare: '...x..x....x..x.',
    hat:   'o.g.o.g.o.g.o.g.' } },
  afro: { steps: 12, bpm: [80, 140], human: true, tracks: {
    bell:    'x.x.xx.x.x.x',
    shaker:  'oggoggoggogg',
    kick:    'x.....x.....',
    congaHi: '...o.x...o.x',
    congaLo: '........x...' } },
  cinematic: { acoustic: true, bpm: [60, 110], human: true, fill: 'tom', tracks: {
    taiko: 'X.......x.......',
    tomLo: 'x..x..x...x..x..',
    tomHi: '....o.......o.o.' } },
  // Jazz brushes, in triplets: the sweep through every beat; the right hand
  // tapping the ride pattern on the snare (1, 2 and its skip note, 3, 4 and its
  // skip, now and then the "let" before 2 or 4), slapped on 2 and 4 with the
  // foot's hi-hat; the kick feathered. ORIGINAL plays ORIGINAL_BRUSHES.
  brushes: { acoustic: true, steps: 12, bpm: [50, 110], human: true, tracks: {
    sweep: 'x..x..x..x..',
    brush: 'o.?x.go.?x.g',
    chick: '...o.....o..',
    kick:  'f..f..f..f..' } },
  garage: { bpm: [118, 140], swing: 0.62, tracks: {
    kick:   'x.........x.....',
    snare:  '....x.......x...',
    hat:    'x.o.x.o.x.o.x.o.',
    shaker: '.g.g.g.g.g.g.g.g' } },
  // 80s drum machine: the rock beat with a gated snare; its fills gated
  // snare or toms, sometimes Simmons.
  synthwave: { bpm: [80, 125], fill: SYNTH_FILLS, machine: true, tracks: {
    kick:   'x.......x.x.....',
    gsnare: '....x.......x...',
    hat:    'x.o.x.o.x.o.x.o.' } },
  // Outrun: four on the floor under driving sixteenths (Kavinsky, Carpenter Brut).
  outrun: { bpm: [95, 130], fill: SYNTH_FILLS, machine: true, tracks: {
    kick:   'x...x...x...x...',
    gsnare: '....x.......x...',
    hat:    'xoxoxoxoxoxoxoxo' } },

  // ─── Dance ──────────────────────────────────────────────────────────────────
  // `dance` styles are picked in Manual mode (or by a genre); Infinite mode's
  // reroll leaves them out, so it sounds as it always has.
  // Wherever an open hat plays, the closed hat leaves that step empty: a closed
  // hat chokes the open one (see hat), so the two on one step left only a tick.
  // Deep house: a swung 909 groove -- off-beat open hats, a shaker and rim
  // ghosts under the clap.
  deep_house: { dance: true, bpm: [115, 128], swing: 0.56, human: true, fill: 'snare', machine: true, tracks: {
    k909:   'x...x...x...x...',
    clap:   '....x.......x...',
    ohat:   '..o...o...o...o.',
    hat:    'g...g...g...g...',
    rim:    '.......g......g.',
    shaker: '.g.g.g.g.g.g.g.g' } },
  // Techno: a driving kick, sixteenth hats with an accent pattern, a rim on
  // the off-beat sixteenth.
  techno: { dance: true, bpm: [122, 140], tracks: {
    k909:  'X...x...X...x...',
    hat:   'xg.gxg.gxg.gxg.g',
    ohat:  '..x...x...x...x.',
    rim:   '...g.......g..g.',
    clap:  '....g.......g...' } },
  // Trance: four on the floor, a clap on two and four, off-beat open hats.
  trance: { dance: true, bpm: [128, 140], fill: 'snare', machine: true, tracks: {
    k909:  'x...x...x...x...',
    clap:  '....x.......x...',
    ohat:  '..x...x...x...x.',
    hat:   'g...g...g...g...' } },
  // Big room / EDM: a heavy kick, clap and snare stacked on two and four.
  big_room: { dance: true, bpm: [120, 132], fill: 'snare', machine: true, tracks: {
    k909:  'X...X...X...X...',
    clap:  '....x.......x...',
    snare: '....o.......o...',
    ohat:  '..x...x...x...x.',
    shaker: 'g.g.g.g.g.g.g.g.' } },
  // Disco / nu-disco: four on the floor, snare and clap on two and four, the
  // open hat on every "and" (cut by the closed one a sixteenth later -- the
  // "tss-t"), a tambourine, and tom fills.
  disco: { acoustic: true, dance: true, bpm: [110, 128], human: true, fill: 'tom', tracks: {
    kick:  'x...x...x...x...',
    snare: '....x.......x...',
    clap:  '....g.......g...',
    hat:   'x..gx..gx..gx..g',
    ohat:  '..x...x...x...x.',
    tamb:  'g.g.x.g.g.g.x.g.' } },
  // Afro house: a 909 four on the floor under busy shakers, congas and a bell.
  afro_house: { dance: true, bpm: [116, 126], swing: 0.54, human: true, tracks: {
    k909:    'x...x...x...x...',
    clap:    '....o.......o...',
    shaker:  'xgogxgogxgogxgog',
    ohat:    '..o...o...o...o.',
    congaHi: '...o..o....o.o..',
    congaLo: '.o.....o.o......',
    bell:    'g..g..g...g.g...' } },
  // Amapiano: a sparse kick (the log drum carries the low end), loud
  // sixteenth shakers, claps on two and four, rim and conga syncopations.
  amapiano: { dance: true, bpm: [108, 118], swing: 0.56, human: true, tracks: {
    kick:    'x.......x.......',
    clap:    '....x.......x...',
    shaker:  'xgogxgogxgogxgog',
    rim:     '..g..g.g..g..g..',
    ohat:    '..o...o...o...o.',
    congaHi: '.......o......o.' } },
  // Afrobeats: a swung 4/4 with the tresillo on the rim over a kick on one and
  // three, shakers and congas.
  afrobeats: { dance: true, bpm: [94, 112], swing: 0.55, human: true, tracks: {
    kick:    'x.......x..x....',
    rim:     '...x..x....x..x.',
    clap:    '....x.......x...',
    shaker:  'xgogxgogxgogxgog',
    congaHi: '..o..o....o..o..',
    congaLo: 'o.....o.........' } },
  // Drum & bass: the two-step -- a kick on one and the "and" of three, the
  // snare on two and four with ghosts between, over driving hats.
  dnb: { dance: true, bpm: [160, 178], fill: 'snare', machine: true, tracks: {
    kick:   'x.........x.....',
    snare:  '....x..g.g..x..g',
    hat:    'x.o.x.o.x.o.x.o.',
    shaker: '.g.g.g.g.g.g.g.g' } },
  // Drill (trap): a short kick that leaves room for a sliding 808 bass, the
  // snare on three with a late one after it, bouncing hats with rolls.
  drill: { dance: true, bpm: [60, 80], rolls: true, tracks: {
    kick:  'x.........x.....',
    snare: '........x......o',
    clap:  '........x.......',
    hat:   'x..x..x.x..x..x.' } },
};

// The brushes as ORIGINAL plays them, note for note: a sweep on each beat, a tap
// and the hi-hat on 2 and 4, in sixteenths.
const ORIGINAL_BRUSHES = { acoustic: true, bpm: [50, 110], swing: 0.66, human: true, tracks: {
  swish: 'x...x...x...x...',
  btap:  '....x.......x...',
  kick:  'f.......f.......',
  hat:   '....o.......o...' } };
const styleNow = () => (style === 'brushes' && state.composer < 2 ? ORIGINAL_BRUSHES : STYLES[style]);

// ─── Other meters ─────────────────────────────────────────────────────────────
// The styles' bars in 3/4 and 6/8 (see meter.js), for the genres that play in them:
// `steps` to the bar, sixteenths (twelve) or triplet eighths (nine, three to the beat).
// A waltz leans on one, its other two beats lighter (jazz's ride 1, 2-and-a-let, 3;
// folk's oom-pah-pah); six-eight is two big beats of three eighths, the backbeat on
// the second. METER_DRUMS (meter.js) lists these: a song only goes into a meter its
// kit has a bar of.
const METER_TRACKS = {
  '3/4': {
    swing:     { steps: 9, tracks: { ride: 'x..x.xx..', hat: '...o..o..', kick: 'f........', snare: '..?..?..?' } },
    brushes:   { steps: 9, tracks: { sweep: 'x..x..x..', brush: 'o.?x.gx.?', chick: '...o..o..', kick: 'f........' } },
    four_four: { steps: 12, tracks: { kick: 'x...........', snare: '....x...x...', hat: 'x.o.x.o.x.o.' } },
    cinematic: { steps: 12, tracks: { taiko: 'X...........', tomLo: 'x..x..x.....', tomHi: '....o.....o.' } },
    halftime:  { steps: 12, tracks: { kick: 'x.....x.....', snare: '........x...', clap: '........x...', hat: 'x.o.x.o.x.o.' } },
    minimal:   { steps: 12, tracks: { kick: 'x...........', snare: '....x...x...' } },
    ghost:     { steps: 12, tracks: { kick: 'x.........x.', snare: '........x...', hat: '..x...x.....' } },
  },
  '6/8': {
    swing:     { steps: 12, tracks: { ride: 'x.o.o.x.o.o.', hat: '......o.....', kick: 'f.....f.....', snare: '....?.....?.' } },
    brushes:   { steps: 12, tracks: { sweep: 'x.....x.....', brush: 'o.g.?.x.g.?.', chick: '......o.....', kick: 'f.....f.....' } },
    four_four: { steps: 12, tracks: { kick: 'x.........x.', snare: '......x.....', hat: 'x.o.o.x.o.o.' } },
    cinematic: { steps: 12, tracks: { taiko: 'X.....x.....', tomLo: 'x...x.x...x.', tomHi: '......o.o...' } },
    halftime:  { steps: 12, tracks: { kick: 'x.......x...', snare: '......x.....', clap: '......x.....', hat: 'x.o.o.x.o.o.' } },
    shuffle:   { steps: 12, tracks: { kick: 'x.........x.', snare: '......x....g', hat: 'x.o.o.x.o.o.' } },
    minimal:   { steps: 12, tracks: { kick: 'x...........', snare: '......x.....' } },
  },
};
for (const [m, styles] of Object.entries(METER_TRACKS)) {
  for (const [name, { steps, tracks }] of Object.entries(styles)) {
    if (!METER_DRUMS[m].includes(name)) console.warn(`drums: ${name} has a ${m} bar METER_DRUMS doesn't list`);
    for (const [track, line] of Object.entries(tracks)) if (line.length !== steps) console.warn(`drums: ${m} ${name} ${track} is ${line.length} steps, not ${steps}`);
  }
  for (const name of METER_DRUMS[m]) if (!styles[name]) console.warn(`drums: METER_DRUMS lists ${name} in ${m}, which has no bar`);
}

// Style `p` in meter `m`, with `steps` to the bar: its own bar in that meter if it has
// one, else its 4/4 bar folded (see meter.js), a sixteenth grid's or a triplet grid's.
const inMeter = new Map();
function styleIn(p, m) {
  if (m === FOUR) return p;
  const key = `${m.name}|${style}|${p === ORIGINAL_BRUSHES}`;
  if (inMeter.has(key)) return inMeter.get(key);
  const own = p === ORIGINAL_BRUSHES ? null : METER_TRACKS[m.name]?.[style];
  let out;
  if (own) out = { ...p, steps: own.steps, tracks: own.tracks };
  else {
    const per = (p.steps || 16) / 4, steps = m.beats * per;
    const from = j => (per === 4 ? m.to16(j) : m.to16(Math.round(j * 4 / 3)) * 3 / 4);
    const tracks = Object.fromEntries(Object.entries(p.tracks).map(([k, line]) =>
      [k, Array.from({ length: steps }, (_, j) => line[Math.round(from(j))] ?? '.').join('')]));
    out = { ...p, steps, tracks };
  }
  inMeter.set(key, out);
  return out;
}

// Fills replace snare/toms/cymbals over the last beat (or two, every 8th bar).
const FILLS = {
  16: {
    snare: { 4: { snare: 'goxX' }, 6: { snare: 'gooxxX' }, 8: { snare: 'g.gooxxX' } },
    tom:   { 4: { tomHi: 'xo..', tomLo: '..xx' }, 6: { tomHi: 'xxo...', tomLo: '...xoX' }, 8: { snare: 'x.......', tomHi: '.xx.o...', tomLo: '....xxoX' } },
    // The 80s kit: gated snare, gated toms, and electronic toms, each rolling
    // down from high to low.
    gsnare:  { 4: { gsnare: 'xoxX' }, 6: { gsnare: 'xoxoxX' }, 8: { gsnare: 'x.x.xoxX' } },
    gtom:    { 4: { gtomHi: 'xo..', gtomMid: '..x.', gtomLo: '...X' }, 6: { gtomHi: 'xo....', gtomMid: '..xo..', gtomLo: '....xX' }, 8: { gsnare: 'x.......', gtomHi: '..xo....', gtomMid: '....xo..', gtomLo: '......xX' } },
    simmons: { 4: { simHi: 'xx..', simMid: '..x.', simLo: '...x' }, 6: { simHi: 'xx....', simMid: '..xx..', simLo: '....xx' }, 8: { simHi: 'xxo.....', simMid: '...xxo..', simLo: '......xX' } },
  },
  12: {
    snare: { 3: { snare: 'gox' }, 6: { snare: 'gogoxX' } },
    tom:   { 3: { tomHi: 'xo.', tomLo: '..x' }, 6: { tomHi: 'xxo...', tomLo: '...xoX' } },
  },
};
const FILL_REPLACES = ['snare', 'gsnare', 'tomHi', 'tomLo', 'hat', 'ohat', 'ride', 'rim', 'clap'];

// ─── In a song ────────────────────────────────────────────────────────────────
// A section of a song (see song.js) sets how much of the kit plays:
//   pulse -- the kick and the time (hats, ride, shaker): an intro's beat
//   light -- the beat without its accents: no open hats, crashes or percussion
//   full  -- everything
//   roll  -- nothing but a build's roll (a stripped build, see BUILDS in song.js)
// each a little harder than the last, and the transitions: a fill on a
// section's last bar and a crash after it, a build's roll through its last
// bars, faster and louder as it goes, played on the kit's own backbeat, kick
// or percussion, and nothing at all in the silent beat before a drop.
const PULSE   = new Set(['kick', 'k808', 'k909', 'taiko', 'hat', 'ride', 'shaker', 'sweep', 'chick']);
const PART_LEVEL = { pulse: 0.75, light: 0.85, full: 1, roll: 1 }; // played softer in a verse, opened up in a chorus
const ACCENTS = new Set(['ohat', 'crash', 'tamb', 'swish', 'bell', 'congaLo', 'congaHi']);
const KICKS   = ['kick', 'k808', 'k909', 'taiko'];
const SNARES  = ['snare', 'gsnare', 'clap', 'rim', 'brush'];
// What each kind of roll stops while it plays: the parts it takes over.
const ROLLED  = {
  backbeat: ['snare', 'gsnare', 'clap', 'rim', 'brush', 'tomHi', 'tomLo', 'simLo', 'simMid', 'simHi', 'gtomLo', 'gtomMid', 'gtomHi'],
  kick:     KICKS,
  perc:     ['congaLo', 'congaHi', 'tomLo', 'tomHi', 'bell'],
};

// The tracks a roll plays in style `p`, taking turns: its backbeat (the
// loudest snare, clap or rim on two and four), its kick, or its congas (else
// toms), low and high.
function rollTracks(p, what) {
  if (what === 'kick') return [KICKS.find(k => p.tracks[k]) ?? 'kick'];
  if (what === 'perc') return p.tracks.congaHi || p.tracks.congaLo ? ['congaLo', 'congaHi'] : ['tomLo', 'tomHi'];
  const steps = p.steps || 16;
  let best = 'snare', most = 0;
  for (const track of SNARES) {
    const line = p.tracks[track];
    const v = line ? Math.max(VEL[line[steps / 4]] || 0, VEL[line[steps * 3 / 4]] || 0) : 0;
    if (v > most) { best = track; most = v; }
  }
  return [best];
}

// The roll from beat `from` to `end`: how hard a snare lands on step `i` of
// beat `b`, or 0 for none. Quarters, then eighths, then sixteenths, louder
// all the way.
function rollHit(b, from, end, i, steps) {
  const x = (b - from) / (end - from);
  const per = x < 0.5 ? 4 : x < 0.75 ? 8 : 16; // hits a bar
  if (i % Math.max(1, Math.round(steps / per))) return 0;
  return 0.35 + 0.8 * x;
}

// ─── Cross-rhythms ─────────────────────────────────────────────────────────────
// A layer played against a style's grid, the way the genre does it (every composer). A song draws
// one or none (see crossNow) and plays it wherever the whole kit plays: a chorus,
// a drop, a swell, a loop. Two kinds:
//   tuplet   -- `line`'s steps spread evenly over `over` beats (4, a bar, if not
//               given) from beat `from` (0) of the bar, and again every `over` beats
//               to the bar's end: twelve over a sixteen-step bar is three against
//               four, six over two beats is triplet eighths over straight ones, eight
//               over a twelve-step bar is two against three.
//   cycle    -- `cycle`'s steps on the style's own grid, going round on its own
//               length rather than the bar's, so it drifts across the bar and comes
//               back to the downbeat every few bars (a polymeter, techno's three-step
//               percussion loop); from the top every 8 bars and every section.
//   replaces -- the style's track the layer plays instead of, where it plays.
// `chance` is how often a song in the style has one.
const CROSS = {
  // Triplet hats: through the back half of the bar, or the whole bar.
  trap:     { chance: 0.6, layers: [
    { track: 'hat', replaces: 'hat', from: 2, over: 2, line: 'xooxoo' },
    { track: 'hat', replaces: 'hat', line: 'xoox.ox.oxoo' } ] },
  drill:    { chance: 0.6, layers: [
    { track: 'hat', replaces: 'hat', line: 'x.ox.ox.oxo.' },
    { track: 'rim', line: '..o..g..o..g' } ] },
  halftime: { chance: 0.5, layers: [
    { track: 'hat', replaces: 'hat', from: 2, over: 2, line: 'xoxoxo' },
    { track: 'rim', line: 'g..g..g..g..' } ] },
  // The African dance styles: shakers and congas in triplets over a straight kick.
  afro_house: { chance: 0.6, layers: [
    { track: 'shaker', replaces: 'shaker', line: 'xgoxgoxgoxgo' },
    { track: 'congaHi', replaces: 'congaHi', line: '.o..o..og.o.' } ] },
  amapiano: { chance: 0.6, layers: [
    { track: 'shaker', replaces: 'shaker', line: 'xgoxgoxgoxgo' },
    { track: 'congaHi', replaces: 'congaHi', from: 2, over: 2, line: 'o.oo.o' } ] },
  afrobeats: { chance: 0.5, layers: [
    { track: 'congaHi', replaces: 'congaHi', line: '..o..o.o..o.' },
    { track: 'shaker', replaces: 'shaker', line: 'xgoxgoxgoxgo' } ] },
  // And the other way round: straight eighths over a twelve-eight bell.
  afro:     { chance: 0.5, layers: [
    { track: 'tamb', line: 'xgogxgog' },
    { track: 'congaLo', line: '..o...o.' } ] },
  // Club percussion going round in threes and fives.
  techno:   { chance: 0.6, layers: [
    { track: 'rim', replaces: 'rim', cycle: 'x..' },
    { track: 'tomHi', cycle: 'o....' },
    { track: 'congaHi', cycle: 'o..g.o' } ] },
  deep_house: { chance: 0.5, layers: [
    { track: 'congaHi', cycle: 'o..g.' },
    { track: 'rim', replaces: 'rim', cycle: 'g..' } ] },
  house:    { chance: 0.5, layers: [ { track: 'rim', cycle: 'o..' }, { track: 'congaHi', cycle: 'o..g.' } ] },
  trance:   { chance: 0.4, layers: [ { track: 'rim', cycle: 'g..' } ] },
  // Toms and cross-stick in threes against the bar.
  cinematic: { chance: 0.6, layers: [
    { track: 'tomHi', replaces: 'tomHi', line: 'xooxoo' },
    { track: 'tomHi', replaces: 'tomHi', from: 2, over: 2, line: 'xoo' } ] },
  swing:    { chance: 0.5, layers: [
    { track: 'rim', from: 2, over: 2, line: 'goo' },
    { track: 'rim', line: 'goo' } ] },
  minimal:  { chance: 0.4, layers: [ { track: 'rim', line: 'ggg' } ] },
};
const CROSS_LEVEL = 0.85; // a layer sits a little under the beat it crosses

// The cross-rhythm style `s` plays in this song, or null. Drawn from a stream of its
// own, re-derived each time, so every section and every bar gets the same answer, and
// drawing it leaves the drums' own stream (fills, ghost notes) as it was.
function crossNow(s) {
  const c = CROSS[s];
  if (!c || meter() !== FOUR) return null; // a cross-rhythm is against a 4/4 bar
  restream('drums.cross', s);
  return within(stream('drums.cross'), () => {
    const r = random(), layer = pick(c.layers);
    return rhythmChance(r, c.chance) ? layer : null;
  });
}

// The hits layer `x` adds in the step from beat `pos` of bar `bar` (`unit` beats
// long, step `i` of `steps`), each [offset in beats from the step, character].
function crossHits(x, bar, pos, unit, i, steps) {
  if (x.cycle) {
    const top = Math.max(bar - bar % 8, sec ? Math.round(sec.start / 4) : 0);
    return [[0, x.cycle[((bar - top) * steps + i) % x.cycle.length]]];
  }
  const out = [], from = x.from ?? 0, over = x.over ?? 4, n = x.line.length;
  for (let at = from; at < 4 - 1e-6; at += over) {
    for (let k = 0; k < n; k++) {
      const sp = at + k * over / n;
      if (sp >= pos - 1e-6 && sp < pos + unit - 1e-6) out.push([sp - pos, x.line[k]]);
    }
  }
  return out;
}

// Whether layer `x` has the style's `track` at beat `pos` of the bar.
function crossReplaces(x, track, pos) {
  if (x.replaces !== track) return false;
  if (x.cycle || x.from === undefined) return true;
  return pos >= x.from - 1e-6;
}

// ─── Sequencer ────────────────────────────────────────────────────────────────
// One key of `weights` ({ key: weight }), drawn in proportion to its weight.
function weighted(weights) {
  let r = random() * Object.values(weights).reduce((a, w) => a + w, 0);
  for (const [k, w] of Object.entries(weights)) if ((r -= w) < 0) return k;
  return Object.keys(weights).at(-1);
}

let style = 'four_four';
let curBar = -1, fill = null, fillFrom = 99, crashNext = false, rollSteps = new Set();
let sec = null;      // the song section the current bar is in, or null
let rollFrom = null; // beat at which this section's roll starts
let cross = null;    // the cross-rhythm layer this song plays, or null (see CROSS)

function startBar(bar, p, steps, B) {
  curBar = bar;
  fill = null; fillFrom = 99;
  cross = crossNow(style);
  sec = song.sectionAt(bar * B);
  const end = sec ? sec.start + sec.beats : 0;
  rollFrom = sec?.build?.roll ? Math.max(sec.start, end - sec.build.rollBars * B) : null;
  const lastBar = !!sec && bar * B + B >= end;
  if (sec && bar * B === sec.start && sec.crash) crashNext = true;
  const wanted = rollFrom !== null && bar * B >= rollFrom ? false
    : lastBar ? sec.fill && (!p.machine || !!song.sectionAt(end)?.hook)
    : p.machine ? !sec && bar % 16 === 15 && random() < 0.6
    : bar % 4 === 3 && (bar % 8 === 7 || random() < 0.55);
  if (p.fill && wanted) {
    // Six-eight fills its last big beat, a dotted quarter.
    const beats = B === 3 && meter().name === '6/8' ? 1.5 : bar % 8 === 7 || lastBar ? 2 : 1;
    const n = beats * steps / B;
    fill = FILLS[4 * steps / B][typeof p.fill === 'string' ? p.fill : weighted(p.fill)][n];
    fillFrom = steps - n;
  }
  rollSteps = new Set();
  if (p.rolls) for (const s of [6, 7, 14, 15]) if (random() < 0.3) rollSteps.add(s);
}

// One hit of a cross-rhythm layer (see play).
function strike(fn, track, t, at, level, v, human) {
  if (human) { at += rand(-0.004, 0.004); v *= rand(0.9, 1.07); }
  fn(Math.max(t, at), level * v, v);
  logHit(track, Math.max(t, at), Math.min(1, v));
}

function play(t, b) {
  const m     = meter();
  const p     = styleIn(styleNow(), m);
  const B     = m.beats;
  const steps = m === FOUR ? p.steps || 16 : p.steps; // to the bar
  const unit  = B / steps;
  const bar   = Math.floor(b / B + 1e-6);
  const i     = Math.round((b - bar * B) / unit) % steps;
  if (bar !== curBar) startBar(bar, p, steps, B);

  const stepSec = unit * beat();
  let st = t;
  if (steps === 4 * B && i % 2 === 1 && p.swing) st += (p.swing - 0.5) * 2 * stepSec;

  const density = 0.5 + state.density * 0.5;
  const bright  = 0.4 + state.brightness * 0.6;

  const next = bar * B + (i + 1) * unit - b; // re-snap to the exact grid every step
  const end = sec ? sec.start + sec.beats : Infinity;
  if (b >= end - (sec?.gap ?? 0) - 1e-6) return next; // the silence before a drop
  const part = sec?.drums ?? 'full';
  const build = sec?.build;
  const rolling = rollFrom !== null && b >= rollFrom - 1e-6;
  const noKick = !!build?.kickOut && b >= end - sec.gap - build.kickOut - 1e-6;
  const crossing = !!cross && part === 'full' && !rolling;

  const hits = [];
  if (i === 0 && crashNext) { hits.push(['crash', 1]); crashNext = false; }
  for (const [track, line] of Object.entries(p.tracks)) {
    if (part === 'roll') break;
    if (i >= fillFrom && FILL_REPLACES.includes(track)) continue;
    if (part === 'pulse' && !PULSE.has(track)) continue;
    if (part === 'light' && ACCENTS.has(track)) continue;
    if (rolling && ROLLED[build.roll].includes(track)) continue;
    if (noKick && KICKS.includes(track)) continue;
    if (crossing && crossReplaces(cross, track, i * unit)) continue;
    hits.push([track, line[i]]);
  }
  if (crossing && !(fill && i >= fillFrom)) {
    for (const [off, ch] of crossHits(cross, bar, i * unit, unit, i, steps)) hits.push([cross.track, ch, off]);
  }
  if (fill && part !== 'roll') {
    for (const [track, line] of Object.entries(fill)) hits.push([track, line[i - fillFrom]]);
    if (i === steps - 1) crashNext = true;
  }
  if (rolling) {
    const v = rollHit(b, rollFrom, end - sec.gap, i, steps);
    const tracks = rollTracks(p, build.roll);
    // A kick roll's sixteenths would swamp everything at a snare's level.
    if (v) hits.push([tracks[Math.round((b - rollFrom) / unit) % tracks.length], v * (build.roll === 'kick' ? 0.8 : 1)]);
  }

  for (const [track, ch, off] of hits) {
    if (ch === '?' && off !== undefined) continue; // a layer has no '?': and no draw from the drums' stream
    let v = typeof ch === 'number' ? ch : ch === '?' ? (random() < 0.35 ? VEL.g : 0) : VEL[ch] || 0;
    if (!v) continue;
    if (off !== undefined) v *= CROSS_LEVEL;
    if (track !== 'crash' && sec) v *= PART_LEVEL[part];
    const [fn, level] = KIT[(p.acoustic && ACOUSTIC[track]) || STRUCK[track] || track];
    const scale = ['hat', 'ohat', 'ride', 'shaker', 'crash', 'swish', 'sweep', 'chick', 'tamb'].includes(track) ? bright : density;
    // A tuplet's hit falls between the grid's steps, at its own time, unswung.
    let at = off ? t + off * beat() : st;
    // A layer's hits draw (their feel, the sounds' own variation) from a stream of
    // their own, so the kit's ghost notes, fills and sounds are as they'd be without it.
    if (off !== undefined) { within(stream('drums.feel'), () => strike(fn, track, t, at, level * scale, v, p.human)); continue; }
    if (p.human) { at += rand(-0.004, 0.004); v *= rand(0.9, 1.07); }
    if (track === 'hat' && rollSteps.has(i)) {
      const n = pick([2, 3, 4]);
      for (let r = 0; r < n; r++) {
        fn(at + r * stepSec / n, level * scale * v * (0.6 + 0.4 * r / n), v * (0.6 + 0.4 * r / n));
        logHit(track, at + r * stepSec / n, v * 0.6);
      }
      continue;
    }
    fn(Math.max(t, at), level * scale * v, v);
    logHit(track, Math.max(t, at), Math.min(1, v));
  }

  return next;
}

const voice = createVoice('drums', play, { entry: 'bar', onReset: () => { curBar = -1; crashNext = false; choke = null; sec = null; rollFrom = null; } });

export const DRUM_STYLES = Object.keys(STYLES);

export const drumsVoice = {
  ...voice,
  get style() { return style; },
  // Infinite mode: choose a style that suits the current tempo.
  reroll() {
    const classic = DRUM_STYLES.filter(s => !STYLES[s].dance);
    const fits = classic.filter(s => state.tempo >= STYLES[s].bpm[0] && state.tempo <= STYLES[s].bpm[1]);
    style = pick(fits.length ? fits : classic);
  },
  setStyle(s) { style = s; },
};
