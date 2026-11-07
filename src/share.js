// ─── Share links ──────────────────────────────────────────────────────────────
// The configuration behind SHARE's `#c=…` hash, and the arrangement it describes.
// Kept apart from main.js, which owns the UI, so it can be used without one: the
// export renderer (render.js) exposes planFromShare for pages that embed it, such
// as Chromaforge's ad builder, which renders a pasted link into its videos.
import { state, ROOT_BASE_MIDI, pick } from './state.js';
import { ROOMS } from './audio/context.js';
import { LANGUAGE_NAMES } from './audio/language.js';

// Canonical instrument order for the share-link bitmask. Spelled out rather
// than derived from the display lists in main.js, so reordering the UI can never
// silently remap old links. Only ever append.
export const ALL_INST_KEYS = [
  'bass:sub','bass:plucked','bass:walking','bass:synth','bass:rumble',
  'drums:minimal','drums:four_four','drums:jungle','drums:shuffle','drums:trap',
  'drums:ghost','drums:halftime','drums:breakbeat','drums:bossanova',
  'pad','melody','texture','pluck','bell','arpeggio','mallet','drone','flute','choir',
  'strings','rhodes','organ','glass','harp','brass','vibraphone','clavinet','sitar','kalimba',
  // added with the expanded drum machine
  'drums:house','drums:funk','drums:boombap','drums:garage','drums:swing','drums:brushes',
  'drums:reggae','drums:dembow','drums:afro','drums:cinematic',
  'supersaw',
  // the 80s instruments
  'drums:synthwave','drums:outrun','juno','solina','synthbrass','monolead',
  // dance music
  'drums:deep_house','drums:techno','drums:trance','drums:big_room',
  'bass:deep','bass:acid','bass:rolling','stab','vox','sawpluck',
  // more dance music
  'drums:disco','drums:afro_house','drums:amapiano','drums:afrobeats','drums:dnb','drums:drill',
  'bass:disco','bass:808','bass:reese','bass:log','guitar',
];

// Binary pack: 20 fixed bytes, then the instrument tail if there is one
// [rootOffset(1), scale(1), tempo(1), density×100(1), brightness×100(1),
//  spaciousness×100(1), instBitmask bits 0–39 (5 bytes),
//  harmonyLock×100(1), chordBeats(1), instBitmask bits 40–47 (1 byte),
//  room index(1), instBitmask bits 48–55 (1 byte), instBitmask bits 56–63 (1 byte),
//  pump×100(1), sweep×100(1), instBitmask bits 64–71 (1 byte),
//  tail length n(1), instBitmask bits 72 and up (n bytes),
//  form(1): 1 = a song, seed(4, little-endian): the song's,
//  length(2, little-endian): the song's, in seconds,
//  composer(1), language(1): its place in LANGUAGE_NAMES,
//  writing seed(4, little-endian): a song written from another's seed, if it is]
// The first 72 instruments were fitted into spare bytes as they came. Everything
// after them goes in the tail, which grows with ALL_INST_KEYS, so appending a key
// needs no change here. While there are no more than 72 keys the tail is left
// out, so a link is the 20 bytes. A new field goes after the tail, at 21 + n,
// never in a fixed slot.
// Fields were appended over time; older 11-, 13-, 14-, 15-, 16- and 18-byte links
// still decode (missing fields fall back to current/default values, and a missing
// pump or sweep is none). A page from before the tail reads a link's first 72
// instruments and ignores the rest. The octave is not in the link.
// A song's link carries the tail's length byte even with no tail (n = 0), so
// its form, seed and length sit at 21 + n; a loop's link stops before them,
// and a page from before songs ignores them and plays the loop. A song's link
// from before lengths stops after the seed, and its song draws its own.
// The composer is the last field. Composer 1 doesn't write it, so its links are
// byte for byte what they always were, and a link without one is composer 1's,
// which is how every link made before composer 2 keeps its song. A loop from
// composer 2 writes the form and song fields as zeros to reach it. A song that keeps
// another's chords and hook (see writeSong in audio/song.js) adds that song's seed.
const FIXED_INST_BITS = 72;
const TAIL_LEN = 20; // the tail's length byte; its bits start at TAIL_LEN + 1
const instByte = i => (i < 40 ? 6 + (i >> 3) : i < 48 ? 13 : i < 56 ? 15 : i < 64 ? 16
  : i < FIXED_INST_BITS ? 19 : TAIL_LEN + 1 + ((i - FIXED_INST_BITS) >> 3));

// `enabled` maps an ALL_INST_KEYS key to whether that instrument is on; the
// rest comes from `feel` (the fields of a plan's state). `song`, { seed,
// length } if given, makes it a song's link.
export function encodeConfig(enabled, song = null, feel = state) {
  const tail = Math.ceil(Math.max(0, ALL_INST_KEYS.length - FIXED_INST_BITS) / 8);
  const written = (feel.composer ?? 1) >= 2;
  const rewrites = written && song?.writing != null;
  const b = new Uint8Array(tail || song || written ? TAIL_LEN + 1 + tail + (rewrites ? 13 : written ? 9 : song ? 7 : 0) : TAIL_LEN);
  if (tail || song || written) b[TAIL_LEN] = tail;
  const at = TAIL_LEN + 1 + tail;
  if (song) {
    const view = new DataView(b.buffer);
    b[at] = 1;
    view.setUint32(at + 1, song.seed >>> 0, true);
    view.setUint16(at + 5, song.length, true);
  }
  if (written) {
    b[at + 7] = feel.composer;
    b[at + 8] = Math.max(0, LANGUAGE_NAMES.indexOf(feel.language));
  }
  if (rewrites) new DataView(b.buffer).setUint32(at + 9, song.writing >>> 0, true);
  b[0] = feel.rootMidi - ROOT_BASE_MIDI;
  b[1] = feel.scaleIdx;
  b[2] = feel.tempo;
  b[3] = Math.round(feel.density * 100);
  b[4] = Math.round(feel.brightness * 100);
  b[5] = Math.round(feel.spaciousness * 100);
  ALL_INST_KEYS.forEach((k, i) => {
    if (enabled[k]) b[instByte(i)] |= (1 << (i % 8));
  });
  b[11] = Math.round(feel.harmonyLock * 100);
  b[12] = feel.chordBeats;
  b[14] = Math.max(0, Object.keys(ROOMS).indexOf(feel.room));
  b[17] = Math.round(feel.pump * 100);
  b[18] = Math.round(feel.sweep * 100);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function decodeConfig(str) {
  try {
    const pad = str + '==='.slice(0, (4 - str.length % 4) % 4);
    const b   = Uint8Array.from(atob(pad.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    // Only the tail's own bytes: anything after it is another field.
    const tail = b[TAIL_LEN] ?? 0;
    const inLink = i => i < FIXED_INST_BITS || (i - FIXED_INST_BITS) >> 3 < tail;
    const at = TAIL_LEN + 1 + tail;
    const view = new DataView(b.buffer);
    const song = b[at] === 1 && b.length >= at + 5 ? {
      seed:   view.getUint32(at + 1, true),
      length: b.length >= at + 7 ? view.getUint16(at + 5, true) : undefined,
      ...(b.length >= at + 13 ? { writing: view.getUint32(at + 9, true) } : {}),
    } : undefined;
    return {
      r: ROOT_BASE_MIDI + (b[0] % 12), s: b[1], t: b[2],
      d: b[3] / 100, b: b[4] / 100, p: b[5] / 100,
      m: ALL_INST_KEYS.filter((_, i) => inLink(i) && b[instByte(i)] & (1 << (i % 8))),
      hl: b[11] !== undefined ? b[11] / 100 : undefined,
      cb: b[12] !== undefined ? b[12] : undefined,
      rm: b[14] !== undefined ? Object.keys(ROOMS)[b[14]] : undefined,
      pu: b[17] !== undefined ? b[17] / 100 : 0,
      sw: b[18] !== undefined ? b[18] / 100 : 0,
      song,
      cv: b[at + 7] ?? 1,
      lg: LANGUAGE_NAMES[b[at + 8]] ?? 'ANY',
    };
  } catch { return null; }
}

// The arrangement a decoded config describes, as plain data (see applyPlan) —
// the same plan Manual mode builds from its controls. Bass and drum styles are
// picked from the enabled ones, as Manual mode does. Simple voices come out in
// ALL_INST_KEYS order, which is also the order of main.js's SIMPLE_VOICES, so
// the leads take their turns in the same order. Fields an old link lacks fall
// back to the current state's.
export function planFromConfig(cfg) {
  const styles = prefix => cfg.m.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
  const bassSubs = styles('bass:'), drumSubs = styles('drums:');
  return {
    state: {
      tempo:        cfg.t,
      octaveShift:  state.octaveShift,
      rootMidi:     cfg.r,
      scaleIdx:     cfg.s,
      era:          0,
      density:      cfg.d,
      brightness:   cfg.b,
      spaciousness: cfg.p,
      harmonyLock:  cfg.hl ?? state.harmonyLock,
      chordBeats:   cfg.cb ?? state.chordBeats,
      room:         cfg.rm ?? state.room,
      pump:         cfg.pu,
      sweep:        cfg.sw,
      composer:     cfg.cv ?? 1,
      language:     cfg.lg ?? 'ANY',
    },
    // A song picks from several by its seed, as Edit mode does.
    bassStyle: !bassSubs.length ? null : cfg.song ? bassSubs[cfg.song.seed % bassSubs.length] : pick(bassSubs),
    drumStyle: !drumSubs.length ? null : cfg.song ? drumSubs[cfg.song.seed % drumSubs.length] : pick(drumSubs),
    voices: [
      ...(drumSubs.length ? ['drums'] : []),
      ...cfg.m.filter(k => !k.includes(':')),
    ],
    ...(cfg.song ? { song: { ...cfg.song } } : {}),
  };
}

// A song's plan as a link: the plan's own instruments and feel, at `length` seconds.
export function linkForPlan(plan, length) {
  const on = Object.fromEntries(plan.voices.filter(v => v !== 'drums').map(v => [v, true]));
  if (plan.bassStyle) on[`bass:${plan.bassStyle}`] = true;
  if (plan.drumStyle) on[`drums:${plan.drumStyle}`] = true;
  return encodeConfig(on, { ...plan.song, length }, plan.state);
}

// A whole share URL, a bare `#c=…` hash, or just the characters after `c=`.
export function planFromShare(link) {
  const m = /(?:^|[#&])c=([A-Za-z0-9_-]+)/.exec(link) || /^([A-Za-z0-9_-]{14,})$/.exec(link.trim());
  const cfg = m && decodeConfig(m[1]);
  return cfg ? planFromConfig(cfg) : null;
}
