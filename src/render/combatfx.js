// Combat effects: muzzle flashes with a ground-light flicker, tracers,
// bullet impacts (sparks, dust, holes), white hit stars, knock-down dust,
// explosions (fireball, smoke column, shock ring, debris, camera shake),
// flames and smoke on burning craft, rocket trails, shell eject and
// bullet-hole / scorch decals. Listens to the combat events in
// docs/COMBAT.md. Blood is allowed (red bursts, ground pools that fade);
// dismemberment never. Vehicle wrecks break into pooled debris chunks.
//
// Reuses the particle pools of effects.js (one alpha, one additive
// instanced billboard system, same atlas and shaders) plus two instanced
// decal meshes and one debris mesh: a few extra draw calls in all. Everything is pooled and
// counts scale with game.quality. Logic is guarded so it still runs when
// `scene` is missing (node tests).
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { makeAtlas, createPool, emitP, tintP, stepPool, writePool, nightAt, GROUND_VERT, GROUND_FRAG } from './effects.js';
import { PARTS_MAX, PART, createParts, addPart, launchCarParts, stepParts, partScale, liveParts } from './carparts.js';
import { BLAST, ROLL_V, ROLL_S0, ROLL_S1, blastScale, fireRadius, shakeAt, dustTone } from './blastplan.js';
import { createEdgeLineView } from './props.js';

// Props sheared by cars (docs/PLAN_V3.md 2.2 item 2): a falling piece from
// the wreck part pool, at most PROP_PIECES_MAX alive; a hydrant sprays.
export const PROP_PIECES_MAX = 8, PROP_PIECE_LIFE = 4, SPRAYS_MAX = 4;
const BREAK_HEX = { lamp: 0x4a4e52, meter: 0x55585c, stopsign: 0x8a9096, namesign: 0x6a7076, streetsign: 0x6a7076, umbrella: 0xe8e4dc, bench: 0x8a6a48, bin: 0x2f4a3a, hydrant: 0xc8382c, mailbox: 0x2c4f8a, bikes: 0x9aa0a6, fence: 0x8a8a84, gate: 0x7a7a74, pallet: 0x9a7a55, shrub: 0x4a8a3e };

const MAX_ALPHA = 420;
const MAX_ADD = 300;
const SCORCH = 24; // matches CAPS.decals in combat.js
const HOLES = 40;
export const SCORCH_LIFE = 120, SCORCH_FADE = 5; // REVAMP 6.7 layer 8: the scorch stays
const DECALS = SCORCH + HOLES;
// Blood: two ring buffers (pools under the dead, small spatters from hits).
export const BLOOD_POOLS = 16;
export const BLOOD_SPLATS = 24;
const BLOOD = BLOOD_POOLS + BLOOD_SPLATS;
// A pool lasts as long as its body (combat BODY_LIE_T 30 s + the 1 s fade).
export const POOL_LIFE = 31, POOL_GROW = 1.6, POOL_FADE = 1.5;
const SPLAT_LIFE = 12, SPLAT_FADE = 4;
// Wreck parts (carparts.js): a pool of 96, drawn as three instanced meshes
// (boxes for chunks, hoods, bumpers and panels; doors; wheels).
export const DEBRIS_MAX = PARTS_MAX;
const NEAR = 170; // meters from the camera where small effects are made

// Atlas cells: 0 puff, 1 ring, 2 streak, 3 glow. +4 flat on the ground, +8 stretched.
const PUFF = 0, RING = 1, STREAK = 2, GLOW = 3;

const BLOOD_VERT = /* glsl */`
attribute float iOp;
attribute float iSeed;
varying vec2 vUv;
varying float vOp;
varying float vSeed;
void main() {
  vUv = uv;
  vOp = iOp;
  vSeed = iSeed;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const BLOOD_FRAG = /* glsl */`
varying vec2 vUv;
varying float vOp;
varying float vSeed;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float rim = 0.74 + 0.26 * sin(a * 5.0 + vSeed) * sin(a * 3.0 - vSeed * 1.7);
  float k = smoothstep(rim, rim * 0.4, r);
  float al = k * min(1.0, vOp) * 0.9;
  if (al < 0.01) discard;
  float shade = 0.85 + 0.15 * sin(a * 9.0 + vSeed * 3.0);
  gl_FragColor = vec4(0.58 * shade, 0.02, 0.03, al);
}
`;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Merge boxes and cylinders into one geometry with a vertex color per piece.
function mergeShaded(pieces) {
  let nv = 0, ni = 0;
  for (const [g] of pieces) {
    nv += g.attributes.position.count;
    ni += g.index.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = new Uint16Array(ni);
  let v = 0, k = 0;
  for (const [g, shade] of pieces) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    pos.set(p, v * 3);
    nor.set(n, v * 3);
    for (let i = 0; i < g.attributes.position.count; i++) col[(v + i) * 3] = col[(v + i) * 3 + 1] = col[(v + i) * 3 + 2] = shade;
    for (let i = 0; i < ix.length; i++) idx[k + i] = ix[i] + v;
    v += g.attributes.position.count;
    k += ix.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
// A door lying flat (thin on y): the lower panel in the paint, the window
// frame dark, a handle.
function whiteColors(geo) {
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  return geo;
}

function doorGeometry() {
  const lower = new THREE.BoxGeometry(1, 1, 0.58).translate(0, 0, 0.21);
  const pillarA = new THREE.BoxGeometry(0.1, 0.9, 0.42).translate(-0.45, 0, -0.29);
  const pillarB = new THREE.BoxGeometry(0.1, 0.9, 0.42).translate(0.45, 0, -0.29);
  const top = new THREE.BoxGeometry(1, 0.9, 0.08).translate(0, 0, -0.46);
  const glass = new THREE.BoxGeometry(0.8, 0.4, 0.34).translate(0, 0, -0.29);
  const handle = new THREE.BoxGeometry(0.16, 1.5, 0.05).translate(0.3, 0, 0.02);
  return mergeShaded([[lower, 1], [pillarA, 0.9], [pillarB, 0.9], [top, 0.9], [glass, 0.06], [handle, 0.25]]);
}
// A wheel (axis on y, so it lies on its side): tire, rim, hub.
function wheelGeometry() {
  const tire = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  const rim = new THREE.CylinderGeometry(0.33, 0.33, 1.04, 12);
  const hub = new THREE.CylinderGeometry(0.1, 0.1, 1.08, 8);
  return mergeShaded([[tire, 0.08], [rim, 0.72], [hub, 0.35]]);
}

export function createCombatFx(game) {
  const scene = game && game.scene;
  const camera = game && game.camera;
  const rng = createRng(0xc0b47);
  const rnd = () => rng.next();
  const rs = () => rng.next() * 2 - 1;

  let S = null; // alpha pool
  let G = null; // additive pool
  let atlas = null;
  let decalMesh = null;
  let decalOp = null;
  let bloodMesh = null;
  let bloodOp = null;
  let debrisMesh = null;
  let doorMesh = null;
  let wheelMesh = null;
  let offs = [];
  let time = 0;
  let tick = 0;

  if (scene && typeof document !== 'undefined') {
    atlas = makeAtlas();
    S = createPool(MAX_ALPHA, false, atlas, scene);
    G = createPool(MAX_ADD, true, atlas, scene);
    S.mesh.name = 'cfx-smoke';
    G.mesh.name = 'cfx-add';
    const geo = new THREE.PlaneGeometry(1, 1);
    decalOp = new THREE.InstancedBufferAttribute(new Float32Array(DECALS), 1);
    decalOp.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOp', decalOp);
    // The contact shadows' program (effects.js), its scorch part on.
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uDecal: { value: 1 } },
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    decalMesh = new THREE.InstancedMesh(geo, mat, DECALS);
    decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    decalMesh.frustumCulled = false;
    decalMesh.renderOrder = 3;
    decalMesh.name = 'cfx-decals';
    decalMesh.visible = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < DECALS; i++) decalMesh.setMatrixAt(i, zero);
    scene.add(decalMesh);

    const bgeo = new THREE.PlaneGeometry(1, 1);
    bloodOp = new THREE.InstancedBufferAttribute(new Float32Array(BLOOD), 1);
    bloodOp.setUsage(THREE.DynamicDrawUsage);
    const bseed = new THREE.InstancedBufferAttribute(new Float32Array(BLOOD), 1);
    for (let i = 0; i < BLOOD; i++) bseed.array[i] = rng.next() * 6.28;
    bgeo.setAttribute('iOp', bloodOp);
    bgeo.setAttribute('iSeed', bseed);
    const bmat = new THREE.ShaderMaterial({
      vertexShader: BLOOD_VERT,
      fragmentShader: BLOOD_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    bloodMesh = new THREE.InstancedMesh(bgeo, bmat, BLOOD);
    bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bloodMesh.frustumCulled = false;
    bloodMesh.renderOrder = 4;
    bloodMesh.name = 'cfx-blood';
    bloodMesh.visible = false;
    const zero2 = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < BLOOD; i++) bloodMesh.setMatrixAt(i, zero2);
    scene.add(bloodMesh);

    // Parts: boxes (plain color), doors (a window band) and wheels (a dark
    // tire round a light hub), the last two shaded by vertex color.
    const mk = (geo, vc, name) => {
      // Plain boxes get white vertex colors: the same program as the
      // shaded parts (color times 1 is the color).
      if (!vc) whiteColors(geo);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), DEBRIS_MAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const c0 = new THREE.Color(0x333333);
      for (let i = 0; i < DEBRIS_MAX; i++) {
        m.setColorAt(i, c0);
        m.setMatrixAt(i, zero2);
      }
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.name = name;
      m.visible = false;
      scene.add(m);
      return m;
    };
    debrisMesh = mk(new THREE.BoxGeometry(1, 1, 1), false, 'cfx-parts');
    doorMesh = mk(doorGeometry(), true, 'cfx-doors');
    wheelMesh = mk(wheelGeometry(), true, 'cfx-wheels');
  }

  const q = () => clamp(game.quality == null ? 1 : +game.quality || 1, 0.25, 1);
  const seaY = () => (Number.isFinite(game.seaY) ? game.seaY : -0.6);
  const cam = () => (camera && camera.position ? camera.position : null);

  // Distance from the camera (or the player) to a point, squared.
  function dist2(x, z) {
    const c = cam();
    let cx = 0, cz = 0;
    if (c) {
      cx = c.x;
      cz = c.z;
    } else if (game.player) {
      cx = game.player.x || 0;
      cz = game.player.z || 0;
    }
    return (x - cx) * (x - cx) + (z - cz) * (z - cz);
  }
  const near = (x, z) => dist2(x, z) < NEAR * NEAR;

  // ---- emit helpers (return the particle index, or -1) ----
  function add(x, y, z, vx, vy, vz, life, s0, s1, a, r, g, b, cell, grav = 0, drag = 0) {
    if (!G) return -1;
    const i = emitP(G, x, y, z, vx, vy, vz, life, s0, s1, a, r, g, b, cell, grav, drag);
    if (i >= 0) G.fadeIn[i] = 0;
    return i;
  }
  function alpha(x, y, z, vx, vy, vz, life, s0, s1, a, r, g, b, cell, grav = 0, drag = 1.5, fade = 0.15) {
    if (!S) return -1;
    const i = emitP(S, x, y, z, vx, vy, vz, life, s0, s1, a, r, g, b, cell, grav, drag);
    if (i >= 0) S.fadeIn[i] = fade;
    return i;
  }
  const fixRot = (P, i, rot) => {
    if (i >= 0) {
      P.rot[i] = rot;
      P.rotV[i] = 0;
    }
  };
  // A star: two crossed streaks and a glow, white, no color cast.
  function star(x, y, z, size, life, r = 1, g = 1, b = 1) {
    add(x, y, z, 0, 0, 0, life * 0.8, size * 0.5, size * 0.9, 1.6, r, g, b, GLOW);
    const k = rnd() * 3.14;
    fixRot(G, add(x, y, z, 0, 0, 0, life, size * 0.6, size * 1.5, 1.4, r, g, b, STREAK), k);
    fixRot(G, add(x, y, z, 0, 0, 0, life, size * 0.5, size * 1.2, 1.1, r, g, b, STREAK), k + 1.57);
  }
  function dust(x, y, z, vx, vy, vz, life, s0, s1, a, tone = 0.7) {
    return alpha(x, y, z, vx, vy, vz, life, s0, s1, a, tone, tone * 0.95, tone * 0.85, PUFF, -0.2, 2.2);
  }

  // ---- decals ----
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const seenT = new Float32Array(SCORCH).fill(-1e9);
  const sBirth = new Float32Array(SCORCH).fill(-1);
  const sSize = new Float32Array(SCORCH), sOp = new Float32Array(SCORCH), sYaw = new Float32Array(SCORCH);
  let holeHead = 0;
  let decalCount = 0;
  function putDecal(slot, x, y, z, yaw, pitch, size, op) {
    if (!decalMesh) return;
    _e.set(pitch, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(size, size, 1);
    _m.compose(_p, _q, _s);
    decalMesh.setMatrixAt(slot, _m);
    decalOp.array[slot] = op;
    decalOp.needsUpdate = true;
    decalMesh.instanceMatrix.needsUpdate = true;
    decalMesh.visible = true;
    decalCount++;
  }
  function hole(x, y, z, nx, nz, flat) {
    if (!decalMesh) return;
    const slot = SCORCH + holeHead;
    holeHead = (holeHead + 1) % HOLES;
    const size = 0.16 + rnd() * 0.1;
    const op = 0.6 + rnd() * 0.4;
    if (flat) putDecal(slot, x, 0.035, z, rnd() * 6.28, -Math.PI / 2, size * 1.2, op);
    else putDecal(slot, x + nx * 0.02, y, z + nz * 0.02, Math.atan2(nx, nz), 0, size, op);
  }
  function syncScorch() {
    const d = game.combat && game.combat.decals;
    if (!d || !decalMesh) return;
    for (let i = 0; i < SCORCH; i++) {
      const t = d.t[i];
      if (t === seenT[i]) continue;
      seenT[i] = t;
      if (t < -1e8) continue;
      sBirth[i] = time;
      sSize[i] = Math.max(2, d.r[i] * 2.5);
      sOp[i] = 0.7 + rnd() * 0.5;
      sYaw[i] = rnd() * 6.28;
      putDecal(i, d.x[i], 0.03, d.z[i], sYaw[i], -Math.PI / 2, sSize[i], sOp[i]);
    }
    // Scorch stays SCORCH_LIFE s, then fades over SCORCH_FADE s (checked twice a second).
    if (tick % 30 !== 0) return;
    for (let i = 0; i < SCORCH; i++) {
      if (sBirth[i] < 0) continue;
      const age = time - sBirth[i];
      if (age < SCORCH_LIFE) continue;
      const k = 1 - (age - SCORCH_LIFE) / SCORCH_FADE;
      if (k <= 0) {
        sBirth[i] = -1;
        putDecal(i, 0, 0.03, 0, 0, -Math.PI / 2, 0.0001, 0);
      } else putDecal(i, d.x[i], 0.03, d.z[i], sYaw[i], -Math.PI / 2, sSize[i], sOp[i] * k);
    }
  }

  // ---- blood: pools under the dead and spatters from hits ----
  // Plain typed-array ring buffers (they work without a scene); the
  // instanced mesh just mirrors them.
  const bx = new Float32Array(BLOOD), bz = new Float32Array(BLOOD);
  const bt = new Float32Array(BLOOD).fill(-1e9); // birth time
  const bsz = new Float32Array(BLOOD), bya = new Float32Array(BLOOD);
  let poolHead = 0, splatHead = 0;
  function putBlood(slot, op, size) {
    if (!bloodMesh) return;
    _e.set(-Math.PI / 2, bya[slot], 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(bx[slot], 0.045 + (slot < BLOOD_POOLS ? 0 : 0.004), bz[slot]);
    _s.set(size, size, 1);
    _m.compose(_p, _q, _s);
    bloodMesh.setMatrixAt(slot, _m);
    bloodOp.array[slot] = op;
  }
  function bloodAdd(pool, x, z, size) {
    const slot = pool ? poolHead : BLOOD_POOLS + splatHead;
    if (pool) poolHead = (poolHead + 1) % BLOOD_POOLS;
    else splatHead = (splatHead + 1) % BLOOD_SPLATS;
    bx[slot] = x;
    bz[slot] = z;
    bt[slot] = time;
    bsz[slot] = size;
    bya[slot] = rnd() * 6.28;
    if (pool) putBlood(slot, 1, size * 0.35);
    else putBlood(slot, 1, size);
    if (bloodMesh) {
      bloodOp.needsUpdate = true;
      bloodMesh.instanceMatrix.needsUpdate = true;
      bloodMesh.visible = true;
    }
  }
  // A body revived by an ambulance (src/systems/service.js): its pool and
  // spatters within 2.5 m go at once.
  function onRevived(e) {
    if (!e) return;
    for (let i = 0; i < BLOOD; i++) {
      if (bt[i] < -1e8 || Math.hypot(bx[i] - e.x, bz[i] - e.z) > 2.5) continue;
      bt[i] = -1e9;
      if (bloodMesh) {
        _m.makeScale(0, 0, 0);
        bloodMesh.setMatrixAt(i, _m);
        bloodOp.array[i] = 0;
        bloodOp.needsUpdate = true;
        bloodMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  function stepBlood() {
    let dirty = false;
    for (let i = 0; i < BLOOD; i++) {
      if (bt[i] < -1e8) continue;
      const age = time - bt[i];
      const pool = i < BLOOD_POOLS;
      const life = pool ? POOL_LIFE : SPLAT_LIFE;
      if (age >= life) {
        bt[i] = -1e9;
        if (bloodMesh) {
          _m.makeScale(0, 0, 0);
          bloodMesh.setMatrixAt(i, _m);
          bloodOp.array[i] = 0;
          dirty = true;
        }
        continue;
      }
      if (!bloodMesh || (tick & 1)) continue;
      const fade = pool ? POOL_FADE : SPLAT_FADE;
      const op = Math.min(1, (life - age) / fade);
      const gk = pool ? Math.min(1, age / POOL_GROW) : Math.min(1, age / 0.4);
      putBlood(i, op, bsz[i] * (pool ? 0.35 + 0.65 * (1 - (1 - gk) * (1 - gk)) : 0.7 + 0.3 * gk));
      dirty = true;
    }
    if (dirty && bloodMesh) {
      bloodOp.needsUpdate = true;
      bloodMesh.instanceMatrix.needsUpdate = true;
    }
  }
  function liveCount(arr, lim, below) {
    let n = 0;
    for (let i = 0; i < arr.length; i++) if (below ? arr[i] > lim : arr[i] >= lim) n++;
    return n;
  }
  const RED = [0.5, 0.02, 0.03];
  function droplets(x, y, z, n, speed, up) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, sp = speed * (0.4 + rnd() * 0.8);
      const j = alpha(x, y, z, Math.cos(a) * sp, up * (0.4 + rnd()), Math.sin(a) * sp, 0.55 + rnd() * 0.35, 0.09 + rnd() * 0.05, 0.07, 1, RED[0] * (0.7 + rnd() * 0.5), RED[1], RED[2], GLOW, 9.8, 0.4, 0);
      if (j >= 0) S.floor[j] = 0.03;
    }
  }
  const isPerson = (t) => !!t && !(t.spec && t.hp === undefined);
  function bloodHit(e) {
    if (game.progress && game.progress.settings && game.progress.settings.blood === false) return;
    const t = e.target;
    if (!isPerson(t)) return;
    const k = e.kind;
    if (k === 'blast' || k === 'fire') return;
    bloodAdd(false, t.x + rs() * 0.6, t.z + rs() * 0.6, 0.55 + rnd() * 0.4);
    if (!near(e.x, e.z)) return;
    const n = Math.max(2, Math.round((k === 'melee' || k === 'ram' ? 5 : 4) * q()));
    droplets(e.x, e.y, e.z, n, 2.2, 3);
  }
  function bloodDeath(t, kind) {
    if (game.progress && game.progress.settings && game.progress.settings.blood === false) return;
    const big = kind === 'blast';
    bloodAdd(true, t.x + rs() * 0.3, t.z + rs() * 0.3, big ? 3.2 : 2.3);
    const extra = big ? 3 : 1;
    for (let i = 0; i < extra; i++) bloodAdd(false, t.x + rs() * 1.8, t.z + rs() * 1.8, 0.5 + rnd() * 0.6);
    if (!near(t.x, t.z)) return;
    const n = Math.max(5, Math.round((big ? 22 : 12) * q()));
    droplets(t.x, (t.y || 0) + 1.0, t.z, n, big ? 5 : 3.2, big ? 7 : 4);
  }

  // ---- wreck parts (carparts.js): doors, wheels, hood, bumper, chunks ----
  const parts = createParts(DEBRIS_MAX);
  const partShown = new Uint8Array(DEBRIS_MAX); // 0 none, 1 box, 2 door, 3 wheel: which mesh holds slot i
  const partSeen = new Int32Array(DEBRIS_MAX).fill(-1);
  const _col = THREE.Color ? new THREE.Color() : null;
  const PRNG = createRng(0x9a27);
  // A loose chunk (props hit by a blast).
  function chunk(x, y, z, vx, vy, vz, sx, sy, sz, hex) {
    const h = Math.sqrt(vx * vx + vz * vz);
    addPart(parts, PART.chunk, x, y, z, Math.sqrt(h * h + vy * vy), Math.atan2(vy, h), Math.atan2(vz, vx), sx, sy, sz, hex, PRNG);
  }
  // 14 to 18 parts per car (tanks, boats and aircraft throw the same mix).
  function wreckDebris(c, x, y, z) {
    landsPer[parts.seq & 63] = 0;
    launchCarParts(parts, c, x, y, z);
  }
  // First ground hit: sparks and dust; at most 4 clatters per blast for audio.
  const LAND = { x: 0, z: 0, part: 'chunk', speed: 0 };
  const PART_NAME = ['chunk', 'door', 'wheel', 'hood', 'bumper', 'panel'];
  const landsPer = new Uint8Array(64);
  function onPartLand(i, sp) {
    const x = parts.x[i], z = parts.z[i];
    if (near(x, z) && sp > 3) {
      const n = Math.max(2, Math.round(5 * q()));
      for (let k = 0; k < n; k++) add(x, 0.1, z, rs() * 4, 1 + rnd() * 3, rs() * 4, 0.25 + rnd() * 0.3, 0.14, 0.05, 2.2, 1, 0.75, 0.3, STREAK + 8, 9.8, 0.5);
      dust(x, 0.2, z, rs() * 0.6, 0.5 + rnd() * 0.4, rs() * 0.6, 0.8, 0.3, 1.3, 0.4, 0.55);
    }
    const b = parts.blast[i];
    const slot = b < 0 ? -1 : b & 63;
    if (slot >= 0 && landsPer[slot] >= 4) return;
    if (slot >= 0) landsPer[slot]++;
    LAND.x = x;
    LAND.z = z;
    LAND.part = PART_NAME[parts.kind[i]] || 'chunk';
    LAND.speed = sp;
    if (game.events && game.events.emit) game.events.emit('partLand', LAND);
  }
  function stepDebris(dt) {
    stepParts(parts, dt, onPartLand);
    if (!debrisMesh) return;
    let dirtyC = 0;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const live = parts.age[i] >= 0;
      const want = !live ? 0 : parts.kind[i] === PART.door ? 2 : parts.kind[i] === PART.wheel ? 3 : 1;
      const mesh = want === 2 ? doorMesh : want === 3 ? wheelMesh : debrisMesh;
      if (partShown[i] !== want || (live && partSeen[i] !== parts.gen[i])) {
        // Moved to another mesh (or freed): hide it in the old one.
        if (partShown[i]) {
          const old = partShown[i] === 2 ? doorMesh : partShown[i] === 3 ? wheelMesh : debrisMesh;
          _m.makeScale(0, 0, 0);
          old.setMatrixAt(i, _m);
          old.instanceMatrix.needsUpdate = true;
        }
        partShown[i] = want;
        if (live) {
          partSeen[i] = parts.gen[i];
          _col.setHex(parts.col[i]);
          mesh.setColorAt(i, _col);
          mesh.instanceColor.needsUpdate = true;
          mesh.visible = true;
          dirtyC++;
        }
      }
      if (!live) continue;
      const sc = partScale(parts, i);
      _e.set(parts.rx[i], parts.ry[i], parts.rz[i]);
      _q.setFromEuler(_e);
      _p.set(parts.x[i], parts.y[i], parts.z[i]);
      _s.set(parts.sx[i] * sc, parts.sy[i] * sc, parts.sz[i] * sc);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    return dirtyC;
  }

  // ---- weapons ----
  const FLASH = {
    pistol: { s: 0.8, glow: 3.5, sparks: 2, smoke: 0, shell: true },
    smg: { s: 0.7, glow: 3.2, sparks: 2, smoke: 0, shell: true },
    scatter: { s: 1.5, glow: 6, sparks: 7, smoke: 1, shell: true },
    lobber: { s: 1.8, glow: 7, sparks: 5, smoke: 3, shell: false },
  };
  let lastFlashT = -1;
  let lastFlashW = '';
  function muzzle(w, x, y, z, dx, dy, dz) {
    const f = FLASH[w];
    if (!f) return;
    const qq = q();
    // Pellets of one shotgun blast share a single flash.
    if (lastFlashT === time && lastFlashW === w && w === 'scatter') return;
    lastFlashT = time;
    lastFlashW = w;
    const fx = x + dx * 0.35, fy = y + dy * 0.35, fz = z + dz * 0.35;
    add(fx, fy, fz, 0, 0, 0, 0.07, f.s * 0.7, f.s * 1.3, 1.6, 1, 0.82, 0.45, GLOW);
    const k = rnd() * 3.14;
    fixRot(G, add(fx + dx * 0.2, fy, fz + dz * 0.2, 0, 0, 0, 0.06, f.s * 0.6, f.s * 1.6, 1.4, 1, 0.9, 0.6, STREAK), k);
    fixRot(G, add(fx + dx * 0.2, fy, fz + dz * 0.2, 0, 0, 0, 0.06, f.s * 0.5, f.s * 1.3, 1.2, 1, 0.85, 0.5, STREAK), k + 1.57);
    // Light flicker: a wide, faint glow that lights the air and the ground around.
    add(fx, fy, fz, 0, 0, 0, 0.09, f.glow * (0.8 + rnd() * 0.4), f.glow * 1.4, 0.2 + rnd() * 0.12, 1, 0.7, 0.35, GLOW);
    const ns = Math.max(1, Math.round(f.sparks * qq));
    for (let i = 0; i < ns; i++) {
      const sp = 9 + rnd() * 12;
      add(fx, fy, fz, dx * sp + rs() * 2.5, dy * sp + rs() * 2.5, dz * sp + rs() * 2.5, 0.12 + rnd() * 0.08, 0.14, 0.05, 2, 1, 0.8, 0.35, STREAK + 8, 4, 1);
    }
    for (let i = 0; i < Math.round(f.smoke * qq); i++) {
      alpha(fx + dx * 0.4, fy, fz + dz * 0.4, dx * (2 + rnd() * 2) + rs() * 0.6, 0.4 + rnd() * 0.4, dz * (2 + rnd() * 2) + rs() * 0.6, 0.7 + rnd() * 0.4, 0.2, 0.9, 0.35, 0.85, 0.85, 0.85, PUFF, -0.3, 2.5);
    }
    if (f.shell && qq >= 0.5) {
      const sp = 1.5 + rnd();
      const j = alpha(x - dz * 0.1, y - 0.05, z + dx * 0.1, -dz * sp + rs() * 0.4, 1.8 + rnd(), dx * sp + rs() * 0.4, 0.7, 0.07, 0.06, 1, 0.95, 0.72, 0.28, GLOW, 9.8, 0.3, 0);
      if (j >= 0) S.floor[j] = 0.03;
    }
  }

  function tracer(w, x, y, z, dx, dy, dz, hx, hy, hz) {
    if (w === 'wrench' || w === 'lobber' || w === 'fizz') return;
    const qq = q();
    if (qq < 0.5 && (tick & 1)) return;
    const ex = hx - x, ey = hy - y, ez = hz - z;
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist < 4 || !near(x, z)) return;
    const speed = 95;
    const j = add(x + dx * 1.2, y + dy * 1.2, z + dz * 1.2, dx * speed, dy * speed, dz * speed,
      Math.min(0.55, Math.max(0.04, (dist - 1.2) / speed)), 0.5, 0.5, 1.5, 1, 0.9, 0.55, STREAK + 8);
    if (j >= 0) G.rotV[j] = 0;
  }

  // Bullet strikes on walls and ground.
  function impact(kind, hx, hy, hz, dx, dy, dz) {
    if (!near(hx, hz)) return;
    const qq = q();
    const hl = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dx / hl, nz = -dz / hl; // faces back toward the shooter
    if (kind === 'wall') {
      star(hx + nx * 0.05, hy, hz + nz * 0.05, 0.4, 0.09, 1, 0.9, 0.6);
      const n = Math.max(1, Math.round(4 * qq));
      for (let i = 0; i < n; i++) {
        const sp = 3 + rnd() * 5;
        add(hx + nx * 0.05, hy, hz + nz * 0.05, nx * sp + rs() * 2.5, 1 + rnd() * 3, nz * sp + rs() * 2.5, 0.25 + rnd() * 0.3, 0.13, 0.05, 2.2, 1, 0.7 + rnd() * 0.2, 0.3, STREAK + 8, 9.8, 0.5);
      }
      dust(hx + nx * 0.1, hy, hz + nz * 0.1, nx * 0.8 + rs() * 0.4, 0.4 + rnd() * 0.4, nz * 0.8 + rs() * 0.4, 0.55 + rnd() * 0.3, 0.2, 0.9, 0.5, 0.72);
      if (qq > 0.6) dust(hx + nx * 0.1, hy, hz + nz * 0.1, nx * 0.4, 0.2, nz * 0.4, 0.8, 0.15, 0.7, 0.35, 0.6);
      hole(hx, hy, hz, nx, nz, false);
    } else if (hy < seaY() + 0.25 && hy < -0.1) {
      // water: a small white splash
      for (let i = 0; i < Math.max(2, Math.round(4 * qq)); i++) {
        alpha(hx, hy, hz, rs() * 0.8, 2 + rnd() * 1.5, rs() * 0.8, 0.5, 0.15, 0.4, 0.8, 0.93, 0.96, 0.98, PUFF, 9.8, 0.6, 0.05);
      }
    } else {
      add(hx, 0.05, hz, 0, 0, 0, 0.07, 0.3, 0.6, 1.2, 1, 0.85, 0.5, GLOW);
      dust(hx, 0.1, hz, rs() * 0.5, 0.9 + rnd() * 0.6, rs() * 0.5, 0.7 + rnd() * 0.3, 0.25, 1.1, 0.55, 0.62);
      const n = Math.max(1, Math.round(3 * qq));
      for (let i = 0; i < n; i++) {
        const j = alpha(hx, 0.05, hz, rs() * 2, 2 + rnd() * 2, rs() * 2, 0.6, 0.07, 0.06, 1, 0.38, 0.32, 0.26, GLOW, 9.8, 0.3, 0);
        if (j >= 0) S.floor[j] = 0.03;
      }
      if (qq > 0.5) {
        for (let i = 0; i < 2; i++) add(hx, 0.08, hz, rs() * 3, 1.5 + rnd() * 2, rs() * 3, 0.3, 0.12, 0.05, 2, 1, 0.75, 0.3, STREAK + 8, 9.8, 0.5);
      }
      hole(hx, 0, hz, 0, 0, true);
    }
  }

  // A hit on a person (stars, no color) or a craft (sparks).
  function onHit(e) {
    const t = e.target;
    const k = e.kind;
    if (!t || k === 'blast' || k === 'fire') return;
    bloodHit(e);
    if (!near(e.x, e.z)) return;
    const qq = q();
    const isCraft = !!(t.spec && t.hp === undefined);
    if (isCraft) {
      if (k === 'ram') return;
      const n = Math.max(2, Math.round(5 * qq));
      for (let i = 0; i < n; i++) {
        add(e.x, e.y, e.z, rs() * 5, 1 + rnd() * 4, rs() * 5, 0.25 + rnd() * 0.3, 0.14, 0.05, 2.2, 1, 0.75, 0.3, STREAK + 8, 9.8, 0.5);
      }
      star(e.x, e.y, e.z, 0.5, 0.09, 1, 0.9, 0.65);
      if (k === 'bullet') hole(e.x, e.y, e.z, 0, 0, true);
      return;
    }
    const big = k === 'melee' || k === 'ram';
    star(e.x, e.y, e.z, big ? 1.1 : 0.75, big ? 0.17 : 0.13);
    if (big) {
      add(e.x, e.y, e.z, 0, 0, 0, 0.2, 0.3, 1.5, 0.7, 1, 1, 1, RING);
    }
    const n = Math.max(1, Math.round((big ? 5 : 3) * qq));
    for (let i = 0; i < n; i++) {
      add(e.x, e.y, e.z, rs() * 3, 0.5 + rnd() * 2, rs() * 3, 0.14 + rnd() * 0.1, 0.18, 0.05, 1.6, 1, 1, 1, GLOW, 4, 1);
    }
    dust(e.x, e.y - 0.2, e.z, rs() * 0.4, 0.3, rs() * 0.4, 0.45, 0.2, 0.7, 0.35, 0.85);
  }

  function onDown(e) {
    const t = e.target;
    if (!t || (t.spec && t.hp === undefined)) return;
    if (t.hp <= 0 || t.hp === undefined) bloodDeath(t, e.kind);
    if (!near(t.x, t.z)) return;
    const n = Math.max(2, Math.round(5 * q()));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + rnd();
      dust(t.x + Math.cos(a) * 0.2, 0.12, t.z + Math.sin(a) * 0.2, Math.cos(a) * (1.2 + rnd()), 0.25 + rnd() * 0.3, Math.sin(a) * (1.2 + rnd()), 0.7 + rnd() * 0.3, 0.3, 1.3, 0.5, 0.74);
    }
  }
  function onOut(e) {
    const t = e.target;
    if (!t || (t.spec && t.hp === undefined) || !near(t.x, t.z)) return;
    const n = Math.max(2, Math.round(4 * q()));
    for (let i = 0; i < n; i++) {
      dust(t.x + rs() * 0.4, 0.3, t.z + rs() * 0.4, rs() * 0.3, 0.8 + rnd() * 0.5, rs() * 0.3, 1.1, 0.35, 1.2, 0.35, 0.9);
    }
    add(t.x, 1.0, t.z, 0, 0.6, 0, 0.5, 0.3, 0.9, 0.7, 1, 1, 1, GLOW);
  }

  // ---- explosions ----
  // A cinematic blast from the two shared particle pools (no new draw
  // calls): a one-step flash, a layered fireball (hot core, orange body
  // and red-to-black billows that cool into smoke), a fast ground
  // shockwave and dust skirt, sparks and slow embers with gravity, a
  // rising smoke column that lingers 6 to 10 s and thins, scorch on the
  // ground, and camera shake scaled by distance (off with Reduce motion).
  const MAX_COLUMNS = 6;
  const cols = [];
  for (let i = 0; i < MAX_COLUMNS; i++) cols.push({ on: false, x: 0, y: 0, z: 0, t: 0, dur: 0, k: 1, acc: 0, n: 0 });
  let colHead = 0;
  let reduced = null;
  function reduceMotion() {
    if (reduced === null) {
      reduced = false;
      try {
        const st = game.progress && game.progress.settings;
        if (st && st.reduceMotion) reduced = true;
        else if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) reduced = true;
      } catch {
        reduced = false;
      }
    }
    return !!(game.progress && game.progress.settings && game.progress.settings.reduceMotion) || reduced;
  }
  // Shake kick for a blast at visual scale vs seen from d m: chasecam trauma
  // 1 at the center, a straight line to 0 at 60 m (REVAMP 6.7 layer 10).
  // kick(strength) adds (strength - 1.5) / 18 trauma.
  function shakeFor(vs, d) {
    const t = shakeAt(vs, d);
    return t > 0 ? 1.5 + 18 * t : 0;
  }
  // Small props near a blast (bins, benches, boxes) throw a few chunks.
  const PROP_HEX = { bin: 0x2f4a3a, bench: 0x8a6a48, hydrant: 0xb23a2c, mailbox: 0x2d4f8a, planter: 0x6a5a48, barrier: 0xd7a02b, meter: 0x555a60, bikes: 0x444444 };
  function scatterProps(x, z, r) {
    const list = game.city && game.city.furniture;
    if (!list || !debrisMesh) return;
    let n = 0;
    const lim = r * 1.2;
    for (let i = 0; i < list.length && n < 5; i++) {
      const f = list[i];
      const dx = f.x - x, dz = f.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > lim * lim) continue;
      const d = Math.sqrt(d2) || 1;
      const k = 1 - d / lim;
      const hex = PROP_HEX[f.type] || 0x666666;
      chunk(f.x, 0.4, f.z, (dx / d) * (5 + 9 * k), 4 + 7 * k, (dz / d) * (5 + 9 * k), 0.28, 0.3, 0.28, hex);
      n++;
    }
  }
  // Live blasts: the smoke roll starts BLAST.roll.t0 after the flash.
  const MAX_BLASTS = 4;
  const blasts = [];
  for (let i = 0; i < MAX_BLASTS; i++) blasts.push({ on: false, x: 0, y: 0, z: 0, vs: 1, t: 0, rolled: false, air: false });
  let blastHead = 0;
  // Layer counts of the last blast (tests and the shot scripts read them).
  const last = { flash: 0, light: 0, fire: 0, roll: 0, ring: 0, dust: 0, sparks: 0, vs: 0 };
  function onExplosion(e) {
    const x = e.x, y = Math.max(0, e.y), z = e.z;
    const R = Math.max(3, e.radius || 6);
    const vs = blastScale(R, e.scale, !!e.craft);
    const d2 = dist2(x, z);
    const dd = Math.sqrt(d2);
    if (!e.puff && game.chase && game.chase.kick && !reduceMotion()) {
      const sh = shakeFor(vs, dd);
      if (sh > 1.5) game.chase.kick(sh);
    }
    if (e.craft) wreckDebris(e.craft, x, y, z);
    if (e.puff) {
      for (let i = 0; i < 4; i++) dust(x + rs(), y + 0.3, z + rs(), rs() * 2, 1 + rnd() * 2, rs() * 2, 0.8, 0.6, 2, 0.5, 0.45);
      return;
    }
    if (!e.puff) scatterProps(x, z, R);
    if (d2 > 240 * 240) return;
    const qq = q();
    const air = y > 3;
    const gy = air ? y : (y < 0.5 ? 0.4 : y);
    const calm = reduceMotion() ? 0.5 : 1; // softer flash with Reduce motion
    last.vs = vs;
    let n = 0;
    // 1. Flash (frame 0) and the warm light it throws on the street and the
    // walls round it for 0.35 s: a flat glow 60 m across on the ground and a
    // soft upright one in the air (pooled sprites; no real light).
    const L = BLAST.light;
    n += add(x, gy + 0.8, z, 0, 0, 0, BLAST.flash.life, BLAST.flash.d * vs, BLAST.flash.d * vs * 1.2, 3.2 * calm, 1, 0.97, 0.84, GLOW) >= 0;
    n += add(x, gy + 0.6, z, 0, 0, 0, BLAST.flash.life * 2, BLAST.flash.d * vs * 2.2, BLAST.flash.d * vs * 2.6, 1.4 * calm, 1, 0.9, 0.6, GLOW) >= 0;
    last.flash = n;
    n = 0;
    if (!air) n += add(x, 0.15, z, 0, 0, 0, L.life, L.r * 2 * vs, L.r * 2.1 * vs, 1.25 * calm, L.rgb[0], L.rgb[1], L.rgb[2], GLOW + 4) >= 0;
    n += add(x, gy + 3 * vs, z, 0, 0, 0, L.life * 0.85, L.r * 1.3 * vs, L.r * 1.4 * vs, 0.55 * calm, L.rgb[0], L.rgb[1] * 0.9, L.rgb[2] * 0.8, GLOW) >= 0;
    last.light = n;
    // 2. Fireball: three additive billboards, 2 m to 7 m radius by 0.25 s,
    // white to yellow to orange to dark red, gone by 0.7 s; a hot core inside.
    const F = BLAST.fire;
    const end = fireRadius(1, F.life) * 2;
    n = 0;
    for (let i = 0; i < F.n; i++) {
      const a = (i / F.n) * 6.28 + rnd() * 0.6, rr = 0.6 * vs;
      const j = add(x + Math.cos(a) * rr, gy + 0.6 * vs + i * 0.5 * vs, z + Math.sin(a) * rr, Math.cos(a) * 1.2 * vs, (1.5 + rnd() * 1.5) * vs, Math.sin(a) * 1.2 * vs,
        F.life * (0.9 + rnd() * 0.1), F.r0 * 2 * vs, end * vs * (0.85 + rnd() * 0.2), 1.5, 1, 0.96, 0.8, PUFF, -0.6, 2.2);
      tintP(G, j, 0.42, 0.05, 0.015);
      n += j >= 0;
    }
    last.fire = n;
    const core = Math.max(2, Math.round(3 * qq));
    for (let i = 0; i < core; i++) {
      const j = add(x + rs() * 0.8 * vs, gy + 0.6 + rnd() * vs, z + rs() * 0.8 * vs, rs() * 0.8, 2 + rnd() * 2, rs() * 0.8, 0.28 + rnd() * 0.12, 2.5 * vs, 7 * vs, 1.6, 1, 0.92, 0.6, PUFF, -0.5, 1.5);
      tintP(G, j, 1, 0.45, 0.1);
    }
    // Red billows that cool to black (alpha pool), rolling through the fire.
    const bill = Math.max(3, Math.round(5 * qq));
    for (let i = 0; i < bill; i++) {
      const a = (i / bill) * 6.28 + rnd() * 1.2, rr = rnd() * 2.5 * vs;
      const j = alpha(x + Math.cos(a) * rr, gy + 0.8 + rnd() * 2 * vs, z + Math.sin(a) * rr, Math.cos(a) * 3 * vs, (3 + rnd() * 3) * vs, Math.sin(a) * 3 * vs, 1.1 + rnd() * 0.5, 4 * vs, 11 * vs, 0.9, 0.95, 0.38, 0.1, PUFF, -0.3, 1.5, 0.05);
      tintP(S, j, 0.08, 0.07, 0.065);
      if (j >= 0) S.rotV[j] = rs() * 0.5;
    }
    // 4. Pressure ring (0 to 16 m in 0.3 s) and a slower dusty one; 5. the dust
    // skirt along the ground, colored by what lies under the blast.
    n = 0;
    if (!air) {
      n += add(x, 0.3, z, 0, 0, 0, BLAST.ring.life, 1, BLAST.ring.r * 2 * vs, 1.1, 1, 0.9, 0.66, RING + 4) >= 0;
      alpha(x, 0.22, z, 0, 0, 0, 0.8, 2 * vs, BLAST.ring.r * 2.2 * vs, 0.55, 0.8, 0.74, 0.66, RING + 4, 0, 0, 0.02);
      const tone = dustTone(game.city && game.city.lotTypeAt ? game.city.lotTypeAt(x, z) : '');
      const D = BLAST.dust;
      const nd = Math.max(5, Math.round(D.n * qq));
      let m = 0;
      for (let i = 0; i < nd; i++) {
        const a = (i / nd) * 6.28 + rnd() * 0.4;
        const sp = D.v * vs * (0.8 + rnd() * 0.4);
        const k = 0.85 + rnd() * 0.3;
        m += alpha(x + Math.cos(a) * vs, 0.5, z + Math.sin(a) * vs, Math.cos(a) * sp, 0.4 + rnd() * 0.8, Math.sin(a) * sp, D.life * (0.85 + rnd() * 0.3), 1.6 * vs, 5.5 * vs, 0.6, tone[0] * k, tone[1] * k, tone[2] * k, PUFF, -0.2, 1.1, 0.05) >= 0;
      }
      last.dust = m;
    } else {
      // In the air the ring stands up: a flat disc seen from the side.
      n += add(x, y, z, 0, 0, 0, BLAST.ring.life, 1, BLAST.ring.r * 1.6 * vs, 0.9, 1, 0.88, 0.6, RING) >= 0;
      last.dust = 0;
    }
    last.ring = n;
    // 6. Sparks (fast, gravity) and embers (slow, glowing, drifting).
    const SP = BLAST.sparks;
    const nsp = Math.max(8, Math.round(SP.n * qq * Math.min(1.5, vs)));
    n = 0;
    for (let i = 0; i < nsp; i++) {
      const a = rnd() * 6.28, sp = (6 + rnd() * 14) * (0.6 + 0.4 * vs);
      n += add(x, gy + 0.5, z, Math.cos(a) * sp, (5 + rnd() * 12) * (0.6 + 0.4 * vs), Math.sin(a) * sp, SP.life0 + rnd() * (SP.life1 - SP.life0), 0.26, 0.06, 2.4, 1, 0.62 + rnd() * 0.25, 0.22, STREAK + 8, 9.8, 0.2) >= 0;
    }
    last.sparks = n;
    const nem = Math.max(4, Math.round(12 * qq));
    for (let i = 0; i < nem; i++) {
      const a = rnd() * 6.28, sp = (1 + rnd() * 5) * vs;
      const j = add(x + rs() * 3 * vs, gy + rnd() * 2.4 * vs, z + rs() * 3 * vs, Math.cos(a) * sp, 3 + rnd() * 7 * vs, Math.sin(a) * sp, 1.4 + rnd() * 1.4, 0.2, 0.07, 1.9, 1, 0.5 + rnd() * 0.2, 0.12, GLOW, 2.2, 0.7);
      if (j >= 0) G.floor[j] = 0.05;
    }
    // 3. Smoke roll from 0.08 s (stepBlasts), then the column that keeps feeding.
    const bl = blasts[blastHead];
    blastHead = (blastHead + 1) % MAX_BLASTS;
    bl.on = true;
    bl.x = x;
    bl.y = gy;
    bl.z = z;
    bl.vs = vs;
    bl.t = 0;
    bl.rolled = false;
    bl.air = air;
    last.roll = 0;
    const c = cols[colHead];
    colHead = (colHead + 1) % MAX_COLUMNS;
    c.on = true;
    c.x = x;
    c.y = gy;
    c.z = z;
    c.t = 0;
    c.dur = 2.4 + R * 0.08;
    c.k = vs * 1.25;
    c.acc = 0;
    // Big and huge blasts (bombs, missiles, shells, tanks, jets): a second
    // shockwave and thrown black billows.
    if (e.size === 'big' || e.size === 'huge') {
      const hk = e.size === 'huge' ? 1.35 : 1;
      if (!air) alpha(x, 0.3, z, 0, 0, 0, 1.2 * hk, 3 * vs, 30 * vs * hk, 0.45, 0.62, 0.58, 0.52, RING + 4, 0, 0, 0.03);
      const nh = Math.max(4, Math.round(10 * qq * hk));
      for (let i = 0; i < nh; i++) {
        const a = rnd() * 6.28, sp = (6 + rnd() * 10) * vs;
        const j = alpha(x, gy + 0.6, z, Math.cos(a) * sp, (9 + rnd() * 12) * vs, Math.sin(a) * sp, 1.6 + rnd() * 0.8, 0.5, 0.4, 1, 0.14, 0.12, 0.1, PUFF, 9.8, 0.1, 0);
        if (j >= 0) S.floor[j] = 0.1;
      }
    }
  }
  // The smoke roll: 8 to 12 dark puffs from 0.08 s, rising 3 m/s and thrown
  // out so smoke is seen 12 m from the center by 0.5 s; each lives 2.5 s.
  function stepBlasts(dt, qq) {
    const RL = BLAST.roll;
    for (let i = 0; i < MAX_BLASTS; i++) {
      const b = blasts[i];
      if (!b.on) continue;
      b.t += dt;
      if (b.rolled) {
        if (b.t > 3) b.on = false;
        continue;
      }
      if (b.t < RL.t0) continue;
      b.rolled = true;
      const n = Math.round(RL.n0 + (RL.n1 - RL.n0) * qq);
      let m = 0;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.28 + rnd() * 0.5;
        const v = ROLL_V[k % ROLL_V.length] * b.vs;
        const g = 0.07 + rnd() * 0.07;
        const j = alpha(b.x + Math.cos(a) * b.vs, b.y + 0.8 + rnd() * 1.5 * b.vs, b.z + Math.sin(a) * b.vs, Math.cos(a) * v, RL.rise * (0.8 + rnd() * 0.4) + (b.air ? Math.sin(a) * v * 0.3 : 0), Math.sin(a) * v,
          RL.life * (0.9 + rnd() * 0.2), ROLL_S0 * b.vs, ROLL_S1 * b.vs, 0.8, g * 2.4, g * 1.4, g, PUFF, -0.05, RL.drag, 0.04);
        tintP(S, j, g, g * 0.96, g * 0.92);
        if (j >= 0) S.rotV[j] = rs() * 0.4;
        m += j >= 0;
      }
      if (b === blasts[(blastHead + MAX_BLASTS - 1) % MAX_BLASTS]) last.roll = m;
    }
  }
  // Feed the lingering smoke columns.
  function stepColumns(dt, qq) {
    for (let i = 0; i < MAX_COLUMNS; i++) {
      const c = cols[i];
      if (!c.on) continue;
      c.t += dt;
      if (c.t > c.dur) {
        c.on = false;
        continue;
      }
      if (!S) continue;
      c.acc += dt * (9 * qq + 1);
      while (c.acc >= 1) {
        c.acc -= 1;
        const f = c.t / c.dur; // thins toward the end of the feed
        const g = 0.14 + rnd() * 0.14;
        const k = c.k;
        const j = alpha(c.x + rs() * 0.5 * k, c.y + 0.4, c.z + rs() * 0.5 * k, rs() * 0.5 + 0.3, (5 - f * 2) * (k * 0.5 + 0.6), rs() * 0.5, 6 + rnd() * 4, 1.6 * k + 0.8, (5 + 3 * k) * (1 - f * 0.3), 0.7 * (1 - f * 0.5), g, g, g * 1.05, PUFF, -0.05, 0.4, 0.08);
        if (j >= 0) S.rotV[j] = rs() * 0.25;
      }
    }
  }

  // ---- burning craft: flames, embers and smoke ----
  const MAX_BURN = 4;
  const burn = [];
  for (let i = 0; i < MAX_BURN; i++) burn.push({ c: null, a: 0, b: 0, s: 0 });
  function onBurning(e) {
    const c = e.craft;
    if (!c) return;
    for (let i = 0; i < MAX_BURN; i++) {
      if (burn[i].c === c) {
        if (!e.on) burn[i].c = null;
        return;
      }
    }
    if (!e.on) return;
    for (let i = 0; i < MAX_BURN; i++) {
      if (!burn[i].c) {
        burn[i].c = c;
        burn[i].a = burn[i].b = burn[i].s = 0;
        return;
      }
    }
  }
  function stepBurn(dt, qq) {
    for (let i = 0; i < MAX_BURN; i++) {
      const bn = burn[i];
      const c = bn.c;
      if (!c) continue;
      if (c.removed || !c.burning) {
        bn.c = null;
        continue;
      }
      if (!near(c.x, c.z)) continue;
      const sp = c.spec || {};
      const len = (sp.length || 4) * 0.5, wid = (sp.width || 1.8) * 0.5, h = (sp.height || 1.4);
      const ch = Math.cos(c.heading || 0), sh = Math.sin(c.heading || 0);
      const y0 = (c.y || 0);
      bn.a += dt * 30 * qq;
      while (bn.a >= 1) {
        bn.a -= 1;
        const lx = rs() * len * 0.8, lz = rs() * wid * 0.7;
        const px = c.x + ch * lx - sh * lz, pz = c.z + sh * lx + ch * lz;
        add(px, y0 + h * 0.5, pz, rs() * 0.4 + (c.vx || 0) * 0.3, 2 + rnd() * 2.5, rs() * 0.4 + (c.vz || 0) * 0.3, 0.5 + rnd() * 0.35, 2.6, 0.7, 1, 1, 0.5 + rnd() * 0.25, 0.1, PUFF, -0.6, 1.2);
      }
      bn.b += dt * 7 * qq;
      while (bn.b >= 1) {
        bn.b -= 1;
        const lx = rs() * len * 0.6, lz = rs() * wid * 0.5;
        const px = c.x + ch * lx - sh * lz, pz = c.z + sh * lx + ch * lz;
        add(px, y0 + h * 0.5, pz, 0, 0.6, 0, 0.22, 2.2, 3.4, 0.6, 1, 0.8, 0.45, GLOW);
        add(px, y0 + h * 0.7, pz, rs() * 2, 3 + rnd() * 3, rs() * 2, 0.5 + rnd() * 0.5, 0.12, 0.04, 2.2, 1, 0.7, 0.25, STREAK + 8, 4, 0.5);
      }
      bn.s += dt * 9 * qq;
      while (bn.s >= 1) {
        bn.s -= 1;
        const g = 0.07 + rnd() * 0.08;
        alpha(c.x + rs() * len * 0.5, y0 + h * 0.9, c.z + rs() * wid, rs() * 0.5, 2.5 + rnd() * 1.5, rs() * 0.5, 2 + rnd() * 1.2, 1, 3.4, 0.55, g, g, g, PUFF, -0.1, 0.5, 0.1);
      }
    }
  }

  // ---- burnt hulls (combat.hulls): flames for the first 12 s, smoke the
  // whole 60 s, thinning as the hull cools and sinks away ----
  const HULL_FLAME_T = 12, STEAM_T = 4;
  function stepHulls(dt, qq) {
    const list = game.combat && game.combat.hulls;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.removed || !near(c.x, c.z)) continue;
      const t = c.wreckT || 0;
      const fade = c.wreckFade || 0;
      const sp = c.spec || {};
      const len = (sp.length || 4) * 0.5, wid = (sp.width || 1.8) * 0.5, h = sp.height || 1.4;
      const ch = Math.cos(c.heading || 0), sh = Math.sin(c.heading || 0);
      const top = (c.y || 0) + h * 0.75;
      const hot = t < HULL_FLAME_T && !c.doused ? 1 - t / HULL_FLAME_T : 0;
      // Put out by a fire truck (src/systems/service.js): white steam for
      // STEAM_T s, then the thin gray column.
      const steam = c.doused && t - (c.dousedWreck || 0) < STEAM_T ? 1 - (t - (c.dousedWreck || 0)) / STEAM_T : 0;
      if (hot > 0) {
        // Flames licking out of the cabin and engine bay, a warm glow under them.
        c.fxFlame = (c.fxFlame || 0) + dt * (6 + 22 * hot) * qq;
        while (c.fxFlame >= 1) {
          c.fxFlame -= 1;
          const lx = rs() * len * 0.75, lz = rs() * wid * 0.6;
          const px = c.x + ch * lx - sh * lz, pz = c.z + sh * lx + ch * lz;
          const j = add(px, top - h * 0.2, pz, rs() * 0.3, 1.6 + rnd() * 2.2 * (0.5 + hot), rs() * 0.3, 0.45 + rnd() * 0.35, 1.1 + hot * 1.2, 0.5, 1, 1, 0.55 + rnd() * 0.25, 0.12, PUFF, -0.6, 1.2);
          tintP(G, j, 0.6, 0.12, 0.03);
          if (rnd() < 0.12) add(px, top, pz, rs() * 1.5, 2.5 + rnd() * 3, rs() * 1.5, 0.6 + rnd() * 0.6, 0.1, 0.04, 2.2, 1, 0.7, 0.25, STREAK + 8, 4, 0.5);
        }
        if ((tick & 7) === 0) add(c.x, top, c.z, 0, 0, 0, 0.3, 3 + 3 * hot, 4 + 3 * hot, 0.35 * hot + 0.1, 1, 0.55, 0.2, GLOW);
        // Firelight on the road round the hull.
        if ((tick & 7) === 4) add(c.x, 0.12, c.z, 0, 0, 0, 0.3, 8 + 6 * hot, 9 + 6 * hot, 0.45 * hot + 0.12, 1, 0.5, 0.18, GLOW + 4);
      }
      // Smoke: thick and black while it burns, then a gray column that
      // thins as the hull cools and sinks away.
      const rate = (c.doused ? 1.2 + 7 * steam : 2.6 + 6 * hot) * (1 - fade * 0.8) * (0.4 + 0.6 * qq);
      c.fxSmoke = (c.fxSmoke || 0) + dt * rate;
      while (c.fxSmoke >= 1) {
        c.fxSmoke -= 1;
        const g = steam > 0 ? 0.85 + rnd() * 0.12 : hot > 0 ? 0.06 + rnd() * 0.06 : 0.16 + rnd() * 0.12;
        const life = hot > 0 ? 4.5 + rnd() * 2.5 : 5 + rnd() * 2.5;
        const j = alpha(c.x + rs() * len * 0.5, top, c.z + rs() * wid * 0.6, rs() * 0.4 + 0.3, 1.5 + rnd() * 1.2 + hot * 1.6, rs() * 0.4, life, 1.4 + hot, 5.5 + hot * 3, 0.55 + 0.25 * hot, g, g, g * 1.05, PUFF, -0.06, 0.4, 0.1);
        if (j >= 0) S.rotV[j] = rs() * 0.3;
      }
    }
  }

  // ---- projectiles in flight (rocket trail, fizz sparks) ----
  function stepProjectiles(qq) {
    const list = game.combat && game.combat.projectiles;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active || !near(p.x, p.z)) continue;
      if (p.weapon === 'lobber') {
        add(p.x, p.y, p.z, 0, 0, 0, 0.07, 0.8, 0.5, 1.4, 1, 0.7, 0.3, GLOW);
        if ((tick & 1) === 0 || qq > 0.7) {
          const g = 0.75 + rnd() * 0.15;
          alpha(p.x - p.vx * 0.01, p.y, p.z - p.vz * 0.01, rs() * 0.3, 0.2, rs() * 0.3, 0.9, 0.25, 1.2, 0.5, g, g, g, PUFF, -0.1, 1.2, 0);
        }
      } else if (p.type === 'missile') {
        // Missile: hot nozzle and a long smoke trail (smoke pool).
        add(p.x, p.y, p.z, 0, 0, 0, 0.07, 2.2, 1.2, 2, 1, 0.8, 0.45, GLOW);
        add(p.x - p.vx * 0.006, p.y - p.vy * 0.006, p.z - p.vz * 0.006, 0, 0, 0, 0.12, 1.1, 0.4, 1.2, 1, 0.55, 0.2, PUFF);
        // Two puffs per step (one half a step back) so the trail is unbroken;
        // white at the nozzle, gray as it ages, lingering about 2.4 s.
        const g = 0.88 + rnd() * 0.1;
        let j = alpha(p.x - p.vx * 0.004, p.y - p.vy * 0.004, p.z - p.vz * 0.004, rs() * 0.5, 0.3, rs() * 0.5, 2.4, 0.8, 3.2, 0.6, g, g, g, PUFF, -0.1, 0.8, 0);
        tintP(S, j, 0.5, 0.5, 0.52);
        if (qq > 0.5) {
          j = alpha(p.x - p.vx * 0.0125, p.y - p.vy * 0.0125, p.z - p.vz * 0.0125, rs() * 0.5, 0.3, rs() * 0.5, 2.4, 0.8, 3.2, 0.6, g, g, g, PUFF, -0.1, 0.8, 0);
          tintP(S, j, 0.5, 0.5, 0.52);
        }
        if ((tick & 3) === 0) add(p.x, p.y, p.z, rs() * 3 - p.vx * 0.05, rs() * 3, rs() * 3 - p.vz * 0.05, 0.4, 0.16, 0.05, 2, 1, 0.7, 0.3, STREAK + 8, 4, 0.3);
      } else if (p.type === 'shell' && (tick & 1) === 0) {
        add(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.5, 0.3, 1.3, 1, 0.85, 0.5, GLOW);
      } else if (p.type === 'bomb') {
        // The bomb itself (a dark body) and a faint wake.
        alpha(p.x, p.y, p.z, 0, 0, 0, 0.034, 1.1, 1.1, 1, 0.12, 0.12, 0.14, PUFF, 0, 0, 0);
        if ((tick % 4) === 0) alpha(p.x, p.y + 0.5, p.z, 0, 0, 0, 0.6, 0.3, 0.8, 0.3, 0.7, 0.7, 0.7, PUFF, 0, 1, 0);
      } else if (p.type === 'sticky' && (tick % 4) === 0) {
        add(p.x, p.y, p.z, 0, 0, 0, 0.12, 0.25, 0.2, 1.4, 1, 0.25, 0.15, GLOW);
      } else if (p.weapon === 'fizz' && (tick % 3) === 0) {
        add(p.x, p.y + 0.1, p.z, rs() * 2, 1 + rnd() * 2, rs() * 2, 0.25, 0.16, 0.05, 2, 1, 0.9, 0.45, STREAK + 8, 9.8, 0.5);
      }
    }
  }

  // ---- arms (docs/ARMS.md): throw arc, bomb ring, charges, trails ----
  // All drawn with the two existing particle pools: no new draw calls.
  function stepArms() {
    const cb = game.combat;
    if (!cb || !G) return;
    const pv = cb.preview;
    if (pv && pv.on && pv.n > 1) {
      const pts = pv.pts;
      // Dashed arc: a dot at each sample and one between.
      for (let k = 0; k < pv.n; k++) {
        const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
        add(x, y, z, 0, 0, 0, 0.05, 0.42, 0.42, 2.2, 1, 0.9, 0.62, GLOW);
        if (k + 1 < pv.n) {
          add(x * 0.67 + pts[k * 3 + 3] * 0.33, y * 0.67 + pts[k * 3 + 4] * 0.33, z * 0.67 + pts[k * 3 + 5] * 0.33, 0, 0, 0, 0.05, 0.3, 0.3, 1.6, 1, 0.9, 0.62, GLOW);
        }
      }
      const r = pv.weapon === 'sticky' ? 6 : 5;
      add(pv.hx, Math.max(0, pv.hy) + 0.08, pv.hz, 0, 0, 0, 0.05, r * 2, r * 2, 1.3, 1, 0.5, 0.2, RING + 4);
      add(pv.hx, Math.max(0, pv.hy) + 0.08, pv.hz, 0, 0, 0, 0.05, 1.6, 1.6, 1.6, 1, 0.75, 0.4, RING + 4);
      add(pv.hx, Math.max(0, pv.hy) + 0.25, pv.hz, 0, 0, 0, 0.05, 1.1, 1.1, 1.6, 1, 0.75, 0.4, GLOW);
    }
    const dp = cb.dropPreview;
    if (dp && dp.on && (tick & 1) === 0) {
      add(dp.hx, Math.max(0, dp.hy) + 0.15, dp.hz, 0, 0, 0, 0.07, 18, 18, 0.75, 1, 0.45, 0.2, RING + 4);
      add(dp.hx, Math.max(0, dp.hy) + 0.15, dp.hz, 0, 0, 0, 0.07, 5, 5, 0.6, 1, 0.8, 0.4, RING + 4);
    }
    const st = cb.stickies;
    if (st && (tick & 3) === 0) {
      for (let i = 0; i < st.length; i++) {
        const c = st[i];
        if (c.active && near(c.x, c.z)) add(c.x, c.y + 0.12, c.z, 0, 0, 0, 0.1, 0.22, 0.22, 1.1, 1, 0.2, 0.12, GLOW);
      }
    }
  }
  function onSticky(e) {
    if (!e || !e.on || !near(e.x, e.z)) return;
    if (e.beep) {
      add(e.x, e.y + 0.15, e.z, 0, 0, 0, 0.18, 0.6, 1.1, 2.2, 1, 0.15, 0.1, GLOW);
    } else {
      // Thunk: a little dust where it stuck.
      for (let i = 0; i < 4; i++) dust(e.x, e.y + 0.1, e.z, rs() * 1.2, 0.6 + rnd(), rs() * 1.2, 0.5, 0.2, 0.6, 0.4, 0.6);
    }
  }
  function onSplash(x, z, strength) {
    if (!(strength >= 2) || !Number.isFinite(x) || !near(x, z)) return;
    // A bomb into the sea: a white water column and a ring.
    const sy = seaY();
    const n = Math.max(6, Math.round(16 * q()));
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, sp = 1 + rnd() * 3;
      alpha(x + Math.cos(a), sy + 0.3, z + Math.sin(a), Math.cos(a) * sp, 8 + rnd() * 10, Math.sin(a) * sp, 1.4 + rnd() * 0.8, 1.6, 4, 0.8, 0.92, 0.95, 1, PUFF, 9.8, 0.4, 0.02);
    }
    alpha(x, sy + 0.1, z, 0, 0, 0, 1.2, 2, 22, 0.7, 0.95, 0.97, 1, RING + 4, 0, 0, 0.02);
  }

  // ---- event handlers ----
  function onShot(e) {
    const w = e.weapon;
    if (w === 'wrench' || w === 'fizz' || w === 'sticky' || w === 'bomb') return;
    if (!near(e.x, e.z)) return;
    muzzle(w, e.x, e.y, e.z, e.dx, e.dy, e.dz);
    const k = e.hitKind;
    if (k === 'none') {
      tracer(w, e.x, e.y, e.z, e.dx, e.dy, e.dz, e.hx, e.hy, e.hz);
      return;
    }
    tracer(w, e.x, e.y, e.z, e.dx, e.dy, e.dz, e.hx, e.hy, e.hz);
    if (k === 'wall' || k === 'ground') impact(k, e.hx, e.hy, e.hz, e.dx, e.dy, e.dz);
  }

  // ---- props sheared by cars ----
  const pieceT = new Float32Array(PROP_PIECES_MAX).fill(-1);
  const sprays = [];
  for (let i = 0; i < SPRAYS_MAX; i++) sprays.push({ t: 0, x: 0, z: 0 });
  function onPropBreak(e) {
    if (!e) return;
    let slot = -1;
    for (let i = 0; i < PROP_PIECES_MAX; i++) if (pieceT[i] < 0) { slot = i; break; }
    if (slot >= 0 && near(e.x, e.z)) {
      pieceT[slot] = PROP_PIECE_LIFE;
      const hex = BREAK_HEX[e.type] || 0x6a6e72;
      const k = Math.min(1, (e.speed || 0) / 25);
      const pole = e.fall === 'pole';
      const h = Math.max(0.5, Math.min(7, e.h || 1));
      chunk(e.x, pole ? h * 0.5 : h * 0.5, e.z, (e.vx || 0) * (0.5 + 0.3 * k), pole ? 1 + 2 * k : 2 + 3 * k, (e.vz || 0) * (0.5 + 0.3 * k), pole ? 0.16 : Math.min(1.6, h), pole ? h : Math.min(1.2, h), pole ? 0.16 : 0.5, hex);
      dust(e.x, 0.3, e.z, rs() * 0.5, 0.6, rs() * 0.5, 0.9, 0.4, 1.4, 0.35, 0.6);
    }
    if (e.spray > 0) {
      for (let i = 0; i < SPRAYS_MAX; i++) {
        const sp = sprays[i];
        if (sp.t > 0) continue;
        sp.t = e.spray;
        sp.x = e.x;
        sp.z = e.z;
        break;
      }
    }
  }
  function stepPropFx(dt, qq) {
    for (let i = 0; i < PROP_PIECES_MAX; i++) if (pieceT[i] >= 0) pieceT[i] = pieceT[i] - dt > 0 ? pieceT[i] - dt : -1;
    for (let i = 0; i < SPRAYS_MAX; i++) {
      const sp = sprays[i];
      if (!(sp.t > 0)) continue;
      sp.t -= dt;
      if (!S || !near(sp.x, sp.z) || (tick & 1)) continue;
      const n = Math.max(1, Math.round(3 * qq));
      for (let k = 0; k < n; k++) alpha(sp.x + rs() * 0.1, 0.6, sp.z + rs() * 0.1, rs() * 1.2, 6 + rnd() * 3, rs() * 1.2, 0.9 + rnd() * 0.4, 0.12, 0.5, 0.55, 0.82, 0.9, 0.98, PUFF, 9.8, 0.6, 0.05);
    }
  }
  // The sea walls and rails, drawn on their collision lines.
  const edgeView = scene && typeof document !== 'undefined' ? createEdgeLineView(game) : null;

  if (game && game.events && game.events.on) {
    const on = (n, f) => offs.push(game.events.on(n, f));
    on('propBreak', onPropBreak);
    on('shot', onShot);
    on('hit', onHit);
    on('down', onDown);
    on('out', onOut);
    on('explosion', onExplosion);
    on('burning', onBurning);
    on('sticky', onSticky);
    on('splash', onSplash);
    on('revived', onRevived);
  }

  // Thrown cars: tumble and lift the mesh (the sim keeps `tRoll`, `tPitch`
  // on the craft; vehiclemesh only knows the small suspension lean).
  function tossVisuals() {
    const vs = game.vehicles;
    if (!vs) return;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      const m = v.mesh;
      if (!m || !(v.tRoll || v.tPitch || v.tossing)) continue;
      const sp = v.spec || {};
      const roll = v.tRoll || 0, pitch = v.tPitch || 0;
      m.rotation.order = 'YXZ';
      m.rotation.x = roll;
      m.rotation.z = pitch;
      const h = sp.height || 1.5, w = sp.width || 1.8;
      m.position.y = (v.y || 0) + (1 - Math.cos(roll)) * 0.5 * h + Math.abs(Math.sin(roll)) * 0.5 * w + Math.abs(Math.sin(pitch)) * 0.5 * (sp.length || 4) * 0.4;
    }
  }

  const sys = {
    name: 'combatfx',
    game,
    lastBlast: last,
    parts,
    counts() {
      return { alpha: S ? S.n : 0, additive: G ? G.n : 0, decals: decalCount, blood: liveCount(bt, -1e8, true), debris: liveParts(parts) };
    },
    fixedUpdate(dt) {
      if (!(dt > 0) || game.paused) return;
      time += dt;
      tick++;
      const qq = q();
      if (S) {
        S.cap = Math.floor(MAX_ALPHA * qq);
        G.cap = Math.floor(MAX_ADD * qq);
      }
      stepBurn(dt, qq);
      stepHulls(dt, qq);
      stepBlasts(dt, qq);
      stepColumns(dt, qq);
      stepProjectiles(qq);
      stepArms();
      syncScorch();
      stepBlood();
      stepDebris(dt);
      stepPropFx(dt, qq);
      if (S) {
        stepPool(S, dt);
        stepPool(G, dt);
      }
    },
    edgeView,
    render() {
      if (edgeView && camera) edgeView.update(camera.position.x, camera.position.z);
      if (!S) return;
      tossVisuals();
      const h = Number.isFinite(game.clock) ? game.clock : 12;
      const night = nightAt(h);
      S.mesh.material.uniforms.uLight.value = 0.3 + 0.7 * (1 - night * 0.85);
      camera.updateMatrixWorld();
      writePool(S, camera, true, null);
      writePool(G, camera, false, null);
    },
    dispose() {
      for (const off of offs) off();
      offs = [];
      for (const m of [S && S.mesh, G && G.mesh, decalMesh, bloodMesh, debrisMesh, doorMesh, wheelMesh]) {
        if (!m) continue;
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      if (atlas) atlas.dispose();
      if (edgeView) edgeView.dispose();
    },
  };
  return sys;
}
