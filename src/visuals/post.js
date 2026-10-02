import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { scene, camera, renderer, resizeHandlers } from './scene.js';
import { music } from './music.js';

// ─── Post-processing: bloom ───────────────────────────────────────────────────
// Bloom is a layer added on top of the finished frame; the frame itself is
// rendered to the screen exactly as without it. The scene is tens of thousands
// of additive particles tuned for the screen, which blends in display (sRGB)
// space and clips at white. Rendering it through a linear offscreen target
// instead (the usual EffectComposer route) changes how the dust sums and lets
// dense patches pile up far past white, which bloom then smears everywhere.
//
// So each frame: render the scene to the screen, copy the screen into an 8-bit
// target, let the bloom pass pick out what's brighter than the threshold (in
// the same display brightness you see), blur it and add it back, and copy the
// result to the screen. Every step after the scene passes raw values — no
// colour-space conversion — so the only difference bloom makes is the glow.
//
// The kick swells the bloom a little, so the light breathes with the beat.
// B toggles it.

const STRENGTH = 0.25, RADIUS = 0.3, THRESHOLD = 0.82;

const size = new THREE.Vector2();
const frame = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), STRENGTH, RADIUS, THRESHOLD);
const copy = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
  vertexShader: CopyShader.vertexShader,
  fragmentShader: CopyShader.fragmentShader,
  depthTest: false,
  depthWrite: false,
}));
copy.material.uniforms.tDiffuse.value = frame.texture;

function resize() {
  renderer.getDrawingBufferSize(size);
  frame.setSize(size.x, size.y);
  bloom.setSize(size.x, size.y);
  renderer.initRenderTarget(frame); // the screen is copied straight into its texture
}
resize();
resizeHandlers.push(resize);

export const post = { bloom: true };

export function render(dt) {
  renderer.render(scene, camera);
  if (!post.bloom) return;

  bloom.strength = STRENGTH * (1 + 0.35 * music.hits.kick + 0.2 * music.hits.crash);
  renderer.copyFramebufferToTexture(frame.texture);
  bloom.render(renderer, null, frame, dt, false); // adds the glow into `frame`
  renderer.setRenderTarget(null);
  copy.render(renderer);
}
