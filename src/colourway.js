import * as THREE from 'three';

// A colourway is { pattern: 'solid' | 'stripes' | 'block' | 'ombre', colors: [hex, ...], count? }.
// Stocking entries that predate the shape carry a single `color` and read as solid.
// Everything is laid out top to bottom along the garment's v axis (v = 0 at the top ring).
const norm = (e) => ({ pattern: e.pattern ?? 'solid', colors: e.colors ?? [e.color], count: e.count ?? e.colors?.length ?? 1 });

// Flat bands as fractions of the height. Stripes cycle through the colours `count` times, a block
// gives each colour one band.
function bands(e) {
  const { pattern, colors, count } = norm(e);
  const n = pattern === 'solid' ? 1 : pattern === 'block' ? colors.length : count;
  return Array.from({ length: n }, (_, k) => ({ from: k / n, to: (k + 1) / n, color: colors[k % colors.length] }));
}

const ombreStops = (colors) => colors.map((color, k) => ({ at: colors.length > 1 ? k / (colors.length - 1) : 0, color }));

export function paintColourway(ctx, w, h, entry) {
  if (norm(entry).pattern === 'ombre') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const s of ombreStops(norm(entry).colors)) g.addColorStop(s.at, s.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  for (const b of bands(entry)) {
    ctx.fillStyle = b.color;
    const y0 = Math.round(b.from * h), y1 = Math.round(b.to * h);
    ctx.fillRect(0, y0, w, y1 - y0);
  }
}

// The swatch background for the same entry the canvas is painted from.
export function colourCss(entry) {
  const { pattern, colors } = norm(entry);
  if (pattern === 'solid') return colors[0];
  const pct = (f) => `${+(f * 100).toFixed(3)}%`;
  const stops = pattern === 'ombre'
    ? ombreStops(colors).map((s) => `${s.color} ${pct(s.at)}`)
    : bands(entry).map((b) => `${b.color} ${pct(b.from)} ${pct(b.to)}`);
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

// flipY is off so the canvas top is v = 0, the top ring of the garment.
export function patternTexture(w = 8, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function repaint(tex, entry) {
  const c = tex.image;
  paintColourway(c.getContext('2d'), c.width, c.height, entry);
  tex.needsUpdate = true;
}
