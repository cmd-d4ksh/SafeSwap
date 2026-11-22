// SafeSwap Gym: a 3D gym you walk around to pick a machine, then report what hurts.
// This file only draws the scene and renders API responses. All search, safety
// checking and ranking happen in the Java backend.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const API = new URLSearchParams(location.search).get('api') || 'http://localhost:8085';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = $('#panel');

async function api(path, options) {
  let res;
  try {
    res = await fetch(API + path, options);
  } catch {
    throw new Error(`Can't reach the server at ${API}. Start the backend with "mvn spring-boot:run" in the backend folder.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.message || `Request failed (${res.status})`);
    e.hints = body.hints || [];
    throw e;
  }
  return body;
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const state = {
  step: 0,
  stations: [],          // from /api/gym/stations
  injuries: [],          // from /api/injuries
  station: null,         // selected station summary
  exercise: null,        // selected exercise {id, name, ...}
  area: null,            // selected body area label
  injury: null,          // selected injury tag
  result: null,          // last substitution response
};

// Station placement in the 3D room (layout only).
const PLACES = {
  rack:        { x: -11, z: -7,  rot: 0 },
  dumbbells:   { x: -3.5, z: -9, rot: 0 },
  cables:      { x: 4,   z: -9,  rot: 0 },
  machines:    { x: 11.5, z: -6.5, rot: -0.35 },
  kettlebells: { x: -12, z: 3.5, rot: 0.3 },
  pullup:      { x: 12,  z: 3.5, rot: -0.3 },
  floor:       { x: -4,  z: 5,   rot: 0 },
  turf:        { x: 4.5, z: 5.5, rot: 0 },
};

// Muscle → plain body-area grouping for the exercise list (presentation only).
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
const nice = (m) => m.replace(/-/g, ' ');

// ------------------------------------------------------------------
// 3D scene
// ------------------------------------------------------------------
const container = $('#scene');
let renderer, labelRenderer, scene, camera, controls;
const stationObjects = new Map(); // id -> {group, pad, label}
let webglOk = true;

function initScene() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    webglOk = false;
    return;
  }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  const bg = dark ? 0x15171a : 0xeef0f2;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 38, 70);

  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  applyViewOffset();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 42;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.enablePan = false;
  setOverview(true);

  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222428 : 0xb8bcc2, dark ? 1.1 : 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.3 : 1.8);
  sun.position.set(-10, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 18, bottom: -18, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  buildRoom(dark);
  addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.setAnimationLoop(tick);
}

// ---------- geometry helpers ----------
const mats = {};
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, ...opts });
  return mats[key];
}
function box(g, w, h, d, color, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m;
}
function cyl(g, r, len, color, x, y, z, axis = 'y') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), mat(color));
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true; g.add(m); return m;
}
function ball(g, r, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), mat(color));
  m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
}

const C = {
  steel: 0x3a3f46, dark: 0x22262b, light: 0xb9bec5, pad: 0x2b2f35,
  plate: 0x1c1f23, accent: 0xff5a36, wood: 0xc9a37a, mat: 0x4b5563,
  blue: 0x4a7bd1, green: 0x5aa469, yellow: 0xe5b94e, turf: 0x4f8a4f,
};

function barbell(g, x, y, z, len = 2.2) {
  cyl(g, 0.03, len, C.light, x, y, z, 'x');
  for (const s of [-1, 1]) {
    cyl(g, 0.32, 0.07, C.plate, x + s * (len / 2 - 0.25), y, z, 'x');
    cyl(g, 0.24, 0.06, C.plate, x + s * (len / 2 - 0.33), y, z, 'x');
  }
}
function dumbbell(g, x, y, z, s = 1) {
  cyl(g, 0.025 * s, 0.32 * s, C.light, x, y, z, 'x');
  cyl(g, 0.07 * s, 0.09 * s, C.plate, x - 0.17 * s, y, z, 'x');
  cyl(g, 0.07 * s, 0.09 * s, C.plate, x + 0.17 * s, y, z, 'x');
}
function bench(g, x, z, ry = 0, incline = 0) {
  const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = ry; g.add(b);
  box(b, 0.3, 0.4, 1.1, C.steel, 0, 0.2, 0);
  const seat = box(b, 0.38, 0.1, 1.25, C.pad, 0, 0.45, 0);
  seat.rotation.x = -incline;
}
function kettlebell(g, x, z, color, s = 1) {
  ball(g, 0.16 * s, color, x, 0.16 * s, z);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.1 * s, 0.025 * s, 10, 24, Math.PI), mat(color));
  h.position.set(x, 0.28 * s, z); h.castShadow = true; g.add(h);
}

// ---------- station models ----------
const BUILDERS = {
  rack(g) {
    for (const [x, z] of [[-0.9, -0.6], [0.9, -0.6], [-0.9, 0.6], [0.9, 0.6]]) box(g, 0.1, 2.6, 0.1, C.steel, x, 1.3, z);
    box(g, 1.9, 0.1, 0.1, C.steel, 0, 2.55, -0.6); box(g, 1.9, 0.1, 0.1, C.steel, 0, 2.55, 0.6);
    box(g, 0.1, 0.1, 1.3, C.steel, -0.9, 2.55, 0); box(g, 0.1, 0.1, 1.3, C.steel, 0.9, 2.55, 0);
    box(g, 2.2, 0.04, 1.8, C.wood, 0, 0.02, 0);
    barbell(g, 0, 1.45, -0.6, 2.4);
    barbell(g, 0, 0.32, 1.7, 2.2);
    bench(g, 0, 2.6, Math.PI / 2);
  },
  dumbbells(g) {
    for (const x of [-1.6, 1.6]) { box(g, 0.08, 0.9, 0.08, C.steel, x, 0.45, -0.2); box(g, 0.08, 0.9, 0.08, C.steel, x, 0.45, 0.2); }
    box(g, 3.4, 0.06, 0.5, C.steel, 0, 0.5, 0); box(g, 3.4, 0.06, 0.4, C.steel, 0, 0.85, -0.05);
    for (let i = 0; i < 7; i++) {
      const x = -1.35 + i * 0.45, s = 0.8 + i * 0.12;
      dumbbell(g, x, 0.58 + 0.07 * s, 0.08, s);
      dumbbell(g, x, 0.92 + 0.05 * s, -0.05, s * 0.7);
    }
    bench(g, 0, 1.8, Math.PI / 2, 0.35);
  },
  cables(g) {
    for (const x of [-1.5, 1.5]) {
      box(g, 0.14, 3, 0.14, C.steel, x, 1.5, 0);
      box(g, 0.45, 1.3, 0.3, C.dark, x, 0.7, -0.35);
      ball(g, 0.09, C.accent, x, 2.2, 0.12);
      cyl(g, 0.008, 1.4, C.light, x, 1.5, 0.12);
    }
    box(g, 3.2, 0.14, 0.14, C.steel, 0, 3, 0);
    box(g, 3.4, 0.05, 1.2, C.wood, 0, 0.025, 0);
  },
  machines(g) {
    // leg press
    box(g, 0.9, 0.2, 2.2, C.steel, -0.9, 0.1, 0);
    const seat = box(g, 0.7, 0.12, 0.9, C.pad, -0.9, 0.6, 0.55); seat.rotation.x = 0.6;
    const sled = box(g, 0.8, 0.8, 0.08, C.dark, -0.9, 0.9, -0.7); sled.rotation.x = -0.5;
    box(g, 0.08, 1.4, 0.08, C.steel, -0.55, 0.7, -0.9); box(g, 0.08, 1.4, 0.08, C.steel, -1.25, 0.7, -0.9);
    // chest press
    box(g, 0.5, 0.5, 0.5, C.steel, 1.0, 0.25, 0.3);
    box(g, 0.55, 0.1, 0.5, C.pad, 1.0, 0.55, 0.3);
    box(g, 0.55, 0.8, 0.1, C.pad, 1.0, 1.0, 0.6);
    box(g, 0.12, 2.0, 0.12, C.steel, 1.0, 1.0, -0.4);
    box(g, 0.5, 0.9, 0.25, C.dark, 1.0, 0.5, -0.65);
    cyl(g, 0.03, 1.1, C.light, 1.0, 1.15, 0.0, 'x');
  },
  kettlebells(g) {
    box(g, 2.6, 0.06, 0.6, C.steel, 0, 0.3, 0);
    for (const x of [-1.2, 1.2]) box(g, 0.06, 0.3, 0.5, C.steel, x, 0.15, 0);
    const colors = [C.blue, C.yellow, C.green, C.accent, C.dark];
    colors.forEach((c, i) => kettlebell(g, -1 + i * 0.5, 0, c, 0.8 + i * 0.12));
    g.children.slice(-colors.length * 2).forEach((m) => { m.position.y += 0.33; });
    ball(g, 0.22, 0x7a5c3e, -0.6, 0.22, 0.9); ball(g, 0.26, 0x8b6a47, 0.1, 0.26, 1.0); ball(g, 0.2, 0x6e5235, 0.75, 0.2, 0.85);
  },
  pullup(g) {
    for (const x of [-0.9, 0.9]) box(g, 0.12, 2.8, 0.12, C.steel, x, 1.4, 0);
    cyl(g, 0.035, 2.0, C.light, 0, 2.6, 0, 'x');
    box(g, 2.0, 0.1, 1.2, C.steel, 0, 0.05, 0.2);
    for (const x of [-0.3, 0.3]) cyl(g, 0.035, 0.9, C.light, x, 1.25, 0.55, 'z');
    box(g, 0.1, 1.2, 0.1, C.steel, -0.3, 0.6, 0.95); box(g, 0.1, 1.2, 0.1, C.steel, 0.3, 0.6, 0.95);
  },
  floor(g) {
    const mats_ = [[-1.2, C.mat], [0, 0x5b6573], [1.2, C.mat]];
    for (const [x, c] of mats_) box(g, 0.9, 0.04, 2.0, c, x, 0.02, 0);
    ball(g, 0.38, C.blue, 1.9, 0.38, -0.6);
    box(g, 0.6, 0.6, 0.6, C.wood, -2.0, 0.3, -0.5);
    box(g, 0.5, 0.45, 0.5, C.wood, -2.0, 0.22, 0.4);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 30), mat(C.green));
    band.rotation.x = Math.PI / 2; band.position.set(0, 0.06, 0.5); g.add(band);
  },
  turf(g) {
    box(g, 1.4, 0.03, 4.0, C.turf, -0.8, 0.015, 0);
    box(g, 0.8, 0.15, 0.9, C.dark, -0.8, 0.1, 0.9);
    for (const x of [-1.05, -0.55]) box(g, 0.08, 1.0, 0.08, C.steel, x, 0.65, 1.25);
    cyl(g, 0.3, 0.08, C.plate, -0.8, 0.3, 0.9);
    const lm = cyl(g, 0.03, 2.0, C.light, 1.0, 0.45, 0.2); lm.rotation.x = 1.15;
    cyl(g, 0.3, 0.07, C.plate, 1.0, 0.85, -0.6, 'z');
    // bike
    box(g, 0.25, 0.7, 0.9, C.dark, 1.3, 0.35, 1.5);
    box(g, 0.3, 0.08, 0.35, C.pad, 1.3, 0.9, 1.75);
    cyl(g, 0.03, 0.5, C.light, 1.3, 1.0, 1.2, 'x');
  },
};

function buildRoom(dark) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(46, 34), mat(dark ? 0x1f2226 : 0xdfe2e6, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(46, 23, dark ? 0x2a2e33 : 0xd2d6db, dark ? 0x2a2e33 : 0xd2d6db);
  grid.position.y = 0.005; scene.add(grid);
  const wallMat = mat(dark ? 0x1b1e22 : 0xf4f5f7, { roughness: 1 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(46, 6, 0.3), wallMat); back.position.set(0, 3, -17); back.receiveShadow = true; scene.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 34), wallMat); left.position.set(-23, 3, 0); left.receiveShadow = true; scene.add(left);
  // accent stripe + mirror strip on the back wall
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(46, 0.12, 0.05), mat(C.accent)); stripe.position.set(0, 2.2, -16.82); scene.add(stripe);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(20, 2.2, 0.05), mat(dark ? 0x2b3138 : 0xcfd8e0, { metalness: 0.6, roughness: 0.15 }));
  mirror.position.set(0, 3.8, -16.82); scene.add(mirror);
}

function buildStations() {
  for (const st of state.stations) {
    const p = PLACES[st.id] || { x: 0, z: 0, rot: 0 };
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.rot;
    group.scale.setScalar(1.6);
    group.userData.stationId = st.id;
    (BUILDERS[st.id] || BUILDERS.floor)(group);

    const pad = new THREE.Mesh(new THREE.CircleGeometry(3.1, 48),
      new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.01; pad.userData.stationId = st.id;
    group.add(pad);

    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `${esc(st.name)}<span class="badge"></span>`;
    el.addEventListener('click', () => selectStation(st.id));
    el.addEventListener('pointerenter', () => setHover(st.id));
    el.addEventListener('pointerleave', () => setHover(null));
    const label = new CSS2DObject(el);
    label.position.set(0, 2.6, 0);
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
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...stationObjects.values()].map((s) => s.group), true);
  return hits.length ? hits[0].object.userData.stationId : null;
}
function onPointerMove(e) {
  const id = pick(e);
  setHover(id);
  const tip = $('#hoverTip');
  if (id && state.step <= 1) {
    const st = state.stations.find((s) => s.id === id);
    tip.textContent = `${st.name} · ${st.exerciseCount} exercises`;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
    tip.hidden = false;
  } else tip.hidden = true;
}
function onPointerUp(e) {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // was a drag
  const id = pick(e);
  if (id) selectStation(id);
}
function setHover(id) {
  if (hoverId === id) return;
  hoverId = id;
  renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
  refreshHighlights();
}

function refreshHighlights() {
  const swaps = swapCounts();
  for (const [id, o] of stationObjects) {
    const selected = state.station?.id === id && state.step < 3;
    const isSwap = swaps[id] > 0;
    o.pad.material.opacity = selected ? 0.22 : isSwap ? 0.16 : hoverId === id ? 0.12 : 0;
    o.label.classList.toggle('selected', selected);
    o.label.classList.toggle('hover', hoverId === id);
    o.label.classList.toggle('has-swap', isSwap);
    o.label.classList.toggle('dim', state.step === 3 && !isSwap);
    o.label.querySelector('.badge').textContent = isSwap ? `${swaps[id]} swap${swaps[id] > 1 ? 's' : ''}` : '';
  }
}

// ---------- camera ----------
let flight = null;
function setOverview(instant = false) {
  const narrow = innerWidth < 760;
  // back the camera off when the free (non-panel) area is narrow, so the whole room fits
  const freeW = narrow ? innerWidth : innerWidth - Math.min(400, innerWidth * 0.45);
  const k = Math.min(1.9, Math.max(1, 1050 / freeW));
  const pos = narrow ? new THREE.Vector3(0, 30, 24).multiplyScalar(k * 0.8) : new THREE.Vector3(0, 20, 21).multiplyScalar(k);
  const target = narrow ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(-1.5, 0, -1.5);
  pos.x += target.x;
  if (instant) { camera.position.copy(pos); controls.target.copy(target); controls.update(); }
  else flyTo(pos, target);
}
function flyToStation(id) {
  const p = PLACES[id]; if (!p) return;
  const target = new THREE.Vector3(p.x, 1, p.z);
  const narrow = innerWidth < 760;
  // approach from the room centre, shifted so the station sits left of the side panel
  const dir = new THREE.Vector3(-p.x * 0.25, 0, 12 - p.z * 0.2).normalize();
  const pos = target.clone().add(dir.multiplyScalar(narrow ? 18 : 10)).add(new THREE.Vector3(0, narrow ? 15 : 7, 0));
  flyTo(pos, target);
}
function flyTo(pos, target) {
  flight = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, start: performance.now() };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function tick(now) {
  if (flight) {
    const t = Math.min(1, (performance.now() - flight.start) / 900); // wall-clock, so slow devices still finish
    const k = ease(t);
    camera.position.lerpVectors(flight.from, flight.to, k);
    controls.target.lerpVectors(flight.tFrom, flight.tTo, k);
    if (t >= 1) flight = null;
  }
  // gentle pulse on stations that hold a safe swap
  const pulse = 0.12 + 0.08 * Math.sin(now / 350);
  const swaps = swapCounts();
  for (const [id, o] of stationObjects) if (swaps[id] && state.step === 3) o.pad.material.opacity = pulse;
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
// Shift the projection so the gym is centred in the area not covered by the panel
// (right-side panel on desktop, bottom sheet on phones).
function applyViewOffset() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  if (w < 760) camera.setViewOffset(w, h, 0, h * 0.24, w, h);
  else camera.setViewOffset(w, h, Math.min(400, w * 0.45) / 2, 0, w, h);
  camera.updateProjectionMatrix();
}
function onResize() {
  applyViewOffset();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
}

// ------------------------------------------------------------------
// Guided flow (panel)
// ------------------------------------------------------------------
function setStep(n) {
  state.step = n;
  document.querySelectorAll('.steps li').forEach((li) => {
    const s = +li.dataset.step;
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
  });
  refreshHighlights();
}

function stationForEquipment(eq) {
  return state.stations.find((s) => s.equipment.some((e) => eq.includes(e)));
}
function swapCounts() {
  const out = {};
  if (state.step !== 3 || !state.result) return out;
  for (const r of state.result.results) {
    const st = stationForEquipment(r.equipment);
    if (st) out[st.id] = (out[st.id] || 0) + 1;
  }
  return out;
}

// Step 0 — welcome
function renderWelcome() {
  setStep(0);
  state.station = null; state.exercise = null; state.result = null;
  if (webglOk) setOverview();
  panel.innerHTML = `
    ${webglOk ? '' : '<div class="fallback">3D view isn\'t available on this device — use the list below.</div>'}
    <h1>Hurt something?<br>Let's find a safe swap.</h1>
    <p class="lead">${webglOk ? 'Tap the machine you were going to use.' : 'Pick the area of the gym you were going to use.'} Drag to look around.</p>
    <div class="list">${state.stations.map((s) => `
      <button class="item" data-station="${s.id}">
        <span>${esc(s.name)}<small>${esc(s.description)}</small></span>
        <span class="arrow">›</span>
      </button>`).join('')}
    </div>
    <h2>Know the exercise name?</h2>
    <input class="search" id="q" placeholder="Search, e.g. squat, bench, row" autocomplete="off">
    <div class="list suggest" id="suggest"></div>`;
  panel.querySelectorAll('[data-station]').forEach((b) => b.addEventListener('click', () => selectStation(b.dataset.station)));
  panel.querySelectorAll('[data-station]').forEach((b) => {
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
          `<button class="item" data-ex="${esc(x.id)}" data-name="${esc(x.name)}"><span>${esc(x.name)}</span><span class="arrow">›</span></button>`).join('')
          : '<p class="lead">No exercise starts with that.</p>';
        $('#suggest').querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => pickFromSearch(b.dataset.ex)));
      } catch (err) { $('#suggest').innerHTML = `<div class="error">${esc(err.message)}</div>`; }
    }, 140);
  });
}

async function pickFromSearch(id) {
  try {
    const ex = await api(`/api/exercises/${encodeURIComponent(id)}`);
    state.station = stationForEquipment(ex.equipment) || null;
    if (state.station && webglOk) flyToStation(state.station.id);
    selectExercise(ex);
  } catch (err) { panel.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`); }
}

// Step 1 — exercises at a station
async function selectStation(id) {
  if (state.step >= 2) return; // finish or restart the current flow first
  const st = state.stations.find((s) => s.id === id);
  if (!st) return;
  state.station = st;
  setStep(1);
  if (webglOk) flyToStation(id);
  panel.innerHTML = `<button class="back">‹ All machines</button><h1>${esc(st.name)}</h1><p class="lead">${esc(st.description)}</p><p class="loading">Loading exercises…</p>`;
  $('.back', panel).addEventListener('click', renderWelcome);
  try {
    const r = await api(`/api/gym/stations/${encodeURIComponent(id)}/exercises`);
    if (state.station?.id !== id) return;
    const groups = {};
    for (const ex of r.exercises) {
      const g = MUSCLE_GROUP[ex.primaryMuscles[0]] || 'Other';
      (groups[g] ||= []).push(ex);
    }
    panel.innerHTML = `
      <button class="back">‹ All machines</button>
      <h1>${esc(st.name)}</h1>
      <p class="lead">What were you planning to do here?</p>
      ${GROUP_ORDER.filter((g) => groups[g]).map((g) => `
        <h2>${g}</h2>
        <div class="list">${groups[g].map((ex) => `
          <button class="item" data-ex="${esc(ex.id)}">
            <span>${esc(ex.name)}<small>${ex.primaryMuscles.map(nice).join(', ')}</small></span>
            <span class="arrow">›</span>
          </button>`).join('')}</div>`).join('')}`;
    $('.back', panel).addEventListener('click', renderWelcome);
    panel.querySelectorAll('[data-ex]').forEach((b) =>
      b.addEventListener('click', () => selectExercise(r.exercises.find((x) => x.id === b.dataset.ex))));
  } catch (err) {
    panel.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`);
  }
}

// Step 2 — what hurts
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
    pts.map(([x, y]) => `<circle class="spot" data-area="${area}" cx="${x}" cy="${y}" r="8"><title>${area}</title></circle>`)).join('');
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

function selectExercise(ex) {
  state.exercise = ex; state.area = null; state.injury = null;
  setStep(2);
  const areas = [...new Set(state.injuries.map((i) => i.area))];
  panel.innerHTML = `
    <button class="back">‹ Back</button>
    <h1>Where does it hurt?</h1>
    <p class="lead">You picked <strong>${esc(ex.name)}</strong>. Tap the body or choose below.</p>
    <div class="body-wrap">${bodySvg()}</div>
    <div class="chips">${areas.map((a) => `<button class="chip" data-area="${esc(a)}">${esc(a)}</button>`).join('')}</div>
    <div class="options" id="opts"></div>
    <button class="primary" id="find" disabled>Show me safe swaps</button>`;
  $('.back', panel).addEventListener('click', () => (state.station ? (setStep(0), selectStation(state.station.id)) : renderWelcome()));
  panel.querySelectorAll('[data-area]').forEach((el) => el.addEventListener('click', () => chooseArea(el.dataset.area)));
  $('#find').addEventListener('click', findSwaps);
}

function chooseArea(area) {
  state.area = area;
  panel.querySelectorAll('[data-area]').forEach((el) => el.classList.toggle('on', el.dataset.area === area));
  const options = state.injuries.filter((i) => i.area === area);
  state.injury = options.length === 1 ? options[0].tag : null;
  $('#opts').innerHTML = options.map((i) => `
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

// Step 3 — results
async function findSwaps() {
  const btn = $('#find');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    state.result = await api('/api/substitutions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exercise: state.exercise.id, injuryTag: state.injury, maxResults: 5 }),
    });
    renderResults();
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Show me safe swaps';
    panel.insertAdjacentHTML('beforeend', `<div class="error" style="margin-top:12px">${esc(err.message)}</div>`);
  }
}

const reasonText = (r) => r.replace(/^[a-z]+ '[^']+': /, '');
const SAFETY_PLAIN = {
  BLOOM_NEGATIVE: 'Not on the avoid list for your injury',
  BLOOM_POSITIVE_RULE_CLEARED: 'Double-checked against the full rules: OK',
};

function renderResults() {
  const r = state.result;
  setStep(3);
  const injury = state.injuries.find((i) => i.tag === state.injury);
  const area = injury.area.toLowerCase();
  const verdict = r.target.unsafeForInjury
    ? `<div class="verdict skip"><strong>Skip ${esc(r.target.name)} for now.</strong><br>${esc(reasonText(r.target.unsafeReasons[0]))}</div>`
    : `<div class="verdict ok"><strong>${esc(r.target.name)} isn't on the avoid list</strong> for your ${esc(area)}. If it still hurts, try one of these.</div>`;

  const cards = r.results.map((c) => {
    const st = stationForEquipment(c.equipment);
    return `
      <div class="card" data-station="${st ? st.id : ''}" tabindex="0">
        <div class="top"><strong>${esc(c.name)}</strong><span class="rank">#${c.rank}</span></div>
        <div class="meta">Works ${c.primaryMuscles.map(nice).join(', ')}${c.movementPattern === r.target.movementPattern ? ' · same type of movement' : ''}</div>
        <div class="safe">✓ ${esc(SAFETY_PLAIN[c.safetyMethod] || 'Safe')}</div>
        ${st ? `<span class="where">📍 ${esc(st.name)}</span>` : ''}
      </div>`;
  }).join('');

  const p = r.pipeline;
  const noSwap = r.status === 'NO_SAFE_SUBSTITUTE';
  panel.innerHTML = `
    <button class="back">‹ Change injury</button>
    <h1>${noSwap ? 'No safe swap here' : 'Try these instead'}</h1>
    <p class="lead">For a sore ${esc(area)} · ${esc(injury.guidance)}</p>
    ${verdict}
    ${noSwap ? `<div class="error">${esc(r.message)} A physiotherapist can suggest a modified version.</div>` : `
      <p class="lead" style="margin-top:14px">${webglOk ? 'Highlighted stations in the gym show where to go. Tap a card to walk there.' : 'Each card shows where in the gym to go.'}</p>
      ${cards}`}
    <details class="how">
      <summary>How we checked</summary>
      <ol>
        <li><strong>Found your exercise</strong> with a <code>Trie</code> (${esc(p.targetLookup)}).</li>
        <li><strong>Gathered ${p.candidatesConsidered} exercises</strong> that work the same main muscles.</li>
        <li><strong>Quick safety screen</strong> with a <code>Bloom filter</code>: ${p.bloomNegatives} were instantly clear, ${p.bloomPositives} were "maybe unsafe".</li>
        <li><strong>Every "maybe" was double-checked</strong> against the full injury rules: ${p.confirmedUnsafe} really unsafe, ${p.falsePositivesCleared} false alarm${p.falsePositivesCleared === 1 ? '' : 's'} cleared. We never call something unsafe on the quick screen alone.</li>
        <li><strong>Ranked</strong> by muscle overlap, movement type and equipment. Server time ${p.elapsedMicros.toLocaleString()} µs.</li>
      </ol>
      ${r.rejected.length ? `<p style="margin-top:10px"><strong>Avoid for now:</strong> ${r.rejected.filter((x) => x.stage === 'SAFETY').slice(0, 6).map((x) => esc(x.name)).join(', ')}${r.rejected.length > 6 ? '…' : ''}</p>` : ''}
    </details>
    <button class="ghost" id="restart">Start over</button>`;

  $('.back', panel).addEventListener('click', () => selectExercise(state.exercise));
  $('#restart').addEventListener('click', renderWelcome);
  panel.querySelectorAll('.card').forEach((card) => {
    const go = () => {
      panel.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c === card));
      if (card.dataset.station && webglOk) flyToStation(card.dataset.station);
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  if (webglOk) setOverview();
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
(async function boot() {
  initScene();
  panel.innerHTML = '<p class="loading">Opening the gym…</p>';
  try {
    [state.stations, state.injuries] = await Promise.all([api('/api/gym/stations'), api('/api/injuries')]);
    if (webglOk) buildStations();
    renderWelcome();
  } catch (err) {
    panel.innerHTML = `<h1>Can't open the gym</h1><div class="error">${esc(err.message)}</div>`;
  }
})();
