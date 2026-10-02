import * as THREE from 'three';

// ─── Ring geometry and dust ───────────────────────────────────────────────────
// The ring is dust in an annulus around the planet. Positions, colour and size
// are computed in the vertex shader from the attributes below, so the CPU only
// feeds textures and uniforms.

export const R_IN = 2.5, R_OUT = 4.1, PLANE_Y = -0.4;
export const TAU = Math.PI * 2;

// Keplerian orbit: angular speed falls off as r^-1.5, so inner dust laps outer
// dust and anything painted onto the ring shears into trailing spirals.
export const OMEGA0 = 0.2, R_REF = 3.2;
export const omega = r => OMEGA0 * Math.pow(R_REF / r, 1.5);

// The chord moons (../chord.js) light the dust around them; chord.js writes
// these uniform objects, which the ring material shares by reference.
export const MOONS = 4;
export const moonUniforms = {
  uMoon:    { value: Array.from({ length: MOONS }, () => new THREE.Vector4()) }, // xyz, intensity
  uMoonCol: { value: Array.from({ length: MOONS }, () => new THREE.Color()) },
};

export const GLSL_COMMON = /* glsl */`
  const float TAU = 6.28318530718;
  const float R_IN = ${R_IN.toFixed(4)}, R_OUT = ${R_OUT.toFixed(4)}, PLANE_Y = ${PLANE_Y.toFixed(4)};
  float omega(float r) { return ${OMEGA0.toFixed(4)} * pow(${R_REF.toFixed(4)} / r, 1.5); }

  uniform vec4 uMoon[${MOONS}];
  uniform vec3 uMoonCol[${MOONS}];
  // Light from the chord moons on a speck of dust at p: a soft pool of the
  // moon's colour, with a brighter core close in.
  vec3 moonLight(vec3 p) {
    vec3 c = vec3(0.0);
    for (int i = 0; i < ${MOONS}; i++) {
      vec3 d = p - uMoon[i].xyz;
      float q = dot(d, d);
      c += uMoonCol[i] * uMoon[i].w * (0.35 * exp(-q * 3.0) + 0.9 * exp(-q * 30.0));
    }
    return c;
  }
`;

// Dust in the annulus, area-uniform so the outer ring isn't sparse.
export function makeDust(count, { thickness = 0.03 } = {}) {
  const angle = new Float32Array(count), radius = new Float32Array(count);
  const y = new Float32Array(count), hash = new Float32Array(count * 4);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(R_IN * R_IN + Math.random() * (R_OUT * R_OUT - R_IN * R_IN));
    angle[i]  = Math.random() * TAU;
    radius[i] = r;
    y[i]      = gauss() * thickness;
    for (let k = 0; k < 4; k++) hash[4 * i + k] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // unused; required
  geo.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geo.setAttribute('aY', new THREE.BufferAttribute(y, 1));
  geo.setAttribute('aHash', new THREE.BufferAttribute(hash, 4));
  return geo;
}

// Soft round point: a bright core with a gentle halo.
export const POINT_FRAG = /* glsl */`
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.0, 1.0, r)) * 0.6 + (1.0 - smoothstep(0.0, 0.35, r)) * 0.4;
    gl_FragColor = vec4(vColor, a);
  }
`;

export function dustMaterial(uniforms, vertexShader) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, ...moonUniforms, ...uniforms },
    vertexShader,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
