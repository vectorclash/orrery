# Mastering: what's left

Written 2026-11-10, after the width rider, side air, air shelf and output trim went in (see the Master entry in the README). Four pieces of mastering work remain, plus one measurement that should come first. Nothing here is started.

## Where the master stands

The chain, in order (`initAudio` in `src/audio/context.js`):

mix → stereo image (mono below 120 Hz, +3 dB side shelf above 5 kHz, width rider) → 30 Hz high-pass → −1.5 dB at 350 Hz → +2 dB shelf above 6 kHz → leveller → compressor → makeup (+5.4 dB) → saturator → limiter → trim (−0.25 dB) → out

Measured over 60 exported songs (40 s each, from just before the first hook):

| | |
|---|---|
| Loudness | −13.9 LUFS average, each song within about 1.5 dB |
| Loudness range | 1.4 LU average |
| Loudest true peak | −1.2 dBTP |
| Octave-band spread between songs | 3 to 7 dB (standard deviation, per band) |
| Left/right balance | 0.6 dB standard deviation, worst song 2.3 dB to the right |

## 0. Measure reference tracks first

Every target so far (how bright, how wide, how dynamic) is a typical figure for finished masters, recalled, not measured. Before changing dynamics or tone, measure three or four released tracks the user would want Orrery to stand beside, with the same tools as the test songs: loudness and loudness range, octave-band balance, side against mid per band, true peak.

- **Needs from the user:** the tracks, as audio files, in a few of the genres Orrery makes.
- **Outcome:** a table of Orrery against the references, which says which of the items below are real gaps and how large. An item whose gap turns out small should be dropped.

## 1. Dynamics

**Problem.** One wideband compressor (threshold −20 dB, ratio 4, knee 24, attack 10 ms, release 250 ms) sits on the whole mix. Kick and bass carry most of the level, so each of their notes pulls everything else down with it. A loudness range of 1.4 LU is very flat; whether it is too flat depends on the references.

**Approach, cheapest first.**
1. Measure how much gain reduction the compressor does and what drives it: render a song's pre-master mix, run it through the chain with and without the low end, and compare the reduction. If the bass is the cause, the fix is in the next step. If the compressor is simply working too hard, raise its threshold and lower the makeup to match, and stop there.
2. Split the compressor into two bands, below and above about 150 Hz, each with its own compressor, summed after. The crossover has to sum flat: fourth-order Linkwitz–Riley (two cascaded Butterworth biquads a side), with the high band's phase matching the low's. Web Audio's compressor adds makeup gain of its own that grows as the threshold drops, so each band's level must be measured, not assumed (this is why the output trim exists).
3. Three bands only if two leaves the cymbals ducking under the snare.

**Check.** Loudness stays at −14 LUFS and true peak under −1 dBTP over the 60 songs. Loudness range rises toward the references'. Listen for pumping on a four-on-the-floor song with and without the pump effect.

**Risk.** The sidechain pump (`src/audio/voices/pump.js`) and the leveller already shape level; a multiband stage must not fight either. Compressor nodes differ slightly between browsers and carry about 6 ms of look-ahead delay, so both bands must go through one each, never one band dry.

## 2. Tone that follows the song

**Problem.** The EQ is the same for every song, and songs differ from one another by 3 to 7 dB per octave band. Some come out dark, some bright, some thick in the low mids.

**Approach.** A tonal rider, built like the leveller and the width rider (`rideLevel`, `rideWidth`): meters read the mix in three or four broad bands every tick, average over several seconds, and ease a low shelf, a high shelf and perhaps a mid bell toward a target balance, each within about ±3 dB. Partial correction (make up half to three quarters of the difference), so a lo-fi song stays darker than a trance one.

- Meters tap ahead of the filters they move, as the width rider's do.
- The export's two-pass path (Firefox, `renderAhead` in `src/render.js`) needs each meter's signal on a channel of its own in the first pass; the width rider is the pattern to copy.
- BRIGHTNESS is the user's control. The rider should correct toward a target that moves with BRIGHTNESS, not cancel it.

**Check.** The spread between songs per band falls by about half. The same song at BRIGHTNESS 0.2 and 0.8 still sounds clearly different. Exports by both paths match.

## 3. Left/right balance

**Problem.** Pan positions are fixed per instrument (`VOICE_PAN` in `src/audio/context.js`), so a song whose instruments happen to sit on one side leans that way. Worst case in the test set: 2.3 dB to the right (rhodes, vocal chop and guitar all right of centre, only the clavinet left).

**Approach, pick one.**
- **Place each song's instruments to balance.** When a song or loop starts, give each instrument its usual distance from the centre but choose the side so the sum stays near zero. This fixes the cause. A voice added while playing takes the side that balances; voices already playing must not move.
- **A balance rider on the master.** Simpler, and it catches imbalance from any source, but it corrects a lopsided arrangement by turning one side down, which narrows it.

The first is the better fix. Widening the pan positions was tried and dropped on 2026-11-10: it barely widened narrow songs and made balance worse.

**Check.** Balance within about 1 dB on every test song. A song exported from its start and from its first hook places instruments the same way.

## 4. A true-peak limiter

**Problem.** The limiter is a compressor node at ratio 20. It is not a brickwall, so the chain stays under −1 dBTP by leaving margin, and its 1 ms attack lets the fastest transients through to be rounded by the saturator.

**Approach.** A look-ahead limiter in an AudioWorklet: delay the signal a few milliseconds, find the gain that keeps the oversampled peak under the ceiling, smooth it, apply it. This would replace the limiter node and the trim after it.

**Cost.** The most new machinery of the four: a worklet module to bundle and load, a fallback where worklets are unavailable, and the offline export must load the same module. The gain is about a decibel of loudness and cleaner transients.

**Recommendation.** Last, and only if the references show Orrery's transients or loudness falling short after items 1 and 2.

## Order

0. Reference tracks (needs the user's files).
1. Dynamics, step 1 (measure), then step 2 if the measurement calls for it.
2. Tonal rider.
3. Balance, by placement.
4. True-peak limiter, if still wanted.

## How to test any of it

Rendering a song takes about 25 seconds; running a rendered mix through a new master chain takes under one. So: render each test song's pre-master mix once (`audio.mix` to the destination, recording the leveller's moves), then run the saved mixes through each candidate chain in a second page. Finish with the real export (`window.renderExport`) on every song, and a few with `OfflineAudioContext.prototype.suspend = undefined` to take the path Firefox takes. Measure loudness (BS.1770, gated), true peak (four times oversampled), octave bands, and side against mid above the bass: whole-band side/mid is dominated by the kick and misleads.
