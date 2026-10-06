// ─── Share links ──────────────────────────────────────────────────────────────
// The configuration behind SHARE's `#c=…` hash, and the arrangement it describes.
// Kept apart from main.js, which owns the UI, so it can be used without one: the
// export renderer (render.js) exposes planFromShare for pages that embed it, such
// as Chromaforge's ad builder, which renders a pasted link into its videos.
import { state, ROOT_BASE_MIDI, pick } from './state.js';
import { ROOMS } from './audio/context.js';

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
]; // 51 keys: bits 0–39 in bytes 6–10, 40–47 in byte 13, 48–55 in byte 15 (byte 14 is the room)

// Binary pack: 16 bytes → 22 base64url chars
// [rootOffset(1), scale(1), tempo(1), density×100(1), brightness×100(1),
//  spaciousness×100(1), instBitmask bits 0–39 (5 bytes),
//  harmonyLock×100(1), chordBeats(1), instBitmask bits 40–47 (1 byte),
//  room index(1), instBitmask bits 48–55 (1 byte)]
// Fields were appended over time; older 11-, 13-, 14- and 15-byte links still
// decode (missing fields fall back to current/default values). The octave is not
// in the link.
const instByte = i => (i < 40 ? 6 + (i >> 3) : i < 48 ? 13 : 15);

// `enabled` maps an ALL_INST_KEYS key to whether that instrument is on; the
// rest comes from the live state.
export function encodeConfig(enabled) {
  const b = new Uint8Array(16);
  b[0] = state.rootMidi - ROOT_BASE_MIDI;
  b[1] = state.scaleIdx;
  b[2] = state.tempo;
  b[3] = Math.round(state.density * 100);
  b[4] = Math.round(state.brightness * 100);
  b[5] = Math.round(state.spaciousness * 100);
  ALL_INST_KEYS.forEach((k, i) => {
    if (enabled[k]) b[instByte(i)] |= (1 << (i % 8));
  });
  b[11] = Math.round(state.harmonyLock * 100);
  b[12] = state.chordBeats;
  b[14] = Math.max(0, Object.keys(ROOMS).indexOf(state.room));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function decodeConfig(str) {
  try {
    const pad = str + '==='.slice(0, (4 - str.length % 4) % 4);
    const b   = Uint8Array.from(atob(pad.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    return {
      r: ROOT_BASE_MIDI + (b[0] % 12), s: b[1], t: b[2],
      d: b[3] / 100, b: b[4] / 100, p: b[5] / 100,
      m: ALL_INST_KEYS.filter((_, i) => b[instByte(i)] & (1 << (i % 8))),
      hl: b[11] !== undefined ? b[11] / 100 : undefined,
      cb: b[12] !== undefined ? b[12] : undefined,
      rm: b[14] !== undefined ? Object.keys(ROOMS)[b[14]] : undefined,
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
    },
    bassStyle: bassSubs.length ? pick(bassSubs) : null,
    drumStyle: drumSubs.length ? pick(drumSubs) : null,
    voices: [
      ...(drumSubs.length ? ['drums'] : []),
      ...cfg.m.filter(k => !k.includes(':')),
    ],
  };
}

// A whole share URL, a bare `#c=…` hash, or just the 22 characters.
export function planFromShare(link) {
  const m = /(?:^|[#&])c=([A-Za-z0-9_-]+)/.exec(link) || /^([A-Za-z0-9_-]{14,})$/.exec(link.trim());
  const cfg = m && decodeConfig(m[1]);
  return cfg ? planFromConfig(cfg) : null;
}
