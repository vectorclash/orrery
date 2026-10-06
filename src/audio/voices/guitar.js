import { audio, getVoiceBus, noise } from '../context.js';
import { state, beat, rand, pick, lerp, register } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { gain, filter, send, pluckBuffer, playBuffer } from '../synth.js';

// Disco rhythm guitar: the "chicken scratch" of Nile Rodgers and every
// nu-disco record since -- a clean, bright guitar strummed in sixteenths, the
// fretting hand muting the strings between chords, so most strokes are a
// percussive scratch and a few ring out as short chord chops. The strumming
// hand never stops: down-strokes on the beat and the "and", up-strokes in
// between, and a stroke that should be silent just passes over the strings.
//
// Each string is a Karplus–Strong model. A chop strums four chord tones a few
// milliseconds apart (low to high going down, the top three high to low coming
// up) and the mute cuts them together; a scratch is the same strings fully
// muted, mostly pick noise. Voicings are the chord's four tones high on the
// neck, voice-led from one chord to the next like a player's hand.
//
// Sixteen steps a bar: X accented chop, x chop, g muted scratch, . nothing.
// A pattern holds for a phrase (four bars) and a new phrase sometimes changes it.
const PATTERNS = [
  'g.Xgg.Xgg.Xgg.Xg', // chops on the off-beat eighths, scratch between
  'X.gxg.X.gxg.X.gx', // syncopated chops, Le Freak style
  'xgXgxgXgxgXgxgXg', // the full sixteenth strum, accents on the "and"
  '..X.gxX...X.gxXg', // pushes
  'X..xg.x.g.X.gxg.', // the "Good Times" lilt
];

let pattern = null; // chosen on the first stroke, see onReset
let phrase  = -1;
let prev    = null; // last voicing
let segAt   = null; // start of the chord segment `prev` was voiced for

function voicing(b) {
  const seg = harmony.at(b);
  if (segAt !== seg.start || !prev) {
    prev  = harmony.voice(harmony.pcs(seg.degree, 4), prev, register(66, 52, 78));
    segAt = seg.start;
  }
  return prev;
}

function stroke(t, notes, down, kind) {
  const accent  = kind === 'X';
  const scratch = kind === 'g';
  const strings = down ? notes : notes.slice().reverse().slice(0, 3);
  const gap     = down ? 0.007 : 0.005;
  const gate    = scratch ? 0.03 : beat() * 0.25 * (accent ? 0.95 : 0.7);
  const level   = 0.275 * (scratch ? 0.4 : accent ? 1 : 0.8) * lerp(0.82, 1, state.density) * rand(0.9, 1.05);
  const span    = gap * (strings.length - 1);

  const tone = filter('lowpass', lerp(3200, 7500, state.brightness), 0.7);
  strings.forEach((midi, i) => {
    const at = t + i * gap;
    if (!scratch) logNote('guitar', at, midi, gate, accent ? 1 : 0.75);
    const ring = scratch ? 0.04 : 1.2;
    const src  = playBuffer(pluckBuffer(midi, { t60: ring, bright: scratch ? 0.95 : 0.78, pick: 0.14, stretch: 0.35, length: gate + span + 0.06 }), at, at + gate + span + 0.06);
    src.connect(tone);
  });
  // The pick dragging across muted strings.
  if (scratch || accent) {
    const n = noise(t, 0.03), bp = filter('bandpass', 2300, 0.9), nG = gain(0);
    nG.gain.setValueAtTime(0, t);
    nG.gain.linearRampToValueAtTime(scratch ? 0.6 : 0.25, t + 0.002);
    nG.gain.setTargetAtTime(0, t + 0.004, 0.008);
    n.connect(bp); bp.connect(nG); nG.connect(tone);
  }
  // The fretting hand: everything rings until the mute, then stops together.
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + 0.002);
  env.gain.setTargetAtTime(0, t + span + gate, 0.012);
  tone.connect(env);
  env.connect(getVoiceBus('guitar').dry);
  send(env, audio.reverbSend, lerp(0.06, 0.2, state.spaciousness));
}

function play(t, b) {
  const p = Math.floor(b / 16);
  if (p !== phrase) {
    phrase = p;
    if (!pattern || Math.random() < 0.35) pattern = pick(PATTERNS);
  }
  const step = Math.round((b - Math.floor(b / 4) * 4) * 4) % 16;
  const kind = pattern[step];
  if (kind === '.') return 0.25;
  stroke(t + rand(-0.003, 0.003), voicing(b), step % 2 === 0, kind);
  return 0.25;
}

// Draws nothing on reset -- every voice is reset at the start of a session, playing or not,
// and a draw here would shift the shared random sequence under the voices that are playing.
export const guitarVoice = createVoice('guitar', play, {
  entry: 4,
  role: 'motion',
  onReset: () => { phrase = -1; pattern = null; prev = null; segAt = null; },
});
