import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, pick, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send } from '../synth.js';

// House chord stab: a short, plucky minor-seventh chord on the off-beats and
// syncopations -- the organ/M1 stab of deep house and garage. Every stab is
// the chord's four tones (root, third, fifth, seventh), voice-led like the
// pads so the hand barely moves between chords. Each note is a pair of saws
// a few cents apart plus a square an octave down for body, through a lowpass
// whose envelope snaps shut with the amp: bright on the hit, dark on the tail.
// Into the tempo echo, which is what makes a stab sound like a record.
//
// Sixteen steps a bar; '.' rests. A pattern holds for a phrase (four bars),
// and a new phrase sometimes picks another.
const PATTERNS = [
  '..x...x...x...x.', // straight off-beats
  '...x..x....x..x.', // deep house syncopation
  '..x..x....x..x..', // push-pull
  'x.....x...x...x.', // on the one, then off-beats
  '...x...x..x...x.', // garage skip
];

let pattern = null; // chosen on the first stab, see onReset
let phrase = -1;
let prev = null;

function play(t, b) {
  const p = Math.floor(b / 16);
  if (p !== phrase) {
    phrase = p;
    if (!pattern || Math.random() < 0.35) pattern = pick(PATTERNS);
  }
  const step = Math.round((b - Math.floor(b / 4) * 4) * 4) % 16;
  if (pattern[step] === '.') return 0.25;

  const seg = harmony.at(b);
  const pcs = harmony.pcs(seg.degree, 4);
  const v   = harmony.voice(pcs, prev, register(62, 28, 79));
  prev = v;

  const bus   = getVoiceBus('stab').dry;
  const len   = beat() * lerp(0.35, 0.6, state.density); // short, a little longer when dense
  const peak  = rand(0.05, 0.06) * 4 / v.length;
  const end   = t + len + 0.25;
  for (const m of v) logNote('stab', t, m, len, 0.8);

  const top = lerp(1800, 6500, state.brightness);
  const lp = filter('lowpass', top, 2.2);
  lp.frequency.setValueAtTime(top, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, top * 0.18), t + len);
  for (const midi of v) {
    const hz = midiToHz(midi);
    for (const d of [-7, 7]) osc('sawtooth', hz, t, end, d).connect(lp);
    const sq = osc('square', hz / 2, t, end), sqG = gain(0.35);
    sq.connect(sqG); sqG.connect(lp);
  }
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.003);
  env.gain.setTargetAtTime(peak * 0.45, t + 0.003, len * 0.35);
  env.gain.setTargetAtTime(0, t + len, 0.04);
  lp.connect(env); env.connect(bus);
  send(env, audio.echoSend, 0.32);
  send(env, audio.reverbSend, lerp(0.15, 0.45, state.spaciousness));
  return 0.25;
}

// Draws nothing on reset -- every voice is reset at the start of a session, playing or not,
// and a draw here would shift the shared random sequence under the voices that are playing.
export const stabVoice = createVoice('stab', play, {
  role: 'motion',
  onReset: () => { phrase = -1; prev = null; pattern = null; },
});
