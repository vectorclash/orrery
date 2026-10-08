import { TICK_MS } from '../state.js';

// ─── Ticks ────────────────────────────────────────────────────────────────────
// The scheduler looks only LOOKAHEAD (120 ms) ahead, so it needs a tick every
// TICK_MS. The page's own timers can't promise that: once the window is
// minimized or the tab hidden, browsers hold them to once a second or slower,
// and the music thins to a note per tick. A worker's timers aren't held back
// (Tone.js drives its clock the same way), and its messages reach a hidden
// page on time. If no worker can be made, the page's own timer stands in.
const WORKER = `let id;
onmessage = e => { clearInterval(id); if (e.data) id = setInterval(() => postMessage(0), e.data); };`;

const ticking = new Set();
let worker;          // undefined until first needed, null if unavailable
let timer = null;    // the fallback

function run() { for (const fn of ticking) fn(); }

function sync() {
  if (worker === undefined) {
    try {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
      worker.onmessage = run;
      worker.onerror   = () => { worker = null; sync(); };
    } catch {
      worker = null;
    }
  }
  const ms = ticking.size ? TICK_MS : 0;
  if (worker) { worker.postMessage(ms); return; }
  clearInterval(timer);
  timer = ms ? setInterval(run, ms) : null;
}

// Calls `fn` every TICK_MS until the returned function is called.
export function everyTick(fn) {
  ticking.add(fn);
  sync();
  return () => { ticking.delete(fn); sync(); };
}
