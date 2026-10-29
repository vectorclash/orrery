import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, register, fold, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { osc, gain, filter, send, shaper, pluckBuffer, playBuffer } from '../synth.js';

// Sitar: a bright plucked string (Karplus–Strong, plucked near the bridge),
// through a gently asymmetric waveshaper and a presence band — the buzzing
// "jawari" bridge that makes the sitar's tone bloom with upper harmonics.
// Meend: when the previous note is close, the new note is plucked at the old
// pitch and pulled to the new one, as a sitarist bends the string sideways.
// Sympathetic (tarab) strings ring quietly when the played note matches them.
const phraser = createPhraser({ name: 'sitar', base: () => register(54, 28, 71), lead: true });
let prev = null;

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;

  const bus  = getVoiceBus('sitar').dry;
  const midi = ev.midi;
  const dur  = ev.dur * beat();
  const ring = Math.min(3, dur + 1.6);
  const peak = 0.6 * ev.vel;
  logNote('sitar', t, midi, dur, ev.vel);

  const src = playBuffer(pluckBuffer(midi, { t60: 2.8, bright: 0.85, pick: 0.07, stretch: 0.35, length: ring }), t, t + ring);
  if (prev !== null && prev !== midi && Math.abs(prev - midi) <= 4 && random() < 0.55) {
    src.detune.setValueAtTime((prev - midi) * 100, t);
    src.detune.setValueAtTime((prev - midi) * 100, t + 0.04);
    src.detune.linearRampToValueAtTime(0, t + rand(0.12, 0.2));
  }
  prev = midi;

  const env = gain(peak);
  src.connect(env);
  const buzz = shaper(3, 0.2), band = filter('bandpass', 2800, 0.9), buzzG = gain(0.32);
  src.connect(buzz); buzz.connect(band); band.connect(buzzG); buzzG.connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, 0.25);

  // Tarab strings tuned to the tonic and the scale: the played pitch class
  // excites its sympathetic string an octave up, along with the tonic.
  const tonic = fold(state.rootMidi, 60, 71);
  for (const m of new Set([fold(midi, 60, 71), tonic])) {
    const s  = osc('sine', midiToHz(m), t, t + ring + 1.2);
    const se = gain(0);
    se.gain.setValueAtTime(0, t);
    se.gain.linearRampToValueAtTime(peak * 0.06, t + 0.12);
    se.gain.exponentialRampToValueAtTime(peak * 6e-5, t + ring + 1.1);
    s.connect(se); se.connect(bus);
    send(se, audio.reverbSend, 0.4);
  }
  return ev.gap;
}

export const sitarVoice = createVoice('sitar', play, { entry: 4, role: 'lead', onReset: () => { phraser.reset(); prev = null; } });
