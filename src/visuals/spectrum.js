import { audio } from '../audio/context.js';

// ─── Spectrum in log-spaced bands, 90 Hz – 11 kHz ─────────────────────────────
// Read once per frame; the cages shimmer with it.

export const BANDS = 16;
export const spectrum = new Float32Array(BANDS); // 0…1 per band, with a noise floor removed

export function updateSpectrum(freqData) {
  spectrum.fill(0);
  if (!audio.analyser) return;
  const binHz = audio.ctx.sampleRate / audio.analyser.fftSize;
  for (let i = 0; i < BANDS; i++) {
    const lo = Math.floor(90 * Math.pow(11000 / 90, i / BANDS) / binHz);
    const hi = Math.max(lo + 1, Math.floor(90 * Math.pow(11000 / 90, (i + 1) / BANDS) / binHz));
    let m = 0;
    for (let b = lo; b < hi && b < freqData.length; b++) m = Math.max(m, freqData[b]);
    const v = Math.max(0, (m / 255 - 0.3) / 0.7);
    spectrum[i] = v * Math.sqrt(v);
  }
}
