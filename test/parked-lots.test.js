// The parked-car system: curb cars only where a parking lane exists, and the
// static lot cars it keeps in view (no scene in node: the field only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createParkedCars } from '../src/systems/parked.js';
import { LOT_CAR_CAP, LOT_CAR_CAP_MAX } from '../src/render/lotmesh.js';
import { makeFightGame } from './fightgame.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const collision = createCollisionWorld(city);

function game(px, pz) {
  const g = makeFightGame({ city, collision, px, pz });
  g.clock = 13;
  g.kinds = { car: {}, boat: {}, plane: {}, heli: {}, tank: {} };
  return g;
}

test('curb cars stand only on streets that have a parking lane', () => {
  const g = game(city.spawn.x, city.spawn.z);
  const p = createParkedCars(g);
  // Mark the street under three spots: none, parkL only, parkR only.
  const curb = p.spots.filter((s) => !s.lot && !s.start).slice(0, 3);
  assert.equal(curb.length, 3);
  const edgeOf = (s) => {
    const out = [];
    city.edgesNear(s.x, s.z, 14, out);
    return out.map((i) => city.edges[i]).sort((a, b) => {
      const d = (e) => { const n = city.nodes[e.a]; const t = Math.max(0, Math.min(e.length, (s.x - n.x) * e.ux + (s.z - n.z) * e.uz)); return Math.hypot(s.x - n.x - e.ux * t, s.z - n.z - e.uz * t); };
      return d(a) - d(b);
    })[0];
  };
  const edges = curb.map(edgeOf);
  edges[0].parkL = 0; edges[0].parkR = 0;
  edges[1].parkL = 2.4; edges[1].parkR = 2.4;
  edges[2].avenue = true; edges[2].parkL = undefined; edges[2].parkR = undefined;
  try {
    for (const s of curb) { s.x += 0; s.vehicle = null; s.used = false; }
    // Put the player on each in turn and let the queue run.
    for (const s of curb) {
      g.player.x = s.x + 90; g.player.z = s.z;
      for (let i = 0; i < 200; i++) p.fixedUpdate(0.1);
    }
    assert.ok(!curb[0].vehicle && curb[0].used, 'a street with parkL = parkR = 0 has no cars');
    assert.ok(curb[1].vehicle || curb[1].used, 'a street with parking lanes keeps its spot');
    assert.ok(!curb[2].vehicle, 'an avenue without lane data has none');
    assert.ok(p.stats.noLane >= 2, `${p.stats.noLane} spots dropped`);
  } finally {
    for (const e of edges) { delete e.parkL; delete e.parkR; }
    edges[2].avenue = false;
  }
});

test('lot cars: the field is capped at 40 by default, 60 at most, curb cars counting first', () => {
  const lot = city.lots.find((l) => l.type === 'carpark' && l.area > 900);
  const g = game((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2);
  const p = createParkedCars(g);
  assert.ok(p.lotField, 'a city with lots has the field');
  assert.equal(p.lotView, null, 'no scene: no meshes');
  for (let i = 0; i < 40; i++) p.fixedUpdate(0.1);
  assert.ok(p.lotField.n > 0 && p.lotField.n <= LOT_CAR_CAP, `${p.lotField.n} lot cars`);
  g.graphics = { parkedCars: 200 };
  for (let i = 0; i < 40; i++) p.fixedUpdate(0.1);
  assert.ok(p.lotField.n <= LOT_CAR_CAP_MAX);
  // Never hour dependent in a way that fills a lot: the 24 hours.
  for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
    g.clock = h;
    for (let i = 0; i < 10; i++) p.fixedUpdate(0.1);
    assert.ok(p.lotField.n <= LOT_CAR_CAP_MAX);
  }
});

test('an island city (no lots) still builds the system', () => {
  const g = game(0, 0);
  const lots = g.city.lots;
  g.city.lots = null;
  try {
    const p = createParkedCars(g);
    assert.equal(p.lotField, null);
    p.fixedUpdate(0.5);
  } finally {
    g.city.lots = lots;
  }
});
