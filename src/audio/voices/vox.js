import { audio, getVoiceBus, noise } from '../context.js';
import { state, beat, rand, pick, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, lfo } from '../synth.js';

// Vocal chop: the pitched, chopped-up vocal hook of house, garage and future
// bass. There are no samples here, so the voice is synthesised the way a
// throat makes one -- a buzzing source (a saw, with a breath of noise) shaped
// by the three resonances of the vocal tract, whose positions ARE the vowel.
// Each chop is one short syllable on a chord tone in a high register, and
// some fall a step at the end, the pitch-bent tail of a resampled vocal.
//
// The hook is a two-bar rhythm of chops, re-mapped onto each chord, that holds
// for a phrase and then sometimes changes -- a hook is a thing that repeats.

// Soprano formants (Hz) and bandwidths (Hz) for each vowel, after Peterson &
// Barney / Fant, with each formant's level against the first.
const VOWELS = {
  ah: { f: [800, 1150, 2900], bw: [80, 90, 120], lvl: [1, 0.5, 0.25] },
  oh: { f: [450, 800, 2830], bw: [70, 80, 100], lvl: [1, 0.35, 0.1] },
  ee: { f: [350, 2000, 2800], bw: [60, 100, 120], lvl: [1, 0.3, 0.2] },
  oo: { f: [325, 700, 2700], bw: [50, 60, 170], lvl: [1, 0.3, 0.05] },
  eh: { f: [400, 1700, 2600], bw: [60, 90, 100], lvl: [1, 0.45, 0.2] },
};
const VOWEL_NAMES = Object.keys(VOWELS);

// A hook: chops over two bars, [step (0–31), length in steps, chord tone 0–4].
function makeHook() {
  const out = [];
  let s = pick([0, 2, 3]);
  while (s < 32) {
    const len = pick([1, 2, 2, 3, 4]);
    out.push({ step: s, len, tone: pick([0, 1, 2, 2, 3, 4]), vowel: pick(VOWEL_NAMES), fall: Math.random() < 0.25 });
    s += len + pick([1, 1, 2, 3, 4]);
  }
  return out;
}

let hook = [];
let phrase = -1;

function chop(t, midi, len, vowel, fall) {
  const hz = midiToHz(midi);
  const end = t + len + 0.12;
  logNote('vox', t, midi, len, 0.9);

  const src = gain(1);
  const saw = osc('sawtooth', hz, t, end);
  // A little vibrato on the longer chops, the way a held syllable wavers.
  if (len > 0.25) lfo(5.5, hz * 0.012, t, end, 0.1, 0.1).connect(saw.frequency);
  if (fall) {
    saw.frequency.setValueAtTime(hz, t + len * 0.55);
    saw.frequency.exponentialRampToValueAtTime(hz * Math.pow(2, -2 / 12), t + len);
  }
  saw.connect(src);
  const breath = noise(t, len + 0.1), bG = gain(0.08);
  breath.connect(bG); bG.connect(src);

  const sum = gain(1);
  const { f, bw, lvl } = VOWELS[vowel];
  f.forEach((fc, i) => {
    const bp = filter('bandpass', fc, fc / bw[i]), g = gain(lvl[i] * 2.2);
    src.connect(bp); bp.connect(g); g.connect(sum);
  });

  const peak = 0.33 * lerp(0.85, 1.05, state.density); // level-matched: the formants pass a narrow slice of the saw
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.012);
  env.gain.setValueAtTime(peak, t + Math.max(0.02, len - 0.03));
  env.gain.linearRampToValueAtTime(0, t + len + 0.02);
  sum.connect(env);
  env.connect(getVoiceBus('vox').dry);
  send(env, audio.echoSend, 0.38);
  send(env, audio.reverbSend, lerp(0.3, 0.7, state.spaciousness));
}

function play(t, b) {
  const p = Math.floor(b / 16);
  if (p !== phrase) {
    phrase = p;
    if (!hook.length || Math.random() < 0.3) hook = makeHook();
  }
  const step = Math.round((b - Math.floor(b / 8) * 8) * 4) % 32;
  const c = hook.find(h => h.step === step);
  if (!c) return 0.25;
  const base = register(72, 60, 84);
  const tones = harmony.stack(b, base, 4);
  const midi = [...tones, tones[0] + 12][c.tone];
  chop(t, midi, c.len * beat() * 0.25 * 0.92, c.vowel, c.fall);
  return 0.25;
}

// Draws nothing on reset -- every voice is reset at the start of a session, playing or not,
// and a draw here would shift the shared random sequence under the voices that are playing.
export const voxVoice = createVoice('vox', play, {
  role: 'motion',
  onReset: () => { phrase = -1; hook = []; },
});
