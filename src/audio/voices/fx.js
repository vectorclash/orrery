import { audio, getVoiceBus, noise } from '../context.js';
import { beat, rand } from '../../state.js';
import { createVoice, transport } from '../transport.js';
import { song } from '../song.js';
import { osc, gain, filter, send } from '../synth.js';

// ─── Transitions ──────────────────────────────────────────────────────────────
// The sounds that join a song's sections, scheduled by the section they belong
// to (see song.js):
//   riser     -- a build's white noise, a band sweeping up and swelling, cut
//                dead where the build ends (or its silent beat begins)
//   swell     -- a reversed-cymbal swell over the last two beats into a chorus
//   impact    -- the downbeat of a drop: a sub boom falling in pitch and a
//                burst of noise into the hall
//   downlift  -- the start of a breakdown: noise sweeping down and away
// Only in a song; it plays nothing otherwise.

function bus() { return getVoiceBus('fx').dry; }

function riser(t, end) {
  const dur = end - t;
  if (dur <= 0.1) return;
  const n = noise(t, dur + 0.02);
  const bp = filter('bandpass', 300, 2.5);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(7000, end);
  const env = gain(0);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.5, end - 0.01);
  env.gain.linearRampToValueAtTime(0, end);
  n.connect(bp); bp.connect(env); env.connect(bus());
  send(env, audio.reverbSend, 0.35);
}

function swell(t, end) {
  const n = noise(t, end - t + 0.02);
  const hp = filter('highpass', 3000, 0.7);
  const env = gain(0);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.12, end - 0.01);
  env.gain.linearRampToValueAtTime(0, end);
  n.connect(hp); hp.connect(env); env.connect(bus());
  send(env, audio.reverbSend, 0.5);
}

function impact(t) {
  const o = osc('sine', 70, t, t + 1.4);
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(32, t + 1.2);
  const boom = gain(0);
  boom.gain.setValueAtTime(0, t);
  boom.gain.linearRampToValueAtTime(0.32, t + 0.005);
  boom.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  o.connect(boom); boom.connect(bus());

  const n = noise(t, 1.6), lp = filter('lowpass', 2400, 0.7), burst = gain(0);
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + 1.4);
  burst.gain.setValueAtTime(0, t);
  burst.gain.linearRampToValueAtTime(0.14, t + 0.003);
  burst.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  n.connect(lp); lp.connect(burst); burst.connect(bus());
  send(burst, audio.reverbSend, 0.9);
}

function downlift(t, dur) {
  const n = noise(t, dur + 0.02);
  const bp = filter('bandpass', 6000, 2);
  bp.frequency.setValueAtTime(6000, t);
  bp.frequency.exponentialRampToValueAtTime(250, t + dur);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.22, t + 0.02);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(bp); bp.connect(env); env.connect(bus());
  send(env, audio.reverbSend, 0.6);
}

function play(t, b) {
  const sec = song.sectionAt(b);
  if (!sec) return 1;
  const end = sec.start + sec.beats;
  if (b === sec.start) {
    if (sec.riser)    riser(t, transport.timeAt(end - sec.gap));
    if (sec.impact)   impact(t);
    if (sec.downlift) downlift(t, Math.min(8, sec.beats) * beat() * rand(0.95, 1.05));
  }
  if (sec.swell && b === end - 2) swell(t, transport.timeAt(end));
  return 1;
}

export const fxVoice = createVoice('fx', play);
