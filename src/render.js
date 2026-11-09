// ─── Export renderer ──────────────────────────────────────────────────────────
// Runs in a hidden iframe, so it has its own copy of every audio module —
// context, harmony, transport, voices. Rendering an export there leaves the
// live music untouched: it keeps playing while the file renders.
import { TICK_MS, LOOKAHEAD } from './state.js';
import { audio, initAudio, rideLevel, presetLevel } from './audio/context.js';
import { applyPlan, startSession, tick, songFor } from './audio/scheduler.js';
import { readLog } from './audio/notes.js';
import { harmony } from './audio/harmony.js';
import { transport } from './audio/transport.js';
import { state } from './state.js';
import { hookSection, transcribe } from './audio/transcribe.js';
import { planFromShare } from './share.js';

const QUANTUM = 128; // frames per render quantum

// Renders `durationSec` of `plan` (see applyPlan) offline: the same scheduler
// drives an OfflineAudioContext, so the file is exactly what the engine
// produces, faster than real time and from true silence.
// A song can start partway, at beat `plan.song.from` (see songPlanFor): from
// the top of the section that beat falls in -- each section is seeded on its
// own, so it plays as it does in the whole song -- with the bars before
// `from` cut off, so `from` falls where beat 0 otherwise does.
window.renderExport = async (plan, durationSec, sampleRate, onProgress) =>
  (await renderTake(plan, durationSec, sampleRate, onProgress)).buffer;

// renderExport's take, and with `capture` ({ stepRate }) what the visuals hear
// as it plays, for a music video of it (see video/stage.js): `steps`, one every
// 1/stepRate s of the render from the take's start, each the chord, key and
// beat the scheduler had set when that moment was heard (as the live
// visuals read them, between ticks); `events`, the note log as each tick
// wrote it (`at`, the tick's time); and the render whole, before the cut --
// `left`, `right` and `mix`, the mix in front of the master chain (mono, as
// the spectrum analyser hears it). Times are the render's; the take starts
// `cut` seconds into it.
export async function renderTake(plan, durationSec, sampleRate, onProgress, capture = null) {
  const from = plan.song?.from ?? 0;
  const sec = from ? songFor(plan).sections.findLast(s => s.start <= from + 1e-9) : null;
  const cut = sec ? (from - sec.start) * 60 / plan.state.tempo : 0;
  const heard = capture && { cut, stepRate: capture.stepRate, steps: [], events: [] };
  const rendered = await render(plan, durationSec + cut, sampleRate, sec?.start ?? 0, onProgress, heard);
  const channels = Math.min(2, rendered.numberOfChannels);
  if (heard) Object.assign(heard, { left: rendered.getChannelData(0), right: rendered.getChannelData(1), mix: rendered.getChannelData(2) });
  if (!cut && channels === rendered.numberOfChannels) return { buffer: rendered, heard };
  const skip = Math.round(cut * sampleRate), length = Math.round(durationSec * sampleRate);
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  for (let c = 0; c < channels; c++) {
    out.copyToChannel(rendered.getChannelData(c).subarray(skip, skip + length), c);
  }
  return { buffer: out, heard };
}

// The plan for a take of a song `durationSec` long whose first hook -- the
// first drop, chorus or swell at or after `hookAtSec` -- lands `hookAtSec`
// into it, rather than one that opens on the intro: for pages that cut a song
// to their own timeline (Chromaforge's ads drop on the first product). It
// starts in the bars before the hook (song.from), and a song whose last chord
// would come before the take ends is made longer: the same song at a longer
// LENGTH, so the take never runs into the silence after it.
window.songPlanFor = (plan, durationSec, hookAtSec = 0) => {
  const spb = 60 / plan.state.tempo, lead = Math.round(hookAtSec / spb);
  let p = plan;
  for (let i = 0; i < 8; i++) {
    const s = songFor(p);
    const hooks = s.sections.filter(x => x.hook && x.energy[0] >= 0.6); // as levelOfSong's
    const hook = hooks.find(x => x.start >= lead) ?? hooks[0];
    const from = Math.max(0, (hook?.start ?? 0) - lead);
    const short = durationSec - (s.end - from) * spb;
    p = { ...p, song: { ...p.song, from } };
    if (short <= 0 || i === 7) break;
    p.song.length = Math.ceil(s.seconds + short);
  }
  return p;
};

async function render(plan, durationSec, sampleRate, fromBeat, onProgress, heard) {
  const stepped = typeof OfflineAudioContext.prototype.suspend === 'function';
  if (heard && !stepped) throw new Error('A video needs OfflineAudioContext.suspend');
  const ctx = new OfflineAudioContext(stepped && !heard ? 2 : 3, Math.round(durationSec * sampleRate), sampleRate);
  initAudio(ctx);
  applyPlan(plan);
  const opts = { skipBass: !plan.bassStyle, skipEvolve: true, levelMs: plan.song?.levelMs };
  const hear = heard && listener(heard, durationSec); // before the session starts: it logs that it has
  startSession(LOOKAHEAD, fromBeat);
  if (opts.levelMs) presetLevel(opts.levelMs);
  if (heard) {
    // The finished mix on channels 0–1, and the spectrum analyser's input on 2.
    audio.masterOut.disconnect();
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(3);
    audio.masterOut.connect(split);
    split.connect(merge, 0, 0); split.connect(merge, 1, 1);
    audio.mix.connect(merge, 0, 2);
    merge.connect(ctx.destination);
  }

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
  return stepped ? renderStepped(ctx, times, opts, progress, hear) : renderAhead(ctx, times, opts, progress);
}

// What the visuals would hear, written down after each tick at time `t` (the
// next is at `next`): the notes it logged, and for each visual step until the
// next tick, the chord, key and beat then -- what the scheduler has set at
// this tick is what the live visuals read until the next one.
function listener(heard, durationSec) {
  const { steps, events, cut, stepRate } = heard;
  let since = readLog(Infinity, () => {}), k = 0;
  return (t, next) => {
    since = readLog(since, e => events.push({ ...e, at: t }));
    for (let at; (at = cut + k / stepRate) < next && at < durationSec; k++) {
      const beat = transport.beatAt(at);
      steps.push({ beat, chord: harmony.chordPcs(beat), rootMidi: state.rootMidi, era: state.era, scaleIdx: state.scaleIdx, tempo: state.tempo });
    }
  };
}

// ─── A song's level ───────────────────────────────────────────────────────────
// What a song's first hook section (its first chorus, drop or swell) reads on
// the leveller's meter, as a mean square: the level the leveller settles at
// there, and so the one an export of the song should start at (renderExport
// takes it as plan.song.levelMs). Otherwise the leveller only finds it at the
// first chorus, and everything before plays at whatever gain it had.
// Each section of a song is seeded on its own, so the hook rendered alone is
// the hook as it plays in the song. The meter listens before the leveller, so
// its gain doesn't matter. The ticks run ahead of the render, as Firefox's
// exports do, so it works in every browser. Null for a song with no hook.
window.levelOfSong = async (plan, sampleRate) => {
  const hook = songFor(plan).sections.find(x => x.hook && x.energy[0] >= 0.6);
  if (!hook) return null;
  const durationSec = LOOKAHEAD + hook.beats * 60 / plan.state.tempo;
  const ctx = new OfflineAudioContext(1, Math.round(durationSec * sampleRate), sampleRate);
  initAudio(ctx);
  applyPlan(plan);
  startSession(LOOKAHEAD, hook.start);
  const opts = { skipBass: !plan.bassStyle, skipEvolve: true };
  let now = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => now, configurable: true });
  for (let t = 0; t < durationSec; t += TICK_MS / 1000) { now = t; tick(opts); }
  delete ctx.currentTime;

  // Only the meter's signal, mono, as the analyser hears it.
  audio.masterOut.disconnect();
  audio.meter.connect(ctx.destination);
  const d = (await ctx.startRendering()).getChannelData(0);
  let e = 0;
  const from = Math.round(LOOKAHEAD * sampleRate);
  for (let i = from; i < d.length; i++) e += d[i] * d[i];
  return e / Math.max(1, d.length - from);
};

// A song's hook, as notes (see transcribe.js): its first hook section played against a
// stand-in clock, nothing rendered, and what its voices do written down. Each section is
// seeded on its own, so that's what it plays in the song. Null for a song with no hook.
window.transcribeHook = plan => {
  const sec = hookSection(songFor(plan));
  if (!sec) return null;
  const ctx = new OfflineAudioContext(1, 128, 44100);
  initAudio(ctx);
  applyPlan(plan);
  let now = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => now, configurable: true });
  startSession(LOOKAHEAD, sec.start);
  const spb = 60 / plan.state.tempo, log = [];
  let since = readLog(Infinity, () => {});
  const opts = { skipBass: true, skipEvolve: true };
  for (let t = 0; t < LOOKAHEAD + sec.beats * spb; t += TICK_MS / 1000) {
    now = t;
    tick(opts);
    since = readLog(since, e => {
      if (e.kind === 'note') log.push({ voice: e.voice, beat: sec.start + (e.t - LOOKAHEAD) / spb, midi: e.midi, dur: e.dur / spb });
    });
  }
  return transcribe(plan, sec, log);
};

// A share link (or its `#c=…` hash) as the plan renderExport takes, or null if
// it isn't one. For pages embedding this renderer, which have no copy of the
// link format: Chromaforge's ad builder.
window.planFromShare = planFromShare;
// Where beat 0 falls in a rendered file (startSession(LOOKAHEAD) above), so an
// embedding page can line its own cuts up with the bars.
window.exportBeatZero = LOOKAHEAD;

// Pause the render at each tick and run the scheduler there. `heard`, if
// given, hears each tick (see listener).
function renderStepped(ctx, times, opts, onProgress, heard) {
  const tickAt = i => ctx.suspend(times[i]).then(() => {
    tick(opts);
    heard?.(times[i], times[i + 1] ?? Infinity);
    onProgress(times[i]);
    if (i + 1 < times.length) tickAt(i + 1);
    ctx.resume();
  });
  tick(opts);
  heard?.(0, times[1] ?? Infinity);
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
  audio.mix.connect(split);
  split.connect(merge, 0, 0); split.connect(merge, 1, 1);
  audio.meter.connect(merge, 0, 2);
  merge.connect(ctx.destination);
  const poll = setInterval(() => onProgress(ctx.currentTime), 100);
  const mix = await ctx.startRendering().finally(() => clearInterval(poll));

  // Pass 2: the mix in where masterGain and reverbGain meet, and the
  // leveller's moves from the meter readings each tick would have taken.
  const out = new OfflineAudioContext(2, mix.length, sr);
  const { holdsAt } = audio.level; // where a song's leveller holds still (see rideLevel)
  initAudio(out);
  audio.level.holdsAt = holdsAt;
  if (opts.levelMs) presetLevel(opts.levelMs);
  const src = out.createBufferSource();
  const split2 = out.createChannelSplitter(3), merge2 = out.createChannelMerger(2);
  src.buffer = mix;
  src.connect(split2);
  split2.connect(merge2, 0, 0); split2.connect(merge2, 1, 1);
  merge2.connect(audio.mix);
  src.start(0);

  const meter = mix.getChannelData(2), reading = audio.level.data, n = reading.length;
  for (const t of times) {
    const end = frameAt(t);
    for (let i = 0; i < n; i++) reading[i] = meter[end - n + i] ?? 0; // silence before the start
    rideLevel(end / sr);
  }
  return out.startRendering();
}
