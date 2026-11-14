// ─── Meter ────────────────────────────────────────────────────────────────────
// How many beats a bar has, and how they fall. A song has one meter all through (see
// meterFor in song.js); eras and loops are always 4/4. The clock still counts quarter
// notes (see transport.js): a bar of 3/4 or 6/8 is three of them, twelve sixteenths;
// 5/4 is five, twenty; 7/8 is three and a half, fourteen.
//   beats   -- quarter-note beats to the bar
//   steps   -- sixteenths to the bar
//   accents -- [every so many beats, how strong a note there is], strongest first; or
//   accent  -- pos => how strong, for a bar whose strong beats aren't evenly spaced
//   strong  -- the bar's main pulses, in beats: where a line thinned to its bones keeps a note
//   pulses  -- the beats a part that plays on the beat plays on: a walking bass, the
//              sidechain pump, the song's conductor
//   fill    -- how many beats a drum fill takes, if not one or two: six-eight's and
//              seven-eight's last group, a dotted quarter
//   to16    -- the sixteenth of a 4/4 bar that sixteenth `j` of this one plays: the
//              patterns, cells and figures written in 4/4 play in other meters through it.
//              3/4 leaves out the third beat, keeping the downbeat, the second beat and
//              the fourth's turn into the next bar; 6/8 keeps the first three eighths of
//              each half bar, so a line of quarter, eighth, eighth, half comes out quarter,
//              eighth, dotted quarter, 6/8's own lilt. 5/4 is three and two, as Take Five
//              is: the 4/4 bar's first three beats, then its third again and its fourth,
//              so the two-beat group starts where the bar's middle did. 7/8 is two, two
//              and three eighths: the 4/4 bar without its last eighth.
// A meter's patterns of its own, where a part has them, are written for it (the
// drums', see METER_TRACKS in voices/drums.js); everything else folds.
const on = (pos, d) => Math.abs(pos / d - Math.round(pos / d)) < 1e-6;
export const METERS = {
  '4/4': {
    name: '4/4', beats: 4, steps: 16, strong: [0, 2], pulses: [0, 1, 2, 3],
    accents: [[4, 1], [2, 0.92], [1, 0.85], [0.5, 0.78]],
    to16: j => j,
  },
  '3/4': {
    name: '3/4', beats: 3, steps: 12, strong: [0], pulses: [0, 1, 2],
    accents: [[3, 1], [1, 0.9], [0.5, 0.78]],
    to16: j => (j < 8 ? j : j + 4),
  },
  '6/8': {
    name: '6/8', beats: 3, steps: 12, strong: [0, 1.5], pulses: [0, 1.5], fill: 1.5,
    accents: [[3, 1], [1.5, 0.92], [0.5, 0.82]],
    to16: j => Math.floor(j / 6) * 8 + j % 6,
  },
  '5/4': {
    name: '5/4', beats: 5, steps: 20, strong: [0, 3], pulses: [0, 1, 2, 3, 4],
    accent: pos => (on(pos, 5) ? 1 : on(pos - 3, 5) ? 0.92 : on(pos, 1) ? 0.85 : on(pos, 0.5) ? 0.78 : 0.72),
    to16: j => (j < 12 ? j : j - 4),
  },
  '7/8': {
    name: '7/8', beats: 3.5, steps: 14, strong: [0, 2], pulses: [0, 1, 2], fill: 1.5,
    accent: pos => (on(pos, 3.5) ? 1 : on(pos - 1, 3.5) || on(pos - 2, 3.5) ? 0.92 : on(pos, 0.5) ? 0.8 : 0.72),
    to16: j => j,
  },
};
export const FOUR = METERS['4/4'];
export const ODD_METERS = ['3/4', '6/8', '5/4', '7/8'];

// Which genres (languages) play in each meter, and which drum styles have patterns
// for it (see METER_TRACKS in voices/drums.js): a song with drums is only in a meter
// its kit can play. Never the dance genres, whose music is the four on the floor.
// Seven-eight is the one dance meter: techno's, where a 2+2+3 kick is a known trick.
export const METER_GENRES = {
  '3/4': ['JAZZ', 'FOLK', 'ORCH', 'DREAM', 'AMBIENT'],
  '6/8': ['FOLK', 'ORCH', 'EPIC', 'BLUES'],
  '5/4': ['JAZZ', 'DARK', 'EPIC', 'ELEC'],
  '7/8': ['TECHNO', 'MELODIC TECHNO', 'ELEC', 'DARK'],
};
export const METER_DRUMS = {
  '3/4': ['swing', 'brushes', 'four_four', 'cinematic', 'halftime', 'minimal', 'ghost'],
  '6/8': ['swing', 'brushes', 'four_four', 'cinematic', 'halftime', 'shuffle', 'minimal'],
  '5/4': ['swing', 'brushes', 'four_four', 'breakbeat', 'cinematic', 'halftime', 'minimal', 'ghost'],
  '7/8': ['techno', 'four_four', 'breakbeat', 'cinematic', 'minimal', 'ghost'],
};
// How often a song that could be in another meter is: a waltz or a six-eight
// (GENTLE_METERS) one time in seven; five-four or seven-eight, the bigger change, one
// in twelve, and only from songs that would have been in 4/4.
export const GENTLE_METERS = ['3/4', '6/8'];
export const BOLD_METERS = ['5/4', '7/8'];
export const METER_CHANCE = 0.15;
export const BOLD_CHANCE = 0.08;

// The meter playing now: the song's, or its section's where the song changes meter
// (song.js tells this module where to find it); or, while a song is being written,
// that song's (see withMeter).
let playing = () => null;
let writing = null;
export function meterSource(fn) { playing = fn; }
export const meter = () => writing ?? playing() ?? FOUR;
export const barBeats = () => meter().beats;
export const isFour = () => meter() === FOUR;

// Where the bars playing now are counted from: { at, bar }, beat `at` being the start
// of bar number `bar`. Beat 0, bar 0, in a song with one meter all through, so a bar is
// floor(b / beats) as it always was; in a song that changes meter, the section's
// start and the bars before it (see section.bar0 in song.js). A section starts on a
// bar line, and the conductor plays every voice up to it before it starts (see
// scheduler.js), so nothing is ever placed on the wrong grid.
const ZERO = { at: 0, bar: 0 };
let counted = () => null;
export function gridSource(fn) { counted = fn; }
const grid = () => (writing ? ZERO : counted() ?? ZERO);
// The bar beat `b` is in, its first beat, and how far into it `b` is. `eps` as each
// caller always had it, so a song with one meter places everything exactly as before.
export function barIndex(b, eps = 0) {
  const { at, bar } = grid();
  return bar + Math.floor((b - at) / meter().beats + eps);
}
export function barStart(b, eps = 0) {
  const { at } = grid(), B = meter().beats;
  return at + Math.floor((b - at) / B + eps) * B;
}
export const inBar = (b, eps = 0) => b - barStart(b, eps);
// Where bars are counted from, for a voice joining on the next bar line (transport.js).
export const barOrigin = () => grid().at;

// `fn` with meter `m`: for writing a song, which happens while another may be playing.
export function withMeter(m, fn) {
  const was = writing;
  writing = m;
  try { return fn(); } finally { writing = was; }
}

// How strong a note at `pos` beats into the bar is.
export function accentAt(pos, m = meter()) {
  if (m.accent) return m.accent(pos);
  for (const [d, v] of m.accents) if (on(pos, d)) return v;
  return 0.72;
}

// Beats from `pos` into the bar to the next of its pulses (or the next bar).
export function toPulse(pos, m = meter()) {
  const next = m.pulses.find(p => p > pos + 1e-6) ?? m.beats;
  return next - pos;
}

// The 4/4 sixteenth that the sixteenth at `pos` beats into this meter's bar plays, for
// reading a part's 4/4 pattern: in 4/4, the sixteenth itself.
export function step16(pos, m = meter()) {
  return m.to16(Math.round(pos * 4) % m.steps);
}

// How many sixteenths the note starting `pos` beats into the bar holds in 4/4 pattern
// `pat` ('-' after it, read through to16); `k` is where the bar starts in `pat` (a
// two-bar figure's second bar starts at 16).
export function heldFor(pat, pos, k = 0, m = meter()) {
  const j = Math.round(pos * 4) % m.steps;
  let n = 1;
  while (j + n < m.steps && pat[k + m.to16(j + n)] === '-') n++;
  return n;
}

// A rhythm cell of signed sixteenths (negative a rest) filling a 4/4 bar, in this
// meter: a note or rest starts at each sixteenth of the bar whose 4/4 sixteenth one
// starts at (so in 5/4 a third beat's note comes round again), and lasts until the
// next. A note on a sixteenth the meter leaves out isn't played, and the one before it
// carries on through. In 4/4, the cell itself.
const folded = new Map();
export function foldCell(cell, m = meter()) {
  if (m === FOUR) return cell;
  const key = `${m.name}|${cell.join()}`;
  if (folded.has(key)) return folded.get(key);
  const onsets = new Map();
  let at = 0;
  for (const d of cell) { onsets.set(at, d < 0); at += Math.abs(d); }
  const starts = [];
  for (let j = 0; j < m.steps; j++) {
    const p = m.to16(j);
    if (onsets.has(p)) starts.push({ j, rest: onsets.get(p) });
  }
  if (!starts.length || starts[0].j !== 0) starts.unshift({ j: 0, rest: true });
  const out = starts.map((s, i) => ((starts[i + 1]?.j ?? m.steps) - s.j) * (s.rest ? -1 : 1));
  folded.set(key, out);
  return out;
}

// The same, for a cell in beats (see phrase.js).
export function foldBeats(cell, m = meter()) {
  if (m === FOUR) return cell;
  return foldCell(cell.map(x => Math.round(x * 4)), m).map(x => x / 4);
}

// Hits of [beat in the bar, length in beats] (a Rhodes comp), in this meter, the same
// way: none longer than the time to the next hit or the bar's end.
export function foldHits(hits, m = meter()) {
  if (m === FOUR) return hits;
  const key = `${m.name}|${hits.flat().join()}`;
  if (folded.has(key)) return folded.get(key);
  const kept = [];
  for (let j = 0; j < m.steps; j++) {
    const hit = hits.find(([p]) => Math.round(p * 4) === m.to16(j));
    if (hit) kept.push([j / 4, hit[1]]);
  }
  if (!kept.length) kept.push([0, m.beats]);
  const out = kept.map(([p, len], i) => [p, Math.min(len, (kept[i + 1]?.[0] ?? m.beats) - p)]);
  folded.set(key, out);
  return out;
}

// A chord's length, in beats, for a song whose chords change every `cb` beats: in 4/4,
// `cb`; in another meter, as many of its bars as `cb` is of 4/4's, at least one.
export function chordBeats(cb, m = meter()) {
  return m === FOUR ? cb : Math.max(1, Math.round(cb / 4)) * m.beats;
}
