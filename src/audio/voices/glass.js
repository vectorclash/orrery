import { audio, getVoiceBus } from '../context.js';
import { currentScale, rand, pick, register, midiToHz, scaleNotes, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, send } from '../synth.js';

// Glass harmonica: a rubbed glass rim. An almost pure tone that swells in
// slowly, with a second partial a hertz or two away — the audible beating
// that gives rubbed glass its shimmer — and faint upper harmonics. (The old
// "FM" version used a modulation index of 0.012, i.e. a plain sine.)
function play(t, b) {
  const wait = pick([2, 3, 4, 5]);
  if (random() < 0.35) return wait;

  const notes = scaleNotes(register(72, 30, 86), currentScale(), 2);
  const midi  = harmony.pickChordTone(notes, b);
  const hz    = midiToHz(midi);
  const dur   = rand(3.0, 7.0);
  logNote('glass', t, midi, dur, 0.7);
  const peak  = rand(0.11, 0.16);
  const bus   = getVoiceBus('glass').dry;

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + rand(0.35, 0.6));
  env.gain.exponentialRampToValueAtTime(peak * 1e-3, t + dur);
  for (const [f, level] of [[hz, 0.62], [hz + rand(1, 2.2), 0.38], [hz * 2, 0.07], [hz * 3, 0.025]]) {
    const o = osc('sine', f, t, t + dur + 0.05), g = gain(level);
    o.connect(g); g.connect(env);
  }
  env.connect(bus);
  send(env, audio.reverbSend, 0.95);
  return wait;
}

export const glassVoice = createVoice('glass', play, { role: 'air' });
