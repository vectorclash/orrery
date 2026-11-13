import { getVoiceBus, noise } from '../context.js';
import { state, beat, lerp, register, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { harmony } from '../harmony.js';
import { gain, filter, pluckBuffer, playBuffer } from '../synth.js';

// Clavinet: a string struck by a tangent and damped the moment the key lifts.
// Modelled as a very bright Karplus–Strong string struck near the bridge
// (twangy, nasal), cut short by a fast damper release, through a resonant
// lowpass that snaps shut — the "quack" of funk clav. Plays repeating riffs
// with occasional double-stops, like the right hand on "Superstition".
// It's an electric instrument, heard as the guitar is (see guitar.js): through
// a pickup near the strings' end, the comb that makes it thin and nasal rather
// than a bare string's toy tone, with both polarisations for a real string's
// decay; and when the key lifts, the yarn damper lands on the string with a
// soft thud.
const POL = { cents: 0.5, t60: 0.5, mix: 0.25 };
const CLAV_TRIM = 0.81; // level-matched to the bare string it was
const phraser = createPhraser({ name: 'clavinet', base: () => register(54, 28, 71), style: 'active', ostinato: true, repeat: 0.85 });

function strike(t, midi, gate, vel) {
  logNote('clavinet', t, midi, gate, vel);
  const src = playBuffer(pluckBuffer(midi, { t60: 1.1, bright: 1, pick: 0.06, stretch: 0.2, length: gate + 0.1, pickup: 0.11, pol: POL }), t, t + gate + 0.1);
  const lp = filter('lowpass', 800, 5);
  lp.frequency.setValueAtTime(lerp(2400, 5200, state.brightness), t);
  lp.frequency.exponentialRampToValueAtTime(900, t + 0.13);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.5 * vel * lerp(0.6, 1, state.density) * CLAV_TRIM, t + 0.002);
  env.gain.setTargetAtTime(0, t + gate, 0.012);
  src.connect(lp); lp.connect(env); env.connect(getVoiceBus('clavinet').dry);
  // The damper: a fixed place in the noise, so it takes no draw from the voice's stream.
  const thud = noise(t + gate, 0.03, (midi * 0.137) % 1), thLp = filter('lowpass', 700), thE = gain(0);
  thE.gain.setValueAtTime(0, t + gate);
  thE.gain.linearRampToValueAtTime(0.06 * vel * lerp(0.6, 1, state.density) * CLAV_TRIM, t + gate + 0.002);
  thE.gain.setTargetAtTime(0, t + gate + 0.003, 0.01);
  thud.connect(thLp); thLp.connect(thE); thE.connect(getVoiceBus('clavinet').dry);
}

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;
  const gate = Math.min(ev.dur * beat() * 0.55, 0.28);
  strike(t, ev.midi, gate, ev.vel);
  if (random() < 0.25) {
    for (let m = ev.midi + 3; m <= ev.midi + 5; m++) {
      if (harmony.isChordTone(m, b)) { strike(t, m, gate, ev.vel * 0.85); break; }
    }
  }
  return ev.gap;
}

export const clavinetVoice = createVoice('clavinet', play, { entry: 'bar', role: 'motion', onReset: phraser.reset });
