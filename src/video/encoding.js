// ─── How a video is encoded ───────────────────────────────────────────────────
// Shared by the studio (its size estimate, studio.js) and the stage that
// encodes (stage.js).

// The video bitrate for a size and frame rate: bits per pixel per frame.
// Orrery's pictures are as hard as video gets to compress: fine lines and
// thousands of points over the whole frame, all of it moving, and the
// kaleidoscope's copies of it. Measured on real 4K frames (2026-11-10, in
// Safari and Chrome, H.264 High, PSNR against the lossless frames): 0.2 bits
// per pixel, where this once was and about what YouTube recommends uploading,
// gave 30 dB, visibly smeared; 0.4 gave 33 dB; 0.6 gave 35 dB, close to the
// original. YouTube re-encodes whatever it's given, so the cleaner the upload
// the better its copy. At 60 fps each frame is less different from the last,
// and needs fewer bits.
export const videoBitrate = (w, h, fps) => Math.round(w * h * fps * (fps > 30 ? 0.42 : 0.6));

// H.264 High profile at the lowest level that allows the size, frame rate and
// bitrate. Mediabunny would choose the same in Chrome, but in Safari it asks
// for Constrained Baseline, which is markedly worse for the same bits: an
// old WebKit fault where the software H.264 encoder stalls on Main and High
// (fixed in WebKit 2026-09). Safari 27.2 encodes High at every size the
// studio makes; should an encoder ever stall, the stage stops with an error
// rather than waiting forever (STALL_MS in stage.js).
// Levels: [level_idc, macroblocks a second, macroblocks a frame, kbit/s for High].
const LEVELS = [
  [0x28, 245_760, 8_192, 25_000],    // 4.0
  [0x2a, 522_240, 8_704, 62_500],    // 4.2
  [0x32, 589_824, 22_080, 168_750],  // 5.0
  [0x33, 983_040, 36_864, 300_000],  // 5.1
  [0x34, 2_073_600, 36_864, 300_000], // 5.2
];
export function avcHigh(w, h, fps, bitrate) {
  const frame = Math.ceil(w / 16) * Math.ceil(h / 16);
  const level = LEVELS.find(([, perSecond, perFrame, kbps]) =>
    frame <= perFrame && frame * fps <= perSecond && bitrate / 1000 <= kbps) ?? LEVELS.at(-1);
  return `avc1.6400${level[0].toString(16)}`;
}
