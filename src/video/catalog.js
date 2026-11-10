// ─── What a music video can do ────────────────────────────────────────────────
// The names the studio page shows (studio.js), kept apart from the code that
// draws them (fx.js, director.js), which makes a WebGL scene as it loads.

// Each effect, and what it does (see fx.js).
export const EFFECTS = [
  ['trails',     'TRAILS',     'Light painting: the picture leaves fading trails that flow outward with the bass.'],
  ['spectrum',   'SPECTRUM',   'The trails turn through the colours as they fade, leaving rainbows (brings trails of its own if there are none).'],
  ['lens',       'LENS',       'Gravitational lensing: starlight bent round the planet into arcs, stronger with the bass.'],
  ['shock',      'SHOCKWAVE',  'Each kick sends a ring of refraction out from the planet.'],
  ['defocus',    'FILTER BLUR','The picture softens while a build\'s filter is shut (easing in over its first beat), and opens up into the drop.'],
  ['glints',     'GLINTS',     'Six-pointed stars on the brightest points, a mirrorball\'s, sparkling with the hats.'],
  ['streaks',    'STREAKS',    'Anamorphic lens flares: long blue streaks across bright points, with the lead.'],
  ['aberration', 'ABERRATION', 'Colour fringes toward the edges, kicked wider by the kick and snare.'],
  ['glitch',     'GLITCH',     'Bands torn sideways and colours slipping apart, on the snare; some come back recoloured (more in GLITCH and PRISM).'],
  ['crt',        'CRT',        'A curved tube: scanlines and an aperture grille.'],
  ['vhs',        'VHS',        'Tape: colour smeared sideways, wobbling lines, a tracking band, noise.'],
  ['film',       'FILM',       'Grain, red halation round highlights, gate weave, lifted blacks, a vignette.'],
  ['grade',      'GRADE',      'The style\'s colour treatment (or the GRADE chosen above).'],
  ['letterbox',  'LETTERBOX',  'Widescreen bars, 2.39:1.'],
  ['flash',      'FLASH',      'A flash of the chord\'s colour as a drop or last chorus lands (never more than two a second).'],
  ['slowmo',     'SLOW MOTION','Through the silence before a drop the world slows almost to a stop (the camera glides on), then the drop snaps it back.'],
];

export const STYLE_ABOUT = {
  DRIFT:  'Zen, ambient, dream: no cuts, slow glides, long light trails, no flashes.',
  CLUB:   'House, techno, trance: cuts on the bar, shockwaves on the kick, builds blur and push in to the drop.',
  DISCO:  'Nu-disco, funk, afro house: mirrorball glints on the hats, tiles on the chorus, warm.',
  RETRO:  'Synthwave: a neon CRT, anamorphic streaks, mirrors and tunnels.',
  FILM:   'Lo-fi, jazz, blues, folk: grain, warmth and worn tape, long takes.',
  CINEMA: 'Orchestral, epic, dark: widescreen, slow dolly moves, lens flares.',
  GLITCH: 'Trap, future bass: glitches on the snare that recolour as they tear, the lens on the 808, fast cuts.',
  PRISM:  'Colour above all: kaleidoscopes and tiles, rainbow trails, every colour turned round the wheel with the chords. Chosen, never AUTO.',
};
