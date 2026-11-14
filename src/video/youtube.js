// ─── For YouTube ──────────────────────────────────────────────────────────────
// What an upload needs besides the video, made from the song: a title, a
// description with the song's chapters, tags, and a thumbnail; and the
// channel's own pictures (an avatar and a banner). The studio shows the text
// to copy and saves the pictures (studio.js); the frames come from the stage's
// still() (stage.js), so they're the video's own.
//
// YouTube's limits, as of 2026: a title of 100 characters, a description of
// 5,000, tags of 500 in all (each counted with its comma; one with a space in
// it counts its quotes too). Chapters come from timestamps in the
// description: the first at 0:00, at least three, each at least 10 s long.
// A thumbnail is 1280×720, under 2 MB; an avatar 800×800, shown as a circle;
// a banner 2560×1440, under 6 MB, of which only the middle 1546×423 shows everywhere.

import { SCALE_NAMES } from '../state.js';
import { GENRES, genreOfKit } from '../genres.js';

export const LIMITS = { title: 100, description: 5000, tags: 500 };
export const THUMB = [1280, 720];
export const AVATAR = [800, 800];
export const BANNER = [2560, 1440];
const BANNER_SAFE = [1546, 423];
const THUMB_MAX_BYTES = 2_000_000;
const BANNER_MAX_BYTES = 6_000_000;
const CHAPTER_MIN = 10; // seconds

const FONT = '"Courier Prime", "Courier New", monospace';

// The instruments by name, as a listener would know them. Every key of
// share.js's ALL_INST_KEYS; one missing falls back to the key itself.
const VOICE_NAMES = {
  pad: 'analogue pad', melody: 'soft synth lead', texture: 'shimmer', pluck: 'fingerpicked guitar',
  bell: 'handbells', arpeggio: 'arpeggiator', mallet: 'marimba', drone: 'drone', flute: 'flute',
  choir: 'choir', strings: 'string section', rhodes: 'electric piano', organ: 'tonewheel organ',
  glass: 'glass harmonica', harp: 'harp', brass: 'brass', vibraphone: 'vibraphone', clavinet: 'clavinet',
  sitar: 'sitar', kalimba: 'kalimba', supersaw: 'supersaw', juno: 'polysynth pad', solina: 'string machine',
  synthbrass: 'synth brass', monolead: 'mono synth lead', stab: 'chord stab', vox: 'vocal chop',
  sawpluck: 'saw pluck', guitar: 'disco rhythm guitar',
};
const BASS_NAMES = {
  sub: 'sub bass', plucked: 'plucked bass', walking: 'walking bass', synth: 'synth bass', rumble: 'rumble bass',
  deep: 'deep house bass', acid: 'acid bass', rolling: 'rolling bass', disco: 'disco bass', '808': '808 bass',
  reese: 'reese bass', log: 'log drum',
};
// Each drum pattern by name, and the genre it says the song is (a tag), if it says one.
const DRUMS = {
  minimal: ['minimal', 'minimal'], four_four: ['four-on-the-floor', 'electronic'], house: ['house', 'house'],
  funk: ['funk', 'funk'], boombap: ['boom bap', 'boom bap'], breakbeat: ['breakbeat', 'breakbeat'],
  jungle: ['jungle', 'jungle'], garage: ['2-step', 'uk garage'], trap: ['trap', 'trap'],
  halftime: ['half-time', null], shuffle: ['shuffle', null], swing: ['swing', 'jazz'], brushes: ['jazz brushes', 'jazz'],
  bossanova: ['bossa nova', 'bossa nova'], reggae: ['one drop', 'reggae'], dembow: ['dembow', 'reggaeton'],
  afro: ['afro 12/8', 'afro'], cinematic: ['cinematic', 'cinematic'], ghost: ['ghost', null],
  synthwave: ['synthwave', 'synthwave'], outrun: ['outrun', 'outrun'], deep_house: ['deep house', 'deep house'],
  techno: ['techno', 'techno'], trance: ['trance', 'trance'], big_room: ['big room', 'big room'],
  disco: ['disco', 'disco'], afro_house: ['afro house', 'afro house'], amapiano: ['amapiano', 'amapiano'],
  afrobeats: ['afrobeats', 'afrobeats'], dnb: ['drum and bass', 'drum and bass'], drill: ['drill', 'drill'],
};
// What a video style says of the music (see STYLE_ABOUT in catalog.js).
const STYLE_GENRES = {
  DRIFT: ['ambient'], CLUB: ['electronic', 'dance music'], DISCO: ['nu disco'], RETRO: ['synthwave', 'retrowave'],
  FILM: ['lofi'], CINEMA: ['cinematic'], GLITCH: ['future bass'],
};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const unique = list => [...new Set(list.filter(Boolean))];
const clock = s => {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// ── Chapters ──
// From the song's sections ({ label, t0, t1 }, in video time): one each,
// a short one folded into the one before it (the END into the OUTRO, say),
// and a label that comes round again numbered. None for a loop, or if
// YouTube's rules can't be met.
export function chapters(sections, duration) {
  const list = [];
  for (const s of sections) {
    if (s.t1 <= s.t0) continue;
    const short = s.t1 - s.t0 < CHAPTER_MIN || s.label === 'END';
    if (list.length && short) { list.at(-1).t1 = s.t1; continue; }
    list.push({ label: s.label, t0: s.t0, t1: s.t1 });
  }
  if (!list.length) return [];
  list[0].t0 = 0; // a title card or a cut can start the first a moment in
  // The first is short only if it's the only one so far: fold it into the next.
  if (list.length > 1 && list[0].t1 - list[0].t0 < CHAPTER_MIN) { list[1].t0 = 0; list.shift(); }
  list.at(-1).t1 = duration;
  if (list.length < 3 || list.some(c => c.t1 - c.t0 < CHAPTER_MIN)) return [];
  const count = {}, seen = {};
  for (const c of list) count[c.label] = (count[c.label] ?? 0) + 1;
  return list.map(c => {
    const name = cap(c.label.toLowerCase());
    return { at: clock(c.t0), name: count[c.label] > 1 ? `${name} ${(seen[c.label] = (seen[c.label] ?? 0) + 1)}` : name };
  });
}

// ── The text ──
// The title and description are written as a 1970s schools science programme
// would have it (see lesson() below); the tags are plain, for search.
// `p`: the plan; `key`: e.g. 'D♯ MINOR'; `name`: the song's, if it has one;
// `style`: the video's; `sections`, `duration`: the video's.
// `rhythm`: the song's meter, { meter: '3/4', change: { kind, meter } | null }
// (the stage knows it, see configure in stage.js), or null for 4/4.
// `taken`: the titles other songs have been given (the studio keeps them), so
// one the same in every word gets a numeral. `name`: one typed for the song,
// which goes before the description.
export function youtubeText({ p, key, name, style, sections, duration, taken = [], rhythm = null }) {
  const drums = p.drumStyle && p.voices.includes('drums') ? DRUMS[p.drumStyle] ?? [p.drumStyle.replace(/_/g, ' '), null] : null;
  const bass = p.bassStyle ? BASS_NAMES[p.bassStyle] ?? `${p.bassStyle} bass` : null;
  const voices = p.voices.filter(v => v !== 'drums').map(v => VOICE_NAMES[v] ?? v);
  const genres = unique([drums?.[1], ...(STYLE_GENRES[style] ?? [])]);
  const genre = genres[0] ?? 'electronic';
  const keyName = key.replace(/\s+(\S.*)$/, (_, scale) => ` ${scale.toLowerCase().replace(/^(dorian|phrygian|lydian|mixolydian)/, cap)}`);
  const kind = p.song ? 'song' : 'loop';

  const marks = chapters(p.song ? sections : [], duration);
  const typed = name?.trim();
  const line = songLine(p, genre), short = songLine(p, genre, 1);
  // Within YouTube's 100 characters: without the key and tempo if need be,
  // then with one instrument, rather than cut off mid-word.
  const make = n => {
    const fits = typed
      ? [`${typed} · ${line}${n} · Orrery`, `${typed} · ${short}${n} · Orrery`]
      : [`${line}${n} (${keyName}, ${p.state.tempo} BPM) · Orrery`, `${line}${n} · Orrery`, `${short}${n} · Orrery`];
    return fits.find(t => t.length <= LIMITS.title) ?? fits.at(-1).slice(0, LIMITS.title);
  };
  let title = make(''), n = 2;
  while (taken.includes(title)) title = make(` ${roman(n++)}`);
  const { description } = lesson({ p, keyName, heading: (typed ? `${typed}: ${line}` : line).toUpperCase(), drums, kind, duration, marks, rhythm });

  const keyTag = keyName.toLowerCase().replace('♯', ' sharp');
  const candidates = unique([
    'orrery', typed?.toLowerCase(), ...genres, ...genres.map(g => `${g} music`),
    'generative music', 'procedural music', 'algorithmic music', 'music visualizer', 'audio visualizer',
    'synthesizer', 'web audio', `${p.state.tempo} bpm`, keyTag, drums?.[0], bass, ...voices,
    'no ai', 'instrumental', 'music video',
  ]);
  // Fitted to the limit as YouTube counts: each tag and a comma, quotes round one with a space.
  const tags = [];
  let used = 0;
  for (const t of candidates) {
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (tags.length ? 1 : 0);
    if (used + cost > LIMITS.tags) continue;
    tags.push(t); used += cost;
  }
  return { title, description, tags: tags.join(', '), chapters: marks.length };
}

// ── The pictures ──
// `frame`: a data URL of the video's frame at the picture's size (still() in
// stage.js). Returns a Blob.

function spaced(g, text, x, y, px, spacing) {
  g.font = `${px}px ${FONT}`;
  if ('letterSpacing' in g) { g.letterSpacing = `${spacing * px}px`; g.fillText(text, x, y); g.letterSpacing = '0px'; return; }
  for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + spacing * px; }
}
function measure(g, text, px, spacing) {
  g.font = `${px}px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = `${spacing * px}px`;
  const w = g.measureText(text).width - ('letterSpacing' in g ? 0 : -spacing * px * text.length);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return w - spacing * px; // no space after the last letter
}

async function canvasFor(frame, width, height) {
  await document.fonts.load(`40px ${FONT}`).catch(() => {});
  const img = new Image();
  img.src = frame;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, 0, width, height);
  return { canvas, g };
}
const blobOf = (canvas, type, quality) => new Promise(res => canvas.toBlob(res, type, quality));

// The thumbnail: the frame, and the song's name large, low on the left, as the opening card is set.
export async function thumbnail(frame, name) {
  const [w, h] = THUMB;
  const { canvas, g } = await canvasFor(frame, w, h);
  const text = name?.trim().toUpperCase();
  if (text) {
    const margin = Math.round(h * 0.08);
    let px = 104;
    while (px > 40 && measure(g, text, px, 0.12) > w - 2 * margin) px -= 4;
    // A shade under the words, so they read at the size a thumbnail is seen.
    const shade = g.createLinearGradient(0, h * 0.45, 0, h);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e4edf6';
    g.shadowColor = 'rgba(0, 0, 0, 0.7)';
    g.shadowBlur = 24;
    spaced(g, text, margin, h - margin, px, 0.12);
  }
  return jpegUnder(canvas, THUMB_MAX_BYTES);
}

// As JPEG, under YouTube's limit for the picture. A starfield is mostly black,
// so the first is usually far under it (as PNG, a banner came to the limit).
async function jpegUnder(canvas, max) {
  for (const q of [0.92, 0.85, 0.75, 0.6]) {
    const blob = await blobOf(canvas, 'image/jpeg', q);
    if (blob.size < max) return blob;
  }
  return blobOf(canvas, 'image/jpeg', 0.5);
}

// The avatar: the frame alone (YouTube crops it to a circle).
export async function avatar(frame) {
  const { canvas } = await canvasFor(frame, ...AVATAR);
  return blobOf(canvas, 'image/png');
}

// The banner: the frame, with the name and a line under it in the middle of
// the strip every device shows, on a band of shade so they read over the picture.
export async function banner(frame, { name = 'ORRERY', line = '' } = {}) {
  const [w, h] = BANNER, [sw, sh] = BANNER_SAFE;
  const { canvas, g } = await canvasFor(frame, w, h);
  if (name || line) {
    const cy = h / 2;
    const band = g.createLinearGradient(0, cy - sh * 0.7, 0, cy + sh * 0.7);
    band.addColorStop(0, 'rgba(0, 0, 0, 0)');
    band.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
    band.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = band;
    g.fillRect(0, cy - sh * 0.7, w, sh * 1.4);
    g.fillStyle = '#e4edf6';
    g.shadowColor = 'rgba(0, 0, 0, 0.7)';
    g.shadowBlur = 30;
    const centred = (text, px, spacing, y) => {
      while (px > 12 && measure(g, text, px, spacing) > sw * 0.92) px -= 2;
      spaced(g, text, (w - measure(g, text, px, spacing)) / 2, y, px, spacing);
    };
    if (name) centred(name.toUpperCase(), 132, 0.34, cy + (line ? 10 : 46));
    g.globalAlpha = 0.8;
    if (line) centred(line.toUpperCase(), 34, 0.22, cy + 86);
    g.globalAlpha = 1;
  }
  return jpegUnder(canvas, BANNER_MAX_BYTES);
}

// ─── The lesson ───────────────────────────────────────────────────────────────
// The description as a schools science programme of the late 1970s: a grave,
// patient narrator, headings in capitals, facts stated with
// total confidence (and not all of them true), questions to answer, and the
// answer at the bottom. Everything that can vary does, chosen by the song's
// seed: the facts (a few for every instrument, key, note and tempo), the
// opening and closing, some headings, the order of the key and the tempo, a
// section on the beats in a bar, and one or two extra sections (an experiment,
// a safety notice, a word of the day...). So a song always gets the same
// lesson, and two songs seldom get the same one.
// What's said of Orrery itself is true: rules, not an AI model; every sound
// synthesised as it plays, no samples, no musicians.

// Each instrument has a few facts, one per song.
const VOICE_FACTS = {
  pad: [
    'A pad is a soft sound. It is called a pad because it is soft, like a pad.',
    'Pads were first used to make loud music softer. They are still used for this today, mostly at night.',
    'If you listen very closely to the pad, you will hear the pad.',
  ],
  melody: [
    'A melody is a tune. This one has been made from a triangle, which is a shape.',
    'A melody is a row of notes, one behind the other, like ducklings.',
    'This melody has never been whistled. You may be the first. Please wait until the video has finished.',
  ],
  texture: [
    'Shimmer is the sound that light would make, if light made sounds. It does not.',
    'Shimmer is made by shaking a sound very gently until it glitters.',
    'Nobody knows where shimmer comes from. It is thought to be a kind of weather.',
  ],
  pluck: [
    'The guitar has six strings. Orrery has no strings at all, and has had to imagine them.',
    'This guitar is played with the fingers. Orrery does not have fingers, and has done very well.',
    'The fingerpicked guitar is picked one string at a time, so that no string feels left out.',
  ],
  bell: [
    'Handbells were first used to tell the time, one hand at a time.',
    'A bell rings when it is struck. It is not upset by this. It is a bell.',
    'These bells are very small, and can be kept in a drawer.',
  ],
  arpeggio: [
    'An arpeggiator plays the notes of a chord one after another, in case you missed any.',
    '"Arpeggio" is an Italian word. Say it out loud now. Well done. You have spoken Italian.',
    'An arpeggio goes up and then comes down again, like a lift with nowhere to be.',
  ],
  mallet: [
    'The marimba is made of wood. Wood comes from trees, which you may have seen outside.',
    'A mallet is a kind of hammer. Never hit a marimba with an ordinary hammer, or with another marimba.',
    'The marimba is a xylophone that has grown up and moved out.',
  ],
  drone: [
    'A drone is a note that does not stop. Scientists are still waiting for this one to finish.',
    'A drone is one note held for a long time. It is the most patient instrument there is.',
    'Some drones are flying machines. This is not one of those. Please stop looking at the ceiling.',
  ],
  flute: [
    'The flute is played by blowing across a hole. Do not try this with other holes.',
    'The flute is the only instrument made entirely of air, apart from the flute.',
    'A flute has many holes, and yet it does not leak. Nobody knows why.',
  ],
  choir: [
    'A choir is a group of people singing. These people are not real. They are made of filters.',
    'A choir sings "aah". Experts believe it may also be able to sing "ooh".',
    'This choir has never needed to breathe. Can you go as long without breathing? No. Please do not try.',
  ],
  strings: [
    'A string section is a great many violins. Nobody has ever managed to count them.',
    'Violins are made of wood and horsehair. The horse has been told.',
    'Strings sound sad because they are stretched very tightly. Try to imagine how that feels.',
  ],
  rhodes: [
    'The electric piano is a piano with electricity in it. Never take a piano into the bath.',
    'Inside an electric piano are small metal forks, called tines, for eating sound.',
    'An electric piano must be plugged in. An ordinary piano will work anywhere, even up a hill.',
  ],
  organ: [
    'The tonewheel organ is full of spinning wheels. Where they are going, nobody knows.',
    'The organ is the largest instrument. This one has been made smaller for television.',
    'Organs were once found only in churches. Now one has been found here.',
  ],
  glass: [
    'The glass harmonica is played by rubbing glasses. It was very popular until the glasses were needed for drinks.',
    'The glass harmonica was invented by a man with wet fingers.',
    'Glass is a liquid that has decided to stay where it is. So is the glass harmonica.',
  ],
  harp: [
    'The harp is played by angels, and also by Orrery, which is not an angel.',
    'A harp has more strings than any other instrument, except two harps.',
    'The harp is plucked, not strummed. Strumming a harp is considered extremely rude.',
  ],
  brass: [
    'Brass is both a metal and a sound. Today we will be listening to the sound.',
    'A trumpet is a brass pipe that has been folded up so that it fits in a car.',
    'Brass instruments must be polished every day, or they stop working. These ones are not real, so they will not.',
  ],
  vibraphone: [
    'The vibraphone vibrates. That is all it does, and it does it very well.',
    'The vibraphone has a small motor inside it, which makes it wobble. Ask before you touch it.',
    'Under each bar of the vibraphone is a tube. Inside each tube is nothing at all.',
  ],
  clavinet: [
    'The clavinet is the funkiest of the keyboards. Funk is measured in clavs.',
    'The clavinet is a keyboard with strings inside it. When the strings are cross, it is funky.',
    'Inside the clavinet, small rubber hammers hit the strings. The hammers are paid very little.',
  ],
  sitar: [
    'The sitar can have as many as twenty-one strings. Count them now.',
    'The sitar has a long neck, like a giraffe. Unlike a giraffe, it can be played.',
    'Some of the sitar\'s strings are never touched. They ring on their own, out of sympathy.',
  ],
  kalimba: [
    'The kalimba is played with the thumbs. Hold up your thumbs now. Good. Put them down.',
    'The kalimba is also called the thumb piano. It is not a piano, and it is not a thumb.',
    'The kalimba is small enough to fit in a pocket. Please check your pockets now.',
  ],
  supersaw: [
    'A supersaw is seven saws at once. Do not attempt this in the home.',
    'A supersaw is very bright. Do not look directly at it.',
    'Each of the seven saws is slightly out of tune. Together they are slightly more in tune. This is called teamwork.',
  ],
  juno: [
    'This is a polysynth. "Poly" means many. There are many of it.',
    'This kind of synthesizer was first made in the 1980s, which is a decade, like this one.',
    'Analogue means "made of wires". These wires have been imagined, to save on wire.',
  ],
  solina: [
    'A string machine is a machine that pretends to be strings. It is fooling nobody, but it is trying very hard.',
    'The string machine was invented for people who could not afford a great many violins.',
    'A string machine contains no string. You may check if you like. You will not find any.',
  ],
  synthbrass: [
    'Synth brass is brass made of electricity. It is lighter than ordinary brass, and easier to carry.',
    'Synth brass never needs polishing, and has never been in a marching band.',
    'Synth brass is used for important announcements, such as this one.',
  ],
  monolead: [
    'A mono synth can only play one note at a time. Please be quiet. It is concentrating.',
    'A lead synth leads. The other instruments follow it, at a safe distance.',
    'This is the loudest sound a single wire can make without help.',
  ],
  stab: [
    'A chord stab is a very short chord. Nobody is hurt.',
    'A stab lasts for less than a second. In that time, a great deal happens. Not to you.',
    'Chord stabs are kept short, so that they do not outstay their welcome.',
  ],
  vox: [
    'The vocal chop is a voice cut into small pieces. The voice felt nothing, as it was never real.',
    'Vocal chops are words with the words taken out.',
    'Somewhere, a voice is missing some of its pieces. They are here.',
  ],
  sawpluck: [
    'A saw pluck is a saw that has been plucked. Never pluck a real saw.',
    'A saw pluck begins loudly and then gives up. This is called "decay", like teeth.',
    'It is called a saw because its wave is shaped like the teeth of a saw. Do not cut anything with it.',
  ],
  guitar: [
    'The disco guitar is played very quickly, so that the dancers do not fall over.',
    'This guitar is played mostly with the wrist, which is what wrists are for.',
    'The disco guitar goes "chk". It has said nothing else since 1977.',
  ],
};
const BASS_FACTS = {
  log: [
    'The log drum is not made from a log. Or is it? It is not.',
    'Knock on a log now. That is not what it sounds like.',
    'The log drum comes from South Africa, where it is very popular, and very low.',
  ],
  '808': [
    'An 808 is a number. It is also a bass. Today it is a bass.',
    'The 808 was once a drum machine. It has since become a bass, through hard work.',
    'An 808 is felt in the chest. If you cannot feel it, you may need a bigger chest.',
  ],
  sub: [
    'The sub bass is so low that you cannot hear it. Listen to it now.',
    'Sub means "below". This bass is below everything, including the floor.',
    'Elephants can hear the sub bass. Is there an elephant with you now? Ask it.',
  ],
  acid: [
    'The acid bass contains no acid, and is perfectly safe to listen to.',
    'The acid bass squelches. Squelching is a recognised scientific term.',
    'This bass was first discovered in Chicago, where somebody had left it switched on.',
  ],
  walking: [
    'A walking bass walks. It has never once run.',
    'A walking bass plays one note for every step. It has walked several miles today.',
    'The walking bass never knows where it is going, and yet it always arrives.',
  ],
  reese: [
    'The reese bass is named after a man called Reese. He is fine.',
    'The reese bass is two basses arguing. Neither of them is winning.',
    'If you hear a growl, it is the reese bass. If you hear a second growl, check behind you.',
  ],
  rumble: [
    'The rumble bass rumbles. If your tummy also rumbles, that is a coincidence.',
    'Rumble is the sound of a very large thing, a very long way away.',
    'The rumble bass is too low to sing along with. Please do not try. Your neighbours have asked.',
  ],
};
const BASS_FACT = [
  'The bass is the lowest part of the music. It lives at the bottom, like a crab.',
  'The bass holds the music up from underneath, like a table holds up a cake.',
  'Bass notes are very long and slow, so they take a while to reach your ears. Be patient.',
  'Without the bass, the music would float away. Please keep the bass on.',
];
const DRUM_FACTS = [
  'Drums are hit with sticks. These drums have been hit with numbers.',
  'The drums keep time. Time is kept in a cupboard when it is not being used.',
  'A drum is a hollow object. So, in a sense, is a cupboard.',
  'The kick drum is the largest drum. It is kicked with the foot, which is what feet are for.',
  'A snare drum has wires underneath it, which make it rattle. Do not try to remove them.',
  'Hi-hats are two cymbals that have agreed to meet.',
  'Drums were first used to send messages. This message reads: "drums".',
  'The drummer in this video does not exist, and has never once been late.',
  'A drum machine never gets tired. It does sometimes get bored, but it does not say so.',
];

const KEY_FACTS = {
  minor: [
    'Minor keys sound sad. This is because they are smaller.',
    'Minor keys were first discovered in the rain.',
    'A minor key has a lowered third note. Nobody remembers who lowered it.',
  ],
  major: [
    'Major keys sound happy. This one is very happy indeed, so please be careful.',
    'Major keys are used for birthdays, weddings and other happy accidents.',
    'A major key is a minor key that has cheered up.',
  ],
  pentatonic: [
    'Pentatonic means five notes. The other notes have been put away for later.',
    'A pentatonic scale has no wrong notes in it. This makes it very safe for beginners.',
    'Five notes are enough for most purposes, including this one.',
  ],
  mode: [
    'This is a mode. Modes are like keys, only older. They were first kept in jars by the Ancient Greeks.',
    'A mode is a scale that starts somewhere unusual, like a bus that begins at the end of its route.',
    'Each mode is named after a part of Ancient Greece. These parts have since been tidied away.',
  ],
};
const NOTE_FACTS = [
  n => `${n} is a letter. It is also a note. This is what is known as a coincidence.`,
  n => `${n} was chosen because it was the nearest note to hand.`,
  n => `The note ${n} sits between two other notes, where it is quite safe.`,
  n => `The note ${n} has been used in many songs before this one, and has never once complained.`,
  n => `If you have a piano, find ${n} on it now. If you do not have a piano, imagine one, then find ${n}.`,
  n => `${n} wobbles hundreds of times every second. It is very tired.`,
];
const SHARP_FACTS = [
  'It is a sharp, so please handle it with care.',
  'A sharp is a note that has been raised slightly, so that it can see over the others.',
  'Sharps are written with a little ladder (♯), which the note climbs up.',
];

// The meter, if it is worth a word: always when the song isn't in 4/4 all through.
const METER_WORDS = { '3/4': 'three', '6/8': 'six', '5/4': 'five', '7/8': 'seven' };
const TIME_FACTS = {
  '4/4': [
    'This music has four beats in every bar, which is the usual number. Count them now: one, two, three, four. Well done.',
    'Music is cut into bars, like chocolate. Each bar of this one has four beats in it.',
  ],
  '3/4': [
    'This music has three beats in a bar instead of the usual four. The fourth beat has been lost, and has not been found.',
    'Three beats in a bar is called a waltz. People danced the waltz for hundreds of years, until they got tired.',
    'One, two, three. One, two, three. That is all there is. Please do not ask for a fourth.',
  ],
  '6/8': [
    'This music is in six-eight, which means six of something and eight of something else.',
    'Six-eight sways from side to side, like a boat. If you feel unwell, look at the horizon.',
    'There are six beats in each bar, but you will only feel two of them. The others are being kept in reserve.',
  ],
  '5/4': [
    'This music has five beats in a bar. That is one more than is normal, and one fewer than is sensible.',
    'Five beats in a bar is very difficult to dance to. If you are dancing now, please stop and sit down.',
    'Count to five, then start again. Keep going until the music stops. Good.',
  ],
  '7/8': [
    'This music has seven beats in a bar, which is an odd number. It is also an odd thing to do.',
    'Seven-eight is counted one-two, one-two, one-two-three. Practise this now, quietly.',
    'Seven is thought to be a lucky number. Even so, it is very difficult to dance to.',
  ],
  short: [
    'Just before each chorus, the music loses two beats. Nobody knows where they go. Keep watching, and you may see.',
    'Listen for the bar that is too short. It comes just before the chorus, and it is in a hurry.',
  ],
  long: [
    'Just before each chorus, there is a bar with six beats in it. It is longer than the others, and it knows it.',
    'Listen for the long bar before the chorus, where the music stops to hold its breath.',
  ],
  bridge: [
    m => `In the middle of the song, the music changes to ${METER_WORDS[m]} beats in a bar, then changes back. Try not to be alarmed.`,
    m => `The bridge is in ${m}. A bridge is how music gets from one side to the other without getting wet.`,
  ],
};

const SPEED_FACTS = [
  [80, [
    'This is about as fast as a cow walking to the shops.',
    'This is the speed at which a snail would run, if it were in a hurry.',
    'At this speed, you could comfortably eat a sandwich in time to the music.',
  ]],
  [105, [
    'This is the speed of a gentleman strolling in a park.',
    'This is a comfortable speed for doing the washing up.',
    'This is the speed of a bicycle being pushed up a hill.',
  ]],
  [120, [
    'This is faster than a man walking, but slower than a horse.',
    'This is roughly the speed of a heart that has just seen a dog.',
    'At this speed, you could tap your foot without upsetting anyone.',
  ]],
  [135, [
    'This is too fast for walking. If you are walking, please begin to jog now.',
    'This is the speed of a person who has just remembered the oven.',
    'Most dancing happens at about this speed. Most dancing should not.',
  ]],
  [Infinity, [
    'This is faster than the human heart. Please sit down.',
    'Scientists recommend holding on to something.',
    'At this speed, a sentence can end before it',
  ]],
];

const INTROS = [
  k => `Look carefully at your screen. What you are seeing is a ${k}. It was written by a computer program called Orrery, which also drew the pictures.`,
  k => `Good morning. Today we will be looking at a ${k}. It was written by a computer program called Orrery, which also drew the pictures.`,
  k => `Welcome to today's lesson. The ${k} you are about to hear was written by a computer program called Orrery. Orrery also drew the pictures, without being asked.`,
  k => `Please put down your pencils. The following ${k} was written by a computer program called Orrery, which has also provided the pictures.`,
  k => `Hello. This is a ${k}. A computer program called Orrery wrote it, and drew the pictures you can see moving about.`,
];
const OPENINGS = [
  'Orrery cannot hear, and yet it has written music. Think about that for a moment.',
  'Nobody played this music. It was made of numbers, arranged in a pleasing order.',
  'No musicians were harmed in the making of this music, because none were used.',
  'What you are about to hear has never been heard before, except by the computer, which heard it first.',
  'Please sit up straight. The music is about to begin, and it can tell.',
  'Every note you are about to hear was chosen by a rule. There are a great many rules. You need not learn them.',
  'Make sure that you are sitting comfortably. If you are not, move to a different chair and begin the video again.',
  'This music was not recorded. It was worked out, like a sum, and then played.',
  'Somewhere inside your computer, very small switches are turning on and off to make this music. Thank them quietly.',
];
// What's said of Orrery itself: true, in every version.
const TRUTHS = [
  'Orrery is not an artificial intelligence. It is a list of very strict rules, like a school. Every sound you hear was made out of electricity, at the very moment it was played.',
  'Orrery is not an artificial intelligence. It does not think. It follows its rules, one after another, very quickly. None of the sounds were recorded: each one was made from electricity at the moment you hear it.',
  'It is important to understand that Orrery is not an artificial intelligence. It is a set of rules, written down. There are no recordings of instruments inside it, and no musicians. Every sound is made fresh as it plays, like toast.',
  'Orrery is not clever, and it is not an artificial intelligence. It simply does what its rules tell it to. No real instruments were recorded for this music. Every sound was built out of electricity, just as it was needed.',
];
const INSTRUMENT_INTROS = [
  () => 'Orrery has played the following instruments for you. It has not thanked them.',
  () => 'The following instruments can be heard. Listen for each one, and tick it off.',
  () => 'These are the instruments. None of them were harmed, as none of them exist.',
  k => `Here is a list of the instruments in this ${k}. You may copy it into your exercise book.`,
  () => 'Orrery has played all of these instruments at once, which is something even a very large family cannot do.',
];
const QUESTIONS = [
  v => `Draw the ${v}. Do not show it to anyone.`,
  () => 'Where does the music go when it stops? Discuss with your partner.',
  () => 'Is the orrery in this video moving, or is it you?',
  () => 'Hum this tune to a grown-up. Did they recognise it? Why not?',
  v => `Which is heavier: the ${v}, or a kilogram of feathers?`,
  () => 'Can a computer be sad? Write your answer on a piece of paper, then fold it up very small.',
  v => `What colour is the ${v}? Explain your answer.`,
  () => 'Close your eyes during the next chorus. Did it still happen?',
  v => `If the ${v} were an animal, which animal would it be? Why is it not?`,
  () => 'Count the stars in the video. Now count them again. Did you get the same number? Why not?',
  () => 'Is this music happy, sad, or a vegetable? Choose one.',
  v => `Write a short letter to the ${v}. Do not post it.`,
  () => 'What would this music sound like underwater? Do not find out.',
  () => 'Name three things that are louder than this music, and one thing that is not.',
  v => `How long could you listen to the ${v} before you needed a sandwich?`,
  () => 'The planet in the middle is going round. What is it going round? Use a ruler.',
];
const FIRST_QUESTIONS = [
  (k, d) => `This ${k} lasts ${d}. How many beats is that? (The answer is at the bottom. Do not look yet.)`,
  (k, d) => `This ${k} lasts ${d}. If you clapped once on every beat, how many times would you clap? (The answer is at the bottom. Please clap quietly.)`,
  (k, d) => `This ${k} is ${d} long. How many beats are there in it? (Turn to the bottom for the answer, but not yet.)`,
];
const ANSWERS = [
  n => `Answer to question 1: about ${n} beats. If you got it wrong, watch the video again and count more carefully.`,
  n => `Answer to question 1: about ${n} beats. Give yourself a gold star. If you do not have a gold star, draw one.`,
  n => `Answer to question 1: roughly ${n} beats. If your answer was different, your clock may be running fast.`,
  n => `Answer to question 1: about ${n}. If you counted more than this, you may have counted some twice.`,
];
const CLOSINGS = [
  'Orrery is kept at orrery.vectorclash.com, where it is fed regularly.',
  'Orrery lives at orrery.vectorclash.com. It does not get out much.',
  'Orrery can be visited at orrery.vectorclash.com during normal opening hours, which are all of them.',
  'Orrery is at orrery.vectorclash.com. Please do not tap on the glass.',
  'This has been a lesson about music. Orrery itself lives at orrery.vectorclash.com, where it is quite happy.',
];
// The extra sections a lesson may have, one or two of them.
const EXTRAS = {
  'AN EXPERIMENT': [
    'Turn the sound off. Is the music still playing? Now turn it back on. It is. Science has once again been proved right.',
    'Place a glass of water near your speaker and watch it during the loud parts. Then drink the water, which is now musical.',
    'Ask a grown-up to hum the bass while you hum the tune. Now swap. Write down which was harder.',
    'Play this video in two rooms at once and stand in the doorway. You are now in stereo.',
  ],
  'SAFETY': [
    'Do not listen to this music while operating a crane.',
    'This music is perfectly safe at a sensible volume. A sensible volume is the one your parents choose.',
    'If this music becomes stuck in your head, do not try to remove it yourself. It will leave on its own, usually by Thursday.',
    'Keep this music away from naked flames, and from clothed ones.',
  ],
  'WORD OF THE DAY': [
    'TEMPO: the speed of music. From the Italian for "time", and from the English for "tempo".',
    'TIMBRE: what makes a flute sound like a flute and not like a horse. It is pronounced "tamber", for some reason.',
    'SYNTHESISER: a machine that makes sounds out of nothing. You may have one at home without knowing.',
    'OSCILLATOR: a thing that goes backwards and forwards very fast, like a pendulum in a hurry. Many of the sounds in this video began as one.',
    'CHORD: three or more notes played at the same time, so that none of them has to be alone.',
  ],
  'NOTES FOR TEACHERS': [
    'This lesson is suitable for children aged six and over, and for adults who are prepared to sit still.',
    'Pupils may become excited during the chorus. This is normal, and will pass.',
    'There is no need to mark the drawings. They are all correct.',
  ],
  'A BRIEF HISTORY': [
    'Music was invented in the Stone Age, when a man dropped one stone onto another and then did it again on purpose.',
    'Before electricity, all music had to be played by hand. It took a very long time.',
    'The first computers to play music filled entire rooms. This one fits inside a web browser, which is smaller.',
  ],
};

// A song's own random numbers: the same song, the same picks.
function rng(seed) {
  // Mixed first (murmur3's finaliser): songs' seeds can sit close together,
  // and close seeds would start on close numbers, and the same jokes.
  let a = seed >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  a ^= a >>> 16;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(p) {
  if (p.song) return p.song.seed;
  let h = 2166136261;
  for (const c of JSON.stringify(p)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h;
}

// ── The title ──
// What the song is, in words: its character, its genre, the two instruments
// you'd notice first, then its key and tempo -- "Bright Amapiano with Log Drum
// and Marimba (B minor, 110 BPM) · Orrery". Nothing invented: every word is
// read off the song.
//
// The character is what sets this song apart from others of its genre: each
// genre's songs are rolled near its preset (genres.js), so a word for being
// brighter, sparser, faster or roomier than that, or in a key the genre doesn't
// usually choose, says something about this one. Only when nothing stands out
// does the key's mood stand alone. (It once always did, and with Dorian the
// first choice of eight genres, every other title began "Smoky".) Each word has
// a few near-synonyms, one per song, so songs alike in the same way still read
// differently.
const KEY_MOOD = {
  aeolian: ['Moody', 'Brooding', 'Wistful'], dorian: ['Smoky', 'Soulful', 'Cool'],
  phrygian: ['Dark', 'Ominous', 'Shadowy'], minor_pent: ['Earthy', 'Bluesy', 'Moody'],
  major_pent: ['Warm', 'Sunlit', 'Open'], lydian: ['Dreamy', 'Floating', 'Starry'],
  mixolydian: ['Sunny', 'Breezy', 'Easygoing'], major: ['Bright', 'Hopeful', 'Joyful'],
};
// [how far the song is from its genre, in units of how far a roll can move it
// (main.js genreFeel), words for more, words for less].
const LEANS = [
  [(s, g) => (s.brightness - g.brightness) / 0.12, ['Bright', 'Gleaming', 'Glowing'], ['Mellow', 'Dusky', 'Muted']],
  [(s, g) => (s.density - g.density) / 0.1, ['Busy', 'Restless', 'Teeming'], ['Sparse', 'Bare', 'Minimal']],
  [(s, g) => (s.spaciousness - g.spaciousness) / 0.1, ['Spacious', 'Wide', 'Airy'], ['Dry', 'Close', 'Intimate']],
  [(s, g) => g.bpm[1] > g.bpm[0] ? (s.tempo - (g.bpm[0] + g.bpm[1]) / 2) / ((g.bpm[1] - g.bpm[0]) / 2) : 0,
    ['Fast', 'Urgent', 'Quick'], ['Unhurried', 'Laid-back', 'Easy']],
];
const STANDS_OUT = 0.5, ALSO = 0.8;
function genreOf(p) {
  const name = p.genre ?? p.state.language;
  return GENRES.find(g => g.name === name) ?? genreOfKit(p);
}
function character(p, genre) {
  const s = p.state, g = genreOf(p), pick = rng(seedOf(p) ^ 0x7e1e);
  const one = words => words[Math.floor(pick() * words.length)];
  const scale = SCALE_NAMES[s.scaleIdx];
  const leans = g ? LEANS.map(([by, more, less]) => {
    const d = by(s, g);
    return { d: Math.abs(d), words: d > 0 ? more : less };
  }) : [];
  // A key the genre seldom picks is as telling as a slider.
  if (g && scale !== SCALE_NAMES[g.scales[0]] && KEY_MOOD[scale]) leans.push({ d: 0.7, words: KEY_MOOD[scale] });
  const said = leans.filter(l => l.d >= STANDS_OUT).sort((x, y) => y.d - x.d).slice(0, 2)
    .filter((l, i) => i === 0 || l.d >= ALSO);
  const words = (said.length ? said.map(l => one(l.words)) : [one(KEY_MOOD[scale] ?? ['Strange'])])
    .filter(w => !genre.toLowerCase().includes(w.toLowerCase()));
  return [...new Set(words)].join(', ');
}
// The instruments you'd notice first, most first; a bass counts when it's a
// sound of its own (the log drum, the 808), not just the low end.
const FEATURED = ['guitar', 'sitar', 'kalimba', 'harp', 'flute', 'choir', 'vox', 'mallet', 'vibraphone',
  'clavinet', 'rhodes', 'organ', 'brass', 'synthbrass', 'strings', 'supersaw', 'monolead', 'sawpluck', 'stab',
  'bell', 'pluck', 'arpeggio', 'juno', 'solina', 'glass', 'pad', 'melody', 'texture', 'drone'];
const TITLE_NAMES = {
  guitar: 'Disco Guitar', mallet: 'Marimba', rhodes: 'Electric Piano', vox: 'Vocal Chops', synthbrass: 'Synth Brass',
  monolead: 'Synth Lead', sawpluck: 'Saw Plucks', stab: 'Chord Stabs', bell: 'Handbells', pluck: 'Fingerpicked Guitar',
  arpeggio: 'Arpeggios', juno: 'Analogue Pads', solina: 'String Machine', glass: 'Glass Harmonica', pad: 'Pads',
  melody: 'Soft Lead', texture: 'Shimmer', supersaw: 'Supersaws', drone: 'Drone',
};
const FEATURED_BASS = { log: 'Log Drum', '808': '808s', acid: 'Acid Bass', reese: 'Reese Bass', walking: 'Walking Bass', disco: 'Disco Bass' };
// A genre as a title has it: UK Garage, Drum and Bass.
const titleCase = g => g.split(' ').map(w => (w === 'uk' ? 'UK' : w === 'and' ? 'and' : cap(w))).join(' ');

// "Moody Amapiano with Log Drum and Marimba", for the title and the description's heading.
function songLine(p, genre, most = 2) {
  const mood = character(p, genre);
  const parts = [
    ...(FEATURED_BASS[p.bassStyle] ? [FEATURED_BASS[p.bassStyle]] : []),
    ...FEATURED.filter(v => p.voices.includes(v)).map(v => TITLE_NAMES[v] ?? cap(v)),
  ].slice(0, most);
  return `${mood} ${titleCase(genre)}${parts.length ? ` with ${parts.join(' and ')}` : ''}`.trim();
}

const scaleKind = scale => scale.includes('pentatonic') ? 'pentatonic' : scale === 'minor' ? 'minor' : scale === 'major' ? 'major' : 'mode';
const roman = n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const spoken = s => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m ? `${plural(m, 'minute')}${sec ? ` and ${plural(sec, 'second')}` : ''}` : plural(sec, 'second');
};

function lesson({ p, keyName, heading, drums, kind, duration, marks, rhythm }) {
  const r = rng(seedOf(p));
  const pick = list => list[Math.floor(r() * list.length)];
  // `n` different ones of `list`, in the order drawn.
  const several = (list, n) => {
    const left = [...list], out = [];
    while (out.length < n && left.length) out.push(left.splice(Math.floor(r() * left.length), 1)[0]);
    return out;
  };

  const [root, ...scaleWords] = keyName.split(' ');
  const scale = scaleWords.join(' ').toLowerCase();
  const keyFact = pick(KEY_FACTS[scaleKind(scale)]);
  const noteFact = root.includes('♯') ? pick(SHARP_FACTS) : pick(NOTE_FACTS)(root);
  const speedFact = pick(SPEED_FACTS.find(([under]) => p.state.tempo < under)[1]);

  const instruments = [];
  if (drums) instruments.push(`• ${cap(drums[0])} drums. ${pick(DRUM_FACTS)}`);
  if (p.bassStyle) instruments.push(`• ${cap(BASS_NAMES[p.bassStyle] ?? `${p.bassStyle} bass`)}. ${pick(BASS_FACTS[p.bassStyle] ?? BASS_FACT)}`);
  const voices = p.voices.filter(v => v !== 'drums');
  for (const v of voices) instruments.push(`• ${cap(VOICE_NAMES[v] ?? v)}. ${VOICE_FACTS[v] ? pick(VOICE_FACTS[v]) : 'Very little is known about this instrument.'}`);

  const beats = Math.round(p.state.tempo * duration / 60);
  // A loop has no chorus to speak of.
  const fits = text => kind === 'song' || !/chorus/i.test(typeof text === 'function' ? text('x', 'x') : text);
  const [q2, q3] = several(QUESTIONS.filter(fits), 2);
  const thing = VOICE_NAMES[voices.length ? pick(voices) : ''] ?? 'bass';

  // The beats in a bar: always for a song in another meter or one that changes,
  // now and then for one in plain 4/4.
  const meter = rhythm?.meter ?? '4/4', change = rhythm?.change;
  const time = change ? (change.kind === 'bridge' ? pick(TIME_FACTS.bridge)(change.meter) : pick(TIME_FACTS[change.kind]))
    : meter !== '4/4' ? pick(TIME_FACTS[meter])
    : r() < 0.3 ? pick(TIME_FACTS['4/4']) : null;

  const keyPart = [pick(['THE KEY', 'THE KEY', 'WHICH KEY IT IS IN']), `This ${kind} is in ${keyName}. ${keyFact} ${noteFact}`];
  const speedPart = [pick(['THE SPEED', 'THE TEMPO', 'HOW FAST IT GOES']), `It goes at ${p.state.tempo} beats per minute. ${speedFact}`];
  const timePart = time ? [pick(['THE TIME', 'BEATS IN A BAR']), time] : null;
  const facts = r() < 0.5 ? [keyPart, speedPart] : [speedPart, keyPart];
  if (timePart) facts.push(timePart);
  // One extra section most of the time, now and then two.
  const extraCount = r() < 0.15 ? 0 : r() < 0.3 ? 2 : 1;
  const extras = several(Object.keys(EXTRAS), extraCount).map(name => [name, pick(EXTRAS[name].filter(fits))]);
  const section = ([name, text]) => ['', name, text];

  const lines = [
    heading,
    '',
    `${pick(INTROS)(kind)} ${pick(OPENINGS)}`,
    '',
    pick(TRUTHS),
    ...facts.flatMap(section),
    '',
    pick(['THE INSTRUMENTS', 'THE INSTRUMENTS', 'WHAT YOU WILL HEAR']),
    pick(INSTRUMENT_INTROS)(kind),
    ...instruments,
    ...(marks.length ? ['', pick(['THE PARTS', 'THE PARTS', 'THE PARTS OF THE SONG']), ...marks.map(c => `${c.at} ${c.name}`)] : []),
    ...extras.flatMap(section),
    '',
    pick(['QUESTIONS', 'QUESTIONS', 'TEST YOURSELF']),
    `1. ${pick(FIRST_QUESTIONS)(kind, spoken(duration))}`,
    `2. ${q2(thing)}`,
    `3. ${q3(thing)}`,
    '',
    pick(CLOSINGS),
    '',
    pick(ANSWERS)(beats),
  ];
  return { description: lines.join('\n').slice(0, LIMITS.description) };
}
