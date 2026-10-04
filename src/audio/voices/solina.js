import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, ahr, ensemble, phaser } from '../synth.js';

// String machine (ARP Solina String Ensemble): one plain saw per note at 8′
// and a quieter one at 4′ — divide-down organ circuitry, no detuning — slow
// to swell and slow to fade, through the ensemble, which is the whole sound:
// three swept delay lines that turn one oscillator into a section. Some
// sessions add a phaser after it, the way Jarre ran his string machine
// through a Small Stone. Chord-synchronous and voice-led like the pad.
let prev = null;
let phased = false;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.pcs(seg.degree, seg.seventh ? 4 : 3);
  const v    = harmony.voice(pcs, prev, register(64, 28, 83));
  prev = v;
  for (const m of v) logNote('solina', t, m, dur, 0.6);

  const bus    = getVoiceBus('solina').dry;
  const peak   = rand(0.07, 0.079) * 3 / v.length;
  const attack = Math.min(0.9, dur * 0.35);
  const end    = t + dur + 1.6;

  const lp = filter('lowpass', lerp(1800, 6000, state.brightness), 0.6);
  const octave = gain(0.45);
  for (const midi of v) {
    const hz = midiToHz(midi);
    osc('sawtooth', hz, t, end).connect(lp);
    osc('sawtooth', hz * 2, t, end).connect(octave);
  }
  octave.connect(lp);

  const env = gain(0), ens = ensemble(t, end);
  ahr(env.gain, t, peak, attack, dur, 1.4);
  lp.connect(env); env.connect(ens.input);
  let out = ens.output;
  if (phased) {
    const ph = phaser(t, end);
    out.connect(ph.input);
    out = ph.output;
  }
  out.connect(bus);
  send(out, audio.reverbSend, lerp(0.3, 0.85, state.spaciousness));
  return len;
}

export const solinaVoice = createVoice('solina', play, {
  role: 'bed',
  onReset: () => { prev = null; phased = Math.random() < 0.4; },
});
