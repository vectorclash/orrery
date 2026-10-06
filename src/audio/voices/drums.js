import { audio, getVoiceBus, noise } from '../context.js';
import { state, beat, rand, pick, fold, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logHit } from '../notes.js';
import { osc, gain, filter, send, perc, shaper } from '../synth.js';

// ─── Kit ──────────────────────────────────────────────────────────────────────
// Each piece takes (t, velocity). Kick/snare/clap sit centre; the rest are
// spread across the stereo field the way a kit is miked.
const out = piece => (piece ? getVoiceBus(`kit:${piece}`).dry : audio.dry);

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
function drum(t, v, hz, piece, decay, verb) {
  const o = osc('sine', hz * 1.5, t, t + decay + 0.1), e = gain(0);
  o.frequency.setValueAtTime(hz * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
  perc(e.gain, t, v, decay, 0.001);
  o.connect(e); e.connect(out(piece));
  const n = noise(t, 0.03), bp = filter('bandpass', hz * 4, 1), ne = gain(0);
  perc(ne.gain, t, v * 0.25, 0.02, 0.0005);
  n.connect(bp); bp.connect(ne); ne.connect(out(piece));
  send(e, audio.reverbSend, verb);
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

// Brushes: a swish is a filtered-noise swell stirred across the head; a tap
// is a soft, short hit.
function swish(t, v) {
  const len = beat() * 0.9;
  const n = noise(t, len + 0.05), bp = filter('bandpass', 4200, 0.6), env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + len * 0.45);
  env.gain.linearRampToValueAtTime(0, t + len);
  n.connect(bp); bp.connect(env); env.connect(out('hat'));
}
function brushTap(t, v) {
  const n = noise(t, 0.15), bp = filter('bandpass', 2800, 0.5), env = gain(0);
  perc(env.gain, t, v, 0.12, 0.002);
  n.connect(bp); bp.connect(env); env.connect(out());
  send(env, audio.reverbSend, 0.2);
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
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0, e = 0;
      for (let i = 0; i < len; i++) {
        y += 0.55 * ((Math.random() * 2 - 1) - y);
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
  return gate.input;
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

// Simmons SDS-V electronic tom: an oscillator whose pitch falls steeply
// through the whole note (the "pew"), a filtered-noise stick attack, and some
// of the gated room. Tuned to the key: root, fifth and octave.
function simmons(t, v, hz, piece) {
  const o = osc('triangle', hz * 2.2, t, t + 0.6), body = gain(0);
  o.frequency.setValueAtTime(hz * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(hz * 0.7, t + 0.5);
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

// Per-piece loudness (before density/brightness scaling and velocity).
const KIT = {
  kick:    [kick,    0.32],  k808:  [kick808, 0.28], snare:   [snare,   0.2],
  k909:    [kick909, 0.21], // level-matched: harder and longer than the acoustic kick
  clap:    [clap,    0.17],  rim:   [rim,     0.16], hat:     [(t, v) => hat(t, v), 0.1],
  ohat:    [(t, v) => hat(t, v, true), 0.08],        ride:    [ride,    0.55],
  crash:   [crash,   0.08],  tomLo: [tomLo,   0.26], tomHi:   [tomHi,   0.22],
  congaLo: [congaLo, 0.2],   congaHi: [congaHi, 0.18], taiko: [taiko,   0.3],
  shaker:  [shaker,  0.06],  bell:  [cowbell, 0.07], swish:   [swish,   0.3],
  btap:    [brushTap, 0.34],
  gsnare:  [gatedSnare, 0.2], simLo: [simLo,   0.26], simMid:  [simMid,  0.24],
  simHi:   [simHi,   0.22],
  tamb:    [tambourine, 0.09],
};

// ─── Patterns ─────────────────────────────────────────────────────────────────
// One bar per string, one character per step: X accent, x hit, o medium,
// g ghost, f feathered (felt more than heard), ? ghost that plays only
// sometimes (variation), . rest.
// 16 steps = sixteenths; 12 steps = eighth-note triplets (a swung or 12/8 bar).
//   swing   — MPC-style: fraction of an eighth taken by its first sixteenth
//   human   — small timing/velocity drift, for styles played by a person
//   fill    — 'snare' or 'tom' fill at the end of 4-bar phrases (then a crash)
//   rolls   — trap hi-hat rolls
//   bpm     — tempo range the style suits (Infinite mode picks by tempo)
const VEL = { X: 1.15, x: 1, o: 0.62, g: 0.35, f: 0.15 };

const STYLES = {
  minimal: { bpm: [50, 140], tracks: {
    kick:  'x.......x.......',
    snare: '....x.......x...' } },
  four_four: { bpm: [70, 140], human: true, fill: 'snare', tracks: {
    kick:  'x.......x.x.....',
    snare: '....x.......x...',
    hat:   'x.o.x.o.x.o.x.o.' } },
  jungle: { bpm: [80, 140], fill: 'snare', tracks: {
    kick:  'x.....x.....x...',
    snare: '....x..g..g.x...',
    hat:   'xo.ox.oo.oo.xo.o' } },
  shuffle: { steps: 12, bpm: [60, 130], human: true, fill: 'snare', tracks: {
    kick:  'x.....x.....',
    snare: '...x.....x.g',
    hat:   'x.ox.ox.ox.o' } },
  trap: { bpm: [60, 140], rolls: true, tracks: {
    k808:  'x......x.x......',
    snare: '........x.......',
    clap:  '........x.......',
    hat:   'xoxoxoxoxoxoxoxo' } },
  ghost: { bpm: [50, 140], tracks: {
    kick:  'x.............x.',
    snare: '......x.....x...',
    hat:   '..x......x......' } },
  halftime: { bpm: [60, 140], fill: 'snare', tracks: {
    kick:  'x.....x.........',
    snare: '........x.....g.',
    clap:  '........x.......',
    hat:   'x.o.x.o.x.o.x.o.' } },
  breakbeat: { bpm: [80, 140], swing: 0.54, human: true, fill: 'snare', tracks: {
    kick:  'x......x..x.....',
    snare: '....x.......x.g.',
    hat:   'x.og.go.xg.gx.o.' } },
  bossanova: { bpm: [60, 140], human: true, tracks: {
    kick:  'x.....x.x.....x.',
    rim:   'x..x..x...x..x..',
    hat:   'o.g.o.g.o.g.o.g.' } },
  house: { bpm: [110, 140], fill: 'snare', tracks: {
    kick:   'x...x...x...x...',
    clap:   '....x.......x...',
    ohat:   '..x...x...x...x.',
    shaker: 'ogogogogogogogog' } },
  swing: { steps: 12, bpm: [60, 140], human: true, fill: 'snare', tracks: {
    ride:  'x..x.xx..x.x',
    hat:   '...o.....o..',
    kick:  'f..f..f..f..',
    snare: '..?..?..?..?' } },
  funk: { bpm: [85, 125], swing: 0.53, human: true, fill: 'snare', tracks: {
    kick:  'x.x....x..x..x..',
    snare: '....X..g.g..X..g',
    hat:   'xoxoxoxoxoxoxo.o',
    ohat:  '..............x.' } },
  boombap: { bpm: [70, 100], swing: 0.58, human: true, tracks: {
    kick:  'x......x..x.....',
    snare: '....x.......x...',
    hat:   'x.o.x.o.x.o.x.o.' } },
  reggae: { steps: 12, bpm: [60, 100], human: true, tracks: {
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
  cinematic: { bpm: [60, 110], human: true, fill: 'tom', tracks: {
    taiko: 'X.......x.......',
    tomLo: 'x..x..x...x..x..',
    tomHi: '....o.......o.o.' } },
  brushes: { bpm: [50, 110], swing: 0.66, human: true, tracks: {
    swish: 'x...x...x...x...',
    btap:  '....x.......x...',
    kick:  'f.......f.......',
    hat:   '....o.......o...' } },
  garage: { bpm: [118, 140], swing: 0.62, tracks: {
    kick:   'x.........x.....',
    snare:  '....x.......x...',
    hat:    'x.o.x.o.x.o.x.o.',
    shaker: '.g.g.g.g.g.g.g.g' } },
  // 80s drum machine: the rock beat with a gated snare and Simmons fills.
  synthwave: { bpm: [80, 125], fill: 'simmons', tracks: {
    kick:   'x.......x.x.....',
    gsnare: '....x.......x...',
    hat:    'x.o.x.o.x.o.x.o.' } },
  // Outrun: four on the floor under driving sixteenths (Kavinsky, Carpenter Brut).
  outrun: { bpm: [95, 130], fill: 'simmons', tracks: {
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
  deep_house: { dance: true, bpm: [115, 128], swing: 0.56, human: true, fill: 'snare', tracks: {
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
  // Trance: four on the floor, a clap on two and four, off-beat open hats and
  // a snare roll into every fourth bar.
  trance: { dance: true, bpm: [128, 140], fill: 'snare', tracks: {
    k909:  'x...x...x...x...',
    clap:  '....x.......x...',
    ohat:  '..x...x...x...x.',
    hat:   'g...g...g...g...' } },
  // Big room / EDM: a heavy kick, clap and snare stacked on two and four.
  big_room: { dance: true, bpm: [120, 132], fill: 'snare', tracks: {
    k909:  'X...X...X...X...',
    clap:  '....x.......x...',
    snare: '....o.......o...',
    ohat:  '..x...x...x...x.',
    shaker: 'g.g.g.g.g.g.g.g.' } },
  // Disco / nu-disco: four on the floor, snare and clap on two and four, the
  // open hat on every "and" (cut by the closed one a sixteenth later -- the
  // "tss-t"), a tambourine, and tom fills.
  disco: { dance: true, bpm: [110, 128], human: true, fill: 'tom', tracks: {
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
  dnb: { dance: true, bpm: [160, 178], fill: 'snare', tracks: {
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

// Fills replace snare/toms/cymbals over the last beat (or two, every 8th bar).
const FILLS = {
  16: {
    snare: { 4: { snare: 'goxX' }, 8: { snare: 'g.gooxxX' } },
    tom:   { 4: { tomHi: 'xo..', tomLo: '..xx' }, 8: { snare: 'x.......', tomHi: '.xx.o...', tomLo: '....xxoX' } },
    // Electronic toms rolling down from high to low.
    simmons: { 4: { simHi: 'xx..', simMid: '..x.', simLo: '...x' }, 8: { simHi: 'xxo.....', simMid: '...xxo..', simLo: '......xX' } },
  },
  12: {
    snare: { 3: { snare: 'gox' }, 6: { snare: 'gogoxX' } },
    tom:   { 3: { tomHi: 'xo.', tomLo: '..x' }, 6: { tomHi: 'xxo...', tomLo: '...xoX' } },
  },
};
const FILL_REPLACES = ['snare', 'gsnare', 'tomHi', 'tomLo', 'hat', 'ohat', 'ride', 'rim', 'clap'];

// ─── Sequencer ────────────────────────────────────────────────────────────────
let style = 'four_four';
let curBar = -1, fill = null, fillFrom = 99, crashNext = false, rollSteps = new Set();

function startBar(bar, p, steps) {
  curBar = bar;
  fill = null; fillFrom = 99;
  if (p.fill && bar % 4 === 3 && (bar % 8 === 7 || Math.random() < 0.55)) {
    const beats = bar % 8 === 7 ? 2 : 1;
    const n = beats * steps / 4;
    fill = FILLS[steps][p.fill][n];
    fillFrom = steps - n;
  }
  rollSteps = new Set();
  if (p.rolls) for (const s of [6, 7, 14, 15]) if (Math.random() < 0.3) rollSteps.add(s);
}

function play(t, b) {
  const p     = STYLES[style];
  const steps = p.steps || 16;
  const unit  = 4 / steps;
  const bar   = Math.floor(b / 4 + 1e-6);
  const i     = Math.round((b - bar * 4) / unit) % steps;
  if (bar !== curBar) startBar(bar, p, steps);

  const stepSec = unit * beat();
  let st = t;
  if (steps === 16 && i % 2 === 1 && p.swing) st += (p.swing - 0.5) * 2 * stepSec;

  const density = 0.5 + state.density * 0.5;
  const bright  = 0.4 + state.brightness * 0.6;

  const hits = [];
  if (i === 0 && crashNext) { hits.push(['crash', 1]); crashNext = false; }
  for (const [track, line] of Object.entries(p.tracks)) {
    if (i >= fillFrom && FILL_REPLACES.includes(track)) continue;
    hits.push([track, line[i]]);
  }
  if (fill) {
    for (const [track, line] of Object.entries(fill)) hits.push([track, line[i - fillFrom]]);
    if (i === steps - 1) crashNext = true;
  }

  for (const [track, ch] of hits) {
    let v = ch === '?' ? (Math.random() < 0.35 ? VEL.g : 0) : VEL[ch] || 0;
    if (!v) continue;
    const [fn, level] = KIT[track];
    const scale = ['hat', 'ohat', 'ride', 'shaker', 'crash', 'swish', 'tamb'].includes(track) ? bright : density;
    let at = st;
    if (p.human) { at += rand(-0.004, 0.004); v *= rand(0.9, 1.07); }
    if (track === 'hat' && rollSteps.has(i)) {
      const n = pick([2, 3, 4]);
      for (let r = 0; r < n; r++) {
        fn(at + r * stepSec / n, level * scale * v * (0.6 + 0.4 * r / n));
        logHit(track, at + r * stepSec / n, v * 0.6);
      }
      continue;
    }
    fn(Math.max(t, at), level * scale * v);
    logHit(track, Math.max(t, at), Math.min(1, v));
  }

  return bar * 4 + (i + 1) * unit - b; // re-snap to the exact grid every step
}

const voice = createVoice('drums', play, { entry: 4, onReset: () => { curBar = -1; crashNext = false; choke = null; } });

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
