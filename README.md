# Orrery

A self-contained, browser-based generative music system. Built entirely with the Web Audio API and Three.js — no server, no runtime dependencies beyond a CDN script tag.

The name: an orrery is a clockwork model of the heavens. This one is driven by the music — the harmony it composes sets the halo, sphere and chord constellation in motion.

Live at [vectorclash.com/orrery](https://vectorclash.com/orrery/).

Run `npm install && npm run dev` and open `http://localhost:8000/` (ES modules need to be served over HTTP, not opened via `file://`).

---

## Modes

### Infinite Mode

Click **PLAY** to start. The button toggles to **PAUSE**, which holds the music where it is — the same song, the same bar — until PLAY carries on (it suspends the audio context, so every note already scheduled simply waits). If the browser stops the sound itself (a phone call, another app taking the output), playback pauses the same way. The switch under it chooses what plays (it's remembered between visits):

- **ERAS** — the system runs indefinitely, slowly evolving through eras of music. The composition auto-generates, shifts key and scale every 38 seconds, and continuously drifts in texture and density. A live status bar shows root note, scale, tempo, era number, and era progress. **NEXT** moves on to a new era at the next bar line.
- **SONGS** — one composed song after another, like a playlist. Each takes a genre (weighted as RANDOMIZE ALL weights them, never the same twice running), varies its feel and rolls its kit, then composes a song from it: an intro, sections that build and fall back — verses and choruses, or builds, drops and breakdowns — and an outro ending on the tonic (see [Songs](#songs-srcaudiosongjs)). When the last chord has rung out, the next song starts. The status bar shows the genre, key, tempo and room, the section and the time through the song, and who is playing in it. **NEXT** skips to the next song straight away, with a quick fade (paused, it plays the next song). There's no STOP: it would only be a pause that throws the song away, which NEXT already does. **EXPORT SONG** saves the whole song as a WAV — all of it, from its first bar, wherever playback has got to. Switching to EDIT while a song plays brings the song across: its genre, its feel, its instruments and its seed, with FORM set to SONG, so it can be played again, changed or exported.

### Manual Mode

Full control over every parameter. The panel is divided into three collapsible sections — **GENRE**, **FEEL**, and **INSTRUMENTS** — to reduce visual clutter.

**Genres** are styles: each sets a feel (scale, tempo, density, brightness, spaciousness, room, the two harmony controls, the pump and the sweep) *and* rolls a kit of instruments that belong to it — a drum style, a bass style, a voice from each of the genre's core pools and a few extras. They come in two groups: **ELECTRONIC** (DEEP HOUSE, NU-DISCO, AFRO HOUSE, AMAPIANO, TECHNO, MELODIC TECHNO, TRANCE, EDM, UK GARAGE, LIQUID DNB, SYNTHWAVE, FUTURE BASS, TRAP, REGGAETON, AFROBEATS, LO-FI, ELEC) and **CLASSIC** (AMBIENT, DARK, JAZZ, ORCH, ZEN, BLUES, FOLK, DREAM, FUNK, EPIC). Clicking a genre again rolls a new kit from it. While a genre is selected, the FEEL and INSTRUMENTS randoms stay inside it; moving a control by hand deselects it.

**Instruments** are grouped for finding things: BASS; the drums as ELECTRONIC DRUMS and CLASSIC DRUMS (one drum style plays at a time, across both); and the instruments by the part they play in an arrangement — PADS & CHORDS, LEADS, RHYTHM and AIR, the roles Infinite mode builds its eras from. The grouping is display only: share links and what plays are unaffected.

**RANDOMIZE ALL** picks a genre — electronic ones twice as likely as classic, about two rolls in three — then varies its feel (any root, a tempo and scale from the genre's range, the sliders nudged) and rolls its kit. About one roll in ten is a wildcard: any feel and any 2–5 instruments, for the combinations no genre makes. Entering Manual mode with no instruments selected automatically randomises.

**FORM** is **LOOP** — the arrangement as it is, round and round, exporting for **LENGTH** — or **SONG**: a song composed from it, the same way Infinite mode's songs are, with the instruments coming in and out section by section and the feel following each section's energy around the FEEL settings. For a song, **LENGTH** is exactly how long it is (30 s to 6 minutes, in 5 s steps), as is its export: a 60 s song is a 60.000 s WAV. Only a very short song at a very slow tempo can't fit (say 30 s at 60 BPM); then the length beside the slider is the shortest it can be. A song is its seed and its length: it stays the same until **NEW SONG** or a new LENGTH, so PLAY plays what EXPORT saves, and SHARE carries it. Each form keeps its own LENGTH. PLAY pauses and carries on as in Infinite mode; **STOP** goes back to the top, so the next PLAY starts a loop afresh and a song from its intro (changing FORM or LENGTH or pressing NEW SONG while paused does the same). A song stops itself when it ends. Moving a control while it plays changes the song (the FEEL sliders set its own feel, which the sections then vary; new instruments are given the same song's parts).

**SHARE** encodes the full current configuration — key, scale, tempo, all five feel sliders, room, pump, sweep, every enabled instrument, and the song's seed and length when FORM is SONG — as a binary payload in the URL hash (`#c=…`, base64url). Clicking the button copies the URL to the clipboard. Loading that URL restores the exact configuration. Each instrument is one bit. The first 72 sit in a fixed 20-byte layout (27 characters); any after them go in a tail of a length byte plus their bits, which grows with the instrument list on its own. A song's link adds a form byte, its 32-bit seed and its 16-bit length in seconds after the tail (writing the tail's length byte even when there is no tail), where a page from before songs ignores them; a song's link from before lengths has no length, and the song draws its own as Infinite mode's do. Fields have only ever been appended, so older 11-, 13-, 14-, 15-, 16- and 18-byte links still load (missing fields fall back to their defaults; a missing pump or sweep is none), and a page from before the tail reads a newer link's first 72 instruments. The link format lives in `src/share.js`, which the export renderer also exposes to pages embedding it. The instrument bitmask order is spelled out in `ALL_INST_KEYS` and must only ever be appended to; a new instrument must be added there too, or it plays but is left out of links (the console warns at startup).

**Controls:**
| Control | Range | Effect |
|---|---|---|
| BPM | 40–180 | Tempo (changes take effect on the beat grid without drift) |
| Octave | −3…+1 | Moves every voice by whole octaves from its home register. Instruments only stop at the edge of audibility (≈30–40 Hz) or where they'd turn piercing, so at −3 the low instruments hold at the floor (the bass never drops below D1) while the higher ones keep descending |
| Density | 0–1 | Note volume and presence |
| Brightness | 0–1 | Filter cutoffs (pad, drone, strings, brass, arpeggio, clavinet) and cymbal level |
| Spaciousness | 0–1 | Reverb send on the sustained voices |
| Harmony | 0–1 | How strongly melodic voices lock to chord tones — 0 lets them roam the whole scale (looser, more random), 1 keeps them strictly on the chord (tighter, more consonant). Triads and bass always follow the progression. |
| Chord | 2–8 beats | How often the chord progression advances — low = fast harmonic motion, high = long, slow-changing chords |
| Pump | 0–1 | Sidechain: everything but the drums dips on every beat and swells back — the breathing of house and EDM. Up to about −14 dB at 1 |
| Sweep | 0–1 | The French house filter: everything but the drums (and their echo and reverb) runs through a resonant lowpass that stays open for six bars, closes over two and opens back up over eight, landing fully open on the next sixteen-bar downbeat. The depth sets how far it closes — about 220 Hz at 1 (the bass line and little else), 2 kHz at 0.5. At 0 the filter is routed around entirely |

**Export** renders a WAV file offline, faster than real time, in a hidden iframe (`src/render.js`) with its own copy of the engine, so whatever is playing carries on undisturbed. The same scheduler drives an `OfflineAudioContext`, stepped every 60 ms of audio time as the live ticks are (Firefox, which can't pause an offline render, takes a two-pass route that works out the leveller's moves afterwards). A loop runs for exactly LENGTH, and so does a song, ending with its last chord rung out. Over the last moments (up to 0.4 s) a fade lets decaying voices die away instead of being chopped, and no new notes start inside it. Because every musical choice is seeded (see [Seeded randomness](#seeded-randomness-srcrandomjs)), an exported song is note for note the one that played.

---

## Audio Engine

All sound is synthesised in real time — no samples. Notes are Web Audio nodes created, scheduled and discarded; plucked strings are rendered per note by a physical model into a buffer. A scheduler fires every 60 ms and fills a 120 ms lookahead window (`LOOKAHEAD = 0.12`), the standard technique for glitch-free timing from JavaScript.

### Timing: one beat grid (`src/audio/transport.js`)

Every voice schedules in **beats**, not seconds. The transport converts beats to audio time and, when the tempo changes, re-anchors at the current position so the grid stays continuous. Consequences:

- Bar lines, chord changes, drum steps and melodic phrases all line up.
- A voice that joins mid-playback (toggled on, or picked by a new era) enters on the next grid line instead of replaying every note it "missed" in one burst.
- Each playback run is a **session** with its own dry/reverb/echo buses. Stopping and restarting disconnects the old session, so nothing queued before the stop (a 16-beat drone, an echo tail) leaks into the new music.

### Seeded randomness (`src/random.js`)

Every musical choice — a note, a pattern, a fill — is drawn from a seeded random stream, one per voice (plus one for the leads' shared motifs), derived from the session's seed and the voice's name. One stream per voice rather than one for everything, because the scheduler runs each voice up to the horizon in turn, and where the horizons fall depends on when the ticks come: every 60 ms exactly in an export, a little early or late live. With one shared stream the order of draws, and so every note after the first difference, would follow the tick timing; with a stream each, a voice draws the same numbers however its notes fall across ticks. A song's session takes the song's seed, so it plays the same live and in the export; other sessions take a fresh one. The reverb impulses and noise buffers have fixed seeds, so every render has the same rooms.

### Harmony engine (`src/audio/harmony.js`)

All pitched voices read the current chord from one place, so the pad, bass, melody and choir always agree.

**Chords** are built by stacking diatonic thirds on a scale degree, which yields the right quality for the active mode automatically.

**Progressions are per mode.** Each mode has its own library that features its characteristic chord — Dorian IV (`i–IV`), Phrygian ♭II (`i–♭II`, the Andalusian descent), Lydian II (`I–II`), Mixolydian ♭VII (`I–♭VII–IV`), Aeolian `i–VI–III–VII` and friends — and avoids the mode's diminished triad (a single shared list gave Lydian `I–♯iv°–V–I`). Pentatonic scales stack into open quartal voicings and use gentle motion.

**Form.** A progression (A) is played twice, a contrasting one (B) once, then A returns: AABA, 16 chords. In a song, each section plays its own progression from its first beat instead (see [Songs](#songs-srcaudiosongjs)), with the sevenths drawn once per progression, so a chorus is harmonised the same every time.

**Harmonic rhythm.** A chord lasts `chordBeats` beats on the transport grid. Voices ask for the chord *at the beat they are scheduling*, so a note on a chord change gets the new chord, and sustained voices end exactly at the change instead of holding the old chord over the new one.

**Colour.** Chords sometimes carry their 7th — more often when the **Harmony** control is looser (jazz, blues) — and every chordal voice uses the same decision, so melodies treat the 7th as a chord tone only when it is actually voiced.

**Voice leading.** Chordal voices choose the inversion and octave of each chord that moves least from the previous voicing, with a pull back toward the instrument's register. Measured over 50 random progressions: 3.4 semitones of total movement per chord change, against 8.8 for root-position blocks.

### Melody: motifs and phrases (`src/audio/phrase.js`)

Melodic voices are built from **motifs** — a one-bar rhythm cell plus a contour — developed over a 4-bar phrase:

| Bar | Role | Treatment |
|---|---|---|
| 1 | Statement | The motif |
| 2 | Sequence | Same motif, restarted on the new chord |
| 3 | Variation | Same rhythm, contour inverted |
| 4 | Cadence | A closing rhythm landing on a stable tone (root, then fifth/third) |

The motif carries into the next phrase more often than not (repetition is what makes a line memorable). Note choice follows voice-leading practice: chord tones on strong beats (~90%), passing tones allowed on weak ones (~35% chord tones), and a leap of a fourth or more is followed by a step back the other way. Velocity follows the metre (downbeat accents) and the phrase (a swell into bar 3).

**Call and response.** With two or more lead instruments active, they trade two-bar phrases and share the motif, so the answer imitates the call; whoever isn't soloing drops to occasional soft chord tones.

**Ostinato mode** (kalimba, marimba, clavinet) repeats one cell every bar and re-anchors it to each chord — a riff that follows the changes.

### Bass (always available)

Every style lands the chord root on each chord arrival and never holds a note across a change. Root motion takes the nearest octave with a pull toward home, and the register is kept between E1 and G3 whatever the octave setting.

| Style | Line | Sound |
|---|---|---|
| SUB | One root per chord | Sine + triangle, sub-octave only where it is still audible (≥ 35 Hz) |
| PLUCK | One-bar rhythms of root/fifth/octave; the last note before a change is an approach tone | Finger bass — Karplus–Strong string |
| WALK | Quarter notes: root on arrival, chord tones on strong beats, scale steps heading toward the next root, and a chromatic, diatonic or dominant approach on the last beat | Upright bass — Karplus–Strong string, dark and plucked mid-string, plus a finger thump |
| SYNTH | 16th-note patterns: octave bounce, off-beat, 3-3-2 syncopation, driving eighths | Detuned saws through a resonant filter sweep |
| RUMBLE | One root per chord | Square + sine sub with slow tremolo |
| DEEP | Syncopated sixteenths that leave the beat to the kick (deep house) | Organ bass — a sine with its 2nd and 3rd harmonics, plucked into a held body |
| ACID | A two-bar sixteenth sequence of chord tones with accents and slides, mutating a little each phrase | TB-303 — one saw (sometimes square) through a resonant lowpass whose envelope is the squelch, a little drive; accents open it further, slides glide without retriggering, the cutoff wanders over bars |
| ROLLING | Sixteenths that skip the beat (trance / EDM) | The SYNTH bass, gated short |
| DISCO | Octaves in eighths — root, octave, root, octave — some syncopated, some with the fifth | Moog-style: a saw and a square through a resonant lowpass that snaps open on every note |
| 808 | Long notes under a sparse kick, held until the next; a note following one still sounding usually slides into its pitch | A sine with a fast pitch drop and saturation (so it is heard on a phone) — the trap 808 |
| REESE | Long notes, at most a few per bar (drum & bass) | Two saws a few cents apart beating slowly against each other, through a drifting lowpass, over a sine sub |
| LOG DRUM | A syncopated, melodic sixteenth riff (amapiano) | A hollow pitched knock: a sine dropping into its pitch, a woody click, saturation and a lowpass closing behind the hit |

The dance styles (DEEP onwards) are chosen in Manual mode or by a genre; Infinite mode keeps to the first five.

### Instruments

Twenty-nine instruments in four roles (the four dance voices are Manual mode's). Infinite mode builds each era's arrangement from roles — one or two **bed** voices, usually one **lead**, one or two **motion** voices, sometimes **air**, drums about a third of the time — instead of drawing at random (which could produce four melodies and no harmony).

#### Bed — chordal, change on the harmonic rhythm, voice-led

| Instrument | Synthesis |
|---|---|
| **Pad** | Detuned saw pair per note into one lowpass that breathes on a slow LFO; attack scales with chord length; releases overlap the next chord |
| **Strings** | Three detuned saws per note (ensemble), a lowpass that opens as bow pressure builds, and per-note vibrato at slightly different rates, faded in after the attack |
| **Choir** | Formant synthesis: the chord's detuned saws (plus a breath of aspiration noise) feed one bank of three band-pass filters tuned to the formants F1–F3 of a vowel (alto tables), which glides from one vowel to another ("ooh" → "aah") over the chord. Vibrato from two slightly different LFOs |
| **Organ** | Tonewheel drawbars at true organ footages (16′ 5⅓′ 8′ 4′ … = 0.5, 1.5, 1, 2 … × pitch), 3 dB per drawbar step, one of five classic registrations per session; one Leslie rotor for the whole chord (amplitude + Doppler pitch wobble, chorale or tremolo speed); percussion (decaying 2⅔′) and key click |
| **Drone** | Tonic + perfect fifth pedal, detuned pairs, very slow filter sweep; successive drones cross-fade, and a key change releases the old one |
| **Supersaw** | Roland JP-8000 style: seven saws per note on its uneven detune curve (inner pairs close, outer pair ±28 cents), side saws split left and right with one of every width on each side, each saw started at its own phase so they don't flange as they drift apart. A much brighter filter than the pad (1.5–7.5 kHz with Brightness) that swells open with the attack |
| **Juno** | Roland Juno-60 pad: one oscillator per note (saw plus a square sub-oscillator an octave down, no detuning), a 24 dB/oct lowpass (two cascaded stages) that opens with the attack, and the Juno chorus — mode I or II per session — which is where all its width comes from |
| **Solina** | String machine (ARP Solina String Ensemble): one plain saw per note at 8′ plus a quieter 4′, slow swell and long fade, through the string ensemble (three delay lines swept by a slow and a fast LFO, a third of a cycle apart). Some sessions add a two-stage phaser after it, Jarre-style |
| **Synth brass** | Two detuned saws per note into a lowpass that carries the brass shape, in one of two settings per session: *stab* (Oberheim OB-Xa: a fast bright "blat" settling to a darker sustain) or *swell* (Yamaha CS-80, Vangelis: the filter climbs slowly with the level, then vibrato arrives) |

#### Lead — phrase generator, call and response

| Instrument | Synthesis |
|---|---|
| **Melody** | Soft synth lead: triangle + quiet octave, delayed vibrato |
| **Flute** | Near-sine with weak 2nd/3rd harmonics (thinning in the high register), breath noise through the whole note plus an attack "chiff", pitch settling from slightly flat, delayed pitch + amplitude vibrato |
| **Brass** | Brightness follows loudness (lowpass "bloom"), pitch scoops up as the lips lock on, delayed vibrato; strong notes are sometimes harmonised a third below |
| **Sitar** | Bright Karplus–Strong string plucked near the bridge, through an asymmetric waveshaper and presence band (the buzzing *jawari* bridge); *meend* glides from the previous note when it is close; sympathetic strings ring when the played pitch class matches |
| **Vibraphone** | Tuned bar partials at 1 : 4 : ~10, motor tremolo (speed chosen per session, sometimes off), soft mallet contact, pedal-length ring |
| **Mono lead** | The synthwave lead: saw and square a few cents apart through a resonant lowpass with its own envelope. Monophonic — a new note cuts the old one, and connected notes glide (portamento, up to 70 ms and never more than a quarter of the note). Delayed vibrato, Juno chorus, plenty of echo |

#### Motion — rhythmic figures

| Instrument | Synthesis / playing |
|---|---|
| **Arpeggio** | Arpeggiator locked to the global grid (up, down, up-down, Alberti, broken thirds, pinky pedal), re-mapped onto each chord; saw through a snappy resonant lowpass into the tempo-synced echo |
| **Harp** | Karplus–Strong strings with a soft finger-like excitation plucked mid-string; a rolled chord marks each chord change, with occasional single chord tones between |
| **Pluck** | Fingerpicked steel-string guitar (Travis picking): thumb alternates root and fifth on the beat, fingers pick upper chord tones on the off-beats, occasional pinch on beat one |
| **Kalimba** | Near-sine tine with a brief ~6× inharmonic overtone and a woody box thump; ostinato figures, sometimes a second thumb a third below |
| **Mallet** | Marimba bars at 1 : 4 : ~9.4 with pitch-dependent decay and a yarn-mallet thump; ostinato figures |
| **Clavinet** | Very bright Karplus–Strong string struck near the bridge, damped on key-up, through a lowpass that snaps shut (the funk "quack"); repeating riffs with occasional double-stops |
| **Rhodes** | Two-operator FM tine piano (1:1 modulator whose depth follows velocity for the "bark", 14:1 for the tine ping) comping rootless voicings (3-5-7-9, ♭9 avoided) in syncopated rhythms, anticipating chord changes by an eighth, through a stereo auto-pan |
| **Chord stab** | House stab: the chord's four tones (minor 7ths in minor keys), voice-led, on off-beats and syncopations; detuned saw pairs plus a square an octave down through a lowpass that snaps shut, into the tempo echo |
| **Saw pluck** | Trance / EDM pluck: three detuned saws through a fast-closing lowpass, chord tones in a gated sixteenth rhythm that holds for a phrase like a hook, heavy tempo echo |
| **Vocal chop** | A synthesised sung syllable — a saw and a breath of noise through the three formant resonances of a soprano vowel (ah, oh, ee, oo, eh) — chopped into a two-bar hook on chord tones, some chops falling a step at the end like a pitched-down sample |
| **Funk guitar** | Disco rhythm guitar, the "chicken scratch": Karplus–Strong strings strummed in sixteenths (down on the beat and the "and", up between, a few ms per string), the chord's four tones high on the neck, voice-led. Most strokes are muted scratches; a few ring out as short chops cut by the fretting hand. Patterns hold for a phrase |

The four dance voices are chosen in Manual mode or by a genre; Infinite mode doesn't draw them into its eras.

#### Air — sparse chord tones

| Instrument | Synthesis |
|---|---|
| **Bell** | Handbell: strong harmonic partials (1, 2, 3) and faint, fast-decaying inharmonic ones, a second fundamental a fraction of a hertz off for the slow warble, a strike click |
| **Glass** | Glass harmonica: near-pure tone with a slow swell and a partial 1–2 Hz away for audible beating |
| **Texture** | Two slightly detuned sines + octave, mostly reverb and echo |

### Drums

A step sequencer: one bar per pattern, written as strings (`X` accent, `x` hit, `o` medium, `g` ghost, `f` feathered, `?` sometimes-ghost, `.` rest). Patterns run on 16 steps (sixteenths) or 12 (eighth-note triplets — true shuffle and 12/8 feel), with optional MPC-style swing and small timing/velocity humanising for the "played" styles. Styles with fills play one at the end of 4-bar phrases (always a longer one every 8 bars) and hit a crash on the next downbeat; trap adds hi-hat rolls. In Infinite mode the style is picked from those suited to the current tempo.

| Pattern | Grid | Character |
|---|---|---|
| MINIMAL | 16 | Kick 1 & 3, snare 2 & 4 |
| 4/4 | 16 | Rock: kick 1, 3, 3&; accented 8th hats; snare fills |
| HOUSE | 16 | Four on the floor, clap 2 & 4, off-beat open hats, shaker |
| FUNK | 16 | Syncopated kick, accented backbeat with ghost notes, 16th hats, open hat on the 4&, light swing |
| BOOM BAP | 16 | Hip-hop, 58% swing |
| BREAK | 16 | Staggered kick, asymmetric hats, slight swing |
| JUNGLE | 16 | Syncopated kick, ghost snares, busy hats |
| 2-STEP | 16 | UK garage: kick skips beat 3, swung hats and shaker |
| TRAP | 16 | Half-time snare + clap, 808 kick tuned to the key, 16th hats with rolls |
| HALF TIME | 16 | Snare + clap on 3 |
| SHUFFLE | 12 | Triplet blues shuffle (long-short hats) |
| SWING | 12 | Jazz ride ("ding, ding-a-ding"), hi-hat foot on 2 & 4, feathered kick, random comping ghost notes |
| BRUSHES | 16 | Brush sweeps each beat, brush taps on 2 & 4, triplet swing |
| BOSSA | 16 | Bossa kick (1, 2&, 3, 4&) and cross-stick clave |
| ONE DROP | 12 | Reggae: kick + cross-stick on 3 only, shuffled hats |
| DEMBOW | 16 | Reggaeton: four-on-the-floor kick, 3-3-2 snare |
| AFRO 12/8 | 12 | West African standard bell pattern, shaker, congas tuned to the key |
| CINEMATIC | 16 | Taiko hits, tom ostinato tuned to the key, tom fills |
| GHOST | 16 | Very sparse, atmospheric |
| SYNTHWAVE | 16 | 80s drum machine: kick 1, 3, 3&, gated snare on 2 & 4, eighth hats, Simmons tom fills |
| OUTRUN | 16 | Four on the floor, gated snare, driving sixteenth hats, Simmons tom fills |
| DEEP HOUSE | 16 | Swung 909 groove: kick on every beat, clap 2 & 4, off-beat open hats, closed hats on the beat, rim and shaker |
| TECHNO | 16 | Driving 909 kick with accents, sixteenth hats around off-beat open hats, rim ghosts |
| TRANCE | 16 | Four on the floor, clap 2 & 4, off-beat open hats, snare-roll fills |
| BIG ROOM | 16 | Heavy kick, clap and snare stacked on 2 & 4, off-beat open hats, shaker |
| DISCO | 16 | Four on the floor, snare and clap on 2 & 4, the open hat on every "and" cut by the closed one a sixteenth later, tambourine, tom fills |
| AFRO HOUSE | 16 | Swung 909 four on the floor under sixteenth shakers, congas, off-beat open hats and a bell |
| AMAPIANO | 16 | Sparse kick (the log drum carries the low end), loud sixteenth shakers, claps on 2 & 4, rim and conga syncopations |
| AFROBEATS | 16 | Swung 4/4: kick on 1 and 3, the tresillo on the rim, claps, shakers, congas |
| D&B | 16 | The two-step at 160–178 BPM: kick on 1 and the "and" of 3, snare on 2 & 4 with ghosts, driving hats |
| DRILL | 16 | A short kick that leaves room for an 808, snare on 3 with a late one after it, bouncing hats with rolls |

Where a dance style plays an open hat, its closed hat leaves that step empty — a closed hat chokes an open one, so the two on one step leave only a tick.

The dance styles (DEEP HOUSE onwards) are chosen in Manual mode or by a genre; Infinite mode's pick by tempo leaves them out.

**Kit** (all synthesised): kick (sine sweep, soft saturation for small speakers, beater click) · 808 kick (long boom tuned to the key root) · snare (two shell modes + band-passed wires) · clap (three hands + room tail) · cross-stick · hi-hats (TR-808 "metal": six square waves at inharmonic frequencies, band-passed; closing the hat chokes a ringing open hat) · ride (noise wash + metal shimmer + stick ping) · crash · toms and congas (tuned to root and fifth) · taiko · shaker · cowbell · tambourine (the 808 metal and bright noise, struck and shaken once more as the jingles settle) · brush sweep and tap · a 909-style kick for the dance styles (a harder, faster pitch drop than the acoustic kick, more drive, a click, and a body that holds) · for the 80s styles, a gated snare (a deeper body and longer wires, mostly heard through a gated reverb: an impulse of dense noise that holds its level for 0.32 s and then stops dead, the AMS RMX16 "nonlinear" trick) and Simmons SDS-V toms (pitch falling steeply through the note — the "pew" — tuned to root, fifth and octave, partly through the gated reverb). Kick, snare and clap sit centre; the other pieces are spread across the stereo field.

Kick and snare levels scale with `density`; cymbals and shaker with `brightness`.

### Musical scales

Eight scales defined as semitone intervals from the root:

| Scale | Intervals | Character |
|---|---|---|
| Aeolian | 0 2 3 5 7 8 10 | Natural minor — dark, classical |
| Dorian | 0 2 3 5 7 9 10 | Minor with raised 6th — jazzy, open |
| Phrygian | 0 1 3 5 7 8 10 | Flat 2nd — tense, Iberian flavour |
| Minor pentatonic | 0 3 5 7 10 | 5 notes — sparse, bluesy |
| Major pentatonic | 0 2 4 7 9 | 5 notes — open, optimistic |
| Lydian | 0 2 4 6 7 9 11 | Raised 4th — floating, ethereal |
| Mixolydian | 0 2 4 5 7 9 10 | Flat 7th — bright but unresolved |
| Major | 0 2 4 5 7 9 11 | Ionian — bright, resolved; EDM and future bass (I–V–vi–IV and friends) |

Pitches are standard MIDI note numbers (69 = A4 = 440 Hz): `hz = 440 × 2^((midi − 69) / 12)`. The tonic is kept within C3–B3; each instrument has a home register, and the octave setting moves it by whole octaves within that instrument's audible range.

### Plucked strings (Karplus–Strong)

Pluck, harp, sitar, clavinet and the plucked/walking bass use a physical string model: a noise burst — low-passed for a soft finger or left bright for a pick, and comb-filtered at the pluck position — circulates in a delay line one period long with an averaging filter in the loop, so upper partials die away faster than the fundamental, exactly as on a real string. A first-order allpass supplies the fractional part of the delay, keeping every note within ±1 cent of pitch from E1 to E6 (rounding to whole samples would be up to 26 cents off in the top octave). Decay time is set as T60 per note.

### Mix and effects

- **Spaces (ROOM control):** each is a room and a hall that belong together. Every dry signal shares the room's early reflections and short tail; the per-voice reverb sends feed the hall, a stereo impulse of decaying noise whose spectrum darkens over the tail (real rooms absorb highs faster than lows), behind a pre-delay and a 180 Hz high-pass so the low end stays dry and clear. STUDIO, ROOM, HALL and CATHEDRAL grow in size; changing space crossfades the inputs and lets the old tail ring out.
- **Shimmer:** the SHIMMER space is not a real place. Its 7 s tail stays bright, and an octave-up pitch shifter sits in the hall's feedback loop, so each pass through the tail comes back an octave higher: a chord blooms upward into its own upper octaves. The shifter is the delay-line kind (two Hann-windowed taps whose delay shrinks at one second per second, restarting every 100 ms, half a grain apart). Nothing goes round the loop twice at the same pitch, and a 250 Hz–3 kHz band limit lets the top octaves fade out instead of climbing into fizz. On a 440 Hz note the octave sits 6–10 dB under it for the first few seconds.
- **Built-in modulation effects:** the 80s instruments carry their own, as the hardware did — the Juno chorus (a delay swept 1.66–5.35 ms by a triangle LFO, the right side swept opposite the left), the string ensemble and a phaser. Each chord or note gets its own, but its LFO is free-running: it starts at the phase it would have reached had it been running all along, so the sweep carries on smoothly across chord changes instead of restarting.
- **Echo:** a tempo-synced ping-pong delay (dotted eighth) with band-limited repeats, used by the arpeggio, kalimba, bell, texture and melody. Its time follows tempo changes.
- **Master:** 30 Hz high-pass and a gentle compressor, as before.
- **Levels:** every voice was measured offline (ITU-R BS.1770 loudness) and balanced by role — beds ≈ −24 LUFS, bass ≈ −22 to −26, leads ≈ −27, motion ≈ −30, air ≈ −32, drum kits ≈ −25 (jazz kits ≈ −29) when soloed. Previously the spread was over 40 dB (the pluck was effectively silent).

---

## Evolution Engine (Infinite mode)

The music evolves at two timescales.

### Continuous drift

On every tick (~60 ms), three state parameters randomly walk:

- **`brightness`** (0.05–0.95) — filter cutoffs, cymbal level
- **`density`** (0.1–1.0) — melody and drum gain scaling
- **`spaciousness`** (0.1–0.9) — reverb send amount

Each drifts by ±0.001–0.002 per tick.

### Era transitions (every ~38 seconds)

An era change waits for the next **chord change**. Every voice schedules up to that exact beat in the old key, then the new era starts on it — so no note straddles the old and new key, and the tempo change lands on the beat.

1. **Root note** moves by a closely related interval from `[−7, −5, −2, 0, 0, 2, 5, 7]` semitones (doubled `0` makes staying in key twice as likely), wrapped to stay within one octave
2. **Scale** changes to a random mode
3. **Chord progression** (a new AABA form) is drawn for the new mode
4. **Tempo** drifts, bounded to 52–130 BPM; **octave**, **chord length** and the three feel parameters are re-rolled
5. A new arrangement is built from roles; bass and drum styles are re-rolled (drums from styles that suit the new tempo)
6. Every voice re-enters on the new era's first downbeat; a sounding drone fades out under the new one

## Songs (`src/audio/song.js`)

A song keeps what makes it itself — key, tempo, instruments, chord progressions, the hook — and changes its arrangement from section to section: who plays, how hard the drums hit, how bright and full it is. That is what an intro, a verse, a chorus or a drop *is*; an era change, which rerolls everything at once, sounds like a different record.

**Composing.** A song is composed from a plan (the arrangement, as data) and a seed, so the export renderer composes the same song from the same plan. Its form depends on the drums:

| Form | When | Sections |
|---|---|---|
| club | house, techno, trance, garage, D&B and the other dance drum styles | intro (kick and time) · groove · build · drop · breakdown · outro |
| song | any other drums | intro · verse · pre-chorus · chorus · bridge · outro |
| ambient | no drums, or soft drums at low density | intro · theme · swell · drift · outro |

Each form has a few weighted sequences, varied now and then (a double chorus to finish, a second drop, no bridge), and every song ends on its tonic chord, held while everything else stops. The song has a progression for its verses, one for its choruses (or its drops), and contrasting ones for the bridge, pre-chorus or breakdown. A song is as long as Edit mode's LENGTH asks, or, in Infinite mode, a length it draws (about 2½–4 minutes, a little longer for club and ambient songs). Intros and outros don't grow with it: they're a share of the song, from about 5 s up to 12–20 s, in whole bars, and now and then (one in seven) one takes twice as long. The other sections are phrase lengths — 4, 8, 16, 24 or 32 bars and more, whole progressions — fitted to the rest without going over, with choruses and drops taking up the slack first. A song comes out exactly its length: what whole phrases leave over goes a phrase at a time onto the sections a song stretches (its last chorus or drop first, up to twice their length), then in whole bars onto the outro, and what's less than a bar onto the last chord, held a few beats longer and rung out for 4 s or more. A song too short for its form drops sections — the bridge, the pre-chorus, the extra verses and choruses, or the grooves, the breakdown and the first build and drop — and keeps the last chorus or drop, the one it builds to, so even a 30 s song has an intro, a verse, a chorus and an outro. Shorter still, its sections may be half an eight-bar progression and its intro and outro a bar each, and at the last it's only intro, hook and outro. Now and then a song's last chorus goes up a whole step (or a half step) and stays there.

**Arranging.** Each kind of section has a recipe — how many of the song's pads, rhythm parts, leads and air voices play, whether the bass does, and how much of the drum kit: *pulse* (kick and time), *light* (the beat without open hats, crashes and percussion) or *full*. The instruments are put in an order fixed for the song, so "the first rhythm part" is the same instrument all song. Changing instruments mid-song (in EDIT) rearranges the same song.

**Playing.** The scheduler's conductor runs every voice up to each beat, then applies it — as an era change does, so nothing is scheduled with the last section's chords or players:

- At a section's first beat: its progression, its instruments, every voice restarting there, and every random stream reseeded from the *kind* of section it is — so each chorus, drop or build replays the first one's parts (the club form's repeats match note for note; elsewhere a returning chorus, a little more energetic each time, varies slightly where voices thin out by density). The leads' motif is held for a whole hook section (chorus, drop, swell, breakdown) and drawn from one stream for all of them, so the breakdown teases the drop's hook.
- Every beat: **density**, **brightness**, **space** and **pump** from the section's energy (rising through a build, falling through an outro) around the song's own settings.
- The master leveller, which evens out eras, would fight a song's dynamics — lifting a breakdown, then pulling the build after it down as it grows — so in a song it only listens to the hook sections (choruses, drops, the top of a swell), which set the song's level, and holds still through the rest. An intro stays quieter than a drop, a build grows into it, and one song's choruses come out about as loud as the next one's.

**Transitions.** A drum fill on a section's last bar and a crash after it; through a build's last eight bars, a snare roll in quarters, eighths, then sixteenths, louder all the way, with a white-noise riser sweeping up over the whole build (`src/audio/voices/fx.js`); often a beat or two of silence before the drop (everything but the reverb and echo tails, cut on a gate after the pump), then an impact on the drop's downbeat — a falling sub boom and a burst into the hall. A breakdown opens with noise sweeping down, and a reversed-cymbal swell leads into a chorus.

---

## Visual Engine

Rendered with [Three.js r183](https://threejs.org/) via WebGL at native pixel ratio. Animation loop runs via `requestAnimationFrame`.

### Scene objects

The ring and the central sphere are driven by the **music itself** rather than the spectrum. Every voice logs each note (pitch, voice, velocity, length) and every drum hit as the scheduler commits it (`src/audio/notes.js`); `src/visuals/music.js` plays that log back in step with what is reaching the speakers — audio clock minus the output latency, so it stays in sync even over Bluetooth. The two analysers (spectrum and waveform) hear the mix through delays of that same latency, so the visuals driven by them show the same moment. (The old 64-bar spectrum ring put every note the engine plays into 5 bars and left 37 bars above 5 kHz dark most of the time.)

Pitch is laid out on the **circle of fifths** (C, G, D, A, E, B, F♯ …) around the scene. That puts a key's scale in one unbroken arc and a chord's tones next to each other, so harmony reads as a shape. Each pitch class has a colour: the tonic takes the palette hue and every fifth turns 30°.

**Harmonic halo** (`src/visuals/halo.js`) — a planetary ring of 16,000 dust particles around the sphere, animated entirely in a vertex shader:

| Dimension | Meaning |
|---|---|
| Angle | Pitch class, on the circle of fifths |
| Ringlet | Octave — seven concentric bands (C1 innermost … C7 outermost) with gaps between them |
| Glow | The key's scale glows as a coloured arc that swings round when the key changes; chord tones brighter |
| Plume | A sounding note lights its patch of dust, which lifts off the plane into a sparkling plume following the note's envelope; the onset throws a brief burst outward |

The dust orbits with Keplerian shear (inner ringlets faster), so it streams through the lit regions, which stay fixed in space.

**Chord constellation** — a ring-shaped star on each tone of the current chord, joined by dotted lines of light with pulses travelling along them. On the circle of fifths a major and a minor triad are mirror-image triangles and a seventh chord is a quadrilateral, so the harmony is a visible shape; the corners glide to the next chord's tones on each change, and a corner flares when its note is actually sounding.

**Harmonic sphere** — five nested wireframe icosahedra (vertices merged, so each of 362 points per layer is computed once), each listening to part of the band: bass (inner), motion, lead and air (outer). The whole shape bulges toward the current chord's pitch classes — the same directions as the lit halo sectors and the constellation — and morphs when the chord changes. Each note onset sends a ripple across its layer from the note's direction on the halo (high notes start near the top); the kick punches the inner layers and the snare the outer ones; a faint shimmer from a log-spaced spectrum keeps the surface alive. Each layer is coloured by one chord tone. Self-rotates, faster with audio energy.

**Inner glow sphere** — `AdditiveBlending`, coloured by the chord root, swells with the bass line and the kick.

**Attractor core** (`src/visuals/core/`) — inside the cages, thousands of particles ride the Aizawa strange attractor: a chaotic flow that spirals up round a sphere and plunges back down a vortex through its axis, no particle ever retracing its path. It runs faster as the music gets louder; the bass swells it, the kick twists it and the lead tightens its spiral, all within the narrow range of the equations' parameters that stays chaotic (outside it every path collapses onto the axis; a particle that falls there anyway is dropped back onto the flow). It takes the chord's colours by height, root at the bottom, and onsets send bright waves through it. At about 60% size and a third of its brightness — additive light stacked on the cages at full strength burns out to white — it's a core to the cages, and it takes their shape: each particle is pushed in or out by as much as the cage beside it (the innermost layer near the middle, blending into the next at the flow's edge), so it bulges into the chord's lobes, ripples with the notes and punches with the kick along with them. The cages share their surface for this (`surfaceBetween()` in `src/visuals/cages.js`: the chord modes, ripples and punch their vertices take). The particles move on the CPU, so phones (coarse pointers) get 60% of them.

**Star field** (`src/visuals/stars.js`) — 7,500 small point stars and 80 large stars, placed using 3D value noise rejection sampling for organic clustering. Each star stores cylindrical coordinates and drifts in a three-component aperiodic flow field using irrational-ratio frequencies (φ, √2, √3), so the motion never visibly repeats. The drift, the colours and the response to the music are all computed per star in the vertex shader; each frame the CPU only sets uniforms. The small stars are one `Points` object and the large ones one instanced mesh of camera-facing quads, drawn exactly as `PointsMaterial` and `SpriteMaterial` would draw them.

The stars hear the music three ways, on top of the loudness swell (drift amplitude and size, from the spectrum):

- **Pitch:** the sky is laid out like the ring. The circle of fifths runs round the horizon in the same directions as the chord moons and the sphere's lobes, and register is height: low notes below the horizon, high ones above. Each sounding note (the 16 strongest) lights a round patch of sky in its direction, tinted the pitch class's colour. Directions are taken from the camera, as on a real sky, so a patch is round and keeps its place as the camera orbits. A held chord glows as a few steady patches; a melody flares from patch to patch. The large stars only change colour, since they already swell with loudness.
- **Kick:** each kick sends a ring of light out from the planet across the sky, as seen from the camera, reaching past the corners of the view in 0.8 of a beat.
- **Hats:** each hi-hat, shaker or ride hit makes its own random 3% of the small stars flicker for about 60 ms, the way stars scintillate.

Every star has a colour personality fixed at placement time:

| Type | Proportion | Hue behaviour |
|---|---|---|
| Musical | ~38% | Follows the palette hue with a small personal offset |
| Blue-white (O/B type) | ~24% | Fixed cool hue (~198–234°) regardless of key |
| Warm orange/red (K/M type) | ~18% | Fixed warm hue (~14–40°) |
| Near-white neutral | ~20% | Low saturation, any hue |

Large stars share the same personalities, drawn with the large star sprite, 1.5–7 units across.

**Volumetric nebulae** — 22 large cloud sprites with elliptical aspect ratios and static rotations for organic variety. Each is a soft radial gradient (white-on-transparent, generated via canvas) rendered with `AdditiveBlending` at low opacity (0.14–0.32). Colour types are weighted toward fixed deep blues, purples, and magentas, with ~20% following the palette hue. Each nebula slowly orbits with an independent speed and direction, and floats vertically on an aperiodic sine cycle (period ~63–105 seconds). Overlapping clouds accumulate intensity, producing the volumetric impression without ray-marching.

**Animation fade-in** — when playback starts, `energy` and `bass` ramp from 0 to their real values over 2.5 seconds. The camera orbit radius and Y oscillation also lerp smoothly from their idle positions. This prevents an abrupt visual jump when the audio begins. Stars are animated and visible even before playback starts (at energy=0).

### Colour

A single hue drives the base palette: `hue = (pitchClass × 15 + 180 + era × 40) % 360`. Each root note has a characteristic colour; each era shifts it by 40°. Fixed-temperature star types (blue-white, warm) are anchored to their astrophysical colours and do not shift with the key.

### Camera

Orbits the origin at radius 7.5, angle incrementing by `0.0035 + energy×0.0018`. Y position oscillates as `sin(cameraAngle × 0.37) × 2.2 + 1.0`. The frequencies 1.0 and 0.37 are incommensurate so the path never exactly repeats.

---

## Signal flow summary

```
setInterval (60ms)
  └─ tick()
       ├─ transport.tick()       → re-anchor the beat grid on tempo change (+ echo time)
       ├─ harmony.tick()         → advance the chord pointer to the current beat
       ├─ song loaded?           → conductor: every voice up to each beat, then the beat:
       │                           a section's chords, players and seeds, the feel from its energy
       ├─ era due? (eras)        → schedule every voice up to the next chord change,
       │                           switch key/scale/tempo/arrangement, continue
       └─ voice.tick() × N       → schedule events in the lookahead window, in beats,
                                   each in its own seeded random stream

voice ─► [per-voice panner] ─► pump ─► gate ─► sweep ─► session dry ─► masterGain ─► mix ─► 30 Hz HP ─► compressor ─► … ─► limiter ─► out
      └─► session reverb send ─► pre-delay ─► 180 Hz HP ─► convolver ─► reverbGain ─┘
                                                            ▲   └─► (SHIMMER) band-limit ─► octave-up shifter ─┐
                                                            └───────────────────────────────────────────────────┘
      └─► session echo send ─► band-limit ─► ping-pong delay ─► masterGain (+ a little into the reverb)

visual taps (not heard), each delayed by the output latency:
  mix     ─► delay ─► analyser   (spectrum: energy, bass, sphere shimmer)
  limiter ─► delay ─► scope      (waveform: ring, chord strings)

requestAnimationFrame
  └─ animate()
       ├─ analyser.getByteFrequencyData() → freqData[]
       ├─ fade-in ramp (0→1 over 2.5 s)  → energy, bass scaled on play start
       ├─ read the note log               → note envelopes, hits, chord, key (at heard time)
       ├─ halo dust (shader uniforms)     ← note envelopes, onsets, key, chord
       ├─ chord constellation             ← chord tones, their note levels
       ├─ sphere: chord lobes + ripples   ← chord, note onsets, kick/snare, log spectrum
       ├─ inner glow                      ← chord root, bass line, kick
       ├─ attractor core (CPU particles)  ← loudness, bass, kick, lead, chord, onsets, the cages' shape
       ├─ star field (shader uniforms)    ← t, energy, bass, hue, sounding notes, kicks, hats
       ├─ update 22 nebula sprites        ← hue, energy, bass, t
       ├─ lerp camera orbit               ← energy, fade
       └─ renderer.render(scene, camera)

Export path (EDIT's EXPORT, Infinite's EXPORT SONG)
  └─ hidden iframe: src/render.js, its own copy of the engine
       ├─ applyPlan(plan) → startSession → OfflineAudioContext
       ├─ suspend every 60 ms of audio time → tick()   (Firefox: tick ahead, two passes)
       ├─ a fade over the last moments
       └─ AudioBuffer → 16-bit WAV download
```

---

## Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| [Three.js](https://threejs.org/) | r175 | 3D rendering (loaded from CDN) |
| Web Audio API | — | Sound synthesis (built into browser) |

The app is bundled with [esbuild](https://esbuild.github.io/) (`npm run build`) into a single content-hashed JS file for production deploys; `three` is still loaded unbundled via the CDN import map. See `scripts/build.js`.
