import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, pick, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, ahr, chorus } from '../synth.js';

// Roland Juno-60 pad. One digitally controlled oscillator per note — a saw
// plus a square sub-oscillator an octave down — so there's no detuning
// between oscillators at all: the width comes entirely from the chorus,
// which is what the Juno sounds like. A 24 dB/oct lowpass (two cascaded
// stages, like the IR3109) whose envelope opens with the amp's.
// Chorus mode I or II per session. Chord-synchronous and voice-led like the pad.
let prev = null;
let mode = 1;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.pcs(seg.degree, seg.seventh ? 4 : 3);
  const v    = harmony.voice(pcs, prev, register(64, 28, 81));
  prev = v;
  for (const m of v) logNote('juno', t, m, dur, 0.6);

  const bus    = getVoiceBus('juno').dry;
  const peak   = rand(0.072, 0.084) * 3 / v.length;
  const attack = Math.min(0.45, dur * 0.3);
  const end    = t + dur + 1.0;

  const cutoff = lerp(900, 5000, state.brightness);
  const lp1 = filter('lowpass', cutoff, 0.55), lp2 = filter('lowpass', cutoff, 0.9);
  for (const lp of [lp1, lp2]) {
    lp.frequency.setValueAtTime(cutoff * 0.3, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + attack + 0.2);
  }
  const sub = gain(0.35);
  for (const midi of v) {
    const hz = midiToHz(midi);
    osc('sawtooth', hz, t, end).connect(lp1);
    osc('square', hz / 2, t, end).connect(sub);
  }
  sub.connect(lp1);
  lp1.connect(lp2);

  const env = gain(0), ch = chorus(t, end, mode);
  ahr(env.gain, t, peak, attack, dur, 0.9);
  lp2.connect(env); env.connect(ch.input);
  ch.output.connect(bus);
  send(ch.output, audio.reverbSend, lerp(0.2, 0.7, state.spaciousness));
  return len;
}

export const junoVoice = createVoice('juno', play, {
  role: 'bed',
  onReset: () => { prev = null; mode = pick([1, 2]); },
});
