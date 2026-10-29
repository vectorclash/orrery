import { state, pick, rand, currentScale, scaleNotes, random } from '../state.js';
import { harmony } from './harmony.js';
import { within, stream } from '../random.js';

// ─── Phrase generator ─────────────────────────────────────────────────────────
// Melodic voices used to random-walk note by note, which is why they wandered.
// Real melodies are built from *motifs* — a short rhythm plus a contour —
// developed over a phrase:
//
//   bar 1  statement      the motif
//   bar 2  sequence       same motif, restarted on the new chord
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
  return leads[Math.floor(beat / 8) % leads.length] === name;
}

function metricAccent(pos) {
  const on = (x, d) => Math.abs(x / d - Math.round(x / d)) < 1e-6;
  if (on(pos, 4)) return 1.0;
  if (on(pos, 2)) return 0.92;
  if (on(pos, 1)) return 0.85;
  if (on(pos, 0.5)) return 0.78;
  return 0.72;
}

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
      if (!local.motif || random() > repeat) local.motif = newMotif(style, leap);
      local.motifPhrase = phrase;
    }
    return local.motif;
  }

  function startBar(bar) {
    curBar = bar;
    const m = motifFor(bar);
    const inPhrase = bar % 4;
    if (ostinato) { cell = m.rhythm; flip = 1; return; }
    cell = inPhrase === 3 ? m.cadence : m.rhythm;
    flip = inPhrase === 2 ? -1 : 1;
  }

  function pool() {
    return scaleNotes(base(), currentScale(), octaves);
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

  return {
    // Next event at `beat`: { midi, gap, dur, vel } — midi is null for a rest.
    next(beat) {
      const bar = Math.floor(beat / 4 + 1e-9);
      if (bar !== curBar) startBar(bar);
      const pos = beat - bar * 4;

      // Locate the cell entry that starts at `pos`.
      let acc = 0, i = 0;
      while (i < cell.length && acc + Math.abs(cell[i]) <= pos + 1e-6) { acc += Math.abs(cell[i]); i++; }
      if (i >= cell.length) return { midi: null, gap: 4 - pos };
      if (pos - acc > 1e-6) return { midi: null, gap: acc + Math.abs(cell[i]) - pos }; // joined mid-note

      const len = Math.abs(cell[i]);
      if (cell[i] < 0) return { midi: null, gap: len };

      const solo = soloist(name, beat);
      if (!solo) {
        // Supporting role: an occasional long, soft chord tone on the downbeat.
        if (i !== 0 || random() < 0.5) return { midi: null, gap: len };
        const notes = pool();
        const j = snap(notes, nearestIndex(notes, lastMidi ?? notes[Math.floor(notes.length / 3)]), beat, 0);
        return { midi: notes[j], gap: len, dur: Math.max(len, 2), vel: 0.55 };
      }

      const notes    = pool();
      const m        = motifFor(bar);
      const inPhrase = bar % 4;
      const lastNote = cell.slice(i + 1).every(x => x < 0);
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
      lastStep = lastMidi === null ? 0 : nearestIndex(notes, midi) - nearestIndex(notes, lastMidi);
      lastMidi = midi;
      const vel = metricAccent(pos) * PHRASE_DYNAMICS[inPhrase] * rand(0.92, 1.05);
      return { midi, gap: len, dur: len, vel };
    },

    reset() {
      local.motif = null; local.motifPhrase = -1;
      lastMidi = null; lastStep = 0; curBar = -1; cell = null;
    },
  };
}
