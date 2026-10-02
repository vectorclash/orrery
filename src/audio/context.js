// ─── Audio context ────────────────────────────────────────────────────────────
// A single mutable object so all voice modules always see the live references.
export const audio = {
  ctx:        null,
  masterGain: null,
  reverbGain: null,
  analyser:   null,
  masterOut:  null, // final node before destination — tap this for recording/export
  freqData:   null,
  waveData:   null,
  scope:      null, // long-window analyser for the waveform ring
  scopeData:  null,
  started:    false,
  // Per-session inputs, rebuilt by beginSession(). Voices connect only to
  // these, so ending a session silences everything it scheduled — including
  // long notes that were queued into the future before the user pressed stop.
  dry:        null, // centred dry signal (bass, drums)
  reverbSend: null,
  echoSend:   null, // tempo-synced ping-pong delay
  noise:      null, // shared white-noise buffer (see noise())
};

const NOISE_SECONDS = 2;

// Stereo impulse response: decaying noise whose spectrum darkens over time.
// Real rooms absorb high frequencies faster than lows; a tail that stays
// uniformly bright sounds like hiss rather than space.
function buildImpulse(ctx, seconds = 3.6, decay = 2.6) {
  const sr  = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.92 - 0.82 * x;          // one-pole lowpass coefficient: bright → dark
      y += k * ((Math.random() * 2 - 1) - y);
      const norm = Math.sqrt((2 - k) / k); // keep noise power constant as the filter closes
      d[i] = y * norm * Math.pow(1 - x, decay);
    }
  }
  return buf;
}

// ─── Per-voice stereo buses ───────────────────────────────────────────────────
// Fixed pan position per instrument so the mix isn't a mono pile-up. Bass,
// kick and snare stay centred — a centred low end keeps the mix coherent on
// mono/small speakers. Drum-kit pieces are spread like a real kit.
const VOICE_PAN = {
  pad: -0.35, melody: 0.3, texture: -0.55, pluck: 0.45, bell: -0.3,
  arpeggio: 0.5, mallet: -0.45, drone: 0.15, flute: 0.35, choir: -0.15,
  strings: -0.2, rhodes: 0.2, organ: -0.3, glass: 0.4, harp: -0.4,
  brass: 0.3, vibraphone: 0.45, clavinet: -0.5, sitar: 0.5, kalimba: -0.35,
  'kit:hat': 0.3, 'kit:ride': -0.35, 'kit:crash': -0.25, 'kit:tomHi': -0.3,
  'kit:tomLo': 0.3, 'kit:perc': -0.4, 'kit:shaker': 0.45, 'kit:rim': 0.12,
};

let voiceBuses = new Map();
let session    = null;

export function getVoiceBus(name) {
  let bus = voiceBuses.get(name);
  if (!bus) {
    const dry    = audio.ctx.createGain();
    const panner = audio.ctx.createStereoPanner();
    panner.pan.value = VOICE_PAN[name] ?? 0;
    dry.connect(panner);
    panner.connect(audio.dry);
    bus = { dry };
    voiceBuses.set(name, bus);
  }
  return bus;
}

// ─── Session ──────────────────────────────────────────────────────────────────
// Fresh dry/reverb/echo inputs for a new playback run. The previous session's
// nodes are disconnected, so anything it still had scheduled (a 16-beat drone,
// an echo tail, a reverb tail) can't leak into the new music on restart.
export function beginSession() {
  const ctx = audio.ctx;
  if (session) for (const n of session.outputs) n.disconnect();
  voiceBuses = new Map();

  const dry = ctx.createGain();
  dry.connect(audio.masterGain);

  // Reverb: 22 ms pre-delay keeps the dry attack distinct from the tail, and
  // a high-pass on the send keeps bass energy out of the reverb (mud).
  const reverbSend = ctx.createGain();
  const preDelay   = ctx.createDelay(0.1);
  preDelay.delayTime.value = 0.022;
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass'; revHp.frequency.value = 180;
  const conv = ctx.createConvolver();
  conv.buffer = session?.impulse ?? buildImpulse(ctx);
  reverbSend.connect(preDelay); preDelay.connect(revHp); revHp.connect(conv);
  conv.connect(audio.reverbGain);

  // Ping-pong echo: left tap → right tap → back to left, band-limited so the
  // repeats sit behind the dry signal. Delay time follows the tempo.
  const echoSend = ctx.createGain();
  const echoHp = ctx.createBiquadFilter(), echoLp = ctx.createBiquadFilter();
  echoHp.type = 'highpass'; echoHp.frequency.value = 350;
  echoLp.type = 'lowpass';  echoLp.frequency.value = 4200;
  const left = ctx.createDelay(2), right = ctx.createDelay(2);
  const feedback = ctx.createGain(); feedback.gain.value = 0.42;
  const merger = ctx.createChannelMerger(2);
  const echoOut = ctx.createGain(); echoOut.gain.value = 0.8;
  echoSend.connect(echoHp); echoHp.connect(echoLp); echoLp.connect(left);
  left.connect(right); right.connect(feedback); feedback.connect(left);
  left.connect(merger, 0, 0); right.connect(merger, 0, 1);
  merger.connect(echoOut); echoOut.connect(audio.masterGain);
  // A little of the echo feeds the reverb so repeats sit in the same space.
  const echoToVerb = ctx.createGain(); echoToVerb.gain.value = 0.25;
  echoOut.connect(echoToVerb); echoToVerb.connect(reverbSend);

  session = { impulse: conv.buffer, outputs: [dry, conv, echoOut], echo: [left, right] };
  audio.dry        = dry;
  audio.reverbSend = reverbSend;
  audio.echoSend   = echoSend;
}

// Echo time in seconds (a dotted eighth is the classic choice).
export function setEchoTime(sec, at = audio.ctx.currentTime) {
  if (!session) return;
  for (const d of session.echo) d.delayTime.setTargetAtTime(Math.min(1.9, sec), at, 0.05);
}

// ─── Shared noise ─────────────────────────────────────────────────────────────
// One pre-rendered noise buffer, played from a random offset, instead of
// allocating and filling a fresh buffer for every hi-hat, breath and pluck.
export function noise(t, dur) {
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noise;
  src.loop   = true;
  src.start(t, Math.random() * NOISE_SECONDS);
  src.stop(t + dur);
  return src;
}

export function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  audio.ctx = new AC();
  session = null;

  audio.masterGain = audio.ctx.createGain();
  audio.masterGain.gain.value = 0.55;

  audio.analyser = audio.ctx.createAnalyser();
  audio.analyser.fftSize = 512;
  audio.freqData = new Uint8Array(audio.analyser.frequencyBinCount);
  audio.waveData = new Uint8Array(audio.analyser.fftSize);

  // A second, longer tap for the waveform display: 4096 samples (~90 ms) is
  // enough to find a trigger point and lift out a whole number of periods,
  // while the spectrum analyser above keeps its 256 bins.
  audio.scope = audio.ctx.createAnalyser();
  audio.scope.fftSize = 4096;
  audio.scopeData = new Float32Array(audio.scope.fftSize);

  audio.reverbGain = audio.ctx.createGain();
  audio.reverbGain.gain.value = 0.45;

  const sr = audio.ctx.sampleRate;
  audio.noise = audio.ctx.createBuffer(1, sr * NOISE_SECONDS, sr);
  const nd = audio.noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // ─── Master bus: gentle high-pass to clear sub-rumble + a soft compressor
  // for cohesion and to catch peaks when density/voice count stacks up.
  // Tuned conservatively so it doesn't squash the ambient dynamics.
  const highpass = audio.ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 30;

  const compressor = audio.ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value      = 24;
  compressor.ratio.value     = 4;
  compressor.attack.value    = 0.01;
  compressor.release.value   = 0.25;

  audio.masterGain.connect(audio.analyser);
  audio.analyser.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(audio.ctx.destination);
  audio.masterOut = compressor;
  compressor.connect(audio.scope); // what reaches the speakers; analysers need no output

  audio.reverbGain.connect(audio.analyser);

  beginSession();
  audio.started = true;
}
