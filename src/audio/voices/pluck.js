import { audio, getVoiceBus } from '../context.js';
import { beat, rand, fold, register, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { gain, send, pluckBuffer, playBuffer } from '../synth.js';

// Fingerpicked steel-string guitar (Travis picking). The thumb alternates
// root and fifth in the bass on each beat; the fingers pick upper chord tones
// on the off-beats; beat one is sometimes a "pinch" (thumb + finger). Strings
// are a Karplus–Strong model plucked near the bridge. (The old pluck was
// band-passed white noise and measured ~25 dB quieter than everything else.)
const FINGER_ORDER = [2, 1, 2, 0];
let upperPrev = null;

function string(t, midi, level, ring) {
  logNote('pluck', t, midi, ring, Math.min(1, level * 5));
  const src = playBuffer(pluckBuffer(midi, { t60: ring, bright: 0.62, pick: 0.13, stretch: 0.45, length: ring }), t, t + ring);
  const g = gain(level);
  src.connect(g);
  g.connect(getVoiceBus('pluck').dry);
  send(g, audio.reverbSend, 0.32);
}

function play(t, b) {
  const seg  = harmony.at(b);
  const pcs  = harmony.pcs(seg.degree, 3);
  const i    = Math.round((b - Math.floor(b / 4) * 4) * 2) % 8; // eighth within the bar
  const ring = Math.min(2.2, beat() * 4);

  if (i % 2 === 0) {
    const bassRoot = fold(harmony.degreeNear(seg.degree, register(46, 28, 63)), 28, 63);
    const fifth    = fold(bassRoot + ((pcs[2] - pcs[0] + 12) % 12), bassRoot + 1, bassRoot + 12);
    string(t, (i / 2) % 2 === 0 ? bassRoot : fifth, rand(0.19, 0.23), ring);
    if (i === 0 && random() < 0.4) string(t, upper(pcs)[2], rand(0.13, 0.16), ring);
  } else if (random() > 0.12) {
    const up = upper(pcs);
    string(t, up[FINGER_ORDER[((i - 1) / 2) % 4]], rand(0.12, 0.16), ring * 0.8);
  }
  return 0.5;
}

function upper(pcs) {
  upperPrev = harmony.voice(pcs, upperPrev, register(64, 28, 81));
  return upperPrev;
}

export const pluckVoice = createVoice('pluck', play, { entry: 4, role: 'motion', onReset: () => { upperPrev = null; } });
