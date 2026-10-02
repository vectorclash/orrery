// ─── Export renderer ──────────────────────────────────────────────────────────
// Runs in a hidden iframe, so it has its own copy of every audio module —
// context, harmony, transport, voices. Rendering an export there leaves the
// live music untouched: it keeps playing while the file renders.
import { TICK_MS, LOOKAHEAD } from './state.js';
import { audio, initAudio } from './audio/context.js';
import { applyPlan, startSession, tick } from './audio/scheduler.js';

// Renders `durationSec` of `plan` (see applyPlan) offline: the same scheduler
// drives an OfflineAudioContext, so the file is exactly what the engine
// produces, faster than real time and from true silence.
window.renderExport = async (plan, durationSec, sampleRate, onProgress) => {
  const ctx = new OfflineAudioContext(2, Math.round(durationSec * sampleRate), sampleRate);
  initAudio(ctx);
  applyPlan(plan);
  const skipBass = !plan.bassStyle;
  startSession(LOOKAHEAD);

  // Fade to silence over the last stretch so long tails (bell, harp, pad)
  // die away instead of being chopped; no new notes start inside it.
  const fadeOutSec = Math.min(0.4, durationSec / 8);
  for (const p of [audio.masterGain.gain, audio.reverbGain.gain]) {
    p.setValueAtTime(p.value, durationSec - fadeOutSec);
    p.linearRampToValueAtTime(0, durationSec);
  }

  // Pause the render every TICK_MS of audio time and run the scheduler, as
  // the live setInterval does.
  const step = TICK_MS / 1000, lastTick = durationSec - fadeOutSec;
  const tickAt = t => ctx.suspend(t).then(() => {
    tick({ skipBass, skipEvolve: true });
    onProgress(t / durationSec);
    if (t + step < lastTick) tickAt(t + step);
    ctx.resume();
  });
  tick({ skipBass, skipEvolve: true });
  tickAt(step);
  return ctx.startRendering();
};
