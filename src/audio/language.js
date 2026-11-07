import { parseChord, parentOf, overBass, soundingPcs, chordInMode, seven } from './chords.js';

// ─── Genre languages ──────────────────────────────────────────────────────────
// Composer 1 keeps its progressions by mode, so every genre in a mode draws from
// one list: measured over 20,000 songs, SYNTHWAVE and REGGAETON spent 96% of their
// time on the same loops, TRANCE and EPIC 93%. And every loop was one shape: four
// equal chords, plain triads, the bass on the root. A new track changed the
// instruments and the drums; the music underneath stayed the same kind of thing.
//
// A language is how a genre writes. Which idioms it uses (a loop's skeleton, below),
// how it colours a chord, how long its chords last, how often the verse leaves the
// chorus's chords, what kind of hook it has and who can carry it. A song draws its
// chords from its language, as plain chord tokens (see chords.js).

// ─── Idioms ───────────────────────────────────────────────────────────────────
// Skeletons of loops, by what they do, in each mode. Bare chords take the language's
// colour and pace (see writeLoop); a chord written with a colour or length keeps it.
//   drone    one chord, or nearly: music that doesn't need to go anywhere
//   vamp     two chords, back and forth
//   axis     four chords going round, no strong pull home
//   descent  the bass walks down
//   circle   roots by fifths
//   cadence  chords that lead home, with a real dominant where the mode has none
//   turn     the turnarounds of jazz and soul: ii–V–I and its relations
//   blues    twelve bars
// No bare degree here lands on the mode's diminished triad; where one belongs it's
// written as one (`2^o`).
const AEOLIAN = {
  drone:   ['1', '1 1 1 7', '1 1 1 6', '1 1 1 4'],
  vamp:    ['1 4', '1 6', '1 7', '1 5', '1 3', '1 4^M'],
  axis:    ['1 6 3 7', '1 7 6 7', '1 3 7 4', '6 7 1 1', '1 6 4 7', '1 6 7 1', '6 3 7 1', '1 3 6 7'],
  descent: ['1 7 6 5', '1 7 6 5^M', '1 5/7 6 3/5', '1 7 6 7', '4 3 6 7'],
  circle:  ['1 4 7 3', '1 4 7 3 6 2^o 5^M 1', '4 7 3 6', '6 2^o 5^M 1'],
  cadence: ['1 4 5^M 1', '1 6 4 5^M', '4 5^M 1 1', '1 5^M 6 4', '6 4 5^M 1', '1 3 4 5^M', '1 b2 5^M 1'],
  turn:    ['2^m7b5 5^D7 1^m7 1^m7', '4^m7 7^D7 3^M7 6^M7', '1^m9 4^m9 2^m7b5 5^D7', '1^m7 6^M7 2^m7b5 5^D7', '3^M7 6^M7 2^m7b5 5^D7'],
  blues:   ['1^m7*4 4^m7*2 1^m7*2 6^D7 5^D7 1^m7 5^D7'],
};
const SKELETONS = {
  aeolian: AEOLIAN,
  dorian: {
    drone:   ['1', '1 1 1 4', '1 1 1 7'],
    vamp:    ['1 4', '1 7', '1 2', '1 5', '1^m9 4^D9'],
    axis:    ['1 3 4 4', '1 7 4 1', '1 3 7 4', '1 2 3 2', '1 4 3 7', '1 7 3 4', '1 5 4 1'],
    descent: ['4 3 2 1', '1 7 3 4', '1 7 4 5'],
    circle:  ['2 5 1 1', '1 4 7 3', '2 5 1 4', '5 1 4 7'],
    cadence: ['1 4 5^M 1', '2 5^M 1 1', '4 5^M 1 1', '1 3 4 5^M'],
    turn:    ['2^m7 5^D7 1^m7 1^m7', '1^m7 4^D7 7^M7 3^M7', '1^m9 4^D9 2^m7 5^D7', '3^M7 2^m7 1^m7 5^D7', '7^M7 3^M7 2^m7 5^D7'],
    blues:   ['1^m7*4 4^D7*2 1^m7*2 5^m7 4^D7 1^m7 5^D7'],
  },
  phrygian: {
    drone:   ['1', '1 1 1 2', '1 1 1 7'],
    vamp:    ['1 2', '1 7', '1 4', '1 6'],
    axis:    ['1 2 3 2', '1 6 2 1', '1 7 6 2', '1 4 2 1', '6 7 1 1', '1 3 2 1'],
    descent: ['4 3 2 1', '1 7 6 2', '4 3 2 1^M'],
    cadence: ['1 2 1 1', '1 4 2 1', '7 2 1 1', '1 6 2 1'],
    turn:    ['1^m7 2^M7 1^m7 7^m7', '6^M7 2^M7 1^m7 1^m7'],
  },
  lydian: {
    drone:   ['1', '1 1 1 2'],
    vamp:    ['1 2', '1 5', '1 6', '1 7', '1^M7 2^add9'],
    axis:    ['1 2 6 1', '1 2 7 6', '6 2 1 1', '1 3 2 1', '1 5 2 1', '1 6 2 5'],
    descent: ['1 7 6 5', '3 2 1 1', '6 5 2 1'],
    cadence: ['2 5 1 1', '5 2 1 1', '1 2 5 1'],
    turn:    ['1^M7 2^D7 7^m7 3^m7', '6^m7 2^D9 1^M9 1^M9', '3^m7 6^m7 2^D7 1^M7'],
  },
  mixolydian: {
    drone:   ['1', '1 1 1 7', '1 1 1 4'],
    vamp:    ['1 7', '1 4', '1 5', '1 2'],
    axis:    ['1 7 4 1', '1 4 7 4', '7 4 1 1', '1 6 7 1', '1 5 4 1', '1 7 6 7', '4 1 7 1'],
    descent: ['1 7 6 5', '1 7 6 4', '4 1/3 2 1'],
    cadence: ['1 4 5^M 1', '2 5^M 1 1', '4 1 5^M 1', '1 6 2 5^M'],
    turn:    ['2^m7 5^D7 1^D7 1^D7', '1^D9 4^D9 2^m7 5^D7', '6^m7 2^m7 5^D7 1^D7', '1^D7 6^D7 2^m7 5^D7'],
    blues:   ['1^D7*4 4^D7*2 1^D7*2 5^D7 4^D7 1^D7 5^D7', '1^D7 4^D7 1^D7*2 4^D7*2 1^D7*2 5^D7 4^D7 1^D7 5^D7'],
  },
  major: {
    drone:   ['1', '1 1 1 4', '1 1 1 b7'],
    vamp:    ['1 4', '1 5', '1 6', '6 4', '2 5', '1 b7'],
    axis:    ['1 5 6 4', '6 4 1 5', '1 4 6 5', '1 6 4 5', '4 5 6 6', '4 1 5 6', '1 3 4 5', '6 5 4 5', '4 5 3 6'],
    descent: ['1 5/7 6 5', '1 5/7 6 3/5 4 1/3 2 5', '6 5 4 3', '4 3 2 1', '1 5/7 6 1/5 4 1/3 2 5'],
    circle:  ['1 6 2 5', '3 6 2 5', '1 4 7^m7b5 3 6 2 5 1', '6 2 5 1'],
    cadence: ['1 4 5 1', '2 5 1 1', '4 5 1 1', '1 4 1 5', '1 2 4 5', '1 b7 4 1', '1 b6 b7 1', '1 4 4^m 1', '1 3^D7 6 4', '1 6 2^D7 5'],
    turn:    ['2^m7 5^D7 1^M7 1^M7', '1^M7 6^m7 2^m7 5^D7', '3^m7 6^m7 2^m7 5^D7', '4^M7 3^m7 2^m7 1^M7', '2^m9 5^D9 1^M9 6^m9', '4^M7 b7^D9 1^M7 1^M7', '1^M7 6^D7 2^m7 5^D7'],
    blues:   ['1^D7*4 4^D7*2 1^D7*2 5^D7 4^D7 1^D7 5^D7'],
  },
  // A minor pentatonic melody over dominant chords, the clash that is the blues.
  minor_pent: {
    ...AEOLIAN,
    drone: ['1^m7', '1^m7 1^m7 1^m7 4^D7', '1^D9'],
    vamp:  ['1^m7 4^D7', '1^m7 7^D7', '1^m7 4^m7', '1^D9 4^D9'],
    blues: ['1^D7*4 4^D7*2 1^D7*2 5^D7 4^D7 1^D7 5^D7', '1^D7 4^D7 1^D7*2 4^D7*2 1^D7*2 5^D7 4^D7 1^D7 5^D7'],
  },
};
const skeletonsFor = name => SKELETONS[name] ?? SKELETONS[parentOf(name)];

// ─── Pace ─────────────────────────────────────────────────────────────────────
// How long a loop's chords last, in chord lengths, by how many chords it has: the
// harmonic rhythm. Lengths add up to 2, 4 or 8, so a loop still fits the bar lines.
const PACES = {
  even: { 1: [[2], [4]], 2: [[1, 1], [2, 2]], 3: [[2, 1, 1], [1, 1, 2]], 4: [[1, 1, 1, 1]] },
  // Long stretches on one chord, then a move.
  long: { 1: [[2], [4]], 2: [[2, 2], [3, 1], [1, 1]], 3: [[2, 1, 1], [2, 1, 1], [1, 1, 2]], 4: [[1, 1, 1, 1]] },
  // Off the bar line: a chord pushed in early or held over.
  lilt: {
    1: [[2]], 2: [[1, 1], [3, 1], [1.5, 0.5]], 3: [[2, 1, 1], [1.5, 1.5, 1], [1, 1, 2]],
    4: [[1, 1, 1, 1], [1, 1, 1, 1], [1.5, 0.5, 1.5, 0.5], [2, 1, 0.5, 0.5], [1, 1, 1.5, 0.5]],
  },
  // Two chords to a bar, some of the time.
  quick: {
    1: [[2]], 2: [[1, 1], [0.5, 0.5]], 3: [[1, 0.5, 0.5], [2, 1, 1]],
    4: [[1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 1, 2]],
  },
};

// ─── The languages ────────────────────────────────────────────────────────────
//   idioms   how likely each idiom is, for the song's main loop
//   colours  how likely each colour is on a bare chord. `sus4r` hangs on a suspended
//            fourth for the first half of the chord and resolves it
//   pace     see PACES
//   same     how often the verse stays on the chorus's chords. Often is fine: the
//            song that prompted all this rides one loop for four and a half minutes
//   pedal    how often the verse holds the tonic in the bass under its chords
//   inv      how likely a chord is to take its third in the bass when that makes
//            the bass walk by step
//   hook     kinds: riff or topline, how likely each. A riff is a figure of a bar or
//            two; a topline is a sung four-bar line
//            riff, topline: which rhythms it uses (see CELLS in hook.js)
//            range: [lo, hi] semitones, what the writer aims for
//            off: the share of notes off the chord it aims for
//   voices   who can carry the hook, best first. A kit rolled without any of them
//            gets one of the first two; bells and the like only count if they come
//            first, in the genres they suit, since elsewhere their long notes can
//            only play the hook's bones
const CLAVE = ['tresillo', 'tresillo', 'habanera', 'son', 'rumba', 'gahu', 'lope', 'push'];
const HOUSE = ['off', 'push', 'skip', 'twostep', 'son', 'tresillo'];
const HYPNO = ['eighths', 'off', 'climb', 'tresillo', 'push', 'drive'];
const DRIVE = ['gallop', 'drive', 'eighths', 'climb', 'tresillo', 'skip'];
const FUNK  = ['funk', 'hit', 'slap', 'twostep', 'skip'];
const LYRIC = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8', 'line9'];
const BOP   = ['bop1', 'bop2', 'bop3', 'line4', 'line3', 'push'];
const SLOW  = ['slow1', 'slow2', 'slow4', 'slow5', 'line5', 'line6', 'line8'];

const LANGUAGES = {
  'ANY': {
    idioms: { axis: 3, vamp: 2, descent: 2, cadence: 2, circle: 1, turn: 1, drone: 1 },
    colours: { '': 4, 7: 2, add9: 1, sus4r: 1, 9: 1 }, pace: 'lilt', same: 0.5, pedal: 0.15, inv: 0.2,
    hook: { kinds: { riff: 1, topline: 1 }, riff: [...CLAVE, ...HYPNO], topline: LYRIC, range: [7, 14], off: 0.25 },
    voices: ['melody', 'monolead', 'mallet', 'kalimba', 'flute', 'vibraphone', 'arpeggio', 'sawpluck', 'vox', 'clavinet', 'brass', 'sitar', 'harp', 'glass', 'bell', 'texture'],
  },
  // ─── Electronic ─────────────────────────────────────────────────────────────
  'DEEP HOUSE': {
    idioms: { vamp: 4, axis: 2, drone: 1 }, colours: { 9: 5, 7: 3 }, pace: 'long', same: 0.8, pedal: 0.2, inv: 0,
    hook: { kinds: { riff: 3, topline: 1 }, riff: HOUSE, topline: LYRIC, range: [5, 12], off: 0.3 },
    voices: ['vox', 'sawpluck', 'mallet', 'glass'],
  },
  'NU-DISCO': {
    idioms: { circle: 3, turn: 3, vamp: 2, axis: 1 }, colours: { 7: 4, 9: 3, '': 1 }, pace: 'lilt', same: 0.5, pedal: 0.1, inv: 0.1,
    hook: { kinds: { riff: 1, topline: 1 }, riff: ['eighths', 'off', 'push', 'hit', 'son'], topline: LYRIC, range: [7, 14], off: 0.25 },
    voices: ['clavinet', 'vox', 'brass', 'sawpluck'],
  },
  'AFRO HOUSE': {
    idioms: { vamp: 3, axis: 2, drone: 1 }, colours: { 7: 3, '': 2, 9: 1 }, pace: 'long', same: 0.8, pedal: 0.2, inv: 0,
    hook: { kinds: { riff: 4, topline: 1 }, riff: CLAVE, topline: LYRIC, range: [5, 12], off: 0.3 },
    voices: ['kalimba', 'mallet', 'vox', 'flute'],
  },
  // Written from the song that prompted all this: one loop, ninths, a 3-3-2 riff.
  'AMAPIANO': {
    idioms: { axis: 3, turn: 3, vamp: 2 }, colours: { 9: 4, 7: 3 }, pace: 'even', same: 0.85, pedal: 0.1, inv: 0,
    hook: { kinds: { riff: 5, topline: 1 }, riff: CLAVE, topline: LYRIC, range: [7, 12], off: 0.33 },
    voices: ['mallet', 'kalimba', 'flute', 'vox'],
  },
  'TECHNO': {
    idioms: { drone: 5, vamp: 2 }, colours: { '': 3, 7: 1, q: 1, sus2: 1 }, pace: 'long', same: 0.9, pedal: 0.3, inv: 0,
    hook: { kinds: { riff: 1 }, riff: HYPNO, topline: LYRIC, range: [3, 8], off: 0.25 },
    voices: ['arpeggio', 'sawpluck', 'monolead'],
  },
  'MELODIC TECHNO': {
    idioms: { vamp: 3, axis: 2, descent: 2 }, colours: { '': 3, add9: 1, sus2: 1, 7: 1 }, pace: 'long', same: 0.7, pedal: 0.25, inv: 0,
    hook: { kinds: { riff: 3, topline: 1 }, riff: HYPNO, topline: SLOW, range: [5, 12], off: 0.2 },
    voices: ['arpeggio', 'sawpluck', 'monolead', 'vox'],
  },
  'TRANCE': {
    idioms: { axis: 5, descent: 2, cadence: 1 }, colours: { '': 4, sus4r: 2, add9: 1 }, pace: 'even', same: 0.7, pedal: 0.1, inv: 0,
    hook: { kinds: { topline: 3, riff: 2 }, riff: DRIVE, topline: LYRIC, range: [7, 14], off: 0.15 },
    voices: ['sawpluck', 'monolead', 'arpeggio', 'vox'],
  },
  'EDM': {
    idioms: { axis: 6, cadence: 1 }, colours: { '': 3, add9: 1, sus4r: 1 }, pace: 'even', same: 0.7, pedal: 0.1, inv: 0,
    hook: { kinds: { riff: 3, topline: 2 }, riff: DRIVE, topline: LYRIC, range: [5, 12], off: 0.15 },
    voices: ['sawpluck', 'vox', 'monolead'],
  },
  'UK GARAGE': {
    idioms: { vamp: 3, turn: 2, axis: 2 }, colours: { 9: 4, 7: 3, 6: 1 }, pace: 'lilt', same: 0.6, pedal: 0.1, inv: 0,
    hook: { kinds: { riff: 3, topline: 1 }, riff: ['twostep', 'skip', 'push', 'son', 'habanera'], topline: LYRIC, range: [5, 12], off: 0.3 },
    voices: ['vox', 'sawpluck', 'glass'],
  },
  'LIQUID DNB': {
    idioms: { turn: 3, axis: 3, vamp: 1, descent: 1 }, colours: { 9: 4, 7: 3 }, pace: 'even', same: 0.4, pedal: 0.1, inv: 0.15,
    hook: { kinds: { topline: 3, riff: 1 }, riff: HOUSE, topline: [...LYRIC, ...SLOW], range: [7, 14], off: 0.3 },
    voices: ['vox', 'arpeggio', 'glass', 'bell'],
  },
  'SYNTHWAVE': {
    idioms: { axis: 5, descent: 3, cadence: 1, vamp: 1 }, colours: { '': 5, sus4r: 2, add9: 1, 7: 1 }, pace: 'even', same: 0.5, pedal: 0.15, inv: 0.1,
    hook: { kinds: { topline: 3, riff: 2 }, riff: DRIVE, topline: LYRIC, range: [7, 14], off: 0.15 },
    voices: ['monolead', 'arpeggio', 'sawpluck'],
  },
  'FUTURE BASS': {
    idioms: { axis: 6, cadence: 1, descent: 1 }, colours: { add9: 3, 7: 3, 9: 2, sus2: 1 }, pace: 'lilt', same: 0.5, pedal: 0.1, inv: 0,
    hook: { kinds: { topline: 3, riff: 1 }, riff: ['tresillo', 'push', 'skip'], topline: LYRIC, range: [7, 14], off: 0.25 },
    voices: ['vox', 'sawpluck'],
  },
  'TRAP': {
    idioms: { vamp: 3, drone: 2, descent: 2, axis: 1 }, colours: { '': 4, 7: 1 }, pace: 'long', same: 0.8, pedal: 0.2, inv: 0,
    hook: { kinds: { riff: 3, topline: 1 }, riff: ['tresillo', 'lope', 'son', 'slow4', 'line3'], topline: SLOW, range: [5, 10], off: 0.2 },
    voices: ['bell', 'glass', 'flute', 'monolead', 'sawpluck'],
  },
  'REGGAETON': {
    idioms: { axis: 6, vamp: 1 }, colours: { '': 4, 7: 1 }, pace: 'even', same: 0.85, pedal: 0.05, inv: 0,
    hook: { kinds: { riff: 4, topline: 1 }, riff: CLAVE, topline: LYRIC, range: [5, 12], off: 0.15 },
    voices: ['sawpluck', 'monolead', 'vox'],
  },
  'AFROBEATS': {
    idioms: { axis: 4, vamp: 2 }, colours: { '': 2, 7: 2, 9: 1, 6: 1 }, pace: 'lilt', same: 0.7, pedal: 0.1, inv: 0,
    hook: { kinds: { riff: 3, topline: 2 }, riff: CLAVE, topline: LYRIC, range: [5, 12], off: 0.25 },
    voices: ['kalimba', 'mallet', 'vox', 'flute'],
  },
  'LO-FI': {
    idioms: { turn: 6, descent: 2, vamp: 1 }, colours: { 9: 4, 7: 3, 6: 1 }, pace: 'lilt', same: 0.5, pedal: 0.1, inv: 0.2,
    hook: { kinds: { topline: 1, riff: 1 }, riff: ['line3', 'lope', 'push', 'bop3'], topline: [...BOP, ...SLOW], range: [5, 12], off: 0.35 },
    voices: ['vibraphone', 'mallet', 'flute', 'glass'],
  },
  'ELEC': {
    idioms: { vamp: 2, drone: 2, axis: 2 }, colours: { '': 3, 7: 1, q: 1 }, pace: 'long', same: 0.8, pedal: 0.2, inv: 0,
    hook: { kinds: { riff: 1 }, riff: [...HYPNO, 'hit'], topline: LYRIC, range: [5, 12], off: 0.2 },
    voices: ['arpeggio', 'sawpluck', 'monolead'],
  },
  // ─── Classic ────────────────────────────────────────────────────────────────
  'AMBIENT': {
    idioms: { drone: 4, vamp: 3, axis: 1 }, colours: { add9: 3, sus2: 2, 7: 2, q: 2 }, pace: 'long', same: 0.7, pedal: 0.4, inv: 0,
    hook: { kinds: { topline: 1 }, riff: SLOW, topline: SLOW, range: [5, 12], off: 0.25 },
    voices: ['glass', 'bell', 'harp', 'texture'],
  },
  'DARK': {
    idioms: { drone: 3, vamp: 3, descent: 2 }, colours: { '': 4, 7: 1, sus2: 1 }, pace: 'long', same: 0.7, pedal: 0.35, inv: 0,
    hook: { kinds: { topline: 2, riff: 1 }, riff: ['slow4', 'lope', 'line3'], topline: SLOW, range: [3, 10], off: 0.2 },
    voices: ['bell', 'brass', 'glass', 'texture'],
  },
  'JAZZ': {
    idioms: { turn: 6, blues: 1, vamp: 1 }, colours: { 9: 4, 7: 4, 6: 1 }, pace: 'lilt', same: 0.3, pedal: 0.05, inv: 0.1,
    hook: { kinds: { topline: 4, riff: 1 }, riff: BOP, topline: BOP, range: [7, 15], off: 0.4 },
    voices: ['vibraphone', 'brass', 'melody', 'flute', 'clavinet'],
  },
  'ORCH': {
    idioms: { cadence: 4, descent: 3, axis: 2, circle: 2 }, colours: { '': 5, 7: 1 }, pace: 'even', same: 0.25, pedal: 0.15, inv: 0.45,
    hook: { kinds: { topline: 1 }, riff: LYRIC, topline: LYRIC, range: [7, 15], off: 0.2 },
    voices: ['flute', 'brass', 'melody', 'harp', 'mallet'],
  },
  'ZEN': {
    idioms: { drone: 4, vamp: 2 }, colours: { q: 3, sus2: 2, add9: 1 }, pace: 'long', same: 0.8, pedal: 0.4, inv: 0,
    hook: { kinds: { topline: 2, riff: 1 }, riff: SLOW, topline: SLOW, range: [5, 10], off: 0.2 },
    voices: ['kalimba', 'flute', 'glass', 'harp'],
  },
  'BLUES': {
    idioms: { blues: 6, vamp: 1 }, colours: { 7: 3, '': 1 }, pace: 'even', same: 0.6, pedal: 0, inv: 0,
    hook: { kinds: { topline: 3, riff: 1 }, riff: ['line3', 'bop2', 'hit'], topline: [...BOP, 'line3', 'line4'], range: [5, 12], off: 0.35 },
    voices: ['brass', 'melody', 'clavinet'],
  },
  'FOLK': {
    idioms: { cadence: 4, axis: 3, vamp: 1 }, colours: { '': 5, add9: 1, sus4r: 1 }, pace: 'even', same: 0.4, pedal: 0.1, inv: 0.4,
    hook: { kinds: { topline: 3, riff: 1 }, riff: ['eighths', 'climb', 'tresillo'], topline: LYRIC, range: [7, 12], off: 0.15 },
    voices: ['flute', 'melody', 'harp', 'kalimba', 'mallet'],
  },
  'DREAM': {
    idioms: { vamp: 3, axis: 2, drone: 1 }, colours: { 7: 3, add9: 3, sus2: 1 }, pace: 'long', same: 0.6, pedal: 0.25, inv: 0.1,
    hook: { kinds: { topline: 3, riff: 1 }, riff: SLOW, topline: SLOW, range: [5, 12], off: 0.25 },
    voices: ['glass', 'bell', 'vox', 'harp'],
  },
  'FUNK': {
    idioms: { drone: 4, vamp: 4 }, colours: { 9: 3, 7: 3 }, pace: 'lilt', same: 0.7, pedal: 0.05, inv: 0,
    hook: { kinds: { riff: 4, topline: 1 }, riff: FUNK, topline: BOP, range: [5, 12], off: 0.3 },
    voices: ['clavinet', 'brass', 'monolead'],
  },
  'EPIC': {
    idioms: { axis: 4, descent: 3, cadence: 2 }, colours: { '': 4, sus4r: 1, add9: 1 }, pace: 'even', same: 0.5, pedal: 0.2, inv: 0.15,
    hook: { kinds: { topline: 3, riff: 1 }, riff: DRIVE, topline: SLOW, range: [7, 14], off: 0.15 },
    voices: ['brass', 'bell', 'melody', 'flute'],
  },
};

// ─── Melodic intervals (composer 3) ───────────────────────────────────────────
// Composer 2's hooks all aimed at one idea of a good tune, so measured across genres
// their rhythms differed and their intervals barely did: a techno riff moved like a
// folk melody. A genre's tune is largely its intervals. Techno and funk hammer one
// note and jump the octave, trance and synthwave climb in fifths and octaves, folk and
// liquid walk by step, blues circles on repeated notes and minor thirds, ambient and
// Zen open out in fourths and fifths.
//   moves     how much of the line is each kind of move: the same note, a step
//             (1–2 semitones), a third (3–4), a fourth or fifth (5–7), or further
//   range     [lo, hi] semitones the writer aims for, as `hook.range` is in composer 2
//   span      [down, up] scale steps a line can go from its centre
//   approach  how often a weak note a step from a strong chord tone slides into it
//             chromatically: the semitone from outside the scale that says jazz, or
//             the flat five that says blues
// Kept apart from LANGUAGES, whose tables composer 2 is still reading: its songs
// must go on being what they were.
const INTERVALS = {
  //                         same step third wide jump
  'ANY':            { moves: [6,  50, 26, 13, 5],  range: [7, 14],  span: [5, 7] },
  'DEEP HOUSE':     { moves: [15, 35, 30, 15, 5],  range: [5, 12],  span: [4, 6] },
  'NU-DISCO':       { moves: [10, 35, 20, 13, 22], range: [10, 16], span: [5, 8], approach: 0.1 },
  'AFRO HOUSE':     { moves: [18, 45, 25, 10, 2],  range: [5, 10],  span: [4, 5] },
  // The song that prompted all this measures 0, 61, 26, 13, 0.
  'AMAPIANO':       { moves: [3,  58, 25, 13, 1],  range: [7, 12],  span: [5, 6] },
  'TECHNO':         { moves: [30, 40, 8,  5,  17], range: [5, 13],  span: [3, 7] },
  'MELODIC TECHNO': { moves: [12, 45, 20, 18, 5],  range: [7, 13],  span: [5, 7] },
  'TRANCE':         { moves: [8,  35, 20, 22, 15], range: [10, 16], span: [6, 8] },
  'EDM':            { moves: [15, 35, 18, 22, 10], range: [7, 14],  span: [5, 7] },
  'UK GARAGE':      { moves: [15, 40, 27, 13, 5],  range: [5, 12],  span: [4, 6] },
  'LIQUID DNB':     { moves: [5,  57, 25, 10, 3],  range: [7, 14],  span: [5, 7] },
  'SYNTHWAVE':      { moves: [5,  32, 28, 20, 15], range: [9, 16],  span: [6, 8] },
  'FUTURE BASS':    { moves: [10, 30, 20, 25, 15], range: [9, 16],  span: [5, 8] },
  'TRAP':           { moves: [30, 47, 13, 7,  3],  range: [3, 9],   span: [3, 5] },
  'REGGAETON':      { moves: [25, 52, 16, 5,  2],  range: [4, 9],   span: [4, 4] },
  'AFROBEATS':      { moves: [20, 47, 23, 8,  2],  range: [5, 10],  span: [4, 5] },
  'LO-FI':          { moves: [4,  38, 30, 16, 12], range: [7, 14],  span: [5, 7], approach: 0.2 },
  'ELEC':           { moves: [15, 25, 30, 15, 15], range: [7, 14],  span: [4, 7] },
  'AMBIENT':        { moves: [5,  22, 18, 35, 20], range: [9, 16],  span: [6, 8] },
  'DARK':           { moves: [22, 52, 13, 10, 3],  range: [3, 9],   span: [3, 5], approach: 0.15 },
  'JAZZ':           { moves: [3,  48, 22, 15, 12], range: [9, 16],  span: [6, 8], approach: 0.35 },
  'ORCH':           { moves: [5,  55, 18, 10, 12], range: [9, 15],  span: [6, 7] },
  'ZEN':            { moves: [10, 18, 27, 40, 5],  range: [5, 12],  span: [4, 6] },
  'BLUES':          { moves: [25, 30, 30, 12, 3],  range: [5, 12],  span: [4, 6], approach: 0.3 },
  'FOLK':           { moves: [15, 57, 22, 5,  1],  range: [5, 10],  span: [4, 5] },
  'DREAM':          { moves: [5,  28, 22, 27, 18], range: [9, 16],  span: [6, 8] },
  'FUNK':           { moves: [30, 28, 15, 5,  22], range: [5, 13],  span: [3, 7], approach: 0.2 },
  'EPIC':           { moves: [8,  32, 14, 28, 18], range: [9, 16],  span: [6, 8] },
};

// A language's melodic intervals, for a composer that has them. Composer 4 is strict
// about what a line's strong notes can be (see hook.js), and only the languages free to
// leave the mode slide in from outside it.
export function intervalsFor(name, composer) {
  if (composer < 3) return null;
  const spoken = INTERVALS[name] ?? INTERVALS.ANY;
  if (composer < 4) return spoken;
  return { ...spoken, strict: true, approach: OUTSIDE[name] === 'free' ? spoken.approach : 0 };
}

// ─── Revisions (composer 4) ───────────────────────────────────────────────────
// The first listen to a song against the one that prompted all this, with the same
// instruments, key and tempo, drew C♯m7♭5–F♯7–Bm where it has Bm–G–D–A: the sound of a
// jazz standard, on a dance record. A half-diminished chord and the dominant it leads to
// belong to a few languages; the others get their richness from diatonic sevenths and
// ninths, which is what that song's Rhodes was doing all along.
const KEEPS_JAZZ = new Set(['ANY', 'JAZZ', 'LO-FI', 'BLUES', 'ORCH', 'EPIC', 'DARK']);
const isJazz = skeleton => /m7b5|\^o/.test(skeleton);
// What `turn` offers without them, by mode. (Only Aeolian's needs replacing: the others'
// turnarounds have no half-diminished chord to lose.)
const PLAIN_TURNS = {
  aeolian: ['4^m7 7^D7 3^M7 6^M7', '1^m9 4^m9 7^D9 3^M7', '1^m9 6^M7 4^m9 7^D9', '6^M7 7^D9 1^m9 1^m9', '1^m7 3^M7 4^m7 7^D7'],
};
const REVISIONS = {
  // That song's loop is an axis; a turnaround should be the exception.
  'AMAPIANO': { idioms: { axis: 5, turn: 2, vamp: 2 } },
};

// Staying in key. Composer 1 could only play the mode's own notes, and measured on 720
// songs, not one note of them left it. Composers 2 and 3 spent 3% of their time outside,
// 14% on the song that showed it: the chords' colours, a borrowed chord here and there,
// and the listener heard wrong notes, because in a loop with no jazz in it, that's what
// they are. So what a language may do outside its mode:
//   free      anything: jazz, blues and funk are made of it
//   dominant  a chord on the fifth, whose leading tone pulls back home, and nothing else
//   none      nothing (every other language)
const OUTSIDE = {
  'JAZZ': 'free', 'BLUES': 'free', 'FUNK': 'free',
  'ORCH': 'dominant', 'EPIC': 'dominant', 'FOLK': 'dominant', 'DARK': 'dominant', 'ANY': 'dominant',
};

function allowed(token, scaleName, lang) {
  if (lang.outside === 'free') return true;
  const c = parseChord(token, scaleName);
  return chordInMode(c, scaleName) || (lang.outside === 'dominant' && c.root === seven(scaleName)[4]);
}

// A language as a composer writes it: composers before 4 have it as it was, so their
// songs go on being what they were.
export function languageFor(name, composer) {
  const lang = languageOf(name);
  return composer >= 4 ? { ...lang, ...REVISIONS[name], plain: !KEEPS_JAZZ.has(name), outside: OUTSIDE[name] ?? 'none' } : lang;
}

// Share links store a language by its place in this list, so the order is fixed:
// only ever append.
export const LANGUAGE_NAMES = [
  'ANY', 'DEEP HOUSE', 'NU-DISCO', 'AFRO HOUSE', 'AMAPIANO', 'TECHNO', 'MELODIC TECHNO', 'TRANCE', 'EDM',
  'UK GARAGE', 'LIQUID DNB', 'SYNTHWAVE', 'FUTURE BASS', 'TRAP', 'REGGAETON', 'AFROBEATS', 'LO-FI', 'ELEC',
  'AMBIENT', 'DARK', 'JAZZ', 'ORCH', 'ZEN', 'BLUES', 'FOLK', 'DREAM', 'FUNK', 'EPIC',
];

export const languageOf = name => LANGUAGES[name] ?? LANGUAGES.ANY;

// ─── Writing a loop ───────────────────────────────────────────────────────────
const pickOf = (r, a) => a[Math.floor(r() * a.length)];

export function weighted(r, weights) {
  const entries = Object.entries(weights);
  let w = r() * entries.reduce((s, [, n]) => s + n, 0);
  for (const [k, n] of entries) if ((w -= n) <= 0) return k;
  return entries[0][0];
}

// A colour for a bare chord, less often than a plain triad the tighter the Harmony
// control's lock: 0.85 is a language's own balance, a looser one hears more colour.
function colourFor(r, lang, lock) {
  const weights = { ...lang.colours };
  if ('' in weights) weights[''] *= Math.max(0.25, (lock / 0.85) ** 3);
  return weighted(r, weights);
}

// `tokens` with lengths from the language's pace, if none is written.
function paced(r, lang, tokens) {
  if (tokens.some(t => t.includes('*')) || tokens.length > 4) return tokens;
  const d = pickOf(r, PACES[lang.pace][tokens.length]);
  return tokens.map((t, i) => (d[i] === 1 ? t : `${t}*${d[i]}`));
}

// Each bare chord takes a colour, the same one wherever it comes round in the loop.
// A suspension is an event, so a loop has one at most, and not on a chord that's
// already sounding. A chord that follows itself is one chord, held. A language keeping
// to its mode only takes a colour that does: a plain triad otherwise.
function coloured(r, lang, tokens, lock, scaleName) {
  const chosen = new Map(), out = [];
  let suspended = false, before = null;
  for (const t of tokens) {
    const [, head, rest] = /^([^/*]+)(.*)$/.exec(t);
    if (t.includes('^')) { out.push(t); before = head; continue; }
    if (!chosen.has(head)) {
      let c = colourFor(r, lang, lock);
      if (lang.outside) {
        if (c === 'q') c = 'qm';
        if (c && !allowed(`${head}^${c === 'sus4r' ? 'sus4' : c}`, scaleName, lang)) c = '';
      }
      chosen.set(head, c);
    }
    let c = chosen.get(head);
    if (c === 'sus4r' && (suspended || head === before)) c = '';
    if (c === 'sus4r') {
      // Hangs on the suspension, then resolves: half the chord's length each.
      suspended = true;
      const dur = /\*([\d.]+)/.exec(rest)?.[1] ?? 1;
      const bass = rest.replace(/\*[\d.]+/, '');
      out.push(`${head}^sus4${bass}*${dur / 2}`, `${head}${bass}*${dur / 2}`);
    } else {
      out.push(c ? `${head}^${c}${rest}` : t);
    }
    before = head;
  }
  return held(out);
}

// Adds up a chord that follows itself.
function held(tokens) {
  const out = [];
  for (const t of tokens) {
    const [, name, dur] = /^([^*]+)(?:\*([\d.]+))?$/.exec(t);
    const last = out[out.length - 1];
    if (last?.name === name) last.dur += +(dur ?? 1);
    else out.push({ name, dur: +(dur ?? 1) });
  }
  return out.map(({ name, dur }) => (dur === 1 ? name : `${name}*${dur}`));
}

const fold12 = n => { const m = ((n % 12) + 12) % 12; return m > 6 ? 12 - m : m; };

// Takes a chord's third into the bass where that makes the bass walk by step and
// its root wouldn't: what makes a bass line a line rather than a list of roots.
function walked(r, lang, tokens, scaleName) {
  if (!lang.inv) return tokens;
  const out = [tokens[0]];
  let bass = parseChord(tokens[0], scaleName).bass;
  for (const t of tokens.slice(1)) {
    const c = parseChord(t, scaleName);
    const third = (c.root + c.tones[1]) % 12;
    const hasThird = c.tones[1] === 3 || c.tones[1] === 4;
    const take = c.bass === c.root && hasThird && fold12(third - bass) <= 2 && fold12(c.root - bass) > 2 && r() < lang.inv;
    out.push(take ? overBass(t, `@${third}`) : t);
    bass = take ? third : c.bass;
  }
  return out;
}

// One loop in this language: chord tokens. `idioms` (default the language's own)
// are how likely each idiom is; loops in `avoid` aren't drawn again if there's a
// choice. Idioms the mode doesn't have are left out.
export function writeLoop(r, lang, scaleName, lock, { idioms = lang.idioms, avoid = [] } = {}) {
  const lib = skeletonsFor(scaleName);
  const usable = Object.fromEntries(Object.entries(idioms).filter(([k]) => lib[k]?.length));
  const tag = Object.keys(usable).length ? weighted(r, usable) : 'axis';
  const seen = new Set(avoid.map(a => a.skeleton));
  let pool = lib[tag];
  if (lang.plain) pool = (tag === 'turn' && PLAIN_TURNS[parentOf(scaleName)]) || pool.filter(s => !isJazz(s));
  if (lang.outside) pool = pool.filter(s => s.split(' ').every(t => allowed(t, scaleName, lang)));
  if (!pool.length) pool = lib.axis;
  const fresh = pool.filter(s => !seen.has(s));
  const skeleton = pickOf(r, fresh.length ? fresh : pool);
  const tokens = walked(r, lang, coloured(r, lang, paced(r, lang, skeleton.split(' ')), lock, scaleName), scaleName);
  tokens.skeleton = skeleton;
  return tokens;
}

const CALM = { drone: 2, vamp: 3 };
const LEAVING = { descent: 3, circle: 2, cadence: 2, axis: 1 };
const RISING = { cadence: 3, vamp: 1, axis: 1 };

// A song's chords: a loop per part of it, as song.js's sections name them. Unlike
// composer 1's, a song needn't change loop to be a song; a verse that does often
// moves less than the chorus, and now and then sits on a pedal.
export function writeProgressions(r, lang, scaleName, lock) {
  const loop = (idioms, ...avoid) => writeLoop(r, lang, scaleName, lock, { idioms, avoid });
  const main = loop(lang.idioms);
  let verse = r() < lang.same ? main : loop(r() < 0.5 ? CALM : lang.idioms, main);
  if (r() < lang.pedal) {
    const { skeleton } = verse;
    // A chord with a note a semitone from the pedal grinds against it, the leading tone
    // of a major V above all. A language keeping to its mode lets the bass move there.
    const grinds = t => lang.outside && soundingPcs(parseChord(t, scaleName)).some(pc => pc === 1 || pc === 11);
    verse = verse.map(t => (grinds(t) ? t : overBass(t, '1')));
    verse.skeleton = skeleton;
  }
  return {
    main,
    chorus: main,
    verse,
    theme:  verse,
    pre:    loop(RISING, main, verse),
    // A jazz turnaround only where the language has them: not in a synthwave bridge.
    bridge: loop(lang.idioms.turn ? { ...LEAVING, turn: 3 } : LEAVING, main, verse),
    break:  r() < 0.6 ? main : loop(CALM, main),
    drift:  loop(CALM, verse),
  };
}

// The chord a build can hold over its last bars, by mode: the one that pulls hardest
// toward the tonic. As tokens; see TENSION in song.js for composer 1's.
const HOLDS = {
  aeolian: ['5^D7', '7', '6'], dorian: ['4', '7', '5^D7'], phrygian: ['2', '7'], lydian: ['2', '5'],
  mixolydian: ['7', '4', '5^D7'], major: ['5^D7', '4', '5^7sus'], minor_pent: ['5^D7', '4'], major_pent: ['5^7sus', '4'],
};
export function holdsFor(name, lang) {
  return lang.outside ? HOLDS[name].filter(t => allowed(t, name, lang)) : HOLDS[name];
}

// A loop or an era's chords: no song to say otherwise, so its main loop, stated
// twice with a contrasting one after, as composer 1's forms are. Short forms and
// fixed ones repeat as they are.
export function freeForm(r, name, scaleName, lock, composer) {
  const lang = languageFor(name, composer);
  const a = writeLoop(r, lang, scaleName, lock);
  if (a.length < 4) return a;
  const b = writeLoop(r, lang, scaleName, lock, { avoid: [a] });
  return [...a, ...a, ...b, ...a];
}

// Who can carry a hook in this language, best first.
export const voicesOf = name => languageOf(name).voices;
