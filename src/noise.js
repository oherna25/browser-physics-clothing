// Tileable 3D gradient noise for the skin, baked once so the shader reads it with one texture fetch per octave.
// The lattice hash and the quintic fade match the gradient noise the skin shader used to evaluate per pixel; the
// lattice wraps every `period` cells, so the volume tiles.

// One integer hash per lattice point, its bits split into a gradient in [-1, 1].
function lattice(x, y, z, out) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  out[0] = (h & 2047) / 1023.5 - 1; out[1] = ((h >>> 11) & 2047) / 1023.5 - 1; out[2] = ((h >>> 22) & 1023) / 511.5 - 1;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const dfade = (t) => 30 * t * t * (t * (t - 2) + 1);

/** Gradient noise at (x, y, z) in cells, wrapped every `period` cells: [value, d/dx, d/dy, d/dz]. */
export function noiseAt(x, y, z, period, out = new Float64Array(4)) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = [fade(fx), fade(fy), fade(fz)], du = [dfade(fx), dfade(fy), dfade(fz)];
  const g = [], v = [], wrap = (i) => ((i % period) + period) % period;
  for (let c = 0; c < 8; c++) {
    const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1, gc = new Float64Array(3);
    lattice(wrap(ix + ox), wrap(iy + oy), wrap(iz + oz), gc);
    g.push(gc);
    v.push(gc[0] * (fx - ox) + gc[1] * (fy - oy) + gc[2] * (fz - oz));
  }
  // Trilinear blend of the corner ramps by the faded fractions, and its derivative by the product rule.
  out.fill(0);
  for (let c = 0; c < 8; c++) {
    const w = [c & 1 ? u[0] : 1 - u[0], (c >> 1) & 1 ? u[1] : 1 - u[1], (c >> 2) & 1 ? u[2] : 1 - u[2]];
    const s = [c & 1 ? 1 : -1, (c >> 1) & 1 ? 1 : -1, (c >> 2) & 1 ? 1 : -1], wxyz = w[0] * w[1] * w[2];
    out[0] += wxyz * v[c];
    for (let a = 0; a < 3; a++) {
      const others = w[(a + 1) % 3] * w[(a + 2) % 3];
      out[a + 1] += wxyz * g[c][a] + s[a] * du[a] * others * v[c];
    }
  }
  return out;
}

/**
 * The noise over one period, `per` texels to a cell, each texel at its centre so linear filtering with repeat
 * wrapping reads the field at period-relative coordinates. RGBA per texel: value, then the gradient in cell units.
 */
export function noiseVolume(period, per) {
  const size = period * per, data = new Float32Array(size * size * size * 4), s = new Float64Array(4);
  for (let k = 0, o = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++, o += 4) {
    noiseAt((i + 0.5) / per, (j + 0.5) / per, (k + 0.5) / per, period, s);
    data[o] = s[0]; data[o + 1] = s[1]; data[o + 2] = s[2]; data[o + 3] = s[3];
  }
  return { data, size };
}
