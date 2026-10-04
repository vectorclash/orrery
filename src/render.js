// ─── Export renderer ──────────────────────────────────────────────────────────
// Runs in a hidden iframe, so it has its own copy of every audio module —
// context, harmony, transport, voices. Rendering an export there leaves the
// live music untouched: it keeps playing while the file renders.
import { TICK_MS, LOOKAHEAD } from './state.js';
import { audio, initAudio, rideLevel } from './audio/context.js';
import { applyPlan, startSession, tick } from './audio/scheduler.js';

const QUANTUM = 128; // frames per render quantum

// Renders `durationSec` of `plan` (see applyPlan) offline: the same scheduler
// drives an OfflineAudioContext, so the file is exactly what the engine
// produces, faster than real time and from true silence.
window.renderExport = async (plan, durationSec, sampleRate, onProgress) => {
  const stepped = typeof OfflineAudioContext.prototype.suspend === 'function';
  const ctx = new OfflineAudioContext(stepped ? 2 : 3, Math.round(durationSec * sampleRate), sampleRate);
  initAudio(ctx);
  applyPlan(plan);
  const opts = { skipBass: !plan.bassStyle, skipEvolve: true };
  startSession(LOOKAHEAD);

  // Fade to silence over the last stretch so long tails (bell, harp, pad)
  // die away instead of being chopped; no new notes start inside it.
  const fadeOutSec = Math.min(0.4, durationSec / 8);
  for (const p of [audio.masterGain.gain, audio.reverbGain.gain]) {
    p.setValueAtTime(p.value, durationSec - fadeOutSec);
    p.linearRampToValueAtTime(0, durationSec);
  }

  // The scheduler runs every TICK_MS of audio time, as the live setInterval
  // does.
  const step = TICK_MS / 1000, lastTick = durationSec - fadeOutSec;
  const times = [0];
  for (let t = step; ; t += step) { times.push(t); if (!(t + step < lastTick)) break; }

  const progress = t => onProgress(t / durationSec);
  return stepped ? renderStepped(ctx, times, opts, progress) : renderAhead(ctx, times, opts, progress);
};

// Pause the render at each tick and run the scheduler there.
function renderStepped(ctx, times, opts, onProgress) {
  const tickAt = i => ctx.suspend(times[i]).then(() => {
    tick(opts);
    onProgress(times[i]);
    if (i + 1 < times.length) tickAt(i + 1);
    ctx.resume();
  });
  tick(opts);
  tickAt(1);
  return ctx.startRendering();
}

// Firefox has no OfflineAudioContext.suspend(), so nothing can run partway
// through a render. There the scheduler runs ahead of it instead, reading a
// stand-in clock set to each tick's time, which leaves one thing unscheduled:
// the leveller, which reads the meter as the render goes (see updateLevel).
// So the render takes two passes. The meter listens before the leveller, so
// the first pass, everything up to the master chain, also captures what the
// meter hears; the leveller's moves are worked out from that, and the second
// pass runs the first's output through a fresh master chain making them.
async function renderAhead(ctx, times, opts, onProgress) {
  const sr = ctx.sampleRate;
  // Where a suspend at t would land, as Chrome places it: the frame (rounded
  // down, which absorbs float error in the summed tick times), then up to the
  // next render-quantum boundary.
  const frameAt = t => Math.ceil(Math.floor(t * sr) / QUANTUM) * QUANTUM;

  let now = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => now, configurable: true });
  for (const t of times) { now = frameAt(t) / sr; tick(opts); }
  delete ctx.currentTime;

  // Pass 1: the mix on channels 0–1 and the meter's signal on channel 2 —
  // mono, as the analyser hears it (a merger input down-mixes the same way).
  audio.masterOut.disconnect();
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(3);
  audio.analyser.connect(split);
  split.connect(merge, 0, 0); split.connect(merge, 1, 1);
  audio.meter.connect(merge, 0, 2);
  merge.connect(ctx.destination);
  const poll = setInterval(() => onProgress(ctx.currentTime), 100);
  const mix = await ctx.startRendering().finally(() => clearInterval(poll));

  // Pass 2: the mix in where masterGain and reverbGain meet, and the
  // leveller's moves from the meter readings each tick would have taken.
  const out = new OfflineAudioContext(2, mix.length, sr);
  initAudio(out);
  const src = out.createBufferSource();
  const split2 = out.createChannelSplitter(3), merge2 = out.createChannelMerger(2);
  src.buffer = mix;
  src.connect(split2);
  split2.connect(merge2, 0, 0); split2.connect(merge2, 1, 1);
  merge2.connect(audio.analyser);
  src.start(0);

  const meter = mix.getChannelData(2), reading = audio.level.data, n = reading.length;
  for (const t of times) {
    const end = frameAt(t);
    for (let i = 0; i < n; i++) reading[i] = meter[end - n + i] ?? 0; // silence before the start
    rideLevel(end / sr);
  }
  return out.startRendering();
}
