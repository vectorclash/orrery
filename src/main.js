import { state, rootName, scaleName, TICK_MS, LOOKAHEAD, START_DELAY, ROOT_BASE_MIDI, pick } from './state.js';
import { audio, ensureAudioRunning, setRoom, ROOMS } from './audio/context.js';
import {
  tick, pickVoices, setActiveVoices, applyPlan, startSession, roomFor,
  bassVoice, padVoice, melodyVoice, textureVoice, pluckVoice,
  bellVoice, arpeggioVoice, malletVoice, droneVoice, fluteVoice,
  choirVoice, stringsVoice, rhodesVoice, organVoice, glassVoice,
  harpVoice, brassVoice, drumsVoice,
  vibraphoneVoice, clavinetVoice, sitarVoice, kalimbaVoice, supersawVoice,
  junoVoice, solinaVoice, synthbrassVoice, monoleadVoice,
  activeVoices, eraTimer, ERA_DURATION, eraAt, requestEra,
} from './audio/scheduler.js';
import { encodeConfig, decodeConfig } from './share.js';
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
  { name:'EPIC',    scaleIdx:0, tempo:84,  density:0.62, brightness:0.42, spaciousness:0.74, harmony:0.90, chord:4, room:'hall' },
];

const BASS_SUBTYPES  = ['sub','plucked','walking','synth','rumble'];
const DRUMS_SUBTYPES = [
  'minimal','four_four','house','funk','boombap','breakbeat','jungle','garage','trap','halftime',
  'shuffle','swing','brushes','bossanova','reggae','dembow','afro','cinematic','ghost',
  'synthwave','outrun',
];
const BASS_LABELS    = { sub:'SUB', plucked:'PLUCK', walking:'WALK', synth:'SYNTH', rumble:'RUMBLE' };
const DRUMS_LABELS   = {
  minimal:'MINIMAL', four_four:'4/4', house:'HOUSE', funk:'FUNK', boombap:'BOOM BAP', breakbeat:'BREAK',
  jungle:'JUNGLE', garage:'2-STEP', trap:'TRAP', halftime:'HALF TIME', shuffle:'SHUFFLE', swing:'SWING',
  brushes:'BRUSHES', bossanova:'BOSSA', reggae:'ONE DROP', dembow:'DEMBOW', afro:'AFRO 12/8',
  cinematic:'CINEMATIC', ghost:'GHOST', synthwave:'SYNTHWAVE', outrun:'OUTRUN',
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
  { key:'supersaw',   voice:supersawVoice },
  { key:'juno',       voice:junoVoice },
  { key:'solina',     voice:solinaVoice },
  { key:'synthbrass', voice:synthbrassVoice, label:'SYNTH BRASS' },
  { key:'monolead',   voice:monoleadVoice,   label:'MONO LEAD' },
];
const voiceLabel = ({ key, label }) => label ?? key.toUpperCase();
// ─── UI refs ──────────────────────────────────────────────────────────────────
const startBtn        = document.getElementById('start-btn');
const nextBtn         = document.getElementById('next-btn');
const infoEl          = document.getElementById('info');
const stateEl         = document.getElementById('state-line');
const infiniteUi      = document.getElementById('infinite-ui');
const manualUi        = document.getElementById('manual-ui');
const manualUiBody    = document.getElementById('manual-ui-body');
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
const feelRandomBtn        = document.getElementById('feel-random-btn');
const instrumentsRandomBtn = document.getElementById('instruments-random-btn');
const randomizeAllBtn      = document.getElementById('randomize-all-btn');
const genreSummary         = document.getElementById('genre-summary');
const feelSummary          = document.getElementById('feel-summary');
const instrumentsSummary   = document.getElementById('instruments-summary');
const manualShareBtn       = document.getElementById('manual-share-btn');
const modeTabs             = document.querySelectorAll('.mode-tab');
const panelHideBtn         = document.getElementById('panel-hide-btn');

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

const fmt2 = x => (+x).toFixed(2);
const signed = x => (x >= 0 ? '+' : '') + x;

// Writes every FEEL control from `state`. All programmatic changes (genre,
// random, share link, carrying over from infinite) set `state` and call this,
// so the controls can't drift from what's playing.
function showFeel() {
  rootSelect.value       = state.rootMidi - ROOT_BASE_MIDI;
  scaleSelect.value      = state.scaleIdx;
  bpmSlider.value        = state.tempo;
  bpmValue.textContent   = bpmSlider.value;
  octaveSlider.value     = state.octaveShift;
  octaveVal.textContent  = signed(state.octaveShift);
  densitySlider.value    = state.density;
  densityVal.textContent = fmt2(state.density);
  brightSlider.value     = state.brightness;
  brightVal.textContent  = fmt2(state.brightness);
  spaceSlider.value      = state.spaciousness;
  spaceVal.textContent   = fmt2(state.spaciousness);
  harmonySlider.value    = state.harmonyLock;
  harmonyVal.textContent = fmt2(state.harmonyLock);
  chordSlider.value      = state.chordBeats;
  chordVal.textContent   = state.chordBeats;
  roomSelect.value       = state.room;
  refreshSummaries();
}

// Applies feel fields live; a room change crossfades into the new space.
function applyFeel(fields) {
  Object.assign(state, fields);
  if ('room' in fields && audio.started && !exporting) setRoom(state.room);
  showFeel();
}

// ─── Section summaries ────────────────────────────────────────────────────────
function enabledInstrumentLabels() {
  return [
    ...BASS_SUBTYPES.filter(s => manualEnabled[`bass:${s}`]).map(s => `${BASS_LABELS[s]} BASS`),
    ...DRUMS_SUBTYPES.filter(s => manualEnabled[`drums:${s}`]).map(s => `${DRUMS_LABELS[s]} DRUMS`),
    ...SIMPLE_VOICES.filter(({ key }) => manualEnabled[key]).map(voiceLabel),
  ];
}

function refreshSummaries() {
  genreSummary.textContent = document.querySelector('.genre-btn.active')?.textContent ?? 'CUSTOM';
  feelSummary.textContent = [
    `${ROOT_NAMES[rootSelect.value]} ${SCALE_LABELS[scaleSelect.value]}`,
    `${bpmSlider.value} BPM`,
    `OCT ${octaveVal.textContent}`,
    roomSelect.selectedOptions[0]?.textContent ?? '',
  ].join(' · ');
  instrumentsSummary.textContent = enabledInstrumentLabels().join(' · ') || 'NONE';
}

// Briefly lights up a section's summary, so a RANDOM on a collapsed section
// visibly lands.
function flashSection(id) {
  const el = document.getElementById(id);
  el.classList.add('flash');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('flash')));
}

// ─── Genre buttons ────────────────────────────────────────────────────────────
function setGenreHighlight(btn) {
  document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b === btn));
  refreshSummaries();
}
function clearGenreHighlight() { setGenreHighlight(null); }

function applyGenre(g, btn) {
  applyFeel({
    scaleIdx:     g.scaleIdx,
    tempo:        g.tempo,
    density:      g.density,
    brightness:   g.brightness,
    spaciousness: g.spaciousness,
    harmonyLock:  g.harmony,
    chordBeats:   g.chord,
    room:         g.room,
  });
  setGenreHighlight(btn);
}

GENRES.forEach(g => {
  const btn = document.createElement('button');
  btn.className = 'genre-btn';
  btn.textContent = g.name;
  btn.addEventListener('click', () => applyGenre(g, btn));
  genreBtnsEl.appendChild(btn);
});

// ─── Randomize ────────────────────────────────────────────────────────────────
const round2 = x => Math.round(x * 100) / 100;

// A preset other than the one already selected.
function randomizeGenre() {
  const btns = [...genreBtnsEl.children];
  const i = pick(GENRES.map((_, j) => j).filter(j => !btns[j].classList.contains('active')));
  applyGenre(GENRES[i], btns[i]);
  flashSection('section-genre');
}

function randomizeFeel() {
  const tempo        = Math.floor(Math.random() * 91) + 50; // 50–140
  const spaciousness = round2(Math.random() * 0.8 + 0.1);
  applyFeel({
    rootMidi:     ROOT_BASE_MIDI + Math.floor(Math.random() * 12),
    scaleIdx:     Math.floor(Math.random() * SCALE_LABELS.length),
    tempo,
    octaveShift:  Math.floor(Math.random() * 3) - 1, // -1 to +1
    density:      round2(Math.random() * 0.8 + 0.1),
    brightness:   round2(Math.random() * 0.8 + 0.1),
    spaciousness,
    harmonyLock:  round2(Math.random() * 0.5 + 0.5), // 0.5–1.0, lean musical
    chordBeats:   pick([2, 3, 4, 4, 6, 8]),
    room:         roomFor(spaciousness, tempo),
  });
  clearGenreHighlight();
  flashSection('section-feel');
}

function randomizeInstruments() {
  const keys = new Set();
  // Bass and drums: ~60% chance each, one random subtype
  if (Math.random() < 0.6) keys.add(`bass:${pick(BASS_SUBTYPES)}`);
  if (Math.random() < 0.6) keys.add(`drums:${pick(DRUMS_SUBTYPES)}`);

  // Simple voices: usually a handful, similar to infinite mode's 3–5, with
  // an occasional (~12%) denser pull so manual can still go bigger than
  // infinite ever does — just rarely, not as the common case.
  const simpleKeys = SIMPLE_VOICES.map(v => v.key);
  const pool  = [...simpleKeys].sort(() => Math.random() - 0.5);
  const count = Math.random() < 0.12
    ? 6 + Math.floor(Math.random() * (simpleKeys.length - 5)) // rare: 6–20
    : 2 + Math.floor(Math.random() * 4);                      // usual: 2–5
  pool.slice(0, count).forEach(k => keys.add(k));

  setInstruments(keys);
  flashSection('section-instruments');
}

function randomizeAll() {
  randomizeFeel();
  randomizeInstruments();
}

genreRandomBtn.addEventListener('click', randomizeGenre);
feelRandomBtn.addEventListener('click', randomizeFeel);
instrumentsRandomBtn.addEventListener('click', randomizeInstruments);
randomizeAllBtn.addEventListener('click', randomizeAll);

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
    instrumentsChanged();
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
SIMPLE_VOICES.forEach(v => grid.appendChild(makeCheckbox(v.key, voiceLabel(v))));
voiceGroups.appendChild(grid);

// Replaces the whole instrument selection with `keys`.
function setInstruments(keys) {
  Object.keys(manualEnabled).forEach(k => {
    manualEnabled[k] = keys.has(k);
    if (cbElements[k]) cbElements[k].checked = keys.has(k);
  });
  instrumentsChanged();
}

// Live instrument changes swap the voices; removing the last one stops.
function instrumentsChanged() {
  if (manualPlaying) {
    if (Object.values(manualEnabled).some(v => v)) applyManualVoices();
    else stopManualPlayback();
  }
  updatePlayEnabled();
  refreshSummaries();
}

// ─── Play-enabled gate ────────────────────────────────────────────────────────
function updatePlayEnabled() {
  const any = Object.values(manualEnabled).some(v => v);
  manualPlayBtn.disabled = !any;
  if (!exporting) manualExportBtn.disabled = !any;
}
updatePlayEnabled();

// ─── Live slider / select updates (take effect mid-playback) ─────────────────
bpmSlider.addEventListener('input', () => {
  state.tempo = parseInt(bpmSlider.value, 10);
  bpmValue.textContent = bpmSlider.value;
  clearGenreHighlight();
});
octaveSlider.addEventListener('input', () => {
  state.octaveShift = parseInt(octaveSlider.value, 10);
  octaveVal.textContent = signed(state.octaveShift);
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
rootSelect.addEventListener('change', () => {
  applyFeel({ rootMidi: ROOT_BASE_MIDI + parseInt(rootSelect.value, 10) });
  clearGenreHighlight();
});
scaleSelect.addEventListener('change', () => {
  applyFeel({ scaleIdx: parseInt(scaleSelect.value, 10) });
  clearGenreHighlight();
});
roomSelect.addEventListener('change', () => { applyFeel({ room: roomSelect.value }); clearGenreHighlight(); });

// Carry the settings infinite mode was playing into the edit panel's controls.
// Infinite mode has already been stopped by the time this runs — this only
// transfers the snapshot of root/scale/sliders/instruments, it doesn't resume
// playback, since infinite's own era evolution must not keep mutating them
// once we're in edit mode.
function syncManualFromInfinite() {
  clearGenreHighlight();
  showFeel();
  setInstruments(new Set([
    `bass:${bassVoice.style}`,
    ...activeVoices.map(v => v.name === 'drums' ? `drums:${v.style}` : v.name),
  ].filter(k => k in manualEnabled)));
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
    manualUi.classList.toggle('active', mode === 'manual');
    if (mode === 'manual') {
      if (wasInfinitePlaying) {
        syncManualFromInfinite();
      } else if (!Object.values(manualEnabled).some(v => v)) {
        randomizeAll();
      }
    }
  });
});

// The sheet folds into its own top bar (see #manual-ui in index.html).
panelHideBtn.addEventListener('click', () => {
  const collapsed = manualUi.classList.toggle('collapsed');
  panelHideBtn.setAttribute('aria-expanded', String(!collapsed));
  manualUiBody.inert = collapsed;
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

function showNext(shown) {
  nextBtn.classList.toggle('shown', shown);
  nextBtn.classList.remove('pending');
  nextBtn.tabIndex = shown ? 0 : -1;
  nextBtn.setAttribute('aria-hidden', String(!shown));
}

function stopInfinite() {
  clearInterval(infiniteInterval);
  infiniteInterval = null;
  infiniteRunning  = false;
  muteAudio();
  showNext(false);
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
  showNext(true);
  infoEl.classList.add('active');
  stateEl.classList.add('active');

  state.scaleIdx    = 0;
  state.rootMidi    = ROOT_BASE_MIDI;
  state.tempo       = Math.floor(Math.random() * 79) + 52; // 52–130
  state.octaveShift = pick([-1, 0, 0, 1]);
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
    if (eraAt === null) nextBtn.classList.remove('pending');
  }, TICK_MS);
});

// Moves on to a new era at the next bar line, without stopping.
nextBtn.addEventListener('click', () => {
  if (!infiniteRunning) return;
  requestEra();
  if (eraAt !== null) nextBtn.classList.add('pending');
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
clearInstrumentsBtn.addEventListener('click', () => setInstruments(new Set()));

// ─── Collapsible sections ─────────────────────────────────────────────────────
// An accordion: opening one section closes the others, which keeps the panel
// short (the collapsed ones still show their summary line).
const sections = document.querySelectorAll('.collapsible-section');
document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', e => {
    if (e.target.closest('.header-btn')) return;
    const section = header.closest('.collapsible-section');
    const opening = section.classList.contains('collapsed');
    sections.forEach(s => s.classList.toggle('collapsed', !(opening && s === section)));
  });
});

// ─── Share / restore config via URL hash ─────────────────────────────────────
// The link's format lives in share.js.

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
  showFeel();
  setInstruments(new Set(cfg.m || []));
}

manualShareBtn.addEventListener('click', () => {
  const hash = `c=${encodeConfig(manualEnabled)}`;
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
showFeel();

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
