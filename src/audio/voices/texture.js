import { audio, getVoiceBus } from '../context.js';
import { currentScale, rand, pick, register, midiToHz, scaleNotes, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, send } from '../synth.js';

// Sparse, high shimmer: a chord tone as two slightly detuned sines (slow
// beating) with a quiet octave, drowned in reverb and a touch of echo.
function play(t, b) {
  const wait = pick([1, 2, 3, 4]);
  if (random() < 0.4) return wait;

  const notes = scaleNotes(register(68, 28, 86), currentScale(), 2);
  const midi  = harmony.pickChordTone(notes, b);
  const hz    = midiToHz(midi);
  const dur   = rand(1.5, 4.0);
  logNote('texture', t, midi, dur, 0.7);
  const peak  = rand(0.1, 0.18);
  const bus   = getVoiceBus('texture').dry;

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.15);
  env.gain.exponentialRampToValueAtTime(peak * 1e-3, t + dur);
  for (const [f, level] of [[hz, 0.5], [hz * 1.0017, 0.4], [hz * 2, 0.1]]) {
    const o = osc('sine', f, t, t + dur + 0.05), g = gain(level);
    o.connect(g); g.connect(env);
  }
  env.connect(bus);
  send(env, audio.reverbSend, 0.9);
  send(env, audio.echoSend, 0.15);
  return wait;
}

export const textureVoice = createVoice('texture', play, { role: 'air' });
