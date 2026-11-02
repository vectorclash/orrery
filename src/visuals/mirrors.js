import * as THREE from 'three';
import { scene } from './scene.js';
import { music, pcAngle } from './music.js';
import { cages } from './cages.js';
import { attractor } from './core/attractor.js';
import { ringPoints } from './ring/scope.js';
import { moonPoints } from './chord.js';

// ─── Mirrors: a kaleidoscope in three dimensions ──────────────────────────────
// Three mirrors meet at the centre like the corner of a kaleidoscope's tube,
// and the centre, the ring and the chord moons are seen through them: the
// ring's strings become interlocking arcs, like an armillary sphere's, and the
// moons a constellation round it. Only what lies in the
// chamber between the mirrors is drawn, once for each reflection, so the
// copies meet seamlessly at the mirrors and are real geometry -- they turn in
// depth as the camera orbits. The light is that of the one chamber, so a
// hundred copies don't burn out to white.
//
// The mirrors are those of the regular solids: the tetrahedron's (24 copies),
// the cube's (48) or the icosahedron's (120), a different one each time a new
// song or era is heard. Each set is three mirror planes whose angles make the
// reflections close up: the chamber is where a point is on the inner side of
// all three (each plane given by its normal, pointing into the chamber), and
// the copies are every product of the three reflections.
//
// The mirrors' corner is the scene's centre: the cages and the attractor are
// nearly round about it, so they stay one body, their lobes and ripples
// repeated. Moving the content off the corner opens the copies out like a
// flower, but its bright core then lies in the chamber and every copy has it,
// which burns out to white. The mirrors turn slowly through the content, the
// snare gives them a twist, and each chord turns them to its root's place on
// the circle of fifths.
//
// Each copy is drawn by a twin of the original that shares its geometry, so
// nothing more is worked out on the CPU: the copies are instances, and the
// vertex shader reflects them. The cost is on the GPU, in proportion to the
// copies: at 2560×1440 on an M4 Max, 0.7 ms a frame for the tetrahedron's,
// 2.2 for the cube's and 7 for the icosahedron's.
//
// M toggles it, and 1, 2 and 3 choose the tetrahedron's, the cube's or the
// icosahedron's. Fun, but not part of the look for now, so it has no button:
// it's off unless M is pressed.

const PHI = (1 + Math.sqrt(5)) / 2;
const SYMMETRIES = [
  [[1, -1, 0], [0, 1, -1], [0, 1, 1]],                         // tetrahedron: 24
  [[1, -1, 0], [0, 1, -1], [0, 0, 1]],                         // cube: 48
  [[1, 0, 0], [-PHI / 2, -0.5, -1 / (2 * PHI)], [0, 1, 0]],    // icosahedron: 120
].map(ns => {
  const walls = ns.map(n => new THREE.Vector3(...n).normalize());
  return { walls, copies: reflections(walls) };
});
const MAX_COPIES = 120;

const TURN = 0.04, TWIST = 1.0, GLIDE = 0.6;

// Every product of the reflections in `walls`, as matrices.
function reflections(walls) {
  const gens = walls.map(n => new THREE.Matrix3().set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z));
  const key = m => m.elements.map(e => Math.round(e * 1e4)).join();
  const found = new Map([[key(new THREE.Matrix3()), new THREE.Matrix3()]]);
  for (const queue = [new THREE.Matrix3()]; queue.length;) {
    const m = queue.pop();
    for (const g of gens) {
      const p = new THREE.Matrix3().multiplyMatrices(g, m);
      if (!found.has(key(p))) { found.set(key(p), p); queue.push(p); }
    }
  }
  return [...found.values()];
}

// ─── Twins ────────────────────────────────────────────────────────────────────
const uniforms = {
  uMirrorFrame: { value: new THREE.Matrix3() }, // world → the mirrors' frame
  uWall0: { value: new THREE.Vector3() },
  uWall1: { value: new THREE.Vector3() },
  uWall2: { value: new THREE.Vector3() },
};

const MIRROR_VERTEX = /* glsl */`
  uniform mat3 uMirrorFrame;
  uniform vec3 uWall0, uWall1, uWall2;
  attribute vec3 aMirror0, aMirror1, aMirror2; // this copy's reflection, by column
  varying vec3 vWall;
  // A world position as this copy shows it. vWall: how far inside each mirror
  // the original is; the fragment shader keeps only what's inside all three.
  vec3 mirrored(vec3 world) {
    vec3 q = uMirrorFrame * world;
    vWall = vec3(dot(q, uWall0), dot(q, uWall1), dot(q, uWall2));
    return transpose(uMirrorFrame) * (mat3(aMirror0, aMirror1, aMirror2) * q);
  }
`;
const MIRROR_FRAGMENT = /* glsl */`
  varying vec3 vWall;
  void main() {
    if (min(vWall.x, min(vWall.y, vWall.z)) < 0.0) discard;
`;

const copyAttrs = [0, 1, 2].map(() => new THREE.InstancedBufferAttribute(new Float32Array(MAX_COPIES * 3), 3));

function twinGeometry(src) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = src.index;
  for (const name in src.attributes) geo.setAttribute(name, src.attributes[name]); // shared: uploaded once
  copyAttrs.forEach((a, i) => geo.setAttribute(`aMirror${i}`, a));
  return geo;
}

function replaceOnce(s, a, b) {
  if (s.split(a).length !== 2) throw new Error(`mirrors: expected one "${a}" in a shader`);
  return s.replace(a, b);
}

// A cage layer or the glow: its basic material, reflected.
function meshTwin(src) {
  const mat = src.material.clone();
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = replaceOnce(sh.vertexShader, '#include <common>', '#include <common>\n' + MIRROR_VERTEX);
    sh.vertexShader = replaceOnce(sh.vertexShader, '#include <project_vertex>', `
      vec4 mvPosition = viewMatrix * vec4(mirrored((modelMatrix * vec4(transformed, 1.0)).xyz), 1.0);
      gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = replaceOnce(sh.fragmentShader, 'void main() {', MIRROR_FRAGMENT);
  };
  return { src, twin: new THREE.Mesh(twinGeometry(src.geometry), mat), sync: () => {
    mat.color.copy(src.material.color);
    mat.opacity = src.material.opacity;
  } };
}

// Shader points -- the attractor, the ring, the moons -- reflected. Each
// works out its view position as modelViewMatrix * vec4(<world-space point>, 1.0).
function pointsTwin(src) {
  const m = src.material;
  let vs = replaceOnce(m.vertexShader, 'void main() {', MIRROR_VERTEX + 'void main() {');
  const mv = vs.match(/modelViewMatrix \* vec4\((\w+), 1\.0\)/g);
  if (mv?.length !== 1) throw new Error('mirrors: expected one modelViewMatrix in a points shader');
  vs = vs.replace(/modelViewMatrix \* vec4\((\w+), 1\.0\)/, 'viewMatrix * vec4(mirrored((modelMatrix * vec4($1, 1.0)).xyz), 1.0)');
  // Outside the chamber: off the screen, so it isn't even rasterised.
  const end = vs.lastIndexOf('}');
  vs = vs.slice(0, end) + '  if (min(vWall.x, min(vWall.y, vWall.z)) < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n' + vs.slice(end);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...m.uniforms, ...uniforms }, // the same objects: they stay in step
    vertexShader: vs,
    fragmentShader: replaceOnce(m.fragmentShader, 'void main() {', MIRROR_FRAGMENT),
    transparent: true, depthWrite: false, blending: m.blending,
  });
  return { src, twin: new THREE.Points(twinGeometry(src.geometry), mat), sync: () => {} };
}

const group = new THREE.Group();
group.visible = false;
scene.add(group);
const twins = [];
cages.group.traverse(o => { if (o.isMesh) twins.push(meshTwin(o)); });
attractor.group.traverse(o => { if (o.isPoints) twins.push(pointsTwin(o)); });
twins.push(pointsTwin(ringPoints), pointsTwin(moonPoints));
for (const { twin } of twins) {
  twin.matrixAutoUpdate = false;
  twin.matrixWorldAutoUpdate = false; // set from its original each frame
  twin.frustumCulled = false;         // its copies reach past the original's bounds
  group.add(twin);
}

// ─── Update ───────────────────────────────────────────────────────────────────
let symmetry = -1, changes = -1;
let turn = 0, root = 0;
const _m4 = new THREE.Matrix4(), _spin = new THREE.Matrix4();
const AXIS = new THREE.Vector3(0.3, 1, 0.2).normalize();
const turnTo = (from, to) => ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;

export function useSymmetry(i) {
  symmetry = i;
  const s = SYMMETRIES[i];
  s.copies.forEach((m, c) => {
    for (let col = 0; col < 3; col++) copyAttrs[col].array.set(m.elements.slice(col * 3, col * 3 + 3), c * 3);
  });
  for (const a of copyAttrs) a.needsUpdate = true;
  for (const { twin } of twins) twin.geometry.instanceCount = s.copies.length;
  s.walls.forEach((n, w) => uniforms[`uWall${w}`].value.copy(n));
}

export const mirrors = { on: false };

export function updateMirrors({ dt }) {
  group.visible = mirrors.on;
  for (const { src } of twins) src.visible = !mirrors.on;

  // A new song or era: other mirrors (kept up while it's off too).
  if (music.changes !== changes) {
    changes = music.changes;
    useSymmetry(symmetry < 0 ? 1 : (symmetry + 1 + Math.floor(Math.random() * 2)) % 3);
  }
  if (!mirrors.on) return;

  const { hits } = music;
  turn += (TURN + TWIST * hits.snare) * dt;
  if (music.chord.length) root += turnTo(root, pcAngle(music.chord[0])) * (1 - Math.exp(-dt / GLIDE));
  _m4.makeRotationY(root).multiply(_spin.makeRotationAxis(AXIS, turn));
  uniforms.uMirrorFrame.value.setFromMatrix4(_m4);

  for (const { src, twin, sync } of twins) {
    src.updateWorldMatrix(true, false);
    twin.matrixWorld.copy(src.matrixWorld);
    sync();
  }
}
