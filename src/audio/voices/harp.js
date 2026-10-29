import { audio, getVoiceBus } from '../context.js';
import { beat, rand, pick, clamp, register, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { gain, send, pluckBuffer, playBuffer } from '../synth.js';

// Harp: a real plucked-string model (Karplus–Strong) with a soft, finger-like
// excitation plucked mid-string for the round harp tone. Each chord change is
// marked by a rolled chord sweeping up (or down) through the new harmony;
// between changes, occasional single chord tones keep the texture alive.
function string(t, midi, vel) {
  const hz  = midiToHz(midi);
  const t60 = clamp(3.4 * Math.pow(200 / hz, 0.4), 1.0, 4.2);
  logNote('harp', t, midi, Math.min(t60, 3.2), vel);
  const src = playBuffer(pluckBuffer(midi, { t60, bright: 0.28 + 0.2 * vel, pick: 0.42, stretch: 0.5, length: Math.min(t60, 3.2) }), t, t + 3.2);
  const g = gain(0.22 * vel);
  src.connect(g);
  g.connect(getVoiceBus('harp').dry);
  send(g, audio.reverbSend, 0.6);
}

function play(t, b) {
  const seg  = harmony.at(b);
  const base = register(50, 28, 67);
  if (Math.abs(b - seg.start) < 1e-6) {
    const notes = harmony.stack(b, base, 5 + Math.floor(random() * 3));
    if (random() < 0.35) notes.reverse();
    const step = Math.min(0.085, beat() * 0.16);
    notes.forEach((m, i) => string(t + i * step, m, rand(0.75, 0.95) - i * 0.03));
  } else if (random() < 0.4) {
    string(t, pick(harmony.stack(b, base + 12, 4)), rand(0.55, 0.75));
  }
  return 1;
}

export const harpVoice = createVoice('harp', play, { role: 'motion' });
