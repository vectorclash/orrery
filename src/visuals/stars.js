import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { music, pcAngle, pcHue } from './music.js';
import { beat } from '../state.js';

// ─── Starfield ────────────────────────────────────────────────────────────────
// 7500 small stars and 80 large ones, drifting in a slow flow field. The drift,
// the colours and the response to the music are all worked out per star in the
// vertex shader; each frame the CPU only sets uniforms.
//
// The stars hear the music three ways:
// - Pitch. The sky is laid out like the ring: the circle of fifths runs round
//   the horizon, in the same directions as the chord moons and the sphere's
//   lobes, and register is height, low notes below the horizon and high ones
//   above. Each sounding note lights a patch of sky in its direction, in its
//   pitch class's colour. A held chord glows as a few steady patches; a melody
//   flares from patch to patch.
// - Kick. Each kick sends a ring of light out from the planet across the sky,
//   as seen from the camera, reaching the edge of the view in under a beat.
// - Hats. Each hi-hat, shaker or ride hit makes a random few of the small stars
//   flicker, the way stars scintillate.
// Loudness, from the spectrum, still swells the drift and the star sizes.

// ─── Sprite textures ──────────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
const smallTex  = texLoader.load('images/star-sprite-small.png');
const largeTex  = texLoader.load('images/star-sprite-large.png');

// ─── Star cluster config ──────────────────────────────────────────────────────
const CLUSTER = {
  freqLarge:  0.04,
  freqMid:    0.10,
  freqFine:   0.28,
  ampLarge:   0.60,
  ampMid:     0.28,
  ampFine:    0.12,
  contrast:   7,
  fill:       3.5,
};

// ─── 3D value noise for organic star clustering ───────────────────────────────
function nHash(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function nLerp(a, b, t) { return a + (b - a) * t; }
function nSmooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = nSmooth(x - ix), fy = nSmooth(y - iy), fz = nSmooth(z - iz);
  return nLerp(
    nLerp(nLerp(nHash(ix,   iy,   iz  ), nHash(ix+1, iy,   iz  ), fx),
          nLerp(nHash(ix,   iy+1, iz  ), nHash(ix+1, iy+1, iz  ), fx), fy),
    nLerp(nLerp(nHash(ix,   iy,   iz+1), nHash(ix+1, iy,   iz+1), fx),
          nLerp(nHash(ix,   iy+1, iz+1), nHash(ix+1, iy+1, iz+1), fx), fy),
    fz
  );
}
function clusterDensity(x, y, z) {
  return valueNoise(x * CLUSTER.freqLarge, y * CLUSTER.freqLarge, z * CLUSTER.freqLarge) * CLUSTER.ampLarge
       + valueNoise(x * CLUSTER.freqMid,   y * CLUSTER.freqMid,   z * CLUSTER.freqMid)   * CLUSTER.ampMid
       + valueNoise(x * CLUSTER.freqFine,  y * CLUSTER.freqFine,  z * CLUSTER.freqFine)  * CLUSTER.ampFine;
}

// ─── Assign a color personality to each star at creation time ─────────────────
// Returns { hueFixed, hueVal, satVal, litVal }
//   hueFixed = true  → hueVal is an absolute hue (0–1), ignores musical hue
//   hueFixed = false → hueVal is a signed offset added to the musical hue
function starColorPersonality() {
  const t = Math.random();
  if (t < 0.38) {
    // Musical — tracks the palette hue with a small individual offset
    return { hueFixed: false, hueVal: (Math.random() - 0.5) * 0.08,
             satVal: 0.80 + Math.random() * 0.20, litVal: 0.48 + Math.random() * 0.16 };
  } else if (t < 0.62) {
    // Blue-white (O/B type) — fixed cool hue regardless of music
    return { hueFixed: true,  hueVal: 0.55 + Math.random() * 0.10,
             satVal: 0.65 + Math.random() * 0.30, litVal: 0.52 + Math.random() * 0.18 };
  } else if (t < 0.80) {
    // Warm orange/red (K/M type) — fixed warm hue
    return { hueFixed: true,  hueVal: 0.04 + Math.random() * 0.06,
             satVal: 0.85 + Math.random() * 0.15, litVal: 0.45 + Math.random() * 0.18 };
  } else {
    // Near-white / neutral — low saturation, any hue
    return { hueFixed: false, hueVal: (Math.random() - 0.5) * 0.20,
             satVal: 0.08 + Math.random() * 0.18, litVal: 0.65 + Math.random() * 0.20 };
  }
}

// ─── Layer factory ────────────────────────────────────────────────────────────
// Per star: its place in the flow (orbit radius, angle and height, phase), its
// drift speed, its colour personality and a fixed random number (`seed`, from
// the star's index so it draws nothing from Math.random).
function makeStarLayer(count, rMin, rMax, speedMin, speedMax) {
  const flow = new Float32Array(count * 4);
  const spd  = new Float32Array(count);
  const tone = new Float32Array(count * 4);
  const seed = new Float32Array(count);

  let placed = 0;
  while (placed < count) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = rMin + Math.random() * (rMax - rMin);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    const d = clusterDensity(x, y, z);
    if (Math.random() > Math.pow(d, CLUSTER.contrast) * CLUSTER.fill) continue;

    flow[placed * 4]     = Math.sqrt(x * x + z * z);
    flow[placed * 4 + 1] = Math.atan2(z, x);
    flow[placed * 4 + 2] = y;
    flow[placed * 4 + 3] = Math.random() * Math.PI * 2;
    spd[placed] = speedMin + Math.random() * (speedMax - speedMin);

    const p = starColorPersonality();
    tone[placed * 4]     = p.hueFixed ? 1 : 0;
    tone[placed * 4 + 1] = p.hueVal;
    tone[placed * 4 + 2] = p.satVal;
    tone[placed * 4 + 3] = p.litVal;

    const h = Math.sin(placed * 12.9898 + count) * 43758.5453;
    seed[placed] = h - Math.floor(h);
    placed++;
  }
  return { flow, spd, tone, seed };
}

function setStarAttributes(geo, layer, Attr) {
  geo.setAttribute('aFlow', new Attr(layer.flow, 4));
  geo.setAttribute('aSpd',  new Attr(layer.spd, 1));
  geo.setAttribute('aTone', new Attr(layer.tone, 4));
  geo.setAttribute('aSeed', new Attr(layer.seed, 1));
}

// ─── Shared shader code ───────────────────────────────────────────────────────
const NOTES = 16, KICKS = 4, HATS = 6;

const NOTE_HOLD  = 1.3;   // a note's patch: this much of its level…
const NOTE_FLARE = 1.0;   // …plus this much of its onset flash
const NOTE_SPAN  = 0.14;  // radians: the patch's angular radius (fifths are 0.52 apart)
const NOTE_TILT  = 0.35;  // radians of height for two octaves either side of middle C…
const NOTE_LEVEL = -0.12; // …which sits this far below the horizon, where the camera looks on average
const RING_FROM  = 0.12;  // radians from the planet's centre: where a kick's ring starts…
const RING_TO    = 1.0;   // …and where it ends, past the corners of the view
const RING_BEATS = 0.8;   // how long it takes to get there
const RING_WIDTH = 0.06;  // radians
const HAT_TAU    = 0.06;  // seconds: a flicker's decay
const PHI        = 1.6180339887; // spreads consecutive hits' seeds evenly

const shared = {
  uFt:      { value: 0 },  // flow-field time
  uFlow:    { value: 1 },  // drift amplitude
  uBaseH:   { value: 0 },  // palette hue, 0…1
  uNote:    { value: Array.from({ length: NOTES }, () => new THREE.Vector4()) }, // direction, strength
  uNoteCol: { value: Array.from({ length: NOTES }, () => new THREE.Color()) },
  uKick:    { value: Array.from({ length: KICKS }, () => new THREE.Vector2()) }, // ring angle, strength
  uHat:     { value: Array.from({ length: HATS }, () => new THREE.Vector2()) },  // seed, strength
};

const STAR_GLSL = /* glsl */`
  #define NOTES ${NOTES}
  #define KICKS ${KICKS}
  #define HATS ${HATS}
  const float PHI = 1.6180339887, RT2 = 1.4142135623, RT3 = 1.7320508075;
  const float NOTE_K = ${(1 / (NOTE_SPAN * NOTE_SPAN)).toFixed(4)}, RING_WIDTH = ${RING_WIDTH.toFixed(4)};
  uniform float uFt, uFlow, uBaseH;
  uniform vec4 uNote[NOTES];
  uniform vec3 uNoteCol[NOTES];
  uniform vec2 uKick[KICKS];
  uniform vec2 uHat[HATS];
  uniform vec3 uGain;          // brightness from: notes, the kick ring, hats
  uniform vec3 uGrow;          // size from the same
  uniform float uHatShare;     // fraction of the stars each hat hit lights
  attribute vec4 aFlow, aTone;
  attribute float aSpd, aSeed;
  varying vec3 vColor;

  // The drift: a flow field of incommensurate sines around the star's orbit.
  vec3 drift() {
    float sx = aFlow.y, sy = aFlow.z * 0.016, sr = aFlow.x * 0.011, ph = aFlow.w, ft = uFt;
    float angFlow = sin(sx * PHI + ft * 0.71 + ph) * 0.07
                  + sin(sy * RT2 + ft * 0.44 * PHI + sr) * 0.04
                  + sin(sx * RT3 + sy * PHI + ft * 0.29) * 0.025;
    float radFlow = sin(sx * RT2 + ft * 0.51 + ph * PHI) * 2.2
                  + sin(sy * PHI + ft * 0.28 * RT2 + sr * RT3) * 1.1
                  + sin(sr + ft * 0.19 + ph) * 0.7;
    float yFlow   = sin(sx + ft * 0.58 + ph * RT2) * 2.2
                  + sin(sy * RT3 + sx * PHI * 0.4 + ft * 0.35) * 1.4
                  + sin(sr * PHI + ft * 0.22 + ph * RT3) * 0.9;
    float angle = aFlow.y + angFlow * aSpd + ft * 0.025 * aSpd;
    float r = aFlow.x + radFlow * uFlow;
    return vec3(cos(angle) * r, aFlow.z + yFlow * uFlow, sin(angle) * r);
  }

  // Colour personality, as THREE.Color.setHSL computes it: fixed types hold
  // their hue, musical ones drift with the palette.
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 0.5) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * 6.0 * (2.0 / 3.0 - t);
    return p;
  }
  vec3 starColor() {
    float h = fract(aTone.x > 0.5 ? aTone.y : uBaseH + aTone.y + 1.0);
    float s = aTone.z, l = aTone.w;
    float p = l <= 0.5 ? l * (1.0 + s) : l + s - l * s, q = 2.0 * l - p;
    return vec3(hue2rgb(q, p, h + 1.0 / 3.0), hue2rgb(q, p, h), hue2rgb(q, p, h - 1.0 / 3.0));
  }

  // The music's light on a star at p: tints and brightens vColor, and returns
  // how much bigger the star draws. Directions are taken from the camera, as
  // on a real sky, so a note's patch is round and keeps its place as the
  // camera orbits.
  float listen(vec3 p) {
    vec3 dir = normalize(p - cameraPosition);
    // Notes: a soft patch round each note's direction, in its colour.
    vec3 tint = vec3(0.0);
    float light = 0.0;
    for (int i = 0; i < NOTES; i++) {
      float k = uNote[i].w * exp((dot(dir, uNote[i].xyz) - 1.0) * NOTE_K);
      light += k;
      tint += uNoteCol[i] * k;
    }
    // Kick: rings at an angle from the line of sight to the planet.
    float off = acos(clamp(dot(dir, normalize(-cameraPosition)), -1.0, 1.0));
    float ring = 0.0;
    for (int i = 0; i < KICKS; i++) {
      float d = (off - uKick[i].x) / RING_WIDTH;
      ring += uKick[i].y * exp(-d * d);
    }
    // Hats: each hit picks its own few stars.
    float hat = 0.0;
    for (int i = 0; i < HATS; i++) {
      hat += uHat[i].y * step(fract(sin(aSeed * 437.0 + uHat[i].x) * 43758.5453), uHatShare);
    }
    vColor = mix(vColor, tint / max(light, 1e-4), 1.0 - exp(-3.0 * light));
    vColor *= 1.0 + uGain.x * light + uGain.y * ring + uGain.z * hat;
    return 1.0 + uGrow.x * min(light, 1.5) + uGrow.y * ring + uGrow.z * hat;
  }
`;

const layerUniforms = (gain, grow, hatShare) => ({
  ...shared,
  uGain:     { value: new THREE.Vector3(...gain) },
  uGrow:     { value: new THREE.Vector3(...grow) },
  uHatShare: { value: hatShare },
});

// ─── Small star layer (points) ────────────────────────────────────────────────
// Drawn as THREE.PointsMaterial draws them (size attenuation, sprite, alpha
// test, output colour space), so the sky looks as it always has at rest.
export const SMALL_COUNT = 7500;
const smallLayer = makeStarLayer(SMALL_COUNT, 10, 45, 0.4, 1.4);

const smallGeo = new THREE.BufferGeometry();
smallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMALL_COUNT * 3), 3)); // unused; sets the count
setStarAttributes(smallGeo, smallLayer, THREE.BufferAttribute);

const smallMat = new THREE.ShaderMaterial({
  uniforms: {
    ...layerUniforms([1.0, 2.5, 3.0], [0.4, 0.6, 0.8], 0.03),
    uMap:     { value: smallTex },
    uSize:    { value: 0.6 },
    uPx:      { value: 1 },   // drawing-buffer pixels per unit of size at distance 1, over 2
    uOpacity: { value: 0.9 },
  },
  vertexShader: /* glsl */`
    ${STAR_GLSL}
    uniform float uSize, uPx;
    void main() {
      vec3 p = drift();
      vColor = starColor();
      float grow = listen(p);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * grow * uPx / -mv.z;
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap;
    uniform float uOpacity;
    varying vec3 vColor;
    void main() {
      vec4 c = vec4(vColor, uOpacity) * texture2D(uMap, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));
      if (c.a < 0.01) discard;
      gl_FragColor = c;
      #include <colorspace_fragment>
    }
  `,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const smallStars = new THREE.Points(smallGeo, smallMat);
smallStars.frustumCulled = false; // positions come from the shader
scene.add(smallStars);

// ─── Large star layer (camera-facing quads) ───────────────────────────────────
// One instanced mesh, drawn as THREE.SpriteMaterial would draw each star.
export const LARGE_COUNT = 80;
const largeLayer = makeStarLayer(LARGE_COUNT, 8, 35, 0.2, 0.7);
const largeScale = Float32Array.from({ length: LARGE_COUNT }, () => 1.5 + Math.random() * 5.5);

const quad = new THREE.PlaneGeometry(1, 1);
const largeGeo = new THREE.InstancedBufferGeometry();
largeGeo.index = quad.index;
largeGeo.setAttribute('position', quad.attributes.position);
largeGeo.setAttribute('uv', quad.attributes.uv);
setStarAttributes(largeGeo, largeLayer, THREE.InstancedBufferAttribute);
largeGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(largeScale, 1));
largeGeo.instanceCount = LARGE_COUNT;

const largeMat = new THREE.ShaderMaterial({
  uniforms: {
    // Already large and swelling with loudness: notes only colour them.
    ...layerUniforms([0, 0.4, 0], [0, 0.15, 0], 0),
    uMap:   { value: largeTex },
    uPulse: { value: 1 },
  },
  vertexShader: /* glsl */`
    ${STAR_GLSL}
    attribute float aScale;
    uniform float uPulse;
    varying vec2 vUv;
    void main() {
      vec3 p = drift();
      vColor = starColor();
      float grow = listen(p);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      mv.xy += position.xy * aScale * uPulse * grow;
      gl_Position = projectionMatrix * mv;
      vUv = uv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap;
    varying vec3 vColor;
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(vColor, 1.0) * texture2D(uMap, vUv);
      #include <colorspace_fragment>
    }
  `,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const largeStars = new THREE.Mesh(largeGeo, largeMat);
largeStars.frustumCulled = false;
scene.add(largeStars);

// ─── What the stars hear ──────────────────────────────────────────────────────
const strength = new Float32Array(128);
const sounding = [];

// The strongest NOTES sounding notes, as directions on the sky and colours.
function listenNotes(hue) {
  sounding.length = 0;
  for (let m = 0; m < 128; m++) {
    strength[m] = NOTE_HOLD * music.noteLevel[m] + NOTE_FLARE * music.flash[m];
    if (strength[m] > 0.01) sounding.push(m);
  }
  sounding.sort((a, b) => strength[b] - strength[a]);
  const dirs = shared.uNote.value, cols = shared.uNoteCol.value;
  for (let i = 0; i < NOTES; i++) {
    const m = sounding[i];
    if (m === undefined) { dirs[i].w = 0; continue; }
    const az = pcAngle(m % 12);
    const el = Math.max(-1, Math.min(1, (m - 60) / 24)) * NOTE_TILT + NOTE_LEVEL;
    dirs[i].set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az), strength[m]);
    // The chord moons' colour as it appears on screen (they write it unconverted).
    cols[i].setHSL(pcHue(m % 12, hue) / 360, 0.8, 0.62, THREE.SRGBColorSpace);
  }
}

// The newest kicks as rings on their way out, and the newest hats as flickers.
function listenDrums() {
  const kicks = shared.uKick.value, hats = shared.uHat.value;
  const travel = RING_BEATS * beat();
  let nk = 0, nh = 0;
  for (let i = music.strikes.length - 1; i >= 0; i--) {
    const s = music.strikes[i];
    if (s.kind === 'kick' && nk < KICKS && s.age < travel) {
      const x = s.age / travel, ease = 1 - (1 - x) * (1 - x);
      kicks[nk++].set(RING_FROM + (RING_TO - RING_FROM) * ease, s.vel * (1 - x));
    } else if (s.kind === 'hat' && nh < HATS) {
      const a = s.vel * Math.exp(-s.age / HAT_TAU);
      if (a > 0.01) hats[nh++].set((s.id * PHI) % 1 * 100, a);
    }
  }
  while (nk < KICKS) kicks[nk++].set(0, 0);
  while (nh < HATS) hats[nh++].set(0, 0);
}

// ─── Update (called each animation frame) ────────────────────────────────────
export function updateStars(energy, bass, hue, t) {
  shared.uFt.value    = t * 0.06;
  shared.uFlow.value  = 1.0 + energy * 0.35 + bass * 0.25;
  shared.uBaseH.value = ((hue + 30) % 360) / 360;
  smallMat.uniforms.uSize.value = 0.6 + energy * 0.15 + bass * 0.10;
  smallMat.uniforms.uPx.value   = renderer.domElement.height * 0.5;
  largeMat.uniforms.uPulse.value = 1.0 + energy * 0.6 + bass * 0.5;
  listenNotes(hue);
  listenDrums();
}
