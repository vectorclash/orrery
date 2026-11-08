import { audio, getVoiceBus, noise } from '../context.js';
import { state, beat, rand, pick, lerp, register, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { gain, filter, send, pluckBuffer, playBuffer, settle } from '../synth.js';

// Disco rhythm guitar: the "chicken scratch" of Nile Rodgers and every
// nu-disco record since -- a clean, bright guitar strummed in sixteenths, the
// fretting hand muting the strings between chords, so most strokes are a
// percussive scratch and a few ring out as short chord chops. The strumming
// hand never stops: down-strokes on the beat and the "and", up-strokes in
// between, and a stroke that should be silent just passes over the strings.
//
// Each string is a Karplus–Strong model, heard as an electric guitar is:
// through a single-coil pickup between the neck and the middle of the body (a
// comb in the string model, see pluckBuffer) and the pickup's own resonance,
// its coil and the cable forming a resonant lowpass around 4–5 kHz -- the
// glassy "quack" of a clean Strat, where a plain lowpass sounded like a toy.
// A chop strums four chord tones a few milliseconds apart (low to high going
// down, the top three high to low coming up) and the mute cuts them together;
// a scratch is the same strings fully muted, mostly pick noise. Voicings are
// the chord's four tones high on the neck, voice-led from one chord to the
// next like a player's hand.
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

// For the newer composers, the guitar of each genre that uses it. Disco's scratch was
// every genre's, the reggaeton and afrobeats guitars strumming like Nile Rodgers.
// Two more strokes: p, one picked note, and d, a double-stop (the voicing's top two),
// each left to ring. Picked notes walk the voicing top, second, third, second, as a
// highlife or dembow picking hand does.
const GENRE_PATTERNS = {
  disco: PATTERNS,
  // Highlife picking: interlocking single notes and double-stops in sixteenths.
  afro: [
    'p.pp.p.pp.p.pp.p',
    'p..p.pd.p..p.pd.',
    'd.p.p.d.p.p.d.pp',
    '.p.p.pp..p.p.pp.',
  ],
  // Dembow: picked notes on the 3+3+2, a chop on the one.
  reggaeton: [
    'p..p..p.p..p..p.',
    'X..p..p.X..p..p.',
    'p..p..pp..p.p...',
  ],
};
const PATTERNS_FOR = { AFROBEATS: 'afro', 'AFRO HOUSE': 'afro', AMAPIANO: 'afro', REGGAETON: 'reggaeton', TRAP: 'reggaeton' };
const patterns = () => (state.composer >= 2 ? GENRE_PATTERNS[PATTERNS_FOR[state.language] ?? 'disco'] : PATTERNS);
const PICK_ORDER = [3, 1, 2, 1];
// One picked string has a fraction of a four-string chop's energy: level-matched
// (BS.1770, gated) to the strummed guitar the genre had.
const PICK_TRIM = { afro: 1.9, reggaeton: 2.4 };

let pattern = null; // chosen on the first stroke, see onReset
let patternFor = null; // the language it was chosen for
let phrase  = -1;
let prev    = null; // last voicing
let segAt   = null; // start of the chord segment `prev` was voiced for

function voicing(b) {
  const seg = state.composer >= 2 ? harmony.pushed(b) : harmony.at(b);
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
  const level   = 0.18 * (scratch ? 0.4 : accent ? 1 : 0.8) * lerp(0.82, 1, state.density) * rand(0.9, 1.05);
  const span    = gap * (strings.length - 1);

  const tone = filter('lowpass', lerp(3800, 5600, state.brightness), 2.4);
  strings.forEach((midi, i) => {
    const at = t + i * gap;
    if (!scratch) logNote('guitar', at, midi, gate, accent ? 1 : 0.75);
    const ring = scratch ? 0.04 : 1.2;
    const src  = playBuffer(pluckBuffer(midi, { t60: ring, bright: scratch ? 0.95 : 0.78, pick: 0.14, stretch: 0.35, length: gate + span + 0.06, pickup: 0.22 }), at, at + gate + span + 0.06);
    if (!scratch) settle(src, at, accent ? 6 : 4, 0.03);
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

// One picked note, or a double-stop, ringing on: no mute, no scrape.
function picked(t, notes, kind, nth) {
  const strings = kind === 'd' ? notes.slice(-2) : [notes[PICK_ORDER[nth % 4] % notes.length]];
  const gate  = beat() * 0.6;
  const level = 0.18 * 0.75 * (PICK_TRIM[PATTERNS_FOR[state.language]] ?? 1.9) * lerp(0.82, 1, state.density) * rand(0.9, 1.05);
  const tone  = filter('lowpass', lerp(3800, 5600, state.brightness), 2.4);
  strings.forEach((midi, i) => {
    const at = t + i * 0.004;
    logNote('guitar', at, midi, gate, 0.8);
    const src = playBuffer(pluckBuffer(midi, { t60: 0.9, bright: 0.72, pick: 0.14, stretch: 0.35, length: gate + 0.1, pickup: 0.22 }), at, at + gate + 0.1);
    settle(src, at, 4, 0.03);
    src.connect(tone);
  });
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + 0.002);
  env.gain.setTargetAtTime(0, t + gate, 0.03);
  tone.connect(env);
  env.connect(getVoiceBus('guitar').dry);
  send(env, audio.reverbSend, lerp(0.06, 0.2, state.spaciousness));
}

function play(t, b) {
  const p = Math.floor(b / 16);
  if (p !== phrase) {
    phrase = p;
    if (!pattern || (state.composer < 2 && random() < 0.35)) { pattern = pick(patterns()); patternFor = state.language; }
  }
  // A genre chosen while it plays: its guitar straight away.
  if (state.composer >= 2 && patternFor !== state.language) { pattern = pick(patterns()); patternFor = state.language; }
  const step = Math.round((b - Math.floor(b / 4) * 4) * 4) % 16;
  const kind = pattern[step];
  if (kind === '.') return 0.25;
  if (kind === 'p' || kind === 'd') {
    const nth = [...pattern.slice(0, step)].filter(c => c === 'p' || c === 'd').length;
    picked(t + rand(-0.003, 0.003), voicing(b), kind, nth);
    return 0.25;
  }
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
