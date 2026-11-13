import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, pick, fold, register, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { song } from '../song.js';
import { gain, send, pluckBuffer, playBuffer, settle, desk } from '../synth.js';
import { barBeats, step16 } from '../meter.js';

// Fingerpicked steel-string guitar (Travis picking). The thumb alternates
// root and fifth in the bass on each beat; the fingers pick upper chord tones
// on the off-beats; beat one is sometimes a "pinch" (thumb + finger). Strings
// are a Karplus–Strong model plucked near the bridge, in a flat-top's body,
// with both polarisations (see pluckBuffer). (The old pluck was band-passed
// white noise and measured ~25 dB quieter than everything else.)
const FINGER_ORDER = [2, 1, 2, 0];
const POL = { cents: 1.2, t60: 0.4, mix: 0.35 };
const PEAK = 2.3; // how far above its level a string's attack may reach
let upperPrev = null;

// For the newer composers, the picked guitar of the other genres that use it: Travis
// picking is folk's, and it was trap's, reggaeton's and drum & bass's too. Sixteenths:
// T the thumb on the bass note, P a pinch (thumb and the top note), a an upper note,
// walking up and down the chord, '.' nothing. One drawn for a loop or a section.
const ARPS = {
  // Trap: an arpeggio loop in eighths with sixteenth turns.
  trap: ['T.aaa.a.T.a.aaa.', 'T...a.a.a...a.a.', 'T.a.a.aaT.a.a.a.'],
  // Dembow: the 3+3+2.
  reggaeton: ['T..a..a.T..a..a.', 'T..a..a.a..a..a.', 'P..a..a.T..a.aa.'],
  // Liquid drum & bass: half-time, room between the notes.
  dnb: ['T.......a...a...', 'T...a...a...a...', 'T.....a.a...a...'],
  // Afrobeats: highlife-style picking.
  afro: ['T.aa.a.aT.aa.a.a', 'T..a.aa.T..a.aa.', 'P.a.a.aaT.a.a.a.'],
};
const ARPS_FOR = { TRAP: 'trap', REGGAETON: 'reggaeton', 'LIQUID DNB': 'dnb', AFROBEATS: 'afro', 'AFRO HOUSE': 'afro', AMAPIANO: 'afro' };
const UP_DOWN = [0, 1, 2, 1];
// Sparser than the Travis picking they replace: each level-matched (BS.1770, gated) to it.
const ARPS_TRIM = { trap: 1.3, reggaeton: 1.3, dnb: 1.6, afro: 1.12 };
let arp = null, arpFor = null; // the pattern, and the language and section it was drawn for

// One sixteenth of an arpeggio pattern.
function picking(t, b, arps, trim) {
  const key = `${state.language}|${song.current ? song.sectionAt(b).start : ''}`;
  if (arpFor !== key) { arp = pick(arps); arpFor = key; }
  const step = step16(b - Math.floor(b / barBeats()) * barBeats()), ch = arp[step];
  if (ch === '.') return 0.25;
  const seg = harmony.at(b), pcs = harmony.pcs(seg.degree, 3);
  const ring = Math.min(2.2, beat() * 4);
  const bass = fold(harmony.degreeNear(seg.degree, register(46, 28, 63)), 28, 63);
  if (ch === 'T' || ch === 'P') string(t, bass, rand(0.19, 0.23) * trim, ring);
  if (ch === 'P') string(t, upper(pcs)[2], rand(0.13, 0.16) * trim, ring);
  if (ch === 'a') {
    const nth = [...arp.slice(0, step)].filter(c => c === 'a').length;
    string(t, upper(pcs)[UP_DOWN[nth % 4]], rand(0.12, 0.16) * trim, ring * 0.8);
  }
  return 0.25;
}

function string(t, midi, level, ring) {
  logNote('pluck', t, midi, ring, Math.min(1, level * 5));
  const src = playBuffer(pluckBuffer(midi, { t60: ring, bright: 0.62, pick: 0.13, stretch: 0.45, length: ring, body: 'acoustic', pol: POL }), t, t + ring);
  settle(src, t, 5, 0.05);
  const g = gain(level), d = desk(level * PEAK, 1.07); // see desk()
  src.connect(g); g.connect(d.input);
  d.output.connect(getVoiceBus('pluck').dry);
  send(d.output, audio.reverbSend, 0.32);
}

function play(t, b) {
  const family = state.composer >= 2 ? ARPS_FOR[state.language] : null;
  if (family) return picking(t, b, ARPS[family], ARPS_TRIM[family]);
  const seg  = harmony.at(b);
  const pcs  = harmony.pcs(seg.degree, 3);
  const B    = barBeats();
  const i    = Math.round((b - Math.floor(b / B) * B) * 2) % (2 * B); // eighth within the bar
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

export const pluckVoice = createVoice('pluck', play, { entry: 'bar', role: 'motion', onReset: () => { upperPrev = null; arpFor = null; } });
