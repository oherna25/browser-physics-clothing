// Software render of the feet with bust-render's rasterizer: the drawn skin of the legs and toes and the stockings
// settled over them, in one depth buffer as the app draws them, the knit opaque. Skin that wins a pixel below the
// stocking's top shows bare through the knit in the app, so every image prints how many pixels it wins.
// Per body it writes the right foot at rest from the outer side, the inner side, the top, the front low down, the
// sole and close on the toes (the top view leans forward so the shin hides only the ankle), once bare and once
// stockinged; the left foot from its outer side through the walk's push-off with the floor drawn, counting every
// frame of a whole cycle from three sides; and both feet on tiptoe (the jump's pointed ankle, planted on the floor).
// Run with: node scripts/foot-render.mjs [outDir] [--wire]

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildBody } from '../src/body.js';
import { BODIES, MOTIONS, POSE } from '../src/presets.js';
import { legSkin, toeSkins, makeStocking, STOCKING_BAND, STOCKING_TOP_Y } from '../src/garments.js';
import { computeNormals, stepCloth, resetCloth } from '../src/cloth.js';
import { makeRig, track, applyPose, makePose, blendPose, STAND } from '../src/pose.js';
import { buildMotions, makeDriver, want, drive, motionPose } from '../src/motion.js';
import { png, render, shaded, W, H } from './bust-render.mjs';

const DEG = Math.PI / 180, DT = 1 / 60, HALF = 0.15;
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// f points from the scene toward the camera; `up` is a hint the image's up axis leans toward.
const look = (f, centre, half = HALF, up = [0, 1, 0]) => {
  f = norm(f);
  const r = norm(cross(up, f));
  return { r, u: cross(f, r), f, centre, half };
};
const lightsFor = ({ r, u, f }) => [[norm(r.map((c, k) => -0.5 * c + 0.8 * u[k] + f[k])), 0.72], [norm(r.map((c, k) => 0.9 * c - 0.2 * u[k] + 0.6 * f[k])), 0.22]];
const SKIN = [214, 162, 128], NYLON = [96, 104, 128];

const strip = (panels) => {
  const out = Buffer.alloc(W * panels.length * H * 3);
  panels.forEach((rgb, k) => { for (let y = 0; y < H; y++) rgb.copy(out, (y * W * panels.length + k * W) * 3, y * W * 3, (y + 1) * W * 3); });
  return png(out, W * panels.length, H);
};
const refresh = (list) => { for (const m of list) computeNormals(m.pos, m.index, m.normal); };
const won = { mesh: new Int32Array(W * H), y: new Float32Array(W * H) };

// One panel and, when a stocking is drawn, the pixels where skin wins below its top.
function shoot(list, view, wire, guide = null) {
  const rgb = render(list, view, { wire, lights: lightsFor(view), guide, won });
  let poke = 0;
  if (list.every((m) => m.skin)) return { rgb, poke };
  for (let k = 0; k < W * H; k++) if (won.mesh[k] >= 0 && list[won.mesh[k]].skin && won.y[k] < STOCKING_TOP_Y) { poke++; rgb[k * 3] = 255; rgb[k * 3 + 1] = 0; rgb[k * 3 + 2] = 255; }
  return { rgb, poke };
}

// The skin meshes of a leg, tracked by the rig, and its stocking, which the caller steps.
function dress(rig, body, leg) {
  const skin = [legSkin(leg), ...toeSkins(leg)].map((g) => ({ ...shaded({ ...g, pos: track(rig, g.pos, leg) }), color: SKIN, skin: true, cull: true }));
  const cloth = makeStocking(body, leg);
  return { leg, skin, cloth, stocking: { ...shaded({ pos: cloth.pos, rings: cloth.rings, segs: cloth.segs }), index: cloth.index, color: NYLON } };
}
const settle = (cloths, frames = 300) => { for (let f = 0; f < frames && !cloths.every((c) => c.asleep); f++) for (const c of cloths) stepCloth(c, DT); };

function renderFeet(outDir, wire) {
  mkdirSync(outDir, { recursive: true });
  const tag = wire ? '-wire' : '';
  for (const [id, shape] of Object.entries(BODIES)) {
    const body = buildBody(shape, { thigh: 0, glute: 0 }, STOCKING_BAND), rig = makeRig(body);
    const legs = body.legs.map((leg) => dress(rig, body, leg)), cloths = legs.map((l) => l.cloth), R = legs[1];
    settle(cloths);
    const x = R.leg.atS(0).x, side = Math.sign(x), centre = [x, 0.045, 0.07];
    const views = {
      outer: look([side, 0, 0], centre), inner: look([-side, 0, 0], centre), top: look([0, 1, 0.3], centre, HALF, [0, 0, 1]),
      front: look([0, 0.25, 1], [x, 0.03, 0.12], 0.08), sole: look([0, -1, 0], centre, HALF, [0, 0, 1]), toes: look([0.55 * side, 0.6, 0.75], [x, 0.02, 0.15], 0.07),
    };
    for (const [name, list] of [['skin', R.skin], ['stocking', [...R.skin, R.stocking]]]) {
      refresh(list);
      const shots = Object.entries(views).map(([v, view]) => [v, shoot(list, view, wire)]);
      const file = `${outDir}/${id}-${name}-rest${tag}.png`;
      writeFileSync(file, strip(shots.map(([, s]) => s.rgb)));
      console.log(`${file}${name === 'stocking' ? `: skin through the stocking ${shots.map(([v, s]) => `${v} ${s.poke}`).join(', ')} px` : ''}`);
    }

    // The left foot from its outer side through the push-off, the floor drawn at y = 0 and the view following the ankle.
    // Every frame of the second cycle is counted from the outer side, the inner side and above the toes.
    const M = buildMotions(rig), d = makeDriver(), L = legs[0], list = [...L.skin, L.stocking], phases = [0, 0.3, 0.5, 0.56, 0.6, 0.64, 0.7];
    const frames = [], worst = { poke: 0, at: '' }, period = M.walk.period, rest = legSkin(L.leg).pos;
    want(d, 'walk');
    for (let f = 0; d.t < 2 * period; f++) {
      const p = drive(d, DT, rig, M), phase = (d.t / period) % 1;
      applyPose(rig, cloths, p);
      for (const c of cloths) stepCloth(c, DT);
      if (d.t < period) continue;
      refresh(list);
      let z = 0, n = 0;
      for (let i = 0; i < rest.length; i += 3) if (rest[i + 1] < 0.06) { z += L.skin[0].pos[i + 2]; n++; }
      const at = [-x, 0.07, z / n], side3 = [look([-side, 0, 0], at, 0.17), look([side, 0, 0], at, 0.17), look([-0.5 * side, 0.6, 0.75], [-x, 0.03, z / n + 0.1], 0.09)];
      const shots = side3.map((v) => shoot(list, v, wire, [0, 0, 0]));
      for (const [k, s] of shots.entries()) if (s.poke > worst.poke) Object.assign(worst, { poke: s.poke, at: `phase ${phase.toFixed(2)} view ${k}`, rgb: s.rgb });
      if (phases.length && Math.abs(((phase - phases[0] + 1.5) % 1) - 0.5) <= DT / period / 2 + 1e-9) {
        phases.shift();
        frames.push(shots[0].rgb);
        console.log(`${id} walk gait phase ${phase.toFixed(2)}: ankle ${(p.ankleL / DEG).toFixed(1)} deg, toes ${((p.toeL ?? 0) / DEG).toFixed(1)} deg, knee ${(p.kneeL / DEG).toFixed(1)} deg; skin through the stocking ${shots.map((s) => s.poke).join(' / ')} px`);
      }
    }
    const file = `${outDir}/${id}-pushoff${tag}.png`;
    writeFileSync(file, strip(frames));
    console.log(`${file}: most skin through the stocking over a whole cycle ${worst.poke} px${worst.poke ? ` (${worst.at})` : ''}`);
    if (worst.poke) writeFileSync(`${outDir}/${id}-walk-worst${tag}.png`, png(worst.rgb, W, H));

    // Tiptoe: both ankles at the jump's pointed angle, the root dropped until the lower foot meets the floor.
    const tip = MOTIONS.jump.point.ankle * DEG, pose = motionPose(rig, { plant: true, sample: () => ({ pose: makePose({ ankleL: tip, ankleR: tip }), lift: 0 }) }, 0);
    applyPose(rig, cloths, STAND);
    for (const c of cloths) resetCloth(c);
    for (let k = 1; k <= POSE.ramp; k++) { applyPose(rig, cloths, blendPose(STAND, pose, k / POSE.ramp)); for (const c of cloths) stepCloth(c, DT); }
    settle(cloths, 120);
    const tl = [...R.skin, R.stocking], tv = [look([side, 0, 0], [x, 0.1, 0.06], 0.17), look([-side, 0, 0], [x, 0.1, 0.06], 0.17), look([0.6 * side, 0.3, 0.75], [x, 0.03, 0.12], 0.09)];
    refresh(tl);
    const shots = tv.map((v) => shoot(tl, v, wire, [0, 0, 0]));
    const tfile = `${outDir}/${id}-tiptoe${tag}.png`;
    writeFileSync(tfile, strip(shots.map((s) => s.rgb)));
    console.log(`${tfile}: toes ${((pose.toeR ?? 0) / DEG).toFixed(1)} deg; skin through the stocking ${shots.map((s) => s.poke).join(' / ')} px`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), plain = args.filter((a) => !a.startsWith('--'));
  renderFeet(plain[0] ?? 'render', args.includes('--wire'));
}
