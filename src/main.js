import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBody, buildTorso, buildHead, buildChokerRest, neckPoint, sweepLimb } from './body.js';
import { makeStocking, makeSkirt, makeShirt, legSkin, STOCKING_BAND } from './garments.js';
import { stepCloth, beginGrab, endGrab, resetCloth, computeStretch, computeNormals, gridIndex } from './cloth.js';
import { buildMotions, makeDriver, want, restart, drive, followView } from './motion.js';
import { makeRig, track, follow, poseSet, angleOf, applyPose, stepSoft, makePose, blendPose, STAND, ROOT, BLEND } from './pose.js';
import { nylonMaterial, setNylonColour } from './nylon.js';
import { colourCss, patternTexture, repaint } from './colourway.js';
import { BODIES, SKIN_TONES, STOCKING_COLORS, SKIRT_COLORS, SHIRT_STYLES, SHIRT_COLORS, CHOKER_STYLES, CHOKER_COLORS, CHOKER, DEFAULTS, POSE, MOTIONS, VIEW } from './presets.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // keeps skin hue where ACES shifts it
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8d5cf);
scene.fog = new THREE.Fog(0xd8d5cf, 4, 9);

const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.05, 30);
camera.position.set(...VIEW.camera);
const controls = new OrbitControls(camera, canvas);
controls.target.set(...VIEW.target);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.55;
controls.update();

// --- Lights and room ---
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;
pmrem.dispose();

const LIGHT_DIR = new THREE.Vector3(...VIEW.light).normalize();
const key = new THREE.DirectionalLight(0xfff0e0, 2.0);
key.position.copy(LIGHT_DIR).multiplyScalar(4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, VIEW.shadow);
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.004;
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd0ff, 0.45);
fill.position.set(-2.2, 0.5, 1.4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xfff2e0, 1.3);
rim.position.set(-0.8, 1.6, -2.4);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xb4b0aa, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// --- Materials ---
// Cheap subsurface look: wrap light around the terminator and at grazing angles,
// tinted by the tone's scatter colour.
const skinUniforms = { uScatter: { value: new THREE.Color() }, uKeyDir: { value: LIGHT_DIR } };
const skinMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, sheen: 0.35, sheenRoughness: 0.6 });
skinMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, skinUniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uScatter;\nuniform vec3 uKeyDir;')
    .replace('#include <opaque_fragment>', `
      {
        vec3 Ls = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
        float nl = dot(normal, Ls);
        float terminator = smoothstep(-0.4, 0.1, nl) * (1.0 - smoothstep(0.1, 0.55, nl));
        float grazing = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += uScatter * diffuseColor.rgb * (terminator * 0.45 + grazing * 0.12);
      }
      #include <opaque_fragment>`);
};
skinMat.customProgramCacheKey = () => 'skin-scatter';

const nylon = nylonMaterial(LIGHT_DIR);

const skirtCanvas = document.createElement('canvas');
skirtCanvas.width = skirtCanvas.height = 256;
const skirtTex = new THREE.CanvasTexture(skirtCanvas);
skirtTex.wrapS = skirtTex.wrapT = THREE.RepeatWrapping;
skirtTex.colorSpace = THREE.SRGBColorSpace;
skirtTex.anisotropy = 8;

function paintPlaid(p) {
  const x = skirtCanvas.getContext('2d');
  x.globalAlpha = 1;
  x.fillStyle = p.base; x.fillRect(0, 0, 256, 256);
  const band = (color, alpha, at, w) => { x.globalAlpha = alpha; x.fillStyle = color; x.fillRect(at, 0, w, 256); x.fillRect(0, at, 256, w); };
  band(p.dark, 0.38, 0, 72);
  band(p.light, 0.07, 128, 56);
  band(p.line, 0.22, 100, 3);
  band(p.line, 0.22, 210, 3);
  band(p.dark, 0.5, 34, 4);
  skirtTex.needsUpdate = true;
}

// --- Figure: skin, garments and colliders for one body shape ---
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 3);

// Wraps a cloth in a mesh. `seam` duplicates the first column so UVs can wrap.
function clothMesh(cloth, material, seam) {
  const { rings, segs, n } = cloth;
  const cols = seam ? segs + 1 : segs;
  const count = seam ? rings * cols : n;
  const map = seam ? new Uint32Array(count) : null;
  const g = new THREE.BufferGeometry();
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < cols; j++) {
      const r = i * cols + j;
      if (map) map[r] = i * segs + (j % segs);
      uv[r * 2] = j / segs; uv[r * 2 + 1] = i / (rings - 1);
    }
  }
  if (!seam) { uv[(n - 1) * 2] = 0.5; uv[(n - 1) * 2 + 1] = 1; }
  g.setAttribute('position', new THREE.BufferAttribute(seam ? new Float32Array(count * 3) : cloth.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(seam ? new Float32Array(count * 3) : cloth.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aStretch', new THREE.BufferAttribute(seam ? new Float32Array(count).fill(1) : cloth.stretch, 1));
  g.setAttribute('aPre', new THREE.BufferAttribute(cloth.preStretch ?? new Float32Array(count).fill(1), 1));
  g.setIndex(new THREE.BufferAttribute(seam ? gridIndex(rings, segs, false, false) : cloth.index, 1));
  g.boundingSphere = BOUNDS; // fixed: the mesh deforms every frame
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.userData = { cloth, map, dirty: true };
  return mesh;
}

function syncMesh(mesh) {
  const { cloth, map } = mesh.userData;
  const g = mesh.geometry;
  computeNormals(cloth.pos, cloth.index, cloth.normals);
  if (map) {
    const p = g.attributes.position.array, nn = g.attributes.normal.array;
    for (let r = 0; r < map.length; r++) {
      const s = map[r] * 3, o = r * 3;
      p[o] = cloth.pos[s]; p[o + 1] = cloth.pos[s + 1]; p[o + 2] = cloth.pos[s + 2];
      nn[o] = cloth.normals[s]; nn[o + 1] = cloth.normals[s + 1]; nn[o + 2] = cloth.normals[s + 2];
    }
  } else {
    computeStretch(cloth);
    g.attributes.aStretch.needsUpdate = true;
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
}

// Typed-array normals: three's computeVertexNormals costs about 4.5 ms a frame for the skin, this about 1 ms.
function shadeSkin(g) {
  computeNormals(g.attributes.position.array, g.index.array, g.attributes.normal.array);
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
}

// Skin follows the pose: its position buffer is the rig's live copy of the rest positions.
function skinMesh(rig, { pos, rings, segs, startPole = false }, by) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(track(rig, pos, by), 3));
  g.setIndex(new THREE.BufferAttribute(gridIndex(rings, segs, true, true, startPole), 1));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  shadeSkin(g);
  g.boundingSphere = BOUNDS; // fixed: the pose moves it
  const m = new THREE.Mesh(g, skinMat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

const shared = new Set([skinMat, nylon]);
function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (!o.material || shared.has(o.material)) return;
    if (o.material.map && o.material.map !== skirtTex) o.material.map.dispose();
    o.material.dispose();
  });
}

const entryOf = (key) => OPTIONS[key].list.find((e) => e.id === settings[key]);

function makeShirtMesh(body, style) {
  const material = new THREE.MeshStandardMaterial({ map: patternTexture(), roughness: 0.9, side: THREE.DoubleSide });
  repaint(material.map, entryOf('shirtColor'));
  const mesh = clothMesh(makeShirt(body, style), material, true);
  mesh.castShadow = mesh.receiveShadow = true;
  syncMesh(mesh); mesh.userData.dirty = false;
  return mesh;
}

// Static: the band is a ribbon marched onto the neck; metal ornaments hang at the front (+z).
function makeChokerGroup(body, style) {
  const rest = buildChokerRest(body, { y: CHOKER.y, width: style.width, offset: CHOKER.offset, nseg: CHOKER.nseg });
  const g = new THREE.BufferGeometry();
  const { rings, segs } = rest, cols = segs + 1, uv = new Float32Array(rings * cols * 2);
  for (let i = 0; i < rings; i++) for (let j = 0; j < cols; j++) { uv[(i * cols + j) * 2] = j / segs; uv[(i * cols + j) * 2 + 1] = i / (rings - 1); }
  g.setAttribute('position', new THREE.BufferAttribute(rest.pos.slice(), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(gridIndex(rings, segs, false, false), 1));
  g.computeVertexNormals();
  g.boundingSphere = BOUNDS;
  const material = new THREE.MeshStandardMaterial({ map: patternTexture(), roughness: 0.55, side: THREE.DoubleSide });
  repaint(material.map, entryOf('chokerColor'));
  const band = new THREE.Mesh(g, material);
  band.castShadow = true;
  const group = new THREE.Group();
  group.add(band);
  group.userData = { band, set: follow(rest.pos, ROOT, g.attributes.position.array), hung: [] };

  const metal = new THREE.MeshStandardMaterial({ color: 0xd8dae0, metalness: 1, roughness: 0.22 });
  const hang = (geometry, material, y, lift) => {
    const p = neckPoint(body, y, Math.PI / 2, CHOKER.offset + lift);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(p.x, p.y, p.z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(p.nx, p.ny, p.nz));
    m.castShadow = true;
    m.userData.rest = { at: follow(new Float32Array([p.x, p.y, p.z])), quaternion: m.quaternion.clone() };
    group.add(m);
    group.userData.hung.push(m);
    return m;
  };
  if (style.ornament === 'ring') hang(new THREE.TorusGeometry(0.0065, 0.0013, 12, 40), metal, CHOKER.y, 0.0014);
  if (style.ornament === 'gem') {
    const gem = new THREE.MeshStandardMaterial({ color: 0x7fc8ff, metalness: 0.25, roughness: 0.08, flatShading: true });
    hang(new THREE.OctahedronGeometry(0.0055), gem, CHOKER.y - 0.017, 0.0045).scale.set(0.85, 1.35, 0.7);
  }
  return group;
}

function buildFigure(shape, mods) {
  const body = buildBody(shape, mods, STOCKING_BAND);
  const rig = makeRig(body);
  const group = new THREE.Group();
  const skin = [
    ...body.legs.map((leg) => skinMesh(rig, legSkin(leg), leg)),
    skinMesh(rig, buildTorso(body), BLEND),
    ...body.arms.map((arm) => skinMesh(rig, sweepLimb(arm, 0, arm.length, 150, 40, 0, 6, 6), arm)),
    skinMesh(rig, buildHead(body), ROOT),
  ];
  group.add(...skin);

  const stockings = body.legs.map((leg) => {
    const mesh = clothMesh(makeStocking(body, leg), nylon, false);
    mesh.renderOrder = 2;
    return mesh;
  });
  const skirtCloth = makeSkirt(body);
  skirtTex.repeat.set(skirtCloth.pleats / 2, 3);
  const skirt = clothMesh(skirtCloth, new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.85, side: THREE.DoubleSide }), true);
  skirt.castShadow = skirt.receiveShadow = true;
  for (let f = 0; f < 90; f++) stepCloth(skirtCloth, 1 / 60); // let the skirt settle before first paint
  skirtCloth.initial.set(skirtCloth.pos);

  const clothMeshes = [...stockings, skirt]; // the shirt, when there is one, is always last
  for (const m of clothMeshes) { syncMesh(m); m.userData.dirty = false; } // correct even before the first physics step
  group.add(...clothMeshes);
  scene.add(group);
  const f = {
    body, rig, skin, group, clothMeshes, stockings, skirt, shirt: null, choker: null, motions: buildMotions(rig),
    get cloths() { return this.clothMeshes.map((m) => m.userData.cloth); },
  };
  placeShirt(f, entryOf('shirt'));
  placeChoker(f, entryOf('choker'));
  return f;
}

// The held pose. A change arrives over POSE.ramp frames from wherever the figure stands now. A running motion
// overrides it.
let pose = STAND, ramp = null;
const driver = makeDriver();
const holdPose = (next) => { pose = next; ramp = { from: fig.rig.pose, k: 0 }; };
const X_AXIS = new THREE.Vector3(1, 0, 0);

// Static pose: skin, choker and cloth anchors move together; a cloth added since the last call catches up.
function setPose(f, next) {
  if (!applyPose(f.rig, f.cloths, next)) return;
  for (const m of f.skin) shadeSkin(m.geometry);
  for (const m of f.clothMeshes) m.userData.dirty = true;
  poseChoker(f);
}

function poseChoker(f) {
  if (!f.choker) return;
  const { band, set, hung } = f.choker.userData;
  poseSet(f.rig, set);
  band.geometry.attributes.position.needsUpdate = true;
  band.geometry.computeVertexNormals();
  for (const m of hung) {
    const { at, quaternion } = m.userData.rest, q = poseSet(f.rig, at);
    m.position.set(q[0], q[1], q[2]);
    // The field turns +y toward -z for a positive angle, the opposite of a right-handed turn about +x.
    m.quaternion.setFromAxisAngle(X_AXIS, -angleOf(f.rig, at)).multiply(quaternion);
  }
}

function disposeFigure(f) {
  scene.remove(f.group);
  disposeTree(f.group);
}

// Swap only the shirt: the body, skin, stockings and skirt stay as they are.
function placeShirt(f, style) {
  if (f.shirt) { f.group.remove(f.shirt); disposeTree(f.shirt); f.clothMeshes.pop(); f.shirt = null; }
  f.shirtStyle = style.id;
  if (style.top === undefined) return;
  f.shirt = makeShirtMesh(f.body, style);
  f.group.add(f.shirt);
  f.clothMeshes.push(f.shirt);
  setPose(f, f.rig.pose);
}

function placeChoker(f, style) {
  if (f.choker) { f.group.remove(f.choker); disposeTree(f.choker); f.choker = null; }
  f.chokerStyle = style.id;
  if (style.width === undefined) return;
  f.choker = makeChokerGroup(f.body, style);
  f.group.add(f.choker);
  poseChoker(f);
}

let fig = null;

// --- Pointer interaction ---
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const tmpV = new THREE.Vector3();
const MAX_PULL = 0.5;
let sigma = 0.035;
let drag = null; // { cloth, origin, target }

function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(fig.clothMeshes.filter((m) => m.visible), false)[0];
}

function startGrab(cloth, point) {
  if (!beginGrab(cloth, point.x, point.y, point.z, cloth.kind === 'skirt' ? sigma * 1.4 : sigma)) return false;
  drag = { cloth, origin: point.clone(), target: new THREE.Vector3() };
  return true;
}

function stopGrab() {
  if (!drag) return;
  endGrab(drag.cloth);
  drag = null;
}

// Capture phase so this runs before OrbitControls sees the event.
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag) return;
  const h = pick(e);
  if (!h || !startGrab(h.object.userData.cloth, h.point)) return;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  drag.pointerId = e.pointerId;
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmpV), h.point);
  canvas.style.cursor = 'grabbing';
}, true);

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (e.pointerType === 'mouse' && e.buttons === 0) canvas.style.cursor = pick(e) ? 'grab' : '';
    return;
  }
  if (e.pointerId !== drag.pointerId) return;
  pick(e);
  if (raycaster.ray.intersectPlane(plane, tmpV)) drag.target.copy(tmpV).sub(drag.origin).clampLength(0, MAX_PULL);
});

function onUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  stopGrab();
  controls.enabled = true;
  canvas.style.cursor = '';
}
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('lostpointercapture', onUp);

// --- Controls panel ---
const $ = (id) => document.getElementById(id);
const reapply = []; // panel settings that act on the current figure
// --- Options: every choice comes from the presets tables ---
const settings = { ...DEFAULTS };
const OPTIONS = {
  motion: {
    title: 'Motion', control: 'segmented',
    list: Object.entries(MOTIONS).map(([id, m]) => ({ id, label: m.label })),
    set: (e) => want(driver, e.id),
  },
  body: {
    title: 'Body', control: 'segmented',
    list: Object.entries(BODIES).map(([id, b]) => ({ id, label: b.label })),
    after: 'build',
    set: rebuild,
  },
  skin: {
    title: 'Skin', list: SKIN_TONES, swatch: (e) => e.color,
    set(e) { skinMat.color.set(e.color); skinUniforms.uScatter.value.set(e.scatter); },
  },
  stocking: {
    title: 'Stockings', list: STOCKING_COLORS, swatch: colourCss,
    set: (e) => setNylonColour(nylon, e),
  },
  skirt: {
    title: 'Skirt', list: SKIRT_COLORS, swatch: (e) => e.base,
    set: paintPlaid,
  },
  shirt: {
    title: 'Shirt', control: 'segmented', list: SHIRT_STYLES,
    set(e) {
      if (!fig || fig.shirtStyle === e.id) return;
      stopGrab(); controls.enabled = true;
      placeShirt(fig, e);
      applyWire();
    },
  },
  shirtColor: {
    title: 'Shirt color', list: SHIRT_COLORS, swatch: colourCss,
    set(e) { if (fig?.shirt) repaint(fig.shirt.material.map, e); },
  },
  choker: {
    title: 'Choker', control: 'segmented', list: CHOKER_STYLES,
    set(e) { if (fig && fig.chokerStyle !== e.id) placeChoker(fig, e); },
  },
  chokerColor: {
    title: 'Choker color', list: CHOKER_COLORS, swatch: colourCss,
    set(e) { if (fig?.choker) repaint(fig.choker.userData.band.material.map, e); },
  },
};
const optionButtons = {};
const SLIDERS = ['thigh', 'glute', 'chest'];

function rebuild() {
  stopGrab(); controls.enabled = true;
  if (fig) disposeFigure(fig);
  fig = buildFigure(BODIES[settings.body], { thigh: settings.thigh, glute: settings.glute, chest: settings.chest });
  $('chest').parentElement.hidden = !BODIES[settings.body].chest;
  restart(driver);
  holdPose(pose);
  for (const fn of reapply) fn();
}

const showSlider = (key) => { $(key + 'Val').textContent = `${Math.round($(key).value)}%`; };

function apply(key, id) {
  if (SLIDERS.includes(key)) {
    if (!Number.isFinite(id)) return false;
    settings[key] = Math.min(Math.max(id, 0), 1);
    $(key).value = settings[key] * 100;
    showSlider(key);
    rebuild();
    return true;
  }
  const opt = OPTIONS[key], entry = opt?.list.find((e) => e.id === id);
  if (!entry) return false;
  settings[key] = id;
  opt.set(entry);
  markOption(key);
  return true;
}

function markOption(key) {
  const entry = entryOf(key);
  for (const [bid, btn] of Object.entries(optionButtons[key] ?? {})) btn.setAttribute('aria-pressed', String(bid === entry.id));
  const out = document.querySelector(`[data-opt-val="${key}"]`);
  if (out) out.textContent = entry.label;
}

for (const key of SLIDERS) {
  $(key).addEventListener('input', () => showSlider(key));
  $(key).addEventListener('change', () => apply(key, $(key).value / 100)); // a rebuild takes ~300 ms, so wait for release
  showSlider(key);
}
for (const key of Object.keys(OPTIONS)) apply(key, DEFAULTS[key]);

function bind(id, fn) {
  const el = $(id), out = $(id + 'Val');
  const run = () => { out.textContent = fn(+el.value); };
  el.addEventListener('input', run);
  reapply.push(run);
  run();
}
bind('stretch', (v) => {
  const a = 1.2e-5 * Math.pow(10, (v - 50) / 35); // log scale around the default
  for (const m of fig.stockings) m.userData.cloth.params.compliance = [a, a * 2, 0];
  return `${v}%`;
});
bind('snap', (v) => { for (const m of fig.stockings) m.userData.cloth.params.homeK = v * v; return `${(v / (2 * Math.PI)).toFixed(1)} Hz`; });
bind('radius', (v) => { sigma = v / 1000; return `${v} mm`; });
bind('sheer', (v) => { nylon.uniforms.uDensity.value = 1.25 - v / 100 * 1.4 + 0.02; return `${v}%`; });
const applyWire = () => { for (const m of fig.clothMeshes) m.material.wireframe = $('wire').checked; };
const applySkirtVisible = () => { fig.skirt.visible = $('skirt').checked; };
$('wire').addEventListener('change', applyWire);
$('skirt').addEventListener('change', applySkirtVisible);
reapply.push(applyWire, applySkirtVisible);
$('reset').addEventListener('click', () => {
  stopGrab(); controls.enabled = true;
  for (const m of fig.clothMeshes) { resetCloth(m.userData.cloth); m.userData.dirty = true; }
});

for (const [key, opt] of Object.entries(OPTIONS)) {
  const group = document.createElement('div');
  group.className = 'opt';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', opt.title);
  const head = document.createElement('div');
  head.className = 'opt-head';
  head.innerHTML = `<span>${opt.title}</span><span data-opt-val="${key}"></span>`;
  const row = document.createElement('div');
  row.className = opt.control === 'segmented' ? 'seg' : 'swatches';
  optionButtons[key] = {};
  for (const e of opt.list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', e.label);
    b.setAttribute('aria-pressed', 'false');
    if (opt.swatch) { b.className = 'swatch'; b.style.background = opt.swatch(e); b.title = e.label; } else b.textContent = e.label;
    b.addEventListener('click', () => { if (settings[key] !== e.id) apply(key, e.id); });
    optionButtons[key][e.id] = b;
    row.append(b);
  }
  group.append(head, row);
  $('options').append(group);
  if (opt.after) $('options').append($(opt.after));
  markOption(key);
}

// --- Loop ---
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// The view rises with the root, low-passed, so a jump stays framed without the camera bobbing every step.
let viewLift = 0;
function frameView(dt) {
  const next = followView(viewLift, fig.rig.pose.root.y, dt), d = next - viewLift;
  viewLift = next;
  camera.position.y += d; controls.target.y += d;
}

let simMs = 0;
function advance(dt) {
  const t0 = performance.now();
  if (drag) {
    const g = drag.cloth.grab; // ease toward the pointer so flicks stay smooth
    g.dx += (drag.target.x - g.dx) * 0.5; g.dy += (drag.target.y - g.dy) * 0.5; g.dz += (drag.target.z - g.dz) * 0.5;
  }
  const moving = driver.state !== 'still', next = drive(driver, dt, fig.rig, fig.motions);
  let target = fig.rig.pose;
  if (moving || driver.state !== 'still') {
    pose = STAND; ramp = null;
    target = next;
  } else if (ramp) {
    const t = ++ramp.k / POSE.ramp;
    target = blendPose(ramp.from, pose, t);
    if (t >= 1) ramp = null;
  }
  // Standing still the bust rings down, and setPose does nothing once it is at rest.
  stepSoft(fig.rig, target, dt);
  setPose(fig, target);
  frameView(dt);
  for (const m of fig.clothMeshes) {
    if (!m.visible) continue;
    if (stepCloth(m.userData.cloth, dt) || m.userData.dirty) syncMesh(m);
    m.userData.dirty = false;
  }
  simMs += (performance.now() - t0 - simMs) * 0.1;
}

const clock = new THREE.Clock();
const STEP = 1 / 60;
let fps = 60, lastStats = 0, acc = 0;
function frame() {
  const raw = clock.getDelta();
  // Fixed 60 Hz physics steps: the solver always sees the same dt, and a
  // background tab can never cause more than a few catch-up steps.
  acc += Math.min(raw, 0.1);
  let steps = 0;
  for (; acc >= STEP && steps < 3; steps++, acc -= STEP) advance(STEP);
  if (steps === 3) acc = 0;
  controls.update();
  renderer.render(scene, camera);
  if (raw > 0) fps += (1 / raw - fps) * 0.05;
  if (clock.elapsedTime - lastStats > 0.5) {
    lastStats = clock.elapsedTime;
    $('stats').textContent = `${Math.round(fps)} fps · sim ${simMs.toFixed(1)} ms · ${fig.cloths.reduce((n, c) => n + c.n, 0).toLocaleString()} verts`;
  }
}
renderer.setAnimationLoop(frame);

// Scripted access for testing from the console.
window.__sim = {
  get cloths() { return fig.cloths; },
  camera, controls, apply, settings,
  step(frames = 1) { for (let f = 0; f < frames; f++) advance(1 / 60); controls.update(); renderer.render(scene, camera); },
  grabAt(clothIndex, vertex) {
    const c = fig.cloths[clothIndex];
    stopGrab();
    return startGrab(c, new THREE.Vector3(c.pos[vertex * 3], c.pos[vertex * 3 + 1], c.pos[vertex * 3 + 2]));
  },
  dragTo(x, y, z) { drag?.target.set(x, y, z); },
  release: stopGrab,
  // Holds a static pose, merged over STAND, in radians; it arrives over POSE.ramp frames. Returns the pose held.
  pose(partial = {}) {
    stopGrab(); controls.enabled = true;
    Object.assign(driver, makeDriver());
    settings.motion = 'stand'; markOption('motion');
    holdPose(makePose(partial));
    return pose;
  },
  get motion() { return { ...driver }; },
  maxHomeOffset(clothIndex) {
    const c = fig.cloths[clothIndex];
    if (!c.home) return null; // a hanging garment has no home shape
    let m = 0;
    for (let i = 0; i < c.n * 3; i += 3) m = Math.max(m, Math.hypot(c.pos[i] - c.home[i], c.pos[i + 1] - c.home[i + 1], c.pos[i + 2] - c.home[i + 2]));
    return m;
  },
};
