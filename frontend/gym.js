// SafeSwap Gym: walk into a 3D gym, pick the machine you were going to use, say what hurts,
// get a safe swap, see where it is, and watch a 3D coach demonstrate the form. This file only
// draws the scene and renders API responses. All search, safety checking, ranking, station
// placement and demo-motion selection happen in the Java backend.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeRig, animate, createCoach } from './rig.js';

const API = new URLSearchParams(location.search).get('api') || 'http://localhost:8085';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const body = $('#panelBody');

async function api(path, options) {
  let res;
  try { res = await fetch(API + path, options); } catch {
    throw new Error(`Can't reach the server at ${API}. Start it with "mvn spring-boot:run" in the backend folder, then refresh.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || `Request failed (${res.status})`); e.hints = data.hints || []; throw e; }
  return data;
}

// ------------------------------------------------------------------
// State + vocabulary
// ------------------------------------------------------------------
const state = {
  step: 0, maxStep: 0, stations: [], injuries: [],
  station: null, exercise: null, injury: null, result: null, where: {},
  guide: null,        // open form guide: { data, back: 'results' | 'exercise' | 'hurt' | 'plan' }
  zone: 'All',
  flow: 'plan',       // 'plan' (pain check -> days -> weekly plan) or 'swap' (machine -> exercise -> pain -> swap)
  painChosen: false, planDays: 3, plan: null, planDay: 0,
};
const FLOWS = {
  plan: { steps: ['Pain check', 'Your week', 'Your plan'], titles: ['Does anything hurt?', 'How often can you train?', 'Your safe plan'] },
  swap: { steps: ['Machine', 'Exercise', 'What hurts', 'Safe swap'], titles: ['Choose a machine', 'Choose the exercise', 'Tell us what hurts', 'Your safe swap'] },
};

const ZONES = {
  Push: { color: '#e8461f', hex: 0xe8461f, blurb: 'Chest, shoulders, triceps', icon: '↗' },
  Pull: { color: '#2f6fd6', hex: 0x2f6fd6, blurb: 'Back and biceps', icon: '↙' },
  Legs: { color: '#1f9d55', hex: 0x1f9d55, blurb: 'Quads, hamstrings, glutes, calves', icon: '⇅' },
  Arms: { color: '#8b4fd6', hex: 0x8b4fd6, blurb: 'Biceps, triceps, forearms', icon: '◠' },
  'Core & Functional': { color: '#0f9aa8', hex: 0x0f9aa8, blurb: 'Abs, carries, mats and turf', icon: '◎' },
  Cardio: { color: '#d93a63', hex: 0xd93a63, blurb: 'Heart and lungs', icon: '♥' },
};
const ZONE_ORDER = Object.keys(ZONES);
const zoneOf = (z) => ZONES[z] || { color: '#4a515b', hex: 0x4a515b, blurb: '', icon: '•' };

const MUSCLE_GROUP = {
  quads: 'Legs', calves: 'Legs', adductors: 'Legs', 'hip-flexors': 'Legs',
  glutes: 'Glutes & hamstrings', hamstrings: 'Glutes & hamstrings',
  chest: 'Chest', 'upper-chest': 'Chest',
  lats: 'Back', rhomboids: 'Back', 'lower-back': 'Back', traps: 'Back', 'upper-back': 'Back',
  'front-delts': 'Shoulders', 'side-delts': 'Shoulders', 'rear-delts': 'Shoulders', 'rotator-cuff': 'Shoulders',
  biceps: 'Arms', triceps: 'Arms', forearms: 'Arms', core: 'Core', obliques: 'Core',
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
const people = [];                // { rig, motion, phase, dy, prop }
let doors = [], facade = null, ceiling = null, webglOk = true, skyTex = null, studioBg = null;

const ROOM = { w: 84, d: 60 }; // x: -42..42, z: -30..30; entrance at z = +30
// Layout only: where each backend station stands (x, z, rotation, highlight radius).
const PLACES = {
  'squat-rack': { x: -36, z: -24 }, smith: { x: -28, z: -24 }, 'hip-thrust': { x: -20, z: -24 }, 'back-extension': { x: -13, z: -24 },
  'leg-press': { x: -36, z: -14 }, 'hack-squat': { x: -28, z: -14 }, 'leg-extension': { x: -20, z: -14 }, 'leg-curl': { x: -13, z: -14 },
  calf: { x: -36, z: -5 }, 'hip-machine': { x: -28, z: -5 },
  bench: { x: -3, z: -24 }, 'incline-bench': { x: 4, z: -24 }, 'shoulder-press': { x: 11, z: -24 },
  'chest-press': { x: -3, z: -14 }, 'pec-deck': { x: 4, z: -14 }, 'cable-crossover': { x: 11, z: -14 }, dip: { x: -3, z: -5 },
  platform: { x: 19.5, z: -24 }, 't-bar': { x: 26.5, z: -24 }, 'lat-pulldown': { x: 19.5, z: -14 }, 'seated-row': { x: 26.5, z: -14 }, pullup: { x: 23, z: -5 },
  elliptical: { x: 36.5, z: -22, rot: -Math.PI / 2 }, rowers: { x: 36.5, z: -12, rot: -Math.PI / 2 }, bikes: { x: 36.5, z: -2, rot: -Math.PI / 2 }, treadmills: { x: 36.5, z: 9, rot: -Math.PI / 2 },
  preacher: { x: -36, z: 6 }, 'arms-rack': { x: -28, z: 6 }, 'cable-arms': { x: -20, z: 6 }, dumbbells: { x: -11, z: 6 },
  abs: { x: 1, z: 6 }, cables: { x: 8, z: 6 }, kettlebells: { x: 16, z: 6 }, mats: { x: 24, z: 6 }, turf: { x: -32, z: 22, rot: Math.PI / 2 },
};
const ZONE_AREAS = { // floor rectangles [x0, x1, z0, z1]
  Legs: [-42, -8, -30, 0], Push: [-8, 16, -30, 0], Pull: [16, 31, -30, 0], Cardio: [31, 42, -30, 18],
  Arms: [-42, -6, 0, 13], 'Core & Functional': [-6, 31, 0, 13],
};

function initScene() {
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { webglOk = false; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environmentIntensity = 0.18;
  skyTex = gradientTexture(['#03050b', '#0c1226', '#232a4a', '#4a3b52'], [0, 0.45, 0.8, 1]);
  studioBg = gradientTexture(['#020304', '#0b0d11'], [0, 1]);
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0x05070b, 70, 170);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(0, 1.7, 48);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 30);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 5, maxDistance: 140, maxPolarAngle: Math.PI * 0.47, enabled: false });

  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x101216, 0.35));
  const sun = new THREE.DirectionalLight(0xe6ecff, 0.9);
  sun.position.set(6, 40, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 34, bottom: -34, near: 1, far: 120 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb4ff, 0.15); fill.position.set(-25, 20, -10); scene.add(fill);

  buildRoom();
  buildOutside();
  new ResizeObserver(onResize).observe(container);
  onResize();
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', () => { setHover(null); $('#hoverTip').hidden = true; });
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.setAnimationLoop(tick);
}

// ---------- textures ----------
function gradientTexture(colors, stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 512);
  colors.forEach((col, i) => g.addColorStop(stops[i], col));
  x.fillStyle = g; x.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noiseTexture({ base, speck, tiles = 0, seam = null, size = 512, n = 9000, repeat = 1 }) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    x.fillStyle = speck[i % speck.length]; x.globalAlpha = 0.35 + Math.random() * 0.5;
    x.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  x.globalAlpha = 1;
  if (tiles && seam) { x.strokeStyle = seam; x.lineWidth = 2; for (let i = 0; i <= tiles; i++) { const p = (i * size) / tiles; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, size); x.moveTo(0, p); x.lineTo(size, p); x.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  return t;
}
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const x = c.getContext('2d'); x.fillStyle = '#c4935f'; x.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 256; i += 32) { x.fillStyle = i % 64 ? '#b98a57' : '#cf9e68'; x.fillRect(i, 0, 30, 512); }
  for (let i = 0; i < 400; i++) { x.strokeStyle = `rgba(90,55,25,${Math.random() * 0.15})`; x.beginPath(); const xx = Math.random() * 256; x.moveTo(xx, 0); x.bezierCurveTo(xx + 6, 170, xx - 6, 340, xx + 3, 512); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textTexture(text, { w = 1024, h = 256, bg = null, color = '#111418', font = '800 150px Inter, system-ui, sans-serif', accent, radius = 0 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; if (radius) { x.beginPath(); x.roundRect(0, 0, w, h, radius); x.fill(); } else x.fillRect(0, 0, w, h); }
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (accent) {
    const [a, b] = text.split(' ');
    const wa = x.measureText(a + ' ').width, wb = x.measureText(b).width, start = w / 2 - (wa + wb) / 2;
    x.textAlign = 'left'; x.fillStyle = accent; x.fillText(a + ' ', start, h / 2); x.fillStyle = color; x.fillText(b, start + wa, h / 2);
  } else { x.fillStyle = color; x.fillText(text, w / 2, h / 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------- geometry helpers ----------
const mats = {};
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...opts });
  return mats[key];
}
const M = {
  steel: () => mat(0x4a525c, { roughness: 0.35, metalness: 0.6 }), dark: () => mat(0x1d2025, { roughness: 0.5, metalness: 0.3 }),
  chrome: () => mat(0xd4d8dd, { roughness: 0.12, metalness: 1 }), pad: () => mat(0x23272d, { roughness: 0.65, metalness: 0 }),
  plate: () => mat(0x15171a, { roughness: 0.6, metalness: 0.2 }), accent: () => mat(0xe8461f, { roughness: 0.4, metalness: 0.1 }),
  rubber: () => mat(0x2b2f35, { roughness: 0.95, metalness: 0 }), screen: () => mat(0x10202e, { emissive: 0x2a7bd6, emissiveIntensity: 0.7, roughness: 0.2 }),
};
function box(g, w, h, d, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
}
function cyl(g, r, len, m, x, y, z, axis = 'y', seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true; g.add(mesh); return mesh;
}
function ball(g, r, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
}
function sub(g, x, z, ry = 0) { const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s); return s; }
function plane(w, d, m, x, y, z) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; scene.add(p); return p; }

// ---------- reusable equipment ----------
function barbell(g, x, y, z, len = 2.2, ry = 0) {
  const s = sub(g, x, z, ry); s.position.y = y;
  cyl(s, 0.028, len, M.chrome(), 0, 0, 0, 'x');
  for (const k of [-1, 1]) {
    cyl(s, 0.36, 0.07, M.plate(), k * (len / 2 - 0.25), 0, 0, 'x', 28);
    cyl(s, 0.26, 0.06, M.accent(), k * (len / 2 - 0.33), 0, 0, 'x', 28);
    cyl(s, 0.045, 0.08, M.chrome(), k * (len / 2 - 0.17), 0, 0, 'x');
  }
  return s;
}
function dumbbell(g, x, y, z, s = 1) {
  cyl(g, 0.022 * s, 0.3 * s, M.chrome(), x, y, z, 'x');
  cyl(g, 0.065 * s, 0.09 * s, M.plate(), x - 0.16 * s, y, z, 'x', 8);
  cyl(g, 0.065 * s, 0.09 * s, M.plate(), x + 0.16 * s, y, z, 'x', 8);
}
function flatBench(g, x, z, ry = 0, incline = 0) {
  const b = sub(g, x, z, ry);
  box(b, 0.25, 0.38, 0.25, M.steel(), 0, 0.19, -0.45); box(b, 0.25, 0.38, 0.25, M.steel(), 0, 0.19, 0.45);
  box(b, 0.12, 0.08, 1.0, M.steel(), 0, 0.36, 0);
  box(b, 0.32, 0.09, 0.62, M.pad(), 0, 0.45, 0.28);
  const back = box(b, 0.32, 0.09, 0.62, M.pad(), 0, 0.45, -0.32);
  if (incline) { back.rotation.x = -incline; back.position.set(0, 0.45 + Math.sin(incline) * 0.31, -0.02 - Math.cos(incline) * 0.31); }
  return b;
}
function stack(g, x, z, h = 1.6) {
  for (const k of [-1, 1]) box(g, 0.08, h + 0.4, 0.08, M.steel(), x + k * 0.26, (h + 0.4) / 2, z);
  for (let i = 0; i < 9; i++) box(g, 0.42, 0.055, 0.2, i === 8 ? M.accent() : M.dark(), x, 0.06 + i * 0.065, z);
  cyl(g, 0.012, h - 0.3, M.chrome(), x, h / 2 + 0.3, z);
  box(g, 0.66, 0.08, 0.3, M.steel(), x, h + 0.42, z);
  box(g, 0.7, 0.05, 0.5, M.dark(), x, 0.025, z);
}
function seat(g, x, z, ry = 0, back = true, h = 0.5) {
  const s = sub(g, x, z, ry);
  box(s, 0.14, h - 0.05, 0.14, M.steel(), 0, (h - 0.05) / 2, 0);
  box(s, 0.52, 0.1, 0.5, M.pad(), 0, h, 0);
  if (back) box(s, 0.52, 0.78, 0.1, M.pad(), 0, h + 0.45, 0.27);
  return s;
}
function screen(g, w, h, x, y, z, rx = 0) { const m = box(g, w, h, 0.03, M.screen(), x, y, z); m.rotation.x = rx; return m; }
function treadmill(g, x, z) {
  const t = sub(g, x, z);
  box(t, 0.88, 0.22, 2.0, M.dark(), 0, 0.11, 0);
  box(t, 0.62, 0.02, 1.7, mat(0x0d0f11, { roughness: 0.95 }), 0, 0.23, 0.05);
  for (const k of [-1, 1]) box(t, 0.07, 1.25, 0.07, M.steel(), k * 0.4, 0.75, -0.85);
  const con = box(t, 0.84, 0.34, 0.12, M.dark(), 0, 1.4, -0.85); con.rotation.x = 0.5;
  screen(t, 0.55, 0.24, 0, 1.44, -0.8, 0.5);
  for (const k of [-1, 1]) cyl(t, 0.025, 0.75, M.chrome(), k * 0.42, 1.0, -0.48, 'z');
}
function bike(g, x, z, air = false) {
  const b = sub(g, x, z);
  box(b, 0.5, 0.08, 1.2, M.dark(), 0, 0.04, 0);
  const frame = box(b, 0.12, 0.95, 0.12, M.steel(), 0, 0.5, 0.25); frame.rotation.x = -0.2;
  box(b, 0.28, 0.08, 0.32, M.pad(), 0, 0.98, 0.32);
  const post = box(b, 0.1, 1.05, 0.1, M.steel(), 0, 0.6, -0.4); post.rotation.x = 0.2;
  cyl(b, 0.03, 0.55, M.chrome(), 0, 1.13, -0.52, 'x');
  if (air) cyl(b, 0.45, 0.2, M.dark(), 0, 0.52, -0.7, 'x', 28); else cyl(b, 0.26, 0.1, M.accent(), 0, 0.4, -0.45, 'x', 24);
  screen(b, 0.22, 0.15, 0, 1.25, -0.55, 0.4);
}
function rower(g, x, z) {
  const r = sub(g, x, z);
  box(r, 0.14, 0.12, 2.6, M.steel(), 0, 0.3, 0.2);
  box(r, 0.5, 0.1, 0.2, M.dark(), 0, 0.08, 1.4);
  cyl(r, 0.32, 0.34, M.dark(), 0, 0.46, -1.1, 'x', 28);
  box(r, 0.3, 0.08, 0.35, M.pad(), 0, 0.42, 0.5);
  for (const k of [-1, 1]) { const f = box(r, 0.14, 0.02, 0.3, M.steel(), k * 0.14, 0.45, -0.6); f.rotation.x = -0.9; }
  screen(r, 0.2, 0.14, 0, 0.95, -0.95, 0.5);
}
function elliptical(g, x, z) {
  const e = sub(g, x, z);
  box(e, 0.6, 0.12, 1.9, M.dark(), 0, 0.06, 0);
  cyl(e, 0.3, 0.25, M.steel(), 0, 0.36, 0.75, 'x', 28);
  for (const k of [-1, 1]) { box(e, 0.14, 0.04, 0.4, M.pad(), k * 0.17, 0.45, 0.1); const arm = box(e, 0.04, 1.5, 0.04, M.chrome(), k * 0.22, 1.05, -0.2); arm.rotation.x = 0.2; }
  box(e, 0.12, 1.3, 0.12, M.steel(), 0, 0.7, -0.55);
  screen(e, 0.4, 0.26, 0, 1.4, -0.6);
}
function stairClimber(g, x, z) {
  const s = sub(g, x, z);
  box(s, 0.9, 0.1, 1.3, M.dark(), 0, 0.05, 0);
  for (let i = 0; i < 5; i++) box(s, 0.7, 0.18, 0.28, M.rubber(), 0, 0.2 + i * 0.2, 0.4 - i * 0.22);
  for (const k of [-1, 1]) box(s, 0.06, 1.8, 0.06, M.steel(), k * 0.42, 0.9, -0.55);
  screen(s, 0.6, 0.3, 0, 1.6, -0.6);
}
function powerRack(g, x, z) {
  const r = sub(g, x, z);
  box(r, 2.4, 0.04, 2.4, woodMat, 0, 0.02, 0.2);
  for (const [px, pz] of [[-0.75, -0.6], [0.75, -0.6], [-0.75, 0.6], [0.75, 0.6]]) box(r, 0.09, 2.5, 0.09, M.steel(), px, 1.25, pz);
  for (const pz of [-0.6, 0.6]) box(r, 1.6, 0.09, 0.09, M.steel(), 0, 2.5, pz);
  for (const px of [-0.75, 0.75]) { box(r, 0.09, 0.09, 1.3, M.steel(), px, 2.5, 0); box(r, 0.06, 0.06, 1.3, M.accent(), px, 0.9, 0); }
  barbell(r, 0, 1.4, 0.6, 2.2);
  for (const k of [0, 1]) cyl(r, 0.36, 0.07, M.plate(), 1.05 + k * 0.08, 0.38, -0.5, 'x', 28);
}
function benchPress(g, x, z, incline = 0) {
  const b = sub(g, x, z);
  box(b, 2.4, 0.04, 2.2, M.rubber(), 0, 0.02, 0);
  flatBench(b, 0, 0.3, 0, incline);
  for (const k of [-1, 1]) { box(b, 0.09, 1.35, 0.09, M.steel(), k * 0.55, 0.68, -0.45); box(b, 0.12, 0.05, 0.12, M.accent(), k * 0.55, 1.15, -0.4); }
  barbell(b, 0, 1.2, -0.45, 2.2);
}
function platform(g, x, z) {
  const p = sub(g, x, z);
  box(p, 2.5, 0.06, 2.5, M.rubber(), 0, 0.03, 0);
  box(p, 1.1, 0.065, 2.5, woodMat, 0, 0.035, 0);
  barbell(p, 0, 0.42, 0.1, 2.2);
}
function legPress(g, x, z) {
  const l = sub(g, x, z);
  box(l, 1.0, 0.2, 2.6, M.steel(), 0, 0.1, 0);
  const s = box(l, 0.7, 0.12, 0.6, M.pad(), 0, 0.55, 0.55); s.rotation.x = 0.15;
  const back = box(l, 0.7, 0.9, 0.12, M.pad(), 0, 0.85, 0.95); back.rotation.x = -0.6;
  const sled = box(l, 0.9, 0.85, 0.08, M.dark(), 0, 1.15, -0.75); sled.rotation.x = -0.6;
  for (const k of [-1, 1]) { const rail = box(l, 0.08, 0.08, 1.9, M.chrome(), k * 0.42, 0.85, -0.4); rail.rotation.x = 0.6; cyl(l, 0.32, 0.07, M.plate(), k * 0.58, 1.18, -0.62, 'x', 28); }
}
function hackSquat(g, x, z) {
  const h = sub(g, x, z);
  box(h, 1.0, 0.15, 2.0, M.steel(), 0, 0.07, 0);
  const back = box(h, 0.6, 1.5, 0.1, M.pad(), 0, 1.0, 0.3); back.rotation.x = -0.35;
  for (const k of [-1, 1]) { const rail = box(h, 0.08, 2.2, 0.08, M.chrome(), k * 0.42, 1.1, 0.35); rail.rotation.x = -0.35; box(h, 0.16, 0.12, 0.3, M.pad(), k * 0.2, 1.7, 0.05); }
  box(h, 0.75, 0.06, 0.55, M.dark(), 0, 0.2, -0.35);
}
function legMachine(g, x, z, kind) {
  const l = sub(g, x, z);
  stack(l, 0, -0.8, 1.5);
  seat(l, 0, 0.2, Math.PI);
  if (kind === 'ext') cyl(l, 0.08, 0.55, M.pad(), 0, 0.35, -0.35, 'x');
  if (kind === 'curl') { cyl(l, 0.08, 0.55, M.pad(), 0, 0.6, -0.4, 'x'); cyl(l, 0.07, 0.55, M.pad(), 0, 0.72, 0.0, 'x'); }
  if (kind === 'hip') for (const k of [-1, 1]) box(l, 0.08, 0.35, 0.45, M.pad(), k * 0.32, 0.65, -0.1);
  box(l, 0.06, 0.65, 0.06, M.steel(), 0.32, 0.5, -0.2);
}
function latPulldown(g, x, z, row = false) {
  const l = sub(g, x, z);
  stack(l, 0, -0.6, row ? 1.4 : 2.0);
  if (!row) {
    box(l, 0.1, 0.1, 1.0, M.steel(), 0, 2.4, -0.1);
    cyl(l, 0.02, 1.25, M.chrome(), 0, 1.9, 0.35, 'x');
    cyl(l, 0.006, 0.5, M.dark(), 0, 2.15, 0.35);
    seat(l, 0, 0.5, 0, false);
    cyl(l, 0.07, 0.5, M.pad(), 0, 0.78, 0.25, 'x');
  } else {
    box(l, 0.3, 0.12, 1.8, M.steel(), 0, 0.25, 0.6);
    box(l, 0.45, 0.08, 0.45, M.pad(), 0, 0.45, 0.9);
    box(l, 0.5, 0.4, 0.1, M.pad(), 0, 0.6, 0.3);
    cyl(l, 0.02, 0.5, M.chrome(), 0, 0.75, 0.1, 'x');
  }
}
function chestPress(g, x, z, pec = false) {
  const c = sub(g, x, z);
  stack(c, 0, -0.8, 1.6);
  seat(c, 0, 0.35, Math.PI);
  if (pec) for (const k of [-1, 1]) { const a = box(c, 0.08, 0.55, 0.5, M.pad(), k * 0.48, 1.12, 0.1); a.rotation.y = k * 0.5; box(c, 0.06, 0.06, 0.7, M.steel(), k * 0.4, 1.5, -0.2); }
  else for (const k of [-1, 1]) { cyl(c, 0.025, 0.65, M.chrome(), k * 0.33, 1.0, -0.05, 'z'); box(c, 0.06, 0.06, 0.8, M.steel(), k * 0.33, 1.0, -0.5); }
}
function cableTower(g, x, z, h = 2.4) {
  const c = sub(g, x, z);
  box(c, 0.16, h, 0.16, M.steel(), 0, h / 2, 0);
  box(c, 0.5, 1.3, 0.28, M.dark(), 0, 0.66, -0.3);
  ball(c, 0.08, M.accent(), 0, 1.7, 0.12);
  cyl(c, 0.006, 1.0, M.chrome(), 0, 1.2, 0.12);
  return c;
}
function cableCrossover(g, x, z) {
  const c = sub(g, x, z);
  for (const k of [-1, 1]) cableTower(c, k * 1.8, 0, 2.6);
  box(c, 3.75, 0.14, 0.14, M.steel(), 0, 2.6, 0);
  box(c, 3.2, 0.03, 1.5, M.rubber(), 0, 0.015, 0.4);
}
function kettlebell(g, x, y, z, color, s = 1) {
  ball(g, 0.15 * s, color, x, y + 0.15 * s, z);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.09 * s, 0.022 * s, 8, 20, Math.PI), mat(color)); h.position.set(x, y + 0.26 * s, z); h.castShadow = true; g.add(h);
}
function rack(g, w, shelves, fill) { // generic storage rack
  for (const k of [-w / 2, w / 2]) { box(g, 0.08, 1.05, 0.08, M.steel(), k, 0.52, -0.2); box(g, 0.08, 1.05, 0.08, M.steel(), k, 0.52, 0.2); }
  shelves.forEach((y) => box(g, w, 0.05, 0.5, M.steel(), 0, y, 0));
  if (fill) fill(g);
}

// ---------- station builders ----------
let woodMat;
const BUILDERS = {
  treadmills(g) { for (let i = 0; i < 4; i++) treadmill(g, -2.4 + i * 1.6, 0); },
  bikes(g) { bike(g, -1.8, 0); bike(g, -0.6, 0); bike(g, 0.6, 0, true); bike(g, 1.8, 0, true); },
  rowers(g) { for (const x of [-1.8, -0.6, 0.6, 1.8]) rower(g, x, 0.2); },
  elliptical(g) { elliptical(g, -1.6, 0); elliptical(g, -0.2, 0); stairClimber(g, 1.4, 0); },
  bench(g) { benchPress(g, -1.4, 0); benchPress(g, 1.4, 0); },
  'incline-bench'(g) { benchPress(g, -1.4, 0, 0.55); benchPress(g, 1.4, 0, 0.3); },
  'shoulder-press'(g) {
    const m = sub(g, -1.0, 0); stack(m, 0, -0.8, 1.8); seat(m, 0, 0.25, Math.PI);
    for (const k of [-1, 1]) { box(m, 0.06, 0.9, 0.06, M.steel(), k * 0.38, 1.3, -0.1); cyl(m, 0.025, 0.25, M.chrome(), k * 0.38, 1.75, 0.0, 'z'); }
    flatBench(g, 1.2, 0.2, 0, 1.3); dumbbell(g, 1.2, 0.07, 1.0, 1); dumbbell(g, 1.5, 0.07, 1.1, 1);
  },
  calf(g) {
    const s = sub(g, -0.8, 0);
    for (const k of [-1, 1]) box(s, 0.1, 2.2, 0.1, M.steel(), k * 0.45, 1.1, -0.4);
    box(s, 0.9, 0.12, 0.35, M.pad(), 0, 1.6, -0.1); box(s, 0.9, 0.12, 0.45, M.dark(), 0, 0.1, 0.0); stack(s, 0, -0.75, 1.9);
    const sc = sub(g, 1.0, 0); seat(sc, 0, 0.3, Math.PI, false, 0.45); box(sc, 0.5, 0.1, 0.25, M.pad(), 0, 0.7, -0.2); box(sc, 0.5, 0.1, 0.25, M.dark(), 0, 0.12, -0.35);
  },
  'hip-thrust'(g) {
    box(g, 3.0, 0.04, 2.6, M.rubber(), 0, 0.02, 0);
    flatBench(g, -0.7, -0.6, Math.PI / 2); barbell(g, -0.7, 0.36, 0.4, 1.8);
    const m = sub(g, 1.0, 0); box(m, 0.8, 0.45, 0.4, M.pad(), 0, 0.3, -0.5); box(m, 0.9, 0.08, 1.5, M.steel(), 0, 0.05, 0.1); box(m, 0.7, 0.12, 0.25, M.accent(), 0, 0.55, 0.2);
  },
  'squat-rack'(g) { powerRack(g, -1.4, 0); powerRack(g, 1.4, 0); },
  smith(g) {
    const s = sub(g, 0, 0);
    box(s, 2.6, 0.04, 1.8, woodMat, 0, 0.02, 0);
    for (const k of [-1, 1]) { box(s, 0.12, 2.6, 0.12, M.steel(), k * 1.05, 1.3, -0.5); box(s, 0.12, 2.6, 0.12, M.steel(), k * 1.05, 1.3, 0.5); cyl(s, 0.03, 2.4, M.chrome(), k * 0.95, 1.25, 0); }
    box(s, 2.3, 0.12, 1.12, M.steel(), 0, 2.6, 0);
    barbell(s, 0, 1.3, 0, 2.3);
    flatBench(s, 0, 0.2, 0);
  },
  't-bar'(g) {
    const l = sub(g, -0.9, 0); box(l, 0.6, 0.1, 2.0, M.steel(), 0, 0.05, 0); box(l, 0.6, 0.12, 0.45, M.dark(), 0, 0.2, 0.7);
    const pad = box(l, 0.5, 0.12, 0.8, M.pad(), 0, 1.05, -0.05); pad.rotation.x = 0.7;
    const arm = box(l, 0.08, 0.08, 1.7, M.chrome(), 0, 0.8, -0.3); arm.rotation.x = -0.35; cyl(l, 0.3, 0.07, M.plate(), 0, 0.6, -1.0, 'x', 28);
    const lm = sub(g, 1.1, 0); box(lm, 0.3, 0.12, 0.3, M.dark(), 0, 0.06, -0.9); const bar = cyl(lm, 0.028, 2.0, M.chrome(), 0, 0.45, 0); bar.rotation.x = 1.2;
    cyl(lm, 0.32, 0.07, M.plate(), 0, 0.88, 0.85, 'z', 28); box(lm, 0.5, 0.04, 0.12, M.steel(), 0, 0.88, 0.95);
  },
  platform(g) { platform(g, -1.35, 0); platform(g, 1.35, 0); },
  preacher(g) {
    for (const x of [-0.8, 0.8]) {
      const p = sub(g, x, 0); seat(p, 0, 0.35, 0, false, 0.55);
      box(p, 0.1, 0.9, 0.1, M.steel(), 0, 0.45, -0.25); const pad = box(p, 0.6, 0.08, 0.45, M.pad(), 0, 0.95, -0.3); pad.rotation.x = 0.7;
      box(p, 0.06, 0.06, 0.7, M.steel(), 0, 1.15, -0.55).rotation.y = Math.PI / 2;
    }
    const ez = sub(g, 0, -0.55); ez.position.y = 1.18; cyl(ez, 0.02, 1.2, M.chrome(), 0, 0, 0, 'x'); for (const k of [-1, 1]) cyl(ez, 0.2, 0.05, M.plate(), k * 0.5, 0, 0, 'x', 24);
  },
  'arms-rack'(g) {
    const r = sub(g, 0, -0.3);
    for (const k of [-1.4, 1.4]) box(r, 0.1, 1.6, 0.3, M.steel(), k, 0.8, 0);
    for (let i = 0; i < 5; i++) {
      const y = 0.4 + i * 0.28;
      const b = sub(r, 0, 0); b.position.y = y;
      cyl(b, 0.02, 2.6, M.chrome(), 0, 0, 0.12, 'x');
      for (const k of [-1, 1]) cyl(b, 0.09 + i * 0.012, 0.08, i % 2 ? M.plate() : M.accent(), k * 1.15, 0, 0.12, 'x', 20);
    }
    flatBench(g, 0, 1.2, Math.PI / 2);
  },
  'leg-press'(g) { legPress(g, 0, 0); },
  'hack-squat'(g) { hackSquat(g, 0, 0); },
  'leg-extension'(g) { legMachine(g, 0, 0, 'ext'); },
  'leg-curl'(g) { legMachine(g, 0, 0, 'curl'); },
  'hip-machine'(g) { legMachine(g, -0.9, 0, 'hip'); legMachine(g, 0.9, 0, 'hip'); },
  'back-extension'(g) {
    const r = sub(g, -0.8, 0); box(r, 0.6, 0.08, 1.5, M.steel(), 0, 0.04, 0);
    const f = box(r, 0.12, 1.1, 0.12, M.steel(), 0, 0.5, 0.2); f.rotation.x = -0.6;
    const pad = box(r, 0.5, 0.1, 0.4, M.pad(), 0, 0.95, -0.05); pad.rotation.x = 0.75; box(r, 0.4, 0.1, 0.12, M.pad(), 0, 0.3, 0.55);
    const h = sub(g, 1.0, 0); box(h, 0.6, 0.9, 0.6, M.steel(), 0, 0.45, 0); box(h, 0.6, 0.1, 0.9, M.pad(), 0, 0.95, 0); cyl(h, 0.06, 0.5, M.pad(), 0, 0.5, 0.7, 'x');
  },
  'chest-press'(g) { chestPress(g, 0, 0); },
  'pec-deck'(g) { chestPress(g, -0.9, 0, true); flatBench(g, 1.1, 0.2); dumbbell(g, 1.4, 0.07, 1.0); },
  dip(g) {
    const d = sub(g, -0.8, 0);
    for (const k of [-0.28, 0.28]) { cyl(d, 0.03, 0.9, M.chrome(), k, 1.25, 0, 'z'); box(d, 0.08, 1.25, 0.08, M.steel(), k, 0.62, 0.4); box(d, 0.08, 1.25, 0.08, M.steel(), k, 0.62, -0.4); }
    box(d, 1.0, 0.05, 1.2, M.rubber(), 0, 0.025, 0);
    const a = sub(g, 1.0, 0); stack(a, 0, -0.6, 2.0); box(a, 0.5, 0.1, 0.35, M.pad(), 0, 0.9, 0.1);
    for (const k of [-1, 1]) cyl(a, 0.025, 0.5, M.chrome(), k * 0.3, 1.35, 0.15, 'z');
  },
  pullup(g) {
    for (const k of [-1.2, 1.2]) box(g, 0.12, 2.8, 0.12, M.steel(), k, 1.4, 0);
    cyl(g, 0.032, 2.5, M.chrome(), 0, 2.6, 0, 'x');
    box(g, 2.6, 0.06, 1.6, M.rubber(), 0, 0.03, 0.3);
    for (const k of [-0.5, 0.5]) { box(g, 0.08, 0.08, 0.5, M.steel(), k, 2.7, -0.2); cyl(g, 0.025, 0.3, M.chrome(), k, 2.62, -0.4, 'y'); }
  },
  'lat-pulldown'(g) { latPulldown(g, 0, 0); },
  'seated-row'(g) { latPulldown(g, 0, -0.3, true); },
  'cable-crossover'(g) { cableCrossover(g, 0, 0); },
  'cable-arms'(g) {
    const c = cableTower(g, -0.6, 0, 2.3); const rope = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16, Math.PI), mat(0x222222)); rope.position.set(0, 1.2, 0.12); rope.rotation.z = Math.PI; c.add(rope);
    const c2 = cableTower(g, 0.8, 0, 2.3); cyl(c2, 0.015, 0.4, M.chrome(), 0, 0.7, 0.15, 'x');
  },
  abs(g) {
    const a = sub(g, 0, 0); stack(a, 0, -0.75, 1.6); seat(a, 0, 0.25, Math.PI);
    box(a, 0.55, 0.12, 0.3, M.pad(), 0, 1.35, -0.2); for (const k of [-1, 1]) box(a, 0.06, 0.06, 0.5, M.steel(), k * 0.3, 1.45, -0.3);
  },
  cables(g) {
    const c = sub(g, 0, 0);
    for (const k of [-0.9, 0.9]) { box(c, 0.14, 2.4, 0.14, M.steel(), k, 1.2, 0); box(c, 0.45, 1.2, 0.26, M.dark(), k, 0.62, -0.25); ball(c, 0.07, M.accent(), k, 1.4, 0.12); }
    box(c, 1.95, 0.14, 0.14, M.steel(), 0, 2.4, 0); cyl(c, 0.03, 1.4, M.chrome(), 0, 2.2, 0.15, 'x');
    box(c, 2.6, 0.03, 1.6, M.rubber(), 0, 0.015, 0.5);
  },
  dumbbells(g) {
    rack(g, 4.0, [0.5, 0.85], () => {
      for (let i = 0; i < 9; i++) { const x = -1.7 + i * 0.42, s = 0.75 + i * 0.09; dumbbell(g, x, 0.57 + 0.065 * s, 0.08, s); dumbbell(g, x, 0.91 + 0.05 * s, -0.05, s * 0.7); }
    });
    flatBench(g, -1, 1.6, Math.PI / 2, 0.3); flatBench(g, 1, 1.6, Math.PI / 2);
  },
  kettlebells(g) {
    rack(g, 2.8, [0.02, 0.35]);
    [0x3f6db3, 0xe0b23f, 0x4f9a5e, 0xe8461f, 0x22262b, 0x3f6db3].forEach((c, i) => kettlebell(g, -1.1 + i * 0.44, 0.38, 0, c, 0.75 + i * 0.1));
    ball(g, 0.2, 0x7a5c3e, -0.6, 0.2, 0.9); ball(g, 0.24, 0x8b6a47, 0.1, 0.24, 1.0); ball(g, 0.18, 0x6e5235, 0.7, 0.18, 0.85);
    const tb = sub(g, 0.2, 1.9); const hex = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 6), M.steel()); hex.rotation.x = Math.PI / 2; hex.position.y = 0.2; tb.add(hex);
  },
  turf(g) {
    box(g, 2.4, 0.03, 9, mat(0x3f8a45, { roughness: 1 }), 0, 0.015, 0);
    for (let i = -4; i <= 4; i += 1.5) box(g, 2.4, 0.035, 0.05, 0xf2f3f5, 0, 0.02, i);
    const sled = sub(g, 0, 2.5);
    box(sled, 0.8, 0.12, 0.9, M.dark(), 0, 0.08, 0);
    for (const k of [-0.25, 0.25]) { const p = box(sled, 0.06, 1.0, 0.06, M.steel(), k, 0.6, 0.35); p.rotation.x = -0.25; }
    cyl(sled, 0.3, 0.08, M.plate(), 0, 0.25, 0);
    const lm = cyl(g, 0.028, 2.0, M.chrome(), 0.6, 0.45, -2.2); lm.rotation.x = 1.15;
    cyl(g, 0.3, 0.07, M.plate(), 0.6, 0.85, -3.0, 'z');
    box(g, 0.3, 0.3, 0.3, M.dark(), -0.5, 0.15, -4.2);
    for (const k of [-0.15, 0.15]) { const r = cyl(g, 0.03, 3.2, mat(0x2b2b2b, { roughness: 0.9 }), -0.5 + k, 0.04, -2.5, 'z'); r.rotation.y = k * 0.3; }
  },
  mats(g) {
    for (const [x, z] of [[-1.6, -0.8], [-0.4, -0.8], [0.8, -0.8], [-1.6, 1.4], [-0.4, 1.4]]) box(g, 1.0, 0.04, 2.0, mat(0x3f6db3, { roughness: 0.9 }), x, 0.02, z);
    ball(g, 0.36, 0x9bb7e0, 2.2, 0.36, -0.6); ball(g, 0.3, 0xe0b5a5, 2.3, 0.3, 0.4);
    box(g, 0.6, 0.6, 0.6, woodMat, 1.0, 0.3, 1.4); box(g, 0.5, 0.45, 0.5, woodMat, 1.8, 0.22, 1.5);
    for (let i = 0; i < 3; i++) cyl(g, 0.08, 0.6, 0x3a3a3a, 2.6, 0.08, 1.2 + i * 0.25, 'x');
  },
};

// People training around the gym (station id -> list of [x, z, rotY, motion, dy, shirt, extra])
const SKINS = [0xc98e66, 0x8d5a3b, 0xe2b48f, 0x6b4430, 0xd9a77e];
const SHIRTS = [0x2f6fd6, 0x1f9d55, 0x22262b, 0x8b4fd6, 0xf2f3f5, 0x0f9aa8, 0xd93a63];
const PEOPLE = {
  treadmills: [[-0.8, 0.15, Math.PI, 'run', 0.08], [2.4, 0.15, Math.PI, 'walk', 0.08]],
  bikes: [[-1.8, 0.32, Math.PI, 'cycle', 0.03]],
  rowers: [[-0.6, 0.6, Math.PI, 'rowing', 0.08]],
  'squat-rack': [[-1.4, 1.8, 0, 'squat', 0]],
  dumbbells: [[0.2, 0.9, 0, 'curl', 0]],
  'lat-pulldown': [[0, 0.5, Math.PI, 'pulldown', 0.03]],
  turf: [[-0.5, -2.2, Math.PI, 'waves', 0]],
  mats: [[-1.6, -0.9, Math.PI / 2, 'plank', 0.04]],
  'shoulder-press': [[1.2, 1.1, 0, 'raise', 0]],
  'cable-arms': [[-0.6, 0.65, Math.PI, 'pushdown', 0]],
};
let personSeed = 0;
function addPerson(parent, x, z, ry, motion, dy = 0) {
  const i = personSeed++;
  const rig = makeRig({ shirt: SHIRTS[i % SHIRTS.length], skin: SKINS[i % SKINS.length], shorts: i % 3 ? 0x22262b : 0x3a4250, hair: i % 2 ? 0x2b211c : 0x5a3b22 });
  rig.holder.position.set(x, 0, z); rig.holder.rotation.y = ry;
  parent.add(rig.holder);
  people.push({ rig, motion, phase: i * 0.37, dy });
  return rig;
}

// ---------- the room ----------
function plant(x, z, s = 1) {
  const g = sub(scene, x, z);
  cyl(g, 0.28 * s, 0.5 * s, 0xf2f2f2, 0, 0.25 * s, 0);
  for (const [dx, dy, dz, r] of [[0, 0.9, 0, 0.42], [0.2, 1.2, 0.1, 0.3], [-0.2, 1.15, -0.1, 0.32], [0, 1.45, 0, 0.25]]) ball(g, r * s, mat(0x3f7f4a, { roughness: 0.9 }), dx * s, dy * s, dz * s);
}
function hangingSign(text, x, z, color) {
  const tex = textTexture(text.toUpperCase(), { w: 1024, h: 200, bg: color, color: '#ffffff', font: '800 104px Inter, system-ui, sans-serif', radius: 30 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, toneMapped: false }));
  m.position.set(x, 5.9, z); scene.add(m);
  for (const k of [-2.4, 2.4]) { const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5), mat(0x555555)); wire.position.set(x + k, 7.2, z); ceilingWires.push(wire); scene.add(wire); }
}
const ceilingWires = [];
function wallText(text, x, y, z, w, h, color, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, { w: 2048, h: Math.round(2048 * h / w), color, font: `900 ${Math.round(2048 * h / w * 0.7)}px Inter, system-ui, sans-serif` }), transparent: true }));
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
}
function buildRoom() {
  const W = ROOM.w, Dp = ROOM.d;
  woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 });
  // floors
  const concrete = new THREE.MeshStandardMaterial({ map: noiseTexture({ base: '#2e3238', speck: ['#3a3f46', '#24272c', '#454a52'], n: 14000, repeat: 6 }), roughness: 0.55, metalness: 0.05 });
  plane(W, Dp, concrete, 0, 0, 0);
  const rubber = new THREE.MeshStandardMaterial({ map: noiseTexture({ base: '#17191c', speck: ['#24272b', '#101214', '#2e3237'], tiles: 4, seam: '#0c0d0f', n: 20000 }), roughness: 0.95 });
  for (const [z, [x0, x1, z0, z1]] of Object.entries(ZONE_AREAS)) {
    const col = zoneOf(z);
    const m = z === 'Cardio' || z === 'Core & Functional' ? mat(z === 'Cardio' ? 0x24282e : 0x2b2822, { roughness: 0.9, metalness: 0 }) : rubber.clone();
    if (m.map) { m.map = m.map.clone(); m.map.needsUpdate = true; m.map.repeat.set((x1 - x0) / 2, (z1 - z0) / 2); }
    plane(x1 - x0 - 0.3, z1 - z0 - 0.3, m, (x0 + x1) / 2, 0.006, (z0 + z1) / 2);
    // painted zone border stripe
    const s = mat(col.hex, { roughness: 0.7 });
    for (const [w, d, x, zz] of [[x1 - x0, 0.14, (x0 + x1) / 2, z1 - 0.1], [x1 - x0, 0.14, (x0 + x1) / 2, z0 + 0.1], [0.14, z1 - z0, x0 + 0.1, (z0 + z1) / 2], [0.14, z1 - z0, x1 - 0.1, (z0 + z1) / 2]]) plane(w, d, s, x, 0.012, zz);
  }
  plane(12, 9, mat(0x3f8a45, { roughness: 1 }), -34, 0.006, 22);

  const wallMat = mat(0x16191e, { roughness: 0.9, metalness: 0 });
  const wall = (w, h, d, x, y, z, m = wallMat) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.receiveShadow = true; scene.add(mesh); return mesh; };
  wall(W, 7.5, 0.3, 0, 3.75, -Dp / 2);
  wall(0.3, 7.5, Dp, -W / 2, 3.75, 0);
  wall(0.3, 1.0, Dp, W / 2, 0.5, 0);
  wall(0.3, 1.2, Dp, W / 2, 6.9, 0);
  for (let z = -27; z <= 27; z += 6) wall(0.4, 5.3, 0.25, W / 2, 3.65, z + 3, M.dark());
  const glassMat = mat(0x0d1424, { emissive: 0x1a2a4a, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 });
  wall(0.08, 5.3, Dp, W / 2, 3.65, 0, glassMat);
  // dark base trim + zone accent paint on the back wall
  wall(W, 0.3, 0.32, 0, 0.15, -Dp / 2 + 0.02, M.dark());
  for (const [z, [x0, x1]] of Object.entries(ZONE_AREAS)) {
    if (z === 'Cardio' || z === 'Arms' || z === 'Core & Functional') continue;
    wall(x1 - x0 - 0.4, 2.6, 0.05, (x0 + x1) / 2, 5.6, -Dp / 2 + 0.18, mat(zoneOf(z).hex, { roughness: 0.8 }));
    wallText(z.toUpperCase(), (x0 + x1) / 2, 5.6, -Dp / 2 + 0.22, Math.min(x1 - x0 - 2, 14), 2.2, '#ffffff');
  }
  // mirrors along the back wall
  const mirror = mat(0xdfe7ee, { metalness: 1, roughness: 0.04 });
  for (const [x0, x1] of [[-41, -9], [-7, 15], [17, 30]]) wall(x1 - x0, 2.6, 0.05, (x0 + x1) / 2, 2.15, -Dp / 2 + 0.2, mirror);
  // left wall graphics
  wall(0.05, 2.4, 34, -W / 2 + 0.18, 5.6, -13, mat(ZONES.Legs.hex, { roughness: 0.8 }));
  wallText('TRAIN SMART · TRAIN SAFE', -W / 2 + 0.22, 5.6, -13, 30, 1.5, '#ffffff', Math.PI / 2);
  wall(0.05, 2.4, 20, -W / 2 + 0.18, 5.6, 7, mat(ZONES.Arms.hex, { roughness: 0.8 }));
  wallText('ARMS', -W / 2 + 0.22, 5.6, 7, 10, 2, '#ffffff', Math.PI / 2);

  // reception, lockers, plants, water
  const desk = sub(scene, 14, 24.5);
  box(desk, 5, 1.1, 1.1, 0x1d2127, 0, 0.55, 0);
  box(desk, 5.2, 0.08, 1.3, M.accent(), 0, 1.12, 0);
  box(desk, 5.0, 0.06, 0.06, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1 }), 0, 0.05, 0.56);
  screen(desk, 0.6, 0.4, -1.2, 1.4, -0.2);
  const rs = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.55), new THREE.MeshBasicMaterial({ map: textTexture('RECEPTION', { w: 1024, h: 160, color: '#ffffff', font: '800 100px Inter, system-ui, sans-serif' }), transparent: true }));
  rs.position.set(0, 0.62, 0.56); desk.add(rs);
  addPerson(desk, 0.6, -0.9, 0, 'wave');
  wall(7, 4, 0.2, 14, 2, 27.2, mat(0x2b3038, { roughness: 0.8 }));
  wallText('WELCOME', 14, 3.0, 27.08, 6, 1.0, '#ffffff', Math.PI);
  for (const [x, z, s] of [[-4, 27.8, 1], [4.5, 27.8, 1], [40.5, -28.3, 1.3], [-40.4, 28.3, 1.3], [40.5, 28.3, 1.2], [-40.4, -28.3, 1.2], [30.5, 14, 1]]) plant(x, z, s);
  const wf = sub(scene, -6.5, 28.6); box(wf, 0.6, 1.0, 0.4, M.chrome(), 0, 0.5, 0); box(wf, 0.5, 0.06, 0.35, 0xf2f3f5, 0, 1.03, 0);
  for (let i = 0; i < 10; i++) box(scene, 0.75, 2.1, 0.55, i % 2 ? 0x2c333c : 0x262c34, -9.5 - i * 0.78, 1.05, 29.4);
  wallText('LOCKERS', -13, 2.6, 29.1, 4, 0.6, '#ffffff', Math.PI);

  // hanging zone signs
  for (const [z, [x0, x1, z0, z1]] of Object.entries(ZONE_AREAS)) hangingSign(z, (x0 + x1) / 2, (z0 + z1) / 2 + (z === 'Cardio' ? 0 : 2), zoneOf(z).color);
  hangingSign('Turf', -34, 18, ZONES['Core & Functional'].color);

  // Real-gym lighting: linear fixtures over every row, warm spots on each zone, LED wall strips.
  const fixture = mat(0xffffff, { emissive: 0xfff1dc, emissiveIntensity: 3.2 });
  for (const z of [-24, -14, -5, 6, 18]) for (let x = -36; x <= 34; x += 10) {
    box(scene, 6, 0.08, 0.32, mat(0x0c0d10), x, 6.62, z); box(scene, 5.8, 0.04, 0.24, fixture, x, 6.56, z);
  }
  for (const [z, [x0, x1, z0, z1]] of Object.entries(ZONE_AREAS)) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0);
    const xs = span > 20 ? [cx - span / 4, cx + span / 4] : [cx];
    for (const x of xs) {
      const spot = new THREE.SpotLight(0xffe2c0, 520, 30, 0.95, 0.75, 1.4);
      spot.position.set(x, 7.2, cz + 2); spot.target.position.set(x, 0, cz); scene.add(spot, spot.target);
    }
    const led = mat(zoneOf(z).hex, { emissive: zoneOf(z).hex, emissiveIntensity: 2.2 });
    plane(x1 - x0 - 0.6, 0.06, led, (x0 + x1) / 2, 0.02, z1 - 0.32);
  }
  wall(W, 0.08, 0.06, 0, 7.3, -Dp / 2 + 0.2, mat(0xff5a2c, { emissive: 0xff5a2c, emissiveIntensity: 2.5 }));
  wall(0.06, 0.08, Dp, -W / 2 + 0.2, 7.3, 0, mat(0xff5a2c, { emissive: 0xff5a2c, emissiveIntensity: 2.5 }));
  wall(W, 0.06, 0.06, 0, 0.32, -Dp / 2 + 0.2, mat(0xffffff, { emissive: 0xbfd4ff, emissiveIntensity: 1.2 }));

  // Ceiling + light panels: part of the walk-in, hidden afterwards like a dollhouse cut-away.
  ceiling = new THREE.Group(); scene.add(ceiling);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), mat(0x2b2f36, { roughness: 1, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 7.5; ceiling.add(ceil);
  for (let x = -36; x <= 36; x += 9) for (let z = -24; z <= 24; z += 8) box(ceiling, 5, 0.06, 0.5, mat(0xffffff, { emissive: 0xfff4e0, emissiveIntensity: 1.6 }), x, 7.4, z);
  for (let x = -40; x <= 40; x += 10) box(ceiling, 0.25, 0.4, Dp, M.dark(), x, 7.2, 0);
  ceilingWires.forEach((w) => ceiling.attach(w));

  // Front facade (glass, cladding, sign, sliding doors) — hidden after the walk-in.
  facade = new THREE.Group(); scene.add(facade);
  const glass = mat(0xcfe6f5, { transparent: true, opacity: 0.18, roughness: 0.02, metalness: 0.2 });
  for (const k of [-1, 1]) { const g = new THREE.Mesh(new THREE.BoxGeometry(W / 2 - 3, 5.2, 0.1), glass); g.position.set(k * (W / 4 + 1.5), 2.6, Dp / 2); facade.add(g); }
  box(facade, W, 2.3, 0.4, mat(0x24282f, { roughness: 0.7 }), 0, 6.35, Dp / 2);
  for (let x = -40; x <= 40; x += 5) if (Math.abs(x) > 3) box(facade, 0.14, 5.2, 0.18, M.steel(), x, 2.6, Dp / 2);
  for (const k of [-1, 1]) box(facade, 0.2, 4.8, 0.22, M.steel(), k * 3, 2.4, Dp / 2);
  box(facade, 6.2, 0.2, 0.22, M.steel(), 0, 4.8, Dp / 2);
  box(facade, 8, 0.15, 2.4, mat(0x1b1e23), 0, 5.2, Dp / 2 + 1.2); // canopy
  for (let x = -3; x <= 3; x += 1.5) box(facade, 0.5, 0.02, 0.2, mat(0xffffff, { emissive: 0xffe9c4, emissiveIntensity: 3 }), x, 5.12, Dp / 2 + 1.4);
  const signTex = textTexture('SAFESWAP GYM', { w: 2048, h: 300, color: '#ffffff', accent: '#ff6a3d', font: '900 210px Inter, system-ui, sans-serif' });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.9), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false }));
  sign.position.set(0, 6.4, Dp / 2 + 0.22); facade.add(sign);
  const open = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), new THREE.MeshBasicMaterial({ map: textTexture('OPEN 24/7', { w: 512, h: 170, bg: '#1f9d55', color: '#ffffff', font: '800 90px Inter, system-ui, sans-serif', radius: 30 }), toneMapped: false, transparent: true }));
  open.position.set(4.3, 2.6, Dp / 2 + 0.08); facade.add(open);
  for (const k of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(2.95, 4.6, 0.06), mat(0xcfe6f5, { transparent: true, opacity: 0.28, roughness: 0.02 }));
    d.position.set(k * 1.5, 2.3, Dp / 2); facade.add(d);
    const handle = box(facade, 0.05, 1.3, 0.08, M.chrome(), k * 0.25, 1.2, Dp / 2 + 0.06);
    doors.push({ mesh: d, side: k, handle });
  }
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.2), mat(0x24282f, { roughness: 1, metalness: 0 }));
  wm.rotation.x = -Math.PI / 2; wm.position.set(0, 0.01, Dp / 2 - 1.5); scene.add(wm);
}
function buildOutside() {
  const Dp = ROOM.d;
  plane(140, 12, mat(0x26282c, { roughness: 1 }), 0, -0.01, Dp / 2 + 6);       // sidewalk
  plane(140, 16, mat(0x111215, { roughness: 1 }), 0, -0.02, Dp / 2 + 20);      // street
  for (let x = -66; x <= 66; x += 6) plane(3, 0.25, mat(0xe8e2c8, { roughness: 1 }), x, -0.01, Dp / 2 + 20);
  box(scene, 140, 0.15, 0.3, 0x3a3d42, 0, 0.07, Dp / 2 + 12);
  plane(140, 40, mat(0x0e1610, { roughness: 1 }), 0, -0.03, Dp / 2 + 48);
  for (const x of [-12, 12, -34, 34]) { // street lamps
    const l = sub(scene, x, Dp / 2 + 10.5);
    cyl(l, 0.08, 5.5, M.dark(), 0, 2.75, 0); box(l, 0.12, 0.12, 1.2, M.dark(), 0, 5.45, -0.55);
    box(l, 0.5, 0.12, 0.35, mat(0xffffff, { emissive: 0xffd9a0, emissiveIntensity: 3 }), 0, 5.35, -1.1);
  }
  for (const x of [-24, -46, 24, 46, -58, 58]) { // trees
    const t = sub(scene, x, Dp / 2 + 8);
    cyl(t, 0.18, 2.4, 0x5a4030, 0, 1.2, 0);
    for (const [dx, dy, r] of [[0, 3.3, 1.5], [0.7, 2.8, 1.0], [-0.7, 2.9, 1.1]]) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(0x3d6b3f, { roughness: 1, flatShading: true })); f.position.set(dx, dy, 0); f.castShadow = true; t.add(f);
    }
  }
  // neighbouring buildings
  for (const [x, w, h, c] of [[-62, 36, 12, 0x15181d], [62, 36, 10, 0x1a1816]]) box(scene, w, h, Dp, c, x, h / 2, 0);
}

function buildStations() {
  for (const st of state.stations) {
    const p = PLACES[st.id] || { x: 0, z: 0 };
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.rot || 0;
    (BUILDERS[st.id] || BUILDERS.mats)(group);
    for (const [x, z, ry, motion, dy] of PEOPLE[st.id] || []) addPerson(group, x, z, ry, motion, dy);

    const r = p.r || (st.id === 'turf' ? 4.8 : 3.2);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: zoneOf(st.zone).hex, transparent: true, opacity: 0, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03; group.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 64), new THREE.MeshBasicMaterial({ color: zoneOf(st.zone).hex, transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035; group.add(ring);

    const el = document.createElement('div');
    el.className = 'label';
    el.style.setProperty('--zc', zoneOf(st.zone).color);
    el.innerHTML = `<i></i>${esc(st.name)}<span class="badge"></span>`;
    el.addEventListener('click', () => onStationClick(st.id));
    el.addEventListener('pointerenter', () => setHover(st.id));
    el.addEventListener('pointerleave', () => setHover(null));
    const label = new CSS2DObject(el);
    label.position.set(0, 3.2, 0);
    group.add(label);

    group.traverse((o) => { o.userData.stationId = st.id; });
    scene.add(group);
    stationObjects.set(st.id, { group, pad, ring, label: el, zone: st.zone });
  }
  refreshHighlights();
}

// ---------- interaction ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverId = null, downAt = null;

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
    tip.innerHTML = `<b>${esc(st.name)}</b>${state.step === 0 ? `<br>${st.exerciseCount} exercises · tap to open` : ''}`;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
    tip.hidden = false;
  } else tip.hidden = true;
}
function onPointerUp(e) {
  if (intro || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
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
  const swapFlow = state.flow === 'swap', planView = state.flow === 'plan' && state.step === 2;
  for (const [id, o] of stationObjects) {
    const selected = swapFlow && state.station?.id === id && state.step > 0 && state.step < 3;
    const isSwap = swaps[id] > 0;
    const zoneOn = swapFlow && state.step === 0 && state.zone !== 'All' && o.zone === state.zone;
    o.pad.material.opacity = selected ? 0.3 : isSwap ? 0.22 : hoverId === id ? 0.2 : zoneOn ? 0.1 : 0;
    o.ring.material.opacity = selected || isSwap || hoverId === id ? 0.9 : zoneOn ? 0.5 : 0;
    o.label.classList.toggle('selected', selected);
    o.label.classList.toggle('hover', hoverId === id && !selected && !isSwap);
    o.label.classList.toggle('has-swap', isSwap);
    o.label.classList.toggle('dim', swapFlow
      ? (state.step === 3 && !isSwap) || (state.step > 0 && state.step < 3 && !selected) || (state.step === 0 && state.zone !== 'All' && !zoneOn)
      : planView && !isSwap);
    const unit = planView ? 'move' : 'swap';
    o.label.querySelector('.badge').textContent = isSwap ? `${swaps[id]} ${unit}${swaps[id] > 1 ? 's' : ''}` : '';
  }
}

// ---------- camera ----------
let flight = null, intro = null;
function overviewPose() {
  const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
  // distance that fits the 88 m-wide floor horizontally (and the 62 m depth vertically)
  const half = Math.tan((camera.fov * Math.PI) / 360);
  const dist = Math.max(46 / (half * (w / h)), 34 / half) * 0.98;
  const dir = new THREE.Vector3(0, 0.72, 0.69).normalize();
  return { pos: dir.multiplyScalar(dist).add(new THREE.Vector3(0, 0, -1)), target: new THREE.Vector3(0, 0, -1) };
}
function setOverview() { const o = overviewPose(); flyTo(o.pos, o.target); }
function flyToZone(zone) {
  const a = ZONE_AREAS[zone];
  if (!a) return setOverview();
  const cx = (a[0] + a[1]) / 2, cz = (a[2] + a[3]) / 2, span = Math.max(a[1] - a[0], a[3] - a[2]);
  const target = new THREE.Vector3(cx, 0, cz);
  flyTo(target.clone().add(new THREE.Vector3(0, span * 0.95 + 6, span * 0.8 + 6)), target);
}
function flyToStation(id) {
  const p = PLACES[id]; if (!p) return;
  const target = new THREE.Vector3(p.x, 0.9, p.z);
  const narrow = container.clientWidth < 600;
  const dir = new THREE.Vector3(-p.x * 0.012, 0, 1).normalize();
  const pos = target.clone().add(dir.multiplyScalar(narrow ? 12 : 8.5)).add(new THREE.Vector3(0, narrow ? 8 : 5.2, 0));
  flyTo(pos, target);
}
function flyTo(pos, target, ms = 1000) {
  flight = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, start: performance.now(), ms };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

// The walk-in: dusk street -> doors slide open -> reception -> look at each zone -> rise to the floor plan.
const CAPTIONS = [
  [0.0, 'Welcome to SafeSwap Gym'],
  [2.6, 'Reception is on your right. First-timers check in here.'],
  [4.2, 'Legs zone: squat racks, leg press and leg machines'],
  [5.8, 'Push zone: bench press, shoulder press and chest machines'],
  [7.2, 'Pull zone, then cardio along the windows'],
  [8.8, 'Here is the whole floor. Pick the machine you were going to use.'],
];
function startWalkIn() {
  const o = overviewPose(), Dz = ROOM.d / 2;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const keys = [
    { t: 0, pos: P(-6, 2.2, Dz + 24), target: P(0, 4.5, Dz) },
    { t: 2.6, pos: P(0, 1.7, Dz + 0.5), target: P(0, 1.8, 0) },
    { t: 4.0, pos: P(1.5, 1.75, Dz - 6), target: P(14, 1.4, Dz - 5) },
    { t: 5.6, pos: P(0, 1.8, Dz - 13), target: P(-26, 1.3, -14) },
    { t: 7.0, pos: P(0.5, 1.8, Dz - 16), target: P(4, 1.3, -18) },
    { t: 8.4, pos: P(2, 1.9, Dz - 17), target: P(32, 1.3, -6) },
    { t: 10.5, pos: o.pos, target: o.target },
  ];
  intro = {
    start: performance.now(), keys,
    pos: new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal'),
    tgt: new THREE.CatmullRomCurve3(keys.map((k) => k.target), false, 'centripetal'),
    cap: -1,
  };
  $('#caption').hidden = false;
}
function updateIntro(now) {
  const s = (now - intro.start) / 1000;
  const k = intro.keys, n = k.length - 1;
  const open = smooth(Math.min(1, Math.max(0, (s - 1.0) / 1.2)));
  for (const d of doors) { d.mesh.position.x = d.side * (1.5 + open * 2.9); d.handle.position.x = d.side * (0.25 + open * 2.9); }
  let i = 0;
  while (i < n - 1 && s > k[i + 1].t) i++;
  const local = Math.min(1, Math.max(0, (s - k[i].t) / (k[i + 1].t - k[i].t)));
  const seg = i === n - 1 ? ease(local) : i === 0 ? local * local * (2 - local) : local;
  const u = (i + seg) / n;
  camera.position.copy(intro.pos.getPoint(u));
  if (s < k[n - 1].t) camera.position.y += Math.sin(s * 8.5) * 0.03; // gentle walking bob
  controls.target.copy(intro.tgt.getPoint(u));
  camera.lookAt(controls.target);
  // fade sky to studio grey and drop the ceiling as we rise
  if (s > k[n - 1].t + 0.3 && ceiling.visible) { ceiling.visible = false; facade.visible = false; scene.background = studioBg; scene.fog.color.set(0x05070b); }
  let c = 0; while (c < CAPTIONS.length - 1 && s >= CAPTIONS[c + 1][0]) c++;
  if (c !== intro.cap) { intro.cap = c; const el = $('#caption'); el.textContent = CAPTIONS[c][1]; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  if (s >= k[n].t) finishIntro();
}
function finishIntro() {
  intro = null;
  if (facade) facade.visible = false;
  if (ceiling) ceiling.visible = false;
  if (scene) { scene.background = studioBg; scene.fog.color.set(0x05070b); scene.fog.near = 90; scene.fog.far = 200; }
  if (controls) controls.enabled = true;
  document.body.classList.remove('intro-on');
  $('#caption').hidden = true;
  $('#panel').hidden = false;
  $('#intro').classList.add('leaving');
  setTimeout(() => { $('#intro').hidden = true; }, 600);
  onResize();
  if (camera) { const o = overviewPose(); camera.position.copy(o.pos); controls.target.copy(o.target); }
  renderPain();
}

let lastDeclutter = 0;
function tick(now) {
  const t = now / 1000;
  if (intro) updateIntro(now);
  else if (flight) {
    const f = Math.min(1, (performance.now() - flight.start) / flight.ms);
    const e = ease(f);
    camera.position.lerpVectors(flight.from, flight.to, e);
    controls.target.lerpVectors(flight.tFrom, flight.tTo, e);
    if (f >= 1) flight = null;
  }
  for (const p of people) animate(p.rig, p.motion, t, { phase: p.phase, dy: p.dy });
  if (state.step === 3) {
    const pulse = 0.14 + 0.1 * Math.sin(now / 350), swaps = swapCounts();
    for (const [id, o] of stationObjects) if (swaps[id]) o.pad.material.opacity = pulse;
  }
  if (!intro) controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  if (now - lastDeclutter > 200) { lastDeclutter = now; declutterLabels(); }
}

// Hide labels that would overlap; selected/swap/hovered first, then nearer stations.
function declutterLabels() {
  const items = [...stationObjects.entries()].map(([id, o]) => {
    o.label.classList.remove('crowded');
    const r = o.label.getBoundingClientRect();
    const pri = hoverId === id ? 3 : o.label.classList.contains('selected') || o.label.classList.contains('has-swap') ? 2 : o.label.classList.contains('dim') ? -1 : 0;
    return { o, r, pri };
  }).filter((x) => x.r.width > 0);
  items.sort((a, b) => b.pri - a.pri || b.r.bottom - a.r.bottom);
  const shown = [];
  for (const it of items) {
    const hit = shown.some((s) => it.r.left < s.right + 4 && it.r.right > s.left - 4 && it.r.top < s.bottom + 2 && it.r.bottom > s.top - 2);
    if (hit && it.pri <= 0) it.o.label.classList.add('crowded'); else shown.push(it.r);
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
function setStep(n, flow = state.flow) {
  if (flow !== state.flow) { state.flow = flow; state.maxStep = n; }
  const F = FLOWS[state.flow];
  state.step = n;
  state.maxStep = Math.max(state.maxStep, n);
  state.guide = null;
  $('#stepText').innerHTML = `<span>Step ${n + 1} of ${F.steps.length}</span>${F.titles[n]}`;
  $('#navBack').disabled = n === 0 && !(state.flow === 'swap' && state.plan);
  $('#navRestart').disabled = state.flow === 'plan' && n === 0 && !state.injury;
  const nav = $('.progress');
  nav.style.gridTemplateColumns = `repeat(${F.steps.length}, 1fr)`;
  nav.innerHTML = F.steps.map((t, i) => `<button data-step="${i}">${t}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => goTo(+b.dataset.step)));
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
  if (state.flow === 'plan') return s === 0 || (s === 1 && state.painChosen) || (s === 2 && !!state.plan);
  if (s === 0) return true;
  if (s === 1) return !!state.station;
  if (s === 2) return !!state.exercise;
  return !!state.result;
}
function goTo(s) {
  if (state.flow === 'plan') return s === 0 ? renderPain() : s === 1 ? renderDays() : state.plan && renderPlan(false);
  if (s === 0) renderWelcome();
  else if (s === 1 && state.station) openStation(state.station.id);
  else if (s === 2 && state.exercise) renderHurt();
  else if (s === 3 && state.result) renderResults(false);
}
function goBack() {
  if (state.guide) { const back = state.guide.back; state.guide = null; return back === 'results' ? renderResults(false) : back === 'plan' ? renderPlan(false) : goTo(state.step); }
  if (state.flow === 'swap' && state.step === 0 && state.plan) { state.flow = 'plan'; return renderPlan(false); }
  if (state.step > 0) goTo(state.flow === 'swap' && state.step === 2 && !state.station ? 0 : state.step - 1);
}
function restart() {
  Object.assign(state, { station: null, exercise: null, injury: null, result: null, where: {}, maxStep: 0, guide: null, zone: 'All',
    flow: 'plan', painChosen: false, plan: null, planDay: 0 });
  renderPain();
}
function swapCounts() {
  const out = {};
  if (state.flow === 'plan') {
    if (state.step === 2 && state.plan && !state.guide) for (const it of state.plan.days[state.planDay].items) if (it.stationId) out[it.stationId] = (out[it.stationId] || 0) + 1;
    return out;
  }
  if (state.step !== 3 || !state.result) return out;
  for (const r of state.result.results) { const loc = state.where[r.id]; if (loc) out[loc.stationId] = (out[loc.stationId] || 0) + 1; }
  return out;
}
function onStationClick(id) {
  if (state.flow === 'plan' && state.step === 2) {
    const card = body.querySelector(`.card[data-station="${id}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); selectCard(card); }
    return;
  }
  if (state.flow === 'swap' && state.step === 3) {
    if (state.guide) return;
    const card = body.querySelector(`.card[data-station="${id}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); selectCard(card); }
    return;
  }
  openStation(id);
}

// Step 1: choose a machine
function renderWelcome() {
  setStep(0, 'swap');
  if (webglOk) state.zone === 'All' ? setOverview() : flyToZone(state.zone);
  const zones = ZONE_ORDER.filter((z) => state.stations.some((s) => s.zone === z));
  const shown = state.zone === 'All' ? zones : [state.zone];
  body.innerHTML = `
    ${webglOk ? '' : '<div class="fallback">3D isn\'t available on this device, but you can use the list below.</div>'}
    ${state.plan ? '<button class="link back-link" id="toPlan">‹ Back to your plan</button>' : ''}
    <h1>What were you about to use?</h1>
    <p class="lead">${webglOk ? 'Tap a machine in the gym or pick one below. Not sure? Search for the exercise.' : 'Pick the machine below, or search for the exercise.'}</p>
    <div class="search-wrap"><span aria-hidden="true">⌕</span><input class="search" id="q" placeholder="Search an exercise, e.g. squat" autocomplete="off" aria-label="Search exercises by name"></div>
    <div class="list suggest" id="suggest"></div>
    <div class="zone-chips" role="tablist" aria-label="Gym zones">
      <button class="zchip ${state.zone === 'All' ? 'on' : ''}" data-zone="All">All</button>
      ${zones.map((z) => `<button class="zchip ${state.zone === z ? 'on' : ''}" data-zone="${esc(z)}" style="--zc:${zoneOf(z).color}"><i></i>${esc(z === 'Core & Functional' ? 'Core' : z)}</button>`).join('')}
    </div>
    ${shown.map((z) => `
      <section class="zone" style="--zc:${zoneOf(z).color}">
        <h2><i></i>${esc(z)}<small>${esc(zoneOf(z).blurb)}</small></h2>
        <div class="list">${state.stations.filter((s) => s.zone === z).map((s) => `
          <button class="item station" data-station="${s.id}">
            <span><span class="t">${esc(s.name)}</span><small>${esc(s.description)}</small></span>
            <span class="n">${s.exerciseCount}<em>moves</em></span>
          </button>`).join('')}</div>
      </section>`).join('')}`;
  body.querySelectorAll('[data-station]').forEach((b) => {
    b.addEventListener('click', () => openStation(b.dataset.station));
    b.addEventListener('mouseenter', () => setHover(b.dataset.station));
    b.addEventListener('mouseleave', () => setHover(null));
  });
  body.querySelectorAll('[data-zone]').forEach((b) => b.addEventListener('click', () => { state.zone = b.dataset.zone; renderWelcome(); }));
  $('#toPlan')?.addEventListener('click', () => { state.flow = 'plan'; renderPlan(false); });
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
  setStep(1, 'swap');
  if (webglOk) flyToStation(id);
  const head = `<div class="eyebrow-zone" style="--zc:${zoneOf(st.zone).color}"><i></i>${esc(st.zone)}</div><h1>${esc(st.name)}</h1>`;
  body.innerHTML = `${head}<p class="lead">${esc(st.description)}</p><p class="loading">Loading exercises…</p>`;
  try {
    const r = await api(`/api/gym/stations/${encodeURIComponent(id)}/exercises`);
    if (state.station?.id !== id || state.step !== 1) return;
    const groups = {};
    for (const ex of r.exercises) (groups[MUSCLE_GROUP[ex.primaryMuscles[0]] || 'Other'] ||= []).push(ex);
    body.innerHTML = `
      ${head}
      <p class="lead">Which exercise were you going to do here? Tap <b>▶</b> to watch how it's done.</p>
      ${r.exercises.length > 10 ? '<div class="search-wrap"><span aria-hidden="true">⌕</span><input class="search" id="filter" placeholder="Filter this list" autocomplete="off" aria-label="Filter exercises"></div>' : ''}
      <div id="exList">
      ${GROUP_ORDER.filter((g) => groups[g]).map((g) => `
        <section data-group>
          <h2>${g}</h2>
          <div class="list">${groups[g].map((ex) => `
            <div class="item ex" data-name="${esc(ex.name.toLowerCase())}">
              <button class="ex-pick" data-ex="${esc(ex.id)}"><span class="t">${esc(ex.name)}</span><small>Works ${ex.primaryMuscles.map(plain).join(', ')}</small></button>
              <button class="play" data-demo="${esc(ex.id)}" aria-label="Watch how to do ${esc(ex.name)}" title="Watch how it's done">▶</button>
            </div>`).join('')}</div>
        </section>`).join('')}
      </div>`;
    body.querySelectorAll('[data-ex]').forEach((b) =>
      b.addEventListener('click', () => { state.exercise = r.exercises.find((x) => x.id === b.dataset.ex); state.result = null; state.maxStep = 2; renderHurt(); }));
    body.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => openGuide(b.dataset.demo, 'exercise')));
    const f = $('#filter');
    if (f) f.addEventListener('input', () => {
      const q = f.value.trim().toLowerCase();
      body.querySelectorAll('.item.ex').forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); });
      body.querySelectorAll('[data-group]').forEach((s) => { s.hidden = ![...s.querySelectorAll('.item.ex')].some((b) => !b.hidden); });
    });
  } catch (err) { body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`); }
}

// Step 3: what hurts
const SPOTS = {
  'Neck': [[100, 58]], 'Shoulder': [[68, 76], [132, 76]], 'Elbow': [[52, 128], [148, 128]], 'Wrist': [[44, 170], [156, 170]],
  'Fingers': [[40, 192], [160, 192]], 'Lower back': [[100, 140]], 'Hip': [[80, 168], [120, 168]], 'Groin': [[100, 182]],
  'Back of thigh': [[84, 210], [116, 210]], 'Knee': [[85, 245], [115, 245]], 'Ankle': [[87, 300], [113, 300]],
};
function bodySvg() {
  const spots = Object.entries(SPOTS).flatMap(([area, pts]) =>
    pts.map(([x, y]) => `<circle class="spot" data-area="${area}" cx="${x}" cy="${y}" r="9"><title>${area}</title></circle>`)).join('');
  return `<svg class="body-svg" viewBox="0 0 200 320" role="img" aria-label="Body diagram: tap where it hurts">
    <circle class="shape" cx="100" cy="30" r="20"/><rect class="shape" x="92" y="48" width="16" height="14" rx="4"/>
    <rect class="shape" x="66" y="64" width="68" height="110" rx="26"/>
    <rect class="shape" x="44" y="70" width="18" height="118" rx="9" transform="rotate(6 53 70)"/>
    <rect class="shape" x="138" y="70" width="18" height="118" rx="9" transform="rotate(-6 147 70)"/>
    <rect class="shape" x="74" y="160" width="22" height="148" rx="11"/><rect class="shape" x="104" y="160" width="22" height="148" rx="11"/>
    ${spots}</svg>`;
}
function renderHurt() {
  setStep(2, 'swap');
  const ex = state.exercise;
  const areas = [...new Set(state.injuries.map((i) => i.area))];
  body.innerHTML = `
    <h1>Where does it hurt?</h1>
    <div class="picked"><span>You picked</span><b>${esc(ex.name)}</b><button class="link" id="demoPicked">▶ How it's done</button></div>
    <div class="hurt-grid">
      <div class="body-wrap">${bodySvg()}</div>
      <div><p class="lead" style="margin:0 0 10px">Tap the spot on the body, or choose:</p>
        <div class="chips">${areas.map((a) => `<button class="chip" data-area="${esc(a)}">${esc(a)}</button>`).join('')}</div></div>
    </div>
    <div class="options" id="opts"></div>
    <button class="btn-primary" id="find" disabled>Find a safe swap</button>`;
  body.querySelectorAll('[data-area]').forEach((el) => el.addEventListener('click', () => chooseArea(el.dataset.area)));
  $('#find').addEventListener('click', findSwaps);
  $('#demoPicked').addEventListener('click', () => openGuide(ex.id, 'hurt'));
  const prev = state.injuries.find((i) => i.tag === state.injury);
  if (prev) chooseArea(prev.area, prev.tag);
}
function chooseArea(area, keepTag) {
  body.querySelectorAll('[data-area]').forEach((el) => el.classList.toggle('on', el.dataset.area === area));
  const options = state.injuries.filter((i) => i.area === area);
  state.injury = keepTag || (options.length === 1 ? options[0].tag : null);
  $('#opts').innerHTML = `${options.length > 1 ? '<p class="lead" style="margin:0 0 8px">Which one sounds like you?</p>' : ''}` + options.map((i) => `
    <button class="option ${state.injury === i.tag ? 'on' : ''}" data-tag="${esc(i.tag)}">${esc(i.hint)}<small>${esc(i.name)}</small></button>`).join('');
  $('#opts').querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    state.injury = b.dataset.tag;
    $('#opts').querySelectorAll('.option').forEach((o) => o.classList.toggle('on', o === b));
    $('#find').disabled = false;
  }));
  $('#find').disabled = !state.injury;
}

// ---------- Plan flow: pain check -> days -> safe weekly plan (POST /api/plans) ----------
function renderPain() {
  setStep(0, 'plan');
  if (webglOk) setOverview();
  const areas = [...new Set(state.injuries.map((i) => i.area))];
  body.innerHTML = `
    <h1>Before we start: does anything hurt?</h1>
    <p class="lead">Tap where you feel pain: a muscle, a joint, or around a bone. We'll build your week around it and leave out anything that could make it worse.</p>
    <div class="hurt-grid">
      <div class="body-wrap">${bodySvg()}</div>
      <div><p class="lead" style="margin:0 0 10px">Or choose an area:</p>
        <div class="chips">${areas.map((a) => `<button class="chip" data-area="${esc(a)}">${esc(a)}</button>`).join('')}</div></div>
    </div>
    <div class="options" id="opts"></div>
    <button class="btn-primary" id="find" disabled>Continue</button>
    <button class="btn-secondary" id="noPain">Nothing hurts. Build me a normal plan</button>
    <div class="or-swap"><span>Already at a machine?</span><button class="link" id="toSwap">Swap one exercise instead ›</button></div>`;
  body.querySelectorAll('[data-area]').forEach((el) => el.addEventListener('click', () => chooseArea(el.dataset.area)));
  $('#find').addEventListener('click', () => { state.painChosen = true; renderDays(); });
  $('#noPain').addEventListener('click', () => { state.injury = null; state.painChosen = true; renderDays(); });
  $('#toSwap').addEventListener('click', () => renderWelcome());
  const prev = state.injuries.find((i) => i.tag === state.injury);
  if (prev) chooseArea(prev.area, prev.tag);
}

const DAY_OPTIONS = [
  { n: 2, split: 'Upper body · Lower body & core', when: 'Mon · Thu', who: 'Busy week, or brand new to training' },
  { n: 3, split: 'Push · Pull · Legs', when: 'Mon · Wed · Fri', who: 'The classic beginner split' },
  { n: 4, split: 'Push · Pull · Legs · Arms & core', when: 'Mon · Tue · Thu · Fri', who: 'You want a bit more volume' },
];
function renderDays() {
  setStep(1, 'plan');
  const injury = state.injuries.find((i) => i.tag === state.injury);
  body.innerHTML = `
    <div class="picked"><span>Pain</span><b>${injury ? esc(injury.hint) : 'None. Full plan'}</b><button class="link" id="chg">Change</button></div>
    <h1 style="margin-top:14px">How many days a week can you train?</h1>
    <p class="lead">Each session takes about 45 minutes, including a warm-up.</p>
    <div class="list">${DAY_OPTIONS.map((o) => `
      <button class="option day-opt ${state.planDays === o.n ? 'on' : ''}" data-days="${o.n}">
        <span class="big">${o.n} days</span> ${esc(o.split)}<small>${esc(o.when)} · ${esc(o.who)}</small>
      </button>`).join('')}</div>
    <button class="btn-primary" id="build" style="margin-top:6px">Build my plan</button>`;
  $('#chg').addEventListener('click', renderPain);
  body.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    state.planDays = +b.dataset.days;
    body.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#build').addEventListener('click', buildPlan);
}
async function buildPlan() {
  const btn = $('#build');
  btn.disabled = true; btn.textContent = 'Building a safe plan…';
  try {
    state.plan = await api('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injuryTag: state.injury || 'none', daysPerWeek: state.planDays }) });
    state.planDay = 0;
    renderPlan(true);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Build my plan';
    body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`);
  }
}
function renderPlan(fly) {
  const p = state.plan;
  setStep(2, 'plan');
  const day = p.days[state.planDay];
  const cards = day.items.map((it, i) => `
    <div class="card" data-station="${esc(it.stationId || '')}" style="--zc:${zoneOf(it.zone).color}">
      <div class="top"><span class="rank">${it.role === 'Warm-up' ? '↻' : i}</span><span class="name">${esc(it.name)}</span></div>
      <div class="dose">${it.role === 'Warm-up' ? '<b>Warm-up</b> · ' : ''}${esc(it.dose)}</div>
      <div class="row">Works <b>${it.primaryMuscles.map(plain).join(', ')}</b></div>
      ${it.stationName ? `<div class="row where"><i></i>${esc(it.stationName)} · ${esc(it.zone)}</div>` : ''}
      <div class="row why">${esc(it.why)}</div>
      ${p.injuryTag ? `<div class="safe">✓ ${esc(SAFETY_PLAIN[it.safetyMethod] || 'Safe for your injury')}</div>` : ''}
      <div class="actions">
        <button class="btn-small primary" data-guide="${esc(it.id)}">▶ How to do it</button>
        ${it.stationId && webglOk ? '<button class="btn-small go">Show me where</button>' : ''}
      </div>
    </div>`).join('');
  const s = p.stats;
  body.innerHTML = `
    <h1>Your ${p.daysPerWeek}-day safe plan</h1>
    <div class="plan-sum">
      <span class="tag ${p.injuryTag ? 'warn' : 'soft'}">${p.injuryTag ? `Around: ${esc(p.injuryName)}` : 'No pain reported'}</span>
      <span class="tag soft">${p.schedule.map(esc).join(' · ')}</span>
    </div>
    <div class="day-tabs" role="tablist">${p.days.map((d, i) => `
      <button role="tab" class="day-tab ${i === state.planDay ? 'on' : ''}" data-day="${i}"><small>${esc(p.schedule[i])}</small>${esc(d.title)}</button>`).join('')}</div>
    <p class="lead" style="margin:10px 0 12px">Day ${day.day}: <b>${esc(day.focus)}</b>. The highlighted machines in the gym are today's stations.</p>
    ${cards}
    ${p.avoid.length ? `<div class="avoid-box"><h3>✕ Avoid for now</h3><ul>${p.avoid.map((a) => `<li><b>${esc(a.name)}</b>${esc(a.reason)}</li>`).join('')}</ul></div>` : ''}
    <div class="breath"><b>How to progress safely</b><ul class="tips">${p.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <details class="how">
      <summary>How we built this plan</summary>
      <ol>
        <li><b>Screened all ${s.candidatesScreened} exercises</b> for your pain${p.injuryTag ? '' : ' (none reported, so all are allowed)'}.</li>
        ${p.injuryTag ? `<li><b>Bloom filter</b> cleared ${s.bloomNegatives} instantly and flagged ${s.bloomPositives} as "maybe unsafe".</li>
        <li><b>Every "maybe" was re-checked</b> with the exact injury rules: ${s.confirmedUnsafe} really unsafe, ${s.falsePositivesCleared} false alarm${s.falsePositivesCleared === 1 ? '' : 's'} cleared.</li>` : ''}
        <li><b>Picked one safe exercise per muscle</b>, preferring guided machines and cables, which are easiest to learn.</li>
        <li><b>Found each machine</b> with the station tries and <b>chose each demo</b> with KMP keyword matching (${s.elapsedMicros.toLocaleString()} µs on the server).</li>
      </ol>
    </details>
    <button class="restart-big" id="redo">Change pain or days</button>
    <div class="or-swap"><span>Want something different?</span><button class="link" id="toSwap">Swap one exercise at a machine ›</button></div>`;
  body.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { state.planDay = +b.dataset.day; renderPlan(true); }));
  body.querySelectorAll('.card').forEach((card) => card.addEventListener('click', (e) => { if (!e.target.closest('[data-guide]')) selectCard(card); }));
  body.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openGuide(b.dataset.guide, 'plan'); }));
  $('#redo').addEventListener('click', renderPain);
  $('#toSwap').addEventListener('click', () => renderWelcome());
  refreshHighlights();
  if (fly && webglOk) setOverview();
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
    state.result = r; state.maxStep = 3;
    renderResults(true);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Find a safe swap';
    body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`);
  }
}

const reasonText = (r) => r.replace(/^[a-z]+ '[^']+': /, '');
const SAFETY_PLAIN = { BLOOM_NEGATIVE: 'Safe for your injury', BLOOM_POSITIVE_RULE_CLEARED: 'Safe for your injury (double-checked)' };
function selectCard(card) {
  body.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c === card));
  if (card.dataset.station && webglOk) flyToStation(card.dataset.station);
}
function renderResults(fly) {
  const r = state.result;
  setStep(3, 'swap');
  const injury = state.injuries.find((i) => i.tag === state.injury);
  const area = injury.area.toLowerCase();
  const noSwap = r.status === 'NO_SAFE_SUBSTITUTE';
  const verdict = r.target.unsafeForInjury
    ? `<div class="verdict skip"><strong>Skip ${esc(r.target.name)} for now</strong>${esc(reasonText(r.target.unsafeReasons[0]))}</div>`
    : `<div class="verdict ok"><strong>${esc(r.target.name)} is OK for your ${esc(area)}</strong>It's not on the avoid list. <button class="link" data-guide="${esc(r.target.id)}">▶ Check your form</button> If it still hurts, try one of these instead.</div>`;
  const cards = r.results.map((c) => {
    const loc = state.where[c.id];
    const st = loc && state.stations.find((s) => s.id === loc.stationId);
    return `
      <div class="card" data-station="${loc ? esc(loc.stationId) : ''}" style="--zc:${zoneOf(st?.zone).color}">
        <div class="top"><span class="rank">${c.rank}</span><span class="name">${esc(c.name)}</span></div>
        <div class="row">Works <b>${c.primaryMuscles.map(plain).join(', ')}</b></div>
        ${loc ? `<div class="row where"><i></i>${esc(loc.stationName)} · ${esc(loc.zone)}</div>` : ''}
        <div class="safe">✓ ${esc(SAFETY_PLAIN[c.safetyMethod] || 'Safe for your injury')}</div>
        <div class="actions">
          <button class="btn-small primary" data-guide="${esc(c.id)}">▶ How to do it</button>
          ${loc && webglOk ? '<button class="btn-small go">Show me where</button>' : ''}
        </div>
      </div>`;
  }).join('');
  const p = r.pipeline;
  const avoid = r.rejected.filter((x) => x.stage === 'SAFETY');
  body.innerHTML = `
    <h1>${noSwap ? 'No safe swap found' : 'Do this instead'}</h1>
    <p class="lead">For your ${esc(area)}: ${esc(injury.guidance)}</p>
    ${verdict}
    ${noSwap ? `<div class="error">${esc(r.message)} A physiotherapist can suggest a modified version.</div>` : cards}
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
  body.querySelectorAll('.card').forEach((card) => card.addEventListener('click', (e) => { if (!e.target.closest('[data-guide]')) selectCard(card); }));
  body.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openGuide(b.dataset.guide, 'results'); }));
  $('#again').addEventListener('click', restart);
  if (fly && webglOk) setOverview();
}

// ---------- Form guide: 3D coach + steps (data from GET /api/exercises/{id}/guide) ----------
let coach = null;
async function openGuide(id, back) {
  const prevHtml = body.innerHTML, prevStep = state.step;
  body.innerHTML = '<p class="loading">Loading the coach…</p>';
  let g;
  try { g = await api(`/api/exercises/${encodeURIComponent(id)}/guide`); } catch (err) {
    body.innerHTML = prevHtml; body.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`); return;
  }
  state.guide = { data: g, back };
  $('#navBack').disabled = false;
  $('#stepText').innerHTML = `<span>Step ${prevStep + 1} of ${FLOWS[state.flow].steps.length}</span>How to do it`;
  refreshHighlights();
  const injury = state.injuries.find((i) => i.tag === state.injury);
  const loc = (await api(`/api/gym/locate?ids=${encodeURIComponent(g.id)}`).catch(() => ({})))[g.id];
  body.innerHTML = `
    <button class="link back-link" id="guideBack">‹ Back to ${back === 'results' ? 'your swaps' : back === 'plan' ? 'your plan' : back === 'hurt' ? '“Where does it hurt?”' : 'the exercise list'}</button>
    <h1>${esc(g.name)}</h1>
    <div class="tags">
      <span class="tag">${esc(g.motionLabel)}</span>
      ${g.primaryMuscles.map((m) => `<span class="tag soft">${esc(plain(m))}</span>`).join('')}
      ${loc ? `<span class="tag soft">📍 ${esc(loc.stationName)}</span>` : ''}
    </div>
    <div class="coach" id="coachBox">
      <div class="coach-stage" id="coachStage">${webglOk ? '<span class="coach-hint">Drag to turn</span>' : '<p class="empty" style="padding:20px">3D demo not available on this device.</p>'}</div>
      <div class="coach-ctrl">
        <button id="cPlay" aria-label="Pause">❚❚</button>
        <button id="cSlow" aria-pressed="false">Slow-mo</button>
        <span class="sep"></span>
        <button data-view="auto" class="on">360°</button><button data-view="front">Front</button><button data-view="side">Side</button>
      </div>
    </div>
    <div class="pills"><span class="pill"><b>Tempo</b>${esc(g.tempo)}</span><span class="pill"><b>Beginner</b>${esc(g.beginnerDose)}</span></div>
    <h2>Step by step</h2>
    <ol class="steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="do-dont">
      <div class="do"><h3>✓ Do</h3><ul>${g.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
      <div class="dont"><h3>✕ Avoid</h3><ul>${g.mistakes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
    </div>
    <div class="breath"><b>Breathing</b>${esc(g.breathing)}</div>
    ${injury && (state.flow === 'plan' || state.step >= 2) ? `<div class="injury-note"><b>With your ${esc(injury.area.toLowerCase())}</b>${esc(injury.guidance)} Stop if the pain is sharp or above 3 out of 10.</div>` : ''}
    ${loc && webglOk ? '<button class="btn-small go wide" id="guideWhere">📍 Show me where in the gym</button>' : ''}
    <p class="fine">Demo picked on the server by ${esc(g.matchedBy)}. ${esc(g.note)}</p>`;
  body.scrollTop = 0;
  $('#guideBack').addEventListener('click', goBack);
  if (loc && webglOk) { flyToStation(loc.stationId); $('#guideWhere').addEventListener('click', () => flyToStation(loc.stationId)); }
  if (webglOk) {
    coach ||= createCoach();
    if (coach) {
      $('#coachStage').prepend(coach.canvas);
      coach.show(g.motion, g.equipment); coach.setPaused(false); coach.setSpeed(1);
      $('#cPlay').addEventListener('click', (e) => { coach.setPaused(!coach.paused); e.target.textContent = coach.paused ? '▶' : '❚❚'; e.target.setAttribute('aria-label', coach.paused ? 'Play' : 'Pause'); });
      $('#cSlow').addEventListener('click', (e) => { const on = e.target.getAttribute('aria-pressed') !== 'true'; e.target.setAttribute('aria-pressed', on); e.target.classList.toggle('on', on); coach.setSpeed(on ? 0.4 : 1); });
      body.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
        body.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b)); coach.setView(b.dataset.view);
      }));
    }
  }
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
$('#navBack').addEventListener('click', goBack);
$('#navRestart').addEventListener('click', restart);

(async function boot() {
  initScene();
  const enter = $('#enter');
  enter.disabled = true; enter.textContent = 'Unlocking the doors…';
  try {
    [state.stations, state.injuries] = await Promise.all([api('/api/gym/stations'), api('/api/injuries')]);
    if (webglOk) buildStations();
    $('#introStats').textContent = `${state.stations.length} machines · ${state.stations.reduce((a, s) => a + s.exerciseCount, 0)} exercises · 6 zones`;
    enter.disabled = false; enter.textContent = 'Walk in';
  } catch (err) {
    $('#introText').innerHTML = `<span style="color:var(--warn)">${esc(err.message)}</span>`;
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

// Debug hook for visual QA: ?debug lets the console open any guide directly.
if (new URLSearchParams(location.search).has('debug')) window.safeswap = { openGuide, state };
