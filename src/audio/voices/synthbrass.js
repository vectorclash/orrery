import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, pick, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo, ahr } from '../synth.js';

// Polysynth brass: two detuned saws per note into one lowpass whose envelope
// carries the brass — the filter opens ahead of the level and then settles.
// Two classic settings, one per session:
//   stab  — Oberheim OB-Xa ("Jump"): a fast bright "blat" that drops back to
//           a darker sustain.
//   swell — Yamaha CS-80 (Vangelis, Blade Runner): the filter climbs slowly
//           with the level, then vibrato arrives once the chord has bloomed.
// Chord-synchronous and voice-led like the pad.
let prev = null;
let style = 'stab';

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.pcs(seg.degree, seg.seventh ? 4 : 3);
  const v    = harmony.voice(pcs, prev, register(60, 28, 78));
  prev = v;
  for (const m of v) logNote('synthbrass', t, m, dur, 0.7);

  const bus   = getVoiceBus('synthbrass').dry;
  const swell = style === 'swell';
  const peak  = rand(0.096, 0.114) * 3 / v.length * (swell ? 0.78 : 0.95); // a swell holds its level, a stab settles
  const end   = t + dur + 0.8;

  const top = lerp(2200, 6500, state.brightness);
  const lp  = filter('lowpass', 250, 1.4);
  lp.frequency.setValueAtTime(250, t);
  if (swell) {
    lp.frequency.exponentialRampToValueAtTime(top * 0.8, t + Math.min(1.2, dur * 0.5));
  } else {
    lp.frequency.exponentialRampToValueAtTime(top, t + 0.06);
    lp.frequency.setTargetAtTime(top * 0.4, t + 0.06, 0.18);
  }
  lp.frequency.setTargetAtTime(250, t + dur, 0.15);

  const vib = swell ? lfo(rand(4.8, 5.4), 9, t, end, Math.min(1.5, dur * 0.6), 0.6) : null; // cents
  for (const midi of v) {
    const hz = midiToHz(midi);
    for (const d of [-7, 7]) {
      const o = osc('sawtooth', hz, t, end, d + rand(-2, 2));
      if (vib) vib.connect(o.detune);
      o.connect(lp);
    }
  }
  const env = gain(0);
  if (swell) {
    ahr(env.gain, t, peak, Math.min(0.6, dur * 0.35), dur, 0.7);
  } else {
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.03);
    env.gain.setTargetAtTime(peak * 0.75, t + 0.03, 0.2);
    env.gain.setValueAtTime(peak * 0.75, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.45);
  }
  lp.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, lerp(0.25, 0.75, state.spaciousness));
  return len;
}

export const synthbrassVoice = createVoice('synthbrass', play, {
  role: 'bed',
  onReset: () => { prev = null; style = pick(['stab', 'swell']); },
});
