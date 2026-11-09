import * as THREE from 'three';
import { camera } from '../visuals/scene.js';
import { music } from '../visuals/music.js';
import { mirrors, useSymmetry } from '../visuals/mirrors.js';
import { song } from '../audio/song.js';
import { transport } from '../audio/transport.js';
import { buildClosed } from '../audio/voices/sweep.js';
import { seeded, hashSeed } from '../random.js';
import { fx } from './fx.js';
import { EFFECTS as CATALOG, STYLE_ABOUT } from './catalog.js';

// ─── The director ─────────────────────────────────────────────────────────────
// Makes a song into a music video: the camera's shots, the look, and how much
// of each effect, section by section, in one of seven styles.
//
// The whole video is planned before the first frame, from the song's sections
// (song.js) and the style: each section split into shots -- on bar lines, in
// the styles that cut, or one long move in the ones that glide -- each shot a
// kind of camera move and a look. Then each frame is worked out from the plan
// and the time alone (plus the music's hits, for the shake and the
// shockwaves), so the preview can jump anywhere and the video is the same
// every time it's rendered.
//
// What a section is for decides most of it (its role, below): an intro
// arrives, a build pushes in under the filter blur, a drop cuts on the beat
// in the busiest looks, a breakdown pulls back and leaves trails, an outro
// leaves. Things happen on the beat: the world slows almost to a stop through
// the silence before a drop (the camera still gliding), the drop lands at
// full speed with a flash and a punch, the video fades in and out with its
// titles.
//
// Flashes are kept to big moments and never closer than half a second apart:
// full-frame flashing three or more times a second can trigger seizures
// (WCAG 2.3.1), and a drop at 174 BPM has a kick nearly that often.

// What each kind of section does in a video.
const ROLE = {
  intro: 'intro', open: 'intro', dawn: 'intro',
  verse: 'low', theme: 'low', bridge: 'low', drift: 'low',
  groove: 'mid',
  pre: 'rise', build: 'rise',
  chorus: 'peak', drop: 'peak', swell: 'peak',
  breakdown: 'break',
  outro: 'outro', close: 'outro', dusk: 'outro', end: 'outro',
};
// How strongly the music-driven effects work in each role.
const ROLE_LEVEL = { intro: 0.4, low: 0.6, mid: 0.8, rise: 0.85, peak: 1, break: 0.5, outro: 0.45 };
const TRAIL_LEVEL = { intro: 1, low: 1, mid: 1, rise: 0.6, peak: 0.8, break: 1.7, outro: 1.1 };

// The effects a style can use, and how much (before the role's level). The
// "texture" ones (film, CRT, VHS, grade, letterbox) hold all video.
const TEXTURE = new Set(['crt', 'vhs', 'film', 'grade', 'letterbox']);
const EFFECTS = CATALOG.map(([name]) => name).filter(n => n !== 'flash' && n !== 'slowmo'); // events, below

export const STYLES = {
  DRIFT: {
    cut: null, glide: 7, dissolve: 5,
    shots: { intro: ['arrive'], low: ['drift', 'wide', 'top'], mid: ['drift', 'orbit'], rise: ['drift'], peak: ['orbit', 'top', 'wide'], break: ['wide', 'top'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery', 'orrery', 'tunnel'], mid: ['orrery', 'kaleidoscope'], rise: ['orrery'], peak: ['kaleidoscope', 'hexagons'], break: ['tunnel', 'orrery'], outro: ['orrery'] },
    fx: { trails: 0.55, lens: 0.3, defocus: 0.4, glints: 0.15, film: 0.25, grade: 0.6 },
    grade: 'dream', impact: 0, shake: 0,
  },
  CLUB: {
    cut: { low: 8, mid: 8, rise: 0, peak: 4, break: 16 }, glide: 0, dissolve: 0,
    shots: { intro: ['arrive'], low: ['orbit', 'ring', 'low'], mid: ['orbit', 'ring', 'dutch', 'low'], rise: ['push'], peak: ['close', 'orbit', 'top', 'dutch', 'ring'], break: ['wide', 'top'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery'], mid: ['orrery', 'orrery', 'mirror'], rise: ['orrery', 'tunnel'], peak: ['orrery', 'orrery', 'kaleidoscope', 'hexagons', 'squares', 'mirrors'], break: ['orrery', 'tunnel'], outro: ['orrery'] },
    fx: { trails: 0.25, lens: 0.5, shock: 0.8, defocus: 1, glints: 0.1, streaks: 0.3, aberration: 0.6, film: 0.1, grade: 0.7 },
    grade: 'cool', impact: 1, shake: 1,
  },
  DISCO: {
    cut: { low: 8, mid: 4, rise: 0, peak: 4, break: 8 }, glide: 0, dissolve: 0,
    shots: { intro: ['arrive'], low: ['orbit', 'dutch', 'ring'], mid: ['dutch', 'orbit', 'close'], rise: ['push'], peak: ['dutch', 'close', 'top', 'orbit'], break: ['wide', 'top'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery'], mid: ['orrery', 'mirror'], rise: ['orrery'], peak: ['orrery', 'squares', 'kaleidoscope', 'mirror', 'hexagons'], break: ['orrery', 'kaleidoscope'], outro: ['orrery'] },
    fx: { trails: 0.3, lens: 0.25, shock: 0.4, defocus: 0.8, glints: 0.85, streaks: 0.2, aberration: 0.25, film: 0.15, grade: 0.8 },
    grade: 'warm', impact: 0.7, shake: 0.5,
  },
  RETRO: {
    cut: { low: 8, mid: 8, rise: 0, peak: 4, break: 8 }, glide: 0, dissolve: 0,
    shots: { intro: ['arrive'], low: ['ring', 'low', 'orbit'], mid: ['ring', 'orbit', 'low'], rise: ['push'], peak: ['ring', 'top', 'close', 'low'], break: ['wide', 'ring'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery'], mid: ['orrery', 'mirror'], rise: ['tunnel'], peak: ['orrery', 'mirror', 'kaleidoscope', 'tunnel'], break: ['orrery'], outro: ['orrery'] },
    fx: { trails: 0.35, lens: 0.3, shock: 0.4, defocus: 0.8, glints: 0.2, streaks: 0.8, aberration: 0.4, crt: 0.8, grade: 0.9 },
    grade: 'neon', impact: 0.6, shake: 0.4,
  },
  FILM: {
    cut: { low: 16, mid: 16, rise: 0, peak: 8, break: 16 }, glide: 0, dissolve: 2,
    shots: { intro: ['arrive'], low: ['orbit', 'wide', 'low'], mid: ['orbit', 'close'], rise: ['push'], peak: ['close', 'orbit', 'top'], break: ['wide'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery'], mid: ['orrery'], rise: ['orrery'], peak: ['orrery', 'kaleidoscope'], break: ['orrery'], outro: ['orrery'] },
    fx: { trails: 0.3, lens: 0.2, shock: 0.15, defocus: 0.6, glints: 0.1, film: 0.75, vhs: 0.3, grade: 0.8 },
    grade: 'warm', impact: 0.3, shake: 0,
  },
  CINEMA: {
    cut: null, glide: 5, dissolve: 3,
    shots: { intro: ['arrive'], low: ['wide', 'low', 'drift'], mid: ['orbit', 'low'], rise: ['push'], peak: ['close', 'low', 'top'], break: ['wide', 'top'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery'], mid: ['orrery'], rise: ['orrery'], peak: ['orrery', 'hexagons'], break: ['orrery'], outro: ['orrery'] },
    fx: { trails: 0.3, lens: 0.6, shock: 0.2, defocus: 0.6, streaks: 0.6, film: 0.3, grade: 0.8, letterbox: 1 },
    grade: 'teal', impact: 0.5, shake: 0,
  },
  GLITCH: {
    cut: { low: 4, mid: 4, rise: 0, peak: 2, break: 8 }, glide: 0, dissolve: 0,
    shots: { intro: ['arrive'], low: ['low', 'close', 'ring'], mid: ['low', 'close', 'dutch'], rise: ['push'], peak: ['close', 'low', 'top', 'dutch'], break: ['wide', 'top'], outro: ['leave'] },
    looks: { intro: ['orrery'], low: ['orrery', 'mirror'], mid: ['orrery', 'mirror'], rise: ['tunnel'], peak: ['orrery', 'mirror', 'squares', 'mirrors', 'kaleidoscope'], break: ['orrery'], outro: ['orrery'] },
    fx: { trails: 0.2, lens: 0.8, shock: 0.7, defocus: 0.8, aberration: 0.8, glitch: 0.8, vhs: 0.15, grade: 0.7 },
    grade: 'mono', impact: 1, shake: 0.8,
  },
};

// A plan's style, from what it plays: its drums above all (links carry no genre).
export function styleFor(plan) {
  const d = plan.voices.includes('drums') ? plan.drumStyle : null;
  const v = new Set(plan.voices);
  if (!d || (plan.state.density < 0.35 && !['techno', 'trance', 'house', 'deep_house'].includes(d))) return 'DRIFT';
  if (['synthwave', 'outrun'].includes(d)) return 'RETRO';
  if (['cinematic', 'ghost'].includes(d) || (v.has('strings') && v.has('choir'))) return 'CINEMA';
  if (['disco', 'funk', 'afro', 'afro_house', 'amapiano', 'afrobeats', 'dembow', 'reggae', 'bossanova'].includes(d)) return 'DISCO';
  if (['trap', 'drill', 'halftime'].includes(d)) return 'GLITCH';
  if (['boombap', 'swing', 'brushes', 'shuffle'].includes(d)) return 'FILM';
  return 'CLUB';
}
// How hard a style works, from the plan: harder for a busier, pumping track
// (deep house sits back; big room doesn't).
export const intensityFor = plan => Math.min(1.2, Math.max(0.55, 0.45 + 0.7 * (plan.state.pump ?? 0) + 0.4 * (plan.state.density - 0.5)));

// ─── Shots ────────────────────────────────────────────────────────────────────
// Each a camera move over a shot `d` seconds long, `s` seconds in: where the
// camera is (cylindrical: radius, azimuth, height), what it looks at, its
// field of view and roll. `k` is the shot's own draw (start angle, direction).
const ease = x => x * x * (3 - 2 * x), easeIn = x => x * x, easeOut = x => 1 - (1 - x) * (1 - x);
const SHOTS = {
  orbit: (s, d, k) => { const a = k.az + k.dir * 0.18 * s; return { r: 7.5, a, y: Math.sin(a * 0.37) * 2.2 + 1, ty: 0, fov: 60, roll: 0 }; },
  wide:  (s, d, k) => ({ r: 12.5 - 1.2 * Math.min(1, s / d), a: k.az + k.dir * 0.05 * s, y: 3.2, ty: 0, fov: 50, roll: 0 }),
  close: (s, d, k) => ({ r: 4.9 - 0.5 * Math.min(1, s / d), a: k.az + k.dir * 0.12 * s, y: 1.35, ty: 0.05, fov: 55, roll: 0 }),
  ring:  (s, d, k) => ({ r: 6.2, a: k.az + k.dir * 0.1 * s, y: -0.22, ty: -0.15, fov: 48, roll: 0 }),
  top:   (s, d, k) => ({ r: 0.001, a: 0, y: 9.5, ty: 0, fov: 55, roll: k.az + k.dir * 0.06 * s, top: true }),
  low:   (s, d, k) => ({ r: 5.8, a: k.az + k.dir * 0.08 * s, y: -2.8, ty: 0.4, fov: 55, roll: 0 }),
  dutch: (s, d, k) => ({ r: 6.6, a: k.az + k.dir * 0.15 * s, y: 1.6, ty: 0, fov: 58, roll: k.dir * 0.2 }),
  drift: (s, d, k) => ({ r: 9.5 + 1.2 * Math.sin(s * 0.05 + k.ph), a: k.az + k.dir * 0.035 * s, y: 1.5 + 2.2 * Math.sin(s * 0.043 + k.ph), ty: 0, fov: 55, roll: 0 }),
  arrive:(s, d, k) => { const u = easeOut(Math.min(1, s / d)); return { r: 24 - 16.5 * u, a: k.az + 0.05 * s, y: 7 - 5.5 * u, ty: 0, fov: 45 + 15 * u, roll: 0 }; },
  leave: (s, d, k) => { const u = easeIn(Math.min(1, s / d)); return { r: 7.5 + 14.5 * u, a: k.az + 0.06 * s, y: 1.5 + 4.5 * u, ty: 0, fov: 60 - 10 * u, roll: 0 }; },
  push:  (s, d, k) => { const u = easeIn(Math.min(1, s / d)); return { r: 9.5 - 4.3 * u, a: k.az + k.dir * 0.06 * s, y: 1.6 - 0.9 * u, ty: 0, fov: 55 + 9 * u, roll: 0 }; },
};
const turnTo = (from, to) => ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
function blendPose(a, b, x) {
  const m = (p, q) => p + (q - p) * x;
  return { r: m(a.r, b.r), a: a.a + turnTo(a.a, b.a) * x, y: m(a.y, b.y), ty: m(a.ty, b.ty), fov: m(a.fov, b.fov),
    roll: m(a.roll, b.roll), top: x < 0.5 ? a.top : b.top };
}

// ─── The plan ─────────────────────────────────────────────────────────────────
// `take`: { cut, duration } -- where the video starts in the render, and how
// long it is. `options`: { style, look ('song' or one of fx.LOOKS or 'mirrors'),
// camera ('directed' | 'orbit'), seed }.
export function planVideo(take, options) {
  const style = STYLES[options.style] ?? STYLES.CLUB;
  const r = seeded(hashSeed('video', options.seed, options.style));
  const pick = a => a[Math.floor(r() * a.length)];
  const spb = transport.timeAt(1) - transport.timeAt(0); // seconds a beat
  const at = b => transport.timeAt(b) - take.cut; // a beat's time in the video

  // The song's sections in video time; a loop gets phrases of 8 bars.
  let sections;
  const s = song.current;
  if (s) {
    sections = s.sections.map(x => ({ ...x, t0: at(x.start), t1: at(x.start + x.beats), role: ROLE[x.kind] ?? 'mid' }));
  } else {
    sections = [];
    const bar = 4 * spb, phrase = 8 * bar;
    for (let t = 0, i = 0; t < take.duration; t += phrase, i++) {
      const role = i === 0 ? 'intro' : t + phrase >= take.duration ? 'outro' : i % 2 ? 'mid' : 'peak';
      sections.push({ kind: role, start: transport.beatAt(t + take.cut), beats: 32, t0: t, t1: Math.min(take.duration, t + phrase), role, impact: false, gap: 0, shift: 0 });
    }
  }
  sections = sections.filter(x => x.t1 > 0 && x.t0 < take.duration);

  // Shots: each section split on its bar lines, or whole.
  const shots = [];
  let lastKind = null, lastLook = 'orrery';
  for (const sec of sections) {
    // The song's last chord, held and rung out: the outro's move carries on
    // through it, rather than cutting back in to leave again.
    const last = shots[shots.length - 1];
    if (sec.kind === 'end' && last?.sec.role === 'outro') { last.t1 = Math.min(take.duration, sec.t1); continue; }
    const bars = style.cut?.[sec.role] ?? 0;
    const len = bars ? bars * 4 * spb : Infinity;
    const lookFor = () => {
      if (options.look !== 'song') return options.look;
      return pick(style.looks[sec.role] ?? ['orrery']);
    };
    let look = lookFor();
    for (let t = Math.max(0, sec.t0), n = 0; t < Math.min(take.duration, sec.t1) - 1e-6; t += len, n++) {
      const kinds = (style.shots[sec.role] ?? ['orbit']).filter((k, _, a) => a.length === 1 || k !== lastKind);
      const kind = options.camera === 'orbit' ? 'orbit' : pick(kinds);
      // In a peak that cuts, the look changes every other cut.
      if (n && sec.role === 'peak' && options.look === 'song' && r() < 0.5) look = lookFor();
      // 3D mirrors are geometry, not a fold of the frame: they can't dissolve, only cut.
      if (look === 'mirrors' && style.dissolve) look = 'kaleidoscope';
      shots.push({
        t0: t, t1: Math.min(sec.t1, t + len, take.duration), sec, kind, look,
        k: { az: r() * Math.PI * 2, dir: r() < 0.5 ? -1 : 1, ph: r() * 10 },
        symmetry: Math.floor(r() * 3),
        lookFrom: lastLook,
      });
      lastKind = kind;
      lastLook = look;
    }
  }
  // The silences before drops, in video time.
  const gaps = sections.filter(x => x.gap).map(x => ({ t0: at(x.start + x.beats - x.gap), t1: at(x.start + x.beats) }));
  return { style, sections, shots, take, options, at, gaps };
}

// ─── Each frame ───────────────────────────────────────────────────────────────
const _target = new THREE.Vector3();
let lastFlashAt = -Infinity, flash = 0, punch = 0, lastImpact = null, shakeSeed = 0, lastCrash = 0;

// From the start again: the preview jumped (see stage.js).
export function resetDirector() {
  lastFlashAt = -Infinity; flash = punch = lastCrash = 0; lastImpact = null;
}

function shotAt(plan, t) {
  const { shots } = plan;
  let lo = 0, hi = shots.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (shots[mid].t0 <= t) lo = mid; else hi = mid - 1; }
  return lo;
}
const poseOf = (shot, t) => SHOTS[shot.kind](t - shot.t0, shot.t1 - shot.t0, shot.k);

// Before the frame's update: what's in the scene (the 3D mirrors).
export function directScene(plan, t) {
  const shot = plan.shots[shotAt(plan, t)];
  if (!shot) return;
  const on = shot.look === 'mirrors';
  if (on && !mirrors.on) useSymmetry(shot.symmetry);
  mirrors.on = on;
}

// After it: the camera and the effects, for time `t` of the video.
// `amounts(name, level)` lets the bench scale or solo each effect (see stage.js).
export function direct(plan, t, dt, intensity, amounts) {
  const { style, shots, take, options } = plan;
  const i = shotAt(plan, t), shot = shots[i];
  if (!shot) return;
  const sec = shot.sec, role = sec.role;
  const beat = transport.beatAt(t + take.cut);

  // ── Camera ──
  let pose = poseOf(shot, t);
  const prev = shots[i - 1];
  if (prev && style.glide) {
    const x = Math.min(1, (t - shot.t0) / style.glide);
    if (x < 1) pose = blendPose(poseOf(prev, t), pose, ease(x));
  }
  if (options.camera !== 'orbit') { // otherwise the live view's orbit (animate.js) stands
    const hits = music.hits;
    // A kick shakes the camera a little, in the styles that hit.
    const shake = style.shake * intensity * hits.kick * 0.06;
    shakeSeed += dt * 40;
    camera.position.set(
      Math.sin(pose.a) * pose.r + shake * Math.sin(shakeSeed * 1.3),
      pose.y + shake * Math.sin(shakeSeed * 1.7 + 1),
      Math.cos(pose.a) * pose.r + shake * Math.sin(shakeSeed * 2.1 + 2));
    _target.set(0, pose.ty, 0);
    if (pose.top) camera.up.set(Math.sin(pose.roll), 0, Math.cos(pose.roll));
    else camera.up.set(0, 1, 0);
    camera.lookAt(_target);
    if (!pose.top && pose.roll) camera.rotateZ(pose.roll);
    const fov = pose.fov - 6 * punch;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // ── The look ──
  const dissolve = style.dissolve;
  const into = Math.min(1, dissolve ? (t - shot.t0) / dissolve : 1);
  fx.look.from = into < 1 ? shot.lookFrom : shot.look;
  fx.look.to = shot.look === 'mirrors' ? 'orrery' : shot.look;
  if (fx.look.from === 'mirrors') fx.look.from = 'orrery';
  fx.look.mix = into;
  // The tunnel falls faster through a build, slowest in a breakdown.
  const through = Math.min(1, Math.max(0, (beat - sec.start) / Math.max(1, sec.beats)));
  fx.tunnel = role === 'rise' ? 0.15 + 1.1 * through * through : role === 'peak' ? 0.45 : role === 'break' ? 0.08 : 0.18;

  // ── Events ──
  // The drop (or a last chorus) lands: a flash, the camera punches in.
  const impact = sec.impact && t >= sec.t0 && t - sec.t0 < 0.05 + dt ? sec : null;
  if (impact && impact !== lastImpact && t - lastFlashAt > 0.5) {
    flash = 0.55 * style.impact * Math.min(1, intensity);
    punch = style.impact;
    lastFlashAt = t;
  }
  if (impact) lastImpact = impact;
  // A crash on a section's first beat, a smaller one (not after a flash).
  const crash = music.hits.crash > 0.6 && lastCrash < 0.3;
  lastCrash = music.hits.crash;
  if (!impact && crash && t - lastFlashAt > 0.5 && style.impact) {
    flash = Math.max(flash, 0.18 * style.impact * Math.min(1, intensity));
    lastFlashAt = t;
  }
  flash *= Math.exp(-dt / 0.2);
  punch *= Math.exp(-dt / 0.4);
  // In and out of black.
  const fade = Math.max(0, 1 - t / 1.5, (t - (take.duration - 2.5)) / 2.5);

  // ── Effects ──
  const level = ROLE_LEVEL[role] ?? 0.7;
  for (const name of EFFECTS) {
    let v = style.fx[name] ?? 0;
    if (name === 'defocus') {
      // Exactly the filter the build shuts (sweep.js): blur while it's shut.
      // Eased in over the build's first beat, where the filter snaps shut:
      // the picture going murky on one frame reads as a fault, not a build.
      const shut = song.current ? (buildClosed(beat) ?? 0) : 0;
      const into = song.current ? beat - (song.sectionAt(beat)?.start ?? 0) : 1;
      v *= Math.min(1, shut / 0.8) * ease(Math.min(1, Math.max(0, into)));
    } else if (name === 'trails') v *= TRAIL_LEVEL[role] ?? 1;
    else if (!TEXTURE.has(name)) v *= level;
    if (name !== 'grade' && name !== 'letterbox') v *= intensity;
    fx[name] = amounts(name, v);
  }
  fx.gradeKind = style.grade;
  fx.flash = amounts('flash', flash);
  fx.fade = Math.min(1, fade);
}

// ─── Slow motion ──────────────────────────────────────────────────────────────
// Through the silence before a drop the world slows -- by `depth` (0 none, 1 a
// standstill), eased in over SLOW_IN -- and the drop brings it back to full
// speed. The scene runs on this time instead of the video's (see stage.js);
// the camera keeps the video's, gliding on. Worked out from the gaps alone,
// so any moment's time is known without playing up to it.
const SLOW_IN = 0.25; // seconds
// How much of the video's time the world has lost by time `t`.
function lost(gaps, t, depth) {
  let l = 0;
  for (const g of gaps) {
    if (t <= g.t0) break;
    const x = Math.min(t, g.t1) - g.t0, u = Math.min(1, x / SLOW_IN);
    // ∫ smoothstep over the ease-in, then the full slow-down past it.
    l += depth * (SLOW_IN * (u * u * u - u * u * u * u / 2) + Math.max(0, x - SLOW_IN));
  }
  return l;
}
export const sceneTime = (plan, t, depth) => (depth > 0 ? t - lost(plan.gaps, t, depth) : t);

// The title cards' timing: the opening card from 1 s to 6 s, the closing one
// over the last 5 s (as the picture fades), each easing in and out.
export function titleCard(t, duration) {
  const card = (from, to) => Math.min(1, Math.max(0, Math.min((t - from) / 0.8, (to - t) / 0.8)));
  if (t < duration / 2) return { which: 'start', alpha: card(1, 6) };
  return { which: 'end', alpha: card(duration - 5, duration + 1) };
}
