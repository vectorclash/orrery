import { audio, getVoiceBus, noise } from '../context.js';
import { currentScale, rand, pick, register, midiToHz, scaleNotes, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, perc } from '../synth.js';

// Handbell. The old partials (1, 2.756, 5.404, 8.801) are those of an untuned
// bar — a glockenspiel — and the loud 2.756× partial rang a quarter-tone off
// every chord for seconds. Handbells are tuned so the strong partials are
// the fundamental, octave and twelfth (1, 2, 3); only faint, fast-decaying
// upper partials are inharmonic, which keeps the "bell" without the clash.
// A second fundamental a fraction of a hertz away gives the slow warble of a
// real bell's split modes.
const PARTIALS = [ // ratio, level, decay (× note length)
  [1, 1, 1], [2, 0.3, 0.55], [3, 0.35, 0.4], [4.2, 0.1, 0.16], [5.4, 0.06, 0.1],
];

function play(t, b) {
  const wait = pick([2, 3, 4, 4]);
  if (random() < 0.3) return wait;

  const notes = scaleNotes(register(74, 32, 84), currentScale(), 2);
  const midi  = harmony.pickChordTone(notes, b);
  const hz    = midiToHz(midi);
  const dur   = rand(2.5, 5.0);
  logNote('bell', t, midi, dur, 0.7);
  const peak  = rand(0.07, 0.11);
  const bus   = getVoiceBus('bell').dry;
  const out   = gain(1);

  for (const [ratio, level, decay] of PARTIALS) {
    if (hz * ratio > 16000) continue;
    const o = osc('sine', hz * ratio, t, t + dur * decay + 0.05), e = gain(0);
    perc(e.gain, t, peak * level, dur * decay, 0.003);
    o.connect(e); e.connect(out);
  }
  const warble = osc('sine', hz + rand(0.6, 1.4), t, t + dur * 0.9), we = gain(0);
  perc(we.gain, t, peak * 0.45, dur * 0.85, 0.003);
  warble.connect(we); we.connect(out);

  const strike = noise(t, 0.01), sHp = filter('highpass', 5000), sE = gain(0);
  perc(sE.gain, t, peak * 0.3, 0.006, 0.0005);
  strike.connect(sHp); sHp.connect(sE); sE.connect(out);

  out.connect(bus);
  send(out, audio.reverbSend, 0.7);
  send(out, audio.echoSend, 0.1);
  return wait;
}

export const bellVoice = createVoice('bell', play, { role: 'air' });
