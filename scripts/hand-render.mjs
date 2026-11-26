// Software render of the hands with bust-render's rasterizer: the arm and hand skin main.js draws, among the legs,
// torso and the skirt's cloth stepped through a walk. Per body, at rest and at the walk's two arm-swing extremes, it
// writes the right hand from the back, the palm, the thumb's side, past the fingertips and close from three quarters,
// and the figure from the right side with the right hand close from the front and the side. It prints how near the
// skirt's cloth comes to each hand there and over a whole cycle.
// Run with: node scripts/hand-render.mjs [outDir] [--wire]

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildBody, buildTorso } from '../src/body.js';
import { BODIES } from '../src/presets.js';
import { legSkin, armSkins, makeSkirt, STOCKING_BAND } from '../src/garments.js';
import { computeNormals, stepCloth } from '../src/cloth.js';
import { makeRig, track, applyPose, STAND, BLEND } from '../src/pose.js';
import { buildMotions, makeDriver, want, drive } from '../src/motion.js';
import { render, shaded } from './bust-render.mjs';
import { look, lightsFor, strip } from './foot-render.mjs';

const DEG = Math.PI / 180, DT = 1 / 60, SKIN = [214, 162, 128], SKIRT = [92, 98, 124];
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const neg = (v) => v.map((c) => -c);
const mix = (...terms) => norm([0, 1, 2].map((k) => terms.reduce((s, [w, v]) => s + w * v[k], 0)));
const shoot = (list, views, wire) => strip(views.map((v) => render(list, v, { wire, lights: lightsFor(v) })));

// Closest any skirt vertex comes to the hand's vertices.
function nearSkirt(skirt, hand) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], R = 0.05;
  for (let i = 0; i < hand.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], hand[i + k]); hi[k] = Math.max(hi[k], hand[i + k]); }
  let best = Infinity;
  for (let j = 0; j < skirt.length; j += 3) {
    if ([0, 1, 2].some((k) => skirt[j + k] < lo[k] - R || skirt[j + k] > hi[k] + R)) continue;
    for (let i = 0; i < hand.length; i += 3) best = Math.min(best, Math.hypot(skirt[j] - hand[i], skirt[j + 1] - hand[i + 1], skirt[j + 2] - hand[i + 2]));
  }
  return best;
}

function renderHands(outDir, wire) {
  mkdirSync(outDir, { recursive: true });
  const tag = wire ? '-wire' : '', mm = (v) => (v === Infinity ? 'over 50' : (v * 1000).toFixed(1));
  for (const [id, shape] of Object.entries(BODIES)) {
    const body = buildBody(shape, { thigh: 0, glute: 0 }, STOCKING_BAND), arm = body.arms[1], rig = makeRig(body), skirt = makeSkirt(body);
    const tracked = (g, by) => ({ ...shaded({ ...g, pos: track(rig, g.pos, by) }), color: SKIN, cull: true });
    const arms = body.arms.map((m) => armSkins(m).map((g) => tracked(g, m))), hands = arms.map(([, h]) => h);
    const context = [...body.legs.map((l) => tracked(legSkin(l), l)), tracked(buildTorso(body), BLEND), ...arms[0], { ...shaded({ pos: skirt.pos, index: skirt.index }), color: SKIRT }];
    const list = [...arms[1], ...context];
    // The right hand's frame as the rig carries it: its origin and points 1 cm along its three axes.
    const { o, a, c, p } = arm.frame, axes = track(rig, Float32Array.from([o, ...[a, c, p].map((e) => o.map((v, k) => v + 0.01 * e[k]))].flat()), arm);
    const frame = () => { const q = (k) => [0, 1, 2].map((i) => axes[k * 3 + i]), O = q(0); return [O, ...[1, 2, 3].map((k) => q(k).map((v, i) => (v - O[i]) / 0.01))]; };
    const centreOf = ({ pos }) => [0, 1, 2].map((k) => { let s = 0; for (let i = k; i < pos.length; i += 3) s += pos[i]; return s / (pos.length / 3); });
    for (let f = 0; f < 2000 && !skirt.asleep; f++) stepCloth(skirt, DT);
    skirt.initial.set(skirt.pos);
    const snap = [skirt.pos.slice(), skirt.prev.slice()];

    // The right hand from the back, the palm, the thumb's side, past the fingertips and close from three quarters,
    // with the rest of the figure and the skirt behind it; the palm and fingertip views leave those out, as they would
    // stand between the hand and the eye. Then the figure from the right side, and the right hand from the front and
    // the side among them.
    const shot = (name, pose) => {
      for (const m of list) computeNormals(m.pos, m.index, m.normal);
      const [O, A, C, P] = frame(), at = (d, u, h) => [0, 1, 2].map((k) => O[k] + A[k] * d + C[k] * u + P[k] * h), mid = at(0.1, -0.002, 0.012), up = neg(A);
      const views = [[look(neg(P), mid, 0.11, up), list], [look(P, mid, 0.11, up), arms[1]], [look(C, mid, 0.11, up), list],
        [look(A, at(0.14, -0.005, 0.02), 0.07, neg(P)), arms[1]], [look(mix([-1, P], [0.8, C], [0.6, A]), at(0.12, 0, 0.01), 0.065, up), list]];
      const h = centreOf(hands[1]), wide = [look([1, 0, 0], [h[0], 0.85, 0.02], 0.3), look([0, 0, 1], h, 0.12), look([1, 0, 0], h, 0.12)];
      const files = [`${outDir}/${id}-hand-${name}${tag}.png`, `${outDir}/${id}-walk-${name}${tag}.png`];
      writeFileSync(files[0], strip(views.map(([v, l]) => render(l, v, { wire, lights: lightsFor(v) }))));
      writeFileSync(files[1], shoot(list, wide, wire));
      console.log(`${files.join(', ')}: right shoulder ${((pose.shoulderR ?? 0) / DEG).toFixed(1)} deg, elbow ${((pose.elbowR ?? 0) / DEG).toFixed(1)} deg; nearest skirt vertex ${hands.map((m) => mm(nearSkirt(skirt.pos, m.pos))).join(' / ')} mm from the left / right hand's vertices`);
    };
    shot('rest', STAND);

    // The second cycle's frames where the right arm swings furthest forward and back, then the walk again through it.
    const M = buildMotions(rig), period = M.walk.period, d = makeDriver(), ext = { forward: [-Infinity, 0], back: [Infinity, 0] };
    want(d, 'walk');
    for (let f = 0; d.t < 2 * period; f++) {
      const q = drive(d, DT, rig, M);
      if (d.t < period) continue;
      if (q.shoulderR > ext.forward[0]) ext.forward = [q.shoulderR, f];
      if (q.shoulderR < ext.back[0]) ext.back = [q.shoulderR, f];
    }
    applyPose(rig, [skirt], STAND);
    skirt.pos.set(snap[0]); skirt.prev.set(snap[1]);
    const e = makeDriver(), near = [Infinity, Infinity];
    want(e, 'walk');
    for (let f = 0; e.t < 2 * period; f++) {
      const q = drive(e, DT, rig, M);
      applyPose(rig, [skirt], q);
      stepCloth(skirt, DT);
      if (e.t >= period) hands.forEach((m, k) => { near[k] = Math.min(near[k], nearSkirt(skirt.pos, m.pos)); });
      for (const [name, [, frame]] of Object.entries(ext)) if (f === frame) shot(name, q);
    }
    console.log(`${id}: over the second walk cycle the nearest skirt vertex came ${near.map(mm).join(' / ')} mm from the left / right hand's vertices`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), plain = args.filter((a) => !a.startsWith('--'));
  renderHands(plain[0] ?? 'render', args.includes('--wire'));
}
