// ─── Meter ────────────────────────────────────────────────────────────────────
// How many beats a bar has, and how they fall. A song has one meter all through (see
// meterFor in song.js); eras and loops are always 4/4. The clock still counts quarter
// notes (see transport.js): a bar of 3/4 or 6/8 is three of them, twelve sixteenths.
//   beats   -- quarter-note beats to the bar
//   steps   -- sixteenths to the bar
//   accents -- [every so many beats, how strong a note there is], strongest first
//   strong  -- the bar's main pulses, in beats: where a line thinned to its bones keeps a note
//   from16  -- where sixteenth `p` of a 4/4 bar goes in this one, or null if it has no
//              place: the patterns, cells and figures written in 4/4 play in other meters
//              through it (and to16, its inverse, reads them). 3/4 leaves out the third
//              beat, keeping the downbeat, the second beat and the fourth's turn into the
//              next bar; 6/8 keeps the first three eighths of each half bar, so a line of
//              quarter, eighth, eighth, half comes out quarter, eighth, dotted quarter,
//              6/8's own lilt.
// A meter's patterns of its own, where a part has them, are written for it (the
// drums', see METER_TRACKS in voices/drums.js); everything else folds.
export const METERS = {
  '4/4': {
    name: '4/4', beats: 4, steps: 16, strong: [0, 2],
    accents: [[4, 1], [2, 0.92], [1, 0.85], [0.5, 0.78]],
    from16: p => p, to16: j => j,
  },
  '3/4': {
    name: '3/4', beats: 3, steps: 12, strong: [0],
    accents: [[3, 1], [1, 0.9], [0.5, 0.78]],
    from16: p => (p < 8 ? p : p < 12 ? null : p - 4),
    to16: j => (j < 8 ? j : j + 4),
  },
  '6/8': {
    name: '6/8', beats: 3, steps: 12, strong: [0, 1.5],
    accents: [[3, 1], [1.5, 0.92], [0.5, 0.82]],
    from16: p => (p % 8 < 6 ? (p >> 3) * 6 + p % 8 : null),
    to16: j => Math.floor(j / 6) * 8 + j % 6,
  },
};
export const FOUR = METERS['4/4'];
export const ODD_METERS = ['3/4', '6/8'];

// Which genres (languages) play in each meter, and which drum styles have patterns
// for it (see METER_TRACKS in voices/drums.js): a song with drums is only in a meter
// its kit can play. Never the dance genres, whose music is the four on the floor.
export const METER_GENRES = {
  '3/4': ['JAZZ', 'FOLK', 'ORCH', 'DREAM', 'AMBIENT'],
  '6/8': ['FOLK', 'ORCH', 'EPIC', 'BLUES'],
};
export const METER_DRUMS = {
  '3/4': ['swing', 'brushes', 'four_four', 'cinematic', 'halftime', 'minimal', 'ghost'],
  '6/8': ['swing', 'brushes', 'four_four', 'cinematic', 'halftime', 'shuffle', 'minimal'],
};
// How often a song that could be in another meter is.
export const METER_CHANCE = 0.15;

// The meter playing now: a song's (song.js tells this module where to find it), or,
// while a song is being written, that song's (see withMeter).
let playing = () => null;
let writing = null;
export function meterSource(fn) { playing = fn; }
export const meter = () => writing ?? playing() ?? FOUR;
export const barBeats = () => meter().beats;
export const isFour = () => meter() === FOUR;

// `fn` with meter `m`: for writing a song, which happens while another may be playing.
export function withMeter(m, fn) {
  const was = writing;
  writing = m;
  try { return fn(); } finally { writing = was; }
}

// How strong a note at `pos` beats into the bar is.
export function accentAt(pos, m = meter()) {
  for (const [d, v] of m.accents) if (Math.abs(pos / d - Math.round(pos / d)) < 1e-6) return v;
  return 0.72;
}

// The 4/4 sixteenth that the sixteenth at `pos` beats into this meter's bar plays, for
// reading a part's 4/4 pattern: in 4/4, the sixteenth itself.
export function step16(pos, m = meter()) {
  return m.to16(Math.round(pos * 4) % m.steps);
}

// How many sixteenths the note starting at 4/4 sixteenth `i` of pattern `pat` holds
// ('-' after it), counting only the sixteenths this meter keeps; `k` is where the bar
// starts in `pat` (a two-bar figure's second bar starts at 16).
export function heldFor(pat, i, k = 0, m = meter()) {
  const j = m.from16(i);
  let n = 1;
  while (j + n < m.steps && pat[k + m.to16(j + n)] === '-') n++;
  return n;
}

// A rhythm cell of signed sixteenths (negative a rest) filling a 4/4 bar, in this
// meter: each note or rest starts where its sixteenth goes, and lasts until the next
// one that's kept. A note whose sixteenth has no place is left out, and the one before
// it carries on through. In 4/4, the cell itself.
const folded = new Map();
export function foldCell(cell, m = meter()) {
  if (m === FOUR) return cell;
  const key = `${m.name}|${cell.join()}`;
  if (folded.has(key)) return folded.get(key);
  const starts = [];
  let at = 0;
  for (const d of cell) {
    const p = m.from16(at);
    if (p !== null && !starts.some(s => s.p === p)) starts.push({ p, rest: d < 0 });
    at += Math.abs(d);
  }
  if (!starts.length || starts[0].p !== 0) starts.unshift({ p: 0, rest: true });
  const out = starts.map((s, i) => ((starts[i + 1]?.p ?? m.steps) - s.p) * (s.rest ? -1 : 1));
  folded.set(key, out);
  return out;
}

// The same, for a cell in beats (see phrase.js).
export function foldBeats(cell, m = meter()) {
  if (m === FOUR) return cell;
  return foldCell(cell.map(x => Math.round(x * 4)), m).map(x => x / 4);
}

// Hits of [beat in the bar, length in beats] (a Rhodes comp), in this meter: each where
// its sixteenth goes, none longer than the time to the next hit or the bar's end.
export function foldHits(hits, m = meter()) {
  if (m === FOUR) return hits;
  const key = `${m.name}|${hits.flat().join()}`;
  if (folded.has(key)) return folded.get(key);
  const kept = [];
  for (const [p, len] of hits) {
    const q = m.from16(Math.round(p * 4));
    if (q !== null && !kept.some(h => h[0] === q / 4)) kept.push([q / 4, len]);
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
