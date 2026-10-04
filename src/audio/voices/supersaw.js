import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo, ahr } from '../synth.js';

// Supersaw (Roland JP-8000): seven detuned saws per note. The detune isn't
// even — the inner pairs sit close and the outer pair wide (the curve
// measured from the original) — which gives a solid centre with a shimmering
// edge rather than an even chorus. The side saws are split left and right,
// each side getting one of every width, so the chord is wide but balanced.
// Each saw starts at its own phase: saws started together sweep like a
// flanger as they drift apart. The filter opens much further than the pad's —
// this is the bright one. Chord-synchronous and voice-led like the pad.
const SHAPE  = [-1, -0.57, -0.18, 0, 0.18, 0.57, 1]; // relative detune per saw
const SIDE   = [-1, 1, -1, 0, 1, -1, 1];             // left, centre or right
const DETUNE = 28;  // cents, outermost saw
const SIDE_LEVEL = 0.7; // against the centre saw

let prev = null;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.pcs(seg.degree, seg.seventh ? 4 : 3);
  const v    = harmony.voice(pcs, prev, register(66, 28, 83));
  prev = v;
  for (const m of v) logNote('supersaw', t, m, dur, 0.6);

  const bus    = getVoiceBus('supersaw').dry;
  const peak   = rand(0.047, 0.057) * 3 / v.length;
  const attack = Math.min(0.5, dur * 0.3);
  const end    = t + dur + 1.1;

  // The filter swells open with the attack, then breathes slowly.
  const cutoff = lerp(1500, 7500, state.brightness);
  const lp = filter('lowpass', cutoff * 0.35, 0.6);
  lp.frequency.setValueAtTime(cutoff * 0.35, t);
  lp.frequency.linearRampToValueAtTime(cutoff, t + attack + 0.4);
  lfo(rand(0.07, 0.12), cutoff * 0.12, t, end).connect(lp.frequency);

  const [left, right] = [-0.8, 0.8].map(p => {
    const g = gain(SIDE_LEVEL), pan = audio.ctx.createStereoPanner();
    pan.pan.value = p;
    g.connect(pan); pan.connect(lp);
    return g;
  });
  for (const midi of v) {
    const hz = midiToHz(midi);
    SHAPE.forEach((s, i) => {
      const o = osc('sawtooth', hz, t - rand(0, 1 / hz), end, s * DETUNE + rand(-1.5, 1.5));
      o.connect(SIDE[i] < 0 ? left : SIDE[i] > 0 ? right : lp);
    });
  }
  const env = gain(0);
  ahr(env.gain, t, peak, attack, dur, 1.0);
  lp.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, lerp(0.2, 0.75, state.spaciousness));
  return len;
}

export const supersawVoice = createVoice('supersaw', play, { role: 'bed', onReset: () => { prev = null; } });
