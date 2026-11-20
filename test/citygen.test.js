import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, lanePoint, signalState } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng, angleDiff } from '../src/core/rng.js';

const city = generateCity();

test('rng is deterministic', () => {
  const a = createRng(5), b = createRng(5);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
  assert.ok(Math.abs(angleDiff(0.1, 6.2)) < 0.2);
});

test('city is deterministic and reasonably sized', () => {
  const again = generateCity();
  assert.equal(again.buildings.length, city.buildings.length);
  assert.equal(again.nodes.length, city.nodes.length);
  assert.ok(city.nodes.length > 120, `nodes ${city.nodes.length}`);
  assert.ok(city.buildings.length > 600, `buildings ${city.buildings.length}`);
  assert.ok(city.blocks.length > 100);
  assert.ok(city.parkingSpots.length > 150);
});

test('road graph is fully connected and on land', () => {
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const n = city.nodes[stack.pop()];
    for (const eid of n.edges) {
      const e = city.edges[eid];
      const other = e.a === n.id ? e.b : e.a;
      if (!seen.has(other)) {
        seen.add(other);
        stack.push(other);
      }
    }
  }
  assert.equal(seen.size, city.nodes.length);
  for (const n of city.nodes) assert.ok(city.isLand(n.x, n.z));
});

test('no building overlaps a road, and all are on land', () => {
  for (const b of city.buildings) {
    assert.ok(b.x1 > b.x0 && b.z1 > b.z0 && b.h > 0);
    for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) {
      assert.ok(!city.onRoad(x, z), 'building corner on road');
      assert.ok(city.isLand(x, z), 'building in the sea');
    }
  }
});

test('spawn point is on a road and clear', () => {
  assert.ok(city.onRoad(city.spawn.x, city.spawn.z));
});

test('lanes keep to the right and signals cycle', () => {
  const e = city.edges.find((x) => x.horizontal);
  const p = lanePoint(city, e, e.a, 10);
  const a = city.nodes[e.a];
  assert.ok(p.z > a.z, 'eastbound lane is on the south side');
  const q = lanePoint(city, e, e.b, 10);
  assert.ok(q.z < a.z, 'westbound lane is on the north side');
  const n = city.nodes.find((x) => x.signal);
  const states = new Set();
  for (let t = 0; t < 24; t += 0.5) {
    const h = signalState(n, true, t), v = signalState(n, false, t);
    states.add(h);
    assert.ok(!(h !== 'red' && v !== 'red'), 'both directions open at once');
  }
  assert.equal(states.size, 3);
});

test('collision: circles are pushed out of boxes and circles', () => {
  const w = createCollisionWorld();
  w.addBox(0, 0, 10, 10);
  w.addCircle(20, 0, 1);
  let r = w.resolveCircle(-0.5, 5, 1);
  assert.ok(r.hit);
  assert.ok(Math.abs(r.x - -1) < 1e-6);
  r = w.resolveCircle(5, 9.5, 1);
  assert.ok(r.hit && Math.abs(r.z - 11) < 1e-6, 'inside box exits nearest face');
  r = w.resolveCircle(21.5, 0, 1);
  assert.ok(r.hit && Math.abs(r.x - 22) < 1e-6);
  r = w.resolveCircle(50, 50, 1);
  assert.ok(!r.hit);
});

test('collision: raycast and line of sight', () => {
  const w = createCollisionWorld();
  w.addBox(10, -5, 20, 5);
  assert.ok(Math.abs(w.raycast(0, 0, 1, 0, 100) - 10) < 1e-6);
  assert.equal(w.raycast(0, 0, -1, 0, 100), 100);
  assert.equal(w.raycast(0, 20, 1, 0, 100), 100);
  assert.ok(!w.lineClear(0, 0, 30, 0));
  assert.ok(w.lineClear(0, 0, 9, 0));
});
