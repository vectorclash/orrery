import { state, SCALE_NAMES, pick, fold, register, currentScale } from '../state.js';
import { transport } from './transport.js';

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

const mod = (n, m) => ((n % m) + m) % m;

let form      = [0, 5, 2, 6];
let colour    = [];  // per-slot random draw deciding whether that chord gets a 7th
let idx       = 0;   // index into `form` of the chord sounding at `segStart`
let segStart  = 0;   // beat position where the current chord began
let lastLen   = 4;
let formScale = null;

function reroll(atBeat = segStart) {
  formScale = SCALE_NAMES[state.scaleIdx];
  form      = buildForm(formScale);
  colour    = form.map(() => Math.random());
  idx       = 0;
  segStart  = atBeat;
  lastLen   = chordLen();
}

function chordLen() { return state.chordBeats || 4; }

export const harmony = {
  reroll,

  // Called once per scheduler tick. Advances the chord pointer to wherever
  // the clock is now.
  tick(now) {
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
  get nextChange() { return segStart + chordLen(); },

  // The chord segment containing musical position `beat`.
  at(beat) {
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
    const seg = this.at(beat);
    return this.pcs(seg.degree, seg.seventh ? 4 : 3);
  },

  // Root-position ascending chord from `baseMidi` (the tonic of the voice's
  // register), `count` stacked thirds. Used by arpeggiated voices.
  stack(beat, baseMidi, count = 3) {
    const scale = currentScale();
    const d     = this.at(beat).degree;
    const out   = [];
    for (let i = 0; i < count; i++) {
      const deg = d + i * 2;
      out.push(baseMidi + Math.floor(deg / scale.length) * 12 + scale[deg % scale.length]);
    }
    return out;
  },

  // MIDI note of scale degree `degree` nearest to `near`.
  degreeNear(degree, near) {
    const scale = currentScale();
    const pc = (state.rootMidi + scale[mod(degree, scale.length)]) % 12;
    return nearestPc(pc, near);
  },

  isChordTone(midi, beat) { return this.chordPcs(beat).includes(midi % 12); },

  // Pick from `notes`, biased toward chord tones at `beat`. With probability
  // `chance` (the Harmony control by default) the result is a chord tone;
  // otherwise any scale note is allowed as passing colour.
  pickChordTone(notes, beat, chance = state.harmonyLock) {
    if (Math.random() < chance) {
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
  voice(pcs, prev, center) {
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
