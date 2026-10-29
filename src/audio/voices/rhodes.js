import { audio, getVoiceBus } from '../context.js';
import { beat, rand, pick, register, midiToHz, currentScale, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, send, perc } from '../synth.js';

// Electric piano comping. The tone is two-operator FM, the standard way to
// synthesise a tine piano: a 1:1 modulator whose depth follows velocity gives
// the "bark" of a hard hit and decays to a mellow sustain, and a 14:1
// modulator adds the metallic tine ping. It plays chords the way a keyboard
// player comps — rootless voicings (3-5-7-9, the bass has the root) in
// syncopated rhythms, anticipating a chord change by an eighth note — through
// the Suitcase's stereo auto-pan.
const COMPS = [
  [[0, 1.5], [1.5, 2.5]],             // Charleston
  [[0, 2], [2.5, 1.5]],
  [[0, 4]],
  [[0, 1], [1.5, 0.5], [2.5, 1.5]],
  [[0.5, 1], [2, 1], [3.5, 0.5]],     // off-beat stabs (last one anticipates)
  [[1, 0.5], [3, 0.5]],               // backbeat stabs
];
let comp = COMPS[0], curBar = -1, prev = null, panRate = 4.5;

function tine(t, hz, vel, dur, out) {
  const end = t + dur + 0.6;
  const car = osc('sine', hz, t, end);
  const mod = osc('sine', hz, t, end), modAmt = gain(0);
  modAmt.gain.setValueAtTime(hz * (0.5 + 2.3 * vel * vel), t);
  modAmt.gain.setTargetAtTime(hz * 0.22, t, 0.2);
  mod.connect(modAmt); modAmt.connect(car.frequency);
  const ping = osc('sine', hz * 14, t, t + 0.2), pingAmt = gain(0);
  perc(pingAmt.gain, t, hz * 1.4 * vel, 0.07, 0.001);
  ping.connect(pingAmt); pingAmt.connect(car.frequency);

  const env = gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vel, t + 0.003);
  env.gain.setTargetAtTime(0, t + 0.003, 0.6 + 1.6 * Math.sqrt(220 / hz));
  env.gain.setTargetAtTime(0, t + dur, 0.09);
  car.connect(env); env.connect(out);
}

function strike(t, b, lenBeats) {
  // Anticipation: a hit within an eighth of a chord change voices the new chord.
  const cur = harmony.at(b);
  const seg = b + 0.5 >= cur.end - 1e-6 ? harmony.at(cur.end) : cur;
  let pcs = harmony.pcs(seg.degree, 3);
  if (currentScale().length === 7) {
    const [root, , , , ninth] = harmony.pcs(seg.degree, 5);
    pcs = harmony.pcs(seg.degree, 4).slice(1);          // 3rd, 5th, 7th
    if ((ninth - root + 12) % 12 !== 1) pcs.push(ninth); // skip a ♭9 (avoid note)
  }
  const v = harmony.voice(pcs, prev, register(60, 28, 77));
  prev = v;
  for (const m of v) logNote('rhodes', t, m, lenBeats * beat(), 0.75);

  const bus = getVoiceBus('rhodes').dry;
  const pan = audio.ctx.createStereoPanner();
  const panLfo = osc('sine', panRate, t, t + lenBeats * beat() + 0.8), panAmt = gain(0.45);
  panLfo.connect(panAmt); panAmt.connect(pan.pan);
  const out = gain(0.055 * 4 / v.length);
  const vel = rand(0.65, 0.95);
  for (const m of v) tine(t + rand(0, 0.012), midiToHz(m), vel * rand(0.9, 1), lenBeats * beat() * 0.95, out);
  out.connect(pan); pan.connect(bus);
  send(out, audio.reverbSend, 0.3);
}

function play(t, b) {
  const bar = Math.floor(b / 4 + 1e-9), pos = b - bar * 4;
  if (bar !== curBar) {
    curBar = bar;
    if (bar % 2 === 0 && random() < 0.5) comp = pick(COMPS);
  }
  const hit = comp.find(([p]) => Math.abs(p - pos) < 1e-6);
  if (hit) strike(t, b, hit[1]);
  const next = comp.find(([p]) => p > pos + 1e-6);
  return (next ? next[0] : 4) - pos;
}

export const rhodesVoice = createVoice('rhodes', play, {
  entry: 4, role: 'motion',
  onReset: () => { curBar = -1; prev = null; comp = pick(COMPS); panRate = rand(3.5, 5.5); },
});
