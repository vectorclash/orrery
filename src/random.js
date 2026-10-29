// ─── Seeded randomness ────────────────────────────────────────────────────────
// Every musical choice the engine makes is drawn from a seeded stream, so a
// song can be played again note for note: live, and in the export renderer's
// iframe, which has its own copy of the engine.
//
// One stream per voice, not one for everything. The scheduler runs each voice
// up to a horizon in turn, and where the horizons fall depends on when the
// ticks come: every 60 ms exactly in an export, a little early or late live,
// once a second in a throttled tab. With one shared stream, the order the
// voices drew in -- and so every note after the first difference -- would
// depend on that timing. With a stream each, a voice draws the same numbers
// however its notes are split across ticks.
//
// rand(), pick() and random() (state.js) read the *current* stream, which
// createVoice (transport.js) points at the voice's own while it plays or
// resets. Outside a voice -- the UI, the visuals, Infinite mode's eras -- it
// is Math.random, as before.

// mulberry32: small, fast, and good enough for music.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over the parts, so (seed, 'chorus', 'pad') names one stream.
export function hashSeed(...parts) {
  let h = 0x811C9DC5;
  for (const ch of parts.join('\u0001')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const newSeed = () => Math.floor(Math.random() * 4294967296);

let current = Math.random;
export const random = () => current();

// Runs `fn` with `stream` as the current stream.
export function within(stream, fn) {
  const prev = current;
  current = stream;
  try { return fn(); } finally { current = prev; }
}

// ─── Named streams ────────────────────────────────────────────────────────────
// Derived from a base seed set per playback session, and re-derived for a
// section of a song (see reseedStreams), so that every chorus draws what the
// first one drew.
let base = 0, label = '';
const streams = new Map();

export function seedStreams(seed) {
  base = seed >>> 0;
  label = '';
  streams.clear();
}

// From here on, each stream starts again from (seed, `l`, its name).
export function reseedStreams(l) {
  label = l;
  streams.clear();
}

// Re-derives one stream from (seed, `l`, its name): a song's leads draw their
// hook from the same stream in every section that plays it.
export function restream(name, l) {
  streams.set(name, seeded(hashSeed(base, l, name)));
}

export function stream(name) {
  let s = streams.get(name);
  if (!s) streams.set(name, s = seeded(hashSeed(base, label, name)));
  return s;
}
