import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo, ahr } from '../synth.js';

// Analogue-style pad. Chords change exactly on the harmonic rhythm and are
// voice-led (each note moves to the nearest tone of the next chord), so the
// pad glides between chords instead of jumping in parallel blocks — and never
// holds the old chord over the new one. Each note is a detuned saw pair; one
// shared lowpass breathes slowly so a held chord doesn't sit static.
let prev = null;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.voiced(seg);
  const v    = harmony.voice(pcs, prev, register(66, 28, 83), { bed: true, name: 'pad', from: b, to: seg.end });
  prev = v;
  for (const m of v) logNote('pad', t, m, dur, 0.6);

  const bus    = getVoiceBus('pad').dry;
  const peak   = rand(0.075, 0.1) * 3 / v.length;
  const attack = Math.min(0.8, dur * 0.4);
  const end    = t + dur + 1.0;

  const cutoff = lerp(400, 2400, state.brightness);
  const lp = filter('lowpass', cutoff, 1.1);
  lfo(rand(0.08, 0.16), cutoff * 0.22, t, end).connect(lp.frequency);

  for (const midi of v) {
    const hz = midiToHz(midi);
    for (const d of [-7, 7]) osc('sawtooth', hz, t, end, d + rand(-2, 2)).connect(lp);
  }
  const env = gain(0);
  ahr(env.gain, t, peak, attack, dur, 0.9);
  lp.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, lerp(0.2, 0.8, state.spaciousness));
  return len;
}

export const padVoice = createVoice('pad', play, { role: 'bed', onReset: () => { prev = null; } });
