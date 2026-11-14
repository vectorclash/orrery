import { audio, noise, voiceIn } from '../context.js';
import { state, beat, rand, pick, lerp, currentScale, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony, bassRoot } from '../harmony.js';
import { song } from '../song.js';
import { osc, gain, filter, perc, ahr, lfo, pluckBuffer, playBuffer, shaper, settle } from '../synth.js';
import { meter, isFour, barBeats, barIndex, inBar, step16, heldFor, toPulse } from '../meter.js';

// ─── Bass ─────────────────────────────────────────────────────────────────────
// Every style is tied to the harmonic rhythm: the chord root lands on the
// arrival of each chord, no note is held across a chord change, and the last
// note before a change often *leads into* the next root (an approach tone) —
// that anticipation is most of what makes a bass line sound like a line.

const STYLES = ['sub', 'plucked', 'walking', 'synth', 'rumble'];
// The dance styles are chosen in Manual mode (or by a genre); Infinite mode's
// reroll keeps to STYLES above, so it sounds as it always has. The later ones
// (GROOVE_STYLES) draw from their own block, so the first three's sequence of
// draws is untouched by them.
const FIRST_DANCE_STYLES = ['deep', 'acid', 'rolling'];
const GROOVE_STYLES = ['disco', '808', 'reese', 'log'];
export const DANCE_STYLES = [...FIRST_DANCE_STYLES, ...GROOVE_STYLES];
const LO = 26, HI = 59; // D1 … B3

// Plucked (finger bass): one-bar rhythms of [beats, note]. R root, F fifth,
// O octave, A approach into the next chord (a chord tone if none is coming).
const PLUCK_RHYTHMS = [
  [[1.5, 'R'], [0.5, 'R'], [1, 'F'], [1, 'A']],
  [[1, 'R'], [1, 'R'], [1, 'F'], [1, 'A']],
  [[0.75, 'R'], [0.75, 'R'], [0.5, 'O'], [1, 'F'], [1, 'A']],
  [[2, 'R'], [1.5, 'F'], [0.5, 'A']],
  [[1.5, 'R'], [1.5, 'F'], [1, 'A']],
];
// Plucked, for the newer composers: two-bar figures in each genre's bass language,
// the second bar turning toward the next. The five cells above all said the same
// thing -- root on one, fifth on three, an approach on four -- in every genre, and
// with one held for a section, a funk bass and a folk bass played the same line.
// Sixteenths, as the synth patterns below: a letter starts a note, '-' holds it, '.'
// rests. R root, O octave, F fifth, 3 and 7 the chord's third and seventh, 6 the
// sixth above the root (in the scale, or the fifth), A an approach into the next
// chord (a chord tone if none is coming), x a dead note: the string muted under the
// finger, a thump at the pitch before.
const FIGURES = {
  // Syncopated sixteenths, the one hit hard, octave pops and ghost notes.
  funk: [
    'R-.xR.O.x.R.7.O.' + 'R-.xR.O.x.F.3.A.',
    'R..R..x.O..R.7x.' + 'R..R..x.O..F.A-.',
    'R-xR.xO.R-xR.7O.' + 'R-xR.xO.F-x3.7A.',
    'R-..R-.xO-..R-7.' + 'R-..R-.xO-..F-A.',
  ],
  // The tresillo (3+3+2) and lines that leave the downbeat to the kick.
  afro: [
    'R--R--F-R--O--F-' + 'R--R--F-3--A----',
    '..R-..R-F-..R-..' + '..R-..R-3-..A-..',
    'R-..O-.R..F-R-..' + 'R-..O-.R..3-A-..',
    'R-.F..R-O-.R..7.' + 'R-.F..R-O-.3..A.',
  ],
  // Root and fifth on the beats, walking up into the changes.
  folk: [
    'R---F---R---F---' + 'R---F---R---3-A-',
    'R---R-F-R---F---' + 'R---R-F-R-3-A---',
    'R-------F-------' + 'R-------F---A---',
    'R---F-R-R---F-O-' + 'R---F-R-3---A---',
  ],
  // Boom bap: sparse and behind the beat, long notes and a pickup or two.
  lofi: [
    'R-------..R.F---' + 'R-------..R.7-A-',
    'R-----.R..F-----' + 'R-----.R..3---A-',
    'R--.....R-.F-...' + 'R--.....3-.A-...',
    'R-----R.....O-..' + 'R-----R...7-A-..',
  ],
  // Held roots and plain quarters: the orchestra's basses, and the slow genres.
  held: [
    'R---------------' + 'R-------F-------',
    'R---R---F---R---' + 'R---R---3---A---',
    'R-------R---F---' + 'R-------R---A---',
    'R-----------F-A-' + 'R-------F-------',
  ],
  // The boogie: root, third, fifth, sixth, seventh and back, in shuffled eighths.
  blues: [
    'R-3-F-6-7-6-F-3-' + 'R-3-F-6-7-6-F-A-',
    'R---F-6-R---F-6-' + 'R---F-6-7-6-F-A-',
    'R-.R3-.3F-.F6-.6' + 'R-.R3-.3F-.F7-.A',
    'R-------F---6---' + 'R---3---F---A---',
  ],
  // Anything else: the old cells' shapes and a few that move more.
  any: [
    'R-----R-F---A---' + 'R-----R-F---3-A-',
    'R---R---F---A---' + 'R---R---O---F-A-',
    'R--R--O-F---A---' + 'R--R--O-3---A---',
    'R-------F-----A-' + 'R-------O---F-A-',
    'R-----F-----A---' + 'R-----F---7-A---',
    'R-.RO-.RF-.R3-.A' + 'R-.RO-.RF-.R7-.A',
  ],
};
const FIGURES_FOR = {
  FUNK: 'funk', 'NU-DISCO': 'funk',
  AFROBEATS: 'afro', 'AFRO HOUSE': 'afro', AMAPIANO: 'afro', REGGAETON: 'afro',
  FOLK: 'folk',
  'LO-FI': 'lofi', TRAP: 'lofi',
  ORCH: 'held', EPIC: 'held', AMBIENT: 'held', ZEN: 'held', DREAM: 'held', DARK: 'held',
  BLUES: 'blues',
};
const figuresFor = language => FIGURES[FIGURES_FOR[language] ?? 'any'];
// The same, written for the songs in 3/4 and 6/8 (see meter.js): two bars of twelve
// sixteenths. The waltz's root on one and the chord on two and three, its turn on
// three; six-eight's two big beats, the root on the first and the fifth or a walk on
// the second. A figure plays the one in the same place in its family here, so a
// section keeps one line; a family without its own reads its 4/4 figure folded.
const METER_FIGURES = {
  '3/4': {
    folk: ['R---F---F---' + 'R---F---3-A-', 'R-------F-O-' + 'R-------3-A-', 'R---F-R-F---' + 'R---3---A---', 'R---F---O---' + 'R---3---A---'],
    held: ['R-----------' + 'R-------F---', 'R---R---F---' + 'R---R---A---', 'R-------F---' + 'R-------A---', 'R-----------' + 'R---F---A---'],
    any:  ['R---F---F---' + 'R---F---A---', 'R-------F---' + 'R---3---A---', 'R---O---F---' + 'R---F---A---', 'R-------F-A-' + 'R-------O-A-',
      'R-----F-----' + 'R-----F---A-', 'R-.RO-.RF-.R' + 'R-.R3-.RF-.A'],
  },
  '6/8': {
    folk:  ['R-----F-----' + 'R-----3---A-', 'R---F-R---F-' + 'R---F-3---A-', 'R-F-R-F-O-F-' + 'R-F-R-3-F-A-', 'R---R-F---F-' + 'R---R-3---A-'],
    held:  ['R-----------' + 'R-----F-----', 'R-----F-----' + 'R-----A-----', 'R---R-F---F-' + 'R---R-3---A-', 'R-----------' + 'R-----F---A-'],
    blues: ['R-3-F-6-F-3-' + 'R-3-F-6-7-A-', 'R---F-6---F-' + 'R---F-6-7-A-', 'R-.R3-F-.F6-' + 'R-.R3-F-.F7A', 'R-----F---6-' + 'R---3-F---A-'],
    any:   ['R-----F-----' + 'R-----F---A-', 'R---F-R---F-' + 'R---F-R---A-', 'R-F-R-F-R-F-' + 'R-F-R-F-3-A-', 'R-----O---F-' + 'R-----3---A-',
      'R---F-O---F-' + 'R---F-3---A-', 'R-.R-.F-.F-.' + 'R-.R-.3-.A-.'],
  },
  // Three and two: the root starting each group, the turn at the end of the two.
  '5/4': {
    held: ['R-----------F-------' + 'R-----------A-------', 'R-------R---F-------' + 'R-------F---A-------',
      'R-----------R---F---' + 'R-----------F---A---', 'R-------------------' + 'R-----------F-------'],
    any:  ['R-------F---R---F---' + 'R-------F---R---A---', 'R---R---F---R---O---' + 'R---R---F---3---A---',
      'R-----R-F---R-----A-' + 'R-----R-F---F-----A-', 'R--R--O-F---R--R--A-' + 'R--R--O-F---R--3--A-'],
  },
  // Two, two and three: a note on each group, the longest last.
  '7/8': {
    held: ['R-------F-----' + 'R-------A-----', 'R-------------' + 'R-------F-----',
      'R---R---F-----' + 'R---R---A-----', 'R-------R---F-' + 'R-------F---A-'],
    any:  ['R---F---R---F-' + 'R---F---R---A-', 'R-R-F-F-R-R-O-' + 'R-R-F-F-R-3-A-',
      'R--R--O-F---A-' + 'R--R--O-3---A-', 'R-------F---A-' + 'R-------O---A-'],
  },
};
// Figure `fig` of family `family`, as written for this meter, or null to fold it.
function meterFigure(fig, family) {
  const own = METER_FIGURES[meter().name]?.[family];
  if (!own) return null;
  const at = FIGURES[family].indexOf(fig);
  return own[(at < 0 ? 0 : at) % own.length];
}
let figure = FIGURES.any[0];
let figureFor = null; // the language `figure` was drawn for

// Synth bass, for the newer composers: the same, in the synth bass's languages. It
// had four one-bar patterns for every genre that uses it, synthwave and techno,
// nu-disco and garage alike.
const SYNTH_FIGURES = {
  // Driving eighths and sixteenths on the root, the gallop, octaves: outrun.
  synthwave: [
    'R-R-R-R-R-R-R-R-' + 'R-R-R-R-F-F-A-A-',
    'RRRRRRRRRRRRRRRR' + 'RRRRRRRRFFFFRRRA',
    'R-RRR-RRR-RRR-RR' + 'R-RRR-RRF-FFA-AA',
    'R-O-R-O-R-O-R-O-' + 'R-O-R-O-F-O-A-O-',
  ],
  // One note, hypnotic, off the kick.
  techno: [
    '..R-..R-..R-..R-' + '..R-..R-..O-..A-',
    '..RR..RR..RR..RR' + '..RR..RR..RR..RA',
    '...R..R....R..R.' + '...R..R....O..A.',
    'R..R..R...R..R..' + 'R..R..R...O..A..',
  ],
  // Rolling sixteenths that move between the chord's tones.
  melodic: [
    '.ROR.ROR.ROR.ROR' + '.ROR.ROR.F3F.RAR',
    '..RO..RO..RO..RO' + '..RO..RO..F3..RA',
    '.R.R.R.R.R.R.R.O' + '.R.R.R.R.F.F.A.O',
  ],
  // House and EDM: the off-beat bass between the kicks.
  house: [
    '..R-..R-..R-..R-' + '..R-..R-..F-..A-',
    '..R...R...R...R.' + '..R...R...O...A.',
    '..R.R.R...R.R.R.' + '..R.R.R...F.F.A.',
  ],
  // UK garage: long, swung notes with gaps, 2-step.
  garage: [
    'R-----.R..R-----' + 'R-----.R..F---A-',
    'R--.R.....R-F-..' + 'R--.R.....3-A-..',
    '..R---R...R-....' + '..R---R...F-A...',
  ],
  // Nu-disco: octaves and sixteenth pushes.
  disco: [
    'R..RO.R.R..RO.R.' + 'R..RO.R.F..FO.A.',
    'R.O.R.O.R.O.R.O.' + 'R.O.R.O.F.O.A.O.',
    'R-.R.OR-.R.OR-.O' + 'R-.R.OR-.F.3A-.O',
  ],
  // A Moog funk line.
  funk: [
    'R-.RR.O..RR.7.O.' + 'R-.RR.O..FF.3.A.',
    'R..R..R.O..R.7R.' + 'R..R..R.O..F.A-.',
  ],
  afro: FIGURES.afro,
  lofi: FIGURES.lofi,
  // Electro and anything else: the four old patterns, each with a turn.
  any: [
    'R.O.R.O.R.O.R.O.' + 'R.O.R.O.F.O.A.O.',
    '..R-..R-..R-..R-' + '..R-..R-..F-..A-',
    'R-.R-.R-R-.R-.O-' + 'R-.R-.R-F-.3-.A-',
    'R-R-R-R-R-R-F-A-' + 'R-R-R-R-O-O-F-A-',
  ],
};
const SYNTH_FOR = {
  SYNTHWAVE: 'synthwave', TECHNO: 'techno', 'MELODIC TECHNO': 'melodic',
  EDM: 'house', TRANCE: 'house', 'FUTURE BASS': 'house', 'DEEP HOUSE': 'house',
  'UK GARAGE': 'garage', 'NU-DISCO': 'disco', FUNK: 'funk',
  AFROBEATS: 'afro', 'AFRO HOUSE': 'afro', AMAPIANO: 'afro', REGGAETON: 'afro',
  'LO-FI': 'lofi', TRAP: 'lofi',
};
const synthFiguresFor = language => SYNTH_FIGURES[SYNTH_FOR[language] ?? 'any'];
let synthFigure = SYNTH_FIGURES.any[0];
let synthFor = null;

// One sixteenth of a two-bar figure: `sound(t, midi, seconds)` plays a note; a dead
// note (x) goes to `dead(t, midi)`. Bars are counted from the section's first, so a
// figure's turn falls on its second.
// A figure written for the song's meter (`own`) is read as it is; a 4/4 one, in another
// meter, a bar at a time through its 4/4 bar (see meter.js).
function figureStep(fig, t, b, pos, sound, dead = null, own = false) {
  const from = song.current ? song.sectionAt(b).start : 0;
  const half = Math.floor((b - from) / barBeats() + 1e-9) % 2;
  const steps = meter().steps;
  const i = own ? Math.round(pos * 4) % steps : step16(pos), k = half * (own ? steps : 16) + i, ch = fig[k];
  if (ch === '.' || ch === '-') return 0.25;
  let n = 1;
  if (own) while (i + n < steps && fig[k + n] === '-') n++;
  else n = heldFor(fig, pos, half * 16);
  if (ch === 'x') { dead?.(t, prev ?? root(harmony.at(b))); return 0.25; }
  const midi = resolve(ch, b, n / 4);
  prev = midi;
  sound(t, midi, room(b, n / 4) * beat());
  return 0.25;
}

// Synth: sixteenth-note patterns. Letters start a note, '-' holds it, '.' rests.
const SYNTH_PATTERNS = [
  'R.O.R.O.R.O.R.O.', // octave bounce (disco / electro)
  '..R-..R-..R-..R-', // off-beat eighths (house / trance)
  'R-.R-.R-R-.R-.O-', // 3-3-2 syncopation with an octave pickup
  'R-R-R-R-R-R-F-A-', // driving eighths into the change
];

// Deep house: a rounded organ bass in syncopated sixteenths, leaving room for
// the kick on the beat.
const DEEP_PATTERNS = [
  '...R..R....R..R.',
  'R-.R..R-..R.R-..',
  '..R-..R-..R-.RA-',
  'R..R..R.R..R..O.',
];
// Rolling (trance / EDM): sixteenths that skip the beat, where the kick is.
const ROLLING_PATTERNS = [
  '.RRR.RRR.RRR.RRR',
  '.R.R.R.R.R.R.RRA',
  '..RR..RR..RR..RO',
];
let deepPattern = DEEP_PATTERNS[0];
let rollPattern = ROLLING_PATTERNS[0];

// Disco: octaves -- the root and the root an octave up, back and forth in
// eighths, the sound of every disco record and most of nu-disco.
const DISCO_PATTERNS = [
  'R.O.R.O.R.O.R.O.', // the octave bounce
  'R-O-R-O-R-O-R-OA', // legato octaves, an approach into the change
  'R..OR.O.R..OR.O.', // syncopated octaves
  'R.O.F.O.R.O.F.OA', // octaves and the fifth
];
// 808 (trap): long, sliding notes under a sparse kick. '-' holds a note.
const PATTERNS_808 = [
  'R---------R-----',
  'R-------R-R---O-',
  'R------R--R-----',
  'R---------O--R--',
];
// Reese (drum & bass): long notes, two bars of movement at most.
const REESE_PATTERNS = [
  'R-----------R-A-',
  'R-------R-------',
  'R-----R-------A-',
  'R-----------F-A-',
];
// Log drum (amapiano): a syncopated, melodic riff of pitched hits.
const LOG_PATTERNS = [
  '..R..R..R.O...R.',
  'R..R..O...R..F..',
  '...R..R.O..R..A.',
  'R.....R..R..O.R.',
];
const GROOVE_PATTERNS = { disco: DISCO_PATTERNS, '808': PATTERNS_808, reese: REESE_PATTERNS, log: LOG_PATTERNS };
let groovePattern = null; // chosen at the first bar of a groove style
let held808 = null;       // { midi, until } -- the 808 still sounding, for slides

// Acid (TB-303): a two-bar sixteenth sequence of notes, accents and slides
// that repeats like a sequencer and mutates a little each phrase. Notes are
// chord tones and their octaves, as a 303 line mostly is.
let acidSeq = [];
function makeAcid() {
  const seq = [];
  for (let i = 0; i < 32; i++) {
    if (random() < (i % 4 === 0 ? 0.2 : 0.38)) { seq.push(null); continue; }
    seq.push({
      code: pick(['R', 'R', 'R', 'O', 'O', 'F', '3', '7']),
      accent: random() < 0.28,
      slide: random() < 0.22,
    });
  }
  return seq;
}
function mutateAcid(seq) {
  return seq.map(s => (random() < 0.15 ? makeAcid()[0] : s));
}

let style  = 'sub';
let prev   = null; // last bass note (MIDI) — keeps root motion smooth
let curBar = -1;
let cell   = PLUCK_RHYTHMS[0];
let pattern = SYNTH_PATTERNS[0];

const inRange = m => Math.max(LO, Math.min(HI, m));
const inScale = m => currentScale().includes((((m - state.rootMidi) % 12) + 12) % 12);

function root(seg)     { return bassRoot(seg.degree, prev, LO, HI); }
function nextRoot(seg) { return bassRoot(seg.next, prev, LO, HI); }
function fifth(r)      { return r + 7 <= HI ? r + 7 : r - 5; }

// Lead into `target` from `from`: a chromatic half step (most common), a
// diatonic neighbour, or the target's own fifth (a dominant approach).
function approach(target, from) {
  const dir = from > target ? 1 : -1; // come in from the side we're already on
  const r = random();
  if (r < 0.45) return inRange(target + dir);
  if (r < 0.8) {
    for (let d = 1; d <= 2; d++) if (inScale(target + dir * d)) return inRange(target + dir * d);
  }
  return inRange(target + (dir > 0 ? 7 : -5));
}

// Composer 2's chord knows its own fifth (a diminished chord's isn't a perfect one),
// and a chord with another note in the bass stays on that note: the fifth above it
// would be a different chord.
function fifthOf(seg, r) {
  const c = seg.degree;
  if (typeof c !== 'object') return fifth(r);
  if (c.bass !== c.root) return r;
  const up = c.tones[2] % 12;
  if (up !== 6 && up !== 7 && up !== 8) return fifth(r);
  return r + up <= HI ? r + up : r + up - 12;
}

// How long a note of `beats` can last at `b`: composer 2's chords can change inside
// a bar, and a held note mustn't ring over the change. Composer 1's only change on
// bar lines, where a pattern's notes already stop.
const room = (b, beats) => (state.composer >= 2 ? Math.min(beats, harmony.at(b).end - b) : beats);

function resolve(code, b, len) {
  const seg = harmony.at(b);
  const r   = root(seg);
  if (b - seg.start < 1e-6) return r; // chord arrival always gets the root
  if (code === 'A') return b + len >= seg.end - 1e-6 ? approach(nextRoot(seg), prev ?? r) : fifthOf(seg, r);
  if (code === 'F') return fifthOf(seg, r);
  if (code === 'O') return r + 12 <= HI + 5 ? r + 12 : r;
  if (code === '3' || code === '7') return resolveAcid(code, b);
  if (code === '6') {
    for (const up of [9, 8]) if (inScale(r + up) && r + up <= HI + 5) return r + up;
    return fifthOf(seg, r);
  }
  return r;
}

// Acid notes: root, octave, fifth, and the chord's third and seventh.
function resolveAcid(code, b) {
  const seg = harmony.at(b);
  const r = root(seg);
  if (code === 'O') return r + 12 <= HI + 5 ? r + 12 : r;
  if (code === 'F') return fifthOf(seg, r);
  if (code === '3' || code === '7') {
    const pcs = harmony.pcs(seg.degree, 4);
    const pc = pcs[code === '3' ? 1 : 3];
    let m = r;
    while ((((m - pc) % 12) + 12) % 12 !== 0) m++;
    return inRange(m);
  }
  return r;
}

// Walking bass: steady quarters. Root on the chord's arrival, an approach
// note on the last beat before a change, and in between chord tones (on
// strong beats) or scale steps that head toward the next root without
// reaching it early.
// A walking bass's step, from `b`: a beat, or to the meter's next pulse (see meter.js):
// six-eight's big beats, seven-eight's two, two and three.
const walkStep = b => {
  if (isFour()) return 1;
  return toPulse(inBar(b, 1e-9));
};

function walkNote(b) {
  const seg = harmony.at(b);
  const k = b - seg.start, left = seg.end - b;
  if (k < 1e-6 || prev === null) return root(seg);
  const target = nextRoot(seg);
  if (left <= walkStep(b) + 1e-6) return approach(target, prev);
  const pcs = harmony.voiced(seg);
  const options = [];
  for (let m = prev - 5; m <= prev + 5; m++) {
    if (m === prev || m < LO || m > HI) continue;
    const chordTone = pcs.includes(m % 12);
    if (!chordTone && !inScale(m)) continue;
    let w = chordTone ? (Math.round(k) % 2 === 0 ? 4 : 2) : 1;
    if (Math.abs(target - m) < Math.abs(target - prev)) w += 1.5;
    if (m === target) w = 0.2;
    options.push([m, w]);
  }
  let total = options.reduce((s, [, w]) => s + w, 0), r = random() * total;
  for (const [m, w] of options) if ((r -= w) <= 0) return m;
  return root(seg);
}

// ─── Sounds ───────────────────────────────────────────────────────────────────
function subBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.8);
  const hz = midiToHz(midi), end = t + dur + 0.1;
  const lp = filter('lowpass', 320, 0.7);
  osc('sine', hz, t, end).connect(lp);
  const tri = osc('triangle', hz, t, end), triG = gain(0.5);
  tri.connect(triG); triG.connect(lp);
  if (hz / 2 >= 35) { // a sub-octave only where it's still audible
    const s = osc('sine', hz / 2, t, end), sG = gain(0.5);
    s.connect(sG); sG.connect(lp);
  }
  const env = gain(0);
  ahr(env.gain, t, rand(0.09, 0.12), 0.03, dur - 0.06, 0.05);
  lp.connect(env); env.connect(voiceIn(audio.pumped));
}

// The two string basses. Each was a bare Karplus–Strong string behind a fixed
// 1.8 kHz lowpass: a low string makes so few passes a second that its overtones
// barely died, so every note stayed as bright as its pluck, and the lowpass that
// tamed it left one flat tone. A real bass string loses its brightness within a
// few hundred milliseconds and blooms into a round note, which `damp` gives
// (see pluckBuffer); then each gets what makes it an instrument.

// Electric bass, played with the fingers: a long roundwound string heard through
// a magnetic pickup a fifth of the way from the bridge (the comb that gives the
// midrange its growl), whose coil and cable resonate around 2.5–4 kHz with the
// TONE control. Two polarisations for the two-stage decay of a real string, and
// the pluck stretches it a few cents sharp for a moment.
const FINGER_POL = { cents: 0.6, t60: 0.6, mix: 0.3 };
const FINGER_TRIM = 0.55; // each level-matched (K-weighted) to the old string bass
const FINGER_PUSH = 2.5;
function fingerBass(t, midi, dur, { level, t60 = 2.4 }) {
  logNote('bass', t, midi, dur, 0.85);
  const ring = dur + 0.2;
  const src = playBuffer(pluckBuffer(midi, {
    t60, bright: 0.45, pick: 0.2, length: ring, damp: { hz: 1100, t60: 0.38 }, pol: FINGER_POL, pickup: 0.2, soft: 7,
  }), t, t + ring);
  settle(src, t, 6, 0.04);
  stringOut(t, src, filter('lowpass', lerp(2400, 3800, state.brightness), 1.3), dur, level, 300, FINGER_PUSH);
}

// Double bass, pizzicato: a gut-toned string plucked over the end of the
// fingerboard, its pluck the body's response (the air mode near 60 Hz, the wood
// around 100–140, see BODIES), losing its highs fast into the woody "thoom" of a
// jazz bass. The pluck pulls it sharper than a bass guitar's, and it settles
// more slowly. Heard through a microphone, so only a gentle lowpass.
const UPRIGHT_POL = { cents: 1, t60: 0.45, mix: 0.35 };
const UPRIGHT_TRIM = 1.22;
const UPRIGHT_PUSH = 2.4;
function uprightBass(t, midi, dur, { level, t60 = 1.6 }) {
  logNote('bass', t, midi, dur, 0.85);
  const ring = dur + 0.2;
  const src = playBuffer(pluckBuffer(midi, {
    t60, bright: 0.3, pick: 0.32, length: ring, damp: { hz: 700, t60: 0.26 }, body: 'upright', pol: UPRIGHT_POL, soft: 9,
  }), t, t + ring);
  settle(src, t, 12, 0.06);
  stringOut(t, src, filter('lowpass', lerp(2600, 4200, state.brightness), 0.7), dur, level, 180, UPRIGHT_PUSH);
}

// A string bass's note: its tone filter, cut when the note ends, and the
// finger's thump under the attack (lowpassed at `thumpHz`). Then into the desk
// the way recorded basses go, through a little tube-style saturation, unity gain
// for quiet signals: a round bass carries its weight in the fundamental, whose
// peaks used the master's headroom up (the old buzz had none to round off), and
// the harmonics the saturation adds are what lets a bass be heard on a phone.
// `push` is how hard a note's peaks drive it.
function stringOut(t, src, tone, dur, level, thumpHz, push) {
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + 0.004);
  env.gain.setTargetAtTime(0, t + dur, 0.03);
  const pre = gain(push), drive = shaper(1), post = gain(Math.tanh(1) / push);
  src.connect(tone); tone.connect(env); env.connect(pre); pre.connect(drive); drive.connect(post); post.connect(voiceIn(audio.pumped));
  const th = noise(t, 0.03), thLp = filter('lowpass', thumpHz), thE = gain(0);
  perc(thE.gain, t, level * 0.5, 0.02, 0.001);
  th.connect(thLp); thLp.connect(thE); thE.connect(voiceIn(audio.pumped));
}

function synthBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.85);
  const hz = midiToHz(midi), end = t + dur + 0.1;
  const peak = rand(0.085, 0.11);
  for (const detune of [-8, 8]) {
    const o = osc('sawtooth', hz, t, end, detune);
    const lp = filter('lowpass', 80, 6);
    lp.frequency.setValueAtTime(80, t);
    lp.frequency.exponentialRampToValueAtTime(600 + 500 * state.brightness, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.06, dur * 0.8));
    const env = gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.006);
    env.gain.setTargetAtTime(0, t + dur, 0.02);
    o.connect(lp); lp.connect(env); env.connect(voiceIn(audio.pumped));
  }
}

function rumbleBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.7);
  const hz = midiToHz(midi), end = t + dur + 0.6;
  const peak = rand(0.07, 0.09);
  const lp = filter('lowpass', 300, 1.5);
  osc('square', hz, t, end).connect(lp);
  if (hz / 2 >= 35) osc('sine', hz / 2, t, end).connect(lp);
  const env = gain(0);
  ahr(env.gain, t, peak, 0.2, dur - 0.1, 0.5);
  const trem = osc('sine', rand(3, 6), t, end), tremG = gain(peak * 0.3);
  trem.connect(tremG); tremG.connect(env.gain);
  lp.connect(env); env.connect(voiceIn(audio.pumped));
}

// Organ bass (the M1 of deep house): a sine with its second and third harmonics,
// plucked -- a quick bloom, then down to a held body that stops with the note.
function deepBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.85);
  const hz = midiToHz(midi), end = t + dur + 0.1;
  const sum = gain(1);
  for (const [k, lvl] of [[1, 1], [2, 0.35], [3, 0.12]]) {
    const o = osc('sine', hz * k, t, end), g = gain(lvl);
    o.connect(g); g.connect(sum);
  }
  const lp = filter('lowpass', 600 + 600 * state.brightness, 0.7);
  const peak = rand(0.23, 0.27); // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.setTargetAtTime(peak * 0.55, t + 0.004, 0.08);
  env.gain.setTargetAtTime(0, t + dur, 0.025);
  sum.connect(lp); lp.connect(env); env.connect(voiceIn(audio.pumped));
}

// TB-303: one sawtooth (sometimes square) through a resonant lowpass whose
// envelope is the squelch. An accent opens it further and plays louder; a
// slide glides into the next note without restarting the envelope. The
// cutoff also wanders slowly over bars -- the hand on the knob.
let acidWave = 'sawtooth';
function acidNote(t, midi, dur, accent, toMidi) {
  logNote('bass', t, midi, dur, accent ? 1 : 0.75);
  const hz = midiToHz(midi), end = t + dur + 0.08;
  const o = osc(acidWave, hz, t, end);
  if (toMidi !== null) {
    o.frequency.setValueAtTime(hz, t + dur - 0.06);
    o.frequency.exponentialRampToValueAtTime(midiToHz(toMidi), t + dur);
  }
  const knob = 0.5 + 0.5 * Math.sin(transport_bars(t) * Math.PI / 4);
  const base = lerpN(180, 900, 0.4 * knob + 0.6 * state.brightness);
  const lp = filter('lowpass', base, accent ? 16 : 11);
  lp.frequency.setValueAtTime(base * (accent ? 7 : 4), t);
  lp.frequency.setTargetAtTime(base, t, accent ? 0.09 : 0.06);
  const drive = shaper(2.2);
  const peak = accent ? 0.21 : 0.155; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.003);
  env.gain.setTargetAtTime(peak * 0.7, t + 0.003, 0.1);
  env.gain.setTargetAtTime(0, t + dur, 0.015);
  o.connect(lp); lp.connect(drive); drive.connect(env); env.connect(voiceIn(audio.pumped));
}
const lerpN = (a, b, x) => a + (b - a) * x;
const transport_bars = t => t / (beat() * 4);

// Disco: a Moog-style bass -- a saw and a square through a resonant lowpass
// that snaps open on every note, short and bouncy.
function discoBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.85);
  const hz = midiToHz(midi), end = t + dur + 0.08;
  const sum = gain(1);
  osc('sawtooth', hz, t, end).connect(sum);
  const sq = osc('square', hz, t, end, 6), sqG = gain(0.45);
  sq.connect(sqG); sqG.connect(sum);
  const top = 450 + 900 * state.brightness;
  const lp = filter('lowpass', top, 5);
  lp.frequency.setValueAtTime(top * 2.4, t);
  lp.frequency.setTargetAtTime(top * 0.7, t, 0.06);
  const peak = rand(0.1, 0.115); // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.003);
  env.gain.setTargetAtTime(peak * 0.7, t + 0.003, 0.09);
  env.gain.setTargetAtTime(0, t + dur, 0.02);
  sum.connect(lp); lp.connect(env); env.connect(voiceIn(audio.pumped));
}

// 808: a sine with a fast pitch drop (the punch), saturated so it is heard on
// a phone speaker, held for as long as the note. A note that follows one still
// sounding glides up or down into its pitch -- the 808 slide.
function bass808(t, midi, dur, fromMidi) {
  logNote('bass', t, midi, dur, 0.9);
  const hz = midiToHz(midi), end = t + dur + 0.15;
  const o = osc('sine', hz, t, end);
  if (fromMidi !== null) {
    o.frequency.setValueAtTime(midiToHz(fromMidi), t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.09);
  } else {
    o.frequency.setValueAtTime(hz * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
  }
  const drive = shaper(1.8);
  const peak = 0.128; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.setTargetAtTime(peak * 0.7, t + 0.004, 0.35);
  env.gain.setTargetAtTime(0, t + dur, 0.04);
  o.connect(drive); drive.connect(env); env.connect(voiceIn(audio.pumped));
}

// Reese: two saws a few cents apart, beating slowly against each other (the
// phasing that is the sound), through a lowpass that drifts, over a sine sub.
function reeseBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.8);
  const hz = midiToHz(midi), end = t + dur + 0.12;
  const saws = gain(1);
  for (const d of [-14, 14]) osc('sawtooth', hz, t, end, d).connect(saws);
  const base = 260 + 600 * state.brightness;
  const lp = filter('lowpass', base, 3);
  lfo(rand(0.15, 0.4), base * 0.45, t, end, 0, 0.1).connect(lp.frequency);
  const sub = osc('sine', hz, t, end), subG = gain(0.9);
  const peak = 0.075; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.01);
  env.gain.setTargetAtTime(0, t + dur, 0.05);
  saws.connect(lp); lp.connect(env);
  sub.connect(subG); subG.connect(env);
  env.connect(voiceIn(audio.pumped));
}

// Log drum: the amapiano bass -- a hollow, pitched knock. A sine that drops
// into its pitch, a little saturation, a woody click, and a lowpass that
// closes behind the hit; it rings briefly rather than holding.
function logDrum(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.9);
  const hz = midiToHz(midi), ring = Math.min(dur, 0.5), end = t + ring + 0.3;
  const o = osc('sine', hz * 2.2, t, end);
  o.frequency.setValueAtTime(hz * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
  const h = osc('triangle', hz * 2, t, end), hG = gain(0.25);
  const sum = gain(1);
  o.connect(sum); h.connect(hG); hG.connect(sum);
  const lp = filter('lowpass', 2400, 2);
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.setTargetAtTime(380 + 400 * state.brightness, t, 0.05);
  const drive = shaper(1.6);
  const peak = 0.2; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.002);
  env.gain.setTargetAtTime(peak * 0.45, t + 0.002, 0.12);
  env.gain.setTargetAtTime(0, t + ring, 0.06);
  sum.connect(lp); lp.connect(drive); drive.connect(env); env.connect(voiceIn(audio.pumped));
  const knock = noise(t, 0.02), bp = filter('bandpass', 750, 1.5), kG = gain(0);
  perc(kG.gain, t, peak * 0.5, 0.015, 0.0005);
  knock.connect(bp); bp.connect(kG); kG.connect(voiceIn(audio.pumped));
}

// ─── Scheduling ───────────────────────────────────────────────────────────────
// A build's pedal (see BUILDS in song.js): the chord's root in the style's
// own sound, coming in halfway on the beat and then in eighths for the last
// quarter, driving into the drop. Short notes, so the build stays under the
// drop it leads to.
function pedal(t, b, sec) {
  const off = b % 1 > 0.25, x = (b - sec.start) / sec.beats;
  if (x < 0.5 || (off && x < 0.75)) return 0.5;
  const midi = root(harmony.at(b));
  const dur = beat() * 0.5 * 0.6;
  prev = midi;
  if (style === 'acid') acidNote(t, midi, dur, off, null);
  else if (style === 'deep') deepBass(t, midi, dur);
  else if (style === 'disco') discoBass(t, midi, dur);
  else if (style === 'reese') reeseBass(t, midi, dur);
  else if (style === 'log') logDrum(t, midi, dur);
  else if (style === '808') bass808(t, midi, dur, null);
  else if (style === 'sub') subBass(t, midi, dur);
  else if (style === 'rumble') rumbleBass(t, midi, dur);
  else if (style === 'plucked') fingerBass(t, midi, dur, { t60: 1.2, level: (off ? 0.46 : 0.38) * FINGER_TRIM });
  else if (style === 'walking') uprightBass(t, midi, dur, { t60: 1.2, level: (off ? 0.46 : 0.38) * UPRIGHT_TRIM });
  else synthBass(t, midi, dur);
  return 0.5;
}

function play(t, b) {
  const sec = song.sectionAt(b), build = sec?.build;
  if (build?.kickOut && b >= sec.start + sec.beats - sec.gap - build.kickOut - 1e-6) return 0.25; // out with the kick
  if (build?.pedal) return pedal(t, b, sec);
  const B = barBeats(), bar = barIndex(b, 1e-9), pos = inBar(b, 1e-9);
  if (bar !== curBar) {
    curBar = bar;
    if (state.composer >= 2) {
      // A bass figure holds for its section, note for note: that's most of what made
      // the log drum on the song that prompted this a riff. An acid line still evolves,
      // which is what an acid line does, but over eight bars, not two.
      if (GROOVE_STYLES.includes(style) && !groovePattern) groovePattern = pick(GROOVE_PATTERNS[style]);
      if (style === 'acid') {
        if (!acidSeq.length) acidSeq = makeAcid();
        else if (bar % 8 === 0 && random() < 0.5) acidSeq = mutateAcid(acidSeq);
      }
    } else if (GROOVE_STYLES.includes(style)) {
      if (!groovePattern || (bar % 4 === 0 && random() < 0.3)) groovePattern = pick(GROOVE_PATTERNS[style]);
    } else if (FIRST_DANCE_STYLES.includes(style)) {
      // The dance styles draw only here, so the classic styles' draws are untouched.
      if (bar % 4 === 0 && random() < 0.3) deepPattern = pick(DEEP_PATTERNS);
      if (bar % 4 === 0 && random() < 0.3) rollPattern = pick(ROLLING_PATTERNS);
      if (!acidSeq.length) acidSeq = makeAcid();
      else if (bar % 2 === 0 && random() < 0.5) acidSeq = mutateAcid(acidSeq);
    } else {
      if (random() < 0.3) cell = pick(PLUCK_RHYTHMS);
      if (random() < 0.15) pattern = pick(SYNTH_PATTERNS);
    }
  }
  if (style === 'acid') {
    const i = step16(pos), k = (bar % 2) * 16 + i;
    const s = acidSeq[k];
    if (!s) return 0.25;
    const midi = resolveAcid(s.code, b);
    const nextStep = acidSeq[(k + 1) % 32];
    const slideTo = s.slide && nextStep ? resolveAcid(nextStep.code, b + 0.25) : null;
    prev = midi;
    acidNote(t, midi, beat() * 0.25 * (slideTo !== null ? 1.02 : 0.6), s.accent, slideTo);
    return 0.25;
  }
  if (style === 'deep' || style === 'rolling') {
    const pat = style === 'deep' ? deepPattern : rollPattern;
    const i = step16(pos), ch = pat[i];
    if (ch !== '.' && ch !== '-') {
      const n = heldFor(pat, pos);
      const midi = resolve(ch, b, n / 4);
      prev = midi;
      if (style === 'deep') deepBass(t, midi, room(b, n / 4) * beat() * 0.85);
      else synthBass(t, midi, room(b, n / 4) * beat() * 0.7);
    }
    return 0.25;
  }

  if (GROOVE_STYLES.includes(style)) {
    // A groove style chosen mid-bar, while playing, hasn't reached the bar line that
    // draws its pattern. Without this it throws on every tick until it does, and takes
    // every voice after it in the tick with it.
    groovePattern ??= pick(GROOVE_PATTERNS[style]);
    const pat = groovePattern, i = step16(pos), ch = pat[i];
    if (ch === '.' || ch === '-') return 0.25;
    const n = heldFor(pat, pos);
    const seg = harmony.at(b);
    const beats = Math.min(n / 4, seg.end - b); // never held across a chord change
    const midi = resolve(ch, b, n / 4);
    if (style === 'disco') discoBass(t, midi, beats * beat() * 0.88);
    else if (style === 'reese') reeseBass(t, midi, beats * beat() * 0.96);
    else if (style === 'log') logDrum(t, midi, beats * beat());
    else {
      // Slide from the 808 still sounding, if there is one and it is another note.
      const from = held808 && held808.until >= t - 1e-3 && held808.midi !== midi && random() < 0.6 ? held808.midi : null;
      bass808(t, midi, beats * beat(), from);
      held808 = { midi, until: t + beats * beat() };
    }
    prev = midi;
    return 0.25;
  }

  if (style === 'sub' || style === 'rumble') {
    const seg = harmony.at(b), len = seg.end - b;
    prev = root(seg);
    (style === 'sub' ? subBass : rumbleBass)(t, prev, len * beat());
    return len;
  }

  if (style === 'walking') {
    const step = walkStep(b);
    prev = walkNote(b);
    uprightBass(t, prev, beat() * 0.95 * step, { level: 0.5 * UPRIGHT_TRIM });
    return step;
  }

  if (style === 'plucked' && state.composer >= 2) {
    // A genre chosen while a loop plays brings its own bass line straight away.
    if (figureFor !== state.language) { figure = pick(figuresFor(state.language)); figureFor = state.language; }
    const own = meterFigure(figure, FIGURES_FOR[state.language] ?? 'any');
    return figureStep(own ?? figure, t, b, pos,
      (at, midi, sec) => fingerBass(at, midi, sec * 0.9, { level: 0.42 * FINGER_TRIM }),
      // A dead note: the finger lands on a muted string.
      (at, midi) => fingerBass(at, midi, beat() * 0.12, { level: 0.42 * FINGER_TRIM * 0.45, t60: 0.08 }), !!own);
  }

  if (style === 'synth' && state.composer >= 2) {
    if (synthFor !== state.language) { synthFigure = pick(synthFiguresFor(state.language)); synthFor = state.language; }
    return figureStep(synthFigure, t, b, pos, (at, midi, sec) => synthBass(at, midi, sec * 0.9));
  }

  if (style === 'plucked') {
    let acc = 0;
    for (const [len, code] of cell) {
      if (Math.abs(acc - pos) < 1e-6) {
        const midi = resolve(code, b, len);
        prev = midi;
        fingerBass(t, midi, room(b, len) * beat() * 0.9, { level: 0.42 * FINGER_TRIM });
        return len;
      }
      if (acc > pos) return acc - pos;
      acc += len;
    }
    return B - pos;
  }

  // synth: one sixteenth step at a time
  const i = step16(pos), ch = pattern[i];
  if (ch !== '.' && ch !== '-') {
    const n = heldFor(pattern, pos);
    const midi = resolve(ch, b, n / 4);
    prev = midi;
    synthBass(t, midi, room(b, n / 4) * beat() * 0.9);
  }
  return 0.25;
}

const voice = createVoice('bass', play, {
  onReset: () => {
    prev = null; curBar = -1; groovePattern = null; held808 = null;
    // Only a dance style draws here, so a classic style's sequence of draws is untouched.
    if (FIRST_DANCE_STYLES.includes(style)) { acidSeq = makeAcid(); acidWave = random() < 0.7 ? 'sawtooth' : 'square'; }
  },
});

export const bassVoice = {
  ...voice,
  get style() { return style; },
  reroll() { style = pick(STYLES); cell = pick(PLUCK_RHYTHMS); pattern = pick(SYNTH_PATTERNS); },
  // A song's section: the patterns the styles keep from bar to bar drawn
  // afresh, not carried over from whatever played before, so the section
  // plays the same every time.
  newSection() {
    voice.draw(() => {
      if (state.composer >= 2) { figure = pick(figuresFor(state.language)); figureFor = state.language; } else cell = pick(PLUCK_RHYTHMS);
      if (state.composer >= 2) { synthFigure = pick(synthFiguresFor(state.language)); synthFor = state.language; } else pattern = pick(SYNTH_PATTERNS);
      deepPattern = pick(DEEP_PATTERNS); rollPattern = pick(ROLLING_PATTERNS);
    });
  },
  setStyle(s) { style = s; },
};
