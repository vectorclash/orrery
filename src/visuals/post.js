import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { scene, camera, renderer, resizeHandlers } from './scene.js';
import { music, pcAngle } from './music.js';

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
//
// The kaleidoscope (its button, or K) folds the finished frame (glow and all)
// into mirrored wedges around the screen's centre, where the orrery's centre
// sits: six to begin with, then three to six, a different number each time a
// new song or era is heard, the one pattern dissolving into the next. The pattern turns slowly one way while the slice of
// the frame it mirrors sweeps the other, so different stars and clouds pass
// through it. Beyond the frame's edges the picture mirrors back on itself, so
// there are no seams.
//
// It follows the music, one part each: the kick punches the pattern outward,
// the snare gives it a twist, the bass line ripples it outward from the centre
// like a struck drumhead, and each new chord glides the mirrored slice to its
// root's place on the circle of fifths (as the pitch ring lays pitches out),
// so a change of chord shows a different patch of sky.

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

const TURN = 0.05, SWEEP = -0.12; // radians a second
const PUNCH = 0.1, TWIST = 1.2, RIPPLE = 0.03, GLIDE = 0.5, DISSOLVE = 1.5; // seconds
const kaleido = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: frame.texture },
    aspect:   { value: 1 },
    angle:    { value: 0 },
    sweep:    { value: 0 },
    zoom:     { value: 1 },
    ripple:   { value: 0 },
    phase:    { value: 0 },
    wedgesWas: { value: 6 }, // segments before the last change
    wedges:    { value: 6 },
    dissolve:  { value: 1 }, // 0…1 from the old count to the new
  },
  vertexShader: CopyShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float aspect, angle, sweep, zoom, ripple, phase, wedgesWas, wedges, dissolve;
    varying vec2 vUv;
    vec4 fold(vec2 p, float r, float n) {
      float wedge = 6.28318531 / n;
      float a = mod(atan(p.y, p.x) + angle, wedge);
      a = min(a, wedge - a) + sweep; // every other half-wedge mirrored
      vec2 q = r * vec2(cos(a), sin(a)) / vec2(aspect, 1.0) + 0.5;
      q = 1.0 - abs(1.0 - mod(q, 2.0)); // mirror-repeat past the edges
      return texture2D(tDiffuse, q);
    }
    void main() {
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float r = length(p);
      r *= zoom * (1.0 + ripple * sin(r * 40.0 - phase));
      vec4 c = fold(p, r, wedges);
      if (dissolve < 1.0) c = mix(fold(p, r, wedgesWas), c, smoothstep(0.0, 1.0, dissolve));
      gl_FragColor = c;
    }`,
  depthTest: false,
  depthWrite: false,
}));

function resize() {
  renderer.getDrawingBufferSize(size);
  frame.setSize(size.x, size.y);
  bloom.setSize(size.x, size.y);
  kaleido.material.uniforms.aspect.value = size.x / size.y;
  renderer.initRenderTarget(frame); // the screen is copied straight into its texture
}
resize();
resizeHandlers.push(resize);

export const post = { bloom: true, kaleido: false };

let drift = 0, root = 0; // the mirrored slice: its steady sweep, and the chord's offset
let changes = 0;          // music.changes as last seen
const turnTo = (from, to) => ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;

export function render(dt) {
  const u = kaleido.material.uniforms;
  // Kept up while it's off too, so turning it on shows the current count.
  if (music.changes !== changes) {
    changes = music.changes;
    u.wedgesWas.value = u.wedges.value;
    u.wedges.value = 3 + (u.wedges.value - 3 + 1 + Math.floor(Math.random() * 3)) % 4; // 3–6, never the same
    u.dissolve.value = 0;
  }
  u.dissolve.value = Math.min(1, u.dissolve.value + dt / DISSOLVE);

  renderer.render(scene, camera);
  if (!post.bloom && !post.kaleido) return;

  renderer.copyFramebufferToTexture(frame.texture);
  if (post.bloom) {
    bloom.strength = STRENGTH * (1 + 0.35 * music.hits.kick + 0.2 * music.hits.crash);
    bloom.render(renderer, null, frame, dt, false); // adds the glow into `frame`
  }
  renderer.setRenderTarget(null);
  if (!post.kaleido) return copy.render(renderer);

  const { hits } = music;
  u.angle.value = (u.angle.value + (TURN + TWIST * hits.snare) * dt) % (Math.PI * 2);
  drift = (drift + SWEEP * dt) % (Math.PI * 2);
  if (music.chord.length) root += turnTo(root, pcAngle(music.chord[0])) * (1 - Math.exp(-dt / GLIDE));
  u.sweep.value = drift + root;
  u.zoom.value = 1 - PUNCH * Math.max(hits.kick, 0.6 * hits.crash); // smaller zoom draws the picture larger
  u.ripple.value = RIPPLE * music.roleLevel.bass;
  u.phase.value = (u.phase.value + 8 * dt) % (Math.PI * 2);
  kaleido.render(renderer);
}
