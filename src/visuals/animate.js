import { camera, clock } from './scene.js';
import { updateCages } from './cages.js';
import { updateSpectrum } from './spectrum.js';
import { updateMusic } from './music.js';
import { updateRing } from './ring/scope.js';
import { updateWaveform } from './waveform.js';
import { updateChord } from './chord.js';
import { render } from './post.js';
import { updateStars } from './stars.js';
import { updateNebulae } from './nebula.js';
import { audio } from '../audio/context.js';
import { state } from '../state.js';

let cameraAngle = 0;
let audioStartT = null;
const FADE_IN   = 2.5; // seconds to ramp audio reactivity from 0 → full

// Reusable zero-filled freq array for the idle state (the cages stay at rest)
const zeroFreq = new Uint8Array(256);

function animate(timestamp) {
  requestAnimationFrame(animate);
  clock.update(timestamp);

  const t   = clock.getElapsed();
  const dt  = Math.min(0.1, clock.getDelta());
  // Each key keeps its colour: pitch class × 15°, offset so the palette
  // matches what the keys looked like before pitches moved to standard MIDI.
  const hue = ((state.rootMidi % 12) * 15 + 180 + state.era * 40) % 360;

  let energy = 0, bass = 0, fade = 0, freqData = zeroFreq;

  if (audio.started && audio.analyser) {
    if (!audioStartT) audioStartT = t;
    fade = Math.min(1, (t - audioStartT) / FADE_IN);

    audio.analyser.getByteFrequencyData(audio.freqData);
    freqData = audio.freqData;

    let rawEnergy = 0;
    for (let i = 0; i < freqData.length; i++) rawEnergy += freqData[i];
    rawEnergy /= freqData.length * 255;

    let rawBass = 0;
    for (let i = 0; i < 8; i++) rawBass += freqData[i];
    rawBass /= 8 * 255;

    energy = rawEnergy * fade;
    bass   = rawBass * fade;
  }

  // Always update the cages and stars — idle energy=0 keeps everything at rest
  // but still visible and gently moving. The ring and cages follow the notes
  // themselves; the space scene keeps its spectrum-driven energy/bass.
  updateMusic(dt);
  updateWaveform();
  updateSpectrum(freqData);
  updateCages({ energy, hue, dt, fade, t });
  updateChord({ hue, dt, t }); // before the ring, which it lights
  updateRing({ hue, dt, t });
  updateStars(energy, bass, hue, t);
  updateNebulae(energy, bass, hue, t);

  // Camera: lerp from flat idle orbit (r=7, y=1.5) to wavy active orbit (r=7.5)
  const activeY = Math.sin(cameraAngle * 0.37) * 2.2 + 1.0;
  const camY    = 1.5 + (activeY - 1.5) * fade;
  const camR    = 7.0 + 0.5 * fade;
  cameraAngle  += 0.003 + energy * 0.0018;

  camera.position.set(Math.sin(cameraAngle) * camR, camY, Math.cos(cameraAngle) * camR);
  camera.lookAt(0, 0, 0);
  render(dt);
}

export function startAnimation() {
  animate();
}
