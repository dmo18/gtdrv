// Car meshes. Each spec's geometry is built once and shared by every car
// of that spec: a body (paint, trim, cabin and details merged into one
// geometry), the glass (tinted, see-through, with the contact shadow in
// the same draw), the lamps (head and tail in one mesh) and one wheel.
// Paint materials are shared by color. Near and mid model: 4 draw calls
// (body, glass, lamps, the four wheels instanced), +1 for a police light
// bar. Far model: one call.
// Origin is the ground center of the car; the car points along local +x.
//
// Hierarchy: group (position, yaw) -> rig (body pitch / roll) -> body,
// glass, lamps, far, bar; group -> wheels (one instanced mesh per LOD
// level, the four instance matrices carry steer, spin and travel). Wheels
// stay planted while the body leans over them.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';
import { buildCar, buildWheel, wheelLayout, wheelStyle, styleFor } from './carbody.js';
import { paintMaterial, ownPaintMaterial, releaseMaterial, farMaterial, wheelMaterial, lampMaterial, carGlassMaterial, LAMP } from './vehiclemats.js';

// ---- per-spec geometry cache ------------------------------------------------------
const specCache = new Map();
const wheelCache = new Map();
const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));

function wheelGeo(spec, lite = false) {
  const { wr, tw } = wheelLayout(spec);
  const ws = wheelStyle(spec);
  const key = wr.toFixed(3) + ':' + tw.toFixed(3) + ':' + ws.spokes + ':' + ws.kind + ':' + ws.rim + (lite ? ':lite' : '');
  let g = wheelCache.get(key);
  if (!g) {
    g = buildWheel(wr, tw, ws.spokes, ws.rim, ws.kind, lite);
    wheelCache.set(key, g);
  }
  return g;
}

// Underbody light (spec.glow): a soft additive pool of color on the road
// under the car. One shared texture and material per color.
const glowMats = new Map();
function underglow(spec) {
  let m = glowMats.get(spec.glow);
  if (!m) {
    const n = 32, d = new Uint8Array(n * n * 4);
    const c = new THREE.Color(spec.glow);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
        const a = Math.max(0, 1 - r) ** 1.6;
        const o = (y * n + x) * 4;
        d[o] = c.r * 255 * a; d[o + 1] = c.g * 255 * a; d[o + 2] = c.b * 255 * a; d[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    tex.needsUpdate = true;
    m = new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    glowMats.set(spec.glow, m);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.length * 1.15, spec.width * 1.3), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  mesh.renderOrder = 2;
  return mesh;
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
  // Strip cells (u = (cell + 0.5) / 8): 0 red, 1 blue, 2 white, 3 base.
  mk(0.24, 0.08, 0.52, 0, 0.075, 0.28, 0.5 / 8);
  mk(0.24, 0.08, 0.52, 0, 0.075, -0.28, 1.5 / 8);
  mk(0.28, 0.045, 1.16, 0, 0.022, 0, 3.5 / 8);
  mk(0.2, 0.06, 0.05, 0, 0.075, 0, 2.5 / 8);
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
  const mid = buildCar(spec, true, true);
  const far = buildCar(spec, false);
  const sh = near.shape, gs = near.gh;
  const S = styleFor(spec);
  const { wr, tw, ax, az } = wheelLayout(spec);
  // Anchor points the effects system uses (car local frame).
  const exY = sh.bottom(sh.x0 + 0.3) + 0.04;
  const exZ = S.exhaust ? S.exhaust.z * sh.hw * 2 * (S.exhaust.n === 2 ? 1 : -1) : -0.4;
  const tris = (g) => (g && g.index ? g.index.count / 3 : 0);
  const anchors = {
    exhaust: [spec.body === 'truck' ? sh.x0 - 0.2 : sh.x0 - 0.05, spec.body === 'truck' ? spec.height + 0.2 : exY, exZ],
    exhaust2: S.exhaust && S.exhaust.n === 2 ? [sh.x0 - 0.05, exY, -exZ] : null,
    hood: [spec.body === 'van' || spec.body === 'truck' ? sh.x1 - 0.5 : (gs.xA + sh.x1) / 2, sh.top((gs.xA + sh.x1) / 2) + 0.05],
    head: [sh.x1 + 0.05, sh.yc(sh.x1 - 0.1) - 0.06, sh.hw * 0.68],
    tail: spec.body === 'truck' ? [-spec.length / 2 - 0.05, 0.55, spec.width / 2 - 0.22] : [sh.x0 - 0.05, sh.yc(sh.x0 + 0.1) - 0.06, sh.hw * 0.7],
    roofY: gs.roofY + gs.crown,
    // Roof mount for a light bar or sign: center x and height (local).
    roofX: (gs.xR0 + gs.xR1) / 2,
    wr, ax, az,
    bodyTris: tris(near.body), midTris: tris(mid.body), farTris: tris(far.body),
  };
  e = {
    body: near.body, mid: mid.body, far: far.body,
    glass: near.glass, glassMid: mid.glass,
    lamps: near.lamps || EMPTY, lampsMid: mid.lamps || EMPTY,
    wheel: wheelGeo(spec), wheelMid: wheelGeo(spec, true),
    wheelSphere: new THREE.Sphere(new THREE.Vector3(0, wr, 0), Math.hypot(ax + wr, az + tw) + 0.05),
    anchors,
  };
  specCache.set(spec.id, e);
  return e;
}

// Triangle counts per spec (near body, far body, one wheel, glass with
// the contact shadow, lamps), for tools and tests.
export function vehicleStats(spec) {
  const e = specEntry(spec);
  const t = (g) => (g && g.index ? g.index.count / 3 : 0);
  return {
    body: e.anchors.bodyTris, mid: e.anchors.midTris, far: e.anchors.farTris,
    wheel: t(e.wheel), wheelMid: t(e.wheelMid),
    glass: t(e.glass), glassMid: t(e.glassMid), lamps: t(e.lamps), lampsMid: t(e.lampsMid),
    // Whole near and mid car (four wheels).
    near: e.anchors.bodyTris + t(e.glass) + t(e.lamps) + 4 * t(e.wheel),
    midAll: e.anchors.midTris + t(e.glassMid) + t(e.lampsMid) + 4 * t(e.wheelMid),
  };
}

// Camera distance (m) beyond which the lighter body is drawn.
export const MID_LOD_M = 24;

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
      ud.bodyLod.visible = vis;
      ud.glass.visible = vis;
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
  for (let i = 0; i < ud.wheels.length; i++) ud.wheels[i].visible = !far;
}

// Light bar geometry and its roof mount, for service vehicles (police,
// and the fire truck / ambulance kit that builds on this one).
export { lightBarGeometry };
export function roofMount(spec) {
  const a = specEntry(spec).anchors;
  return { x: a.roofX, y: a.roofY };
}

// ---- public API -------------------------------------------------------------------
function lodPair(a, b, mat) {
  const lod = new THREE.LOD();
  const m0 = new THREE.Mesh(a, mat), m1 = new THREE.Mesh(b, mat);
  lod.addLevel(m0, 0);
  lod.addLevel(m1, MID_LOD_M);
  return [lod, m0, m1];
}

export function createVehicleMesh(spec, color) {
  const col = color == null ? spec.colors[0] : color;
  const e = specEntry(spec);
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);

  const paint = paintMaterial(col);
  // The renderer picks the full or the lighter level by camera distance;
  // the one-call far model (game.js, 75 m) hides them all.
  const [bodyLod, body, bodyMid] = lodPair(e.body, e.mid, paint);
  const [glass, glassNear, glassMid] = lodPair(e.glass, e.glassMid, carGlassMaterial('clean'));
  const [lamps, lampNear, lampMid] = lodPair(e.lamps, e.lampsMid, lampMaterial(false, 0));
  glass.renderOrder = 1;
  const far = new THREE.Mesh(e.far, farMaterial(col));
  far.visible = false;
  rig.add(bodyLod, glass, far, lamps);

  // Four wheels per LOD level in one instanced draw; both levels share
  // the instance matrices, written by updateVehicleMesh.
  const wmat = wheelMaterial();
  const wNear = new THREE.InstancedMesh(e.wheel, wmat, 4);
  const wMid = new THREE.InstancedMesh(e.wheelMid, wmat, 4);
  wMid.instanceMatrix = wNear.instanceMatrix;
  wNear.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wNear.boundingSphere = wMid.boundingSphere = e.wheelSphere;
  const wheelLod = new THREE.LOD();
  wheelLod.addLevel(wNear, 0);
  wheelLod.addLevel(wMid, MID_LOD_M);
  group.add(wheelLod);

  let bar = null;
  if (spec.id === 'police') {
    bar = new THREE.Mesh(lightBarGeometry(), LAMP.bar0);
    bar.position.set(e.anchors.roofX, e.anchors.roofY - 0.01, 0);
    rig.add(bar);
  }

  const glow = spec.glow ? underglow(spec) : null;
  if (glow) group.add(glow);

  group.rotation.order = 'YXZ';
  const L = spec.length;
  group.userData = {
    spec, color: col, rig, body, bodyMid, bodyLod, far, glass, glassLevels: [glassNear, glassMid],
    // head and tail are the one lamp mesh (game.js toggles both for LOD).
    head: lamps, tail: lamps, lamps, lampLevels: [lampNear, lampMid],
    wheels: [wheelLod], wheelLevels: [wNear, wMid], wheelMatrix: wNear.instanceMatrix,
    bar, barRed: bar, barBlue: bar, glowMesh: glow,
    anchors: e.anchors,
    lodFar: false,
    hf: 1, wrecked: false, ownPaint: null, glassState: 'clean', lampMat: null,
    hits: [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(-1, 0, 0, 0)], hitN: 0, hitDirty: false,
    crushF: 0, crushR: 0,
    box: new THREE.Vector4(L / 2, spec.width / 2, spec.height, 0),
    brakeOn: false, sirenOn: false, sirenPhase: -1, reverseOn: false, tailState: 0, headState: 'head',
    seed: (Math.abs(col * 0.618) % 97) + 1,
  };
  linkLod(group.userData);
  writeWheels(group.userData, 0, 0, 0, 0);
  // Only the body casts a sun shadow (wheels and lamps add draw calls to
  // the shadow pass and barely change the shadow). The flag tells the
  // graphics system the casters are already marked.
  body.castShadow = bodyMid.castShadow = far.castShadow = true;
  group.userData.rwShadow = true;
  // No matrix work per frame for the parts (docs/PLAN_V2.md 1.4, hitch
  // 7): only the group and the rig move, and updateVehicleMesh updates
  // their matrices itself, so a parked car costs nothing. Parts added
  // later (service bodies) keep their own automatic matrices.
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  return group;
}

// Write the four wheel instance matrices: rotation Ry(yaw) * Rz(spin) at
// the wheel center. Wheels 0, 1 front (right, left), 2, 3 rear.
function writeWheels(ud, steer, spin, roll, pitch) {
  const a = ud.anchors;
  const m = ud.wheelMatrix.array;
  for (let i = 0; i < 4; i++) {
    const front = i < 2, right = i % 2 === 0;
    const px = front ? a.ax : -a.ax, pz = right ? a.az : -a.az;
    const dy = -roll * pz + pitch * px;
    const py = a.wr + Math.max(-0.03, Math.min(0.035, dy * 0.45));
    const yaw = (front ? -steer : 0) + (right ? 0 : Math.PI);
    const sp = right ? -spin : spin;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cz = Math.cos(sp), sz = Math.sin(sp);
    const o = i * 16;
    m[o] = cy * cz; m[o + 1] = sz; m[o + 2] = -sy * cz; m[o + 3] = 0;
    m[o + 4] = -cy * sz; m[o + 5] = cz; m[o + 6] = sy * sz; m[o + 7] = 0;
    m[o + 8] = sy; m[o + 9] = 0; m[o + 10] = cy; m[o + 11] = 0;
    m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
  }
  ud.wheelMatrix.needsUpdate = true;
}

// Remember a hit for damage decals. (lx, ly, lz) is the direction from
// the car center to the struck point in the car's local frame; strength
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

function setLevels(list, mat) {
  for (let i = 0; i < list.length; i++) list[i].material = mat;
}

function applyDamage(ud, v) {
  const hf = ud.hf;
  const wear = 1 - hf;
  const needOwn = wear > 0.02 || ud.wrecked || ud.hits[0].w > 0 || ud.hits[1].w > 0;
  if (needOwn && !ud.ownPaint) {
    ud.ownPaint = ownPaintMaterial(ud.color, ud.box);
    ud.body.material = ud.ownPaint;
    ud.bodyMid.material = ud.ownPaint;
  }
  if (ud.ownPaint) {
    const u = ud.ownPaint.userData.rw;
    u.uDmg.value.set(Math.min(1, wear * 1.1), ud.wrecked ? 1 : 0, Math.min(1, 0.15 + wear * 1.3), ud.seed);
    u.uHit0.value.copy(ud.hits[0]);
    u.uHit1.value.copy(ud.hits[1]);
    u.uCrush.value.set(ud.crushF, ud.crushR, ud.box.x, -ud.box.x);
  }
  // Lamps follow the crumple (morph targets: head back, tail forward).
  for (let i = 0; i < ud.lampLevels.length; i++) {
    const inf = ud.lampLevels[i].morphTargetInfluences;
    if (inf) {
      inf[0] = ud.crushF;
      inf[1] = ud.crushR;
    }
  }
  // Glass: crazed once badly hurt or hit hard, blown out when wrecked.
  const hit = Math.max(ud.hits[0].w, ud.hits[1].w);
  const gst = ud.wrecked ? 'gone' : hf < 0.45 || hit > 0.85 ? 'crack' : 'clean';
  if (gst !== ud.glassState) {
    ud.glassState = gst;
    setLevels(ud.glassLevels, carGlassMaterial(gst));
  }
  ud.far.material = farMaterial(ud.color, ud.wrecked);
  setLevels(ud.wheelLevels, wheelMaterial(ud.wrecked));
  if (ud.glowMesh) ud.glowMesh.visible = !ud.wrecked;
  void v;
}

function hash(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function applyLamps(ud, time) {
  let m;
  if (ud.wrecked) {
    m = lampMaterial(false, 0, true);
  } else {
    // A damaged car's left headlight flickers; a badly damaged one runs
    // its hazards.
    let out = false;
    if (ud.hf < 0.5) {
      const k = Math.floor(time * 14);
      out = hash(k + ud.seed * 7) < 0.25 + (0.5 - ud.hf) * 1.2;
    }
    const haz = ud.hf < 0.25 && Math.floor(time * 2.6) % 2 === 0;
    m = lampMaterial(out, (ud.brakeOn ? 1 : 0) | (ud.reverseOn ? 2 : 0) | (haz ? 4 : 0));
  }
  if (m !== ud.lampMat) {
    ud.lampMat = m;
    setLevels(ud.lampLevels, m);
  }
  if (ud.bar) ud.bar.material = ud.wrecked ? LAMP.off : ud.sirenPhase === 0 ? LAMP.bar1 : ud.sirenPhase === 1 ? LAMP.bar2 : LAMP.bar0;
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

  // Body lean about a roll / pitch center a little above the ground.
  const roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, v.roll || 0));
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch || 0));
  const p = 0.45;
  const rig = ud.rig;
  rig.rotation.set(roll, 0, pitch, 'XZY');
  rig.position.set(p * Math.sin(pitch), p * (2 - Math.cos(roll) - Math.cos(pitch)), -p * Math.sin(roll));
  // Rolled over by a tank (docs/ARMS.md): squashed flat; wrecked tint.
  rig.scale.y = v.crushed ? 0.45 : 1;
  mesh.updateMatrix();
  rig.updateMatrix();

  // Wheels: spin, steer, and follow part of the body's travel.
  const steer = v.steerAngle != null ? v.steerAngle : (v.steer || 0) * (v.spec.steerMax || 0.6);
  writeWheels(ud, steer, v.wheelSpin || 0, roll, pitch);

  // Distance LOD (also driven by game.js through head.visible, and by
  // graphics.js through lodDist: the quality tier's own, nearer limit).
  if (v.lodFar != null) {
    const far = !!v.lodFar || ud.lodDist === true;
    if (far !== ud.lodFar) setVehicleLod(mesh, far);
  }

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
