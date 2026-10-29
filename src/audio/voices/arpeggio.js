import { audio, getVoiceBus } from '../context.js';
import { state, beat, pick, lerp, register, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send } from '../synth.js';

// Arpeggiator. The step counter runs off the global beat grid, so the figure
// stays locked to the bar and simply re-maps onto each new chord (a real arp
// doesn't restart its pattern every few notes). Patterns change per phrase.
// Sound: saw through a resonant lowpass with a snappy envelope, into the
// tempo-synced echo — the classic synth-arp voice.
const PATTERNS = {
  up:      n => [...Array(n).keys()],
  down:    n => [...Array(n).keys()].reverse(),
  updown:  n => { const u = [...Array(n).keys()]; return [...u, ...u.slice(1, -1).reverse()]; },
  alberti: () => [0, 2, 1, 2],          // low–high–middle–high
  broken:  n => [0, 2, 1, 3, 2, Math.min(4, n - 1)],
  pinky:   n => [0, n - 1, 1, n - 1, 2, n - 1], // top note as a pedal
};
let pattern = 'up';
let rate    = 0.25;
let phrase  = -1;

function chordNotes(b) {
  const seg  = harmony.at(b);
  const base = register(56, 28, 73);
  if (seg.seventh) return harmony.stack(b, base, 4);
  const triad = harmony.stack(b, base, 3);
  return [...triad, triad[0] + 12];
}

function play(t, b) {
  const p = Math.floor(b / 16);
  if (p !== phrase) { phrase = p; if (random() < 0.5) pattern = pick(Object.keys(PATTERNS)); }
  const step  = Math.round(b / rate);
  const notes = chordNotes(b);
  const seq   = PATTERNS[pattern](notes.length);
  const midi  = notes[seq[step % seq.length]];

  const bus   = getVoiceBus('arpeggio').dry;
  const hz    = midiToHz(midi);
  const gate  = rate * beat() * 0.85;
  const vel   = step % 4 === 0 ? 1 : 0.78;
  const peak  = 0.1 * vel;
  logNote('arpeggio', t, midi, gate, vel);

  const lp = filter('lowpass', 300, 3.5);
  const top = lerp(1600, 5200, state.brightness) * (0.7 + 0.3 * vel);
  lp.frequency.setValueAtTime(top, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(hz * 1.5, 280), t + Math.min(0.2, gate + 0.05));
  const o = osc('sawtooth', hz, t, t + gate + 0.12);
  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.setTargetAtTime(peak * 0.5, t + 0.004, gate * 0.5);
  env.gain.setTargetAtTime(0, t + gate, 0.025);
  o.connect(lp); lp.connect(env); env.connect(bus);
  send(env, audio.reverbSend, 0.28);
  send(env, audio.echoSend, 0.3);
  return rate;
}

export const arpeggioVoice = createVoice('arpeggio', play, {
  role: 'motion',
  onReset: () => {
    phrase = -1;
    pattern = pick(Object.keys(PATTERNS));
    rate = state.tempo > 110 ? pick([0.25, 0.5, 0.5]) : pick([0.25, 0.25, 0.5]);
  },
});
