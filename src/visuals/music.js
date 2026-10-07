import { audio } from '../audio/context.js';
import { readLog } from '../audio/notes.js';
import { harmony } from '../audio/harmony.js';
import { transport } from '../audio/transport.js';
import { state, currentScale } from '../state.js';

// ─── What the music is doing, frame by frame ──────────────────────────────────
// Turns the scheduler's note log into visual state, timed to what is reaching
// the speakers now (audio clock minus output latency, see syncLatency — so the
// picture stays in sync even over Bluetooth or AirPlay). Exact pitches, voices
// and hits instead of an FFT means a chord shows up as its notes, not as a
// smear in a few bins.

const ROLE = {
  bass: 'bass',
  drone: 'bed', pad: 'bed', strings: 'bed', choir: 'bed', organ: 'bed', supersaw: 'bed',
  juno: 'bed', solina: 'bed', synthbrass: 'bed',
  stab: 'motion', sawpluck: 'motion', vox: 'lead', guitar: 'motion',
  melody: 'lead', flute: 'lead', brass: 'lead', sitar: 'lead', vibraphone: 'lead', monolead: 'lead',
  arpeggio: 'motion', harp: 'motion', pluck: 'motion', kalimba: 'motion',
  mallet: 'motion', clavinet: 'motion', rhodes: 'motion',
  bell: 'air', glass: 'air', texture: 'air',
};
const HIT = {
  kick: 'kick', k808: 'kick', k909: 'kick', taiko: 'kick',
  snare: 'snare', clap: 'snare', rim: 'snare', btap: 'snare',
  tomLo: 'snare', tomHi: 'snare', congaLo: 'snare', congaHi: 'snare', bell: 'snare',
  gsnare: 'snare', simLo: 'snare', simMid: 'snare', simHi: 'snare',
  hat: 'hat', ohat: 'hat', ride: 'hat', shaker: 'hat', swish: 'hat', tamb: 'hat', crash: 'crash',
};
const HIT_DECAY = { kick: 0.14, snare: 0.12, hat: 0.06, crash: 0.8 };
const MAX_RIPPLES = 24;
const MAX_STRIKES = 32, STRIKE_LIFE = 2; // seconds

// Circle-of-fifths position of a pitch class (C 0, G 1, D 2 … F 11). Laying
// pitch out this way puts a key's scale in one unbroken arc and a chord's
// tones close together, so harmony reads as a shape.
export const fifths  = pc => (pc * 7) % 12;
export const pcAngle = pc => (fifths(pc) / 12) * Math.PI * 2;

// One hue per pitch class: the tonic takes the scene's palette hue and every
// step around the circle of fifths turns 30°, so a key's notes form a band of
// related colours and a chord's tones are neighbours.
export const pcHue = (pc, hue) => (hue + ((fifths(pc) - fifths(music.tonic) + 12) % 12) * 30) % 360;

export const music = {
  now:       0,
  noteLevel: new Float32Array(128),                      // per MIDI note, 0…1
  flash:     new Float32Array(128),                      // per MIDI note, onset impulse
  roleLevel: { bass: 0, bed: 0, lead: 0, motion: 0, air: 0 },
  hits:      { kick: 0, snare: 0, hat: 0, crash: 0 },    // decaying envelopes
  ripples:   [],   // note onsets: { x, y, z, role, vel, age }
  strikes:   [],   // drum hits: { kind, vel, age, id }, kind as in hits; id counts up
  chord:     [],   // pitch classes of the sounding chord, root first
  scale:     new Set(),
  tonic:     0,
};

let cursor = 0, strikeId = 0;
const pending = []; // logged but not yet heard
const active  = []; // heard and still visible

// Visual envelope of one note: a quick attack; sustained voices hold, then
// release after the note ends; plucked/struck voices decay from the start.
function level(n, age) {
  const attack = 1 - Math.exp(-age / 0.015);
  if (n.role === 'bed') {
    return attack * (age < n.dur ? 0.75 : 0.75 * Math.exp(-(age - n.dur) / 0.5));
  }
  const tau  = Math.min(1.2, Math.max(0.15, n.dur * 0.6));
  const tail = age < n.dur ? 1 : Math.exp(-(age - n.dur) / 0.15);
  return attack * Math.exp(-age / tau) * tail;
}

function hear(e, now) {
  const late = now - e.t;
  if (e.kind === 'hit') {
    if (late > 0.2) return; // stale (the tab was in the background)
    const h = HIT[e.voice];
    if (!h) return;
    music.hits[h] = Math.max(music.hits[h], e.vel);
    music.strikes.push({ kind: h, vel: e.vel, age: late, id: strikeId++ });
    if (music.strikes.length > MAX_STRIKES) music.strikes.shift();
    return;
  }
  if (late > e.dur + 0.5) return;
  const role = ROLE[e.voice] || 'motion';
  active.push({ midi: e.midi, t: e.t, dur: e.dur, vel: e.vel, role });
  const f = e.vel * (role === 'bed' ? 0.5 : 1);
  if (f > music.flash[e.midi]) music.flash[e.midi] = f;
  if (role !== 'bed' && late < 0.3) {
    // Ripple from the note's place on the pitch ring; higher notes start higher.
    const az = pcAngle(e.midi % 12);
    const el = Math.max(-1, Math.min(1, (e.midi - 60) / 30)) * 0.9;
    music.ripples.push({
      x: Math.cos(el) * Math.cos(az), y: Math.sin(el), z: Math.cos(el) * Math.sin(az),
      role, vel: e.vel, age: late,
    });
    if (music.ripples.length > MAX_RIPPLES) music.ripples.shift();
  }
}

export function updateMusic(dt) {
  if (!audio.started) return;
  const now = audio.ctx.currentTime - audio.latency;
  music.now = now;

  let kept = 0;
  for (const s of music.strikes) if ((s.age += dt) < STRIKE_LIFE) music.strikes[kept++] = s;
  music.strikes.length = kept;

  cursor = readLog(cursor, e => pending.push(e));
  for (let i = 0; i < pending.length;) {
    if (pending[i].t <= now) hear(pending.splice(i, 1)[0], now);
    else i++;
  }

  for (const k in music.hits) music.hits[k] *= Math.exp(-dt / HIT_DECAY[k]);
  const fade = Math.exp(-dt / 0.3);
  for (let i = 0; i < 128; i++) music.flash[i] *= fade;

  music.noteLevel.fill(0);
  for (const r in music.roleLevel) music.roleLevel[r] = 0;
  for (let i = active.length - 1; i >= 0; i--) {
    const n = active[i], age = now - n.t;
    const v = n.vel * level(n, age);
    if (age > n.dur && v < 0.004) { active.splice(i, 1); continue; }
    if (v > music.noteLevel[n.midi]) music.noteLevel[n.midi] = v;
    if (v > music.roleLevel[n.role]) music.roleLevel[n.role] = v;
  }

  for (const r of music.ripples) r.age += dt;
  while (music.ripples.length && music.ripples[0].age > 1.6) music.ripples.shift();

  music.chord = harmony.chordPcs(transport.beatAt(now));
  music.tonic = state.rootMidi % 12;
  music.scale = new Set(currentScale().map(i => (state.rootMidi + i) % 12));
}
