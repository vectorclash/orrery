import { audio, getVoiceBus, noise } from '../context.js';
import { beat, rand, pick, register, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, perc } from '../synth.js';

// Hammond-style tonewheel organ. Drawbars are pitched in organ footages —
// 16′ 5⅓′ 8′ 4′ 2⅔′ 2′ 1⅗′ 1⅓′ 1′ = 0.5, 1.5, 1, 2, 3, 4, 5, 6, 8 × the note —
// not a plain harmonic series, and each drawbar step is ~3 dB. A registration
// is chosen per session from classic settings. The Leslie speaker is one
// rotor for the whole chord (amplitude *and* Doppler pitch wobble), and the
// "percussion" (a decaying 2⅔′ on the attack) plus key click give the bite.
const FOOTAGE = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
const REGISTRATIONS = [
  { bars: [8, 8, 8, 0, 0, 0, 0, 0, 0], perc: true  }, // jazz
  { bars: [8, 0, 8, 0, 0, 0, 0, 0, 0], perc: false }, // mellow
  { bars: [8, 8, 6, 0, 0, 0, 0, 0, 0], perc: true  }, // Booker T.
  { bars: [6, 8, 8, 6, 0, 0, 0, 0, 0], perc: false }, // gospel
  { bars: [0, 0, 8, 8, 0, 0, 0, 0, 0], perc: false }, // soft flutes
];
const drawbar = level => (level ? Math.pow(10, (level - 8) * 3 / 20) : 0);
let reg  = REGISTRATIONS[0];
let prev = null;

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.pcs(seg.degree, seg.seventh ? 4 : 3);
  const v    = harmony.voice(pcs, prev, register(60, 28, 80));
  prev = v;
  for (const m of v) logNote('organ', t, m, dur, 0.6);

  const bus  = getVoiceBus('organ').dry;
  const end  = t + dur + 0.1;
  const peak = 0.045 * 3 / v.length;

  // One Leslie for the chord: fast (tremolo) or slow (chorale) this time.
  const fast  = random() < 0.3;
  const rate  = fast ? rand(6.2, 6.9) : rand(0.7, 0.9);
  const rotor = osc('sine', rate, t, end);
  const am = gain(fast ? 0.12 : 0.05), fm = gain(fast ? 7 : 3);
  rotor.connect(am); rotor.connect(fm);
  const leslie = gain(1);
  am.connect(leslie.gain);

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.008);
  env.gain.setValueAtTime(1, t + dur - 0.04);
  env.gain.linearRampToValueAtTime(0, t + dur);

  for (const midi of v) {
    const hz = midiToHz(midi);
    reg.bars.forEach((level, i) => {
      if (!level || hz * FOOTAGE[i] > 8000) return;
      const o = osc('sine', hz * FOOTAGE[i], t, end);
      fm.connect(o.detune);
      const g = gain(peak * drawbar(level));
      o.connect(g); g.connect(env);
    });
    if (reg.perc) {
      const p = osc('sine', hz * 3, t, t + 0.4), pe = gain(0);
      perc(pe.gain, t, peak * 0.7, 0.28, 0.001);
      p.connect(pe); pe.connect(leslie);
    }
  }
  // Key click: the contacts closing.
  const click = noise(t, 0.012), clickLp = filter('lowpass', 2800), clickE = gain(0);
  perc(clickE.gain, t, peak * 0.4, 0.008, 0.0005);
  click.connect(clickLp); clickLp.connect(clickE); clickE.connect(bus);

  env.connect(leslie);
  leslie.connect(bus);
  send(leslie, audio.reverbSend, 0.2);
  return len;
}

export const organVoice = createVoice('organ', play, {
  role: 'bed',
  onReset: () => { prev = null; reg = pick(REGISTRATIONS); },
});
