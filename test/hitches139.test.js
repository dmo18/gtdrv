// 0.13.9 hitches and start (docs/STATUS.md): the street tile's junction
// corners and strips ask the ground in slices (a cold ask of the narrow-gap
// net was up to 100 ms at a 4x throttle), the first hit is rehearsed on a
// stand-in combat, and the start's tiles are built without a clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createGround } from '../src/world/ground.js';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import { realRoads, realJunctionJob, realEdgeJob } from '../src/render/citymesh.js';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createWalker } from '../src/entities/onfoot.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { createRng } from '../src/core/rng.js';
import { RULES, createArms } from '../src/core/weapons.js';
import { createCombat, initActor, addActor, warmCombat } from '../src/systems/combat.js';

const region = 'miami-downtown';
const city = createMiamiCity(JSON.parse(fs.readFileSync(new URL(`../src/world/data/${region}.json`, import.meta.url), 'utf8')), { region });
const KEYS = ['asphalt', 'sidewalk', 'grass', 'paint'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};
function dump(B) {
  const out = [];
  for (const k of KEYS) for (const mb of B[k].map.values()) out.push(k, mb.count, ...mb.pos.subarray(0, mb.count * 3), ...mb.col.subarray(0, mb.count * 3), ...mb.idx);
  return out;
}
// The nodes and edges within r of the spawn.
const sp = city.spawn;
const near = (r) => ({
  nodes: city.nodes.filter((n) => Math.hypot(n.x - sp.x, n.z - sp.z) < r),
  edges: city.edges.filter((e) => { const a = city.nodes[e.a]; return Math.hypot(a.x - sp.x, a.z - sp.z) < r; }),
});

test('surfaceAtJob and surfaceTry: the answers of surfaceAt, a stop at every ask', () => {
  // Two grounds of the same city: one asked straight, one in slices
  // (fresh caches each, so the sliced one meets cold net points).
  const A = createGround(city), B = createGround(city);
  const rng = createRng(9);
  let stops = 0, tried = 0;
  const over = () => true;
  for (let i = 0; i < 1500; i++) {
    const x = sp.x + (rng.next() - 0.5) * 300, z = sp.z + (rng.next() - 0.5) * 300;
    const want = A.surfaceAt(x, z);
    const t = B.surfaceTry(x, z);
    if (t >= 0) { tried++; assert.equal(t, want, `try at ${x}, ${z}`); }
    const it = B.surfaceAtJob(x, z, over);
    let r = it.next();
    while (!r.done) { stops++; r = it.next(); }
    assert.equal(r.value, want, `job at ${x}, ${z}`);
    // Once worked out, known cheaply.
    assert.equal(B.surfaceTry(x, z), want);
  }
  assert.ok(stops > 0, 'some asks stopped (cold net points)');
  assert.ok(tried > 0, 'some asks known cheaply');
});

test('junctions and strips in slices: the same triangles as realRoads', () => {
  const { nodes, edges } = near(220);
  assert.ok(nodes.length > 20 && edges.length > 20);
  // In slices first, a stop wherever one may be (on a fresh ground the
  // asks are cold), then straight: the ground's answers are pure, so the
  // order changes nothing.
  const S = builders();
  let stops = 0;
  const over = () => true;
  for (const n of nodes) for (const _ of realJunctionJob(city, S, n, null, over)) stops++;
  for (const e of edges) for (const _ of realEdgeJob(city, S, e, null, over)) stops++;
  const P = builders();
  realRoads(city, P, nodes, edges);
  assert.ok(stops > 0);
  assert.deepEqual(dump(S), dump(P));
});

// A small combat scene on the real city (as test/combat.test.js builds it).
function fight() {
  const collision = createCollisionWorld();
  const walker = createWalker(sp.x, sp.z, 0);
  const game = {
    events: createEvents(), collision, city, world: { collision, city }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker, x: walker.x, z: walker.z, y: 0, health: 100, wanted: 0 },
    progress: { stats: {} }, input: null,
  };
  createCombat(game, { seed: 5 });
  const log = [];
  for (const nm of ['hit', 'down', 'explosion', 'shot']) game.events.on(nm, (e) => log.push(nm, Math.round((e && e.x) * 1000) || 0, e && e.amount ? Math.round(e.amount * 1000) : 0));
  const a = initActor({ x: sp.x, z: sp.z + 3, y: 0, heading: 0, radius: 0.35, px: sp.x, pz: sp.z + 3, vx: 0, vz: 0 }, 'crew');
  a.arms = createArms('smg');
  addActor(game, a);
  const b = initActor({ x: sp.x + 9, z: sp.z + 3, y: 0, heading: 0, radius: 0.35, px: sp.x + 9, pz: sp.z + 3, vx: 0, vz: 0 }, 'civ');
  addActor(game, b);
  const car = createVehicle('sedan', sp.x + 14, sp.z + 8, 0, createRng(3));
  game.vehicles.push(car);
  for (let i = 0; i < 90; i++) {
    if (i % 6 === 0) game.combat.fire(a, 1, 0, 0);
    if (i === 40) game.combat.explode(sp.x + 14, 0.5, sp.z + 8, 6);
    game.combat.fixedUpdate(1 / 60);
  }
  log.push(a.hp, b.hp, b.life, Math.round(car.health * 1000), car.wrecked, car.burning);
  return log;
}

test('warmCombat: hits, a blast and a knock-down on a stand-in; a real fight is the same after it', () => {
  const before = fight();
  assert.ok(before.filter((x) => x === 'hit').length >= 2 && before.includes('explosion'), 'the fight lands a shot and a blast');
  const r =warmCombat(city, sp.x, sp.z, sp.heading || 0);
  assert.ok(r.hits > 0, 'the rehearsal hit something');
  assert.equal(r.blasts, 1);
  assert.ok(r.downs > 0);
  assert.ok(r.shots > 0);
  const after = fight();
  assert.deepEqual(after, before);
  assert.ok(RULES.invulnerable, 'cannot-die default holds');
});
