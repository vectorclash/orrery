import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo } from '../synth.js';

// Brass: the defining trait is that brightness follows loudness — a lowpass
// opens as the note swells and closes as it settles ("bloom"). The pitch
// scoops up from slightly flat as the lips lock onto the note, and vibrato
// arrives late. Strong-beat notes are sometimes harmonised a third below,
// the way a horn section voices a line.
const phraser = createPhraser({ name: 'brass', base: () => register(58, 28, 75), lead: true, repeat: 0.65 });

function horn(t, midi, dur, vel, level) {
  const bus = getVoiceBus('brass').dry;
  const hz  = midiToHz(midi);
  const end = t + dur + 0.4;
  const peak = level * vel;
  logNote('brass', t, midi, dur, vel);

  const lp = filter('lowpass', hz * 1.2, 1.3);
  const open = hz * lerp(3.5, 7, vel * (0.4 + 0.6 * state.brightness));
  lp.frequency.setValueAtTime(hz * 1.2, t);
  lp.frequency.exponentialRampToValueAtTime(open, t + 0.07);
  lp.frequency.setTargetAtTime(hz * lerp(2.4, 4.2, state.brightness), t + 0.07, 0.25);
  lp.frequency.setTargetAtTime(hz * 1.1, t + dur, 0.06);

  const vib = lfo(rand(5, 5.6), 9, t, end, Math.min(0.35, dur * 0.5), 0.3);
  for (const d of [-5, 5]) {
    const o = osc('sawtooth', hz, t, end, d);
    o.detune.setValueAtTime(d - 28, t);
    o.detune.linearRampToValueAtTime(d, t + 0.07);
    vib.connect(o.detune);
    o.connect(lp);
  }

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.045);
  env.gain.setTargetAtTime(peak * 0.8, t + 0.045, 0.15);
  env.gain.setTargetAtTime(0, t + dur, 0.07);
  lp.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, 0.32);
}

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;
  const dur = ev.dur * beat();
  horn(t, ev.midi, dur, ev.vel, 0.11);
  if (ev.vel > 0.85 && random() < 0.4) {
    for (let m = ev.midi - 3; m >= ev.midi - 4; m--) {
      if (harmony.isChordTone(m, b)) { horn(t, m, dur, ev.vel * 0.8, 0.08); break; }
    }
  }
  return ev.gap;
}

export const brassVoice = createVoice('brass', play, { entry: 4, role: 'lead', onReset: phraser.reset });
