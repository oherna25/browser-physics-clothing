// Garment construction shared by the browser app and the headless test.

import { makeGridCloth, setCollider, concatSegs, nearest, gridIndex, STRIDE } from './cloth.js';
import { sweepLimb, buildSkirt, buildShirtRest, ringRadii, handSkin, SKIRT_WAIST_Y } from './body.js';
import { SHIRT, STOCKING_MOTION, SKIRT_MOTION, BUILD } from './presets.js';
import { bounceSlack, onFoot } from './pose.js';

export const SKIRT_THICKNESS = 0.005;
export const STOCKING_TOP_Y = 0.63;
export const STOCKING_BAND = { y: STOCKING_TOP_Y, width: 0.028 };

// A collider cut from the rest coarse legs and torso chosen by `keep`. The picked indices let a pose refresh it
// from body.live.segsCoarse, which the full collider used while dragged, arms and head included, reads directly.
// `slack(i, k)` takes k as the coarse capsule slot, where setCollider's own takes the picked offset.
function pickCollider(cloth, body, keep, slack = null) {
  const c = body.base.segsCoarse, idx = [];
  for (let o = 0; o < c.length; o += STRIDE) if (keep(c, o)) idx.push(o / STRIDE);
  setCollider(cloth, concatSegs(...idx.map((k) => c.subarray(k * STRIDE, (k + 1) * STRIDE))), undefined, slack && ((i, o) => slack(i, idx[o / STRIDE])));
  cloth.colliderPick = new Uint32Array(idx);
  cloth.colliderFull = body.live.segsCoarse;
}

// The stocking's grid, which the leg skin shares on the foot: there a ring sweep fans out over the heel and steps
// across the arch, so two grids of different pitch cut different chords and the coarser stocking's dipped up to
// 4.6 mm under the skin at rest (measured). Above the foot the skin is about twice as fine.
const LEG_SEGS = 44, CAP_RINGS = 5, SKIN_PITCH = 0.004, FOOT_Y = 0.15, TOE_PITCH = 0.0035;

// Arc lengths of the stocking's rings: from its top at the leg's knit pitch down to the first ring below FOOT_Y, then
// spread evenly to the toes about as far apart. The second value is that first ring's index.
function stockingRings(leg) {
  const s0 = leg.sAtY(STOCKING_TOP_Y), foot = leg.sAtY(FOOT_Y), at = [];
  while (s0 + leg.knit * at.length < foot) at.push(s0 + leg.knit * at.length);
  const k = at.length, sk = s0 + leg.knit * k, end = leg.length + leg.front - BUILD.foot.cap, n = Math.ceil((end - sk) / leg.knit);
  for (let j = 0; j <= n; j++) at.push(sk + (end - sk) * j / n);
  return [at, k];
}

// The leg down to the front of the foot's body, where its cap stays inside the toes.
export function legSkin(leg) {
  const [at, k] = stockingRings(leg), s = at[k], n = Math.ceil(s / SKIN_PITCH), rings = [];
  for (let i = 0; i < n; i++) rings.push(s * i / n);
  for (let i = k; i < at.length && at[i] <= leg.footEnd; i++) rings.push(at[i]);
  return sweepLimb({ ...leg, segs: leg.body }, 0, rings[rings.length - 1], rings, LEG_SEGS, 0, CAP_RINGS);
}

// One tube per toe, closed at both ends, about TOE_PITCH between rings and columns.
export function toeSkins(leg) {
  return leg.toes.map((toe) => {
    const nseg = 2 * Math.ceil(Math.PI * toe.r / TOE_PITCH);
    return sweepLimb(toe, 0, toe.length, Math.ceil(toe.length / TOE_PITCH) + 1, nseg, 0, 4, 4);
  });
}

const ARM_PITCH = 0.0047, ARM_SEGS = 40;

// The arm from the shoulder to where the hand's skin covers it, and the hand.
export function armSkins(arm) {
  const { from, ramp } = BUILD.hand.join, s1 = arm.length - from + ramp + 2 * ARM_PITCH;
  return [sweepLimb({ ...arm, segs: arm.forearm }, 0, s1, Math.ceil(s1 / ARM_PITCH) + 1, ARM_SEGS, 0, 0, 6), handSkin(arm)];
}

// On the foot some rays graze a toe or leave the union steeply, so they end nearer it than the sweep's offset and the
// knit's thickness would push them off home at rest. Those points step out along the nearest capsule's normal.
function clearFoot(pos, segs, offset, from = 0) {
  const hit = {};
  for (let o = from * 3; o < pos.length; o += 3) {
    for (let k = 0; k < 2 && pos[o + 1] < FOOT_Y; k++) {
      if (nearest(segs, pos[o], pos[o + 1], pos[o + 2], hit).d >= offset) break;
      const s = offset - hit.d;
      pos[o] += hit.nx * s; pos[o + 1] += hit.ny * s; pos[o + 2] += hit.nz * s;
    }
  }
  return pos;
}

// Knit pulled over the foot spans the hollows between the toes and rows instead of following them into creases: a few
// rounds of smoothing the foot's rings toward their neighbours, each followed by stepping out what that pulled under
// the offset. The smoothing ramps in over the first rings so the leg above keeps its shape.
function wrapFoot(g, k, segs, offset) {
  const { pos, rings, segs: n } = g, pole = rings * n, was = new Float32Array(pos.length), { rounds, pull, ramp } = BUILD.foot.wrap;
  for (let it = 0; it < rounds; it++) {
    was.set(pos);
    for (let i = k + 1; i < rings; i++) {
      const w = pull * Math.min(1, (i - k) / ramp), up = (i - 1) * n, down = i + 1 < rings ? (i + 1) * n : -1;
      for (let j = 0; j < n; j++) {
        const o = (i * n + j) * 3, a = (i * n + (j + 1) % n) * 3, b = (i * n + (j + n - 1) % n) * 3, c = (up + j) * 3, e = (down < 0 ? pole : down + j) * 3;
        for (let d = 0; d < 3; d++) pos[o + d] += w * ((was[a + d] + was[b + d] + was[c + d] + was[e + d]) / 4 - was[o + d]);
      }
    }
    for (let d = 0, o = pole * 3; d < 3; d++) {
      let m = 0;
      for (let j = 0; j < n; j++) m += was[((rings - 1) * n + j) * 3 + d];
      pos[o + d] += pull * (m / n - was[o + d]);
    }
    clearFoot(pos, segs, offset, k * n);
  }
}

// A triangle between points that clear the union can still cut into it where the union bends sharply under it, as
// over a toe's tip. Points on a barycentric grid of every foot triangle that come nearer the union than `margin`
// move it out along the capsule's normal, shared among its corners by their weights at that point.
const FACE_GRID = [];
for (let i = 0; i <= 4; i++) for (let j = 0; i + j <= 4; j++) FACE_GRID.push([i / 4, j / 4, (4 - i - j) / 4]);
function clearFaces(g, k, segs, margin) {
  const { pos } = g, ix = gridIndex(g.rings, g.segs, true), hit = {}, from = k * g.segs;
  for (let it = 0; it < 4; it++) {
    let moved = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      if (ix[t] < from || ix[t + 1] < from || ix[t + 2] < from) continue;
      for (const [u, v, w] of FACE_GRID) {
        const x = u * pos[a] + v * pos[b] + w * pos[c], y = u * pos[a + 1] + v * pos[b + 1] + w * pos[c + 1], z = u * pos[a + 2] + v * pos[b + 2] + w * pos[c + 2];
        if (nearest(segs, x, y, z, hit).d >= margin - 1e-5) continue; // within float32 rounding of the margin
        const s = (margin - hit.d) / (u * u + v * v + w * w);
        for (const [o, q] of [[a, u], [b, v], [c, w]]) { pos[o] += hit.nx * s * q; pos[o + 1] += hit.ny * s * q; pos[o + 2] += hit.nz * s * q; }
        moved++;
      }
    }
    if (!moved) break;
  }
}

// The leg's capsules that reach below `y`: all the foot's rings can come near.
function capsulesBelow(segs, y) {
  const keep = [];
  for (let o = 0; o < segs.length; o += STRIDE) if (Math.min(segs[o + 1] - segs[o + 3], segs[o + 1] + segs[o + 5] - segs[o + 3] - segs[o + 7]) < y) keep.push(segs.subarray(o, o + STRIDE));
  return concatSegs(...keep);
}

// The stocking's rest shape from leg's union `box`, its first foot ring k.
function stockingShape(leg, segs, rings, k, offset) {
  const g = sweepLimb({ ...leg, segs: leg.box }, rings[0], rings[rings.length - 1], rings, segs, offset, CAP_RINGS), near = capsulesBelow(leg.segs, FOOT_Y + 0.03);
  clearFoot(g.pos, near, offset);
  wrapFoot(g, k, near, offset);
  clearFaces(g, k, near, BUILD.foot.face);
  return g;
}

export function makeStocking(body, leg) {
  const [rings, k] = stockingRings(leg), s0 = rings[0], s1 = rings[rings.length - 1], segs = LEG_SEGS, offset = 0.0015;
  const g = stockingShape(leg, segs, rings, k, offset);
  const cloth = makeGridCloth({
    pos: g.pos, rings: g.rings, segs: g.segs, pole: true, pinRings: [0], pinPole: true,
    home: g.pos.slice(),
    params: {
      compliance: [1.2e-5, 2.4e-5, 0], // stretchy knit
      homeK: 45 * 45,                  // tether frequency squared
      damping: 9,
      thickness: 0.001,
      friction: 0.15,
      ...STOCKING_MOTION,
    },
  });
  // Below the ankle's blend the knit is pinned home, which the field moves with the skin under it: a foot's knit is
  // held by its fit. Left free, its triangles slid up to 4 mm through a stride and cut across the heel and the toes'
  // tips, and the sole under a bent ball pulled taut through the skin by 1.2 mm (measured).
  const rigid = onFoot(body, leg, g.pos);
  for (let i = k * segs; i < cloth.n; i++) if (rigid[i]) cloth.w[i] = 0;
  setCollider(cloth, body.live.base.segs);
  cloth.colliderFull = body.live.segs;
  cloth.kind = 'stocking';
  cloth.leg = leg; // the pose turns its home with this leg alone
  cloth.bodyRings = rings.length; // rings before the toe cap

  // The knit is cut for the unmodified leg, so a thicker one starts out pre-stretched.
  // Rest lengths stay at home length; this only feeds the sheer shader.
  cloth.preStretch = new Float32Array(cloth.n).fill(1);
  if (leg.ref) {
    const gr = stockingShape(leg.ref, segs, rings, k, offset);
    const a = ringRadii(leg, g, s0, s1, rings), b = ringRadii(leg.ref, gr, s0, s1, rings);
    for (let i = 0; i < g.rings; i++) cloth.preStretch.fill(Math.max(a[i] / b[i], 1), i * segs, (i + 1) * segs);
  }
  return cloth;
}

export function makeSkirt(body) {
  const g = buildSkirt(body);
  const cloth = makeGridCloth({
    pos: g.pos, rings: g.rings, segs: g.segs, bend: true, pinRings: [0, 1],
    params: {
      compliance: [0, 2e-6, 4e-5],
      damping: 1.6,
      gravity: 9.8,
      thickness: SKIRT_THICKNESS,
      friction: 0.35,
      ...SKIRT_MOTION,
    },
  });
  // The skirt hangs from the waist and cannot reach below its own length unaided, nor above its
  // waist ring, so it only needs the capsules between the knee and just above the waist. Dropping
  // the torso rows under the waist ring leaves the pinned rings over a crease and the skirt never sleeps.
  const reach = 0.55, ceiling = SKIRT_WAIST_Y + 0.01;
  pickCollider(cloth, body, (c, o) => {
    const top = Math.max(c[o + 1], c[o + 1] + c[o + 5]) + c[o + 3];
    const axisBottom = Math.min(c[o + 1], c[o + 1] + c[o + 5]);
    return top > reach && axisBottom < ceiling;
  });
  cloth.kind = 'skirt';
  cloth.pleats = g.pleats;
  return cloth;
}

// Knit shirt: a tube of rings hung from a pinned top ring, tethered home like the stocking.
export function makeShirt(body, style) {
  const g = buildShirtRest(body, style, SHIRT);
  const cloth = makeGridCloth({
    pos: g.pos, rings: g.rings, segs: g.segs, pinRings: [0], home: g.pos.slice(),
    params: { ...SHIRT.params, thickness: SHIRT.thickness },
  });
  // Only the capsules within reach of the shirt's height range; the grab swaps in the full set.
  const lo = style.hem - 0.03, hi = style.top + 0.03;
  pickCollider(cloth, body, (c, o) => {
    const r = Math.max(c[o + 3], c[o + 3] + c[o + 7]);
    const y0 = Math.min(c[o + 1], c[o + 1] + c[o + 5]) - r, y1 = Math.max(c[o + 1], c[o + 1] + c[o + 5]) + r;
    return y1 > lo && y0 < hi;
  }, bounceSlack(body, cloth.home));
  cloth.kind = 'shirt';
  return cloth;
}
