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
export function youtubeText({ p, key, name, style, sections, duration }) {
  const drums = p.drumStyle && p.voices.includes('drums') ? DRUMS[p.drumStyle] ?? [p.drumStyle.replace(/_/g, ' '), null] : null;
  const bass = p.bassStyle ? BASS_NAMES[p.bassStyle] ?? `${p.bassStyle} bass` : null;
  const voices = p.voices.filter(v => v !== 'drums').map(v => VOICE_NAMES[v] ?? v);
  const genres = unique([drums?.[1], ...(STYLE_GENRES[style] ?? [])]);
  const genre = genres[0] ?? 'electronic';
  const keyName = key.replace(/\s+(\S.*)$/, (_, scale) => ` ${scale.toLowerCase().replace(/^(dorian|phrygian|lydian|mixolydian)/, cap)}`);
  const kind = p.song ? 'song' : 'loop';

  const marks = chapters(p.song ? sections : [], duration);
  const { title, description } = lesson({ p, keyName, name: name?.trim(), genre, drums, kind, duration, marks });

  const keyTag = keyName.toLowerCase().replace('♯', ' sharp');
  const candidates = unique([
    'orrery', name?.trim().toLowerCase(), ...genres, ...genres.map(g => `${g} music`),
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
// patient narrator, a module number, headings in capitals, facts stated with
// total confidence (and not all of them true), questions to answer, and the
// answer at the bottom. The jokes are chosen by the song's seed, so a song
// always gets the same lesson, and two songs seldom get the same one.
// What's said of Orrery itself is true: rules, not an AI model; every sound
// synthesised as it plays, no samples, no musicians.

const VOICE_FACTS = {
  pad: 'A pad is a soft sound. It is called a pad because it is soft, like a pad.',
  melody: 'A melody is a tune. This one has been made from a triangle, which is a shape.',
  texture: 'Shimmer is the sound that light would make, if light made sounds. It does not.',
  pluck: 'The guitar has six strings. Orrery has no strings at all, and has had to imagine them.',
  bell: 'Handbells were first used to tell the time, one hand at a time.',
  arpeggio: 'An arpeggiator plays the notes of a chord one after another, in case you missed any.',
  mallet: 'The marimba is made of wood. Wood comes from trees, which you may have seen outside.',
  drone: 'A drone is a note that does not stop. Scientists are still waiting for this one to finish.',
  flute: 'The flute is played by blowing across a hole. Do not try this with other holes.',
  choir: 'A choir is a group of people singing. These people are not real. They are made of filters.',
  strings: 'A string section is a great many violins. Nobody has ever managed to count them.',
  rhodes: 'The electric piano is a piano with electricity in it. Never take a piano into the bath.',
  organ: 'The tonewheel organ is full of spinning wheels. Where they are going, nobody knows.',
  glass: 'The glass harmonica is played by rubbing glasses. It was very popular until the glasses were needed for drinks.',
  harp: 'The harp is played by angels, and also by Orrery, which is not an angel.',
  brass: 'Brass is both a metal and a sound. Today we will be listening to the sound.',
  vibraphone: 'The vibraphone vibrates. That is all it does, and it does it very well.',
  clavinet: 'The clavinet is the funkiest of the keyboards. Funk is measured in clavs.',
  sitar: 'The sitar can have as many as twenty-one strings. Count them now.',
  kalimba: 'The kalimba is played with the thumbs. Hold up your thumbs now. Good. Put them down.',
  supersaw: 'A supersaw is seven saws at once. Do not attempt this in the home.',
  juno: 'This is a polysynth. "Poly" means many. There are many of it.',
  solina: 'A string machine is a machine that pretends to be strings. It is fooling nobody, but it is trying very hard.',
  synthbrass: 'Synth brass is brass made of electricity. It is lighter than ordinary brass, and easier to carry.',
  monolead: 'A mono synth can only play one note at a time. Please be quiet. It is concentrating.',
  stab: 'A chord stab is a very short chord. Nobody is hurt.',
  vox: 'The vocal chop is a voice cut into small pieces. The voice felt nothing, as it was never real.',
  sawpluck: 'A saw pluck is a saw that has been plucked. Never pluck a real saw.',
  guitar: 'The disco guitar is played very quickly, so that the dancers do not fall over.',
};
const BASS_FACTS = {
  log: 'The log drum is not made from a log. Or is it? It is not.',
  '808': 'An 808 is a number. It is also a bass. Today it is a bass.',
  sub: 'The sub bass is so low that you cannot hear it. Listen to it now.',
  acid: 'The acid bass contains no acid, and is perfectly safe to listen to.',
  walking: 'A walking bass walks. It has never once run.',
  reese: 'The reese bass is named after a man called Reese. He is fine.',
  rumble: 'The rumble bass rumbles. If your tummy also rumbles, that is a coincidence.',
};
const BASS_FACT = 'The bass is the lowest part of the music. It lives at the bottom, like a crab.';
const DRUM_FACTS = [
  'Drums are hit with sticks. These drums have been hit with numbers.',
  'The drums keep time. Time is kept in a cupboard when it is not being used.',
  'A drum is a hollow object. So, in a sense, is a cupboard.',
];

const KEY_FACTS = {
  minor: 'Minor keys sound sad. This is because they are smaller.',
  major: 'Major keys sound happy. This one is very happy indeed, so please be careful.',
  pentatonic: 'Pentatonic means five notes. The other notes have been put away for later.',
  mode: 'This is a mode. Modes are like keys, only older. They were first kept in jars by the Ancient Greeks.',
};
const NOTE_FACTS = [
  n => `${n} is a letter. It is also a note. This is what is known as a coincidence.`,
  n => `${n} was chosen because it was the nearest note to hand.`,
  n => `The note ${n} sits between two other notes, where it is quite safe.`,
];
const SHARP_FACT = 'It is a sharp, so please handle it with care.';

const OPENINGS = [
  'Orrery cannot hear, and yet it has written music. Think about that for a moment.',
  'Nobody played this music. It was made of numbers, arranged in a pleasing order.',
  'No musicians were harmed in the making of this music, because none were used.',
  'What you are about to hear has never been heard before, except by the computer, which heard it first.',
];
const QUESTIONS = [
  v => `Draw the ${v}. Do not show it to anyone.`,
  () => 'Where does the music go when it stops? Discuss with your partner.',
  () => 'Is the orrery in this video moving, or is it you?',
  () => 'Hum this tune to a grown-up. Did they recognise it? Why not?',
  v => `Which is heavier: the ${v}, or a kilogram of feathers?`,
  () => 'Can a computer be sad? Write your answer on a piece of paper, then fold it up very small.',
];

function speedFact(bpm) {
  if (bpm < 80) return 'This is about as fast as a cow walking to the shops.';
  if (bpm < 105) return 'This is the speed of a gentleman strolling in a park.';
  if (bpm < 120) return 'This is faster than a man walking, but slower than a horse.';
  if (bpm < 135) return 'This is too fast for walking. If you are walking, please begin to jog now.';
  return 'This is faster than the human heart. Please sit down.';
}

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const spoken = s => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m ? `${plural(m, 'minute')}${sec ? ` and ${plural(sec, 'second')}` : ''}` : plural(sec, 'second');
};

function lesson({ p, keyName, name, genre, drums, kind, duration, marks }) {
  const r = rng(seedOf(p));
  const pick = list => list[Math.floor(r() * list.length)];
  const module = 1 + Math.floor(r() * 99);
  const subject = name || genre.split(' ').map(cap).join(' ');
  const title = `Orrery · Module ${module}: ${subject}`.slice(0, LIMITS.title);

  const [root, ...scaleWords] = keyName.split(' ');
  const scale = scaleWords.join(' ').toLowerCase();
  const keyFact = scale.includes('pentatonic') ? KEY_FACTS.pentatonic
    : scale === 'minor' ? KEY_FACTS.minor : scale === 'major' ? KEY_FACTS.major : KEY_FACTS.mode;
  const noteFact = root.includes('♯') ? SHARP_FACT : pick(NOTE_FACTS)(root);

  const instruments = [];
  if (drums) instruments.push(`• ${cap(drums[0])} drums. ${pick(DRUM_FACTS)}`);
  if (p.bassStyle) instruments.push(`• ${cap(BASS_NAMES[p.bassStyle] ?? `${p.bassStyle} bass`)}. ${BASS_FACTS[p.bassStyle] ?? BASS_FACT}`);
  const voices = p.voices.filter(v => v !== 'drums');
  for (const v of voices) instruments.push(`• ${cap(VOICE_NAMES[v] ?? v)}. ${VOICE_FACTS[v] ?? 'Very little is known about this instrument.'}`);

  const beats = Math.round(p.state.tempo * duration / 60);
  const i = Math.floor(r() * QUESTIONS.length), j = (i + 1 + Math.floor(r() * (QUESTIONS.length - 1))) % QUESTIONS.length;
  const [q2, q3] = [QUESTIONS[i], QUESTIONS[j]];
  const thing = VOICE_NAMES[voices.length ? pick(voices) : ''] ?? 'bass';

  const lines = [
    `ORRERY · MODULE ${module}: ${subject.toUpperCase()}`,
    '',
    `Look carefully at your screen. What you are seeing is a ${kind}. It was written by a computer program called Orrery, which also drew the pictures. ${pick(OPENINGS)}`,
    '',
    'Orrery is not an artificial intelligence. It is a list of very strict rules, like a school. Every sound you hear was made out of electricity, at the very moment it was played.',
    '',
    'THE KEY',
    `This ${kind} is in ${keyName}. ${keyFact} ${noteFact}`,
    '',
    'THE SPEED',
    `It goes at ${p.state.tempo} beats per minute. ${speedFact(p.state.tempo)}`,
    '',
    'THE INSTRUMENTS',
    `Orrery has played the following instruments for you. It has not thanked them.`,
    ...instruments,
    ...(marks.length ? ['', 'THE PARTS', ...marks.map(c => `${c.at} ${c.name}`)] : []),
    '',
    'QUESTIONS',
    `1. This ${kind} lasts ${spoken(duration)}. How many beats is that? (The answer is at the bottom. Do not look yet.)`,
    `2. ${q2(thing)}`,
    `3. ${q3(thing)}`,
    '',
    'Orrery is kept at orrery.vectorclash.com, where it is fed regularly.',
    '',
    `Answer to question 1: about ${beats} beats. If you got it wrong, watch the video again and count more carefully.`,
  ];
  return { title, description: lines.join('\n').slice(0, LIMITS.description) };
}
