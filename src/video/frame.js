// ─── A video stage's iframe ───────────────────────────────────────────────────
// A fresh page for each stage (see stage.js): its own copy of the audio engine
// and the visuals, with three and the encoder from this page's importmap. The
// studio shows it as its screen (studio.js).
//
// Math.random is seeded first, before any module draws from it (the stars,
// the nebulae, the dust...), so a song's video is the same each time: the
// same link makes the same video.

const STAGE_URL = 'src/video/stage.js';

// What a video needs of the browser: an H.264 encoder (WebCodecs), and an
// offline render that can stop at each tick (Firefox's can't).
export const videoSupported = () =>
  typeof VideoEncoder === 'function' && typeof OfflineAudioContext === 'function'
  && typeof OfflineAudioContext.prototype.suspend === 'function';

// A 32-bit seed for a plan's video: its song's, or one from the loop's settings.
export function videoSeed(plan) {
  if (plan.song) return plan.song.seed >>> 0;
  let h = 2166136261;
  for (const c of JSON.stringify(plan)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// `parent`: where the iframe goes (it's shown: it's the studio's screen).
export function openStage(seed, parent = document.body) {
  const frame = document.createElement('iframe');
  frame.tabIndex = -1;
  const map = document.querySelector('script[type="importmap"]')?.textContent ?? '{"imports":{}}';
  frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Courier Prime'; src: url('fonts/courier-prime-400.woff2') format('woff2'); font-weight: 400; }
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
</style>
<script type="importmap">${map}</script>
<script>(() => {
  let a = ${seed >>> 0};
  Math.random = () => { // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();</script>
</head><body><div id="three-container"></div>
<script type="module" src="${STAGE_URL}"></script>
</body></html>`;
  const ready = new Promise((resolve, reject) => {
    frame.onload = () => frame.contentWindow.stage ? resolve(frame.contentWindow.stage) : reject(new Error('The video stage failed to load (see the console)'));
    frame.onerror = reject;
  });
  parent.appendChild(frame);
  return { frame, ready };
}
