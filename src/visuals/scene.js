import * as THREE from 'three';

// ─── Three.js scene setup ─────────────────────────────────────────────────────

export const scene    = new THREE.Scene();
export const camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
export const renderer = new THREE.WebGLRenderer({ antialias: true });
export const clock    = new THREE.Timer();

renderer.setClearColor(0x0a0a0f);
document.getElementById('three-container').appendChild(renderer.domElement);

scene.fog = new THREE.FogExp2(0x0a0a0f, 0.022);

camera.position.set(0, 1.5, 7);
camera.lookAt(0, 0, 0);

export const resizeHandlers = []; // e.g. post-processing targets

// The view is `width` × `height` (CSS pixels) at `ratio` device pixels each.
// `fit`: the canvas keeps no size of its own (a video's frames are drawn at
// their own size and the page only shows them scaled; see video/stage.js).
export function setRenderSize(width, height, ratio, { fit = false } = {}) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, !fit);
  // Sync viewport to actual drawing buffer so it never exceeds the framebuffer size
  const gl = renderer.getContext();
  const w  = gl.drawingBufferWidth  / renderer.getPixelRatio();
  const h  = gl.drawingBufferHeight / renderer.getPixelRatio();
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  for (const fn of resizeHandlers) fn();
}

const fitWindow = () => setRenderSize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 2));
fitWindow();

// ─── Resize — debounced, handles orientation change ───────────────────────────
// The live view follows the window; a video keeps its own size (see
// keepRenderSize).
let following = true;
export function keepRenderSize() { following = false; }
let resizeTimer;
function onResize() { if (following) fitWindow(); }
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 150);
});
// orientationchange fires before the browser reports new dimensions
window.addEventListener('orientationchange', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 300);
});
