import { state, SCALE_NAMES, ROOT_BASE_MIDI } from '../state.js';
import { getVoiceBus } from './context.js';
import { transport } from './transport.js';
import { harmony } from './harmony.js';
import { degreeSemis } from './chords.js';
import { voicesOf } from './language.js';

// ─── Lines ────────────────────────────────────────────────────────────────────
// The written lines playing now (see hook.js), and who has them. A voice with a
// line plays it instead of what it would otherwise choose; a voice without one
// carries on as it always has, so with nothing assigned (composer 1) `next` is null
// and nothing here draws or changes anything.
//
// Who can carry a line, and where a line sits in their register: [centre, lo, hi],
// MIDI notes. It's placed whole, a line moved by octaves to sit around the centre.
// `next` doesn't ask a voice's own register, so the hook's shape survives a key lift
// that would fold the voice's tonic down an octave.
const CARRIERS = {
  // Leads
  melody:     [72, 55, 88],
  flute:      [76, 60, 93],
  brass:      [65, 46, 82],
  sitar:      [64, 48, 80],
  vibraphone: [72, 53, 89],
  monolead:   [72, 52, 91],
  // Riff instruments
  mallet:     [67, 48, 84],
  kalimba:    [72, 55, 89],
  clavinet:   [64, 48, 82],
  vox:        [74, 60, 88],
  sawpluck:   [72, 50, 88],
  arpeggio:   [67, 40, 84],
  harp:       [67, 43, 86],
  // Air: long, ringing notes, so a busy line is thinned for them (see assignLines)
  bell:       [79, 60, 96],
  glass:      [76, 58, 94],
  texture:    [76, 58, 94],
};
export const canCarry = name => name in CARRIERS;
export const isAir = name => name === 'bell' || name === 'glass' || name === 'texture';

const RANK = Object.keys(CARRIERS);

// How far up a voice comes while it has the hook, in dB. The riff instruments are
// balanced to sit behind a mix, playing eight or ten notes a bar, and a hook they
// carry got lost: rendered and measured against the rest of its section, a sawpluck
// hook averaged 16 dB under, an arpeggio 13, where the mallet on the song that
// prompted all this sits 8 under and is easily the thing you remember. Only ever on
// a voice with a line, so nothing changes for anything else.
const TRIM = { sawpluck: 7, arpeggio: 5, harp: 5, texture: 5, kalimba: 4, mallet: 3, glass: 3, bell: 2, monolead: 1 };

// The voices in `names` able to carry a line, the language's choice first.
export function carriersIn(names, language) {
  const want = voicesOf(language);
  const place = n => {
    const i = want.indexOf(n);
    return i >= 0 ? i : want.length + RANK.indexOf(n);
  };
  return names.filter(canCarry).sort((a, b) => place(a) - place(b));
}

const mod = (n, m) => ((n % m) + m) % m;

let playing = new Map(); // voice → line
let from = 0;            // the beat the lines start from
let length = Infinity;   // how long they play for, in beats
let shift = 0;           // semitones the key is lifted from the song's own
let restFrom = Infinity; // the beat they stop for what's left of the section
let free = null;         // a loop's or an era's line, with no conductor to hand it out
let trimmed = null;      // the voice brought up, whose bus has to go back

function trim(name, at) {
  if (name === trimmed) return;
  // A beat long gone can fall before time began, once the tempo has moved: then it's
  // simply now. (A change of instruments mid-loop asks for the line's starting beat.)
  const t = Math.max(0, transport.timeAt(at));
  if (trimmed) getVoiceBus(trimmed).dry.gain.setValueAtTime(1, t);
  if (name) getVoiceBus(name).dry.gain.setValueAtTime(10 ** ((TRIM[name] ?? 0) / 20), t);
  trimmed = name;
}

// A song's lines all hang from its hook's mean (`anchor`), so a verse written lower
// than the chorus sounds lower, rather than each being centred on the voice.
function place(name, line) {
  const [centre, lo, hi] = CARRIERS[name];
  const tonic = ROOT_BASE_MIDI + mod(state.rootMidi - ROOT_BASE_MIDI - shift, 12);
  let oct = Math.round((centre - (tonic + (line.anchor ?? line.mean))) / 12) + state.octaveShift;
  while (tonic + line.low + 12 * oct < lo) oct++;
  while (tonic + line.high + 12 * oct > hi && tonic + line.low + 12 * (oct - 1) >= lo) oct--;
  return tonic + shift + 12 * oct;
}

export const lines = {
  // A song's section: who plays what, from beat `at`, for `beats` beats, up to beat
  // `rest`: over the bar that prepares a key lift, its dominant from outside the key, a
  // line in the old key has nothing right to play (composer 4).
  set(map, at, beats, keyShift = 0, rest = Infinity) {
    playing = new Map(Object.entries(map ?? {}));
    from = at;
    length = beats;
    shift = keyShift;
    restFrom = rest;
    free = null;
    trim(playing.keys().next().value ?? null, at); // the first is the hook's; the other's under it
  },

  // A loop's or an era's line, for the best carrier among `names`, from beat `at`.
  setFree(line, at, names, language) {
    free = { line, language };
    from = at;
    length = Infinity;
    shift = 0;
    restFrom = Infinity;
    this.follow(names);
  },

  // The instruments of a loop or an era changed: the line moves to whoever can carry it.
  follow(names) {
    if (!free) return;
    playing = new Map();
    const [first] = carriersIn(names, free.language);
    if (first) playing.set(first, free.line);
    trim(first ?? null, from);
  },

  // A new session has new buses, so there's nothing to bring back down.
  clear() {
    playing = new Map();
    free = null;
    from = 0;
    length = Infinity;
    shift = 0;
    restFrom = Infinity;
    trimmed = null;
  },

  // Whether anyone has a line: a lead without one then stands back from it.
  get busy() { return playing.size > 0; },

  // The note voice `name` plays at `beat`, or null if it has no line:
  // { midi, gap, dur, vel, i }, midi null for a rest, `i` the note's place in the line.
  next(name, beat) {
    const line = playing.get(name);
    if (!line) return null;
    if (beat >= restFrom - 1e-6) return { midi: null, gap: Math.max(0.25, from + length - beat) };
    const rel = beat - from;
    const n   = Math.floor(rel / line.beats + 1e-9);
    const pos = rel - n * line.beats;
    // Every fourth time round, and the last time in a section, it turns (see realise).
    const lastTime = n === Math.floor((length - 1e-6) / line.beats);
    const notes = line.fill && (n % 4 === 3 || lastTime) ? line.fill : line.notes;
    const i = notes.findIndex(x => x.at >= pos - 1e-6);
    if (i < 0) return { midi: null, gap: line.beats - pos };
    const x = notes[i];
    if (x.at > pos + 1e-6) return { midi: null, gap: x.at - pos }; // joined between notes
    const name7 = SCALE_NAMES[state.scaleIdx];
    const midi = place(name, line) + degreeSemis(x.deg, harmony.at(beat).degree, name7) + (x.alt ?? 0);
    return { midi, gap: (notes[i + 1]?.at ?? line.beats) - x.at, dur: x.len, vel: x.vel, i };
  },
};
