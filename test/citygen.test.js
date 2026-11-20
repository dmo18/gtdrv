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

test('collision: height filter and roof height', () => {
  const w = createCollisionWorld();
  w.addBox(0, 0, 10, 10, 20);
  assert.ok(w.resolveCircle(5, 5, 1, 5).hit, 'below the roof collides');
  assert.ok(!w.resolveCircle(5, 5, 1, 25).hit, 'above the roof is clear');
  assert.equal(w.heightAt(5, 5), 20);
  assert.equal(w.heightAt(50, 5), 0);
});

test('causeway is solid ground all the way to the airfield', () => {
  const gate = city.airfield.gate;
  const e = city.edges.find((x) => x.causeway);
  const a = city.nodes[e.a === gate.id ? e.b : e.a];
  for (let x = a.x; x <= gate.x; x += 2) {
    assert.ok(city.shoreDist(x, a.z) > 5, `thin land at x=${x.toFixed(0)}: ${city.shoreDist(x, a.z).toFixed(1)}`);
  }
  for (const s of city.boatSpots) assert.ok(city.shoreDist(s.x, s.z) < -1, 'boat berth is in the water');
  for (const s of city.aircraftSpots) {
    if (s.spec !== 'seaplane') assert.ok(city.shoreDist(s.x, s.z) > 3, `${s.spec} spot on land`);
  }
});

test('task 33 spots: fighter on the apron, police heli by the pads, clear and apart', () => {
  const col = createCollisionWorld();
  for (const b of city.buildings) col.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
  const { apron, runway } = city.airfield;
  const f = city.aircraftSpots.find((s) => s.spec === 'fighter' && !s.depot && !s.roof);
  const h = city.aircraftSpots.find((s) => s.spec === 'patrolheli' && !s.depot && !s.roof);
  assert.ok(f && h);
  for (const [s, r] of [[f, 7], [h, 6]]) {
    const inside = (q) => s.x > q.x0 && s.x < q.x1 && s.z > q.z0 && s.z < q.z1;
    assert.ok(inside(apron) || inside(runway), `${s.spec} on the apron or runway`);
    assert.equal(col.resolveCircle(s.x, s.z, r, 1).hit, false, `${s.spec} clear of buildings`);
    assert.ok(city.isGround(s.x, s.z) && !city.onRoad(s.x, s.z));
    for (const o of [...city.aircraftSpots, ...city.boatSpots]) {
      if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) > 20, `${s.spec} apart from ${o.spec}`);
    }
  }
  // The older spots keep their place and order; deterministic.
  assert.deepEqual(city.aircraftSpots.slice(0, 7).map((s) => s.spec), ['prop', 'stunt', 'jet', 'prop', 'heli', 'heavyheli', 'seaplane']);
  assert.deepEqual(generateCity().aircraftSpots, city.aircraftSpots);
});

// ---- Task 32: Ironbank Depot, tank spots, roof pad (docs/ARMS.md 3) ----
// Everything generated before the military places, with the depot items
// and the parking cleared for the Cinder Row tank left out.
function cityPrint(c, tankSpot) {
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
  const pick = (o, keys) => keys.map((k) => r(o[k])).join(':');
  const parts = [];
  parts.push(c.buildings.filter((b) => !b.depot).map((b) => pick(b, ['x0', 'z0', 'x1', 'z1', 'h', 'kind', 'color', 'style', 'tint', 'vseed', 'block', 'street'])).join('|'));
  parts.push(c.nodes.map((n) => pick(n, ['x', 'z', 'hx', 'hz'])).join('|'));
  parts.push(c.edges.map((e) => pick(e, ['a', 'b', 'width', 'length'])).join('|'));
  parts.push(c.props.map((p) => pick(p, ['type', 'x', 'z', 'h'])).join('|'));
  parts.push(c.furniture.map((p) => pick(p, ['type', 'x', 'z', 'rot'])).join('|'));
  parts.push(c.parkingSpots.filter((s) => !tankSpot || Math.hypot(s.x - tankSpot.x, s.z - tankSpot.z) >= 6).map((p) => pick(p, ['x', 'z', 'heading'])).join('|'));
  parts.push(c.aircraftSpots.slice(0, 7).map((p) => pick(p, ['x', 'z', 'spec'])).join('|'));
  parts.push(c.boatSpots.map((p) => pick(p, ['x', 'z', 'spec'])).join('|'));
  parts.push(c.surfaces.filter((s) => !s.depot).map((p) => pick(p, ['x0', 'z0', 'x1', 'z1', 'type'])).join('|'));
  parts.push(c.pois.filter((p) => p.type !== 'depot').map((p) => pick(p, ['x', 'z', 'label'])).join('|'));
  parts.push(c.helipads.slice(0, 2).map((p) => pick(p, ['x', 'z'])).join('|'));
  parts.push(JSON.stringify(c.landmarks), JSON.stringify(c.signals), JSON.stringify(c.blocks), JSON.stringify(c.piers));
  const s = parts.join('#');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16) + ':' + s.length;
}

test('task 32: the city before the military places is unchanged (buildings, roads, props, courses data)', () => {
  const cinder = city.tankSpots.find((s) => s.place === 'cinder');
  // Fingerprint of the city as generated before task 32 (same seed).
  assert.equal(cityPrint(city, cinder), 'e0ac5ff1:249312');
  assert.ok(city.parkingSpots.length >= 960, 'only a couple of parking spaces cleared');
  for (const s of city.parkingSpots) assert.ok(Math.hypot(s.x - cinder.x, s.z - cinder.z) >= 6, 'no car parked on the Cinder Row tank');
});

test('task 32: Ironbank Depot on the islet, clear of roads and buildings, reachable through its gate', () => {
  const col = createCollisionWorld();
  for (const b of city.buildings) col.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
  const d = city.depot, { islet, runway } = city.airfield;
  assert.ok(d.x0 >= islet.x0 + 520 - 1e-6 && d.x1 <= islet.x1 - 40 + 1e-6 && d.z0 >= runway.z1 + 12 - 1e-6 && d.z1 <= islet.z1 - 24 + 1e-6);
  const poi = city.pois.find((p) => p.type === 'depot');
  assert.ok(poi && poi.label === 'Ironbank Depot');
  assert.ok(city.surfaces.some((s) => s.type === 'apron' && s.depot));
  // Depot buildings: on land, off every road, not overlapping older buildings.
  const old = city.buildings.filter((b) => !b.depot);
  for (const b of city.buildings.filter((q) => q.depot)) {
    for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z1], [b.x0, b.z1], [b.x1, b.z0]]) {
      assert.ok(city.isLand(x, z) && !city.onRoad(x, z));
    }
    assert.ok(!old.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.z0 < o.z1 && b.z1 > o.z0), 'no overlap with an older building');
    assert.ok(!(b.z0 < runway.z1 && b.z1 > runway.z0), 'off the runway');
  }
  assert.ok(old.length === city.buildings.length - city.buildings.filter((q) => q.depot).length);
  // Spots: two tanks in the depot, one in Cinder Row; fighters and police helis.
  const depotTanks = city.tankSpots.filter((s) => s.place === 'depot');
  assert.equal(depotTanks.length, 2);
  const cinder = city.tankSpots.find((s) => s.place === 'cinder');
  assert.ok(cinder && city.districtOf(cinder.x, cinder.z) === 'industrial');
  for (const s of city.tankSpots) {
    for (const off of [-1.8, 1.8]) {
      const x = s.x + Math.cos(s.heading) * off, z = s.z + Math.sin(s.heading) * off;
      assert.equal(col.resolveCircle(x, z, 1.9, 1).hit, false, `${s.place} tank clear of buildings`);
      assert.ok(city.shoreDist(x, z) > 3, 'on land');
    }
  }
  assert.equal(city.aircraftSpots.filter((s) => s.depot && s.spec === 'fighter').length, 2);
  assert.ok(city.aircraftSpots.some((s) => s.depot && s.spec === 'patrolheli'));
  const roof = city.roofPads[0];
  assert.ok(roof && roof.y >= 12 && roof.y <= 30 && Math.abs(col.heightAt(roof.x, roof.z) - roof.y) < 1e-6, 'police pad on a roof');
  assert.ok(city.aircraftSpots.some((s) => s.roof && s.spec === 'patrolheli' && s.x === roof.x));
  // Reachable: flood a 2 m grid (tank-sized clearance) from the airfield
  // gate node and from the nearest road node to the Cinder Row tank.
  const flood = (sx, sz, x0, z0, x1, z1, goals) => {
    const S = 2, W = Math.ceil((x1 - x0) / S), H = Math.ceil((z1 - z0) / S);
    const seen = new Uint8Array(W * H);
    const free = (i, j) => {
      const x = x0 + i * S, z = z0 + j * S;
      return city.shoreDist(x, z) > 3 && !col.resolveCircle(x, z, 1.9, 1).hit;
    };
    const q = [];
    const si = Math.round((sx - x0) / S), sj = Math.round((sz - z0) / S);
    seen[sj * W + si] = 1;
    q.push(si, sj);
    for (let h = 0; h < q.length; h += 2) {
      const i = q[h], j = q[h + 1];
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H || seen[nj * W + ni]) continue;
        seen[nj * W + ni] = 1;
        if (free(ni, nj)) q.push(ni, nj);
        else seen[nj * W + ni] = 2;
      }
    }
    return goals.map((g) => seen[Math.round((g.z - z0) / S) * W + Math.round((g.x - x0) / S)] === 1);
  };
  const gate = city.airfield.gate;
  const reach = flood(gate.x, gate.z, gate.x - 20, islet.z0, d.x1 + 10, islet.z1, [...depotTanks, ...city.aircraftSpots.filter((s) => s.depot)]);
  assert.ok(reach.every(Boolean), `depot spots reachable from the airfield gate (${reach})`);
  let node = city.nodes[0];
  for (const n of city.nodes) if (Math.hypot(n.x - cinder.x, n.z - cinder.z) < Math.hypot(node.x - cinder.x, node.z - cinder.z)) node = n;
  const box = [Math.min(node.x, cinder.x) - 60, Math.min(node.z, cinder.z) - 60, Math.max(node.x, cinder.x) + 60, Math.max(node.z, cinder.z) + 60];
  assert.ok(flood(node.x, node.z, ...box, [cinder])[0], 'Cinder Row tank can drive out to the road');
  // Deterministic.
  const again = generateCity();
  assert.deepEqual(again.tankSpots, city.tankSpots);
  assert.deepEqual(again.depot, city.depot);
  assert.deepEqual(again.roofPads, city.roofPads);
});
