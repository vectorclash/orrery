import { state, SCALE_NAMES, pick, fold, register, currentScale, random } from '../state.js';
import { transport } from './transport.js';
import { parseChord, chordScale, soundingPcs, isPent } from './chords.js';
import { freeForm } from './language.js';
import { lines } from './lines.js';
import { barBeats, chordBeats } from './meter.js';

// ─── Shared harmonic context ────────────────────────────────────────────────
// Every harmonic and melodic voice reads the chord from here, so at any
// instant the pad, choir, bass and melody all agree on what is sounding.
//
// Chords are a root *scale degree* (an index into the active scale). Stacking
// diatonic thirds on that degree (degree, +2, +4, +6) yields the right quality
// for the active mode automatically.
//
// Chord changes live on the transport's beat grid: segment k covers beats
// [start, start + chordBeats). Voices ask for the chord at the *beat they are
// scheduling* (which may be a little ahead of the clock), so a note that
// starts on a chord change gets the new chord, and sustained voices can end
// exactly at the change instead of holding the old chord over the new one.

// Progressions per mode, as 0-based degrees. Each list favours the mode's
// characteristic chord (Dorian IV, Phrygian ♭II, Lydian II, Mixolydian ♭VII)
// and avoids the mode's diminished triad, which is what made a one-size-fits-
// all list sound wrong: i–iv–v–i in Lydian is I–♯iv°–V–I.
const PROGRESSIONS = {
  aeolian: [                    // i ii° III iv v VI VII
    [0, 5, 2, 6],               // i – VI – III – VII
    [0, 6, 5, 6],               // i – VII – VI – VII
    [0, 3, 6, 2],               // i – iv – VII – III   (circle of fifths)
    [0, 5, 3, 4],               // i – VI – iv – v
    [0, 6, 5, 4],               // i – VII – VI – v     (descending)
    [0, 3, 4, 0],               // i – iv – v – i
    [5, 6, 0, 0],               // VI – VII – i         (Aeolian cadence)
    [0, 2, 6, 3],               // i – III – VII – iv
  ],
  dorian: [                     // i ii III IV v vi° VII
    [0, 3, 0, 3],               // i – IV vamp
    [0, 3, 6, 0],               // i – IV – VII – i
    [0, 1, 2, 1],               // i – ii – III – ii
    [0, 6, 3, 0],               // i – VII – IV – i
    [0, 4, 3, 0],               // i – v – IV – i
    [0, 2, 3, 3],               // i – III – IV
  ],
  phrygian: [                   // i ♭II ♭III iv v° ♭VI ♭vii
    [0, 1, 0, 1],               // i – ♭II vamp
    [0, 1, 2, 1],               // i – ♭II – ♭III – ♭II
    [3, 2, 1, 0],               // iv – ♭III – ♭II – i  (Andalusian descent)
    [0, 6, 5, 1],               // i – ♭vii – ♭VI – ♭II
    [0, 5, 1, 0],               // i – ♭VI – ♭II – i
    [0, 3, 1, 0],               // i – iv – ♭II – i
  ],
  lydian: [                     // I II iii ♯iv° V vi vii
    [0, 1, 0, 1],               // I – II vamp
    [0, 1, 5, 0],               // I – II – vi – I
    [0, 1, 6, 5],               // I – II – vii – vi
    [0, 4, 1, 0],               // I – V – II – I
    [0, 2, 1, 0],               // I – iii – II – I
    [5, 1, 0, 0],               // vi – II – I
  ],
  mixolydian: [                 // I ii iii° IV v vi ♭VII
    [0, 6, 3, 0],               // I – ♭VII – IV – I
    [0, 6, 0, 6],               // I – ♭VII vamp
    [0, 3, 6, 3],               // I – IV – ♭VII – IV
    [0, 4, 3, 0],               // I – v – IV – I
    [0, 5, 6, 0],               // I – vi – ♭VII – I
    [6, 3, 0, 0],               // ♭VII – IV – I        (double plagal)
  ],
  major: [                      // I ii iii IV V vi vii°
    [0, 4, 5, 3],               // I – V – vi – IV      (the pop / EDM axis)
    [5, 3, 0, 4],               // vi – IV – I – V      (the same, from the minor side)
    [0, 3, 5, 4],               // I – IV – vi – V
    [3, 4, 5, 5],               // IV – V – vi          (future bass)
    [0, 5, 3, 4],               // I – vi – IV – V
    [1, 4, 0, 0],               // ii – V – I
    [0, 2, 3, 3],               // I – iii – IV
  ],
  // Pentatonic "chords" stack scale-thirds of a 5-note scale, which gives
  // open quartal voicings — gentle motion suits them best.
  minor_pent: [[0, 2, 3, 0], [0, 3, 2, 0], [0, 2, 4, 3], [0, 3, 0, 2], [0, 4, 3, 0]],
  major_pent: [[0, 2, 3, 0], [0, 3, 2, 0], [0, 2, 4, 3], [0, 3, 0, 2], [0, 1, 3, 0]],
};

// Song form: the main progression (A) states twice, a contrasting one (B)
// follows, then A returns — AABA, the backbone of countless songs. Repetition
// makes the harmony memorable; the B section keeps it from going static.
function buildForm(scaleName) {
  const options = PROGRESSIONS[scaleName];
  const a = pick(options);
  const others = options.filter(p => p !== a);
  const b = pick(others.length ? others : options);
  return [...a, ...a, ...b, ...a];
}

// The progressions a scale offers (degree lists), for a song to choose from.
export const progressionsFor = scaleName => PROGRESSIONS[scaleName];

const mod = (n, m) => ((n % m) + m) % m;

let form      = [0, 5, 2, 6];
let colour    = [];  // per-slot random draw deciding whether that chord gets a 7th
let idx       = 0;   // index into `form` of the chord sounding at `segStart`
let segStart  = 0;   // beat position where the current chord began
let lastLen   = 4;
let formScale = null;

// Composer 2 (see chords.js): the same pointer isn't enough, since its chords
// needn't be equal lengths. A written form is { tokens, chords, at, total }: the
// loop's chords, the beat it starts from, its length in chord lengths. Null while
// composer 1's form above is playing. A chord's `degree` here is the chord itself,
// so pcs, stack and degreeNear take either, and the voices needn't know which.
let written = null;
let lastBeat = 0;

function write(tokens, atBeat) {
  formScale = SCALE_NAMES[state.scaleIdx];
  const chords = tokens.map(t => parseChord(t, formScale));
  written = { tokens, chords, at: atBeat, total: chords.reduce((s, c) => s + c.dur, 0) };
  lastLen = chordLen();
}

function writtenAt(beat) {
  const { chords, at, total } = written;
  const len   = chordLen();
  const cycle = total * len;
  const k     = Math.floor((beat - at) / cycle + 1e-9);
  const from  = at + k * cycle;
  let start = 0;
  for (let i = 0; i < chords.length; i++) {
    const d = chords[i].dur * len;
    if (beat - from < start + d - 1e-9 || i === chords.length - 1) {
      return { degree: chords[i], next: chords[(i + 1) % chords.length], start: from + start, end: from + start + d, seventh: chords[i].n > 3 };
    }
    start += d;
  }
}

function reroll(atBeat = segStart) {
  if (state.composer >= 2) {
    write(freeForm(random, state.language, SCALE_NAMES[state.scaleIdx], state.harmonyLock, state.composer), atBeat);
    return;
  }
  written   = null;
  formScale = SCALE_NAMES[state.scaleIdx];
  form      = buildForm(formScale);
  colour    = form.map(() => random());
  idx       = 0;
  segStart  = atBeat;
  lastLen   = chordLen();
}

// A chord's length in beats: the Chords control's, in the song's meter (see meter.js).
function chordLen() { return chordBeats(state.chordBeats || 4); }

export const harmony = {
  reroll,

  // A song's section: `prog` round and round from beat `atBeat`, with
  // `colours` (a draw per chord) deciding which chords take a 7th, so a
  // section played again is harmonised the same.
  // Composer 2's `prog` is chord tokens, and it has no `colours`: its chords say.
  setForm(prog, colours, atBeat) {
    if (typeof prog[0] === 'string') { write(prog, atBeat); return; }
    written   = null;
    formScale = SCALE_NAMES[state.scaleIdx];
    form      = prog;
    colour    = colours;
    idx       = 0;
    segStart  = atBeat;
    lastLen   = chordLen();
  },

  // Called once per scheduler tick. Advances the chord pointer to wherever
  // the clock is now.
  tick(now) {
    if (written) {
      lastBeat = transport.beatAt(now);
      // Mode switched live: the same chords, read in the new mode. Chord length
      // changed live: the same chord, on the next bar's grid.
      if (SCALE_NAMES[state.scaleIdx] !== formScale) write(written.tokens, written.at);
      if (chordLen() !== lastLen) { const B = barBeats(); written.at = Math.floor(lastBeat / B) * B; lastLen = chordLen(); }
      return;
    }
    if (SCALE_NAMES[state.scaleIdx] !== formScale) reroll(); // mode switched live
    const b   = transport.beatAt(now);
    const len = chordLen();
    if (len !== lastLen) {
      // Chord length changed live: keep the current chord, re-grid so future
      // changes fall on multiples of the new length (i.e. on bar lines).
      segStart = Math.floor(b / len) * len;
      lastLen  = len;
    }
    while (b >= segStart + len) {
      segStart += len;
      idx = (idx + 1) % form.length;
    }
  },

  // Beat position of the next chord change.
  get nextChange() { return written ? writtenAt(lastBeat).end : segStart + chordLen(); },

  // The written form playing (composer 2's), or null: its chord tokens, where it
  // starts and how long a time round it is, in beats.
  get written() { return written && { tokens: written.tokens, at: written.at, beats: written.total * chordLen() }; },

  // The chord segment containing musical position `beat`.
  at(beat) {
    if (written) return writtenAt(beat);
    const len  = chordLen();
    const k    = Math.floor((beat - segStart) / len + 1e-9);
    const i    = mod(idx + k, form.length);
    const pent = currentScale().length < 7;
    return {
      degree:  form[i],
      next:    form[mod(i + 1, form.length)],
      start:   segStart + k * len,
      end:     segStart + (k + 1) * len,
      // Sevenths add colour; how often is tied to the Harmony control — a
      // looser lock (jazz, blues) hears more of them. Pentatonic chords are
      // already quartal, so they stay as they are.
      seventh: !pent && colour[i] < 1.1 - state.harmonyLock,
    };
  },

  // Pitch classes of a chord built on `degree`: root, 3rd, 5th (+7th, +9th).
  pcs(degree, count = 3) {
    if (typeof degree === 'object') {
      const out = [];
      for (let i = 0; i < count; i++) out.push((state.rootMidi + degree.root + degree.tones[i % 5]) % 12);
      return out;
    }
    const scale = currentScale();
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push((state.rootMidi + scale[(degree + i * 2) % scale.length]) % 12);
    }
    return out;
  },

  // Pitch classes of the chord sounding at `beat`, including its 7th when the
  // chord is voiced with one.
  chordPcs(beat) {
    return this.voiced(this.at(beat));
  },

  // Pitch classes of chord segment `seg` as a chord voice plays it.
  voiced(seg) {
    const c = seg.degree;
    if (typeof c === 'object') return soundingPcs(c).map(pc => (state.rootMidi + pc) % 12);
    return this.pcs(c, seg.seventh ? 4 : 3);
  },

  // Whether pitch class `pc` is one of the notes a tune has over chord segment `seg`
  // (see chordScale). The tones a chord offers past what it sounds, a natural ninth above
  // all, can be outside them: a Rhodes on F♯7 in B minor played G♯ against the tune's G.
  fits(pc, seg) {
    return chordScale(seg.degree, SCALE_NAMES[state.scaleIdx]).some(n => (state.rootMidi + n) % 12 === pc);
  },

  // The chord change an eighth note early: what a hit within an eighth of a change
  // plays, the anticipation that pushes a groove. (Rhodes has always done this.)
  pushed(beat) {
    const cur = this.at(beat);
    return beat + 0.5 >= cur.end - 1e-6 ? this.at(cur.end) : cur;
  },

  // The notes a melody can use at `beat`, as semitones above the tonic: the mode's,
  // bent to fit a chord from outside it (see chordScale). A pentatonic mode keeps
  // its five whatever the chord: its clash with a chord's third is the blues.
  scaleAt(beat) {
    if (!written) return currentScale();
    const name = SCALE_NAMES[state.scaleIdx];
    return isPent(name) ? currentScale() : chordScale(this.at(beat).degree, name);
  },

  // Root-position ascending chord from `baseMidi` (the tonic of the voice's
  // register), `count` stacked thirds. Used by arpeggiated voices.
  stack(beat, baseMidi, count = 3) {
    const scale = currentScale();
    const d     = this.at(beat).degree;
    const out   = [];
    if (typeof d === 'object') {
      for (let i = 0; i < count; i++) {
        let tone = d.tones[i % 5] + 12 * Math.floor(i / 5);
        // Composer 4: a tone the chord only offers has to fit, or its own notes go higher.
        if (state.composer >= 4 && i >= d.n && !this.fits((state.rootMidi + d.root + tone) % 12, this.at(beat))) {
          tone = d.tones[i % d.n] + 12 * Math.floor(i / d.n);
        }
        out.push(baseMidi + d.root + tone);
      }
      return out;
    }
    for (let i = 0; i < count; i++) {
      const deg = d + i * 2;
      out.push(baseMidi + Math.floor(deg / scale.length) * 12 + scale[deg % scale.length]);
    }
    return out;
  },

  // MIDI note of scale degree `degree` nearest to `near`.
  degreeNear(degree, near) {
    if (typeof degree === 'object') return nearestPc((state.rootMidi + degree.bass) % 12, near);
    const scale = currentScale();
    const pc = (state.rootMidi + scale[mod(degree, scale.length)]) % 12;
    return nearestPc(pc, near);
  },

  isChordTone(midi, beat) { return this.chordPcs(beat).includes(midi % 12); },

  // Pick from `notes`, biased toward chord tones at `beat`. With probability
  // `chance` (the Harmony control by default) the result is a chord tone;
  // otherwise any scale note is allowed as passing colour.
  pickChordTone(notes, beat, chance = state.harmonyLock) {
    if (random() < chance) {
      const pcs   = this.chordPcs(beat);
      const tones = notes.filter(m => pcs.includes(m % 12));
      if (tones.length) return pick(tones);
    }
    return pick(notes);
  },

  // ── Voice leading ───────────────────────────────────────────────────────
  // Choose the inversion and octave of `pcs` that moves least from the
  // previous voicing `prev`, with a pull toward `center` so it can't wander
  // out of range over many changes. This is the difference between a pad
  // that glides between chords and one that jumps in parallel blocks.
  voice(pcs, prev, center, around = null) {
    if (around && state.composer >= 2) return voiceAround(pcs, prev, center, around);
    let best = null, bestCost = Infinity;
    for (let inv = 0; inv < pcs.length; inv++) {
      const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
      for (let low = center - 14; low <= center + 2; low++) {
        if (mod(low, 12) !== order[0]) continue;
        const v = [low];
        for (let i = 1; i < order.length; i++) {
          let m = v[i - 1] + 1;
          while (mod(m, 12) !== order[i]) m++;
          v.push(m);
        }
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        let cost = Math.abs(mean - center) * (prev?.length ? 0.35 : 1);
        if (prev?.length) cost += movement(prev, v);
        // Close seconds at the bottom of a low voicing turn to mud.
        if (v[0] < 57 && v[1] - v[0] < 3) cost += 4;
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
    }
    return best;
  },
};

// A chord voice's notes and the tune's, from composer 2 on: what a chord voice holds
// has to leave the tune room. A held chord (`bed`) never stacks a minor second or
// ninth inside itself: G major seventh as F♯ G B D grinds, as G B D F♯ it doesn't.
// And any chord voice told the beats it sounds for (`from`, `to`) moves or leaves out
// a note a minor second or ninth from a note the tune plays over it, as an arranger
// would: under a tune on the root, the major seventh goes. A held chord that gives its
// `name` also voices round the other held chords sounding with it, and a held chord
// keeps under the tune where it can, so the tune stays the top line. Open (drop-2) voicings are
// offered beside the close ones for a held chord, so there's usually a way round
// without a jump, and no voicing puts a small interval low enough to turn to mud.
const GRINDS = d => d === 1 || d === 13;
// The lowest an interval sounds clear rather than muddy, as arrangers' low interval
// limits have it: a minor second down to E3, a minor third to C3, a fifth to B♭1.
const CLEAR = [0, 52, 51, 48, 46, 46, 47, 34, 41, 41, 41, 41];
const muddy = (lo, hi) => hi - lo < CLEAR.length && lo < CLEAR[hi - lo];
const CLASH = 20; // a clash held for the whole chord, against a semitone of movement
const OVER = 6;   // a held chord's top above the tune, for the whole chord
const DROP = 10;  // leaving the seventh out: it's what makes the chord, so only for a clash
function voiceAround(pcs, prev, center, { bed = false, name = null, from, to }) {
  // Another chord voice holding with this one counts as the tune does: a pad and a
  // choir each voiced on its own could put F♯ in one and G just above it in the other.
  const tune = lines.over(from, to), others = name ? lines.heldBy(name, from, to) : [];
  const span = Math.max(0.25, to - from);
  const sets = [pcs];
  for (let i = 3; i < pcs.length; i++) sets.push(pcs.filter((_, j) => j !== i));
  let best = null, bestCost = Infinity;
  for (const set of sets) {
    for (const v of shapes(set, center, bed)) {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      let cost = Math.abs(mean - center) * (prev?.length ? 0.35 : 1);
      if (prev?.length) cost += movement(prev, v);
      for (let i = 1; i < v.length; i++) if (muddy(v[i - 1], v[i])) cost += 15;
      if (set.length < pcs.length) cost += DROP;
      if (bed) for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (GRINDS(v[j] - v[i])) cost += 10;
      for (const n of tune) {
        const w = (Math.min(to, n.at + n.dur) - Math.max(from, n.at)) / span;
        if (w <= 0) continue;
        for (const m of v) if (GRINDS(Math.abs(m - n.midi))) cost += CLASH * w;
        if (bed && v[v.length - 1] > n.midi) cost += OVER * w; // the tune is the top line
      }
      for (const n of others) for (const m of v) if (GRINDS(Math.abs(m - n.midi))) cost += CLASH;
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  if (name) lines.hold(name, best, from, to);
  return best;
}

// Every close voicing of `pcs` with its bass within reach of `center`, and for a held
// chord each one's drop-2 (the second note from the top an octave down), lowest first.
function shapes(pcs, center, open) {
  const out = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let low = center - 14; low <= center + 2; low++) {
      if (mod(low, 12) !== order[0]) continue;
      const v = [low];
      for (let i = 1; i < order.length; i++) {
        let m = v[i - 1] + 1;
        while (mod(m, 12) !== order[i]) m++;
        v.push(m);
      }
      out.push(v);
      if (open && v.length >= 3 && v[v.length - 2] - 12 >= center - 18) {
        out.push([v[v.length - 2] - 12, ...v.slice(0, -2), v[v.length - 1]].sort((x, y) => x - y));
      }
    }
  }
  return out;
}

function nearestPc(pc, near) {
  const base = near - mod(near - pc, 12);        // at or below `near`
  return near - base <= 6 ? base : base + 12;
}

// Total semitone movement between two voicings of possibly different sizes:
// every note is matched to its nearest partner in the other chord.
function movement(a, b) {
  let cost = 0;
  for (const x of b) cost += Math.min(...a.map(y => Math.abs(x - y)));
  for (const y of a) cost += Math.min(...b.map(x => Math.abs(x - y)));
  return cost / 2;
}

// Bass register helper: the chord root at `beat`, in the octave nearest to
// the previous bass note, kept within [lo, hi].
// A gentle pull back toward the home register stops a long run of rising
// fourths from creeping up to the top of the range.
export function bassRoot(degree, prev, lo = 28, hi = 52) {
  const home   = register(42, lo, hi);
  const center = prev == null ? home : Math.round(prev * 0.6 + home * 0.4);
  return fold(harmony.degreeNear(degree, center), lo, hi);
}
