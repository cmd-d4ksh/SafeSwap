// A small jointed 3D person used two ways: as the "coach" that demonstrates an exercise in the
// panel, and as gym members training around the 3D gym. Pure presentation: the backend decides
// WHICH motion an exercise uses (GET /api/exercises/{id}/guide); this file only knows how to draw it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const D = Math.PI / 180;
const KEYS = ['rootY', 'rootX', 'rootRY', 'rootZ', 'spine', 'twist', 'neck', 'shrug', 'lift',
  'shF', 'shA', 'el', 'hipF', 'hipA', 'kn', 'toe', 'shFR', 'shAR', 'elR', 'hipFR', 'hipAR', 'knR', 'toeR'];
const STAND = { rootY: 0.95, shF: 0, shA: 8, el: 12 };
const SEATED = { rootY: 0.58, hipF: 90, kn: 90, shF: 10, shA: 18, el: 25 };

// Each motion blends pose a -> b -> a. Angles in degrees: shF/hipF = flexion (limb forward),
// shA/hipA = abduction (out to the side), el/kn = bend. "R" keys override the right side.
// anchor: 'feet' (plant both feet), 'left' (plant left foot), 'stance' (feet on floor only),
// 'all' (hands + feet on floor), 'hands' (hands fixed at `at`), 'feetxz', or none.
export const MOTIONS = {
  squat: { anchor: 'feet', prop: 'kb', a: { spine: 4, shF: 38, shA: 14, el: 120 }, b: { spine: 40, shF: 62, shA: 14, el: 120, hipF: 108, kn: 118 } },
  lunge: { anchor: 'left', prop: 'db', a: { hipF: 6, hipFR: -6 }, b: { spine: 4, hipF: 85, kn: 88, hipFR: -22, knR: 100, toeR: 45 } },
  stepup: { anchor: 'left', at: { x: 0.1, y: 0.36, z: 0.12 }, set: 'box', prop: 'db', a: { hipF: 72, kn: 82, hipFR: -6, knR: 6, spine: 12 }, b: { hipF: 2, kn: 2, hipFR: 70, knR: 85, spine: 2 } },
  legpress: { set: 'recline', prop: 'plate', a: { rootY: 0.62, rootX: -40, hipF: 103, kn: 60, shF: 20, el: 30 }, b: { rootY: 0.62, rootX: -40, hipF: 90, kn: 4, shF: 20, el: 30 } },
  legext: { set: 'seatback', a: { ...SEATED, kn: 92 }, b: { ...SEATED, kn: 8 } },
  legcurl: { set: 'seatback', a: { ...SEATED, kn: 10 }, b: { ...SEATED, kn: 100 } },
  hipmachine: { set: 'seatback', a: { ...SEATED, hipA: 4 }, b: { ...SEATED, hipA: 32 } },
  calf: { anchor: 'feet', prop: 'db', a: { toe: 0 }, b: { toe: 38 } },
  hinge: { anchor: 'feet', prop: 'bar', a: { shF: 0, el: 0 }, b: { rootX: 70, hipF: 82, kn: 18, spine: 4, shF: 74, el: 0 } },
  swing: { anchor: 'feet', prop: 'kb', period: 1.7, a: { rootX: 55, hipF: 75, kn: 28, spine: 3, shF: 40, el: 0 }, b: { rootX: -3, hipF: -3, kn: 0, shF: 95, el: 0 } },
  hipthrust: { anchor: 'feetxz', set: 'mat', a: { rootX: -90, rootY: 0.13, hipF: 45, kn: 135, shF: 0, el: 0 }, b: { rootX: -118, rootY: 0.5, hipF: -6, kn: 112, shF: -28, el: 0 } },
  glutekick: { anchor: 'left', a: { rootX: 20, hipF: 20, hipFR: 20, spine: 10, shF: 60, el: 20 }, b: { rootX: 20, hipF: 20, hipFR: -32, knR: 10, spine: 10, shF: 60, el: 20 } },
  jump: { anchor: 'feet', period: 1.5, a: { spine: 30, hipF: 70, kn: 85, shF: -35, el: 10 }, b: { hipF: 0, kn: 0, shF: 165, el: 5, lift: 0.3, toe: 30 } },
  bench: { set: 'bench', prop: 'bar', a: { rootX: -90, rootY: 0.6, hipF: -5, kn: 92, shF: 25, shA: 55, el: 105 }, b: { rootX: -90, rootY: 0.6, hipF: -5, kn: 92, shF: 90, shA: 12, el: 3 } },
  chestpress: { set: 'seatback', a: { ...SEATED, shF: 15, shA: 60, el: 100 }, b: { ...SEATED, shF: 88, shA: 12, el: 3 } },
  pushup: { anchor: 'all', set: 'mat', free: true, a: { rootX: 76, shF: 76, el: 0, shA: 10 }, b: { rootX: 86, shF: 40, el: 46, shA: 10 } },
  dip: { anchor: 'hands', at: { x: 0, y: 1.2, z: 0 }, set: 'bars', free: true, a: { shF: 0, shA: 10, el: 0, hipF: 25, kn: 70, spine: 5 }, b: { shF: -70, shA: 10, el: 75, hipF: 25, kn: 70, spine: 18 } },
  overhead: { anchor: 'feet', prop: 'db', a: { shF: 40, shA: 18, el: 128 }, b: { shF: 172, shA: 12, el: 4 } },
  raise: { anchor: 'feet', prop: 'db', a: { shA: 10, el: 15 }, b: { shA: 86, el: 15 } },
  frontraise: { anchor: 'feet', prop: 'db', a: { shF: 0, el: 8 }, b: { shF: 88, el: 8 } },
  fly: { anchor: 'feet', a: { shA: 82, shF: 12, el: 20 }, b: { shA: 12, shF: 85, el: 20 } },
  shrug: { anchor: 'feet', prop: 'bar', a: { shF: 0, el: 0, shrug: 0 }, b: { shF: 0, el: 0, shrug: 0.07 } },
  row: { anchor: 'feet', prop: 'bar', a: { rootX: 48, hipF: 60, kn: 22, shF: 48, el: 0 }, b: { rootX: 48, hipF: 60, kn: 22, shF: -15, el: 60 } },
  seatedrow: { set: 'floorseat', a: { rootY: 0.34, hipF: 85, kn: 25, spine: 18, shF: 70, el: 0 }, b: { rootY: 0.34, hipF: 85, kn: 25, spine: -12, shF: -20, el: 105 } },
  pulldown: { set: 'seat', a: { ...SEATED, shF: 170, shA: 22, el: 6 }, b: { ...SEATED, spine: -10, shF: 35, shA: 22, el: 128 } },
  pullup: { anchor: 'hands', at: { x: 0, y: 2.2, z: 0.05 }, set: 'pullbar', free: true, a: { shF: 172, shA: 14, el: 4, hipF: 12, kn: 35 }, b: { shF: 45, shA: 14, el: 135, hipF: 18, kn: 45, spine: -6 } },
  curl: { anchor: 'feet', prop: 'db', a: { el: 6, shF: 2 }, b: { el: 140, shF: 8 } },
  pushdown: { anchor: 'feet', prop: 'handle', a: { shF: -4, el: 100, spine: 8 }, b: { shF: -4, el: 2, spine: 8 } },
  extension: { anchor: 'feet', prop: 'kb', a: { shF: 168, shA: 8, el: 140 }, b: { shF: 168, shA: 8, el: 8 } },
  plank: { anchor: 'all', set: 'mat', free: true, period: 3, a: { rootX: 90, shF: 90, el: 92 }, b: { rootX: 86, shF: 86, el: 92, hipF: 4 } },
  crunch: { set: 'mat', a: { rootX: -90, rootY: 0.13, hipF: 50, kn: 110, shF: 30, el: 10 }, b: { rootX: -90, rootY: 0.13, hipF: 50, kn: 110, shF: 30, el: 10, spine: 38 } },
  twist: { anchor: 'feet', prop: 'kb', period: 2.4, a: { twist: -40, shF: 75, el: 15, kn: 15, hipF: 15, spine: 10 }, b: { twist: 40, shF: 75, el: 15, kn: 15, hipF: 15, spine: 10 } },
  carry: { anchor: 'stance', prop: 'db', period: 1.1, a: { hipF: 22, kn: 8, hipFR: -16, knR: 28, shF: -4, shFR: 4, el: 4 }, b: { hipF: -16, kn: 28, hipFR: 22, knR: 8, shF: 4, shFR: -4, el: 4 } },
  walk: { anchor: 'stance', at: { y: 0.16 }, set: 'belt', period: 1.1, a: { hipF: 22, kn: 8, hipFR: -16, knR: 28, shF: -18, shFR: 18, el: 18 }, b: { hipF: -16, kn: 28, hipFR: 22, knR: 8, shF: 18, shFR: -18, el: 18 } },
  run: { anchor: 'stance', at: { y: 0.16 }, set: 'belt', period: 0.7, a: { spine: 10, hipF: 50, kn: 65, hipFR: -25, knR: 95, shF: -35, shFR: 35, el: 90, lift: 0.05 }, b: { spine: 10, hipF: -25, kn: 95, hipFR: 50, knR: 65, shF: 35, shFR: -35, el: 90, lift: 0.05 } },
  cycle: { set: 'bike', period: 1.0, a: { rootY: 1.0, spine: 35, shF: 62, el: 18, hipF: 75, kn: 110, hipFR: 35, knR: 55 }, b: { rootY: 1.0, spine: 35, shF: 62, el: 18, hipF: 35, kn: 55, hipFR: 75, knR: 110 } },
  rowing: { anchor: 'feetxz', at: { z: 0.75 }, set: 'rower', period: 2.2, a: { rootY: 0.4, spine: 28, hipF: 118, kn: 128, shF: 82, el: 0 }, b: { rootY: 0.4, spine: -22, hipF: 78, kn: 2, shF: -12, el: 112 } },
  waves: { anchor: 'feet', prop: 'ropes', period: 0.6, a: { rootX: 15, hipF: 50, kn: 55, spine: 10, shF: 75, shFR: 30, el: 25 }, b: { rootX: 15, hipF: 50, kn: 55, spine: 10, shF: 30, shFR: 75, el: 25 } },
  // gym-only extras
  wave: { anchor: 'feet', period: 1.2, a: { shAR: 140, elR: 20 }, b: { shAR: 165, elR: 55 } },
  idle: { anchor: 'feet', period: 4, a: { spine: 0 }, b: { spine: 3, neck: 4 } },
};
for (const m of Object.values(MOTIONS)) {
  const base = m.a.rootX && Math.abs(m.a.rootX) >= 60 ? {} : STAND;
  m.A = resolve({ ...base, ...m.a });
  m.B = resolve({ ...base, ...m.b });
  m.period ||= 2.6;
}
function resolve(p) {
  const out = {};
  for (const k of KEYS) out[k] = p[k] ?? 0;
  out.rootY = p.rootY ?? 0.95;
  for (const k of ['shF', 'shA', 'el', 'hipF', 'hipA', 'kn', 'toe']) out[k + 'R'] = p[k + 'R'] ?? out[k];
  return out;
}

// ------------------------------------------------------------------
// The jointed figure
// ------------------------------------------------------------------
const geo = {
  pelvis: new THREE.SphereGeometry(0.15, 16, 12),
  torso: new THREE.CapsuleGeometry(0.15, 0.26, 6, 14),
  neck: new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10),
  head: new THREE.SphereGeometry(0.105, 20, 16),
  joint: new THREE.SphereGeometry(0.068, 12, 10),
  upper: new THREE.CapsuleGeometry(0.05, 0.19, 4, 10),
  fore: new THREE.CapsuleGeometry(0.043, 0.18, 4, 10),
  hand: new THREE.SphereGeometry(0.048, 10, 8),
  thighTop: new THREE.CapsuleGeometry(0.078, 0.14, 4, 12),
  thigh: new THREE.CapsuleGeometry(0.066, 0.22, 4, 12),
  shin: new THREE.CapsuleGeometry(0.056, 0.3, 4, 12),
  foot: new THREE.BoxGeometry(0.1, 0.07, 0.25),
};
const matCache = {};
const M = (c, r = 0.7) => (matCache[c + ':' + r] ||= new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 }));

export function makeRig({ shirt = 0xe8461f, shorts = 0x22262b, skin = 0xd9a77e, hair = 0x2b211c, shoes = 0xf2f3f5 } = {}) {
  const holder = new THREE.Group();
  const root = new THREE.Group(); root.rotation.order = 'YXZ'; holder.add(root);
  const part = (parent, g, m, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  part(root, geo.pelvis, M(shorts), 0, -0.01, 0, 1.2, 0.75, 0.85);
  const spine = grp(root, 0, 0.06, 0);
  part(spine, geo.torso, M(shirt), 0, 0.27, 0, 1.25, 1, 0.78);
  const neck = grp(spine, 0, 0.5, 0);
  part(neck, geo.neck, M(skin, 0.6), 0, 0.04, 0);
  part(neck, geo.head, M(skin, 0.6), 0, 0.16, 0.005, 0.95, 1.08, 1);
  part(neck, geo.head, M(hair, 0.9), 0, 0.195, -0.012, 1.02, 0.78, 1.04);

  const side = (sgn) => {
    const sh = grp(spine, sgn * 0.21, 0.44, 0);
    part(sh, geo.joint, M(shirt), 0, 0, 0, 1.1, 1, 1);
    part(sh, geo.upper, M(skin, 0.6), 0, -0.15, 0);
    const el = grp(sh, 0, -0.29, 0);
    part(el, geo.fore, M(skin, 0.6), 0, -0.13, 0);
    const hand = grp(el, 0, -0.28, 0);
    part(hand, geo.hand, M(skin, 0.6), 0, 0, 0);
    const hp = grp(root, sgn * 0.1, -0.05, 0);
    part(hp, geo.thighTop, M(shorts), 0, -0.1, 0);
    part(hp, geo.thigh, M(skin, 0.6), 0, -0.27, 0);
    const kn = grp(hp, 0, -0.43, 0);
    part(kn, geo.shin, M(skin, 0.6), 0, -0.2, 0);
    const an = grp(kn, 0, -0.42, 0);
    part(an, geo.foot, M(shoes, 0.5), 0, -0.035, 0.06);
    const heel = grp(an, 0, -0.07, -0.06), toe = grp(an, 0, -0.07, 0.18);
    return { sh, el, hand, hp, kn, an, heel, toe, sgn };
  };
  return { holder, root, spine, neck, L: side(1), R: side(-1), props: {}, propKind: null };
}

// ------------------------------------------------------------------
// Props held by the figure (bar, dumbbells, kettlebell, ...)
// ------------------------------------------------------------------
const steel = () => M(0xc4c9cf, 0.3), dark = () => M(0x1a1c20, 0.6), accent = () => M(0xe8461f, 0.5);
function cylX(r, len, m) { const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 18), m); g.rotation.z = Math.PI / 2; g.castShadow = true; return g; }
function makeProp(kind) {
  const g = new THREE.Group();
  if (kind === 'bar') {
    g.add(cylX(0.016, 1.7, steel()));
    for (const k of [-1, 1]) { const p = cylX(0.2, 0.05, dark()); p.position.x = k * 0.68; g.add(p); const q = cylX(0.15, 0.04, accent()); q.position.x = k * 0.62; g.add(q); }
  } else if (kind === 'db') {
    g.add(cylX(0.014, 0.18, steel()));
    for (const k of [-1, 1]) { const p = cylX(0.05, 0.06, dark()); p.position.x = k * 0.09; g.add(p); }
  } else if (kind === 'kb') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), dark()); b.position.y = -0.13; b.castShadow = true; g.add(b);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 16, Math.PI), dark()); h.position.y = -0.04; g.add(h);
  } else if (kind === 'handle') {
    g.add(cylX(0.016, 0.34, steel()));
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 2), dark()); c.position.y = 1; g.add(c);
  } else if (kind === 'plate') {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.5), dark()); p.castShadow = true; g.add(p);
  } else if (kind === 'ropes') {
    for (const k of [-1, 1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8), M(0x2b2b2b, 0.9)); r.rotation.x = Math.PI / 2 - 0.05; r.position.set(k * 0.02, -0.05, 1.1); g.add(r); }
  }
  return g;
}
function setProp(rig, kind) {
  if (rig.propKind === kind) return;
  for (const p of Object.values(rig.props)) rig.holder.remove(p);
  rig.props = {}; rig.propKind = kind;
  if (!kind) return;
  if (kind === 'db') { rig.props.l = makeProp('db'); rig.props.r = makeProp('db'); }
  else rig.props.c = makeProp(kind);
  for (const p of Object.values(rig.props)) rig.holder.add(p);
}

// ------------------------------------------------------------------
// Posing
// ------------------------------------------------------------------
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
function local(rig, obj, out) { obj.getWorldPosition(out); return rig.holder.worldToLocal(out); }

function applyPose(rig, p, free) {
  const { root, spine, neck } = rig;
  root.position.set(0, p.rootY, p.rootZ);
  root.rotation.set(p.rootX * D, p.rootRY * D, 0);
  spine.rotation.set(p.spine * D, p.twist * D, 0);
  neck.rotation.x = p.neck * D;
  for (const s of [rig.L, rig.R]) {
    const R = s.sgn < 0 ? 'R' : '';
    const shF = p['shF' + R], shA = p['shA' + R], el = p['el' + R], hipF = p['hipF' + R], hipA = p['hipA' + R], kn = p['kn' + R], toe = p['toe' + R];
    s.sh.position.y = 0.44 + p.shrug;
    s.sh.rotation.set(-shF * D, 0, s.sgn * shA * D);
    s.el.rotation.x = -el * D;
    s.hp.rotation.set(-hipF * D, 0, s.sgn * hipA * D);
    s.kn.rotation.x = kn * D;
    s.an.rotation.x = (free ? 0 : -(p.rootX - hipF + kn)) * D + toe * D; // keep feet flat unless free
  }
}

function anchorRig(rig, mode, at = {}) {
  if (!mode) return;
  rig.holder.updateMatrixWorld(true);
  const pos = rig.root.position;
  if (mode === 'hands') {
    const a = local(rig, rig.L.hand, v1), b = local(rig, rig.R.hand, v2);
    pos.x += (at.x ?? 0) - (a.x + b.x) / 2; pos.y += (at.y ?? 1) - (a.y + b.y) / 2; pos.z += (at.z ?? 0) - (a.z + b.z) / 2;
    return;
  }
  const feet = mode === 'left' ? [rig.L] : [rig.L, rig.R];
  let minY = Infinity;
  const p = new THREE.Vector3();
  if (mode !== 'feetxz') {
    for (const f of feet) for (const m of [f.heel, f.toe]) minY = Math.min(minY, local(rig, m, p).y);
    if (mode === 'all') for (const h of [rig.L.hand, rig.R.hand]) minY = Math.min(minY, local(rig, h, p).y - 0.045);
    pos.y += (at.y ?? 0) - minY;
  }
  if (mode !== 'stance') {
    let cx = 0, cz = 0;
    for (const f of feet) { local(rig, f.an, p); cx += p.x; cz += p.z; }
    cx /= feet.length; cz /= feet.length;
    pos.x += (at.x ?? (mode === 'left' ? 0.1 : 0)) - cx;
    pos.z += (at.z ?? 0) - cz;
  }
}

function placeProps(rig) {
  const k = rig.propKind;
  if (!k) return;
  rig.holder.updateMatrixWorld(true);
  const a = local(rig, rig.L.hand, v1.clone()), b = local(rig, rig.R.hand, v2.clone());
  const ry = rig.root.rotation.y;
  if (k === 'db') {
    rig.props.l.position.copy(a); rig.props.r.position.copy(b);
    rig.props.l.rotation.y = rig.props.r.rotation.y = ry;
  } else if (k === 'plate') {
    const fa = local(rig, rig.L.toe, new THREE.Vector3()), fb = local(rig, rig.R.toe, new THREE.Vector3());
    rig.props.c.position.copy(fa.add(fb).multiplyScalar(0.5)); rig.props.c.rotation.set(-50 * D, ry, 0, 'YXZ');
  } else {
    rig.props.c.position.copy(a.add(b).multiplyScalar(0.5));
    rig.props.c.rotation.set(0, ry, 0);
  }
}

/** Plays `motion` on a rig at time `t` seconds. opts: { dy, speed, phase } */
export function animate(rig, motionName, t, opts = {}) {
  const m = MOTIONS[motionName] || MOTIONS.idle;
  setProp(rig, opts.prop === undefined ? m.prop : opts.prop);
  const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t + (opts.phase || 0))) / m.period);
  const p = {};
  for (const k of KEYS) p[k] = m.A[k] + (m.B[k] - m.A[k]) * w;
  applyPose(rig, p, m.free);
  anchorRig(rig, m.anchor, m.at);
  rig.root.position.y += p.lift + (opts.dy || 0);
  placeProps(rig);
}

// ------------------------------------------------------------------
// Coach viewer (the "how to do it" demo in the panel)
// ------------------------------------------------------------------
function setPiece(kind) {
  const g = new THREE.Group();
  const b = (w, h, d, x, y, z, m = dark(), rx = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
  const pad = M(0x2a2f36, 0.55), frame = M(0x5b636e, 0.4);
  if (kind === 'seat' || kind === 'seatback') {
    b(0.46, 0.08, 0.46, 0, 0.46, 0.08, pad); b(0.1, 0.42, 0.1, 0, 0.21, 0.08, frame);
    if (kind === 'seatback') b(0.46, 0.62, 0.07, 0, 0.84, -0.17, pad);
  } else if (kind === 'recline') {
    b(0.46, 0.08, 0.5, 0, 0.5, 0.05, pad); b(0.5, 0.9, 0.08, 0, 0.76, -0.31, pad, -40 * D); b(0.6, 0.12, 2.2, 0, 0.06, 0.6, frame);
  } else if (kind === 'bench') {
    b(0.32, 0.09, 1.25, 0, 0.44, -0.25, pad); b(0.25, 0.4, 0.25, 0, 0.2, -0.6, frame); b(0.25, 0.4, 0.25, 0, 0.2, 0.15, frame);
    for (const k of [-1, 1]) b(0.06, 1.2, 0.06, k * 0.55, 0.6, -0.5, frame);
  } else if (kind === 'box') {
    b(0.5, 0.36, 0.5, 0.1, 0.18, 0.12, M(0xc79b6b, 0.8));
  } else if (kind === 'bars') {
    for (const k of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 12), steel()); bar.rotation.x = Math.PI / 2; bar.position.set(k * 0.27, 1.17, 0.05); g.add(bar);
      b(0.06, 1.17, 0.06, k * 0.27, 0.585, 0.45, frame); b(0.06, 1.17, 0.06, k * 0.27, 0.585, -0.35, frame);
    }
  } else if (kind === 'pullbar') {
    const bar = cylX(0.02, 1.8, steel()); bar.position.set(0, 2.24, 0.05); g.add(bar);
    for (const k of [-1, 1]) b(0.08, 2.4, 0.08, k * 0.9, 1.2, 0.05, frame);
  } else if (kind === 'bike') {
    b(0.3, 0.06, 0.32, 0, 0.92, 0.05, pad); b(0.08, 0.9, 0.08, 0, 0.45, 0.05, frame);
    b(0.5, 0.05, 0.05, 0, 1.12, 0.62, frame); b(0.08, 1.1, 0.08, 0, 0.55, 0.62, frame);
    b(0.5, 0.06, 1.0, 0, 0.03, 0.3, frame);
  } else if (kind === 'rower') {
    b(0.14, 0.1, 2.4, 0, 0.25, 0.4, frame); b(0.38, 0.08, 0.38, 0, 0.32, 0.05, pad);
    const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 24), dark()); fw.rotation.z = Math.PI / 2; fw.position.set(0, 0.42, 1.65); g.add(fw);
    b(0.42, 0.04, 0.26, 0, 0.3, 0.82, frame, -0.9);
  } else if (kind === 'floorseat') {
    b(0.42, 0.24, 0.5, 0, 0.12, 0, pad); b(0.12, 0.08, 1.4, 0, 0.04, 0.6, frame); b(0.5, 0.4, 0.05, 0, 0.2, 0.95, frame, 0.3);
  } else if (kind === 'mat') {
    b(0.75, 0.02, 2.0, 0, 0.01, 0.2, M(0x3f6db3, 0.9));
  } else if (kind === 'belt') {
    b(0.85, 0.16, 2.0, 0, 0.08, 0, dark()); b(0.6, 0.01, 1.7, 0, 0.165, 0, M(0x101215, 0.9));
    for (const k of [-1, 1]) b(0.05, 1.2, 0.05, k * 0.38, 0.75, 0.9, frame);
    b(0.8, 0.3, 0.1, 0, 1.38, 0.9, dark());
  }
  return g;
}

export function createCoach() {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'coach-canvas';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enablePan: false, enableDamping: true, autoRotate: true, autoRotateSpeed: 1.2, minDistance: 2.5, maxDistance: 9, maxPolarAngle: Math.PI * 0.52 });

  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x0b0d10, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.5, 5, 3.5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 3, bottom: -1, near: 0.5, far: 15 });
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff8a5c, 2.2); rim.position.set(-3, 2.5, -3); scene.add(rim);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.6, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.62, 64), new THREE.MeshBasicMaterial({ color: 0xff5a2c }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);

  const rig = makeRig({ shirt: 0xe8461f, shorts: 0x1c2026, skin: 0xc98e66 });
  scene.add(rig.holder);
  let piece = null, motion = 'idle', prop, t = 0, last = performance.now(), paused = false, speed = 1;

  function frameFor(m) {
    const lying = ['bench', 'hipthrust', 'crunch', 'pushup', 'plank'].includes(m);
    const tall = ['pullup', 'overhead', 'extension', 'jump', 'dip'].includes(m);
    if (m === 'pullup') return { target: new THREE.Vector3(0, 1.45, 0.05), dist: 5.4 };
    const z = { pushup: 0.75, plank: 0.75, hipthrust: -0.55, bench: -0.2, crunch: -0.15 }[m] ?? 0.1;
    return { target: new THREE.Vector3(0, lying ? 0.4 : tall ? 1.1 : 0.82, z), dist: lying ? 3.9 : tall ? 4.6 : 3.7 };
  }
  function setView(view) {
    const f = frameFor(motion);
    const dir = view === 'side' ? new THREE.Vector3(1, 0.32, motion === 'pullup' ? 0.45 : 0.05) : view === 'front' ? new THREE.Vector3(0.12, 0.3, 1) : new THREE.Vector3(0.75, 0.38, 0.85);
    camera.position.copy(f.target).add(dir.normalize().multiplyScalar(f.dist));
    controls.target.copy(f.target);
    controls.autoRotate = view === 'auto';
  }
  // equipment from the guide picks what the coach holds (only for motions that hold something)
  function propFor(m, equipment = []) {
    const def = MOTIONS[m].prop;
    if (!def || def === 'plate' || def === 'ropes' || def === 'handle') return def;
    const eq = equipment[0] || '';
    if (['barbell', 'ez-bar', 'smith-machine', 'trap-bar'].includes(eq)) return 'bar';
    if (eq === 'dumbbell') return 'db';
    if (['kettlebell', 'medicine-ball', 'plate', 'sandbag'].includes(eq)) return 'kb';
    if (['bodyweight', 'machine', 'cable', 'resistance-band', 'landmine', 'sled'].includes(eq)) return eq === 'cable' ? 'handle' : null;
    return def;
  }
  function show(m, equipment) {
    motion = MOTIONS[m] ? m : 'idle';
    prop = propFor(motion, equipment);
    if (piece) scene.remove(piece);
    piece = setPiece(MOTIONS[motion].set);
    if (MOTIONS[motion].set === 'mat') piece.position.z = frameFor(motion).target.z - 0.2;
    scene.add(piece);
    t = 0;
    setView('auto');
  }
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!canvas.isConnected) return;
    const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
    if (w && h && (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio()))) {
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    if (!paused) t += dt * speed;
    animate(rig, motion, t, { prop });
    controls.update();
    renderer.render(scene, camera);
  });
  return {
    canvas, show, setView,
    setPaused(v) { paused = v; }, setSpeed(v) { speed = v; },
    get paused() { return paused; },
  };
}
