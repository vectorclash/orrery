import { audio, getVoiceBus } from '../context.js';
import { state, rand, lerp, register, midiToHz } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { createPhraser } from '../phrase.js';
import { osc, gain, filter, send, perc, shaper } from '../synth.js';

// Cowbell lead: the 808's cowbell played as a tune, which is the sound of phonk. The
// drum machine's cowbell is two square waves a little under a fifth apart through a
// band-pass, a clank with a pitch; Memphis producers pitched it up and down a keyboard
// and wrote riffs with it, and drift phonk made those riffs the whole song. Here the
// lower square is the note and the upper sits a fifth above, so a riff stays in key;
// a fast click, a short body and a longer ring, driven a little, as the tape those
// records were made on was. Plays riffs: a figure repeated bar after bar.
const phraser = createPhraser({ name: 'cowbell', base: () => register(69, 28, 84), style: 'active', ostinato: true, repeat: 0.85 });

function play(t, b) {
  const ev = phraser.next(b);
  if (ev.midi === null) return ev.gap;
  const hz = midiToHz(ev.midi);
  const peak = 0.3 * ev.vel * lerp(0.75, 1, state.density);
  const ring = rand(0.3, 0.38);
  logNote('cowbell', t, ev.midi, ring, ev.vel);

  const bp = filter('bandpass', hz * 1.9, 1.3), hp = filter('highpass', hz * 0.8, 0.7);
  const a = osc('square', hz, t, t + ring + 0.1), b2 = osc('square', hz * 1.4983, t, t + ring + 0.1), b2G = gain(0.8);
  a.connect(bp); b2.connect(b2G); b2G.connect(bp);
  const env = gain(0);
  // Two stages: the strike falls away in a few hundredths of a second, the ring after it.
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.001);
  env.gain.setTargetAtTime(peak * 0.5, t + 0.001, 0.012);
  env.gain.setTargetAtTime(0, t + 0.04, ring / 3);
  const drive = shaper(1.5);
  bp.connect(hp); hp.connect(drive); drive.connect(env);
  env.connect(getVoiceBus('cowbell').dry);
  send(env, audio.reverbSend, 0.3);
  send(env, audio.echoSend, 0.16);
  return ev.gap;
}

export const cowbellVoice = createVoice('cowbell', play, { entry: 'bar', role: 'lead', onReset: phraser.reset });
