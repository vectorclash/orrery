import { audio } from '../context.js';
import { state, beat } from '../../state.js';
import { createVoice } from '../transport.js';

// ─── Pump ─────────────────────────────────────────────────────────────────────
// The sidechain "breathing" of house and EDM: everything but the drums dips on
// every beat, where the kick lands, and swells back before the next one. Real
// sidechain compression ducks to the kick's own level; this ducks to the beat
// grid, which is the same thing for four-on-the-floor and keeps the pump
// steady when a drum style leaves a beat empty.
//
// It schedules gain on audio.pumped (every voice bus and the bass, see
// context.js). At pump 0 it leaves the bus at exactly unity and draws no
// random numbers, so nothing else moves.
const MAX_DUCK = 0.8;   // the deepest dip, as a fraction of the level (about −14 dB)
const ATTACK   = 0.004; // seconds: fast, so the dip lands with the kick
const RELEASE  = 0.17;  // of a beat: the swell back

let ducking = false;

function play(t) {
  const g = audio.pumped.gain;
  if (state.pump <= 0) {
    if (ducking) {
      g.setTargetAtTime(1, t, 0.03);
      ducking = false;
    }
    return 1;
  }
  ducking = true;
  g.setTargetAtTime(1 - MAX_DUCK * state.pump, t, ATTACK);
  g.setTargetAtTime(1, t + ATTACK * 4, beat() * RELEASE);
  return 1;
}

export const pumpVoice = createVoice('pump', play, { onReset: () => { ducking = false; } });
