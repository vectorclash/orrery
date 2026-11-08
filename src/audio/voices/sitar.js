import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, register, fold, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { gain, filter, send, shaper, pluckBuffer, playBuffer } from '../synth.js';

// Sitar: a plucked string, plucked near the bridge, in its gourd (a
// Karplus–Strong string with a body, see pluckBuffer), over the jawari: the
// wide, curved bridge the string grazes as it swings. The jawari is what
// makes a sitar a sitar -- a buzzing band of upper harmonics that blooms on
// the pluck, lasts as long as the note does, and slides down through the
// spectrum as the note dies away. Here it is heard rather than modelled: the
// string through an asymmetric waveshaper (the one-sided contact), driven
// harder as the string decays so the buzz holds, into a resonant band that
// falls from about 4.5 kHz to 1.3 kHz over the note. (Collision models of the
// bridge inside the string loop were tried: on a Karplus–Strong string they
// dulled it instead. The old voice's buzz stood still at 2.8 kHz and died
// with the string, like a fuzz box.)
// Meend: when the previous note is close, the new note is plucked at the old
// pitch and pulled to the new one, as a sitarist bends the string sideways.
// Sympathetic (tarab) strings ring quietly when the played note matches them.
const phraser = createPhraser({ name: 'sitar', base: () => register(54, 28, 71), lead: true });
let prev = null;

const STRING = { t60: 2.8, bright: 0.85, pick: 0.07, stretch: 0.35, body: 'sitar', pol: { cents: 1, t60: 0.55, mix: 0.3 } };

// A tarab string is tuned and never plucked, so it's the same sound every
// time it answers: rendered once per pitch, from its own seed, so it never
// takes a draw from the music.
const TARAB_SECONDS = 4.3;
const tarabs = new Map();
function tarab(midi) {
  const key = `${midi}|${audio.ctx.sampleRate}`;
  if (!tarabs.has(key)) {
    tarabs.set(key, pluckBuffer(midi, { t60: 4, bright: 0.5, pick: 0.2, stretch: 0.4, length: TARAB_SECONDS, body: 'sitar', seed: 'tarab' }));
  }
  return tarabs.get(key);
}

function jawari(src, t, ring) {
  const end = t + ring, sweep = Math.min(ring, 1.6);
  const drive = gain(1);
  drive.gain.setValueAtTime(1, t);
  drive.gain.exponentialRampToValueAtTime(10, t + sweep); // +20 dB: about what the string loses by then
  const buzz = shaper(3, 0.3);
  const hp = filter('highpass', 900, 0.7);
  const band = filter('bandpass', 4500, 1.4);
  band.frequency.setValueAtTime(4500, t);
  band.frequency.exponentialRampToValueAtTime(1300, t + sweep);
  // The drive's makeup comes back off afterwards, so the buzz fades with the
  // note but more slowly: it ends about 12 dB nearer the string than it began.
  const out = gain(0.3);
  out.gain.setValueAtTime(0.3, t);
  out.gain.exponentialRampToValueAtTime(0.3 * 0.25, t + sweep);
  out.gain.setValueAtTime(0.3 * 0.25, end);
  src.connect(drive); drive.connect(buzz); buzz.connect(hp); hp.connect(band); band.connect(out);
  return out;
}

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;

  const bus  = getVoiceBus('sitar').dry;
  const midi = ev.midi;
  const dur  = ev.dur * beat();
  const ring = Math.min(3, dur + 1.6);
  const peak = 0.6 * ev.vel;
  logNote('sitar', t, midi, dur, ev.vel);

  const src = playBuffer(pluckBuffer(midi, { ...STRING, length: ring }), t, t + ring);
  if (prev !== null && prev !== midi && Math.abs(prev - midi) <= 4 && random() < 0.55) {
    src.detune.setValueAtTime((prev - midi) * 100, t);
    src.detune.setValueAtTime((prev - midi) * 100, t + 0.04);
    src.detune.linearRampToValueAtTime(0, t + rand(0.12, 0.2));
  }
  prev = midi;

  const env = gain(peak);
  src.connect(env);
  jawari(src, t, ring).connect(env);
  env.connect(bus);
  send(env, audio.reverbSend, 0.25);

  // Tarab strings tuned to the tonic and the scale: the played pitch class
  // excites its sympathetic string an octave up, along with the tonic. They
  // build up over a moment rather than starting with the pluck.
  const tonic = fold(state.rootMidi, 60, 71);
  for (const m of new Set([fold(midi, 60, 71), tonic])) {
    const s  = playBuffer(tarab(m), t, t + ring + 1.2);
    const se = gain(0);
    se.gain.setValueAtTime(0, t);
    se.gain.linearRampToValueAtTime(peak * 0.12, t + 0.12);
    se.gain.exponentialRampToValueAtTime(peak * 1.2e-4, t + ring + 1.1);
    s.connect(se); se.connect(bus);
    send(se, audio.reverbSend, 0.4);
  }
  return ev.gap;
}

export const sitarVoice = createVoice('sitar', play, { entry: 4, role: 'lead', onReset: () => { phraser.reset(); prev = null; } });
