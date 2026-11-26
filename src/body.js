// Procedural mannequin. One analytic definition (chains of tapered capsules)
// produces the skin mesh, the garments' rest shapes and the colliders, so the
// cloth can never disagree with the surface it sits on.

import { nearest, packSegs, concatSegs, STRIDE } from './cloth.js';
import { BODIES, BUILD, DEFAULTS, POSE } from './presets.js';

const cr = (a, b, c, d, t) =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

const smoothstep = (a, b, v) => {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Splits segments that touch the squeeze window into pieces no longer than maxPiece.
// Points are [x, y, z, rThick, rBase]; everything interpolates linearly. `open[k]` is true
// for the pieces that came from a split segment, i.e. piece k runs from out[k] to out[k + 1].
function refine(list, lo, hi, maxPiece, wasOpen = []) {
  const out = [], open = [];
  for (let k = 0; k < list.length - 1; k++) {
    const a = list[k], b = list[k + 1];
    const touches = Math.max(a[1], b[1]) >= lo && Math.min(a[1], b[1]) <= hi;
    const n = touches ? Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / maxPiece) : 1;
    for (let j = 0; j < n; j++) { out.push(a.map((v, c) => v + (b[c] - v) * j / n)); open.push(touches || !!wasOpen[k]); }
  }
  out.push(list[list.length - 1]);
  return { pts: out, open };
}

// Flesh compressed by the band's elastic, a little compression along the leg below it,
// and a soft bulge just above the top edge. All scale with the thickness gained.
function squeeze([x, y, z, r, rb], band, Q) {
  const excess = r - rb;
  const depthBand = Q.dig0 + Q.softness * excess;
  const depthSheer = Q.sheerShare * Q.softness * excess;
  const t = band.y - y;
  const below = smoothstep(band.width - Q.edge, band.width + 2 * Q.edge, t);
  const inBand = smoothstep(-Q.edge, Q.edge, t) * (1 - below);
  const u = (y - band.y - Q.bulgeAt) / Q.bulgeWidth;
  return [x, y, z, r - depthBand * inBand - depthSheer * below + Q.bulgeShare * depthBand * Math.exp(-u * u)];
}

// Catmull-Rom through `rows`, cut into pieces in which no column listed in `spans` moves more than `step`.
function resample(rows, spans, step) {
  const out = [], J = rows.length;
  for (let k = 0; k < J - 1; k++) {
    const p = [rows[Math.max(k - 1, 0)], rows[k], rows[k + 1], rows[Math.min(k + 2, J - 1)]];
    const n = Math.max(1, Math.ceil(Math.max(...spans.map((c) => Math.abs(rows[k + 1][c] - rows[k][c]))) / step));
    for (let t = 0; t < n; t++) out.push(rows[k].map((_, c) => cr(p[0][c], p[1][c], p[2][c], p[3][c], t / n)));
  }
  out.push(rows[J - 1]);
  return out;
}

const ROW_STEP = 0.008; // 1 cm row spacing scallops under 0.2 mm at r = 8 cm; this is finer on the sloped shoulders

// Point and outward normal of the ribcage's front at x and y: the torso rows are stadiums, so it falls away sideways.
function ribAt(rows, x, y) {
  let k = 0;
  while (k < rows.length - 2 && rows[k + 1][0] < y) k++;
  const [y0, h0, z0, r0] = rows[k], [y1, h1, z1, r1] = rows[k + 1], t = Math.min(Math.max((y - y0) / (y1 - y0), 0), 1);
  const lerp = (a, b) => a + (b - a) * t, r = lerp(r0, r1), dx = Math.min(Math.max(Math.abs(x) - lerp(h0, h1), 0), 0.999 * r);
  const nz = Math.sqrt(r * r - dx * dx);
  return [x, lerp(z0, z1) + nz, Math.sign(x) * dx / r, nz / r];
}

const bump = (u) => (u >= 1 ? 0 : (1 - u * u) ** 3);
const projection = (size) => { const [a, b, c] = BUILD.chest.projection; return a + b * size + c * size * size; };

// Both breasts at `size` (0..1); see presets.js for the rows. The shell is the garments' version:
// the rows run out below the apex to the ribcage, a capsule bridges the cleft in every row, and only the ramp below the
// apex adds breast capsules, since above it the body's own already stand there. It is cut twice as coarsely, because
// fabric rides 2.5 mm off it. Each node carries a fifth value, its bounce weight: how far it stands off the ribcage as
// a share of the projection, so the top and bottom rows and the outer ends of the chains weigh 0.
function chestCapsules(chest, size, torso, shell = false) {
  const B = BUILD.chest, p = projection(size), k = B.flat + (1 - B.flat) * p / projection(1);
  const rib = resample(torso, [0, 1], ROW_STEP), out = [];
  const rows = shell ? [...chest.rows.filter((r) => r[0] < chest.shell[0][0]), ...chest.shell] : chest.rows;
  const dense = resample(rows.map(([d, f, r, wi, wo]) => [chest.anchor - d * k, f * p, r * k, wi * k, wo * k]), [0], shell ? 2 * B.step : B.step);
  const ramp = shell ? chest.anchor - chest.shell[0][0] * k : Infinity, apex = chest.apex[1] + (chest.apex[0] - chest.apex[1]) * (1 - size);
  for (const [y, h, r, wi, wo] of dense) {
    const side = (t) => (t < 0 ? bump(-t / wi) : bump(t / wo));
    // r in from H along the ribcage normal. A node standing out of the ribcage starts from the point whose normal lands
    // it at x, so the crest keeps its place as the size changes how far out it stands.
    const node = (x, share = 1) => {
      const H = h * share * (side(x - apex) + side(-x - apex)), e = H - r;
      let q = ribAt(rib, x, y);
      for (let it = 0; it < 4 && e > 0; it++) q = ribAt(rib, x - q[2] * e, y);
      return [q[0] + q[2] * e, y, q[1] + q[3] * e, r, Math.max(H, 0) / p];
    };
    if (y <= ramp + 1e-9) {
      const chain = [node(0), ...chest.nodes.map((u) => apex + u * (u < 0 ? wi : wo)).filter((x) => x > 0.002).map((x) => node(x))];
      for (const s of [1, -1]) for (let j = 1; j < chain.length; j++) out.push([chain[j - 1], chain[j]].map(([x, ...q]) => [s * x, ...q]));
    }
    if (shell) out.push([node(-apex, chest.bridge), node(apex, chest.bridge)]);
  }
  return out;
}

// Chest, shoulders and neck as capsules. The torso is a stack of horizontal capsules, so the front
// and back stay flat across the middle instead of grooving where two vertical capsules meet.
function upperCapsules({ torso, neck, chest }, size) {
  const rows = resample(torso, [0, 1], ROW_STEP).map(([y, hw, z, r]) => [[-hw, y, z, r], [hw, y, z, r]]);
  const joints = resample(neck, [0], ROW_STEP).map(([y, z, r]) => [0, y, z, r]);
  return [...rows, ...chainOf(joints), ...(chest ? chestCapsules(chest, size, torso) : [])];
}

/**
 * What the pose field needs to bounce the bust: the bounce weight at both ends of every torso capsule (0 off the
 * chest) and of every shell capsule, in packSegs order, and the crest's capsule end, whose acceleration drives it.
 */
function bustOf(torsoList, fillList, size) {
  const ends = (list) => new Float32Array(list.flatMap(([a, b]) => [a[4] ?? 0, b[4] ?? 0]));
  const crest = torsoList.flatMap(([a, b]) => [a, b]).reduce((m, e) => ((e[4] ?? 0) > (m[4] ?? 0) ? e : m));
  return { torso: ends(torsoList), fill: ends(fillList), at: [crest[1], crest[2]], size, projection: projection(size) };
}

// Ring centres need a z that stays inside the body; the cut-off waist keeps its own cz.
function trunkOf({ trunk, torso, neck }) {
  const centre = [[torso[0][0], trunk.cz], ...torso.slice(1).map(([y, , z]) => [y, z])];
  const centreZ = (y) => {
    if (y <= centre[0][0]) return trunk.cz;
    let k = 0;
    while (k < centre.length - 2 && centre[k + 1][0] < y) k++;
    const [y0, z0] = centre[k], [y1, z1] = centre[k + 1];
    return z0 + (z1 - z0) * Math.min((y - y0) / (y1 - y0), 1);
  };
  const [top, neckZ] = neck[neck.length - 1];
  return { ...trunk, top, neckZ, centreZ };
}

const chainOf = (list, open = []) => list.slice(1).map((p, k) => [list[k], p, open[k]]);

// Catmull-Rom through the rows, `sub` pieces per span, every column interpolated.
function subdivide(rows, sub) {
  const out = [], J = rows.length;
  for (let k = 0; k < J - 1; k++) {
    const p = [rows[Math.max(k - 1, 0)], rows[k], rows[k + 1], rows[Math.min(k + 2, J - 1)]];
    for (let s = 0; s < sub; s++) out.push(rows[k].map((_, c) => cr(p[0][c], p[1][c], p[2][c], p[3][c], s / sub)));
  }
  out.push(rows[J - 1].slice());
  return out;
}

// Arc-length sampling of a limb's centre line, points [x, y, z, ...]: the point and unit tangent at arc length s.
function centreline(pts) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]));
  const length = cum[cum.length - 1];
  // Smoothed tangent at each polyline vertex.
  const tan = pts.map((_, k) => {
    const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, pts.length - 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
  });
  const atS = (s) => {
    s = Math.min(Math.max(s, 0), length);
    let k = 0;
    while (k < pts.length - 2 && cum[k + 1] < s) k++;
    const f = (s - cum[k]) / (cum[k + 1] - cum[k]);
    const a = pts[k], b = pts[k + 1], u = tan[k], v = tan[k + 1];
    const tx = u[0] + (v[0] - u[0]) * f, ty = u[1] + (v[1] - u[1]) * f, tz = u[2] + (v[2] - u[2]) * f;
    const l = Math.hypot(tx, ty, tz);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, tx: tx / l, ty: ty / l, tz: tz / l };
  };
  const sAtY = (y) => {
    for (let s = 0; s < length; s += 0.001) if (atS(s).y <= y) return s;
    return length;
  };
  const sAtZ = (z) => {
    for (let s = 0; s < length; s += 0.001) if (atS(s).z >= z) return s;
    return length;
  };
  return { length, atS, sAtY, sAtZ };
}

export function buildLeg(side, { leg: LEG, foot: FOOT, hipX, knit, joints }, mods = { thigh: 0, glute: 0 }, band = null) {
  const pts = subdivide(LEG, 3).map((p) => [0, ...p]); // [x, y, z, r], x filled in once the thigh gain is known

  const T = BUILD.thigh;
  const rThick = pts.map((p) => p[3] * (1 + T.gain * mods.thigh * smoothstep(T.from, T.to, p[1])));
  // Thicker thighs move outward so the two legs never merge.
  const dx = rThick.reduce((m, r, k) => Math.max(m, r - pts[k][3]), 0);
  const x = side * (hipX + dx);
  for (const p of pts) p[0] = x;

  const thick = pts.map((p, k) => [x, p[1], p[2], rThick[k], p[3]]);
  let fine = thick, open = [];
  if (band) {
    const Q = BUILD.squeeze;
    // Joint spheres ripple a tapered limb, and thicker thighs amplify it, so pieces
    // above the knee end flat. They are cut short because a flat end overlaps its
    // neighbour by a fixed share of its own length. Below the knee the taper is steep
    // enough that flat ends push pulled cloth sideways (measured 0.69 mm clearance
    // against 1 mm), so the lower leg keeps its spheres. So does the hip end, where a
    // flat top would show as a shelf beside the pelvis.
    // Where the pose bends the knee the pieces keep their spheres: flat ends there open a notch on the outside of
    // the bend, and the stocking pulled taut over a crouching knee sank into it, under the skin.
    const knee = joints.knee[0], top = knee + POSE.knee;
    const bent = refine(thick, knee, top, Q.thighPiece).pts;
    const thigh = refine(bent, top, Q.openBelow, Q.thighPiece);
    const r = refine(thigh.pts, band.y - Q.below, band.y + Q.above, Q.maxPiece, thigh.open);
    fine = r.pts.map((p) => squeeze(p, band, Q));
    open = r.open;
  }
  const heel = FOOT.heel.map(([y, z, r]) => [x, y, z, r]), rows = [heel, ...footRows(x, side, FOOT.rows, FOOT_STEP)];
  const toePts = FOOT.toes.map((t) => t.map(([w, y, z, r]) => [x + side * w, y, z, r])), toes = toePts.map((t) => chainOf(t));
  const segs = packSegs([...chainOf(fine, open), ...rows, ...toes.flat()]);
  const segsCoarse = packSegs([...chainOf(thick.map((p) => p.slice(0, 4))), heel, ...footRows(x, side, FOOT.rows, FOOT_STEP * FOOT_COARSE), ...toes.flat()]);

  // Same leg without the modifiers: the size the garment is cut for.
  const ref = mods.thigh > 0 ? buildLeg(side, { leg: LEG, foot: FOOT, hipX, knit }) : null;
  const line = centreline(pts), last = FOOT.rows[FOOT.rows.length - 1][0];
  // Over the toes the rings turn about y until they lie along the line of the toes' tips, so every toe ends in the
  // last ring and the cap closes them together. Square rings ended one toe after another and cut facets between
  // their tips. The turn spreads from the little toe's root on, slowly enough that no two rings cross in the foot.
  const big = toePts[0][toePts[0].length - 1], little = toePts[4][toePts[4].length - 1], root = line.sAtZ(toePts[4][0][2]);
  const yaw = Math.atan2(big[2] - little[2], Math.abs(little[0] - big[0]));
  const turn = (s) => {
    const c = line.atS(s), a = side * yaw * smoothstep(root, line.length, s), ca = Math.cos(a), sa = Math.sin(a);
    return { ...c, tx: c.tx * ca + c.tz * sa, tz: c.tz * ca - c.tx * sa };
  };
  const end = turn(line.length);
  const atS = (s) => (s <= line.length ? turn(s) : { ...end, x: end.x + end.tx * (s - line.length), y: end.y + end.ty * (s - line.length), z: end.z + end.tz * (s - line.length) });
  const front = Math.max(...toePts.map((t) => { const [x, y, z, r] = t[t.length - 1]; return (x - end.x) * end.tx + (y - end.y) * end.ty + (z - end.z) * end.tz + r; }));
  const leg = {
    kind: 'leg', side, segs, segsCoarse, ...line, atS, dx, ref, knit, front,
    // The skin draws the foot without its toes up to the last row, and each toe as a limb of its own. The centre
    // line's capsules past that row are left out, or the cap would run along them into a spike.
    body: packSegs([...chainOf(fine, open).filter(([a]) => a[2] < last), ...rows]), footEnd: line.sAtZ(last),
    toes: toePts.map((t, k) => ({ segs: packSegs(toes[k]), r: t[0][3], ...centreline(t) })),
  };
  // The toes bend about the line through their roots, each about its own root's axis: pivot y and z for a point at x
  // are y0 + ly (x - x0) and z0 + lz (x - x0). `ahead` is that line in the ground plane, its normal pointing forward.
  // The line runs back toward the little toe, so a heel raised about x lifts the smaller toes' pivots above the big
  // toe's, and bent by one angle their tips stood up to 12 mm off the floor on tiptoe (measured). `scale` holds each
  // toe's share of the big toe's angle, at the x of each of its points and ordered by x, that lands its tip level
  // with the big toe's when the foot pitches down by half of POSE.toeMax and the big toe bends up as far.
  const [bx, by, bz] = toePts[0][0], [lx, ly, lz] = toePts[4][0], ax = lx - bx, az = lz - bz, al = Math.hypot(ax, az), f = Math.sign(ax);
  const pivot = [by, bz, (ly - by) / ax, (lz - bz) / ax, bx], pitch = POSE.toeMax * Math.PI / 360;
  const tip = (t, bend) => {
    const [ex, ey, ez, er] = t[t.length - 1], py = by + pivot[2] * (ex - bx), pz = bz + pivot[3] * (ex - bx);
    const c = Math.cos(bend), s = Math.sin(bend), y = py + (ey - py) * c + (ez - pz) * s, z = pz - (ey - py) * s + (ez - pz) * c;
    return y * Math.cos(pitch) - z * Math.sin(pitch) - er;
  };
  const level = tip(toePts[0], pitch), scale = toePts.flatMap((t) => {
    let lo = 0, hi = 1.5;
    for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (tip(t, mid * pitch) > level) hi = mid; else lo = mid; }
    return t.map((p) => [p[0], (lo + hi) / 2]);
  });
  leg.toe = { pivot, ahead: [bx, bz, -f * az / al, f * ax / al], scale: scale.sort((a, b) => a[0] - b[0]) };
  // The toes bridged: the union the stocking's rest shape is cut from, and the section the foot's columns follow.
  leg.box = concatSegs(segs, packSegs(toeShell(toePts)));
  leg.columns = footColumns(leg);
  return leg;
}

// The tables' rows sit 12 to 24 mm apart, so pieces under 6.5 mm come out 6 mm apart and scallop the foot's sides
// (end radius 9 mm or more) by under 0.5 mm. The coarse union, which only the floor contact reads, keeps every third.
const FOOT_STEP = 0.0065, FOOT_COARSE = 3;

// The stocking's rest shape adds a chain between each pair of neighbouring toes, its top BUILD.foot.groove under
// theirs at the roots and level with them at the tips, and a chain along the tips: the knit lies over shallow grooves
// behind one rounded front, like a mitten, and the section stays in sight of the centre line, whose rays would
// otherwise skip from toe to toe and cut flat facets between their tips.
function toeShell(toePts) {
  const { groove } = BUILD.foot, n = toePts[0].length;
  const bridges = toePts.slice(1).flatMap((b, k) => chainOf(toePts[k].map((p, i) => {
    const q = b[i], y = (p[1] + q[1]) / 2, g = groove * (1 - i / (n - 1));
    return [(p[0] + q[0]) / 2, y, (p[2] + q[2]) / 2, (p[1] + p[3] + q[1] + q[3]) / 2 - g - y];
  })));
  return [...bridges, ...chainOf(toePts.map((t) => t[n - 1]))];
}

// The foot's body: one capsule across it per interpolated row. Rows are [z, inner edge, outer edge, inner top, outer
// top, inner sole, outer sole], the edges measured from the leg's line, so each end's radius is half its height.
function footRows(x, side, rows, step) {
  return resample(rows, [0], step).map(([z, ei, eo, ti, to, si, so]) => {
    const ri = (ti - si) / 2, ro = (to - so) / 2;
    return [[x - side * (ei - ri), si + ri, z, ri], [x + side * (eo - ro), so + ro, z, ro]];
  });
}

const HAND_STEP = 0.004; // row spacing that keeps the ripple between 1 cm thick rows under 0.2 mm

// An arm hangs from the ball of its shoulder; the mitten continues the forearm's line past the wrist.
export function buildArm(side, { arm, hand }) {
  const pts = subdivide(arm, 3).map(([x, y, z, r]) => [side * x, y, z, r]);
  const [w, v] = [arm[arm.length - 1], arm[arm.length - 2]];
  const l = Math.hypot(w[0] - v[0], w[1] - v[1], w[2] - v[2]);
  const dir = [side * (w[0] - v[0]) / l, (w[1] - v[1]) / l, (w[2] - v[2]) / l];
  const wrist = pts[pts.length - 1];
  const along = (d) => [wrist[0] + dir[0] * d, wrist[1] + dir[1] * d, wrist[2] + dir[2] * d];
  const rows = resample(hand, [0], HAND_STEP).map(([d, hw, r]) => {
    const [x, y, z] = along(d);
    return [[x, y, z - hw, r], [x, y, z + hw, r]];
  });
  const segs = packSegs([...chainOf(pts), ...rows]);
  const line = [...pts, ...hand.slice(1).map(([d]) => [...along(d), 0])];
  return { kind: 'arm', side, segs, segsCoarse: segs, ...centreline(line) };
}

const hit = { d: 0, nx: 0, ny: 0, nz: 0 };

// Stepping `offset` along the normal leaves a point closer than `offset` to the other side of a concave
// crease, such as where the shoulders meet the neck. Push it out until it is `offset` from the whole union.
function clearOf(segs, out, o, offset) {
  for (let it = 0; it < 4; it++) {
    nearest(segs, out[o], out[o + 1], out[o + 2], hit);
    if (hit.d >= offset - 1e-5) return;
    const k = offset - hit.d;
    out[o] += hit.nx * k; out[o + 1] += hit.ny * k; out[o + 2] += hit.nz * k;
  }
}

// Capsules within reach of the ray from (ox, oy, oz) along unit u for RAY_REACH, copied into `cand`. The rest are
// positive all along the ray, so a march over these alone takes the same steps; it is one pass instead of forty.
const RAY_REACH = 0.6;
let cand = new Float32Array(0);
function rayCandidates(segs, ox, oy, oz, ux, uy, uz) {
  if (cand.length < segs.length) cand = new Float32Array(segs.length);
  let n = 0;
  for (let o = 0; o < segs.length; o += STRIDE) {
    // Closest points of the ray segment and the capsule axis, open pieces' overlap included.
    const grow = segs[o + 9] ? 0.25 : 0;
    const dx = segs[o + 4] * (1 + 2 * grow), dy = segs[o + 5] * (1 + 2 * grow), dz = segs[o + 6] * (1 + 2 * grow);
    const ax = segs[o] - segs[o + 4] * grow, ay = segs[o + 1] - segs[o + 5] * grow, az = segs[o + 2] - segs[o + 6] * grow;
    const rx = ox - ax, ry = oy - ay, rz = oz - az;
    const a = RAY_REACH * RAY_REACH, e = dx * dx + dy * dy + dz * dz, f = dx * rx + dy * ry + dz * rz;
    const b = RAY_REACH * (ux * dx + uy * dy + uz * dz), c = RAY_REACH * (ux * rx + uy * ry + uz * rz);
    const den = a * e - b * b;
    let s = den > 1e-18 ? Math.min(Math.max((b * f - c * e) / den, 0), 1) : 0;
    let t = e > 1e-18 ? (b * s + f) / e : 0;
    if (t < 0) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); } else if (t > 1) { t = 1; s = Math.min(Math.max((b - c) / a, 0), 1); }
    const qx = rx + ux * RAY_REACH * s - dx * t, qy = ry + uy * RAY_REACH * s - dy * t, qz = rz + uz * RAY_REACH * s - dz * t;
    const r = Math.max(segs[o + 3], segs[o + 3] + segs[o + 7]) + 1e-4;
    if (qx * qx + qy * qy + qz * qz <= r * r) { for (let q = 0; q < STRIDE; q++) cand[n + q] = segs[o + q]; n += STRIDE; }
  }
  return cand.subarray(0, n);
}

// Walk from a point inside the body along a ray to the surface, then step
// `offset` along the surface normal. Writes xyz to out[o..o+2].
function march(segs, ox, oy, oz, ux, uy, uz, offset, out, o) {
  const near = rayCandidates(segs, ox, oy, oz, ux, uy, uz);
  let lo = 0, hi = 0;
  for (let it = 0; it < 200; it++) {
    nearest(near, ox + ux * hi, oy + uy * hi, oz + uz * hi, hit);
    if (hit.d >= 0) break;
    lo = hi; hi += Math.max(-hit.d * 0.9, 2e-4);
  }
  for (let it = 0; it < 16; it++) {
    const mid = (lo + hi) / 2;
    nearest(near, ox + ux * mid, oy + uy * mid, oz + uz * mid, hit);
    if (hit.d >= 0) hi = mid; else lo = mid;
  }
  const px = ox + ux * hi, py = oy + uy * hi, pz = oz + uz * hi;
  nearest(segs, px, py, pz, hit);
  out[o] = px + hit.nx * offset; out[o + 1] = py + hit.ny * offset; out[o + 2] = pz + hit.nz * offset;
}

// Ring frame at a centre-line sample: N1 is +x with its part along the tangent removed, N2 = T x N1.
function ringFrame(c) {
  const k = c.tx;
  let ax = 1 - k * c.tx, ay = -k * c.ty, az = -k * c.tz;
  const l = Math.hypot(ax, ay, az);
  ax /= l; ay /= l; az /= l;
  return [ax, ay, az, c.ty * az - c.tz * ay, c.tz * ax - c.tx * az, c.tx * ay - c.ty * ax];
}

// Column angles of a leg's ring at arc length s, or null for even angles. Across the foot the section is wide and
// flat, where even angles bunch on the instep and leave the edges and toes a centimetre apart. There columns are even
// in arc length along the section, weighted toward the top, counted from the top point so the two legs stay mirror
// images, and they blend in from even angles as the centre line turns forward. Probed once per ring and cached, so
// the skin and the stocking share them.
function footColumns(leg) {
  const { probes: K, top, turn } = BUILD.foot, cache = new Map(), q = new Float32Array(K * 3);
  return (s, nseg) => {
    const key = `${s} ${nseg}`;
    if (cache.has(key)) return cache.get(key);
    const c = leg.atS(s), w = smoothstep(turn[0], turn[1], Math.hypot(c.tx, c.tz));
    let out = null;
    if (w > 0) {
      const [ax, ay, az, bx, by, bz] = ringFrame(c), th = (k) => (k / K) * Math.PI * 2;
      for (let k = 0; k < K; k++) {
        const ct = Math.cos(th(k)), st = Math.sin(th(k));
        march(leg.box, c.x, c.y, c.z, ax * ct + bx * st, ay * ct + by * st, az * ct + bz * st, 0, q, k * 3);
      }
      // Weighted length from the top point (k = K / 4) round to each probe.
      const acc = new Float64Array(K + 1);
      for (let i = 0; i < K; i++) {
        const a = (K / 4 + i) % K, b = (a + 1) % K;
        const len = Math.hypot(q[b * 3] - q[a * 3], q[b * 3 + 1] - q[a * 3 + 1], q[b * 3 + 2] - q[a * 3 + 2]);
        acc[i + 1] = acc[i] + len * Math.exp(top * Math.sin(th(a + 0.5)));
      }
      out = new Float64Array(nseg);
      for (let j = 0; j < nseg; j++) {
        const u = ((((j - nseg / 4) % nseg) + nseg) % nseg) / nseg * acc[K];
        let i = 0;
        while (i < K - 1 && acc[i + 1] < u) i++;
        const t = th(K / 4 + i + (u - acc[i]) / Math.max(acc[i + 1] - acc[i], 1e-12)), even = (j / nseg) * Math.PI * 2;
        const d = ((t - even) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        out[j] = even + w * d;
      }
    }
    cache.set(key, out);
    return out;
  };
}

/**
 * Tube of `rings` x `nseg` vertices wrapped around a limb from arc length s0 to s1, closed over the end by
 * `capRings` shrinking rings and a pole vertex, and over the start by `startRings` rings and a second pole
 * when that is not 0. Rings run start cap, body, end cap; the end pole follows them, then the start pole.
 * `rings` is a count spaced evenly from s0 to s1, or the body rings' arc lengths themselves.
 */
export function sweepLimb(limb, s0, s1, rings, nseg, offset, capRings, startRings = 0) {
  const at = Array.isArray(rings) ? rings : null;
  if (at) rings = at.length;
  const total = startRings + rings + capRings;
  const pos = new Float32Array((total * nseg + 1 + (startRings ? 1 : 0)) * 3);
  let o = 0;
  for (let i = 0; i < total; i++) {
    const b = i - startRings, cap = b - rings + 1; // b < 0 in the start cap, cap > 0 in the end cap
    const c = limb.atS(b < 0 ? s0 : cap > 0 ? s1 : at ? at[b] : s0 + (s1 - s0) * b / (rings - 1));
    const phi = b < 0 ? (-Math.PI / 2) * -b / (startRings + 1) : cap > 0 ? (Math.PI / 2) * cap / (capRings + 1) : 0;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const [ax, ay, az, bx, by, bz] = ringFrame(c), cols = limb.columns?.(b < 0 ? s0 : cap > 0 ? s1 : at ? at[b] : s0 + (s1 - s0) * b / (rings - 1), nseg);
    for (let j = 0; j < nseg; j++, o += 3) {
      const th = cols ? cols[j] : (j / nseg) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
      const ux = ax * ct + bx * st, uy = ay * ct + by * st, uz = az * ct + bz * st;
      march(limb.segs, c.x, c.y, c.z, ux * cp + c.tx * sp, uy * cp + c.ty * sp, uz * cp + c.tz * sp, offset, pos, o);
    }
  }
  const e = limb.atS(s1);
  march(limb.segs, e.x, e.y, e.z, e.tx, e.ty, e.tz, offset, pos, o);
  if (startRings) {
    const a = limb.atS(s0);
    march(limb.segs, a.x, a.y, a.z, -a.tx, -a.ty, -a.tz, offset, pos, o + 3);
  }
  return { pos, rings: total, segs: nseg, startPole: startRings > 0 };
}

// Mean distance from the leg centreline of each ring of a sweepLimb tube; `rings` as sweepLimb takes it.
export function ringRadii(leg, g, s0, s1, rings) {
  const out = new Float32Array(g.rings), at = Array.isArray(rings) ? rings : null;
  if (at) rings = at.length;
  for (let i = 0; i < g.rings; i++) {
    const c = leg.atS(i >= rings ? s1 : at ? at[i] : s0 + (s1 - s0) * i / (rings - 1));
    let m = 0;
    for (let j = 0; j < g.segs; j++) {
      const o = (i * g.segs + j) * 3;
      m += Math.hypot(g.pos[o] - c.x, g.pos[o + 1] - c.y, g.pos[o + 2] - c.z);
    }
    out[i] = m / g.segs;
  }
  return out;
}

/**
 * mods: thigh and glute in 0..1. band: the garment's elastic band { y, width } that digs
 * into the thigh. segs is the fine union (skin, stocking); segsCoarse omits the band detail.
 * Both run legs, torso, arms, head. `base` views the legs and torso alone: the surface every garment is cut
 * from and rests on, so shirts stay sleeveless and the arms pass through them at the shoulder.
 */
export function buildBody(shape = BODIES.feminine, mods = { thigh: 0, glute: 0 }, band = null) {
  const legs = [buildLeg(-1, shape, mods, band), buildLeg(1, shape, mods, band)];
  const arms = [buildArm(-1, shape), buildArm(1, shape)];
  const { dx } = legs[0], G = BUILD.glute, chest = mods.chest ?? DEFAULTS.chest;
  const out = ([x, y, z, r]) => [x + Math.sign(x) * dx, y, z, r];
  const bulk = ([x, y, z, r]) => [x + Math.sign(x) * dx, y, z - G.back * mods.glute, r * (1 + G.gain * mods.glute)];
  const torsoList = [
    ...shape.pelvis.map((pair) => pair.map(out)),
    ...shape.glutes.map((pair) => pair.map(bulk)),
    ...shape.waist,
    ...upperCapsules(shape, chest),
  ];
  const torsoSegs = packSegs(torsoList);
  const headSegs = packSegs(shape.head);
  const union = (key) => {
    const base = concatSegs(legs[0][key], legs[1][key], torsoSegs);
    return [concatSegs(base, arms[0][key], arms[1][key], headSegs), base.length];
  };
  // What garments are cut from over the bust: the body with the cleft bridged and the underside run out to the ribcage.
  const fillList = shape.chest ? chestCapsules(shape.chest, chest, shape.torso, true) : null;
  const fill = fillList && packSegs(fillList);
  const body = { legs, arms, limbs: [...legs, ...arms], torsoSegs, headSegs, fill, bust: fillList && bustOf(torsoList, fillList, chest), joints: shape.joints, trunk: trunkOf(shape), samplers: new Map() };
  const [segs, n] = union('segs'), [segsCoarse, nc] = union('segsCoarse');
  // segs and segsCoarse are the rest shape every builder marches; live holds the posed copies colliders read.
  const live = { segs: segs.slice(), segsCoarse: segsCoarse.slice() };
  live.base = { segs: live.segs.subarray(0, n), segsCoarse: live.segsCoarse.subarray(0, nc) };
  return Object.assign(body, { segs, segsCoarse, base: { segs: segs.subarray(0, n), segsCoarse: segsCoarse.subarray(0, nc) }, live });
}

// Rings around the torso. Below `pivot` a ring is a horizontal slice; above it the rings fan out from the pivot,
// sweeping from horizontal up to the rim of the flat cut on the neck, because a horizontal slice through a sloping
// shoulder is a thin ribbon that rays from the axis cannot sample. `u` in 0..1 climbs the slices, 1..2 runs the fan.
// Skin and shirt both sample here; the arc length table is built on first use and cached on the body.
const LEG_TOP = 1.0;
function torsoSampler(body, pivot, fill = null, bust = []) {
  const key = `${pivot}${fill ? ' fill' : ''}${bust.length ? ' bust' : ''}`, cached = body.samplers.get(key);
  if (cached) return cached;
  const torsoSegs = fill ? concatSegs(body.torsoSegs, fill) : body.torsoSegs;
  const baseSegs = fill ? concatSegs(body.base.segs, fill) : body.base.segs;
  const { bottom, top, neckZ, centreZ } = body.trunk;
  const zp = centreZ(pivot);
  const ox = [0, 0, 0], dir = [0, 0, 0];
  // The rim of the flat cut: where the union's section at y = top ends along each angle. The joint
  // spheres of a tapered, leaning neck overhang the last sphere, so it is not a circle of the last radius.
  const rims = new Map(), rim = new Float32Array(3);
  const rimAt = (th) => {
    if (!rims.has(th)) {
      march(body.torsoSegs, 0, top, neckZ, Math.cos(th), 0, Math.sin(th), 0, rim, 0);
      rims.set(th, [rim[0], rim[2]]);
    }
    return rims.get(th);
  };
  const ray = (u, th) => {
    const c = Math.cos(th), s = Math.sin(th);
    if (u <= 1) {
      const y = bottom + (pivot - bottom) * u;
      ox[1] = y; ox[2] = centreZ(y);
      dir[0] = c; dir[1] = 0; dir[2] = s;
      return;
    }
    const l = u - 1, [rx, rz] = rimAt(th), tx = rx, ty = top - pivot, tz = rz - zp, n = Math.hypot(tx, ty, tz);
    const dx = c + (tx / n - c) * l, dy = (ty / n) * l, dz = s + (tz / n - s) * l, m = Math.hypot(dx, dy, dz);
    ox[1] = pivot; ox[2] = zp;
    dir[0] = dx / m; dir[1] = dy / m; dir[2] = dz / m;
  };
  const at = (u, th, offset, out, o) => {
    ray(u, th);
    // The legs top out at y 0.99, so a ray above that only needs the torso capsules.
    const segs = ox[1] > LEG_TOP ? torsoSegs : baseSegs;
    nearest(segs, ox[0], ox[1], ox[2], hit);
    if (hit.d >= 0) throw new Error(`torso ring centre at u=${u.toFixed(3)} is outside the body`);
    march(segs, ox[0], ox[1], ox[2], dir[0], dir[1], dir[2], offset, out, o);
    if (offset > 0) clearOf(segs, out, o, offset);
  };

  // Rings are spaced by profile arc length so the near-horizontal shoulder tops get as many as the sides.
  const N = 400;
  let arc = null;
  const table = () => {
    if (arc) return arc;
    const probes = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, ...bust];
    arc = new Float64Array(N + 1);
    const prev = new Float32Array(probes.length * 3), cur = new Float32Array(3);
    for (let k = 0; k <= N; k++) {
      let d = 0, most = 0;
      probes.forEach((th, q) => {
        at(2 * k / N, th, 0, cur, 0);
        const step = k ? Math.hypot(cur[0] - prev[q * 3], cur[1] - prev[q * 3 + 1], cur[2] - prev[q * 3 + 2]) : 0;
        if (q < 4) d += step / 4; else most = Math.max(most, step);
        prev.set(cur, q * 3);
      });
      arc[k] = (k ? arc[k - 1] : 0) + Math.max(d, most);
    }
    return arc;
  };
  const point = new Float32Array(3);
  const sampler = {
    at,
    length: () => table()[N],
    uAt(s) {
      const a = table();
      let lo = 0, hi = N;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] < s) lo = mid; else hi = mid; }
      return (2 * (lo + (s - a[lo]) / Math.max(a[hi] - a[lo], 1e-12))) / N;
    },
    sAt(u) {
      const a = table(), k = Math.min(Math.max(u / 2 * N, 0), N - 1e-9), lo = Math.floor(k);
      return a[lo] + (a[lo + 1] - a[lo]) * (k - lo);
    },
    uOfY: (y) => (y - bottom) / (pivot - bottom),
    // u in the fan whose ring passes through the front (+z) at height y.
    uAtFrontY(y) {
      let lo = 1, hi = 2;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        at(mid, Math.PI / 2, 0, point, 0);
        if (point[1] < y) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    },
  };
  body.samplers.set(key, sampler);
  return sampler;
}

// `nseg` vertices around each ring in `us`, in order, `offset` along the normal off the surface.
function sampleRings(sampler, us, nseg, offset, pos = new Float32Array(us.length * nseg * 3), o = 0, angle = (j) => (j / nseg) * Math.PI * 2) {
  for (const u of us) for (let j = 0; j < nseg; j++, o += 3) sampler.at(u, angle(j), offset, pos, o);
  return pos;
}

// Skin from the crotch to the flat cut on top of the neck.
export function buildTorso(body, rings = 96, nseg = 64) {
  const { bottom, top, neckZ, pivot } = body.trunk, G = body.fill && BUILD.chest.grid;
  if (G) [rings, nseg] = [G.rings, G.segs];
  const [a, b] = G ? G.crowd : [0, 0], apexAngle = G ? Math.atan2(G.probe[1], G.probe[0]) : 0;
  const sm = torsoSampler(body, pivot, null, G ? [apexAngle, Math.PI - apexAngle] : []), len = sm.length();
  const us = Array.from({ length: rings }, (_, i) => sm.uAt(len * (1 - i / (rings - 1))));
  const pos = new Float32Array(((rings + 1) * nseg + 1) * 3);
  let o = 0;
  for (let j = 0; j < nseg; j++, o += 3) { pos[o] = 0; pos[o + 1] = top; pos[o + 2] = neckZ; } // flat cap
  // Sit just inside the true surface so the leg meshes win where they overlap.
  sampleRings(sm, us, nseg, -0.0008, pos, o, (j) => { const t = (j / nseg) * Math.PI * 2; return t + a * Math.sin(2 * t) + b * Math.cos(t); });
  // The cleft is a crease where mirrored capsules tie, and nearest() takes one side's normal for the inward offset.
  if (G) for (let i = 0, k = o; i < rings; i++) for (const j of [nseg / 4, (3 * nseg) / 4]) pos[k + (i * nseg + j) * 3] = 0;
  o += rings * nseg * 3;
  march(body.base.segs, 0, bottom, body.trunk.cz, 0, -1, 0, -0.0008, pos, o); // the crotch pole, on the surface like the rings
  return { pos, rings: rings + 1, segs: nseg };
}

// Head skin from 3 cm down the neck, so the torso's flat cut stays inside it, over the chin to a pole on the crown.
// Rays start in the middle of the skull: u in 0..1 fans up from the neck rim to horizontal, 1..2 climbs to the crown.
// Angles run from +x toward -z because the rings climb, so the triangles face out like the descending limb rings.
const HEAD_OVERLAP = 0.03;
export function buildHead(body, rings = 72, nseg = 64) {
  const segs = concatSegs(body.torsoSegs, body.headSegs), h = body.headSegs;
  const ox = h[0] + h[4] / 2, oy = h[1] + h[5] / 2, oz = h[2] + h[6] / 2;
  const pos = new Float32Array((rings * nseg + 1) * 3), rim = new Float32Array(3);
  for (let j = 0; j < nseg; j++) {
    const th = (j / nseg) * Math.PI * 2, c = Math.cos(th), s = -Math.sin(th);
    march(body.torsoSegs, 0, body.trunk.top - HEAD_OVERLAP, body.trunk.neckZ, c, 0, s, 0, rim, 0);
    const rx = rim[0] - ox, ry = rim[1] - oy, rz = rim[2] - oz, rl = Math.hypot(rx, ry, rz);
    for (let i = 0; i < rings; i++) {
      const u = 2 * i / rings;
      let dx, dy, dz;
      if (u <= 1) {
        dx = rx / rl + (c - rx / rl) * u; dy = (ry / rl) * (1 - u); dz = rz / rl + (s - rz / rl) * u;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
      } else {
        const lat = (u - 1) * Math.PI / 2, cl = Math.cos(lat);
        dx = cl * c; dy = Math.sin(lat); dz = cl * s;
      }
      march(segs, ox, oy, oz, dx, dy, dz, 0, pos, (i * nseg + j) * 3);
    }
  }
  march(segs, ox, oy, oz, 0, 1, 0, 0, pos, rings * nseg * 3);
  return { pos, rings, segs: nseg };
}

/**
 * Shirt rest shape: rings from `top` down to `hem`, `offset` off the skin, about `pitch` apart along the profile.
 * A flat top is a horizontal ring, so the horizontal slices extend up to it; otherwise the top ring is the fan ring
 * whose front point is at `top`.
 */
export function buildShirtRest(body, { top, hem, flat = false }, { offset, pitch, nseg }) {
  const sm = torsoSampler(body, flat ? top : body.trunk.pivot, body.fill);
  let rings, us;
  if (flat) {
    rings = Math.ceil((top - hem) / pitch) + 1;
    const uHem = sm.uOfY(hem);
    us = Array.from({ length: rings }, (_, i) => 1 + (uHem - 1) * i / (rings - 1));
  } else {
    const sTop = sm.sAt(sm.uAtFrontY(top)), sHem = sm.sAt(sm.uOfY(hem));
    rings = Math.ceil((sTop - sHem) / pitch) + 1;
    us = Array.from({ length: rings }, (_, i) => sm.uAt(sTop + (sHem - sTop) * i / (rings - 1)));
  }
  return { pos: sampleRings(sm, us, nseg, offset), rings, segs: nseg };
}

// A point on the neck at height y and angle th (0 = +x, pi / 2 = front), `offset` out along the normal.
export function neckPoint(body, y, th, offset) {
  const out = new Float32Array(3);
  march(body.torsoSegs, 0, y, body.trunk.neckZ, Math.cos(th), 0, Math.sin(th), offset, out, 0);
  if (offset > 0) clearOf(body.torsoSegs, out, 0, offset);
  nearest(body.torsoSegs, out[0], out[1], out[2], hit);
  return { x: out[0], y: out[1], z: out[2], nx: hit.nx, ny: hit.ny, nz: hit.nz };
}

/**
 * Ribbon of quads around the neck centred on height y. The first column is repeated at the end so UVs can wrap;
 * rows run top to bottom.
 */
export function buildChokerRest(body, { y, width, offset, nseg }) {
  const rows = Math.max(2, Math.ceil(width / 0.006) + 1), cols = nseg + 1;
  const pos = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) {
    const yy = y + width / 2 - width * i / (rows - 1);
    for (let j = 0; j < cols; j++) {
      const th = ((j % nseg) / nseg) * Math.PI * 2;
      const o = (i * cols + j) * 3;
      march(body.torsoSegs, 0, yy, body.trunk.neckZ, Math.cos(th), 0, Math.sin(th), offset, pos, o);
      clearOf(body.torsoSegs, pos, o, offset);
    }
  }
  return { pos, rings: rows, segs: nseg };
}

/**
 * Pleated skirt rest shape: a cone hung from a waist ring fitted to the body,
 * with a zigzag radial offset (4 columns per pleat) that grows toward the hem.
 */
export const SKIRT_WAIST_Y = 1.03;
export const SKIRT_OFFSET = 0.006;
export function buildSkirt(body, { pleats = 28, rings = 24, waistY = SKIRT_WAIST_Y, length = 0.33, flare = 0.4 } = {}) {
  const CZ = body.trunk.cz;
  const nseg = pleats * 4;
  const pos = new Float32Array(rings * nseg * 3);
  const waist = new Float32Array(3);
  const zig = [-1, 0, 1, 0];
  const sa = Math.sin(flare), ca = Math.cos(flare);
  for (let j = 0; j < nseg; j++) {
    const th = (j / nseg) * Math.PI * 2, ex = Math.cos(th), ez = Math.sin(th);
    march(body.base.segs, 0, waistY, CZ, ex, 0, ez, SKIRT_OFFSET, waist, 0);
    for (let i = 0; i < rings; i++) {
      const v = i / (rings - 1);
      const out = v * length * sa + zig[j % 4] * (0.002 + 0.012 * v);
      const o = (i * nseg + j) * 3;
      pos[o] = waist[0] + ex * out; pos[o + 1] = waistY - v * length * ca; pos[o + 2] = waist[2] + ez * out;
    }
  }
  return { pos, rings, segs: nseg, pleats };
}
