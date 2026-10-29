import * as THREE from 'three';
import { renderer } from '../scene.js';

// ─── Glowing points ───────────────────────────────────────────────────────────
// The soft additive dots of the chord moons' dust (../chord.js), for the
// attractor. Colours are premultiplied by brightness, so it dims by scaling
// them.

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
// Phones get fewer particles: they're moved on the CPU.
export const budget = n => Math.round(COARSE ? n * 0.6 : n);

export function glowPoints(count) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const size = new Float32Array(count).fill(3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uPx;
      attribute vec3 color;
      attribute float size;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position  = projectionMatrix * mv;
        gl_PointSize = uPx * size * (7.0 / -mv.z);
        vColor = color;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float dust = (1.0 - smoothstep(0.0, 1.0, r)) * 0.6 + (1.0 - smoothstep(0.0, 0.35, r)) * 0.4;
        gl_FragColor = vec4(vColor, dust);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points, pos, col, size,
    // After writing the arrays: upload them.
    commit() {
      mat.uniforms.uPx.value = renderer.domElement.height / 750;
      for (const a of ['position', 'color', 'size']) geo.attributes[a].needsUpdate = true;
    },
  };
}
