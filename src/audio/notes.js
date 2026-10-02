// ─── Note log ─────────────────────────────────────────────────────────────────
// Every note and drum hit, recorded as the scheduler commits it (up to one
// lookahead window before it sounds), so the visuals can show exactly what is
// playing — pitch, voice, loudness, length — at the moment it's heard, rather
// than guessing from a smoothed spectrum. A fixed ring buffer: the audio side
// writes, the render loop reads whatever is new each frame.
const SIZE = 1024;
const log  = new Array(SIZE);
let written = 0;
let logging = true;

// Off while export renders offline: those notes never sound live, and their
// timestamps belong to another clock.
export function setNoteLogging(on) { logging = on; }

// `dur` is how long the note sounds (seconds); `vel` 0…1.
export function logNote(voice, t, midi, dur, vel = 0.8) {
  if (!logging) return;
  log[written++ % SIZE] = { kind: 'note', voice, t, midi, dur, vel };
}

export function logHit(piece, t, vel) {
  if (!logging) return;
  log[written++ % SIZE] = { kind: 'hit', voice: piece, t, vel };
}

// Calls `fn` for every event written since position `since`; returns the new
// position. If the reader fell more than SIZE events behind, it skips ahead.
export function readLog(since, fn) {
  for (let i = Math.max(since, written - SIZE); i < written; i++) fn(log[i % SIZE]);
  return written;
}
