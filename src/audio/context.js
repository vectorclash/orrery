import { state } from '../state.js';

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
  leveler:    null, // slow loudness rider on the master (see updateLevel)
  meter:      null,
  level:      null,
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
// uniformly bright sounds like hiss rather than space. `darken` is how far
// the lowpass closes by the end: 0.82 ends near 800 Hz, 0.4 near 5.6 kHz.
function buildImpulse(ctx, seconds = 3.6, decay = 2.6, darken = 0.82) {
  const sr  = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.92 - darken * x;        // one-pole lowpass coefficient: bright → dark
      y += k * ((Math.random() * 2 - 1) - y);
      const norm = Math.sqrt((2 - k) / k); // keep noise power constant as the filter closes
      // A real tail builds up over its first ~40 ms as reflections multiply;
      // starting at full density sounds like a burst of noise, not a space.
      const build = Math.min(1, i / (sr * 0.04));
      d[i] = y * norm * Math.pow(1 - x, decay) * build;
    }
  }
  return buf;
}

// ─── Room ─────────────────────────────────────────────────────────────────────
// The hall above is a long tail that each voice sends to at its own level, so
// voices sat at different depths of a wash while their dry sound stayed
// bone-dry: close-miked instruments in no particular space. The room is what
// places them together. Every dry signal goes into it at one level, so
// everything shares the same early reflections and short tail.
//
// True-stereo impulse (4 channels: L→L, L→R, R→L, R→R) so a voice panned left
// still excites both walls, with the far side arriving later and darker.
// Discrete early reflections over the first `er` ms (bigger room, wider
// spread), then a diffuse tail that builds up, decays with RT60 ≈ `rt60` and
// darkens as it goes.
function buildRoom(ctx, rt60, er) {
  const sr  = ctx.sampleRate;
  const len = Math.floor(sr * rt60 * 1.3);
  const buf = ctx.createBuffer(4, len, sr);
  for (let ch = 0; ch < 4; ch++) {
    const cross = ch === 1 || ch === 2;
    const d = buf.getChannelData(ch);

    // Early reflections: sparse taps, quieter and duller the later they come.
    const taps = cross ? 10 : 14;
    for (let n = 0; n < taps; n++) {
      const t   = (cross ? 9 : 4) * er / 70 + Math.random() * er * 0.95; // ms
      const amp = (cross ? 0.55 : 0.8) * (1 - t / (er * 1.3)) * (Math.random() < 0.5 ? -1 : 1);
      const at  = Math.floor(sr * t / 1000);
      const w   = 2 + Math.floor(t / 12);                 // wider tap = more HF lost
      for (let k = 0; k < w; k++) d[at + k] += amp * (1 - k / w) * 2 / w;
    }

    // Diffuse tail.
    let y = 0;
    const start = Math.floor(sr * er * 0.17 / 1000), ramp = sr * er * 0.7 / 1000;
    for (let i = start; i < len; i++) {
      const x = i / len;
      const k = 0.75 - 0.6 * x;
      y += k * ((Math.random() * 2 - 1) - y);
      const norm  = Math.sqrt((2 - k) / k);
      const env   = Math.exp(-6.91 * (i / sr) / rt60) * Math.min(1, (i - start) / ramp);
      d[i] += y * norm * env * (cross ? 0.07 : 0.08);
    }

  }
  // Unit energy per output (each output sums a direct and a cross path), so
  // the send level alone sets how much room there is.
  for (const [a, b] of [[0, 2], [1, 3]]) {
    const pa = buf.getChannelData(a), pb = buf.getChannelData(b);
    let e = 0;
    for (let i = 0; i < len; i++) e += pa[i] * pa[i] + pb[i] * pb[i];
    const s = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < len; i++) { pa[i] *= s; pb[i] *= s; }
  }
  return buf;
}
// ─── Spaces ───────────────────────────────────────────────────────────────────
// A space is a room and a hall that belong together: a small room never
// carries a cathedral tail. `roomDb` is room energy relative to the dry
// signal for the nearest voices (others sit further back, see VOICE_DISTANCE);
// `hallDb` scales the per-voice hall sends. `room` reproduces the original
// single space.
//
// SHIMMER isn't a real place. Its tail stays bright instead of darkening, and
// `shimmer` is the feedback level of an octave-up pitch shifter around the
// hall (see makeShimmer). Order matters: share links store the index, so only
// ever append.
export const ROOMS = {
  studio:    { label: 'STUDIO',    rt60: 0.35, er: 35,  roomDb: -15, hall: [1.6, 3.4], hallDb: -5, preDelay: 0.008 },
  room:      { label: 'ROOM',      rt60: 0.7,  er: 70,  roomDb: -13, hall: [3.6, 2.6], hallDb: 0,  preDelay: 0.022 },
  hall:      { label: 'HALL',      rt60: 1.3,  er: 110, roomDb: -12, hall: [5.0, 2.3], hallDb: 1,  preDelay: 0.032 },
  cathedral: { label: 'CATHEDRAL', rt60: 2.2,  er: 160, roomDb: -11, hall: [8.0, 2.0], hallDb: 2,  preDelay: 0.045 },
  shimmer:   { label: 'SHIMMER',   rt60: 1.3,  er: 110, roomDb: -12, hall: [7.0, 1.8, 0.4], hallDb: 1, preDelay: 0.04, shimmer: 0.35 },
};

// Impulses are noise-built and cost a few ms each, so they're made once per
// space and sample rate. AudioBuffers can be shared between contexts.
const impulses = new Map();
function impulsesFor(name, ctx) {
  const key = `${name}|${ctx.sampleRate}`;
  if (!impulses.has(key)) {
    const p = ROOMS[name];
    impulses.set(key, { room: buildRoom(ctx, p.rt60, p.er), hall: buildImpulse(ctx, ...p.hall) });
  }
  return impulses.get(key);
}

const dbToGain = db => Math.pow(10, db / 20);
const SPACE_FADE = 0.25; // seconds; see setRoom()

// ─── Shimmer ──────────────────────────────────────────────────────────────────
// An octave-up pitch shifter in the hall's feedback loop: whatever the tail
// holds comes back an octave higher and rings on, so a chord blooms upward
// into its own upper octaves. Each pass climbs another octave until the
// loop's lowpass takes it, which is also what keeps the loop from running
// away: nothing goes round twice at the same pitch.
//
// The shifter is the delay-line kind. A delay that shrinks at one second
// per second plays its input back twice as fast — an octave up. It can't
// shrink forever, so two taps restart every grain, half a grain apart, each
// faded in and out by a Hann window; the two windows sum to one. All four
// control signals come from one looping buffer, so they can't drift apart.
const GRAIN     = 0.1;   // seconds; shorter grains warble, longer ones echo
const MIN_DELAY = 0.003; // a delay inside a feedback loop can't go below one render quantum
const grains = new Map();
function grainBuffer(ctx) {
  const sr = ctx.sampleRate;
  if (!grains.has(sr)) {
    const n = Math.round(GRAIN * sr), buf = ctx.createBuffer(4, n, sr);
    const [delA, winA, delB, winB] = [0, 1, 2, 3].map(c => buf.getChannelData(c));
    for (let i = 0; i < n; i++) {
      const b = (i + n / 2) % n;
      delA[i] = MIN_DELAY + (n - i) / sr;
      delB[i] = MIN_DELAY + (n - b) / sr;
      winA[i] = Math.sin(Math.PI * i / n) ** 2;
      winB[i] = Math.sin(Math.PI * b / n) ** 2;
    }
    grains.set(sr, buf);
  }
  return grains.get(sr);
}

// Wraps the convolver `hall` in the shimmer loop. Returns a handle whose
// stop() halts the clock and disconnects the loop, for when the space goes.
function makeShimmer(hall, level) {
  const ctx = audio.ctx;
  // Band-limit what goes round: no low end to smear upward, and a ceiling so
  // the top octaves fade out rather than climbing into fizz.
  const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 250;
  lp.type = 'lowpass';  lp.frequency.value = 3000; lp.Q.value = 0.5;
  const clock = ctx.createBufferSource();
  clock.buffer = grainBuffer(ctx);
  clock.loop = true;
  const split = ctx.createChannelSplitter(4);
  clock.connect(split);
  const back = ctx.createGain();
  back.gain.value = level;
  hall.connect(hp); hp.connect(lp);
  const nodes = [hp, lp, split, back];
  for (const c of [0, 2]) {
    const tap = ctx.createDelay(GRAIN + 0.01), win = ctx.createGain();
    tap.delayTime.value = 0; win.gain.value = 0; // the clock supplies both
    split.connect(tap.delayTime, c); split.connect(win.gain, c + 1);
    lp.connect(tap); tap.connect(win); win.connect(back);
    nodes.push(tap, win);
  }
  back.connect(hall);
  clock.start();
  return { stop() { clock.stop(); clock.disconnect(); for (const n of nodes) n.disconnect(); } };
}

// One space, fed from the session's room and hall buses. Its inputs start
// closed; open() and close() fade them.
function makeSpace(name) {
  const ctx = audio.ctx, p = ROOMS[name], ir = impulsesFor(name, ctx);
  const roomIn = ctx.createGain(), hallIn = ctx.createGain();
  roomIn.gain.value = hallIn.gain.value = 0;

  const room = ctx.createConvolver();
  room.normalize = false; // the impulse is already unit-energy (see buildRoom)
  room.buffer = ir.room;
  session.roomBus.connect(roomIn); roomIn.connect(room); room.connect(audio.masterGain);

  const preDelay = ctx.createDelay(0.1);
  preDelay.delayTime.value = p.preDelay; // keeps the dry attack distinct from the tail
  const hall = ctx.createConvolver();
  hall.buffer = ir.hall;
  session.hallBus.connect(hallIn); hallIn.connect(preDelay); preDelay.connect(hall); hall.connect(audio.reverbGain);
  const shimmer = p.shimmer ? makeShimmer(hall, p.shimmer) : null;

  const fade = (param, to, at) => {
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
    param.linearRampToValueAtTime(to, at + SPACE_FADE);
  };
  return {
    name,
    tail: Math.max(p.hall[0], p.rt60 * 1.3) * (shimmer ? 2 : 1) + p.preDelay, // shimmer octaves outlast the impulse
    open(at)  { fade(roomIn.gain, dbToGain(p.roomDb), at); fade(hallIn.gain, dbToGain(p.hallDb), at); },
    close(at) { fade(roomIn.gain, 0, at); fade(hallIn.gain, 0, at); },
    disconnect() { roomIn.disconnect(); hallIn.disconnect(); room.disconnect(); hall.disconnect(); shimmer?.stop(); },
  };
}

// Change space at audio time `at`. Only the *inputs* crossfade: new sound
// goes into the new space while the old one's tail rings out on its own, as
// it would if you walked into the next room — nothing is cut off, so there's
// no click and no hole. The old space is dropped once its tail has decayed.
export function setRoom(name, at = audio.ctx.currentTime) {
  if (!session || !ROOMS[name] || session.space.name === name) return;
  const old = session.space;
  old.close(at);
  session.space = makeSpace(name);
  session.space.open(at);
  session.spaces.push(session.space);
  const wait = (at - audio.ctx.currentTime + SPACE_FADE + old.tail) * 1000;
  setTimeout(() => {
    if (!session?.spaces.includes(old)) return; // the session already ended
    old.disconnect();
    session.spaces.splice(session.spaces.indexOf(old), 1);
  }, Math.max(0, wait));
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
  synthbrass: -0.25, monolead: 0.15, // juno and solina are centred: their chorus spreads them
  'kit:hat': 0.3, 'kit:ride': -0.35, 'kit:crash': -0.25, 'kit:tomHi': -0.3,
  'kit:tomLo': 0.3, 'kit:perc': -0.4, 'kit:shaker': 0.45, 'kit:rim': 0.12,
};

// Distance: how far back each voice sits, as extra room on top of the shared
// level every dry signal gets (dB more room energy). Leads, bass and drums up
// front; rhythmic and harmonic parts behind them; beds and air at the back.
// One shared room with different direct-to-room ratios is how a real
// ensemble reads in depth, not just side to side.
const VOICE_DISTANCE = {
  arpeggio: 3, harp: 3, pluck: 3, kalimba: 3, mallet: 3, clavinet: 3, rhodes: 3, vibraphone: 3, organ: 3,
  pad: 6, strings: 6, choir: 6, drone: 6, supersaw: 6, juno: 6, solina: 6, synthbrass: 6,
  texture: 6, glass: 6, bell: 6,
};

// Low cut: the bass owns the bottom octave and a half. Measured solo, pads,
// strings, organ and drone put 10–20 dB more energy into 60–250 Hz than the
// bass itself (more again an octave down), burying it in mud. While the bass
// plays, every other part is high-passed by role; without it they keep their
// low end and only rumble is cut. Drums keep theirs — the toms need it.
// The cutoffs are set for octave 0 and drop an octave with the Octave control,
// so the filter keeps the same place relative to each voice's notes instead of
// stripping their fundamentals.
const VOICE_LOW_CUT = {
  pad: 110, strings: 110, choir: 110, organ: 110, drone: 110, supersaw: 110, juno: 110, solina: 110, synthbrass: 110,
  arpeggio: 120, harp: 120, pluck: 120, kalimba: 120, mallet: 120, clavinet: 120, rhodes: 120,
  melody: 140, flute: 140, brass: 140, sitar: 140, vibraphone: 140, monolead: 140,
  bell: 250, glass: 250, texture: 250,
};
const RUMBLE_CUT = 35;
let bassPresent = true;
let cutShift    = 0; // octave shift the low cuts are currently tuned to
const lowCutFor = name => (bassPresent ? VOICE_LOW_CUT[name] * 2 ** Math.min(0, cutShift) : RUMBLE_CUT);

// Called every tick: retunes the low cuts when the bass comes or goes, or the
// octave changes.
export function updateLowCuts(on) {
  if (on === bassPresent && state.octaveShift === cutShift) return;
  bassPresent = on;
  cutShift    = state.octaveShift;
  const now = audio.ctx.currentTime;
  for (const [name, bus] of voiceBuses) {
    if (bus.lowCut) bus.lowCut.frequency.setTargetAtTime(lowCutFor(name), now, 0.1);
  }
}

let voiceBuses = new Map();
let session    = null;

export function getVoiceBus(name) {
  let bus = voiceBuses.get(name);
  if (!bus) {
    const dry    = audio.ctx.createGain();
    const panner = audio.ctx.createStereoPanner();
    panner.pan.value = VOICE_PAN[name] ?? 0;
    let lowCut = null;
    if (VOICE_LOW_CUT[name]) {
      lowCut = audio.ctx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = lowCutFor(name);
      dry.connect(lowCut); lowCut.connect(panner);
    } else {
      dry.connect(panner);
    }
    panner.connect(audio.dry);
    // The dry bus already feeds the room at gain 1; this adds the rest. Both
    // copies are the same signal, so they add in amplitude, not energy.
    const extra = dbToGain(VOICE_DISTANCE[name] ?? 0) - 1;
    if (extra > 0) {
      const send = audio.ctx.createGain();
      send.gain.value = extra;
      panner.connect(send); send.connect(session.roomBus);
    }
    bus = { dry, lowCut };
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

  if (session) for (const sp of session.spaces) sp.disconnect();

  const dry = ctx.createGain();
  dry.connect(audio.masterGain);

  // Room bus: the whole dry mix, stereo image and all (plus the extra sends
  // of voices further back). The high-pass keeps bass and kick fundamentals
  // out of it — a room on the low end reads as boom, not space.
  const roomBus = ctx.createBiquadFilter();
  roomBus.type = 'highpass'; roomBus.frequency.value = 160;
  dry.connect(roomBus);

  // Hall bus: per-voice sends, high-passed to keep bass energy out of the
  // long tail (mud).
  const reverbSend = ctx.createGain();
  const hallBus = ctx.createBiquadFilter();
  hallBus.type = 'highpass'; hallBus.frequency.value = 180;
  reverbSend.connect(hallBus);

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
  // A little of the echo feeds the hall so repeats sit in the same space.
  const echoToVerb = ctx.createGain(); echoToVerb.gain.value = 0.25;
  echoOut.connect(echoToVerb); echoToVerb.connect(reverbSend);

  session = { roomBus, hallBus, outputs: [dry, echoOut], echo: [left, right], spaces: [] };
  session.space = makeSpace(ROOMS[state.room] ? state.room : 'room');
  session.space.open(0);
  session.spaces.push(session.space);
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

// ─── Master helpers ───────────────────────────────────────────────────────────
const SATURATION = (() => {
  const k = 1.2, c = new Float32Array(2048);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / k;
  }
  return c;
})();

// Leveller. Arrangements differ by ~4–6 dB in loudness (a sparse trio vs a
// full band), so each era change was a jump in level. Called every scheduler
// tick: it tracks the mix's mean-square level over a few seconds and eases a
// gain toward the target, within ±LEVEL_RANGE_DB so dynamics within a
// section survive. Quiet stretches (rests, fades, stop) are ignored rather
// than boosted.
const LEVEL_TARGET_DB = -24; // about the average meter level of the test arrangements
const LEVEL_RANGE_DB  = 6;
const LEVEL_TAU       = 4;   // seconds of history
const LEVEL_GATE_DB   = 20;  // below target − this, hold

export function updateLevel() {
  const lv = audio.level;
  if (!lv) return;
  const now = audio.ctx.currentTime;
  const dt  = Math.min(1, now - lv.last);
  lv.last = now;
  audio.meter.getFloatTimeDomainData(lv.data);
  let e = 0;
  for (let i = 0; i < lv.data.length; i++) e += lv.data[i] * lv.data[i];
  e /= lv.data.length;
  if (10 * Math.log10(e + 1e-12) < LEVEL_TARGET_DB - LEVEL_GATE_DB) return;
  lv.ms = lv.ms === null ? e : lv.ms + (e - lv.ms) * (1 - Math.exp(-dt / LEVEL_TAU));
  const gainDb = Math.max(-LEVEL_RANGE_DB, Math.min(LEVEL_RANGE_DB, LEVEL_TARGET_DB - 10 * Math.log10(lv.ms)));
  audio.leveler.gain.setTargetAtTime(dbToGain(gainDb), now, 1.0);
}

// ─── Making sure sound actually comes out ────────────────────────────────────
// A context that sat in a background tab can come back in a state other than
// 'suspended' (Safari reports 'interrupted'), can leave resume() pending, or
// can claim 'running' while its clock is frozen because the output device
// changed underneath it. Any of those means notes get scheduled against a
// clock that never reaches them: the UI says playing, nothing sounds.
// So: ask to resume whatever the state, check the clock really moves, and if
// it doesn't, replace the context. Resolves false if there's still no sound
// (e.g. the browser wants a fresh click), so callers don't claim to be playing.
const wait = ms => new Promise(r => setTimeout(r, ms));

async function clockRuns(ctx) {
  if (ctx.state !== 'running') {
    await Promise.race([ctx.resume().catch(() => {}), wait(500)]);
    if (ctx.state !== 'running') return false;
  }
  // A context that has only just started can take a few hundred ms to open
  // the output device before its clock moves, so poll rather than sample once.
  const t0 = ctx.currentTime;
  for (let i = 0; i < 20; i++) {
    await wait(50);
    if (ctx.currentTime > t0) return true;
  }
  return false;
}

// The scheduler records the clock on every tick, so a context that has been
// running since the last play can be confirmed instantly; only a fresh,
// suspended or frozen one waits on clockRuns().
let lastClock = null;
export function noteClock() {
  lastClock = { ctx: audio.ctx, time: audio.ctx.currentTime, wall: performance.now() };
}
function clockMovedSinceNoted() {
  const ctx = audio.ctx;
  return ctx.state === 'running' && lastClock?.ctx === ctx &&
    performance.now() - lastClock.wall > 30 && ctx.currentTime > lastClock.time;
}

export async function ensureAudioRunning() {
  if (!audio.started || audio.ctx.state === 'closed') initAudio();
  let ok = clockMovedSinceNoted() || await clockRuns(audio.ctx);
  if (!ok) {
    audio.ctx.close().catch(() => {});
    initAudio();
    ok = await clockRuns(audio.ctx);
  }
  if (ok) noteClock();
  return ok;
}

// Point every voice at a different context — an OfflineAudioContext for
// export — with a fresh master chain. Returns a function that puts the live
// context back exactly as it was.
export function useContext(ctx) {
  const saved = { fields: { ...audio }, session, voiceBuses, bassPresent };
  initAudio(ctx);
  return () => {
    Object.assign(audio, saved.fields);
    session    = saved.session;
    voiceBuses = saved.voiceBuses;
    bassPresent = saved.bassPresent;
  };
}

export function initAudio(ctx = null) {
  const AC = window.AudioContext || window.webkitAudioContext;
  audio.ctx = ctx ?? new AC();
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

  // Makeup gain into a peak limiter: the mix used to leave 5–8 dB of unused
  // headroom (quiet next to anything else playing), and the compressor's
  // 10 ms attack lets transients through, so the limiter catches them once
  // the level comes up. It isn't a brickwall — peaks land between about −3
  // and −0.6 dBFS in test renders — hence the threshold well below that.
  const makeup = audio.ctx.createGain();
  makeup.gain.value = Math.pow(10, 3 / 20);
  const limiter = audio.ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value      = 0;
  limiter.ratio.value     = 20;
  limiter.attack.value    = 0.001;
  limiter.release.value   = 0.12;

  // Leveller: slow gain riding ahead of the compressor (see updateLevel), fed
  // from a roughly K-weighted meter tap so it hears level the way LUFS does.
  const leveler = audio.ctx.createGain();
  const kHp = audio.ctx.createBiquadFilter(), kShelf = audio.ctx.createBiquadFilter();
  kHp.type = 'highpass'; kHp.frequency.value = 60;
  kShelf.type = 'highshelf'; kShelf.frequency.value = 1500; kShelf.gain.value = 4;
  const meter = audio.ctx.createAnalyser();
  meter.fftSize = 2048;
  highpass.connect(kHp); kHp.connect(kShelf); kShelf.connect(meter);
  audio.leveler = leveler;
  audio.meter   = meter;
  audio.level   = { data: new Float32Array(meter.fftSize), ms: null, last: 0 };

  // Saturation: a gentle tanh, unity gain for small signals and about −1 dB
  // at −6 dBFS, so loud moments round off instead of being clamped by the
  // limiter, and the mix gains a little harmonic density.
  const saturator = audio.ctx.createWaveShaper();
  saturator.curve = SATURATION;
  saturator.oversample = '4x';

  audio.masterGain.connect(audio.analyser);
  audio.analyser.connect(highpass);
  highpass.connect(leveler);
  leveler.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(saturator);
  saturator.connect(limiter);
  limiter.connect(audio.ctx.destination);
  audio.masterOut = limiter;
  limiter.connect(audio.scope); // what reaches the speakers; analysers need no output

  audio.reverbGain.connect(audio.analyser);

  beginSession();
  audio.started = true;
}
