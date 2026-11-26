// Headless check of the solver: grab, pull hard, flick, release.
// Run with: npm test

import assert from 'node:assert/strict';
import { buildBody, buildTorso, buildHead, buildChokerRest, buildShirtRest, buildSkirt, sweepLimb, ringRadii, SKIRT_OFFSET } from '../src/body.js';
import { BODIES, BUILD, DEFAULTS, POSE, MOTIONS, SHIRT, SHIRT_STYLES, SHIRT_COLORS, CHOKER, CHOKER_STYLES, CHOKER_COLORS, STOCKING_COLORS } from '../src/presets.js';
import { makeStocking, makeSkirt, makeShirt, legSkin, toeSkins, STOCKING_BAND, SKIRT_THICKNESS } from '../src/garments.js';
import { colourCss } from '../src/colourway.js';
import { stepCloth, beginGrab, endGrab, computeStretch, nearest, resetCloth, concatSegs, gridIndex, computeNormals, STRIDE } from '../src/cloth.js';
import { makeRig, track, applyPose, stepSoft, makePose, blendPose, feetOf, STAND, ROOT, BLEND } from '../src/pose.js';
import { buildMotions, motionPose, makeDriver, want, drive, restart } from '../src/motion.js';

const DT = 1 / 60;
const hit = {};

function report(c, segs) {
  let nan = 0, maxHome = 0, minDist = Infinity, maxStretch = 0;
  computeStretch(c);
  for (let i = 0; i < c.n; i++) {
    const x = c.pos[i * 3], y = c.pos[i * 3 + 1], z = c.pos[i * 3 + 2];
    if (!Number.isFinite(x + y + z)) { nan++; continue; }
    if (c.home) maxHome = Math.max(maxHome, Math.hypot(x - c.home[i * 3], y - c.home[i * 3 + 1], z - c.home[i * 3 + 2]));
    if (c.w[i] > 0) minDist = Math.min(minDist, nearest(segs, x, y, z, hit).d);
    maxStretch = Math.max(maxStretch, c.stretch[i]);
  }
  return { nan, maxHome, minDist, maxStretch };
}
const fmt = (r) => `home ${(r.maxHome * 1000).toFixed(2)}mm  clearance ${(r.minDist * 1000).toFixed(2)}mm  stretch x${r.maxStretch.toFixed(2)}`;
const run = (c, frames, each) => { for (let f = 0; f < frames; f++) { each?.(f); stepCloth(c, DT); } };

// Captured from buildBody before the thigh and glute modifiers existed: [length, sum, index-weighted sum]. Feet
// re-captured when they gained toes.
const UNMODIFIED = { feminine: [1422, 1032534.1210122162, 59132722.723137364], masculine: [1422, 608369.9884688768, 33586684.166439496] };
// Slots 0..8 of every segment, flattened as when a segment was 9 floats; slot 9 is the open flag.
const legacySlots = (a) => {
  const out = [];
  for (let o = 0; o < a.length; o += STRIDE) for (let k = 0; k < 9; k++) out.push(a[o + k]);
  return out;
};
const LEGACY_CAPSULES = 158; // legs and waist as they were before the torso grew; later capsules are appended
const checksum = (a) => { let s = 0, w = 0; a.forEach((v, i) => { s += v; w += v * ((i % 97) + 1); }); return [a.length, s, w]; };

// Bodies are built once per shape and build; the pose section reuses the garments the earlier sections settled.
const bodies = new Map(), garments = new Map();
const bodyOf = (shape, thigh, glute, chest = DEFAULTS.chest) => {
  const key = `${shape.label} ${thigh} ${glute} ${chest}`;
  if (!bodies.has(key)) bodies.set(key, buildBody(shape, { thigh, glute, chest }, STOCKING_BAND));
  return bodies.get(key);
};
const keep = (body, part) => { if (!garments.has(body)) garments.set(body, {}); Object.assign(garments.get(body), part); };

const squeezeOk = [];
const MODS = [[0, 0], [0.5, 0.5], [1, 1]];
const mm = (v) => (v * 1000).toFixed(2);
const at = (p, i) => `y ${p[i + 1].toFixed(3)} z ${p[i + 2].toFixed(3)}`;

for (const [id, shape] of Object.entries(BODIES)) {
  const unmodified = buildBody(shape).segs.subarray(0, LEGACY_CAPSULES * STRIDE);
  const want = UNMODIFIED[id], got = checksum(legacySlots(unmodified));
  for (let o = 9; o < unmodified.length; o += STRIDE) assert.equal(unmodified[o], 0, `${id}: open flag set on the unmodified body`);
  assert.equal(got[0], want[0]);
  assert.ok(Math.abs(got[1] / want[1] - 1) < 1e-9 && Math.abs(got[2] / want[2] - 1) < 1e-9, `${id}: unmodified body changed`);

  // Skin radius about the centreline at the middle of the band and 12 mm above its top edge.
  const squeezeDepth = (thigh) => {
    const leg = bodyOf(shape, thigh, 0).legs[1];
    const at = (y) => {
      const s = leg.sAtY(y), g = sweepLimb(leg, s, s, 2, 48, 0, 0);
      return ringRadii(leg, g, s, s, 2)[0];
    };
    const inBand = at(STOCKING_BAND.y - STOCKING_BAND.width / 2), above = at(STOCKING_BAND.y + 0.012);
    return { inBand, above, d: above - inBand };
  };
  const depth = [0, 0.5, 1].map(squeezeDepth);
  console.log(`\n${id} above - in band (mm) at thigh 0/0.5/1: ${depth.map((q) => `${mm(q.d)} (${mm(q.above)} - ${mm(q.inBand)})`).join('  ')}`);
  // The groove is real: mid-band skin sits well below the leg just above and below the band.
  {
    const leg = bodyOf(shape, 1, 0).legs[1];
    const at = (y) => {
      const s = leg.sAtY(y), g = sweepLimb(leg, s, s, 2, 48, 0, 0);
      return ringRadii(leg, g, s, s, 2)[0];
    };
    const mid = at(STOCKING_BAND.y - STOCKING_BAND.width / 2);
    const ref = (at(STOCKING_BAND.y + 0.04) + at(STOCKING_BAND.y - STOCKING_BAND.width - 0.02)) / 2;
    console.log(`${id} groove depth at thigh 1: ${mm(ref - mid)} mm (mid-band ${mm(mid)}, reference ${mm(ref)})`);
    assert.ok(ref - mid >= 0.005, `${id}: groove under the band is shallower than 5 mm`);
  }

  // No holes in the open zone. Column neighbours must agree within 4 mm. Along the leg the groove
  // walls are legitimately steep (the jump between rings is reported), so a ring may not stick out of,
  // or dip below, the range of its two ring neighbours by 4 mm or more.
  {
    const Q = BUILD.squeeze, rings = 110, nseg = 48;
    const leg = bodyOf(shape, 1, 0).legs[1];
    const g = sweepLimb(leg, 0, leg.length, rings, nseg, 0, 5);
    const rad = new Float32Array(g.rings * nseg);
    for (let i = 0; i < g.rings; i++) {
      const c = leg.atS(i >= rings ? leg.length : leg.length * i / (rings - 1));
      for (let j = 0; j < nseg; j++) {
        const o = (i * nseg + j) * 3;
        rad[i * nseg + j] = Math.hypot(g.pos[o] - c.x, g.pos[o + 1] - c.y, g.pos[o + 2] - c.z);
      }
    }
    let col = 0, jump = 0, spike = 0, checked = 0;
    for (let i = 1; i < rings - 1; i++) for (let j = 0; j < nseg; j++) {
      const y = g.pos[(i * nseg + j) * 3 + 1];
      if (y < STOCKING_BAND.y - Q.below || y > STOCKING_BAND.y + Q.above) continue;
      const r = rad[i * nseg + j], up = rad[(i - 1) * nseg + j], dn = rad[(i + 1) * nseg + j];
      col = Math.max(col, Math.abs(r - rad[i * nseg + (j + 1) % nseg]), Math.abs(r - rad[i * nseg + (j + nseg - 1) % nseg]));
      jump = Math.max(jump, Math.abs(r - up), Math.abs(r - dn));
      spike = Math.max(spike, r - Math.max(up, dn), Math.min(up, dn) - r);
      checked++;
    }
    console.log(`${id} open zone at thigh 1, ${checked} vertices: column jump ${mm(col)} mm, ring jump ${mm(jump)} mm, ring spike ${mm(spike)} mm`);
    assert.ok(checked > 0 && col < 0.004 && spike < 0.004, `${id}: holes in the skin surface`);
  }

  squeezeOk.push([id, depth[0].d > 0 && depth[1].d > depth[0].d && depth[2].d > depth[1].d]);

  let preMax = [];
  for (const thigh of [0, 0.5, 1]) {
    const body = bodyOf(shape, thigh, thigh);
    const [a, b] = body.legs;
    for (const [leg, other] of [[a, b], [b, a]]) {
      const g = sweepLimb(leg, 0, leg.length, 110, 48, 0, 5);
      let gap = Infinity;
      for (let i = 0; i < g.pos.length; i += 3) gap = Math.min(gap, nearest(other.segs, g.pos[i], g.pos[i + 1], g.pos[i + 2], hit).d);
      assert.ok(gap > 0, `legs interpenetrate at thigh ${thigh}`);
    }
    const pre = makeStocking(body, body.legs[1]).preStretch;
    preMax.push(pre.reduce((m, v) => Math.max(m, v), 0));
  }
  console.log(`${id} preStretch max at thigh 0/0.5/1: ${preMax.map((v) => v.toFixed(3)).join(' ')}`);
  assert.ok(preMax[0] < 1.02 && preMax[1] > preMax[0] && preMax[2] > preMax[1], 'preStretch does not grow with thigh');
}

// --- Torso skin ---
// Front and back z of the capsule union at (x, y): scan in from outside, then bisect.
const surfaceZ = (segs, x, y, sign) => {
  let z = 0.25;
  while (z > 0 && nearest(segs, x, y, sign * z, hit).d >= 0) z -= 0.0005;
  let lo = z, hi = z + 0.0005;
  for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (nearest(segs, x, y, sign * mid, hit).d < 0) lo = mid; else hi = mid; }
  return lo;
};
// The breasts make a cleft between them over this span, which covers every chest size.
const CLEFT = { feminine: [1.15, 1.36] };

for (const [id, shape] of Object.entries(BODIES)) {
  const body = buildBody(shape);
  const legacy = body.segs.subarray(0, LEGACY_CAPSULES * STRIDE), segs = body.base.segs;

  // The torso rows reach down to the waist but must leave the legs and crotch as they were.
  let moved = 0;
  for (let y = 0.02; y <= 0.8401; y += 0.02) for (let x = -0.3; x <= 0.3001; x += 0.02) for (let z = -0.2; z <= 0.25; z += 0.02) {
    const was = nearest(legacy, x, y, z, hit).d;
    if (was >= 0) moved = Math.max(moved, Math.abs(nearest(segs, x, y, z, hit).d - was));
  }
  console.log(`\n${id} surface change at y <= 0.84: ${moved.toExponential(1)} m`);
  assert.ok(moved < 1e-6, `${id}: torso changed the legs at or below y 0.84`);

  const g = buildTorso(body);
  const { segs: nseg, pos } = g, P = (i, j) => (i * nseg + ((j % nseg) + nseg) % nseg) * 3;
  const first = 1, last = g.rings - 1; // row 0 is the degenerate cap, the pole follows the last row
  const top = body.trunk.top;

  // Below y 1.10 the skin follows the legacy waist capsules, whose groove between them is a crease
  // that was there before the torso grew, so smoothness and symmetry are asserted from y 1.10 up.
  const FROM = 1.0;
  let off = 0, edge = 0, spike = 0, asym = 0, topErr = 0, legacySpike = 0;
  const n = {};
  for (let i = first; i <= last; i++) for (let j = 0; j < nseg; j++) {
    const o = P(i, j), x = pos[o], y = pos[o + 1], z = pos[o + 2];
    off = Math.max(off, Math.abs(nearest(segs, x, y, z, n).d));
    if (i === first) topErr = Math.max(topErr, Math.abs(y - top));
    const e = P(i, j + 1), m = P(i, nseg / 2 - j); // m: mirror image across x = 0
    const len = Math.hypot(pos[e] - x, pos[e + 1] - y, pos[e + 2] - z);
    const up = i < last ? P(i + 1, j) : o;
    // Distance of a vertex from the chord of its neighbours along the surface normal: a hole or spike shows as a large value.
    let dev = 0;
    if (i > first && i < last) for (const [a, b] of [[P(i - 1, j), up], [P(i, j - 1), e]]) {
      dev = Math.max(dev, Math.abs((x - (pos[a] + pos[b]) / 2) * n.nx + (y - (pos[a + 1] + pos[b + 1]) / 2) * n.ny + (z - (pos[a + 2] + pos[b + 2]) / 2) * n.nz));
    }
    if (y < FROM) { legacySpike = Math.max(legacySpike, dev); continue; }
    spike = Math.max(spike, dev);
    asym = Math.max(asym, Math.hypot(x + pos[m], y - pos[m + 1], z - pos[m + 2]));
    edge = Math.max(edge, len, Math.hypot(pos[up] - x, pos[up + 1] - y, pos[up + 2] - z));
  }
  console.log(`${id} torso skin ${g.rings} x ${nseg}: off surface ${mm(off)} mm, longest edge ${mm(edge)} mm, neighbour-chord deviation ${mm(spike)} mm (${mm(legacySpike)} mm below y ${FROM}), asymmetry ${mm(asym)} mm, cut at ${top} (height error ${mm(topErr)} mm)`);
  // A smooth surface leaves the chord of its neighbours by at most h^2 / 8R, under 1 mm here. The concave
  // crease where the neck meets the shoulders is a real edge of the capsule union worth about 4 mm, and a
  // hole or a spike is a centimetre or more. A torn ring has an edge several times the 2 cm to 2.5 cm ring pitch.
  assert.ok(off < 0.0015, `${id}: torso skin strays from the capsule surface`);
  assert.ok(asym < 1e-4, `${id}: torso skin is not left-right symmetric`);
  assert.ok(edge < 0.03 && spike < 0.006, `${id}: holes or spikes in the torso skin`);
  assert.ok(top > 1.52 && top < 1.56 && topErr < 1e-3, `${id}: neck is not cut flat near y 1.54`);

  // A stack of horizontal capsules leaves no groove down the middle of the chest and back.
  let groove = 0, where = 0;
  const [c0, c1] = CLEFT[id] ?? [];
  for (let y = 1.10; y <= 1.4001; y += 0.01) {
    if (y >= c0 && y <= c1) continue;
    for (const sign of [1, -1]) {
      let widest = 0;
      for (let x = -0.06; x <= 0.0601; x += 0.005) widest = Math.max(widest, surfaceZ(segs, x, y, sign));
      const d = widest - surfaceZ(segs, 0, y, sign);
      if (d > groove) { groove = d; where = y; }
    }
  }
  console.log(`${id} deepest centre groove ${mm(groove)} mm at y ${where.toFixed(2)}${c0 ? ` (skipping y ${c0} to ${c1})` : ''}`);
  assert.ok(groove < 0.001, `${id}: centre groove deeper than 1 mm`);

  // The sliders reshape the hips only; the torso skin must still build and sit on the surface.
  {
    const fat = bodyOf(shape, 1, 1), gf = buildTorso(fat);
    let worst = 0;
    for (let o = nseg * 3; o < gf.pos.length - 3; o += 3) worst = Math.max(worst, Math.abs(nearest(fat.base.segs, gf.pos[o], gf.pos[o + 1], gf.pos[o + 2], hit).d));
    console.log(`${id} torso skin at thigh 1, glute 1: off surface ${mm(worst)} mm`);
    assert.ok(worst < 0.0015, `${id}: torso skin strays from the surface at thigh 1, glute 1`);
  }

  let neck = 0;
  for (let z = -0.02; z <= 0.04; z += 0.002) for (let x = 0; x <= 0.1; x += 0.0005) if (nearest(segs, x, 1.48, z, hit).d < 0) neck = Math.max(neck, x);
  console.log(`${id} neck radius at y 1.48: ${mm(neck)} mm`);
  assert.ok(neck > 0.045 && neck < 0.065, `${id}: neck radius outside 4.5 to 6.5 cm`);
}

// --- Arms and head ---
// The mesh sizes main.js draws: rings, segments, end cap rings, start cap rings.
const ARM_MESH = [150, 40, 6, 6];
const armSkin = (arm) => sweepLimb(arm, 0, arm.length, ARM_MESH[0], ARM_MESH[1], 0, ARM_MESH[2], ARM_MESH[3]);
const ringAt = (g, i, j) => (i * g.segs + ((j % g.segs) + g.segs) % g.segs) * 3;
// Off-surface error, longest edge and neighbour-chord deviation of a ring grid, as for the torso skin.
function gridQuality(g, segs) {
  let off = 0, edge = 0, spike = 0;
  for (let i = 0; i < g.rings; i++) for (let j = 0; j < g.segs; j++) {
    const o = ringAt(g, i, j), p = g.pos, x = p[o], y = p[o + 1], z = p[o + 2];
    off = Math.max(off, Math.abs(nearest(segs, x, y, z, hit).d));
    const e = ringAt(g, i, j + 1);
    edge = Math.max(edge, Math.hypot(p[e] - x, p[e + 1] - y, p[e + 2] - z));
    if (i + 1 < g.rings) { const u = ringAt(g, i + 1, j); edge = Math.max(edge, Math.hypot(p[u] - x, p[u + 1] - y, p[u + 2] - z)); }
    if (i === 0 || i === g.rings - 1) continue;
    for (const [a, b] of [[ringAt(g, i - 1, j), ringAt(g, i + 1, j)], [ringAt(g, i, j - 1), e]]) {
      spike = Math.max(spike, Math.abs((x - (p[a] + p[b]) / 2) * hit.nx + (y - (p[a + 1] + p[b + 1]) / 2) * hit.ny + (z - (p[a + 2] + p[b + 2]) / 2) * hit.nz));
    }
  }
  return { off, edge, spike };
}
// Triangles whose winding faces into the union: an inside-out mesh lights black.
function inward(pos, index, segs) {
  let n = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-10) continue;
    nearest(segs, (pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3, hit);
    if (nx * hit.nx + ny * hit.ny + nz * hit.nz < 0) n++;
  }
  return n;
}
// --- Chest ---
// Captured from the masculine body before it gained a build slider for the chest: segments, torso skin and two shirts' rest shapes.
const MASCULINE = { segs: [5060, 7157802.317767003, 331450915.2203044], torso: [18627, 7370.717243687914, 360944.43242050096], tank: [7680, 3116.428964460767, 152514.54777717707], tube: [3264, 1343.579700960152, 65313.26069611008] };
{
  const shape = BODIES.feminine, bare = buildBody({ ...shape, chest: undefined });
  // Front (+z) of the union at (x, y): bisect in from outside.
  const front = (segs, x, y) => { let lo = 0, hi = 0.3; for (let it = 0; it < 16; it++) { const m = (lo + hi) / 2; if (nearest(segs, x, y, m, hit).d < 0) lo = m; else hi = m; } return lo; };
  const ys = Array.from({ length: 51 }, (_, i) => 1.10 + i * 0.006), rib = ys.map((y) => front(bare.torsoSegs, 0, y)), ribAt = (y) => front(bare.torsoSegs, 0, y);
  const peak = (body) => {
    let best = { p: -Infinity };
    ys.forEach((y, i) => { for (let x = 0.01; x <= 0.12; x += 0.01) { const p = front(body.torsoSegs, x, y) - rib[i]; if (p > best.p) best = { p, x, y }; } });
    return best;
  };
  const SIZES = [0, 0.25, DEFAULTS.chest, 0.75, 1];
  const found = SIZES.map((size) => ({ size, body: bodyOf(shape, 0, 0, size) })).map((e) => ({ ...e, ...peak(e.body) }));
  console.log(`\nchest projection in front of the ribcage (mm) at ${SIZES.join(' / ')}: ${found.map((e) => mm(e.p)).join(' / ')}`);
  for (let k = 1; k < found.length; k++) assert.ok(found[k].p > found[k - 1].p + 0.003, `chest projection does not rise from ${SIZES[k - 1]} to ${SIZES[k]}`);
  const at = (size) => found.find((e) => e.size === size);
  assert.ok(at(0).p > 0.004 && at(0).p < 0.0065, `chest 0 projection ${mm(at(0).p)} mm outside 4 to 6.5 mm`);
  assert.ok(at(DEFAULTS.chest).p > 0.04 && at(DEFAULTS.chest).p < 0.05, `default chest projection ${mm(at(DEFAULTS.chest).p)} mm outside 40 to 50 mm`);
  assert.ok(at(1).p > 0.085 && at(1).p < 0.095, `chest 1 projection ${mm(at(1).p)} mm outside 85 to 95 mm`);

  for (const size of [DEFAULTS.chest, 1]) {
    const e = at(size), segs = e.body.torsoSegs, prof = [];
    for (let y = 1.10; y <= 1.40; y += 0.002) prof.push([y, front(segs, e.x, y) - ribAt(y)]);
    const shown = prof.filter(([, p]) => p > 0.002), top = shown[shown.length - 1][0], bottom = shown[0][0];
    // Fullest below the middle, and a real cleft whose floor stands off the ribcage by a modest share of the projection.
    const standoff = front(segs, 0, e.y) - ribAt(e.y), middle = (top + bottom) / 2, most = size === 1 ? 0.55 : 0.35;
    console.log(`chest ${size}: bust spans y ${bottom.toFixed(3)} to ${top.toFixed(3)}, most forward at y ${e.y.toFixed(3)} (middle ${middle.toFixed(3)}), x ${mm(e.x)} mm; midline ${mm(standoff)} mm off the ribcage (${(standoff / e.p * 100).toFixed(0)}% of the projection), cleft ${mm(e.p - standoff)} mm deep`);
    assert.ok(e.y < middle, `chest ${size}: fullest point is not below the vertical middle`);
    assert.ok(e.p - standoff > 0.005 && standoff < most * e.p, `chest ${size}: midline stands ${mm(standoff)} mm off the ribcage, over ${most * 100}% of the projection`);
  }

  // The drawn skin, as main.js indexes and shades it.
  const drawn = (body) => {
    const g = buildTorso(body), index = gridIndex(g.rings, g.segs, true, true), normal = new Float32Array(g.pos.length);
    computeNormals(g.pos, index, normal);
    return { ...g, index, normal };
  };
  const skins = new Map([0, 0.25, DEFAULTS.chest, 0.75, 1].map((size) => [size, drawn(at(size).body)]));

  // Fidelity and shading over the bust: triangle centroids and edge midpoints on the capsule union, and neighbouring
  // vertex normals within 20 degrees at size 0 and 33 above, except across the cleft. The cleft is a crease of the union
  // on the midline column, where mirrored capsules wider than its curvature meet.
  for (const size of [0, DEFAULTS.chest, 1]) {
    const { pos, index, normal, segs: nseg } = skins.get(size), segs = at(size).body.torsoSegs;
    let fid = 0, turn = 0, crease = 0;
    for (let t = 0; t < index.length; t += 3) {
      const ids = [index[t], index[t + 1], index[t + 2]], v = ids.map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      const c = [0, 1, 2].map((q) => (v[0][q] + v[1][q] + v[2][q]) / 3);
      if (c[1] < 1.10 || c[1] > 1.37 || c[2] < 0.02 || Math.abs(c[0]) > 0.135) continue;
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const m = [0, 1, 2].map((q) => (v[a][q] + v[b][q]) / 2), i = ids[a] * 3, j = ids[b] * 3;
        fid = Math.max(fid, Math.abs(nearest(segs, m[0], m[1], m[2], hit).d));
        const ang = Math.acos(Math.min(1, normal[i] * normal[j] + normal[i + 1] * normal[j + 1] + normal[i + 2] * normal[j + 2])) * 180 / Math.PI;
        if (ids[a] % nseg === nseg / 4 || ids[b] % nseg === nseg / 4) crease = Math.max(crease, ang); else turn = Math.max(turn, ang);
      }
      fid = Math.max(fid, Math.abs(nearest(segs, c[0], c[1], c[2], hit).d));
    }
    const q = gridQuality({ pos: pos.subarray(nseg * 3), rings: skins.get(size).rings - 1, segs: nseg }, at(size).body.base.segs); // from below the flat cap on the neck
    console.log(`chest ${size}: drawn bust within ${mm(fid)} mm of the capsules; neighbouring normals turn up to ${turn.toFixed(1)} deg, ${crease.toFixed(1)} deg across the cleft; torso skin off surface ${mm(q.off)} mm, longest edge ${mm(q.edge)} mm, neighbour-chord deviation ${mm(q.spike)} mm`);
    assert.ok(q.off < 0.0015 && q.edge < 0.03 && q.spike < 0.006, `chest ${size}: torso skin over the bust is rough`);
    assert.ok(fid < 0.0015, `chest ${size}: drawn bust strays ${mm(fid)} mm from the capsules`);
    assert.ok(turn < (size === 0 ? 20 : 33) && crease < 50, `chest ${size}: shading breaks over the bust (${turn.toFixed(1)} deg, cleft ${crease.toFixed(1)} deg)`);
  }

  // From the front the bust reads as two forms: the drawn skin's section at apex height has a crest on each side,
  // set out at about half the torso's half-width, with the midline well behind it. A crest is the middle of the run of
  // 2 mm bins within 0.5 mm of that side's highest point, since the top of a breast is flat to a fraction of a millimetre.
  const crests = [];
  for (const size of [0.25, DEFAULTS.chest, 0.75, 1]) {
    const { pos, index } = skins.get(size), y = at(size).y, bins = new Map();
    for (let t = 0; t < index.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const A = index[t + a] * 3, B = index[t + b] * 3;
      if ((pos[A + 1] - y) * (pos[B + 1] - y) > 0 || pos[A + 1] === pos[B + 1]) continue;
      const s = (y - pos[A + 1]) / (pos[B + 1] - pos[A + 1]), x = pos[A] + (pos[B] - pos[A]) * s, z = pos[A + 2] + (pos[B + 2] - pos[A + 2]) * s, k = Math.round(x / 0.002);
      if (z > 0) bins.set(k, Math.max(bins.get(k) ?? -Infinity, z));
    }
    const side = (sign) => {
      const ks = [...bins.keys()].filter((k) => k * sign > 0).sort((p, q) => p * sign - q * sign), top = Math.max(...ks.map((k) => bins.get(k)));
      const run = ks.filter((k) => bins.get(k) > top - 0.0005);
      return { x: Math.abs(run[0] + run[run.length - 1]) * 0.001, top };
    };
    let half = 0;
    for (let z = -0.12; z <= 0.12; z += 0.004) { let lo = 0, hi = 0.25; for (let it = 0; it < 16; it++) { const m = (lo + hi) / 2; if (nearest(bare.torsoSegs, m, y, z, hit).d < 0) lo = m; else hi = m; } half = Math.max(half, lo); }
    const [l, r] = [side(-1), side(1)], dip = Math.min(l.top, r.top) - bins.get(0);
    crests.push(Math.min(l.x, r.x));
    console.log(`chest ${size}: crests at x ${mm(l.x)} and ${mm(r.x)} mm (${(l.x / half * 100).toFixed(0)}% and ${(r.x / half * 100).toFixed(0)}% of the half-width ${mm(half)} mm), midline ${mm(dip)} mm behind`);
    for (const c of [l, r]) assert.ok(c.x > 0.45 * half && c.x < 0.62 * half, `chest ${size}: crest at ${mm(c.x)} mm, outside 45% to 62% of the half-width`);
    assert.ok(dip > 0.2 * at(size).p, `chest ${size}: the midline is not behind the crests`);
  }
  assert.ok(crests[0] > crests[crests.length - 1] - 0.003, `the crests close in by ${mm(crests[crests.length - 1] - crests[0])} mm from chest 1 to 0.25`);

  // The masculine body has no chest to size: its geometry is what it was.
  const masc = bodyOf(BODIES.masculine, 0.5, 0.5, 1), same = (got, want, what) => assert.ok(got[0] === want[0] && Math.abs(got[1] / want[1] - 1) < 1e-9 && Math.abs(got[2] / want[2] - 1) < 1e-9, `masculine ${what} changed`);
  same(checksum(masc.segs), MASCULINE.segs, 'segments');
  same(checksum(buildTorso(masc).pos), MASCULINE.torso, 'torso skin');
  for (const id of ['tank', 'tube']) same(checksum(buildShirtRest(masc, SHIRT_STYLES.find((st) => st.id === id), SHIRT).pos), MASCULINE[id], `${id} rest shape`);
  console.log('masculine segments, torso skin and shirt rest shapes: unchanged');

  // Every style fits at the extremes (the default size runs through the shirt section): clear of the body at rest,
  // settled, held pulled out and after release, and asleep at rest.
  for (const size of [0, 1]) {
    const body = bodyOf(shape, 0, 0, size);
    for (const style of SHIRT_STYLES.filter((st) => st.top !== undefined)) {
      const t0 = performance.now(), sh = makeShirt(body, style), built = performance.now() - t0;
      let clear = Infinity;
      for (let i = 0; i < sh.n; i++) clear = Math.min(clear, nearest(body.base.segs, sh.pos[i * 3], sh.pos[i * 3 + 1], sh.pos[i * 3 + 2], hit).d);
      run(sh, 60);
      let r = report(sh, body.base.segs);
      const asleep = sh.asleep;
      const v = Math.floor(sh.rings / 2) * sh.segs + sh.segs / 4;
      assert.ok(beginGrab(sh, sh.pos[v * 3], sh.pos[v * 3 + 1], sh.pos[v * 3 + 2], 0.035));
      run(sh, 30, (f) => { sh.grab.dz = 0.15 * (f + 1) / 30; });
      run(sh, 30);
      const held = report(sh, body.base.segs);
      endGrab(sh);
      run(sh, 120);
      const after = report(sh, body.base.segs);
      console.log(`chest ${size} shirt ${style.id}: built in ${built.toFixed(0)} ms, rest clearance ${mm(clear)} mm, settled ${mm(r.minDist)} mm (asleep ${asleep}), held ${mm(held.minDist)} mm, released ${mm(after.minDist)} mm (asleep ${sh.asleep})`);
      assert.ok(clear >= 0.001 && r.minDist >= 0.001 && held.minDist >= 0.001 && after.minDist >= 0.001, `chest ${size} ${style.id}: shirt closer than 1 mm to the body`);
      assert.ok(r.nan === 0 && r.maxHome < 0.0005 && asleep && sh.asleep, `chest ${size} ${style.id}: shirt drifts or never sleeps at rest`);
    }
  }

  // Fabric bridges the bust instead of following the skin: each style's rest shape stands off the cleft by most of its
  // depth and off the crease under the bust by a good share of the projection.
  for (const size of [DEFAULTS.chest, 1]) {
    const e = at(size), segs = e.body.torsoSegs, cleft = e.p - (front(segs, 0, e.y) - ribAt(e.y));
    for (const style of SHIRT_STYLES.filter((st) => st.top !== undefined)) {
      const g = buildShirtRest(e.body, style, SHIRT), gap = (x, y0, y1) => {
        let most = 0;
        for (let i = 0; i < g.rings; i++) {
          let best = -1;
          for (let j = 0; j < g.segs; j++) { const o = (i * g.segs + j) * 3; if (g.pos[o + 2] > 0 && (best < 0 || Math.abs(g.pos[o] - x) < Math.abs(g.pos[best] - x))) best = o; }
          const y = g.pos[best + 1];
          if (y > y0 && y < y1) most = Math.max(most, g.pos[best + 2] - front(segs, g.pos[best], y));
        }
        return most;
      };
      const mid = gap(0, 1.12, 1.33), under = gap(e.x, 1.08, e.y - 0.02);
      console.log(`chest ${size} shirt ${style.id}: stands ${mm(mid)} mm off the cleft (${mm(cleft)} mm deep) and ${mm(under)} mm off the crease under the bust`);
      assert.ok(mid > 0.75 * cleft && under > 0.3 * e.p, `chest ${size} ${style.id}: shirt follows the skin into the cleft or under the bust`);
    }
  }

  // The arms swing past the bust: closest approach of its exposed surface to the arm capsules over whole cycles.
  {
    const body = bodyOf(shape, 0, 0, 1), t = body.torsoSegs, pts = [], n0 = bare.torsoSegs.length / STRIDE, n1 = t.length / STRIDE;
    for (let c = n0; c < n1; c++) for (let q = 0; q <= 2; q++) for (let i = 0; i < 24; i++) for (const el of [-0.6, 0, 0.6, 1]) {
      const o = c * STRIDE, u = q / 2, a = (i / 24) * Math.PI * 2, r = t[o + 3] + t[o + 7] * u;
      const p = [t[o] + t[o + 4] * u + Math.cos(a) * Math.cos(el) * r, t[o + 1] + t[o + 5] * u + Math.sin(el) * r, t[o + 2] + t[o + 6] * u + Math.sin(a) * Math.cos(el) * r];
      if (Math.abs(nearest(t, p[0], p[1], p[2], hit).d) < 2e-4 && nearest(bare.torsoSegs, p[0], p[1], p[2], hit).d > 0.002) pts.push(...p);
    }
    const rig = makeRig(body), M = buildMotions(rig), live = track(rig, new Float32Array(pts), ROOT);
    const armCount = body.arms.reduce((n, a) => n + a.segs.length / STRIDE, 0), start = body.live.segs.length - (armCount + body.headSegs.length / STRIDE) * STRIDE;
    const gaps = {};
    for (const motion of ['walk', 'jump']) {
      const d = makeDriver(); want(d, motion);
      let m = Infinity;
      for (let f = 0; f < (motion === 'walk' ? 240 : 420); f++) {
        applyPose(rig, [], drive(d, DT, rig, M));
        const arms = body.live.segs.subarray(start, start + armCount * STRIDE);
        for (let i = 0; i < live.length; i += 3) m = Math.min(m, nearest(arms, live[i], live[i + 1], live[i + 2], hit).d);
      }
      gaps[motion] = m;
    }
    console.log(`chest 1: ${pts.length / 3} surface points, closest approach to the arms over a walk cycle ${mm(gaps.walk)} mm, over a jump cycle ${mm(gaps.jump)} mm`);
    assert.ok(gaps.walk >= 0.005 && gaps.jump >= 0.005, `chest 1: arm within 5 mm of the bust (walk ${mm(gaps.walk)}, jump ${mm(gaps.jump)} mm)`);

    // The jump again with the bust bouncing, its spring stepped before each pose as main.js does, and with its offset
    // pinned at the limit each way; last the walk, bouncing. The bounce floats the bust up in the flight toward arms
    // that come down past it at the landing, so pinned up all the way the arm comes closer than the 5 mm the bounce's
    // own swing keeps.
    const L = BUILD.chest.bounce.limit * body.bust.projection, bounce = [];
    for (const [motion, pin] of [['jump', null], ['jump', [L, 0]], ['jump', [-L, 0]], ['jump', [0, L]], ['jump', [0, -L]], ['walk', null]]) {
      const d = makeDriver(); want(d, motion);
      let m = Infinity;
      for (let f = 0; f < (motion === 'walk' ? 240 : 420); f++) {
        const pose = drive(d, DT, rig, M);
        if (pin) [rig.soft.y, rig.soft.z] = pin; else stepSoft(rig, pose, DT);
        applyPose(rig, [], pose);
        const arms = body.live.segs.subarray(start, start + armCount * STRIDE);
        for (let i = 0; i < live.length; i += 3) m = Math.min(m, nearest(arms, live[i], live[i + 1], live[i + 2], hit).d);
      }
      bounce.push(m);
    }
    const walked = bounce.pop();
    console.log(`chest 1 bouncing: closest approach to the arms over a walk cycle ${mm(walked)} mm`);
    assert.ok(walked >= 0.005, `chest 1: arm within 5 mm of the bust bouncing in the walk (${mm(walked)} mm)`);
    console.log(`chest 1 bouncing: closest approach to the arms over a jump cycle ${mm(bounce[0])} mm; offset pinned at the limit ${mm(L)} mm up, down, forward, back ${bounce.slice(1).map(mm).join(' / ')} mm`);
    assert.ok(bounce[0] >= 0.005, `chest 1: arm within 5 mm of the bouncing bust (${mm(bounce[0])} mm)`);
    assert.ok(Math.min(...bounce) >= 0.003, `chest 1: arm within 3 mm of the bust pinned at the limit (${bounce.slice(1).map(mm).join(' / ')} mm)`);
  }

  // The bounce offset pinned at its limit each way in y and z. The drawn skin rides the live capsules only as closely
  // as rigid capsules allow: one 54 mm across meets the ribcage while moving at its own weight, and the skin over that
  // crease leaves it to stay smooth, so the skin strays further than the 1.5 mm it holds at rest. A held tank stays
  // clear of the live body.
  for (const size of [DEFAULTS.chest, 1]) {
    const body = at(size).body, rig = makeRig(body), { pos: rest, index } = skins.get(size), skin = track(rig, rest, BLEND);
    const L = BUILD.chest.bounce.limit * body.bust.projection, t0 = body.legs.reduce((n, l) => n + l.segs.length, 0);
    const sh = makeShirt(body, SHIRT_STYLES.find((st) => st.id === 'tank')), v = Math.floor(sh.rings / 2) * sh.segs + sh.segs / 4;
    let fid = 0, held = Infinity, leftOut = Infinity;
    for (const [y, z] of [[L, 0], [-L, 0], [0, L], [0, -L]]) {
      rig.soft.y = y; rig.soft.z = z;
      applyPose(rig, [sh], STAND);
      // The lists were cut at rest, but the bounce moves a home and a capsule by their own weights: a capsule left out
      // of a vertex's list must still be setCollider's 20 mm reach from the vertex's live home, less 0.01 mm of rounding.
      const caps = Array.from({ length: sh.collider.length / STRIDE }, (_, k) => sh.collider.subarray(k * STRIDE, (k + 1) * STRIDE));
      for (let i = 0; i < sh.n; i++) {
        const own = new Set(sh.cand.subarray(sh.candStart[i], sh.candStart[i + 1]));
        caps.forEach((cap, k) => { if (!own.has(k * STRIDE)) leftOut = Math.min(leftOut, nearest(cap, sh.home[i * 3], sh.home[i * 3 + 1], sh.home[i * 3 + 2], hit).d); });
      }
      const segs = body.live.segs.subarray(t0, t0 + body.torsoSegs.length);
      for (let t = 0; t < index.length; t += 3) {
        const ids = [index[t], index[t + 1], index[t + 2]], c = [0, 1, 2].map((q) => (rest[ids[0] * 3 + q] + rest[ids[1] * 3 + q] + rest[ids[2] * 3 + q]) / 3);
        if (c[1] < 1.10 || c[1] > 1.37 || c[2] < 0.02 || Math.abs(c[0]) > 0.135) continue;
        const p = ids.map((i) => [skin[i * 3], skin[i * 3 + 1], skin[i * 3 + 2]]);
        const probes = [[0, 1], [1, 2], [2, 0]].map(([a, b]) => p[a].map((u, q) => (u + p[b][q]) / 2)).concat([p[0].map((u, q) => (u + p[1][q] + p[2][q]) / 3)]);
        for (const q of probes) fid = Math.max(fid, Math.abs(nearest(segs, q[0], q[1], q[2], hit).d));
      }
      run(sh, 60);
      assert.ok(beginGrab(sh, sh.pos[v * 3], sh.pos[v * 3 + 1], sh.pos[v * 3 + 2], 0.035));
      run(sh, 30, (f) => { sh.grab.dz = 0.15 * (f + 1) / 30; });
      run(sh, 30);
      held = Math.min(held, report(sh, body.live.base.segs).minDist);
      endGrab(sh);
    }
    rig.soft.y = 0; rig.soft.z = 0;
    applyPose(rig, [sh], STAND);
    const bound = size === 1 ? 0.0045 : 0.0034;
    console.log(`chest ${size} bounce pinned at the limit ${mm(L)} mm each way: drawn bust within ${mm(fid)} mm of the live capsules, held tank ${mm(held)} mm clear`);
    assert.ok(fid < bound, `chest ${size}: pinned at the limit the drawn bust strays ${mm(fid)} mm from the live capsules, over ${mm(bound)}`);
    assert.ok(held >= 0.001, `chest ${size}: pinned at the limit a held tank comes within ${mm(held)} mm of the body`);
    console.log(`chest ${size} bounce pinned at the limit: closest capsule left out of a tank vertex's list to its live home ${mm(leftOut)} mm`);
    assert.ok(leftOut >= 0.02 - 1e-5, `chest ${size}: pinned at the limit a capsule left out of a tank vertex's list comes within ${mm(leftOut)} mm of its home, under the 20 mm reach`);
  }

  // Walking, the bust swings up and down by a visible share of its size, and from frame to frame no more abruptly than
  // 1.5 times a sine at the spring's own frequency with the same peak would.
  for (const [size, lo, hi] of [[DEFAULTS.chest, 0.003, 0.006], [1, 0.006, 0.01]]) {
    const body = at(size).body, rig = makeRig(body), M = buildMotions(rig), s = rig.soft, d = makeDriver(), ys = [];
    let peak = 0, step = 0;
    want(d, 'walk');
    for (let f = 0, py = 0, pz = 0; f < 240; f++) {
      const pose = drive(d, DT, rig, M);
      stepSoft(rig, pose, DT);
      applyPose(rig, [], pose);
      if (f >= 120) { ys.push(s.y); peak = Math.max(peak, Math.hypot(s.y, s.z)); step = Math.max(step, Math.hypot(s.y - py, s.z - pz)); }
      py = s.y; pz = s.z;
    }
    const { hz } = BUILD.chest.bounce, sine = 2 * Math.PI * (hz[0] + (hz[1] - hz[0]) * size) * peak * DT;
    const swing = (Math.max(...ys) - Math.min(...ys)) / 2;
    console.log(`chest ${size} walking: the bust swings ${mm(swing)} mm, peak offset ${mm(peak)} mm; largest change between frames ${mm(step)} mm, ${(step / sine).toFixed(2)} of a sine's`);
    assert.ok(swing >= lo && peak <= hi, `chest ${size} walking: the bust swings ${mm(swing)} mm with a peak of ${mm(peak)}, outside ${mm(lo)} to ${mm(hi)} mm`);
    assert.ok(step <= 1.5 * sine, `chest ${size} walking: the bust moves ${mm(step)} mm in a frame, over 1.5 times a sine's ${mm(sine)} mm`);
  }

  // A live jump in the tank at chest 1, the spring stepped before each pose: the bust moves, its offset is exactly 0
  // once the figure has stood still a while, the capsules are their rest values again, and the tank goes to sleep.
  {
    const body = at(1).body, rig = makeRig(body), M = buildMotions(rig), sh = makeShirt(body, SHIRT_STYLES.find((st) => st.id === 'tank'));
    const flight = M.jump.segments.find((g) => g.flight), d = makeDriver(), s = rig.soft;
    want(d, 'jump');
    let peak = 0, landed = false, still = -1, rest = -1, asleep = -1;
    for (let f = 0; f < 600 && asleep < 0; f++) {
      const pose = drive(d, DT, rig, M);
      stepSoft(rig, pose, DT);
      applyPose(rig, [sh], pose);
      stepCloth(sh, DT);
      peak = Math.max(peak, Math.hypot(s.y, s.z));
      if (!landed && d.state === 'run' && d.t > flight.t0 + flight.T) { landed = true; want(d, 'stand'); }
      if (still < 0 && d.state === 'still') still = f;
      if (still >= 0 && rest < 0 && s.y === 0 && s.z === 0) rest = f;
      if (rest >= 0 && sh.asleep) asleep = f;
    }
    const nan = sh.pos.reduce((k, x) => k + !Number.isFinite(x), 0), exact = s.y === 0 && s.z === 0 && body.live.segs.every((x, i) => x === body.segs[i]);
    console.log(`chest 1 live jump in the tank: bounce peak ${mm(peak)} mm; offset exactly 0 ${rest - still} frames after standing still, tank asleep ${asleep - still} frames after; NaN ${nan}`);
    assert.ok(nan === 0 && peak > 0.01, `chest 1 live jump: NaN ${nan}, bounce peak ${mm(peak)} mm`);
    assert.ok(still >= 0 && rest >= 0 && exact, `chest 1 live jump: the bounce never came to rest (still at ${still}, rest at ${rest})`);
    assert.ok(asleep >= 0 && asleep - still <= 150, `chest 1 live jump: tank asleep ${asleep - still} frames after standing still, over 150`);
  }

  // The spring alone. A pose jumped to without a step (a reset, a test's starting pose, a fresh rig) does not kick
  // it, though the same jump taken as a step does; an absurd drive saturates it at the limit; at rest it snaps to
  // exactly 0 and the capsules are their rest values again. The masculine body has no bust and never bounces.
  {
    const body = at(1).body, rig = makeRig(body), s = rig.soft, L = BUILD.chest.bounce.limit * body.bust.projection;
    const far = makePose({ root: { y: 0.25, z: 0.1, pitch: 0.3 } }), still = (r) => r.soft.y === 0 && r.soft.z === 0;
    const steps = (pose, n) => { for (let k = 0; k < n; k++) { stepSoft(rig, pose, DT); applyPose(rig, [], pose); } };
    steps(far, 3);
    const fresh = still(rig);
    applyPose(rig, [], STAND);
    steps(STAND, 3);
    const reset = still(rig);
    steps(far, 1);
    const kicked = !still(rig);
    let most = 0, finite = true, k = 0;
    applyPose(rig, [], STAND);
    for (let i = 0; i < 30; i++) { steps(makePose({ root: { y: 500 * (i * DT) ** 2 } }), 1); most = Math.max(most, Math.hypot(s.y, s.z)); finite &&= Number.isFinite(s.y + s.z); }
    applyPose(rig, [], STAND);
    for (; k < 600 && !still(rig); k++) steps(STAND, 1);
    const exact = body.live.segs.every((x, i) => x === body.segs[i]);
    const mr = makeRig(masc);
    stepSoft(mr, far, DT); stepSoft(mr, STAND, DT); stepSoft(mr, far, DT);
    console.log(`bounce spring: fresh rig ${fresh ? 'still' : 'kicked'}, reset ${reset ? 'still' : 'kicked'}, a stepped jump ${kicked ? 'kicks' : 'does not kick'}; 100 g held for half a second peaks at ${mm(most)} mm (limit ${mm(L)} mm); at rest ${k} frames later; masculine ${still(mr) ? 'still' : 'moved'}`);
    assert.ok(fresh && reset && kicked, `bounce spring: fresh ${fresh}, reset ${reset}, stepped jump kicks ${kicked}`);
    assert.ok(finite && most > 0.99 * L && most <= L * (1 + 1e-12), `bounce spring: 100 g peaks at ${mm(most)} mm against the limit ${mm(L)} mm`);
    assert.ok(k < 600 && exact, `bounce spring: never back at exactly rest (${k} frames)`);
    assert.ok(still(mr), 'the masculine body bounced');
  }

  // Never stepped, posing is what it was before the bounce existed: one posed frame's live capsules and torso skin,
  // bit for bit, captured from the code before it.
  const POSED = makePose({ root: { y: -0.04, z: 0.03, pitch: 0.15 }, hipL: 0.4, kneeL: 0.5, hipR: -0.2, shoulderL: 0.6, elbowL: 0.7, shoulderR: -0.3 });
  const RIGID = {
    0.5: { segs: [11030, 37950022.319867425, 1821514599.7489998], torso: [34851, 14315.303486065002, 701343.0117014081] },
    1: { segs: [11770, 35694656.20723153, 1770249233.6620061], torso: [34851, 14352.373351381017, 702988.1029380776] },
  };
  for (const size of [DEFAULTS.chest, 1]) {
    const body = at(size).body, rig = makeRig(body), skin = track(rig, buildTorso(body).pos, BLEND);
    applyPose(rig, [], POSED);
    const got = { segs: checksum(body.live.segs), torso: checksum(skin) };
    assert.deepEqual(got, RIGID[size], `chest ${size}: posing without the bounce stepped changed`);
    applyPose(rig, [], STAND);
  }
  console.log('posing never stepped: live capsules and torso skin bit for bit as before the bounce');
}

const crowns = {};

for (const [id, shape] of Object.entries(BODIES)) for (const build of [0, 1]) {
  console.log(`\n== arms and head: ${id} thigh ${build} glute ${build}`);
  const body = bodyOf(shape, build, build);
  const [L, R] = body.arms.map(armSkin);
  const armSegs = concatSegs(body.arms[0].segs, body.arms[1].segs);
  for (const [g, arm, name] of [[L, body.arms[0], 'left'], [R, body.arms[1], 'right']]) {
    const q = gridQuality(g, arm.segs), bad = inward(g.pos, gridIndex(g.rings, g.segs, true, true, true), arm.segs);
    console.log(`${name} arm skin ${g.rings} x ${g.segs}: off its capsules ${mm(q.off)} mm, longest edge ${mm(q.edge)} mm, neighbour-chord deviation ${mm(q.spike)} mm, ${bad} inward triangles`);
    assert.ok(q.off < 0.0015, `${id}: ${name} arm skin strays from its capsules`);
    assert.ok(q.edge < 0.03 && q.spike < 0.006, `${id}: holes or spikes in the ${name} arm skin`);
    assert.equal(bad, 0, `${id}: ${name} arm skin faces inward`);
  }
  // Mirror images: ring i, column j of the left arm against column nseg / 2 - j of the right; then both poles.
  let asym = 0;
  for (let i = 0; i < L.rings; i++) for (let j = 0; j < L.segs; j++) {
    const a = ringAt(L, i, j), b = ringAt(R, i, L.segs / 2 - j);
    asym = Math.max(asym, Math.hypot(L.pos[a] + R.pos[b], L.pos[a + 1] - R.pos[b + 1], L.pos[a + 2] - R.pos[b + 2]));
  }
  for (let o = L.rings * L.segs * 3; o < L.pos.length; o += 3) asym = Math.max(asym, Math.hypot(L.pos[o] + R.pos[o], L.pos[o + 1] - R.pos[o + 1], L.pos[o + 2] - R.pos[o + 2]));
  const n = shape.pelvis.length + shape.glutes.length, hips = concatSegs(body.legs[0].segs, body.legs[1].segs, body.torsoSegs.subarray(0, n * STRIDE));
  let low = Infinity, clear = Infinity, clearAt = '';
  for (const g of [L, R]) for (let i = 0; i < g.pos.length; i += 3) {
    low = Math.min(low, g.pos[i + 1]);
    const d = nearest(hips, g.pos[i], g.pos[i + 1], g.pos[i + 2], hit).d;
    if (d < clear) { clear = d; clearAt = at(g.pos, i); }
  }
  const skirt = buildSkirt(body);
  let hem = Infinity;
  for (let i = 0; i < skirt.pos.length; i += 3) hem = Math.min(hem, nearest(armSegs, skirt.pos[i], skirt.pos[i + 1], skirt.pos[i + 2], hit).d);
  console.log(`arms: asymmetry ${mm(asym)} mm, lowest hand point y ${low.toFixed(3)}, clear of legs, pelvis and glutes by ${mm(clear)} mm at ${clearAt}, rest skirt clear of the arms by ${mm(hem)} mm`);
  assert.ok(asym < 1e-4, `${id}: arms are not mirror images`);
  assert.ok(low > 0.6, `${id}: hand reaches below y 0.60`);
  if (build === 1) assert.ok(clear >= 0.01, `${id}: arm closer than 10 mm to the legs, pelvis or glutes at full build`);
  assert.ok(hem >= 0.01, `${id}: rest skirt closer than 10 mm to an arm`);

  // How far the arm emerges through each shirt: the deepest rest vertex inside the arm, and how far the arm's
  // top sphere stands out of the shirt surface (offset off the torso) within the shirt's height.
  const [px, py, pz, r0] = shape.arm[0], sphere = [];
  for (let k = 0; k < 400; k++) {
    const y = 1 - 2 * (k + 0.5) / 400, r = Math.sqrt(1 - y * y), th = k * Math.PI * (3 - Math.sqrt(5));
    sphere.push([px + r0 * r * Math.cos(th), py + r0 * y, pz + r0 * r * Math.sin(th)]);
  }
  const holes = SHIRT_STYLES.filter((s) => s.top !== undefined).map((style) => {
    const rest = buildShirtRest(body, style, SHIRT).pos;
    let deep = 0, yMax = -Infinity, out = -Infinity;
    for (let i = 0; i < rest.length; i += 3) { deep = Math.min(deep, nearest(armSegs, rest[i], rest[i + 1], rest[i + 2], hit).d); yMax = Math.max(yMax, rest[i + 1]); }
    for (const [x, y, z] of sphere) if (y <= yMax && y >= style.hem) out = Math.max(out, nearest(body.base.segs, x, y, z, hit).d - SHIRT.offset);
    return `${style.id} ${mm(-deep)} / ${mm(out)}`;
  });
  console.log(`armholes, deepest shirt vertex inside the arm / top sphere out of the shirt (mm): ${holes.join(', ')}`);

  const head = buildHead(body), headSegs = concatSegs(body.torsoSegs, body.headSegs);
  const q = gridQuality(head, headSegs), bad = inward(head.pos, gridIndex(head.rings, head.segs, true), headSegs);
  let crown = -Infinity, hasym = 0, rim = Infinity;
  for (let i = 0; i < head.pos.length; i += 3) crown = Math.max(crown, head.pos[i + 1]);
  for (let j = 0; j < head.segs; j++) rim = Math.min(rim, head.pos[ringAt(head, 0, j) + 1]);
  for (let i = 0; i < head.rings; i++) for (let j = 0; j < head.segs; j++) {
    const a = ringAt(head, i, j), b = ringAt(head, i, head.segs / 2 - j);
    hasym = Math.max(hasym, Math.hypot(head.pos[a] + head.pos[b], head.pos[a + 1] - head.pos[b + 1], head.pos[a + 2] - head.pos[b + 2]));
  }
  console.log(`head skin ${head.rings} x ${head.segs}: off its capsules ${mm(q.off)} mm, longest edge ${mm(q.edge)} mm, neighbour-chord deviation ${mm(q.spike)} mm, ${bad} inward triangles, asymmetry ${mm(hasym)} mm, crown y ${crown.toFixed(3)}, lower rim y ${rim.toFixed(3)} (neck cut ${body.trunk.top})`);
  assert.ok(q.off < 0.0015, `${id}: head skin strays from its capsules`);
  assert.ok(q.edge < 0.03 && q.spike < 0.006, `${id}: holes or spikes in the head skin`);
  assert.equal(bad, 0, `${id}: head skin faces inward`);
  assert.ok(hasym < 1e-4, `${id}: head is not left-right symmetric`);
  assert.ok(rim < body.trunk.top - 0.02, `${id}: head skin does not cover the neck cut`);
  crowns[id] = crown;
}
assert.ok(crowns.feminine >= 1.74 && crowns.feminine <= 1.76, 'feminine crown outside y 1.74 to 1.76');
assert.ok(crowns.masculine > crowns.feminine && crowns.masculine <= crowns.feminine + 0.03, 'masculine crown is not slightly above the feminine one');

// --- Feet ---
// Measured on the drawn skin, the foot's body and its five toes, of the unmodified build. The right foot is read in
// its own frame: m runs from the inner side (big toe, negative) outward, z from the heel to the toes.
const footLength = {};
for (const [id, shape] of Object.entries(BODIES)) {
  const body = bodyOf(shape, 0, 0), [left, right] = body.legs, x0 = right.atS(0).x, side = Math.sign(x0);
  const drawn = (leg) => [legSkin(leg), ...toeSkins(leg)], R = drawn(right);
  const own = [right.body, ...right.toes.map((t) => t.segs)], index = R.map((g) => gridIndex(g.rings, g.segs, true, true, g.startPole));
  const frame = (pos) => { const q = []; for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] < 0.08) q.push([side * (pos[i] - x0), pos[i + 1], pos[i + 2]]); return q; };
  const pts = R.flatMap((g) => frame(g.pos)), toes = R.slice(1).map((g) => frame(g.pos));
  const min = (q, k) => q.reduce((m, p) => Math.min(m, p[k]), Infinity), max = (q, k) => q.reduce((m, p) => Math.max(m, p[k]), -Infinity);
  const low = min(pts, 1), back = min(pts, 2), L = max(pts, 2) - back, stature = crowns[id];
  const slice = (z0, z1) => pts.filter((p) => p[2] >= back + z0 * L && p[2] < back + z1 * L), span = (q) => max(q, 0) - min(q, 0);
  let ball = 0;
  for (let f = 0.55; f < 0.85; f += 0.008) ball = Math.max(ball, span(slice(f - 0.004, f + 0.004)));
  const heel = span(slice(0.1, 0.2).filter((p) => p[1] < 0.05));
  // Arch: the union's sole 15 mm in from either edge of the midfoot, over the union's lowest point, at its highest.
  let floor = Infinity;
  for (let o = 0; o < right.segs.length; o += STRIDE) floor = Math.min(floor, right.segs[o + 1] - right.segs[o + 3], right.segs[o + 1] + right.segs[o + 5] - right.segs[o + 3] - right.segs[o + 7]);
  const sole = (m, z) => { let y = floor - 0.002; while (y < 0.08 && nearest(right.segs, x0 + side * m, y, z, hit).d > 0) y += 0.00025; return y - floor; };
  const arch = (inner) => {
    let h = -Infinity;
    for (let f = 0.35; f < 0.6; f += 0.016) { const q = slice(f - 0.008, f + 0.008); h = Math.max(h, sole(inner ? min(q, 0) + 0.015 : max(q, 0) - 0.015, back + f * L)); }
    return h;
  };
  const inner = arch(true), outer = arch(false);
  // Each toe's width across its own axis, and its centre across the foot.
  const width = right.toes.map((t, k) => {
    const a = t.atS(0), b = t.atS(t.length), l = Math.hypot(b.x - a.x, b.z - a.z), u = (p) => (p[0] * (b.z - a.z) - p[2] * side * (b.x - a.x)) / l;
    return toes[k].reduce((m, p) => Math.max(m, u(p)), -Infinity) - toes[k].reduce((m, p) => Math.min(m, u(p)), Infinity);
  });
  const centre = toes.map((q) => q.reduce((m, p) => m + p[0], 0) / q.length);
  // Crests: the highest triangle straight above points along the line through each toe 10 mm short of its tip, in
  // from past the big toe to past the little toe, peaks standing `rise` over the dips on both sides.
  const along = right.toes.map((t) => t.atS(t.length - 0.01)), [ta, tb] = [along[0], along[4]];
  const crests = (meshes, rise) => {
    const tris = [];
    for (const { pos: p, index: ix } of meshes) for (let t = 0; t < ix.length; t += 3) {
      const v = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
      if (v.every((o) => p[o + 2] > 0.1 && p[o + 1] < 0.06)) tris.push(v.map((o) => [p[o], p[o + 1], p[o + 2]]));
    }
    const prof = [];
    for (let k = -10; k <= 110; k++) {
      const x = ta.x + (tb.x - ta.x) * k / 100, z = ta.z + (tb.z - ta.z) * k / 100;
      let top = -Infinity;
      for (const [a, b, c] of tris) {
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) top = Math.max(top, u * a[1] + v * b[1] + (1 - u - v) * c[1]);
      }
      prof.push(top);
    }
    let n = 0;
    for (let i = 1; i < prof.length - 1; i++) {
      if (!(prof[i] >= prof[i - 1] && prof[i] > prof[i + 1])) continue;
      let l = i, r = i;
      while (l > 0 && prof[l - 1] <= prof[i]) l--;
      while (r < prof.length - 1 && prof[r + 1] <= prof[i]) r++;
      if (prof[i] - Math.max(Math.min(...prof.slice(l, i + 1)), Math.min(...prof.slice(i, r + 1))) >= rise) n++;
    }
    return n;
  };
  const st = makeStocking(body, right), skinCrests = crests(R.map((g, k) => ({ pos: g.pos, index: index[k] })), 0.001);
  const knitCrests = crests([{ pos: st.home, index: st.index }], 0.0003);
  // Pads: the lowest skin under the heel and the ball, and each toe's, over the lowest skin of all.
  const pad = (q) => min(q, 1) - low, heelPad = pad(slice(0, 0.25)), ballPad = pad(slice(0.6, 0.8)), toePads = toes.map(pad);
  // Skin near its capsules, checked at triangle centres where a chord sags furthest, and outside none. Triangles
  // buried in another part of the foot are hidden and skipped. The foot's body shares the stocking's rings, which
  // fan out round the back of the heel, so its chords sag further there than the toes'.
  const off = [0, 0];
  let flipped = 0;
  R.forEach((g, k) => {
    const p = g.pos, others = concatSegs(...own.filter((_, j) => j !== k)), seen = [];
    for (let t = 0; t < index[k].length; t += 3) {
      const [a, b, c] = [index[k][t] * 3, index[k][t + 1] * 3, index[k][t + 2] * 3], q = [0, 1, 2].map((d) => (p[a + d] + p[b + d] + p[c + d]) / 3);
      if (q[1] > 0.08 || nearest(others, ...q, hit).d < 0) continue;
      seen.push(index[k][t], index[k][t + 1], index[k][t + 2]);
      off[Math.min(k, 1)] = Math.max(off[Math.min(k, 1)], Math.abs(nearest(own[k], ...q, hit).d));
    }
    flipped += inward(p, seen, own[k]);
  });
  // Left and right are mirror images: ring i, column j on the right is ring i, column n/2 - j on the left.
  let mirror = 0;
  drawn(left).forEach((h, k) => {
    const g = R[k], n = g.segs;
    for (let o = 0; o < g.pos.length; o += 3) {
      const v = o / 3, i = Math.floor(v / n), q = i < g.rings ? (i * n + (((n / 2 - (v % n)) % n) + n) % n) * 3 : o;
      mirror = Math.max(mirror, Math.abs(g.pos[o] + h.pos[q]), Math.abs(g.pos[o + 1] - h.pos[q + 1]), Math.abs(g.pos[o + 2] - h.pos[q + 2]));
    }
  });
  // The settled stocking's surface clear of the drawn foot and toes, below the ankle: every triangle sampled on a
  // barycentric grid six to an edge, finer than the grid the rest shape is cleared on.
  const depths = R.map((g, k) => meshDepth(g.pos, index[k])), grid = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; i + j <= 6; j++) grid.push([i / 6, j / 6, (6 - i - j) / 6]);
  run(st, 300);
  let clear = Infinity;
  for (let t = 0; t < st.index.length; t += 3) {
    const v = [st.index[t] * 3, st.index[t + 1] * 3, st.index[t + 2] * 3];
    if (v.some((o) => st.pos[o + 1] > 0.1)) continue;
    for (const w of grid) {
      const q = [0, 1, 2].map((d) => w[0] * st.pos[v[0] + d] + w[1] * st.pos[v[1] + d] + w[2] * st.pos[v[2] + d]);
      for (const depth of depths) { const d = depth(...q); if (d !== null) clear = Math.min(clear, d); }
    }
  }
  footLength[id] = L;
  console.log(`\n${id} foot: length ${mm(L)} mm, ${(L / stature * 100).toFixed(1)}% of stature; ball ${(ball / L * 100).toFixed(1)}% and heel ${(heel / L * 100).toFixed(1)}% of the length wide; sole lifted ${mm(inner)} mm on the inner side, ${mm(outer)} mm on the outer`);
  console.log(`${id} toes: widths ${width.map(mm).join(' / ')} mm, centres ${centre.map(mm).join(' / ')} mm across; crests on the skin ${skinCrests}, on the stocking's rest ${knitCrests}; lowest point over the floor contact: heel ${mm(heelPad)}, ball ${mm(ballPad)}, toes ${toePads.map(mm).join(' / ')} mm`);
  console.log(`${id} foot skin: ${mm(off[0])} mm off its capsules at most on the body, ${mm(off[1])} mm on the toes, ${flipped} inward triangles, left and right ${mm(mirror)} mm from mirror images; settled stocking's surface ${mm(clear)} mm clear of it`);
  assert.ok(L / stature > 0.14 && L / stature < 0.16, `${id}: foot length ${(L / stature * 100).toFixed(1)}% of stature, outside 14 to 16%`);
  assert.ok(ball / L > 0.36 && ball / L < 0.41 && heel / L > 0.24 && heel / L < 0.28, `${id}: ball or heel width out of proportion`);
  assert.ok(inner > 0.01 && inner < 0.018 && outer < inner / 3, `${id}: the arch does not lift the inner side ${mm(inner)} mm and leave the outer ${mm(outer)} mm`);
  assert.ok(centre.every((c, k) => k === 0 || c > centre[k - 1]) && width.slice(1).every((w) => width[0] > 1.4 * w), `${id}: the big toe is not innermost and widest`);
  // The knit is wrapped over the toes' hollows (BUILD.foot.wrap), which covers the toes' tips but smooths the four
  // smaller toes into one rounded front under it: only the big toe's crest stands out, 2 mm (measured).
  assert.ok(skinCrests === 5 && knitCrests >= 1, `${id}: ${skinCrests} toe crests on the skin and ${knitCrests} under the stocking`);
  assert.ok(heelPad < 0.001 && ballPad < 0.001 && toePads.every((d) => d < 0.002), `${id}: heel, ball or toes off the floor`);
  assert.ok(off[0] < 0.003 && off[1] < 0.0015 && flipped === 0, `${id}: foot skin strays from its capsules or faces inward`);
  assert.ok(mirror < 1e-5, `${id}: feet are not mirror images`);
  assert.ok(clear >= 0, `${id}: settled stocking ${mm(clear)} mm under the foot's skin`);
}
assert.ok(footLength.masculine > footLength.feminine, 'the masculine foot is not the longer');

for (const [id, shape] of Object.entries(BODIES)) for (const [thigh, glute] of MODS) {
  console.log(`\n== ${id} thigh ${thigh} glute ${glute}`);
  const body = bodyOf(shape, thigh, glute);

  assert.ok(shape.hipX > shape.leg[0][2], 'thighs overlap');
  for (const leg of body.legs) {
    const g = sweepLimb(leg, 0, leg.length, 110, 48, 0, 5);
    let low = Infinity;
    for (let i = 1; i < g.pos.length; i += 3) low = Math.min(low, g.pos[i]);
    console.log(`lowest skin point ${(low * 1000).toFixed(1)}mm`);
    assert.ok(low > 0 && low < 0.02, 'feet not resting on the floor');
  }

  // --- Stocking ---
  const st = makeStocking(body, body.legs[1]);
  console.log(`stocking: ${st.n} verts, ${st.ci.length} constraints`);

  run(st, 60);
  let r = report(st, body.base.segs);
  console.log('rest     ', fmt(r));
  assert.equal(r.nan, 0);
  assert.ok(r.maxHome < 0.0005, 'stocking drifts at rest');

  // Grab the outer thigh a third of the way down and pull 30 cm sideways.
  const v = Math.floor(st.bodyRings * 0.3) * st.segs;
  assert.ok(beginGrab(st, st.pos[v * 3], st.pos[v * 3 + 1], st.pos[v * 3 + 2], 0.035));
  run(st, 30, (f) => { st.grab.dx = 0.3 * (f + 1) / 30; });
  run(st, 60);
  r = report(st, body.base.segs);
  console.log('pulled   ', fmt(r));
  assert.equal(r.nan, 0);
  assert.ok(r.maxHome > 0.25, 'grab did not move the cloth');
  assert.ok(r.maxStretch < 8, 'cloth over-stretched');
  assert.ok(r.minDist > st.params.thickness - 2e-4, 'cloth inside the leg while pulled');

  // Flick: slam the grab through the leg and back in alternating frames.
  run(st, 20, (f) => { st.grab.dx = f % 2 ? 0.3 : -0.3; st.grab.dz = f % 2 ? -0.2 : 0.2; });
  r = report(st, body.base.segs);
  console.log('flicked  ', fmt(r));
  assert.equal(r.nan, 0);
  assert.ok(r.maxStretch < 12, 'flick exploded the mesh');

  endGrab(st);
  let settled = -1;
  for (let f = 0; f < 180; f++) {
    stepCloth(st, DT);
    if (settled < 0 && report(st, body.base.segs).maxHome < 0.001) settled = f + 1;
  }
  r = report(st, body.base.segs);
  console.log('released ', fmt(r), ` (within 1mm after ${settled} frames)`);
  assert.equal(r.nan, 0);
  assert.ok(settled > 0 && settled <= 90, 'snap-back too slow');
  assert.ok(r.minDist > st.params.thickness - 2e-4, 'cloth inside the leg after release');

  // --- Skirt ---
  const sk = makeSkirt(body);
  console.log(`skirt: ${sk.n} verts, ${sk.ci.length} constraints`);
  run(sk, 240);
  r = report(sk, body.base.segs);
  console.log('hanging  ', fmt(r));
  assert.equal(r.nan, 0);
  assert.ok(r.maxStretch < 1.3, 'skirt sags too much');
  assert.ok(r.minDist > sk.params.thickness - 5e-4, 'skirt inside the body');

  const hem = (sk.rings - 1) * sk.segs;
  assert.ok(beginGrab(sk, sk.pos[hem * 3], sk.pos[hem * 3 + 1], sk.pos[hem * 3 + 2], 0.05));
  run(sk, 30, (f) => { sk.grab.dy = 0.25 * (f + 1) / 30; sk.grab.dx = -0.2 * (f + 1) / 30; });
  endGrab(sk);
  run(sk, 240);
  r = report(sk, body.base.segs);
  console.log('dropped  ', fmt(r));
  assert.equal(r.nan, 0);
  assert.ok(r.maxStretch < 1.3);
  assert.ok(r.minDist > sk.params.thickness - 5e-4, 'skirt inside the body after drop');

  assert.ok(st.asleep, 'stocking never went to sleep after settling');
  run(sk, 240);
  assert.ok(sk.asleep, 'skirt never went to sleep after settling');

  // --- Cost ---
  const t0 = performance.now();
  run(st, 120, () => { st.asleep = false; });
  const ms = (performance.now() - t0) / 120;
  console.log(`stocking step: ${ms.toFixed(2)} ms/frame`);
  const t1 = performance.now();
  run(sk, 120, () => { sk.asleep = false; });
  console.log(`skirt step: ${((performance.now() - t1) / 120).toFixed(2)} ms/frame`);
  keep(body, { stocking: st, skirt: sk });
}

// --- Shirt ---
assert.ok(SHIRT.offset + SHIRT.thickness < SKIRT_THICKNESS, 'shirt is thicker than the skirt, so a tucked tank would poke through');
assert.ok(SHIRT.offset + SHIRT.thickness < SKIRT_OFFSET, 'shirt reaches past the skirt waist ring');

for (const [id, shape] of Object.entries(BODIES)) for (const build of [0, 1]) {
  const body = bodyOf(shape, build, build);
  // At full build only the long styles differ: their hems sit in the glute zone.
  for (const style of SHIRT_STYLES.filter((s) => s.top !== undefined && (build === 0 || s.hem < 1.05))) {
    const t0 = performance.now();
    const sh = makeShirt(body, style);
    const built = performance.now() - t0;
    assert.equal(sh.params.thickness, SHIRT.thickness);
    let clear = Infinity;
    for (let i = 0; i < sh.n; i++) clear = Math.min(clear, nearest(body.base.segs, sh.pos[i * 3], sh.pos[i * 3 + 1], sh.pos[i * 3 + 2], hit).d);
    console.log(`\n${id} shirt ${style.id}: ${sh.rings} x ${sh.segs}, built in ${built.toFixed(0)} ms, rest clearance ${mm(clear)} mm`);
    assert.ok(clear >= 0.001, `${id} ${style.id}: shirt closer than 1 mm to the body at rest`);

    run(sh, 60);
    let r = report(sh, body.base.segs);
    assert.equal(r.nan, 0);
    assert.ok(r.maxHome < 0.0005, `${id} ${style.id}: shirt drifts at rest`);
    assert.ok(r.minDist >= 0.001, `${id} ${style.id}: shirt closer than 1 mm after settling`);

    // Front (+z) vertex at mid height: ramp the pull out to 15 cm, hold it, release.
    const v = Math.floor(sh.rings / 2) * sh.segs + sh.segs / 4;
    assert.ok(Math.abs(sh.pos[v * 3]) < 1e-3 && sh.pos[v * 3 + 2] > 0, 'front vertex is not at the front');
    assert.ok(beginGrab(sh, sh.pos[v * 3], sh.pos[v * 3 + 1], sh.pos[v * 3 + 2], 0.035));
    run(sh, 30, (f) => { sh.grab.dz = 0.15 * (f + 1) / 30; });
    run(sh, 30);
    const moved = Math.hypot(sh.pos[v * 3] - sh.home[v * 3], sh.pos[v * 3 + 1] - sh.home[v * 3 + 1], sh.pos[v * 3 + 2] - sh.home[v * 3 + 2]);
    r = report(sh, body.base.segs);
    console.log('pulled   ', fmt(r), ` front vertex ${mm(moved)} mm from home`);
    assert.equal(r.nan, 0);
    assert.ok(moved > 0.12, 'grab did not pull the front vertex');
    assert.ok(r.maxStretch < 8, 'shirt over-stretched');
    assert.ok(r.minDist >= 0.001, `${id} ${style.id}: held shirt sinks into the body`);

    endGrab(sh);
    let settled = -1;
    for (let f = 0; f < 240; f++) {
      stepCloth(sh, DT);
      if (settled < 0 && report(sh, body.base.segs).maxHome < 0.001) settled = f + 1;
    }
    r = report(sh, body.base.segs);
    console.log('released ', fmt(r), ` (within 1mm after ${settled} frames, asleep ${sh.asleep})`);
    assert.equal(r.nan, 0);
    assert.ok(settled > 0 && settled <= 90, `${id} ${style.id}: shirt snap-back too slow`);
    assert.ok(sh.asleep, `${id} ${style.id}: shirt never went to sleep`);
    assert.ok(r.minDist >= 0.001, `${id} ${style.id}: shirt inside the body after release`);

    const t1 = performance.now();
    run(sh, 120, () => { sh.asleep = false; });
    console.log(`shirt step: ${((performance.now() - t1) / 120).toFixed(2)} ms/frame`);
    if (style.id === 'tank') keep(body, { tank: sh });
  }

  // A choker band sits outside the skin and outside the turtleneck's rest surface (offset plus its half thickness).
  const turtle = makeShirt(body, SHIRT_STYLES.find((s) => s.id === 'turtleneck'));
  const fabric = SHIRT.offset + SHIRT.thickness;
  for (const style of CHOKER_STYLES.filter((s) => s.width !== undefined)) {
    const band = buildChokerRest(body, { y: CHOKER.y, width: style.width, offset: CHOKER.offset, nseg: CHOKER.nseg });
    let skin = Infinity, cloth = Infinity;
    for (let i = 0; i < band.pos.length; i += 3) {
      const x = band.pos[i], y = band.pos[i + 1], z = band.pos[i + 2];
      skin = Math.min(skin, nearest(body.base.segs, x, y, z, hit).d);
      for (let k = 0; k < turtle.n; k++) cloth = Math.min(cloth, Math.hypot(x - turtle.home[k * 3], y - turtle.home[k * 3 + 1], z - turtle.home[k * 3 + 2]));
    }
    console.log(`${id} choker ${style.id}: ${band.pos.length / 3} vertices, ${mm(skin)} mm from the skin (fabric ends at ${mm(fabric)} mm), ${mm(cloth)} mm from the nearest turtleneck vertex`);
    assert.ok(skin > fabric + 0.0009, `${id} choker ${style.id}: band not outside the turtleneck`);
    assert.ok(cloth > SHIRT.thickness, `${id} choker ${style.id}: band touches the turtleneck rest vertices`);
  }
}

// --- Pose ---
// Every criterion is checked in every pose before failing, so one run reports all of them.
const DEG = Math.PI / 180;
const failed = [];
const need = (ok, label) => { if (!ok) failed.push(label); return ok ? 'ok' : 'FAIL'; };
const POSES = {
  a: { hipL: 30, kneeL: 60 },
  b: { hipR: 25, hipL: -15, kneeR: 10, kneeL: 35, ankleR: 5, ankleL: -10 },
  c: { hipL: 45, hipR: 45, kneeL: 70, kneeR: 70, ankleL: 25, ankleR: 25 }, // the root then drops the feet to the floor
  d: { root: { y: 0.3 } },
};
const RIGHT_ONLY = { hipR: 30, kneeR: 60 };
const ARM_SWING = { shoulderL: 30, shoulderR: -30, elbowL: 20, elbowR: 20 }, RIGHT_ARM = { shoulderR: 30, elbowR: 20 };
const radians = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? v * DEG : v]));
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
// Lowest point of the leg capsules: the bottom of an end sphere.
const lowestFoot = (body) => {
  const n = body.legs.reduce((s, l) => s + l.segs.length / STRIDE, 0), c = body.live.segs;
  let m = Infinity;
  for (let o = 0; o < n * STRIDE; o += STRIDE) m = Math.min(m, c[o + 1] - c[o + 3], c[o + 1] + c[o + 5] - c[o + 3] - c[o + 7]);
  return m;
};
const clearance = (c, segs) => {
  let m = Infinity;
  for (let i = 0; i < c.n; i++) m = Math.min(m, nearest(segs, c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2], hit).d);
  return m;
};
const fromHome = (c) => { let m = 0; for (let i = 0; i < c.home.length; i += 3) m = Math.max(m, Math.hypot(c.pos[i] - c.home[i], c.pos[i + 1] - c.home[i + 1], c.pos[i + 2] - c.home[i + 2])); return m; };
// Largest distance any vertex strays from where it was, over `frames` frames.
const wobble = (c, frames) => {
  const ref = c.pos.slice();
  let m = 0;
  for (let f = 0; f < frames; f++) {
    stepCloth(c, DT);
    for (let i = 0; i < ref.length; i += 3) m = Math.max(m, Math.hypot(c.pos[i] - ref[i], c.pos[i + 1] - ref[i + 1], c.pos[i + 2] - ref[i + 2]));
  }
  return m;
};

for (const [id, shape] of Object.entries(BODIES)) {
  const { joints, leg } = shape;
  for (const [name, row] of [['hip', 0], ['knee', 4], ['ankle', 9]]) {
    assert.deepEqual(joints[name], leg[row].slice(0, 2), `${id}: ${name} pivot is not on the leg joint`);
  }
}

for (const [id, shape] of Object.entries(BODIES)) for (const build of [0, 1]) {
  console.log(`\n== pose: ${id} thigh ${build} glute ${build}`);
  const body = bodyOf(shape, build, build), kept = garments.get(body);
  const rig = makeRig(body);
  // The mesh sizes main.js draws, so the cost below is the app's.
  // The toes come last, so the indices above stay put.
  const toes = body.legs.flatMap((l, s) => toeSkins(l).map((g, k) => [g, l, `${s ? 'right' : 'left'} toe ${k + 1}`]));
  const skins = [...body.legs.map((l) => legSkin(l)), buildTorso(body), ...body.arms.map(armSkin), buildHead(body), ...toes.map(([g]) => g)];
  const owners = [...body.legs, BLEND, ...body.arms, ROOT, ...toes.map(([, l]) => l)];
  const names = ['left leg', 'right leg', 'torso', 'left arm', 'right arm', 'head', ...toes.map(([, , n]) => n)];
  const live = skins.map((g, m) => track(rig, g.pos, owners[m]));
  const stockings = [makeStocking(body, body.legs[0]), kept.stocking], { skirt, tank: shirt } = kept;
  const cloths = [...stockings, skirt, shirt];
  for (const c of [...stockings, shirt]) resetCloth(c);
  for (let f = 0; f < 2000 && !skirt.asleep; f++) stepCloth(skirt, DT);
  assert.ok(skirt.asleep, 'skirt never slept at rest');
  skirt.initial.set(skirt.pos);
  const snap = cloths.map((c) => [c.pos.slice(), c.prev.slice()]);
  const restCaps = [body.segs.slice(), body.segsCoarse.slice()];
  const restHome = cloths.map((c) => (c.home ?? c.initial).slice());

  for (const [pn, angles] of Object.entries(POSES)) {
    applyPose(rig, cloths, STAND);
    cloths.forEach((c, k) => { c.pos.set(snap[k][0]); c.prev.set(snap[k][1]); c.asleep = true; });
    let pose = makePose(radians(angles));
    if (pn === 'c') {
      applyPose(rig, [], pose);
      pose = makePose({ ...pose, root: { y: -lowestFoot(body) } });
      applyPose(rig, [], STAND);
    }
    // The pose arrives over POSE.ramp frames, as in the app.
    for (let k = 1; k <= POSE.ramp; k++) {
      assert.ok(applyPose(rig, cloths, blendPose(STAND, pose, k / POSE.ramp)));
      if (k === 1) assert.ok(cloths.every((c) => !c.asleep), 'posing did not wake the cloths');
      for (const c of cloths) stepCloth(c, DT);
    }
    if (pn === 'c') assert.ok(Math.abs(lowestFoot(body)) < 1e-6, 'crouch feet are not on the floor');
    const segs = body.live.segs, base = body.live.base.segs;
    const tag = `${id} ${build} (${pn})`;

    // 1. Skin buried in the union is hidden; skin standing off it is not. The torso skin's web across the
    // glute fold, where the hip share is fractional, bridges pelvis and thigh and stands 6 to 15 mm off
    // (measured); it reads as the fold in the browser, so it gets its own bound.
    let out = -Infinity, outAt = '', web = -Infinity;
    live.forEach((p, m) => {
      const r = skins[m].pos, torso = names[m] === 'torso';
      for (let i = 0; i < p.length; i += 3) {
        const d = nearest(segs, p[i], p[i + 1], p[i + 2], hit).d;
        if (torso) { if (d > web) web = d; continue; }
        if (d > out) { out = d; outAt = `${names[m]} at rest x ${r[i].toFixed(3)} ${at(r, i)}`; }
      }
    });
    console.log(`(${pn}) 1. torso fold web ${mm(web)} mm outside: ${need(web <= 0.016, `1 ${tag} torso web ${mm(web)} mm outside`)}`);
    console.log(`(${pn}) 1. skin furthest outside the posed union ${mm(out)} mm, ${outAt}: ${need(out <= 0.005, `1 ${tag} skin ${mm(out)} mm outside`)}`);

    // 3. Torso skin across x = 0.
    {
      const t = skins[2], p = live[2], nseg = t.segs;
      let high = 0, low = 0, lowAt = '';
      for (let i = 1; i < t.rings; i++) for (let j = 0; j < nseg; j++) {
        const a = (i * nseg + j) * 3, b = (i * nseg + (j + 1) % nseg) * 3;
        if ((t.pos[a] < 0) === (t.pos[b] < 0)) continue;
        const d = Math.hypot(p[a] - t.pos[a] - p[b] + t.pos[b], p[a + 1] - t.pos[a + 1] - p[b + 1] + t.pos[b + 1], p[a + 2] - t.pos[a + 2] - p[b + 2] + t.pos[b + 2]);
        if (t.pos[a + 1] > 0.86) high = Math.max(high, d);
        else if (d > low) { low = d; lowAt = at(t.pos, a); }
      }
      console.log(`(${pn}) 3. mid-line neighbours split ${mm(high)} mm above y 0.86: ${need(high <= 0.002, `3 ${tag} mid-line ${mm(high)} mm`)}; below it ${mm(low)} mm${lowAt && ` at rest ${lowAt}`}${pn === 'b' ? `: ${need(low < 0.025, `3 ${tag} mid-line below y 0.86 ${mm(low)} mm`)}` : ''}`);
    }

    if (pn === 'd') {
      const shift = (rest, p) => { let e = 0; for (let i = 0; i < p.length; i += 3) e = Math.max(e, Math.abs(p[i] - rest[i]), Math.abs(p[i + 1] - rest[i + 1] - 0.3), Math.abs(p[i + 2] - rest[i + 2])); return e; };
      const err = Math.max(...live.map((p, m) => shift(skins[m].pos, p)), ...cloths.map((c, k) => shift(restHome[k], c.home ?? c.initial)));
      console.log(`(d) 5. largest departure from a (0, 0.3, 0) shift: ${err.toExponential(1)} m`);
      assert.ok(err < 1e-6, `${tag}: root y is not a pure translation`);
    }

    // 2. Settle 120 frames, then the fabric must hold still. The skirt only has to come to rest.
    for (const c of cloths) {
      if (c.kind === 'skirt') {
        let f = POSE.ramp;
        for (; f < 480 && !c.asleep; f++) stepCloth(c, DT);
        const r = report(c, base);
        console.log(`(${pn}) 2. skirt: ${c.asleep ? `asleep after ${f}` : 'awake after 480'} frames counting the ramp, NaN ${r.nan}, clearance ${mm(r.minDist)} mm: ${need(r.nan === 0 && c.asleep, `2 ${tag} skirt ${c.asleep ? '' : 'awake '}NaN ${r.nan}`)}`);
        continue;
      }
      run(c, 120);
      const w = wobble(c, 60), r = report(c, base);
      const label = c.kind === 'stocking' ? `${c.leg.side < 0 ? 'left' : 'right'} stocking` : c.kind;
      console.log(`(${pn}) 2. ${label}: wobble ${mm(w)} mm over 60 frames, NaN ${r.nan}, stretch x${r.maxStretch.toFixed(2)}: ${need(r.nan === 0 && w < 0.0015, `2 ${tag} ${label} wobble ${mm(w)} mm NaN ${r.nan}`)}`);
      const m = clearance(c, c.kind === 'shirt' ? base : segs); // the arms emerge through the shirt by design
      console.log(`(${pn}) 4. ${label} clearance from the posed union ${mm(m)} mm${pn === 'b' ? `: ${need(m >= 0.0005, `4 ${tag} ${label} clearance ${mm(m)} mm`)}` : ''}`);
      if (c.kind === 'shirt' && (pn === 'a' || pn === 'b')) {
        const m = fromHome(c);
        console.log(`(${pn}) 4. shirt furthest from home ${mm(m)} mm: ${need(m < 0.008, `4 ${tag} shirt ${mm(m)} mm from home`)}`);
      }
    }
    if (pn === 'd') need(cloths.every((c) => c.asleep), `${tag}: a cloth did not settle after a pure translation`);

    resetCloth(stockings[1]);
    assert.ok(maxDiff(stockings[1].pos, stockings[1].home) === 0, `${tag}: reset did not land on the posed home`);
  }

  // 3. Only the right leg posed: nothing of the left leg moves at all.
  applyPose(rig, cloths, makePose(radians(RIGHT_ONLY)));
  const leftMoved = Math.max(...[0, 6, 7, 8, 9, 10].map((m) => maxDiff(live[m], skins[m].pos)), maxDiff(stockings[0].home, restHome[0]));
  console.log(`3. right leg posed, left leg skin and stocking home moved ${leftMoved.toExponential(1)} m`);
  assert.ok(leftMoved === 0, `${id}: posing the right leg moved the left leg`);

  // Arms swing like a stride. The arm skin rides its own capsules, and the left arm ignores the right arm's pose.
  applyPose(rig, cloths, makePose(radians(ARM_SWING)));
  let armOut = -Infinity, armAt = '';
  for (const m of [3, 4]) {
    const p = live[m], r = skins[m].pos;
    for (let i = 0; i < p.length; i += 3) {
      const d = nearest(body.live.segs, p[i], p[i + 1], p[i + 2], hit).d;
      if (d > armOut) { armOut = d; armAt = `${names[m]} at rest x ${r[i].toFixed(3)} ${at(r, i)}`; }
    }
  }
  console.log(`arms swung: skin furthest outside the posed union ${mm(armOut)} mm, ${armAt}`);
  assert.ok(armOut <= 0.002, `${id} ${build}: arm skin ${mm(armOut)} mm outside the posed union`);
  const hand = (m) => skins[m].rings * skins[m].segs * 3 + 2; // z of the end pole, the mitten's tip
  assert.ok(live[3][hand(3)] > skins[3].pos[hand(3)] + 0.1 && live[4][hand(4)] < skins[4].pos[hand(4)] - 0.1, `${id}: positive shoulder does not swing the arm forward`);
  applyPose(rig, cloths, makePose(radians({ elbowR: 20 })));
  assert.ok(live[4][hand(4)] > skins[4].pos[hand(4)] + 0.05, `${id}: positive elbow does not flex the forearm forward`);
  applyPose(rig, cloths, makePose(radians(RIGHT_ARM)));
  const leftArm = maxDiff(live[3], skins[3].pos);
  console.log(`right arm posed, left arm skin moved ${leftArm.toExponential(1)} m`);
  assert.ok(leftArm === 0 && maxDiff(live[0], skins[0].pos) === 0, `${id}: posing the right arm moved the left side`);

  // 7. Cost of one pose change: capsules, tracked skin, every cloth's home and pinned vertices.
  const A = makePose(radians(POSES.b)), B = makePose(radians(POSES.c));
  const N = 20, t0 = performance.now();
  for (let k = 0; k < N; k++) applyPose(rig, cloths, k % 2 ? A : B);
  const cost = (performance.now() - t0) / N;
  const n = live.reduce((s, p) => s + p.length / 3, 0) + cloths.reduce((s, c) => s + c.n, 0) + body.segs.length / STRIDE * 2 + body.segsCoarse.length / STRIDE * 2;
  console.log(`7. pose application: ${cost.toFixed(2)} ms for ${n} points`);
  assert.ok(cost < 2, `${id}: pose application over 2 ms`);

  // 5. Back to STAND.
  applyPose(rig, cloths, STAND);
  const err = Math.max(maxDiff(body.live.segs, restCaps[0]), maxDiff(body.live.segsCoarse, restCaps[1]), ...live.map((p, m) => maxDiff(p, skins[m].pos)),
    ...cloths.map((c, k) => maxDiff(c.home ?? c.initial, restHome[k])), maxDiff(body.segs, restCaps[0]));
  console.log(`5. back at STAND: largest difference from rest ${err.toExponential(1)} m`);
  assert.ok(err <= 1e-6, `${id}: STAND did not restore the rest shape`);
  assert.ok(!applyPose(rig, cloths, makePose()), 'an unchanged STAND did work');
}

// --- Stocking over the skin ---
// The nylon is sheer, so wherever the stocking's surface passes under the drawn skin the skin shows through it.
// Signed distance to a triangle mesh within 1 cm, positive on the side its winding faces; null further off.
function meshDepth(pos, index) {
  const C = 0.01, cell = (v) => Math.floor(v / C), key = (i, j, k) => `${i},${j},${k}`, grid = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    const lo = [0, 1, 2].map((d) => cell(Math.min(pos[a + d], pos[b + d], pos[c + d])));
    const hi = [0, 1, 2].map((d) => cell(Math.max(pos[a + d], pos[b + d], pos[c + d])));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const h = key(i, j, k);
      if (!grid.has(h)) grid.set(h, []);
      grid.get(h).push(t);
    }
  }
  const sub = (o, p) => [pos[o] - p[0], pos[o + 1] - p[1], pos[o + 2] - p[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // Closest point on triangle t to p, by sampling the barycentric clamp of its plane projection and its edges.
  const closest = (t, p) => {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3], A = [pos[a], pos[a + 1], pos[a + 2]];
    const ab = sub(b, A), ac = sub(c, A), ap = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
    const d00 = dot(ab, ab), d01 = dot(ab, ac), d11 = dot(ac, ac), d20 = dot(ap, ab), d21 = dot(ap, ac), den = d00 * d11 - d01 * d01;
    let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
    const at = (v, w) => [A[0] + ab[0] * v + ac[0] * w, A[1] + ab[1] * v + ac[1] * w, A[2] + ab[2] * v + ac[2] * w];
    if (v >= 0 && w >= 0 && v + w <= 1) return at(v, w);
    const seg = (q, r) => { const e = [r[0] - q[0], r[1] - q[1], r[2] - q[2]], s = Math.min(Math.max(dot([p[0] - q[0], p[1] - q[1], p[2] - q[2]], e) / dot(e, e), 0), 1); return [q[0] + e[0] * s, q[1] + e[1] * s, q[2] + e[2] * s]; };
    const cands = [seg(A, at(1, 0)), seg(A, at(0, 1)), seg(at(1, 0), at(0, 1))];
    return cands.reduce((m, q) => (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < Math.hypot(m[0] - p[0], m[1] - p[1], m[2] - p[2]) ? q : m));
  };
  return (x, y, z) => {
    const p = [x, y, z], seen = new Set();
    let best = Infinity, side = 1, align = 0;
    for (let i = cell(x) - 1; i <= cell(x) + 1; i++) for (let j = cell(y) - 1; j <= cell(y) + 1; j++) for (let k = cell(z) - 1; k <= cell(z) + 1; k++) {
      for (const t of grid.get(key(i, j, k)) ?? []) {
        if (seen.has(t)) continue;
        seen.add(t);
        const q = closest(t, p), d = Math.hypot(x - q[0], y - q[1], z - q[2]);
        if (d > best + 1e-9) continue;
        const a = index[t] * 3, n = cross(sub(index[t + 1] * 3, [pos[a], pos[a + 1], pos[a + 2]]), sub(index[t + 2] * 3, [pos[a], pos[a + 1], pos[a + 2]]));
        const cos = dot([x - q[0], y - q[1], z - q[2]], n) / (Math.hypot(...n) * Math.max(d, 1e-12) || 1);
        // Ties at a shared edge or vertex: the face the point lies most squarely off decides the side.
        if (d < best - 1e-9 || Math.abs(cos) > Math.abs(align)) { best = Math.min(best, d); align = cos; side = cos < 0 && d > 1e-9 ? -1 : 1; }
      }
    }
    return best > C ? null : best * side;
  };
}
// Deepest point of a stocking's surface under the skin, sampled at its vertices, edge midpoints and face centres,
// skipping triangles at a crease (a posed home inside the union, where the skin folds into itself). `keep` picks
// triangles by the rest height of their first vertex.
function underSkin(st, depth, rest, segs, keep = () => true, faces = true) {
  const p = st.pos, crease = (i) => nearest(segs, st.home[i * 3], st.home[i * 3 + 1], st.home[i * 3 + 2], hit).d < st.params.thickness;
  const W = faces ? [[1, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]] : [[1, 0, 0]];
  let worst = Infinity, where = '';
  for (let t = 0; t < st.index.length; t += 3) {
    const v = [st.index[t], st.index[t + 1], st.index[t + 2]];
    if (!keep(rest[v[0] * 3 + 1]) || v.some(crease)) continue;
    for (const w of W) {
      const q = [0, 1, 2].map((d) => w[0] * p[v[0] * 3 + d] + w[1] * p[v[1] * 3 + d] + w[2] * p[v[2] * 3 + d]);
      const d = depth(...q);
      if (d !== null && d < worst) { worst = d; where = `ring ${Math.floor(v[0] / st.segs)} at rest ${at(rest, v[0] * 3)}`; }
    }
  }
  return { worst, where };
}
const TOE_REST = 0, TOE_HELD = 0.001;
for (const [id, shape] of Object.entries(BODIES)) {
  const body = bodyOf(shape, 1, 1), leg = body.legs[1], rig = makeRig(body), skin = legSkin(leg), index = gridIndex(skin.rings, skin.segs, true);
  const live = track(rig, skin.pos, leg), st = makeStocking(body, leg), rest = st.home.slice();
  const atRest = underSkin({ ...st, pos: st.home }, meshDepth(skin.pos, index), rest, body.segs);
  console.log(`\n${id} 1: stocking at rest, lowest point of its surface ${mm(atRest.worst)} mm outside the skin, ${atRest.where}: ${need(atRest.worst >= 0, `${id} stocking under the skin at rest ${mm(atRest.worst)} mm`)}`);
  // The toes are meshes of their own; under any of them is under the skin.
  const toes = toeSkins(leg), toeIndex = toes.map((g) => gridIndex(g.rings, g.segs, true, true, true)), toeLive = toes.map((g) => track(rig, g.pos, leg));
  const underToes = (meshes) => { const d = meshes.map((p, k) => meshDepth(p, toeIndex[k])); return (x, y, z) => d.reduce((m, f) => { const v = f(x, y, z); return v === null ? m : m === null ? v : Math.min(m, v); }, null); };
  const toesRest = underSkin({ ...st, pos: st.home }, underToes(toes.map((g) => g.pos)), rest, body.segs);
  console.log(`${id} 1: stocking at rest over the toes, lowest point ${mm(toesRest.worst)} mm outside their skin, ${toesRest.where}: ${need(toesRest.worst >= TOE_REST, `${id} stocking under the toes at rest ${mm(toesRest.worst)} mm`)}`);
  // Held poses from the jump: the bottom of the crouch (the foot kept flat) and the pointed foot of the flight.
  const { crouch: C, point: Pt } = MOTIONS.jump, held = {
    crouch: { hipL: C.hip, hipR: C.hip, kneeL: C.knee, kneeR: C.knee, ankleL: C.knee - C.hip + C.lean, ankleR: C.knee - C.hip + C.lean, root: { pitch: C.lean * DEG } },
    point: { ankleL: Pt.ankle, ankleR: Pt.ankle },
  };
  for (const [pn, angles] of Object.entries(held)) {
    const pose = motionPose(rig, { plant: true, sample: () => ({ pose: makePose(radians(angles)), lift: 0 }) }, 0);
    resetCloth(st);
    for (let k = 1; k <= POSE.ramp; k++) { applyPose(rig, [st], blendPose(STAND, pose, k / POSE.ramp)); stepCloth(st, DT); }
    run(st, 120);
    const depth = meshDepth(live, index), segs = body.live.segs;
    const vert = underSkin(st, depth, rest, segs, undefined, false), knee = underSkin(st, depth, rest, segs, (y) => y > 0.38 && y < 0.56);
    console.log(`${id} 1 held ${pn}: lowest stocking vertex ${mm(vert.worst)} mm outside the skin, ${vert.where}: ${need(vert.worst >= -3e-4, `${id} ${pn} stocking vertex ${mm(vert.worst)} mm off the skin`)}; lowest point of its surface over the knee ${mm(knee.worst)} mm, ${knee.where}: ${need(knee.worst >= 0, `${id} ${pn} knee surface ${mm(knee.worst)} mm off the skin`)}`);
    const toeVert = underSkin(st, underToes(toeLive), rest, segs, undefined, false);
    console.log(`${id} 1 held ${pn}: lowest stocking vertex over the toes ${mm(toeVert.worst)} mm outside their skin, ${toeVert.where}: ${need(toeVert.worst >= TOE_HELD, `${id} ${pn} stocking vertex ${mm(toeVert.worst)} mm under the toes`)}`);
    if (pn !== 'point') continue;
    // Planted on the pointed foot, the toes bend up to lie on the floor: every toe's tip on it, none under.
    const L = body.live.segs, toeSlots = leg.toes.map((t) => t.segs.length / STRIDE);
    let o = (body.legs[0].segs.length + leg.segs.length) / STRIDE - toeSlots.reduce((a, b) => a + b, 0);
    const tips = toeSlots.map((n) => { o += n; const q = (o - 1) * STRIDE; return L[q + 1] + L[q + 5] - L[q + 3] - L[q + 7]; });
    console.log(`${id} 1 held point: toes bent ${(pose.toeR / DEG).toFixed(1)} deg, their tips ${tips.map(mm).join(' / ')} mm over the floor: ${need(pose.toeR > 0 && tips.every((y) => y >= -5e-4 && y <= 0.002), `${id} point toes ${(pose.toeR / DEG).toFixed(1)} deg, tips ${tips.map(mm)} mm`)}`);
  }
  applyPose(rig, [st], STAND);
}

// Motions: walk and jump drive the figure through the state machine with every garment on, as the app does.
// Least squares y = c0 + c1 t + c2 t^2 through [frame, _, y] samples, t in seconds.
function parabola(q) {
  const S = Array(5).fill(0), R = [0, 0, 0];
  for (const [f, , y] of q) { const t = f * DT; for (let k = 0; k < 5; k++) S[k] += t ** k; for (let k = 0; k < 3; k++) R[k] += y * t ** k; }
  const A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? R[i] : v)))) / D);
}
const G = 9.8;
for (const [id, shape] of Object.entries(BODIES)) for (const build of [0, 1]) {
  const tag = `${id} ${build}`;
  console.log(`\n== motion: ${tag}`);
  const body = buildBody(shape, { thigh: build, glute: build }, STOCKING_BAND);
  const rig = makeRig(body);
  for (const [g, o] of [...body.legs.flatMap((l) => [legSkin(l), ...toeSkins(l)].map((g) => [g, l])), [buildTorso(body), BLEND], ...body.arms.map((a) => [armSkin(a), a]), [buildHead(body), ROOT]]) track(rig, g.pos, o);
  const M = buildMotions(rig);
  const stockings = body.legs.map((l) => makeStocking(body, l)), skirt = makeSkirt(body), shirt = makeShirt(body, SHIRT_STYLES.find((s) => s.id === 'tank'));
  const cloths = [...stockings, skirt, shirt], tethered = [...stockings, shirt];
  for (let f = 0; f < 2000 && !build && !skirt.asleep; f++) stepCloth(skirt, DT);
  const ringY = (r) => { let s = 0; for (let j = 0; j < skirt.segs; j++) s += skirt.pos[(r * skirt.segs + j) * 3 + 1]; return s / skirt.segs; };
  const hemRise = () => ringY(skirt.rings - 1) - ringY(0); // hem height over the waist
  const hang = hemRise();
  const nan = () => cloths.reduce((n, c) => n + c.pos.reduce((k, v) => k + !Number.isFinite(v), 0), 0);
  const step = (pose) => { applyPose(rig, cloths, pose); for (const c of cloths) stepCloth(c, DT); };
  const F = { low: [0, 0], z: 0 };
  // Creases: a vertex whose posed home is itself inside the union cannot sit clear of it or on its home.
  const crease = (c, segs, o) => nearest(segs, c.home[o], c.home[o + 1], c.home[o + 2], hit).d < c.params.thickness;
  const strayed = (c) => {
    let m = 0;
    for (let o = 0; o < c.pos.length; o += 3) {
      const v = Math.hypot(c.pos[o] - c.home[o], c.pos[o + 1] - c.home[o + 1], c.pos[o + 2] - c.home[o + 2]);
      if (v > m && !crease(c, body.live.segs, o)) m = v;
    }
    return m;
  };
  const clearOf = (c) => {
    const segs = c.kind === 'shirt' ? body.live.base.segs : body.live.segs; // the arms emerge through the shirt
    let m = Infinity;
    for (let o = 0; o < c.pos.length; o += 3) if (!crease(c, segs, o)) m = Math.min(m, nearest(segs, c.pos[o], c.pos[o + 1], c.pos[o + 2], hit).d);
    return m;
  };

  // ---- walk: 4 cycles after a 1 s warm-up
  {
    const w = M.walk, cycle = Math.round(w.period / DT);
    let per = 0, mir = 0;
    for (let k = 0; k < 50; k++) {
      const t = k * w.period / 50 + 0.37, a = motionPose(rig, w, t), b = motionPose(rig, w, t + w.period), c = motionPose(rig, w, t + w.period / 2);
      for (const key of Object.keys(a)) if (key !== 'root') per = Math.max(per, Math.abs(a[key] - b[key]));
      for (const key of ['y', 'z', 'pitch']) per = Math.max(per, Math.abs(a.root[key] - b.root[key]));
      for (const j of ['hip', 'knee', 'ankle', 'toe', 'shoulder', 'elbow']) mir = Math.max(mir, Math.abs(a[j + 'L'] - c[j + 'R']), Math.abs(a[j + 'R'] - c[j + 'L']));
      mir = Math.max(mir, Math.abs(a.root.y - c.root.y), Math.abs(a.root.pitch - c.root.pitch));
    }
    console.log(`walk: ${(2 / w.period).toFixed(2)} steps/s; pose(t) vs pose(t + cycle) ${per.toExponential(1)}: ${need(per < 1e-9, `${tag} walk not periodic ${per}`)}; left vs right half a cycle on ${mir.toExponential(1)}: ${need(mir < 1e-9, `${tag} walk not mirrored ${mir}`)}`);

    if (build) {
      // The thicker builds share the feet, so the cloth runs stay on build 0 (the suite's time limit); the gait's
      // floor contact is checked here from the poses alone.
      let lo = Infinity, hi = -Infinity;
      for (let f = 0; f < 4 * cycle; f++) {
        const t = 1 + f * DT, pose = motionPose(rig, w, t), low = feetOf(rig, pose, F).low, p = (t / w.period) % 1;
        [p, (p + 0.5) % 1].forEach((q, k) => { if (q >= w.stance[0] && q <= w.stance[1]) { lo = Math.min(lo, low[k]); hi = Math.max(hi, low[k]); } });
      }
      console.log(`walk 4 cycles, poses only: stance foot ${mm(lo)} to ${mm(hi)} mm above the floor: ${need(lo >= -5e-4 && hi <= 3e-3, `${tag} walk stance foot ${mm(lo)}..${mm(hi)} mm`)}`);
      continue;
    }
    const d = makeDriver(); want(d, 'walk');
    for (let f = 0; f < 60; f++) step(drive(d, DT, rig, M));
    for (const c of cloths) c.fallbacks = 0;
    let stance = [Infinity, -Infinity], clear = Infinity, home = 0, hemZ = [Infinity, -Infinity], hemLow = Infinity, hemOut = 0;
    for (let f = 0; f < 4 * cycle; f++) {
      const pose = drive(d, DT, rig, M);
      step(pose);
      const low = feetOf(rig, pose, F).low, p = (d.t / w.period) % 1;
      [p, (p + 0.5) % 1].forEach((q, k) => { if (q >= w.stance[0] && q <= w.stance[1]) { stance[0] = Math.min(stance[0], low[k]); stance[1] = Math.max(stance[1], low[k]); } });
      for (const c of stockings) home = Math.max(home, strayed(c));
      if (f % 12 === 0) for (const c of tethered) clear = Math.min(clear, clearOf(c));
      let z = 0;
      for (let j = 0, o = (skirt.rings - 1) * skirt.segs * 3; j < skirt.segs; j++, o += 3) {
        z += skirt.pos[o + 2]; hemLow = Math.min(hemLow, skirt.pos[o + 1]); hemOut = Math.max(hemOut, Math.hypot(skirt.pos[o], skirt.pos[o + 2]));
      }
      z /= skirt.segs; hemZ = [Math.min(hemZ[0], z), Math.max(hemZ[1], z)];
    }
    const sway = hemZ[1] - hemZ[0], falls = cloths.map((c) => c.fallbacks), n = nan();
    console.log(`walk 4 cycles: NaN ${n}: ${need(n === 0, `${tag} walk NaN`)}; stance foot ${mm(stance[0])} to ${mm(stance[1])} mm above the floor: ${need(stance[0] >= -5e-4 && stance[1] <= 3e-3, `${tag} walk stance foot ${mm(stance[0])}..${mm(stance[1])} mm`)}`);
    console.log(`walk: stocking and shirt clearance off the posed union outside creases ${mm(clear)} mm: ${need(clear >= 4e-4, `${tag} walk clearance ${mm(clear)} mm`)}; stocking furthest from home ${mm(home)} mm: ${need(home < 0.01, `${tag} walk stocking ${mm(home)} mm from home`)}`);
    console.log(`walk: candidate fallbacks ${falls.join('/')}: ${need(falls.every((v) => v === 0), `${tag} walk fallbacks ${falls}`)}; hem sways ${mm(sway)} mm front to back, lowest ${mm(hemLow)} mm, widest ${mm(hemOut)} mm: ${need(sway > 2e-3 && sway < 0.1 && hemLow > 0.3 && hemOut < 0.4, `${tag} walk hem sway ${mm(sway)} low ${mm(hemLow)} out ${mm(hemOut)}`)}`);
    {
      // Grabbed while walking: the held patch is drawn after the pointer in the world, and lets go cleanly. Standing,
      // the same 13 cm pull leaves the held vertex 37 mm short (measured), the fabric pulling back on it.
      let o = (skirt.rings - 1) * skirt.segs * 3;
      for (let j = 0, q = o; j < skirt.segs; j++, q += 3) if (skirt.pos[q] > skirt.pos[o]) o = q; // the hem's outer side
      const x = skirt.pos[o], y = skirt.pos[o + 1], z = skirt.pos[o + 2];
      need(beginGrab(skirt, x, y, z, 0.05), `${tag} walk grab missed`);
      for (let f = 1; f <= 30; f++) { skirt.grab.dx = 0.12 * f / 30; skirt.grab.dy = 0.05 * f / 30; step(drive(d, DT, rig, M)); }
      const held = ((skirt.pos[o] - x) * 0.12 + (skirt.pos[o + 1] - y) * 0.05) / 0.13 / 0.13; // share of the pull
      endGrab(skirt);
      for (let f = 0; f < 30; f++) step(drive(d, DT, rig, M));
      const n = nan();
      console.log(`walk: skirt hem pulled 13 cm while walking follows ${(held * 100).toFixed(0)}% of the pull: ${need(held > 0.6 && held < 1.05, `${tag} walk grab ${held}`)}; NaN after release ${n}: ${need(n === 0, `${tag} walk grab NaN`)}`);
    }
    want(d, 'stand');
    for (let f = 0; f < 120 && d.state !== 'still'; f++) step(drive(d, DT, rig, M));
    need(d.state === 'still', `${tag} walk did not stop`);
  }

  // ---- jump: 3 jumps, then stand
  {
    const d = makeDriver(); want(d, 'jump');
    let prevY = 0, prevV = 0, lowest = Infinity, home = 0, lag = 0, kick = 0, lift = -Infinity, lastLand = -1;
    let flight = null; // airborne samples of the current jump: [frame, lowest foot, root y]
    const jumps = [], contacts = [], dv = [], offs = [], aloft = [];
    for (let f = 0; f < 2400 && (lastLand < 0 || f < lastLand + 90); f++) {
      const pose = drive(d, DT, rig, M);
      step(pose);
      const y = pose.root.y, v = (y - prevY) / DT, low = Math.min(...feetOf(rig, pose, F).low);
      lowest = Math.min(lowest, low);
      const off = Math.max(...stockings.map(strayed));
      home = Math.max(home, off);
      // While blending in, STAND's few millimetres of foot gap fade out; only a full jump leaves the floor.
      if (low > 1e-6 && d.state === 'run') {
        if (!flight) { flight = []; lift = -Infinity; contacts.push(f); }
        flight.push([f, low, y]);
        if (y < prevY) lift = Math.max(lift, hemRise() - hang); // the descent
      } else if (flight) {
        contacts.push(f);
        // The root flies a parabola; the feet leave and meet the floor at the flight's speed, so a line through
        // the two samples nearest each contact finds it to well under a frame.
        const fit = parabola(flight), [a0, a1] = flight, [z1, z0] = flight.slice(-2);
        const t0 = a0[0] - a0[1] / (a1[1] - a0[1]), t1 = z0[0] + z0[1] / (z1[1] - z0[1]);
        const v0 = fit[1] + 2 * fit[2] * t0 * DT, apex = Math.max(...flight.map((q) => q[2]));
        jumps.push({ apex, flight: (t1 - t0) * DT, v0, g: -2 * fit[2], lift });
        flight = null;
        if (jumps.length === 3) { want(d, 'stand'); lastLand = f; }
      }
      dv[f] = f > 1 ? Math.abs(v - prevV + G * DT) : 0; offs[f] = off; aloft[f] = !!flight;
      prevV = v; prevY = y;
    }
    // In the air and around each contact the body accelerates hardest, and the knit's own shape barely changes.
    offs.forEach((o, f) => { if (aloft[f] || contacts.some((c) => Math.abs(c - f) <= 3)) lag = Math.max(lag, o); });
    // The frame pairs that straddle a contact; further out the push's own acceleration shows.
    let near2 = 0;
    for (const c of contacts) for (let f = c - 2; f <= c + 2; f++) { if (f >= c - 1 && f <= c + 1) kick = Math.max(kick, dv[f] ?? 0); near2 = Math.max(near2, dv[f] ?? 0); }
    const n = nan(), settled = Math.abs(hemRise() - hang);
    for (const [k, q] of jumps.entries()) {
      const T = 2 * q.v0 / G;
      console.log(`jump ${k + 1}: root apex ${q.apex.toFixed(3)} m: ${need(q.apex >= 0.22 && q.apex <= 0.32, `${tag} jump apex ${q.apex}`)}; flight ${q.flight.toFixed(3)} s, 2v0/g ${T.toFixed(3)} s (v0 ${q.v0.toFixed(2)} m/s, fitted g ${q.g.toFixed(2)}): ${need(Math.abs(q.flight / T - 1) < 0.05, `${tag} jump flight ${q.flight} vs ${T}`)}; hem rises ${(q.lift * 100).toFixed(1)} cm over the waist in the descent: ${need(q.lift >= 0.04, `${tag} jump hem lift ${q.lift}`)}`);
    }
    console.log(`jump: ${jumps.length} jumps: ${need(jumps.length === 3, `${tag} ${jumps.length} jumps`)}; NaN ${n}: ${need(n === 0, `${tag} jump NaN`)}; root velocity change beyond gravity's across a contact ${kick.toFixed(3)} m/s: ${need(kick <= 0.3, `${tag} jump kick ${kick}`)} (${near2.toFixed(3)} within 2 frames); lowest foot ${mm(lowest)} mm: ${need(lowest >= -5e-4, `${tag} jump foot ${mm(lowest)} mm`)}`);
    console.log(`jump: stocking furthest from home in the air and within 3 frames of a contact ${mm(lag)} mm: ${need(lag < 0.01, `${tag} jump stocking lag ${mm(lag)} mm`)}; over the whole jump, deep crouch included, ${mm(home)} mm`);
    console.log(`jump: hem 1.5 s after the last landing ${mm(settled)} mm from hanging: ${need(settled < 0.01, `${tag} jump hem settle ${mm(settled)} mm`)}`);
    for (let f = 0; f < 240 && d.state !== 'still'; f++) step(drive(d, DT, rig, M));
  }

  // ---- transitions: stand, walk, jump, stand. A rebuild mid-walk restarts the motion from STAND.
  {
    const d = makeDriver(), seen = new Set();
    const go = (frames) => { for (let f = 0; f < frames; f++) { step(drive(d, DT, rig, M)); seen.add(d.state); } };
    want(d, 'walk'); go(60);
    restart(d);
    const back = d.state === 'in' && d.amp === 0 && d.t === 0;
    go(60); want(d, 'jump'); go(150); want(d, 'stand');
    let f = 0;
    for (; f < 400 && d.state !== 'still'; f++) go(1);
    const exact = rig.pose === STAND && body.live.segs.every((v, i) => v === body.segs[i]);
    let k = 0;
    for (; k < 480 && !cloths.every((c) => c.asleep); k++) go(1);
    console.log(`transitions: states ${[...seen].join(' ')}; restart blends in again: ${need(back, `${tag} restart`)}; still ${f} frames after asking: ${need(d.state === 'still', `${tag} never stood`)}; exact STAND: ${need(exact, `${tag} not exact STAND`)}; all cloths asleep ${k} frames later: ${need(k < 480, `${tag} cloths awake after 480 frames`)}; NaN ${nan()}: ${need(nan() === 0, `${tag} transitions NaN`)}`);
  }

  // ---- damping and friction act relative to the body: a constant-velocity glide leaves the fabric on its home
  {
    const keep = cloths.map((c) => [c.params.inertia, c.params.drag]);
    for (const c of cloths) { c.params.inertia = 0; c.params.drag = 0; }
    // A world-frame damping or friction would brake the fabric in proportion to the glide's speed; relative to the
    // body, two speeds end alike. The skirt glides at both speeds from one state, and against standing still awake.
    const N = 90, start = cloths.map((c) => [c.pos.slice(), c.prev.slice()]);
    const glide = (v) => {
      cloths.forEach((c, k) => { c.pos.set(start[k][0]); c.prev.set(start[k][1]); c.asleep = false; });
      let m = 0;
      for (let f = 1; f <= N; f++) {
        if (v) step(makePose({ root: { y: v * f * DT } })); else for (const c of cloths) { c.asleep = false; stepCloth(c, DT); }
        if (f > 30) for (const c of tethered) m = Math.max(m, strayed(c));
      }
      const end = skirt.pos.slice();
      for (let o = 1; o < end.length; o += 3) end[o] -= v * N * DT;
      applyPose(rig, cloths, STAND);
      return [m, end];
    };
    const apart = (a, b) => { let m = 0; for (let o = 0; o < a.length; o += 3) m = Math.max(m, Math.hypot(a[o] - b[o], a[o + 1] - b[o + 1], a[o + 2] - b[o + 2])); return m; };
    const [, still] = glide(0), [slowOff, slow] = glide(0.5), [fastOff, fast] = glide(2);
    const worst = Math.max(slowOff, fastOff), speeds = apart(slow, fast);
    console.log(`glide at 0.5 and 2 m/s: stockings and shirt furthest from home ${mm(worst)} mm; skirt ends ${mm(speeds)} mm apart between the speeds, ${mm(apart(slow, still))} mm off standing still: ${need(worst < 1e-4 && speeds < 5e-5, `${tag} glide ${mm(worst)} / ${mm(speeds)} mm`)}`);
    cloths.forEach((c, i) => { [c.params.inertia, c.params.drag] = keep[i]; });
    for (let f = 0; f < 60; f++) step(STAND);
  }

  // ---- frame budget: posing and every cloth stepping, walking or jumping, median of 5 runs
  if (id === 'feminine') {
    const runs = [];
    for (let r = 0; r < 5; r++) {
      const d = makeDriver(); want(d, r % 2 ? 'jump' : 'walk');
      for (let f = 0; f < 20; f++) step(drive(d, DT, rig, M));
      const t0 = performance.now();
      for (let f = 0; f < 60; f++) step(drive(d, DT, rig, M)); // a jump's 60 frames hold the push and the flight
      runs.push((performance.now() - t0) / 60);
      if (!cloths.every((c) => !c.asleep)) runs[r] = NaN;
    }
    const sorted = [...runs].sort((a, b) => a - b), med = sorted[2];
    console.log(`budget: posing + 2 stockings, skirt and tank shirt awake: median ${med.toFixed(2)} ms/frame over 5 runs of 60 frames (${sorted.map((v) => v.toFixed(2)).join(', ')}): ${need(med < 12, `${tag} frame ${med.toFixed(2)} ms`)}`);
  }
}

// Every colourway has a swatch, and a patterned stocking entry has what the shader needs.
for (const e of [...SHIRT_COLORS, ...CHOKER_COLORS, ...STOCKING_COLORS]) assert.ok(colourCss(e), `${e.id}: no swatch`);
assert.ok(SHIRT_COLORS.filter((e) => e.pattern === 'solid').length >= 5 && SHIRT_COLORS.filter((e) => e.pattern !== 'solid').length >= 5);
assert.ok(CHOKER_COLORS.filter((e) => e.pattern === 'solid').length >= 4 && CHOKER_COLORS.filter((e) => e.pattern !== 'solid').length >= 3);
assert.ok(STOCKING_COLORS.filter((e) => e.pattern === 'stripes' && e.sheen).length >= 3);

for (const [id, ok] of squeezeOk) assert.ok(ok, `${id}: squeeze does not grow with thickness`);
const total = performance.now() / 1000;
console.log(`\ntotal ${total.toFixed(1)} s: ${need(total < 170, `8 npm test took ${total.toFixed(1)} s`)}`);
assert.equal(failed.length, 0, `criteria failed:\n  ${failed.join('\n  ')}`);
console.log('ok');
