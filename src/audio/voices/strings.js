import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo, ahr, wander } from '../synth.js';

// String section: three players per note, each a sawtooth (a bowed string's
// Helmholtz motion is very nearly one), a lowpass that opens as bow pressure
// builds, and vibrato faded in after the bow has started. Each player has a
// vibrato of their own, a little faster or slower and starting a little
// later than the next, and a pitch that wanders by a few cents (see wander):
// three saws sharing one vibrato beat against each other like a synth pad.
// The sound goes through a violin's body, the part a bare saw lacks most:
// the air and wood resonances around 280 Hz, a dip near 1.5 kHz, and the
// "bridge hill", the broad peak near 2.5 kHz that gives strings their edge
// and carries them through a mix. Chord-synchronous and voice-led like the pad.
//
// Body resonances as [type, Hz, Q, dB]: a smoothed outline of measured
// violin and viola responses, not any one instrument's.
const BODY = [['peaking', 280, 1.2, 3], ['peaking', 1500, 1.4, -3], ['peaking', 2500, 1.3, 4], ['lowpass', 7500, 0.6, 0]];
let prev = null;
const LEVEL = 0.82; // matched to the old voice's loudness

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.voiced(seg);
  const v    = harmony.voice(pcs, prev, register(62, 28, 80), { bed: true, name: 'strings', from: b, to: seg.end });
  prev = v;
  for (const m of v) logNote('strings', t, m, dur, 0.6);

  const bus    = getVoiceBus('strings').dry;
  const peak   = rand(0.12, 0.155) * 3 / v.length;
  const attack = Math.min(1.2, dur * 0.35);
  const end    = t + dur + 1.2;

  const lp = filter('lowpass', 400, 0.7);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.linearRampToValueAtTime(lerp(2000, 5000, state.brightness), t + attack + 0.3);
  const hp = filter('highpass', 110, 0.7);

  for (const midi of v) {
    const hz    = midiToHz(midi);
    const rate  = rand(5.0, 5.9), depth = rand(7, 11); // cents
    [-10, 0, 10].forEach((d, i) => {
      const o = osc('sawtooth', hz, t, end, d + rand(-3, 3));
      lfo(rate * (1 + 0.07 * (i - 1)), depth, t, end, attack * (0.65 + 0.15 * i), 0.5).connect(o.detune);
      wander(t, end, 5, midi * 3 + i).connect(o.detune);
      o.connect(lp);
    });
  }
  const env = gain(0);
  ahr(env.gain, t, peak / 3 * LEVEL, attack, dur, 1.0);
  let node = hp;
  lp.connect(hp);
  for (const [type, hz, q, db] of BODY) {
    const f = filter(type, hz, q);
    f.gain.value = db;
    node.connect(f); node = f;
  }
  node.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, lerp(0.3, 0.8, state.spaciousness));
  return len;
}

export const stringsVoice = createVoice('strings', play, { role: 'bed', onReset: () => { prev = null; } });
