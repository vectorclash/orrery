import { audio, getVoiceBus } from '../context.js';
import { state, beat, rand, pick, lerp, register, midiToHz, random } from '../../state.js';
import { createVoice, transport } from '../transport.js';
import { logNote } from '../notes.js';
import { osc, gain, filter, send, lfo, ahr } from '../synth.js';

// Tonic pedal: root and perfect fifth, sustained under the progression.
// (The old code took scale[4] as "the fifth", which in a pentatonic scale is
// the 7th.) Each note is a detuned pair, and a very slow filter sweep keeps
// the drone evolving; successive drones cross-fade.
let wave = 'sawtooth';
let held = null; // gain stage of the sounding drone, so a key change can release it

function play(t, b) {
  const len  = pick([8, 12, 16]);
  const dur  = len * beat();
  const root = register(53, 28, 70);
  const bus  = getVoiceBus('drone').dry;
  const peak = rand(0.07, 0.1);
  const end  = t + dur + 2.6;
  logNote('drone', t, root, dur, 0.6);
  logNote('drone', t, root + 7, dur, 0.5);

  const cutoff = lerp(200, 900, state.brightness);
  const lp = filter('lowpass', cutoff, 0.9);
  lfo(rand(0.05, 0.1), cutoff * 0.35, t, end).connect(lp.frequency);

  for (const midi of [root, root + 7]) {
    for (const d of [-5, 5]) osc(wave, midiToHz(midi), t, end, d + rand(-2, 2)).connect(lp);
  }
  const env = gain(0), release = gain(1);
  ahr(env.gain, t, peak / 2, 2.5, dur, 2.5);
  lp.connect(env); env.connect(release);
  release.connect(bus);
  send(release, audio.reverbSend, lerp(0.4, 0.9, state.spaciousness));
  held = release;
  return len;
}

export const droneVoice = createVoice('drone', play, {
  entry: 4, role: 'bed',
  onReset: atBeat => {
    // Era change: fade the old-key drone out as the new one fades in.
    if (held && atBeat !== null) {
      const at = transport.timeAt(atBeat);
      held.gain.setValueAtTime(1, at);
      held.gain.setTargetAtTime(0, at, 0.8);
    }
    held = null;
    wave = random() < 0.5 ? 'sawtooth' : 'square';
  },
});
