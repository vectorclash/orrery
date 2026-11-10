// ─── Genres ───────────────────────────────────────────────────────────────────
// Shared by the app (main.js) and the video studio, whose titles say how a song
// differs from its genre (video/youtube.js).

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
export const GENRES = [
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

// The genre a kit is from, for a song that doesn't say (a link from before languages, or
// a kit set by hand): the one that uses these drums, and this bass if more than one does.
export function genreOfKit({ bassStyle, drumStyle }) {
  const by = GENRES.filter(g => drumStyle && g.kit.drums.includes(drumStyle));
  return by.find(g => g.kit.bass.includes(bassStyle)) ?? by[0] ?? null;
}
