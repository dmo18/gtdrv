import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalker, stepWalker, findEnterable, exitPosition } from '../src/entities/onfoot.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';

const DT = 1 / 60;
const emptyWorld = () => ({ collision: createCollisionWorld() });
const run = (w, controls, steps, world, cam = 0) => {
  for (let i = 0; i < steps; i++) stepWalker(w, controls, DT, world, cam);
};

test('forward stick moves along the camera heading', () => {
  const cam = Math.PI / 2; // looking toward +z
  const w = createWalker(0, 0, 0);
  run(w, { moveX: 0, moveY: 1, sprint: false }, 120, emptyWorld(), cam);
  assert.ok(w.z > 3.5, `z ${w.z}`);
  assert.ok(Math.abs(w.x) < 0.01);
  assert.ok(Math.abs(w.speed - 2.4) < 0.05);
  assert.ok(w.moving);
  assert.ok(Math.abs(w.heading - cam) < 0.05, 'body faces travel direction');
  assert.ok(w.stride > 0, 'walk cycle advances');
});

test('right stick moves to the camera right', () => {
  const w = createWalker(0, 0, 0);
  run(w, { moveX: 1, moveY: 0, sprint: false }, 60, emptyWorld(), 0);
  // right of heading 0 is +z
  assert.ok(w.z > 1.5, `z ${w.z}`);
  assert.ok(Math.abs(w.x) < 0.01);
});

test('no controls: stands still', () => {
  const w = createWalker(0, 0, 0);
  run(w, { moveX: 0, moveY: 1 }, 30, emptyWorld());
  run(w, null, 120, emptyWorld());
  assert.ok(w.speed < 0.01);
  assert.equal(w.moving, false);
});

test('sprint is faster, drains stamina, then drops to walk', () => {
  const world = emptyWorld();
  const w = createWalker(0, 0, 0);
  run(w, { moveX: 0, moveY: 1, sprint: true }, 60, world);
  assert.ok(w.sprinting);
  assert.ok(w.speed > 5.5, `speed ${w.speed}`);
  assert.ok(w.stamina < 1 && w.stamina > 0.8);
  run(w, { moveX: 0, moveY: 1, sprint: true }, 60 * 8, world);
  assert.equal(w.sprinting, false);
  assert.ok(w.stamina < 0.25);
  assert.ok(Math.abs(w.speed - 2.4) < 0.1, `speed ${w.speed}`);
  const s = w.stamina;
  run(w, { moveX: 0, moveY: 1, sprint: false }, 60, world);
  assert.ok(w.stamina > s, 'regenerates');
});

test('wall blocks and the walker slides along it', () => {
  const world = emptyWorld();
  world.collision.addBox(2, -50, 6, 50, 10);
  const w = createWalker(0, 0, 0);
  // diagonal into the wall: forward (+x) and right (+z)
  run(w, { moveX: 1, moveY: 1, sprint: false }, 240, world);
  assert.ok(w.x <= 2 - 0.34, `x ${w.x}`);
  assert.ok(w.z > 4, `slid z ${w.z}`);
});

test('non-ground region blocks and slides', () => {
  const world = emptyWorld();
  world.city = { isGround: (x) => x < 3 };
  const w = createWalker(0, 0, 0);
  run(w, { moveX: 1, moveY: 1, sprint: false }, 240, world);
  assert.ok(w.x < 3, `x ${w.x}`);
  assert.ok(w.z > 4, `slid z ${w.z}`);
});

test('crafts near the ground push the walker out, airborne ones do not', () => {
  const world = emptyWorld();
  world.crafts = [{ x: 4, z: 0, y: 0, radius: 3 }];
  const w = createWalker(0, 0, 0);
  run(w, { moveX: 0, moveY: 1 }, 180, world);
  assert.ok(w.x <= 4 - 1.8 - 0.35 + 1e-6, `x ${w.x}`);
  world.crafts[0].y = 10;
  run(w, { moveX: 0, moveY: 1 }, 180, world);
  assert.ok(w.x > 4);
});

const craft = (x, z, extra = {}) => ({
  x, z, y: 0, heading: 0, speed: 0, wrecked: false, radius: 2.5,
  spec: { width: 2, length: 4.5 }, ...extra,
});

test('findEnterable picks the nearest valid craft', () => {
  const w = createWalker(0, 0, 0);
  const near = craft(3, 0), far = craft(-4, 0);
  const fast = craft(1.5, 0, { speed: 10 });
  const wreck = craft(0, 1.5, { wrecked: true });
  const air = craft(0, -1.5, { y: 5 });
  assert.equal(findEnterable(w, [far, fast, near, wreck, air]), near);
  assert.equal(findEnterable(w, [far]), far);
  assert.equal(findEnterable(w, [fast, wreck, air]), null);
  assert.equal(findEnterable(w, [craft(20, 0)]), null);
  assert.equal(findEnterable(w, []), null);
});

test('exitPosition prefers the left side, falls back when blocked', () => {
  const world = emptyWorld();
  const c = craft(0, 0);
  const out = { x: 0, z: 0, ok: false };
  exitPosition(c, world, out);
  assert.ok(out.ok);
  // left of heading 0 is -z
  assert.ok(Math.abs(out.x) < 1e-9 && Math.abs(out.z + 1.8) < 1e-9, `${out.x},${out.z}`);
  world.collision.addBox(-1, -3, 1, -1.2, 5);
  exitPosition(c, world, out);
  assert.ok(out.ok);
  assert.ok(Math.abs(out.z - 1.8) < 1e-9, 'right side');
  world.city = { isGround: (x, z) => z < -5 || x < -2 }; // only behind is ground
  exitPosition(c, world, out);
  assert.ok(out.ok);
  assert.ok(Math.abs(out.x + 3.05) < 1e-9 && Math.abs(out.z) < 1e-9, 'rear');
  world.city = { isGround: () => false };
  exitPosition(c, world, out);
  assert.equal(out.ok, false);
});

test('no NaN over 2000 random steps', () => {
  const rng = createRng(7);
  const world = emptyWorld();
  for (let i = 0; i < 30; i++) {
    const x = rng.range(-40, 40), z = rng.range(-40, 40);
    if (rng.chance(0.5)) world.collision.addBox(x, z, x + rng.range(1, 6), z + rng.range(1, 6), 8);
    else world.collision.addCircle(x, z, rng.range(0.2, 1.5), 4);
  }
  world.city = { isGround: (x, z) => x * x + z * z < 45 * 45 };
  world.crafts = [craft(5, 5), craft(-10, 3, { y: 1 })];
  const w = createWalker(0.5, 0.5, 0);
  const ctl = { moveX: 0, moveY: 0, sprint: false };
  for (let i = 0; i < 2000; i++) {
    if (i % 20 === 0) {
      ctl.moveX = rng.range(-1.2, 1.2);
      ctl.moveY = rng.range(-1.2, 1.2);
      ctl.sprint = rng.chance(0.4);
    }
    stepWalker(w, rng.chance(0.05) ? null : ctl, DT, world, rng.range(-7, 7));
    for (const k of ['x', 'z', 'heading', 'vx', 'vz', 'speed', 'stride', 'stamina']) {
      assert.ok(Number.isFinite(w[k]), `${k} at step ${i}`);
    }
    assert.ok(w.stamina >= 0 && w.stamina <= 1);
  }
});
