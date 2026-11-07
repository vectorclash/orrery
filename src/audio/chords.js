import { SCALES } from '../state.js';

// ─── Chords ───────────────────────────────────────────────────────────────────
// Composer 2's chord: a root and intervals, not a scale degree, so it can be a
// 9th, a sus chord, an inversion, or a chord from outside the key. (Composer 1's
// chords are scale degrees with diatonic thirds stacked on them; old share links
// go on playing those, note for note. See `state.composer`.)
//
// Chords are written as tokens, plain strings, so a song stays plain data and a
// live change of mode can read the same tokens in the new mode:
//
//   degree[^colour][/bass][*length]
//
//   degree  1–7, the mode's own degree: `6` in Aeolian is its major ♭VI. A `b` or
//           `#` moves it out of the mode (`b7` in Major); `@n` is n semitones
//           above the tonic, for a chord from another key.
//   colour  how the chord is filled in (see COLOURS); none is the mode's triad.
//   bass    the note in the bass, the same way, or `/@n`: `5/7` is V over its
//           third. Without one, the root.
//   length  in chord lengths (the Chord control's beats): `*2` is twice as long,
//           `*.5` half. A loop's chords needn't be equal.
//
// Pentatonic modes read chords from their parent mode: the melody keeps to the
// five notes, the harmony underneath doesn't have to.

const PARENT = { minor_pent: 'aeolian', major_pent: 'major' };
export const isPent = name => name in PARENT;
export const parentOf = name => PARENT[name] ?? name;
export const seven = name => SCALES[parentOf(name)];

const mod = (n, m) => ((n % m) + m) % m;

// Each colour: from the mode's stacked thirds `b` (root, 3rd, 5th, 7th, 9th, in
// semitones above the root) to the five tones this chord offers, and how many of
// them sound in a chord voice. All five are always there, because some voices
// ask for more than sound in the pads: a Rhodes plays 3-5-7-9 whatever the bed
// does, the way a keyboard player colours a plain chord.
const COLOURS = {
  '':     b => [b, 3],
  7:      b => [b, 4],
  9:      b => [b, b[4] % 12 === 1 ? 4 : 5], // a ♭9 over the root is an avoid note
  add9:   b => [[0, b[1], b[2], 14, b[3]], 4],
  6:      b => [[0, b[1], b[2], 9, 14], 4],
  sus2:   b => [[0, 2, 7, b[3], 14], 3],
  sus4:   b => [[0, 5, 7, b[3], 14], 3],
  '7sus': () => [[0, 5, 7, 10, 14], 4],
  q:      () => [[0, 5, 10, 15, 19], 3], // quartal: stacked perfect fourths, in or out of the mode
  // Quartal in the mode: every note a step of its scale, the fourths falling as they may.
  qm:     (b, scale, d) => {
    if (d === null) return [[0, 5, 10, 15, 19], 3];
    return [[0, 3, 6, 9, 12].map(k => scale[(d + k) % 7] + 12 * Math.floor((d + k) / 7) - scale[d]), 3];
  },
  5:      () => [[0, 7, 12, 19, 24], 3], // a power chord: root, fifth, octave
  M:      () => [[0, 4, 7, 10, 14], 3],
  m:      () => [[0, 3, 7, 10, 14], 3],
  M7:     () => [[0, 4, 7, 11, 14], 4],
  m7:     () => [[0, 3, 7, 10, 14], 4],
  D7:     () => [[0, 4, 7, 10, 14], 4], // dominant
  M9:     () => [[0, 4, 7, 11, 14], 5],
  m9:     () => [[0, 3, 7, 10, 14], 5],
  D9:     () => [[0, 4, 7, 10, 14], 5],
  m6:     () => [[0, 3, 7, 9, 14], 4],
  o:      () => [[0, 3, 6, 9, 14], 3],
  o7:     () => [[0, 3, 6, 9, 14], 4],
  m7b5:   () => [[0, 3, 6, 10, 14], 4],
  '+':    () => [[0, 4, 8, 11, 14], 3],
};

const TOKEN = /^(@\d+|[b#]?[1-7])(?:\^([^/*]+))?(?:\/(@\d+|[b#]?[1-7]))?(?:\*([\d.]+))?$/;

// Semitones above the tonic of `1`, `b7`, `@9`, and whether it's outside the mode.
function place(text, scale) {
  if (text[0] === '@') return [mod(+text.slice(1), 12), true];
  const alter = text[0] === 'b' ? -1 : text[0] === '#' ? 1 : 0;
  return [mod(scale[+text.slice(alter ? 1 : 0) - 1] + alter, 12), alter !== 0];
}

// The mode's stacked thirds on degree `d`: root, 3rd, 5th, 7th, 9th.
function stacked(scale, d) {
  return [0, 2, 4, 6, 8].map(k => scale[(d + k) % 7] + 12 * Math.floor((d + k) / 7) - scale[d]);
}

const cache = new Map();

// A token, read in a mode: { token, root, tones, n, bass, dur }. `root` and `bass`
// are semitones above the tonic, `tones` above the root, `n` how many sound.
export function parseChord(token, scaleName) {
  const key = `${scaleName}|${token}`;
  let c = cache.get(key);
  if (c) return c;
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`Bad chord token: ${token}`);
  const scale = seven(scaleName);
  const [root, outside] = place(m[1], scale);
  const colour = COLOURS[m[2] ?? ''];
  if (!colour) throw new Error(`Bad chord colour: ${token}`);
  // A chord from outside the mode has no thirds of the mode to stack: major.
  const base = outside ? [0, 4, 7, 10, 14] : stacked(scale, +m[1] - 1);
  const [tones, n] = colour(base, scale, outside ? null : +m[1] - 1);
  c = { token, root, tones, n, bass: m[3] ? place(m[3], scale)[0] : root, dur: m[4] ? +m[4] : 1 };
  cache.set(key, c);
  return c;
}

// The tones that sound in a chord voice, as semitones above the chord's root. A
// five-note chord leaves out its fifth, as a player's hand does.
export function soundingTones(c) {
  return c.n === 5 ? [c.tones[0], c.tones[1], c.tones[3], c.tones[4]] : c.tones.slice(0, c.n);
}

// The sounding tones as semitones above the tonic (0–11).
export const soundingPcs = c => soundingTones(c).map(t => mod(c.root + t, 12));

// Whether a chord stays in the mode: what it sounds, and what voices that ask for more
// than sound in the pads will play (see COLOURS). A ninth it only offers doesn't count;
// the Rhodes checks those itself (see strike in voices/rhodes.js).
export function chordInMode(c, scaleName) {
  const scale = seven(scaleName);
  return c.tones.slice(0, c.n === 5 ? 5 : 4).every(t => scale.includes(mod(c.root + t, 12)));
}

// The seven notes a melody has over this chord: the mode's, with any the chord
// contradicts moved to the chord's note, so a line over a borrowed major V takes
// its raised leading tone. The tonic stays if it can, and the fifth, since the
// note a chord changes is usually the one beside them.
const scales = new Map();
export function chordScale(c, scaleName) {
  const key = `${scaleName}|${c.token}`;
  let out = scales.get(key);
  if (out) return out;
  const scale = [...seven(scaleName)];
  const tones = soundingPcs(c);
  for (const pc of tones) {
    if (scale.includes(pc)) continue;
    const near = [mod(pc + 1, 12), mod(pc - 1, 12)].filter(n => scale.includes(n) && !tones.includes(n));
    const worth = n => (n === 0 ? 2 : n === 7 ? 1 : 0);
    const n = near.sort((a, b) => worth(a) - worth(b))[0];
    if (n !== undefined) scale[scale.indexOf(n)] = pc;
  }
  out = scale.sort((a, b) => a - b);
  scales.set(key, out);
  return out;
}

// Semitones above the tonic of diatonic position `deg` (0 the tonic, 7 the
// octave) over chord `c`. In a pentatonic mode, a note outside the five moves to
// the nearest of them, unless the chord itself is sounding it.
export function degreeSemis(deg, c, scaleName) {
  const sc = chordScale(c, scaleName);
  const st = Math.floor(deg / 7) * 12 + sc[mod(deg, 7)];
  if (!isPent(scaleName)) return st;
  const five = SCALES[scaleName], pc = mod(st, 12);
  if (five.includes(pc) || soundingPcs(c).includes(pc)) return st;
  for (const d of [-1, 1, -2, 2]) if (five.includes(mod(pc + d, 12))) return st + d;
  return st;
}

// `token` with bass `bass` written in, unless it already has one.
export function overBass(token, bass) {
  if (token.includes('/')) return token;
  const star = token.indexOf('*');
  return star < 0 ? `${token}/${bass}` : `${token.slice(0, star)}/${bass}${token.slice(star)}`;
}

// A loop's length, in chord lengths.
export const loopLength = (tokens, scaleName) => tokens.reduce((s, t) => s + parseChord(t, scaleName).dur, 0);
