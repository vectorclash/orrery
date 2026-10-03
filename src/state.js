// ─── Musical constants ────────────────────────────────────────────────────────
export const SCALES = {
  aeolian:    [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  minor_pent: [0, 3, 5, 7, 10],
  major_pent: [0, 2, 4, 7, 9],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
export const SCALE_NAMES = Object.keys(SCALES);

// ─── Shared mutable state ─────────────────────────────────────────────────────
// All modules import this same object reference and see each other's mutations.
// Pitches are standard MIDI note numbers (60 = middle C, 69 = A4 = 440 Hz).
export const ROOT_BASE_MIDI = 48; // C3 — rootMidi always stays within C3…B3
export const state = {
  rootMidi:    ROOT_BASE_MIDI,
  octaveShift: 0,
  scaleIdx:    0,
  tempo:       88,
  density:     0.5,
  brightness:  0.3,
  spaciousness: 0.5,
  harmonyLock: 0.78, // 0 = melodies roam the whole scale, 1 = strict chord tones
  chordBeats:  4,    // beats per chord — how often the progression advances
  era:         0,
  room:        'room', // acoustic space — see ROOMS in audio/context.js
  get rootBase() { return this.rootMidi + this.octaveShift * 12; },
};

// ─── Scheduler constants ──────────────────────────────────────────────────────
export const LOOKAHEAD = 0.12; // seconds
// Beat 0 of a new session sits this far ahead of "now": just enough for the
// first notes' attack ramps to start in the future (no pop), with the first
// tick run straight away rather than on the next timer fire.
export const START_DELAY = 0.04; // seconds
export const TICK_MS   = 60;   // milliseconds

// ─── Math helpers ─────────────────────────────────────────────────────────────
export function rand(a, b)  { return a + Math.random() * (b - a); }
export function pick(arr)   { return arr[Math.floor(Math.random() * arr.length)]; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ─── Music helpers ────────────────────────────────────────────────────────────
export function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

export function beat() { return 60 / state.tempo; }

export function currentScale() { return SCALES[SCALE_NAMES[state.scaleIdx]]; }

export function scaleNotes(rootMidi, scaleIntervals, octaves = 3) {
  const notes = [];
  for (let o = 0; o < octaves; o++) {
    for (const i of scaleIntervals) notes.push(rootMidi + o * 12 + i);
  }
  return notes;
}

// Move `midi` by whole octaves until it sits inside [lo, hi].
export function fold(midi, lo, hi) {
  while (midi < lo) midi += 12;
  while (midi > hi) midi -= 12;
  return midi;
}

// Register for a voice: the tonic nearest the voice's `home` note (where it
// sits at octave 0), moved by whole octaves with the Octave control, and kept
// within [lo, hi] — the range the instrument can sensibly sound in. The Octave
// control spans −1…+1 because that is all the room there is: −2 would put
// chords and leads around 65 Hz, too low to sound clearly, and −3 would drop
// most voices below their floor, where they fold back up and repeat −2.
export function register(home, lo, hi) {
  const tonic = fold(state.rootMidi, home - 6, home + 5);
  return fold(tonic + 12 * state.octaveShift, lo, hi);
}

export function scaleName() { return SCALE_NAMES[state.scaleIdx]; }

export function rootName() {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[state.rootMidi % 12];
}
