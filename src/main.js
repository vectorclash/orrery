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
  stabVoice, voxVoice, sawpluckVoice, guitarVoice,
  activeVoices, eraTimer, ERA_DURATION, eraAt, requestEra,
} from './audio/scheduler.js';
import { encodeConfig, decodeConfig } from './share.js';
import { startAnimation } from './visuals/animate.js';
import { post } from './visuals/post.js';

// ─── Definitions ──────────────────────────────────────────────────────────────
const ROOT_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALE_LABELS = ['AEOLIAN','DORIAN','PHRYGIAN','PENT MINOR','PENT MAJOR','LYDIAN','MIXOLYDIAN','MAJOR'];

// A genre is a style: a FEEL and a KIT.
//   feel  -- what the genre's button sets: scale, tempo, the sliders, room, pump and sweep.
//            harmony = chord-tone lock (0 loose/roaming … 1 strict/consonant),
//            chord = beats per chord (low = fast harmonic motion, high = slow).
//            RANDOMIZE ALL varies it: a tempo within `bpm`, a scale from `scales`,
//            any root, the sliders nudged.
//   kit   -- what it plays: one drum style and one bass style (null = sometimes
//            none), one voice from each `cores` pool, then `extras` [min, max]
//            more from `extra`.
// `electronic` genres are weighted 2:1 in RANDOMIZE ALL (see weightedGenre):
// before kits, a random pick drew from all 25 instruments evenly, and with
// most of them acoustic, orchestral or folk, most rolls sounded old-fashioned.
// (It was 3:1 with nine electronic genres; 2:1 with seventeen keeps the same
// share, about two thirds electronic.)
const GENRES = [
  // ─── Electronic ─────────────────────────────────────────────────────────────
  { name:'DEEP HOUSE', electronic:true, scaleIdx:1, tempo:122, density:0.62, brightness:0.45, spaciousness:0.50, harmony:0.82, chord:8, room:'room', pump:0.35,
    bpm:[118,125], scales:[1,0],
    kit:{ drums:['deep_house'], bass:['deep','deep','sub'], cores:[['stab','rhodes']], extra:['pad','juno','vox','texture','glass','solina'], extras:[1,2] } },
  { name:'NU-DISCO', electronic:true, scaleIdx:1, tempo:118, density:0.75, brightness:0.65, spaciousness:0.45, harmony:0.72, chord:4, room:'room', pump:0.30, sweep:0.55,
    bpm:[112,124], scales:[1,7,0],
    kit:{ drums:['disco'], bass:['disco','disco','synth'], cores:[['guitar'],['strings','synthbrass','rhodes']], extra:['clavinet','vox','stab','juno','solina','brass','glass'], extras:[1,2] } },
  { name:'AFRO HOUSE', electronic:true, scaleIdx:0, tempo:122, density:0.70, brightness:0.50, spaciousness:0.60, harmony:0.85, chord:8, room:'hall', pump:0.30,
    bpm:[118,124], scales:[0,1,2],
    kit:{ drums:['afro_house'], bass:['deep','sub'], cores:[['kalimba','mallet']], extra:['vox','pad','flute','choir','stab','texture'], extras:[1,2] } },
  { name:'AMAPIANO', electronic:true, scaleIdx:1, tempo:113, density:0.62, brightness:0.50, spaciousness:0.55, harmony:0.75, chord:4, room:'room',
    bpm:[110,116], scales:[1,0,7],
    kit:{ drums:['amapiano'], bass:['log'], cores:[['rhodes']], extra:['pad','vox','flute','glass','mallet','strings'], extras:[1,2] } },
  { name:'TECHNO', electronic:true, scaleIdx:2, tempo:130, density:0.78, brightness:0.55, spaciousness:0.35, harmony:0.90, chord:8, room:'studio', pump:0.40,
    bpm:[126,134], scales:[2,0,1],
    kit:{ drums:['techno'], bass:['acid','acid','rumble','synth'], cores:[['arpeggio','stab','sawpluck']], extra:['texture','monolead','glass','pad','drone'], extras:[1,2] } },
  { name:'MELODIC TECHNO', electronic:true, scaleIdx:0, tempo:124, density:0.72, brightness:0.50, spaciousness:0.75, harmony:0.90, chord:8, room:'hall', pump:0.35, sweep:0.20,
    bpm:[120,126], scales:[0,2,1],
    kit:{ drums:['techno'], bass:['rolling','rolling','synth'], cores:[['arpeggio','sawpluck'],['pad','juno','solina']], extra:['monolead','glass','texture','vox','drone'], extras:[1,2] } },
  { name:'TRANCE', electronic:true, scaleIdx:0, tempo:138, density:0.80, brightness:0.70, spaciousness:0.72, harmony:0.90, chord:4, room:'hall', pump:0.50,
    bpm:[134,140], scales:[0,7],
    kit:{ drums:['trance'], bass:['rolling'], cores:[['supersaw'],['sawpluck','arpeggio']], extra:['glass','monolead','pad','vox','solina'], extras:[0,1] } },
  { name:'EDM', electronic:true, scaleIdx:0, tempo:126, density:0.85, brightness:0.80, spaciousness:0.55, harmony:0.90, chord:4, room:'hall', pump:0.60,
    bpm:[124,128], scales:[0,7,3],
    kit:{ drums:['big_room'], bass:['rolling','synth','deep'], cores:[['supersaw'],['sawpluck','vox','monolead']], extra:['glass','arpeggio','vox','solina'], extras:[0,1] } },
  { name:'UK GARAGE', electronic:true, scaleIdx:1, tempo:132, density:0.70, brightness:0.55, spaciousness:0.45, harmony:0.75, chord:4, room:'room', pump:0.25,
    bpm:[128,136], scales:[1,0],
    kit:{ drums:['garage'], bass:['deep','sub','synth'], cores:[['stab','vox']], extra:['rhodes','pad','glass','texture','organ'], extras:[1,2] } },
  { name:'LIQUID DNB', electronic:true, scaleIdx:1, tempo:174, density:0.65, brightness:0.60, spaciousness:0.72, harmony:0.85, chord:8, room:'hall', pump:0.15,
    bpm:[170,176], scales:[1,0,7],
    kit:{ drums:['dnb','dnb','jungle'], bass:['reese','reese','sub'], cores:[['pad','juno','solina'],['rhodes','pluck','arpeggio']], extra:['vox','strings','glass','bell','texture'], extras:[1,2] } },
  { name:'SYNTHWAVE', electronic:true, scaleIdx:0, tempo:104, density:0.70, brightness:0.60, spaciousness:0.65, harmony:0.85, chord:4, room:'hall', pump:0.15,
    bpm:[88,118], scales:[0,2,1],
    kit:{ drums:['synthwave','outrun'], bass:['synth','rolling'], cores:[['juno','solina','synthbrass'],['monolead','arpeggio']], extra:['arpeggio','glass','supersaw','synthbrass'], extras:[0,1] } },
  { name:'FUTURE BASS', electronic:true, scaleIdx:7, tempo:75, density:0.75, brightness:0.75, spaciousness:0.70, harmony:0.90, chord:4, room:'hall', pump:0.55,
    bpm:[70,80], scales:[7,0,4],
    kit:{ drums:['halftime','trap'], bass:['sub'], cores:[['supersaw'],['vox','sawpluck']], extra:['glass','solina','vox','bell'], extras:[0,1] } },
  { name:'TRAP', electronic:true, scaleIdx:0, tempo:70, density:0.70, brightness:0.50, spaciousness:0.55, harmony:0.85, chord:8, room:'room',
    bpm:[64,76], scales:[0,2,3],
    kit:{ drums:['drill'], bass:['808'], cores:[['bell','glass','pluck','flute']], extra:['pad','choir','vox','strings','monolead','texture'], extras:[1,2] } },
  { name:'REGGAETON', electronic:true, scaleIdx:0, tempo:94, density:0.72, brightness:0.60, spaciousness:0.42, harmony:0.85, chord:4, room:'room',
    bpm:[88,100], scales:[0,1,2],
    kit:{ drums:['dembow'], bass:['808','sub'], cores:[['pluck','sawpluck','guitar']], extra:['vox','pad','juno','glass','monolead'], extras:[1,2] } },
  { name:'AFROBEATS', electronic:true, scaleIdx:1, tempo:104, density:0.66, brightness:0.60, spaciousness:0.45, harmony:0.80, chord:4, room:'room',
    bpm:[98,110], scales:[1,7,4],
    kit:{ drums:['afrobeats','afrobeats','afro'], bass:['plucked','sub','synth'], cores:[['guitar','kalimba','mallet']], extra:['pad','vox','rhodes','flute','glass','pluck'], extras:[1,2] } },
  { name:'LO-FI', electronic:true, scaleIdx:1, tempo:80, density:0.45, brightness:0.30, spaciousness:0.45, harmony:0.70, chord:4, room:'room', pump:0.10,
    bpm:[70,88], scales:[1,6,5],
    kit:{ drums:['boombap'], bass:['sub','plucked'], cores:[['rhodes']], extra:['pad','texture','vibraphone','juno','glass','mallet'], extras:[1,2] } },
  { name:'ELEC', electronic:true, scaleIdx:3, tempo:128, density:0.82, brightness:0.72, spaciousness:0.28, harmony:0.85, chord:4, room:'studio',
    bpm:[118,134], scales:[3,0,2],
    kit:{ drums:['four_four','breakbeat','house','minimal'], bass:['synth','sub'], cores:[['arpeggio','supersaw','juno']], extra:['pad','glass','monolead','texture','sawpluck'], extras:[1,2] } },
  // ─── Classic ────────────────────────────────────────────────────────────────
  { name:'AMBIENT', scaleIdx:5, tempo:65,  density:0.25, brightness:0.25, spaciousness:0.88, harmony:0.72, chord:8, room:'cathedral',
    bpm:[56,72], scales:[5,4,0],
    kit:{ drums:[null,null,null,'minimal'], bass:['sub',null,null], cores:[['pad','drone','texture']], extra:['glass','bell','choir','strings','harp','solina'], extras:[1,3] } },
  { name:'DARK',    scaleIdx:2, tempo:72,  density:0.45, brightness:0.12, spaciousness:0.65, harmony:0.75, chord:8, room:'hall',
    bpm:[60,80], scales:[2,0],
    kit:{ drums:['ghost','cinematic','minimal',null], bass:['rumble','sub'], cores:[['drone','choir','strings']], extra:['texture','organ','bell','brass','glass'], extras:[1,2] } },
  { name:'JAZZ',    scaleIdx:1, tempo:112, density:0.75, brightness:0.50, spaciousness:0.40, harmony:0.50, chord:4, room:'room',
    bpm:[96,128], scales:[1,6],
    kit:{ drums:['swing','brushes'], bass:['walking'], cores:[['rhodes','vibraphone','organ']], extra:['brass','melody','clavinet','flute'], extras:[1,2] } },
  { name:'ORCH',    scaleIdx:0, tempo:82,  density:0.60, brightness:0.38, spaciousness:0.78, harmony:0.85, chord:4, room:'hall',
    bpm:[70,96], scales:[0,1,5],
    kit:{ drums:['cinematic',null], bass:['plucked','sub'], cores:[['strings']], extra:['brass','choir','harp','flute','bell','mallet'], extras:[1,3] } },
  { name:'ZEN',     scaleIdx:4, tempo:56,  density:0.18, brightness:0.40, spaciousness:0.94, harmony:0.80, chord:8, room:'cathedral',
    bpm:[50,66], scales:[4,5],
    kit:{ drums:[null], bass:[null,'sub'], cores:[['kalimba','glass','flute']], extra:['drone','bell','texture','harp'], extras:[1,2] } },
  { name:'BLUES',   scaleIdx:3, tempo:88,  density:0.55, brightness:0.30, spaciousness:0.45, harmony:0.45, chord:4, room:'room',
    bpm:[76,100], scales:[3,6],
    kit:{ drums:['shuffle','swing'], bass:['walking','plucked'], cores:[['organ','rhodes']], extra:['brass','clavinet','melody'], extras:[1,2] } },
  { name:'FOLK',    scaleIdx:6, tempo:96,  density:0.48, brightness:0.55, spaciousness:0.58, harmony:0.85, chord:4, room:'room',
    bpm:[84,110], scales:[6,4,0],
    kit:{ drums:['brushes','four_four',null], bass:['plucked'], cores:[['pluck','harp']], extra:['flute','strings','kalimba','mallet','melody'], extras:[1,2] } },
  { name:'DREAM',   scaleIdx:5, tempo:72,  density:0.32, brightness:0.72, spaciousness:0.82, harmony:0.72, chord:8, room:'hall',
    bpm:[64,84], scales:[5,7,4],
    kit:{ drums:['halftime','minimal','ghost',null], bass:['sub'], cores:[['pad','juno','solina']], extra:['glass','texture','bell','supersaw','vox'], extras:[1,2] } },
  { name:'FUNK',    scaleIdx:3, tempo:110, density:0.82, brightness:0.68, spaciousness:0.20, harmony:0.55, chord:4, room:'studio',
    bpm:[98,118], scales:[3,1,6],
    kit:{ drums:['funk','boombap'], bass:['plucked','synth'], cores:[['clavinet','rhodes']], extra:['brass','organ','synthbrass','monolead'], extras:[1,2] } },
  { name:'EPIC',    scaleIdx:0, tempo:84,  density:0.62, brightness:0.42, spaciousness:0.74, harmony:0.90, chord:4, room:'hall',
    bpm:[76,92], scales:[0,7],
    kit:{ drums:['cinematic','halftime'], bass:['sub','rumble'], cores:[['strings','choir']], extra:['brass','supersaw','bell','choir'], extras:[1,2] } },
];

const BASS_SUBTYPES  = ['sub','plucked','walking','synth','rumble','deep','acid','rolling','disco','808','reese','log'];
const DRUMS_SUBTYPES = [
  'minimal','four_four','house','funk','boombap','breakbeat','jungle','garage','trap','halftime',
  'shuffle','swing','brushes','bossanova','reggae','dembow','afro','cinematic','ghost',
  'synthwave','outrun','deep_house','techno','trance','big_room',
  'disco','afro_house','amapiano','afrobeats','dnb','drill',
];
const BASS_LABELS    = {
  sub:'SUB', plucked:'PLUCK', walking:'WALK', synth:'SYNTH', rumble:'RUMBLE', deep:'DEEP', acid:'ACID', rolling:'ROLLING',
  disco:'DISCO', '808':'808', reese:'REESE', log:'LOG DRUM',
};
const DRUMS_LABELS   = {
  minimal:'MINIMAL', four_four:'4/4', house:'HOUSE', funk:'FUNK', boombap:'BOOM BAP', breakbeat:'BREAK',
  jungle:'JUNGLE', garage:'2-STEP', trap:'TRAP', halftime:'HALF TIME', shuffle:'SHUFFLE', swing:'SWING',
  brushes:'BRUSHES', bossanova:'BOSSA', reggae:'ONE DROP', dembow:'DEMBOW', afro:'AFRO 12/8',
  cinematic:'CINEMATIC', ghost:'GHOST', synthwave:'SYNTHWAVE', outrun:'OUTRUN',
  deep_house:'DEEP HOUSE', techno:'TECHNO', trance:'TRANCE', big_room:'BIG ROOM',
  disco:'DISCO', afro_house:'AFRO HOUSE', amapiano:'AMAPIANO', afrobeats:'AFROBEATS', dnb:'D&B', drill:'DRILL',
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
  // Same order as share.js's ALL_INST_KEYS, which a share link's voices follow.
  { key:'stab',       voice:stabVoice,       label:'CHORD STAB' },
  { key:'vox',        voice:voxVoice,        label:'VOCAL CHOP' },
  { key:'sawpluck',   voice:sawpluckVoice,   label:'SAW PLUCK' },
  { key:'guitar',     voice:guitarVoice,     label:'FUNK GUITAR' },
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
const pumpSlider      = document.getElementById('pump-slider');
const pumpVal         = document.getElementById('pump-val');
const sweepSlider     = document.getElementById('sweep-slider');
const sweepVal        = document.getElementById('sweep-val');
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
  pumpSlider.value       = state.pump;
  pumpVal.textContent    = fmt2(state.pump);
  sweepSlider.value      = state.sweep;
  sweepVal.textContent   = fmt2(state.sweep);
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
    ...(state.pump > 0 ? [`PUMP ${Math.round(state.pump * 100)}%`] : []),
    ...(state.sweep > 0 ? [`SWEEP ${Math.round(state.sweep * 100)}%`] : []),
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
// A genre button sets the genre's feel AND rolls its kit, so it sounds like
// the genre straight away. The genre stays "active" until a control is moved by
// hand; while it is, the FEEL and INSTRUMENTS randoms stay inside it.
let activeGenre = null;
const genreButtons = new Map(); // genre → its button

function setGenreHighlight(btn) {
  document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b === btn));
  activeGenre = btn ? [...genreButtons].find(([, b]) => b === btn)?.[0] ?? null : null;
  refreshSummaries();
}
function clearGenreHighlight() { setGenreHighlight(null); }

const round2 = x => Math.round(x * 100) / 100;
const between = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));

// The genre's feel: exactly its preset, or (vary) somewhere inside it.
function genreFeel(g, vary) {
  const feel = {
    scaleIdx: g.scaleIdx, tempo: g.tempo, density: g.density, brightness: g.brightness,
    spaciousness: g.spaciousness, harmonyLock: g.harmony, chordBeats: g.chord, room: g.room,
    pump: g.pump ?? 0, sweep: g.sweep ?? 0,
  };
  if (!vary) return feel;
  const nudge = (x, by) => round2(Math.min(0.95, Math.max(0.05, x + (Math.random() * 2 - 1) * by)));
  return {
    ...feel,
    rootMidi:     ROOT_BASE_MIDI + Math.floor(Math.random() * 12),
    scaleIdx:     pick(g.scales),
    tempo:        between(g.bpm),
    density:      nudge(g.density, 0.1),
    brightness:   nudge(g.brightness, 0.12),
    spaciousness: nudge(g.spaciousness, 0.1),
  };
}

// The genre's kit, rolled: a drum style, a bass style, a voice from each core
// pool and a few extras.
function rollKit(g) {
  const { drums, bass, cores, extra, extras } = g.kit;
  const keys = new Set();
  const d = pick(drums), b = pick(bass);
  if (d) keys.add(`drums:${d}`);
  if (b) keys.add(`bass:${b}`);
  for (const pool of cores) keys.add(pick(pool.filter(v => !keys.has(v))));
  extra.filter(v => !keys.has(v)).sort(() => Math.random() - 0.5).slice(0, between(extras)).forEach(v => keys.add(v));
  return keys;
}

function applyGenre(g, { vary = false } = {}) {
  applyFeel(genreFeel(g, vary));
  setInstruments(rollKit(g));
  setGenreHighlight(genreButtons.get(g));
}

// Electronic genres twice as likely as classic ones.
const GENRE_WEIGHT = g => (g.electronic ? 2 : 1);
function weightedGenre(except = null) {
  const pool = GENRES.filter(g => g !== except);
  let r = Math.random() * pool.reduce((s, g) => s + GENRE_WEIGHT(g), 0);
  for (const g of pool) if ((r -= GENRE_WEIGHT(g)) <= 0) return g;
  return pool[pool.length - 1];
}

for (const [label, electronic] of [['ELECTRONIC', true], ['CLASSIC', false]]) {
  const group = document.createElement('div');
  group.className = 'genre-group';
  const name = document.createElement('span');
  name.className = 'group-label';
  name.textContent = label;
  const row = document.createElement('div');
  row.className = 'genre-row';
  for (const g of GENRES.filter(x => !!x.electronic === electronic)) {
    const btn = document.createElement('button');
    btn.className = 'genre-btn';
    btn.textContent = g.name;
    btn.addEventListener('click', () => applyGenre(g));
    genreButtons.set(g, btn);
    row.appendChild(btn);
  }
  group.append(name, row);
  genreBtnsEl.appendChild(group);
}

// ─── Randomize ────────────────────────────────────────────────────────────────
// A genre other than the one already selected.
function randomizeGenre() {
  applyGenre(weightedGenre(activeGenre));
  flashSection('section-genre');
  flashSection('section-instruments');
}

// Inside the active genre if there is one; otherwise anything at all.
function randomizeFeel() {
  if (activeGenre) {
    applyFeel(genreFeel(activeGenre, true));
  } else {
    freeFeel();
  }
  flashSection('section-feel');
}

function freeFeel() {
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
    pump:         0,
    sweep:        0,
  });
  clearGenreHighlight();
}

// The active genre's kit, or (with none) a genre's kit, electronic-weighted --
// a coherent set either way. The feel is left alone.
function randomizeInstruments() {
  const keep = activeGenre;
  setInstruments(rollKit(activeGenre ?? weightedGenre()));
  if (keep) setGenreHighlight(genreButtons.get(keep));
  flashSection('section-instruments');
}

// Anything goes: the old free roll -- any feel, any 2–5 of every instrument.
// Kept as RANDOMIZE ALL's rare wildcard, for the combinations no genre makes.
function freeInstruments() {
  const keys = new Set();
  if (Math.random() < 0.6) keys.add(`bass:${pick(BASS_SUBTYPES)}`);
  if (Math.random() < 0.6) keys.add(`drums:${pick(DRUMS_SUBTYPES)}`);
  const pool = SIMPLE_VOICES.map(v => v.key).sort(() => Math.random() - 0.5);
  pool.slice(0, 2 + Math.floor(Math.random() * 4)).forEach(k => keys.add(k));
  setInstruments(keys);
}

const WILDCARD = 0.1;
function randomizeAll() {
  if (Math.random() < WILDCARD) {
    freeFeel();
    freeInstruments();
  } else {
    applyGenre(weightedGenre(), { vary: true });
  }
  flashSection('section-genre');
  flashSection('section-feel');
  flashSection('section-instruments');
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

// The panel is grouped for finding things: the drums by kind (the genre
// panel's two groups) and the voices by the part they play in an arrangement
// -- the roles Infinite mode builds its eras from. Display only: the summary,
// share links and the order a manual plan lists its voices in follow
// BASS_SUBTYPES, DRUMS_SUBTYPES and SIMPLE_VOICES, which are untouched.
const DRUM_GROUPS = [
  ['ELECTRONIC DRUMS', ['house','deep_house','disco','afro_house','amapiano','techno','trance','big_room','garage',
                        'breakbeat','jungle','dnb','trap','drill','halftime','boombap','dembow','afrobeats','synthwave','outrun']],
  ['CLASSIC DRUMS',    ['four_four','funk','shuffle','swing','brushes','bossanova','reggae','afro','cinematic','minimal','ghost']],
];
const VOICE_GROUPS = [
  ['PADS & CHORDS', ['pad','strings','choir','organ','drone','supersaw','juno','solina','synthbrass']],
  ['LEADS',         ['melody','flute','brass','sitar','vibraphone','monolead','vox']],
  ['RHYTHM',        ['arpeggio','rhodes','clavinet','harp','pluck','kalimba','mallet','stab','sawpluck','guitar']],
  ['AIR',           ['bell','glass','texture']],
];
// Anything added to the instrument lists but not to a group above still shows,
// at the end of the last group, rather than silently going missing.
function withStragglers(groups, all) {
  const placed = new Set(groups.flatMap(([, keys]) => keys));
  const left = all.filter(k => !placed.has(k));
  if (!left.length) return groups;
  console.warn('Ungrouped instruments:', left);
  return groups.map(([label, keys], i) => [label, i === groups.length - 1 ? [...keys, ...left] : keys]);
}

function makeGroup(groupLabel, toggles, layout = 'subtype-row') {
  const wrap = document.createElement('div');
  wrap.className = 'inst-group';
  const name = document.createElement('span');
  name.className = 'group-label';
  name.textContent = groupLabel;
  const row = document.createElement('div');
  row.className = layout;
  toggles.forEach(t => row.appendChild(t));
  wrap.append(name, row);
  return wrap;
}

// One drum style at a time, across both drum groups; any number of bass styles
// (a plan picks one of them).
const drumsKeys = DRUMS_SUBTYPES.map(s => `drums:${s}`);
voiceGroups.appendChild(makeGroup('BASS', BASS_SUBTYPES.map(s => makeCheckbox(`bass:${s}`, BASS_LABELS[s]))));
for (const [label, styles] of withStragglers(DRUM_GROUPS, DRUMS_SUBTYPES)) {
  voiceGroups.appendChild(makeGroup(label, styles.map(s => makeCheckbox(`drums:${s}`, DRUMS_LABELS[s], drumsKeys))));
}

const divider = document.createElement('div');
divider.className = 'voices-divider';
voiceGroups.appendChild(divider);

const voiceByKey = new Map(SIMPLE_VOICES.map(v => [v.key, v]));
for (const [label, keys] of withStragglers(VOICE_GROUPS, SIMPLE_VOICES.map(v => v.key))) {
  voiceGroups.appendChild(makeGroup(label, keys.map(k => makeCheckbox(k, voiceLabel(voiceByKey.get(k)))), 'inst-grid'));
}

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
pumpSlider.addEventListener('input', () => {
  state.pump = parseFloat(pumpSlider.value);
  pumpVal.textContent = state.pump.toFixed(2);
  clearGenreHighlight();
});
sweepSlider.addEventListener('input', () => {
  state.sweep = parseFloat(sweepSlider.value);
  sweepVal.textContent = state.sweep.toFixed(2);
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
  state.pump        = 0; // Infinite mode's eras have no sidechain
  state.sweep       = 0; // or filter sweep
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
      pump:         parseFloat(pumpSlider.value),
      sweep:        parseFloat(sweepSlider.value),
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
  const prefix   = genreBtn ? genreBtn.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '_' : '';
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
  state.pump         = cfg.pu ?? 0;
  state.sweep        = cfg.sw ?? 0;
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
