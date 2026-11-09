import * as THREE from 'three';

// ─── Title cards ──────────────────────────────────────────────────────────────
// Text over the picture, set in Courier Prime as the site is: an opening card
// (the title and what the song is) low on the left, and a closing card in the
// middle. Drawn once into a canvas the size of the video, as a texture the
// finish pass lays over the frame (see fx.js).

const FONT = '"Courier Prime", "Courier New", monospace';

function card(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  const unit = Math.min(width, height) / 1080; // sizes are set for 1080 pixels
  g.fillStyle = '#e4edf6';
  g.shadowColor = 'rgba(0, 0, 0, 0.6)';
  g.shadowBlur = 18 * unit;
  draw(g, unit);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // drawn as display values, laid over display values
  tex.flipY = true;
  return tex;
}

// Letters spaced as the site's labels are.
function spaced(g, text, x, y, px, spacing) {
  g.font = `${px}px ${FONT}`;
  if ('letterSpacing' in g) { g.letterSpacing = `${spacing * px}px`; g.fillText(text, x, y); return; }
  for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + spacing * px; }
}

// `lines`: { title, about } for the opening card; { title, about } for the closing one.
export async function makeTitles(width, height, opening, closing) {
  await document.fonts.load(`40px ${FONT}`).catch(() => {});
  const margin = Math.round(Math.min(width, height) * 0.07);
  const start = card(width, height, (g, u) => {
    g.textBaseline = 'alphabetic';
    if (opening.title) spaced(g, opening.title.toUpperCase(), margin, height - margin - 52 * u, 54 * u, 0.18);
    g.globalAlpha = 0.75;
    if (opening.about) spaced(g, opening.about.toUpperCase(), margin, height - margin, 24 * u, 0.22);
  });
  const end = card(width, height, (g, u) => {
    g.textAlign = 'left';
    const at = (text, px, sp, y) => {
      g.font = `${px}px ${FONT}`;
      if ('letterSpacing' in g) g.letterSpacing = `${sp * px}px`;
      const w = g.measureText(text).width;
      spaced(g, text, (width - w) / 2, y, px, sp);
    };
    if (closing.title) at(closing.title.toUpperCase(), 64 * u, 0.3, height / 2);
    g.globalAlpha = 0.75;
    if (closing.about) at(closing.about, 26 * u, 0.12, height / 2 + 56 * u);
  });
  return { start, end };
}
