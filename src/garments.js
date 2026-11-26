// Garment construction shared by the browser app and the headless test.

import { makeGridCloth, setCollider, concatSegs, STRIDE } from './cloth.js';
import { sweepLimb, buildSkirt, buildShirtRest, ringRadii, SKIRT_WAIST_Y } from './body.js';
import { SHIRT, STOCKING_MOTION, SKIRT_MOTION } from './presets.js';
import { bounceSlack } from './pose.js';

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
const STOCKING_RINGS = 92, LEG_SEGS = 44, CAP_RINGS = 5, SKIN_PITCH = 0.004, FOOT_Y = 0.15;

export function legSkin(leg) {
  const s0 = leg.sAtY(STOCKING_TOP_Y), L = leg.length, foot = leg.sAtY(FOOT_Y);
  const k = Math.ceil((foot - s0) / (L - s0) * (STOCKING_RINGS - 1)), s = s0 + (L - s0) * k / (STOCKING_RINGS - 1);
  const n = Math.ceil(s / SKIN_PITCH), rings = [];
  for (let i = 0; i < n; i++) rings.push(s * i / n);
  for (let i = k; i < STOCKING_RINGS; i++) rings.push(s0 + (L - s0) * i / (STOCKING_RINGS - 1));
  return sweepLimb(leg, 0, L, rings, LEG_SEGS, 0, CAP_RINGS);
}

export function makeStocking(body, leg) {
  const s0 = leg.sAtY(STOCKING_TOP_Y), rings = STOCKING_RINGS, segs = LEG_SEGS, capRings = CAP_RINGS;
  const g = sweepLimb(leg, s0, leg.length, rings, segs, 0.0015, capRings);
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
  setCollider(cloth, body.live.base.segs);
  cloth.colliderFull = body.live.segs;
  cloth.kind = 'stocking';
  cloth.leg = leg; // the pose turns its home with this leg alone
  cloth.bodyRings = rings; // rings before the toe cap

  // The knit is cut for the unmodified leg, so a thicker one starts out pre-stretched.
  // Rest lengths stay at home length; this only feeds the sheer shader.
  cloth.preStretch = new Float32Array(cloth.n).fill(1);
  if (leg.ref) {
    const gr = sweepLimb(leg.ref, s0, leg.length, rings, segs, 0.0015, capRings);
    const a = ringRadii(leg, g, s0, leg.length, rings), b = ringRadii(leg.ref, gr, s0, leg.length, rings);
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
