import { audio, noise } from '../context.js';
import { state, beat, rand, pick, currentScale, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony, bassRoot } from '../harmony.js';
import { osc, gain, filter, perc, ahr, lfo, pluckBuffer, playBuffer, shaper } from '../synth.js';

// ─── Bass ─────────────────────────────────────────────────────────────────────
// Every style is tied to the harmonic rhythm: the chord root lands on the
// arrival of each chord, no note is held across a chord change, and the last
// note before a change often *leads into* the next root (an approach tone) —
// that anticipation is most of what makes a bass line sound like a line.

const STYLES = ['sub', 'plucked', 'walking', 'synth', 'rumble'];
// The dance styles are chosen in Manual mode (or by a genre); Infinite mode's
// reroll keeps to STYLES above, so it sounds as it always has. The later ones
// (GROOVE_STYLES) draw from their own block, so the first three's sequence of
// draws is untouched by them.
const FIRST_DANCE_STYLES = ['deep', 'acid', 'rolling'];
const GROOVE_STYLES = ['disco', '808', 'reese', 'log'];
export const DANCE_STYLES = [...FIRST_DANCE_STYLES, ...GROOVE_STYLES];
const LO = 26, HI = 59; // D1 … B3

// Plucked (finger bass): one-bar rhythms of [beats, note]. R root, F fifth,
// O octave, A approach into the next chord (a chord tone if none is coming).
const PLUCK_RHYTHMS = [
  [[1.5, 'R'], [0.5, 'R'], [1, 'F'], [1, 'A']],
  [[1, 'R'], [1, 'R'], [1, 'F'], [1, 'A']],
  [[0.75, 'R'], [0.75, 'R'], [0.5, 'O'], [1, 'F'], [1, 'A']],
  [[2, 'R'], [1.5, 'F'], [0.5, 'A']],
  [[1.5, 'R'], [1.5, 'F'], [1, 'A']],
];
// Synth: sixteenth-note patterns. Letters start a note, '-' holds it, '.' rests.
const SYNTH_PATTERNS = [
  'R.O.R.O.R.O.R.O.', // octave bounce (disco / electro)
  '..R-..R-..R-..R-', // off-beat eighths (house / trance)
  'R-.R-.R-R-.R-.O-', // 3-3-2 syncopation with an octave pickup
  'R-R-R-R-R-R-F-A-', // driving eighths into the change
];

// Deep house: a rounded organ bass in syncopated sixteenths, leaving room for
// the kick on the beat.
const DEEP_PATTERNS = [
  '...R..R....R..R.',
  'R-.R..R-..R.R-..',
  '..R-..R-..R-.RA-',
  'R..R..R.R..R..O.',
];
// Rolling (trance / EDM): sixteenths that skip the beat, where the kick is.
const ROLLING_PATTERNS = [
  '.RRR.RRR.RRR.RRR',
  '.R.R.R.R.R.R.RRA',
  '..RR..RR..RR..RO',
];
let deepPattern = DEEP_PATTERNS[0];
let rollPattern = ROLLING_PATTERNS[0];

// Disco: octaves -- the root and the root an octave up, back and forth in
// eighths, the sound of every disco record and most of nu-disco.
const DISCO_PATTERNS = [
  'R.O.R.O.R.O.R.O.', // the octave bounce
  'R-O-R-O-R-O-R-OA', // legato octaves, an approach into the change
  'R..OR.O.R..OR.O.', // syncopated octaves
  'R.O.F.O.R.O.F.OA', // octaves and the fifth
];
// 808 (trap): long, sliding notes under a sparse kick. '-' holds a note.
const PATTERNS_808 = [
  'R---------R-----',
  'R-------R-R---O-',
  'R------R--R-----',
  'R---------O--R--',
];
// Reese (drum & bass): long notes, two bars of movement at most.
const REESE_PATTERNS = [
  'R-----------R-A-',
  'R-------R-------',
  'R-----R-------A-',
  'R-----------F-A-',
];
// Log drum (amapiano): a syncopated, melodic riff of pitched hits.
const LOG_PATTERNS = [
  '..R..R..R.O...R.',
  'R..R..O...R..F..',
  '...R..R.O..R..A.',
  'R.....R..R..O.R.',
];
const GROOVE_PATTERNS = { disco: DISCO_PATTERNS, '808': PATTERNS_808, reese: REESE_PATTERNS, log: LOG_PATTERNS };
let groovePattern = null; // chosen at the first bar of a groove style
let held808 = null;       // { midi, until } -- the 808 still sounding, for slides

// Acid (TB-303): a two-bar sixteenth sequence of notes, accents and slides
// that repeats like a sequencer and mutates a little each phrase. Notes are
// chord tones and their octaves, as a 303 line mostly is.
let acidSeq = [];
function makeAcid() {
  const seq = [];
  for (let i = 0; i < 32; i++) {
    if (Math.random() < (i % 4 === 0 ? 0.2 : 0.38)) { seq.push(null); continue; }
    seq.push({
      code: pick(['R', 'R', 'R', 'O', 'O', 'F', '3', '7']),
      accent: Math.random() < 0.28,
      slide: Math.random() < 0.22,
    });
  }
  return seq;
}
function mutateAcid(seq) {
  return seq.map(s => (Math.random() < 0.15 ? makeAcid()[0] : s));
}

let style  = 'sub';
let prev   = null; // last bass note (MIDI) — keeps root motion smooth
let curBar = -1;
let cell   = PLUCK_RHYTHMS[0];
let pattern = SYNTH_PATTERNS[0];

const inRange = m => Math.max(LO, Math.min(HI, m));
const inScale = m => currentScale().includes((((m - state.rootMidi) % 12) + 12) % 12);

function root(seg)     { return bassRoot(seg.degree, prev, LO, HI); }
function nextRoot(seg) { return bassRoot(seg.next, prev, LO, HI); }
function fifth(r)      { return r + 7 <= HI ? r + 7 : r - 5; }

// Lead into `target` from `from`: a chromatic half step (most common), a
// diatonic neighbour, or the target's own fifth (a dominant approach).
function approach(target, from) {
  const dir = from > target ? 1 : -1; // come in from the side we're already on
  const r = Math.random();
  if (r < 0.45) return inRange(target + dir);
  if (r < 0.8) {
    for (let d = 1; d <= 2; d++) if (inScale(target + dir * d)) return inRange(target + dir * d);
  }
  return inRange(target + (dir > 0 ? 7 : -5));
}

function resolve(code, b, len) {
  const seg = harmony.at(b);
  const r   = root(seg);
  if (b - seg.start < 1e-6) return r; // chord arrival always gets the root
  if (code === 'A') return b + len >= seg.end - 1e-6 ? approach(nextRoot(seg), prev ?? r) : fifth(r);
  if (code === 'F') return fifth(r);
  if (code === 'O') return r + 12 <= HI + 5 ? r + 12 : r;
  return r;
}

// Acid notes: root, octave, fifth, and the chord's third and seventh.
function resolveAcid(code, b) {
  const seg = harmony.at(b);
  const r = root(seg);
  if (code === 'O') return r + 12 <= HI + 5 ? r + 12 : r;
  if (code === 'F') return fifth(r);
  if (code === '3' || code === '7') {
    const pcs = harmony.pcs(seg.degree, 4);
    const pc = pcs[code === '3' ? 1 : 3];
    let m = r;
    while ((((m - pc) % 12) + 12) % 12 !== 0) m++;
    return inRange(m);
  }
  return r;
}

// Walking bass: steady quarters. Root on the chord's arrival, an approach
// note on the last beat before a change, and in between chord tones (on
// strong beats) or scale steps that head toward the next root without
// reaching it early.
function walkNote(b) {
  const seg = harmony.at(b);
  const k = b - seg.start, left = seg.end - b;
  if (k < 1e-6 || prev === null) return root(seg);
  const target = nextRoot(seg);
  if (left <= 1 + 1e-6) return approach(target, prev);
  const pcs = harmony.pcs(seg.degree, seg.seventh ? 4 : 3);
  const options = [];
  for (let m = prev - 5; m <= prev + 5; m++) {
    if (m === prev || m < LO || m > HI) continue;
    const chordTone = pcs.includes(m % 12);
    if (!chordTone && !inScale(m)) continue;
    let w = chordTone ? (Math.round(k) % 2 === 0 ? 4 : 2) : 1;
    if (Math.abs(target - m) < Math.abs(target - prev)) w += 1.5;
    if (m === target) w = 0.2;
    options.push([m, w]);
  }
  let total = options.reduce((s, [, w]) => s + w, 0), r = Math.random() * total;
  for (const [m, w] of options) if ((r -= w) <= 0) return m;
  return root(seg);
}

// ─── Sounds ───────────────────────────────────────────────────────────────────
function subBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.8);
  const hz = midiToHz(midi), end = t + dur + 0.1;
  const lp = filter('lowpass', 320, 0.7);
  osc('sine', hz, t, end).connect(lp);
  const tri = osc('triangle', hz, t, end), triG = gain(0.5);
  tri.connect(triG); triG.connect(lp);
  if (hz / 2 >= 35) { // a sub-octave only where it's still audible
    const s = osc('sine', hz / 2, t, end), sG = gain(0.5);
    s.connect(sG); sG.connect(lp);
  }
  const env = gain(0);
  ahr(env.gain, t, rand(0.09, 0.12), 0.03, dur - 0.06, 0.05);
  lp.connect(env); env.connect(audio.pumped);
}

function stringBass(t, midi, dur, { bright, pick: pos, t60, level }) {
  logNote('bass', t, midi, dur, 0.85);
  const src = playBuffer(pluckBuffer(midi, { t60, bright, pick: pos, stretch: 0.5, length: Math.min(t60, dur + 0.2) }), t, t + dur + 0.2);
  const lp = filter('lowpass', 1800, 0.7);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + 0.004);
  env.gain.setTargetAtTime(0, t + dur, 0.03);
  src.connect(lp); lp.connect(env); env.connect(audio.pumped);
  // Finger/string thump under the attack.
  const th = noise(t, 0.03), thLp = filter('lowpass', 220), thE = gain(0);
  perc(thE.gain, t, level * 0.5, 0.02, 0.001);
  th.connect(thLp); thLp.connect(thE); thE.connect(audio.pumped);
}

function synthBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.85);
  const hz = midiToHz(midi), end = t + dur + 0.1;
  const peak = rand(0.085, 0.11);
  for (const detune of [-8, 8]) {
    const o = osc('sawtooth', hz, t, end, detune);
    const lp = filter('lowpass', 80, 6);
    lp.frequency.setValueAtTime(80, t);
    lp.frequency.exponentialRampToValueAtTime(600 + 500 * state.brightness, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.06, dur * 0.8));
    const env = gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.006);
    env.gain.setTargetAtTime(0, t + dur, 0.02);
    o.connect(lp); lp.connect(env); env.connect(audio.pumped);
  }
}

function rumbleBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.7);
  const hz = midiToHz(midi), end = t + dur + 0.6;
  const peak = rand(0.07, 0.09);
  const lp = filter('lowpass', 300, 1.5);
  osc('square', hz, t, end).connect(lp);
  if (hz / 2 >= 35) osc('sine', hz / 2, t, end).connect(lp);
  const env = gain(0);
  ahr(env.gain, t, peak, 0.2, dur - 0.1, 0.5);
  const trem = osc('sine', rand(3, 6), t, end), tremG = gain(peak * 0.3);
  trem.connect(tremG); tremG.connect(env.gain);
  lp.connect(env); env.connect(audio.pumped);
}

// Organ bass (the M1 of deep house): a sine with its second and third harmonics,
// plucked -- a quick bloom, then down to a held body that stops with the note.
function deepBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.85);
  const hz = midiToHz(midi), end = t + dur + 0.1;
  const sum = gain(1);
  for (const [k, lvl] of [[1, 1], [2, 0.35], [3, 0.12]]) {
    const o = osc('sine', hz * k, t, end), g = gain(lvl);
    o.connect(g); g.connect(sum);
  }
  const lp = filter('lowpass', 600 + 600 * state.brightness, 0.7);
  const peak = rand(0.23, 0.27); // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.setTargetAtTime(peak * 0.55, t + 0.004, 0.08);
  env.gain.setTargetAtTime(0, t + dur, 0.025);
  sum.connect(lp); lp.connect(env); env.connect(audio.pumped);
}

// TB-303: one sawtooth (sometimes square) through a resonant lowpass whose
// envelope is the squelch. An accent opens it further and plays louder; a
// slide glides into the next note without restarting the envelope. The
// cutoff also wanders slowly over bars -- the hand on the knob.
let acidWave = 'sawtooth';
function acidNote(t, midi, dur, accent, toMidi) {
  logNote('bass', t, midi, dur, accent ? 1 : 0.75);
  const hz = midiToHz(midi), end = t + dur + 0.08;
  const o = osc(acidWave, hz, t, end);
  if (toMidi !== null) {
    o.frequency.setValueAtTime(hz, t + dur - 0.06);
    o.frequency.exponentialRampToValueAtTime(midiToHz(toMidi), t + dur);
  }
  const knob = 0.5 + 0.5 * Math.sin(transport_bars(t) * Math.PI / 4);
  const base = lerpN(180, 900, 0.4 * knob + 0.6 * state.brightness);
  const lp = filter('lowpass', base, accent ? 16 : 11);
  lp.frequency.setValueAtTime(base * (accent ? 7 : 4), t);
  lp.frequency.setTargetAtTime(base, t, accent ? 0.09 : 0.06);
  const drive = shaper(2.2);
  const peak = accent ? 0.21 : 0.155; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.003);
  env.gain.setTargetAtTime(peak * 0.7, t + 0.003, 0.1);
  env.gain.setTargetAtTime(0, t + dur, 0.015);
  o.connect(lp); lp.connect(drive); drive.connect(env); env.connect(audio.pumped);
}
const lerpN = (a, b, x) => a + (b - a) * x;
const transport_bars = t => t / (beat() * 4);

// Disco: a Moog-style bass -- a saw and a square through a resonant lowpass
// that snaps open on every note, short and bouncy.
function discoBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.85);
  const hz = midiToHz(midi), end = t + dur + 0.08;
  const sum = gain(1);
  osc('sawtooth', hz, t, end).connect(sum);
  const sq = osc('square', hz, t, end, 6), sqG = gain(0.45);
  sq.connect(sqG); sqG.connect(sum);
  const top = 450 + 900 * state.brightness;
  const lp = filter('lowpass', top, 5);
  lp.frequency.setValueAtTime(top * 2.4, t);
  lp.frequency.setTargetAtTime(top * 0.7, t, 0.06);
  const peak = rand(0.1, 0.115); // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.003);
  env.gain.setTargetAtTime(peak * 0.7, t + 0.003, 0.09);
  env.gain.setTargetAtTime(0, t + dur, 0.02);
  sum.connect(lp); lp.connect(env); env.connect(audio.pumped);
}

// 808: a sine with a fast pitch drop (the punch), saturated so it is heard on
// a phone speaker, held for as long as the note. A note that follows one still
// sounding glides up or down into its pitch -- the 808 slide.
function bass808(t, midi, dur, fromMidi) {
  logNote('bass', t, midi, dur, 0.9);
  const hz = midiToHz(midi), end = t + dur + 0.15;
  const o = osc('sine', hz, t, end);
  if (fromMidi !== null) {
    o.frequency.setValueAtTime(midiToHz(fromMidi), t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.09);
  } else {
    o.frequency.setValueAtTime(hz * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
  }
  const drive = shaper(1.8);
  const peak = 0.128; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.setTargetAtTime(peak * 0.7, t + 0.004, 0.35);
  env.gain.setTargetAtTime(0, t + dur, 0.04);
  o.connect(drive); drive.connect(env); env.connect(audio.pumped);
}

// Reese: two saws a few cents apart, beating slowly against each other (the
// phasing that is the sound), through a lowpass that drifts, over a sine sub.
function reeseBass(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.8);
  const hz = midiToHz(midi), end = t + dur + 0.12;
  const saws = gain(1);
  for (const d of [-14, 14]) osc('sawtooth', hz, t, end, d).connect(saws);
  const base = 260 + 600 * state.brightness;
  const lp = filter('lowpass', base, 3);
  lfo(rand(0.15, 0.4), base * 0.45, t, end, 0, 0.1).connect(lp.frequency);
  const sub = osc('sine', hz, t, end), subG = gain(0.9);
  const peak = 0.075; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.01);
  env.gain.setTargetAtTime(0, t + dur, 0.05);
  saws.connect(lp); lp.connect(env);
  sub.connect(subG); subG.connect(env);
  env.connect(audio.pumped);
}

// Log drum: the amapiano bass -- a hollow, pitched knock. A sine that drops
// into its pitch, a little saturation, a woody click, and a lowpass that
// closes behind the hit; it rings briefly rather than holding.
function logDrum(t, midi, dur) {
  logNote('bass', t, midi, dur, 0.9);
  const hz = midiToHz(midi), ring = Math.min(dur, 0.5), end = t + ring + 0.3;
  const o = osc('sine', hz * 2.2, t, end);
  o.frequency.setValueAtTime(hz * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
  const h = osc('triangle', hz * 2, t, end), hG = gain(0.25);
  const sum = gain(1);
  o.connect(sum); h.connect(hG); hG.connect(sum);
  const lp = filter('lowpass', 2400, 2);
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.setTargetAtTime(380 + 400 * state.brightness, t, 0.05);
  const drive = shaper(1.6);
  const peak = 0.2; // level-matched to the other bass styles
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.002);
  env.gain.setTargetAtTime(peak * 0.45, t + 0.002, 0.12);
  env.gain.setTargetAtTime(0, t + ring, 0.06);
  sum.connect(lp); lp.connect(drive); drive.connect(env); env.connect(audio.pumped);
  const knock = noise(t, 0.02), bp = filter('bandpass', 750, 1.5), kG = gain(0);
  perc(kG.gain, t, peak * 0.5, 0.015, 0.0005);
  knock.connect(bp); bp.connect(kG); kG.connect(audio.pumped);
}

// ─── Scheduling ───────────────────────────────────────────────────────────────
function play(t, b) {
  const bar = Math.floor(b / 4 + 1e-9), pos = b - bar * 4;
  if (bar !== curBar) {
    curBar = bar;
    if (GROOVE_STYLES.includes(style)) {
      if (!groovePattern || (bar % 4 === 0 && Math.random() < 0.3)) groovePattern = pick(GROOVE_PATTERNS[style]);
    } else if (FIRST_DANCE_STYLES.includes(style)) {
      // The dance styles draw only here, so the classic styles' draws are untouched.
      if (bar % 4 === 0 && Math.random() < 0.3) deepPattern = pick(DEEP_PATTERNS);
      if (bar % 4 === 0 && Math.random() < 0.3) rollPattern = pick(ROLLING_PATTERNS);
      if (!acidSeq.length) acidSeq = makeAcid();
      else if (bar % 2 === 0 && Math.random() < 0.5) acidSeq = mutateAcid(acidSeq);
    } else {
      if (Math.random() < 0.3) cell = pick(PLUCK_RHYTHMS);
      if (Math.random() < 0.15) pattern = pick(SYNTH_PATTERNS);
    }
  }
  if (style === 'acid') {
    const i = Math.round(pos * 4) % 16, k = (bar % 2) * 16 + i;
    const s = acidSeq[k];
    if (!s) return 0.25;
    const midi = resolveAcid(s.code, b);
    const nextStep = acidSeq[(k + 1) % 32];
    const slideTo = s.slide && nextStep ? resolveAcid(nextStep.code, b + 0.25) : null;
    prev = midi;
    acidNote(t, midi, beat() * 0.25 * (slideTo !== null ? 1.02 : 0.6), s.accent, slideTo);
    return 0.25;
  }
  if (style === 'deep' || style === 'rolling') {
    const pat = style === 'deep' ? deepPattern : rollPattern;
    const i = Math.round(pos * 4) % 16, ch = pat[i];
    if (ch !== '.' && ch !== '-') {
      let n = 1;
      while (i + n < 16 && pat[i + n] === '-') n++;
      const midi = resolve(ch, b, n / 4);
      prev = midi;
      if (style === 'deep') deepBass(t, midi, (n / 4) * beat() * 0.85);
      else synthBass(t, midi, (n / 4) * beat() * 0.7);
    }
    return 0.25;
  }

  if (GROOVE_STYLES.includes(style)) {
    const pat = groovePattern, i = Math.round(pos * 4) % 16, ch = pat[i];
    if (ch === '.' || ch === '-') return 0.25;
    let n = 1;
    while (i + n < 16 && pat[i + n] === '-') n++;
    const seg = harmony.at(b);
    const beats = Math.min(n / 4, seg.end - b); // never held across a chord change
    const midi = resolve(ch, b, n / 4);
    if (style === 'disco') discoBass(t, midi, beats * beat() * 0.88);
    else if (style === 'reese') reeseBass(t, midi, beats * beat() * 0.96);
    else if (style === 'log') logDrum(t, midi, beats * beat());
    else {
      // Slide from the 808 still sounding, if there is one and it is another note.
      const from = held808 && held808.until >= t - 1e-3 && held808.midi !== midi && Math.random() < 0.6 ? held808.midi : null;
      bass808(t, midi, beats * beat(), from);
      held808 = { midi, until: t + beats * beat() };
    }
    prev = midi;
    return 0.25;
  }

  if (style === 'sub' || style === 'rumble') {
    const seg = harmony.at(b), len = seg.end - b;
    prev = root(seg);
    (style === 'sub' ? subBass : rumbleBass)(t, prev, len * beat());
    return len;
  }

  if (style === 'walking') {
    prev = walkNote(b);
    stringBass(t, prev, beat() * 0.95, { bright: 0.22, pick: 0.28, t60: 1.2, level: 0.5 });
    return 1;
  }

  if (style === 'plucked') {
    let acc = 0;
    for (const [len, code] of cell) {
      if (Math.abs(acc - pos) < 1e-6) {
        const midi = resolve(code, b, len);
        prev = midi;
        stringBass(t, midi, len * beat() * 0.9, { bright: 0.4, pick: 0.18, t60: 1.6, level: 0.42 });
        return len;
      }
      if (acc > pos) return acc - pos;
      acc += len;
    }
    return 4 - pos;
  }

  // synth: one sixteenth step at a time
  const i = Math.round(pos * 4) % 16, ch = pattern[i];
  if (ch !== '.' && ch !== '-') {
    let n = 1;
    while (i + n < 16 && pattern[i + n] === '-') n++;
    const midi = resolve(ch, b, n / 4);
    prev = midi;
    synthBass(t, midi, (n / 4) * beat() * 0.9);
  }
  return 0.25;
}

const voice = createVoice('bass', play, {
  onReset: () => {
    prev = null; curBar = -1; groovePattern = null; held808 = null;
    // Only a dance style draws here, so a classic style's sequence of draws is untouched.
    if (FIRST_DANCE_STYLES.includes(style)) { acidSeq = makeAcid(); acidWave = Math.random() < 0.7 ? 'sawtooth' : 'square'; }
  },
});

export const bassVoice = {
  ...voice,
  get style() { return style; },
  reroll() { style = pick(STYLES); cell = pick(PLUCK_RHYTHMS); pattern = pick(SYNTH_PATTERNS); },
  setStyle(s) { style = s; },
};
