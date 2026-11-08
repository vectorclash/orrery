import { audio, getVoiceBus, noise } from '../context.js';
import { beat, pick, register, midiToHz, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { osc, gain, filter, send, perc } from '../synth.js';

// Hammond-style tonewheel organ. Drawbars are pitched in organ footages —
// 16′ 5⅓′ 8′ 4′ 2⅔′ 2′ 1⅗′ 1⅓′ 1′ = 0.5, 1.5, 1, 2, 3, 4, 5, 6, 8 × the note —
// not a plain harmonic series, and each drawbar step is ~3 dB. A registration
// is chosen per session from classic settings. The "percussion" (a decaying
// 2⅔′ on the attack) plus key click give the bite, and the Leslie (below)
// gives it the motion.
const FOOTAGE = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
const REGISTRATIONS = [
  { bars: [8, 8, 8, 0, 0, 0, 0, 0, 0], perc: true  }, // jazz
  { bars: [8, 0, 8, 0, 0, 0, 0, 0, 0], perc: false }, // mellow
  { bars: [8, 8, 6, 0, 0, 0, 0, 0, 0], perc: true  }, // Booker T.
  { bars: [6, 8, 8, 6, 0, 0, 0, 0, 0], perc: false }, // gospel
  { bars: [0, 0, 8, 8, 0, 0, 0, 0, 0], perc: false }, // soft flutes
];
const drawbar = level => (level ? Math.pow(10, (level - 8) * 3 / 20) : 0);
const ORGAN_TRIM = 0.83; // level-matched to the old, mono Leslie: the bus's panner gives a stereo source more
let reg  = REGISTRATIONS[0];
let prev = null;

// ─── The Leslie ───────────────────────────────────────────────────────────────
// The cabinet splits the organ at 800 Hz: the treble goes up to a spinning horn,
// the bass down to a spinning drum, each turning at its own speed, so the two
// drift against each other and never line up. The horn's narrow beam sweeps past
// the microphones: a deep swell, a Doppler wobble in pitch as it comes and goes,
// and the sound moving from side to side; the drum's wider throw mostly swells.
// Switched between chorale (slow) and tremolo (fast), the light horn gets there in
// about a second and the heavy drum in several. They turn on through the chords:
// the old Leslie was one wobble on the whole chord, in mono, restarted with every
// chord, so each began with the same swell. Tonewheels are sine waves, so each
// one goes to the rotor its pitch belongs to, and the crossover needs no filter.
const CROSSOVER = 800;
const ROTORS = { // rev/s; ramp time constants (s); swell, pan and Doppler depths at full speed
  horn: { slow: 0.83, fast: 6.8, up: 0.35, down: 0.9, am: 0.32, pan: 0.55, cents: 10 },
  drum: { slow: 0.67, fast: 5.9, up: 1.6, down: 2.6, am: 0.18, pan: 0.25, cents: 2 },
};
let leslie = null; // per rotor: ramping from `from` toward `to` since `at`, turned `phase` cycles then

// A rotor's speed at `t` and how far round it is (in cycles), from its ramp.
function rotorAt(r, t) {
  const dt = Math.max(0, t - r.at), e = Math.exp(-dt / r.tau);
  return { rate: r.to + (r.from - r.to) * e, turned: r.phase + r.to * dt + (r.from - r.to) * r.tau * (1 - e) };
}

function setSpeed(t, fast, nudge) {
  for (const name of ['horn', 'drum']) {
    const spec = ROTORS[name], to = (fast ? spec.fast : spec.slow) * (0.97 + 0.06 * nudge);
    const now = leslie?.[name] ? rotorAt(leslie[name], t) : { rate: to, turned: 0 };
    leslie = { ...leslie, [name]: { from: now.rate, to, at: t, tau: fast ? spec.up : spec.down, phase: now.turned % 1 } };
  }
  leslie.fast = fast;
}

// One chord's view of a rotor: a sine (which way it points, for the swell and the
// pan) and a cosine (how fast it's coming toward the microphones, for the Doppler),
// starting where the rotor has turned to, at its speed now, ramping as it is.
function rotor(name, t, end) {
  const r = leslie[name], { rate, turned } = rotorAt(r, t), ph = 2 * Math.PI * turned;
  const make = (re, im) => {
    const o = audio.ctx.createOscillator();
    o.setPeriodicWave(audio.ctx.createPeriodicWave(new Float32Array([0, re]), new Float32Array([0, im]), { disableNormalization: true }));
    o.frequency.setValueAtTime(rate, t);
    if (Math.abs(rate - r.to) > 1e-3) o.frequency.setTargetAtTime(r.to, t, r.tau);
    o.start(t); o.stop(end);
    return o;
  };
  // sin(θ+φ) = sin θ cos φ + cos θ sin φ, and cos(θ+φ) = cos θ cos φ − sin θ sin φ.
  const sin = make(Math.sin(ph), Math.cos(ph)), cos = make(Math.cos(ph), -Math.sin(ph));
  const spec = ROTORS[name], full = spec.fast;
  // The chord's sound through this rotor: gated by the chord, swelling, panned.
  const gate = gain(0), swell = gain(1), pan = audio.ctx.createStereoPanner();
  const am = gain(spec.am), panAmt = gain(spec.pan);
  sin.connect(am); am.connect(swell.gain);
  sin.connect(panAmt); panAmt.connect(pan.pan);
  // Doppler depth follows the speed: the faster it turns, the faster it approaches.
  const doppler = gain(spec.cents * rate / full);
  if (Math.abs(rate - r.to) > 1e-3) doppler.gain.setTargetAtTime(spec.cents * r.to / full, t, r.tau);
  cos.connect(doppler);
  gate.connect(swell); swell.connect(pan);
  return { input: gate, gate: gate.gain, swell, doppler, output: pan };
}

function play(t, b) {
  const seg  = harmony.at(b);
  const len  = seg.end - b;
  const dur  = len * beat();
  const pcs  = harmony.voiced(seg);
  const v    = harmony.voice(pcs, prev, register(60, 28, 80), { bed: true, name: 'organ', from: b, to: seg.end });
  prev = v;
  for (const m of v) logNote('organ', t, m, dur, 0.6);

  const bus  = getVoiceBus('organ').dry;
  const end  = t + dur + 0.1;
  const peak = 0.045 * 3 / v.length * ORGAN_TRIM;

  // The player's hand on the Leslie switch: the first chord finds it at either
  // speed, and now and then a chord flips it (two draws, as the Leslie always took).
  const toss = random(), nudge = random();
  if (!leslie) setSpeed(t, toss < 0.3, nudge);
  else if (toss < 0.1) setSpeed(t, !leslie.fast, nudge);
  const horn = rotor('horn', t, end), drum = rotor('drum', t, end);
  for (const { gate } of [horn, drum]) {
    gate.setValueAtTime(0, t);
    gate.linearRampToValueAtTime(1, t + 0.008);
    gate.setValueAtTime(1, t + dur - 0.04);
    gate.linearRampToValueAtTime(0, t + dur);
  }
  const to = hz => (hz < CROSSOVER ? drum : horn);

  for (const midi of v) {
    const hz = midiToHz(midi);
    reg.bars.forEach((level, i) => {
      if (!level || hz * FOOTAGE[i] > 8000) return;
      const r = to(hz * FOOTAGE[i]);
      const o = osc('sine', hz * FOOTAGE[i], t, end);
      r.doppler.connect(o.detune);
      const g = gain(peak * drawbar(level));
      o.connect(g); g.connect(r.input);
    });
    if (reg.perc) {
      // The percussion isn't gated with the chord: it decays by itself.
      const r = to(hz * 3);
      const p = osc('sine', hz * 3, t, t + 0.4), pe = gain(0);
      perc(pe.gain, t, peak * 0.7, 0.28, 0.001);
      p.connect(pe); pe.connect(r.swell);
    }
  }
  // Key click: the contacts closing.
  const click = noise(t, 0.012), clickLp = filter('lowpass', 2800), clickE = gain(0);
  perc(clickE.gain, t, peak * 0.4, 0.008, 0.0005);
  click.connect(clickLp); clickLp.connect(clickE); clickE.connect(bus);

  for (const r of [horn, drum]) {
    r.output.connect(bus);
    send(r.output, audio.reverbSend, 0.2);
  }
  return len;
}

export const organVoice = createVoice('organ', play, {
  role: 'bed',
  onReset: () => { prev = null; reg = pick(REGISTRATIONS); leslie = null; },
});
