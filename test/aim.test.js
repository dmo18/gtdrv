import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  pickAssist, pickLock, pickFlick, keepLock, lineOfSight, followAngle, convergeDir, forward,
  angleTo, assistCone, ASSIST_CONE, ASSIST_CONE_NEAR, DRIVE_CONE, LOCK_LOSE_T,
} from '../src/core/aim.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createChaseCamera } from '../src/render/chasecam.js';
import { createCombatHud } from '../src/ui/combathud.js';
import { createInput } from '../src/core/input.js';
import { createArms } from '../src/core/weapons.js';
import { createEvents } from '../src/core/events.js';

const DEG = Math.PI / 180;
const actor = (x, z, team = 'crew', extra = {}) => ({ x, z, y: 0, hp: 60, maxHp: 60, team, life: 'ok', fade: 0, radius: 0.35, height: 1.8, ...extra });
const self = actor(0, 0, 'player', { hp: 100 });
const eye = { x: 0, y: 1.4, z: 0 };
const fwdX = { x: 1, y: 0, z: 0 };
const ctxOf = (actors, collision = null, vehicles = []) => ({ actors: [self, ...actors], vehicles, collision, self, selfCraft: null, seaY: 0 });
// A point at distance d and bearing deg (0 = +x, + toward +z).
const at = (d, deg, team, extra) => actor(Math.cos(deg * DEG) * d, Math.sin(deg * DEG) * d, team, extra);

test('assist cone: 8 deg far, 14 deg near, nothing outside', () => {
  assert.equal(assistCone(20), ASSIST_CONE);
  assert.equal(assistCone(5), ASSIST_CONE_NEAR);
  const inFar = at(20, 6), outFar = at(20, 11), inNear = at(5, 12), outNear = at(5, 17);
  assert.equal(pickAssist(ctxOf([inFar]), eye, fwdX, eye, { range: 45 }), inFar);
  assert.equal(pickAssist(ctxOf([outFar]), eye, fwdX, eye, { range: 45 }), null);
  assert.equal(pickAssist(ctxOf([inNear]), eye, fwdX, eye, { range: 45 }), inNear);
  assert.equal(pickAssist(ctxOf([outNear]), eye, fwdX, eye, { range: 45 }), null);
  // Out of weapon range.
  assert.equal(pickAssist(ctxOf([at(50, 0)]), eye, fwdX, eye, { range: 45 }), null);
  // Behind the eye.
  assert.equal(pickAssist(ctxOf([at(5, 180)]), eye, fwdX, eye, { range: 45 }), null);
  // Drive-by cone is wider.
  const side = at(20, 18);
  assert.equal(pickAssist(ctxOf([side]), eye, fwdX, eye, { range: 35, cone: DRIVE_CONE }), side);
});

test('assist picks the nearest of several targets in the cone; ignores down, faded and self', () => {
  const far = at(30, 1), near = at(12, 3);
  assert.equal(pickAssist(ctxOf([far, near]), eye, fwdX, eye, { range: 45 }), near);
  const centred = at(14, 0.2), offAxis = at(13, 7);
  assert.equal(pickAssist(ctxOf([offAxis, centred]), eye, fwdX, eye, { range: 45 }), centred);
  const down = at(10, 0, 'crew', { life: 'down' }), gone = at(9, 0, 'crew', { fade: 0.5 });
  assert.equal(pickAssist(ctxOf([down, gone]), eye, fwdX, eye, { range: 45 }), null);
});

test('walls hide targets (collision world, height aware)', () => {
  const col = createCollisionWorld();
  col.addBox(8, -3, 10, 3, 10); // a tall wall across the line at x 8..10
  const behind = at(15, 0), clear = at(15, 6.5);
  assert.equal(lineOfSight(col, 0, 1.4, 0, 15, 1.1, 0), false);
  assert.equal(pickAssist(ctxOf([behind], col), eye, fwdX, eye, { range: 45 }), null);
  // A visible one a little off to the side still wins over the hidden one.
  const col2 = createCollisionWorld();
  col2.addBox(8, -0.6, 10, 0.6, 10);
  assert.equal(pickAssist(ctxOf([behind, clear], col2), eye, fwdX, eye, { range: 45 }), clear);
  // A low wall the line passes over does not block.
  const low = createCollisionWorld();
  low.addBox(8, -3, 10, 3, 0.8);
  assert.equal(lineOfSight(low, 0, 1.4, 0, 15, 1.1, 0), true);
  assert.equal(pickAssist(ctxOf([behind], low), eye, fwdX, eye, { range: 45 }), behind);
});

test('lock-on order: attackers, crew, police, crewed craft; civilians only under the crosshair', () => {
  const civ = at(10, 2, 'civ');
  const cop = at(20, -20, 'police');
  const crew = at(25, 25, 'crew');
  const attacker = at(28, -28, 'civ', { attacking: true });
  assert.equal(pickLock(ctxOf([civ, cop, crew, attacker]), eye, fwdX, eye, 45), attacker);
  assert.equal(pickLock(ctxOf([civ, cop, crew]), eye, fwdX, eye, 45), crew);
  assert.equal(pickLock(ctxOf([civ, cop]), eye, fwdX, eye, 45), cop);
  assert.equal(pickLock(ctxOf([civ]), eye, fwdX, eye, 45), civ, 'civilian right under the crosshair');
  assert.equal(pickLock(ctxOf([at(10, 25, 'civ')]), eye, fwdX, eye, 45), null, 'civilian off to the side is not locked');
  const car = { x: 20, z: 3, y: 0, spec: { height: 1.5 }, health: 100, radius: 2, driver: {}, police: true };
  assert.equal(pickLock(ctxOf([civ], null, [car]), eye, fwdX, eye, 45), car);
  const parked = { x: 20, z: 3, y: 0, spec: { height: 1.5 }, health: 100, radius: 2, driver: null };
  assert.equal(pickLock(ctxOf([], null, [parked]), eye, fwdX, eye, 45), null, 'empty craft are never locked');
});

test('lock breaks after 1.5 s out of sight, at once when the target goes down', () => {
  const col = createCollisionWorld();
  const t = at(20, 0);
  const ctx = ctxOf([t], col);
  const st = { lock: t, lostT: 0 };
  assert.equal(keepLock(st, ctx, eye, 45, 1 / 60), true);
  col.addBox(8, -3, 10, 3, 10); // now hidden
  let steps = 0;
  while (keepLock(st, ctx, eye, 45, 1 / 60)) steps++;
  assert.ok(Math.abs(steps / 60 - LOCK_LOSE_T) < 0.05, `${steps} steps`);
  assert.equal(st.lock, null);
  const t2 = at(10, 0);
  const st2 = { lock: t2, lostT: 0 };
  t2.life = 'down';
  assert.equal(keepLock(st2, ctxOf([t2]), eye, 45, 1 / 60), false);
  // Out of range for a moment, then back: the timer resets.
  const t3 = at(50, 0);
  const st3 = { lock: t3, lostT: 0 };
  for (let i = 0; i < 60; i++) keepLock(st3, ctxOf([t3]), eye, 45, 1 / 60);
  t3.x = 30;
  keepLock(st3, ctxOf([t3]), eye, 45, 1 / 60);
  assert.equal(st3.lostT, 0);
  assert.equal(st3.lock, t3);
});

test('flick picks the next target on the swiped side', () => {
  const cur = at(20, 0), right = at(20, 15), farRight = at(20, 40), left = at(20, -20);
  const ctx = ctxOf([cur, right, farRight, left]);
  assert.equal(pickFlick(ctx, eye, eye, cur, 1, 45), right);
  assert.equal(pickFlick(ctx, eye, eye, cur, -1, 45), left);
  assert.equal(pickFlick(ctxOf([cur]), eye, eye, cur, 1, 45), null);
});

test('soft follow: time constant, frame-rate independent, wraps, no NaN', () => {
  let a = 0;
  for (let i = 0; i < 15; i++) a = followAngle(a, 1, 1 / 60, 0.25);
  assert.ok(Math.abs(a - (1 - Math.exp(-1))) < 1e-6, `${a}`);
  let b = 0;
  for (let i = 0; i < 30; i++) b = followAngle(b, 1, 1 / 120, 0.25);
  assert.ok(Math.abs(a - b) < 1e-9, 'same at 120 Hz');
  // Across the -PI/PI seam it takes the short way.
  const c = followAngle(3.1, -3.1, 1 / 60, 0.25);
  assert.ok(c > 3.1 || c < -3.0, `${c}`);
  assert.equal(followAngle(0.5, NaN, 1 / 60), 0.5);
  assert.equal(followAngle(0.5, 1, 0), 0.5);
});

test('converge: the muzzle aims at the point the crosshair reaches; no NaN anywhere', () => {
  const out = { x: 0, y: 0, z: 0 };
  const f = forward(0.3, 0.1, { x: 0, y: 0, z: 0 });
  const camEye = { x: -3, y: 1.9, z: 0.6 }, mz = { x: 0, y: 1.4, z: 0 };
  convergeDir(camEye, f, mz, 25, out);
  const px = camEye.x + f.x * 25, py = camEye.y + f.y * 25, pz = camEye.z + f.z * 25;
  assert.ok(angleTo(mz.x, mz.y, mz.z, out.x, out.y, out.z, px, py, pz) < 1e-6);
  assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-9);
  convergeDir(mz, f, mz, 0, out);
  assert.ok([out.x, out.y, out.z].every(Number.isFinite));
  assert.equal(pickAssist(ctxOf([actor(0, 0, 'crew')]), eye, fwdX, eye, { range: 45 }), null, 'target on top of the eye');
  assert.ok(Number.isFinite(angleTo(0, 0, 0, 1, 0, 0, 0, 0, 0)));
});

// The controller in combathud.js with a real chase camera, no DOM.
function rig() {
  const camera = new THREE.PerspectiveCamera(60, 915 / 412, 0.3, 1000);
  const chase = createChaseCamera(camera);
  chase.setMode('foot');
  const walker = actor(0, 0, 'player', { hp: 100, maxHp: 100, heading: 0, speed: 0, arms: createArms('pistol') });
  const input = createInput();
  const game = {
    input, chase, camera, events: createEvents(), actors: [walker], vehicles: [], collision: createCollisionWorld(),
    aim: { dx: 1, dy: 0, dz: 0, manual: false }, seaY: 0, player: { walker, vehicle: null, mode: 'foot', x: 0, z: 0 },
  };
  const hud = createCombatHud(game, null);
  const target = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 0, height: 1.5 };
  const frame = () => {
    input.poll();
    hud.always(1 / 60);
    hud.fixedUpdate(1 / 60);
    target.x = walker.x; target.z = walker.z; target.heading = walker.heading;
    chase.update(target, 1 / 60, input, game.collision);
    hud.render(1, 1 / 60);
    input.endStep();
  };
  chase.snap(target);
  return { game, hud, chase, walker, input, frame };
}

test('controller: FIRE enters the aim view, shots bend to a target in the cone', () => {
  const { game, hud, chase, input, frame } = rig();
  const t = at(15, 4, 'crew');
  game.actors.push(t);
  frame();
  input.press('fire');
  for (let i = 0; i < 20; i++) frame();
  assert.equal(hud.aiming, true);
  assert.ok(chase.aim.k > 0.99, 'aim view eased in within 0.2 s');
  assert.ok(Math.abs(camFov(game) - 55) < 1.5, `fov ${camFov(game)}`);
  assert.equal(hud.target, t);
  const a = game.aim;
  assert.equal(a.manual, true);
  const ang = angleTo(0, 1.4, 0, a.dx, a.dy, a.dz, t.x, 1.1, t.z);
  assert.ok(ang < 0.01, `aim points at the target (${ang})`);
  input.release('fire');
  for (let i = 0; i < 90; i++) frame();
  assert.equal(hud.aiming, false, 'aim view leaves after the hold');
});

const camFov = (game) => game.camera.fov;

test('controller: lock-on follows a moving target with the camera', () => {
  const { game, hud, chase, input, frame } = rig();
  const t = at(18, 10, 'crew');
  game.actors.push(t);
  frame();
  input.press('lock');
  frame();
  input.release('lock');
  assert.equal(hud.lock, t);
  for (let i = 0; i < 40; i++) frame();
  for (let i = 0; i < 120; i++) {
    // Walks across the view at 3 m/s.
    t.z += 3 / 60;
    frame();
  }
  const ray = chase.ray;
  const ang = angleTo(ray.x, ray.y, ray.z, ray.dx, ray.dy, ray.dz, t.x, 1.1, t.z);
  assert.ok(ang < 6 * DEG, `camera keeps the target near the centre (${(ang / DEG).toFixed(2)} deg)`);
  assert.equal(hud.lock, t);
  // Tap again to release.
  input.press('lock');
  frame();
  input.release('lock');
  assert.equal(hud.lock, null);
  for (const v of [ray.x, ray.y, ray.z, ray.dx, ray.dy, ray.dz, game.aim.dx, game.aim.dy, game.aim.dz]) assert.ok(Number.isFinite(v));
});

test('controller: drive-by aims along the camera look with a 20 deg cone, never steers', () => {
  const { game, hud, chase, input, frame } = rig();
  const car = { kind: 'car', x: 0, z: 0, y: 0, heading: 0, speed: 10, spec: { height: 1.4 }, health: 100, radius: 2, driver: 'player' };
  game.vehicles.push(car);
  game.player.vehicle = car;
  chase.setMode('car');
  const t = at(20, 15, 'crew');
  game.actors.push(t);
  frame();
  assert.equal(chase.aim.on, false, 'no aim view in a car');
  input.press('fire');
  input.poll();
  const steer0 = input.steer;
  for (let i = 0; i < 5; i++) frame();
  assert.equal(hud.target, t);
  const a = game.aim;
  assert.ok(angleTo(0, 1.19, 0, a.dx, a.dy, a.dz, t.x, 1.1, t.z) < 0.01);
  assert.equal(input.steer, steer0);
  assert.equal(chase.aim.holdOrbit, true, 'the look stays where it is while firing');
  // Out of the cone: straight along the look, level.
  t.x = 0; t.z = 20;
  frame();
  assert.equal(hud.target, null);
  assert.ok(Math.abs(game.aim.dy) < 1e-9 && game.aim.dx > 0.99);
  input.release('fire');
});
