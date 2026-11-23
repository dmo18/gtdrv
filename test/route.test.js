// GPS routes (src/core/route.js, docs/PLAN_V3.md 2.7 and section 6 item 11):
// connected and legal on one-ways, Alton Road from 5th Street to Lincoln
// Road, an L route gives one "turn right onto", re-routing when off the
// line, prompts in ft and mi, determinism and search time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity } from './regionfixture.js';
import { createRng } from '../src/core/rng.js';
import { canDrive, lanePoint } from '../src/world/citygen.js';
import {
  createRouter, createRoute, createTracker, turnText, formatTurnDistance, formatEta, shortStreet, turnKind,
  OFF_ROUTE_M,
} from '../src/core/route.js';

const beach = regionCity('miami-beach');
const router = createRouter(beach);
const meet = (city, A, B) => city.nodes.find((n) => n.edges.some((i) => city.edges[i].name === A) && n.edges.some((i) => city.edges[i].name === B));

// Every path edge is entered legally and joins the one before it.
function assertLegal(city, r) {
  for (let i = 0; i < r.edges; i++) {
    const e = city.edges[r.pathE[i]], from = r.pathFrom[i];
    assert.ok(e.a === from || e.b === from, 'path edge ' + i + ' starts at its from node');
    assert.ok(canDrive(e, from), 'one-way edge ' + e.id + ' (' + e.name + ') driven the wrong way');
    if (i > 0) {
      const p = city.edges[r.pathE[i - 1]], pf = r.pathFrom[i - 1];
      assert.equal(p.a === pf ? p.b : p.a, from, 'path edges ' + (i - 1) + ' and ' + i + ' are joined');
    }
  }
  for (let i = 1; i < r.n; i++) {
    assert.ok(r.cum[i] > r.cum[i - 1], 'cumulative length grows');
    const lim = Math.max(city.edges[r.seg[i - 1]].length, city.edges[r.seg[i]].length) + 40;
    assert.ok(Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1]) < lim, 'no jump in the polyline');
  }
}

test('Alton Road from 5th Street to Lincoln Road: on Alton for 90 percent, 1.8 km within 5 percent', () => {
  const a = meet(beach, 'Alton Road', '5th Street'), b = meet(beach, 'Alton Road', 'Lincoln Road');
  assert.ok(a && b, 'both junctions exist');
  const r = createRoute();
  for (const heading of [-Math.PI / 2, Math.PI / 2]) {
    assert.ok(router.search(a.x, a.z, heading, b.x, b.z, r), 'a route');
    assertLegal(beach, r);
    let alton = 0;
    for (let i = 0; i + 1 < r.n; i++) if (beach.edges[r.seg[i]].name === 'Alton Road') alton += r.cum[i + 1] - r.cum[i];
    assert.ok(alton / r.length >= 0.9, 'on Alton Road ' + (alton / r.length * 100).toFixed(0) + ' percent');
    assert.ok(Math.abs(r.length - 1800) <= 90, 'length ' + r.length.toFixed(0) + ' m');
    // Straight up Alton: past the junction at the start (a U-turn facing south) no turn until the arrival.
    for (let k = 0; k + 1 < r.turnCount; k++) assert.ok(r.turns[k].at < 60, 'a turn at ' + r.turns[k].at.toFixed(0) + ' m');
    assert.equal(r.turns[r.turnCount - 1].kind, 'arrive');
  }
});

test('an L route gives exactly one "turn right onto <name>"', () => {
  const P = { x: 0, z: 0, heading: 0 };
  const r = createRoute();
  let tried = 0;
  for (const J of beach.nodes) {
    if (J.edges.length !== 4 || tried >= 12) continue;
    for (const ia of J.edges) {
      const ein = beach.edges[ia];
      if (!ein.name || ein.ped || ein.length < 120) continue;
      const from = ein.a === J.id ? ein.b : ein.a;
      if (!canDrive(ein, from)) continue;
      const inx = (J.x - beach.nodes[from].x) / ein.length, inz = (J.z - beach.nodes[from].z) / ein.length;
      for (const ib of J.edges) {
        const eo = beach.edges[ib];
        if (ib === ia || !eo.name || eo.ped || eo.name === ein.name || eo.length < 120 || !canDrive(eo, J.id)) continue;
        const ox = eo.a === J.id ? eo.ux : -eo.ux, oz = eo.a === J.id ? eo.uz : -eo.uz;
        if (!(inx * oz - inz * ox > 0.95)) continue; // a right angle to the right
        tried++;
        lanePoint(beach, ein, from, 20, 0, P);
        const sx = P.x, sz = P.z, h = P.heading;
        lanePoint(beach, eo, J.id, eo.length - 30, 0, P);
        assert.ok(router.search(sx, sz, h, P.x, P.z, r));
        assertLegal(beach, r);
        assert.equal(r.turnCount, 2, ein.name + ' -> ' + eo.name);
        const t = r.turns[0];
        assert.equal(t.kind, 'right');
        assert.equal(t.name, shortStreet(eo.name));
        assert.equal(turnText(t, 91.44), 'In 300 ft, turn right onto ' + shortStreet(eo.name));
      }
    }
  }
  assert.ok(tried >= 5, 'L corners tried: ' + tried);
});

test('random routes across the Beach are connected, legal on one-ways, with a sane turn count', () => {
  const rng = createRng(911);
  const c = beach.crop;
  const r = createRoute();
  let routes = 0, partial = 0, worst = 0, sumMs = 0;
  for (let k = 0; k < 40; k++) {
    const fx = c.x0 + rng.next() * (c.x1 - c.x0), fz = c.z0 + rng.next() * (c.z1 - c.z0);
    const tx = c.x0 + rng.next() * (c.x1 - c.x0), tz = c.z0 + rng.next() * (c.z1 - c.z0);
    const ok = router.search(fx, fz, rng.next() * 6.28, tx, tz, r);
    if (!ok) continue;
    routes++;
    if (r.partial) partial++;
    assertLegal(beach, r);
    const turns = r.turnCount - 1;
    assert.ok(turns <= 4 + r.length / 120, turns + ' turns for ' + r.length.toFixed(0) + ' m');
    assert.equal(r.turns[r.turnCount - 1].kind, 'arrive');
    for (let i = 0; i < r.turnCount; i++) assert.ok(r.turns[i].at >= 0 && r.turns[i].at <= r.length + 0.01);
    worst = Math.max(worst, r.searchMs);
    sumMs += r.searchMs;
  }
  assert.ok(routes >= 36, 'routes found ' + routes);
  assert.ok(partial <= routes / 2, 'partial routes ' + partial);
  assert.ok(sumMs / routes < 8, 'mean search ' + (sumMs / routes).toFixed(2) + ' ms (worst ' + worst.toFixed(1) + ')');
});

test('the same search gives the same route (determinism)', () => {
  const a = createRoute(), b = createRoute();
  const s = beach.spawn;
  router.search(s.x, s.z, s.heading, 2600, -2400, a);
  createRouter(beach).search(s.x, s.z, s.heading, 2600, -2400, b);
  assert.equal(a.n, b.n);
  assert.deepEqual(Array.from(a.x.subarray(0, a.n)), Array.from(b.x.subarray(0, b.n)));
  assert.deepEqual(a.turns.slice(0, a.turnCount).map((t) => t.kind + t.name), b.turns.slice(0, b.turnCount).map((t) => t.kind + t.name));
});

test('the tracker follows the line with a cursor and re-routes within 2.5 s when 40 m off it', () => {
  const tr = createTracker(router);
  const s = beach.spawn;
  const goal = meet(beach, 'Washington Avenue', 'Lincoln Road');
  tr.setGoal(goal.x, goal.z);
  const dt = 1 / 60;
  tr.update(s.x, s.z, s.heading, 0, dt);
  const r = tr.route;
  assert.ok(r.ok, 'route found');
  const rev0 = tr.rev;
  // Drive along the polyline at 12 m/s.
  let along = 0, lastTo = Infinity, x = s.x, z = s.z;
  const at = (d) => {
    let i = 0;
    while (i + 2 < r.n && r.cum[i + 1] < d) i++;
    const t = Math.max(0, Math.min(1, (d - r.cum[i]) / (r.cum[i + 1] - r.cum[i] || 1)));
    x = r.x[i] + (r.x[i + 1] - r.x[i]) * t;
    z = r.z[i] + (r.z[i + 1] - r.z[i]) * t;
    return Math.atan2(r.z[i + 1] - r.z[i], r.x[i + 1] - r.x[i]);
  };
  while (along < r.length * 0.4) {
    along += 12 * dt;
    const h = at(along);
    tr.update(x, z, h, 12, dt);
    const nt = tr.next();
    if (nt && nt.kind !== 'arrive' && tr.turn === 0) {
      assert.ok(tr.toTurn <= lastTo + 0.5, 'distance to the turn falls');
      lastTo = tr.toTurn;
    }
  }
  assert.equal(tr.rev, rev0, 'no re-route while on the line');
  assert.ok(Math.abs(tr.along - along) < 3, 'cursor along ' + tr.along.toFixed(1) + ' vs ' + along.toFixed(1));
  assert.ok(tr.remaining > 0 && tr.eta > 0);
  assert.ok(tr.off < 4, 'on the line: ' + tr.off.toFixed(1) + ' m');
  // Leave the route: 60 m off to the side, facing away.
  const h = at(along);
  const ox = x - Math.sin(h) * 60, oz = z + Math.cos(h) * 60;
  let t = 0;
  while (tr.rev === rev0 && t < 5) { tr.update(ox, oz, h + Math.PI / 2, 10, dt); t += dt; }
  assert.ok(tr.rev !== rev0, 're-routed');
  assert.ok(t <= 2.5, 're-routed after ' + t.toFixed(2) + ' s');
  assert.ok(tr.off > OFF_ROUTE_M || r.ok, 'new route');
  assert.ok(r.ok && Math.hypot(r.x[0] - ox, r.z[0] - oz) < 60, 'the new route starts near the car');
  assert.ok(Math.hypot(r.destX - goal.x, r.destZ - goal.z) < 40, 'and ends at the same goal');
  // Arrive.
  tr.update(r.destX, r.destZ, 0, 0, dt);
  assert.ok(tr.arrived);
  tr.clear();
  assert.equal(tr.active, false);
});

test('prompts read in ft under 1,000 ft and in mi above', () => {
  assert.equal(formatTurnDistance(91.44), '300 ft');
  assert.equal(formatTurnDistance(20), '70 ft');
  assert.equal(formatTurnDistance(290), '950 ft');
  assert.equal(formatTurnDistance(310), '0.2 mi');
  assert.equal(formatTurnDistance(1609.344), '1.0 mi');
  assert.equal(formatEta(30), '1 min');
  assert.equal(formatEta(600), '10 min');
  assert.equal(shortStreet('Alton Road'), 'Alton Rd');
  assert.equal(shortStreet('West 28th Street'), 'W 28th St');
  assert.equal(shortStreet('Collins Avenue'), 'Collins Ave');
  assert.equal(shortStreet('Ocean Drive'), 'Ocean Dr');
  assert.equal(turnKind(Math.PI / 2), 'right');
  assert.equal(turnKind(-Math.PI / 2), 'left');
  assert.equal(turnKind(0.5), 'slight-right');
  assert.equal(turnKind(Math.PI), 'uturn');
  assert.equal(turnText({ kind: 'right', name: 'Alton Rd' }, 91.44), 'In 300 ft, turn right onto Alton Rd');
  assert.equal(turnText({ kind: 'left', name: '5th St' }, 5), 'Turn left onto 5th St');
});

test('a search takes under 8 ms on the largest region', () => {
  const down = regionCity('miami-downtown');
  const big = down.nodes.length >= beach.nodes.length ? down : beach;
  const R = createRouter(big);
  const r = createRoute();
  const c = big.crop;
  // corner to corner, the longest searches
  const pts = [[c.x0 + 200, c.z0 + 200, c.x1 - 200, c.z1 - 200], [c.x1 - 200, c.z0 + 200, c.x0 + 200, c.z1 - 200], [c.x0 + 300, c.z1 - 300, c.x1 - 300, c.z0 + 300]];
  for (let w = 0; w < 3; w++) R.search(pts[0][0], pts[0][1], 0, pts[0][2], pts[0][3], r); // warm up
  const times = [];
  for (let k = 0; k < 9; k++) {
    const p = pts[k % 3];
    R.search(p[0], p[1], 0, p[2], p[3], r);
    times.push(r.searchMs);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[4] < 8, 'median ' + times[4].toFixed(2) + ' ms');
});
