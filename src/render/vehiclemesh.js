// Car meshes. Each spec's geometry is built once (smooth lofted body with
// glass, trim and details merged into one geometry; head lamps; tail
// lamps; one wheel) and shared by every car of that spec. Paint materials
// are shared by colour. Near model draw calls: body, head, tail, 4 wheels
// (+1 light bar on police cars). Far model: one call.
// Origin is the ground centre of the car; the car points along local +x.
//
// Hierarchy: group (position, yaw) -> rig (body pitch / roll) -> body,
// far, head, tail, bar; group -> 4 wheel pivots (steer) -> mount -> wheel
// (spin). Wheels stay planted while the body leans over them.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';
import { buildCar, buildWheel, wheelLayout, styleFor } from './carbody.js';
import { paintMaterial, ownPaintMaterial, releaseMaterial, farMaterial, wheelMaterial, LAMP } from './vehiclemats.js';

// ---- per-spec geometry cache ------------------------------------------------------
const specCache = new Map();
const wheelCache = new Map();
const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));

function wheelGeo(spec) {
  const { wr, tw } = wheelLayout(spec);
  const spokes = spec.body === 'truck' ? 8 : spec.body === 'van' ? 7 : spec.body === 'pickup' ? 6 : 5;
  const rim = spec.body === 'truck' || spec.body === 'van' ? 0xa9adb2 : spec.id === 'police' ? 0x8e9298 : spec.id === 'muscle' ? 0xd6d8dc : 0xc6cad0;
  const key = wr.toFixed(3) + ':' + tw.toFixed(3) + ':' + spokes + ':' + rim;
  let g = wheelCache.get(key);
  if (!g) {
    g = buildWheel(wr, tw, spokes, rim);
    wheelCache.set(key, g);
  }
  return g;
}

let barGeo = null;
function lightBarGeometry() {
  if (barGeo) return barGeo;
  const parts = [];
  // Two lamp blocks (u picks red / blue cell) on a dark base.
  const mk = (sx, sy, sz, x, y, z, u) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
    parts.push(g);
  };
  mk(0.22, 0.09, 0.5, 0, 0.07, 0.27, 0.125);
  mk(0.22, 0.09, 0.5, 0, 0.07, -0.27, 0.375);
  mk(0.26, 0.05, 1.12, 0, 0.02, 0, 0.875);
  mk(0.2, 0.06, 0.06, 0, 0.07, 0, 0.625);
  const pos = [], nor = [], uvs = [], idx = [];
  let base = 0;
  for (const g of parts) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uvs.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(base + i);
    base += g.attributes.position.count;
    g.dispose();
  }
  barGeo = new THREE.BufferGeometry();
  barGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  barGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  barGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  barGeo.setIndex(idx);
  return barGeo;
}

function specEntry(spec) {
  let e = specCache.get(spec.id);
  if (e) return e;
  const near = buildCar(spec, true);
  const far = buildCar(spec, false);
  const sh = near.shape, gs = near.gh;
  const S = styleFor(spec);
  const { wr, ax, az } = wheelLayout(spec);
  // Anchor points the effects system uses (car local frame).
  const exY = sh.bottom(sh.x0 + 0.3) + 0.04;
  const exZ = S.exhaust ? S.exhaust.z * sh.hw * 2 * (S.exhaust.n === 2 ? 1 : -1) : -0.4;
  const anchors = {
    exhaust: [spec.body === 'truck' ? sh.x0 - 0.2 : sh.x0 - 0.05, spec.body === 'truck' ? spec.height + 0.2 : exY, exZ],
    exhaust2: S.exhaust && S.exhaust.n === 2 ? [sh.x0 - 0.05, exY, -exZ] : null,
    bonnet: [spec.body === 'van' || spec.body === 'truck' ? sh.x1 - 0.5 : (gs.xA + sh.x1) / 2, sh.top((gs.xA + sh.x1) / 2) + 0.05],
    head: [sh.x1 + 0.05, sh.yc(sh.x1 - 0.1) - 0.06, sh.hw * 0.68],
    tail: spec.body === 'truck' ? [-spec.length / 2 - 0.05, 0.55, spec.width / 2 - 0.22] : [sh.x0 - 0.05, sh.yc(sh.x0 + 0.1) - 0.06, sh.hw * 0.7],
    roofY: gs.roofY + gs.crown,
    wr, ax, az,
    bodyTris: near.body.index.count / 3, farTris: far.body.index.count / 3,
  };
  e = { body: near.body, head: near.head || EMPTY, tail: near.tail || EMPTY, far: far.body, wheel: wheelGeo(spec), anchors };
  specCache.set(spec.id, e);
  return e;
}

// Triangle counts per spec (near body, far body, one wheel), for tools.
export function vehicleStats(spec) {
  const e = specEntry(spec);
  return { body: e.anchors.bodyTris, far: e.anchors.farTris, wheel: e.wheel.index.count / 3, head: e.head.index ? e.head.index.count / 3 : 0, tail: e.tail.index ? e.tail.index.count / 3 : 0 };
}

// ---- LOD ----------------------------------------------------------------------------
// game.js toggles `userData.head.visible` (with wheels and tail) for
// distance LOD; the head lamp mesh forwards that to the near / far bodies
// so sleeping cars switch too without any per-frame work.
function linkLod(ud) {
  const head = ud.head;
  let vis = true;
  Object.defineProperty(head, 'visible', {
    get() { return vis; },
    set(v) {
      vis = !!v;
      ud.body.visible = vis;
      ud.far.visible = !vis;
      if (ud.bar) ud.bar.visible = vis;
      ud.lodFar = !vis;
    },
    configurable: true,
  });
}

// Switch a car mesh between the near model and the one-call far model.
export function setVehicleLod(mesh, far) {
  const ud = mesh.userData;
  if (ud.lodFar === !!far) return;
  ud.head.visible = !far;
  ud.tail.visible = !far;
  for (let i = 0; i < ud.wheels.length; i++) ud.wheels[i].visible = !far;
}

// ---- public API -------------------------------------------------------------------
export function createVehicleMesh(spec, color) {
  const col = color == null ? spec.colors[0] : color;
  const e = specEntry(spec);
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);

  const body = new THREE.Mesh(e.body, paintMaterial(col));
  const far = new THREE.Mesh(e.far, farMaterial(col));
  far.visible = false;
  const head = new THREE.Mesh(e.head, LAMP.head);
  const tail = new THREE.Mesh(e.tail, LAMP.tail0);
  rig.add(body, far, head, tail);

  const { wr, ax, az } = e.anchors;
  const wheels = [];
  const frontWheels = [];
  const pivots = [];
  const wmat = wheelMaterial();
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const right = i % 2 === 0;
    const pivot = new THREE.Group();
    pivot.position.set(front ? ax : -ax, wr, right ? az : -az);
    const mount = new THREE.Group();
    if (!right) mount.rotation.y = Math.PI;
    const m = new THREE.Mesh(e.wheel, wmat);
    m.userData.sign = right ? -1 : 1;
    mount.add(m);
    pivot.add(mount);
    group.add(pivot);
    wheels.push(m);
    pivots.push(pivot);
    if (front) frontWheels.push(pivot);
  }

  let bar = null;
  if (spec.id === 'police') {
    bar = new THREE.Mesh(lightBarGeometry(), LAMP.bar0);
    bar.position.set(-spec.length * 0.08, e.anchors.roofY - 0.01, 0);
    rig.add(bar);
  }

  group.rotation.order = 'YXZ';
  const L = spec.length;
  group.userData = {
    spec, color: col, rig, body, far, head, tail, wheels, frontWheels, pivots, bar,
    barRed: bar, barBlue: bar,
    anchors: e.anchors,
    lodFar: false,
    hf: 1, wrecked: false, ownPaint: null,
    hits: [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(-1, 0, 0, 0)], hitN: 0, hitDirty: false,
    crushF: 0, crushR: 0,
    box: new THREE.Vector4(L / 2, spec.width / 2, spec.height, 0),
    brakeOn: false, sirenOn: false, sirenPhase: -1, reverseOn: false, tailState: 0, headState: 'head',
    seed: (Math.abs(col * 0.618) % 97) + 1,
  };
  linkLod(group.userData);
  return group;
}

// Remember a hit for damage decals. (lx, ly, lz) is the direction from
// the car centre to the struck point in the car's local frame; strength
// the closing speed in m/s.
export function noteVehicleHit(mesh, lx, ly, lz, strength) {
  const ud = mesh && mesh.userData;
  if (!ud || !ud.hits) return;
  const l = Math.hypot(lx, ly, lz) || 1;
  // Merge with the last hit if it is on the same side.
  const last = ud.hits[(ud.hitN + 1) % 2];
  const amt = Math.min(1, strength / 16);
  if (last.w > 0 && (last.x * lx + last.y * ly + last.z * lz) / l > 0.8) {
    last.w = Math.min(1, last.w + amt * 0.6);
  } else {
    const h = ud.hits[ud.hitN];
    h.set(lx / l, ly / l, lz / l, Math.max(h.w * 0.5, amt));
    ud.hitN = (ud.hitN + 1) % 2;
  }
  // Big frontal / rear hits crumple the body a little.
  if (strength > 13) {
    const c = Math.min(0.3, (strength - 13) * 0.018);
    if (lx / l > 0.6) ud.crushF = Math.min(0.32, ud.crushF + c);
    else if (lx / l < -0.6) ud.crushR = Math.min(0.32, ud.crushR + c);
  }
  ud.hitDirty = true;
}

// Drop the car's private damage material (call when the car is removed).
export function releaseVehicleMesh(mesh) {
  const ud = mesh && mesh.userData;
  if (!ud || !ud.ownPaint) return;
  releaseMaterial(ud.ownPaint);
  ud.ownPaint = null;
}

function applyDamage(ud, v) {
  const hf = ud.hf;
  const wear = 1 - hf;
  const needOwn = wear > 0.02 || ud.wrecked || ud.hits[0].w > 0 || ud.hits[1].w > 0;
  if (needOwn && !ud.ownPaint) {
    ud.ownPaint = ownPaintMaterial(ud.color, ud.box);
    ud.body.material = ud.ownPaint;
  }
  if (ud.ownPaint) {
    const u = ud.ownPaint.userData.rw;
    u.uDmg.value.set(Math.min(1, wear * 1.1), ud.wrecked ? 1 : 0, Math.min(1, 0.15 + wear * 1.3), ud.seed);
    u.uHit0.value.copy(ud.hits[0]);
    u.uHit1.value.copy(ud.hits[1]);
    u.uCrush.value.set(ud.crushF, ud.crushR, ud.box.x, -ud.box.x);
  }
  ud.head.position.x = -ud.crushF * 0.9;
  ud.tail.position.x = ud.crushR * 0.9;
  ud.far.material = farMaterial(ud.color, ud.wrecked);
  const wm = wheelMaterial(ud.wrecked);
  for (let i = 0; i < ud.wheels.length; i++) ud.wheels[i].material = wm;
  void v;
}

function hash(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function applyLamps(ud, time) {
  if (ud.wrecked) {
    ud.head.material = LAMP.headOff;
    ud.tail.material = LAMP.tailOff;
  } else {
    // A damaged car's left headlight flickers.
    let h = LAMP.head;
    if (ud.hf < 0.5) {
      const k = Math.floor(time * 14);
      if (hash(k + ud.seed * 7) < 0.25 + (0.5 - ud.hf) * 1.2) h = LAMP.headFlickL;
    }
    ud.head.material = h;
    const haz = ud.hf < 0.25 && Math.floor(time * 2.6) % 2 === 0;
    ud.tail.material = LAMP['tail' + ((ud.brakeOn ? 1 : 0) | (ud.reverseOn ? 2 : 0) | (haz ? 4 : 0))];
  }
  if (ud.bar) ud.bar.material = ud.sirenPhase === 0 ? LAMP.bar1 : ud.sirenPhase === 1 ? LAMP.bar2 : LAMP.bar0;
}

const MAX_ROLL = 0.075, MAX_PITCH = 0.055;

// Place the mesh between the previous and current simulation state.
export function updateVehicleMesh(mesh, v, alpha = 1, time = 0) {
  const x = v.px + (v.x - v.px) * alpha;
  const z = v.pz + (v.z - v.pz) * alpha;
  const h = v.pheading + angleDiff(v.heading, v.pheading) * alpha;
  const ud = mesh.userData;
  mesh.position.set(x, Number.isFinite(v.y) ? v.y : 0, z);
  mesh.rotation.set(0, -h, 0);

  // Body lean about a roll / pitch centre a little above the ground.
  const roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, v.roll || 0));
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch || 0));
  const p = 0.45;
  const rig = ud.rig;
  rig.rotation.set(roll, 0, pitch, 'XZY');
  rig.position.set(p * Math.sin(pitch), p * (2 - Math.cos(roll) - Math.cos(pitch)), -p * Math.sin(roll));

  // Wheels: spin, steer, and follow part of the body's travel.
  const spin = v.wheelSpin || 0;
  for (let i = 0; i < ud.wheels.length; i++) {
    const w = ud.wheels[i];
    w.rotation.z = w.userData.sign * spin;
    const pv = ud.pivots[i];
    const dy = -roll * pv.position.z + pitch * pv.position.x;
    pv.position.y = ud.anchors.wr + Math.max(-0.03, Math.min(0.035, dy * 0.45));
  }
  const steer = v.steerAngle != null ? v.steerAngle : (v.steer || 0) * (v.spec.steerMax || 0.6);
  for (let i = 0; i < ud.frontWheels.length; i++) ud.frontWheels[i].rotation.y = -steer;

  // Distance LOD (also driven by game.js through head.visible).
  if (v.lodFar != null && !!v.lodFar !== ud.lodFar) setVehicleLod(mesh, v.lodFar);

  // Damage state.
  const max = (v.spec && v.spec.health) || 1000;
  const hf = Math.max(0, Math.min(1, (Number.isFinite(v.health) ? v.health : max) / max));
  const wrecked = !!v.wrecked;
  if (Math.abs(hf - ud.hf) > 0.004 || wrecked !== ud.wrecked || ud.hitDirty) {
    ud.hf = hf;
    ud.wrecked = wrecked;
    ud.hitDirty = false;
    applyDamage(ud, v);
  }
  ud.brakeOn = (v.brake || 0) > 0.1 || !!v.handbrake;
  ud.reverseOn = (v.speed || 0) < -0.4 && !!(v.driver || v.controls);
  applyLamps(ud, time);
}

// Brake lights and police light bar.
export function setVehicleLights(mesh, opts) {
  const ud = mesh.userData;
  ud.brakeOn = !!(opts && opts.brake);
  const on = !!(opts && opts.siren);
  ud.sirenOn = on;
  ud.sirenPhase = on ? Math.floor((opts.time || 0) * 6) % 2 : -1;
  applyLamps(ud, (opts && opts.time) || 0);
}
