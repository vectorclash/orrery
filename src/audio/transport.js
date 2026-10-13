import { state, LOOKAHEAD } from '../state.js';

// ─── Transport: the shared musical clock ──────────────────────────────────────
// Voices schedule in *beats* and convert to audio time here, so bar lines,
// chord changes and drum steps all land on one grid. A tempo change re-anchors
// the clock at the current position instead of rescaling past beats, so the
// grid stays continuous when the BPM moves mid-playback.
let anchorTime = 0; // audio time at which the clock read `anchorBeat`
let anchorBeat = 0;
let bpm        = 120;

export const transport = {
  // Beat 0 = audio time `t`.
  start(t) {
    anchorTime = t;
    anchorBeat = 0;
    bpm        = state.tempo;
  },

  // Returns true when the tempo changed since the last tick.
  tick(now) {
    if (state.tempo === bpm) return false;
    anchorBeat = this.beatAt(now);
    anchorTime = now;
    bpm        = state.tempo;
    return true;
  },

  beatAt(t) { return anchorBeat + (t - anchorTime) * bpm / 60; },
  timeAt(b) { return anchorTime + (b - anchorBeat) * 60 / bpm; },

  // First beat position at or after audio time `t` on a `div`-beat grid.
  nextBeat(t, div = 1) { return Math.ceil(this.beatAt(t) / div - 1e-6) * div; },

  // Apply a tempo change exactly at beat `b` (used when an era changes tempo
  // on a chord change) rather than at whatever moment the next tick notices.
  retime(b) {
    anchorTime = this.timeAt(b);
    anchorBeat = b;
    bpm        = state.tempo;
  },
};

// ─── Voice scheduling loop ────────────────────────────────────────────────────
// `play(t, beat)` schedules whatever starts at audio time `t` (musical position
// `beat`) and returns how many beats until it wants to run again.
//
// A voice that hasn't played yet, or sat idle while the clock moved on (it was
// out of the active set, or the tab's timers were throttled), rejoins on the
// next `entry`-beat grid line rather than replaying every missed note at once.
//
// `horizon` lets the scheduler stop every voice exactly at a chord change,
// switch key, then carry on — so no note straddles the old and new key.
export function createVoice(name, play, { entry = 1, role = null, onReset = null } = {}) {
  let next = null; // beat position of the next event
  return {
    name,
    role,
    entry,
    tick(now, horizon = now + LOOKAHEAD) {
      if (next === null || transport.timeAt(next) < now) next = transport.nextBeat(now, entry);
      while (transport.timeAt(next) < horizon) {
        const step = play(transport.timeAt(next), next);
        next += step > 0 ? step : 0.25; // a zero/NaN step would spin forever
      }
    },
    // `atBeat` restarts the voice at a specific position (an era change);
    // voices holding long notes use it to release them at that moment.
    reset(atBeat = null) {
      next = atBeat;
      if (onReset) onReset(atBeat);
    },
  };
}
