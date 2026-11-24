// Collision sweep (docs/PLAN_V4.md task 1, scripts/collision-sweep.mjs):
// the holes the sweep found, each pinned on a small hand-made world, and a
// reduced sweep of one region (every craft into lamps, signal masts, lot
// walls and fences, buildings, barriers, sea walls and rails; boats at the
// shore and the piers) with no craft more than 0.3 m into a solid, below
// the ground, left inside a solid or past a wall toward the water.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle, stepVehicle, vehicleCorners } from '../src/entities/vehicle.js';
import { createTank, stepTank } from '../src/entities/tank.js';
import { createAircraft, stepAircraft } from '../src/entities/aircraft.js';
import { createBoat, stepBoat } from '../src/entities/boat.js';
import { buildWorld, sweepRegion, sweepBoats, penetration, PEN_MAX } from '../scripts/collision-sweep.mjs';

const DT = 1 / 60;
const capsule = (x0, z0, x1, z1, tag = 'seawall') => ({ kind: 2, x0, z0, x1, z1, r: 0.25, h: 0.9, tag, stamp: 0, off: false, brk: null });
// A stand-in for the edge layer: the capsules a 32 m cell lists (those
// reaching into it, as world/edgelines.js lists them).
function edgeLayer(caps) {
  return {
    name: 'edges',
    cell(cx, cz) {
      const x0 = cx * 32, z0 = cz * 32, m = 0.251;
      return caps.filter((s) => Math.max(s.x0, s.x1) >= x0 - m && Math.min(s.x0, s.x1) <= x0 + 32 + m && Math.max(s.z0, s.z1) >= z0 - m && Math.min(s.z0, s.z1) <= z0 + 32 + m);
    },
  };
}
const CORN = new Array(8);

test('resolveLayer: only the named layer pushes; an unknown name never hits', () => {
  const col = createCollisionWorld();
  col.addBox(-1, -1, 1, 1, 5, 'building');
  col.addLayer(edgeLayer([capsule(10, -5, 10, 5)]));
  assert.equal(col.resolveLayer('edges', 0, 0, 0.5, 0).hit, false, 'the box is not in the edge layer');
  assert.equal(col.resolveCircle(0, 0, 0.5, 0).hit, true);
  const r = col.resolveLayer('edges', 10.3, 0, 0.5, 0);
  assert.equal(r.hit, true);
  assert.ok(Math.abs(r.x - 10.75) < 1e-9, `pushed to ${r.x}`);
  assert.equal(col.resolveLayer('nothing', 10.3, 0, 0.5, 0).hit, false);
});

test('tank: a sea wall stops it (it rolls over 1 m props, not the 0.9 m walls)', () => {
  for (const ang of [0, 0.6, 1.1]) {
    for (const u of [3, 8, 13]) {
      const col = createCollisionWorld();
      col.addLayer(edgeLayer([...Array(200)].map((_, i) => capsule(20, -200 + i * 2, 20, -198 + i * 2))));
      const t = createTank('rustback', 10, 0, ang);
      t.vx = Math.cos(ang) * u; t.vz = Math.sin(ang) * u;
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        stepTank(t, { throttle: 1 }, DT, { collision: col, city: null });
        vehicleCorners(t, CORN);
        for (let q = 0; q < 8; q += 2) worst = Math.max(worst, CORN[q] - 19.75);
      }
      assert.ok(worst <= 0.15, `angle ${ang} at ${u} m/s: a corner ${worst.toFixed(2)} m into the wall`);
    }
  }
});

test('tank: the shore push never shoves it through a post (at most 1 m a step, before the walls)', () => {
  const col = createCollisionWorld();
  const lamp = col.addCircle(0, 2.6, 0.18, 7, 'prop');
  // Land at z > 0: the tank at z 0.5 is inside its 2.4 m shore margin.
  const city = { shoreDist: (x, z) => z };
  const t = createTank('rustback', 0, 0.5, 0);
  let worst = -Infinity;
  for (let i = 0; i < 60; i++) {
    stepTank(t, { throttle: 0 }, DT, { collision: col, city });
    for (const o of [1.8, -1.8]) worst = Math.max(worst, penetration(lamp, t.x + Math.cos(t.heading) * o, t.z + Math.sin(t.heading) * o, 1.8));
  }
  assert.ok(worst <= PEN_MAX, `the tank went ${worst.toFixed(2)} m into the lamp`);
});

test('truck: corners stay out of a rail when its center is one cell back', () => {
  // The rail 0.5 m inside cell 1: the edge layer does not list it in cell 0.
  for (const ang of [0.35, 0.6, 1.0]) {
    for (const mph of [15, 30, 45]) {
      const u = mph / 2.23694;
      const col = createCollisionWorld();
      col.addLayer(edgeLayer([...Array(30)].map((_, i) => capsule(32.5, -30 + i * 2, 32.5, -28 + i * 2, 'rail'))));
      const v = createVehicle('truck', 24, 0, ang);
      v.vx = Math.cos(ang) * u; v.vz = Math.sin(ang) * u;
      let worst = -Infinity;
      for (let i = 0; i < 240; i++) {
        stepVehicle(v, { throttle: 1 }, DT, { collision: col });
        vehicleCorners(v, CORN);
        for (let q = 0; q < 8; q += 2) worst = Math.max(worst, CORN[q] - 32.25);
      }
      assert.ok(worst <= 0.15, `angle ${ang} at ${mph} mph: a corner ${worst.toFixed(2)} m into the rail`);
    }
  }
});

test('car: the corner probes by a sea wall never pull the car through a thin lot wall', () => {
  // A 0.3 m lot wall (the thinnest, 0.5 m tall, x 0 to 0.3) with a sea
  // wall in the car's cell, so the box corners are probed. The car is put
  // at rest with its body circles clear of the lot wall and a front corner
  // probe point past the wall's middle. Was: the probe left the lot wall by its
  // far face and pulled the car through it.
  for (const hd of [0.7, 0.79, 0.9]) {
    const col = createCollisionWorld();
    const wall = col.addBox(0, -10, 0.3, 10, 0.5, 'lot');
    col.addLayer(edgeLayer([capsule(-9, -20, -9, 20)]));
    const spec = createVehicle('sedan', 0, 0, 0).spec;
    const r = spec.width / 2, half = spec.length / 2 - r;
    const ch = Math.cos(hd), sh = Math.sin(hd);
    let cx = NaN;
    for (let x = -6; x < 0; x += 0.005) {
      let circ = -Infinity;
      for (const o of [half, 0, -half]) circ = Math.max(circ, penetration(wall, x + ch * o, sh * o, r));
      // The front corner's probe point (0.08 m in from the corner).
      const lo = spec.length / 2 - 0.08, la = spec.width / 2 - 0.08;
      const probe = x + Math.max(ch * lo - sh * la, ch * lo + sh * la);
      if (circ < -0.005 && probe > 0.17 && probe < 0.28) { cx = x; break; }
    }
    assert.ok(Number.isFinite(cx), `heading ${hd}: a pose with a corner probe inside the wall`);
    const v = createVehicle('sedan', cx, 0, hd);
    stepVehicle(v, { throttle: 0, brake: 0 }, DT, { collision: col });
    let worst = -Infinity;
    for (const o of [half, 0, -half]) worst = Math.max(worst, penetration(wall, v.x + Math.cos(v.heading) * o, v.z + Math.sin(v.heading) * o, r));
    assert.ok(worst <= 0.05 && v.x - cx < 0.05, `heading ${hd}: moved ${(v.x - cx).toFixed(2)} m toward the wall, ${worst.toFixed(2)} m into it`);
  }
});

test('plane: taxiing on a deck over the water, the shore push does not shove it into the rail', () => {
  const col = createCollisionWorld();
  col.addLayer(edgeLayer([...Array(40)].map((_, i) => capsule(-40 + i * 2, 2.2, -38 + i * 2, 2.2, 'rail'))));
  // Water everywhere (land far to +z), but the deck is ground.
  const city = { shoreDist: (x, z) => z - 1000, isGround: () => true };
  const a = createAircraft('prop', 0, 0, Math.PI);
  a.speed = 20; a.vx = -20; a.engineOn = true;
  for (let i = 0; i < 60; i++) stepAircraft(a, { throttle: 0.25, steer: 0, pitch: 0, brake: 0 }, DT, { collision: col, city });
  assert.equal(a.wrecked, false, 'not wrecked');
  assert.ok(Math.abs(a.z) < 0.5, `stayed in its lane (z ${a.z.toFixed(2)})`);
});

test('boat: the hull corners stay off the shore at an angle', () => {
  // Land at x > 0.
  const city = { shoreDist: (x) => x, isLand: (x) => x > 0 };
  for (const spec of ['fisher', 'speedboat']) {
    for (const deg of [0, 35, 65]) {
      for (const u of [8, 18]) {
        const hd = (deg * Math.PI) / 180;
        const b = createBoat(spec, -25, 0, hd);
        b.vx = Math.cos(hd) * u; b.vz = Math.sin(hd) * u; b.speed = u;
        let worst = -Infinity;
        for (let i = 0; i < 300; i++) {
          stepBoat(b, { throttle: 1, steer: 0 }, DT, { city, waterCollision: createCollisionWorld(), time: i * DT });
          vehicleCorners({ x: b.x, z: b.z, heading: b.heading, spec: b.spec }, CORN);
          for (let q = 0; q < 8; q += 2) worst = Math.max(worst, CORN[q]);
        }
        assert.ok(worst <= 0.05, `${spec} at ${deg} degrees, ${u} m/s: a corner ${worst.toFixed(2)} m onto the land`);
      }
    }
  }
});

test('reduced sweep, Downtown: every craft into posts, walls, buildings, barriers, sea walls and rails, boats at the shore and piers', () => {
  const W = buildWorld('miami-downtown');
  const classes = ['street:lamp', 'street:signal', 'street:palm', 'lot:wall', 'lot:fence', 'lot:car', 'building', 'barrier', 'seawall', 'rail'];
  const rows = sweepRegion(W, { per: 1, pool: 12, classes }).concat(sweepBoats(W, { per: 2, specs: ['fisher'] }));
  const fails = rows.flatMap((r) => r.fails);
  assert.deepEqual(fails, [], 'failing runs');
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  const seen = new Set(rows.map((r) => r.cls));
  for (const c of [...classes, 'shore', 'pier']) assert.ok(seen.has(c), `${c} was swept`);
  for (const c of ['car', 'truck', 'tank', 'plane', 'foot', 'boat:fisher']) assert.ok(rows.some((r) => r.craft === c), `${c} was driven`);
  assert.ok(runs >= 400, `${runs} runs`);
});
