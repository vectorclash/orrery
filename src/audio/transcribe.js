import { SCALES, SCALE_NAMES } from '../state.js';
import { isPent, seven } from './chords.js';

// ─── Reading a hook out of a song ─────────────────────────────────────────────
// MORE LIKE THIS keeps a song's hook and changes everything else. A song from composer 2
// or later has its hook written down, but a composer 1 song never did: its tune is worked
// out note by note as it plays. So the way to learn what it is, is to play it and write
// down what comes out (transcribeHook in render.js plays it; `transcribe` here listens).
//
// A hook is plain data, kept with a song and carried in its links:
//   { chords: ['1', '6^7', '3', '7'], beats: 16, notes: [[at, len, deg], ...] }
// Its chords as tokens (see chords.js); how many beats it takes to come round; and each
// note's start and length in sixteenths, and its place in the scale (0 the tonic, 7 the
// octave). `notes` is null for a song with no tune to take: just its chords, then.

// Who might be carrying the tune, most likely first: the leads, written to be heard over
// everything else, then the riff instruments. The others play the chord's notes in
// patterns, which aren't a tune you could take away from the chords.
const TUNE_VOICES = ['monolead', 'melody', 'flute', 'brass', 'sitar', 'vibraphone', 'mallet', 'kalimba', 'clavinet', 'vox', 'sawpluck'];
// These log how long a note is meant to last; the rest, how long it rings, or a set length.
const LOGS_ITS_LENGTH = new Set(['monolead', 'melody', 'flute', 'brass', 'sitar']);

const MOST_BEATS = 64;
const LEAST_NOTES = 4;
const LEAST_PITCHES = 3;

const mod = (n, m) => ((n % m) + m) % m;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// The section a song's hook is heard in: its first chorus, drop or swell.
export const hookSection = song => song.sections.find(x => x.hook && x.energy[0] >= 0.6) ?? song.sections.find(x => x.hook) ?? null;

// A composer 1 section's chords as tokens: scale degrees, with a seventh where its draw
// and the Harmony lock say. Its pentatonic chords are stacked from the five notes, which
// tokens don't spell: the parent mode's triad on the same root is the nearest.
function chordTokens(sec, plan) {
  const name = SCALE_NAMES[plan.state.scaleIdx];
  if (isPent(name)) return sec.prog.map(d => String(seven(name).indexOf(SCALES[name][d]) + 1));
  return sec.prog.map((d, i) => `${d + 1}${sec.colours[i] < 1.1 - plan.state.harmonyLock ? '^7' : ''}`);
}

// A voice's notes, one to a sixteenth: where it doubles a note (a clavinet's double-stop, a
// brass section's third) the tune is the one it logged first.
function tuneOf(voice, log, from) {
  const out = new Map();
  for (const n of log) {
    if (n.voice !== voice) continue;
    const at = Math.round((n.beat - from) * 4);
    if (!out.has(at)) out.set(at, { at, midi: n.midi, dur: n.dur });
  }
  return [...out.values()].sort((a, b) => a.at - b.at);
}

const isTune = notes => notes.length >= LEAST_NOTES && new Set(notes.map(n => mod(n.midi, 12))).size >= LEAST_PITCHES;

// What a voice plays the most often, of its times round: a riff keeps coming back, and a
// lead that moves on gives its first. Null if it never plays a tune at all.
function bestRound(notes, sixteenths, whole) {
  const rounds = new Map();
  for (let k = 0; k < whole; k++) {
    const here = notes.filter(n => n.at >= k * sixteenths && n.at < (k + 1) * sixteenths);
    if (!isTune(here)) continue;
    const key = here.map(n => `${n.at - k * sixteenths}:${n.midi}`).join(' ');
    const got = rounds.get(key);
    if (got) got.times++;
    else rounds.set(key, { times: 1, start: k * sixteenths, here });
  }
  return [...rounds.values()].reduce((best, r) => (!best || r.times > best.times ? r : best), null);
}

// A note's place in the scale, from its height above the tonic. Composer 1's tunes keep to the mode.
const placeOf = (semis, scale) => Math.floor(semis / 12) * 7 + scale.indexOf(mod(semis, 12));

// The hook of a section just played, from `log`, the notes it played in the order they
// were scheduled: { voice, beat, midi, dur }, with `dur` in beats. Long enough to come
// round its chords a whole number of times, four bars at least if it can. The first voice
// to repeat itself has the tune, or if none does, the first voice with anything like one.
export function transcribe(plan, sec, log) {
  const chords = chordTokens(sec, plan);
  const loop = chords.length * (plan.state.chordBeats || 4);
  const multiple = loop * 16 / gcd(loop, 16);
  const beats = multiple <= MOST_BEATS ? multiple : loop;
  const whole = Math.floor(sec.beats / beats);
  const scale = seven(SCALE_NAMES[plan.state.scaleIdx]);
  const tonic = plan.state.rootMidi + sec.shift;

  const rounds = TUNE_VOICES
    .map(voice => ({ voice, round: bestRound(tuneOf(voice, log, sec.start), beats * 4, whole) }))
    .filter(x => x.round);
  const tune = rounds.find(x => x.round.times > 1) ?? rounds[0];
  if (!tune) return { chords, beats, notes: null };

  const { here, start } = tune.round;
  return {
    chords, beats,
    notes: here.map((n, i) => {
      const gap = (here[i + 1]?.at ?? start + beats * 4) - n.at;
      const len = LOGS_ITS_LENGTH.has(tune.voice) ? Math.min(gap, Math.max(1, Math.round(n.dur * 4))) : gap;
      return [n.at - start, len, placeOf(n.midi - tonic, scale)];
    }),
  };
}

// A written song's hook, as the same data: to keep it when another genre would write
// another. A sliding note's slide, its `alt`, was its genre's accent, and stays there.
export function hookOfWritten(song) {
  const sec = hookSection(song);
  if (!sec) return null;
  const { line } = sec;
  return {
    chords: sec.prog,
    beats: line?.beats ?? 16,
    notes: line?.notes.length ? line.notes.map(n => [Math.round(n.at * 4), Math.max(1, Math.round(n.len * 4)), n.deg]) : null,
  };
}
