import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { renderer, camera, scene, resizeHandlers } from '../visuals/scene.js';
import { drawScene, addBloom, sceneFrame } from '../visuals/post.js';
import { music, pcAngle, pcHue } from '../visuals/music.js';
import { state } from '../state.js';

// ─── A video's post-processing ────────────────────────────────────────────────
// What a music video does to the finished frame (the scene and its bloom, as
// the live view draws them), in order:
//
//   scene  trails · lens · shockwave · filter blur · glints and streaks
//   look   the frame folded: the orrery as it is, a kaleidoscope, square or
//          hexagonal tiles, a mirror, a tunnel -- one look dissolving into
//          the next
//   lens   chromatic aberration · glitch · CRT · VHS · film · grade
//   finish letterbox · flash · fade · titles · dither, to the screen
//
// Each effect has a strength in `fx` (0 is off, and skipped), set each frame
// by the director (video/director.js), and its own way of hearing the music
// (music.js): the kick, the snare, the bass, the chord. The frame is 8-bit and
// in display space, as the live view's is (see post.js), so a threshold or a
// grade reads it as you see it; in between, the passes work in half floats so
// trails and blurs don't band.
//
// Additive light burns out to white when it stacks, so what adds light --
// trails, glints -- keeps to the brightest parts or decays fast; trails take
// the brighter of the frame and their memory, never the sum.

export const LOOKS = ['orrery', 'kaleidoscope', 'squares', 'hexagons', 'mirror', 'tunnel'];

export const fx = {
  trails: 0, lens: 0, shock: 0, defocus: 0, glints: 0, streaks: 0,
  aberration: 0, glitch: 0, crt: 0, vhs: 0, film: 0, grade: 0, letterbox: 0,
  flash: 0, fade: 0,
  gradeKind: 'neutral',
  look: { from: 'orrery', to: 'orrery', mix: 1 }, // `from` dissolving into `to`
  tunnel: 0.15,  // the tunnel's speed: how fast it falls inward (log-radius a second)
  titles: null,  // a texture of text over the picture (see titles.js), and
  titleAlpha: 0, // how much of it shows
};

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const HEAD = /* glsl */`
  uniform sampler2D tIn;
  uniform vec2 res;       // the target's size, pixels
  uniform float aspect, time, amount;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  // Centred on the screen, in screen heights.
  vec2 centred(vec2 uv) { return (uv - 0.5) * vec2(aspect, 1.0); }
  vec2 fromCentred(vec2 p) { return p / vec2(aspect, 1.0) + 0.5; }
  // Mirror-repeat past the edges, so nothing reads off the frame.
  vec2 mirrored(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
`;

function pass(fragment, uniforms = {}, blending = THREE.NoBlending) {
  return new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tIn: { value: null }, res: { value: new THREE.Vector2() }, aspect: { value: 1 },
      time: { value: 0 }, amount: { value: 0 }, ...uniforms,
    },
    vertexShader: VERT,
    fragmentShader: HEAD + fragment,
    depthTest: false, depthWrite: false, blending, transparent: blending !== THREE.NoBlending,
  }));
}

const target = (scale = 1) => new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});

// ─── Scene passes ─────────────────────────────────────────────────────────────

// Trails: the brighter of the frame and the last one, drawn a little larger
// and turned (light flows outward, like a long exposure falling away from
// the camera), fading. The bass pushes the flow; each new chord turns it.
const trails = pass(/* glsl */`
  uniform sampler2D tPrev;
  uniform float decay, zoom, turn;
  void main() {
    vec4 c = texture2D(tIn, vUv);
    vec2 q = fromCentred(rot(turn) * centred(vUv) / zoom);
    vec4 h = texture2D(tPrev, q) * decay;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) h = vec4(0.0);
    gl_FragColor = max(c, h);
  }`, { tPrev: { value: null }, decay: { value: 0 }, zoom: { value: 1 }, turn: { value: 0 } });

// Gravitational lens: the sky behind the planet -- the stars and nebulae,
// drawn on their own (see drawSplit) -- bent round it as a point mass bends
// light: stars near it smeared into arcs, and what lies right behind it
// spread into a ring at the Einstein radius, with a shadow inside it (the
// lens's second image is left out: it only ever showed as a smear). Then the
// orrery itself added over it, unbent. Additive light clips at white, as the
// screen does.
const lens = pass(/* glsl */`
  uniform sampler2D tFg;   // the rest of the scene
  uniform vec2 centre;     // the planet, in uv
  uniform float einstein;  // screen heights
  void main() {
    vec2 d = (vUv - centre) * vec2(aspect, 1.0);
    float r = max(length(d), 1e-4);
    vec2 src = d * max(0.0, 1.0 - einstein * einstein / (r * r));
    vec3 bent = texture2D(tIn, mirrored(src / vec2(aspect, 1.0) + centre)).rgb * smoothstep(0.9 * einstein, einstein, r);
    vec3 sky = mix(texture2D(tIn, vUv).rgb, bent, amount);
    gl_FragColor = vec4(min(vec3(1.0), sky + texture2D(tFg, vUv).rgb), 1.0);
  }`, { tFg: { value: null }, centre: { value: new THREE.Vector2(0.5, 0.5) }, einstein: { value: 0 } });

// Shockwave: each kick a ring of refraction racing out from the planet, its
// colours split a little at the front.
const KICK_WAVES = 4;
const shock = pass(/* glsl */`
  uniform vec2 centre;
  uniform vec4 waves[${KICK_WAVES}]; // radius (screen heights), strength, width
  void main() {
    vec2 d = (vUv - centre) * vec2(aspect, 1.0);
    float r = max(length(d), 1e-4);
    vec2 n = d / r;
    float off = 0.0, edge = 0.0;
    for (int i = 0; i < ${KICK_WAVES}; i++) {
      float x = (r - waves[i].x) / waves[i].z;
      float g = exp(-x * x);
      off += waves[i].y * x * g;
      edge += waves[i].y * g;
    }
    vec2 k = n / vec2(aspect, 1.0);
    vec2 uv = vUv - k * off * 0.15;
    vec3 c = vec3(texture2D(tIn, mirrored(uv - k * edge * 0.01)).r, texture2D(tIn, mirrored(uv)).g,
                  texture2D(tIn, mirrored(uv + k * edge * 0.01)).b);
    gl_FragColor = vec4(c * (1.0 + 0.4 * edge), 1.0);
  }`, { centre: { value: new THREE.Vector2(0.5, 0.5) }, waves: { value: Array.from({ length: KICK_WAVES }, () => new THREE.Vector4(0, 0, 0.05, 0)) } });

// A quarter-size copy, each pixel the average of the 4×4 it stands for (four
// bilinear taps), so a star of a pixel or two isn't caught or missed.
const down = pass(/* glsl */`
  uniform vec2 texel; // one pixel of tIn
  void main() {
    vec3 c = texture2D(tIn, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tIn, vUv + texel * vec2(1.0, -1.0)).rgb
           + texture2D(tIn, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tIn, vUv + texel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`, { texel: { value: new THREE.Vector2() } });

// Filter blur, in two: a wide soft blur of the quarter-size copy (a disc of
// samples on the golden angle), then the frame mixed part way toward it and
// a little dimmer -- what a lowpass filter does to a sound, done to the
// picture, with the orrery still there to see through it.
const defocusBlur = pass(/* glsl */`
  uniform float radius; // screen heights
  void main() {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 32; i++) {
      float f = (float(i) + 0.5) / 32.0;
      float a = float(i) * 2.39996323;
      acc += texture2D(tIn, vUv + sqrt(f) * radius * vec2(cos(a) / aspect, sin(a))).rgb;
    }
    gl_FragColor = vec4(acc / 32.0, 1.0);
  }`, { radius: { value: 0.03 } });
const defocusMix = pass(/* glsl */`
  uniform sampler2D tBlur;
  void main() {
    vec3 c = mix(texture2D(tIn, vUv).rgb, texture2D(tBlur, vUv).rgb, amount);
    c *= 1.0 - 0.15 * amount;
    gl_FragColor = vec4(c, 1.0);
  }`, { tBlur: { value: null } });

// The points of light: what's much brighter than the ring of pixels round it
// -- stars, moons, sparks -- at half size, and not the broad glow of the
// core, which a flare would only burn out to white.
const points = pass(/* glsl */`
  uniform vec2 texel;       // a few pixels of the frame, at 1080 lines
  uniform float threshold;
  void main() {
    vec3 c = texture2D(tIn, vUv).rgb, n = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      n += texture2D(tIn, vUv + vec2(cos(a), sin(a)) * texel).rgb;
    }
    vec3 p = max(vec3(0.0), c - n / 8.0 * 1.15);
    gl_FragColor = vec4(p * smoothstep(threshold, threshold + 0.3, max(p.r, max(p.g, p.b))), 1.0);
  }`, { texel: { value: new THREE.Vector2() }, threshold: { value: 0.25 } });

// Glints and streaks, from the points: each drawn out into a six-pointed star
// (a cross-screen filter's, a mirrorball's), and into long horizontal streaks,
// faintly blue (an anamorphic lens's). Added to the frame after.
const flare = pass(/* glsl */`
  uniform vec2 texel;       // one pixel of tIn
  uniform float glints, streaks, spin;
  vec3 bright(vec2 uv) { return texture2D(tIn, uv).rgb; }
  void main() {
    vec3 acc = vec3(0.0);
    if (glints > 0.0) {
      for (int a = 0; a < 3; a++) {
        float ang = spin + float(a) * 1.0471976;
        vec2 dir = vec2(cos(ang), sin(ang)) * texel * (res.y / 360.0);
        for (int k = 1; k <= 14; k++) {
          float w = pow(0.8, float(k));
          acc += (bright(vUv + dir * float(k)) + bright(vUv - dir * float(k))) * w;
        }
      }
      acc *= 0.9 * glints;
    }
    if (streaks > 0.0) {
      vec3 s = vec3(0.0);
      vec2 dir = vec2(texel.x * res.y / 180.0, 0.0);
      for (int k = 1; k <= 24; k++) {
        float w = pow(0.88, float(k));
        s += (bright(vUv + dir * float(k)) + bright(vUv - dir * float(k))) * w;
      }
      acc += s * vec3(0.55, 0.75, 1.25) * 0.9 * streaks;
    }
    gl_FragColor = vec4(acc, 1.0);
  }`, { texel: { value: new THREE.Vector2() }, glints: { value: 0 }, streaks: { value: 0 }, spin: { value: 0 } });
const addFlare = pass(/* glsl */`
  uniform sampler2D tFlare;
  void main() { gl_FragColor = vec4(texture2D(tIn, vUv).rgb + texture2D(tFlare, vUv).rgb, 1.0); }
`, { tFlare: { value: null } });

// ─── The look ─────────────────────────────────────────────────────────────────
// The frame folded into a pattern, one look dissolving into the next. All of
// them hear the music as the live kaleidoscope does (post.js): the kick
// punches the pattern outward, the snare twists it, the bass ripples it, and
// each chord glides the slice it mirrors to its root's place on the circle of
// fifths. The tiles are mirror-symmetric cells (square ones with four mirror
// lines, hexagonal ones with six), which meet without seams; the tunnel maps
// the frame onto rings that fall endlessly inward (log-polar, mirrored from
// ring to ring).
const fold = pass(/* glsl */`
  uniform float lookA, lookB, mixAB, wedgesA, wedgesB;
  uniform float angle, sweep, zoom, ripple, phase, tile, depth, twist;
  uniform vec2 planetUv;   // where the planet is, and
  uniform float planetR;   // how big its cages look (screen heights)
  uniform sampler2D tHeld;
  vec4 src(vec2 uv) { return texture2D(tIn, uv); }
  // A mirrored wedge of n round a centre: the point's distance kept, its angle
  // folded (the folds turned by spin), then turned to the slice it mirrors.
  vec2 wedge(vec2 p, float n, float spin) {
    float r = length(p), w = 6.28318531 / n;
    float a = mod(atan(p.y, p.x) + spin, w);
    a = min(a, w - a) + sweep;
    return r * vec2(cos(a), sin(a));
  }
  vec2 hexCentre(vec2 p) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec4 c = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - c.xy * s, p - (c.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? c.xy * s : (c.zw + 0.5) * s;
  }
  vec2 lookAt(float look, float n, vec2 p) {
    if (look < 0.5) return fromCentred(p);                          // the orrery
    if (look < 1.5) return fromCentred(wedge(p, n, angle));         // kaleidoscope
    if (look < 3.5) {                                               // squares, hexagons
      // The cells' own mirrors stay square to the grid, or they'd stop meeting.
      vec2 q = rot(angle * 0.3) * p * tile;
      vec2 c = look < 2.5 ? floor(q) + 0.5 : hexCentre(q);
      // Each cell mirrors a slice of the cages -- their wires, not the white of
      // the core, nor the empty sky past them, whichever way the slice points --
      // sized to the planet however near the camera is, and gliding round it
      // with the chord.
      vec2 s = wedge(q - c, look < 2.5 ? 4.0 : 6.0, 0.0) * 1.1 * planetR + 0.45 * planetR * vec2(cos(sweep), sin(sweep));
      return planetUv + s / vec2(aspect, 1.0);
    }
    if (look < 4.5) return fromCentred(vec2(abs(p.x), p.y));         // mirror
    float r = max(length(p), 1e-4), period = 1.3862944;             // tunnel: each ring 4× the next
    float lr = mod(log(r) + depth, 2.0 * period);
    lr = lr > period ? 2.0 * period - lr : lr;
    float th = atan(p.y, p.x) + angle + twist * lr;
    return fromCentred(0.11 * exp(lr) * vec2(cos(th), sin(th)));
  }
  void main() {
    vec2 p = centred(vUv);
    float r = length(p);
    p *= zoom * (1.0 + ripple * sin(r * 40.0 - phase));
    vec4 c = src(mirrored(lookAt(lookB, wedgesB, p)));
    if (mixAB < 1.0) c = mix(src(mirrored(lookAt(lookA, wedgesA, p))), c, smoothstep(0.0, 1.0, mixAB));
    gl_FragColor = c;
  }`, {
  lookA: { value: 0 }, lookB: { value: 0 }, mixAB: { value: 1 }, wedgesA: { value: 6 }, wedgesB: { value: 6 },
  angle: { value: 0 }, sweep: { value: 0 }, zoom: { value: 1 }, ripple: { value: 0 }, phase: { value: 0 },
  tile: { value: 2.5 }, depth: { value: 0 }, twist: { value: 0.35 },
  planetUv: { value: new THREE.Vector2(0.5, 0.5) }, planetR: { value: 0.2 },
});

// ─── Lens passes ──────────────────────────────────────────────────────────────

const aberration = pass(/* glsl */`
  uniform float spread;
  void main() {
    vec2 d = vUv - 0.5;
    float k = spread * (0.3 + dot(d, d) * 3.0);
    gl_FragColor = vec4(texture2D(tIn, 0.5 + d * (1.0 + k)).r, texture2D(tIn, vUv).g,
                        texture2D(tIn, 0.5 + d * (1.0 - k)).b, 1.0);
  }`, { spread: { value: 0 } });

// Glitch: bands of the picture torn sideways, their colours slipping apart,
// some blown up into blocks -- a new tear each time it fires.
const glitch = pass(/* glsl */`
  uniform float seed;
  void main() {
    vec2 uv = vUv;
    float rows = 6.0 + floor(hash(vec2(seed, 3.0)) * 30.0);
    float row = floor(uv.y * rows);
    float torn = step(1.0 - 0.7 * amount, hash(vec2(row, seed)));
    uv.x += torn * (hash(vec2(row, seed + 1.0)) - 0.5) * 0.25 * amount;
    float blocky = torn * step(0.6, hash(vec2(row, seed + 2.0)));
    vec2 cell = vec2(aspect, 1.0) * (20.0 + 60.0 * hash(vec2(row, seed + 4.0)));
    uv = mix(uv, (floor(uv * cell) + 0.5) / cell, blocky);
    float slip = (0.004 + 0.02 * torn) * amount;
    gl_FragColor = vec4(texture2D(tIn, fract(uv + vec2(slip, 0.0))).r, texture2D(tIn, fract(uv)).g,
                        texture2D(tIn, fract(uv - vec2(slip, 0.0))).b, 1.0);
  }`, { seed: { value: 0 } });

// CRT: a curved tube, scanlines and an aperture grille, and a glow -- the
// same number of lines however large the video.
const crt = pass(/* glsl */`
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    q *= 1.0 + amount * 0.06 * dot(q, q);
    vec2 uv = q * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 c = texture2D(tIn, uv).rgb;
    vec3 glow = (texture2D(tIn, uv + vec2(2.0, 0.0) / res).rgb + texture2D(tIn, uv - vec2(2.0, 0.0) / res).rgb) * 0.5;
    c = max(c, glow * 0.8);
    float line = 0.5 + 0.5 * cos(uv.y * 270.0 * 6.28318531);
    c *= mix(1.0, 0.55 + 0.6 * line, amount);
    float sub = mod(floor(gl_FragCoord.x / max(1.0, res.y / 1080.0)), 3.0);
    vec3 mask = sub < 1.0 ? vec3(1.0, 0.7, 0.7) : sub < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
    c *= mix(vec3(1.0), mask * 1.2, amount * 0.6);
    c *= 1.0 - amount * 0.5 * pow(length(q) * 0.72, 4.0);
    gl_FragColor = vec4(c, 1.0);
  }`);

// VHS: the colour smeared sideways past the picture (chroma has a fraction of
// a tape's bandwidth), the lines wobbling, a tracking band rolling up, noise.
const vhs = pass(/* glsl */`
  vec3 yiq(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
  vec3 rgb(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * c; }
  void main() {
    vec2 uv = vUv;
    float band = fract(time * 0.07);
    float inBand = smoothstep(0.04, 0.0, abs(uv.y - band));
    uv.x += amount * (0.0015 * sin(uv.y * 300.0 + time * 7.0) + 0.012 * inBand * (hash(vec2(floor(uv.y * 200.0), floor(time * 30.0))) - 0.5));
    float px = 1.0 / res.x * (res.y / 480.0);
    vec3 y = yiq(texture2D(tIn, uv).rgb);
    vec2 iq = vec2(0.0);
    for (int k = -4; k <= 4; k++) iq += yiq(texture2D(tIn, uv + vec2(float(k) * 3.0 * px + 4.0 * px, 0.0)).rgb).yz;
    vec3 c = rgb(vec3(y.x, mix(y.yz, iq / 9.0, amount)));
    float n = hash(vUv * res + floor(time * 30.0));
    c += amount * ((n - 0.5) * 0.06 + inBand * n * 0.15);
    c = mix(c, c * vec3(1.05, 0.98, 0.9), amount * 0.6);
    gl_FragColor = vec4(c, 1.0);
  }`);

// Film: grain (more in the mid-tones, as on stock), a red glow round the
// highlights (halation), the frame weaving in the gate, lifted blacks, a vignette.
const film = pass(/* glsl */`
  uniform vec2 weave;
  void main() {
    vec2 uv = vUv + weave * amount;
    vec3 c = texture2D(tIn, uv).rgb;
    vec3 halo = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996323, f = (float(i) + 0.5) / 16.0;
      vec3 h = texture2D(tIn, uv + vec2(cos(a) / aspect, sin(a)) * 0.008 * sqrt(f)).rgb;
      halo += h * smoothstep(0.7, 1.0, luma(h));
    }
    c += halo / 16.0 * vec3(0.9, 0.25, 0.08) * amount;
    float l = luma(c);
    float g = hash(vUv * res + fract(time) * 100.0) - 0.5;
    c += g * amount * 0.12 * (1.0 - abs(l * 2.0 - 1.0) * 0.7);
    c = mix(c, 0.035 + c * 0.95, amount);
    vec2 d = vUv - 0.5;
    c *= 1.0 - amount * 0.45 * dot(d, d) * 2.5;
    gl_FragColor = vec4(c, 1.0);
  }`, { weave: { value: new THREE.Vector2() } });

// Grade: a colour treatment. Lift, gamma and gain per channel and saturation,
// then optionally two-tone (duotone, from shadow to highlight colour), and
// optionally everything grey but the colours near one hue (the chord root's).
export const GRADES = {
  neutral: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1.1 },
  cool:    { lift: [0, 0.01, 0.03], gamma: [0.95, 1, 1.08], gain: [0.92, 1, 1.1], sat: 0.85 },
  warm:    { lift: [0.03, 0.015, 0], gamma: [1.08, 1, 0.92], gain: [1.08, 1, 0.88], sat: 1.15 },
  neon:    { lift: [0.02, 0, 0.04], gamma: [1, 0.92, 1.05], gain: [1.1, 0.9, 1.15], sat: 1.35, duo: [[0.05, 0.0, 0.12], [1.0, 0.35, 0.85]], duoMix: 0.35 },
  teal:    { lift: [0, 0.02, 0.03], gamma: [1.05, 1, 0.95], gain: [1.1, 1, 0.9], sat: 1.05, duo: [[0.0, 0.08, 0.1], [1.0, 0.75, 0.5]], duoMix: 0.3 },
  mono:    { lift: [0.01, 0.01, 0.01], gamma: [1, 1, 1], gain: [1.05, 1.05, 1.05], sat: 1, accent: 1 },
  dream:   { lift: [0.022, 0.018, 0.035], gamma: [1.08, 1.04, 1.08], gain: [1, 0.98, 1.02], sat: 0.85 },
};
const grade = pass(/* glsl */`
  uniform vec3 lift, gamma, gain, duoA, duoB;
  uniform float sat, duoMix, accent, accentHue;
  vec3 hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  void main() {
    vec3 o = texture2D(tIn, vUv).rgb, c = o;
    c = pow(max(vec3(0.0), c * gain + lift * (1.0 - c)), 1.0 / gamma);
    float l = luma(c);
    c = mix(vec3(l), c, sat);
    c = mix(c, mix(duoA, duoB, smoothstep(0.0, 0.9, l)) * (0.4 + 0.8 * l), duoMix);
    if (accent > 0.0) {
      vec3 h = hsv(o);
      float dh = abs(fract(h.x - accentHue + 0.5) - 0.5);
      float keep = exp(-dh * dh / 0.004) * smoothstep(0.15, 0.4, h.y);
      c = mix(c, mix(vec3(l), c, keep), accent);
    }
    gl_FragColor = vec4(mix(o, c, amount), 1.0);
  }`, {
  lift: { value: new THREE.Vector3() }, gamma: { value: new THREE.Vector3(1, 1, 1) }, gain: { value: new THREE.Vector3(1, 1, 1) },
  sat: { value: 1 }, duoA: { value: new THREE.Vector3() }, duoB: { value: new THREE.Vector3(1, 1, 1) }, duoMix: { value: 0 },
  accent: { value: 0 }, accentHue: { value: 0 },
});

// ─── Finish ───────────────────────────────────────────────────────────────────
// Letterbox bars (to 2.39:1), a flash, a fade to black, the titles over it,
// and a dither of half a level, so dark gradients don't band in the encode.
const finish = pass(/* glsl */`
  uniform float bars, flash, fade, titleAlpha, titleDim;
  uniform vec3 flashColour;
  uniform sampler2D tTitles;
  void main() {
    vec3 c = texture2D(tIn, vUv).rgb;
    c = c + flash * flashColour * (0.35 + 0.65 * c);
    float edge = bars * 0.5;
    c *= step(edge, vUv.y) * step(edge, 1.0 - vUv.y);
    c *= 1.0 - fade;
    vec4 t = texture2D(tTitles, vUv);
    c *= 1.0 - titleDim * titleAlpha; // the picture steps back behind a card in the middle
    c = mix(c, t.rgb, t.a * titleAlpha);
    c += (hash(vUv * res + fract(time) * 61.0) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`, {
  bars: { value: 0 }, flash: { value: 0 }, fade: { value: 0 }, titleAlpha: { value: 0 }, titleDim: { value: 0 },
  flashColour: { value: new THREE.Vector3(1, 1, 1) }, tTitles: { value: null },
});

// Motion blur: a frame as the average of several moments across it (see
// video/stage.js), summed here before the bloom.
const accumulate = pass(/* glsl */`
  void main() { gl_FragColor = vec4(texture2D(tIn, vUv).rgb * amount, 1.0); }
`, {}, THREE.AdditiveBlending);
const copyOut = pass(/* glsl */`
  void main() { gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }
`);

// ─── Targets ──────────────────────────────────────────────────────────────────
const ping = target(), pong = target(), quarter = target(), quarterBlur = target(), half = target(), half2 = target();
const history = [target(), target()], sum = target(), skySum = target();
// The sky drawn on its own, for the lens: 8-bit display values, as the scene's frame is (post.js).
const skyFrame = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
const size = new THREE.Vector2();
const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;

function resize() {
  renderer.getDrawingBufferSize(size);
  for (const t of [ping, pong, sum, skySum, skyFrame]) t.setSize(size.x, size.y);
  // The trails are the picture's past, which a new size mustn't wipe (a still
  // drawn at another size, see stage.js): each carried over, scaled.
  for (let i = 0; i < history.length; i++) {
    const was = history[i];
    if (was.width === size.x && was.height === size.y) continue;
    const next = target();
    next.setSize(size.x, size.y);
    if (trailsOn) run(copyOut, was.texture, next);
    was.dispose();
    history[i] = next;
  }
  renderer.initRenderTarget(skyFrame); // the screen is copied straight into its texture
  for (const t of [quarter, quarterBlur]) t.setSize(Math.max(1, size.x >> 2), Math.max(1, size.y >> 2));
  for (const t of [half, half2]) t.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
}

// ─── Each frame ───────────────────────────────────────────────────────────────
let time = 0, drift = 0, root = 0, angle = 0, phase = 0, depth = 0, spin = 0;
let trailTurn = 0, trailSign = 1, lastChord = '';
let tear = 0, tearSeed = 0, trailsOn = false;
let wedges = { from: 6, to: 6 }, lastTo = null;
resizeHandlers.push(resize); // (after the state above: resizing reads trailsOn)
resize();
const turnTo = (from, to) => ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
const _v = new THREE.Vector3();

// Where the planet is on the screen (uv), and how big its cages look (screen heights).
function planet() {
  camera.updateMatrixWorld(); // this frame's camera (the render would only update it after)
  _v.set(0, 0, 0).project(camera);
  const dist = camera.position.length();
  const r = 1.55 / (dist * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  return { x: _v.x * 0.5 + 0.5, y: _v.y * 0.5 + 0.5, r, behind: _v.z > 1 };
}

function run(q, input, output, uniforms = {}) {
  const u = q.material.uniforms;
  u.tIn.value = input;
  u.res.value.set(output ? output.width : size.x, output ? output.height : size.y);
  u.aspect.value = size.x / size.y;
  u.time.value = time;
  for (const k in uniforms) {
    if (u[k].value?.set && Array.isArray(uniforms[k])) u[k].value.set(...uniforms[k]);
    else u[k].value = uniforms[k];
  }
  renderer.setRenderTarget(output);
  q.render(renderer);
}

// A flash is the chord root's colour, pale (as the moons draw it, lighter).
const _flash = new THREE.Color();
function flashTint() {
  const palette = ((state.rootMidi % 12) * 15 + 180 + state.era * 40) % 360;
  _flash.setHSL((music.chord.length ? pcHue(music.chord[0], palette) : palette) / 360, 0.6, 0.8);
  return [_flash.r, _flash.g, _flash.b];
}

// The scene in two, for the lens: the sky alone into skyFrame, and the rest
// into the scene's frame. Additive light, so the two add up to the whole.
function drawSplit() {
  const was = scene.children.map(o => o.visible);
  scene.children.forEach((o, i) => { o.visible = was[i] && !!o.userData.sky; });
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  renderer.copyFramebufferToTexture(skyFrame.texture);
  scene.children.forEach((o, i) => { o.visible = was[i] && !o.userData.sky; });
  drawScene();
  scene.children.forEach((o, i) => { o.visible = was[i]; });
}
const lensing = P => fx.lens > 0 && !P.behind;
const lensUniforms = P => ({ centre: [P.x, P.y], einstein: P.r * (1.15 + 0.5 * music.roleLevel.bass + 0.3 * music.hits.kick), amount: fx.lens });

// Every pass drawn once, into a scrap target, so each shader is compiled
// before it's needed: otherwise the first time a look or an effect appears,
// the preview stalls while the GPU compiles it.
const ALL_PASSES = [trails, lens, shock, down, defocusBlur, defocusMix, points, flare, addFlare, fold,
  aberration, glitch, crt, vhs, film, grade, finish, accumulate, copyOut];
function warmPasses() {
  const scrap = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  for (const q of ALL_PASSES) {
    for (const u of Object.values(q.material.uniforms)) if (u.value === null) u.value = blank;
    run(q, blank, scrap);
  }
  scrap.dispose();
}

export const chain = {
  warm: warmPasses,

  blurred: false, // the scene was summed for motion blur this frame (see sumScene)
  summedSky: false,

  // Motion blur: the scene drawn now, as part `i` of `n` of this frame.
  sumScene(i, n) {
    const split = lensing(planet());
    if (split) drawSplit(); else drawScene();
    const wasAuto = renderer.autoClear;
    if (i === 0) for (const t of [sum, skySum]) { renderer.setRenderTarget(t); renderer.clear(); }
    renderer.autoClear = false;
    run(accumulate, sceneFrame.texture, sum, { amount: 1 / n });
    if (split) run(accumulate, skyFrame.texture, skySum, { amount: 1 / n });
    renderer.autoClear = wasAuto;
    if (i === 0) chain.summedSky = split;
    chain.blurred = i === n - 1;
  },

  render(dt) {
    time += dt;
    const P = planet();
    // The scene (lensed, if the lens is on), then its bloom.
    if (chain.blurred) {
      if (chain.summedSky) run(lens, skySum.texture, ping, { tFg: sum.texture, ...lensUniforms(P) });
      run(copyOut, chain.summedSky ? ping.texture : sum.texture, sceneFrame);
      chain.blurred = false;
    } else if (lensing(P)) {
      drawSplit();
      run(lens, skyFrame.texture, ping, { tFg: sceneFrame.texture, ...lensUniforms(P) });
      run(copyOut, ping.texture, sceneFrame);
    } else drawScene();
    addBloom(dt);

    const { hits, roleLevel } = music;
    let cur = sceneFrame.texture, flip = false;
    const next = () => (flip = !flip) ? ping : pong;

    // Trails
    const chordKey = music.chord.join();
    if (chordKey !== lastChord) { if (lastChord) trailSign = -trailSign; lastChord = chordKey; }
    if (fx.trails > 0) {
      const tau = 0.12 + 1.1 * fx.trails;
      trailTurn += (trailSign * (0.05 + 0.1 * fx.trails) - trailTurn) * (1 - Math.exp(-dt / 1.5));
      const [a, b] = history;
      run(trails, cur, b, {
        tPrev: a.texture, decay: Math.exp(-dt / tau),
        zoom: Math.exp(dt * (0.03 + 0.2 * roleLevel.bass + 0.2 * hits.kick) * fx.trails), turn: trailTurn * dt,
      });
      history.reverse();
      cur = b.texture;
      trailsOn = true;
    } else if (trailsOn) {
      for (const t of history) { renderer.setRenderTarget(t); renderer.clear(); }
      trailsOn = false;
    }

    if (fx.shock > 0 && !P.behind) {
      const waves = shock.material.uniforms.waves.value;
      let n = 0;
      for (let i = music.strikes.length - 1; i >= 0 && n < KICK_WAVES; i--) {
        const s = music.strikes[i];
        if (s.kind !== 'kick' || s.age > 1.2) continue;
        waves[n++].set(P.r * 1.2 + s.age * 1.1, s.vel * fx.shock * Math.exp(-s.age / 0.45), 0.035 + s.age * 0.05, 0);
      }
      while (n < KICK_WAVES) waves[n++].set(0, 0, 0.05, 0);
      const out = next();
      run(shock, cur, out, { centre: [P.x, P.y] });
      cur = out.texture;
    }

    if (fx.defocus > 0.002) {
      run(down, cur, quarter, { texel: [1 / size.x, 1 / size.y] });
      run(defocusBlur, quarter.texture, quarterBlur, { radius: 0.008 + 0.035 * fx.defocus });
      const out = next();
      run(defocusMix, cur, out, { tBlur: quarterBlur.texture, amount: Math.min(0.6, fx.defocus * 0.9) });
      cur = out.texture;
    }

    if (fx.glints > 0 || fx.streaks > 0) {
      spin += dt * 0.15;
      const px = size.y / 1080;
      run(points, cur, half, { texel: [4 * px / size.x, 4 * px / size.y], threshold: 0.12 });
      run(flare, half.texture, half2, {
        texel: [2 / size.x, 2 / size.y], glints: fx.glints * (0.6 + 0.8 * hits.hat), streaks: fx.streaks * (0.7 + 0.6 * roleLevel.lead), spin,
      });
      const out = next();
      run(addFlare, cur, out, { tFlare: half2.texture });
      cur = out.texture;
    }

    // The look.
    const look = fx.look;
    if (look.to !== lastTo) {
      wedges = { from: wedges.to, to: 3 + (wedges.to - 3 + 1 + Math.floor(Math.random() * 3)) % 4 };
      lastTo = look.to;
    }
    angle = (angle + (0.05 + 1.2 * hits.snare) * dt) % (Math.PI * 2);
    drift = (drift - 0.12 * dt) % (Math.PI * 2);
    if (music.chord.length) root += turnTo(root, pcAngle(music.chord[0])) * (1 - Math.exp(-dt / 0.5));
    phase = (phase + 8 * dt) % (Math.PI * 2);
    depth += dt * fx.tunnel;
    if (look.from !== 'orrery' || look.to !== 'orrery') {
      const out = next();
      run(fold, cur, out, {
        lookA: LOOKS.indexOf(look.from), lookB: LOOKS.indexOf(look.to), mixAB: look.mix,
        wedgesA: wedges.from, wedgesB: wedges.to, angle, sweep: drift + root,
        zoom: 1 - 0.1 * Math.max(hits.kick, 0.6 * hits.crash), ripple: 0.03 * roleLevel.bass, phase,
        tile: 2.5, depth, twist: 0.35,
        planetUv: P.behind ? [0.5, 0.5] : [P.x, P.y], planetR: Math.min(0.5, Math.max(0.05, P.r)),
      });
      cur = out.texture;
    }

    if (fx.aberration > 0) {
      const out = next();
      run(aberration, cur, out, { spread: fx.aberration * (0.004 + 0.016 * hits.kick + 0.008 * hits.snare) });
      cur = out.texture;
    }

    // A new tear on each snare (and now and then besides), lasting a moment.
    tear = Math.max(tear * Math.exp(-dt / 0.08), hits.snare > 0.6 ? 1 : 0);
    // (Only as time moves on: a frame drawn again is the same frame.)
    if (dt > 0 && (hits.snare > 0.6 || Math.random() < dt * 2)) tearSeed = Math.random() * 100;
    const glitchAmount = fx.glitch * Math.min(1, 0.15 + tear);
    if (glitchAmount > 0.01) {
      const out = next();
      run(glitch, cur, out, { amount: glitchAmount, seed: tearSeed });
      cur = out.texture;
    }

    for (const [q, amt, extra] of [[crt, fx.crt], [vhs, fx.vhs],
      [film, fx.film, { weave: [Math.sin(time * 3.1) * 0.0007 + Math.sin(time * 7.3) * 0.0004, Math.sin(time * 2.3) * 0.0009] }]]) {
      if (amt <= 0) continue;
      const out = next();
      run(q, cur, out, { amount: amt, ...extra });
      cur = out.texture;
    }

    if (fx.grade > 0) {
      const g = GRADES[fx.gradeKind] ?? GRADES.neutral;
      const palette = ((state.rootMidi % 12) * 15 + 180 + state.era * 40) % 360; // as animate.js's
      const hueOf = music.chord.length ? pcHue(music.chord[0], palette) : palette;
      const out = next();
      run(grade, cur, out, {
        amount: fx.grade, lift: g.lift, gamma: g.gamma, gain: g.gain, sat: g.sat,
        duoA: g.duo?.[0] ?? [0, 0, 0], duoB: g.duo?.[1] ?? [1, 1, 1], duoMix: g.duoMix ?? 0,
        accent: g.accent ?? 0, accentHue: hueOf / 360,
      });
      cur = out.texture;
    }

    run(finish, cur, null, {
      bars: fx.letterbox * (1 - (size.x / size.y) / 2.39) * (size.x / size.y > 1.2 ? 1 : 0),
      flash: Math.min(1, fx.flash), flashColour: flashTint(), fade: Math.min(1, fx.fade),
      tTitles: fx.titles ?? blank, titleAlpha: fx.titles ? fx.titleAlpha : 0, titleDim: fx.titleDim ?? 0,
    });
  },
};
