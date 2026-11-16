import { audio, getVoiceBus, noise } from '../context.js';
import { state, rand, lerp, clamp } from '../../state.js';
import { gain, filter, send, perc, pluckBuffer, playBuffer, desk } from '../synth.js';
import { createKeys } from './keys.js';

// Acoustic piano: the piano of gospel, house, soul and bossa nova. Each note is the
// string model (see pluckBuffer) struck rather than plucked: a felt hammer an eighth
// of the way along the string, soft and round when played quietly and brighter the
// harder it lands (a hammer's felt stiffens as it compresses, which is most of what
// makes a loud piano note a different sound from a quiet one, not just a louder one);
// two strings to a note a cent or so apart, whose sum has a piano's two-stage decay,
// a quick fall and a long singing tail; highs that die in a second while the
// fundamental rings for several; and a soundboard (BODIES.piano) in place of a
// guitar's body. Low notes ring longer than high ones. The dampers fall when the
// keys lift, with the felt's soft thud. Laid out across the stereo field as the
// player hears it, low on the left.
const LEVEL = 0.54;
const PEAK = 2.2; // how far above its level a note's attack may reach (see desk)

function note(t, midi, seconds, vel, out) {
  const t60 = clamp(9 * Math.pow(2, (48 - midi) / 18), 1.5, 9);
  const ring = Math.min(seconds + 0.25, 4.5);
  const src = playBuffer(pluckBuffer(midi, {
    t60, bright: 0.5 + 0.3 * vel, pick: 0.12, length: ring, body: 'piano',
    damp: { hz: 2200 + 2600 * vel * lerp(0.7, 1.15, state.brightness), t60: clamp(t60 * 0.16, 0.3, 1.1) },
    pol: { cents: 1.6, t60: 0.35, mix: 0.4 }, soft: 5 + 11 * vel,
  }), t, t + ring);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vel, t + 0.003);
  env.gain.setTargetAtTime(0, t + seconds, 0.07); // the damper
  const place = audio.ctx.createStereoPanner();
  place.pan.value = clamp((midi - 60) / 40, -0.45, 0.45);
  src.connect(env); env.connect(place); place.connect(out);
  // The hammer's knock on the way in, the damper's felt on the way out. Fixed places in
  // the noise, so neither takes a draw from the voice's stream.
  const knock = noise(t, 0.03, (midi * 0.0731) % 1), kLp = filter('lowpass', 500 + 1500 * vel), kE = gain(0);
  perc(kE.gain, t, vel * 0.12, 0.02, 0.001);
  knock.connect(kLp); kLp.connect(kE); kE.connect(place);
  const thud = noise(t + seconds, 0.04, (midi * 0.0137) % 1), tLp = filter('lowpass', 500), tE = gain(0);
  perc(tE.gain, t + seconds, vel * 0.03, 0.03, 0.002);
  thud.connect(tLp); tLp.connect(tE); tE.connect(place);
}

function chord(t, notes, seconds, vel) {
  const level = 0.2 * LEVEL * 4 / Math.max(3, notes.length);
  const sum = gain(level), d = desk(level * PEAK, 1.05);
  // Rolled a few milliseconds, bottom to top, the top note a little louder: the tune's.
  notes.forEach((m, i) => note(t + i * rand(0.004, 0.011), m, seconds * 0.97, vel * (i === notes.length - 1 ? 1 : rand(0.82, 0.95)), sum));
  sum.connect(d.input);
  d.output.connect(getVoiceBus('piano').dry);
  send(d.output, audio.reverbSend, 0.3);
}

// A piano's own comping where it has one: the house piano riff, above all.
const COMPS = { HOUSE: 'piano_house', 'DEEP HOUSE': 'piano_house', 'UK GARAGE': 'piano_house', TRANCE: 'piano_house', EDM: 'piano_house' };

export const pianoVoice = createKeys('piano', { chord, centre: 62, compsFor: COMPS, fallback: 'soul' });
