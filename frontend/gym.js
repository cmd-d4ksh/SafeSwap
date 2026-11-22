// SafeSwap Gym: walk into a 3D gym, pick the machine you were going to use, say what hurts,
// and get a safe swap plus where to find it. This file only draws the scene and renders API
// responses. All search, safety checking, ranking and station placement happen in the Java backend.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const API = new URLSearchParams(location.search).get('api') || 'http://localhost:8085';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const body = $('#panelBody');

async function api(path, options) {
  let res;
  try {
    res = await fetch(API + path, options);
  } catch {
    throw new Error(`Can't reach the server at ${API}. Start it with "mvn spring-boot:run" in the backend folder, then refresh.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.message || `Request failed (${res.status})`);
    e.hints = data.hints || [];
    throw e;
  }
  return data;
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const state = {
  step: 0,
  maxStep: 0,         // furthest step reached, for the clickable progress bar
  stations: [],       // /api/gym/stations
  injuries: [],       // /api/injuries
  station: null,
  exercise: null,
  injury: null,
  result: null,       // /api/substitutions response
  where: {},          // /api/gym/locate response: exerciseId -> {stationId, stationName, zone}
};

const ZONE_ICON = { Cardio: '🏃', 'Free weights': '🏋️', Machines: '⚙️', Functional: '🤸' };
const MUSCLE_GROUP = {
  quads: 'Legs', calves: 'Legs', adductors: 'Legs', 'hip-flexors': 'Legs',
  glutes: 'Glutes & hamstrings', hamstrings: 'Glutes & hamstrings',
  chest: 'Chest', 'upper-chest': 'Chest',
  lats: 'Back', rhomboids: 'Back', 'lower-back': 'Back', traps: 'Back', 'upper-back': 'Back',
  'front-delts': 'Shoulders', 'side-delts': 'Shoulders', 'rear-delts': 'Shoulders', 'rotator-cuff': 'Shoulders',
  biceps: 'Arms', triceps: 'Arms', forearms: 'Arms',
  core: 'Core', obliques: 'Core',
};
const GROUP_ORDER = ['Legs', 'Glutes & hamstrings', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Other'];
const MUSCLE_PLAIN = {
  quads: 'front of thighs', hamstrings: 'back of thighs', glutes: 'glutes', calves: 'calves', adductors: 'inner thighs',
  'hip-flexors': 'hip flexors', chest: 'chest', 'upper-chest': 'upper chest', lats: 'back (lats)', rhomboids: 'upper back',
  'lower-back': 'lower back', traps: 'traps', 'upper-back': 'upper back', 'front-delts': 'front shoulders',
  'side-delts': 'side shoulders', 'rear-delts': 'rear shoulders', 'rotator-cuff': 'rotator cuff', biceps: 'biceps',
  triceps: 'triceps', forearms: 'forearms', core: 'core', obliques: 'obliques',
};
const plain = (m) => MUSCLE_PLAIN[m] || m.replace(/-/g, ' ');

// ------------------------------------------------------------------
// 3D scene
// ------------------------------------------------------------------
const container = $('#scene');
let renderer, labelRenderer, scene, camera, controls;
const stationObjects = new Map(); // id -> {group, pad, label}
let doors = [];
let facade = null;
let webglOk = true;

// Layout only: where each backend station stands in the room (x, z, rotation, pad radius).
const PLACES = {
  treadmills:     { x: 21,  z: 12,   rot: -Math.PI / 2, r: 4.0 },
  cardio:         { x: 21,  z: 1,    rot: -Math.PI / 2, r: 4.2 },
  'squat-rack':   { x: -21, z: -15,  rot: 0, r: 3.8 },
  bench:          { x: -11.5, z: -15, rot: 0, r: 3.8 },
  platform:       { x: -2,  z: -15,  rot: 0, r: 3.8 },
  dumbbells:      { x: -9,  z: -6,   rot: 0, r: 3.8 },
  'leg-press':    { x: 8,   z: -15,  rot: 0, r: 3.2 },
  'leg-curl':     { x: 16,  z: -15,  rot: 0, r: 3.2 },
  'lat-pulldown': { x: 8,   z: -6.5, rot: 0, r: 3.2 },
  'chest-press':  { x: 16,  z: -6.5, rot: 0, r: 3.2 },
  cables:         { x: 9,   z: 2.5,  rot: 0, r: 3.4 },
  kettlebells:    { x: -13, z: 3.5,  rot: 0, r: 3.0 },
  pullup:         { x: -22, z: 3,    rot: Math.PI / 2, r: 2.8 },
  turf:           { x: -24, z: 13,   rot: 0, r: 3.6 },
  mats:           { x: -12, z: 13,   rot: 0, r: 3.8 },
};
const ROOM = { w: 60, d: 44 }; // x: -30..30, z: -22..22; entrance doors at z = +22

function initScene() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    webglOk = false;
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe3e8);
  scene.fog = new THREE.Fog(0xdfe3e8, 60, 120);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  camera.position.set(0, 1.7, 36);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.enabled = false; // until the walk-in finishes

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9ccd2, 1.7));
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.1);
  sun.position.set(18, 30, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  buildRoom();
  new ResizeObserver(onResize).observe(container);
  onResize();
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', () => { setHover(null); $('#hoverTip').hidden = true; });
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.setAnimationLoop(tick);
}

// ---------- geometry helpers ----------
const mats = {};
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...opts });
  return mats[key];
}
function box(g, w, h, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts ? mat(color, opts) : mat(color));
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
}
function cyl(g, r, len, color, x, y, z, axis = 'y', seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(color));
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true; g.add(m); return m;
}
function ball(g, r, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat(color));
  m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
}
function sub(g, x, z, ry = 0) {
  const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s); return s;
}
function textTexture(text, { w = 1024, h = 256, bg = null, color = '#111418', font = 'bold 150px system-ui, sans-serif', accent } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (accent) {
    const [a, b] = text.split(' ');
    const wa = x.measureText(a + ' ').width, wb = x.measureText(b).width, start = w / 2 - (wa + wb) / 2;
    x.textAlign = 'left'; x.fillStyle = accent; x.fillText(a + ' ', start, h / 2); x.fillStyle = color; x.fillText(b, start + wa, h / 2);
  } else { x.fillStyle = color; x.fillText(text, w / 2, h / 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const C = {
  steel: 0x3b4048, dark: 0x22262b, chrome: 0xc4c9cf, pad: 0x1f2328, plate: 0x16181b,
  accent: 0xe8461f, wood: 0xc79b6b, rubber: 0x2e3238, mat: 0x3f6db3, blue: 0x3f6db3,
  green: 0x4f9a5e, yellow: 0xe0b23f, turf: 0x4c8b4a, screen: 0x1b2b3a, white: 0xf2f3f5,
};

// ---------- reusable equipment ----------
function barbell(g, x, y, z, len = 2.2, ry = 0) {
  const s = sub(g, x, z, ry); s.position.y = y;
  cyl(s, 0.028, len, C.chrome, 0, 0, 0, 'x');
  for (const k of [-1, 1]) {
    cyl(s, 0.36, 0.07, C.plate, k * (len / 2 - 0.25), 0, 0, 'x');
    cyl(s, 0.26, 0.06, C.accent, k * (len / 2 - 0.33), 0, 0, 'x');
  }
}
function dumbbell(g, x, y, z, s = 1) {
  cyl(g, 0.022 * s, 0.3 * s, C.chrome, x, y, z, 'x');
  cyl(g, 0.065 * s, 0.09 * s, C.plate, x - 0.16 * s, y, z, 'x', 8);
  cyl(g, 0.065 * s, 0.09 * s, C.plate, x + 0.16 * s, y, z, 'x', 8);
}
function flatBench(g, x, z, ry = 0, incline = 0) {
  const b = sub(g, x, z, ry);
  box(b, 0.25, 0.38, 1.0, C.steel, 0, 0.19, 0);
  const seat = box(b, 0.32, 0.09, 1.2, C.pad, 0, 0.44, 0);
  seat.rotation.x = -incline;
  return b;
}
function stack(g, x, z, h = 1.6) { // weight-stack column
  box(g, 0.08, h + 0.4, 0.08, C.steel, x - 0.25, (h + 0.4) / 2, z);
  box(g, 0.08, h + 0.4, 0.08, C.steel, x + 0.25, (h + 0.4) / 2, z);
  box(g, 0.42, h * 0.55, 0.22, C.dark, x, h * 0.28, z);
  box(g, 0.62, 0.08, 0.3, C.steel, x, h + 0.42, z);
}
function seat(g, x, z, ry = 0, back = true) {
  const s = sub(g, x, z, ry);
  box(s, 0.16, 0.45, 0.16, C.steel, 0, 0.22, 0);
  box(s, 0.5, 0.1, 0.5, C.pad, 0, 0.5, 0);
  if (back) box(s, 0.5, 0.75, 0.1, C.pad, 0, 0.95, 0.27);
  return s;
}
function treadmill(g, x, z) {
  const t = sub(g, x, z);
  box(t, 0.85, 0.22, 2.0, C.dark, 0, 0.11, 0);
  box(t, 0.6, 0.02, 1.7, 0x101215, 0, 0.23, 0.05);
  for (const k of [-1, 1]) box(t, 0.06, 1.25, 0.06, C.steel, k * 0.38, 0.75, -0.85);
  const con = box(t, 0.8, 0.35, 0.12, C.dark, 0, 1.4, -0.85); con.rotation.x = 0.5;
  box(t, 0.55, 0.25, 0.02, C.screen, 0, 1.43, -0.8, { emissive: 0x2a6cb3, emissiveIntensity: 0.5 }).rotation.x = 0.5;
  for (const k of [-1, 1]) cyl(t, 0.025, 0.7, C.chrome, k * 0.4, 1.0, -0.5, 'z');
}
function bike(g, x, z, air = false) {
  const b = sub(g, x, z);
  box(b, 0.5, 0.08, 1.2, C.dark, 0, 0.04, 0);
  const frame = box(b, 0.12, 0.9, 0.12, C.steel, 0, 0.5, 0.15); frame.rotation.x = -0.25;
  box(b, 0.26, 0.08, 0.3, C.pad, 0, 0.98, 0.3);
  const post = box(b, 0.1, 1.0, 0.1, C.steel, 0, 0.6, -0.4); post.rotation.x = 0.2;
  cyl(b, 0.03, 0.5, C.chrome, 0, 1.1, -0.5, 'x');
  if (air) { cyl(b, 0.42, 0.18, C.dark, 0, 0.5, -0.65, 'x', 24); }
  else cyl(b, 0.25, 0.1, C.accent, 0, 0.38, -0.45, 'x');
}
function rower(g, x, z) {
  const r = sub(g, x, z);
  box(r, 0.14, 0.12, 2.6, C.steel, 0, 0.3, 0.2);
  box(r, 0.5, 0.1, 0.2, C.dark, 0, 0.08, 1.4);
  cyl(r, 0.3, 0.32, C.dark, 0, 0.45, -1.1, 'x', 24);
  box(r, 0.3, 0.08, 0.35, C.pad, 0, 0.42, 0.5);
  for (const k of [-1, 1]) { const f = box(r, 0.14, 0.02, 0.3, C.steel, k * 0.14, 0.45, -0.6); f.rotation.x = -0.9; }
}
function elliptical(g, x, z) {
  const e = sub(g, x, z);
  box(e, 0.6, 0.12, 1.9, C.dark, 0, 0.06, 0);
  cyl(e, 0.28, 0.25, C.steel, 0, 0.35, 0.75, 'x');
  for (const k of [-1, 1]) {
    box(e, 0.14, 0.04, 0.4, C.pad, k * 0.17, 0.45, 0.1);
    const arm = box(e, 0.04, 1.5, 0.04, C.chrome, k * 0.22, 1.05, -0.2); arm.rotation.x = 0.2;
  }
  box(e, 0.12, 1.3, 0.12, C.steel, 0, 0.7, -0.55);
  box(e, 0.4, 0.3, 0.1, C.screen, 0, 1.4, -0.6);
}
function stairClimber(g, x, z) {
  const s = sub(g, x, z);
  box(s, 0.9, 0.1, 1.3, C.dark, 0, 0.05, 0);
  for (let i = 0; i < 5; i++) box(s, 0.7, 0.18, 0.28, C.rubber, 0, 0.2 + i * 0.2, 0.4 - i * 0.22);
  for (const k of [-1, 1]) box(s, 0.06, 1.8, 0.06, C.steel, k * 0.42, 0.9, -0.55);
  box(s, 0.6, 0.3, 0.1, C.screen, 0, 1.6, -0.6);
}
function powerRack(g, x, z) {
  const r = sub(g, x, z);
  box(r, 2.3, 0.04, 2.3, C.wood, 0, 0.02, 0.2);
  for (const [px, pz] of [[-0.75, -0.6], [0.75, -0.6], [-0.75, 0.6], [0.75, 0.6]]) box(r, 0.09, 2.5, 0.09, C.steel, px, 1.25, pz);
  for (const pz of [-0.6, 0.6]) box(r, 1.6, 0.09, 0.09, C.steel, 0, 2.5, pz);
  for (const px of [-0.75, 0.75]) box(r, 0.09, 0.09, 1.3, C.steel, px, 2.5, 0);
  barbell(r, 0, 1.4, 0.6, 2.2);
  cyl(r, 0.36, 0.07, C.plate, 1.05, 0.38, -0.5, 'x'); cyl(r, 0.36, 0.07, C.plate, 1.13, 0.38, -0.5, 'x');
}
function benchPress(g, x, z) {
  const b = sub(g, x, z);
  box(b, 2.4, 0.04, 2.0, C.rubber, 0, 0.02, 0);
  flatBench(b, 0, 0.2);
  for (const k of [-1, 1]) box(b, 0.09, 1.3, 0.09, C.steel, k * 0.55, 0.65, -0.45);
  barbell(b, 0, 1.15, -0.45, 2.2);
}
function platform(g, x, z) {
  const p = sub(g, x, z);
  box(p, 2.4, 0.06, 2.4, C.rubber, 0, 0.03, 0);
  box(p, 1.1, 0.065, 2.4, C.wood, 0, 0.035, 0);
  barbell(p, 0, 0.42, 0.1, 2.2);
}
function legPress(g, x, z) {
  const l = sub(g, x, z);
  box(l, 0.9, 0.2, 2.4, C.steel, 0, 0.1, 0);
  const s = box(l, 0.65, 0.12, 0.85, C.pad, 0, 0.6, 0.6); s.rotation.x = 0.65;
  const sled = box(l, 0.8, 0.8, 0.08, C.dark, 0, 1.0, -0.75); sled.rotation.x = -0.5;
  for (const k of [-1, 1]) { const rail = box(l, 0.07, 0.07, 1.7, C.chrome, k * 0.35, 0.8, -0.35); rail.rotation.x = 0.55; }
  for (const k of [-1, 1]) cyl(l, 0.3, 0.07, C.plate, k * 0.5, 1.1, -0.65, 'x');
}
function hackSquat(g, x, z) {
  const h = sub(g, x, z);
  box(h, 0.9, 0.15, 2.0, C.steel, 0, 0.07, 0);
  const back = box(h, 0.55, 1.4, 0.1, C.pad, 0, 1.0, 0.3); back.rotation.x = -0.35;
  for (const k of [-1, 1]) { const rail = box(h, 0.07, 2.1, 0.07, C.chrome, k * 0.38, 1.05, 0.35); rail.rotation.x = -0.35; }
  box(h, 0.7, 0.06, 0.5, C.dark, 0, 0.2, -0.3);
}
function legExtension(g, x, z, curl = false) {
  const l = sub(g, x, z);
  stack(l, 0, -0.75, 1.5);
  seat(l, 0, 0.2);
  cyl(l, 0.08, 0.5, C.pad, 0, curl ? 0.65 : 0.35, curl ? -0.25 : -0.3, 'x');
  box(l, 0.06, 0.6, 0.06, C.steel, 0.3, 0.5, -0.2);
}
function latPulldown(g, x, z, row = false) {
  const l = sub(g, x, z);
  stack(l, 0, -0.6, row ? 1.4 : 2.0);
  if (!row) {
    box(l, 0.1, 0.1, 1.0, C.steel, 0, 2.4, -0.1);
    cyl(l, 0.02, 1.2, C.chrome, 0, 1.9, 0.35, 'x');
    cyl(l, 0.006, 0.5, C.dark, 0, 2.15, 0.35);
    seat(l, 0, 0.5, 0, false);
    cyl(l, 0.07, 0.5, C.pad, 0, 0.75, 0.25, 'x');
  } else {
    box(l, 0.3, 0.12, 1.8, C.steel, 0, 0.25, 0.6);
    box(l, 0.45, 0.08, 0.45, C.pad, 0, 0.45, 0.9);
    box(l, 0.25, 0.4, 0.1, C.pad, 0, 0.6, 0.3);
    cyl(l, 0.02, 0.5, C.chrome, 0, 0.75, 0.1, 'x');
  }
}
function chestPress(g, x, z, pec = false) {
  const c = sub(g, x, z);
  stack(c, 0, -0.75, 1.6);
  seat(c, 0, 0.35, Math.PI);
  if (pec) for (const k of [-1, 1]) { const a = box(c, 0.08, 0.5, 0.5, C.pad, k * 0.45, 1.1, 0.1); a.rotation.y = k * 0.5; }
  else for (const k of [-1, 1]) cyl(c, 0.025, 0.6, C.chrome, k * 0.32, 1.0, -0.05, 'z');
}
function cableCrossover(g, x, z) {
  const c = sub(g, x, z);
  for (const k of [-1, 1]) {
    box(c, 0.14, 2.6, 0.14, C.steel, k * 1.8, 1.3, 0);
    box(c, 0.5, 1.3, 0.28, C.dark, k * 1.8, 0.66, -0.3);
    ball(c, 0.08, C.accent, k * 1.8, 1.9, 0.12);
    cyl(c, 0.006, 0.9, C.chrome, k * 1.8, 1.45, 0.12);
  }
  box(c, 3.75, 0.14, 0.14, C.steel, 0, 2.6, 0);
  box(c, 3.0, 0.03, 1.4, C.rubber, 0, 0.015, 0.4);
}
function kettlebell(g, x, y, z, color, s = 1) {
  ball(g, 0.15 * s, color, x, y + 0.15 * s, z);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.09 * s, 0.022 * s, 8, 20, Math.PI), mat(color));
  h.position.set(x, y + 0.26 * s, z); h.castShadow = true; g.add(h);
}

// ---------- station builders ----------
const BUILDERS = {
  treadmills(g) { for (let i = 0; i < 4; i++) treadmill(g, -2.4 + i * 1.6, 0); },
  cardio(g) {
    bike(g, -2.8, 0); bike(g, -1.6, 0, true); elliptical(g, -0.2, 0); stairClimber(g, 1.2, 0); rower(g, 2.8, 0.2);
  },
  'squat-rack'(g) { powerRack(g, -1.3, 0); powerRack(g, 1.5, 0); },
  bench(g) { benchPress(g, -1.4, 0); benchPress(g, 1.4, 0); },
  platform(g) { platform(g, -1.3, 0); platform(g, 1.3, 0); },
  dumbbells(g) {
    for (const k of [-1.9, 1.9]) { box(g, 0.08, 0.9, 0.08, C.steel, k, 0.45, -0.2); box(g, 0.08, 0.9, 0.08, C.steel, k, 0.45, 0.2); }
    box(g, 4.0, 0.06, 0.5, C.steel, 0, 0.5, 0); box(g, 4.0, 0.06, 0.4, C.steel, 0, 0.85, -0.05);
    for (let i = 0; i < 9; i++) {
      const x = -1.7 + i * 0.42, s = 0.75 + i * 0.09;
      dumbbell(g, x, 0.57 + 0.065 * s, 0.08, s);
      dumbbell(g, x, 0.91 + 0.05 * s, -0.05, s * 0.7);
    }
    flatBench(g, -1, 1.6, Math.PI / 2, 0.3); flatBench(g, 1, 1.6, Math.PI / 2);
  },
  'leg-press'(g) { legPress(g, -1, 0); hackSquat(g, 1.1, 0); },
  'leg-curl'(g) { legExtension(g, -0.9, 0); legExtension(g, 0.9, 0, true); },
  'lat-pulldown'(g) { latPulldown(g, -0.9, 0); latPulldown(g, 1.0, -0.2, true); },
  'chest-press'(g) { chestPress(g, -0.9, 0); chestPress(g, 0.9, 0, true); },
  cables(g) { cableCrossover(g, 0, 0); },
  kettlebells(g) {
    box(g, 2.8, 0.05, 0.6, C.steel, 0, 0.35, 0); box(g, 2.8, 0.05, 0.6, C.steel, 0, 0.02, 0);
    for (const k of [-1.35, 1.35]) box(g, 0.05, 0.35, 0.55, C.steel, k, 0.18, 0);
    [C.blue, C.yellow, C.green, C.accent, C.dark, C.blue].forEach((c, i) => kettlebell(g, -1.1 + i * 0.44, 0.38, 0, c, 0.75 + i * 0.1));
    ball(g, 0.2, 0x7a5c3e, -0.6, 0.2, 0.9); ball(g, 0.24, 0x8b6a47, 0.1, 0.24, 1.0); ball(g, 0.18, 0x6e5235, 0.7, 0.18, 0.85);
  },
  pullup(g) {
    for (const k of [-0.9, 0.9]) box(g, 0.12, 2.7, 0.12, C.steel, k, 1.35, 0);
    cyl(g, 0.032, 2.0, C.chrome, 0, 2.55, 0, 'x');
    box(g, 2.0, 0.08, 1.4, C.rubber, 0, 0.04, 0.3);
    for (const k of [-0.28, 0.28]) cyl(g, 0.032, 0.9, C.chrome, k, 1.25, 0.6, 'z');
    for (const k of [-0.28, 0.28]) box(g, 0.08, 1.25, 0.08, C.steel, k, 0.62, 1.0);
  },
  turf(g) {
    box(g, 2.2, 0.03, 8, C.turf, 0, 0.015, 0);
    for (let i = -3; i <= 3; i += 1.5) box(g, 2.2, 0.035, 0.05, C.white, 0, 0.02, i);
    const sled = sub(g, 0, 2.5);
    box(sled, 0.8, 0.12, 0.9, C.dark, 0, 0.08, 0);
    for (const k of [-0.25, 0.25]) { const p = box(sled, 0.06, 1.0, 0.06, C.steel, k, 0.6, 0.35); p.rotation.x = -0.25; }
    cyl(sled, 0.3, 0.08, C.plate, 0, 0.25, 0);
    const lm = cyl(g, 0.028, 2.0, C.chrome, 0.6, 0.45, -2.2); lm.rotation.x = 1.15;
    cyl(g, 0.3, 0.07, C.plate, 0.6, 0.85, -3.0, 'z');
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 30, Math.PI), mat(0x2b2b2b)); rope.rotation.x = -Math.PI / 2; rope.position.set(-0.4, 0.04, -0.5); g.add(rope);
  },
  mats(g) {
    for (const [x, z] of [[-1.6, -0.8], [-0.4, -0.8], [0.8, -0.8], [-1.6, 1.4], [-0.4, 1.4]]) box(g, 1.0, 0.04, 2.0, C.mat, x, 0.02, z);
    ball(g, 0.36, 0x9bb7e0, 2.2, 0.36, -0.6); ball(g, 0.3, 0xe0b5a5, 2.3, 0.3, 0.4);
    box(g, 0.6, 0.6, 0.6, C.wood, 1.0, 0.3, 1.4); box(g, 0.5, 0.45, 0.5, C.wood, 1.8, 0.22, 1.5);
    for (let i = 0; i < 3; i++) cyl(g, 0.08, 0.6, 0x3a3a3a, 2.6, 0.08, 1.2 + i * 0.25, 'x');
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 24), mat(C.green));
    band.rotation.x = Math.PI / 2; band.position.set(-0.4, 0.06, 1.4); g.add(band);
  },
};

// ---------- the room: walls, glass entrance, reception, signage ----------
function plant(x, z, s = 1) {
  const g = sub(scene, x, z);
  cyl(g, 0.28 * s, 0.5 * s, 0xf2f2f2, 0, 0.25 * s, 0);
  for (const [dx, dy, dz, r] of [[0, 0.9, 0, 0.42], [0.2, 1.2, 0.1, 0.3], [-0.2, 1.15, -0.1, 0.32], [0, 1.45, 0, 0.25]]) ball(g, r * s, 0x3f7f4a, dx * s, dy * s, dz * s);
}
function hangingSign(text, x, z, ry = 0) {
  const tex = textTexture(text, { w: 1024, h: 200, bg: '#111418', color: '#ffffff', font: 'bold 110px system-ui, sans-serif' });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.98), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  m.position.set(x, 5.6, z); m.rotation.y = ry; scene.add(m);
  for (const k of [-2, 2]) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.4), mat(0x555555));
    wire.position.set(x + Math.cos(ry) * k, 6.8, z - Math.sin(ry) * k); scene.add(wire);
  }
}
function buildRoom() {
  const W = ROOM.w, D = ROOM.d;
  // floors: light base, black rubber in free weights, grey under cardio
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xd9dce1, { roughness: 0.9, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const zone = (w, d, x, z, color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, { roughness: 0.95, metalness: 0 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.receiveShadow = true; scene.add(m);
  };
  zone(32, 17, -13, -12.5, 0x2c3036);   // free weights rubber
  zone(14, 24, 21, 5, 0xc7ccd3);        // cardio
  zone(15, 21, 12, -7, 0xcfd3d9);       // machines
  // outside pavement in front of the entrance
  const out = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), mat(0xbfc3c8, { roughness: 1, metalness: 0 }));
  out.rotation.x = -Math.PI / 2; out.position.set(0, -0.01, D / 2 + 10); out.receiveShadow = true; scene.add(out);

  const wallMat = mat(0xf6f7f8, { roughness: 1, metalness: 0 });
  const wall = (w, h, d, x, y, z, m = wallMat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.receiveShadow = true; scene.add(mesh); return mesh;
  };
  wall(W, 7, 0.3, 0, 3.5, -D / 2);       // back
  wall(0.3, 7, D, -W / 2, 3.5, 0);        // left
  wall(0.3, 1.2, D, W / 2, 0.6, 0);       // right: low wall + windows
  for (let z = -18; z <= 18; z += 6) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.6, 5.2), mat(0xbfdcf2, { emissive: 0xbfdcf2, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.2 }));
    win.position.set(W / 2, 3.6, z); scene.add(win);
  }
  wall(0.3, 1.0, D, W / 2, 6.5, 0);
  // Front facade (glass wall, fascia, doors). Shown for the walk-in, then hidden like a
  // dollhouse cut-away so it never blocks the view of stations near the entrance.
  facade = new THREE.Group(); scene.add(facade);
  const glass = mat(0xcfe6f5, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1 });
  for (const k of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(W / 2 - 2.5, 6, 0.1), glass);
    g.position.set(k * (W / 4 + 1.25), 3, D / 2); facade.add(g);
  }
  // storefront frame: fascia band, mullions and the door frame
  box(facade, W, 0.9, 0.2, 0x111418, 0, 6.45, D / 2);
  for (let x = -27.5; x <= 27.5; x += 5) if (Math.abs(x) > 3) box(facade, 0.12, 6, 0.14, C.steel, x, 3, D / 2);
  for (const k of [-1, 1]) box(facade, 0.16, 4.6, 0.18, C.steel, k * 2.5, 2.3, D / 2);
  box(facade, 5.2, 0.16, 0.18, C.steel, 0, 4.6, D / 2);
  const entry = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.85), new THREE.MeshBasicMaterial({ map: textTexture('SAFESWAP GYM', { w: 1024, h: 210, color: '#ffffff', accent: '#e8461f', font: 'bold 120px system-ui, sans-serif' }), transparent: true }));
  entry.position.set(0, 6.45, D / 2 + 0.12); facade.add(entry);
  for (const k of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(2.45, 4.4, 0.06), mat(0xcfe6f5, { transparent: true, opacity: 0.3, roughness: 0.05 }));
    d.position.set(k * 1.25, 2.2, D / 2); facade.add(d);
    const handle = box(facade, 0.05, 1.2, 0.08, C.chrome, k * 0.2, 1.2, D / 2 + 0.05);
    doors.push({ mesh: d, side: k, handle });
  }
  // welcome mat
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2), mat(0x2b2f35, { roughness: 1, metalness: 0 }));
  wm.rotation.x = -Math.PI / 2; wm.position.set(0, 0.01, D / 2 - 1.4); scene.add(wm);

  // back wall: mirrors + logo
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(30, 2.4, 0.05), mat(0xd8e1e8, { metalness: 0.9, roughness: 0.08 }));
  mirror.position.set(-13, 1.9, -D / 2 + 0.18); scene.add(mirror);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.4), new THREE.MeshBasicMaterial({ map: textTexture('SAFESWAP GYM', { w: 2048, h: 300, color: '#111418', accent: '#e8461f', font: 'bold 220px system-ui, sans-serif' }), transparent: true }));
  logo.position.set(10, 4.6, -D / 2 + 0.17); scene.add(logo);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, 0.04), mat(C.accent)); stripe.position.set(0, 3.4, -D / 2 + 0.17); scene.add(stripe);
  const motto = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.6), new THREE.MeshBasicMaterial({ map: textTexture('TRAIN SMART · TRAIN SAFE', { w: 2048, h: 180, color: '#8a919b', font: 'bold 120px system-ui, sans-serif' }), transparent: true }));
  motto.position.set(-W / 2 + 0.17, 4.6, 2); motto.rotation.y = Math.PI / 2; scene.add(motto);

  // reception desk + screen + plants near the door
  const desk = sub(scene, 8, 17);
  box(desk, 4.2, 1.1, 1.0, C.white, 0, 0.55, 0);
  box(desk, 4.4, 0.08, 1.2, C.accent, 0, 1.12, 0);
  box(desk, 0.6, 0.4, 0.05, C.screen, -0.8, 1.4, -0.2, { emissive: 0x2a6cb3, emissiveIntensity: 0.4 });
  const rs = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshBasicMaterial({ map: textTexture('RECEPTION', { w: 1024, h: 170, color: '#111418', font: 'bold 110px system-ui, sans-serif' }), transparent: true }));
  rs.position.set(0, 0.6, 0.52); desk.add(rs);
  plant(-4, 20.2); plant(4.2, 20.2); plant(28.5, -20.5, 1.2); plant(-28.4, 20.5, 1.2); plant(28.5, 20.5);
  // water fountain + lockers on the left of the entrance
  const wf = sub(scene, -6, 20.6); box(wf, 0.6, 1.0, 0.4, C.chrome, 0, 0.5, 0); box(wf, 0.5, 0.06, 0.35, C.white, 0, 1.03, 0);
  for (let i = 0; i < 6; i++) box(scene, 0.75, 2.0, 0.55, i % 2 ? 0x9aa6b2 : 0x8796a5, -10.5 - i * 0.78, 1.0, 21.4);

  // hanging zone signs, readable from the entrance
  hangingSign('CARDIO', 21, 8);
  hangingSign('FREE WEIGHTS', -11.5, -10);
  hangingSign('MACHINES', 12, -11);
  hangingSign('FUNCTIONAL', -17, 8);
}

function buildStations() {
  for (const st of state.stations) {
    const p = PLACES[st.id] || { x: 0, z: 0, rot: 0, r: 3 };
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.rot;
    (BUILDERS[st.id] || BUILDERS.mats)(group);

    const pad = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48),
      new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02;
    group.add(pad);

    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `${esc(st.name)}<span class="badge"></span>`;
    el.addEventListener('click', () => onStationClick(st.id));
    el.addEventListener('pointerenter', () => setHover(st.id));
    el.addEventListener('pointerleave', () => setHover(null));
    const label = new CSS2DObject(el);
    label.position.set(0, 3.1, 0);
    group.add(label);

    group.traverse((o) => { o.userData.stationId = st.id; });
    scene.add(group);
    stationObjects.set(st.id, { group, pad, label: el });
  }
  refreshHighlights();
}

// ---------- interaction ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverId = null;
let downAt = null;

function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...stationObjects.values()].map((s) => s.group), true);
  return hits.length ? hits[0].object.userData.stationId : null;
}
function onPointerMove(e) {
  if (intro) return;
  const id = pick(e);
  setHover(id);
  const tip = $('#hoverTip');
  if (id) {
    const st = state.stations.find((s) => s.id === id);
    tip.textContent = state.step === 0 ? `${st.name}: tap to see exercises` : st.name;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
    tip.hidden = false;
  } else tip.hidden = true;
}
function onPointerUp(e) {
  if (intro || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // drag, not tap
  const id = pick(e);
  if (id) onStationClick(id);
}
function setHover(id) {
  if (hoverId === id) return;
  hoverId = id;
  if (renderer) renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
  document.querySelectorAll('[data-station]').forEach((b) => b.classList.toggle('hl', b.dataset.station === id));
  refreshHighlights();
}
function refreshHighlights() {
  const swaps = swapCounts();
  for (const [id, o] of stationObjects) {
    const selected = state.station?.id === id && state.step > 0 && state.step < 3;
    const isSwap = swaps[id] > 0;
    o.pad.material.opacity = selected ? 0.3 : isSwap ? 0.22 : hoverId === id ? 0.18 : 0;
    o.label.classList.toggle('selected', selected);
    o.label.classList.toggle('hover', hoverId === id && !selected && !isSwap);
    o.label.classList.toggle('has-swap', isSwap);
    o.label.classList.toggle('dim', (state.step === 3 && !isSwap) || (state.step > 0 && state.step < 3 && !selected));
    o.label.querySelector('.badge').textContent = isSwap ? `${swaps[id]} swap${swaps[id] > 1 ? 's' : ''}` : '';
  }
}

// ---------- camera ----------
let flight = null;
let intro = null;
function overviewPose() {
  const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
  const k = Math.min(1.8, Math.max(0.95, 1.6 / (w / h)));
  return { pos: new THREE.Vector3(0, 30 * k, 33 * k), target: new THREE.Vector3(0, 0, -2) };
}
function setOverview() { const o = overviewPose(); flyTo(o.pos, o.target); }
function flyToStation(id) {
  const p = PLACES[id]; if (!p) return;
  const target = new THREE.Vector3(p.x, 0.8, p.z);
  const narrow = container.clientWidth < 600;
  // approach from the room's front-centre so the station faces the viewer
  const dir = new THREE.Vector3(-p.x * 0.15, 0, 10).normalize();
  const pos = target.clone().add(dir.multiplyScalar(narrow ? 13 : 10)).add(new THREE.Vector3(0, narrow ? 9 : 6.5, 0));
  flyTo(pos, target);
}
function flyTo(pos, target, ms = 900) {
  flight = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, start: performance.now(), ms };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

// The walk-in: outside the doors -> through them -> look left (free weights) -> look right (cardio) -> rise to overview.
function startWalkIn() {
  const o = overviewPose();
  const D = ROOM.d / 2;
  intro = {
    start: performance.now(),
    keys: [
      { t: 0,    pos: new THREE.Vector3(0, 1.7, D + 14), target: new THREE.Vector3(0, 1.6, 0) },
      { t: 1.8,  pos: new THREE.Vector3(0, 1.7, D - 1),  target: new THREE.Vector3(0, 1.6, -10) },
      { t: 3.0,  pos: new THREE.Vector3(0, 1.75, D - 7), target: new THREE.Vector3(-14, 1.2, -12) },
      { t: 4.2,  pos: new THREE.Vector3(1, 1.75, D - 8), target: new THREE.Vector3(18, 1.2, 4) },
      { t: 6.0,  pos: o.pos, target: o.target },
    ],
  };
}
function updateIntro(now) {
  const s = (now - intro.start) / 1000;
  const k = intro.keys;
  // doors slide open as we approach
  const open = smooth(Math.min(1, Math.max(0, (s - 0.4) / 1.0)));
  for (const d of doors) { d.mesh.position.x = d.side * (1.25 + open * 2.3); d.handle.position.x = d.side * (0.2 + open * 2.3); }
  let i = 0;
  while (i < k.length - 2 && s > k[i + 1].t) i++;
  const a = k[i], b = k[i + 1];
  const t = ease(Math.min(1, Math.max(0, (s - a.t) / (b.t - a.t))));
  camera.position.lerpVectors(a.pos, b.pos, t);
  controls.target.lerpVectors(a.target, b.target, t);
  camera.lookAt(controls.target);
  if (s >= k[k.length - 1].t) finishIntro();
}
function finishIntro() {
  intro = null;
  if (facade) facade.visible = false;
  controls.enabled = true;
  document.body.classList.remove('intro-on');
  $('#panel').hidden = false;
  $('#intro').classList.add('leaving');
  setTimeout(() => { $('#intro').hidden = true; }, 600);
  onResize();
  const o = overviewPose();
  camera.position.copy(o.pos); controls.target.copy(o.target);
  renderWelcome();
}

function tick(now) {
  if (intro) updateIntro(now);
  else if (flight) {
    const t = Math.min(1, (performance.now() - flight.start) / flight.ms); // wall-clock, so slow devices still finish
    const k = ease(t);
    camera.position.lerpVectors(flight.from, flight.to, k);
    controls.target.lerpVectors(flight.tFrom, flight.tTo, k);
    if (t >= 1) flight = null;
  }
  if (state.step === 3) {
    const pulse = 0.16 + 0.1 * Math.sin(now / 350);
    const swaps = swapCounts();
    for (const [id, o] of stationObjects) if (swaps[id]) o.pad.material.opacity = pulse;
  }
  if (!intro) controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  if (now - lastDeclutter > 200) { lastDeclutter = now; declutterLabels(); }
}

// Hide labels that would overlap. Priority: selected/swap/hovered first, then nearer stations
// (lower on screen); a hidden station still shows its name when hovered or picked from the list.
let lastDeclutter = 0;
function declutterLabels() {
  const items = [...stationObjects.entries()].map(([id, o]) => {
    o.label.classList.remove('crowded');
    const r = o.label.getBoundingClientRect();
    const pri = o.label.classList.contains('selected') || o.label.classList.contains('has-swap') ? 2 : hoverId === id ? 3 : 0;
    return { o, r, pri };
  }).filter((x) => x.r.width > 0);
  items.sort((a, b) => b.pri - a.pri || b.r.bottom - a.r.bottom);
  const shown = [];
  for (const it of items) {
    const hit = shown.some((s) => it.r.left < s.right + 4 && it.r.right > s.left - 4 && it.r.top < s.bottom + 2 && it.r.bottom > s.top - 2);
    if (hit && it.pri === 0) it.o.label.classList.add('crowded');
    else shown.push(it.r);
  }
}
function onResize() {
  if (!renderer) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
}

// ------------------------------------------------------------------
// Guided flow (panel)
// ------------------------------------------------------------------
function setStep(n) {
  state.step = n;
  state.maxStep = Math.max(state.maxStep, n);
  $('#stepText').textContent = `Step ${n + 1} of 4`;
  $('#navBack').disabled = n === 0;
  $('#navRestart').disabled = n === 0 && !state.station;
  document.querySelectorAll('.progress button').forEach((b) => {
    const s = +b.dataset.step;
    b.classList.toggle('active', s === n);
    b.classList.toggle('done', s < n);
    b.disabled = s > state.maxStep || s === n || !canGoTo(s);
  });
  body.scrollTop = 0;
  refreshHighlights();
}
function canGoTo(s) {
  if (s === 0) return true;
  if (s === 1) return !!state.station;
  if (s === 2) return !!state.exercise;
  return !!state.result;
}
function goTo(s) {
  if (s === 0) renderWelcome();
  else if (s === 1 && state.station) openStation(state.station.id);
  else if (s === 2 && state.exercise) renderHurt();
  else if (s === 3 && state.result) renderResults(false);
}
function goBack() { if (state.step > 0) goTo(state.step === 2 && !state.station ? 0 : state.step - 1); }
function restart() {
  Object.assign(state, { station: null, exercise: null, injury: null, result: null, where: {}, maxStep: 0 });
  renderWelcome();
}

function swapCounts() {
  const out = {};
  if (state.step !== 3 || !state.result) return out;
  for (const r of state.result.results) {
    const loc = state.where[r.id];
    if (loc) out[loc.stationId] = (out[loc.stationId] || 0) + 1;
  }
  return out;
}

function onStationClick(id) {
  if (state.step === 3) { // in results: clicking a highlighted station scrolls to its swap
    const card = body.querySelector(`.card[data-station="${id}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); selectCard(card); }
    return;
  }
  openStation(id);
}

// Step 1: choose a machine
function renderWelcome() {
  setStep(0);
  if (webglOk) setOverview();
  const zones = [...new Set(state.stations.map((s) => s.zone))];
  body.innerHTML = `
    ${webglOk ? '' : '<div class="fallback">3D isn\'t available on this device, but you can use the list below.</div>'}
    <h1>What were you about to use?</h1>
    <p class="lead">${webglOk ? 'Tap a machine in the gym, or pick it from this list.' : 'Pick the machine from this list.'}</p>
    <input class="search" id="q" placeholder="Know the exercise? Search, e.g. squat" autocomplete="off" aria-label="Search exercises by name">
    <div class="list suggest" id="suggest"></div>
    ${zones.map((z) => `
      <h2>${ZONE_ICON[z] || ''} ${esc(z)}</h2>
      <div class="list">${state.stations.filter((s) => s.zone === z).map((s) => `
        <button class="item" data-station="${s.id}">
          <span><span class="t">${esc(s.name)}</span><small>${esc(s.description)}</small></span>
          <span class="arrow">›</span>
        </button>`).join('')}</div>`).join('')}`;
  body.querySelectorAll('[data-station]').forEach((b) => {
    b.addEventListener('click', () => openStation(b.dataset.station));
    b.addEventListener('mouseenter', () => setHover(b.dataset.station));
    b.addEventListener('mouseleave', () => setHover(null));
  });
  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) { $('#suggest').innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/exercises/autocomplete?mode=name&limit=6&prefix=${encodeURIComponent(q)}`);
        $('#suggest').innerHTML = r.exercises.length ? r.exercises.map((x) =>
          `<button class="item" data-ex="${esc(x.id)}"><span class="t">${esc(x.name)}</span><span class="arrow">›</span></button>`).join('')
          : '<p class="empty">No exercise starts with that. Try another word.</p>';
        $('#suggest').querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => pickFromSearch(b.dataset.ex)));
      } catch (err) { $('#suggest').innerHTML = `<div class="error">${esc(err.message)}</div>`; }
    }, 140);
  });
}

async function pickFromSearch(id) {
  try {
    const [ex, where] = await Promise.all([api(`/api/exercises/${encodeURIComponent(id)}`), api(`/api/gym/locate?ids=${encodeURIComponent(id)}`)]);
    const loc = where[ex.id];
    state.station = loc ? state.stations.find((s) => s.id === loc.stationId) : null;
    if (state.station && webglOk) flyToStation(state.station.id);
    state.exercise = ex;
    state.maxStep = Math.max(state.maxStep, 1);
    renderHurt();
  } catch (err) { body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`); }
}

// Step 2: choose the exercise at that machine
async function openStation(id) {
  const st = state.stations.find((s) => s.id === id);
  if (!st) return;
  if (state.station?.id !== id) { state.exercise = null; state.result = null; state.maxStep = 1; }
  state.station = st;
  setStep(1);
  if (webglOk) flyToStation(id);
  body.innerHTML = `<h1>${esc(st.name)}</h1><p class="lead">${esc(st.description)}</p><p class="loading">Loading exercises…</p>`;
  try {
    const r = await api(`/api/gym/stations/${encodeURIComponent(id)}/exercises`);
    if (state.station?.id !== id || state.step !== 1) return;
    const groups = {};
    for (const ex of r.exercises) (groups[MUSCLE_GROUP[ex.primaryMuscles[0]] || 'Other'] ||= []).push(ex);
    body.innerHTML = `
      <h1>${esc(st.name)}</h1>
      <p class="lead">Which exercise were you going to do here?</p>
      ${r.exercises.length > 10 ? '<input class="search" id="filter" placeholder="Filter this list" autocomplete="off" aria-label="Filter exercises">' : ''}
      <div id="exList">
      ${GROUP_ORDER.filter((g) => groups[g]).map((g) => `
        <section data-group>
          <h2>${g}</h2>
          <div class="list">${groups[g].map((ex) => `
            <button class="item" data-ex="${esc(ex.id)}" data-name="${esc(ex.name.toLowerCase())}">
              <span><span class="t">${esc(ex.name)}</span><small>Works ${ex.primaryMuscles.map(plain).join(', ')}</small></span>
              <span class="arrow">›</span>
            </button>`).join('')}</div>
        </section>`).join('')}
      </div>`;
    body.querySelectorAll('[data-ex]').forEach((b) =>
      b.addEventListener('click', () => { state.exercise = r.exercises.find((x) => x.id === b.dataset.ex); state.result = null; state.maxStep = 2; renderHurt(); }));
    const f = $('#filter');
    if (f) f.addEventListener('input', () => {
      const q = f.value.trim().toLowerCase();
      body.querySelectorAll('[data-ex]').forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); });
      body.querySelectorAll('[data-group]').forEach((s) => { s.hidden = ![...s.querySelectorAll('[data-ex]')].some((b) => !b.hidden); });
    });
  } catch (err) {
    body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`);
  }
}

// Step 3: what hurts
const SPOTS = { // body figure hotspots (viewBox 0 0 200 320)
  'Neck': [[100, 58]],
  'Shoulder': [[68, 76], [132, 76]],
  'Elbow': [[52, 128], [148, 128]],
  'Wrist': [[44, 170], [156, 170]],
  'Fingers': [[40, 192], [160, 192]],
  'Lower back': [[100, 140]],
  'Hip': [[80, 168], [120, 168]],
  'Groin': [[100, 182]],
  'Back of thigh': [[84, 210], [116, 210]],
  'Knee': [[85, 245], [115, 245]],
  'Ankle': [[87, 300], [113, 300]],
};
function bodySvg() {
  const spots = Object.entries(SPOTS).flatMap(([area, pts]) =>
    pts.map(([x, y]) => `<circle class="spot" data-area="${area}" cx="${x}" cy="${y}" r="9"><title>${area}</title></circle>`)).join('');
  return `<svg class="body-svg" viewBox="0 0 200 320" role="img" aria-label="Body diagram: tap where it hurts">
    <circle class="shape" cx="100" cy="30" r="20"/>
    <rect class="shape" x="92" y="48" width="16" height="14" rx="4"/>
    <rect class="shape" x="66" y="64" width="68" height="110" rx="26"/>
    <rect class="shape" x="44" y="70" width="18" height="118" rx="9" transform="rotate(6 53 70)"/>
    <rect class="shape" x="138" y="70" width="18" height="118" rx="9" transform="rotate(-6 147 70)"/>
    <rect class="shape" x="74" y="160" width="22" height="148" rx="11"/>
    <rect class="shape" x="104" y="160" width="22" height="148" rx="11"/>
    ${spots}
  </svg>`;
}
function renderHurt() {
  setStep(2);
  const ex = state.exercise;
  const areas = [...new Set(state.injuries.map((i) => i.area))];
  body.innerHTML = `
    <h1>Where does it hurt?</h1>
    <div class="picked">You picked <b>${esc(ex.name)}</b></div>
    <p class="lead" style="margin-top:10px">Tap the spot on the body, or choose below.</p>
    <div class="body-wrap">${bodySvg()}</div>
    <div class="chips">${areas.map((a) => `<button class="chip" data-area="${esc(a)}">${esc(a)}</button>`).join('')}</div>
    <div class="options" id="opts"></div>
    <button class="btn-primary" id="find" disabled style="margin-top:10px">Find a safe swap</button>`;
  body.querySelectorAll('[data-area]').forEach((el) => el.addEventListener('click', () => chooseArea(el.dataset.area)));
  $('#find').addEventListener('click', findSwaps);
  const prev = state.injuries.find((i) => i.tag === state.injury);
  if (prev) chooseArea(prev.area, prev.tag);
}
function chooseArea(area, keepTag) {
  body.querySelectorAll('[data-area]').forEach((el) => el.classList.toggle('on', el.dataset.area === area));
  const options = state.injuries.filter((i) => i.area === area);
  state.injury = keepTag || (options.length === 1 ? options[0].tag : null);
  $('#opts').innerHTML = `${options.length > 1 ? '<p class="lead" style="margin:0 0 8px">Which one sounds like you?</p>' : ''}` + options.map((i) => `
    <button class="option ${state.injury === i.tag ? 'on' : ''}" data-tag="${esc(i.tag)}">
      ${esc(i.hint)}<small>${esc(i.name)}</small>
    </button>`).join('');
  $('#opts').querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    state.injury = b.dataset.tag;
    $('#opts').querySelectorAll('.option').forEach((o) => o.classList.toggle('on', o === b));
    $('#find').disabled = false;
  }));
  $('#find').disabled = !state.injury;
}

// Step 4: results
async function findSwaps() {
  const btn = $('#find');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await api('/api/substitutions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exercise: state.exercise.id, injuryTag: state.injury, maxResults: 5 }),
    });
    const ids = r.results.map((c) => c.id);
    state.where = ids.length ? await api(`/api/gym/locate?ids=${ids.map(encodeURIComponent).join(',')}`) : {};
    state.result = r;
    state.maxStep = 3;
    renderResults(true);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Find a safe swap';
    body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`);
  }
}

const reasonText = (r) => r.replace(/^[a-z]+ '[^']+': /, '');
const SAFETY_PLAIN = {
  BLOOM_NEGATIVE: 'Safe for your injury',
  BLOOM_POSITIVE_RULE_CLEARED: 'Safe for your injury (double-checked)',
};
function selectCard(card) {
  body.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c === card));
  if (card.dataset.station && webglOk) flyToStation(card.dataset.station);
}
function renderResults(fly) {
  const r = state.result;
  setStep(3);
  const injury = state.injuries.find((i) => i.tag === state.injury);
  const area = injury.area.toLowerCase();
  const noSwap = r.status === 'NO_SAFE_SUBSTITUTE';
  const verdict = r.target.unsafeForInjury
    ? `<div class="verdict skip"><strong>Skip ${esc(r.target.name)} for now</strong>${esc(reasonText(r.target.unsafeReasons[0]))}</div>`
    : `<div class="verdict ok"><strong>${esc(r.target.name)} is OK for your ${esc(area)}</strong>It's not on the avoid list. If it still hurts, try one of these instead.</div>`;

  const cards = r.results.map((c) => {
    const loc = state.where[c.id];
    return `
      <div class="card" data-station="${loc ? esc(loc.stationId) : ''}">
        <div class="top"><span class="name">${esc(c.name)}</span><span class="rank">Option ${c.rank}</span></div>
        <div class="row">Works <b>${c.primaryMuscles.map(plain).join(', ')}</b></div>
        ${loc ? `<div class="row">Where: <b>${esc(loc.stationName)}</b> (${esc(loc.zone)})</div>` : ''}
        <div class="safe">✓ ${esc(SAFETY_PLAIN[c.safetyMethod] || 'Safe for your injury')}</div>
        ${loc && webglOk ? '<button class="go">Show me where</button>' : ''}
      </div>`;
  }).join('');

  const p = r.pipeline;
  const avoid = r.rejected.filter((x) => x.stage === 'SAFETY');
  body.innerHTML = `
    <h1>${noSwap ? 'No safe swap found' : 'Do this instead'}</h1>
    <p class="lead">For your ${esc(area)}: ${esc(injury.guidance)}</p>
    ${verdict}
    ${noSwap
      ? `<div class="error">${esc(r.message)} A physiotherapist can suggest a modified version.</div>`
      : cards}
    <details class="how">
      <summary>How we checked this</summary>
      <ol>
        <li><b>Found your exercise</b> using a <code>Trie</code> (prefix tree): ${esc(p.targetLookup)}.</li>
        <li><b>Gathered ${p.candidatesConsidered} exercises</b> that work the same main muscles.</li>
        <li><b>Quick safety screen</b> with a <code>Bloom filter</code>: ${p.bloomNegatives} were cleared instantly, ${p.bloomPositives} were flagged "maybe unsafe".</li>
        <li><b>Every "maybe" was checked again</b> against the full injury rules: ${p.confirmedUnsafe} really unsafe, ${p.falsePositivesCleared} false alarm${p.falsePositivesCleared === 1 ? '' : 's'} cleared. Nothing is marked unsafe from the quick screen alone.</li>
        <li><b>Ranked</b> by muscle overlap, movement type and equipment (${p.elapsedMicros.toLocaleString()} µs on the server).</li>
      </ol>
      ${avoid.length ? `<p style="margin:10px 0 0;color:var(--muted)"><b style="color:var(--text)">Avoid for now:</b> ${avoid.slice(0, 6).map((x) => esc(x.name)).join(', ')}${avoid.length > 6 ? ` and ${avoid.length - 6} more` : ''}</p>` : ''}
    </details>
    <button class="restart-big" id="again">↺ Start over with another machine</button>`;

  body.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => selectCard(card));
  });
  $('#again').addEventListener('click', restart);
  if (fly && webglOk) setOverview();
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
$('#navBack').addEventListener('click', goBack);
$('#navRestart').addEventListener('click', restart);
document.querySelectorAll('.progress button').forEach((b) => b.addEventListener('click', () => goTo(+b.dataset.step)));

(async function boot() {
  initScene();
  const enter = $('#enter');
  enter.disabled = true; enter.textContent = 'Opening the doors…';
  try {
    [state.stations, state.injuries] = await Promise.all([api('/api/gym/stations'), api('/api/injuries')]);
    if (webglOk) buildStations();
    enter.disabled = false; enter.textContent = 'Walk in';
  } catch (err) {
    $('.intro-card p:not(.eyebrow)').innerHTML = `<span style="color:var(--warn)">${esc(err.message)}</span>`;
    enter.textContent = 'Try again'; enter.disabled = false;
    enter.onclick = () => location.reload();
    $('#skip').hidden = true;
    return;
  }
  enter.addEventListener('click', () => {
    if (!webglOk) return finishIntro();
    $('#intro').classList.add('leaving');
    startWalkIn();
  });
  $('#skip').addEventListener('click', finishIntro);
})();
