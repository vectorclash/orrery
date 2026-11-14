// ─── The video stage ──────────────────────────────────────────────────────────
// Runs in an iframe of its own (see frame.js and studio.js), so it has its own
// copy of every module -- the audio engine and the visuals. A video is made in
// two passes:
//
// 1. load(): the audio, exactly as Orrery's EXPORT renders it (render.js),
//    with what the visuals hear written down as it plays -- the note log as
//    each tick wrote it, and the chord, key and beat at each moment
//    (renderTake's `capture`) -- and the video planned from the song
//    (director.js).
// 2. The visuals, stepped on the video's clock instead of the audio
//    context's: the note log written again as the ticks wrote it, the chord
//    and key set from the capture, and the two analysers stood in for by ones
//    reading the rendered signal (analyser.js). The director places the
//    camera and sets the effects (fx.js) each step. drawAt() does it for the
//    preview, in time with the page playing the audio; encode() for every
//    frame of the video, into an MP4 with the audio alongside.
//
// So the frames are exactly in step with the sound (a live recording would be
// one output latency behind it -- two seconds over AirPlay), any size, never
// dropped however long a frame takes, and the preview is the video.
import { Output, Mp4OutputFormat, StreamTarget, CanvasSource, AudioBufferSource, Quality, canEncodeVideo } from 'mediabunny';
import { renderTake } from '../render.js';
import { songFor } from '../audio/scheduler.js';
import { audio } from '../audio/context.js';
import { harmony } from '../audio/harmony.js';
import { clearLog, replayLog } from '../audio/notes.js';
import { state } from '../state.js';
import { renderer, scene, camera, setRenderSize, keepRenderSize } from '../visuals/scene.js';
import { mirrors, updateMirrors } from '../visuals/mirrors.js';
import { updateFrame } from '../visuals/animate.js';
import { render, post } from '../visuals/post.js';
import { resetMusic } from '../visuals/music.js';
import { standInAnalyser } from './analyser.js';
import { chain, fx } from './fx.js';
import { planVideo, directScene, direct, resetDirector, titleCard, styleFor, intensityFor, sceneTime } from './director.js';
import { makeTitles } from './titles.js';
import { videoBitrate, avcHigh, describeColour } from './encoding.js';

export const SAMPLE_RATE = 48000;
const CAPTURE_RATE = 240;  // what the visuals hear, written down this many times a second
const PREVIEW_RATE = 60;   // preview steps a second, as the live view draws
const BLUR_SUBFRAMES = 4;  // moments averaged into a frame, with motion blur
const AUDIO_BITRATE = 320_000;
const AUDIO_AHEAD = 1;     // seconds of audio handed to the encoder ahead of the frames
const STALL_MS = 30_000;   // an encoder that takes no frame for this long has stopped

// How much of each effect when it's soloed (SOLO on the bench), before its strength.
const SOLO_LEVEL = { defocus: 0.5, grade: 1, letterbox: 1, crt: 0.8, vhs: 0.8, film: 0.8 };
// Flash and slow motion are moments, not levels: soloed, they still only come when the music does.
const EVENTS = new Set(['flash', 'slowmo']);

let take = null;     // { cut, duration, steps, events, plan }
let plan = null;     // the director's
let settings = null;
let titles = null, titlesKey = '';
let clock = -1, replayed = 0, now = 0, chord = [];

post.chain = chain;
keepRenderSize();
const canvas = renderer.domElement;
Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'contain' });

// ── Loading ──
// Renders the take and plans the video. `loopSeconds`: how long a loop runs
// (a song is as long as it is). Returns what the page needs: the audio, the
// sections, the style the plan would choose by itself.
async function load(songPlan, loopSeconds, onProgress) {
  const duration = songPlan.song ? songFor(songPlan).seconds : loopSeconds;
  const { buffer, heard } = await renderTake(songPlan, duration, SAMPLE_RATE, onProgress, { stepRate: CAPTURE_RATE });

  const mono = new Float32Array(heard.left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (heard.left[i] + heard.right[i]) / 2;
  audio.ctx = { sampleRate: SAMPLE_RATE, outputLatency: 0, baseLatency: 0, state: 'running' };
  Object.defineProperty(audio.ctx, 'currentTime', { get: () => now });
  audio.latency = 0;
  audio.lag = [];
  audio.analyser = standInAnalyser(heard.mix, SAMPLE_RATE, 512, () => now);
  audio.scope = standInAnalyser(mono, SAMPLE_RATE, 4096, () => now);
  audio.started = true;
  harmony.chordPcs = () => chord; // what the capture says (the engine is done with it)

  take = { cut: heard.cut, duration, steps: heard.steps, events: heard.events, plan: songPlan };
  clock = -1;
  warmUp();
  return {
    duration,
    channels: [buffer.getChannelData(0), buffer.getChannelData(1)],
    autoStyle: styleFor(songPlan),
    autoIntensity: intensityFor(songPlan),
  };
}

// Every shader the video may need, compiled now rather than the first time
// it's used, which would stall the preview: the effects' passes, and the 3D
// mirrors' copies of the scene (drawn only while they're on).
function warmUp() {
  chain.warm();
  mirrors.on = true;
  updateMirrors({ dt: 0 });
  renderer.compile(scene, camera);
  mirrors.on = false;
  updateMirrors({ dt: 0 });
}

// ── Settings ──
// { style, look, camera, intensity, grade, allow: { effect: bool }, strength:
// { effect: 0…2 }, solo: [effect...], titles: { on, opening, closing } }
function configure(next) {
  const replan = !settings || ['style', 'look', 'camera'].some(k => settings[k] !== next[k]);
  settings = next;
  if (replan && take) {
    plan = planVideo({ cut: take.cut, duration: take.duration },
      { style: next.style, look: next.look, camera: next.camera, seed: take.plan.song?.seed ?? 0 });
    resetDirector();
  }
  return plan && {
    sections: plan.sections.map(s => ({ label: s.label ?? s.kind.toUpperCase(), role: s.role, t0: Math.max(0, s.t0), t1: Math.min(take.duration, s.t1) })),
    rhythm: rhythmOf(take.plan),
  };
}

// The song's meter, for the upload's description (youtube.js): { meter, change }.
function rhythmOf(p) {
  if (!p.song) return null;
  const s = songFor(p);
  return { meter: s.meter.name, change: s.change && { kind: s.change.kind, meter: s.change.meter?.name ?? null } };
}

async function useTitles() {
  const t = settings.titles;
  const [w, h] = [canvas.width, canvas.height];
  const key = JSON.stringify([w, h, t.opening, t.closing]);
  if (key === titlesKey) return;
  titlesKey = key;
  titles?.start.dispose(); titles?.end.dispose();
  titles = await makeTitles(w, h, t.opening, t.closing);
}

// ── Stepping ──
// The bench's say over the director's amounts: soloed effects alone, at a
// set level; otherwise the director's, unless switched off, at their strength.
function amounts(name, v) {
  const strength = settings.strength?.[name] ?? 1;
  if (settings.solo?.length) {
    if (!settings.solo.includes(name)) return 0;
    return (EVENTS.has(name) ? v : SOLO_LEVEL[name] ?? 0.8) * strength;
  }
  return settings.allow?.[name] === false ? 0 : v * strength;
}

// How far the world slows before a drop (sceneTime in director.js): SLOW MOTION's strength.
const slowDepth = () => Math.min(0.92, 0.85 * amounts('slowmo', 1));
// The scene's time at time `t` of the video: the video's, less what slow motion took.
const sceneAt = t => sceneTime(plan, t, slowDepth());

// One step of the visuals, to time `t` of the video.
function step(t, dt) {
  now = take.cut + t;
  // The log as the ticks had written it by now, and the chord and key then.
  const { events, steps } = take;
  while (replayed < events.length && events[replayed].at <= now + 1e-9) replayLog(events[replayed++]);
  const s = steps[Math.max(0, Math.min(steps.length - 1, Math.round(t * CAPTURE_RATE)))];
  chord = s.chord;
  state.rootMidi = s.rootMidi; state.era = s.era; state.scaleIdx = s.scaleIdx; state.tempo = s.tempo;

  directScene(plan, t);
  updateFrame(sceneAt(t), clock < 0 ? dt : Math.max(0, sceneAt(t) - sceneAt(clock)));
  directNow(t, dt);
  clock = t;
}

// The director at time `t`: the camera, the effects, the titles. Run again
// with dt 0 when the settings change while the preview is paused, so the
// change shows at once and nothing moves on.
function directNow(t, dt) {
  const intensity = settings.intensity ?? intensityFor(take.plan);
  direct(plan, t, dt, intensity, amounts);
  if (settings.grade && settings.grade !== 'auto') fx.gradeKind = settings.grade;
  const card = titleCard(t, take.duration);
  fx.titles = settings.titles?.on && titles ? titles[card.which] : null;
  fx.titleAlpha = card.alpha;
  fx.titleDim = card.which === 'end' ? 0.45 : 0;
}

// Steps on to time `t`, `rate` steps a second.
function stepTo(t, rate) {
  if (clock < 0) step(0, 1 / rate);
  while (clock + 1 / rate <= t + 1e-9) step(clock + 1 / rate, 1 / rate);
}

// Back to `t` (or on to it, from far behind): the music heard afresh from a
// couple of seconds before, so what's sounding at `t` is.
function seek(t) {
  clearLog();
  resetMusic();
  resetDirector();
  const from = Math.max(0, t - 2);
  replayed = take.events.findIndex(e => e.at >= take.cut + from);
  if (replayed < 0) replayed = take.events.length;
  clock = -1;
  if (from > 0) { step(from, 1 / PREVIEW_RATE); }
  stepTo(t, PREVIEW_RATE);
}

// The preview: the frame at time `t`, at `width` × `height`. Drawn again at
// the same time (paused, a setting changed), it's the same moment: the
// effects' own clocks -- trails, the turning folds, grain -- don't move on.
async function drawAt(t, width, height, jumped = false) {
  if (canvas.width !== width || canvas.height !== height) setRenderSize(width, height, 1, { fit: true });
  await useTitles();
  frameAt(t, jumped);
}

// On to time `t` from the preview's last frame, and drawn. Much of the
// picture has built up over time -- the camera's orbit, the folds' turn,
// the tunnel's depth, the trails -- so it's the moment the preview was
// showing, moved on; not one worked out afresh, which would differ.
//
// A jump -- `jumped`: the studio's playhead was moved; or a step back, or
// far on -- starts the trails afresh and draws the WARM seconds before the
// moment, every step, so they're there as if it had been played into: kept
// from before, each jump left the last place's picture behind, ghost on ghost.
// (Not judged by the step's size alone: a slow frame while playing would
// count, and the extra drawing would make the next one slower again.)
const WARM = 0.75; // seconds drawn up to a moment jumped to
function frameAt(t, jumped = false) {
  const was = clock;
  if (jumped || clock < 0 || t < clock - 0.05 || t > clock + 3) {
    chain.clearTrails();
    seek(Math.max(0, t - WARM));
    render(1 / PREVIEW_RATE);
    while (clock + 1 / PREVIEW_RATE <= t + 1e-9) {
      const before = clock;
      step(clock + 1 / PREVIEW_RATE, 1 / PREVIEW_RATE);
      render(Math.max(0, sceneAt(clock) - sceneAt(before)));
    }
    return;
  }
  stepTo(t, PREVIEW_RATE);
  directNow(clock, 0);
  const moved = clock < was ? 1 / PREVIEW_RATE : sceneAt(clock) - sceneAt(was);
  render(Math.min(0.1, Math.max(0, moved)));
}

// A still: the preview's frame at time `t` (the playhead), drawn again at
// `width` × `height`, as a PNG data URL, without the title cards (a
// picture's words are set on it, see youtube.js). At the playhead nothing
// moves on, so it's the very picture on the screen; the trails come along,
// scaled to the new size (see fx.js), and the preview goes back to its own
// size unchanged. Read in the same task as it's drawn: the buffer is
// cleared once presented.
function still(t, width, height) {
  const kept = settings;
  settings = { ...settings, titles: { ...settings.titles, on: false } };
  try {
    setRenderSize(width, height, 1, { fit: true });
    frameAt(t);
    return canvas.toDataURL('image/png');
  } finally {
    settings = kept;
  }
}

// ── Encoding ──
// Every frame of the video, from the start, into an MP4. `output`: { width,
// height, fps, motionBlur, tags }. `onProgress` hears the fraction done.
async function encode({ width, height, fps = 30, motionBlur = false, tags = {} }, onProgress) {
  const bitrate = videoBitrate(width, height, fps);
  const fullCodecString = avcHigh(width, height, fps, bitrate);
  if (!await canEncodeVideo('avc', { width, height, fullCodecString, quality: new Quality({ bitrate }) })) {
    throw new Error(`This browser can't encode H.264 at ${width}×${height}`);
  }
  // FFmpeg's AAC encoder, as WebAssembly, in every browser: Safari's own ignores
  // the bitrate asked of it (76 kbit/s whatever's asked, measured in 27.2), and
  // Firefox has none. Registered, it's used before the browser's.
  (await import('@mediabunny/aac-encoder')).registerAacEncoder();
  setRenderSize(width, height, 1, { fit: true });
  await useTitles();

  const file = await openFile();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'reserve' }),
    target: new StreamTarget(new WritableStream({ write: c => file.write(c) }), { chunked: true }),
  });
  const frames = Math.round(take.duration * fps);
  const samples = Math.round(take.duration * SAMPLE_RATE);
  const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString, quality: new Quality({ bitrate }), keyFrameInterval: 2, latencyMode: 'quality', onEncodedPacket: describeColour });
  const sound = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE }) });
  output.addVideoTrack(video, { frameRate: fps, maximumPacketCount: frames + 16 });
  output.addAudioTrack(sound, { maximumPacketCount: Math.ceil(samples / 1024) + 64 });
  output.setMetadataTags(tags);
  await output.start();

  // The audio goes to the encoder a second at a time, ahead of the frames, so
  // the file interleaves the two as it's written.
  const [left, right] = encodeAudio;
  let fed = 0;
  const feedAudio = async until => {
    const end = Math.min(samples, Math.round(until * SAMPLE_RATE));
    while (fed < end) {
      const n = Math.min(end - fed, SAMPLE_RATE);
      const part = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
      part.copyToChannel(left.subarray(fed, fed + n), 0);
      part.copyToChannel(right.subarray(fed, fed + n), 1);
      fed += n;
      await sound.add(part);
    }
  };

  // Steps at 60 a second or more, a whole number to a frame (72 at 24 fps);
  // with motion blur, the scene drawn at each of several moments centred on
  // the frame's and averaged.
  const sub = motionBlur ? BLUR_SUBFRAMES : 1;
  const rate = fps * (motionBlur ? sub : Math.ceil(60 / fps));
  seek(0);
  let lastProgress = -1;
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    if (motionBlur) {
      for (let j = 0; j < sub; j++) {
        stepTo(Math.max(0, t + (j - (sub - 1) / 2) / rate), rate);
        chain.sumScene(j, sub);
      }
    } else stepTo(t, rate);
    render(i ? sceneAt(t) - sceneAt(t - 1 / fps) : 1 / fps); // the scene's time, slowed or not
    await unlessStalled(video.add(t, 1 / fps)); // captures the canvas now, before it's presented
    await feedAudio(t + 1 / fps + AUDIO_AHEAD);
    if (i - lastProgress >= 5 || i === frames - 1) {
      lastProgress = i;
      onProgress((i + 1) / frames);
      await yieldToPage(); // the page's own work: the progress, the preview
    }
  }
  await feedAudio(Infinity);
  video.close();
  sound.close();
  await output.finalize();
  return file.finish();
}

// An encoder's promise, or an error if it takes no frame for STALL_MS (see encoding.js).
function unlessStalled(promise) {
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('the video encoder stopped responding. Try Chrome, or a smaller size')), STALL_MS);
  });
  return Promise.race([promise, stalled]).finally(() => clearTimeout(timer));
}
let encodeAudio = null;

window.stage = {
  async load(songPlan, loopSeconds, onProgress) {
    const loaded = await load(songPlan, loopSeconds, onProgress);
    encodeAudio = loaded.channels;
    return loaded;
  },
  configure,
  drawAt,
  still,
  encode,
};

// Back to the event loop for a moment (not a timer: a hidden tab throttles those).
function yieldToPage() {
  return new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

// ─── The file, as it's written ────────────────────────────────────────────────
// The muxer writes the file in order, except that it goes back to fill in
// what it reserved at the start (the index: fastStart 'reserve'), so some
// writes land before the end, over bytes already written.
//
// Written to disk as it's made: a file in the browser's own storage for this
// page (the origin private file system), which a 4K song of several GB needs
// -- held in memory, it could take the tab down. Left there for the download
// to read, and cleared away at the start of the next video. Where there's no
// such storage, held in memory (Sink, below).
// Returns { write({ data, position }), finish() → Blob }.
async function openFile() {
  try {
    const dir = await navigator.storage.getDirectory();
    for await (const name of dir.keys()) {
      if (name.startsWith('video-')) await dir.removeEntry(name).catch(() => {});
    }
    const handle = await dir.getFileHandle(`video-${Date.now()}.mp4`, { create: true });
    const out = await handle.createWritable();
    return {
      // A copy: the muxer may reuse its buffer before the write is done.
      write: ({ data, position }) => out.write({ type: 'write', position, data: data.slice() }),
      finish: async () => { await out.close(); return handle.getFile(); },
    };
  } catch (err) {
    console.warn('No file storage for the video; keeping it in memory:', err);
    const sink = new Sink();
    return { write: c => sink.write(c), finish: async () => sink.blob('video/mp4') };
  }
}

// In memory: a list of chunks, the parts of a Blob, so a long file never needs
// one buffer the size of it.
class Sink {
  chunks = []; // { at, bytes }, in order, back to back
  end = 0;
  write({ data, position }) {
    let bytes = data.slice(); // the muxer may reuse its buffer
    let at = position;
    // Overwrite what's already there...
    for (const c of this.chunks) {
      const from = Math.max(at, c.at), to = Math.min(at + bytes.length, c.at + c.bytes.length);
      if (from < to) c.bytes.set(bytes.subarray(from - at, to - at), from - c.at);
    }
    // ...and append what's past the end (after a gap of zeros, if any).
    if (at + bytes.length <= this.end) return;
    if (at < this.end) { bytes = bytes.subarray(this.end - at); at = this.end; }
    if (at > this.end) this.chunks.push({ at: this.end, bytes: new Uint8Array(at - this.end) });
    this.chunks.push({ at, bytes });
    this.end = at + bytes.length;
  }
  blob(type) { return new Blob(this.chunks.map(c => c.bytes), { type }); }
}
