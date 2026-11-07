import { audio, getVoiceBus, noise } from '../context.js';
import { beat, rand, pick, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo, ahr } from '../synth.js';

// Choir by formant synthesis. A vowel is defined by the resonances of the
// vocal tract (formants F1–F3), which stay put whatever note is sung — so the
// whole chord's detuned saws feed ONE bank of three band-pass filters tuned
// to a vowel, and the bank glides from one vowel to another over the chord
// ("ooh" opening to "aah"). A single swept band-pass can't make a vowel.
// Values: alto formant tables (frequency Hz, level dB, bandwidth Hz).
const VOWELS = {
  a: [[800, 0, 80],  [1150, -4, 90],  [2800, -20, 120]],
  o: [[450, 0, 70],  [800, -9, 80],   [2830, -16, 100]],
  u: [[325, 0, 50],  [700, -12, 60],  [2530, -30, 170]],
  e: [[400, 0, 60],  [1600, -24, 80], [2700, -30, 120]],
};
const db = x => Math.pow(10, x / 20);
let prev = null;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.voiced(seg);
  const v    = harmony.voice(pcs, prev, register(64, 28, 81));
  prev = v;
  for (const m of v) logNote('choir', t, m, dur, 0.6);

  const bus    = getVoiceBus('choir').dry;
  const peak   = rand(0.13, 0.16) * 3 / v.length;
  const attack = Math.min(1.0, dur * 0.35);
  const end    = t + dur + 1.4;

  const src = gain(1);
  const vibA = lfo(5.1, 12, t, end, attack, 0.6);
  const vibB = lfo(5.7, 10, t, end, attack, 0.6);
  v.forEach(midi => {
    const hz = midiToHz(midi);
    [-12, 0, 12].forEach((d, i) => {
      const o = osc('sawtooth', hz, t, end, d + rand(-3, 3));
      (i % 2 ? vibA : vibB).connect(o.detune);
      o.connect(src);
    });
  });
  // A breath of aspiration noise through the same vocal tract.
  const air = noise(t, dur + 1.4), airG = gain(0.25);
  air.connect(airG); airG.connect(src);

  const from = VOWELS[pick(['u', 'o', 'e'])], to = VOWELS[pick(['a', 'o', 'a'])];
  const env = gain(0);
  ahr(env.gain, t, peak, attack, dur, 1.2);
  for (let f = 0; f < 3; f++) {
    const [f1, l1, bw1] = from[f], [f2, l2, bw2] = to[f];
    const bp = filter('bandpass', f1, f1 / bw1);
    bp.frequency.setValueAtTime(f1, t);
    bp.frequency.linearRampToValueAtTime(f2, t + Math.max(0.5, dur * 0.6));
    bp.Q.setValueAtTime(f1 / bw1, t);
    bp.Q.linearRampToValueAtTime(f2 / bw2, t + Math.max(0.5, dur * 0.6));
    const lvl = gain(db(l1));
    lvl.gain.setValueAtTime(db(l1), t);
    lvl.gain.linearRampToValueAtTime(db(l2), t + Math.max(0.5, dur * 0.6));
    src.connect(bp); bp.connect(lvl); lvl.connect(env);
  }
  env.connect(bus);
  send(env, audio.reverbSend, 0.8);
  return len;
}

export const choirVoice = createVoice('choir', play, { role: 'bed', onReset: () => { prev = null; } });
