// The Miami map, milestone 1 (docs/MAP.md): the core crop of the real
// OpenStreetMap data built into the same city shape as generateCity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity, MIAMI_CROP, MIAMI_SPOTS } from '../src/world/miami.js';
import { mapFromSearch } from '../src/world/maps.js';
import { lanePoint, laneOffset, lanesPerDirection, DISTRICTS } from '../src/world/citygen.js';
import { createCollisionWorld, fillCollision } from '../src/world/collision.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createTraffic } from '../src/systems/traffic.js';
import { createPeds } from '../src/systems/peds.js';
import { createParkedCars } from '../src/systems/parked.js';
import { findSecrets } from '../src/world/secrets.js';
import { generateStuntSpots } from '../src/world/stunts.js';
import { makeFightGame, step } from './fightgame.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const cpu0 = process.cpuUsage();
const t0 = performance.now();
const city = createMiamiCity(data);
const buildWall = performance.now() - t0;
const buildCpu = process.cpuUsage(cpu0).user / 1000;
const collision = fillCollision(city, createCollisionWorld());
const nodeById = city.nodes;
const otherEnd = (e, n) => (e.a === n ? e.b : e.a);

// Nodes reachable by road from node `from`.
function reach(from) {
  const seen = new Uint8Array(city.nodes.length);
  const stack = [from];
  seen[from] = 1;
  while (stack.length) {
    const n = stack.pop();
    for (const eid of nodeById[n].edges) {
      const o = otherEnd(city.edges[eid], n);
      if (!seen[o]) { seen[o] = 1; stack.push(o); }
    }
  }
  return seen;
}
const nearestNode = (x, z) => city.nodes.reduce((b, n) => (Math.hypot(n.x - x, n.z - z) < Math.hypot(b.x - x, b.z - z) ? n : b), city.nodes[0]);
const inBox = (b, x, z, m = 0) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
const inAnyBuilding = (x, z, m = 0) => city.inBuilding(x, z, m);

test(`builds in under 1.5 s (wall ${buildWall.toFixed(0)} ms, cpu ${buildCpu.toFixed(0)} ms)`, () => {
  // Wall time on a quiet machine; CPU time when other jobs share it.
  assert.ok(Math.min(buildWall, buildCpu) < 1500, `wall ${buildWall.toFixed(0)} ms, cpu ${buildCpu.toFixed(0)} ms`);
  assert.ok(city.nodes.length > 1000 && city.edges.length > 1200, `${city.nodes.length} nodes, ${city.edges.length} edges`);
  assert.ok(city.buildings.length > 3000, `${city.buildings.length} buildings`);
  assert.ok(city.blocks.length > 100, `${city.blocks.length} blocks`);
  assert.match(city.attribution, /OpenStreetMap contributors, ODbL/);
});

test('same object shape as the procedural city', () => {
  for (const k of ['nodes', 'edges', 'blocks', 'buildings', 'props', 'parkingSpots', 'furniture', 'signals', 'piers', 'pois',
    'surfaces', 'aircraftSpots', 'boatSpots', 'helipads', 'tankSpots', 'roofPads', 'extraLand']) assert.ok(Array.isArray(city[k]), k);
  for (const k of ['shoreDist', 'mainShore', 'isLand', 'isGround', 'districtOf', 'onRoad']) assert.equal(typeof city[k], 'function', k);
  for (const k of ['islet', 'runway', 'apron', 'gate']) assert.ok(city.airfield[k], k);
  assert.ok(city.depot && city.depot.gate && city.landmarks && city.streetNames.x.length === 16 && city.streetNames.z.length === 16);
  for (const n of city.nodes) {
    assert.ok(Number.isFinite(n.x + n.z + n.hx + n.hz) && n.hx > 0 && n.hz > 0, `node ${n.id}`);
    assert.ok(n.edges.length > 0);
  }
  for (const e of city.edges) {
    assert.ok(e.length > 0.4 && Number.isFinite(e.ux + e.uz) && Math.abs(Math.hypot(e.ux, e.uz) - 1) < 1e-6, `edge ${e.id}`);
    assert.ok(e.width === 11 || e.width === 18);
    const a = city.nodes[e.a], b = city.nodes[e.b];
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - e.length) < 1e-6);
    assert.ok(a.edges.includes(e.id) && b.edges.includes(e.id));
  }
  // Every district key the city returns is a known one (HUD names).
  for (let x = MIAMI_CROP.x0; x <= MIAMI_CROP.x1; x += 97) {
    for (let z = MIAMI_CROP.z0; z <= MIAMI_CROP.z1; z += 97) assert.ok(DISTRICTS[city.districtOf(x, z)], `${x}, ${z}`);
  }
  // Activities, secrets and ramps are off on this map for now (milestone 2).
  assert.deepEqual(city.courses, []);
  assert.deepEqual(findSecrets(city), { spots: [], garage: null });
  assert.deepEqual(generateStuntSpots(city), []);
});

test('road graph: one network with at least 95 % of the junctions; the airfield is linked', () => {
  const g = city.graphStats;
  assert.ok(g.mainJunctions / g.junctions >= 0.95, `${g.mainJunctions} of ${g.junctions} junctions`);
  // Only the largest network is kept: everything reaches everything.
  const seen = reach(nearestNode(city.spawn.x, city.spawn.z).id);
  assert.equal(seen.reduce((a, v) => a + v, 0), city.nodes.length);
  const gate = city.airfield.gate;
  assert.equal(city.nodes[gate.id], gate);
  assert.ok(seen[gate.id], 'spawn reaches the airfield gate by road');
  const cw = city.edges.find((e) => e.causeway);
  assert.ok(cw && (cw.a === gate.id || cw.b === gate.id), 'causeway edge to the gate');
  // Named check: Biscayne Boulevard joins the MacArthur and Venetian causeways.
  for (const name of ['Biscayne Boulevard', 'MacArthur Causeway', 'Venetian Way', 'Brickell Avenue', 'Port Boulevard']) {
    assert.ok(city.edges.some((e) => e.name === name), name);
  }
});

test('shoreDist: land probes positive, bay probes negative, smooth and finite', () => {
  const land = {
    'Freedom Tower': [-1061, -55], 'Brickell City Centre': [-1216, 1458], 'Brickell Key': [-502, 1407],
    'Watson Island': [450, -600], Edgewater: [-923, -2316], Overtown: [-1630, -102], 'PortMiami': [400, 300],
  };
  const sea = { 'Bay off Bayfront Park': [-300, 600], 'Bay north of Watson Island': [400, -1500], 'Bay by Margaret Pace Park': [-300, -1200], 'Bay east of Edgewater': [-200, -2000] };
  for (const [k, [x, z]] of Object.entries(land)) assert.ok(city.shoreDist(x, z) > 5, `${k} ${city.shoreDist(x, z)}`);
  for (const [k, [x, z]] of Object.entries(sea)) assert.ok(city.shoreDist(x, z) < -20, `${k} ${city.shoreDist(x, z)}`);
  // The islet plus 100 m is open water in the real data.
  const il = city.airfield.islet;
  for (let x = il.x0 - 100; x <= il.x1 + 100; x += 20) {
    for (let z = il.z0 - 100; z <= il.z1 + 100; z += 20) {
      if (inBox(city.extraLand[1], x, z, 2)) continue; // the causeway itself
      if (!inBox(il, x, z, 1)) assert.ok(city.mainShore(x, z) < 0, `islet surroundings at ${x}, ${z}`);
    }
  }
  assert.ok(city.isLand((il.x0 + il.x1) / 2, (il.z0 + il.z1) / 2));
  // Finite everywhere, including well outside the raster, and continuous.
  for (let x = city.bounds.x0 - 500; x <= city.bounds.x1 + 500; x += 61) {
    for (let z = city.bounds.z0 - 500; z <= city.bounds.z1 + 500; z += 61) {
      const d = city.shoreDist(x, z);
      assert.ok(Number.isFinite(d) && d <= 250 && d >= -250);
      assert.ok(Math.abs(city.shoreDist(x + 1, z) - d) <= 1.5 && Math.abs(city.shoreDist(x, z + 1) - d) <= 1.5, `jump at ${x}, ${z}`);
    }
  }
});

test('no seam on any road: every lane, bridge and the causeway is 2 m inside land', () => {
  // Vehicles are pushed back when shoreDist < 2 (entities/vehicle.js).
  const p = { x: 0, z: 0, heading: 0 };
  let worst = Infinity, where = '';
  for (const e of city.edges) {
    for (const from of [e.a, e.b]) {
      for (let lane = 0; lane < lanesPerDirection(e); lane++) {
        for (let d = 0; d <= e.length; d += 3) {
          lanePoint(city, e, from, d, lane, p);
          const s = city.shoreDist(p.x, p.z);
          if (s < worst) { worst = s; where = `${e.name || e.cls} at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`; }
        }
      }
    }
  }
  assert.ok(worst >= 2, `lane at ${worst.toFixed(2)} m from the water: ${where}`);
  // Dead ends at the crop edge are inside land too, with room to turn.
  for (const n of city.nodes) {
    const atEdge = n.x - MIAMI_CROP.x0 < 1 || MIAMI_CROP.x1 - n.x < 1 || n.z - MIAMI_CROP.z0 < 1 || MIAMI_CROP.z1 - n.z < 1;
    if (atEdge) assert.ok(city.shoreDist(n.x, n.z) > 8, `crop-edge node ${n.id}`);
  }
  assert.ok(laneOffset(city.edges[0]) > 0);
});

test('spawn and parked-car spots: on land, on a road, clear of buildings and water', () => {
  const s = city.spawn;
  assert.ok(city.onRoad(s.x, s.z) && city.shoreDist(s.x, s.z) > 5, 'spawn on a road on land');
  assert.ok(!inAnyBuilding(s.x, s.z, 3) && !collision.resolveCircle(s.x, s.z, 2.5, 0).hit, 'spawn clear');
  assert.ok(Math.hypot(s.x - MIAMI_SPOTS.spawn.x, s.z - MIAMI_SPOTS.spawn.z) < 80, 'near the asked place');
  assert.ok(city.edges.some((e) => e.name === MIAMI_SPOTS.spawn.street && city.edgesNear(s.x, s.z, 1, []).includes(e.id)), 'on the named street');
  assert.ok(city.parkingSpots.length > 500, `${city.parkingSpots.length} spots`);
  for (const p of city.parkingSpots) {
    assert.ok(Number.isFinite(p.x + p.z + p.heading));
    assert.ok(city.shoreDist(p.x, p.z) > 3 && city.mainShore(p.x, p.z) > 0, `spot in water ${p.x}, ${p.z}`);
    assert.ok(!collision.resolveCircle(p.x, p.z, 1.2, 0).hit, `spot in a building ${p.x}, ${p.z}`);
    assert.ok(!city.edges.some((e) => e.bridge && city.edgesNear(p.x, p.z, 0, []).includes(e.id)), 'spot on a bridge');
  }
});

test('hand-placed spots: piers into the water, boats afloat, pads and aircraft on land', () => {
  assert.equal(city.piers.length, MIAMI_SPOTS.piers.length + 1);
  assert.equal(city.piers[city.piers.length - 1].label, 'Airfield Dock');
  city.piers.forEach((r, k) => {
    // One end on the ground, the other well out at sea.
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    const ends = alongX ? [[r.x0, (r.z0 + r.z1) / 2], [r.x1, (r.z0 + r.z1) / 2]] : [[(r.x0 + r.x1) / 2, r.z0], [(r.x0 + r.x1) / 2, r.z1]];
    const d = ends.map(([x, z]) => city.shoreDist(x, z)).sort((a, b) => a - b);
    assert.ok(d[0] < -20 && d[1] > -3, `pier ${k} ends ${d.map((v) => v.toFixed(1))}`);
    assert.ok(city.isGround((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2));
  });
  // The spawn can reach every main pier by road (a node near its root).
  const seen = reach(nearestNode(city.spawn.x, city.spawn.z).id);
  for (const r of city.piers.slice(0, -1)) {
    const n = nearestNode((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    assert.ok(seen[n.id] && Math.hypot(n.x - (r.x0 + r.x1) / 2, n.z - (r.z0 + r.z1) / 2) < 250, `road to ${r.label}`);
  }
  for (const b of city.boatSpots) {
    assert.ok(city.shoreDist(b.x, b.z) < -3, `boat ${b.spec} at ${b.x}, ${b.z}`);
    assert.ok(!city.piers.some((r) => inBox(r, b.x, b.z, 1)), 'boat clear of piers');
  }
  for (const h of city.helipads) {
    assert.ok(city.shoreDist(h.x, h.z) > 10 && !inAnyBuilding(h.x, h.z, 9) && !city.onRoad(h.x, h.z), `helipad ${h.x}, ${h.z}`);
  }
  for (const a of city.aircraftSpots) {
    if (a.roof) continue;
    const sd = city.shoreDist(a.x, a.z);
    if (a.spec === 'seaplane') assert.ok(sd < -5, `seaplane at ${a.x}, ${a.z}`);
    else assert.ok(sd > 5 && !collision.resolveCircle(a.x, a.z, 3, 0).hit, `${a.spec} at ${a.x}, ${a.z}`);
  }
  for (const t of city.tankSpots) assert.ok(city.shoreDist(t.x, t.z) > 5 && !collision.resolveCircle(t.x, t.z, 2, 0).hit);
  assert.equal(city.roofPads.length, 1);
});

test('buildings: no box on a road strip, inside the crop, on land; collision works', () => {
  const near = [];
  for (const b of city.buildings) {
    assert.ok(b.x1 > b.x0 && b.z1 > b.z0 && b.h > 0 && b.style && Number.isFinite(b.vseed), 'box');
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    assert.ok(city.shoreDist(cx, cz) > 0, `building in water at ${cx}, ${cz}`);
    const r = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2;
    city.edgesNear(cx, cz, r + 1, near);
    for (const id of near) {
      const e = city.edges[id], a = city.nodes[e.a], c = city.nodes[e.b];
      // Sample the centreline: no point within half a road width of the box.
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
        assert.ok(Math.hypot(dx, dz) >= e.width / 2 - 0.05, `building ${cx.toFixed(0)}, ${cz.toFixed(0)} on ${e.name || e.cls}`);
      }
    }
  }
  // fillCollision gives one box per building, and the boxes block.
  assert.equal(collision.boxes.length, city.buildings.length);
  const big = city.buildings.find((b) => b.x1 - b.x0 > 20 && b.z1 - b.z0 > 20 && !b.depot);
  const bx = (big.x0 + big.x1) / 2, bz = (big.z0 + big.z1) / 2;
  assert.ok(collision.resolveCircle(bx, bz, 1, 0).hit);
  assert.equal(collision.lineClear(big.x0 - 5, bz, big.x1 + 5, bz), false);
  // A car driven into the building stops at its wall.
  const v = createVehicle('sedan', big.x0 - 8, bz, 0);
  v.vx = 20;
  v.speed = 20;
  const world = { collision, city, time: 0 };
  for (let k = 0; k < 120; k++) stepVehicle(v, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 1 / 60, world);
  assert.ok(v.x < big.x0 + 0.5, `car went into the building (${v.x.toFixed(1)} vs ${big.x0.toFixed(1)})`);
  // Blocks are clear of roads and every building in a block keeps its pavement.
  for (const k of city.blocks) {
    city.edgesNear((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2, Math.hypot(k.x1 - k.x0, k.z1 - k.z0) / 2, near);
    for (const id of near) {
      const e = city.edges[id], a = city.nodes[e.a], c = city.nodes[e.b];
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        const dx = Math.max(k.x0 - x, 0, x - k.x1), dz = Math.max(k.z0 - z, 0, z - k.z1);
        assert.ok(Math.hypot(dx, dz) >= e.width / 2 - 0.3, `block ${k.id} on ${e.name || e.cls}`);
      }
    }
  }
});

test('traffic, parked cars and peds run 600 steps: no errors, no NaN, nobody in the water or a building', () => {
  const s = city.spawn;
  const game = makeFightGame({ city, collision, px: s.x + 3, pz: s.z + 3 });
  game.quality = 1;
  game.player.mode = 'foot';
  const traffic = createTraffic(game, { max: 10 });
  const peds = createPeds(game, { max: 16 });
  game.peds = peds;
  const parked = createParkedCars(game);
  const systems = [parked, peds, traffic];
  const world = game.world;
  let maxCars = 0, maxPeds = 0;
  step(game, systems, 600, () => {
    for (const v of game.vehicles) {
      if (v.asleep) continue;
      v.px = v.x;
      v.pz = v.z;
      stepVehicle(v, v.controls || null, 1 / 60, world);
    }
    for (const v of game.vehicles) {
      assert.ok(Number.isFinite(v.x + v.z + v.heading + v.speed), 'car NaN');
      assert.ok(city.shoreDist(v.x, v.z) > 0, `car in the water at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
      assert.ok(!collision.resolveCircle(v.x, v.z, 0.3, 0).hit, `car inside a building at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
    }
    for (const sl of peds.slots) {
      const p = sl.ped;
      if (!p.active) continue;
      assert.ok(Number.isFinite(p.x + p.z + p.heading + p.speed), 'ped NaN');
      assert.ok(city.isGround(p.x, p.z), `ped in the water at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      assert.ok(!inAnyBuilding(p.x, p.z, -0.2), `ped inside a building at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
    maxCars = Math.max(maxCars, traffic.count);
    maxPeds = Math.max(maxPeds, peds.count);
  });
  assert.ok(maxCars >= 4, `traffic spawned (${maxCars})`);
  assert.ok(maxPeds >= 4, `peds spawned (${maxPeds})`);
  assert.ok(game.vehicles.some((v) => v.parked), 'parked cars placed');
  // Traffic actually drives: some car has passed a junction.
  assert.ok(traffic.cars.some((v) => v.ai.junctions > 0), 'traffic passed junctions');
});

test('helpers are cheap: 1e5 calls of shoreDist, onRoad and districtOf', () => {
  const t = performance.now();
  let acc = 0;
  for (let i = 0; i < 1e5; i++) {
    const x = -2500 + (i * 37.1) % 4800, z = -2500 + (i * 53.7) % 4200;
    acc += city.shoreDist(x, z) + (city.onRoad(x, z) ? 1 : 0) + city.districtOf(x, z).length;
  }
  const ms = performance.now() - t;
  assert.ok(Number.isFinite(acc));
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});

test('map choice: the island is the default, ?map=miami picks Miami', () => {
  assert.equal(mapFromSearch(''), 'island');
  assert.equal(mapFromSearch('?autostart'), 'island');
  assert.equal(mapFromSearch('?map=miami'), 'miami');
  assert.equal(mapFromSearch('?autostart&map=miami'), 'miami');
  assert.equal(mapFromSearch('?map=Miami%00'), 'island');
  assert.equal(mapFromSearch('?map=elsewhere'), 'island');
});

test('deterministic: the same data builds the same city', () => {
  const again = createMiamiCity(data);
  assert.equal(again.nodes.length, city.nodes.length);
  assert.equal(again.buildings.length, city.buildings.length);
  assert.deepEqual(again.spawn, city.spawn);
  assert.deepEqual(again.parkingSpots.slice(0, 50), city.parkingSpots.slice(0, 50));
});
