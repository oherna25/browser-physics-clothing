// Sagittal pose field. One deformation, a function of rest position and owner, moves capsule ends, skin,
// garment homes and pinned cloth vertices, so none of them can disagree. Plain typed-array code: the node
// test runs it. Pose: { root: { y, z, pitch }, hipL, kneeL, ankleL, toeL, hipR, kneeR, ankleR, toeR, shoulderL,
// elbowL, shoulderR, elbowR }; signs in presets.js, a toe's positive when the toes bend up. The bust's bounce is a
// term of the same field: an offset in y and z (rig.soft) that each point adds in proportion to its bounce weight.

import { STRIDE, nearest } from './cloth.js';
import { BUILD, POSE } from './presets.js';

// Each limb kind's joints, root end first. blend: half width of the share's blend across the pivot height, or 0
// for the joint the whole limb turns about rigidly. The toes' share instead rises over `blend` ahead of the line
// through their roots (leg.toe), so nothing behind the joint turns with them: a blend centred on it turned the ball
// down under the foot as the toes bent up. It runs on the point itself, which a toe's cross-section shares: the
// foot's rows lie across it, so their axis points step forward 6.5 mm at a time, and the knit and the skin under it
// took different steps and parted by up to 3.6 mm under a bent ball (measured). Past the blend it is the toe's
// scale across the foot (leg.toe.scale), so the smaller toes bend less. sign turns a pose angle into the field's
// rotation.
const LIMB_JOINTS = {
  leg: [
    { name: 'hip', blend: 0, sign: 1 }, { name: 'knee', blend: POSE.knee, sign: -1 }, { name: 'ankle', blend: POSE.ankle, sign: 1 },
    { name: 'toe', blend: POSE.toe, sign: 1 },
  ],
  arm: [{ name: 'shoulder', blend: 0, sign: 1 }, { name: 'elbow', blend: POSE.elbow, sign: 1 }],
};
const SHARES = 4; // one share per joint of the longest chain
const REC = 2 + SHARES, SOFT = 1 + SHARES; // weights per point: owner, the shares, then the bounce weight
const keyOf = (name, side) => name + (side < 0 ? 'L' : 'R');
const DEG = Math.PI / 180;
const ANGLES = ['leg', 'arm'].flatMap((kind) => [-1, 1].flatMap((side) => LIMB_JOINTS[kind].map((j) => keyOf(j.name, side))));

export const STAND = Object.freeze({ root: Object.freeze({ y: 0, z: 0, pitch: 0 }), ...Object.fromEntries(ANGLES.map((k) => [k, 0])) });

export const makePose = (partial = {}) => ({ ...STAND, ...partial, root: { ...STAND.root, ...partial.root } });
// The pose a fraction t of the way from a to b; t = 1 returns b itself.
export function blendPose(a, b, t) {
  if (t >= 1) return b;
  const mix = (u, v) => u + (v - u) * t;
  const root = { y: mix(a.root.y, b.root.y), z: mix(a.root.z, b.root.z), pitch: mix(a.root.pitch, b.root.pitch) };
  return { root, ...Object.fromEntries(ANGLES.map((k) => [k, mix(a[k], b[k])])) };
}
export const isStand = (p) => p.root.y === 0 && p.root.z === 0 && p.root.pitch === 0 && ANGLES.every((k) => p[k] === 0);
const samePose = (a, b) => a.root.y === b.root.y && a.root.z === b.root.z && a.root.pitch === b.root.pitch && ANGLES.every((k) => a[k] === b[k]);

const smoothstep = (a, b, v) => {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Signed distance from (x, y, z) to capsule o of s; the share along its axis of the point under it goes to `along`.
const along = { t: 0 };
function depthOf(s, o, x, y, z) {
  const px = x - s[o], py = y - s[o + 1], pz = z - s[o + 2];
  const t = Math.min(Math.max((px * s[o + 4] + py * s[o + 5] + pz * s[o + 6]) * s[o + 8], 0), 1);
  const cx = px - s[o + 4] * t, cy = py - s[o + 5] * t, cz = pz - s[o + 6] * t;
  along.t = t;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) - (s[o + 3] + s[o + 7] * t);
}

// The rest capsule of s that (x, y, z) lies deepest in, or is nearest to outside, and how far along its axis the
// point under it is: capsule offset o and share t, written to `axis`.
const axis = { o: 0, t: 0 };
function axisOf(s, x, y, z) {
  let best = Infinity;
  for (let o = 0; o < s.length; o += STRIDE) {
    const d = depthOf(s, o, x, y, z);
    if (d < best) { best = d; axis.o = o; axis.t = along.t; }
  }
  return axis;
}

// The bounce weight at (x, y, z) from the capsules of s, whose end weights are `ends`: each capsule's weight at the
// axis point under it, blended by exp(-depth / blend) on how much shallower the point lies in it than in the deepest.
// A point well inside one capsule takes that capsule's weight, for the reason axisY gives. Where the deepest capsule
// changes, along a crease, a hard choice stepped the skin by up to 0.4 of the offset between neighbouring vertices
// (measured at the bust's side), which shaded as a ragged edge. Written to `soft`: the weight and the deepest depth.
const soft = { w: 0, d: 0 };
function softWeight(s, ends, x, y, z, blend) {
  let lo = Infinity, a = 0, b = 0;
  for (let o = 0, k = 0; o < s.length; o += STRIDE, k += 2) {
    const d = depthOf(s, o, x, y, z);
    if (d - lo > 12 * blend) continue;
    if (d < lo) { const r = Math.exp((d - lo) / blend); a *= r; b *= r; lo = d; }
    const e = Math.exp((lo - d) / blend);
    a += e * (ends[k] + (ends[k + 1] - ends[k]) * along.t); b += e;
  }
  soft.w = a / b; soft.d = lo;
  return soft;
}

// Height of the axis point under (x, y, z) on the limb's nearest rest capsule. The shares blend on it, not on the
// point's own height, so a capsule's whole cross-section turns as its axis does: blended on height, the instep
// above a pointed foot turned less than the foot capsule under it and stood 13 mm off it (measured).
function axisY({ segs: s }, x, y, z) {
  const { o, t } = axisOf(s, x, y, z);
  return s[o + 1] + s[o + 5] * t;
}

// Which points of `pos`, swept from `leg`, lie wholly below the ankle's blend, where the field moves them with the
// foot and the toes alone.
export function onFoot(body, leg, pos) {
  const w = limbWeights({ slot: 0, segs: leg.segs, joints: jointsOf(body, leg) }, pos), out = new Uint8Array(pos.length / 3);
  for (let i = 0, at = 0; i < out.length; i++, at += REC) out[i] = w[at + 3] === 1 ? 1 : 0;
  return out;
}

// Piecewise linear through [x, value] pairs ordered by x, held at the ends.
function lerpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    const [x1, v1] = table[k];
    if (x <= x1) { const [x0, v0] = table[k - 1]; return v0 + (v1 - v0) * (x - x0) / (x1 - x0); }
  }
  return table[table.length - 1][1];
}

// Weights per point, REC floats: owning limb's slot in rig.limbs plus 1 (0 the root), that limb's joint shares,
// then the bounce weight. A limb's own points turn rigidly about its first joint; the others blend along the chain.
function limbWeight(limb, x, y, z, h, w, at) {
  w[at] = limb.slot + 1;
  const ay = axisY(limb, x, y, z);
  limb.joints.forEach((j, k) => {
    if (!j.ahead) { w[at + 1 + k] = j.blend ? h * (1 - smoothstep(j.pivot[0] - j.blend, j.pivot[0] + j.blend, ay)) : h; return; }
    const [x0, z0, nx, nz] = j.ahead;
    w[at + 1 + k] = h * smoothstep(0, j.blend, (x - x0) * nx + (z - z0) * nz) * lerpTable(j.scale, x);
  });
}

function limbWeights(limb, pos, w = new Float32Array(pos.length / 3 * REC), at = 0) {
  for (let o = 0; o < pos.length; o += 3, at += REC) limbWeight(limb, pos[o], pos[o + 1], pos[o + 2], 1, w, at);
  return w;
}

// Skin inside the body takes its bounce weight from the body's capsules; a garment's home outside it from the body's
// or, where nearer, the shell's that the garment was cut from. Limbs never bounce.
function bustWeights({ torsoSegs, fill, bust }, pos, w, at = SOFT, step = REC) {
  const { blend } = BUILD.chest.bounce;
  for (let o = 0; o < pos.length; o += 3, at += step) {
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    let { w: b, d } = softWeight(torsoSegs, bust.torso, x, y, z, blend);
    if (d >= 0 && softWeight(fill, bust.fill, x, y, z, blend).d < d) b = soft.w;
    w[at] = b;
  }
}

// Torso skin follows the root unless it lies on a thigh: the hip share blends on how much nearer the point is
// to the nearer leg's capsules than to the root's. Only that one leg is ever used, so the two thighs never mix.
const hit = { d: 0, nx: 0, ny: 0, nz: 0 };
function ownedWeights(rig, pos) {
  const w = new Float32Array(pos.length / 3 * REC), [L, R] = rig.body.legs;
  for (let o = 0, at = 0; o < pos.length; o += 3, at += REC) {
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    const dL = nearest(L.segs, x, y, z, hit).d, dR = nearest(R.segs, x, y, z, hit).d;
    const h = 1 - smoothstep(-POSE.own, POSE.own, Math.min(dL, dR) - nearest(rig.body.torsoSegs, x, y, z, hit).d);
    if (h > 0) limbWeight(rig.limbOf.get(dL <= dR ? L : R), x, y, z, h, w, at);
  }
  return w;
}

// Rotations about x compose by adding angles, so a point's whole transform is its limb's joints from the far
// end in (each about its rest pivot), then the root pitch about the hip, the shift and the bounce. x never changes.
function deform(rig, pose, w, rest, out) {
  const { limbs, angle, cos, sin, last, soft: { y: oy, z: oz } } = rig;
  for (const limb of limbs) limb.joints.forEach((j, k) => { angle[limb.slot * SHARES + k] = j.sign * pose[j.key]; });
  last.fill(0); cos.fill(1); sin.fill(0);
  const [hy, hz] = rig.joints.hip;
  const rp = -pose.root.pitch, rc = Math.cos(rp), rs = Math.sin(rp), ty = pose.root.y, tz = pose.root.z;
  for (let i = 0, o = 0; o < rest.length; i += REC, o += 3) {
    let y = rest[o + 1], z = rest[o + 2], dy, dz;
    if (w[i] !== 0) {
      const limb = limbs[w[i] - 1], base = limb.slot * SHARES;
      for (let k = limb.joints.length - 1; k >= 0; k--) {
        const a = w[i + 1 + k] * angle[base + k];
        if (a === 0) continue;
        // Most points sit where a share is exactly 0 or 1, so consecutive points usually repeat an angle.
        const q = base + k;
        if (a !== last[q]) { last[q] = a; cos[q] = Math.cos(a); sin[q] = Math.sin(a); }
        const P = limb.joints[k].pivot, c = cos[q], s = sin[q];
        let py = P[0], pz = P[1];
        if (P.length > 2) { const u = rest[o] - P[4]; py += P[2] * u; pz += P[3] * u; }
        dy = y - py; dz = z - pz; y = py + dy * c + dz * s; z = pz - dy * s + dz * c;
      }
    }
    if (rp !== 0) { dy = y - hy; dz = z - hz; y = hy + dy * rc + dz * rs; z = hz - dy * rs + dz * rc; }
    const b = w[i + SOFT];
    out[o] = rest[o];
    if (b === 0) { out[o + 1] = y + ty; out[o + 2] = z + tz; } else { out[o + 1] = y + ty + b * oy; out[o + 2] = z + tz + b * oz; }
  }
}

// Who a point set follows besides a limb. Garments follow the root only: a thigh pushes them through the
// collider, because turning them with the thigh near the hip ball rotates them into the glute.
export const ROOT = 'root', BLEND = 'blend';

/**
 * A point set that follows the pose: rest positions, the live copy, and weights made on first use. `by` is the
 * body limb the points were swept from, ROOT, or BLEND to weigh them by ownership (torso skin).
 */
export const follow = (rest, by = ROOT, live = rest.slice()) => ({ rest, live, by, w: null });

function weigh(rig, set) {
  if (set.w) return set.w;
  const { rest, by } = set, owned = by === BLEND || by === ROOT;
  set.w = by === BLEND ? ownedWeights(rig, rest) : by === ROOT ? new Float32Array(rest.length / 3 * REC) : limbWeights(rig.limbOf.get(by), rest);
  if (owned && rig.body.bust) bustWeights(rig.body, rest, set.w);
  return set.w;
}

// STAND with the bust at rest: every point is where it was built.
const atRest = (rig) => rig.soft.y === 0 && rig.soft.z === 0 && isStand(rig.pose);

export function poseSet(rig, set, out = set.live) {
  if (atRest(rig)) out.set(set.rest);
  else deform(rig, rig.pose, weigh(rig, set), set.rest, out);
  return out;
}

// Total rotation about x at point i of a set, for rigid parts such as the choker ornaments.
export function angleOf(rig, set, i = 0) {
  const w = weigh(rig, set), p = rig.pose, at = i * REC;
  if (w[at] === 0) return -p.root.pitch;
  const limb = rig.limbs[w[at] - 1];
  return limb.joints.reduce((a, j, k) => a + w[at + 1 + k] * j.sign * p[j.key], 0) - p.root.pitch;
}

// The bounce weight at both ends of every capsule of the union body[key], in its order: the torso's are body.bust's,
// the legs', arms' and head's 0.
function capsuleBounce(body, key) {
  const out = new Float32Array(body[key].length / STRIDE * 2);
  if (body.bust) out.set(body.bust.torso, (body.legs[0][key].length + body.legs[1][key].length) / STRIDE * 2);
  return out;
}

// Capsule ends as points [a, b] per capsule. Each capsule belongs wholly to one limb or to the root, by its
// slot in the union (legs, torso, arms, head), so no capsule ever takes a fractional share and shears. A torso
// capsule's ends take the bounce weights body.bust gives them.
function capsuleSet(rig, rest, live, key) {
  const n = rest.length / STRIDE, ends = new Float32Array(n * 6), w = new Float32Array(n * 2 * REC);
  for (let k = 0, o = 0; k < n; k++, o += STRIDE) {
    ends[k * 6] = rest[o]; ends[k * 6 + 1] = rest[o + 1]; ends[k * 6 + 2] = rest[o + 2];
    ends[k * 6 + 3] = rest[o] + rest[o + 4]; ends[k * 6 + 4] = rest[o + 1] + rest[o + 5]; ends[k * 6 + 5] = rest[o + 2] + rest[o + 6];
  }
  const { legs, arms, torsoSegs } = rig.body, at = (k) => k * 2 * REC;
  let k0 = 0;
  for (const part of [legs[0], legs[1], null, arms[0], arms[1]]) {
    const count = (part ? part[key] : torsoSegs).length / STRIDE;
    if (part) limbWeights(rig.limbOf.get(part), ends.subarray(k0 * 6, (k0 + count) * 6), w, at(k0));
    k0 += count;
  }
  capsuleBounce(rig.body, key).forEach((b, j) => { w[j * REC + SOFT] = b; });
  return { restSegs: rest, live, ends: { ...follow(ends), w } };
}

// Radii and the open flag never change, so only position, axis and inverse squared length are written.
function poseCapsules(rig, cap) {
  if (atRest(rig)) { cap.live.set(cap.restSegs); return; }
  poseSet(rig, cap.ends);
  const e = cap.ends.live, live = cap.live;
  for (let k = 0, o = 0; o < live.length; k += 6, o += STRIDE) {
    const dx = e[k + 3] - e[k], dy = e[k + 4] - e[k + 1], dz = e[k + 5] - e[k + 2];
    live[o] = e[k]; live[o + 1] = e[k + 1]; live[o + 2] = e[k + 2];
    live[o + 4] = dx; live[o + 5] = dy; live[o + 6] = dz;
    live[o + 8] = 1 / Math.max(dx * dx + dy * dy + dz * dz, 1e-12);
  }
}

// A limb's joints with their pivots; a leg's toes carry their own (leg.toe).
function jointsOf(body, limb) {
  return LIMB_JOINTS[limb.kind].map((j) => ({ ...j, key: keyOf(j.name, limb.side), ...(j.name === 'toe' ? limb.toe : { pivot: body.joints[j.name] }) }));
}

/**
 * A rig poses one body: its live capsule arrays (body.live, which every collider reads), point sets
 * registered with track(), and the cloths passed to applyPose. Rest arrays are never written. soft holds the
 * bust's offset (y, z, metres), which the field adds and anything may set, and the spring stepSoft runs behind it.
 */
export function makeRig(body) {
  const limbs = body.limbs.map((limb, slot) => ({ slot, segs: limb.segs, joints: jointsOf(body, limb) }));
  const n = limbs.length * SHARES;
  const rig = {
    body, joints: body.joints, pose: STAND, sets: [], limbs, limbOf: new Map(body.limbs.map((l, k) => [l, limbs[k]])),
    angle: new Float64Array(n), cos: new Float64Array(n), sin: new Float64Array(n), last: new Float64Array(n),
    soft: {
      y: 0, z: 0, posed: [0, 0],
      // The spring in y and z, the low-passed acceleration driving it, the crest's last two positions and how many of
      // them are motion, and the pose the last step was toward.
      q: new Float64Array(2), v: new Float64Array(2), a: new Float64Array(2), track: new Float64Array(4), seen: 0, toward: null,
    },
  };
  rig.caps = [capsuleSet(rig, body.segs, body.live.segs, 'segs'), capsuleSet(rig, body.segsCoarse, body.live.segsCoarse, 'segsCoarse')];
  rig.feet = body.legs.map((leg) => footSet(leg, body.joints.ankle));
  return rig;
}

// The capsule ends of a leg that can reach the floor, their radii, and last the ankle pivot. The foot is the
// same in the fine and coarse leg, so the coarse one serves. `toes` lists the ends past the toes' blend.
const FOOT_TOP = 0.2;
function footSet(leg, [ay, az]) {
  const s = leg.segsCoarse, pts = [], radii = [], [x0, z0, nx, nz] = leg.toe.ahead;
  for (let o = 0; o < s.length; o += STRIDE) {
    const ra = s[o + 3], rb = ra + s[o + 7];
    if (Math.min(s[o + 1] - ra, s[o + 1] + s[o + 5] - rb) > FOOT_TOP) continue;
    pts.push(s[o], s[o + 1], s[o + 2], s[o] + s[o + 4], s[o + 1] + s[o + 5], s[o + 2] + s[o + 6]);
    radii.push(ra, rb);
  }
  const toes = [];
  for (let i = 0; i < radii.length; i++) if ((pts[i * 3] - x0) * nx + (pts[i * 3 + 2] - z0) * nz >= POSE.toe) toes.push(i);
  pts.push(s[0], ay, az);
  return { set: follow(new Float32Array(pts), leg), radii: new Float32Array(radii), toes };
}

/**
 * Where a pose puts the feet: the lowest point of each leg (the bottom of an end sphere, as the floor sees it)
 * and the mean ankle z, written to out = { low: [left, right], z }. With `free` the toes are bent up as far as a
 * motion bends them, so the lowest point is what the foot stands on once its toes give way to the floor.
 */
export function feetOf(rig, pose, out = { low: [0, 0], z: 0 }, free = false) {
  if (free) pose = { ...pose, toeL: POSE.toeMax * DEG, toeR: POSE.toeMax * DEG };
  out.z = 0;
  rig.feet.forEach(({ set, radii }, k) => {
    deform(rig, pose, weigh(rig, set), set.rest, set.live);
    const p = set.live;
    let m = Infinity;
    for (let i = 0; i < radii.length; i++) m = Math.min(m, p[i * 3 + 1] - radii[i]);
    out.low[k] = m;
    out.z += p[p.length - 1] / 2;
  });
  return out;
}

// Bends each foot's toes up from straight by the least that keeps them off the floor (y = 0), at most POSE.toeMax:
// flat on it as the heel rises, straight once the foot leaves it. The root must already be placed. Only the points
// past the toes' blend count: one in it sinks a few hundredths of a millimetre as they bend, and the root was
// placed with them bent all the way, so it would hold them there.
export function bendToes(rig, pose) {
  const max = POSE.toeMax * DEG;
  rig.feet.forEach(({ set, radii, toes }, k) => {
    const key = k ? 'toeR' : 'toeL', w = weigh(rig, set), p = set.live;
    const low = (a) => {
      pose[key] = a;
      deform(rig, pose, w, set.rest, p);
      let m = Infinity;
      for (const i of toes) m = Math.min(m, p[i * 3 + 1] - radii[i]);
      return m;
    };
    if (low(0) >= 0) return;
    // Bisected to double precision, so poses a cycle apart bend their toes alike.
    let lo = 0, hi = max;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (low(mid) >= 0) hi = mid; else lo = mid;
    }
    pose[key] = hi;
  });
  return pose;
}

// Registers rest positions and returns the live copy that follows the pose.
export function track(rig, rest, by = ROOT) {
  const set = follow(rest, by);
  rig.sets.push(set);
  poseSet(rig, set);
  return set.live;
}

// The offset in y or z saturates toward this: a share of the bust's projection.
const bounceLimit = (bust) => BUILD.chest.bounce.limit * bust.projection;

// How much closer than at rest the bounce can bring vertex i of `home` (rest positions) and capsule `slot` of the
// coarse union, for setCollider to widen that pair's reach by. A point moves by its weight times an offset of at most
// the limit, so a pair closes by at most the gap between their weights times the limit. A capsule's weight along its
// axis lies between its ends', so the larger gap at either end bounds it. A body without a bust has none.
export function bounceSlack(body, home) {
  if (!body.bust) return null;
  const L = bounceLimit(body.bust), w = new Float32Array(home.length / 3), e = capsuleBounce(body, 'segsCoarse');
  bustWeights(body, home, w, 0, 1);
  return (i, slot) => L * Math.max(Math.abs(w[i] - e[slot * 2]), Math.abs(w[i] - e[slot * 2 + 1]));
}

// A cloth's anchor is its home, or its initial shape when it has none (the skirt). The candidate lists
// (cand) stay valid: they hold capsule slots, not positions, and a home vertex and the capsules near it
// at rest go through the same field, which is rigid away from the joint blends and the bust. There a home takes
// the bounce weight of the capsule under it, and bounceSlack widens the lists by how far the weights differ.
function anchorOf(rig, c) {
  if (c.rig !== rig) {
    const live = c.home ?? c.initial;
    c.rig = rig;
    c.anchor = { ...follow(live.slice(), c.leg ?? ROOT, live), next: new Float32Array(live.length), fresh: true };
  }
  return c.anchor;
}

// The anchor's motion for the cloth's next step: d its displacement this frame, dd the change from last frame's.
// A fresh anchor jumps from rest to the pose, a teleport that carries no velocity, and on the frame after the
// cloth is taken to be moving with the body already. A frame without posing means the anchor stood still.
function kinematics(c, a, next) {
  const K = (c.kin ??= { d: new Float32Array(next.length), dd: new Float32Array(next.length), frame: -1, age: 0, dt: 0 });
  const { d, dd } = K, live = a.live;
  if (a.fresh) { d.fill(0); dd.fill(0); K.age = 0; a.fresh = false; K.frame = c.frame; return; }
  // Posed twice before one step: the earlier move was a jump to a starting pose (the test harness, a reset), so
  // only the last one is motion. Adding them kicked a crouching stocking with the whole jump and left it wobbling.
  if (K.frame === c.frame) {
    for (let o = 0; o < d.length; o++) d[o] = next[o] - live[o];
    dd.fill(0);
    return;
  }
  const still = K.frame !== c.frame - 1, settle = K.age === 0;
  for (let o = 0; o < d.length; o++) {
    const v = next[o] - live[o];
    dd[o] = settle ? 0 : still ? v : v - d[o];
    d[o] = v;
  }
  K.age++; K.frame = c.frame;
}

function refreshCollider(rig, c) {
  const pick = c.colliderPick, src = rig.caps[1].live;
  if (!pick) return; // the stocking reads body.live.base.segs itself
  for (let k = 0; k < pick.length; k++) c.collider.set(src.subarray(pick[k] * STRIDE, (pick[k] + 1) * STRIDE), k * STRIDE);
}

// Every vertex moves by its anchor's displacement, pos and prev alike so no velocity is added; a jump that
// left free vertices behind would drag them through the body. Pinned vertices land exactly on the anchor.
function poseCloth(rig, c) {
  const a = anchorOf(rig, c), next = a.next;
  poseSet(rig, a, next);
  kinematics(c, a, next);
  const { pos, prev, w } = c;
  for (let i = 0, o = 0; i < c.n; i++, o += 3) {
    if (w[i] === 0) {
      pos[o] = prev[o] = next[o]; pos[o + 1] = prev[o + 1] = next[o + 1]; pos[o + 2] = prev[o + 2] = next[o + 2];
      continue;
    }
    const dx = next[o] - a.live[o], dy = next[o + 1] - a.live[o + 1], dz = next[o + 2] - a.live[o + 2];
    pos[o] += dx; pos[o + 1] += dy; pos[o + 2] += dz;
    prev[o] += dx; prev[o + 1] += dy; prev[o + 2] += dz;
  }
  a.live.set(next);
  if (c.home) c.initial.set(c.home); // they start equal, so resetCloth lands on the posed home
  refreshCollider(rig, c);
  c.asleep = false; c.stillFrames = 0;
}

/**
 * Poses capsules, tracked sets and cloths. An unchanged pose and bust offset cost nothing, except that a cloth this
 * rig has not seen (a shirt swapped in while posed) is posed to catch up. Returns whether either changed.
 */
export function applyPose(rig, cloths, pose) {
  const s = rig.soft, changed = !samePose(rig.pose, pose) || s.y !== s.posed[0] || s.z !== s.posed[1];
  rig.pose = pose; s.posed[0] = s.y; s.posed[1] = s.z;
  if (changed) {
    for (const cap of rig.caps) poseCapsules(rig, cap);
    for (const set of rig.sets) poseSet(rig, set);
  }
  for (const c of cloths) {
    if (changed || (c.rig !== rig && !atRest(rig))) poseCloth(rig, c);
    else anchorOf(rig, c);
  }
  return changed;
}

/**
 * Steps the bust's spring once per simulation step, before `pose` is applied: it answers the acceleration of the
 * crest as the root carries it, the second difference of its positions over the steps, as the standard relative
 * coordinate spring q'' = -w^2 q - 2 zeta w q' - gain a. The low-passed a is compressed past a knee, so a walk's small
 * accelerations move the bust visibly while a jump's large ones level off. Gravity's sag is in the rest shape. The
 * offset left in rig.soft saturates smoothly toward the limit and snaps to exactly 0 once the spring is at rest, so
 * STAND is the rest shape again. A rig that is never stepped poses rigidly.
 */
export function stepSoft(rig, pose, dt) {
  const bust = rig.body.bust, s = rig.soft;
  if (!bust) return;
  const B = BUILD.chest.bounce, [hy, hz] = rig.joints.hip, dy = bust.at[0] - hy, dz = bust.at[1] - hz;
  const rp = -pose.root.pitch, rc = Math.cos(rp), rs = Math.sin(rp);
  const y = hy + dy * rc + dz * rs + pose.root.y, z = hz - dy * rs + dz * rc + pose.root.z;
  // A pose applied since the last step other than the one it was toward was a jump (a reset, a test's starting
  // pose), not motion, so the positions before it carry no acceleration. A fresh rig has none either.
  if (s.toward && !samePose(rig.pose, s.toward)) s.seen = 0;
  const h = s.track, moving = s.seen === 2, dt2 = dt * dt;
  const ay = moving ? (y - 2 * h[2] + h[0]) / dt2 : 0, az = moving ? (z - 2 * h[3] + h[1]) / dt2 : 0;
  h[0] = h[2]; h[1] = h[3]; h[2] = y; h[3] = z;
  s.seen = Math.min(s.seen + 1, 2); s.toward = pose;

  const w = 2 * Math.PI * (B.hz[0] + (B.hz[1] - B.hz[0]) * bust.size), g = B.gain * bust.projection;
  const k = 1 - Math.exp(-2 * Math.PI * B.drive * dt), { q, v, a } = s;
  a[0] += (ay - a[0]) * k; a[1] += (az - a[1]) * k;
  const n = Math.hypot(a[0], a[1]), A = B.knee[a[0] < 0 ? 1 : 0], u = n / A, t = Math.tanh(u);
  const gc = n > 0 ? g * A * (t + (u - t) / B.ratio) / n : g;
  for (let i = 0; i < 2; i++) { v[i] += dt * (-w * w * q[i] - 2 * B.damping * w * v[i] - gc * a[i]); q[i] += dt * v[i]; }
  const m = Math.hypot(q[0], q[1]), e = B.rest;
  if (m < e && Math.hypot(v[0], v[1]) < e * w && gc * n < e * w * w) {
    q.fill(0); v.fill(0); a.fill(0); s.y = 0; s.z = 0;
    return;
  }
  const L = bounceLimit(bust), f = m > 0 ? L * Math.tanh(m / L) / m : 1;
  s.y = q[0] * f; s.z = q[1] * f;
}
