// Combat effects: muzzle flashes with a ground-light flicker, tracers,
// bullet impacts (sparks, dust, holes), white hit stars, knock-down dust,
// explosions (fireball, smoke column, shock ring, debris, camera shake),
// flames and smoke on burning craft, rocket trails, shell eject and
// bullet-hole / scorch decals. Listens to the combat events in
// docs/COMBAT.md. Cartoon handling only: no blood, ever.
//
// Reuses the particle pools of effects.js (one alpha, one additive
// instanced billboard system, same atlas and shaders) plus one instanced
// decal mesh: three extra draw calls in all. Everything is pooled and
// counts scale with game.quality. Logic is guarded so it still runs when
// `scene` is missing (node tests).
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { makeAtlas, createPool, emitP, stepPool, writePool, nightAt } from './effects.js';

const MAX_ALPHA = 420;
const MAX_ADD = 300;
const SCORCH = 24; // matches CAPS.decals in combat.js
const HOLES = 40;
const DECALS = SCORCH + HOLES;
const NEAR = 170; // metres from the camera where small effects are made

// Atlas cells: 0 puff, 1 ring, 2 streak, 3 glow. +4 flat on the ground, +8 stretched.
const PUFF = 0, RING = 1, STREAK = 2, GLOW = 3;

const DECAL_VERT = /* glsl */`
attribute float iOp;
varying vec2 vUv;
varying float vOp;
void main() {
  vUv = uv;
  vOp = iOp;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const DECAL_FRAG = /* glsl */`
varying vec2 vUv;
varying float vOp;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float rim = 0.78 + 0.22 * sin(a * 7.0 + vOp * 40.0) * sin(a * 3.0 - vOp * 17.0);
  float k = smoothstep(rim, rim * 0.35, r);
  float al = k * min(1.0, vOp) * 0.85;
  if (al < 0.01) discard;
  gl_FragColor = vec4(0.03, 0.028, 0.025, al);
}
`;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
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
    const mat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
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
  // A star: two crossed streaks and a glow, white, no colour cast.
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
      putDecal(i, d.x[i], 0.03, d.z[i], rnd() * 6.28, -Math.PI / 2, Math.max(1.2, d.r[i] * 2.3), 0.5 + rnd());
    }
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

  // A hit on a person (stars, no colour) or a craft (sparks).
  function onHit(e) {
    const t = e.target;
    const k = e.kind;
    if (!t || k === 'blast' || k === 'fire') return;
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
    if (!t || (t.spec && t.hp === undefined) || !near(t.x, t.z)) return;
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
  function onExplosion(e) {
    const x = e.x, y = Math.max(0, e.y), z = e.z;
    const k = clamp(e.radius / 8, 0.55, 1.7);
    const d2 = dist2(x, z);
    // Camera shake through the existing impact kick.
    const dd = Math.sqrt(d2);
    const sh = (1 - dd / 48) * 28 * k;
    if (sh > 1.5 && game.chase && game.chase.kick) game.chase.kick(sh);
    if (d2 > 220 * 220) return;
    const qq = q();
    const gy = y < 0.5 ? 0.4 : y;
    // Flash and fireball.
    add(x, gy + 0.8, z, 0, 0, 0, 0.22, 8 * k, 16 * k, 2.2, 1, 0.92, 0.7, GLOW);
    add(x, gy + 0.8, z, 0, 0, 0, 0.4, 16 * k, 26 * k, 0.3, 1, 0.55, 0.2, GLOW);
    const nf = Math.max(5, Math.round(14 * qq));
    for (let i = 0; i < nf; i++) {
      const a = rnd() * 6.28, up = rnd();
      const sp = (2 + rnd() * 4) * k;
      add(x + rs() * k, gy + 0.4 + up * 1.4 * k, z + rs() * k, Math.cos(a) * sp, 1 + up * 3, Math.sin(a) * sp, 0.5 + rnd() * 0.6, 3.2 * k, 7 * k, 0.9, 1, 0.5 + rnd() * 0.25, 0.12, PUFF, -0.5, 1.8);
    }
    const nc = Math.max(3, Math.round(7 * qq));
    for (let i = 0; i < nc; i++) {
      const a = rnd() * 6.28;
      add(x + rs() * 0.8 * k, gy + 0.8 + rnd() * 1.4, z + rs() * 0.8 * k, Math.cos(a) * 1.5, 2 + rnd() * 3, Math.sin(a) * 1.5, 0.3 + rnd() * 0.3, 1.4 * k, 3 * k, 1, 1, 0.9, 0.55, PUFF, -0.4, 1.5);
    }
    // Smoke column: faster puffs climb higher.
    const ns = Math.max(5, Math.round(14 * qq));
    for (let i = 0; i < ns; i++) {
      const g = 0.1 + rnd() * 0.12;
      const f = i / ns;
      const j = alpha(x + rs() * 1.2 * k, gy + 0.5 + f, z + rs() * 1.2 * k, rs() * 1.2, (2.5 + f * 6) * (0.8 + k * 0.3), rs() * 1.2, 2.4 + rnd() * 1.8, 1.8 * k, (3.8 + f * 2.2) * k, 0.62, g, g, g * 1.05, PUFF, -0.1, 0.5, 0.05);
      if (j >= 0) S.rotV[j] = rs() * 0.4;
    }
    // Shock ring on the ground, and dust racing outward.
    alpha(x, 0.25, z, 0, 0, 0, 0.55, 1.5, e.radius * 3, 1, 1, 0.95, 0.85, RING + 4, 0, 0, 0.02);
    add(x, 0.3, z, 0, 0, 0, 0.35, 1, e.radius * 2.4, 0.8, 1, 0.8, 0.5, RING + 4);
    const nd = Math.max(4, Math.round(10 * qq));
    for (let i = 0; i < nd; i++) {
      const a = (i / nd) * 6.28 + rnd() * 0.4;
      const sp = (8 + rnd() * 5) * k;
      dust(x + Math.cos(a), 0.4, z + Math.sin(a), Math.cos(a) * sp, 0.3 + rnd() * 0.5, Math.sin(a) * sp, 1.0 + rnd() * 0.6, 1.2 * k, 3.4 * k, 0.5, 0.58);
    }
    // Sparks and debris.
    const nsp = Math.max(5, Math.round(18 * qq));
    for (let i = 0; i < nsp; i++) {
      const a = rnd() * 6.28, sp = (4 + rnd() * 10) * k;
      add(x, gy + 0.5, z, Math.cos(a) * sp, (6 + rnd() * 10) * k, Math.sin(a) * sp, 0.7 + rnd() * 0.8, 0.22, 0.06, 2.4, 1, 0.65 + rnd() * 0.25, 0.25, STREAK + 8, 9.8, 0.2);
    }
    const nb = Math.max(2, Math.round(8 * qq));
    for (let i = 0; i < nb; i++) {
      const a = rnd() * 6.28, sp = (3 + rnd() * 6) * k;
      const j = alpha(x, gy + 0.5, z, Math.cos(a) * sp, (5 + rnd() * 8) * k, Math.sin(a) * sp, 1.4 + rnd() * 0.6, 0.35, 0.3, 1, 0.12, 0.1, 0.09, PUFF, 9.8, 0.15, 0);
      if (j >= 0) S.floor[j] = 0.1;
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
      } else if (p.weapon === 'fizz' && (tick % 3) === 0) {
        add(p.x, p.y + 0.1, p.z, rs() * 2, 1 + rnd() * 2, rs() * 2, 0.25, 0.16, 0.05, 2, 1, 0.9, 0.45, STREAK + 8, 9.8, 0.5);
      }
    }
  }

  // ---- event handlers ----
  function onShot(e) {
    const w = e.weapon;
    if (w === 'wrench' || w === 'fizz') return;
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

  if (game && game.events && game.events.on) {
    const on = (n, f) => offs.push(game.events.on(n, f));
    on('shot', onShot);
    on('hit', onHit);
    on('down', onDown);
    on('out', onOut);
    on('explosion', onExplosion);
    on('burning', onBurning);
  }

  const sys = {
    name: 'combatfx',
    game,
    counts() {
      return { alpha: S ? S.n : 0, additive: G ? G.n : 0, decals: decalCount };
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
      stepProjectiles(qq);
      syncScorch();
      if (S) {
        stepPool(S, dt);
        stepPool(G, dt);
      }
    },
    render() {
      if (!S) return;
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
      for (const m of [S && S.mesh, G && G.mesh, decalMesh]) {
        if (!m) continue;
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      if (atlas) atlas.dispose();
    },
  };
  return sys;
}
