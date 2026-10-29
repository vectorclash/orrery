import { audio, getVoiceBus, noise } from '../context.js';
import { rand, register, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, perc } from '../synth.js';

// Kalimba / mbira: music built from repeating, interlocking ostinato figures,
// so it uses the phrase generator in riff mode (a figure repeated bar after
// bar, re-anchored to each chord). The tine is a near-sine with a brief
// inharmonic overtone (clamped metal tines sit around 6× the fundamental), a
// woody thump from the box, and sometimes a second thumb a third below.
const phraser = createPhraser({ name: 'kalimba', base: () => register(65, 28, 80), style: 'active', ostinato: true, repeat: 0.85 });

function tine(t, midi, vel) {
  const bus  = getVoiceBus('kalimba').dry;
  const hz   = midiToHz(midi);
  const peak = 0.14 * vel;
  const decay = rand(0.9, 1.4);
  logNote('kalimba', t, midi, decay, vel);
  const o = osc('sine', hz, t, t + decay + 0.05), e = gain(0);
  perc(e.gain, t, peak, decay);
  const o2 = osc('sine', hz * 6.1, t, t + 0.12), e2 = gain(0);
  perc(e2.gain, t, peak * 0.14, 0.08);
  const th = noise(t, 0.03), thLp = filter('lowpass', 700), thE = gain(0);
  perc(thE.gain, t, peak * 0.45, 0.018, 0.001);
  o.connect(e); o2.connect(e2); th.connect(thLp); thLp.connect(thE);
  for (const n of [e, e2, thE]) n.connect(bus);
  send(e, audio.reverbSend, 0.42);
  send(e, audio.echoSend, 0.12);
}

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;
  tine(t, ev.midi, ev.vel);
  if (random() < 0.25) {
    for (let m = ev.midi - 3; m >= ev.midi - 4; m--) {
      if (harmony.isChordTone(m, b)) { tine(t + 0.03, m, ev.vel * 0.8); break; }
    }
  }
  return ev.gap;
}

export const kalimbaVoice = createVoice('kalimba', play, { entry: 4, role: 'motion', onReset: phraser.reset });
