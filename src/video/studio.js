// ─── The music video studio ───────────────────────────────────────────────────
// A local page (video.html, `npm run video`) for making a music video of an
// Orrery song: paste its share link, watch the preview with the song playing,
// choose the look, style and effects, and make the MP4. Never deployed: the
// site's build ships index.html alone.
//
// The preview is a stage (stage.js) in an iframe: the song's audio rendered
// as EXPORT renders it, played here, and the stage drawing the frame for the
// moment being heard -- from the same capture and plan the video is encoded
// from, so the preview is the video. MAKE VIDEO opens a fresh stage (its
// randomness seeded from the song, so the same link and settings make the same
// video) and shows it drawing every frame.
import { planFromShare } from '../share.js';
import { SCALE_NAMES } from '../state.js';
import { openStage, videoSeed, videoSupported } from './frame.js';
import { EFFECTS, STYLE_ABOUT } from './catalog.js';

const SAMPLE_RATE = 48000;
const ROOTS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SCALES = { aeolian: 'MINOR', dorian: 'DORIAN', phrygian: 'PHRYGIAN', minor_pent: 'MINOR PENTATONIC', major_pent: 'MAJOR PENTATONIC', lydian: 'LYDIAN', mixolydian: 'MIXOLYDIAN', major: 'MAJOR' };
const PREVIEW_MAX_HEIGHT = 1080; // device pixels: the preview's drawing size, at most
const STORE = 'orrery.video';

const $ = id => document.getElementById(id);
const screen = $('screen'), stageBox = $('stage');

// ─── Settings ─────────────────────────────────────────────────────────────────
const defaults = {
  look: 'song', style: 'AUTO', camera: 'directed', intensity: null, grade: 'auto',
  allow: {}, strength: {}, solo: [],
  titles: { on: false, opening: { title: 'Orrery', about: '' }, closing: { title: 'Orrery', about: 'orrery.vectorclash.com' } },
  size: '1920x1080', fps: 30, motionBlur: false, link: '', loopSeconds: 60,
};
// `v`: the settings' version. Before 2, titles were on by default and saved
// as on with everything else, so that one is forgotten: off is the default now.
// Before 3, the closing card's default named Orrery's old address.
const SETTINGS_VERSION = 3;
const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
if ((saved.v ?? 1) < 2 && saved.titles) delete saved.titles.on;
if ((saved.v ?? 1) < 3 && saved.titles?.closing?.about === 'vectorclash.com/orrery') saved.titles.closing.about = 'orrery.vectorclash.com';
const settings = { ...defaults, ...saved, titles: { ...defaults.titles, ...saved.titles }, v: SETTINGS_VERSION };
const save = () => localStorage.setItem(STORE, JSON.stringify(settings));

// ─── State ────────────────────────────────────────────────────────────────────
let plan = null, loaded = null;   // the song, and what its stage gave back
let preview = null, previewFrame = null;
let ctx = null, buffer = null, source = null, startedAt = 0, offset = 0, playing = false;
let making = null;                // the frame of a video being made
let autoStyle = 'CLUB', autoIntensity = 1, sections = [];

const style = () => (settings.style === 'AUTO' ? autoStyle : settings.style);
const outSize = () => settings.size.split('x').map(Number);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ─── What's happening ─────────────────────────────────────────────────────────
// Loading a song or making a video shows in the transport's place, under the
// screen, with its progress (`fraction`, or null while it can't tell) and the
// tab's title counting up; it ends with a message (a saved file, an error), or
// none, and the transport comes back.
const TITLE = document.title;
let jobTimer = 0;
function job(text, fraction = null, cancellable = false) {
  clearTimeout(jobTimer);
  $('transport').hidden = true;
  const el = $('job');
  el.hidden = false;
  el.classList.remove('done', 'error');
  $('job-text').textContent = text;
  $('job-bar').firstElementChild.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  $('job-cancel').hidden = !cancellable;
  $('job-close').hidden = true;
  document.title = fraction === null ? `… ${TITLE}` : `${Math.round(fraction * 100)}% · ${TITLE}`;
}
function endJob(text = '', error = false) {
  clearTimeout(jobTimer);
  document.title = TITLE;
  if (!text) { $('job').hidden = true; $('transport').hidden = false; return; }
  job(text);
  document.title = TITLE;
  $('job').classList.add('done');
  $('job').classList.toggle('error', error);
  $('job-close').hidden = false;
  if (!error) jobTimer = setTimeout(() => endJob(), 12_000);
}

// ─── The screen ───────────────────────────────────────────────────────────────
// The video's shape, as large as fits.
function fitScreen() {
  const [vw, vh] = outSize();
  const box = stageBox.getBoundingClientRect();
  const scale = Math.min(box.width / vw, box.height / vh);
  screen.style.width = `${Math.floor(vw * scale)}px`;
  screen.style.height = `${Math.floor(vh * scale)}px`;
}
new ResizeObserver(() => { fitScreen(); redraw(); }).observe(stageBox);

// The preview's drawing size: the screen's, in device pixels, no taller than PREVIEW_MAX_HEIGHT.
function previewSize() {
  const r = screen.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const k = Math.min(dpr, PREVIEW_MAX_HEIGHT / Math.max(1, r.height));
  return [Math.max(2, Math.round(r.width * k)), Math.max(2, Math.round(r.height * k))];
}

// ─── Loading a song ───────────────────────────────────────────────────────────
async function measureLevel(p) {
  // As Orrery's own export does (main.js): the hook measured alone, in a renderer of its own.
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.srcdoc = `<script type="module" src="src/render.js"></script>`;
  const ready = new Promise((res, rej) => { frame.onload = () => res(frame.contentWindow); frame.onerror = rej; });
  document.body.appendChild(frame);
  try { return await (await ready).levelOfSong(p, SAMPLE_RATE); } finally { frame.remove(); }
}

// A plan, ready to render: a song's level measured first.
async function readyPlan(p) {
  if (p.song && p.song.levelMs === undefined) return { ...p, song: { ...p.song, levelMs: await measureLevel(p) } };
  return p;
}

function describe(p, duration) {
  const key = `${ROOTS[p.state.rootMidi % 12]} ${SCALES[SCALE_NAMES[p.state.scaleIdx]] ?? ''}`.trim();
  const kit = [p.drumStyle && p.voices.includes('drums') ? `${p.drumStyle.replace(/_/g, ' ')} drums` : null,
    p.bassStyle ? `${p.bassStyle} bass` : null, ...p.voices.filter(v => v !== 'drums')].filter(Boolean).join(', ');
  return { key, line: `${key} · ${p.state.tempo} BPM · ${p.song ? 'SONG' : 'LOOP'} ${fmt(duration)} · ${kit.toUpperCase()}` };
}

async function load() {
  const link = $('link').value.trim();
  const p = planFromShare(link);
  if (!p) return endJob('That isn\'t an Orrery share link.', true);
  stop();
  settings.link = link; save();
  $('loop-row').hidden = !!p.song;
  $('load').disabled = $('make').disabled = $('play').disabled = true;
  job(p.song ? 'LOADING · MEASURING THE SONG\'S LEVEL' : 'LOADING', p.song ? null : 0);
  try {
    plan = await readyPlan(p);
    previewFrame?.remove();
    $('empty').hidden = true;
    const { frame, ready } = openStage(videoSeed(plan), screen);
    previewFrame = frame;
    preview = await ready;
    loaded = await preview.load(plan, settings.loopSeconds, f => job(`LOADING · RENDERING THE AUDIO ${Math.round(f * 100)}%`, f));
    autoStyle = loaded.autoStyle;
    autoIntensity = loaded.autoIntensity;
    if (!ctx) ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    buffer = new AudioBuffer({ length: loaded.channels[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    buffer.copyToChannel(loaded.channels[0], 0);
    buffer.copyToChannel(loaded.channels[1], 1);
    const d = describe(plan, loaded.duration);
    $('song-about').textContent = `${d.line} · AUTO STYLE ${autoStyle}`;
    if (!settings.titles.opening.about || settings.titles.autoAbout) {
      settings.titles.opening.about = `${d.key} · ${plan.state.tempo} BPM`;
      settings.titles.autoAbout = true;
    }
    offset = 0;
    showSettings();
    await apply();
    endJob();
    $('load').disabled = $('make').disabled = $('play').disabled = false;
  } catch (err) {
    console.error(err);
    endJob(`Couldn't load it: ${err.message}`, true);
    $('load').disabled = false;
  }
}

// ─── Settings to the stage ────────────────────────────────────────────────────
function stageSettings() {
  return {
    style: style(), look: settings.look, camera: settings.camera,
    intensity: settings.intensity, grade: settings.grade,
    allow: settings.allow, strength: settings.strength, solo: settings.solo,
    titles: settings.titles,
  };
}

async function apply() {
  save();
  showSettings();
  if (!preview) return;
  const got = preview.configure(stageSettings());
  if (got) showSections(got.sections);
  redraw();
}

let drawing = false;
async function redraw() {
  if (!preview || playing || drawing) return;
  drawing = true;
  try { await preview.drawAt(offset, ...previewSize()); } finally { drawing = false; }
}

// ─── Playback ─────────────────────────────────────────────────────────────────
const latency = () => ctx.outputLatency || ctx.baseLatency || 0;
const playhead = () => (playing ? ctx.currentTime - startedAt + offset - latency() : offset);

function play() {
  if (!buffer) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (offset >= loaded.duration - 0.05) offset = 0;
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0, offset);
  startedAt = ctx.currentTime;
  playing = true;
  $('play').textContent = 'PAUSE';
  requestAnimationFrame(tick);
}
function stop() {
  if (!playing) return;
  offset = Math.max(0, playhead());
  source.stop();
  source.disconnect();
  playing = false;
  $('play').textContent = 'PLAY';
}
function seekTo(t) {
  const was = playing;
  stop();
  offset = Math.max(0, Math.min(loaded.duration, t));
  if (was) play(); else { redraw(); showTime(offset); }
}

async function tick() {
  if (!playing) return;
  const t = Math.max(0, playhead());
  if (t >= loaded.duration) { stop(); offset = 0; showTime(0); return; }
  showTime(t);
  if (!drawing) {
    drawing = true;
    try { await preview.drawAt(t, ...previewSize()); } finally { drawing = false; }
  }
  requestAnimationFrame(tick);
}

function showTime(t) {
  $('time').textContent = `${fmt(t)} / ${fmt(loaded?.duration ?? 0)}`;
  $('playhead').style.left = `${(t / (loaded?.duration || 1)) * 100}%`;
}

function showSections(list) {
  sections = list;
  const bar = $('sections');
  bar.querySelectorAll('button').forEach(b => b.remove());
  for (const s of list) {
    if (s.t1 <= s.t0) continue;
    const b = document.createElement('button');
    b.style.flex = `${s.t1 - s.t0} 0 0`;
    b.textContent = s.label;
    b.title = `${s.label} — ${fmt(s.t0)}`;
    b.dataset.role = s.role;
    b.addEventListener('click', e => {
      const r = b.getBoundingClientRect();
      seekTo(s.t0 + (e.clientX - r.left) / r.width * (s.t1 - s.t0));
    });
    bar.insertBefore(b, $('playhead'));
  }
  showTime(playhead());
}

// ─── Making the video ─────────────────────────────────────────────────────────
function fileName() {
  const [vw, vh] = outSize();
  const key = `${ROOTS[plan.state.rootMidi % 12].replace('♯', 's')}-${SCALE_NAMES[plan.state.scaleIdx]}`.toLowerCase();
  const id = plan.song ? `_song-${plan.song.seed.toString(36)}` : '';
  return `orrery_${style().toLowerCase()}_${key}_${plan.state.tempo}bpm${id}_${vw}x${vh}_${settings.fps}fps.mp4`;
}

async function make() {
  if (making) { // CANCEL
    making.remove(); making = null;
    finishMaking('CANCELLED');
    return;
  }
  stop();
  const [vw, vh] = outSize();
  previewFrame.style.visibility = 'hidden';
  const { frame, ready } = openStage(videoSeed(plan), screen);
  making = frame;
  $('make').textContent = 'CANCEL';
  $('load').disabled = $('play').disabled = true;
  const began = performance.now();
  job('MAKING THE VIDEO · RENDERING THE AUDIO', 0, true);
  try {
    const stage = await ready;
    await stage.load(plan, settings.loopSeconds, f => job(`MAKING THE VIDEO · RENDERING THE AUDIO ${Math.round(f * 100)}%`, f * 0.05, true));
    if (making !== frame) return;
    stage.configure(stageSettings());
    const videoBegan = performance.now();
    const blob = await stage.encode({
      width: vw, height: vh, fps: settings.fps, motionBlur: settings.motionBlur,
      tags: { title: settings.titles.opening.title || 'Orrery', artist: 'Orrery', genre: style(), comment: settings.link, beatsPerMinute: plan.state.tempo },
    }, f => {
      const left = (performance.now() - videoBegan) / 1000 * (1 / Math.max(f, 1e-3) - 1);
      const done = 0.05 + f * 0.95; // the audio was the first 5%
      job(`MAKING THE VIDEO · ${Math.round(done * 100)}%${f > 0.02 ? ` · ABOUT ${fmt(left)} LEFT` : ''}`, done, true);
    });
    if (making !== frame) return;
    const url = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    finishMaking(`SAVED ${fileName()} · ${(blob.size / 1e6).toFixed(0)} MB in ${fmt((performance.now() - began) / 1000)}`);
  } catch (err) {
    console.error(err);
    if (making === frame) finishMaking(`Couldn't make it: ${err.message}`, true);
  }
}
function finishMaking(text, error = false) {
  making?.remove();
  making = null;
  previewFrame.style.visibility = '';
  $('make').textContent = 'MAKE VIDEO';
  $('load').disabled = $('play').disabled = false;
  endJob(text, error);
  redraw();
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function choice(id, key, parse = v => v) {
  const el = $(id);
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[key] = parse(b.dataset.v);
    if (key === 'size') fitScreen();
    apply();
  });
}
choice('look', 'look');
choice('style', 'style');
choice('camera', 'camera');
choice('grade', 'grade');
choice('size', 'size');
choice('fps', 'fps', Number);

$('intensity').addEventListener('input', e => { settings.intensity = e.target.value / 100; apply(); });
$('intensity-auto').addEventListener('click', () => { settings.intensity = null; apply(); });
$('motion-blur').addEventListener('change', e => { settings.motionBlur = e.target.checked; apply(); });
$('titles-on').addEventListener('change', e => { settings.titles.on = e.target.checked; apply(); });
for (const [id, card, field] of [['title-open', 'opening', 'title'], ['title-open-about', 'opening', 'about'], ['title-close', 'closing', 'title'], ['title-close-about', 'closing', 'about']]) {
  $(id).addEventListener('change', e => {
    settings.titles[card][field] = e.target.value;
    if (id === 'title-open-about') settings.titles.autoAbout = false;
    apply();
  });
}
$('loop-seconds').addEventListener('change', e => { settings.loopSeconds = Math.max(10, Number(e.target.value) || 60); save(); });
$('load').addEventListener('click', load);
$('link').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
$('play').addEventListener('click', () => (playing ? stop() : play()));
$('make').addEventListener('click', make);
$('job-cancel').addEventListener('click', () => { if (making) make(); });
$('job-close').addEventListener('click', () => endJob());
window.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.target.closest('input, textarea')) return;
  e.preventDefault();
  if (!$('play').disabled) playing ? stop() : play();
});

// The bench: each effect, whether the director may use it, its strength, and SOLO.
const effectsEl = $('effects');
for (const [name, label, hint] of EFFECTS) {
  const allow = document.createElement('input');
  allow.type = 'checkbox';
  allow.dataset.effect = name;
  allow.addEventListener('change', () => { settings.allow[name] = allow.checked; apply(); });
  const nameEl = document.createElement('span');
  nameEl.className = 'name'; nameEl.textContent = label;
  const strength = document.createElement('input');
  strength.type = 'range'; strength.min = 0; strength.max = 200; strength.step = 5; strength.dataset.effect = name;
  strength.addEventListener('input', () => { settings.strength[name] = strength.value / 100; apply(); });
  const value = document.createElement('span');
  value.className = 'value'; value.dataset.effect = name;
  const solo = document.createElement('button');
  solo.className = 'btn solo'; solo.textContent = 'SOLO'; solo.dataset.effect = name;
  solo.title = 'See this effect alone, at a steady strength';
  solo.addEventListener('click', () => {
    const on = settings.solo.includes(name);
    settings.solo = on ? settings.solo.filter(n => n !== name) : [...settings.solo, name];
    apply();
  });
  const hintEl = document.createElement('div');
  hintEl.className = 'hint'; hintEl.textContent = hint;
  effectsEl.append(allow, nameEl, strength, value, solo, hintEl);
}

function showSettings() {
  for (const [id, key] of [['look', 'look'], ['style', 'style'], ['camera', 'camera'], ['grade', 'grade'], ['size', 'size'], ['fps', 'fps']]) {
    $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(settings[key])));
  }
  $('style').querySelector('[data-v="AUTO"]').textContent = loaded ? `AUTO (${autoStyle})` : 'AUTO';
  $('style-about').textContent = STYLE_ABOUT[style()] ?? '';
  const k = settings.intensity ?? autoIntensity;
  $('intensity').value = Math.round(k * 100);
  $('intensity-v').textContent = `${Math.round(k * 100)}%${settings.intensity === null ? ' AUTO' : ''}`;
  $('motion-blur').checked = settings.motionBlur;
  $('titles-on').checked = settings.titles.on;
  $('title-open').value = settings.titles.opening.title;
  $('title-open-about').value = settings.titles.opening.about;
  $('title-close').value = settings.titles.closing.title;
  $('title-close-about').value = settings.titles.closing.about;
  $('loop-seconds').value = settings.loopSeconds;
  for (const el of effectsEl.querySelectorAll('[data-effect]')) {
    const n = el.dataset.effect, s = settings.strength[n] ?? 1;
    if (el.type === 'checkbox') el.checked = settings.allow[n] !== false;
    else if (el.type === 'range') el.value = Math.round(s * 100);
    else if (el.classList.contains('value')) el.textContent = `${Math.round(s * 100)}%`;
    else el.classList.toggle('on', settings.solo.includes(n));
  }
  const [vw, vh] = outSize();
  const secs = loaded?.duration ?? 0;
  const mb = secs ? ((vw * vh * settings.fps * (settings.fps > 30 ? 0.14 : 0.2) + 320_000) * secs / 8 / 1e6) : 0;
  $('video-about').textContent = `${vw}×${vh} · ${settings.fps} FPS${settings.motionBlur ? ' · MOTION BLUR' : ''}${secs ? ` · ${fmt(secs)} · ABOUT ${Math.round(mb)} MB` : ''}`;
}

// ─── Start ────────────────────────────────────────────────────────────────────
$('link').value = settings.link;
showSettings();
fitScreen();
if (!videoSupported()) {
  endJob('This browser can\'t make videos: it needs WebCodecs and OfflineAudioContext.suspend (Chrome or Safari).', true);
  $('load').disabled = true;
}
