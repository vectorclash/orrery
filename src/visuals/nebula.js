import * as THREE from 'three';
import { scene } from './scene.js';

// ─── Soft radial gradient texture ─────────────────────────────────────────────
// Peak alpha = 1 so material.opacity is the sole brightness control.
// Built as a raw DataTexture, not a Canvas2D gradient: mobile GPUs showed a speckle of
// colored pixels in the sprite centers with the canvas route — Canvas2D stores pixels
// premultiplied and the WebGL upload unpremultiplies them back (lossy at low alpha,
// rounding varies by driver), and some mobile rasterizers also dither gradients. Writing
// the exact non-premultiplied bytes ourselves sidesteps both.
function makeNebulaTex() {
  const s = 512, h = s / 2;
  // Same falloff as the old canvas radial gradient's stops
  const stops = [
    [0, 1.0],
    [0.25, 0.55],
    [0.55, 0.18],
    [0.8, 0.04],
    [1, 0]
  ];
  const alphaAt = (t) => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, a0] = stops[i - 1];
        const [t1, a1] = stops[i];
        return a0 + ((t - t0) / (t1 - t0)) * (a1 - a0);
      }
    }
    return 0;
  };
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x + 0.5 - h;
      const dy = y + 0.5 - h;
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / h);
      const o = (y * s + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(alphaAt(t) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, s, s);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const nebulaTex = makeNebulaTex();

// ─── Color personalities ──────────────────────────────────────────────────────
function nebulaPersonality(t) {
  if (t < 0.35) {
    // Deep blue / teal — fixed
    return { hueFixed: true,  hueVal: 0.50 + Math.random() * 0.13,
             sat: 0.80 + Math.random() * 0.15, lit: 0.38 + Math.random() * 0.14 };
  } else if (t < 0.62) {
    // Purple / violet — fixed
    return { hueFixed: true,  hueVal: 0.67 + Math.random() * 0.13,
             sat: 0.82 + Math.random() * 0.14, lit: 0.35 + Math.random() * 0.14 };
  } else if (t < 0.80) {
    // Magenta / rose — fixed
    return { hueFixed: true,  hueVal: 0.84 + Math.random() * 0.12,
             sat: 0.80 + Math.random() * 0.16, lit: 0.38 + Math.random() * 0.14 };
  } else {
    // Follows musical hue
    return { hueFixed: false, hueVal: (Math.random() - 0.5) * 0.14,
             sat: 0.78 + Math.random() * 0.18, lit: 0.38 + Math.random() * 0.14 };
  }
}

// ─── Spawn nebulae ────────────────────────────────────────────────────────────
const NEBULA_COUNT = 22;
export const nebulae = [];
const _col = new THREE.Color();

for (let i = 0; i < NEBULA_COUNT; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const r     = 18 + Math.random() * 28;
  const x     = r * Math.sin(phi) * Math.cos(theta);
  const y     = r * Math.sin(phi) * Math.sin(theta);
  const z     = r * Math.cos(phi);

  const p           = nebulaPersonality(Math.random());
  const baseOpacity = 0.14 + Math.random() * 0.18;  // 0.14–0.32

  // Elliptical shape + static rotation for organic variety
  const baseW  = 20 + Math.random() * 32;
  const baseH_ = baseW * (0.55 + Math.random() * 0.90);

  const mat = new THREE.SpriteMaterial({
    map:         nebulaTex,
    transparent: true,
    opacity:     baseOpacity,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    rotation:    Math.random() * Math.PI * 2,
  });
  _col.setHSL(p.hueVal, p.sat, p.lit);
  mat.color.copy(_col);

  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(baseW, baseH_, 1);
  sprite.position.set(x, y, z);

  sprite.userData = {
    angle:      theta,
    baseR:      r,
    yBase:      y,
    orbitSpeed: (0.00015 + Math.random() * 0.00022) * (Math.random() < 0.5 ? 1 : -1),
    yAmp:       1.8 + Math.random() * 3.5,
    yPhase:     Math.random() * Math.PI * 2,
    ySpeed:     0.06 + Math.random() * 0.10,
    baseW, baseH_,
    baseOpacity,
    hueFixed:   p.hueFixed,
    hueVal:     p.hueVal,
    sat:        p.sat,
    lit:        p.lit,
  };

  sprite.userData.sky = true; // behind everything: a video's lens bends it (video/fx.js)
  scene.add(sprite);
  nebulae.push(sprite);
}

// ─── Update (called each animation frame) ────────────────────────────────────
export function updateNebulae(energy, bass, hue, dt, t) {
  const baseH = ((hue + 30) % 360) / 360;
  for (const neb of nebulae) {
    const ud = neb.userData;

    ud.angle += ud.orbitSpeed * dt * 60; // per 60th of a second, as it was set
    const nx = Math.cos(ud.angle) * ud.baseR;
    const ny = ud.yBase + Math.sin(t * ud.ySpeed + ud.yPhase) * ud.yAmp;
    const nz = Math.sin(ud.angle) * ud.baseR;
    neb.position.set(nx, ny, nz);

    const h = ud.hueFixed ? ud.hueVal : (baseH + ud.hueVal + 1) % 1;
    _col.setHSL(h, ud.sat, ud.lit);
    neb.material.color.copy(_col);

    const pulse = 1.0 + bass * 0.12 + energy * 0.05;
    neb.scale.set(ud.baseW * pulse, ud.baseH_ * pulse, 1);

    neb.material.opacity = ud.baseOpacity * (0.70 + energy * 0.40 + bass * 0.45);
  }
}
