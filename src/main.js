import { state, rootName, scaleName, TICK_MS, LOOKAHEAD, START_DELAY, ROOT_BASE_MIDI, pick } from './state.js';
import { audio, ensureAudioRunning, setRoom, ROOMS } from './audio/context.js';
import {
  tick, pickVoices, setActiveVoices, applyPlan, startSession, roomFor,
  bassVoice, padVoice, melodyVoice, textureVoice, pluckVoice,
  bellVoice, arpeggioVoice, malletVoice, droneVoice, fluteVoice,
  choirVoice, stringsVoice, rhodesVoice, organVoice, glassVoice,
  harpVoice, brassVoice, drumsVoice,
  vibraphoneVoice, clavinetVoice, sitarVoice, kalimbaVoice,
  activeVoices, eraTimer, ERA_DURATION,
} from './audio/scheduler.js';
import { startAnimation } from './visuals/animate.js';
import { post } from './visuals/post.js';

// ─── Definitions ──────────────────────────────────────────────────────────────
const ROOT_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALE_LABELS = ['AEOLIAN','DORIAN','PHRYGIAN','PENT MINOR','PENT MAJOR','LYDIAN','MIXOLYDIAN'];

// harmony = chord-tone lock (0 loose/roaming … 1 strict/consonant)
// chord   = beats per chord (low = fast harmonic motion, high = slow/static)
const GENRES = [
  { name:'AMBIENT', scaleIdx:5, tempo:65,  density:0.25, brightness:0.25, spaciousness:0.88, harmony:0.72, chord:8, room:'cathedral' },
  { name:'DARK',    scaleIdx:2, tempo:72,  density:0.45, brightness:0.12, spaciousness:0.65, harmony:0.75, chord:8, room:'hall' },
  { name:'JAZZ',    scaleIdx:1, tempo:112, density:0.75, brightness:0.50, spaciousness:0.40, harmony:0.50, chord:4, room:'room' },
  { name:'ELEC',    scaleIdx:3, tempo:128, density:0.82, brightness:0.72, spaciousness:0.28, harmony:0.85, chord:4, room:'studio' },
  { name:'ORCH',    scaleIdx:0, tempo:82,  density:0.60, brightness:0.38, spaciousness:0.78, harmony:0.85, chord:4, room:'hall' },
  { name:'ZEN',     scaleIdx:4, tempo:56,  density:0.18, brightness:0.40, spaciousness:0.94, harmony:0.80, chord:8, room:'cathedral' },
  { name:'BLUES',   scaleIdx:3, tempo:88,  density:0.55, brightness:0.30, spaciousness:0.45, harmony:0.45, chord:4, room:'room' },
  { name:'FOLK',    scaleIdx:6, tempo:96,  density:0.48, brightness:0.55, spaciousness:0.58, harmony:0.85, chord:4, room:'room' },
  { name:'DREAM',   scaleIdx:5, tempo:72,  density:0.32, brightness:0.72, spaciousness:0.82, harmony:0.72, chord:8, room:'hall' },
  { name:'FUNK',    scaleIdx:3, tempo:110, density:0.82, brightness:0.68, spaciousness:0.20, harmony:0.55, chord:4, room:'studio' },
  { name:'EPIC',    scaleIdx:0, tempo:84,  density:0.62, brightness:0.42, spaciousness:0.74, harmony:0.90, chord:4 },
];

const BASS_SUBTYPES  = ['sub','plucked','walking','synth','rumble'];
const DRUMS_SUBTYPES = [
  'minimal','four_four','house','funk','boombap','breakbeat','jungle','garage','trap','halftime',
  'shuffle','swing','brushes','bossanova','reggae','dembow','afro','cinematic','ghost',
];
const BASS_LABELS    = { sub:'SUB', plucked:'PLUCK', walking:'WALK', synth:'SYNTH', rumble:'RUMBLE' };
const DRUMS_LABELS   = {
  minimal:'MINIMAL', four_four:'4/4', house:'HOUSE', funk:'FUNK', boombap:'BOOM BAP', breakbeat:'BREAK',
  jungle:'JUNGLE', garage:'2-STEP', trap:'TRAP', halftime:'HALF TIME', shuffle:'SHUFFLE', swing:'SWING',
  brushes:'BRUSHES', bossanova:'BOSSA', reggae:'ONE DROP', dembow:'DEMBOW', afro:'AFRO 12/8',
  cinematic:'CINEMATIC', ghost:'GHOST',
};

const SIMPLE_VOICES = [
  { key:'pad',      voice:padVoice },
  { key:'melody',   voice:melodyVoice },
  { key:'texture',  voice:textureVoice },
  { key:'pluck',    voice:pluckVoice },
  { key:'bell',     voice:bellVoice },
  { key:'arpeggio', voice:arpeggioVoice },
  { key:'mallet',   voice:malletVoice },
  { key:'drone',    voice:droneVoice },
  { key:'flute',    voice:fluteVoice },
  { key:'choir',    voice:choirVoice },
  { key:'strings',  voice:stringsVoice },
  { key:'rhodes',     voice:rhodesVoice },
  { key:'organ',      voice:organVoice },
  { key:'glass',      voice:glassVoice },
  { key:'harp',       voice:harpVoice },
  { key:'brass',      voice:brassVoice },
  { key:'vibraphone', voice:vibraphoneVoice },
  { key:'clavinet',   voice:clavinetVoice },
  { key:'sitar',      voice:sitarVoice },
  { key:'kalimba',    voice:kalimbaVoice },
];
// Canonical instrument order for the share-link bitmask. Spelled out rather
// than derived from the display lists above, so reordering the UI can never
// silently remap old links. Only ever append.
const ALL_INST_KEYS = [
  'bass:sub','bass:plucked','bass:walking','bass:synth','bass:rumble',
  'drums:minimal','drums:four_four','drums:jungle','drums:shuffle','drums:trap',
  'drums:ghost','drums:halftime','drums:breakbeat','drums:bossanova',
  'pad','melody','texture','pluck','bell','arpeggio','mallet','drone','flute','choir',
  'strings','rhodes','organ','glass','harp','brass','vibraphone','clavinet','sitar','kalimba',
  // added with the expanded drum machine
  'drums:house','drums:funk','drums:boombap','drums:garage','drums:swing','drums:brushes',
  'drums:reggae','drums:dembow','drums:afro','drums:cinematic',
]; // 44 keys: bits 0–39 in bytes 6–10, bits 40–47 in byte 13 (byte 14 is the room)

// ─── UI refs ──────────────────────────────────────────────────────────────────
const startBtn        = document.getElementById('start-btn');
const infoEl          = document.getElementById('info');
const stateEl         = document.getElementById('state-line');
const infiniteUi      = document.getElementById('infinite-ui');
const manualUi        = document.getElementById('manual-ui');
const manualUiScroll  = document.getElementById('manual-ui-scroll');
const genreBtnsEl     = document.getElementById('genre-btns');
const rootSelect      = document.getElementById('manual-root');
const scaleSelect     = document.getElementById('manual-scale');
const bpmSlider       = document.getElementById('manual-bpm-slider');
const bpmValue        = document.getElementById('manual-bpm-value');
const octaveSlider    = document.getElementById('manual-octave-slider');
const octaveVal       = document.getElementById('manual-octave-val');
const densitySlider   = document.getElementById('density-slider');
const densityVal      = document.getElementById('density-val');
const brightSlider    = document.getElementById('bright-slider');
const brightVal       = document.getElementById('bright-val');
const spaceSlider     = document.getElementById('space-slider');
const roomSelect      = document.getElementById('manual-room');
const spaceVal        = document.getElementById('space-val');
const harmonySlider   = document.getElementById('harmony-slider');
const harmonyVal      = document.getElementById('harmony-val');
const chordSlider     = document.getElementById('chord-slider');
const chordVal        = document.getElementById('chord-val');
const lengthInput     = document.getElementById('manual-length');
const lengthValue     = document.getElementById('manual-length-value');
const voiceGroups     = document.getElementById('voice-groups');
const manualPlayBtn        = document.getElementById('manual-play-btn');
const manualExportBtn      = document.getElementById('manual-export-btn');
const manualStatus         = document.getElementById('manual-status');
const exportProgressWrap   = document.getElementById('export-progress-wrap');
const exportProgressBar    = document.getElementById('export-progress-bar');
const clearInstrumentsBtn  = document.getElementById('clear-instruments-btn');
const genreRandomBtn       = document.getElementById('genre-random-btn');
const manualShareBtn       = document.getElementById('manual-share-btn');
const modeTabs             = document.querySelectorAll('.mode-tab');
const panelToggleBtn       = document.getElementById('panel-toggle');
const panelHideBtn         = document.getElementById('panel-hide-btn');
let panelVisible = true;

// ─── Enable state (all off by default) ───────────────────────────────────────
const manualEnabled = {};
BASS_SUBTYPES.forEach(s  => { manualEnabled[`bass:${s}`]  = false; });
DRUMS_SUBTYPES.forEach(s => { manualEnabled[`drums:${s}`] = false; });
SIMPLE_VOICES.forEach(({ key }) => { manualEnabled[key] = false; });

// ─── Playback state ───────────────────────────────────────────────────────────
let currentMode       = 'infinite';
let infiniteRunning   = false;
let infiniteInterval  = null;
let manualPlaying     = false;
let manualInterval    = null;
let exporting         = false;
let exportId          = 0;      // incremented on each new export or cancellation

// ─── Populate selects ─────────────────────────────────────────────────────────
ROOT_NAMES.forEach((name, i) => {
  const o = document.createElement('option');
  o.value = i; o.textContent = name;
  rootSelect.appendChild(o);
});
SCALE_LABELS.forEach((label, i) => {
  const o = document.createElement('option');
  o.value = i; o.textContent = label;
  scaleSelect.appendChild(o);
});

Object.entries(ROOMS).forEach(([key, r]) => {
  const o = document.createElement('option');
  o.value = key; o.textContent = r.label;
  roomSelect.appendChild(o);
});
roomSelect.value = state.room;

// Applies a space from the controls; live playback crossfades into it.
function applyRoom(name) {
  state.room = name;
  roomSelect.value = name;
  if (audio.started && !exporting) setRoom(name);
}

// ─── Genre buttons ────────────────────────────────────────────────────────────
GENRES.forEach(g => {
  const btn = document.createElement('button');
  btn.className = 'genre-btn';
  btn.textContent = g.name;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    scaleSelect.value      = g.scaleIdx;
    bpmSlider.value        = g.tempo;
    bpmValue.textContent   = g.tempo;
    densitySlider.value    = g.density;
    densityVal.textContent = g.density.toFixed(2);
    brightSlider.value     = g.brightness;
    brightVal.textContent  = g.brightness.toFixed(2);
    spaceSlider.value      = g.spaciousness;
    spaceVal.textContent   = g.spaciousness.toFixed(2);
    harmonySlider.value    = g.harmony;
    harmonyVal.textContent = g.harmony.toFixed(2);
    chordSlider.value      = g.chord;
    chordVal.textContent   = g.chord;
    applyRoom(g.room);
    // Apply to live state immediately (takes effect even while playing)
    state.scaleIdx      = g.scaleIdx;
    state.tempo         = g.tempo;
    state.density       = g.density;
    state.brightness    = g.brightness;
    state.spaciousness  = g.spaciousness;
    state.harmonyLock   = g.harmony;
    state.chordBeats    = g.chord;
  });
  genreBtnsEl.appendChild(btn);
});

// ─── Randomize ────────────────────────────────────────────────────────────────
function randomize() {
  document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));

  const root         = Math.floor(Math.random() * 12);
  const scale        = Math.floor(Math.random() * SCALE_LABELS.length);
  const bpm          = Math.floor(Math.random() * 91) + 50; // 50–140
  const octave       = Math.floor(Math.random() * 5) - 3; // -3 to +1
  const density      = Math.round((Math.random() * 0.8 + 0.1) * 100) / 100;
  const brightness   = Math.round((Math.random() * 0.8 + 0.1) * 100) / 100;
  const spaciousness = Math.round((Math.random() * 0.8 + 0.1) * 100) / 100;
  const harmonyLock  = Math.round((Math.random() * 0.5 + 0.5) * 100) / 100; // 0.5–1.0, lean musical
  const chordBeats   = [2, 3, 4, 4, 6, 8][Math.floor(Math.random() * 6)];

  rootSelect.value        = root;
  scaleSelect.value       = scale;
  bpmSlider.value         = bpm;
  bpmValue.textContent    = bpm;
  octaveSlider.value      = octave;
  octaveVal.textContent   = (octave >= 0 ? '+' : '') + octave;
  densitySlider.value     = density;
  densityVal.textContent  = density.toFixed(2);
  brightSlider.value      = brightness;
  brightVal.textContent   = brightness.toFixed(2);
  spaceSlider.value       = spaciousness;
  spaceVal.textContent    = spaciousness.toFixed(2);
  harmonySlider.value     = harmonyLock;
  harmonyVal.textContent  = harmonyLock.toFixed(2);
  chordSlider.value       = chordBeats;
  chordVal.textContent    = chordBeats;
  roomSelect.value        = roomFor(spaciousness, bpm);

  state.rootMidi     = ROOT_BASE_MIDI + root;
  state.scaleIdx     = scale;
  state.tempo        = bpm;
  state.octaveShift  = octave;
  state.density      = density;
  state.brightness   = brightness;
  state.spaciousness = spaciousness;
  state.harmonyLock  = harmonyLock;
  state.chordBeats   = chordBeats;

  // Clear all instruments first
  Object.keys(manualEnabled).forEach(k => {
    manualEnabled[k] = false;
    if (cbElements[k]) cbElements[k].checked = false;
  });

  // Bass: ~60% chance, one random subtype
  if (Math.random() < 0.6) {
    const sub = BASS_SUBTYPES[Math.floor(Math.random() * BASS_SUBTYPES.length)];
    manualEnabled[`bass:${sub}`] = true;
    if (cbElements[`bass:${sub}`]) cbElements[`bass:${sub}`].checked = true;
  }

  // Drums: ~60% chance, one random subtype
  if (Math.random() < 0.6) {
    const sub = DRUMS_SUBTYPES[Math.floor(Math.random() * DRUMS_SUBTYPES.length)];
    manualEnabled[`drums:${sub}`] = true;
    if (cbElements[`drums:${sub}`]) cbElements[`drums:${sub}`].checked = true;
  }

  // Simple voices: usually a handful, similar to infinite mode's 3–5, with
  // an occasional (~12%) denser pull so manual can still go bigger than
  // infinite ever does — just rarely, not as the common case.
  const simpleKeys = SIMPLE_VOICES.map(v => v.key);
  const pool  = [...simpleKeys].sort(() => Math.random() - 0.5);
  const count = Math.random() < 0.12
    ? 6 + Math.floor(Math.random() * (simpleKeys.length - 5)) // rare: 6–20
    : 2 + Math.floor(Math.random() * 4);                      // usual: 2–5
  pool.slice(0, count).forEach(k => {
    manualEnabled[k] = true;
    if (cbElements[k]) cbElements[k].checked = true;
  });

  if (manualPlaying) {
    applyManualVoices();
  }

  updatePlayEnabled();
}

genreRandomBtn.addEventListener('click', randomize);

// ─── Build instrument panel ───────────────────────────────────────────────────
const cbElements = {}; // key → <input> — needed for exclusive-group deselection

function makeCheckbox(key, label, exclusiveKeys = null) {
  const lbl = document.createElement('label');
  lbl.className = 'inst-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = false;
  cb.addEventListener('change', () => {
    if (exclusiveKeys && cb.checked) {
      exclusiveKeys.forEach(k => {
        if (k !== key) { manualEnabled[k] = false; if (cbElements[k]) cbElements[k].checked = false; }
      });
    }
    manualEnabled[key] = cb.checked;
    if (manualPlaying) {
      const any = Object.values(manualEnabled).some(v => v);
      if (!any) {
        stopManualPlayback();
      } else {
        applyManualVoices();
      }
    }
    updatePlayEnabled();
  });
  cbElements[key] = cb;
  const span = document.createElement('span');
  span.className = 'inst-name';
  span.textContent = label;
  lbl.appendChild(cb);
  lbl.appendChild(span);
  return lbl;
}

function makeGroup(groupLabel, entries, exclusiveKeys = null) {
  const wrap = document.createElement('div');
  wrap.className = 'voice-group';
  const name = document.createElement('span');
  name.className = 'group-label';
  name.textContent = groupLabel;
  wrap.appendChild(name);
  const row = document.createElement('div');
  row.className = 'subtype-row';
  entries.forEach(([key, label]) => row.appendChild(makeCheckbox(key, label, exclusiveKeys)));
  wrap.appendChild(row);
  return wrap;
}

const drumsKeys = DRUMS_SUBTYPES.map(s => `drums:${s}`);
voiceGroups.appendChild(makeGroup('BASS',  BASS_SUBTYPES.map(s  => [`bass:${s}`,  BASS_LABELS[s]])));
voiceGroups.appendChild(makeGroup('DRUMS', DRUMS_SUBTYPES.map(s => [`drums:${s}`, DRUMS_LABELS[s]]), drumsKeys));

const divider = document.createElement('div');
divider.className = 'voices-divider';
voiceGroups.appendChild(divider);

const grid = document.createElement('div');
grid.className = 'inst-grid';
SIMPLE_VOICES.forEach(({ key }) => grid.appendChild(makeCheckbox(key, key.toUpperCase())));
voiceGroups.appendChild(grid);

// ─── Play-enabled gate ────────────────────────────────────────────────────────
function updatePlayEnabled() {
  const any = Object.values(manualEnabled).some(v => v);
  manualPlayBtn.disabled = !any;
  if (!exporting) manualExportBtn.disabled = !any;
}
updatePlayEnabled();

// ─── Live slider / select updates (take effect mid-playback) ─────────────────
function clearGenreHighlight() {
  document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
}

bpmSlider.addEventListener('input', () => {
  state.tempo = parseInt(bpmSlider.value, 10);
  bpmValue.textContent = bpmSlider.value;
  clearGenreHighlight();
});
octaveSlider.addEventListener('input', () => {
  state.octaveShift = parseInt(octaveSlider.value, 10);
  const v = state.octaveShift;
  octaveVal.textContent = (v >= 0 ? '+' : '') + v;
  clearGenreHighlight();
});
densitySlider.addEventListener('input', () => {
  state.density = parseFloat(densitySlider.value);
  densityVal.textContent = state.density.toFixed(2);
  clearGenreHighlight();
});
brightSlider.addEventListener('input', () => {
  state.brightness = parseFloat(brightSlider.value);
  brightVal.textContent = state.brightness.toFixed(2);
  clearGenreHighlight();
});
spaceSlider.addEventListener('input', () => {
  state.spaciousness = parseFloat(spaceSlider.value);
  spaceVal.textContent = state.spaciousness.toFixed(2);
  clearGenreHighlight();
});
harmonySlider.addEventListener('input', () => {
  state.harmonyLock = parseFloat(harmonySlider.value);
  harmonyVal.textContent = state.harmonyLock.toFixed(2);
  clearGenreHighlight();
});
chordSlider.addEventListener('input', () => {
  state.chordBeats = parseInt(chordSlider.value, 10);
  chordVal.textContent = chordSlider.value;
  clearGenreHighlight();
});
lengthInput.addEventListener('input', () => {
  lengthValue.textContent = `${lengthInput.value}s`;
});
scaleSelect.addEventListener('change', clearGenreHighlight);
roomSelect.addEventListener('change', () => { applyRoom(roomSelect.value); clearGenreHighlight(); });
rootSelect.addEventListener('change',  clearGenreHighlight);

// Carry the settings infinite mode was playing into the edit panel's controls.
// Infinite mode has already been stopped by the time this runs — this only
// transfers the snapshot of root/scale/sliders/instruments, it doesn't resume
// playback, since infinite's own era evolution must not keep mutating them
// once we're in edit mode.
function syncManualFromInfinite() {
  clearGenreHighlight();

  rootSelect.value        = state.rootMidi - ROOT_BASE_MIDI;
  scaleSelect.value       = state.scaleIdx;
  bpmSlider.value         = state.tempo;
  bpmValue.textContent    = bpmSlider.value;
  octaveSlider.value      = state.octaveShift;
  octaveVal.textContent   = (state.octaveShift >= 0 ? '+' : '') + state.octaveShift;
  densitySlider.value     = state.density;
  densityVal.textContent  = state.density.toFixed(2);
  brightSlider.value      = state.brightness;
  brightVal.textContent   = state.brightness.toFixed(2);
  spaceSlider.value       = state.spaciousness;
  spaceVal.textContent    = state.spaciousness.toFixed(2);
  harmonySlider.value     = state.harmonyLock;
  harmonyVal.textContent  = state.harmonyLock.toFixed(2);
  chordSlider.value       = state.chordBeats;
  chordVal.textContent    = state.chordBeats;
  roomSelect.value        = state.room;

  Object.keys(manualEnabled).forEach(k => {
    manualEnabled[k] = false;
    if (cbElements[k]) cbElements[k].checked = false;
  });
  const bassKey = `bass:${bassVoice.style}`;
  manualEnabled[bassKey] = true;
  if (cbElements[bassKey]) cbElements[bassKey].checked = true;
  activeVoices.forEach(v => {
    const key = v.name === 'drums' ? `drums:${v.style}` : v.name;
    if (key in manualEnabled) {
      manualEnabled[key] = true;
      if (cbElements[key]) cbElements[key].checked = true;
    }
  });

  updatePlayEnabled();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    if (mode === currentMode) return;

    const wasInfinitePlaying = currentMode === 'infinite' && infiniteRunning;
    if (wasInfinitePlaying) stopInfinite();
    if (currentMode === 'manual' && manualPlaying) stopManualPlayback();

    currentMode = mode;
    modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    infiniteUi.style.display = mode === 'infinite' ? '' : 'none';
    if (mode === 'manual') {
      panelVisible = true;
      manualUi.classList.add('active');
      panelToggleBtn.style.display = 'none';
      if (wasInfinitePlaying) {
        syncManualFromInfinite();
      } else if (!Object.values(manualEnabled).some(v => v)) {
        randomize();
      }
    } else {
      panelVisible = false;
      manualUi.classList.remove('active');
      panelToggleBtn.style.display = 'none';
    }
  });
});

panelHideBtn.addEventListener('click', () => {
  const collapsed = manualUi.classList.toggle('collapsed');
  panelHideBtn.textContent = collapsed ? 'SHOW' : 'HIDE';
});

panelToggleBtn.addEventListener('click', () => {
  panelVisible = true;
  manualUi.classList.add('active');
  panelToggleBtn.style.display = 'none';
});

// ─── Keys ─────────────────────────────────────────────────────────────────────
// B toggles bloom.
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
  if (e.key.toLowerCase() === 'b') post.bloom = !post.bloom;
});

// ─── Infinite mode ────────────────────────────────────────────────────────────
function updateInfiniteDisplay() {
  const prog       = Math.min(100, Math.round((eraTimer / ERA_DURATION) * 100));
  const voiceNames = [
    `bass(${bassVoice.style})`,
    ...activeVoices.map(v => v.style ? `${v.name}(${v.style})` : v.name),
  ].join(' · ');
  const oct = state.octaveShift;
  stateEl.textContent = `${rootName()} ${scaleName()}  ·  ${Math.round(state.tempo)} bpm  ·  oct ${oct >= 0 ? '+' : ''}${oct}  ·  ${ROOMS[state.room].label.toLowerCase()}  ·  era ${state.era}  [${prog}%]\n${voiceNames}`;
}

function stopInfinite() {
  clearInterval(infiniteInterval);
  infiniteInterval = null;
  infiniteRunning  = false;
  muteAudio();
  startBtn.textContent = 'PLAY';
  startBtn.classList.remove('playing');
  infoEl.classList.remove('active');
  stateEl.classList.remove('active');
  stateEl.textContent = '';
}

startBtn.addEventListener('click', async () => {
  if (infiniteRunning) { stopInfinite(); return; }
  if (!await ensureAudioRunning()) return;
  unmuteAudio();

  startBtn.textContent = 'STOP';
  startBtn.classList.add('playing');
  infoEl.classList.add('active');
  stateEl.classList.add('active');

  state.scaleIdx    = 0;
  state.rootMidi    = ROOT_BASE_MIDI;
  state.tempo       = Math.floor(Math.random() * 79) + 52; // 52–130
  state.octaveShift = pick([-3, -2, -1, 0, 0, 1]);
  state.harmonyLock = 0.78;
  state.chordBeats  = 4;
  state.room        = roomFor(state.spaciousness, state.tempo);

  pickVoices();
  bassVoice.reroll();
  drumsVoice.reroll();

  startSession(audio.ctx.currentTime + START_DELAY);
  tick();
  updateInfiniteDisplay();

  infiniteRunning  = true;
  infiniteInterval = setInterval(() => {
    tick();
    updateInfiniteDisplay();
  }, TICK_MS);
});

// ─── Manual helpers ───────────────────────────────────────────────────────────
function enabledBassSubtypes()  { return BASS_SUBTYPES.filter(s  => manualEnabled[`bass:${s}`]);  }
function enabledDrumsSubtypes() { return DRUMS_SUBTYPES.filter(s => manualEnabled[`drums:${s}`]); }

// Live instrument changes: swap the voices and styles, leave the rest alone.
function applyManualVoices() {
  const { bassStyle, drumStyle, voices } = manualPlan();
  applyPlan({ state: {}, bassStyle, drumStyle, voices });
}

// The arrangement the manual controls describe, as plain data (see applyPlan).
function manualPlan() {
  const bassSubs = enabledBassSubtypes(), drumSubs = enabledDrumsSubtypes();
  return {
    state: {
      tempo:        parseInt(bpmSlider.value, 10),
      octaveShift:  parseInt(octaveSlider.value, 10),
      rootMidi:     ROOT_BASE_MIDI + parseInt(rootSelect.value, 10),
      scaleIdx:     parseInt(scaleSelect.value, 10),
      era:          0,
      density:      parseFloat(densitySlider.value),
      brightness:   parseFloat(brightSlider.value),
      spaciousness: parseFloat(spaceSlider.value),
      harmonyLock:  parseFloat(harmonySlider.value),
      chordBeats:   parseInt(chordSlider.value, 10),
      room:         roomSelect.value,
    },
    bassStyle: bassSubs.length ? pick(bassSubs) : null,
    drumStyle: drumSubs.length ? pick(drumSubs) : null,
    voices: [
      ...(drumSubs.length ? ['drums'] : []),
      ...SIMPLE_VOICES.filter(({ key }) => manualEnabled[key]).map(({ voice }) => voice.name),
    ],
  };
}

async function manualInit() {
  if (!await ensureAudioRunning()) return false;
  unmuteAudio();
  applyPlan(manualPlan());
  startSession(audio.ctx.currentTime + START_DELAY);
  return true;
}

function buildExportName(ext) {
  const root     = ROOT_NAMES[parseInt(rootSelect.value, 10)].replace('#', 's');
  const scale    = SCALE_LABELS[parseInt(scaleSelect.value, 10)].toLowerCase().replace(/\s+/g, '-');
  const bpm      = bpmSlider.value;
  const genreBtn = document.querySelector('.genre-btn.active');
  const prefix   = genreBtn ? genreBtn.textContent.toLowerCase() + '_' : '';
  return `${prefix}${root}_${scale}_${bpm}bpm.${ext}`;
}

function resetExportUI() {
  exportProgressWrap.classList.remove('active');
  exportProgressBar.style.width = '0%';
}

function muteAudio(fadeSec = 0.04) {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  [audio.masterGain.gain, audio.reverbGain.gain].forEach(p => {
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + fadeSec);
  });
}

function unmuteAudio() {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  [[audio.masterGain.gain, 0.55], [audio.reverbGain.gain, 0.45]].forEach(([p, target]) => {
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + 0.05);
  });
}

function stopManualPlayback() {
  if (manualInterval)    { clearInterval(manualInterval);   manualInterval    = null; }
  muteAudio();
  manualPlaying = false;
  manualPlayBtn.textContent = 'PLAY';
  manualPlayBtn.classList.remove('playing');
  updatePlayEnabled();
}

// ─── Manual play ─────────────────────────────────────────────────────────────
manualPlayBtn.addEventListener('click', async () => {
  if (manualPlaying) {
    stopManualPlayback();
    manualStatus.textContent = '';
    manualStatus.classList.remove('active');
    return;
  }

  if (!await manualInit()) return;
  manualPlaying = true;
  manualPlayBtn.textContent = 'STOP';
  manualPlayBtn.classList.add('playing');
  manualStatus.classList.add('active');
  manualStatus.textContent = 'PLAYING';

  tick({ skipBass: enabledBassSubtypes().length === 0, skipEvolve: true });
  manualInterval = setInterval(() => {
    tick({ skipBass: enabledBassSubtypes().length === 0, skipEvolve: true });
  }, TICK_MS);
});

// ─── Manual export ────────────────────────────────────────────────────────────
function encodeWav(decoded, numSamples) {
  const nCh = decoded.numberOfChannels;
  const sr  = decoded.sampleRate;
  const n   = Math.min(decoded.length, numSamples);
  const pcm = n * nCh * 2;
  const ab  = new ArrayBuffer(44 + pcm);
  const dv  = new DataView(ab);
  const s4  = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  s4(0, 'RIFF'); dv.setUint32(4, 36 + pcm, true);
  s4(8, 'WAVE'); s4(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, nCh, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nCh * 2, true); dv.setUint16(32, nCh * 2, true);
  dv.setUint16(34, 16, true); s4(36, 'data'); dv.setUint32(40, pcm, true);
  const chs = Array.from({ length: nCh }, (_, c) => decoded.getChannelData(c));
  let off = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) {
    const x = Math.max(-1, Math.min(1, chs[c][i]));
    dv.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
    off += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// Export renders offline in a hidden iframe (src/render.js) — its own copy
// of the engine, so live playback carries on untouched while it renders.
// The build passes the bundled renderer's filename in as __RENDER_URL__.
const RENDER_URL = typeof __RENDER_URL__ !== 'undefined' ? __RENDER_URL__ : 'src/render.js';
let exportFrame = null;

function cancelExport() {
  exportId++;
  exportFrame?.remove();
  exportFrame = null;
}

async function renderInFrame(plan, durationSec, onProgress) {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.srcdoc = `<script type="module" src="${RENDER_URL}"></script>`;
  const loaded = new Promise((res, rej) => { frame.onload = res; frame.onerror = rej; });
  document.body.appendChild(frame);
  exportFrame = frame;
  await loaded;
  const sampleRate = audio.ctx?.sampleRate ?? 48000;
  return frame.contentWindow.renderExport(plan, durationSec, sampleRate, onProgress);
}

function resetExportButton() {
  exporting = false;
  manualExportBtn.textContent = 'EXPORT';
  manualExportBtn.classList.remove('recording');
  resetExportUI();
  updatePlayEnabled();
}

manualExportBtn.addEventListener('click', async () => {
  if (exporting) { cancelExport(); resetExportButton(); manualStatus.textContent = 'CANCELLED'; return; }
  if (!window.OfflineAudioContext) {
    manualStatus.textContent = 'EXPORT NOT SUPPORTED IN THIS BROWSER';
    manualStatus.classList.add('active');
    return;
  }

  const myId        = ++exportId;
  const durationSec = Math.max(5, parseInt(lengthInput.value, 10) || 10);

  exporting = true;
  manualExportBtn.textContent = 'CANCEL 0%';
  manualExportBtn.classList.add('recording');
  manualStatus.classList.add('active');
  manualStatus.textContent = 'RENDERING';
  exportProgressWrap.classList.add('active');
  exportProgressBar.style.transition = 'none';
  exportProgressBar.style.width = '0%';

  let rendered = null;
  try {
    rendered = await renderInFrame(manualPlan(), durationSec, f => {
      if (exportId !== myId) return;
      const pct = Math.round(f * 100);
      exportProgressBar.style.width = `${pct}%`;
      manualExportBtn.textContent = `CANCEL ${pct}%`;
    });
  } catch (err) {
    console.error(err);
  }
  if (exportId !== myId) return; // cancelled
  exportFrame?.remove();
  exportFrame = null;

  if (rendered) {
    const url = URL.createObjectURL(encodeWav(rendered, rendered.length));
    const a   = document.createElement('a');
    a.href = url; a.download = buildExportName('wav');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  resetExportButton();
  manualStatus.textContent = rendered ? 'SAVED' : 'EXPORT FAILED';
});

// ─── Clear instruments ────────────────────────────────────────────────────────
clearInstrumentsBtn.addEventListener('click', () => {
  if (manualPlaying) stopManualPlayback();
  Object.keys(manualEnabled).forEach(k => {
    manualEnabled[k] = false;
    if (cbElements[k]) cbElements[k].checked = false;
  });
  updatePlayEnabled();
});

// ─── Collapsible sections ─────────────────────────────────────────────────────
document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', e => {
    if (e.target.closest('.clear-btn')) return;
    header.closest('.collapsible-section').classList.toggle('collapsed');
  });
});

// ─── Share / restore config via URL hash ─────────────────────────────────────
// Binary pack: 15 bytes → 20 base64url chars
// [rootOffset(1), scale(1), tempo(1), density×100(1), brightness×100(1),
//  spaciousness×100(1), instBitmask bits 0–39 (5 bytes),
//  harmonyLock×100(1), chordBeats(1), instBitmask bits 40–47 (1 byte),
//  room index(1)]
// Fields were appended over time; older 11-, 13- and 14-byte links still decode
// (missing fields fall back to current/default values).
const instByte = i => (i < 40 ? 6 + (i >> 3) : 13 + ((i - 40) >> 3));

function encodeConfig() {
  const b = new Uint8Array(15);
  b[0] = state.rootMidi - ROOT_BASE_MIDI;
  b[1] = state.scaleIdx;
  b[2] = state.tempo;
  b[3] = Math.round(state.density * 100);
  b[4] = Math.round(state.brightness * 100);
  b[5] = Math.round(state.spaciousness * 100);
  ALL_INST_KEYS.forEach((k, i) => {
    if (manualEnabled[k]) b[instByte(i)] |= (1 << (i % 8));
  });
  b[11] = Math.round(state.harmonyLock * 100);
  b[12] = state.chordBeats;
  b[14] = Math.max(0, Object.keys(ROOMS).indexOf(state.room));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeConfig(str) {
  try {
    const pad = str + '==='.slice(0, (4 - str.length % 4) % 4);
    const b   = Uint8Array.from(atob(pad.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    return {
      r: ROOT_BASE_MIDI + (b[0] % 12), s: b[1], t: b[2],
      d: b[3] / 100, b: b[4] / 100, p: b[5] / 100,
      m: ALL_INST_KEYS.filter((_, i) => b[instByte(i)] & (1 << (i % 8))),
      hl: b[11] !== undefined ? b[11] / 100 : undefined,
      cb: b[12] !== undefined ? b[12] : undefined,
      rm: b[14] !== undefined ? Object.keys(ROOMS)[b[14]] : undefined,
    };
  } catch { return null; }
}

function applyConfig(cfg) {
  if (!cfg) return;
  state.rootMidi     = cfg.r ?? state.rootMidi;
  state.scaleIdx     = cfg.s ?? state.scaleIdx;
  state.tempo        = cfg.t ?? state.tempo;
  state.density      = cfg.d ?? state.density;
  state.brightness   = cfg.b ?? state.brightness;
  state.spaciousness = cfg.p ?? state.spaciousness;
  state.harmonyLock  = cfg.hl ?? state.harmonyLock;
  state.chordBeats   = cfg.cb ?? state.chordBeats;
  state.room         = cfg.rm ?? state.room;

  rootSelect.value        = state.rootMidi - ROOT_BASE_MIDI;
  scaleSelect.value       = state.scaleIdx;
  bpmSlider.value         = state.tempo;
  bpmValue.textContent    = state.tempo;
  densitySlider.value     = state.density;
  densityVal.textContent  = state.density.toFixed(2);
  brightSlider.value      = state.brightness;
  brightVal.textContent   = state.brightness.toFixed(2);
  spaceSlider.value       = state.spaciousness;
  spaceVal.textContent    = state.spaciousness.toFixed(2);
  harmonySlider.value     = state.harmonyLock;
  harmonyVal.textContent  = state.harmonyLock.toFixed(2);
  chordSlider.value       = state.chordBeats;
  chordVal.textContent    = state.chordBeats;
  roomSelect.value        = state.room;

  const enabled = new Set(cfg.m || []);
  Object.keys(manualEnabled).forEach(k => {
    manualEnabled[k] = enabled.has(k);
    if (cbElements[k]) cbElements[k].checked = enabled.has(k);
  });
  updatePlayEnabled();
}

manualShareBtn.addEventListener('click', () => {
  const hash = `c=${encodeConfig()}`;
  history.replaceState(null, '', `#${hash}`);
  navigator.clipboard.writeText(window.location.href).then(() => {
    manualShareBtn.textContent = 'COPIED!';
  }).catch(() => {
    manualShareBtn.textContent = 'LINKED!';
  });
  setTimeout(() => { manualShareBtn.textContent = 'SHARE'; }, 1600);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
startAnimation();

// Restore config from URL hash (after all UI is wired)
const _hashMatch = location.hash.match(/[#&]c=([A-Za-z0-9\-_]+)/);
if (_hashMatch) {
  const cfg = decodeConfig(_hashMatch[1]);
  if (cfg) {
    applyConfig(cfg);
    // Switch to manual tab directly — bypass the auto-randomize guard in the click handler
    if (currentMode !== 'manual') {
      currentMode = 'manual';
      modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'manual'));
      infiniteUi.style.display = 'none';
      manualUi.classList.add('active');
    }
  }
}
