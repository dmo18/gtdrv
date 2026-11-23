// The lots' collision shapes (docs/REVAMP.md 6.2) exist in the simulation
// from the city build, whatever the renderer streams: the same seed and
// the same car input give the same run whether or not near tiles are
// built (on a wall-clock budget, as in the render loop) in between.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld, fillCollision, fillLotCollision } from '../src/world/collision.js';
import { buildRealCity } from '../src/render/realcity.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createRng } from '../src/core/rng.js';

const DT = 1 / 60, STEPS = 1200;
// The Downtown region (docs/PLAN_V2.md 3.7: downtown, Brickell,
// Overtown, Edgewater, Wynwood), from its own data file.
const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami-downtown.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data, { region: 'miami-downtown' });
const CROP = city.crop;
// Stand-in textures (node has no canvas).
const rect = { u0: 0, u1: 1, v0: 0, v1: 1, w: 64, h: 64 };
const rects = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? rect : undefined) });
const textures = new Proxy({}, { get: (o, k) => (k === 'decals' || k === 'details' ? { rects } : {}) });

function quietBuild(collision) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return buildRealCity(city, collision, { textures });
  } finally {
    console.warn = warn;
  }
}

// A solid lot wall box far from the spawn (its tile is not built at
// start), with a clear run of road or lot of 15 to 40 m west of it. (A
// fence or gate is breakable since PLAN_V3 2.2: the car may shear it, so
// it is not a wall to stop at; test/prop-collision.test.js covers those.)
function pickTarget(collision, shapes, st) {
  const s = city.spawn;
  for (const b of shapes) {
    if (b.kind !== 0 || b.tag !== 'lot' || b.brk || b.z1 - b.z0 < 3) continue;
    const cz = (b.z0 + b.z1) / 2;
    if (Math.hypot(b.x0 - s.x, cz - s.z) < 600) continue;
    if (st.tiles[st.tileOf(b.x0, cz)].group) continue;
    const x = b.x0 - 30;
    if (x < CROP.x0 + 50 || !city.isGround(x, cz)) continue;
    if (collision.resolveCircle(x, cz, 3).hit) continue;
    const d = collision.raycast(x, cz, 1, 0, 40);
    if (Math.abs(d - (b.x0 - x)) > 1e-6) continue;
    return { b, x, z: cz };
  }
  return null;
}

// One run: a sedan from (x, z) heading east, seeded throttle and steer.
// stream: build and drop near tiles round the car between steps, on a
// wall-clock budget that changes from step to step.
function run(collision, st, start, stream) {
  const v = createVehicle('sedan', start.x, start.z, 0, createRng(7));
  const world = { collision, city, time: 0 };
  const rng = createRng(20261122);
  const out = new Float64Array(STEPS * 3);
  let impacts = 0, built = 0;
  const cam = { position: { x: 0, y: 2, z: 0 } };
  for (let i = 0; i < STEPS; i++) {
    const c = { throttle: i < 900 ? 0.6 + rng.next() * 0.4 : 0, steer: (rng.next() - 0.5) * 0.3, brake: i >= 900 ? 1 : 0, handbrake: false };
    stepVehicle(v, c, DT, world);
    world.time += DT;
    if (v.impact > 0) impacts++;
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.z;
    out[i * 3 + 2] = v.heading;
    if (stream && i % 5 === 0) {
      cam.position.x = v.x;
      cam.position.z = v.z;
      const before = st.stats.built;
      st.update(cam, i % 200 === 0 ? Infinity : 0.5 + (i % 7));
      built += st.stats.built - before;
    }
  }
  return { out, impacts, built };
}

test('lot solids collide from the build: the same run with or without tiles streaming', () => {
  assert.ok(city.lots && city.lots.length > 100, 'the crop has lots');
  // The renderer's world has the same building and lot shapes as a
  // world filled without it (it adds street prop circles on top).
  const pure = createCollisionWorld();
  fillCollision(city, pure);
  const pureLots = fillLotCollision(city, pure);
  const colA = createCollisionWorld();
  const A = quietBuild(colA);
  const stA = A.userData.stream;
  assert.equal(colA.boxes.length, pure.boxes.length);
  assert.ok(colA.circles.length >= pure.circles.length);
  assert.equal(stA.lotShapes(), pureLots.length);
  const target = pickTarget(colA, colA.boxes, stA);
  assert.ok(target, 'a lot wall away from the spawn');
  const tile = stA.tiles[stA.tileOf(target.b.x0, target.z)];

  // A: tiles never streamed (only the start ones round the spawn).
  const a = run(colA, stA, target, false);
  assert.equal(tile.group, null, 'the target tile was never built in A');
  assert.ok(a.impacts > 0, 'the car hits something');
  // The car is stopped by the lot wall, never past it.
  let maxX = -Infinity;
  for (let i = 0; i < STEPS; i++) maxX = Math.max(maxX, a.out[i * 3]);
  assert.ok(maxX < target.b.x0, `car stays west of the lot wall (${maxX.toFixed(2)} < ${target.b.x0.toFixed(2)})`);

  // B: a second build, near tiles built and dropped round the car on a
  // wall-clock budget between steps.
  const colB = createCollisionWorld();
  const B = quietBuild(colB);
  const stB = B.userData.stream;
  const b = run(colB, stB, target, true);
  assert.ok(b.built > 0, 'tiles were built during run B');
  assert.ok(stB.tiles[tile.k].group, 'the target tile was built in B');
  assert.equal(colB.boxes.length + colB.circles.length, colA.boxes.length + colA.circles.length, 'streaming adds no shapes');
  for (let i = 0; i < STEPS * 3; i++) assert.equal(b.out[i], a.out[i], `step ${Math.floor(i / 3)}: streamed run differs`);
});

test('setEnabled switches a shape off and on for every query', () => {
  const col = createCollisionWorld();
  const box = col.addBox(0, 0, 4, 4, 3, 'lot');
  const circ = col.addCircle(10, 2, 1, 2, 'lot');
  assert.ok(col.resolveCircle(2, 2, 0.5).hit);
  assert.ok(col.raycast(-5, 2, 1, 0, 30) < 6);
  assert.equal(col.heightAt(2, 2), 3);
  assert.ok(col.resolveCircle(10, 2, 0.5).hit);
  col.setEnabled(box, false);
  col.setEnabled(circ, false);
  assert.ok(!col.resolveCircle(2, 2, 0.5).hit);
  assert.ok(!col.resolveCircle(10, 2, 0.5).hit);
  assert.equal(col.raycast(-5, 2, 1, 0, 30), 30);
  assert.ok(col.lineClear(-5, 2, 20, 2));
  assert.equal(col.heightAt(2, 2), 0);
  col.setEnabled(box, true);
  assert.ok(col.resolveCircle(2, 2, 0.5).hit);
  assert.ok(Math.abs(col.raycast(-5, 2, 1, 0, 30) - 5) < 1e-9);
  assert.equal(col.heightAt(2, 2), 3);
  assert.ok(!col.resolveCircle(10, 2, 0.5).hit, 'the circle stays off');
});
