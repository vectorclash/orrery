import { audio, getVoiceBus } from '../context.js';
import { state, beat, pick, lerp, register, midiToHz, random, rhythmChance } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { song } from '../song.js';
import { lines } from '../lines.js';
import { osc, gain, filter, send } from '../synth.js';
import { restream, within, stream } from '../../random.js';
import { barBeats, isFour } from '../meter.js';

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

// Threes: now and then a song's arpeggio goes round in groups of three, three
// chord tones a group with the accent on the first, against the bar's four: in
// sixteenths the accents fall a dotted eighth apart, three against four (the
// synthwave and trance arp); in eighths a dotted quarter apart. It comes back to
// the downbeat every three bars, and starts again each four bars of a section. Drawn from
// a stream of its own, once a song, so it leaves the arp's other draws as they were.
const THREES = [[0, 1, 2], [0, 2, 1], [0, 1, 3], [2, 1, 0]];
let threes = null; // the group, or null for the pattern

function drawThrees() {
  restream('arpeggio.threes', 'song');
  threes = within(stream('arpeggio.threes'), () => {
    const r = random(), group = pick(THREES);
    return rhythmChance(r, 0.35) ? group : null;
  });
}

function chordNotes(b) {
  const seg  = harmony.at(b);
  const base = register(56, 28, 73);
  if (seg.seventh) return harmony.stack(b, base, 4);
  const triad = harmony.stack(b, base, 3);
  return [...triad, triad[0] + 12];
}

function play(t, b) {
  const line = lines.next('arpeggio', b);
  if (line) {
    if (line.midi !== null) note(t, line.midi, line.dur * beat() * 0.85, line.vel >= 0.92 ? 1 : 0.78);
    return line.gap;
  }
  const p = Math.floor(b / (4 * barBeats()));
  if (p !== phrase) { phrase = p; if (state.composer < 2 && random() < 0.5) pattern = pick(Object.keys(PATTERNS)); }
  const notes = chordNotes(b);
  if (threes && isFour()) {
    const top = song.current ? song.sectionAt(b)?.start ?? 0 : 0;
    const n = Math.round(((b - top) % 16) / rate);
    note(t, notes[threes[n % 3]], rate * beat() * 0.85, n % 3 === 0 ? 1 : 0.72);
    return rate;
  }
  const step  = Math.round(b / rate);
  const seq   = PATTERNS[pattern](notes.length);
  note(t, notes[seq[step % seq.length]], rate * beat() * 0.85, step % 4 === 0 ? 1 : 0.78);
  return rate;
}

function note(t, midi, gate, vel) {
  const bus   = getVoiceBus('arpeggio').dry;
  const hz    = midiToHz(midi);
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
}

export const arpeggioVoice = createVoice('arpeggio', play, {
  role: 'motion',
  onReset: () => {
    phrase = -1;
    pattern = pick(Object.keys(PATTERNS));
    rate = state.tempo > 110 ? pick([0.25, 0.5, 0.5]) : pick([0.25, 0.25, 0.5]);
    drawThrees();
  },
});
