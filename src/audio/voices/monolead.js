import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { osc, gain, filter, send, lfo, chorus } from '../synth.js';

// Monophonic synth lead, the synthwave topline: a saw and a square a few
// cents apart through a resonant lowpass with its own envelope. It is mono,
// so a new note cuts the one still sounding, and when the line is legato
// the pitch glides from the old note to the new one (portamento) instead of
// jumping. Delayed vibrato, Juno-style chorus, and plenty of echo.
const phraser = createPhraser({ name: 'monolead', base: () => register(64, 28, 84), lead: true });
const GLIDE = 0.07; // seconds, at most a quarter of the note so fast runs stay clean

let last = null; // { env, hz, until } — the note still sounding

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;

  const bus  = getVoiceBus('monolead').dry;
  const hz   = midiToHz(ev.midi);
  const dur  = ev.dur * beat();
  const peak = 0.082 * ev.vel * lerp(0.6, 1.0, state.density);
  const end  = t + dur + 0.4;
  logNote('monolead', t, ev.midi, dur, ev.vel);

  // Legato: cut the previous note here and slide up or down from its pitch.
  const from = last && t < last.until ? last.hz : hz;
  if (last && t < last.until) {
    last.env.gain.cancelScheduledValues(t);
    last.env.gain.setTargetAtTime(0, t, 0.012);
  }

  const lp  = filter('lowpass', hz * 2, 3);
  const top = hz * lerp(5, 12, state.brightness) * (0.7 + 0.3 * ev.vel);
  lp.frequency.setValueAtTime(Math.min(top, 16000), t);
  lp.frequency.setTargetAtTime(Math.min(hz * lerp(2.5, 5, state.brightness), 12000), t + 0.01, 0.12);

  const vib = lfo(rand(5.2, 5.8), 14, t, end, Math.min(0.35, dur * 0.5), 0.3); // cents
  for (const [type, cents, level] of [['sawtooth', -4, 1], ['square', 4, 0.5]]) {
    const o = osc(type, from, t, end, cents);
    if (from !== hz) {
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(hz, t + Math.min(GLIDE, dur * 0.25));
    }
    vib.connect(o.detune);
    const g = gain(level);
    o.connect(g); g.connect(lp);
  }

  const env = gain(0), ch = chorus(t, end);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.008);
  env.gain.setTargetAtTime(peak * 0.8, t + 0.008, 0.15);
  env.gain.setTargetAtTime(0, t + dur, 0.06);
  lp.connect(env); env.connect(ch.input);
  ch.output.connect(bus);
  send(ch.output, audio.reverbSend, 0.35);
  send(ch.output, audio.echoSend, 0.3);
  last = { env, hz, until: t + dur + 0.15 };
  return ev.gap;
}

export const monoleadVoice = createVoice('monolead', play, {
  entry: 4, role: 'lead',
  onReset: () => { last = null; phraser.reset(); },
});
