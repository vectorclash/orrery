import { audio, getVoiceBus, noise } from '../context.js';
import { clamp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { osc, gain, filter, send, perc } from '../synth.js';

// Marimba: rosewood bars tuned so the first overtone is two octaves up (4×)
// and the next near 10× — the old version used 1:2:4, an octave that a
// marimba bar doesn't have. Low bars ring longer than high ones, and a soft
// yarn-mallet thump sits under the attack. Plays ostinato figures.
// A harder stroke is a brighter one: the overtones and the mallet's knock grow
// with it, where they were a fixed share of every note. And the bars are laid
// out across the instrument, low on the left, so the notes are too.
const LEVEL = 0.77; // matched to the old voice's loudness
const phraser = createPhraser({ name: 'mallet', base: () => register(54, 28, 71), style: 'active', ostinato: true, repeat: 0.8 });

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;

  const bus   = getVoiceBus('mallet').dry;
  const hz    = midiToHz(ev.midi);
  const peak  = 0.32 * ev.vel * LEVEL;
  const hard  = clamp((ev.vel - 0.5) * 2, 0, 1);
  const decay = clamp(0.4 * Math.pow(400 / hz, 0.6), 0.18, 1.4);
  logNote('mallet', t, ev.midi, decay, ev.vel);

  const out = gain(1);
  for (const [ratio, level, d] of [[1, 1, 1], [3.93, 0.2, 0.22], [9.4, 0.05, 0.07]]) {
    if (hz * ratio > 16000) continue;
    const o = osc('sine', hz * ratio, t, t + decay + 0.05), e = gain(0);
    perc(e.gain, t, peak * level * (ratio === 1 ? 1 : 0.55 + 0.9 * hard), decay * d);
    o.connect(e); e.connect(out);
  }
  const th = noise(t, 0.02), thLp = filter('lowpass', 800 + 900 * hard), thE = gain(0);
  perc(thE.gain, t, peak * 0.3, 0.012, 0.001);
  th.connect(thLp); thLp.connect(thE); thE.connect(out);

  const place = audio.ctx.createStereoPanner();
  place.pan.value = clamp((ev.midi - 62) / 30, -0.4, 0.4);
  out.connect(place); place.connect(bus);
  send(out, audio.reverbSend, 0.4);
  return ev.gap;
}

export const malletVoice = createVoice('mallet', play, { entry: 4, role: 'motion', onReset: phraser.reset });
