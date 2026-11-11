import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { osc, gain, filter, send, lfo, wander } from '../synth.js';

// Soft synth lead: a triangle with a quiet octave partial and delayed vibrato,
// and under it a saw through a lowpass that opens with the note and settles --
// the edge a played note has at its start, more of it the harder it's played.
// Alone, the triangle was the same beep at every pitch and strength. The pitch
// wanders a few cents (see wander), and a note that follows straight on from the
// last slides into its pitch, as a player's would.
// One consistent timbre (it used to flip between sine and triangle per note).
const GLIDE = 0.05; // seconds
const LEVEL = 0.945;    // matched to the old voice's loudness
let last = null;    // { hz, until }: the note before, while a new one would still be legato
const phraser = createPhraser({ name: 'melody', base: () => register(64, 28, 81), lead: true });

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;

  const bus  = getVoiceBus('melody').dry;
  const hz   = midiToHz(ev.midi);
  const dur  = ev.dur * beat();
  const peak = 0.15 * ev.vel * lerp(0.6, 1.0, state.density) * LEVEL;
  const end  = t + dur + 0.5;
  logNote('melody', t, ev.midi, dur, ev.vel);

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.025);
  env.gain.setTargetAtTime(peak * 0.72, t + 0.025, 0.3);
  env.gain.setTargetAtTime(0, t + dur, 0.07);

  const from = last && t < last.until ? last.hz : hz;
  last = { hz, until: t + dur + 0.03 };
  const main = osc('triangle', from, t, end, rand(-3, 3));
  const oct  = osc('sine', from * 2, t, end);
  const octG = gain(0.16);
  const vib  = lfo(rand(4.8, 5.6), 11, t, end, Math.min(0.3, dur * 0.5), 0.35); // cents
  const edge = osc('sawtooth', from, t, end, 4), edgeG = gain(0.3);
  const lp = filter('lowpass', hz * 2, 0.9);
  lp.frequency.setValueAtTime(Math.min(12000, hz * (2.2 + 5 * ev.vel * lerp(0.4, 1, state.brightness))), t);
  lp.frequency.setTargetAtTime(hz * 2, t + 0.02, 0.2);
  const drift = wander(t, end, 4, ev.midi);
  for (const [o, mult] of [[main, 1], [oct, 2], [edge, 1]]) {
    vib.connect(o.detune); drift.connect(o.detune);
    if (from !== hz) {
      o.frequency.setValueAtTime(from * mult, t);
      o.frequency.exponentialRampToValueAtTime(hz * mult, t + Math.min(GLIDE, dur * 0.25));
    }
  }

  main.connect(env); oct.connect(octG); octG.connect(env);
  edge.connect(lp); lp.connect(edgeG); edgeG.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, 0.5);
  send(env, audio.echoSend, 0.12);
  return ev.gap;
}

export const melodyVoice = createVoice('melody', play, { entry: 4, role: 'lead', onReset: () => { last = null; phraser.reset(); } });
