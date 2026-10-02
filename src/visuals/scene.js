import * as THREE from 'three';

// ─── Three.js scene setup ─────────────────────────────────────────────────────

export const scene    = new THREE.Scene();
export const camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
export const renderer = new THREE.WebGLRenderer({ antialias: true });
export const clock    = new THREE.Timer();

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0a0a0f);
document.getElementById('three-container').appendChild(renderer.domElement);

// Sync viewport to actual drawing buffer so it never exceeds the framebuffer size
{
  const gl = renderer.getContext();
  const w  = gl.drawingBufferWidth  / renderer.getPixelRatio();
  const h  = gl.drawingBufferHeight / renderer.getPixelRatio();
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
}

scene.fog = new THREE.FogExp2(0x0a0a0f, 0.022);

camera.position.set(0, 1.5, 7);
camera.lookAt(0, 0, 0);

// ─── Resize — debounced, handles orientation change ───────────────────────────
export const resizeHandlers = []; // e.g. post-processing targets
let resizeTimer;
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const gl = renderer.getContext();
  const w  = gl.drawingBufferWidth  / renderer.getPixelRatio();
  const h  = gl.drawingBufferHeight / renderer.getPixelRatio();
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  for (const fn of resizeHandlers) fn();
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 150);
});
// orientationchange fires before the browser reports new dimensions
window.addEventListener('orientationchange', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 300);
});
