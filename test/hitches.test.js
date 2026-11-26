// 0.13.8 remaining hitches (docs/STATUS.md): the route search in parts
// over several steps gives the same routes as the whole search, the street
// event avoidance from the city's grid marks the same edges as a scan of
// every edge, and the tracker with a search budget keeps the old guidance
// until the new route is ready, then follows the same route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity } from './regionfixture.js';
import { createRouter, createRoute, createTracker } from '../src/core/route.js';
import { placeEvents } from '../src/world/eventspots.js';
import { createRng } from '../src/core/rng.js';
import { ROUTE_BUDGET } from '../src/systems/objective.js';

const c = regionCity('miami-downtown');
const box = c.crop || c.bounds;
function pairs(seed, n) {
  const R = createRng(seed), out = [];
  for (let i = 0; i < n; i++) {
    out.push([box.x0 + R.next() * (box.x1 - box.x0), box.z0 + R.next() * (box.z1 - box.z0), R.next() * 6.283,
      box.x0 + R.next() * (box.x1 - box.x0), box.z0 + R.next() * (box.z1 - box.z0), i % 3 ? NaN : R.next() * 6.283, i % 7 !== 3]);
  }
  return out;
}
function same(a, b, why) {
  assert.equal(a.ok, b.ok, why + ' ok');
  assert.equal(a.partial, b.partial, why + ' partial');
  assert.equal(a.n, b.n, why + ' points');
  assert.equal(a.length, b.length, why + ' length');
  assert.equal(a.startUturn, b.startUturn, why + ' U-turn');
  assert.equal(a.expanded, b.expanded, why + ' nodes');
  assert.deepEqual(Array.from(a.x.subarray(0, a.n)), Array.from(b.x.subarray(0, b.n)), why + ' x');
  assert.deepEqual(Array.from(a.z.subarray(0, a.n)), Array.from(b.z.subarray(0, b.n)), why + ' z');
  assert.equal(a.turnCount, b.turnCount, why + ' turns');
  for (let t = 0; t < a.turnCount; t++) assert.equal(a.turns[t].kind + a.turns[t].name, b.turns[t].kind + b.turns[t].name, why + ' turn ' + t);
}

test('route search in parts (begin, step with a small budget): the same routes as the whole search', () => {
  const whole = createRouter(c), parts = createRouter(c);
  const a = createRoute(), b = createRoute();
  let sliced = 0;
  for (const [fx, fz, h, tx, tz, arr, legal] of pairs(31, 120)) {
    whole.search(fx, fz, h, tx, tz, a, legal, arr);
    const id = parts.begin(fx, fz, h, tx, tz, b, legal, arr);
    const rev = b.rev;
    let steps = 0;
    while (!parts.step(37, id)) {
      steps++;
      assert.equal(b.rev, rev, 'the old route is kept until the search is done');
    }
    if (steps > 2) sliced++;
    same(b, a, `${fx.toFixed(0)},${fz.toFixed(0)} -> ${tx.toFixed(0)},${tz.toFixed(0)}`);
  }
  assert.ok(sliced > 40, 'most searches took several parts: ' + sliced);
});

test('a search dropped by a newer one writes nothing; the newer one is whole', () => {
  const rr = createRouter(c), ref = createRouter(c);
  const a = createRoute(), b = createRoute(), r = createRoute();
  const [p, q] = pairs(5, 2);
  const id1 = rr.begin(p[0], p[1], p[2], p[3], p[4], a, true);
  rr.step(5, id1);
  const rev = a.rev;
  rr.search(q[0], q[1], q[2], q[3], q[4], b, true);
  assert.equal(rr.step(Infinity, id1), true, 'the dropped search reports done');
  assert.equal(a.rev, rev, 'and writes nothing');
  ref.search(q[0], q[1], q[2], q[3], q[4], r, true);
  same(b, r, 'the newer search');
});

test('street event avoidance from the city grid: the same edges and costs as a scan of every edge', () => {
  const gates = placeEvents(c);
  assert.ok(gates.length >= 10, 'gates ' + gates.length);
  const grid = createRouter(c);
  const flat = createRouter({ ...c, edgesNear: undefined });
  const a = createRoute(), b = createRoute();
  let marked = 0;
  for (let i = 0; i < gates.length; i += 3) {
    const g = gates[i];
    const n = grid.setAvoid(gates, g.x, g.z);
    marked += n;
    assert.equal(n, flat.setAvoid(gates, g.x, g.z), 'edges marked, goal ' + i);
    const [p] = pairs(100 + i, 1);
    grid.search(p[0], p[1], p[2], g.x, g.z, a, true);
    flat.search(p[0], p[1], p[2], g.x, g.z, b, true);
    same(a, b, 'route to gate ' + i);
  }
  assert.ok(marked > 20, 'edges marked ' + marked);
});

test('tracker with a search budget: the old guidance holds, then the same route as without one', () => {
  const rr = createRouter(c);
  const t0 = createTracker(rr), t1 = createTracker(createRouter(c), { budget: ROUTE_BUDGET });
  let waited = 0;
  for (const [fx, fz, h, tx, tz] of pairs(77, 30)) {
    t0.setGoal(tx, tz, true);
    t1.setGoal(tx, tz, true);
    t0.update(fx, fz, h, 0, 1 / 60);
    const rev = t1.route.rev;
    let n = 0;
    while (t1.update(fx, fz, h, 0, 1 / 60) === false && t1.route.rev === rev && n < 400) n++;
    if (n > 0) waited++;
    assert.ok(n < 400, 'the search ends');
    same(t1.route, t0.route, 'tracked route');
    assert.equal(t1.remaining, t0.remaining, 'remaining');
  }
  assert.ok(waited > 3, 'some searches took several steps: ' + waited);
});
