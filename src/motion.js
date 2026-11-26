// Motions over time, built from the MOTIONS table for one rig, and the state machine that blends between them.
// Plain code with no rendering imports: the node test drives it frame by frame.

import { MOTIONS, MOTION_BLEND, VIEW } from './presets.js';
import { STAND, feetOf, bendToes } from './pose.js';

const DEG = Math.PI / 180, G = 9.8;
const LEG = ['hip', 'knee', 'ankle'], ARM = ['shoulder', 'elbow'];
const hermite = (y0, m0, y1, m1, s) => {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * m0 + (3 * s2 - 2 * s3) * y1 + (s3 - s2) * m1;
};
// Quintic from (y, v, a) to (y, v, a) over T seconds, at time t.
function quintic([y0, v0, a0], [y1, v1, a1], T, t) {
  const s = t / T, s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s, T2 = T * T;
  return (1 - 10 * s3 + 15 * s4 - 6 * s5) * y0 + (s - 6 * s3 + 8 * s4 - 3 * s5) * v0 * T + (s2 - 3 * s3 + 3 * s4 - s5) * a0 * T2 / 2
    + (10 * s3 - 15 * s4 + 6 * s5) * y1 + (-4 * s3 + 7 * s4 - 3 * s5) * v1 * T + (s3 - 2 * s4 + s5) * a1 * T2 / 2;
}

// A C1 periodic curve through [phase, degrees] keys, in radians, with Catmull-Rom tangents.
function periodic(keys) {
  const n = keys.length;
  const key = (k) => { const q = ((k % n) + n) % n; return [keys[q][0] + Math.floor(k / n), keys[q][1] * DEG]; };
  const slope = keys.map((_, k) => { const [t0, v0] = key(k - 1), [t1, v1] = key(k + 1); return (v1 - v0) / (t1 - t0); });
  return (p) => {
    p -= Math.floor(p);
    let k = n - 1;
    while (keys[k][0] > p) k--;
    const [t0, v0] = key(k), [t1, v1] = key(k + 1), h = t1 - t0;
    return hermite(v0, slope[k] * h, v1, slope[(k + 1) % n] * h, (p - t0) / h);
  };
}

// A C1 periodic curve through values on a uniform grid over one cycle.
function grid(v) {
  const n = v.length, at = (k) => v[((k % n) + n) % n];
  return (p) => {
    const x = (p - Math.floor(p)) * n, k = Math.floor(x), s = x - k;
    return hermite(at(k), (at(k + 1) - at(k - 1)) / 2, at(k + 1), (at(k + 2) - at(k)) / 2, s);
  };
}
const FIX_GRID = 600;

const zeroPose = () => ({ root: { y: 0, z: 0, pitch: 0 }, ...Object.fromEntries([...LEG, 'toe', ...ARM].flatMap((j) => [[j + 'L', 0], [j + 'R', 0]])) });

function buildCycle(def, rig) {
  const curves = Object.fromEntries([...LEG, ...ARM].map((j) => [j, periodic(def[j])]));
  const lean = def.lean * DEG, [p0, p1, p2, p3] = def.push, [lo0, hi0] = def.reach.map((v) => v * DEG);
  const share = (q) => (q <= p0 || q >= p3 ? 0 : q < p1 ? smooth((q - p0) / (p1 - p0)) : q <= p2 ? 1 : smooth((p3 - q) / (p3 - p2)));
  const F = { low: [0, 0], z: 0 };
  // The trailing leg's change that brings foot k level with the other foot: d < 0 plantarflexes the ankle (a
  // longer reach), d > 0 bends the knee (a shorter one). A bent knee only shortens the leg, so that side bisects.
  // Plantarflexion stops lowering the toe once the foot points down, so a gap it cannot close takes the toe's
  // lowest reach instead, which keeps d continuous as the toe leaves the floor.
  const bisect = (gap, lo, hi) => {
    for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (gap(mid) > 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  };
  const reach = (pose, k) => {
    const s = k ? 'R' : 'L', ankle = pose['ankle' + s], knee = pose['knee' + s];
    const gap = (d) => {
      pose['ankle' + s] = ankle + Math.min(d, 0); pose['knee' + s] = knee + Math.max(d, 0);
      const f = feetOf(rig, pose, F, true);
      return f.low[k] - f.low[1 - k];
    };
    let d;
    if (gap(0) <= 0) d = gap(hi0) <= 0 ? hi0 : bisect(gap, 0, hi0);
    else {
      let a = lo0, b = 0;
      for (let it = 0; it < 30; it++) {
        const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
        if (gap(m1) < gap(m2)) b = m2; else a = m1;
      }
      const low = (a + b) / 2;
      d = gap(low) >= 0 ? low : bisect(gap, low, 0);
    }
    pose['ankle' + s] = ankle; pose['knee' + s] = knee;
    return d;
  };
  const period = 2 / def.cadence;
  const keyed = (p, pose = zeroPose()) => {
    pose.root.pitch = lean;
    for (const [s, q] of [['L', p], ['R', p + 0.5]]) for (const j of [...LEG, ...ARM]) pose[j + s] = curves[j](q);
    return pose;
  };
  // The correction is solved once per body on a grid over the left leg's cycle (the right leg is its mirror half
  // a cycle on) and limited to `rate`, so a toe chasing a floor it can barely reach does not snap.
  const fix = new Float64Array(FIX_GRID), step = def.rate * DEG * period / FIX_GRID;
  for (let k = 0; k < FIX_GRID; k++) { const w = share(k / FIX_GRID); if (w > 0) fix[k] = w * reach(keyed(k / FIX_GRID), 0); }
  for (let k = 1; k < FIX_GRID; k++) fix[k] = Math.min(Math.max(fix[k], fix[k - 1] - step), fix[k - 1] + step);
  for (let k = FIX_GRID - 2; k >= 0; k--) fix[k] = Math.min(Math.max(fix[k], fix[k + 1] - step), fix[k + 1] + step);
  const fixAt = grid(fix);
  return {
    period, plant: false, stance: def.stance,
    calm: () => true,
    // Gait phase p: the left side at p, the right half a cycle later.
    sample(t, pose = zeroPose()) {
      const p = t / period;
      keyed(p, pose);
      for (const [s, q] of [['L', p], ['R', p + 0.5]]) {
        const d = fixAt(q);
        if (d < 0) pose['ankle' + s] += d; else pose['knee' + s] += d;
      }
      return { pose, lift: 0 };
    },
  };
}

// Smooth positive part of c: 0 below -w, c above w, a parabola in between.
const ease = (c, w) => (c <= -w ? 0 : c >= w ? c : (c + w) * (c + w) / (4 * w));

function buildJump(def, rig) {
  const { crouch: C, point: Pt } = def, w = def.blend;
  const family = (c, pose = zeroPose()) => {
    const e = ease(c, w), q = ease(-c, w);
    const hip = C.hip * DEG * e, knee = C.knee * DEG * e, pitch = C.lean * DEG * e;
    const ankle = knee - hip + pitch + Pt.ankle * DEG * q; // the crouch part keeps the foot flat
    pose.root.pitch = pitch;
    for (const s of ['L', 'R']) {
      pose['hip' + s] = hip; pose['knee' + s] = knee; pose['ankle' + s] = ankle;
      pose['shoulder' + s] = (C.shoulder * e + Pt.shoulder * q) * DEG;
      pose['elbow' + s] = (C.elbow * e + Pt.elbow * q) * DEG;
    }
    return pose;
  };
  const F = { low: [0, 0], z: 0 }, scratch = zeroPose();
  const height = (c) => -Math.min(...feetOf(rig, family(c, scratch), F, true).low); // root y with the feet on the floor
  for (let c = -1; c < 1; c += 0.01) {
    if (!(height(c + 0.01) < height(c))) throw new Error(`jump: root height does not fall with the crouch at c ${c.toFixed(2)}`);
  }
  // c whose floor-contact root height is y; the height falls as c grows.
  const crouchAt = (y) => {
    let lo = -1, hi = 1;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (height(mid) > y) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  const ph = def.phases, n = ph.length, fi = ph.findIndex((p) => p.flight);
  const cTake = ph[(fi - 1 + n) % n].c, yTake = height(cTake);
  const v0 = Math.sqrt(2 * G * (def.apex - yTake)), flight = 2 * v0 / G;
  // Ground phases run from rest to rest, except at take-off and landing, where the root moves at the flight's
  // speed under gravity alone: the floor's push fades to nothing as the feet leave it.
  let t = 0;
  const segments = ph.map((p, k) => {
    const lands = k === (fi + 1) % n, takes = k === (fi - 1 + n) % n, c0 = lands ? cTake : ph[(k - 1 + n) % n].c;
    const y0 = height(c0), y1 = height(p.c);
    const seg = { ...p, c0, y0, t0: t, T: p.flight ? flight : p.t, from: lands ? [y0, -v0, -G] : [y0, 0, 0], to: takes ? [y1, v0, -G] : [y1, 0, 0] };
    t += seg.T;
    return seg;
  });
  for (const s of segments) {
    if (s.flight) continue;
    const dir = Math.sign(s.to[0] - s.from[0]);
    for (let a = 0.01; a < s.T; a += 0.01) {
      if ((quintic(s.from, s.to, s.T, a) - quintic(s.from, s.to, s.T, a - 0.01)) * dir < 0) throw new Error(`jump: ${s.name} overshoots; give it more or less time`);
    }
  }
  const period = t, calmUntil = segments[(fi - 1 + n) % n].t0 - MOTION_BLEND;
  return {
    period, plant: true, v0, flight, segments,
    // Late enough in the cycle to blend out before the push.
    calm: (time) => time - Math.floor(time / period) * period <= calmUntil,
    sample(time, pose = zeroPose()) {
      const u = time - Math.floor(time / period) * period;
      const s = segments.find((g) => u < g.t0 + g.T) ?? segments[n - 1], a = u - s.t0;
      if (s.flight) {
        const c = s.c0 + (s.c - s.c0) * Math.sin(Math.PI * a / s.T) ** 2;
        family(c, pose);
        return { pose, lift: s.y0 + v0 * a - G * a * a / 2 - height(c) };
      }
      return { pose: family(crouchAt(quintic(s.from, s.to, s.T, a)), pose), lift: 0 };
    },
  };
}

const BUILDERS = { cycle: buildCycle, jump: buildJump };

// Every motion but stand, built for a rig. The jump's timing depends on the feet the rig's body stands on.
export const buildMotions = (rig) => Object.fromEntries(Object.entries(MOTIONS).filter(([, d]) => d.kind).map(([id, d]) => [id, BUILDERS[d.kind](d, rig)]));

const smooth = (a) => a * a * (3 - 2 * a);

/**
 * The pose of motion m at time t with amplitude a in 0..1: joint angles scale with a, then the root drops the
 * lower foot onto the floor (y = 0), rises by the flight above it, and for a planted motion slides so the ankles
 * keep their rest z. At a = 0 this is STAND, whose feet rest a few millimetres up, so that gap fades with a. The
 * foot stands on its ball and heel, and the toes bend up as far as the floor makes them.
 */
export function motionPose(rig, m, t, a = 1) {
  const { pose, lift } = m.sample(t);
  for (const k of Object.keys(pose)) if (k !== 'root') pose[k] *= a;
  pose.root.pitch *= a;
  const F = feetOf(rig, pose, undefined, true), rest = (rig.restFeet ??= feetOf(rig, STAND, undefined, true));
  pose.root.y = -Math.min(...F.low) + a * lift + (1 - a) * Math.min(...rest.low);
  pose.root.z = m.plant ? rest.z - F.z : 0;
  return bendToes(rig, pose);
}

// Motion state machine. still: STAND exactly, nothing posed. in: amplitude rising. run: full amplitude.
// out: waiting for a calm moment of the motion, then amplitude falling, then on to `next`.
const STATES = {
  still: {
    want: (d, id) => { if (id !== 'stand') Object.assign(d, { state: 'in', id, t: 0, amp: 0 }); },
    tick: () => {},
  },
  in: {
    want: (d, id) => { if (id !== d.id) Object.assign(d, { state: 'out', next: id, fading: true }); },
    tick: (d, dt) => { d.amp = Math.min(d.amp + dt / MOTION_BLEND, 1); if (d.amp === 1) d.state = 'run'; },
  },
  run: {
    want: (d, id) => { if (id !== d.id) Object.assign(d, { state: 'out', next: id, fading: false }); },
    tick: () => {},
  },
  out: {
    want: (d, id) => { if (id === d.id) Object.assign(d, { state: 'in' }); else d.next = id; },
    tick: (d, dt, m) => {
      d.fading ||= m.calm(d.t);
      if (d.fading) d.amp = Math.max(d.amp - dt / MOTION_BLEND, 0);
      if (d.amp > 0) return;
      if (d.next === 'stand') Object.assign(d, { state: 'still', id: 'stand', t: 0 });
      else Object.assign(d, { state: 'in', id: d.next, t: 0 });
    },
  },
};

export const makeDriver = () => ({ state: 'still', id: 'stand', next: null, t: 0, amp: 0, fading: false });
export const want = (d, id) => STATES[d.state].want(d, id);

// A rebuilt figure starts from STAND, so a running motion blends in again from the start of its cycle.
export function restart(d) {
  if (d.state === 'in' || d.state === 'run') Object.assign(d, { state: 'in', t: 0, amp: 0 });
  else if (d.state === 'out') d.amp = 0;
}

/** Advances the driver one step and returns the pose to hold: STAND itself while still. */
export function drive(d, dt, rig, motions) {
  if (d.state !== 'still') d.t += dt;
  STATES[d.state].tick(d, dt, motions[d.id]);
  if (d.state === 'still') return STAND;
  return motionPose(rig, motions[d.id], d.t, smooth(d.amp));
}

// The view's rise after one step of dt toward its share of the root's height above standing.
export function followView(lift, rootY, dt, { share, lag } = VIEW.follow) {
  return lift + (share * Math.max(rootY, 0) - lift) * (1 - Math.exp(-dt / lag));
}
