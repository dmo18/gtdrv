// 0.13.4: unit tests for recently added logic: mkShape, deadEnds on a small
// synthetic city, router.setAvoid, traffic stageAhead/stageBay protection of
// parked cars that must stay, heat.ceiling, keepJoinedRamps (through Downtown).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkShape } from '../src/world/shape.js';
import { deadEnds, DEAD_END_GAP } from '../src/world/deadends.js';
import { createRouter, createRoute, AVOID_COST } from '../src/core/route.js';
import { createTraffic } from '../src/systems/traffic.js';
import { createRng } from '../src/core/rng.js';
import { createHeat, updateHeat, MAX_HEAT } from '../src/systems/police.js';
import { regionCity } from './regionfixture.js';

test('mkShape: fixed field layout, hidden group, JSON without grp', () => {
  const s = mkShape('box', 1, 2, 3, 4, 5, 6, 7, 8, 'tag');
  assert.deepEqual(Object.keys(s), ['kind', 'x0', 'z0', 'x1', 'z1', 'x', 'z', 'r', 'h', 'tag', 'stamp', 'off', 'brk', 'ptype']);
  assert.equal(s.kind, 'box');
  assert.equal(s.tag, 'tag');
  assert.equal(s.stamp, 0);
  assert.equal(s.off, false);
  assert.equal(s.brk, null);
  assert.equal(s.ptype, '');
  assert.equal(s.grp, null);
  assert.ok(!JSON.stringify(s).includes('grp'));
  s.grp = [1];
  assert.deepEqual(s.grp, [1], 'grp is writable');
  const t = mkShape('circle');
  assert.deepEqual(Object.keys(t), Object.keys(s), 'same layout with arguments missing');
  assert.equal(t.x0, undefined);
});

function lineCity({ land = () => true, building = () => false, roadEnds = [] } = {}) {
  // 0 --- 1 --- 2 along +x, plus a 5 m stub 3 off node 1 (too short)
  const nodes = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }, { x: 100, z: 5 }];
  const mk = (id, a, b) => {
    const dx = nodes[b].x - nodes[a].x, dz = nodes[b].z - nodes[a].z, length = Math.hypot(dx, dz);
    return { id, a, b, width: 8, length, ux: dx / length, uz: dz / length };
  };
  const edges = [mk(0, 0, 1), mk(1, 1, 2), mk(2, 1, 3)];
  return { nodes, edges, roadGeo: {}, roadEnds, isLand: land, inBuilding: building, edgesNear: () => {} };
}

test('deadEnds: a barricade past each loose end, cached, none for short stubs, crop ends, buildings or water', () => {
  const c = lineCity();
  const list = deadEnds(c);
  assert.equal(deadEnds(c), list, 'cached');
  assert.equal(list.length, 2, 'both ends of the line, not the 5 m stub');
  const west = list.find((d) => d.node === 0), east = list.find((d) => d.node === 2);
  assert.ok(Math.abs(west.x - -DEAD_END_GAP) < 1e-9 && Math.abs(west.z) < 1e-9);
  assert.ok(Math.abs(east.x - (200 + DEAD_END_GAP)) < 1e-9);
  assert.ok(Math.abs(Math.abs(west.heading) - Math.PI) < 1e-9, 'heading points out of the end');
  assert.equal(east.heading, 0);
  assert.equal(east.w, 9);
  assert.equal(deadEnds(lineCity({ roadEnds: [{ node: 0 }] })).length, 1, 'a crop edge end is skipped');
  assert.equal(deadEnds(lineCity({ building: () => true })).length, 0, 'into a building');
  assert.equal(deadEnds(lineCity({ land: () => false })).length, 0, 'into water');
  const noGeo = lineCity();
  delete noGeo.roadGeo;
  assert.equal(deadEnds(noGeo).length, 0, 'the island city (no roadGeo) has none');
  const onRoad = lineCity();
  onRoad.edgesNear = (x, z, r, out) => { out.length = 0; out.push(3); };
  onRoad.edges.push({ id: 99, a: 0, b: 1, width: 400, length: 100 });
  assert.equal(deadEnds(onRoad).length, 0, 'a road the graph does not join');
});

test('router.setAvoid: penalizes gates other than the goal, resets, never bans', () => {
  const beach = regionCity('miami-beach');
  const rr = createRouter(beach), r = createRoute();
  const e = beach.edges.find((q) => q.length > 60 && !q.ped);
  const a = beach.nodes[e.a], b = beach.nodes[e.b];
  const gate = { x: a.x + e.ux * e.length / 2, z: a.z + e.uz * e.length / 2, dx: e.ux, dz: e.uz, w: 4 };
  assert.ok(AVOID_COST > 0);
  assert.equal(rr.setAvoid(null), 0);
  assert.ok(rr.setAvoid([gate], NaN, NaN) >= 1, 'an edge through the beam is marked');
  assert.equal(rr.setAvoid([gate], gate.x + 5, gate.z), 0, 'the goal gate (within 30 m) is skipped');
  assert.ok(rr.setAvoid([gate]) >= 1);
  assert.equal(rr.setAvoid(null), 0, 'null clears');
  assert.equal(rr.setAvoid([]), 0);
  rr.setAvoid([gate]);
  assert.ok(rr.search(a.x, a.z, Math.atan2(e.uz, e.ux), b.x, b.z, r, false), 'a penalty, not a ban: still routes');
  rr.setAvoid(null);
});

function stageWorld(city, ev) {
  const vehicles = [];
  const g = {
    city, vehicles, rng: createRng(5), time: 0, quality: 1,
    player: { x: ev.x - ev.dx * 40, z: ev.z - ev.dz * 40, y: 0, heading: ev.heading, vehicle: null },
    addVehicle(v) { vehicles.push(v); },
    removeVehicle(v) { vehicles.splice(vehicles.indexOf(v), 1); v.removed = true; },
  };
  return { g, vehicles, traffic: createTraffic(g, { max: 14 }) };
}

test('stageBay never removes parked cars with home, svcHome, staged, or the player\'s car', async () => {
  const { placeEvents } = await import('../src/world/eventspots.js');
  const bc = regionCity('miami-beach');
  const ev = placeEvents(bc)[0];
  const dists = [50, 90, 135];
  const first = stageWorld(bc, ev);
  assert.ok(first.traffic.stageAhead(ev.x, ev.z, ev.dx, ev.dz, dists, 6) >= 2);
  const st = first.vehicles.filter((v) => v.staged);
  const w = stageWorld(bc, ev);
  const keep = [], plain = [];
  for (const v of st) {
    const hx = Math.cos(v.heading), hz = Math.sin(v.heading);
    for (let al = -6; al <= 70; al += 6) {
      const at = (lat) => ({ x: v.x + hx * al - hz * lat, z: v.z + hz * al + hx * lat, parked: true });
      keep.push({ ...at(2.7), home: true }, { ...at(-2.7), svcHome: true });
      plain.push(at(3.3), at(-3.3));
    }
  }
  const player = { x: st[0].x + 10, z: st[0].z, parked: true };
  const stagedParked = { x: st[0].x - 3, z: st[0].z + 2.7, parked: true, staged: true };
  w.g.player.vehicle = player;
  for (const o of [...keep, ...plain, player, stagedParked]) w.vehicles.push(o);
  const n = w.traffic.stageAhead(ev.x, ev.z, ev.dx, ev.dz, dists, 6);
  assert.ok(n >= 1, 'placed ' + n);
  for (const o of keep) assert.ok(!o.removed, 'home or svcHome car kept');
  assert.ok(!player.removed && !stagedParked.removed);
  assert.ok(plain.some((o) => o.removed), 'ordinary parked cars in the bay are cleared');
});

test('heat.ceiling: default is the top level; held at the ceiling, lower levels still step', () => {
  const h = createHeat();
  assert.equal(h.ceiling, MAX_HEAT);
  h.ceiling = 2;
  const f = { crashedTraffic: true, inCar: true, enabled: true };
  for (let i = 0; i < 20; i++) updateHeat(h, 1 / 60, f);
  assert.equal(h.level, 1, 'steps up below the ceiling');
  h.level = 2;
  h.grace = 0;
  for (let i = 0; i < 600; i++) updateHeat(h, 1 / 60, f);
  assert.equal(h.level, 2, 'no step up at the ceiling');
  assert.ok(h.points < 1);
});

test('keepJoinedRamps: Downtown routes in full to the Watson Island garage over the kept ramps', () => {
  const c = regionCity('miami-downtown');
  const rr = createRouter(c), r = createRoute();
  const g = c.garages.find((q) => q.id === 'g-watson');
  assert.ok(g && rr.search(c.spawn.x, c.spawn.z, c.spawn.heading, g.x, g.z, r) && !r.partial);
});
