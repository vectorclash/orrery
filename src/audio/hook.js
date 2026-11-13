import { parseChord, degreeSemis, soundingPcs } from './chords.js';
import { weighted } from './language.js';
import { meter, accentAt, foldCell } from './meter.js';

// ─── Hooks ────────────────────────────────────────────────────────────────────
// What a listener takes away from a track is a figure they can hum, and composer 1
// mostly didn't have one: 73% of its songs never played a lead, and where one did,
// each note was worked out from the note before and pulled to a chord tone, so even
// over the same chords a phrase repeated itself exactly only 29% of the time. The
// rhythm came back; the tune didn't.
//
// The track that showed what was missing had no lead at all. Its mallet played
// F♯ D C♯ B F♯ E, a 3-3-2 rhythm, over and over, and each bar restarted from the
// chord tone nearest one fixed pitch. Since chords share notes, that pitch barely
// moved while the chords changed under it: one tune, recoloured, a third of its
// notes off the chord. Composer 1 only ever did this by luck, in three instruments.
//
// So a song now writes its hook down, once, as notes. A motif is a rhythm and a
// contour. Realised over a chord loop it becomes a line, which plays back literally:
//
//   riff     a bar or two, each bar re-anchored on the chord tone nearest a centre
//   topline  a four- or eight-bar sung line: statement, statement, a lift, a cadence
//
// Many candidates are drawn and each is scored for how singable it is (see `score`),
// so a song gets a good one of the many it could have, not the first. A line's notes
// are positions in the scale, not pitches, so a live change of key or mode carries it.

// Rhythms: sixteenth notes, a bar's worth. Negative is a rest.
export const CELLS = {
  // The 3-3-2 family, and the claves it comes from
  tresillo: [3, 3, 2, 3, 3, 2],
  habanera: [3, 1, 2, 2, 3, 1, 2, 2],
  son:      [3, 3, 4, 2, 4],
  rumba:    [3, 4, 3, 2, 4],
  gahu:     [3, 3, 4, 4, 2],
  lope:     [3, 3, 4, 3, 3],
  // Off the beat, leaving it to the kick
  off:      [-2, 2, -2, 2, -2, 2, -2, 2],
  push:     [-2, 3, 3, -2, 3, 3],
  skip:     [-3, 3, -2, 3, 3, 2],
  twostep:  [3, -1, 2, 2, -2, 2, 2, 2],
  // On it
  eighths:  [2, 2, 2, 2, 2, 2, 2, 2],
  climb:    [2, 2, 2, 2, 4, 4],
  drive:    [4, 2, 2, 4, 2, 2],
  gallop:   [2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
  // Funk's sixteenths
  funk:     [1, 1, 2, -1, 1, 2, 2, -2, 2, 2],
  hit:      [3, 1, -2, 2, 1, 1, -2, 4],
  slap:     [2, -1, 1, -2, 2, -1, 1, 2, 2, 2],
  // Sung
  line1:    [4, 2, 2, 8],
  line2:    [2, 2, 4, 8],
  line3:    [3, 3, 2, 8],
  line4:    [-2, 2, 2, 2, 8],
  line5:    [6, 2, 8],
  line6:    [4, 4, 8],
  line7:    [2, 2, 2, 2, 8],
  line8:    [8, 4, 4],
  line9:    [-4, 2, 2, 8],
  // Bebop's off-beat starts
  bop1:     [-2, 2, 2, 2, -2, 2, 4],
  bop2:     [3, 3, 2, -2, 2, 4],
  bop3:     [2, 2, 2, 2, -2, 3, 3],
  // Slow
  slow1:    [8, 8],
  slow2:    [12, 4],
  slow4:    [6, 2, 8],
  slow5:    [-8, 8],
};
// How a sung phrase comes to rest.
const CADENCES = [[4, 4, 8], [8, 8], [2, 2, 12], [6, 2, 8], [4, 12], [16]];

const TRIES = 40;

const mod = (n, m) => ((n % m) + m) % m;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => a * b / gcd(a, b);
const pickOf = (r, a) => a[Math.floor(r() * a.length)];

// ─── A motif ──────────────────────────────────────────────────────────────────
// Contour: scale steps between notes. Mostly steps one way, with a signature leap
// against the grain: F♯ D C♯ B then up to F♯ again.
function contour(r, n) {
  const steps = [0];
  let dir = r() < 0.6 ? -1 : 1;
  const leapAt = 1 + Math.floor(r() * Math.max(1, n - 1));
  const leap = pickOf(r, [2, 3, 3, 4, 4, 5]);
  for (let i = 1; i < n; i++) {
    if (i === leapAt) { steps.push(-dir * leap); continue; }
    if (r() < 0.22) dir = -dir;
    steps.push(r() < 0.1 ? 0 : dir * pickOf(r, [1, 1, 1, 2]));
  }
  return steps;
}

// Composer 3's contour speaks its language's intervals (see INTERVALS in language.js):
// a move of each kind as often as the language has them, in scale steps. Wide moves go
// against the grain, as above, and the line carries on its way back down from them.
const MOVE_STEPS = [[0], [1], [2], [3, 4], [5, 7]];

function spokenContour(r, n, { moves }) {
  const weights = Object.fromEntries(moves.map((w, i) => [i, w]));
  const steps = [0];
  let dir = r() < 0.6 ? -1 : 1;
  for (let i = 1; i < n; i++) {
    const size = pickOf(r, MOVE_STEPS[+weighted(r, weights)]);
    if (size >= 3) { steps.push(-dir * size); continue; }
    if (r() < 0.22) dir = -dir;
    steps.push(dir * size);
  }
  return steps;
}

function drawMotif(r, palette, kind, lock, centres, spoken = null) {
  const a = CELLS[pickOf(r, palette)], b = CELLS[pickOf(r, palette)];
  const cad = pickOf(r, CADENCES);
  const riff = kind === 'riff';
  const cells = riff
    ? pickOf(r, [[a], [a], [a, a, a, b], [a, b]])
    : pickOf(r, [[a, a, b, cad], [a, b, a, cad], [a, a, a, cad]]);
  const n = Math.max(...cells.map(c => c.filter(x => x > 0).length));
  return {
    kind, cells,
    spoken,
    steps: spoken ? spokenContour(r, n, spoken) : contour(r, n),
    slides: spoken?.approach ? Array.from({ length: n }, () => r() < spoken.approach) : null,
    centre: pickOf(r, centres),
    arc: riff ? [0] : pickOf(r, [[0, 0, 1, -1], [0, 1, 2, 0], [0, -1, 1, 0], [0, 0, 2, 1]]),
    // Which of the notes that could snap to a chord tone do: a fixed choice, so
    // every bar behaves alike. The looser the Harmony lock, the fewer.
    snaps: Array.from({ length: n }, () => r() < 0.35 + 0.65 * lock),
    long: !riff && r() < 0.4, // a sung line can take eight bars to come round
  };
}

// ─── Realising a motif over chords ────────────────────────────────────────────
function timeline(tokens, scaleName, cb) {
  const seq = [];
  let at = 0;
  for (const t of tokens) {
    const chord = parseChord(t, scaleName), len = chord.dur * cb;
    seq.push({ chord, start: at, end: at + len });
    at += len;
  }
  return { seq, beats: at };
}

const chordAt = ({ seq, beats }, at) => {
  const pos = mod(at, beats);
  return (seq.find(s => pos < s.end - 1e-9) ?? seq[seq.length - 1]).chord;
};

// Beats from `at` to the end of the chord sounding then.
const chordEndAt = ({ seq, beats }, at) => {
  const pos = mod(at, beats);
  return (seq.find(s => pos < s.end - 1e-9) ?? seq[seq.length - 1]).end - pos;
};

const isTone = (deg, chord, scaleName) => soundingPcs(chord).includes(mod(degreeSemis(deg, chord, scaleName), 12));

// The chord tone nearest `deg`, searching outward; `dir` is the side to prefer.
function nearestTone(deg, chord, scaleName, dir) {
  for (let r = 0; r < 8; r++) {
    for (const s of dir >= 0 ? [r, -r] : [-r, r]) if (isTone(deg + s, chord, scaleName)) return deg + s;
  }
  return deg;
}

// A semitone above a chord tone, and not a chord tone itself: a fourth over a major
// chord, a flat sixth over a minor one. Fine in passing; held, or on the beat, a wrong note.
function isAvoid(deg, chord, scaleName) {
  const pcs = soundingPcs(chord), pc = mod(degreeSemis(deg, chord, scaleName), 12);
  return !pcs.includes(pc) && pcs.some(t => mod(pc - t, 12) === 1);
}

// How strong a note `pos` beats into the bar is, in the meter being written (meter.js).
const accent = pos => accentAt(pos);
const SWELL = [0.9, 0.96, 1, 0.88]; // over four bars: up into the third, relaxing on the cadence

function cycleFor(beats, motif) {
  const B = meter().beats;
  const bars = motif.kind === 'topline' && motif.long ? 8 * B : 4 * B;
  const c = lcm(beats, bars);
  return c <= 96 ? c : Math.max(beats, bars);
}

// The notes of `cell`, from note `prev`, over bar `bar`. Each is { at, len, deg, vel }.
function realiseBar(m, tl, scaleName, bar, cell, prev, out, { landing = false } = {}) {
  const anchor = m.centre + m.arc[bar % m.arc.length];
  const [down, up] = m.spoken?.span ?? [5, 6];
  const lo = m.centre - down, hi = m.centre + up;
  const B = meter().beats;
  cell = foldCell(cell);
  let at = bar * B, i = 0, last = prev, lastStep = 0;
  const lastAt = cell.filter(x => x > 0).length - 1;
  for (const d of cell) {
    const len = Math.abs(d) / 4;
    if (d < 0) { at += len; continue; }
    const chord = chordAt(tl, at), pos = at - bar * B;
    let deg;
    if (i === 0 && (m.kind === 'riff' || last === null)) {
      deg = nearestTone(anchor, chord, scaleName, 0);
    } else {
      let step = i === 0 ? mod(anchor - last + 3, 7) - 3 : m.steps[i % m.steps.length];
      if (Math.abs(lastStep) >= 3) step = -Math.sign(lastStep);  // recover from a leap by step
      deg = last + step;
      if (deg < lo || deg > hi) deg = last - step;               // back off the range's edge
      const strong = accent(pos) >= 0.92 || len >= 1.5;
      // A language that hammers one note means it: a repeat stays a repeat.
      const held = m.spoken && step === 0;
      if (!held && (strong || Math.abs(step) >= 2) && m.snaps[i % m.snaps.length]) deg = nearestTone(deg, chord, scaleName, Math.sign(step));
    }
    if (landing && i === lastAt) deg = nearestTone(deg, chord, scaleName, 0);
    // Composer 4: not on the beat, or held. And a note stops when its chord does: the
    // next chord may not have it, and only what was chosen for this one has been checked.
    if (m.spoken?.strict && (accent(pos) >= 0.92 || len >= 1) && isAvoid(deg, chord, scaleName)) deg = nearestTone(deg, chord, scaleName, 0);
    lastStep = last === null ? 0 : deg - last;
    last = deg;
    const room = m.spoken?.strict ? chordEndAt(tl, at) : null;
    out.push({ at, len: room === null ? len : Math.min(len, room), deg, i, vel: +(accent(pos) * SWELL[bar % 4]).toFixed(3), ...(room === null ? {} : { room }) });
    at += len;
    i++;
  }
  return last;
}

// A weak note a whole step from the strong chord tone after it slides in from a
// semitone away, outside the scale if that's where the semitone is: an `alt` on the
// note, in semitones. Whether a note does is part of the motif, so every bar agrees.
function slid(m, notes, tl, scaleName) {
  if (!m.slides) return notes;
  return notes.map((n, k) => {
    const to = notes[k + 1];
    if (!to || !m.slides[n.i % m.slides.length]) return n;
    const B = meter().beats;
    const strong = accent(mod(to.at, B)) >= 0.92 || to.len >= 1.5;
    const here = degreeSemis(n.deg, chordAt(tl, n.at), scaleName), there = degreeSemis(to.deg, chordAt(tl, to.at), scaleName);
    if (!strong || accent(mod(n.at, B)) >= 0.92 || Math.abs(there - here) !== 2) return n;
    if (!isTone(to.deg, chordAt(tl, to.at), scaleName)) return n;
    return { ...n, alt: Math.sign(there - here) };
  });
}

function realise(m, tokens, scaleName, cb) {
  const tl = timeline(tokens, scaleName, cb);
  const B = meter().beats;
  const beats = cycleFor(tl.beats, m), bars = Math.round(beats / B);
  const notes = [];
  let last = null;
  for (let bar = 0; bar < bars; bar++) {
    const cell = m.cells[bar % m.cells.length];
    last = realiseBar(m, tl, scaleName, bar, cell, last, notes, { landing: m.kind === 'topline' && bar % 4 === 3 });
  }
  // The same, with a last bar that goes somewhere else: every so often, and on the
  // way out of a section, a figure that has come round four times turns.
  const inLast = n => n.at >= (bars - 1) * B - 1e-9;
  const fill = notes.filter(n => !inLast(n));
  realiseBar(m, tl, scaleName, bars - 1, m.turn ?? [...m.cells[0]].reverse(), last, fill, { landing: true });
  return finished({ beats, notes: slid(m, notes, tl, scaleName), fill: slid(m, fill, tl, scaleName) }, tl, scaleName);
}

const pitchOf = (n, tl, scaleName) => degreeSemis(n.deg, chordAt(tl, n.at), scaleName) + (n.alt ?? 0);

// A line's reach, kept with it to place it in a voice's register (see lines.js).
function finished(line, tl, scaleName) {
  const st = line.notes.map(n => pitchOf(n, tl, scaleName));
  line.low = Math.min(...st);
  line.high = Math.max(...st);
  line.mean = st.reduce((a, b) => a + b, 0) / (st.length || 1);
  return line;
}

// ─── What makes a line singable ───────────────────────────────────────────────
// A score of everything a tune seems to need, each out of about one. Mostly steps,
// with a leap or two, and leaps taken back; a range you can sing, aimed by the
// language; a shape with a top; notes on the chord where the ear checks, on the
// strong beats, and off it (a ninth, a passing note) a fair share of the time
// elsewhere; moving from bar to bar by little, so chords change under one tune.
//
// This was tuned on one example, F♯ D C♯ B F♯ E over i–VI–III–VII, which reaches the
// top of the range. So it's a sanity check, not proof: what it reliably does is throw
// out the dull and the unsingable. Plenty of lines clear it, and the draw picks among
// them, which is what keeps one song's hook from sounding like the next one's.
function score(line, tl, scaleName, aim) {
  const { notes } = line;
  if (notes.length < 2) return -9;
  const st = notes.map(n => pitchOf(n, tl, scaleName));
  const iv = st.slice(1).map((x, i) => x - st[i]);
  const abs = iv.map(Math.abs);
  const share = f => abs.filter(f).length / abs.length;
  const near = (x, lo, hi, width) => (x < lo ? Math.max(0, 1 - (lo - x) / width) : x > hi ? Math.max(0, 1 - (x - hi) / width) : 1);

  const range = Math.max(...st) - Math.min(...st);
  let s = 2 * near(range, aim.range[0], aim.range[1], 4);
  if (aim.moves) {
    // Composer 3: how close its moves come to the language's. Worth the most of
    // anything here, since nothing else in the line says what genre it's from.
    const kinds = [a => a === 0, a => a >= 1 && a <= 2, a => a >= 3 && a <= 4, a => a >= 5 && a <= 7, a => a >= 8];
    const all = aim.moves.reduce((a, b) => a + b, 0);
    const apart = kinds.reduce((sum, f, i) => sum + Math.abs(share(f) - aim.moves[i] / all), 0);
    s += 8 * (1 - apart / 2);
  } else {
    s += 2 * near(share(a => a >= 1 && a <= 2), 0.45, 0.8, 0.35);
    s += near(share(a => a === 0), 0, 0.2, 0.2);
    s += near(share(a => a >= 3 && a <= 7), 0.1, 0.45, 0.25); // thirds and fourths: a riff is full of them
    s -= 2 * share(a => a > 9);
  }

  // A leap taken back by step, not followed by another the same way.
  let leaps = 0, good = 0;
  for (let i = 0; i + 1 < iv.length; i++) if (abs[i] >= 5) { leaps++; if (Math.sign(iv[i + 1]) !== Math.sign(iv[i]) && abs[i + 1] <= 4) good++; }
  if (leaps) s += good / leaps;

  // Direction changes: not a run, not a zigzag.
  let turns = 0, moves = 0, was = 0;
  for (const x of iv) { if (!x) continue; moves++; if (was && Math.sign(x) !== was) turns++; was = Math.sign(x); }
  s += near(moves ? turns / moves : 0, 0.2, 0.55, 0.3);

  // A top the tune reaches, not one it sits on.
  const top = Math.max(...st);
  s += near(st.filter(x => x === top).length / st.length, 0, 0.2, 0.25);

  // Variety, in a bar's notes and across the line.
  s += near(new Set(st.map(x => mod(x, 12))).size, 4, 7, 3);

  // The chord where the ear checks; colour elsewhere.
  let strong = 0, strongOn = 0, off = 0, rooted = 0, avoid = 0, rubs = 0;
  notes.forEach((n, i) => {
    const chord = chordAt(tl, n.at), pcs = soundingPcs(chord), pc = mod(st[i], 12);
    const on = pcs.includes(pc);
    if (!on) off++;
    const pos = mod(n.at, meter().beats);
    if (accent(pos) >= 0.92 || n.len >= 1.5) {
      strong++;
      if (on) strongOn++;
      if (pc === chord.root) rooted++;
      if (!on && pcs.some(t => mod(pc - t, 12) === 1)) avoid++; // a semitone above a chord tone, held
      // A semitone from anything a voice might be playing of this chord: a seventh or ninth
      // the pads sound, or the ones a Rhodes adds. Colour in passing, a rub on the beat.
      if (chord.tones.some(t => { const d = mod(chord.root + t - pc, 12); return d === 1 || d === 11; })) rubs++;
    }
  });
  if (strong) {
    s += 2 * near(strongOn / strong, 0.7, 1, 0.5);
    s += near(rooted / strong, 0, 0.4, 0.4);
    s -= 2 * (avoid / strong);
    if (aim.strict) s -= 5 * (rubs / strong);
  }
  s += 1.5 * near(off / notes.length, aim.off - 0.08, aim.off + 0.08, 0.25);

  // From bar to bar: the first notes barely move.
  const bars = [];
  const B = meter().beats;
  notes.forEach((n, i) => { (bars[Math.floor(n.at / B)] ??= []).push(i); });
  const firsts = bars.filter(Boolean).map(b => st[b[0]]);
  if (firsts.length > 1) {
    const by = firsts.slice(1).map((x, i) => Math.abs(x - firsts[i]));
    s += near(by.reduce((a, b) => a + b, 0) / by.length, 0, 3, 5);
  }

  // A riff keeps its shape as it's recoloured: the steps of its first bar carry on
  // through the others, however the chord tones pull it. A sung line is meant to move.
  if (aim.shape && firsts.length > 1) {
    const steps = b => b.slice(1).map(i => notes[i].deg - notes[i - 1].deg);
    const [one, ...rest] = bars.filter(Boolean).map(steps);
    let same = 0, all = 0;
    for (const other of rest) {
      const n = Math.max(one.length, other.length);
      all += n;
      for (let i = 0; i < n; i++) if (one[i] === other[i]) same++;
    }
    if (all) s += 2 * near(same / all, 0.7, 1, 0.5);
  }
  return s;
}

// ─── Writing a hook ───────────────────────────────────────────────────────────
// The best of many motifs for this loop in this language. The score's ties are
// broken by a little of the draw, so two songs on one loop don't converge on one
// tune: there are far more good lines than one best one.
export function writeMotif(r, lang, tokens, scaleName, cb, lock, { kind, palette, centres = [2, 4, 4, 7], spoken = null } = {}) {
  const k = kind ?? weighted(r, lang.hook.kinds);
  const cells = palette ?? (k === 'riff' ? lang.hook.riff : lang.hook.topline);
  const tl = timeline(tokens, scaleName, cb);
  const aim = { ...lang.hook, ...spoken, shape: k === 'riff' };
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < TRIES; i++) {
    const m = drawMotif(r, cells, k, lock, centres, spoken);
    const s = score(realise(m, tokens, scaleName, cb), tl, scaleName, aim) + r() * 0.6;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

// The motif over a loop.
export const lineOver = (motif, tokens, scaleName, cb) => realise(motif, tokens, scaleName, cb);

// A hook kept with the song as notes, taken from another (see transcribe.js), as a line.
export function lineOfHook(hook, scaleName, cb) {
  const tl = timeline(hook.chords, scaleName, cb);
  const notes = hook.notes.map(([at16, len16, deg]) => {
    const at = at16 / 4, room = chordEndAt(tl, at);
    const B = meter().beats;
    return { at, len: Math.min(len16 / 4, room), deg, room, vel: +(accent(mod(at, B)) * SWELL[Math.floor(at / B) % 4]).toFixed(3) };
  });
  const line = finished({ beats: hook.beats, notes, fill: null }, tl, scaleName);
  return { ...line, anchor: line.mean };
}

// ─── Lines made from lines ────────────────────────────────────────────────────
// The bones of a line: the notes nearest the bar's first and third beats, each held
// until the next. An intro's hint of the hook, an outro's memory of it, and what a
// slow voice can play of a fast figure without running together. Two notes a bar
// keep its shape; any fewer and it isn't the same tune.
export function thinned(line) {
  const out = [], { beats: B, strong } = meter();
  for (let bar = 0; bar * B < line.beats; bar++) {
    const here = line.notes.filter(n => n.at >= bar * B - 1e-9 && n.at < (bar + 1) * B - 1e-9);
    const nearest = beat => here.reduce((a, n) => (Math.abs(n.at - beat) < Math.abs(a.at - beat) ? n : a));
    if (!here.length) continue;
    for (const n of new Set(strong.map(x => nearest(bar * B + x)))) out.push({ ...n, alt: undefined });
  }
  out.forEach((n, i) => { n.len = Math.min((out[i + 1]?.at ?? line.beats) - n.at, B, n.room ?? B); });
  return { ...line, notes: out, fill: null };
}

// The line a third away, for a second voice to double it on the last chorus.
export function harmonised(line, by = -2) {
  const moved = list => list?.map(n => ({ ...n, deg: n.deg + by, alt: undefined, vel: +(n.vel * 0.85).toFixed(3) })) ?? null;
  return { ...line, notes: moved(line.notes), fill: moved(line.fill) };
}

// A counter-melody, the second voice under a hook: long notes on each chord's third
// or seventh (the two that say what the chord is), moving as little as they can.
// It leaves the hook all the room it needs and still gives the harmony a line.
export function counterLine(tokens, scaleName, cb, centre = 2) {
  const tl = timeline(tokens, scaleName, cb);
  const bars4 = 4 * meter().beats;
  const beats = lcm(tl.beats, bars4) <= 6 * bars4 ? lcm(tl.beats, bars4) : tl.beats;
  const notes = [];
  let last = centre;
  for (let at = 0; at < beats;) {
    const pos = mod(at, tl.beats);
    const s = tl.seq.find(x => pos < x.end - 1e-9) ?? tl.seq[tl.seq.length - 1];
    const len = s.end - pos;
    const guide = [1, 3].map(i => mod(s.chord.root + s.chord.tones[i], 12));
    let deg = last, found = false;
    for (let r = 0; r < 8 && !found; r++) {
      for (const d of [r, -r]) {
        if (guide.includes(mod(degreeSemis(last + d, s.chord, scaleName), 12))) { deg = last + d; found = true; break; }
      }
    }
    if (deg > centre + 5) deg -= 7;
    if (deg < centre - 5) deg += 7;
    notes.push({ at, len, deg, vel: 0.62 });
    last = deg;
    at += len;
  }
  return finished({ beats, notes, fill: null }, tl, scaleName);
}
