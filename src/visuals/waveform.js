import { music } from './music.js';
import { audio } from '../audio/context.js';

// ─── The live waveform, as a stable loop ──────────────────────────────────────
// Each frame, one slice of what reaches the speakers, resampled to COLS
// columns and normalised. Used by the Scope ring (wrapped round the planet)
// and the chord strings (stretched between chord tones).
//
// The slice is phase-locked to the lowest sounding note — its pitch is known
// exactly from the note log — and spans a whole number of its periods, so a
// held bass note draws a standing pattern that loops seamlessly; everything
// above it moves through that pattern. The remaining seam (from notes that
// don't divide the slice evenly) is crossfaded.

export const COLS = 512;
const TARGET = 1100;   // preferred slice length, samples
const FADE = 0.15;     // fraction of the slice crossfaded

export const waveform = {
  shown: new Float32Array(COLS), // gain-normalised, smoothed in angle and time (≈ ±1)
  live:  false,
};

const slice = new Float32Array(COLS), tmp = new Float32Array(COLS);
let gain = 4;

export function updateWaveform() {
  waveform.live = readSlice();
  if (!waveform.live) waveform.shown.fill(0);
}

// Fills `slice` with one loop of the waveform; returns false if there's no audio.
function readSlice() {
  if (!audio.started || !audio.scope) return false;
  const x = audio.scopeData, N = x.length, sr = audio.ctx.sampleRate;
  audio.scope.getFloatTimeDomainData(x);

  // Period of the lowest sounding note, if any.
  let low = -1;
  for (let m = 0; m < 128; m++) if (music.noteLevel[m] > 0.04) { low = m; break; }
  const P = low < 0 ? 0 : sr / (440 * Math.pow(2, (low - 69) / 12));
  const L = P > 0 ? Math.max(1, Math.round(TARGET / P)) * P : TARGET;
  const L1 = Math.min(L, (N - (P || 0)) / (1 + FADE) - 2);

  // Start the slice at a rising zero crossing of that note's fundamental:
  // measure its phase near the newest samples with a single-bin DFT, then
  // step back to the matching point within one period of N − L.
  let s = N - L1 - 1;
  if (P > 0) {
    let c = 0, q = 0;
    const w = (2 * Math.PI) / P, n0 = N - Math.floor(Math.min(N, 3 * P));
    for (let i = n0; i < N; i++) { c += x[i] * Math.cos(w * i); q += x[i] * Math.sin(w * i); }
    const phi = Math.atan2(q, c);            // fundamental ≈ cos(w·i − phi)
    let z = (phi - Math.PI / 2) / w;         // a sample where w·i − phi = −π/2
    z -= Math.ceil((z - (N - L1 - 1)) / P) * P;
    s = Math.max(FADE * L1 + 1, z);
  }

  // Box-average into columns, crossfading the tail into the samples one loop
  // earlier so the last column meets the first.
  let sumSq = 0;
  const step = L1 / COLS;
  for (let c = 0; c < COLS; c++) {
    const a = s + c * step, b = a + step;
    let sum = 0, n = 0;
    for (let i = Math.floor(a); i < b; i++, n++) sum += x[i];
    let v = n ? sum / n : x[Math.floor(a)];
    const f = (c / COLS - (1 - FADE)) / FADE;
    if (f > 0) {
      let e = 0, m = 0;
      for (let i = Math.floor(a - L1); i < b - L1; i++, m++) e += x[Math.max(0, i)];
      v = v * (1 - f) + (m ? e / m : v) * f;
    }
    slice[c] = v;
    sumSq += v * v;
  }

  // Slow automatic gain, so quiet passages still read but loud ones don't clip.
  const rms = Math.sqrt(sumSq / COLS);
  const want = Math.min(8, 0.3 / Math.max(rms, 0.01));
  gain += (want - gain) * (want < gain ? 0.08 : 0.01);
  // Two passes of a circular 7-column box: what's left is the waveform's
  // shape (fundamentals and low partials), not hiss. Then ease toward it, so
  // consecutive frames agree where the sound is steady.
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? tmp : slice, dst = pass ? slice : tmp;
    for (let c = 0; c < COLS; c++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += src[(c + k + COLS) % COLS];
      dst[c] = sum / 7;
    }
  }
  const shown = waveform.shown;
  for (let c = 0; c < COLS; c++) shown[c] += (slice[c] * gain - shown[c]) * 0.5;
  return true;
}
