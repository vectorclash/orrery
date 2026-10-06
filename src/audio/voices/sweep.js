import { audio } from '../context.js';
import { state } from '../../state.js';
import { createVoice } from '../transport.js';

// ─── Sweep ────────────────────────────────────────────────────────────────────
// The filter of French house and nu-disco: everything but the drums runs
// through a resonant lowpass that closes and opens again over a sixteen-bar
// cycle, so the groove keeps going while the music around it goes dark and
// then blooms back. Each cycle stays open for six bars, closes over two, then
// opens over eight -- slowly at first, rushing open at the end -- and lands
// fully open on the next cycle's downbeat, so the build arrives on the one.
//
// Depth sets how far it closes: at 1 down to about 220 Hz (the bass line and
// little else), at 0.5 about 2 kHz, at 0.25 a gentle darkening. The resonance
// rises as it closes, which is the "wah" in the sweep.
//
// It automates the filters of context.js's sweep stages (the voices' dry bus and
// their echo and hall sends). At sweep 0 it leaves them routed around at exactly
// unity and draws no random numbers, so nothing else moves.
const OPEN  = 20000; // Hz
const SHUT  = 220;   // Hz, at depth 1
const CYCLE = 64;    // beats: sixteen bars
const HOLD  = 24;    // beats fully open
const CLOSE = 8;     // beats closing; the rest of the cycle opens
const STEP  = 0.25;  // beats between automation points
const XFADE = 0.02;  // seconds, switching between the straight and filtered paths

// How far closed (0 open … 1 shut) the filter is at beat `b`.
export function closedAt(b) {
  const p = ((b % CYCLE) + CYCLE) % CYCLE;
  if (p < HOLD) return 0;
  if (p < HOLD + CLOSE) {
    const x = (p - HOLD) / CLOSE;
    return x * x * (3 - 2 * x);
  }
  const x = (p - HOLD - CLOSE) / (CYCLE - HOLD - CLOSE);
  return 1 - x * x;
}

let active = false;

function play(t, b) {
  const stages = audio.sweeps;
  if (state.sweep <= 0) {
    if (active) {
      for (const s of stages) {
        s.direct.gain.setTargetAtTime(1, t, XFADE);
        s.wet.gain.setTargetAtTime(0, t, XFADE);
      }
      active = false;
    }
    return STEP;
  }
  const c  = closedAt(b) * state.sweep;
  const hz = OPEN * (SHUT / OPEN) ** c;
  const q  = -3 + 9 * c; // dB (a lowpass's Q is a resonance in dB): flat open, +6 dB shut
  for (const s of stages) {
    if (!active) {
      s.lp.frequency.setValueAtTime(hz, t);
      s.lp.Q.setValueAtTime(q, t);
      s.direct.gain.setTargetAtTime(0, t, XFADE);
      s.wet.gain.setTargetAtTime(1, t, XFADE);
    } else {
      s.lp.frequency.exponentialRampToValueAtTime(hz, t);
      s.lp.Q.linearRampToValueAtTime(q, t);
    }
  }
  active = true;
  return STEP;
}

// Every session builds fresh stages, routed straight through.
export const sweepVoice = createVoice('sweep', play, { onReset: () => { active = false; } });
