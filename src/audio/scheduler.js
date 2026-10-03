import { audio, beginSession, setEchoTime, setRoom, updateLowCuts, updateLevel, noteClock } from './context.js';
import { state, SCALE_NAMES, TICK_MS, LOOKAHEAD, ROOT_BASE_MIDI, rand, pick, beat } from '../state.js';
import { harmony } from './harmony.js';
import { transport } from './transport.js';
import { ensemble } from './phrase.js';

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

export {
  bassVoice, padVoice, melodyVoice, textureVoice, pluckVoice,
  bellVoice, arpeggioVoice, malletVoice, droneVoice, fluteVoice,
  choirVoice, stringsVoice, rhodesVoice, organVoice, glassVoice,
  harpVoice, brassVoice, drumsVoice,
  vibraphoneVoice, clavinetVoice, sitarVoice, kalimbaVoice,
};

// ─── Orchestration ────────────────────────────────────────────────────────────
// Infinite mode used to draw 3–5 voices at random, which could produce four
// melodies fighting and no harmony underneath. An arrangement needs roles:
// a harmonic bed, usually one lead line, something that moves, and
// optionally some air on top and drums.
const ROLES = {
  bed:    [padVoice, stringsVoice, choirVoice, organVoice, droneVoice],
  lead:   [melodyVoice, fluteVoice, brassVoice, sitarVoice, vibraphoneVoice],
  motion: [arpeggioVoice, harpVoice, pluckVoice, kalimbaVoice, malletVoice, clavinetVoice, rhodesVoice],
  air:    [bellVoice, glassVoice, textureVoice],
};
const ALL_VOICES = [bassVoice, drumsVoice, ...Object.values(ROLES).flat()];

export let activeVoices = [];

function draw(list, n) {
  return list.slice().sort(() => Math.random() - 0.5).slice(0, n);
}

export function pickVoices() {
  const v = draw(ROLES.bed, Math.random() < 0.25 ? 2 : 1);
  if (Math.random() < 0.8)  v.push(...draw(ROLES.lead, 1));
  if (Math.random() < 0.85) v.push(...draw(ROLES.motion, Math.random() < 0.25 ? 2 : 1));
  if (Math.random() < 0.45) v.push(...draw(ROLES.air, 1));
  while (v.length < 3) v.push(...draw([...ROLES.motion, ...ROLES.air].filter(x => !v.includes(x)), 1));
  if (Math.random() < 0.35) v.push(drumsVoice);
  setActiveVoices(v);
}

// A manual-mode arrangement as plain data, so the export renderer (its own
// copy of the engine, in an iframe) can play exactly what the controls say.
// { state: {...fields}, bassStyle, drumStyle, voices: [names] }
export function applyPlan(plan) {
  Object.assign(state, plan.state);
  if (plan.bassStyle) bassVoice.setStyle(plan.bassStyle);
  if (plan.drumStyle) drumsVoice.setStyle(plan.drumStyle);
  setActiveVoices(plan.voices.map(n => ALL_VOICES.find(v => v.name === n)).filter(Boolean));
}

export function setActiveVoices(voices) {
  activeVoices = voices;
  ensemble.leads = voices.filter(v => v.role === 'lead').map(v => v.name);
}

// ─── Session ──────────────────────────────────────────────────────────────────
// Beat 0 falls at audio time `t`. Fresh buses, a fresh chord progression, and
// every voice re-enters on the grid.
export function startSession(t) {
  beginSession();
  transport.start(t);
  setEchoTime(beat() * 0.75, t);
  harmony.reroll(0);
  ensemble.motif = null;
  ensemble.motifPhrase = -1;
  for (const v of ALL_VOICES) v.reset();
  lastTickTime = 0;
  eraTimer = 0;
  eraAt = null;
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

// Starts the new era exactly at beat `at` (a chord change).
function advanceEra(at) {
  state.era++;
  // Move by a closely related interval (or stay), keeping the tonic within
  // one octave — register comes from octaveShift, not from the root drifting.
  const shifts = [-7, -5, -2, 0, 0, 2, 5, 7];
  state.rootMidi     = ROOT_BASE_MIDI + ((state.rootMidi - ROOT_BASE_MIDI + pick(shifts)) % 12 + 12) % 12;
  state.scaleIdx     = Math.floor(Math.random() * SCALE_NAMES.length);
  const tempoShift   = Math.random() < 0.3 ? rand(-35, 35) : rand(-15, 15);
  state.tempo        = Math.max(52, Math.min(130, state.tempo + tempoShift));
  state.brightness   = rand(0.1, 0.9);
  state.spaciousness = rand(0.2, 0.85);
  state.density      = rand(0.2, 0.9);
  state.octaveShift  = pick([-1, 0, 0, 1]);
  state.chordBeats   = pick([4, 4, 8]);
  state.room         = roomFor(state.spaciousness, state.tempo);
  transport.retime(at);
  setEchoTime(beat() * 0.75, transport.timeAt(at));
  setRoom(state.room, transport.timeAt(at));
  harmony.reroll(at);

  // A new era is a new section: everyone re-enters on its first downbeat.
  pickVoices();
  bassVoice.reroll();
  drumsVoice.reroll();
  for (const v of ALL_VOICES) v.reset(at);
}

function drift() {
  state.brightness   = Math.max(0.05, Math.min(0.95, state.brightness   + (Math.random() - 0.5) * 0.002));
  state.density      = Math.max(0.10, Math.min(1.00, state.density      + (Math.random() - 0.5) * 0.001));
  state.spaciousness = Math.max(0.10, Math.min(0.90, state.spaciousness + (Math.random() - 0.5) * 0.001));
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
let lastTickTime = 0;

function runVoices(now, horizon, skipBass) {
  if (!skipBass) bassVoice.tick(now, horizon);
  for (const v of activeVoices) v.tick(now, horizon);
}

export function tick({ skipBass = false, skipEvolve = false } = {}) {
  if (!audio.started) return;
  const now = audio.ctx.currentTime;
  const dt  = now - (lastTickTime || now);
  updateLowCuts(!skipBass);
  updateLevel();
  noteClock();
  lastTickTime = now;

  if (transport.tick(now)) setEchoTime(beat() * 0.75, now);
  harmony.tick(now);

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
