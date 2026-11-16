import { audio, getVoiceBus } from '../context.js';
import { state, rand, lerp, clamp, midiToHz } from '../../state.js';
import { osc, gain, filter, send, perc, chorus } from '../synth.js';
import { createKeys } from './keys.js';

// FM electric piano: the digital one of the 1980s, on every city pop record and most
// ballads of the decade. Where the tine piano (rhodes.js) is warm and barks, this is
// glass: two pairs of FM operators, as the patch that made it famous has them. One
// pair is the body, a carrier with a modulator at its own pitch whose depth falls
// quickly, a bright strike over a pure, bell-like sustain. The other is the tine, a
// modulator fourteen times higher that rings for a moment on the attack. Each pair
// sits a few cents either side of the note, so every note shimmers against itself,
// and the whole thing goes through a chorus, as it always did on record. Harder
// playing opens both modulators, so it gets brighter rather than just louder.
const LEVEL = 0.72;

function note(t, midi, seconds, vel, out) {
  const hz = midiToHz(midi), end = t + seconds + 0.8;
  const bright = lerp(0.7, 1.25, state.brightness);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vel, t + 0.002);
  env.gain.setTargetAtTime(vel * 0.2, t + 0.002, 0.7 + 1.2 * Math.sqrt(220 / hz));
  env.gain.setTargetAtTime(0, t + seconds, 0.12);
  for (const [cents, ratio, depth, fall, level] of [[-3.5, 1, 1.5, 0.28, 1], [3.5, 14, 0.55, 0.06, 0.55]]) {
    const car = osc('sine', hz, t, end, cents);
    const mod = osc('sine', hz * ratio, t, end, cents), amt = gain(0);
    const index = hz * depth * vel * vel * bright * clamp(660 / hz, 0.35, 1.4);
    amt.gain.setValueAtTime(index, t);
    amt.gain.setTargetAtTime(index * (ratio === 1 ? 0.18 : 0), t, fall);
    mod.connect(amt); amt.connect(car.frequency);
    const g = gain(level);
    car.connect(g); g.connect(env);
  }
  env.connect(out);
}

function chord(t, notes, seconds, vel) {
  const end = t + seconds + 1;
  const sum = gain(0.05 * LEVEL * 4 / Math.max(3, notes.length));
  for (const m of notes) note(t + rand(0, 0.01), m, seconds * 0.96, vel * rand(0.88, 1), sum);
  const top = filter('lowpass', 9000, 0.5), ch = chorus(t, end);
  sum.connect(top); top.connect(ch.input);
  ch.output.connect(getVoiceBus('epiano').dry);
  send(ch.output, audio.reverbSend, 0.38);
}

export const epianoVoice = createKeys('epiano', { chord, centre: 64, full: false, fallback: 'citypop' });
