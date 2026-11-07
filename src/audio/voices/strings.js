import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo, ahr } from '../synth.js';

// String section: three detuned saws per note for ensemble width, a lowpass
// that opens as bow pressure builds, and — the thing that makes synthetic
// strings read as *strings* — vibrato on every note, slightly different in
// rate per player, faded in after the bow has started. Chord-synchronous and
// voice-led like the pad.
let prev = null;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.voiced(seg);
  const v    = harmony.voice(pcs, prev, register(62, 28, 80));
  prev = v;
  for (const m of v) logNote('strings', t, m, dur, 0.6);

  const bus    = getVoiceBus('strings').dry;
  const peak   = rand(0.12, 0.155) * 3 / v.length;
  const attack = Math.min(1.2, dur * 0.35);
  const end    = t + dur + 1.2;

  const lp = filter('lowpass', 300, 0.7);
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.linearRampToValueAtTime(lerp(900, 3200, state.brightness), t + attack + 0.3);
  const hp = filter('highpass', 110, 0.7);

  for (const midi of v) {
    const hz  = midiToHz(midi);
    const vib = lfo(rand(5.0, 5.9), rand(7, 11), t, end, attack * 0.8, 0.5); // cents
    for (const d of [-10, 0, 10]) {
      const o = osc('sawtooth', hz, t, end, d + rand(-3, 3));
      vib.connect(o.detune);
      o.connect(lp);
    }
  }
  const env = gain(0);
  ahr(env.gain, t, peak / 3, attack, dur, 1.0);
  lp.connect(hp); hp.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, lerp(0.3, 0.8, state.spaciousness));
  return len;
}

export const stringsVoice = createVoice('strings', play, { role: 'bed', onReset: () => { prev = null; } });
