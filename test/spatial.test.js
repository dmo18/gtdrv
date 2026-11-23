// The shared grid index, the per-step spawn gate and the mesh warmer
// (src/core/spatial.js), and the H1 budget on the real map: the systems that
// fill the world round the player stay cheap a step (docs/PLAN_V2.md 5.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRng } from '../src/core/rng.js';
import {
  createGridIndex, createPointIndex, beginSpawnStep, takeSpawn, spawnsLeft, belowLiveCap, createWarmer,
  SPAWNS_PER_STEP, LIVE_CAP, SPAWNER,
} from '../src/core/spatial.js';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createParkedCars } from '../src/systems/parked.js';
import { createPeds } from '../src/systems/peds.js';
import { createTraffic } from '../src/systems/traffic.js';
import { createPolice } from '../src/systems/police.js';
import { createService } from '../src/systems/service.js';
import { createFleet } from '../src/systems/fleet.js';
import { createCrew } from '../src/systems/crew.js';
import { createStunts } from '../src/systems/stunts.js';
import { createSystemTimer } from '../src/ui/phonecheck.js';
import { makeFightGame } from './fightgame.js';

test('grid index: near() is the brute-force answer, ascending', () => {
  const rng = createRng(11);
  const pts = [];
  for (let i = 0; i < 2000; i++) pts.push({ x: rng.range(-3000, 3000), z: rng.range(-2000, 2000) });
  const idx = createPointIndex(pts.length, (i) => pts[i].x, (i) => pts[i].z, 64);
  const boxes = [];
  for (let i = 0; i < 600; i++) {
    const x = rng.range(-3000, 3000), z = rng.range(-2000, 2000);
    boxes.push({ x0: x, z0: z, x1: x + rng.range(0, 300), z1: z + rng.range(0, 40) });
  }
  const bidx = createGridIndex(boxes.length, (i, b) => Object.assign(b, boxes[i]), 96);
  const out = [];
  for (let q = 0; q < 200; q++) {
    const x = rng.range(-3200, 3200), z = rng.range(-2200, 2200), r = rng.range(0, 400);
    const want = [];
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - x, pts[i].z - z) <= r) want.push(i);
    assert.deepEqual(idx.near(x, z, r, out), want);
    const wantB = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      if (dx * dx + dz * dz <= r * r) wantB.push(i);
    }
    assert.deepEqual(bidx.near(x, z, r, out), wantB);
    // nearest: the lowest id among the closest boxes, within the reach.
    let best = -1, bd = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      if (i % 3 === 0) continue;
      const d = bidx.dist2(i, x, z);
      if (d < bd) { bd = d; best = i; }
    }
    assert.equal(bidx.nearest(x, z, 5000, (i) => i % 3 !== 0), best);
  }
  assert.deepEqual(idx.near(NaN, 0, 10, out), []);
});

test('spawn gate: two spawns a step across systems; a new step by time or by a system coming round', () => {
  const game = { time: 0 };
  beginSpawnStep(game, SPAWNER.parked);
  assert.equal(spawnsLeft(game), SPAWNS_PER_STEP);
  assert.ok(takeSpawn(game));
  beginSpawnStep(game, SPAWNER.traffic); // same step
  assert.ok(takeSpawn(game));
  assert.ok(!takeSpawn(game), 'third spawn in one step');
  assert.ok(!takeSpawn(game, 2));
  beginSpawnStep(game, SPAWNER.parked); // parked again: the next step, even with the same time
  assert.ok(takeSpawn(game, 2));
  game.time += 1 / 60;
  beginSpawnStep(game, SPAWNER.traffic);
  assert.equal(spawnsLeft(game), 2);
  assert.ok(belowLiveCap({ vehicles: new Array(LIVE_CAP - 1) }));
  assert.ok(!belowLiveCap({ vehicles: new Array(LIVE_CAP) }));
  assert.ok(!belowLiveCap({ vehicles: new Array(LIVE_CAP - 5) }, 5));
});

test('mesh warmer: one listed mesh every few steps, only where the game draws', () => {
  const made = [];
  const game = { scene: {}, kinds: { car: { createMesh: (spec, c) => made.push([spec.id, c]) } } };
  const w = createWarmer([['car', { id: 'a', colors: [5] }], ['car', { id: 'b' }, 7], ['boat', { id: 'x' }]], 3, 2);
  const at = [];
  for (let i = 1; i <= 12; i++) if (w.step(game)) at.push(i);
  assert.deepEqual(at, [2, 5]);
  assert.deepEqual(made, [['a', 5], ['b', 7]]);
  assert.ok(w.done);
  const w2 = createWarmer([['car', { id: 'a' }]], 1, 1);
  w2.step({});
  assert.ok(w2.done, 'no scene: nothing to warm');
});

// ---------------------------------------------------------------------------
// The real map: the ambient systems drive round the start at 20 m/s.
// ---------------------------------------------------------------------------
const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const collision = createCollisionWorld();
for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);

// A chain of road nodes from the start, the straightest edge each time.
function route(length) {
  let n = city.nodes.reduce((b, q) => (Math.hypot(q.x - city.spawn.x, q.z - city.spawn.z) < Math.hypot(b.x - city.spawn.x, b.z - city.spawn.z) ? q : b), city.nodes[0]);
  const pts = [n.x, n.z], seen = new Set([n.id]);
  let hx = Math.cos(city.spawn.heading), hz = Math.sin(city.spawn.heading), len = 0, back = -1;
  for (let hop = 0; hop < 400 && len < length; hop++) {
    let best = null, bs = -Infinity;
    for (const eid of n.edges) {
      const e = city.edges[eid], o = city.nodes[e.a === n.id ? e.b : e.a];
      if (o.id === back || e.causeway) continue;
      const l = Math.hypot(o.x - n.x, o.z - n.z) || 1;
      const sc = ((o.x - n.x) * hx + (o.z - n.z) * hz) / l - (seen.has(o.id) ? 4 : 0);
      if (sc > bs) { bs = sc; best = o; }
    }
    back = n.id;
    if (!best) break;
    const l = Math.hypot(best.x - n.x, best.z - n.z) || 1;
    hx = (best.x - n.x) / l; hz = (best.z - n.z) / l;
    len += l;
    pts.push(best.x, best.z);
    seen.add(best.id);
    n = best;
  }
  return pts;
}

// One drive: returns what the budget test checks.
function drive() {
  const game = makeFightGame({ city, collision, px: city.spawn.x, pz: city.spawn.z });
  game.quality = 1;
  game.clock = 13;
  game.kinds = { car: {}, boat: {}, plane: {}, heli: {}, tank: {} };
  const parked = createParkedCars(game);
  game.systems = [parked];
  const peds = createPeds(game);
  game.peds = peds;
  const fleet = createFleet(game);
  const traffic = createTraffic(game);
  const police = createPolice(game);
  const crew = createCrew(game);
  const service = createService(game);
  const stunts = createStunts(game);
  const systems = [parked, peds, fleet, traffic, police, crew, service, stunts];
  game.systems = systems;
  const builtAtStart = game.vehicles.length;

  // CPU time of this process (other test files running beside this one
  // do not count; its own garbage collection does).
  const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const timer = createSystemTimer(systems, cpuMs);
  const pts = route(20 * 40 + 100);
  const p = game.player;
  let seg = 0, along = 0, mostSpawns = 0, mostLive = 0, firstParked = 0, firstPeds = 0;
  const firstStep = [];
  const n = 60 * 40;
  for (let i = 0; i < n; i++) {
    let l = Math.hypot(pts[seg + 2] - pts[seg], pts[seg + 3] - pts[seg + 1]) || 1;
    while (along > l && seg + 5 < pts.length) { along -= l; seg += 2; l = Math.hypot(pts[seg + 2] - pts[seg], pts[seg + 3] - pts[seg + 1]) || 1; }
    p.x = p.walker.x = pts[seg] + ((pts[seg + 2] - pts[seg]) * Math.min(along, l)) / l;
    p.z = p.walker.z = pts[seg + 1] + ((pts[seg + 3] - pts[seg + 1]) * Math.min(along, l)) / l;
    p.heading = Math.atan2(pts[seg + 3] - pts[seg + 1], pts[seg + 2] - pts[seg]);
    if (i >= 60) along += 20 / 60; // a second standing at the start, then a drive
    game.time += 1 / 60;
    game.world.time = game.time;
    if (i === 120) timer.start(); // after the first two seconds
    const before = game.spawnGate ? game.spawnGate.total : 0;
    for (const s of systems) {
      if (i === 0) {
        const t = performance.now();
        s.fixedUpdate(1 / 60);
        firstStep.push([s.name, performance.now() - t]);
      } else s.fixedUpdate(1 / 60);
    }
    const made = game.spawnGate.total - before;
    if (made > mostSpawns) mostSpawns = made;
    if (game.vehicles.length > mostLive) mostLive = game.vehicles.length;
    if (i === 59) {
      firstParked = parked.spots.filter((s) => s.vehicle).length;
      firstPeds = peds.count;
    }
  }
  timer.stop();
  return { builtAtStart, firstStep, worst: timer.worst(), mostSpawns, mostLive, fleet, parked, firstParked, firstPeds };
}

test('H1 budget on the real map: spawns spread, two a step at most, live cap, cheap steps', () => {
  drive(); // warm the JIT: the measured run is the next one
  let r = drive();
  // A garbage collection can land in any call: the better of two runs.
  if (r.worst.ms >= 8) {
    const r2 = drive();
    if (r2.worst.ms < r.worst.ms) r = r2;
  }
  const { builtAtStart, firstStep, worst, mostSpawns, mostLive, fleet, parked, firstParked, firstPeds } = r;
  assert.equal(builtAtStart, 0, 'nothing built before the first step');
  assert.ok(firstParked >= 4, `${firstParked} parked cars within the first second`);
  assert.ok(firstPeds >= 4, `${firstPeds} people within the first second`);
  const sum = firstStep.reduce((a, [, ms]) => a + ms, 0);
  console.log(`# first step ${sum.toFixed(1)} ms (${firstStep.map(([k, ms]) => `${k} ${ms.toFixed(1)}`).join(', ')}); worst single call after 2 s: ${worst.name} ${worst.ms.toFixed(2)} ms; most spawns in a step ${mostSpawns}; most live vehicles ${mostLive}; parked looked at ${parked.stats.looked} spots in ${parked.stats.scans} scans`);
  assert.ok(mostSpawns <= SPAWNS_PER_STEP, `${mostSpawns} spawns in one step`);
  assert.ok(mostLive <= LIVE_CAP, `${mostLive} live vehicles`);
  assert.ok(fleet.ready, 'every berth filled by distance within the run');
  // A parked scan looks at the spots near the player, not the city's 27k.
  assert.ok(parked.stats.looked / parked.stats.scans < 2000, `${(parked.stats.looked / parked.stats.scans).toFixed(0)} spots a scan`);
  // No single system call over 8 ms of CPU once the first two seconds are
  // past (desktop node; the work budget is 1 ms a step, the margin is for a
  // garbage collection landing in a call and for slow machines).
  assert.ok(worst.ms < 8, `slowest call ${worst.name} ${worst.ms.toFixed(2)} ms`);
});
