import * as THREE from 'three';
import { music, pcHue } from '../music.js';
import { waveform, COLS } from '../waveform.js';
import { scene, renderer } from '../scene.js';
import { R_IN, R_OUT, OMEGA0, R_REF, GLSL_COMMON, GLSL_SUN, makeDust, dustMaterial } from './common.js';

// ─── The ring: the waveform itself, radiating through the dust ────────────────
// The planet emits the live waveform as a ring: each frame, a slice of what
// reaches the speakers is wrapped once around the inner edge and pushes the
// dust up and down, and then travels outward. So at any moment the ring holds
// the last few seconds of waveform, newest at the planet, oldest at the rim.
// The emitter turns as it emits and each ring is carried by the orbit on its
// way out, so the history winds into a spiral.
//
// The slice comes from ../waveform.js, phase-locked to the lowest sounding
// note, so a held bass note draws a standing pattern that loops seamlessly
// round the circle and everything above it moves through that pattern.

const ROWS = 160, RATE = 60;               // history rows, rows per second
const SPAN = (ROWS - 2) / RATE;             // seconds from inner to outer edge (short of the wrap)
const SPIN = 0.7;                           // emitter rotation, rad/s
const DUST = 64000;

const wave = new Uint8Array(COLS * ROWS).fill(128);
const waveTex = new THREE.DataTexture(wave, COLS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
const tint = new Uint8Array(2 * ROWS * 4);  // per row: crest colour, trough colour
const tintTex = new THREE.DataTexture(tint, 2, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
for (const tex of [waveTex, tintTex]) {
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
}

// Twist the orbit gives a ring that has been travelling outward for `age`
// seconds at constant speed: ∫ omega(r(s)) ds, in closed form.
const SPEED = (R_OUT - R_IN) / SPAN;
const TWIST_K = 2 * OMEGA0 * Math.pow(R_REF, 1.5) / SPEED;

const mat = dustMaterial({
  uWave: { value: waveTex },
  uTint: { value: tintTex },
  uHead: { value: 0 },      // texture v of the newest row
  uBase: { value: new THREE.Color() },
}, /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_SUN}
  uniform float uTime, uPx, uHead;
  uniform sampler2D uWave, uTint;
  uniform vec3 uBase;
  attribute float aAngle, aRadius, aY;
  attribute vec4 aHash;
  varying vec3 vColor;
  const float SPAN = ${SPAN.toFixed(5)}, ROWS = ${ROWS}.0, RATE = ${RATE}.0, SPIN = ${SPIN};

  void main() {
    float r  = aRadius;
    float th = aAngle + omega(r) * uTime;              // the dust's own orbit
    float x  = (r - R_IN) / (R_OUT - R_IN);
    float age = x * SPAN;                              // seconds since this ring left the planet
    float twist = ${TWIST_K.toFixed(5)} * (inversesqrt(R_IN) - inversesqrt(r));
    float u  = (th - SPIN * (uTime - age) - twist) / TAU;
    float v  = uHead - age * RATE / ROWS;

    float y   = texture2D(uWave, vec2(u, v)).r * 2.0 - 1.0;
    vec3 crest  = texture2D(uTint, vec2(0.25, v)).rgb;
    vec3 trough = texture2D(uTint, vec2(0.75, v)).rgb;
    float env = smoothstep(0.0, 0.06, x) * (1.0 - 0.6 * x);  // emerges at the planet, relaxes outward

    float lift = y * env * (0.45 + 0.25 * aHash.x);
    vec3 wp = vec3(cos(th) * r, PLANE_Y + aY + lift, sin(th) * r);
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;

    float a = abs(y) * env;
    float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * aHash.z) + aHash.y * 50.0);
    vec3 col = uBase * 0.06 + (y > 0.0 ? crest : trough) * (0.8 * a + 4.5 * a * a);
    vColor = col * twinkle * (1.0 - 0.85 * planetShadow(wp)); // the planet's shadow falls across the ring
    vColor += moonLight(wp) * (0.6 + 0.4 * twinkle);
    gl_PointSize = uPx * (2.0 + 5.0 * a + 1.2 * aHash.x) * (7.0 / -mv.z);
  }
`);
const points = new THREE.Points(makeDust(DUST, { thickness: 0.02 }), mat);
points.frustumCulled = false; // positions come from the shader
scene.add(points);

let acc = 0, head = 0;

const _a = new THREE.Color(), _b = new THREE.Color();

export function updateRing({ dt, t, hue }) {
  const { live, shown } = waveform;
  const chord = music.chord;
  _a.setHSL((chord.length ? pcHue(chord[0], hue) : hue) / 360, 0.85, 0.6);
  _b.setHSL((chord.length > 1 ? pcHue(chord[chord.length > 2 ? 2 : 1], hue) : (hue + 40) % 360) / 360, 0.85, 0.6);

  acc += dt * RATE;
  const rows = Math.min(ROWS, Math.floor(acc));
  acc -= rows;
  for (let k = 0; k < rows; k++) {
    head = (head + 1) % ROWS;
    const o = head * COLS;
    for (let c = 0; c < COLS; c++) wave[o + c] = live ? 128 + 127 * Math.tanh(shown[c]) : 128;
    const p = head * 8;
    tint[p] = _a.r * 255; tint[p + 1] = _a.g * 255; tint[p + 2] = _a.b * 255; tint[p + 3] = 255;
    tint[p + 4] = _b.r * 255; tint[p + 5] = _b.g * 255; tint[p + 6] = _b.b * 255; tint[p + 7] = 255;
  }
  if (rows) { waveTex.needsUpdate = true; tintTex.needsUpdate = true; }

  const U = mat.uniforms;
  U.uTime.value = t;
  U.uPx.value = renderer.domElement.height / 750; // sizes are authored for a 750px-tall view
  U.uHead.value = (head + 0.5) / ROWS;
  _a.setHSL(hue / 360, 0.35, 0.55);
  U.uBase.value.lerp(_a, 1 - Math.exp(-dt / 0.5));
}
