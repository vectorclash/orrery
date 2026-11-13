import { state, pick, rand, scaleNotes, random } from '../state.js';
import { harmony } from './harmony.js';
import { lines } from './lines.js';
import { within, stream } from '../random.js';
import { meter, accentAt, foldBeats } from './meter.js';

// ─── Phrase generator ─────────────────────────────────────────────────────────
// Melodic voices used to random-walk note by note, which is why they wandered.
// Real melodies are built from *motifs* — a short rhythm plus a contour —
// developed over a phrase:
//
//   bar 1  statement      the motif
//   bar 2  sequence       same motif, carrying on from bar 1 (an ostinato restarts from the chord)
//   bar 3  variation      same rhythm, contour inverted
//   bar 4  cadence        a closing rhythm that lands on a stable tone
//
// and the motif is kept for the next phrase more often than not, because
// repetition is what makes a line memorable. Within that frame the classic
// voice-leading rules apply: chord tones on strong beats, passing tones on
// weak ones, and a leap is followed by a step back the other way.
//
// Rhythms are cells of beats summing to one 4/4 bar; negative = rest.

const CELLS = {
  lyrical: [
    [2, 1, 1], [1, 1, 2], [1.5, 0.5, 2], [3, 1], [1, 0.5, 0.5, 2],
    [1.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [1, 1, 1, 1], [-1, 1, 1, 1], [2, -0.5, 0.5, 1],
  ],
  active: [
    [0.5, 0.5, 0.5, 0.5, 1, 1], [0.75, 0.75, 0.5, 0.75, 0.75, 0.5], [0.5, 1, 0.5, 1, 1],
    [0.25, 0.25, 0.5, 1, 0.5, 0.5, 1], [1.5, 1.5, 1], [0.5, 0.5, 1, 0.5, 0.5, 1],
    [0.75, 0.25, 0.5, 0.5, 1, 1], [-0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 1],
  ],
};
const CADENCES = {
  lyrical: [[1, 1, 2], [2, -2], [1, 1, 1, -1], [1.5, 0.5, 2], [3, -1]],
  active:  [[0.5, 0.5, 1, 2], [1, 1, 2], [0.5, 0.5, 0.5, 0.5, 1, -1], [0.75, 0.75, 0.5, 2]],
};

// Contour: scale-step movement between successive notes.
function contour(n, leapChance) {
  const shape = pick(['arch', 'fall', 'rise', 'wave', 'arch']);
  const steps = [0];
  for (let i = 1; i < n; i++) {
    const firstHalf = i < n / 2;
    let dir;
    if (shape === 'rise') dir = 1;
    else if (shape === 'fall') dir = -1;
    else if (shape === 'arch') dir = firstHalf ? 1 : -1;
    else dir = i % 2 ? 1 : -1;
    if (random() < 0.2) dir = -dir;
    const size = random() < leapChance ? pick([3, 4]) : pick([1, 1, 1, 2]);
    steps.push(dir * size);
  }
  return steps;
}

function newMotif(style, leapChance) {
  const rhythm  = pick(CELLS[style]);
  const cadence = pick(CADENCES[style]);
  const notes   = Math.max(rhythm.length, cadence.length);
  return { rhythm, cadence, steps: contour(notes, leapChance) };
}

// Shared by the lead voices so an answering phrase imitates the call.
//
// Each phrase's motif is drawn once, in phrase order, from the ensemble's own
// random stream, in the first lead's style. Not by whichever lead reaches the
// phrase first: within a tick each voice runs ahead to the horizon in turn, so
// which one that is depends on where the ticks fall, and a lead still
// finishing the last phrase would have asked for that one again.
export const ensemble = {
  leads:  [],        // names of the active lead voices (set by the scheduler)
  hold:   false,     // a song's hook: keep one motif for the whole section
  motifs: new Map(), // phrase → motif
  last:   -1,        // the latest phrase drawn
  styles: new Map(), // lead voice name → how it writes motifs
  // Forget the motifs: the next phrase asked for starts afresh.
  reset() { this.motifs.clear(); this.last = -1; },
};

function sharedMotif(phrase, own) {
  if (phrase > ensemble.last) {
    const { style, leap, repeat } = ensemble.styles.get(ensemble.leads[0]) ?? own;
    within(stream('ensemble'), () => {
      for (let q = ensemble.last < 0 ? phrase : ensemble.last + 1; q <= phrase; q++) {
        const prev = ensemble.motifs.get(q - 1);
        const keep = prev && (ensemble.hold || random() <= repeat);
        ensemble.motifs.set(q, keep ? prev : newMotif(style, leap));
        ensemble.motifs.delete(q - 3);
      }
    });
    ensemble.last = phrase;
  }
  return ensemble.motifs.get(phrase) ?? ensemble.motifs.get(ensemble.last);
}

// With two or more leads, they trade two-bar phrases (call and response);
// whoever isn't soloing drops to a quiet supporting role.
function soloist(name, beat) {
  const leads = ensemble.leads;
  if (leads.length < 2 || !leads.includes(name)) return true;
  return leads[Math.floor(beat / (2 * meter().beats)) % leads.length] === name;
}

const mod = (n, m) => ((n % m) + m) % m;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// How strong a note `pos` beats into the bar is, in the song's meter (see meter.js).
const metricAccent = pos => accentAt(pos);

const PHRASE_DYNAMICS = [0.9, 0.96, 1.0, 0.88]; // swell into bar 3, relax on the cadence

export function createPhraser({
  name,
  base,               // () → MIDI tonic at the bottom of the voice's register
  octaves  = 2,
  style    = 'lyrical',
  lead     = false,   // shares its motif and takes turns with other leads
  ostinato = false,   // riff: same cell every bar, re-anchored to each chord
  repeat   = 0.6,     // chance a new phrase keeps the previous motif
  leap     = 0.18,
}) {
  const local  = { motif: null, motifPhrase: -1 }; // non-lead voices keep their own
  if (lead) ensemble.styles.set(name, { style, leap, repeat });
  let lastMidi = null;
  let lastStep = 0;
  let curBar   = -1;
  let cell     = null;
  let flip     = 1;

  // One motif per 4-bar phrase, kept into the next phrase with p = `repeat`.
  function motifFor(bar) {
    const phrase = Math.floor(bar / 4);
    if (lead) return sharedMotif(phrase, { style, leap, repeat });
    if (local.motifPhrase !== phrase) {
      // Composer 2 holds a motif for a section: it comes round, it doesn't drift.
      if (!local.motif || (state.composer < 2 && random() > repeat)) local.motif = newMotif(style, leap);
      local.motifPhrase = phrase;
    }
    return local.motif;
  }

  function startBar(bar) {
    curBar = bar;
    const m = motifFor(bar);
    const inPhrase = bar % 4;
    // A motif's cells fill a 4/4 bar: in another meter, folded into its bar.
    if (ostinato) { cell = foldBeats(m.rhythm); flip = 1; return; }
    cell = foldBeats(inPhrase === 3 ? m.cadence : m.rhythm);
    flip = inPhrase === 2 ? -1 : 1;
  }

  function pool(beat) {
    return scaleNotes(base(), harmony.scaleAt(beat), octaves);
  }

  function nearestIndex(notes, midi) {
    let best = 0;
    for (let i = 1; i < notes.length; i++) {
      if (Math.abs(notes[i] - midi) < Math.abs(notes[best] - midi)) best = i;
    }
    return best;
  }

  // Nearest chord tone to index `j`, searching outward, preferring `dir`
  // (only in `dir` when `oneWay`). `stable` (cadences) restricts to the triad
  // and prefers the root.
  function snap(notes, j, beat, dir, stable = false, oneWay = false) {
    const tones  = stable ? harmony.pcs(harmony.at(beat).degree, 3) : harmony.chordPcs(beat);
    const search = ok => {
      for (let r = 0; r < notes.length; r++) {
        for (const s of oneWay ? [r * dir] : dir >= 0 ? [r, -r] : [-r, r]) {
          const k = j + s;
          if (k >= 0 && k < notes.length && ok(notes[k] % 12)) return k;
        }
      }
      return -1;
    };
    if (stable) {
      const root = search(pc => pc === tones[0]);
      if (root >= 0 && Math.abs(root - j) <= 2) return root;
    }
    const k = search(pc => tones.includes(pc));
    return k >= 0 ? k : j;
  }

  // Composer 2 remembers what it played, by where it falls in the chord loop, so a
  // phrase that comes round over the same chords comes round note for note. Without
  // this each note is worked out from the one before and the tune drifts: measured
  // on composer 1, the rhythm repeats every time and the pitches 60% of the time.
  const played = new Map();
  function memoKey(bar, i) {
    const w = harmony.written;
    if (!w) return null;
    const B = meter().beats, four = 4 * B;
    const cycle = w.beats % four === 0 ? w.beats : four * w.beats / gcd(w.beats, four);
    return `${mod(bar * B - w.at, cycle)}:${i}`;
  }

  return {
    // Next event at `beat`: { midi, gap, dur, vel } — midi is null for a rest.
    next(beat) {
      const written = lines.next(name, beat);
      if (written) return written;
      const B = meter().beats;
      const bar = Math.floor(beat / B + 1e-9);
      if (bar !== curBar) startBar(bar);
      const pos = beat - bar * B;

      // Locate the cell entry that starts at `pos`.
      let acc = 0, i = 0;
      while (i < cell.length && acc + Math.abs(cell[i]) <= pos + 1e-6) { acc += Math.abs(cell[i]); i++; }
      if (i >= cell.length) return { midi: null, gap: B - pos };
      if (pos - acc > 1e-6) return { midi: null, gap: acc + Math.abs(cell[i]) - pos }; // joined mid-note

      const len = Math.abs(cell[i]);
      if (cell[i] < 0) return { midi: null, gap: len };

      const solo = !lines.busy && soloist(name, beat);
      if (!solo && (lead || !lines.busy)) {
        // Supporting role: an occasional long, soft chord tone on the downbeat.
        if (i !== 0 || random() < 0.5) return { midi: null, gap: len };
        const notes = pool(beat);
        const j = snap(notes, nearestIndex(notes, lastMidi ?? notes[Math.floor(notes.length / 3)]), beat, 0);
        return { midi: notes[j], gap: len, dur: Math.max(len, 2), vel: 0.55 };
      }

      const notes    = pool(beat);
      const m        = motifFor(bar);
      const inPhrase = bar % 4;
      const lastNote = cell.slice(i + 1).every(x => x < 0);
      const key      = memoKey(bar, i);
      if (key && played.has(key)) {
        const midi = played.get(key);
        lastStep = lastMidi === null ? 0 : nearestIndex(notes, midi) - nearestIndex(notes, lastMidi);
        lastMidi = midi;
        return { midi, gap: len, dur: len, vel: metricAccent(pos) * PHRASE_DYNAMICS[inPhrase] * rand(0.92, 1.05) };
      }
      let j;
      if (lastMidi === null || (ostinato && i === 0)) {
        // Phrase/riff start: nearest chord tone to the middle of the register
        // (or to where the riff was), so the figure follows the harmony.
        const anchor = lastMidi ?? notes[Math.floor(notes.length / 3)];
        j = snap(notes, nearestIndex(notes, ostinato ? notes[Math.floor(notes.length / 3)] : anchor), beat, 0);
      } else {
        let step = (m.steps[i % m.steps.length] || 0) * flip;
        const recovering = Math.abs(lastStep) >= 3;
        if (recovering) step = -Math.sign(lastStep); // recover from a leap by step
        j = nearestIndex(notes, lastMidi) + step;
        if (j < 0 || j >= notes.length) j = nearestIndex(notes, lastMidi) - step; // bounce off the range edge
        j = Math.max(0, Math.min(notes.length - 1, j));
        const strong = metricAccent(pos) >= 0.92 || len >= 1.5;
        const leapt  = Math.abs(step) >= 2;
        if ((strong || leapt) && random() < 0.35 + 0.65 * state.harmonyLock) {
          j = snap(notes, j, beat, Math.sign(step), false, recovering);
        }
      }
      if (lastNote && inPhrase === 3 && !ostinato) j = snap(notes, j, beat, 0, true);

      const midi = notes[j];
      if (key) played.set(key, midi);
      lastStep = lastMidi === null ? 0 : nearestIndex(notes, midi) - nearestIndex(notes, lastMidi);
      lastMidi = midi;
      const vel = metricAccent(pos) * PHRASE_DYNAMICS[inPhrase] * rand(0.92, 1.05);
      return { midi, gap: len, dur: len, vel };
    },

    reset() {
      local.motif = null; local.motifPhrase = -1;
      lastMidi = null; lastStep = 0; curBar = -1; cell = null;
      played.clear();
    },
  };
}
