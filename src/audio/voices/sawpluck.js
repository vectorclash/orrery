import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, pick, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send } from '../synth.js';

// Saw pluck: the bright, short lead of trance and EDM. Three detuned saws
// through a lowpass that snaps shut in a fraction of a second, so each note is
// a pluck rather than a tone, and plenty of the tempo echo, which fills the
// gaps between notes. It plays chord tones in a gated sixteenth-note rhythm:
// the gate says which steps sound, the walk says which chord tone, and both
// hold for a phrase, so the figure repeats like a hook instead of wandering.
const GATES = [
  'x.xx.xx.x.xx.xx.', // the trance gallop
  'x..x..x.x..x..x.', // three-three-two
  'x.x.xx.xx.x.xx.x',
  'x...x.x...x.x.x.',
];
// Index into the chord's tones (0 = root, 4 = root an octave up).
const WALKS = [
  [0, 2, 4, 2, 1, 2, 4, 3],
  [4, 3, 2, 0, 2, 3, 4, 2],
  [0, 4, 2, 4, 1, 4, 2, 4],
  [2, 1, 0, 1, 2, 3, 4, 3],
];

let gate = null; // chosen on the first note, see onReset
let walk = null;
let phrase = -1;

function chordTones(b) {
  const base = register(68, 40, 80);
  const four = harmony.stack(b, base, 4);
  return [...four, four[0] + 12];
}

function play(t, b) {
  const p = Math.floor(b / 16);
  if (p !== phrase) {
    phrase = p;
    if (!gate || Math.random() < 0.4) gate = pick(GATES);
    if (!walk || Math.random() < 0.4) walk = pick(WALKS);
  }
  const step = Math.round((b - Math.floor(b / 4) * 4) * 4) % 16;
  if (gate[step] !== 'x') return 0.25;

  const notes = chordTones(b);
  const hit = gate.slice(0, step + 1).split('x').length - 2; // which sounding step this is
  const midi = notes[walk[hit % walk.length]];
  const hz = midiToHz(midi);
  const accent = step % 4 === 0 ? 1 : 0.82;
  const len = beat() * 0.25 * 0.9;
  logNote('sawpluck', t, midi, len, accent);

  const bus = getVoiceBus('sawpluck').dry;
  const peak = 0.1 * accent; // level-matched to the motion voices
  const end = t + 0.45;
  const top = lerp(2500, 9000, state.brightness);
  const lp = filter('lowpass', top, 1.6);
  lp.frequency.setValueAtTime(top * accent, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(hz * 1.2, 350), t + 0.18);
  for (const d of [-11, 0, 11]) osc('sawtooth', hz, t - rand(0, 1 / hz), end, d).connect(lp);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.002);
  env.gain.setTargetAtTime(0, t + 0.002, 0.09);
  lp.connect(env); env.connect(bus);
  send(env, audio.echoSend, 0.45);
  send(env, audio.reverbSend, lerp(0.2, 0.55, state.spaciousness));
  return 0.25;
}

// Draws nothing on reset -- every voice is reset at the start of a session, playing or not,
// and a draw here would shift the shared random sequence under the voices that are playing.
export const sawpluckVoice = createVoice('sawpluck', play, {
  role: 'motion',
  onReset: () => { phrase = -1; gate = null; walk = null; },
});
