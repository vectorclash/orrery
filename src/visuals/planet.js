import * as THREE from 'three';
import { scene } from './scene.js';
import { music, fifths, pcAngle, pcHue } from './music.js';
import { spectrum, BANDS } from './spectrum.js';
import { PLANET_R, GLSL_SUN } from './ring/common.js';

// ─── Gas giant ────────────────────────────────────────────────────────────────
// The planet is a procedural atmosphere, everything computed per pixel:
//
//   bands    light zones and darker belts by latitude, unevenly spaced. Each
//            latitude turns at its own rate (alternating jets), so neighbouring
//            bands shear past each other; the flow speeds up with the music's
//            energy and bass.
//   flow     the clouds are warped twice, at shrinking scales and mostly along
//            the bands, so fine filaments wrap round larger eddies. Where bands
//            meet, rows of curling waves (Kelvin–Helmholtz billows) run along
//            the boundary, growing with that latitude's part of the spectrum.
//   spectrum each latitude listens to one band of the spectrum, low at the
//            equator to high at the poles; a loud band brightens and churns.
//   colour   light, near-neutral bands that take their hue from the chord: the
//            root tints the zones, the other tones the belts and highlights,
//            with slow hue drift across the clouds. Louder music saturates it.
//   poles    a hexagonal jet round the north pole, a ring of cyclones round the
//            south.
//   storms   each chord tone keeps a vortex on the side facing its moon (same
//            directions as chord.js), spinning harder while the tone sounds,
//            fading when the chord moves on.
//   ripples  note onsets send rings across the clouds from the pitch's
//            direction (high notes start near the top), bending the bands.
//   drums    the kick thumps the planet and flashes the clouds; the haze round
//            the limb breathes with the bass.
//
// Lighting: a fixed sun (ring/common.js), so the camera's orbit passes from the
// day side to a backlit crescent. Cloud tops have relief — the cloud structure
// doubles as a height map that tilts the shading per pixel — the terminator is
// warm and dim, the limb hazy and bluish, and the ring casts its shadow across
// the planet. Storms and ripples also glow on their own, so the music still
// shows on the night side, like lightning, and sunlight scattered off the
// ring (ringshine) fills the night side with a cool light. Noise octaves finer than a couple of
// pixels fade out, so the limb doesn't shimmer as the clouds move.
//
// Colours are display values, like the rest of the scene's shaders. The planet
// is opaque, so the ring's far side and the cages' back halves pass behind it.

const TINT = 0.6;            // how far the chord pulls the near-neutral base palette
const STORMS = 6, RIPPLES = 8;
const BUMP = 0.012;          // cloud-top relief

const NOISE = /* glsl */`
  // 3D simplex noise — Ian McEwan, Stefan Gustavson (Ashima Arts), MIT.
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x  = x_ * ns.x + ns.yyyy;
    vec4 y  = y_ * ns.x + ns.yyyy;
    vec4 h  = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x), p1 = vec3(a0.zw, h.y), p2 = vec3(a1.xy, h.z), p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  // Fractal noise that drops octaves finer than about two pixels. fw is the
  // pixel footprint in the noise's own coordinates (scale × surface footprint).
  float fbm(vec3 p, float fw, int octaves) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      float k = 1.0 - smoothstep(0.3, 0.7, fw);
      if (k <= 0.0) break;
      s += a * k * snoise(p);
      p = p * 2.07 + vec3(1.7, 9.2, 3.1); fw *= 2.07; a *= 0.5;
    }
    return s;
  }
  // Rotate a colour's hue by a radians, about the grey axis.
  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float co = cos(a), si = sin(a);
    return c * co + cross(k, c) * si + k * dot(k, c) * (1.0 - co);
  }
  float hash(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
  // Rotate p about the unit axis k by angle a (Rodrigues).
  vec3 rotAbout(vec3 p, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c);
  }
`;

const planetMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:     { value: 0 },
    uFlow:     { value: 0 },
    uKick:     { value: 0 },
    uBass:     { value: 0 },
    uSpec:     { value: new Float32Array(BANDS) },
    uZone:     { value: new THREE.Color(0.9, 0.91, 0.93) },
    uBelt:     { value: new THREE.Color(0.56, 0.6, 0.67) },
    uAccent:   { value: new THREE.Color(0.8, 0.84, 0.9) },
    uStorm:    { value: Array.from({ length: STORMS }, () => new THREE.Vector4()) }, // centre, strength
    uStormCol: { value: Array.from({ length: STORMS }, () => new THREE.Color()) },
    uRip:      { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4()) }, // origin, ring radius (rad)
    uRipAmp:   { value: new Float32Array(RIPPLES) },
  },
  vertexShader: /* glsl */`
    varying vec3 vPos, vNormal, vWorld;
    void main() {
      vPos = normalize(position);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime, uFlow, uKick, uBass;
    uniform vec3 uZone, uBelt, uAccent;
    uniform float uSpec[${BANDS}];
    uniform vec4 uStorm[${STORMS}];
    uniform vec3 uStormCol[${STORMS}];
    uniform vec4 uRip[${RIPPLES}];
    uniform float uRipAmp[${RIPPLES}];
    varying vec3 vPos, vNormal, vWorld;
    ${GLSL_SUN}
    ${NOISE}
    const vec3 Y = vec3(0.0, 1.0, 0.0);

    // Latitude → band coordinate, unevenly spaced so bands vary in width.
    float bandsAt(float y) { return y * 9.0 + 0.9 * sin(y * 3.7 + 0.4) + 0.45 * sin(y * 8.3 + 2.0); }
    float isZone(float id) { return mod(id, 2.0) < 1.0 ? 1.0 : 0.25 * step(0.7, hash(id)); }

    // A band's shade: even bands are zones, odd ones belts, each varied.
    vec3 bandColor(float id) {
      float h = hash(id), g = hash(id + 17.0);
      vec3 zone = mix(uZone, uAccent, 0.35 * g) * (0.9 + 0.15 * h);
      vec3 belt = mix(uBelt, uBelt * 0.72, h) * (0.92 + 0.16 * g);
      return mix(belt, zone, isZone(id));
    }

    // Spectrum at |latitude| (0 equator … 1 pole), interpolated between bands.
    float spectrum(float a) {
      float x = clamp(a, 0.0, 1.0) * float(${BANDS - 1});
      int i = int(x);
      return mix(uSpec[i], uSpec[min(i + 1, ${BANDS - 1})], fract(x));
    }

    // One evaluation of the cloud layer. shear is how far (in flow radians)
    // the jets have offset each latitude from the rest; see main().
    vec3 clouds(vec3 p, float shear, float rip, float px,
                out float zone, out float streak, out float wy, out float detail, out float kh, out float d) {
      vec3 col;
      // Zonal jets: the whole atmosphere turns with the flow, and each
      // latitude adds its own offset on top — the shear between bands.
      float lat = p.y;
      float jet = 0.6 * sin(lat * 10.0) + 0.15 * sin(lat * 23.0 + 1.3);
      vec3 q = rotAbout(p, Y, uFlow + jet * shear);
      float sb = spectrum(abs(lat) * 1.15);
      // Shear stretches the clouds across rows of pixels, too: widen the
      // footprint by it, so octaves that would alias fade out.
      float jetSlope = 6.0 * cos(lat * 10.0) + 3.45 * cos(lat * 23.0 + 1.3);
      px *= 1.0 + abs(jetSlope) * shear;

      // Flow: two warps at shrinking scales, along the bands (no vertical
      // part), so fine filaments wrap round the larger eddies.
      float t4 = uTime * 0.04;
      vec3 q1 = q + 0.1 * vec3(fbm(q * 1.8 + vec3(0.0, 0.0, t4), px * 1.8, 3), 0.0,
                               fbm(q * 1.8 + vec3(5.2, 1.3, t4), px * 1.8, 3));
      vec3 q2 = q1 + 0.035 * vec3(fbm(q1 * 4.5 + vec3(2.1, 7.7, t4 * 1.6), px * 4.5, 3), 0.0,
                                  fbm(q1 * 4.5 + vec3(8.3, 3.1, t4 * 1.6), px * 4.5, 3));
      wy = fbm(q2 * 2.6 + vec3(3.3, 0.0, t4), px * 2.6, 3);   // the wobble that bends the bands

      // Bands. Turbulence lives mostly at the edges between them and grows
      // with the band's frequencies and the kick.
      float y0 = bandsAt(lat + 0.012 * wy + 0.03 * rip);
      float edge = 1.0 - abs(fract(y0) * 2.0 - 1.0);               // 1 mid-band, 0 at edges
      float churn = (0.025 + 0.07 * sb + 0.03 * uKick) * (1.0 - 0.75 * edge);
      float y = lat + churn * wy + 0.03 * rip;
      float band = bandsAt(y) + 0.18 * fbm(vec3(q2.x * 1.6, y * 5.0, q2.z * 1.6), px * 5.0, 3);
      float bandPx = fwidth(band);                                  // bands per pixel: large where foreshortened

      // Billows along each band boundary: slanted, curling scallops. The slant
      // (phase change across the edge) times the amplitude stays under 1, so the
      // band coordinate never folds back on itself into aliasing slivers.
      float lon = atan(q2.z, q2.x);
      d = band - floor(band + 0.5);                           // signed distance to the nearest edge
      float waveAA = 1.0 - smoothstep(0.25, 0.6, px * 26.0 / max(sqrt(1.0 - lat * lat), 0.1));
      kh = (0.3 + 0.6 * sb) * exp(-d * d / 0.04) * waveAA * (1.0 - smoothstep(0.06, 0.2, bandPx));
      band += kh * 0.32 * sin(lon * 26.0 + d * 3.2 + hash(floor(band + 0.5)) * 6.283 + uFlow * 2.0);

      float id = floor(band), fr = fract(band);
      float mixB = smoothstep(min(0.72, 1.0 - 1.5 * bandPx), 1.0, fr);   // never sharper than ~1.5 px
      col = mix(bandColor(id), bandColor(id + 1.0), mixB);
      zone = mix(isZone(id), isZone(id + 1.0), mixB);

      // Fine streaks along the flow, small eddies, slow hue drift.
      streak = fbm(vec3(q2.x * 2.5, y * 40.0, q2.z * 2.5), px * 40.0, 4);
      detail = fbm(q2 * 9.0 + vec3(0.0, 0.0, t4 * 2.0), px * 9.0, 3);
      float drift = fbm(q1 * 1.2 + vec3(11.0, 4.0, t4 * 0.5), px * 1.2, 2);
      col *= 0.88 + 0.32 * streak + 0.14 * detail;
      col = mix(col, uAccent, smoothstep(0.3, 0.75, streak) * 0.25);
      col = hueShift(col, 0.45 * drift);
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, 1.0 + 0.35 * detail);               // saturation varies with the eddies
      col *= 0.8 * (0.9 + 0.3 * sb);                                  // the band's frequencies; lit zones stay under white
      return col;
    }

    void main() {
      vec3 p0 = normalize(vPos);
      float px = length(fwidth(p0));               // surface footprint of a pixel (unit sphere)
      vec3 p = p0;

      // South pole: a ring of five cyclones round a central one.
      float polar = 0.0;
      if (p0.y < -0.72) {
        for (int i = 0; i < 6; i++) {
          float a = float(i) * 1.2566 + uFlow * 0.25;
          vec3 c = i == 5 ? -Y : normalize(vec3(0.27 * cos(a), -0.963, 0.27 * sin(a)));
          vec3 d = p0 - c;
          float q = dot(d, d);
          p = rotAbout(p, c, 2.6 * exp(-q / 0.006));
          polar = max(polar, exp(-q / 0.0025));
        }
      }

      // Storms: compact ovals that swirl the clouds just round themselves,
      // with a dark collar; strength spins them up.
      float stormMask = 0.0, collar = 0.0;
      vec3 stormTint = vec3(0.0);
      for (int i = 0; i < ${STORMS}; i++) {
        vec3 c = uStorm[i].xyz;
        float w = uStorm[i].w;
        if (w < 0.002) continue;
        vec3 d = p0 - c;
        d.y *= 1.8;                                  // ovals, wider than tall
        float q = dot(d, d);
        p = rotAbout(p, c, w * exp(-q / 0.03) * 2.2 * sign(c.y + 0.001));
        float core = smoothstep(0.024, 0.006, q);     // a filled oval, soft-edged
        float rim = (sqrt(q) - 0.16) / 0.04;
        collar = max(collar, exp(-rim * rim) * w);
        stormMask = max(stormMask, core * w);
        stormTint += uStormCol[i] * core * w;
      }

      // Note onsets: rings spreading over the surface.
      float rip = 0.0;
      for (int i = 0; i < ${RIPPLES}; i++) {
        if (uRipAmp[i] < 0.002) continue;
        float th = acos(clamp(dot(p0, uRip[i].xyz), -1.0, 1.0));
        float x = (th - uRip[i].w) / 0.08;
        rip += uRipAmp[i] * exp(-x * x);
      }

      // The bands shear past each other, but the shear can't simply grow
      // forever: neighbouring rows of pixels would end up sampling clouds far
      // apart and the texture would tear into streaks. So the shear runs in
      // cycles and resets, with two copies of the cloud layer half a cycle
      // apart crossfading so each reset happens while that copy is hidden (a
      // flow map). The second copy is only computed during the crossfades.
      const float CYCLE = 0.45;                   // flow radians per shear cycle (the visible jet speed doesn't depend on it)
      float fA = fract(uFlow / CYCLE), fB = fract(uFlow / CYCLE + 0.5);
      float wA = smoothstep(0.0, 0.12, fA) * (1.0 - smoothstep(0.88, 1.0, fA));
      vec3 col = vec3(0.0);
      float zone = 0.0, streak = 0.0, wy = 0.0, detail = 0.0, khd = 0.0;
      float z_, s_, w_, de_, k_, d_;
      if (wA > 0.001) {                           // uniform across the frame, so derivatives stay valid
        col += wA * clouds(p, fA * CYCLE, rip, px, z_, s_, w_, de_, k_, d_);
        zone += wA * z_; streak += wA * s_; wy += wA * w_; detail += wA * de_; khd += wA * k_ * d_;
      }
      if (wA < 0.999) {
        float wB = 1.0 - wA;
        col += wB * clouds(p, fB * CYCLE, rip, px, z_, s_, w_, de_, k_, d_);
        zone += wB * z_; streak += wB * s_; wy += wB * w_; detail += wB * de_; khd += wB * k_ * d_;
      }
      float lat = p.y;

      // North pole: a hexagonal jet, a slightly bluer hexagon inside it.
      if (p.y > 0.6) {
        float rp = acos(clamp(p.y, -1.0, 1.0));
        float ap = atan(p.z, p.x) - uFlow * 0.6;
        float hexR = rp * 0.866 / cos(mod(ap + 0.5236, 1.0472) - 0.5236);
        float jetLine = exp(-pow((hexR - 0.42) / 0.03, 2.0));
        col *= 1.0 - 0.3 * jetLine;
        col = mix(col, hueShift(col, 0.4) * 0.92, smoothstep(0.45, 0.38, hexR) * 0.6);
      }
      col *= mix(1.0, 0.75, smoothstep(0.7, 0.98, abs(lat)));        // hazier poles
      col *= 1.0 - 0.4 * polar;                                       // dark cyclone eyes

      col *= 1.0 - 0.35 * collar;
      // Storm ovals take their tone's colour, keeping the cloud texture inside.
      vec3 stormCol = stormTint / max(stormMask, 0.001) * (0.75 + 0.35 * streak + 0.2 * wy);
      col = mix(col, stormCol, stormMask * 0.75);

      // Relief: the cloud structure as a height map. Zones and storms stand
      // high, belts and collars sit low; the shading normal tilts with its
      // screen-space slope, so no extra noise lookups are needed.
      float h = 0.5 * zone + 0.12 * detail + 0.5 * stormMask - 0.3 * collar + 0.3 * khd;
      vec3 n = normalize(vNormal);
      vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
      vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
      float det = dot(dpx, r1);
      vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
      vec3 nb = normalize(abs(det) * n - ${BUMP} * grad);          // height in world units = BUMP × h

      // Sunlight: a soft terminator that warms and dims, the ring's shadow.
      vec3 v = normalize(cameraPosition - vWorld);
      float mu = max(dot(n, v), 0.0);
      float ndl = dot(nb, SUN);
      float diff = clamp((ndl + 0.12) / 1.12, 0.0, 1.0) * (1.0 - ringShadow(vWorld));
      vec3 warm = mix(vec3(1.0, 0.7, 0.52), vec3(1.0), smoothstep(-0.05, 0.4, dot(n, SUN)));
      // Ringshine: sunlight scattered off the ring fills the night side with a
      // cool light, strongest low down, near the ring plane.
      float ringshine = 0.16 * (1.0 - smoothstep(-0.2, 0.3, dot(n, SUN))) * (0.6 + 0.4 * (1.0 - abs(n.y)));
      vec3 lit = col * (warm * (0.03 + 0.97 * diff) + vec3(0.75, 0.85, 1.0) * ringshine) * (0.62 + 0.38 * mu);

      // Haze: bluish at the limb, lit by the sun, glowing when backlit.
      vec3 haze = mix(uAccent, vec3(0.62, 0.76, 1.0), 0.5);
      float limb = pow(1.0 - mu, 2.5);
      float back = pow(max(dot(-v, SUN), 0.0), 3.0);
      lit = mix(lit, haze * (0.15 + 0.85 * max(dot(n, SUN), 0.0)), limb * 0.5);
      lit += haze * limb * (0.25 * uBass + 0.3 * uKick + 0.9 * back);

      // Music that glows by itself, so it shows on the night side too.
      float night = 1.0 - smoothstep(-0.1, 0.35, dot(n, SUN));
      lit += (uZone * 0.5 + stormTint) * rip * (0.3 + 0.4 * night)
           + stormTint * (0.08 + 0.22 * night)
           + col * uKick * (0.06 + 0.1 * night);
      lit *= 1.0 + 0.15 * uKick;
      gl_FragColor = vec4(lit, 1.0);
    }
  `,
});
const planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 160, 120), planetMat);
scene.add(planet);

// Haze beyond the limb: a larger back-faced shell, brightest just outside the
// planet's edge and fading to nothing at its own. Brighter on the sunlit side,
// and much brighter when the sun is behind the planet.
const hazeMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color() }, uGain: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vNormal, vView;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
      vView = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform float uGain;
    varying vec3 vNormal, vView;
    ${GLSL_SUN}
    void main() {
      vec3 n = normalize(vNormal), v = normalize(vView);
      float edge = pow(clamp(-dot(n, v) / 0.55, 0.0, 1.0), 3.0);
      float sun = 0.25 + 0.75 * max(dot(n, SUN), 0.0) + 1.5 * pow(max(dot(-v, SUN), 0.0), 4.0);
      gl_FragColor = vec4(uColor * uGain * edge * sun, 1.0);
    }
  `,
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const haze = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R * 1.2, 96, 64), hazeMat);
scene.add(haze);

// ─── Update ───────────────────────────────────────────────────────────────────
// Storm strength per pitch class, eased, so storms grow and fade rather than
// pop when the chord changes. Each pitch class has a fixed latitude.
const stormW = new Float32Array(12);
const stormLat = Array.from({ length: 12 }, (_, pc) => 0.42 * Math.sin(fifths(pc) * 2.3 + 0.6));
const RIPPLE_GAIN = { bass: 1.0, motion: 0.6, lead: 0.9, air: 0.7 };

let flow = 0;
const _c = new THREE.Color(), _base = new THREE.Color();
const PALE = new THREE.Color(0.9, 0.91, 0.93), SLATE = new THREE.Color(0.56, 0.6, 0.67);

export function updatePlanet({ energy, hue, dt, fade, t }) {
  const U = planetMat.uniforms;
  const chord = music.chord, hits = music.hits, roles = music.roleLevel;
  const ease = 1 - Math.exp(-dt / 0.6);

  // Flow: integrated, so speed follows the music without jumps.
  flow += dt * (0.045 + 0.09 * energy + 0.07 * roles.bass);
  U.uTime.value = t;
  U.uFlow.value = flow;
  U.uKick.value = hits.kick;
  U.uBass.value = roles.bass;

  for (let i = 0; i < BANDS; i++) U.uSpec.value[i] += (spectrum[i] * fade - U.uSpec.value[i]) * (1 - Math.exp(-dt / 0.12));

  // Palette: light neutrals, coloured by the chord, saturated by loudness.
  const sat = 0.3 + 0.4 * Math.min(1, energy * 2.5);
  const tone = i => chord.length ? pcHue(chord[Math.min(i, chord.length - 1)], hue) : (hue + i * 40) % 360;
  _c.setHSL(tone(0) / 360, sat, 0.8);  _base.copy(PALE).lerp(_c, TINT);   U.uZone.value.lerp(_base, ease);
  _c.setHSL(tone(1) / 360, sat + 0.1, 0.55); _base.copy(SLATE).lerp(_c, TINT); U.uBelt.value.lerp(_base, ease);
  _c.setHSL(tone(2) / 360, 0.6, 0.72);                                     U.uAccent.value.lerp(_c, ease);

  // Storms: strongest few chord tones.
  const active = [];
  for (let pc = 0; pc < 12; pc++) {
    let lvl = 0;
    for (let k = 0; k < 7; k++) lvl = Math.max(lvl, music.noteLevel[24 + 12 * k + pc]);
    const target = chord.includes(pc) ? 0.35 + 0.65 * Math.min(1, lvl * 1.5) : 0;
    stormW[pc] += (target - stormW[pc]) * (1 - Math.exp(-dt / (target > stormW[pc] ? 0.15 : 0.9)));
    if (stormW[pc] > 0.002) active.push(pc);
  }
  active.sort((a, b) => stormW[b] - stormW[a]);
  for (let i = 0; i < STORMS; i++) {
    const pc = active[i];
    if (pc === undefined) { U.uStorm.value[i].w = 0; continue; }
    const a = pcAngle(pc), la = stormLat[pc];
    U.uStorm.value[i].set(Math.cos(a) * Math.cos(la), Math.sin(la), Math.sin(a) * Math.cos(la), stormW[pc]);
    U.uStormCol.value[i].setHSL(pcHue(pc, hue) / 360, 0.6, 0.5);
  }

  // Ripples: the newest onsets.
  const rips = music.ripples;
  for (let i = 0; i < RIPPLES; i++) {
    const r = rips[rips.length - 1 - i];
    if (!r) { U.uRipAmp.value[i] = 0; continue; }
    U.uRip.value[i].set(r.x, r.y, r.z, r.age * 1.5);
    U.uRipAmp.value[i] = r.vel * (RIPPLE_GAIN[r.role] ?? 0.6) * Math.exp(-r.age / 0.6);
  }

  // The kick thumps the planet; the haze breathes with bass and kick.
  const punch = 1 + 0.035 * hits.kick + 0.015 * hits.crash;
  planet.scale.setScalar(punch);
  haze.scale.setScalar(punch);
  hazeMat.uniforms.uColor.value.copy(U.uAccent.value).lerp(U.uZone.value, 0.4);
  hazeMat.uniforms.uGain.value = 0.22 + 0.35 * roles.bass + 0.4 * hits.kick;
}
