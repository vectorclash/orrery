import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './scene.js';
import { music, pcAngle, pcHue } from './music.js';
import { spectrum, BANDS } from './spectrum.js';

// ─── Harmonic cages: wireframe icosahedra round the planet ────────────────────
// Two cages, each listening to a part of the band. The shape as a whole
// vibrates like a droplet in the current chord's modes (below) and morphs when
// the chord changes. Note onsets send ripples out from their pitch's direction
// (high notes start near the top); the kick punches the inner cage and the
// snare the outer. A faint spectral shimmer keeps them alive. The planet is
// opaque, so each cage's far side passes behind it.
//
// Chord modes: each chord tone excites a sectoral mode, sinᵐθ·cos m(φ − φ₀) —
// m lobes evenly round the equator, one of them aimed at the tone's moon. m is
// the tone's role in the chord (root 2, third 3, fifth 4, seventh 5), so major
// and minor chords take different shapes. The modes are balanced — every lobe
// out has a trough beside it — so the cages never lean toward the chord.
// Each mode holds a small shape while its tone is in the chord and wobbles,
// at a rate set by its interval above the root, while the tone is sounding.
const LAYERS = [
  { radius: 1.60, opacity: 0.18, ry: -0.0022, rx: -0.0008, hueOff: -25, roles: ['bass', 'motion'], tone: 2, hit: 'kick'  },
  { radius: 1.95, opacity: 0.12, ry:  0.0016, rx: -0.0005, hueOff:   0, roles: ['lead', 'air'],    tone: 0, hit: 'snare' },
];
const RIPPLE_GAIN = { bass: 0.22, motion: 0.13, lead: 0.2, air: 0.16 };

const layers = LAYERS.map((cfg, i) => {
  let geo = new THREE.IcosahedronGeometry(cfg.radius, 5);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo); // 2160 → 362 vertices: each point computed once
  const pos = geo.attributes.position;
  pos.setUsage(THREE.DynamicDrawUsage);
  const unit = new Float32Array(pos.array.length);
  const jitter = new Float32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const x = pos.array[3 * v], y = pos.array[3 * v + 1], z = pos.array[3 * v + 2];
    const len = Math.hypot(x, y, z);
    unit[3 * v] = x / len; unit[3 * v + 1] = y / len; unit[3 * v + 2] = z / len;
    jitter[v] = Math.random();
  }
  const mat = new THREE.MeshBasicMaterial({
    color: 0x334466, wireframe: true, transparent: true,
    opacity: cfg.opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(i * 0.38, i * 0.65, i * 0.22);
  scene.add(mesh);
  return { ...cfg, mesh, mat, pos, unit, jitter };
});

// Chord modes, keyed by pitch class × lobe count, so a tone that changes role
// between chords fades out of one mode and into the other.
const MODE_M = [2, 3, 4, 5];
const modeHold = new Float32Array(12 * 4), modeWobble = new Float32Array(12 * 4);
const roleOf = interval => interval === 0 ? 0 : interval <= 4 ? 1 : interval <= 8 ? 2 : 3;

// ─── Update (called each animation frame) ────────────────────────────────────
const _target = new THREE.Color();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const _ex = new THREE.Vector3(), _ez = new THREE.Vector3();
const modeBuf = new Float32Array(12 * 4 * 4), ripBuf = new Float32Array(24 * 6);

export function updateCages({ energy, hue, dt, fade, t }) {
  const chord  = music.chord;
  const hits   = music.hits;
  const roles  = music.roleLevel;
  const ease   = 1 - Math.exp(-dt / 0.3);

  // ── Chord modes ──
  // Active modes as [cos φ₀, sin φ₀, m, amplitude] for the vertex loop.
  const quick = 1 - Math.exp(-dt / 0.12);
  let nm = 0;
  for (let pc = 0; pc < 12; pc++) {
    const interval = chord.length ? (pc - chord[0] + 12) % 12 : 0;
    const role = chord.includes(pc) ? roleOf(interval) : -1;
    let lvl = 0;
    for (let k = 0; k < 7; k++) lvl = Math.max(lvl, music.noteLevel[24 + 12 * k + pc]);
    const wob = Math.sin(t * 2 * Math.PI * 0.6 * Math.pow(2, interval / 12) + pc);
    for (let k = 0; k < 4; k++) {
      const i = pc * 4 + k, on = k === role;
      modeHold[i]   += ((on ? (k === 0 ? 0.075 : 0.055) * (0.6 + 0.4 * roles.bed) : 0) - modeHold[i]) * ease;
      modeWobble[i] += ((on ? 0.07 * Math.min(1, lvl * 1.4) : 0) - modeWobble[i]) * quick;
      const amp = modeHold[i] + modeWobble[i] * wob;
      if (Math.abs(amp) < 0.002) continue;
      modeBuf[nm++] = Math.cos(pcAngle(pc)); modeBuf[nm++] = Math.sin(pcAngle(pc));
      modeBuf[nm++] = MODE_M[k]; modeBuf[nm++] = amp;
    }
  }

  // ── Layers ──
  for (const L of layers) {
    L.mesh.rotation.y += L.ry + energy * 0.006;
    L.mesh.rotation.x += L.rx + energy * 0.002;
    _q.copy(L.mesh.quaternion).invert(); // world → this layer's local frame
    // World x and z axes in local coordinates, to read each vertex's world direction.
    _ex.set(1, 0, 0).applyQuaternion(_q); _ez.set(0, 0, 1).applyQuaternion(_q);

    let nr = 0;
    for (const r of music.ripples) {
      if (!L.roles.includes(r.role) || nr >= ripBuf.length) continue;
      _v.set(r.x, r.y, r.z).applyQuaternion(_q);
      const amp = r.vel * RIPPLE_GAIN[r.role] * Math.exp(-r.age / 0.55);
      ripBuf[nr++] = _v.x; ripBuf[nr++] = _v.y; ripBuf[nr++] = _v.z;
      ripBuf[nr++] = amp; ripBuf[nr++] = r.age * 1.8; ripBuf[nr++] = 0;
    }

    const punch = 1 + (L.hit === 'kick' ? 0.2 * hits.kick : L.hit === 'snare' ? 0.08 * hits.snare : 0) + 0.05 * hits.crash;
    const u = L.unit, p = L.pos.array, jit = L.jitter;
    for (let v = 0, n = L.pos.count; v < n; v++) {
      const x = u[3 * v], y = u[3 * v + 1], z = u[3 * v + 2];
      let d = 0;
      if (nm) {
        // sinᵐθ·cos m(φ − φ₀) = Re[((wx + i·wz)·e^(−iφ₀))ᵐ], no trig needed.
        const wx = x * _ex.x + y * _ex.y + z * _ex.z;
        const wz = x * _ez.x + y * _ez.y + z * _ez.z;
        for (let j = 0; j < nm; j += 4) {
          const a = wx * modeBuf[j] + wz * modeBuf[j + 1], b = wz * modeBuf[j] - wx * modeBuf[j + 1];
          let re = a, im = b;
          for (let k = 1; k < modeBuf[j + 2]; k++) { const r2 = re * a - im * b; im = re * b + im * a; re = r2; }
          d += modeBuf[j + 3] * re;
        }
      }
      for (let j = 0; j < nr; j += 6) {
        const c = x * ripBuf[j] + y * ripBuf[j + 1] + z * ripBuf[j + 2];
        const off = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) - ripBuf[j + 4];
        d += ripBuf[j + 3] * Math.exp(-off * off * 16);
      }
      const band = Math.min(BANDS - 1, Math.floor(((y * 0.5 + 0.5) * 0.85 + jit[v] * 0.15) * BANDS));
      d += 0.16 * spectrum[band] * fade;
      const r = L.radius * (punch + d);
      p[3 * v] = x * r; p[3 * v + 1] = y * r; p[3 * v + 2] = z * r;
    }
    L.pos.needsUpdate = true;

    // Colour: each layer takes one chord tone (idle: fixed offsets).
    const tone = chord.length ? pcHue(chord[L.tone % chord.length], hue) : (hue + L.hueOff + 360) % 360;
    _target.setHSL(tone / 360, 0.65, 0.55);
    L.mat.color.lerp(_target, ease);
    const presence = Math.max(...L.roles.map(r => roles[r]));
    const flash = (L.hit ? hits[L.hit] * 0.8 : 0) + (L.radius > 1.8 ? hits.hat * 0.3 : 0);
    L.mat.opacity = L.opacity * (1 + 0.4 * presence + 0.6 * flash);
  }
}
