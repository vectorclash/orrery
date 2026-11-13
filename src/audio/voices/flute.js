import { audio, getVoiceBus, noise } from '../context.js';
import { beat, register, midiToHz, clamp } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { osc, gain, filter, send, lfo, perc, wander } from '../synth.js';

// Flute: a tone whose harmonics depend on the register, breath noise that
// runs through the whole note — not just the attack — and vibrato that is
// partly pitch, partly amplitude, eased in after the note has spoken. The
// attack starts slightly flat and settles, as a flute's pitch does while the
// air column locks in, and the pitch wanders a few cents (see wander).
//
// A flute is only nearly a sine at the top. In its low register the second
// harmonic is about as strong as the fundamental, with a few more above it
// -- the reedy, breathy low flute -- and the tone thins out as it rises,
// until above about 1.2 kHz little is left but the fundamental. The old
// voice was nearly a sine everywhere, which is an ocarina's sound, not a
// flute's. Amplitudes of harmonics 1–6 at the bottom and top of the range,
// interpolated in pitch between them; one wave per note, cached.
const LOW  = [1, 0.75, 0.38, 0.18, 0.08, 0.04]; // up to 330 Hz
const HIGH = [1, 0.14, 0.04, 0.012, 0, 0];      // from 1200 Hz
const LEVEL = 0.87; // matched to the old voice's loudness
const waves = new WeakMap(); // a PeriodicWave belongs to its context
function toneFor(midi) {
  const ctx = audio.ctx;
  if (!waves.has(ctx)) waves.set(ctx, new Map());
  const cache = waves.get(ctx);
  if (!cache.has(midi)) {
    const x = clamp(Math.log2(midiToHz(midi) / 330) / Math.log2(1200 / 330), 0, 1);
    const real = new Float32Array(LOW.length + 1), imag = new Float32Array(LOW.length + 1);
    LOW.forEach((lo, i) => { imag[i + 1] = lo + (HIGH[i] - lo) * x; });
    cache.set(midi, ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
  }
  return cache.get(midi);
}

const phraser = createPhraser({ name: 'flute', base: () => register(66, 28, 83), lead: true });

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;

  const bus  = getVoiceBus('flute').dry;
  const hz   = midiToHz(ev.midi);
  const dur  = ev.dur * beat();
  const peak = 0.12 * ev.vel * LEVEL;
  const end  = t + dur + 0.4;
  logNote('flute', t, ev.midi, dur, ev.vel);

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.07);
  env.gain.setTargetAtTime(0, t + dur, 0.06);

  const trem = gain(1);
  lfo(5.1, 0.07, t, end, 0.3, 0.35).connect(trem.gain);
  const vib = lfo(5.1, 13, t, end, 0.3, 0.35);

  const o = osc('sine', hz, t, end);
  o.setPeriodicWave(toneFor(ev.midi));
  o.detune.setValueAtTime(-14, t);
  o.detune.linearRampToValueAtTime(0, t + 0.07);
  vib.connect(o.detune);
  wander(t, end, 4, ev.midi).connect(o.detune);
  o.connect(trem);
  trem.connect(env);

  // Breath: noise band-passed around the note, under the tone for its length
  // and swelling with its vibrato, as the air does…
  const air = noise(t, dur + 0.4);
  const airBp = filter('bandpass', hz, 3.5);
  const airG = gain(0.35);
  air.connect(airBp); airBp.connect(airG); airG.connect(trem);

  // …plus a brief breathy "chiff" as the note starts.
  const chiff = noise(t, 0.12);
  const chiffHp = filter('highpass', hz * 2.2);
  const chiffEnv = gain(0);
  perc(chiffEnv.gain, t, peak * 0.22, 0.09, 0.01);
  chiff.connect(chiffHp); chiffHp.connect(chiffEnv); chiffEnv.connect(bus);

  env.connect(bus);
  send(env, audio.reverbSend, 0.55);
  return ev.gap;
}

export const fluteVoice = createVoice('flute', play, { entry: 'bar', role: 'lead', onReset: phraser.reset });
