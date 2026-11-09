// ─── Analysers over a rendered take ───────────────────────────────────────────
// A video's visuals are drawn after its audio has rendered (see stage.js),
// so the two analysers the visuals read -- the spectrum and the waveform scope
// (audio/context.js) -- are stood in for by these, reading the rendered signal
// at the frame's time: what a live AnalyserNode holds at that moment. The
// spectrum is the Web Audio spec's: Blackman window, FFT, magnitude over N,
// smoothed over time, in dB, scaled to bytes between minDecibels and
// maxDecibels. The live one smooths once per frame at 60 fps; these smooth by
// the frame's length, so other frame rates smooth alike.

// `signal`: the samples the node hears; `clock()`: the time it's read at, s.
export function standInAnalyser(signal, sampleRate, fftSize, clock) {
  const N = fftSize, bins = N / 2;
  const window = Float32Array.from({ length: N }, (_, n) =>
    0.42 - 0.5 * Math.cos(2 * Math.PI * n / N) + 0.08 * Math.cos(4 * Math.PI * n / N));
  const re = new Float64Array(N), im = new Float64Array(N);
  const smoothed = new Float64Array(bins);
  const fft = fftOf(N);
  let lastRead = null;

  const node = {
    fftSize: N,
    frequencyBinCount: bins,
    smoothingTimeConstant: 0.8,
    minDecibels: -100,
    maxDecibels: -30,
    // The newest N samples at the clock's time; silence before the start.
    getFloatTimeDomainData(out) {
      const end = Math.round(clock() * sampleRate);
      for (let n = 0; n < out.length; n++) out[n] = signal[end - out.length + n] ?? 0;
    },
    getByteFrequencyData(out) {
      const now = clock();
      const end = Math.round(now * sampleRate);
      for (let n = 0; n < N; n++) { re[n] = (signal[end - N + n] ?? 0) * window[n]; im[n] = 0; }
      fft(re, im);
      // A 60 fps frame smooths by τ; one of length dt by τ^(60·dt).
      const dt = lastRead === null ? 1 / 60 : Math.max(0, now - lastRead);
      lastRead = now;
      const tau = Math.pow(node.smoothingTimeConstant, dt * 60);
      const scale = 255 / (node.maxDecibels - node.minDecibels);
      for (let k = 0; k < Math.min(bins, out.length); k++) {
        const mag = Math.hypot(re[k], im[k]) / N;
        smoothed[k] = tau * smoothed[k] + (1 - tau) * mag;
        if (!Number.isFinite(smoothed[k])) smoothed[k] = 0;
        const db = 20 * Math.log10(smoothed[k]);
        out[k] = Math.max(0, Math.min(255, Math.floor(scale * (db - node.minDecibels))));
      }
    },
  };
  return node;
}

// An in-place radix-2 FFT of length N (a power of two).
function fftOf(N) {
  const bits = Math.log2(N);
  const rev = Uint32Array.from({ length: N }, (_, i) => {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    return r;
  });
  const cos = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / N));
  const sin = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / N));
  return (re, im) => {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step], s = sin[k * step];
          const a = i + k, b = a + half;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}
