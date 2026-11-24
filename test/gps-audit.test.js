// GPS audit (docs/PLAN_V4.md task 2): 200 seeded origin and destination pairs
// per region through the in-game router (scripts/gps-audit.mjs holds the
// checks and prints the same table). A route exists when both ends are on
// roads of one drivable piece, it follows edges and one-ways, its length is
// near the shortest legal way, the turn text names the road taken, the car
// follows it without a re-route and a wrong turn is told within about 2 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGION_IDS, regionCity } from './regionfixture.js';
import { runRegion, followRoutes, rerouteTimes, pickPoint } from '../scripts/gps-audit.mjs';
import { createRng } from '../src/core/rng.js';
import { createRouter, createRoute, createTracker, shortStreet } from '../src/core/route.js';
import { createObjective, objectiveAngle } from '../src/systems/objective.js';

for (const id of REGION_IDS) {
  test('GPS audit ' + id + ': 200 seeded pairs, legal, near shortest, honest turn text', () => {
    const c = regionCity(id);
    const res = runRegion(c, 4242, 200);
    assert.equal(res.pairs, 200);
    assert.deepEqual(res.missed.slice(0, 3), [], 'pairs on one drivable piece with no full route');
    assert.deepEqual(res.illegal.slice(0, 3), [], 'routes that break an edge or a one-way');
    assert.deepEqual(res.guide.slice(0, 3), [], 'turn text or arrow that does not match the road taken');
    assert.ok(res.longer.length === 0, 'routes over 1.2 times the shortest legal way: ' + JSON.stringify(res.longer.slice(0, 2)));
    assert.ok(res.worstVsShortest <= 1.25, 'worst vs shortest ' + res.worstVsShortest.toFixed(2));
    assert.ok(res.noRoute.length <= 45, 'pairs with no full route (islands and one-way traps of the crop) ' + res.noRoute.length);
  });

  test('GPS audit ' + id + ': the car on the line (2 m to the side) never re-routes and reaches the end', () => {
    const c = regionCity(id);
    const f = followRoutes(c, 99, 100, 2);
    assert.ok(f.ran >= 70, 'routes driven ' + f.ran);
    assert.equal(f.rerouted, 0, 're-routes on the line');
    assert.equal(f.arrived, f.ran, 'arrived');
    assert.equal(f.backwards, 0, 'the next turn goes back');
    assert.ok(f.skipped <= 2, 'turns skipped ' + f.skipped);
  });

  test('GPS audit ' + id + ': a wrong turn is re-routed within about 2 s', () => {
    const c = regionCity(id);
    const t = rerouteTimes(c, 7, 200).sort((a, b) => a - b);
    assert.ok(t.length >= 15, 'wrong turns tried ' + t.length);
    const within = t.filter((x) => x <= 3).length / t.length;
    assert.ok(t[t.length >> 1] <= 1.5, 'median ' + t[t.length >> 1].toFixed(2) + ' s from 8 m off the line');
    assert.ok(t[Math.floor(t.length * 0.9)] <= 2.6, 'p90 ' + t[Math.floor(t.length * 0.9)].toFixed(2) + ' s');
    assert.ok(within >= 0.8, 'within 3 s ' + (within * 100).toFixed(0) + ' percent');
  });
}

test('the HUD arrow points along the route (45 m ahead on the line), not through the blocks at the goal', () => {
  const c = regionCity('miami-beach');
  const rng = createRng(2024);
  const A = {}, B = {};
  let checked = 0, differs = 0;
  for (let k = 0; k < 120 && checked < 40; k++) {
    pickPoint(c, rng, A); pickPoint(c, rng, B);
    if (Math.hypot(A.x - B.x, A.z - B.z) < 300) continue;
    const car = { heading: A.heading, speed: 0 };
    const game = {
      city: c, paused: false, camHeading: A.heading, waypoint: { x: B.x, z: B.z },
      player: { x: A.x, z: A.z, mode: 'car', vehicle: car },
    };
    const o = createObjective(game);
    o.refresh();
    const r = o.route;
    if (!r.ok || r.partial || !o.routing) continue;
    o.render(0, 1 / 60);
    // 45 m ahead of the cursor on the route
    const want = o.tracker.along + 45;
    let i = 0;
    while (i + 2 < r.n && r.cum[i + 1] < want) i++;
    const f = Math.max(0, Math.min(1, (want - r.cum[i]) / (r.cum[i + 1] - r.cum[i] || 1)));
    const ax = r.x[i] + (r.x[i + 1] - r.x[i]) * f, az = r.z[i] + (r.z[i + 1] - r.z[i]) * f;
    const expect = objectiveAngle(A.x, A.z, A.heading, ax, az);
    assert.ok(Math.abs(o.angle - expect) < 0.01, 'arrow ' + o.angle.toFixed(1) + ' vs route ' + expect.toFixed(1));
    const straight = objectiveAngle(A.x, A.z, A.heading, B.x, B.z);
    if (Math.abs(straight - expect) > 45) differs++;
    checked++;
  }
  assert.ok(checked >= 30, 'routes checked ' + checked);
  assert.ok(differs >= 3, 'only ' + differs + ' routes where the goal bearing and the route disagree');
});

test('the turn pill and the arrow agree with the next road on a drive', () => {
  const c = regionCity('miami-north');
  const router = createRouter(c);
  const rng = createRng(31337);
  const A = {}, B = {};
  let shown = 0;
  for (let k = 0; k < 40 && shown < 12; k++) {
    pickPoint(c, rng, A); pickPoint(c, rng, B);
    const tr = createTracker(router);
    tr.setGoal(B.x, B.z);
    tr.update(A.x, A.z, A.heading, 0, 1 / 60);
    const r = tr.route;
    if (!r.ok || r.partial || r.turnCount < 3 || r.startUturn) continue;
    // 30 m before the first real turn: the next turn is that one and names the road after it
    const t = r.turns[0];
    if (t.kind === 'arrive' || t.kind === 'uturn' || t.at < 60 || t.node < 0) continue;
    const along = t.at - 30;
    let i = 0;
    while (i + 2 < r.n && r.cum[i + 1] < along) i++;
    const f = (along - r.cum[i]) / (r.cum[i + 1] - r.cum[i] || 1);
    tr.update(r.x[i] + (r.x[i + 1] - r.x[i]) * f, r.z[i] + (r.z[i + 1] - r.z[i]) * f, Math.atan2(r.z[i + 1] - r.z[i], r.x[i + 1] - r.x[i]), 12, 1 / 60);
    assert.equal(tr.turn, 0);
    assert.ok(Math.abs(tr.toTurn - 30) < 6, 'toTurn ' + tr.toTurn.toFixed(1));
    const pi = (() => { for (let q = 1; q < r.edges; q++) if (r.pathFrom[q] === t.node) return q; return -1; })();
    assert.ok(pi > 0, 'turn node on the path');
    // the road taken after the junction carries the pill's name (first named edge within 150 m)
    let name = '', run = 0;
    for (let q = pi; q < r.edges && run <= 150; q++) { const e = c.edges[r.pathE[q]]; if (e.name) { name = e.name; break; } run += e.length; }
    assert.equal(tr.next().name, shortStreet(name));
    shown++;
  }
  assert.ok(shown >= 8, 'turns checked ' + shown);
});

test('a merged pair of turns onto an unnamed ramp keeps the street name', () => {
  // West: a jog onto a named street that continues on an unnamed link.
  const c = regionCity('miami-west');
  const router = createRouter(c);
  const r = createRoute();
  const a = c.edges[864], b = c.edges[1654];
  const A = { x: 0, z: 0, heading: 0 }, B = { x: 0, z: 0 };
  const na = c.nodes[a.a === 626 ? a.b : a.a], nb = c.nodes[b.a];
  A.x = c.nodes[626].x + (na.x - c.nodes[626].x) * 0.35; A.z = c.nodes[626].z + (na.z - c.nodes[626].z) * 0.35;
  A.heading = Math.atan2(na.z - c.nodes[626].z, na.x - c.nodes[626].x);
  B.x = nb.x; B.z = nb.z;
  assert.ok(router.search(A.x, A.z, A.heading, B.x, B.z, r));
  const named = [];
  for (let k = 0; k < r.turnCount - 1; k++) named.push(r.turns[k].name);
  assert.ok(named.some((n) => /8th/.test(n)), 'turn onto 8th Street Road is named: ' + named.join(' | '));
});
