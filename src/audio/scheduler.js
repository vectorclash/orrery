import { audio, beginSession, setEchoTime, setRoom, clearSpace, updateLowCuts, updateLevel, noteClock, gateGap, easeLevel, presetLevel } from './context.js';
import { state, SCALE_NAMES, TICK_MS, LOOKAHEAD, ROOT_BASE_MIDI, rand, pick, beat, random, clamp } from '../state.js';
import { seedStreams, reseedStreams, restream, newSeed, stream } from '../random.js';
import { harmony } from './harmony.js';
import { logChange } from './notes.js';
import { transport } from './transport.js';
import { ensemble } from './phrase.js';
import { song, composeSong, arrange } from './song.js';
import { barBeats } from './meter.js';
import { lines } from './lines.js';
import { languageOf, intervalsFor, LANGUAGE_NAMES } from './language.js';
import { writeMotif, lineOver } from './hook.js';
import { fxVoice } from './voices/fx.js';

import { bassVoice }     from './voices/bass.js';
import { padVoice }      from './voices/pad.js';
import { melodyVoice }   from './voices/melody.js';
import { textureVoice }  from './voices/texture.js';
import { pluckVoice }    from './voices/pluck.js';
import { bellVoice }     from './voices/bell.js';
import { arpeggioVoice } from './voices/arpeggio.js';
import { malletVoice }   from './voices/mallet.js';
import { droneVoice }    from './voices/drone.js';
import { fluteVoice }    from './voices/flute.js';
import { choirVoice }    from './voices/choir.js';
import { stringsVoice }  from './voices/strings.js';
import { rhodesVoice }     from './voices/rhodes.js';
import { organVoice }      from './voices/organ.js';
import { glassVoice }      from './voices/glass.js';
import { harpVoice }       from './voices/harp.js';
import { brassVoice }      from './voices/brass.js';
import { drumsVoice }      from './voices/drums.js';
import { vibraphoneVoice } from './voices/vibraphone.js';
import { clavinetVoice }   from './voices/clavinet.js';
import { sitarVoice }      from './voices/sitar.js';
import { kalimbaVoice }    from './voices/kalimba.js';
import { supersawVoice }   from './voices/supersaw.js';
import { junoVoice }       from './voices/juno.js';
import { solinaVoice }     from './voices/solina.js';
import { synthbrassVoice } from './voices/synthbrass.js';
import { monoleadVoice }   from './voices/monolead.js';
import { stabVoice }       from './voices/stab.js';
import { voxVoice }        from './voices/vox.js';
import { sawpluckVoice }   from './voices/sawpluck.js';
import { guitarVoice }     from './voices/guitar.js';
import { pumpVoice }       from './voices/pump.js';
import { sweepVoice }      from './voices/sweep.js';

export {
  bassVoice, padVoice, melodyVoice, textureVoice, pluckVoice,
  bellVoice, arpeggioVoice, malletVoice, droneVoice, fluteVoice,
  choirVoice, stringsVoice, rhodesVoice, organVoice, glassVoice,
  harpVoice, brassVoice, drumsVoice,
  vibraphoneVoice, clavinetVoice, sitarVoice, kalimbaVoice, supersawVoice,
  junoVoice, solinaVoice, synthbrassVoice, monoleadVoice,
  stabVoice, voxVoice, sawpluckVoice, guitarVoice,
};

// ─── Orchestration ────────────────────────────────────────────────────────────
// Infinite mode used to draw 3–5 voices at random, which could produce four
// melodies fighting and no harmony underneath. An arrangement needs roles:
// a harmonic bed, usually one lead line, something that moves, and
// optionally some air on top and drums.
const ROLES = {
  bed:    [padVoice, stringsVoice, choirVoice, organVoice, droneVoice, supersawVoice, junoVoice, solinaVoice, synthbrassVoice],
  lead:   [melodyVoice, fluteVoice, brassVoice, sitarVoice, vibraphoneVoice, monoleadVoice],
  motion: [arpeggioVoice, harpVoice, pluckVoice, kalimbaVoice, malletVoice, clavinetVoice, rhodesVoice],
  air:    [bellVoice, glassVoice, textureVoice],
};
// The dance voices are chosen in Manual mode (or by a genre), not drawn into
// Infinite mode's eras by role, so Infinite sounds as it always has.
const DANCE_VOICES = [stabVoice, voxVoice, sawpluckVoice, guitarVoice];
const ALL_VOICES = [bassVoice, drumsVoice, ...Object.values(ROLES).flat(), ...DANCE_VOICES];

export let activeVoices = [];

function draw(list, n) {
  return list.slice().sort(() => random() - 0.5).slice(0, n);
}

export function pickVoices() {
  const v = draw(ROLES.bed, random() < 0.25 ? 2 : 1);
  if (random() < 0.8)  v.push(...draw(ROLES.lead, 1));
  if (random() < 0.85) v.push(...draw(ROLES.motion, random() < 0.25 ? 2 : 1));
  if (random() < 0.45) v.push(...draw(ROLES.air, 1));
  while (v.length < 3) v.push(...draw([...ROLES.motion, ...ROLES.air].filter(x => !v.includes(x)), 1));
  if (random() < 0.35) v.push(drumsVoice);
  setActiveVoices(v);
}

// A manual-mode arrangement as plain data, so the export renderer (its own
// copy of the engine, in an iframe) can play exactly what the controls say.
// { state: {...fields}, bassStyle, drumStyle, voices: [names], song?: { seed } }
// With `song`, the plan is a song's: it's composed from the plan and the seed
// (see song.js), and the voices are its instruments, which the conductor
// brings in and out section by section.
export function applyPlan(plan) {
  Object.assign(state, plan.state);
  if (plan.bassStyle) bassVoice.setStyle(plan.bassStyle);
  if (plan.drumStyle) drumsVoice.setStyle(plan.drumStyle);
  if (plan.song) {
    song.current = composeSong(plan, roleOf);
    song.current.buildTrimDb = plan.song.buildTrimDb ?? 0;
    song.base = { ...state };
    setActiveVoices([]);
  } else {
    song.current = null;
    setActiveVoices(voicesNamed(plan.voices));
  }
}

const voicesNamed = names => names.map(n => ALL_VOICES.find(v => v.name === n)).filter(Boolean);
const roleOf = name => ALL_VOICES.find(v => v.name === name)?.role ?? null;

// The song a plan describes, without playing it: for its length and sections.
export const songFor = plan => composeSong(plan, roleOf);

export function setActiveVoices(voices) {
  activeVoices = voices;
  ensemble.leads = voices.filter(v => v.role === 'lead').map(v => v.name);
  lines.follow(voices.map(v => v.name));
}

// A loop or an era has no song to write its hook: it writes one for its own chords,
// and whoever can carry it has it, from beat `at`.
function writeFreeLine(at) {
  if (state.composer < 2 || song.current) return;
  const w = harmony.written;
  const name = SCALE_NAMES[state.scaleIdx];
  const motif = writeMotif(stream('writing'), languageOf(state.language), w.tokens, name, state.chordBeats || 4, state.harmonyLock, { spoken: intervalsFor(state.language, state.composer) });
  lines.setFree(lineOver(motif, w.tokens, name, state.chordBeats || 4), at, activeVoices.map(v => v.name), state.language);
}

// ─── Session ──────────────────────────────────────────────────────────────────
// Beat `from` (0, the start) falls at audio time `t`. Fresh buses, a fresh
// chord progression, and every voice re-enters on the grid. A song's session
// takes the song's seed, so it plays the same every time; any other, a fresh
// one. A song can start partway, at a section's first beat: each section is
// seeded on its own, so it plays as it would have (see levelOfSong in render.js).
export function startSession(t, from = 0) {
  restart(t, from);
  logChange(t);
}

function restart(t, from) {
  seedStreams(song.current ? song.current.seed : newSeed());
  beginSession();
  transport.start(t, from);
  setEchoTime(beat() * 0.75, t);
  harmony.reroll(0);
  ensemble.reset();
  ensemble.hold = state.composer >= 2; // composer 2's motifs hold for a section
  lines.clear();
  writeFreeLine(0);
  for (const v of ALL_VOICES) v.reset();
  if (state.composer >= 2 && !song.current) bassVoice.newSection(); // a song's sections do this
  pumpVoice.reset();
  sweepVoice.reset();
  fxVoice.reset();
  lastTickTime = 0;
  eraTimer = 0;
  eraAt = null;
  eraBegan = 0;
  songBeat = from;
  songBass = false;
  heard = null;
  audio.level.holdsAt = song.current ? levelHoldsAt : null;
  const g = audio.sectionGain.gain;
  g.cancelScheduledValues(0);
  g.setValueAtTime(1, t);
  trimmed = null;
}

// ─── Space ────────────────────────────────────────────────────────────────────
// Infinite mode's space follows how spacious the era is, one size smaller
// when it's fast: a cathedral tail under 120 bpm sixteenths is mush.
const ROOM_ORDER = ['studio', 'room', 'hall', 'cathedral'];
export function roomFor(spaciousness, tempo) {
  let i = spaciousness < 0.35 ? 0 : spaciousness < 0.6 ? 1 : spaciousness < 0.8 ? 2 : 3;
  if (tempo > 115) i = Math.max(0, i - 1);
  return ROOM_ORDER[i];
}

// ─── Era / evolution ──────────────────────────────────────────────────────────
export let eraTimer = 0;
export const ERA_DURATION = 38;

// Beat position of a requested era change (infinite mode's NEXT), or null.
// Lands on the next bar line rather than waiting for the era to run out:
// a bar line keeps the drums and the new chord progression on the grid.
// It's computed from now + LOOKAHEAD, which is past anything already
// scheduled, so no note gets scheduled in the old key after it.
export let eraAt = null;
export function requestEra() {
  if (!audio.started || eraAt !== null) return;
  eraAt = transport.nextBeat(audio.ctx.currentTime + LOOKAHEAD, 4);
}

// Beat position at which a change of arrangement made now is heard in full,
// given the voices sounding before it. A voice that joins waits for its next
// `entry` grid line (a bar for drums and most leads, a beat for the rest);
// anything else -- a new key, tempo or style, a voice dropping out -- is
// heard as soon as the notes already scheduled have played.
export function changeLandsAt(before, after) {
  const now = audio.ctx.currentTime;
  let at = transport.beatAt(now + LOOKAHEAD);
  for (const v of after) if (!before.includes(v)) at = Math.max(at, transport.nextBeat(now, v.entry === 'bar' ? barBeats() : v.entry));
  return at;
}

// Beat position of the coming era change, once one is due: a requested one
// at its bar line, or one whose time is up at the next chord change. Null
// while the era is still running.
export function eraDue() {
  if (eraAt !== null) return eraAt;
  return eraTimer >= ERA_DURATION ? harmony.nextChange : null;
}

// Beat position at which the current era began.
export let eraBegan = 0;

// Starts the new era exactly at beat `at` (a chord change).
function advanceEra(at) {
  for (const v of sounding(false).keys()) v.release(transport.timeAt(at));
  state.era++;
  eraBegan = at;
  // Move by a closely related interval (or stay), keeping the tonic within
  // one octave — register comes from octaveShift, not from the root drifting.
  const shifts = [-7, -5, -2, 0, 0, 2, 5, 7];
  state.rootMidi     = ROOT_BASE_MIDI + ((state.rootMidi - ROOT_BASE_MIDI + pick(shifts)) % 12 + 12) % 12;
  state.scaleIdx     = Math.floor(random() * SCALE_NAMES.length);
  const tempoShift   = random() < 0.3 ? rand(-35, 35) : rand(-15, 15);
  state.tempo        = Math.max(52, Math.min(130, state.tempo + tempoShift));
  state.brightness   = rand(0.1, 0.9);
  state.spaciousness = rand(0.2, 0.85);
  state.density      = rand(0.2, 0.9);
  state.octaveShift  = pick([-1, 0, 0, 1]);
  state.chordBeats   = pick([4, 4, 8]);
  state.room         = roomFor(state.spaciousness, state.tempo);
  // Each era speaks a language of its own (composer 2), any genre's: its chords and
  // its hook, whatever instruments it draws.
  if (state.composer >= 2) state.language = pick(LANGUAGE_NAMES);
  transport.retime(at);
  setEchoTime(beat() * 0.75, transport.timeAt(at));
  setRoom(state.room, transport.timeAt(at));
  harmony.reroll(at);
  logChange(transport.timeAt(at));

  // A new era is a new section: everyone re-enters on its first downbeat.
  pickVoices();
  bassVoice.reroll();
  drumsVoice.reroll();
  if (state.composer >= 2) { ensemble.reset(); writeFreeLine(at); }
  for (const v of ALL_VOICES) v.reset(at);
  if (state.composer >= 2) bassVoice.newSection();
}

function drift() {
  state.brightness   = Math.max(0.05, Math.min(0.95, state.brightness   + (random() - 0.5) * 0.002));
  state.density      = Math.max(0.10, Math.min(1.00, state.density      + (random() - 0.5) * 0.001));
  state.spaciousness = Math.max(0.10, Math.min(0.90, state.spaciousness + (random() - 0.5) * 0.001));
}

// ─── Song ─────────────────────────────────────────────────────────────────────
// The conductor: plays the loaded song (song.current) beat by beat. Like an
// era change, every voice is run up to the beat first, then the beat is
// applied, so nothing is scheduled with the last section's chords or players.
// At a section's first beat: its chords and instruments, every voice
// restarting there, and every random stream reseeded from the kind of section
// it is, so each verse, chorus or drop plays what the first one did. Every
// beat: the feel, from the section's energy and the song's own (song.base).
// Near a build's end, the chord it holds (see BUILDS in song.js).
let songBeat = 0;     // the next beat the conductor acts on
let songBass = false; // whether the bass plays in this section

function conduct(now, skipBass) {
  const end = song.current.end;
  while (songBeat <= end && transport.timeAt(songBeat) < now + LOOKAHEAD) {
    runVoices(now, transport.timeAt(songBeat), skipBass || !songBass);
    onBeat(songBeat);
    songBeat++;
  }
  runVoices(now, now + LOOKAHEAD, skipBass || !songBass);
}

function onBeat(b) {
  if (b === song.current.end) {
    // Over: nobody starts another note, and long notes (the drone) let go.
    setActiveVoices([]);
    songBass = false;
    ensemble.hold = false;
    lines.clear();
    for (const v of ALL_VOICES) v.reset(b);
    return;
  }
  const sec = song.sectionAt(b);
  if (b === sec.start) enterSection(sec, b);
  setFeel(song.energyAt(sec, b));
  if (b === sec.holdFrom && !sec.turnFrom) harmony.setForm([sec.build.hold], [0.5], b);
  if (b === sec.turnFrom) harmony.setForm([sec.turn], null, b);
  const end = sec.start + sec.beats;
  if (sec.gap && b === end - sec.gap) gateGap(transport.timeAt(b), transport.timeAt(end));
}

// Where a section's lines stop (see lines.set).
const restOf = sec => (state.composer >= 4 && sec.turnFrom != null ? sec.turnFrom : Infinity);

// A build is turned down by the song's buildTrimDb (see songLevels in render.js), so
// the drop lands louder than its last bars: eased down over its first two bars,
// while the build is still thin, and straight back up on the next section's
// downbeat, under the drop's impact.
let trimmed = null; // the gain a build was turned down to, or null

function trimFor(sec, b) {
  const g = audio.sectionGain.gain, t = transport.timeAt(b);
  const trim = sec.build ? song.current.buildTrimDb : 0;
  if (trim < 0) {
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    trimmed = 10 ** (trim / 20);
    g.linearRampToValueAtTime(trimmed, transport.timeAt(b + Math.min(8, sec.beats / 2)));
  } else if (trimmed !== null) {
    g.cancelScheduledValues(t - 0.02);
    g.setValueAtTime(trimmed, t - 0.02); // where the ramp ended: a build is longer than it
    g.linearRampToValueAtTime(1, t);
    trimmed = null;
  }
}

function enterSection(sec, b) {
  trimFor(sec, b);
  reseedStreams(sec.kind);
  // A build that teases the hook plays its motif, as the drop will.
  const hook = sec.hook || !!sec.build?.tease;
  restream('ensemble', hook ? 'hook' : sec.kind);
  state.rootMidi = ROOT_BASE_MIDI + ((song.base.rootMidi - ROOT_BASE_MIDI + sec.shift) % 12 + 12) % 12;
  harmony.setForm(sec.prog, sec.colours, b);
  ensemble.reset();
  ensemble.hold = hook || state.composer >= 2;
  lines.set(sec.lines, b, sec.beats, sec.shift, restOf(sec));
  setActiveVoices(voicesNamed(sec.voices));
  songBass = sec.bass;
  for (const v of ALL_VOICES) v.reset(b);
  bassVoice.newSection();
  fxVoice.reset(b);
}

// Fuller, brighter, drier and pumping harder the higher the energy.
function setFeel(e) {
  const f = song.base;
  state.density      = clamp(f.density * (0.4 + 0.7 * e), 0.05, 1);
  state.brightness   = clamp(f.brightness + (e - 0.7) * 0.5, 0.05, 0.95);
  state.spaciousness = clamp(f.spaciousness + (0.6 - e) * 0.25, 0.05, 0.95);
  state.pump         = f.pump * clamp((e - 0.3) / 0.5, 0, 1);
}

// The leveller sets a song's level from its hook sections -- choruses, drops,
// the top of a swell -- and holds still through the rest (see rideLevel), so
// an intro stays quieter than a drop, a build grows into it, and one song's
// choruses are about as loud as the next one's.
function levelHoldsAt(t) {
  const b = transport.beatAt(t), sec = song.sectionAt(b);
  return !sec || !sec.hook || song.energyAt(sec, b) < 0.6;
}

// A live song's levels, measured once it had started (see songLevels in render.js
// and main.js): the build trim for builds still to come, and the leveller eased to
// the song's level if it hasn't yet heard a hook of its own to set it by.
// `ease` false: the song has only just started, so the leveller goes straight there.
export function setSongLevels({ levelMs, buildTrimDb }, ease = true) {
  const s = song.current;
  if (!s) return;
  s.buildTrimDb = buildTrimDb ?? 0;
  const first = s.sections.find(x => x.hook && x.energy[0] >= 0.6);
  if (!levelMs || !first || songBeat >= first.start) return;
  if (ease) easeLevel(levelMs, audio.ctx.currentTime);
  else presetLevel(levelMs);
}

// Whether the loaded song has played its last chord.
export const songOver = () => !!song.current && songBeat > song.current.end;

// The session again where it was paused, on a new audio context: the old one's
// clock died while paused (the output device changed) and took everything
// scheduled with it. A song starts again from the top of the section it had
// reached, which plays as it did (each section is seeded on its own); eras and
// loops carry on as they were set.
export function resumeSession(t) {
  const s = song.current;
  const sec = s && song.sectionAt(Math.min(songBeat, s.end) - 1);
  restart(t, sec ? sec.start : 0); // the same music, so no change to log
}

// Back to eras or a loop: no song.
export function unloadSong() {
  song.current = null;
  lines.clear();
  if (audio.level) audio.level.holdsAt = null;
  if (audio.sectionGain && trimmed !== null) {
    const g = audio.sectionGain.gain, t = audio.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1, t, 0.05);
    trimmed = null;
  }
}

// The song's own feel and key, which the sections vary from: Edit mode's
// controls, moved while it plays.
export function setSongFeel(fields) {
  if (!song.current) return;
  Object.assign(song.base, fields);
  if ('rootMidi' in fields) {
    const sec = song.sectionAt(songBeat - 1);
    state.rootMidi = ROOT_BASE_MIDI + ((fields.rootMidi - ROOT_BASE_MIDI + (sec?.shift ?? 0)) % 12 + 12) % 12;
  }
}

// New instruments for the song playing: the same song, arranged for them.
export function rearrangeSong(plan) {
  if (plan.bassStyle) bassVoice.setStyle(plan.bassStyle);
  if (plan.drumStyle) drumsVoice.setStyle(plan.drumStyle);
  arrange(song.current, plan, roleOf);
  const sec = song.sectionAt(songBeat - 1);
  if (!sec) return;
  lines.set(sec.lines, sec.start, sec.beats, sec.shift, restOf(sec));
  setActiveVoices(voicesNamed(sec.voices));
  songBass = sec.bass;
}

// ─── Letting go ───────────────────────────────────────────────────────────────
// A change made between ticks -- Edit's controls, live -- can leave notes ringing
// that no longer belong: a pad's sixteen-beat chord in the old key, a shimmer
// from an instrument that has gone. Each tick compares what it plays with what
// the last one left playing, and lets go (see voice.release) of any voice that
// has left or changed style, and of all of them if the octave or chord length
// moved. If the key, mode, genre or composer moved, it's another loop: the room
// starts again empty as well, so the old one's tail doesn't hang on under it
// (see clearSpace). The release falls where the last tick's scheduling stopped,
// so nothing scheduled since the change is touched. The scheduler's own changes
// (an era, a song's section) happen inside a tick, so this doesn't see them: an
// era lets go itself (see advanceEra), and a song's sections end on their chords.
let heard = null; // { key, grid, voices: Map(voice → style), to } as the last tick left them
const keyOf  = () => [state.rootMidi, state.scaleIdx, state.language, state.composer].join();
const gridOf = () => [state.octaveShift, state.chordBeats].join();

function sounding(skipBass) {
  const out = new Map(activeVoices.map(v => [v, v.style ?? null]));
  if (!skipBass && (!song.current || songBass)) out.set(bassVoice, bassVoice.style);
  return out;
}

function letGoOfChanges(now, skipBass) {
  if (!heard) return;
  const t = Math.max(now, heard.to), playing = sounding(skipBass);
  const another = keyOf() !== heard.key, moved = another || gridOf() !== heard.grid;
  for (const [v, style] of heard.voices) if (moved || playing.get(v) !== style) v.release(t);
  if (another) clearSpace(t);
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
let lastTickTime = 0;

function runVoices(now, horizon, skipBass) {
  pumpVoice.tick(now, horizon);
  sweepVoice.tick(now, horizon);
  if (song.current) fxVoice.tick(now, horizon);
  if (!skipBass) bassVoice.tick(now, horizon);
  for (const v of activeVoices) v.tick(now, horizon);
}

export function tick({ skipBass = false, skipEvolve = false } = {}) {
  if (!audio.started) return;
  const now = audio.ctx.currentTime;
  const dt  = now - (lastTickTime || now);
  updateLowCuts(!skipBass && (!song.current || songBass));
  updateLevel();
  noteClock();
  lastTickTime = now;

  letGoOfChanges(now, skipBass);
  if (transport.tick(now)) setEchoTime(beat() * 0.75, now);
  harmony.tick(now);

  if (song.current) conduct(now, skipBass);
  else evolve(now, dt, skipBass, skipEvolve);
  heard = { key: keyOf(), grid: gridOf(), voices: sounding(skipBass), to: now + LOOKAHEAD };
}

function evolve(now, dt, skipBass, skipEvolve) {
  if (!skipEvolve) {
    eraTimer += dt;
    drift();
    // A new era waits for the next chord change. Everything before the change
    // is scheduled in the old key, then the key/scale/tempo switch, then the
    // rest of the window is scheduled in the new one.
    const at = eraAt ?? harmony.nextChange;
    if ((eraAt !== null || eraTimer >= ERA_DURATION) && transport.timeAt(at) < now + LOOKAHEAD) {
      runVoices(now, transport.timeAt(at), skipBass);
      eraTimer = 0;
      eraAt = null;
      advanceEra(at);
    }
  }
  runVoices(now, now + LOOKAHEAD, skipBass);
}

export { TICK_MS };
