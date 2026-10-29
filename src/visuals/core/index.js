import { scene } from '../scene.js';
import { music } from '../music.js';
import { transport } from '../../audio/transport.js';
import { cages } from '../cages.js';
import { attractor } from './attractor.js';

// ─── The centre ───────────────────────────────────────────────────────────────
// The cages, with the attractor inside them as a flowing core: at about 60% of
// its size, and dimmed to a third -- the cages and the flow are both additive
// light, and stacked at full strength they burn out to white. The attractor
// takes the inner cages' shape (see core/attractor.js), so the two move as
// one body.
const SCALE = 0.62, GAIN = 0.3;

scene.add(cages.group, attractor.group);
attractor.group.scale.setScalar(SCALE);

export function updateCore(ctx) {
  const beat = music.now > 0 ? transport.beatAt(music.now) : ctx.t * 1.5;
  cages.update({ ...ctx, beat, alpha: 1 });                       // first: the attractor reads its surface
  attractor.update({ ...ctx, beat, alpha: GAIN, within: 1 });
}
