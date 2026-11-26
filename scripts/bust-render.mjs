// Software render of the drawn skin over the chest: the torso and arm meshes main.js builds, with the vertex normals it
// computes, lambert shaded per pixel. Writes front, three-quarter and side PNGs per chest size. With --jump it writes a
// side-view filmstrip of a jump per size instead, and with --walk one of a gait cycle, the bust bouncing as in the app,
// the view following the chest, and a guide line at the crest's height without the bounce.
// Run with: node scripts/bust-render.mjs [outDir] [sizes, comma separated] [--wire] [--jump | --walk]

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildBody, buildTorso, sweepLimb } from '../src/body.js';
import { BODIES } from '../src/presets.js';
import { gridIndex, computeNormals } from '../src/cloth.js';
import { STOCKING_BAND } from '../src/garments.js';
import { makeRig, track, applyPose, stepSoft, BLEND } from '../src/pose.js';
import { buildMotions, makeDriver, want, drive } from '../src/motion.js';

export const W = 520, H = 520;
const HALF = 0.2, CENTRE = [0, 1.235, 0.04];
const VIEWS = { front: 0, threequarter: 45, side: 90 };

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const LIGHTS = [[norm([1.2, 2.4, 1.6]), 0.72], [norm([-2.2, 0.5, 1.4]), 0.22]];
const AMBIENT = 0.14, SKIN = [214, 162, 128];

const grids = (body) => [buildTorso(body), ...body.arms.map((arm) => sweepLimb(arm, 0, arm.length, 150, 40, 0, 6, 6))];
export const shaded = ({ pos, rings, segs, startPole = false }) => {
  const index = gridIndex(rings, segs, true, true, startPole), normal = new Float32Array(pos.length);
  computeNormals(pos, index, normal);
  return { pos, index, normal };
};
const meshes = (size) => grids(buildBody(BODIES.feminine, { thigh: 0, glute: 0, chest: size }, STOCKING_BAND)).map(shaded);

// A view from `deg` about y, 0 from the front (+z): right, up and toward-the-camera axes, and what it frames.
export const yaw = (deg, centre = CENTRE, half = HALF) => {
  const a = deg * Math.PI / 180;
  return { r: [Math.cos(a), 0, -Math.sin(a)], u: [0, 1, 0], f: [Math.sin(a), 0, Math.cos(a)], centre, half };
};

// A mesh may carry its own colour, and `cull` drops its triangles that face away, as a single-sided material does.
// `lights` are [direction, strength] pairs. `won`, when given, receives per pixel the
// index in `list` of the mesh drawn there (-1 for none) and the world height of what was drawn.
export function render(list, { r, u, f, centre, half }, { wire = false, guide = null, lights = LIGHTS, won = null } = {}) {
  const depth = new Float32Array(W * H).fill(-Infinity), rgb = Buffer.alloc(W * H * 3, 236);
  const dot = (p, a) => (p[0] - centre[0]) * a[0] + (p[1] - centre[1]) * a[1] + (p[2] - centre[2]) * a[2];
  const px = (p) => (dot(p, r) / half + 1) * W / 2;
  const py = (p) => (1 - dot(p, u) / half) * H / 2;
  const pz = (p) => dot(p, f);
  if (won) won.mesh.fill(-1);
  for (const [m, { pos, index, normal, color = SKIN, cull = false }] of list.entries()) {
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], N = (i) => [normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]];
    for (let t = 0; t < index.length; t += 3) {
      const ids = [index[t], index[t + 1], index[t + 2]], v = ids.map(P), n = ids.map(N);
      const sx = v.map(px), sy = v.map(py), sz = v.map(pz);
      const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(area) < 1e-12 || (cull && area > 0)) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...sx))), x1 = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(0, Math.floor(Math.min(...sy))), y1 = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((sx[1] - qx) * (sy[2] - qy) - (sx[2] - qx) * (sy[1] - qy)) / area;
        const w1 = ((sx[2] - qx) * (sy[0] - qy) - (sx[0] - qx) * (sy[2] - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2], k = y * W + x;
        if (z <= depth[k]) continue;
        depth[k] = z;
        if (won) { won.mesh[k] = m; won.y[k] = w0 * v[0][1] + w1 * v[1][1] + w2 * v[2][1]; }
        const nn = norm([0, 1, 2].map((c) => w0 * n[0][c] + w1 * n[1][c] + w2 * n[2][c]));
        let light = AMBIENT;
        for (const [d, s] of lights) light += s * Math.max(0, nn[0] * d[0] + nn[1] * d[1] + nn[2] * d[2]);
        const edge = wire && Math.min(w0, w1, w2) < 0.04;
        for (let c = 0; c < 3; c++) rgb[k * 3 + c] = edge ? 60 : Math.min(255, color[c] * light * 1.05);
      }
    }
  }
  if (guide) {
    const y = Math.round(py(guide));
    for (let x = 0; x < W; x++) if (depth[y * W + x] === -Infinity) for (let c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = c === 2 ? 200 : 40;
  }
  return rgb;
}

export function renderChest(outDir, sizes, wire = false) {
  mkdirSync(outDir, { recursive: true });
  for (const size of sizes) {
    const list = meshes(size);
    for (const [name, deg] of Object.entries(VIEWS)) {
      const file = `${outDir}/chest${Math.round(size * 100)}-${name}${wire ? '-wire' : ''}.png`;
      writeFileSync(file, png(render(list, yaw(deg), { wire }), W, H));
      console.log(file);
    }
  }
}

// Frames after landing shown in the jump's strip, and frames into the walk where its strip starts, past the blend-in.
const AFTER = [3, 6, 9, 12, 18, 24, 36, 48];
const WALK_FROM = 180;
const DT = 1 / 60;

// Side views of a motion per size, left to right. plan(M, d) returns pick(f), the label of frame f if it is shown
// (it may also steer the driver), with pick.count the number of frames shown.
function filmstrip(outDir, sizes, wire, name, plan) {
  mkdirSync(outDir, { recursive: true });
  for (const size of sizes) {
    const body = buildBody(BODIES.feminine, { thigh: 0, glute: 0, chest: size }, STOCKING_BAND), rig = makeRig(body);
    const gs = grids(body), owners = [BLEND, ...body.arms], live = gs.map((g, k) => track(rig, g.pos, owners[k]));
    const list = gs.map((g, k) => shaded({ ...g, pos: live[k] })), M = buildMotions(rig), d = makeDriver(), pick = plan(M, d);
    // The crest without the bounce, carried by the root, so the view follows the chest and the guide marks the crest.
    const [hy, hz] = body.joints.hip, [cy, cz] = body.bust.at, offset = [CENTRE[1] - cy, CENTRE[2] - cz];
    const crest = (p) => {
      const rp = -p.root.pitch, c = Math.cos(rp), s = Math.sin(rp), dy = cy - hy, dz = cz - hz;
      return [0, hy + dy * c + dz * s + p.root.y, hz - dy * s + dz * c + p.root.z];
    };
    const frames = [];
    want(d, name);
    for (let f = 0; f < 600 && frames.length < pick.count; f++) {
      const p = drive(d, DT, rig, M);
      stepSoft(rig, p, DT);
      applyPose(rig, [], p);
      const label = pick(f);
      if (!label) continue;
      for (const m of list) computeNormals(m.pos, m.index, m.normal);
      const g = crest(p), centre = [0, g[1] + offset[0], g[2] + offset[1]];
      frames.push(render(list, yaw(VIEWS.side, centre), { wire, guide: g }));
      console.log(`chest ${size} frame ${f} (${label}): bust offset y ${(rig.soft.y * 1000).toFixed(1)} mm, z ${(rig.soft.z * 1000).toFixed(1)} mm`);
    }
    const strip = Buffer.alloc(W * frames.length * H * 3);
    frames.forEach((rgb, k) => { for (let y = 0; y < H; y++) rgb.copy(strip, (y * W * frames.length + k * W) * 3, y * W * 3, (y + 1) * W * 3); });
    const file = `${outDir}/${name}${Math.round(size * 100)}-side${wire ? '-wire' : ''}.png`;
    writeFileSync(file, png(strip, W * frames.length, H));
    console.log(file);
  }
}

/** One jump per size: take-off, apex, landing, then AFTER frames past it. */
export const renderJump = (outDir, sizes, wire = false) => filmstrip(outDir, sizes, wire, 'jump', (M, d) => {
  const fl = M.jump.segments.find((g) => g.flight), at = [fl.t0, fl.t0 + fl.T / 2, fl.t0 + fl.T];
  let landed = -1, k = 0;
  const pick = (f) => {
    const due = k < at.length ? d.t >= at[k] : f === landed + AFTER[k - at.length];
    if (k === at.length - 1 && due) { landed = f; want(d, 'stand'); }
    if (!due) return null;
    return k < at.length ? ['take-off', 'apex', 'landing'][k++] : `landing + ${AFTER[k++ - at.length]}`;
  };
  return Object.assign(pick, { count: at.length + AFTER.length });
});

/** One gait cycle of the steady walk per size, in ten even steps. */
export const renderWalk = (outDir, sizes, wire = false) => filmstrip(outDir, sizes, wire, 'walk', (M, d) => {
  const at = Array.from({ length: 10 }, (_, k) => WALK_FROM + Math.round(k * M.walk.period / DT / 10));
  const pick = (f) => (at.includes(f) ? `gait phase ${(d.t / M.walk.period % 1).toFixed(2)}` : null);
  return Object.assign(pick, { count: at.length });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), plain = args.filter((a) => !a.startsWith('--'));
  (args.includes('--jump') ? renderJump : args.includes('--walk') ? renderWalk : renderChest)(plain[0] ?? 'render', (plain[1] ?? '0,0.5,1').split(',').map(Number), args.includes('--wire'));
}
