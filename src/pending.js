import { audio, heardTime } from './audio/context.js';
import { transport } from './audio/transport.js';

// ─── Waiting for a change to be heard ─────────────────────────────────────────
// NEXT and the RANDOM buttons change the music on the grid -- the next bar
// line, or the next beat -- and over Bluetooth or AirPlay the speakers are
// further behind again, so a click can go seconds without a sound changing.
// The button answers at once instead: it lights up the moment it's pressed,
// a bar along its bottom edge fills until the change reaches the speakers,
// and then it fades back. A change that's heard at once still flashes.
// NEXT does the same, unpressed, while an era that has run its time waits
// for its chord change.
//
// One change waits at a time: a press on another button takes over, as its
// change replaces this one's.

let btn = null;
let from = 0;    // heard time when the wait began
let beat = 0;    // beat position at which the change is heard
let frame = 0;

// Shows `el`'s change as landing at beat position `at`, or straight away
// when `at` is null (nothing is playing).
export function showPending(el, at = null) {
  if (at === null || !audio.started) { flash(el); return; }
  // Pressed again before the same change lands: the bar carries on filling.
  if (el !== btn || Math.abs(at - beat) > 1e-6) {
    clearPending();
    btn  = el;
    from = heardTime();
    beat = at;
    btn.style.setProperty('--progress', 0);
    btn.classList.add('pending');
  }
  frame ||= requestAnimationFrame(update);
}

// Called when playback stops: the change will never be heard.
export function clearPending() {
  cancelAnimationFrame(frame);
  frame = 0;
  if (!btn) return;
  btn.classList.remove('pending');
  btn.style.removeProperty('--progress');
  btn = null;
}

function update() {
  frame = 0;
  // Read each frame, so a tempo change on the way stretches the wait with it.
  const to = transport.timeAt(beat), now = heardTime();
  if (now >= to) {
    const el = btn;
    clearPending();
    flash(el);
    return;
  }
  btn.style.setProperty('--progress', Math.max(0, (now - from) / (to - from)));
  frame = requestAnimationFrame(update);
}

// Lights `el` up and lets it fade back, from the start again if it's already
// fading.
function flash(el) {
  el.classList.remove('landed');
  void el.offsetWidth; // restart the animation
  el.classList.add('landed');
  el.addEventListener('animationend', () => el.classList.remove('landed'), { once: true });
}
