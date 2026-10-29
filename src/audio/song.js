import { SCALE_NAMES } from '../state.js';
import { seeded, hashSeed } from '../random.js';
import { progressionsFor } from './harmony.js';

// ─── Songs ────────────────────────────────────────────────────────────────────
// A song keeps what makes it itself -- key, tempo, instruments, chord
// progressions, the hook -- and changes its arrangement from section to
// section: who plays, how hard the drums hit, how bright and full it is. That
// is what an intro, a verse, a chorus or a drop *is*; an era change, which
// rerolls everything at once, sounds like a different record.
//
// A song is composed from a plan (see applyPlan in scheduler.js) and a seed,
// as plain data, so the export renderer composes the same song from the same
// plan. The scheduler's conductor plays it: at each section it sets the chords
// and the instruments, and every beat it sets the feel from the section's
// energy. Every section of a kind is seeded alike (see reseedStreams), so a
// second chorus plays what the first one played.
//
// Three forms:
//   song    -- intro, verses, choruses (the hook), a bridge, an outro
//   club    -- dance music: grooves, builds with a snare roll and a riser,
//              drops, breakdowns
//   ambient -- no beat to speak of: a theme, swells and drifts

// What each kind of section is for. `energy` is where it starts and ends
// (0 the barest, 1 everything at full tilt); the conductor sets density,
// brightness, space and pump from it. `bars` is a length at a moderate tempo,
// scaled to the song's tempo and target length.
//   roles  -- how many voices of each role play (9: all of them), then
//             whether the bass plays and the drums' level: 'pulse' (kick and
//             time), 'light' (the beat without its accents), 'full', or null
//   hook   -- the leads keep one motif all section, the same in every hook section
//   prog   -- which of the song's progressions it plays
const KINDS = {
  // song
  intro:     { label: 'INTRO',      bars: 8,  energy: [0.22, 0.36], prog: 'verse' },
  verse:     { label: 'VERSE',      bars: 16, energy: [0.48, 0.52], prog: 'verse' },
  pre:       { label: 'PRE-CHORUS', bars: 8,  energy: [0.56, 0.74], prog: 'pre' },
  chorus:    { label: 'CHORUS',     bars: 16, energy: [0.88, 0.92], prog: 'chorus', hook: true },
  bridge:    { label: 'BRIDGE',     bars: 8,  energy: [0.42, 0.62], prog: 'bridge' },
  outro:     { label: 'OUTRO',      bars: 8,  energy: [0.4, 0.16],  prog: 'chorus' },
  // club
  open:      { label: 'INTRO',      bars: 16, energy: [0.3, 0.45],  prog: 'main' },
  groove:    { label: 'GROOVE',     bars: 16, energy: [0.58, 0.64], prog: 'main' },
  build:     { label: 'BUILD',      bars: 8,  energy: [0.5, 0.86],  prog: 'main' },
  drop:      { label: 'DROP',       bars: 16, energy: [0.98, 1],    prog: 'main', hook: true },
  breakdown: { label: 'BREAKDOWN',  bars: 16, energy: [0.26, 0.34], prog: 'break', hook: true },
  close:     { label: 'OUTRO',      bars: 16, energy: [0.5, 0.2],   prog: 'main' },
  // ambient
  dawn:      { label: 'INTRO',      bars: 8,  energy: [0.15, 0.3],  prog: 'theme' },
  theme:     { label: 'THEME',      bars: 16, energy: [0.42, 0.5],  prog: 'theme' },
  swell:     { label: 'SWELL',      bars: 16, energy: [0.62, 0.8],  prog: 'theme', hook: true },
  drift:     { label: 'DRIFT',      bars: 16, energy: [0.34, 0.3],  prog: 'drift' },
  dusk:      { label: 'OUTRO',      bars: 8,  energy: [0.32, 0.12], prog: 'theme' },
  // the last chord, held while everything else has stopped
  end:       { label: 'END',        bars: 0,  energy: [0.12, 0.08] },
};

// Who plays in each kind of section. A function of the composer's draw, so a
// recipe can vary from song to song; the result is stored with the section.
const RECIPES = {
  intro:     r => ({ bed: 1, air: 9, motion: r() < 0.5 ? 1 : 0, lead: 0, bass: false, drums: r() < 0.25 ? 'pulse' : null }),
  verse:     r => ({ bed: 1, air: 0, motion: 1, lead: r() < 0.6 ? 1 : 0, bass: true, drums: 'light' }),
  pre:       () => ({ bed: 9, air: 1, motion: 9, lead: 1, bass: true, drums: 'light' }),
  chorus:    () => ({ bed: 9, air: 9, motion: 9, lead: 9, bass: true, drums: 'full' }),
  bridge:    r => ({ bed: 9, air: 1, motion: r() < 0.5 ? 1 : 0, lead: 1, bass: r() < 0.6, drums: r() < 0.5 ? 'light' : null }),
  outro:     () => ({ bed: 1, air: 9, motion: 1, lead: 0, bass: false, drums: null }),
  open:      r => ({ bed: 0, air: 0, motion: r() < 0.5 ? 1 : 0, lead: 0, bass: r() < 0.5, drums: 'pulse' }),
  groove:    r => ({ bed: r() < 0.5 ? 1 : 0, air: 0, motion: 9, lead: 0, bass: true, drums: 'light' }),
  build:     () => ({ bed: 1, air: 0, motion: 9, lead: 0, bass: false, drums: 'light' }), // the drop brings the low end back
  drop:      () => ({ bed: 9, air: 9, motion: 9, lead: 9, bass: true, drums: 'full' }),
  breakdown: () => ({ bed: 9, air: 9, motion: 0, lead: 9, bass: false, drums: null }),
  close:     r => ({ bed: 0, air: 1, motion: 1, lead: 0, bass: r() < 0.5, drums: 'pulse' }),
  dawn:      () => ({ bed: 1, air: 1, motion: 0, lead: 0, bass: false, drums: null }),
  theme:     r => ({ bed: 9, air: 1, motion: 1, lead: r() < 0.5 ? 1 : 0, bass: true, drums: 'light' }),
  swell:     () => ({ bed: 9, air: 9, motion: 9, lead: 9, bass: true, drums: 'full' }),
  drift:     () => ({ bed: 1, air: 9, motion: 0, lead: 1, bass: false, drums: null }),
  dusk:      () => ({ bed: 1, air: 9, motion: 0, lead: 0, bass: false, drums: null }),
  end:       () => ({ bed: 9, air: 0, motion: 0, lead: 0, bass: false, drums: null }),
};

// Forms, picked by weight and then varied.
const FORMS = {
  song: [
    [3, ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro']],
    [3, ['intro', 'verse', 'pre', 'chorus', 'verse', 'pre', 'chorus', 'bridge', 'chorus', 'outro']],
    [2, ['intro', 'verse', 'verse', 'chorus', 'bridge', 'chorus', 'outro']],
    [1, ['intro', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro']],
  ],
  club: [
    [3, ['open', 'build', 'drop', 'breakdown', 'build', 'drop', 'close']],
    [3, ['open', 'groove', 'build', 'drop', 'breakdown', 'build', 'drop', 'groove', 'close']],
    [2, ['open', 'groove', 'breakdown', 'build', 'drop', 'groove', 'close']],
    [1, ['open', 'build', 'drop', 'groove', 'breakdown', 'build', 'drop', 'close']],
  ],
  ambient: [
    [2, ['dawn', 'theme', 'swell', 'theme', 'drift', 'swell', 'dusk']],
    [2, ['dawn', 'theme', 'drift', 'swell', 'dusk']],
    [1, ['dawn', 'drift', 'theme', 'swell', 'drift', 'dusk']],
  ],
};

// Target lengths in seconds.
const LENGTH = { song: [150, 230], club: [190, 280], ambient: [170, 260] };

// Section lengths in bars: phrases of four and eight, as songs are written.
const NICE_BARS = [4, 8, 16, 24, 32, 48, 64];
// Which kinds of section take up the slack first when a song is short of its
// length: the ones it's about.
const GROW = ['chorus', 'drop', 'verse', 'swell', 'theme', 'groove', 'breakdown', 'drift',
  'intro', 'open', 'dawn', 'outro', 'close', 'dusk', 'bridge', 'pre', 'build'];

// Drum styles whose music is built in builds and drops.
const CLUB_DRUMS = new Set([
  'house', 'deep_house', 'techno', 'trance', 'big_room', 'disco', 'afro_house', 'amapiano',
  'garage', 'dnb', 'jungle', 'breakbeat', 'four_four',
]);
// Drums too quiet to carry a song form on their own.
const SOFT_DRUMS = new Set(['minimal', 'ghost']);

export function formFor(plan) {
  const d = plan.drumStyle;
  if (d && CLUB_DRUMS.has(d)) return 'club';
  if (!d || (SOFT_DRUMS.has(d) && plan.state.density < 0.45)) return 'ambient';
  return 'song';
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => a * b / gcd(a, b);

// Composes the song a plan describes: its form, every section's length,
// energy, chords and instruments. `roleOf` names a voice's role.
export function composeSong(plan, roleOf) {
  const seed = plan.song.seed >>> 0;
  const r    = seeded(hashSeed(seed, 'form'));
  const pick = a => a[Math.floor(r() * a.length)];
  const form = formFor(plan);

  // The sequence of sections: a weighted form, varied a little.
  const forms = FORMS[form];
  let w = r() * forms.reduce((s, [n]) => s + n, 0), kinds = forms[0][1];
  for (const [n, k] of forms) if ((w -= n) <= 0) { kinds = k; break; }
  kinds = [...kinds];
  if (form === 'song' && r() < 0.3) kinds.splice(kinds.lastIndexOf('chorus') + 1, 0, 'chorus'); // a double chorus to finish
  if (form === 'song' && r() < 0.15 && kinds.includes('bridge')) kinds.splice(kinds.indexOf('bridge'), 1);
  if (form === 'club' && r() < 0.3) kinds.splice(kinds.lastIndexOf('drop') + 1, 0, 'drop');

  // Chords: a progression per part of the song, distinct where it matters.
  const scale = SCALE_NAMES[plan.state.scaleIdx];
  const options = progressionsFor(scale);
  const other = (...not) => {
    const left = options.filter(p => !not.includes(p));
    return pick(left.length ? left : options);
  };
  const progs = {};
  progs.verse  = pick(options);
  progs.chorus = r() < 0.7 ? other(progs.verse) : progs.verse;
  progs.pre    = r() < 0.5 ? progs.verse : other(progs.verse, progs.chorus);
  progs.bridge = other(progs.verse, progs.chorus);
  progs.main   = progs.chorus;
  progs.break  = r() < 0.6 ? progs.main : other(progs.main);
  progs.theme  = progs.verse;
  progs.drift  = other(progs.theme);
  const colours = new Map(Object.values(progs).map(p => [p, p.map(() => r())]));

  // Lengths: the kinds' bars scaled to a target length at this tempo, then to
  // the nearest phrase length that is a whole number of units: four bars, or
  // the progression if it runs longer (eight bars of two-bar chords), so a
  // section starts its chords from the top.
  const cb   = plan.state.chordBeats || 4;
  const unit = lcm(4 * cb, 16) <= 32 ? lcm(4 * cb, 16) : 16;
  const [lo, hi] = LENGTH[form];
  const target = lo + r() * (hi - lo);
  const spb = 60 / plan.state.tempo;
  const fits = NICE_BARS.filter(n => (n * 4) % unit === 0);
  const snap = want => fits.reduce((a, n) => (Math.abs(Math.log(n / want)) < Math.abs(Math.log(a / want)) ? n : a));
  const bars = {};
  const total = () => kinds.reduce((sum, k) => sum + bars[k] * 4, 0) * spb;
  // Everything as short as it will go to fit the target, all kinds scaled
  // alike; then, one kind at a time, the parts that carry a song longer,
  // while that brings it nearer the target.
  let f = 2.5;
  do {
    for (const k of kinds) bars[k] = snap(KINDS[k].bars * f);
    f -= 0.05;
  } while (f > 0.5 && total() > target);
  for (const k of GROW) {
    if (!(k in bars)) continue;
    const longer = fits.find(n => n > bars[k]);
    if (!longer || longer > KINDS[k].bars * 2.5) continue;
    const before = total(), was = bars[k];
    bars[k] = longer;
    if (Math.abs(total() - target) >= Math.abs(before - target)) bars[k] = was;
  }

  // A key change up for the last chorus, now and then.
  const lift = form === 'song' && r() < 0.3 ? (r() < 0.75 ? 2 : 1) : 0;
  const lastChorus = kinds.lastIndexOf('chorus');

  const sections = [];
  const seen = {};
  const recipes = {};
  let at = 0, shift = 0;
  kinds.forEach((kind, i) => {
    const k = KINDS[kind];
    const beats = bars[kind] * 4;
    const next = kinds[i + 1];
    if (i === lastChorus && lift) shift = lift;
    // The same recipe for every section of a kind: they're the same section.
    recipes[kind] ??= RECIPES[kind](r);
    seen[kind] = (seen[kind] ?? 0) + 1;
    const final = kind === 'chorus' && i === lastChorus || kind === 'drop' && i === kinds.lastIndexOf('drop');
    sections.push({
      kind,
      label: k.label,
      n: seen[kind],
      start: at,
      beats,
      // A little more each time a chorus comes back.
      energy: k.energy.map(e => Math.min(1, e + (k.hook ? 0.03 * (seen[kind] - 1) : 0) + (final ? 0.02 : 0))),
      prog: progs[k.prog],
      colours: colours.get(progs[k.prog]),
      roles: recipes[kind],
      hook: !!k.hook,
      shift,
      // Transitions
      fill:     !!next && form !== 'ambient',                         // drum fill on the last bar
      roll:     kind === 'build',                                     // snare roll building into the drop
      gap:      kind === 'build' && next === 'drop' && r() < 0.6 ? pick([1, 1, 2]) : 0, // silence before the drop
      riser:    kind === 'build',
      swell:    (next === 'chorus' || next === 'swell') && kind !== 'chorus',
      impact:   kind === 'drop' || (kind === 'chorus' && final),
      downlift: kind === 'breakdown',
      crash:    kind === 'chorus' || kind === 'drop' || kind === 'swell',
    });
    at += beats;
  });

  // A fill lands on a crash.
  for (let i = 1; i < sections.length; i++) sections[i].crash ||= sections[i - 1].fill;

  // The end: the tonic, held.
  const endBeats = Math.max(8, cb);
  sections.push({
    kind: 'end', label: KINDS.end.label, n: 1, start: at, beats: endBeats,
    energy: KINDS.end.energy, prog: [0], colours: [1], roles: RECIPES.end(r), hook: false, shift,
    fill: false, roll: false, gap: 0, riser: false, swell: false, impact: false, downlift: false, crash: false,
  });
  at += endBeats;

  const song = { seed, form, sections, end: at, tempo: plan.state.tempo };
  arrange(song, plan, roleOf);
  return song;
}

// Which instruments play in each section: the recipe's count of each role,
// taken from the plan's instruments in an order fixed for the song. Kept apart
// from composing so a change of instruments mid-song (Edit mode) rearranges
// the same song.
export function arrange(song, plan, roleOf) {
  const r = seeded(hashSeed(song.seed, 'parts'));
  const names = [...plan.voices.filter(n => n !== 'drums')].sort();
  // Shuffle, then a stable order per role: "the first motion voice" is the
  // same voice all song.
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const byRole = { bed: [], motion: [], lead: [], air: [] };
  for (const n of names) (byRole[roleOf(n)] ?? byRole.motion).push(n);
  const hasDrums = plan.voices.includes('drums'), hasBass = !!plan.bassStyle;

  for (const s of song.sections) {
    const voices = [];
    for (const role of ['bed', 'motion', 'lead', 'air']) voices.push(...byRole[role].slice(0, s.roles[role]));
    const drums = hasDrums && s.roles.drums ? s.roles.drums : null;
    let bass = hasBass && s.roles.bass;
    // Never an empty section: fall back to the first voice there is, in
    // order of what sounds most like the music on its own.
    if (!voices.length && !drums && !bass) {
      const first = byRole.bed[0] ?? byRole.motion[0] ?? byRole.lead[0] ?? byRole.air[0];
      if (first) voices.push(first);
      else bass = hasBass;
    }
    s.voices = drums ? ['drums', ...voices] : voices;
    s.drums  = drums;
    s.bass   = bass;
  }
}

// ─── The song playing now ─────────────────────────────────────────────────────
// Set by the scheduler; read by the conductor, the drums, the effects and the
// display. Beat 0 is the song's first downbeat.
export const song = {
  current: null,
  base:    null, // the song's own feel and key, before a section varies them
  // The section sounding at beat `b`, or null outside the song.
  sectionAt(b) {
    const s = this.current;
    if (!s || b < 0 || b >= s.end) return null;
    let lo = 0, hi = s.sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s.sections[mid].start <= b + 1e-9) lo = mid; else hi = mid - 1;
    }
    return s.sections[lo];
  },
  // The section's energy at beat `b`, from its start value to its end value.
  energyAt(sec, b) {
    const x = Math.min(1, Math.max(0, (b - sec.start) / sec.beats));
    return sec.energy[0] + (sec.energy[1] - sec.energy[0]) * x;
  },
};

// Seconds from the first downbeat to the end of the last chord.
export const songSeconds = s => s.end * 60 / s.tempo;
