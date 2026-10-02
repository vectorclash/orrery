import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { music, fifths, pcAngle, pcHue } from './music.js';
import { waveform, COLS } from './waveform.js';
import { transport } from '../audio/transport.js';
import { PLANE_Y, TAU, MOONS, moonUniforms } from './ring/common.js';

// ─── Chord moons ──────────────────────────────────────────────────────────────
// Each tone of the current chord is a small moon embedded in the ring, at its
// place on the circle of fifths (the same directions as the cages' lobes).
// A swarm of dust circles each moon, spinning faster and spreading wider when
// that tone sounds, and the moon lights the ring dust around it.
//
// Neighbouring chord tones are joined by strings: threads of dust arching
// from moon to moon along the ring, vibrating with the live waveform (fixed
// at both ends, like a real string) and plucked when the chord changes. A
// pulse of light runs along each string once per beat. The arcs skip the
// widest gap round the circle, so a chord is one connected span — and a
// major and a minor triad are mirror images (gaps of 1 then 3 fifths, or
// 3 then 1), so the harmony still reads as a shape.
//
// The moons glide to the next chord's tones when the harmony moves. A triad
// fills the four slots by repeating its last tone; the repeat sits on top of
// it, and its moon and string fade out by their separation.

const R_MOON = 3.3, MOON_Y = PLANE_Y + 0.1;
const SWARM = 110, THREAD = 240;          // particles per moon; per string
const STRINGS = MOONS - 1;
const COUNT = MOONS + MOONS * SWARM + STRINGS * THREAD;

const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), size = new Float32Array(COUNT);
const kind = new Float32Array(COUNT).fill(0).fill(1, 0, MOONS); // cores first
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute('kind', new THREE.BufferAttribute(kind, 1));

const mat = new THREE.ShaderMaterial({
  uniforms: { uPx: { value: 1 } },
  vertexShader: /* glsl */`
    uniform float uPx;
    attribute vec3 color;
    attribute float size, kind;
    varying vec3 vColor;
    varying float vKind;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position  = projectionMatrix * mv;
      gl_PointSize = uPx * size * (7.0 / -mv.z);
      vColor = color;
      vKind = kind;
    }
  `,
  // Moon cores: a hot centre in a wide, soft glow. Dust: soft points.
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying float vKind;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float dust = (1.0 - smoothstep(0.0, 1.0, r)) * 0.6 + (1.0 - smoothstep(0.0, 0.35, r)) * 0.4;
      float moon = exp(-r * r * 40.0) * 1.6 + exp(-r * r * 7.0) * 0.5 + (1.0 - smoothstep(0.3, 1.0, r)) * 0.12;
      gl_FragColor = vec4(vColor, clamp(mix(dust, moon, vKind), 0.0, 1.0));
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
scene.add(points);

// Swarm orbits: radius, tilt, node, phase and speed per particle.
const orbit = Float32Array.from({ length: MOONS * SWARM * 5 }, (_, i) => {
  const r = Math.random();
  switch (i % 5) {
    case 0: return 0.05 + 0.17 * r * r;          // radius: dense near the moon
    case 1: return (r - 0.5) * 1.4;              // inclination
    case 2: return r * TAU;                      // ascending node
    case 3: return r * TAU;                      // phase
    default: return 0.6 + 1.4 * r;               // relative speed
  }
});
// Thread jitter: each speck sits a little off the string's centre line.
const jitter = Float32Array.from({ length: STRINGS * THREAD * 3 }, () => (Math.random() - 0.5) * 0.035);

const slots = Array.from({ length: MOONS }, () => ({ angle: 0, color: new THREE.Color(), glow: 0, vis: 0, spin: 0 }));
let alpha = 0, pluck = 0, lastChord = '';

// ─── Update ───────────────────────────────────────────────────────────────────
const _c = new THREE.Color(), _d = new THREE.Color();

function shortest(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Chord tones in circle-of-fifths order, starting after the widest gap, so
// consecutive tones are the ones the strings join.
function chordOrder(chord) {
  const pcs = [...chord].sort((a, b) => fifths(a) - fifths(b));
  let best = 0, widest = -1;
  for (let i = 0; i < pcs.length; i++) {
    const gap = (fifths(pcs[(i + 1) % pcs.length]) - fifths(pcs[i]) + 12) % 12 || 12;
    if (gap > widest) { widest = gap; best = (i + 1) % pcs.length; }
  }
  return pcs.slice(best).concat(pcs.slice(0, best));
}

export function updateChord({ hue, dt, t }) {
  mat.uniforms.uPx.value = renderer.domElement.height / 750;
  const ease = 1 - Math.exp(-dt / 0.35);
  const chord = chordOrder(music.chord);
  alpha += ((chord.length ? 1 : 0) - alpha) * ease;

  const key = chord.join(',');
  if (key !== lastChord && lastChord) pluck = 1;
  lastChord = key;
  pluck *= Math.exp(-dt / 0.9);

  // Slots: glide to the chord tones; a sounding tone makes its moon flare.
  for (let i = 0; i < MOONS; i++) {
    const s = slots[i];
    if (chord.length) {
      const pc = chord[Math.min(i, chord.length - 1)];
      s.angle += shortest(s.angle, pcAngle(pc)) * ease;
      _c.setHSL(pcHue(pc, hue) / 360, 0.8, 0.62);
      s.color.lerp(_c, ease);
      let lit = 0;
      for (let k = 0; k < 7; k++) lit = Math.max(lit, music.noteLevel[24 + 12 * k + pc] + music.flash[24 + 12 * k + pc]);
      s.glow += (Math.min(1.5, lit) - s.glow) * (1 - Math.exp(-dt / 0.08));
    }
    s.spin += dt * (0.8 + 2.2 * s.glow);
    // A repeated tone sits on its predecessor: fade it by the separation.
    s.vis = i === 0 ? 1 : Math.min(1, Math.abs(shortest(slots[i - 1].angle, s.angle)) * R_MOON / 0.25);
  }

  // Moons: cores, plus their light on the ring dust.
  let p = 0;
  for (let i = 0; i < MOONS; i++, p++) {
    const s = slots[i], a = alpha * s.vis;
    const x = Math.cos(s.angle) * R_MOON, z = Math.sin(s.angle) * R_MOON;
    const y = MOON_Y + 0.03 * Math.sin(t * 0.9 + i * 1.7);
    pos[3 * p] = x; pos[3 * p + 1] = y; pos[3 * p + 2] = z;
    _c.copy(s.color).multiplyScalar(a * (0.9 + 0.8 * s.glow));
    col[3 * p] = _c.r; col[3 * p + 1] = _c.g; col[3 * p + 2] = _c.b;
    size[p] = 24 + 16 * s.glow;
    moonUniforms.uMoon.value[i].set(x, y, z, a * (0.35 + 0.65 * Math.min(1, s.glow)));
    moonUniforms.uMoonCol.value[i].copy(s.color);
  }

  // Swarms: tilted circular orbits around each moon.
  for (let i = 0; i < MOONS; i++) {
    const s = slots[i], a = alpha * s.vis;
    const cx = pos[3 * i], cy = pos[3 * i + 1], cz = pos[3 * i + 2];
    const spread = 1 + 0.9 * Math.min(1, s.glow);
    _c.copy(s.color).multiplyScalar(a * (0.45 + 0.7 * s.glow));
    for (let k = 0; k < SWARM; k++, p++) {
      const o = 5 * (i * SWARM + k);
      const r = orbit[o] * spread, inc = orbit[o + 1], node = orbit[o + 2];
      const ph = orbit[o + 3] + s.spin * orbit[o + 4] / Math.sqrt(orbit[o] / 0.1);
      // Orbit in its plane, tilted about the node line.
      const ox = Math.cos(ph) * r, oz = Math.sin(ph) * r;
      const oy = oz * Math.sin(inc), ozz = oz * Math.cos(inc);
      pos[3 * p]     = cx + ox * Math.cos(node) - ozz * Math.sin(node);
      pos[3 * p + 1] = cy + oy;
      pos[3 * p + 2] = cz + ox * Math.sin(node) + ozz * Math.cos(node);
      col[3 * p] = _c.r; col[3 * p + 1] = _c.g; col[3 * p + 2] = _c.b;
      size[p] = 3.2;
    }
  }

  // Strings: arcs along the ring between neighbouring tones, displaced by
  // the waveform under a sin(πs) envelope (both ends fixed).
  const wave = waveform.shown;
  const beat = music.now > 0 ? transport.beatAt(music.now) : t * 1.5;
  const head = beat - Math.floor(beat);
  for (let e = 0; e < STRINGS; e++) {
    const A = slots[e], B = slots[e + 1];
    const span = shortest(A.angle, B.angle);
    const vis = alpha * B.vis;
    const arch = 0.18 + 0.32 * Math.abs(span);
    const amp = 0.09 + 0.05 * Math.min(1, A.glow + B.glow);
    const offset = Math.floor(e * COLS / STRINGS);
    for (let k = 0; k < THREAD; k++, p++) {
      const f = (k + 0.5) / THREAD;
      const env = Math.sin(Math.PI * f);
      const w = wave[(offset + Math.floor(f * COLS / STRINGS)) % COLS];
      const ring = pluck * Math.sin(2 * Math.PI * f) * Math.cos(t * 19 + e) * 0.25;
      const d = (Math.tanh(w) * amp + ring) * env;
      const ang = A.angle + span * f;
      const r = R_MOON + d * 0.35;
      const j = 3 * (e * THREAD + k);
      pos[3 * p]     = Math.cos(ang) * r + jitter[j];
      pos[3 * p + 1] = MOON_Y + arch * env + d + jitter[j + 1];
      pos[3 * p + 2] = Math.sin(ang) * r + jitter[j + 2];
      // Light runs from tone to tone once per beat.
      const pulse = Math.exp(-(((f - head) * 6) ** 2));
      _d.copy(A.color).lerp(B.color, f).multiplyScalar(vis * (0.32 + 1.0 * pulse + 2.2 * Math.abs(d)));
      col[3 * p] = _d.r; col[3 * p + 1] = _d.g; col[3 * p + 2] = _d.b;
      size[p] = 3.8 + 4 * pulse;
    }
  }

  for (const name of ['position', 'color', 'size']) geo.attributes[name].needsUpdate = true;
}
