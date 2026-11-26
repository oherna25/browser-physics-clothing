// Position-based cloth solver. Pure typed-array code, no rendering imports,
// so it runs unchanged in the browser and in Node (see test/sim.test.mjs).

export const STRUCT = 0;
export const SHEAR = 1;
export const BEND = 2;

// A collider is a list of tapered capsules, 10 floats each:
// ax ay az ar | (b-a)x (b-a)y (b-a)z | (br-ar) | 1/|b-a|^2 | open
// An open capsule is an interior piece of a smooth chain: its ends are not rounded into
// full spheres, so a narrow groove in the chain is not filled in by the joints beside it.
export const STRIDE = 10;
const OPEN_OVERLAP = 0.25; // open pieces extend this fraction past each end, closing the seam

export function packSegs(list) {
  const out = new Float32Array(list.length * STRIDE);
  list.forEach(([a, b, open], k) => {
    const o = k * STRIDE;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    out[o] = a[0]; out[o + 1] = a[1]; out[o + 2] = a[2]; out[o + 3] = a[3];
    out[o + 4] = dx; out[o + 5] = dy; out[o + 6] = dz; out[o + 7] = b[3] - a[3];
    out[o + 8] = 1 / Math.max(dx * dx + dy * dy + dz * dz, 1e-12);
    out[o + 9] = open ? 1 : 0;
  });
  return out;
}

export function concatSegs(...arrays) {
  const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

// Signed distance from a point to one capsule; writes the outward normal to `out`.
// An open capsule ends in a flat cap instead of a sphere: past its overlap the point is
// outside by the axial excess, so the pieces beside it can carve a steep groove.
// A caller that only acts on a distance below `cut` passes it, and a closed capsule that far or further away
// returns Infinity without its root, quotient and normal.
function segDistance(segs, o, x, y, z, out, cut = Infinity) {
  const px = x - segs[o], py = y - segs[o + 1], pz = z - segs[o + 2];
  const dx = segs[o + 4], dy = segs[o + 5], dz = segs[o + 6];
  const raw = (px * dx + py * dy + pz * dz) * segs[o + 8];
  let t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  // Kept out of line: folding the open case into the clamp above doubled the
  // cost of every closed capsule (measured, 2.4 to 4.9 ms per skirt step).
  if (t !== raw && segs[o + 9] !== 0) return openEnd(segs, o, px, py, pz, raw, out);
  const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t;
  const l2 = cx * cx + cy * cy + cz * cz, r = segs[o + 3] + segs[o + 7] * t, lim = r + cut;
  // The margin keeps the squared test from disagreeing with len - r at the boundary, so a capsule nearer than `cut`
  // is measured exactly as without it.
  if (l2 > lim * lim * (1 + 1e-9)) return Infinity;
  const len = Math.sqrt(l2);
  const inv = len > 1e-9 ? 1 / len : 0;
  out.nx = cx * inv; out.ny = cy * inv; out.nz = cz * inv;
  return len - r;
}

// Beyond its overlap an open piece ends in a flat cap, not a sphere, so a
// thick neighbour cannot swell into a groove cut by thinner pieces.
function openEnd(segs, o, px, py, pz, raw, out) {
  const dx = segs[o + 4], dy = segs[o + 5], dz = segs[o + 6];
  const t = raw < 0 ? Math.max(raw, -OPEN_OVERLAP) : Math.min(raw, 1 + OPEN_OVERLAP);
  const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t;
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const d = len - (segs[o + 3] + segs[o + 7] * t);
  const axis = Math.sqrt(dx * dx + dy * dy + dz * dz), ax = Math.abs(raw - t) * axis;
  if (ax > 0 && ax > d) {
    const k = (raw > t ? 1 : -1) / axis;
    out.nx = dx * k; out.ny = dy * k; out.nz = dz * k;
    return ax;
  }
  const inv = len > 1e-9 ? 1 / len : 0;
  out.nx = cx * inv; out.ny = cy * inv; out.nz = cz * inv;
  return d;
}

const tmp = { nx: 0, ny: 0, nz: 0 };

// Distance to the union of all capsules. Result in `out` {d, nx, ny, nz}.
export function nearest(segs, x, y, z, out) {
  let best = Infinity;
  for (let o = 0; o < segs.length; o += STRIDE) {
    const d = segDistance(segs, o, x, y, z, tmp);
    if (d < best) { best = d; out.nx = tmp.nx; out.ny = tmp.ny; out.nz = tmp.nz; }
  }
  out.d = best;
  return out;
}

// Triangles of a ring grid. `pole` closes the last ring with the vertex after the grid, `startPole` closes the
// first ring with the vertex after that.
export function gridIndex(rings, segs, pole, wrap = true, startPole = false) {
  const cols = wrap ? segs : segs + 1;
  const idx = [];
  const id = (i, j) => i * cols + (wrap ? j % segs : j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = id(i, j), b = id(i, j + 1), c = id(i + 1, j), d = id(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  if (pole) {
    const p = rings * cols;
    for (let j = 0; j < segs; j++) idx.push(id(rings - 1, j), id(rings - 1, j + 1), p);
  }
  if (startPole) {
    const p = rings * cols + (pole ? 1 : 0);
    for (let j = 0; j < segs; j++) idx.push(p, id(0, j + 1), id(0, j));
  }
  return new Uint32Array(idx);
}

/**
 * Cloth on a closed tube grid: `rings` x `segs` vertices with wraparound
 * columns (no duplicated seam), plus an optional pole vertex closing the end.
 */
export function makeGridCloth({ pos, rings, segs, pole = false, bend = false, pinRings = [0], pinPole = false, home = null, params }) {
  const n = pos.length / 3;
  const w = new Float32Array(n).fill(1);
  for (const r of pinRings) for (let j = 0; j < segs; j++) w[r * segs + j] = 0;
  if (pole && pinPole) w[n - 1] = 0;

  const ci = [], cj = [], ct = [];
  const id = (i, j) => i * segs + (j % segs);
  const add = (a, b, t) => { ci.push(a); cj.push(b); ct.push(t); };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      add(id(i, j), id(i, j + 1), STRUCT);
      if (i + 1 < rings) {
        add(id(i, j), id(i + 1, j), STRUCT);
        add(id(i, j), id(i + 1, j + 1), SHEAR);
        add(id(i, j + 1), id(i + 1, j), SHEAR);
      }
      if (bend) {
        add(id(i, j), id(i, j + 2), BEND);
        if (i + 2 < rings) add(id(i, j), id(i + 2, j), BEND);
      }
    }
  }
  if (pole) for (let j = 0; j < segs; j++) add(id(rings - 1, j), n - 1, STRUCT);

  const m = ci.length;
  const rest = new Float32Array(m);
  for (let k = 0; k < m; k++) {
    const a = ci[k] * 3, b = cj[k] * 3;
    rest[k] = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
  }

  return {
    n, rings, segs, pos, prev: pos.slice(), initial: pos.slice(), w, home,
    ci: new Uint32Array(ci), cj: new Uint32Array(cj), ct: new Uint8Array(ct), rest,
    index: gridIndex(rings, segs, pole),
    normals: new Float32Array(n * 3),
    stretch: new Float32Array(n).fill(1),
    stretchCount: new Float32Array(n),
    collider: null, cand: null, candStart: null, candR2: 0, fallbacks: 0, short: null,
    grab: null, kin: null, air: null, frame: 0, h: 0,
    params: {
      compliance: [0, 0, 0], // per constraint type, m/N (unit masses)
      homeK: 0,              // tether spring, 1/s^2
      damping: 2,            // velocity decay, 1/s
      gravity: 0,
      thickness: 0.001,
      friction: 0.1,
      inertia: 0,            // share of the anchor's acceleration the cloth resists
      drag: 0,               // quadratic air drag, 1/m: acceleration drag * |v| * v against still air
      ...params,
    },
  };
}

/**
 * Tethered cloth stays near its home pose, so each vertex only needs to test
 * the capsules within `reach` of that pose. A vertex further than `near` from
 * it could touch a capsule left out, so it falls back to testing every capsule.
 * `near` keeps every capsule left out a millimetre beyond the cloth's thickness. A home and a capsule that move
 * relative to each other close on one another, so `slack(i, o)`, the most they can close for vertex i and the
 * capsule at offset o, widens that pair's reach.
 */
export function setCollider(c, segs, reach = 0.02, slack = null) {
  c.collider = segs;
  if (!c.home) {
    // Free cloth has no home to cut lists around, so they are cut each frame around where it is (refreshFree).
    const r = FREE_REACH;
    c.free = { reach: r, n: segs.length / STRIDE };
    c.candAt = new Float32Array(c.n * 3); c.candStart = new Uint32Array(c.n + 1);
    c.cand = new Uint32Array(c.n * c.free.n); c.candR2 = (r - c.params.thickness - 0.001) ** 2;
    c.short = makeShort(c);
    return;
  }
  const near = reach - c.params.thickness - 0.001;
  const start = new Uint32Array(c.n + 1), list = [];
  for (let i = 0; i < c.n; i++) {
    start[i] = list.length;
    for (let o = 0; o < segs.length; o += STRIDE) {
      const d = segDistance(segs, o, c.home[i * 3], c.home[i * 3 + 1], c.home[i * 3 + 2], tmp);
      if (d < reach || (slack !== null && d < reach + slack(i, o))) list.push(o);
    }
  }
  start[c.n] = list.length;
  c.candStart = start; c.cand = new Uint32Array(list); c.candR2 = near * near; c.candAt = c.home;
  c.short = makeShort(c);
}
// A walking skirt's hem moves up to 33 mm in a frame where the knee kicks it (measured), so it reaches further.
const FREE_REACH = 0.04;

// The candidate lists for one frame, cut shorter. A vertex that starts the frame further than the thickness plus
// LIST_MARGIN of a capsule cannot touch it while it stays within LIST_MARGIN of where it started, because the distance
// to a capsule changes by at most `lip` of a move. So each vertex keeps the capsules within that reach, in order, and the
// substeps measure only those; a vertex that has left its margin uses the whole list as before. The collision sees the
// same capsules either way: this changes how many it measures, not which one wins (0.9 ms a frame saved, measured).
const LIST_MARGIN = 0.004;
const usesLists = (c) => c.cand !== null && (!c.free || c.freeOn);
const NO_SHORT = { start: null, cand: null, ok: null, base: null };
const makeShort = (c) => ({ start: new Uint32Array(c.n + 1), cand: new Uint32Array(c.cand.length), ok: new Uint8Array(c.n), base: new Float32Array(c.n * 3) });

function refreshShort(c) {
  const { pos, w, cand, candStart, candAt: at, collider: segs } = c, { start, ok, base } = c.short, list = c.short.cand;
  let lip2 = 1;
  for (let o = 0; o < segs.length; o += STRIDE) {
    const dx = segs[o + 4], dy = segs[o + 5], dz = segs[o + 6], l2 = dx * dx + dy * dy + dz * dz, dr = segs[o + 7];
    lip2 = Math.max(lip2, l2 > 1e-12 ? 1 + dr * dr / l2 : Infinity);
  }
  const reach = c.params.thickness + LIST_MARGIN * Math.sqrt(lip2) * 1.01 + 1e-5;
  // The full list is complete for a vertex within sqrt(candR2) of `at`, so only a vertex that cannot leave that
  // radius within its margin has a shorter list that is complete too.
  const inside = Math.max(Math.sqrt(c.candR2) - LIST_MARGIN, 0) ** 2;
  base.set(pos);
  let k = 0;
  for (let i = 0, o = 0; i < c.n; i++, o += 3) {
    start[i] = k; ok[i] = 0;
    if (w[i] === 0) continue;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2], ex = x - at[o], ey = y - at[o + 1], ez = z - at[o + 2];
    if (ex * ex + ey * ey + ez * ez >= inside) continue;
    ok[i] = 1;
    for (let q = candStart[i], e = candStart[i + 1]; q < e; q++) if (segDistance(segs, cand[q], x, y, z, tmp, reach) < reach) list[k++] = cand[q];
  }
  start[c.n] = k;
}

// Cuts a free cloth's candidate lists around its current positions: one full scan per frame instead of one
// per substep.
function refreshFree(c) {
  const { pos, w, collider: segs, cand, candStart, candAt } = c, reach = c.free.reach;
  candAt.set(pos);
  let k = 0;
  for (let i = 0, o = 0; i < c.n; i++, o += 3) {
    candStart[i] = k;
    if (w[i] === 0) continue;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    for (let s = 0; s < segs.length; s += STRIDE) if (segDistance(segs, s, x, y, z, tmp, reach) < reach) cand[k++] = s;
  }
  candStart[c.n] = k;
}

// Distance from (x, y, z) to the union of vertex i's candidate capsules: the surface its collision sees.
export function candidateDistance(c, i, x, y, z) {
  let best = Infinity;
  for (let q = c.candStart[i], e = c.candStart[i + 1]; q < e; q++) best = Math.min(best, segDistance(c.collider, c.cand[q], x, y, z, tmp));
  return best;
}

export function beginGrab(c, x, y, z, sigma) {
  const idx = [], wt = [], start = [];
  const r2 = 9 * sigma * sigma, k = 1 / (2 * sigma * sigma);
  const p = c.pos;
  for (let i = 0; i < c.n; i++) {
    if (c.w[i] === 0) continue;
    const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    idx.push(i); wt.push(Math.exp(-d2 * k)); start.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }
  if (!idx.length) return false;
  c.grab = { idx: new Uint32Array(idx), wt: new Float32Array(wt), start: new Float32Array(start), dx: 0, dy: 0, dz: 0 };
  return true;
}

export function endGrab(c) { c.grab = null; }

export function resetCloth(c) {
  c.pos.set(c.initial); c.prev.set(c.initial); c.grab = null;
  c.asleep = false; c.stillFrames = 0;
}

function integrate(c, h, air) {
  const { pos, prev, w, home, n } = c;
  const P = c.params;
  const damp = Math.exp(-P.damping * h);
  const h2 = h * h, gy = -P.gravity * h2, k = P.homeK * h2;

  // 1. Verlet integration with tether spring, gravity and quadratic drag against still air. Positions are
  // carried with the body, so a vertex's speed through the air is its own plus its anchor's (air, m per frame).
  const drag = P.drag, toAir = air ? h / c.kin.dt : 0;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    if (w[i] === 0) continue;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    let vx = (x - prev[o]) * damp, vy = (y - prev[o + 1]) * damp, vz = (z - prev[o + 2]) * damp;
    if (drag) {
      const ax = air ? vx + air[o] * toAir : vx, ay = air ? vy + air[o + 1] * toAir : vy, az = air ? vz + air[o + 2] * toAir : vz;
      const f = drag * Math.sqrt(ax * ax + ay * ay + az * az), s = f / (1 + f); // implicit, so it never reverses
      vx -= ax * s; vy -= ay * s; vz -= az * s;
    }
    let nx = x + vx, ny = y + vy + gy, nz = z + vz;
    if (home) { nx -= (x - home[o]) * k; ny -= (y - home[o + 1]) * k; nz -= (z - home[o + 2]) * k; }
    prev[o] = x; prev[o + 1] = y; prev[o + 2] = z;
    pos[o] = nx; pos[o + 1] = ny; pos[o + 2] = nz;
  }

  // 2. Grab: the patch centre follows the pointer exactly, the rim only loosely.
  const g = c.grab;
  if (g) {
    for (let q = 0; q < g.idx.length; q++) {
      const o = g.idx[q] * 3, wt = g.wt[q];
      pos[o] += (g.start[q * 3] + g.dx * wt - pos[o]) * wt;
      pos[o + 1] += (g.start[q * 3 + 1] + g.dy * wt - pos[o + 1]) * wt;
      pos[o + 2] += (g.start[q * 3 + 2] + g.dz * wt - pos[o + 2]) * wt;
    }
  }
}

// 3. Distance constraints (XPBD-style compliance, one Gauss-Seidel pass).
function solve(c, h) {
  const { pos, w, home, ci, cj, ct, rest } = c, P = c.params, h2 = h * h;
  const a0 = P.compliance[0] / h2, a1 = P.compliance[1] / h2, a2 = P.compliance[2] / h2;
  // A tethered knit holds its shape through the tether, so its threads only resist stretch.
  // Resisting compression too leaves no rest state where a pose folds the fabric (behind a knee).
  const slack = home !== null;
  for (let q = 0; q < ci.length; q++) {
    const i = ci[q], j = cj[q], wi = w[i], wj = w[j], ws = wi + wj;
    if (ws === 0) continue;
    const a = i * 3, b = j * 3;
    const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9 || (slack && len < rest[q])) continue;
    const t = ct[q];
    const s = (len - rest[q]) / ((ws + (t === 0 ? a0 : t === 1 ? a1 : a2)) * len);
    pos[a] += dx * s * wi; pos[a + 1] += dy * s * wi; pos[a + 2] += dz * s * wi;
    pos[b] -= dx * s * wj; pos[b + 1] -= dy * s * wj; pos[b + 2] -= dz * s * wj;
  }
}

// The same pass for two cloths. A cloth's constraints are one long chain of updates, each reading what the last wrote,
// so the processor cannot overlap them. Two cloths never touch, so interleaving their passes in one loop lets it work
// on both chains at once, each in its own order (measured: two stockings 0.26 to 0.15 ms a pass). A lone cloth runs
// faster in solve, which this loop slows by a third.
function solvePair(c, h, d, hd) {
  const { pos, w, home, ci, cj, ct, rest } = c, P = c.params, h2 = h * h;
  const a0 = P.compliance[0] / h2, a1 = P.compliance[1] / h2, a2 = P.compliance[2] / h2;
  const { pos: posD, w: wD, home: homeD, ci: ciD, cj: cjD, ct: ctD, rest: restD } = d, PD = d.params, h2D = hd * hd;
  const d0 = PD.compliance[0] / h2D, d1 = PD.compliance[1] / h2D, d2 = PD.compliance[2] / h2D;
  const slack = home !== null, slackD = homeD !== null, n = ci.length, nD = ciD.length;
  for (let q = 0, m = Math.max(n, nD); q < m; q++) {
    if (q < n) {
      const i = ci[q], j = cj[q], wi = w[i], wj = w[j], ws = wi + wj;
      if (ws !== 0) {
        const a = i * 3, b = j * 3;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!(len < 1e-9 || (slack && len < rest[q]))) {
          const t = ct[q];
          const s = (len - rest[q]) / ((ws + (t === 0 ? a0 : t === 1 ? a1 : a2)) * len);
          pos[a] += dx * s * wi; pos[a + 1] += dy * s * wi; pos[a + 2] += dz * s * wi;
          pos[b] -= dx * s * wj; pos[b + 1] -= dy * s * wj; pos[b + 2] -= dz * s * wj;
        }
      }
    }
    if (q < nD) {
      const i = ciD[q], j = cjD[q], wi = wD[i], wj = wD[j], ws = wi + wj;
      if (ws !== 0) {
        const a = i * 3, b = j * 3;
        const dx = posD[b] - posD[a], dy = posD[b + 1] - posD[a + 1], dz = posD[b + 2] - posD[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!(len < 1e-9 || (slackD && len < restD[q]))) {
          const t = ctD[q];
          const s = (len - restD[q]) / ((ws + (t === 0 ? d0 : t === 1 ? d1 : d2)) * len);
          posD[a] += dx * s * wi; posD[a + 1] += dy * s * wi; posD[a + 2] += dz * s * wi;
          posD[b] -= dx * s * wj; posD[b + 1] -= dy * s * wj; posD[b + 2] -= dz * s * wj;
        }
      }
    }
  }
}

function collide(c) {
  const { pos, prev, w, n } = c;
  const P = c.params;
  // 4. Capsule collision: push out along the capsule normal.
  const segs = c.wideFrames > 0 && c.colliderFull ? c.colliderFull : c.collider;
  if (!segs) return;
  const th = P.thickness, keep = 1 - P.friction;
  // Cloths carry different fields, so `c` has several shapes here and a field read through it inside the loops
  // below costs a polymorphic load per capsule (measured: 4 ms a frame across a stocking pair, skirt and shirt).
  const lists = usesLists(c), at = c.candAt, { cand, candStart, candR2, collider } = c;
  const { start: shortStart, cand: shortCand, ok, base } = c.short ?? NO_SHORT, margin2 = LIST_MARGIN * LIST_MARGIN;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    if (w[i] === 0) continue;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    // Only a capsule closer than th pushes, so none further is measured exactly.
    let best = th, bx = 0, by = 0, bz = 0;
    let local = false, close = false;
    if (lists) {
      const ex = x - at[o], ey = y - at[o + 1], ez = z - at[o + 2];
      local = ex * ex + ey * ey + ez * ez < candR2;
      if (ok[i] === 1) { const fx = x - base[o], fy = y - base[o + 1], fz = z - base[o + 2]; close = fx * fx + fy * fy + fz * fz < margin2; }
    }
    if (close) {
      for (let q = shortStart[i], e = shortStart[i + 1]; q < e; q++) {
        const d = segDistance(collider, shortCand[q], x, y, z, tmp, best);
        if (d < best) { best = d; bx = tmp.nx; by = tmp.ny; bz = tmp.nz; }
      }
    } else if (local) {
      for (let q = candStart[i], e = candStart[i + 1]; q < e; q++) {
        const d = segDistance(collider, cand[q], x, y, z, tmp, best); // candidates index the resting collider
        if (d < best) { best = d; bx = tmp.nx; by = tmp.ny; bz = tmp.nz; }
      }
    } else {
      if (lists) c.fallbacks++;
      // A capsule whose height range, grown by its radius and the open pieces' overlap, stays further than best
      // from y is skipped without measuring it.
      for (let s = 0; s < segs.length; s += STRIDE) {
        const ay = segs[s + 1], dy = segs[s + 5], r0 = segs[s + 3], dr = segs[s + 7];
        const room = (dr > 0 ? r0 + dr : r0) + best + (dy < 0 ? -0.25 * dy : 0.25 * dy);
        if (y > (dy > 0 ? ay + dy : ay) + room || y < (dy < 0 ? ay + dy : ay) - room) continue;
        const d = segDistance(segs, s, x, y, z, tmp, best);
        if (d < best) { best = d; bx = tmp.nx; by = tmp.ny; bz = tmp.nz; }
      }
    }
    if (best < th) {
      const push = th - best;
      pos[o] = x + bx * push; pos[o + 1] = y + by * push; pos[o + 2] = z + bz * push;
      prev[o] = pos[o] - (pos[o] - prev[o]) * keep;
      prev[o + 1] = pos[o + 1] - (pos[o + 1] - prev[o + 1]) * keep;
      prev[o + 2] = pos[o + 2] - (pos[o + 2] - prev[o + 2]) * keep;
    }
  }
}

function substep(c, h, air) {
  integrate(c, h, air);
  solve(c, h);
  collide(c);
}

const SLEEP_SPEED = 0.002; // m/s
const SLEEP_FRAMES = 20;
// A held cloth keeps the substeps its pull was tuned with, and so does a cloth without a tether: at 4 a dropped
// masculine skirt hem stays caught inside the body (clearance -54 mm). A tethered cloth is stable with 4.
export const SUBSTEPS = 4, FULL_SUBSTEPS = 6;
const substepsOf = (c) => c.grab || !c.home ? FULL_SUBSTEPS : SUBSTEPS;

// Everything a step does before its substeps. False when the cloth does not step.
function begin(c, dt, substeps) {
  if (!(dt > 1e-5)) return false; // a zero step would divide compliance by zero
  const frame = c.frame++;
  if (c.asleep && !c.grab) return false;
  c.asleep = false;
  // Dragged cloth uses the full collider, and keeps it briefly after release.
  c.wideFrames = c.grab ? 120 : Math.max((c.wideFrames || 0) - 1, 0);
  const h = dt / substeps;
  const { pos, prev, w } = c;
  // Verlet keeps velocity as displacement per substep, so a new substep length rescales it.
  if (c.h && c.h !== h) {
    const r = h / c.h;
    for (let o = 0; o < pos.length; o++) prev[o] = pos[o] - (pos[o] - prev[o]) * r;
  }
  c.h = h;
  // Kinematics written by the pose this frame: the anchor's displacement (d) and its change since the last
  // frame (dd). The cloth resists `inertia` of the anchor's acceleration, as a velocity change before the substeps.
  const K = c.kin && c.kin.frame === frame ? c.kin : null, P = c.params;
  if (K && P.inertia) {
    const s = P.inertia * h / dt, dd = K.dd;
    for (let i = 0, o = 0; i < c.n; i++, o += 3) {
      if (w[i] === 0) continue;
      prev[o] += dd[o] * s; prev[o + 1] += dd[o + 1] * s; prev[o + 2] += dd[o + 2] * s;
    }
  }
  if (K) K.dt = dt;
  c.air = K && P.drag ? K.d : null; // a body not posed this frame stands still in the air
  // A held free cloth scans the full collider, as it always has.
  c.freeOn = !!c.free && c.wideFrames === 0;
  if (c.freeOn) refreshFree(c);
  if (usesLists(c)) refreshShort(c);
  return true;
}

// Still means no vertex drifted more than SLEEP_SPEED would carry it over the window. Measured per frame or per
// substep, a hem vertex resting on a capsule that pops 0.07 mm every fifth frame and returns kept a skirt awake
// for good.
function settle(c, dt) {
  const { pos, prev } = c;
  const ref = (c.ref ??= new Float32Array(pos.length)), limit = (SLEEP_SPEED * SLEEP_FRAMES * dt) ** 2;
  let still = !c.grab && c.stillFrames > 0;
  for (let o = 0; still && o < pos.length; o += 3) {
    const dx = pos[o] - ref[o], dy = pos[o + 1] - ref[o + 1], dz = pos[o + 2] - ref[o + 2];
    if (dx * dx + dy * dy + dz * dz > limit) still = false;
  }
  if (!still) ref.set(pos);
  c.stillFrames = c.grab ? 0 : still ? c.stillFrames + 1 : 1;
  if (c.stillFrames >= SLEEP_FRAMES) { c.asleep = true; c.stillFrames = 0; prev.set(pos); }
}

/**
 * Advance one frame. Returns false when nothing moved: a cloth that has been
 * still for a while goes to sleep and costs nothing until it is grabbed.
 */
export function stepCloth(c, dt, substeps = substepsOf(c)) {
  if (!begin(c, dt, substeps)) return false;
  for (let s = 0; s < substeps; s++) substep(c, c.h, c.air);
  settle(c, dt);
  return true;
}

/**
 * Advances two cloths a frame, each as stepCloth would alone, with their constraint passes interleaved. Returns a bit
 * for each that stepped: 1 for a, 2 for b.
 */
export function stepCloths(a, b, dt) {
  const na = substepsOf(a), nb = substepsOf(b), ra = begin(a, dt, na), rb = begin(b, dt, nb);
  const sa = ra ? na : 0, sb = rb ? nb : 0, both = Math.min(sa, sb);
  for (let s = 0; s < both; s++) {
    integrate(a, a.h, a.air); integrate(b, b.h, b.air);
    solvePair(a, a.h, b, b.h);
    collide(a); collide(b);
  }
  for (let s = both; s < sa; s++) substep(a, a.h, a.air);
  for (let s = both; s < sb; s++) substep(b, b.h, b.air);
  if (ra) settle(a, dt);
  if (rb) settle(b, dt);
  return (ra ? 1 : 0) | (rb ? 2 : 0);
}

export function wake(c) { c.asleep = false; c.stillFrames = 0; }

// Math.hypot(x, y, z) with V8's algorithm, so the same bits: the builtin's call and argument array cost 0.9 ms a frame
// across the skin's normals.
function hypot3(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const max = ax > ay ? (ax > az ? ax : az) : (ay > az ? ay : az);
  if (max === 0) return 0;
  let n = ax / max, sum = n * n, comp = 0, s, p;
  n = ay / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  n = az / max; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  return Math.sqrt(sum) * max;
}

// Per-vertex mean of (edge length / rest length) over structural edges.
export function computeStretch(c) {
  const { pos, ci, cj, ct, rest, stretch, stretchCount } = c;
  stretch.fill(0); stretchCount.fill(0);
  for (let q = 0; q < ci.length; q++) {
    if (ct[q] !== STRUCT || rest[q] < 1e-6) continue;
    const a = ci[q] * 3, b = cj[q] * 3;
    const r = hypot3(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]) / rest[q];
    stretch[ci[q]] += r; stretch[cj[q]] += r; stretchCount[ci[q]]++; stretchCount[cj[q]]++;
  }
  for (let i = 0; i < c.n; i++) stretch[i] = stretchCount[i] ? stretch[i] / stretchCount[i] : 1;
}

export function computeNormals(pos, index, out) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let o = 0; o < out.length; o += 3) {
    const l = hypot3(out[o], out[o + 1], out[o + 2]) || 1;
    out[o] /= l; out[o + 1] /= l; out[o + 2] /= l;
  }
}
