import * as THREE from 'three';
import { music, pcHue } from '../music.js';
import { glowPoints, budget } from './points.js';
import { surfaceBetween, LAYER_RADII } from '../cages.js';

// ─── Strange attractor ────────────────────────────────────────────────────────
// Thousands of particles riding the Aizawa attractor: a chaotic flow that
// wraps a sphere, spiralling up its surface and plunging back down a vortex
// through its axis. No particle ever retraces its path, yet together they
// hold the shape.
//
// The music steers the flow: it runs faster as the music gets louder, the
// bass swells the sphere, the kick twists it (Aizawa's f), and the lead
// tightens the spiral (d). Particles take the chord's colours by height, the
// root at the bottom; note onsets send a bright wave through them from the
// note's direction, as across the cages.
//
// Inside the cages (see core/index.js), the flow takes their shape: each
// particle is pushed in or out by as much as the cage beside it -- the inner
// layer near the middle, blending into the next one out at the flow's edge --
// so it bulges into the chord's lobes, ripples with the notes and punches
// with the kick, as one body with them.
//
// Only a narrow range of the equations' parameters is chaotic -- outside it
// every path collapses onto the axis -- so the music only moves them within
// it, and a particle that falls onto the axis anyway is dropped back onto
// the flow.

const N = budget(7000), S = 0.8, MID = 0.65;
const MAX_H = 0.009; // integration step: larger ones fall onto the axis

const group = new THREE.Group();
const dust = glowPoints(N);
group.add(dust.points);

const st = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random();
  st[3 * i] = Math.cos(a) * r; st[3 * i + 1] = Math.sin(a) * r; st[3 * i + 2] = Math.random() * 2 - 0.5;
}

const toneCol = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
const _c = new THREE.Color(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const ripBuf = new Float32Array(24 * 7);
let warm = 120; // steps to run before the first frame, so it starts on the attractor

function update({ hue, dt, t, energy, alpha, within = 0 }) {
  const chord = music.chord, hits = music.hits, roles = music.roleLevel;
  const ease = 1 - Math.exp(-dt / 0.4);
  const list = chord.length ? chord : [music.tonic];
  for (let i = 0; i < 4; i++) {
    _c.setHSL(pcHue(list[Math.min(i, list.length - 1)], hue) / 360, 0.75, 0.6);
    toneCol[i].lerp(_c, ease);
  }
  const nc = Math.min(4, list.length);

  const A = 0.88 + 0.06 * Math.min(1, roles.bass), B = 0.7, C = 0.6;
  const D = 3.5 - 0.8 * Math.min(1, roles.lead), E = 0.25, F = 0.08 + 0.1 * hits.kick;
  const sim = warm ? warm * MAX_H : dt * (0.7 + 1.6 * energy + 0.4 * roles.motion);
  warm = 0;
  const n = Math.max(1, Math.ceil(sim / MAX_H)), h = sim / n;

  // Ripples, into the turning frame.
  _q.copy(group.quaternion).invert();
  let nr = 0;
  for (const r of music.ripples) {
    if (nr >= ripBuf.length) break;
    _v.set(r.x, r.y, r.z).applyQuaternion(_q);
    ripBuf[nr++] = _v.x; ripBuf[nr++] = _v.y; ripBuf[nr++] = _v.z;
    ripBuf[nr++] = r.vel * Math.exp(-r.age / 0.5); ripBuf[nr++] = r.age * 1.8;
    // The cosines its wavefront spans (±0.7 rad): nothing outside to work out.
    ripBuf[nr++] = Math.cos(Math.min(Math.PI, r.age * 1.8 + 0.7)); ripBuf[nr++] = Math.cos(Math.max(0, r.age * 1.8 - 0.7));
  }

  // In the cages, their punch replaces its own.
  const punch = S * (1 + (1 - within) * (0.07 * hits.kick + 0.03 * hits.crash));
  // The world turn and size of this frame, for finding where a particle is.
  const { x: qx, y: qy, z: qz, w: qw } = group.quaternion, scale = group.scale.x;
  const r0 = LAYER_RADII[0], r1 = LAYER_RADII[1];
  const p = dust.pos, col = dust.col, size = dust.size;
  for (let i = 0; i < N; i++) {
    let x = st[3 * i], y = st[3 * i + 1], z = st[3 * i + 2];
    for (let k = 0; k < n; k++) {
      const dx = (z - B) * x - D * y, dy = D * x + (z - B) * y;
      const dz = C + A * z - z * z * z / 3 - (x * x + y * y) * (1 + E * z) + F * z * x * x * x;
      x += dx * h; y += dy * h; z += dz * h;
    }
    if (!(x * x + y * y > 1e-3) || !(Math.abs(z) < 4)) {
      // Fell onto the axis (or out): back onto the flow beside another particle.
      const j = 3 * Math.floor(Math.random() * N);
      x = st[j] + (Math.random() - 0.5) * 0.05; y = st[j + 1] + (Math.random() - 0.5) * 0.05; z = st[j + 2];
      if (!(x * x + y * y > 1e-3)) { x = 1; y = 0; z = 0.5; }
    }
    st[3 * i] = x; st[3 * i + 1] = y; st[3 * i + 2] = z;

    let X = x * punch, Y = (z - MID) * punch, Z = y * punch;
    if (within > 0) {
      // Its direction and distance in the world: rotate by the group's turn.
      const tx = 2 * (qy * Z - qz * Y), ty = 2 * (qz * X - qx * Z), tz = 2 * (qx * Y - qy * X);
      const wx = X + qw * tx + (qy * tz - qz * ty), wy = Y + qw * ty + (qz * tx - qx * tz), wz = Z + qw * tz + (qx * ty - qy * tx);
      const len = Math.hypot(wx, wy, wz) || 1;
      const k = Math.min(1, Math.max(0, (len * scale - r0) / (r1 - r0)));
      const f = 1 + within * (surfaceBetween(0, k, wx / len, wy / len, wz / len) - 1);
      X *= f; Y *= f; Z *= f;
    }
    p[3 * i] = X; p[3 * i + 1] = Y; p[3 * i + 2] = Z;

    let wave = 0;
    if (nr) {
      const len = Math.hypot(X, Y, Z) || 1;
      for (let j = 0; j < nr; j += 7) {
        const c = (X * ripBuf[j] + Y * ripBuf[j + 1] + Z * ripBuf[j + 2]) / len;
        if (c < ripBuf[j + 5] || c > ripBuf[j + 6]) continue;
        const off = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) - ripBuf[j + 4];
        wave += ripBuf[j + 3] * Math.exp(-off * off * 12);
      }
    }
    // Colour by height through the chord's tones, root at the bottom.
    const hgt = Math.min(0.999, Math.max(0, (z + 0.7) / 2.6)) * (nc - 1);
    const lo = Math.floor(hgt), fr = hgt - lo, ca = toneCol[lo], cb = toneCol[Math.min(nc - 1, lo + 1)];
    const b = alpha * (0.42 + 1.4 * wave);
    col[3 * i]     = (ca.r + (cb.r - ca.r) * fr) * b;
    col[3 * i + 1] = (ca.g + (cb.g - ca.g) * fr) * b;
    col[3 * i + 2] = (ca.b + (cb.b - ca.b) * fr) * b;
    size[i] = 2.4 + 2 * wave;
  }
  dust.commit();

  group.rotation.y += dt * (0.05 + 0.1 * energy);
  group.rotation.x = 0.18 * Math.sin(t * 0.04);
}

export const attractor = { group, update };
