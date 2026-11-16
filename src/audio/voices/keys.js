import { state, beat, rand, pick, register, random } from '../../state.js';
import { createVoice } from '../transport.js';
import { logNote } from '../notes.js';
import { harmony } from '../harmony.js';
import { barBeats, barIndex, inBar, foldHits } from '../meter.js';
import { GENRE_COMPS, COMPS_FOR } from './rhodes.js';

// ─── Comping keyboards ────────────────────────────────────────────────────────
// A keyboard that comps: chords in the genre's rhythm (the electric piano's comps, see
// rhodes.js, or its own where `compsFor` says so), voice-led from one to the next, a
// hit within an eighth of a chord change playing the chord that's coming. The piano
// and the FM electric piano are each this with a sound of their own: `chord(t, notes,
// seconds, velocity)` plays one.
//   full  -- the chord's own notes, root and all, as a pianist's two hands have them;
//            without it, the rootless voicing of the electric piano (3-5-7 and a ninth
//            where the tune agrees)
export function createKeys(name, { chord, centre = 60, compsFor = {}, fallback = 'jazz', full = true }) {
  const family = () => compsFor[state.language] ?? COMPS_FOR[state.language] ?? fallback;
  const comps = () => GENRE_COMPS[family()];
  let comp = null, compFor = null, curBar = -1, prev = null;

  function strike(t, b, lenBeats) {
    const cur = harmony.at(b);
    const seg = b + 0.5 >= cur.end - 1e-6 ? harmony.at(cur.end) : cur;
    let pcs;
    if (full) {
      pcs = typeof seg.degree === 'object' ? harmony.voiced(seg) : harmony.pcs(seg.degree, 3);
    } else {
      const own = typeof seg.degree === 'object' ? harmony.voiced(seg) : harmony.pcs(seg.degree, 4);
      const [root, , , , ninth] = harmony.pcs(seg.degree, 5);
      pcs = harmony.pcs(seg.degree, 4).slice(1).filter(pc => own.includes(pc) || harmony.fits(pc, seg));
      if ((ninth - root + 12) % 12 !== 1 && harmony.fits(ninth, seg)) pcs.push(ninth);
      if (pcs.length < 3) pcs = own;
    }
    const v = harmony.voice(pcs, prev, register(centre, 28, centre + 17), { name, from: b, to: b + lenBeats });
    prev = v;
    const seconds = lenBeats * beat();
    for (const m of v) logNote(name, t, m, seconds, 0.75);
    chord(t, v, seconds, rand(0.62, 0.95));
  }

  function play(t, b) {
    const B = barBeats(), bar = barIndex(b, 1e-9), pos = inBar(b, 1e-9);
    if (bar !== curBar) {
      curBar = bar;
      if (bar % 4 === 0 && random() < 0.4) comp = pick(comps());
    }
    if (!comp || compFor !== state.language) { comp = pick(comps()); compFor = state.language; }
    const hits = foldHits(comp);
    const hit = hits.find(([p]) => Math.abs(p - pos) < 1e-6);
    if (hit) strike(t, b, hit[1]);
    const next = hits.find(([p]) => p > pos + 1e-6);
    return (next ? next[0] : B) - pos;
  }

  return createVoice(name, play, {
    entry: 'bar', role: 'motion',
    onReset: () => { curBar = -1; prev = null; comp = pick(comps()); compFor = state.language; },
  });
}
