import { state, rootName, START_DELAY, ROOT_BASE_MIDI, LATEST_COMPOSER, pick } from './state.js';
import { audio, ensureAudioRunning, audioStopped, setRoom, ROOMS, heardTime } from './audio/context.js';
import { everyTick } from './audio/ticker.js';
import {
  tick, pickVoices, setActiveVoices, applyPlan, startSession, roomFor,
  bassVoice, padVoice, melodyVoice, textureVoice, pluckVoice,
  bellVoice, arpeggioVoice, malletVoice, droneVoice, fluteVoice,
  choirVoice, stringsVoice, rhodesVoice, organVoice, glassVoice,
  harpVoice, brassVoice, drumsVoice,
  vibraphoneVoice, clavinetVoice, sitarVoice, kalimbaVoice, supersawVoice,
  junoVoice, solinaVoice, synthbrassVoice, monoleadVoice,
  stabVoice, voxVoice, sawpluckVoice, guitarVoice,
  activeVoices, eraTimer, ERA_DURATION, requestEra, eraDue, eraBegan, changeLandsAt,
  songFor, songOver, unloadSong, resumeSession, setSongFeel, rearrangeSong,
} from './audio/scheduler.js';
import { transport } from './audio/transport.js';
import { song, songSeconds, formFor } from './audio/song.js';
import { LANGUAGE_NAMES, voicesOf } from './audio/language.js';
import { isAir, carriersIn } from './audio/lines.js';
import { hookOfWritten, hookSection, transcribe } from './audio/transcribe.js';
import { library } from './library.js';
import { newSeed } from './random.js';
import { showPending, clearPending } from './pending.js';
import { encodeConfig, decodeConfig, planFromConfig, linkForPlan, ALL_INST_KEYS } from './share.js';
import { startAnimation } from './visuals/animate.js';
import { post } from './visuals/post.js';
import { mirrors, useSymmetry } from './visuals/mirrors.js';

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
// A share link only carries the instruments listed in ALL_INST_KEYS, so one
// added here but not there would play but be left out of links.
{
  const unshared = [
    ...BASS_SUBTYPES.map(s => `bass:${s}`),
    ...DRUMS_SUBTYPES.map(s => `drums:${s}`),
    ...SIMPLE_VOICES.map(v => v.key),
  ].filter(k => !ALL_INST_KEYS.includes(k));
  if (unshared.length) console.warn('Instruments missing from ALL_INST_KEYS in share.js:', unshared);
}
// ─── UI refs ──────────────────────────────────────────────────────────────────
const startBtn        = document.getElementById('start-btn');
const nextBtn         = document.getElementById('next-btn');
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
const manualStopBtn        = document.getElementById('manual-stop-btn');
const manualExportBtn      = document.getElementById('manual-export-btn');
const manualStatus         = document.getElementById('manual-status');
const exportProgressWrap   = document.getElementById('export-progress-wrap');
const exportProgressBar    = document.getElementById('export-progress-bar');
const clearInstrumentsBtn  = document.getElementById('clear-instruments-btn');
const genreRandomBtn       = document.getElementById('genre-random-btn');
const feelRandomBtn        = document.getElementById('feel-random-btn');
const kaleidoBtn           = document.getElementById('kaleido-btn');
const instrumentsRandomBtn = document.getElementById('instruments-random-btn');
const randomizeAllBtn      = document.getElementById('randomize-all-btn');
const genreSummary         = document.getElementById('genre-summary');
const genreHint            = document.getElementById('genre-hint');
const feelSummary          = document.getElementById('feel-summary');
const instrumentsSummary   = document.getElementById('instruments-summary');
const songSummary          = document.getElementById('song-summary');
const manualShareBtn       = document.getElementById('manual-share-btn');
const modeTabs             = document.querySelectorAll('.mode-tab');
const kindBtns             = document.querySelectorAll('.kind-btn[data-kind]'); // not FORM's, which share the look
const songExportBtn        = document.getElementById('song-export-btn');
const formBtns             = document.querySelectorAll('.form-btn');
const newSongBtn           = document.getElementById('new-song-btn');
const composerBtns         = document.querySelectorAll('.composer-btn');
const prevBtn              = document.getElementById('prev-btn');
const songActions          = document.getElementById('song-actions');
const keepBtn              = document.getElementById('keep-btn');
const likeBtn              = document.getElementById('like-btn');
const songRow              = document.getElementById('song-row');
const manualLikeBtn        = document.getElementById('manual-like-btn');
const manualKeepBtn        = document.getElementById('manual-keep-btn');
const libraryBtn           = document.getElementById('library-btn');
const libraryEl            = document.getElementById('library');
const libraryList          = document.getElementById('library-list');
const libraryTabs          = document.querySelectorAll('.library-tab');
const libraryCloseBtn      = document.getElementById('library-close');
const panelHideBtn         = document.getElementById('panel-hide-btn');

// ─── Enable state (all off by default) ───────────────────────────────────────
const manualEnabled = {};
BASS_SUBTYPES.forEach(s  => { manualEnabled[`bass:${s}`]  = false; });
DRUMS_SUBTYPES.forEach(s => { manualEnabled[`drums:${s}`] = false; });
SIMPLE_VOICES.forEach(({ key }) => { manualEnabled[key] = false; });

// ─── Playback state ───────────────────────────────────────────────────────────
let currentMode       = 'infinite';
let infiniteRunning   = false;
let infiniteTicks     = null;   // each holds the function that stops its ticks
let manualPlaying     = false;
let manualTicks       = null;
let paused            = false;  // playing, held where it is (one mode plays at a time)
let exporting         = false;
let exportId          = 0;      // incremented on each new export or cancellation
let exportBtn         = null;   // the button whose export is running
let infiniteKind      = localStorage.getItem('orrery.infinite') === 'songs' ? 'songs' : 'eras';
let songPlan          = null;   // the song Infinite mode is playing (or last played)
let manualForm        = 'loop'; // Edit mode: a LOOP of the arrangement, or a SONG made from it
let manualSongSeed    = newSeed();
let manualWriting     = null;   // the seed of the song this one takes its chords and hook from, if any
let manualHook        = null;   // the chords and hook it's been given as notes, if any (see audio/transcribe.js)
let linked            = null; // the configuration the address bar's link describes (see forgetStaleLink)
// LENGTH, in seconds, kept for each form: a loop's export, a song's length.
let loopLength        = 10;
let songLength        = 180;

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

const pct = x => `${Math.round(x * 100)}%`;
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
  densityVal.textContent = pct(state.density);
  brightSlider.value     = state.brightness;
  brightVal.textContent  = pct(state.brightness);
  spaceSlider.value      = state.spaciousness;
  spaceVal.textContent   = pct(state.spaciousness);
  harmonySlider.value    = state.harmonyLock;
  harmonyVal.textContent = pct(state.harmonyLock);
  chordSlider.value      = state.chordBeats;
  chordVal.textContent   = state.chordBeats;
  pumpSlider.value       = state.pump;
  pumpVal.textContent    = pct(state.pump);
  sweepSlider.value      = state.sweep;
  sweepVal.textContent   = pct(state.sweep);
  roomSelect.value       = state.room;
  showComposer();
  refreshSummaries();
}

function showGenre() {
  const genre = document.querySelector('.genre-btn.active')?.textContent ?? 'CUSTOM';
  genreSummary.textContent = keepingHook() ? `${genre} · SAME HOOK` : genre;
  genreHint.hidden = !keepingHook();
}

// ORIGINAL / LATEST: which composer writes the notes (see `state.composer`).
function showComposer() {
  composerBtns.forEach(b => {
    const on = (b.dataset.composer === 'new') === (state.composer >= 2);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// Applies feel fields live; a room change crossfades into the new space.
function applyFeel(fields) {
  Object.assign(state, fields);
  if ('room' in fields && audio.started && !exporting) setRoom(state.room);
  showFeel();
  syncSongFeel();
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
  feelSummary.textContent = [
    `${ROOT_NAMES[rootSelect.value]} ${SCALE_LABELS[scaleSelect.value]}`,
    `${bpmSlider.value} BPM`,
    `OCT ${octaveVal.textContent}`,
    roomSelect.selectedOptions[0]?.textContent ?? '',
    ...(state.pump > 0 ? [`PUMP ${Math.round(state.pump * 100)}%`] : []),
    ...(state.sweep > 0 ? [`SWEEP ${Math.round(state.sweep * 100)}%`] : []),
  ].join(' · ');
  instrumentsSummary.textContent = enabledInstrumentLabels().join(' · ') || 'NONE';
  showLength();
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
    pump: g.pump ?? 0, sweep: g.sweep ?? 0, language: g.name,
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
// pool and a few extras. For composer 2 (`writes`), a kit with none of the voices
// that carry a hook in this genre gets one.
function rollKit(g, writes = state.composer >= 2) {
  const { drums, bass, cores, extra, extras } = g.kit;
  const keys = new Set();
  const d = pick(drums), b = pick(bass);
  if (d) keys.add(`drums:${d}`);
  if (b) keys.add(`bass:${b}`);
  for (const pool of cores) keys.add(pick(pool.filter(v => !keys.has(v))));
  extra.filter(v => !keys.has(v)).sort(() => Math.random() - 0.5).slice(0, between(extras)).forEach(v => keys.add(v));
  const carriers = voicesOf(g.name);
  const count = isAir(carriers[0]) ? carriers : carriers.filter(v => !isAir(v));
  if (writes && !count.some(v => keys.has(v))) keys.add(pick(count.slice(0, 2)));
  return keys;
}

// A link keeps the composer that wrote it, so a song from an earlier NEW goes on
// playing as it was. Anything drawn afresh gets the latest.
function latestComposer() {
  if (state.composer >= 2) state.composer = LATEST_COMPOSER;
}

function applyGenre(g, { vary = false, keeping = {} } = {}) {
  latestComposer();
  applyFeel({ ...genreFeel(g, vary), ...keeping });
  setInstruments(rollKit(g));
  setGenreHighlight(genreButtons.get(g));
}

// Once a song is a variation of another, a hook is what it's about: a genre keeps that,
// and changes everything else. A song with its hook written down by a seed has it taken
// down as notes, since the new genre's language would write another from that seed.
function keepingHook() {
  return manualForm === 'song' && state.composer >= 2 && (manualHook !== null || manualWriting !== null);
}

// What a kept hook was written for, which the randoms leave alone: its mode, whose
// notes it's made of, and its chord length, which times its chords against its notes.
function hookFeel() {
  if (!keepingHook()) return {};
  const { scaleIdx, chordBeats } = manualPlan().state;
  return { scaleIdx, chordBeats };
}

function remix(g) {
  const keeping = hookFeel();
  if (!manualHook?.notes) manualHook = hookOfWritten(songFor(manualPlan()));
  manualSongSeed = newSeed();
  manualWriting = null;
  applyGenre(g, { keeping });
  showLength();
}

// Electronic genres twice as likely as classic ones.
const GENRE_WEIGHT = g => (g.electronic ? 2 : 1);
function weightedGenre(except = null) {
  const not = [except].flat();
  const pool = GENRES.filter(g => !not.includes(g));
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
    btn.addEventListener('click', () => {
      if (!keepingHook()) { applyGenre(g); return; }
      remix(g);
      replayManual();
    });
    genreButtons.set(g, btn);
    row.appendChild(btn);
  }
  group.append(name, row);
  genreBtnsEl.appendChild(group);
}

// ─── Randomize ────────────────────────────────────────────────────────────────
// A genre other than the one already selected.
function randomizeGenre() {
  const g = weightedGenre(activeGenre);
  if (keepingHook()) remix(g); else applyGenre(g);
  flashSection('section-genre');
  flashSection('section-instruments');
}

// Inside the active genre if there is one; otherwise anything at all.
function randomizeFeel() {
  if (activeGenre) {
    applyFeel({ ...genreFeel(activeGenre, true), ...hookFeel() });
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
    language:     'ANY',
    ...hookFeel(),
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

// All of it, the song's seed with the rest: in SONG form, another song.
const WILDCARD = 0.1;
function randomizeAll() {
  latestComposer();
  manualWriting = null;
  manualHook = null;
  if (Math.random() < WILDCARD) {
    freeFeel();
    freeInstruments();
  } else {
    applyGenre(weightedGenre(), { vary: true });
  }
  manualSongSeed = newSeed();
  if (manualForm === 'song') {
    songLength = drawnLength();
    lengthInput.value = songLength;
    flashSection('section-song');
  }
  showLength();
  flashSection('section-genre');
  flashSection('section-feel');
  flashSection('section-instruments');
}

// The length the song would draw for itself, as Infinite's songs do.
function drawnLength() {
  const plan = manualPlan();
  return songFor({ ...plan, song: { ...plan.song, length: undefined } }).target;
}

// While playing, each button shows how long until its change is heard. A
// change that makes another song plays it from the top, as NEW SONG does.
function pressed(btn, change, anotherSong = () => false) {
  btn.addEventListener('click', () => {
    if (anotherSong()) { change(); showPending(btn); replayManual(); return; }
    if (!manualPlaying || paused) { change(); showPending(btn); return; }
    const before = soundingVoices();
    change();
    if (!manualPlaying) { showPending(btn); return; } // left with no instruments
    // Tick now, so the voices that joined take their places on the grid from
    // the same moment changeLandsAt measures from.
    manualTick();
    showPending(btn, changeLandsAt(before, soundingVoices()));
  });
}
pressed(genreRandomBtn, randomizeGenre, keepingHook);
pressed(feelRandomBtn, randomizeFeel);
pressed(instrumentsRandomBtn, randomizeInstruments);
pressed(randomizeAllBtn, randomizeAll, () => manualForm === 'song');

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
  manualExportBtn.disabled = exporting ? exportBtn !== manualExportBtn : !any;
  manualLikeBtn.disabled = manualKeepBtn.disabled = !any;
  songExportBtn.disabled = exporting && exportBtn !== songExportBtn;
}
updatePlayEnabled();

// ─── Live slider / select updates (take effect mid-playback) ─────────────────
// Each slider, the state it sets, and how its value reads beside it.
for (const [slider, out, key, show] of [
  [bpmSlider,     bpmValue,   'tempo',        String],
  [octaveSlider,  octaveVal,  'octaveShift',  signed],
  [densitySlider, densityVal, 'density',      pct],
  [brightSlider,  brightVal,  'brightness',   pct],
  [spaceSlider,   spaceVal,   'spaciousness', pct],
  [harmonySlider, harmonyVal, 'harmonyLock',  pct],
  [pumpSlider,    pumpVal,    'pump',         pct],
  [sweepSlider,   sweepVal,   'sweep',        pct],
  [chordSlider,   chordVal,   'chordBeats',   String],
]) {
  slider.addEventListener('input', () => {
    state[key] = parseFloat(slider.value);
    out.textContent = show(state[key]);
    clearGenreHighlight();
  });
}
lengthInput.addEventListener('input', () => {
  if (manualForm === 'song') songLength = parseInt(lengthInput.value, 10);
  else loopLength = parseInt(lengthInput.value, 10);
  showLength();
});
// A song of another length is another song: from the top, as NEW SONG.
lengthInput.addEventListener('change', () => { if (manualForm === 'song') replayManual(); });
rootSelect.addEventListener('change', () => {
  applyFeel({ rootMidi: ROOT_BASE_MIDI + parseInt(rootSelect.value, 10) });
  clearGenreHighlight();
});
scaleSelect.addEventListener('change', () => {
  applyFeel({ scaleIdx: parseInt(scaleSelect.value, 10) });
  clearGenreHighlight();
});
roomSelect.addEventListener('change', () => { applyFeel({ room: roomSelect.value }); clearGenreHighlight(); });

// Carry what Infinite mode was playing into the edit panel's controls: a song
// whole (see showSong), an era as a LOOP of its key, feel and instruments.
// Infinite's ticks have stopped by the time this runs, so its era evolution
// can't go on changing them.
function syncManualFromInfinite() {
  if (infiniteKind === 'songs' && songPlan) {
    showSong(songPlan);
    return;
  }
  clearGenreHighlight();
  showFeel();
  setInstruments(new Set([
    `bass:${bassVoice.style}`,
    ...activeVoices.map(v => v.name === 'drums' ? `drums:${v.style}` : v.name),
  ].filter(k => k in manualEnabled)));
  setForm('loop');
}

// The state's settings, not its getters (rootBase), which can't be set back.
const settingsOf = s => Object.fromEntries(
  Object.entries(Object.getOwnPropertyDescriptors(s)).filter(([, d]) => 'value' in d).map(([k, d]) => [k, d.value]));

// Switching to EDIT doesn't stop the music: what plays carries on, now Edit's,
// with the controls describing it. A song goes on from where it has got to,
// and still stops at its end; an era goes on as a LOOP, no longer evolving, as
// Edit's loops don't. Paused, it stays paused, and PLAY carries on.
function handOverToEdit() {
  // Mid-fade into another song, which hasn't started yet: stop, as before.
  if (switching) { stopInfinite(); syncManualFromInfinite(); return; }
  releaseInfinite();
  // The controls take the song's own feel; what plays keeps its section's (a
  // lifted key, the energy), set only as each section starts. So the shared
  // state comes through the sync as it was.
  const playing = settingsOf(state);
  syncManualFromInfinite();
  Object.assign(state, playing);
  manualPlaying = true;
  manualStopBtn.disabled = false;
  manualStatus.classList.add('active');
  showManualPlaying(!paused);
  showManualStatus();
  updatePlayEnabled();
  if (!paused) manualTicks = everyTick(manualEveryTick);
}

// A song comes across whole -- its genre, its own feel (not a section's) and
// its seed -- so it can be played again, changed, or exported.
function showSong(plan) {
  manualSongSeed = plan.song.seed;
  manualWriting = plan.song.writing ?? null;
  manualHook = plan.song.hook ?? null;
  songLength = songFor(plan).target;
  applyFeel({ ...plan.state });
  setInstruments(new Set([
    ...(plan.bassStyle ? [`bass:${plan.bassStyle}`] : []),
    ...(plan.drumStyle ? [`drums:${plan.drumStyle}`] : []),
    ...plan.voices.filter(n => n !== 'drums'),
  ].filter(k => k in manualEnabled)));
  setGenreHighlight(genreButtons.get(GENRES.find(g => g.name === plan.genre)) ?? null);
  setForm('song');
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    if (mode === currentMode) return;

    const wasInfinitePlaying = currentMode === 'infinite' && infiniteRunning;
    if (currentMode === 'manual' && manualPlaying) stopManualPlayback();

    currentMode = mode;
    modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    infiniteUi.style.display = mode === 'infinite' ? '' : 'none';
    manualUi.classList.toggle('active', mode === 'manual');
    if (mode === 'manual') {
      if (wasInfinitePlaying) {
        handOverToEdit();
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

// ─── Kaleidoscope ─────────────────────────────────────────────────────────────
// A view setting, the same in both modes and remembered between visits; share
// links describe the music, so they leave it out.
function setKaleido(on) {
  post.kaleido = on;
  kaleidoBtn.classList.toggle('active', on);
  kaleidoBtn.setAttribute('aria-pressed', String(on));
  localStorage.setItem('orrery.kaleido', on ? 'on' : 'off');
}
setKaleido(localStorage.getItem('orrery.kaleido') === 'on');
kaleidoBtn.addEventListener('click', () => setKaleido(!post.kaleido));

// ─── Keys ─────────────────────────────────────────────────────────────────────
// B toggles bloom, K the kaleidoscope, M the 3D mirrors (no button: an extra),
// and 1–3 choose the mirrors' symmetry.
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
  const key = e.key.toLowerCase();
  if (key === 'b') post.bloom = !post.bloom;
  if (key === 'k') setKaleido(!post.kaleido);
  if (key === 'm') mirrors.on = !mirrors.on;
  if (mirrors.on && ['1', '2', '3'].includes(key)) useSymmetry(+key - 1);
});

// Space plays and pauses, as in any player. A control reached with Tab keeps
// Space for itself (that's how a keyboard presses it); one last clicked lets go
// of focus, or Space would press it again. A slider has no use for Space, and a
// select or a text field keeps it. (Not :focus-visible, which a key pressed on a
// clicked button turns on before this can ask.)
let tabbing = false;
window.addEventListener('pointerdown', () => { tabbing = false; }, true);
window.addEventListener('keydown', e => { if (e.key === 'Tab') tabbing = true; }, true);
window.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const t = e.target;
  if (t.closest?.('select, textarea, [contenteditable], input:not([type="range"], [type="checkbox"])')) return;
  if (t !== document.body && tabbing && t.type !== 'range') return;
  e.preventDefault();
  t.blur?.();
  (currentMode === 'manual' ? manualPlayBtn : startBtn).click();
});

// ─── Infinite mode ────────────────────────────────────────────────────────────
// Two ways to go on forever: ERAS, where everything -- key, tempo, instruments --
// changes every 38 seconds, and SONGS, one composed song after another, each
// from a genre's kit, with an intro, an outro and its sections in between
// (see src/audio/song.js).

// What's playing, in the words the controls use: a title, the key and tempo,
// where it has got to, and who's playing. Written every tick, so a line is
// only touched when it changes.
const nowPlaying = [...stateEl.children];
function showNowPlaying(...lines) {
  nowPlaying.forEach((el, i) => {
    const text = lines[i] ?? '';
    if (el.textContent !== text) el.textContent = text;
  });
}

// A line of names, broken only between them: RUMBLE BASS never splits.
const nameLine = names => names.map(n => n.replace(/ /g, '\u00a0')).join(' · ');

// An instrument by the name its button has in Edit.
function partName(name, style) {
  if (name === 'bass')  return `${BASS_LABELS[style] ?? style} BASS`;
  if (name === 'drums') return `${DRUMS_LABELS[style] ?? style} DRUMS`;
  return voiceLabel(voiceByKey.get(name) ?? { key: name });
}

// The line describes what's heard: a new era's key and voices wait until the
// era reaches the speakers, and until then the old one reads full time.
let shownEra = 0;
function updateInfiniteDisplay() {
  if (state.era !== shownEra && heardTime() < transport.timeAt(eraBegan)) return;
  shownEra = state.era;
  showNowPlaying(
    `ERA ${state.era + 1}`,
    nameLine([`${rootName()} ${SCALE_LABELS[state.scaleIdx]}`, `${Math.round(state.tempo)} BPM`, `OCT ${signed(state.octaveShift)}`, ROOMS[state.room].label]),
    `${clock(Math.min(eraTimer, ERA_DURATION))} / ${clock(ERA_DURATION)}`,
    nameLine([partName('bass', bassVoice.style), ...activeVoices.map(v => partName(v.name, v.style))]),
  );
}

const clock = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// Where the song being heard is: its section, how far in, and who's playing.
function songPosition() {
  const s = song.current;
  if (!s) return null;
  const b   = Math.min(s.end - 1e-6, Math.max(0, transport.beatAt(heardTime())));
  const sec = song.sectionAt(b);
  const label = sec.n > 1 ? `${sec.label} ${sec.n}` : sec.label;
  return { sec, label, at: clock(b * 60 / s.tempo), of: clock(songSeconds(s)) };
}

// Who plays in a section names the drums' level when it isn't the full kit:
// PULSE, LIGHT…
function updateSongDisplay() {
  const p = songPosition();
  if (!p) return;
  const { sec } = p;
  const drums = () => partName('drums', drumsVoice.style) + (sec.drums && sec.drums !== 'full' ? ` (${sec.drums.toUpperCase()})` : '');
  const key = ROOT_NAMES[(song.base.rootMidi - ROOT_BASE_MIDI + sec.shift) % 12];
  showNowPlaying(
    songEntry?.variation ? `${songPlan.genre} · VARIATION` : songPlan.genre,
    nameLine([`${key} ${SCALE_LABELS[state.scaleIdx]}`, `${Math.round(state.tempo)} BPM`, ROOMS[state.room].label]),
    `${p.label.toUpperCase()} · ${p.at} / ${p.of}`,
    nameLine([...(sec.bass ? [partName('bass', bassVoice.style)] : []), ...sec.voices.map(n => n === 'drums' ? drums() : partName(n))]),
  );
}

function showNext(shown) {
  for (const [btn, on] of [[nextBtn, shown], [prevBtn, shown && infiniteKind === 'songs']]) {
    btn.classList.toggle('shown', on);
    btn.tabIndex = on ? 0 : -1;
    btn.setAttribute('aria-hidden', String(!on));
  }
  clearPending();
}

function showInfinitePlaying(on) {
  startBtn.textContent = on ? 'PAUSE' : 'PLAY';
  startBtn.classList.toggle('playing', on);
}

// Infinite lets go: its ticks stop and its controls reset, and the music is
// left as it is, for STOP to silence or EDIT to take on (see handOverToEdit).
function releaseInfinite() {
  infiniteTicks?.();
  infiniteTicks    = null;
  infiniteRunning  = false;
  showNext(false);
  showInfinitePlaying(false);
  stateEl.classList.remove('active');
  showNowPlaying();
  updateKindUI();
}

function stopInfinite() {
  releaseInfinite();
  paused = false;
  muteAudio();
}

function startEras() {
  unloadSong();
  state.composer    = LATEST_COMPOSER;
  state.language    = pick(LANGUAGE_NAMES);
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
  shownEra = state.era;
  updateInfiniteDisplay();
}

// A new song from a genre's kit and a varied feel. What keeps a playlist from
// sounding samey is partly what it just played: not one of the last few genres, if
// it can help it not the same mode as the last song, and not a chord loop it has
// played lately. A few tries at that, then it takes what it has.
const RECENT_GENRES = 4;
const RECENT_LOOPS  = 8;
const recentGenres = [];
const recentLoops  = [];
const heldBy = s => s.sections.find(x => x.hook)?.prog.join(' ') ?? '';

function composeInfiniteSong() {
  const g = weightedGenre(recentGenres);
  let plan = null, loop = '';
  for (let tries = 0; tries < 8; tries++) {
    plan = planFromKeys({ octaveShift: 0, ...genreFeel(g, true), composer: LATEST_COMPOSER }, rollKit(g, true), newSeed());
    loop = heldBy(songFor(plan));
    if (plan.state.scaleIdx !== songPlan?.state.scaleIdx && !recentLoops.includes(loop)) break;
  }
  recentGenres.push(g);
  if (recentGenres.length > RECENT_GENRES) recentGenres.shift();
  recentLoops.push(loop);
  if (recentLoops.length > RECENT_LOOPS) recentLoops.shift();
  plan.genre = g.name;
  return plan;
}

// MORE LIKE THIS: the same chords and the same hook (the writing seed, see writeSong
// in audio/song.js), in the same key and tempo, with new instruments and an arrangement
// of its own. Of a few kits rolled, the one furthest from this one, the hook's carrier
// changing above all, since that's the voice you'd notice. It has to keep the song's
// form, which decides what the hook is written over, and the drums decide the form: a
// roll whose drums would change it keeps this song's, and the rest of the roll.
function likeThis(plan, hook = plan.song.hook) {
  const g = GENRES.find(x => x.name === plan.genre) ?? genreOfKit(plan);
  const carrierOf = p => carriersIn(p.voices, p.state.language)[0];
  const parts = p => new Set([...p.voices, p.bassStyle, p.drumStyle]);
  const was = parts(plan);
  let best = null, bestScore = -1;
  for (let tries = 0; g && tries < 16; tries++) {
    const p = planFromKeys(plan.state, rollKit(g, true), newSeed());
    if (formFor(p) !== formFor(plan)) {
      p.drumStyle = plan.drumStyle;
      p.voices = [...(plan.drumStyle ? ['drums'] : []), ...p.voices.filter(v => v !== 'drums')];
    }
    const score = [...parts(p)].filter(x => !was.has(x)).length + (carrierOf(p) !== carrierOf(plan) ? 3 : 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  // No genre to roll from: the same players, arranged anew.
  best ??= { ...plan, song: { seed: newSeed() } };
  best.song.writing = plan.song.writing ?? plan.song.seed;
  if (hook) best.song.hook = hook;
  best.genre = plan.genre;
  return best;
}

// A song from before hooks were written down has its own read out of it first, and its
// variation is the latest composer's, in the language of its genre, given that hook.
async function moreLikeThis(plan) {
  if (plan.state.composer >= 2) return likeThis(plan);
  const language = LANGUAGE_NAMES.includes(plan.genre) ? plan.genre : 'ANY';
  return likeThis({ ...plan, state: { ...plan.state, composer: LATEST_COMPOSER, language } }, await hookOf(plan));
}

// The genre a kit is from, for a song that doesn't say (a link from before languages, or
// a kit set by hand): the one that uses these drums, and this bass if more than one does.
function genreOfKit({ bassStyle, drumStyle }) {
  const by = GENRES.filter(g => drumStyle && g.kit.drums.includes(drumStyle));
  return by.find(g => g.kit.bass.includes(bassStyle)) ?? by[0] ?? null;
}

// ─── History ──────────────────────────────────────────────────────────────────
// Infinite's songs are a player's queue: PREV goes back through what it has played,
// NEXT forward through it again, and past the end there's a new song. It's the
// library's recent list, so it reaches back past a reload.
let songEntry = null;                         // the song playing, as the library has it
let place = library.recent.length - 1;        // where in the history that is

function entryFor(plan) {
  const s = songFor(plan);
  return {
    link: linkForPlan(plan, s.target), genre: plan.genre, root: plan.state.rootMidi, scale: plan.state.scaleIdx,
    tempo: plan.state.tempo, seconds: Math.round(songSeconds(s)), at: Date.now(),
    ...(plan.song.writing === undefined && !plan.song.hook ? {} : { variation: true }),
  };
}

// An entry's song, as Infinite plays them: at the octave it was written for.
function planOf(entry) {
  const cfg = decodeConfig(entry.link);
  if (!cfg?.song) return null;
  const plan = planFromConfig(cfg);
  plan.state.octaveShift = 0;
  plan.genre = entry.genre;
  return plan;
}

function fromHistory(i) {
  const plan = planOf(library.recent[i]);
  if (plan) place = i;
  return plan;
}

// A song that isn't from the history goes in straight after the one playing, so PREV
// comes back to that one, and NEXT carries on from where it was.
function played(plan) {
  place = library.played(entryFor(plan), place + 1);
  return plan;
}

const planAfter  = () => (place < library.recent.length - 1 && fromHistory(place + 1)) || played(composeInfiniteSong());
const planBefore = () => (place > 0 && fromHistory(place - 1)) || songPlan;

function startSong(plan) {
  songPlan = plan;
  songEntry = entryFor(plan);
  applyPlan(plan);
  startSession(audio.ctx.currentTime + START_DELAY);
  tick();
  updateSongDisplay();
  updateKindUI();
  showKept();
  if (!libraryEl.hidden) showLibrary();
}

// Straight on to another song, with a quick fade instead of a cut. `plan` is asked for
// when it starts, so a press that's ignored here moves nothing in the history.
let switching = false;
function switchSong(plan) {
  if (switching) return;
  switching = true;
  muteAudio(0.15);
  setTimeout(() => {
    switching = false;
    if (!infiniteRunning) return;
    if (!paused) unmuteAudio(); // switched to ERAS meanwhile: they're already playing
    if (infiniteKind === 'songs') startSong(plan());
  }, 170);
}
const nextSongNow = () => switchSong(planAfter);

// Another song, from wherever Infinite is: playing, it fades across; paused, it plays
// again with the change (a new song starts from silence, so it needs no fade); stopped,
// it starts.
let startOn = null;
async function goToSong(plan, btn = null) {
  if (btn) showPending(btn);
  if (!infiniteRunning) { startOn = plan; startInfinite(); return; }
  if (!paused) switchSong(plan);
  else if (await resumeInfinite()) startSong(plan());
}

function infiniteTick() {
  tick();
  if (infiniteKind === 'songs') {
    // The last chord has rung out: the next song.
    if (songOver() && audio.ctx.currentTime > transport.timeAt(song.current.end) + song.current.ring) nextSongNow();
    updateSongDisplay();
  } else {
    updateInfiniteDisplay();
    // An era that has run its time waits for the next chord change; NEXT
    // counts down to it just as if it had been pressed.
    const due = eraDue();
    if (due !== null) showPending(nextBtn, due);
  }
  pauseIfSilenced();
}

// Holds the song (or era) where it is, NEXT still offered; PLAY carries on.
function pauseInfinite() {
  infiniteTicks?.();
  infiniteTicks = null;
  pauseAudio();
  showInfinitePlaying(false);
}

async function resumeInfinite() {
  if (!await resumeAudio() || !infiniteRunning) return false;
  infiniteTicks ??= everyTick(infiniteTick);
  showInfinitePlaying(true);
  return true;
}

startBtn.addEventListener('click', () => {
  if (infiniteRunning) {
    if (paused) resumeInfinite(); else pauseInfinite();
    return;
  }
  startInfinite();
});

const startInfinite = oneStart(async () => {
  if (!await startAudio()) return;

  showInfinitePlaying(true);
  stateEl.classList.add('active');

  if (infiniteKind === 'songs') startSong((startOn ?? (() => played(composeInfiniteSong())))());
  else startEras();
  startOn = null;
  infiniteRunning = true;
  showNext(true);
  infiniteTicks   = everyTick(infiniteTick);
  updateKindUI();
});

// Eras: a new era at the next bar line, without stopping. Songs: the next
// song, straight away. Paused, either plays again with the change (a new
// song starts from silence, so it needs no fade).
nextBtn.addEventListener('click', async () => {
  if (!infiniteRunning) return;
  if (infiniteKind === 'songs') {
    goToSong(planAfter, nextBtn);
    return;
  }
  if (paused && !await resumeInfinite()) return;
  requestEra();
  showPending(nextBtn, eraDue());
});

// PREV, as any player has it: back to the top of this song, or if you've only just
// started it, to the one before.
const PREV_RESTARTS_AFTER = 3; // seconds

prevBtn.addEventListener('click', () => {
  if (!infiniteRunning || infiniteKind !== 'songs') return;
  const heard = transport.beatAt(heardTime()) * 60 / state.tempo;
  goToSong(heard > PREV_RESTARTS_AFTER ? () => songPlan : planBefore, prevBtn);
});

// ─── Keeping a song ───────────────────────────────────────────────────────────
function showKeep(btn, kept) {
  btn.textContent = kept ? 'KEPT' : 'KEEP';
  btn.classList.toggle('on', kept);
  btn.setAttribute('aria-pressed', String(kept));
  btn.title = kept ? 'In your library. Press to take it out' : 'Keep this song in your library';
}
function showKept() { showKeep(keepBtn, !!songEntry && library.isKept(songEntry.link)); }
function showManualKept() { showKeep(manualKeepBtn, manualForm === 'song' && library.isKept(shareConfig())); }

keepBtn.addEventListener('click', () => {
  if (!songEntry) return;
  if (library.isKept(songEntry.link)) library.unkeep(songEntry.link);
  else library.keep(songEntry);
  showKept();
  if (!libraryEl.hidden) showLibrary();
});

likeBtn.addEventListener('click', async () => {
  const plan = songPlan;
  if (!plan) return;
  showPending(likeBtn);
  const like = await moreLikeThis(plan);
  // If you've moved on while its hook was being read, this was for a song that's gone.
  if (plan === songPlan && currentMode === 'infinite') goToSong(() => played(like));
});

// The same two in Edit mode, for the song the controls describe.
function manualSong() {
  const plan = manualPlan();
  plan.genre = activeGenre?.name ?? genreOfKit(plan)?.name ?? 'CUSTOM';
  return plan;
}

manualKeepBtn.addEventListener('click', () => {
  const link = shareConfig();
  if (library.isKept(link)) library.unkeep(link);
  else library.keep({ ...entryFor(manualSong()), link });
  showManualKept();
  showKept();
});

manualLikeBtn.addEventListener('click', async () => {
  showPending(manualLikeBtn);
  const plan = manualSong();
  // The controls can have moved on from the song playing, which plays as it was written
  // (a genre pressed mid-song is only heard in the instruments). This means what you hear.
  if (manualPlaying && song.current && plan.state.composer >= 2 && !plan.song.hook) {
    const heard = hookOfWritten(song.current);
    if (JSON.stringify(heard) !== JSON.stringify(hookOfWritten(songFor(plan)))) plan.song.hook = heard;
  }
  const like = await moreLikeThis(plan);
  like.song.length = songLength;
  showSong(like);
  replayManual();
});

// ─── The library ──────────────────────────────────────────────────────────────
// The songs you've kept, and the ones you've heard lately (see library.js). Each can
// be played, or copied as a link; a kept one takes two presses to remove, since a song
// found by luck may not come round again.
let libraryTab = 'kept';

const scaleLabel = entry => `${ROOT_NAMES[entry.root - ROOT_BASE_MIDI]} ${SCALE_LABELS[entry.scale]}`;
const linkTo = entry => `${location.origin}${location.pathname}#c=${entry.link}`;

function timeAgo(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'JUST NOW';
  if (min < 60) return `${min} MIN AGO`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} HR AGO`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'YESTERDAY' : `${days} DAYS AGO`;
}

function libraryButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'header-btn';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

// Asks once more before `onSure`, for as long as the question stays up.
function removeButton(onSure) {
  let timer = 0;
  const btn = libraryButton('REMOVE', 'Take this song out of your library', () => {
    if (timer) { clearTimeout(timer); onSure(); return; }
    btn.textContent = 'SURE?';
    timer = setTimeout(() => { timer = 0; btn.textContent = 'REMOVE'; }, 2500);
  });
  return btn;
}

function libraryRow(entry) {
  const row = document.createElement('div');
  row.className = 'library-row';
  row.classList.toggle('current', entry.link === songEntry?.link);
  const about = document.createElement('div');
  about.className = 'library-about';
  const name = document.createElement('div');
  name.className = 'library-name';
  name.textContent = entry.variation ? `${entry.genre} · VARIATION` : entry.genre;
  const meta = document.createElement('div');
  meta.className = 'library-meta';
  meta.textContent = [scaleLabel(entry), `${entry.tempo} BPM`, clock(entry.seconds), timeAgo(entry.at)].join(' · ');
  about.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'library-actions';
  const link = libraryButton('LINK', 'Copy a link to this song', () => {
    navigator.clipboard.writeText(linkTo(entry)).then(() => { link.textContent = 'COPIED!'; }).catch(() => { link.textContent = 'FAILED'; });
    setTimeout(() => { link.textContent = 'LINK'; }, 1600);
  });
  const keep = library.isKept(entry.link)
    ? removeButton(() => { library.unkeep(entry.link); showKept(); showLibrary(); })
    : libraryButton('KEEP', 'Keep this song in your library', () => { library.keep(entry); showKept(); showLibrary(); });
  const play = libraryButton('PLAY', 'Play this song', () => {
    const plan = planOf(entry);
    if (plan) goToSong(() => played(plan), play);
  });
  actions.append(play, link, keep);
  row.append(about, actions);
  return row;
}

function showLibrary() {
  libraryTabs.forEach(b => {
    const on = b.dataset.tab === libraryTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    if (b.dataset.tab === 'kept') b.textContent = library.kept.length ? `KEPT ${library.kept.length}` : 'KEPT';
  });
  // The recent list is a queue, so a song played twice is there twice, and not always
  // in the order it was played. Here, each once, the latest first.
  const seen = new Set();
  const entries = libraryTab === 'kept' ? library.kept
    : [...library.recent].sort((a, b) => b.at - a.at).filter(e => !seen.has(e.link) && seen.add(e.link));
  libraryList.replaceChildren(...entries.map(libraryRow));
  if (entries.length) return;
  const none = document.createElement('div');
  none.className = 'library-none';
  none.textContent = libraryTab === 'kept' ? 'Press KEEP while a song plays, and it will be here.' : 'The songs you hear in SONGS will be here.';
  libraryList.append(none);
}

function setLibraryOpen(open) {
  libraryEl.hidden = !open;
  infiniteUi.classList.toggle('library-open', open);
  libraryBtn.classList.toggle('on', open);
  libraryBtn.setAttribute('aria-expanded', String(open));
  if (open) showLibrary();
}
libraryBtn.addEventListener('click', () => setLibraryOpen(libraryEl.hidden));
libraryCloseBtn.addEventListener('click', () => setLibraryOpen(false));
libraryTabs.forEach(b => b.addEventListener('click', () => { libraryTab = b.dataset.tab; showLibrary(); }));
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !libraryEl.hidden) setLibraryOpen(false); });

// ERAS / SONGS. A switch while playing starts the other straight away; while
// paused, it lets go of what was paused, and PLAY starts the other.
function updateKindUI() {
  kindBtns.forEach(b => {
    const on = b.dataset.kind === infiniteKind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  nextBtn.title = infiniteKind === 'songs' ? 'Next song' : 'Move on to the next era';
  songActions.hidden = infiniteKind !== 'songs' || !songPlan;
  libraryBtn.hidden = infiniteKind !== 'songs';
  if (infiniteKind !== 'songs') setLibraryOpen(false);
}
kindBtns.forEach(b => b.addEventListener('click', () => {
  if (b.dataset.kind === infiniteKind) return;
  infiniteKind = b.dataset.kind;
  localStorage.setItem('orrery.infinite', infiniteKind);
  updateKindUI();
  if (!infiniteRunning) return;
  if (paused) { stopInfinite(); return; }
  clearPending();
  showNext(true);
  if (infiniteKind === 'songs') startSong(played(composeInfiniteSong()));
  else startEras();
}));
updateKindUI();
showKept();

// ─── Manual helpers ───────────────────────────────────────────────────────────
function enabledBassSubtypes()  { return BASS_SUBTYPES.filter(s  => manualEnabled[`bass:${s}`]);  }
function enabledDrumsSubtypes() { return DRUMS_SUBTYPES.filter(s => manualEnabled[`drums:${s}`]); }
// Bass plays outside activeVoices, ticked only while a bass is chosen.
function soundingVoices() { return enabledBassSubtypes().length ? [bassVoice, ...activeVoices] : [...activeVoices]; }
function manualTick() { tick({ skipBass: enabledBassSubtypes().length === 0, skipEvolve: true }); }

// Live instrument changes: swap the voices and styles, leave the rest alone.
// In a song, the same song arranged for the new instruments.
function applyManualVoices() {
  const plan = manualPlan();
  if (song.current) rearrangeSong(plan);
  else applyPlan({ state: {}, bassStyle: plan.bassStyle, drumStyle: plan.drumStyle, voices: plan.voices });
}

// A plan from a feel and a set of instrument keys: a genre's kit, for
// Infinite mode's songs. One bass and one drum style, the first enabled.
function planFromKeys(feel, keys, seed) {
  const bass  = BASS_SUBTYPES.filter(s => keys.has(`bass:${s}`));
  const drums = DRUMS_SUBTYPES.filter(s => keys.has(`drums:${s}`));
  return {
    state: { era: 0, ...feel },
    bassStyle: bass[0] ?? null,
    drumStyle: drums[0] ?? null,
    voices: [
      ...(drums.length ? ['drums'] : []),
      ...SIMPLE_VOICES.filter(({ key }) => keys.has(key)).map(({ voice }) => voice.name),
    ],
    song: { seed },
  };
}

// The arrangement the manual controls describe, as plain data (see applyPlan):
// with FORM set to SONG, the song made from it.
function manualPlan() {
  const bassSubs = enabledBassSubtypes(), drumSubs = enabledDrumsSubtypes();
  const asSong = manualForm === 'song';
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
      composer:     state.composer,
      language:     state.language,
    },
    // A song picks from several the same way every time, so it plays as it
    // will export.
    bassStyle: !bassSubs.length ? null : asSong ? bassSubs[manualSongSeed % bassSubs.length] : pick(bassSubs),
    drumStyle: !drumSubs.length ? null : asSong ? drumSubs[manualSongSeed % drumSubs.length] : pick(drumSubs),
    voices: [
      ...(drumSubs.length ? ['drums'] : []),
      ...SIMPLE_VOICES.filter(({ key }) => manualEnabled[key]).map(({ voice }) => voice.name),
    ],
    ...(asSong ? { song: {
      seed: manualSongSeed, length: songLength,
      ...(manualWriting === null ? {} : { writing: manualWriting }),
      ...(manualHook === null ? {} : { hook: manualHook }),
    } } : {}),
  };
}

async function manualInit() {
  if (!await startAudio()) return false;
  applyPlan(manualPlan());
  startSession(audio.ctx.currentTime + START_DELAY);
  return true;
}

// genre_key_scale_bpm.wav, and a song's seed: each song its own file.
function exportName(plan, genre) {
  const root   = ROOT_NAMES[plan.state.rootMidi - ROOT_BASE_MIDI].replace('#', 's');
  const scale  = SCALE_LABELS[plan.state.scaleIdx].toLowerCase().replace(/\s+/g, '-');
  const prefix = genre ? genre.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '_' : '';
  const kind   = plan.song ? `_song-${plan.song.seed.toString(36)}` : '';
  return `${prefix}${root}_${scale}_${plan.state.tempo}bpm${kind}.wav`;
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

function showManualPlaying(on) {
  manualPlayBtn.textContent = on ? 'PAUSE' : 'PLAY';
  manualPlayBtn.classList.toggle('playing', on);
}

function stopManualPlayback() {
  manualTicks?.();
  manualTicks = null;
  clearPending();
  muteAudio();
  manualPlaying = false;
  paused = false;
  showManualPlaying(false);
  manualStopBtn.disabled = true;
  if (!exporting) {
    manualStatus.textContent = '';
    manualStatus.classList.remove('active');
  }
  updatePlayEnabled();
}

// ─── Pause ────────────────────────────────────────────────────────────────────
// Pausing suspends the audio context. Its clock stops, and every note already
// scheduled waits on it, so PLAY carries on from the moment it paused: the
// same song, the same bar, the drone still held.
function pauseAudio() {
  paused = true;
  muteAudio(PAUSE_FADE);
  const ctx = audio.ctx;
  // Not until the fade has reached the speakers, so it doesn't click and the
  // output holds only silence; not if PLAY came first.
  setTimeout(() => { if (paused && audio.ctx === ctx) ctx.suspend().catch(() => {}); }, silentAfter(PAUSE_FADE));
}

// The output queues what the context has rendered -- `outputLatency` of it,
// a tenth of a second on built-in speakers -- and a context stopped with
// music in that queue keeps it: Safari plays it first when audio next starts,
// in this page or the next, a moment of the old music mid-phrase. So the
// context only stops once a fade has gone through the queue: `silentAfter`
// milliseconds after one `fadeSec` long begins.
const PAUSE_FADE = 0.04;
const silentAfter = fadeSec => (fadeSec + (audio.ctx.outputLatency || audio.ctx.baseLatency || 0)) * 1000 + 100;

// PLAY waits on the browser before there's sound (see ensureAudioRunning): a
// moment for a fresh context, far longer while AirPlay opens. Pressed again
// meanwhile, it's the same start -- each press used to start a session, the
// second taking the music back to the top just after the first began.
function oneStart(start) {
  let starting = null;
  return () => starting ??= start().finally(() => { starting = null; });
}

// Resolves false if there's still no sound (see ensureAudioRunning). If the
// context had to be replaced, everything scheduled went with the old one, so
// the session starts again on the new one (see resumeSession). Pressed twice
// while waiting on the browser, it's one resume.
let resuming = null;
function resumeAudio() {
  return resuming ??= (async () => {
    const ctx = audio.ctx;
    if (!await startAudio()) return false;
    paused = false;
    if (audio.ctx !== ctx) resumeSession(audio.ctx.currentTime + START_DELAY);
    return true;
  })().finally(() => { resuming = null; });
}

// ─── Following the sound ──────────────────────────────────────────────────────
// The browser can stop the sound by itself (see audioStopped), and nothing
// else would tell the controls, so they'd go on offering PAUSE over silence.
// So they pause, as a player does when a call comes in, and PLAY carries on.
// Checked on every tick, and as soon as the context changes state.
async function startAudio() {
  if (!await ensureAudioRunning()) return false;
  audio.ctx.onstatechange = pauseIfSilenced;
  unmuteAudio();
  return true;
}

function pauseIfSilenced() {
  if (paused || !audioStopped()) return;
  if (infiniteRunning) pauseInfinite();
  if (manualPlaying)   pauseManual();
}

// Leaving the page (a reload, a link) while it plays: the same, or the next
// page would open on the end of this one's music (see silentAfter). The page
// mutes and waits while the audio thread fills the queue with silence, then
// closes -- a busy wait, since nothing else holds a page that's going, and at
// most LEAVE_WAIT_MS of it, which covers built-in speakers and headphones.
// Back from the back-forward cache, the closed context reads as stopped, so
// the controls pause and PLAY carries on in a new one (see resumeAudio).
const LEAVE_WAIT_MS = 300;
addEventListener('pagehide', () => {
  if (!audio.ctx || audio.ctx.state === 'closed') return;
  const audible = audio.ctx.state === 'running' && audio.masterGain.gain.value > 0;
  for (const p of [audio.masterGain.gain, audio.reverbGain.gain]) {
    p.cancelScheduledValues(0);
    p.value = 0;
  }
  if (audible) for (const until = performance.now() + Math.min(LEAVE_WAIT_MS, silentAfter(0)); performance.now() < until;);
  audio.ctx.close().catch(() => {});
});

// ─── Manual play ─────────────────────────────────────────────────────────────
// PLAY / PAUSE, and STOP: back to the top (a song from its intro).
manualPlayBtn.addEventListener('click', () => {
  if (manualPlaying) {
    if (paused) resumeManual(); else pauseManual();
    return;
  }
  startManual();
});

const startManual = oneStart(async () => {
  if (!await manualInit()) return;
  manualPlaying = true;
  showManualPlaying(true);
  manualStopBtn.disabled = false;
  manualStatus.classList.add('active');

  manualTick();
  showManualStatus();
  manualTicks = everyTick(manualEveryTick);
});
manualStopBtn.addEventListener('click', () => { if (manualPlaying) stopManualPlayback(); });

function manualEveryTick() {
  manualTick();
  showManualStatus();
  // A song stops when its last chord has rung out.
  if (songOver() && audio.ctx.currentTime > transport.timeAt(song.current.end) + song.current.ring) {
    stopManualPlayback();
    return;
  }
  pauseIfSilenced();
}

function pauseManual() {
  manualTicks?.();
  manualTicks = null;
  pauseAudio();
  showManualPlaying(false);
  showManualStatus();
}

async function resumeManual() {
  if (!await resumeAudio() || !manualPlaying) return;
  manualTicks ??= everyTick(manualEveryTick);
  showManualPlaying(true);
  showManualStatus();
}

// Playing or paused, and where a song is.
function showManualStatus() {
  if (exporting) return;
  const p = songPosition();
  const where = p ? `${p.label} · ${p.at} / ${p.of}` : '';
  manualStatus.textContent = paused ? (where ? `PAUSED · ${where}` : 'PAUSED') : where || 'PLAYING';
}

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

// A fresh renderer each time: module state from one render can't reach the next.
function openRenderer() {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.srcdoc = `<script type="module" src="${RENDER_URL}"></script>`;
  const ready = new Promise((res, rej) => { frame.onload = () => res(frame.contentWindow); frame.onerror = rej; });
  document.body.appendChild(frame);
  return { frame, ready };
}

async function loadRenderer() {
  const { frame, ready } = openRenderer();
  exportFrame = frame;
  return ready;
}

// A song's hook, read in a renderer of its own, which what's playing and any export can't
// reach (see transcribeHook in render.js). Without one, what it can tell from the song
// alone: its chords, and a new hook written over them.
async function hookOf(plan) {
  const { frame, ready } = openRenderer();
  try {
    return (await ready).transcribeHook(plan);
  } catch (err) {
    console.error(err);
    const sec = hookSection(songFor(plan));
    return sec && transcribe(plan, sec, []);
  } finally {
    frame.remove();
  }
}

// A song is first measured -- its hook alone, a fraction of the work (the
// first tenth of the progress) -- so the leveller starts at the song's level
// (see levelOfSong in src/render.js). Null if cancelled meanwhile.
async function renderInFrame(plan, durationSec, onProgress) {
  const sampleRate = audio.ctx?.sampleRate ?? 48000;
  const id = exportId;
  let share = 1;
  if (plan.song && plan.song.levelMs === undefined) {
    const levelMs = await (await loadRenderer()).levelOfSong(plan, sampleRate);
    exportFrame?.remove();
    if (exportId !== id) return null;
    plan = { ...plan, song: { ...plan.song, levelMs } };
    onProgress(0.1);
    share = 0.9;
  }
  const render = await loadRenderer();
  return render.renderExport(plan, durationSec, sampleRate, f => onProgress(1 - share + share * f));
}

// Renders `plan` for `durationSec` and downloads it as `filename`; `progress`
// hears how far it has got (0…1). One export at a time: `button` started it,
// and is the one that can cancel it. Resolves 'saved', 'failed' or 'cancelled'.
async function renderAndSave(plan, durationSec, filename, button, progress) {
  const myId = ++exportId;
  exporting = true;
  exportBtn = button;
  updatePlayEnabled();
  let rendered = null;
  try {
    rendered = await renderInFrame(plan, durationSec, f => { if (exportId === myId) progress(f); });
  } catch (err) {
    console.error(err);
  }
  if (exportId !== myId) return 'cancelled';
  exportFrame?.remove();
  exportFrame = null;
  exporting = false;
  exportBtn = null;
  updatePlayEnabled();
  if (!rendered) return 'failed';
  const url = URL.createObjectURL(encodeWav(rendered, rendered.length));
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'saved';
}

function stopExport() {
  cancelExport();
  exporting = false;
  exportBtn = null;
  updatePlayEnabled();
}

// How long an export of `plan` runs: a loop for its LENGTH; a song for its
// own length, its last chord rung out.
function exportSeconds(plan) {
  if (plan.song) return songSeconds(songFor(plan));
  return Math.max(5, loopLength);
}

function resetExportButton() {
  manualExportBtn.textContent = 'EXPORT';
  manualExportBtn.classList.remove('recording');
  resetExportUI();
}

manualExportBtn.addEventListener('click', async () => {
  if (exporting) {
    if (exportBtn !== manualExportBtn) return;
    stopExport(); resetExportButton(); manualStatus.textContent = 'CANCELLED';
    return;
  }
  if (!window.OfflineAudioContext) {
    manualStatus.textContent = 'EXPORT NOT SUPPORTED IN THIS BROWSER';
    manualStatus.classList.add('active');
    return;
  }

  manualExportBtn.textContent = 'CANCEL 0%';
  manualExportBtn.classList.add('recording');
  manualStatus.classList.add('active');
  manualStatus.textContent = 'RENDERING';
  exportProgressWrap.classList.add('active');
  exportProgressBar.style.transition = 'none';
  exportProgressBar.style.width = '0%';

  const plan = manualPlan();
  const genre = document.querySelector('.genre-btn.active')?.textContent;
  const done = await renderAndSave(plan, exportSeconds(plan), exportName(plan, genre), manualExportBtn, f => {
    const pct = Math.round(f * 100);
    exportProgressBar.style.width = `${pct}%`;
    manualExportBtn.textContent = `CANCEL ${pct}%`;
  });
  if (done === 'cancelled') return;
  resetExportButton();
  manualStatus.textContent = done === 'saved' ? 'SAVED' : 'EXPORT FAILED';
});

// Infinite mode's songs: the whole of the song playing (or last played),
// from its first bar, wherever it has got to.
songExportBtn.addEventListener('click', async () => {
  if (exporting) {
    if (exportBtn !== songExportBtn) return;
    stopExport(); songExportBtn.textContent = 'EXPORT';
    return;
  }
  if (!songPlan || !window.OfflineAudioContext) return;
  const plan = songPlan;
  songExportBtn.textContent = 'CANCEL 0%';
  songExportBtn.classList.add('recording');
  const done = await renderAndSave(plan, exportSeconds(plan), exportName(plan, plan.genre), songExportBtn, f => {
    songExportBtn.textContent = `CANCEL ${Math.round(f * 100)}%`;
  });
  if (done === 'cancelled') return;
  songExportBtn.classList.remove('recording');
  songExportBtn.textContent = done === 'saved' ? 'SAVED' : 'FAILED';
  setTimeout(() => { if (!exporting) songExportBtn.textContent = 'EXPORT'; }, 1600);
});

// ─── Form: a loop, or a song ──────────────────────────────────────────────────
// LOOP plays the arrangement as it is, for as long as it plays (and exports
// for LENGTH). SONG composes a song from it (see src/audio/song.js), as near
// LENGTH as whole phrases come: the instruments come and go section by
// section and the feel follows each section's energy, around the controls'
// settings. The song is its seed and length: the same until NEW SONG, RANDOMIZE
// ALL or a new LENGTH, so what plays is what exports, and a share link carries both.
function setForm(form) {
  manualForm = form;
  formBtns.forEach(b => {
    const on = b.dataset.form === form;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  newSongBtn.hidden = songRow.hidden = form !== 'song';
  // min and max first, so the value isn't clamped to the other form's range.
  const asSong = form === 'song';
  lengthInput.min   = asSong ? 30 : 5;
  lengthInput.max   = asSong ? 360 : 300;
  // A song by the second, so a length it drew for itself can be set again.
  lengthInput.step  = asSong ? 1 : 5;
  lengthInput.value = asSong ? songLength : loopLength;
  showLength();
}

// A loop's LENGTH; a song's as composed, which is LENGTH unless even the
// shortest song at this tempo is longer.
function showLength() {
  forgetStaleLink();
  showManualKept();
  showGenre();
  const asSong = manualForm === 'song';
  if (!asSong) lengthValue.textContent = `${loopLength}s`;
  else {
    const any = Object.values(manualEnabled).some(v => v);
    lengthValue.textContent = clock(any ? songSeconds(songFor(manualPlan())) : songLength);
  }
  songSummary.textContent = [
    asSong ? 'SONG' : 'LOOP',
    asSong ? lengthValue.textContent : clock(loopLength),
    state.composer >= 2 ? 'LATEST COMPOSER' : 'ORIGINAL COMPOSER',
  ].join(' · ');
}

// From the top, in the new form or with the new song: now if playing, at
// the next PLAY if paused.
function replayManual() {
  if (!manualPlaying) return;
  const wasPaused = paused;
  stopManualPlayback();
  if (wasPaused) return;
  manualPlayBtn.click();
}

formBtns.forEach(b => b.addEventListener('click', () => {
  if (b.dataset.form === manualForm) return;
  setForm(b.dataset.form);
  replayManual();
}));
newSongBtn.addEventListener('click', () => {
  latestComposer();
  manualSongSeed = newSeed();
  manualWriting = null;
  manualHook = null;
  showLength();
  showPending(newSongBtn);
  replayManual();
});
// The other composer, same settings and same seed: from the top, to compare them.
composerBtns.forEach(b => b.addEventListener('click', () => {
  const wanted = b.dataset.composer === 'new';
  if (wanted === state.composer >= 2) return;
  state.composer = wanted ? LATEST_COMPOSER : 1;
  if (wanted && state.language === 'ANY') state.language = genreOfKit(manualPlan())?.name ?? 'ANY';
  showComposer();
  showLength();
  replayManual();
}));

// While a song plays, the FEEL controls set the song's own feel, which each
// section then varies; set straight onto the state, a section would undo them
// at its next beat.
function syncSongFeel() {
  if (!song.current || !manualPlaying) return;
  setSongFeel({
    density:      parseFloat(densitySlider.value),
    brightness:   parseFloat(brightSlider.value),
    spaciousness: parseFloat(spaceSlider.value),
    pump:         parseFloat(pumpSlider.value),
    rootMidi:     ROOT_BASE_MIDI + parseInt(rootSelect.value, 10),
  });
}
manualUiBody.addEventListener('input', syncSongFeel);
manualUiBody.addEventListener('change', syncSongFeel);

// ─── Clear instruments ────────────────────────────────────────────────────────
clearInstrumentsBtn.addEventListener('click', () => setInstruments(new Set()));

// ─── Collapsible sections ─────────────────────────────────────────────────────
// An accordion: opening one section closes the others, which keeps the panel
// short (the collapsed ones still show their summary line). A closed section's
// controls are inert, so Tab doesn't wander into what can't be seen.
const sections = document.querySelectorAll('.collapsible-section');
function openSection(open) {
  sections.forEach(s => {
    const shut = s !== open;
    s.classList.toggle('collapsed', shut);
    s.querySelector('.section-toggle').setAttribute('aria-expanded', String(!shut));
    s.querySelector('.section-body').inert = shut;
  });
}
openSection(null);
document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', e => {
    if (e.target.closest('.header-btn')) return;
    const section = header.closest('.collapsible-section');
    openSection(section.classList.contains('collapsed') ? section : null);
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
  state.composer     = cfg.cv ?? 1;
  state.language     = cfg.lg ?? 'ANY';
  showFeel();
  setInstruments(new Set(cfg.m || []));
  if (cfg.song) {
    manualSongSeed = cfg.song.seed;
    manualWriting = cfg.song.writing ?? null;
    manualHook = cfg.song.hook ?? null;
    // A link from before songs had lengths: the length the song drew itself.
    songLength = cfg.song.length ?? songFor(planFromConfig(cfg)).target;
  }
  setForm(cfg.song ? 'song' : 'loop');
}

// The configuration as a link: the controls' own feel, not the state a song
// playing varies section by section (its key lifted, its density following
// the energy).
function shareConfig() {
  const plan = manualPlan();
  return encodeConfig(manualEnabled, plan.song ?? null, plan.state);
}

// The address bar carries a link once one is opened or SHARE is pressed. Once
// anything changes it no longer describes what's set -- reloading or copying it
// would bring the old configuration back -- so it goes, until the next SHARE.
function forgetStaleLink() {
  if (linked === null || shareConfig() === linked) return;
  linked = null;
  history.replaceState(null, '', location.pathname + location.search);
}

manualShareBtn.addEventListener('click', () => {
  linked = shareConfig();
  history.replaceState(null, '', `#c=${linked}`);
  navigator.clipboard.writeText(window.location.href).then(() => {
    manualShareBtn.textContent = 'COPIED!';
  }).catch(() => {
    manualShareBtn.textContent = 'LINKED!';
  });
  setTimeout(() => { manualShareBtn.textContent = 'SHARE'; }, 1600);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
// The page writes with the latest composer unless a link says otherwise. The state's
// own default stays 1, so a plan that doesn't say is played as it was written.
state.composer = LATEST_COMPOSER;
startAnimation();
setForm(manualForm);
showFeel();

// Restore config from URL hash (after all UI is wired)
const _hashMatch = location.hash.match(/[#&]c=([A-Za-z0-9\-_]+)/);
if (_hashMatch) {
  const cfg = decodeConfig(_hashMatch[1]);
  if (cfg) {
    applyConfig(cfg);
    linked = shareConfig();
    // Switch to manual tab directly — bypass the auto-randomize guard in the click handler
    if (currentMode !== 'manual') {
      currentMode = 'manual';
      modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'manual'));
      infiniteUi.style.display = 'none';
      manualUi.classList.add('active');
    }
  }
}
