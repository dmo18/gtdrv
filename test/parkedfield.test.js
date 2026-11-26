// 0.13.8 parked cars: the lot car field loaded a few lots a step
// (render/parkedfield.js), the bays it keeps empty, the occupancy by lot,
// district and hour, and the cap on live parked cars near the player.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld, bayLotU } from '../src/world/collision.js';
import { lotDressCache, lotFill, blockedBays, eachBay, lotPull } from '../src/world/lots.js';
import { createParkedLotField, LOT_BAYS_MAX, LOAD_BAYS_STEP } from '../src/render/parkedfield.js';
import { createLotCarField } from '../src/render/lotmesh.js';
import { createParkedCars, PARKED_CAP } from '../src/systems/parked.js';
import { makeFightGame } from './fightgame.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data, { region: 'miami-downtown' });
const cache = lotDressCache(city);
const carparks = city.lots.filter((l) => l.type === 'carpark');
// The busiest spot: the lot with the most bays.
const big = carparks.map((l) => {
  let n = 0;
  for (const f of cache.get(l)) if (f.kind === 'bay') eachBay(f, () => n++);
  return [n, l];
}).sort((a, b) => b[0] - a[0])[0][1];
const cam = { x: (big.x0 + big.x1) / 2, z: (big.z0 + big.z1) / 2 };

// Every bay of the lots in reach: { x, z, lot, car } with car true when the
// collision rule (bayLotU under the lot's fill, blocked bays empty) has a car.
function baysNear(x, z, r, hour) {
  const out = [];
  for (const lot of carparks) {
    const qx = Math.max(lot.x0 - x, 0, x - lot.x1), qz = Math.max(lot.z0 - z, 0, z - lot.z1);
    if (Math.hypot(qx, qz) > r) continue;
    const feats = cache.get(lot), blocked = blockedBays(feats), fill = lotFill(lot, hour);
    let k = 0;
    for (const f of feats) {
      if (f.kind !== 'bay') continue;
      eachBay(f, (bx, bz) => {
        out.push({ x: bx, z: bz, lot, car: !blocked[k] && bayLotU(city, lot, bx, bz, f.v) >= 0 && bayLotU(city, lot, bx, bz, f.v) < fill, blocked: !!blocked[k] });
        k++;
      });
    }
  }
  return out;
}

test('lot field: a car only where the collision world has one, never two in a bay', () => {
  for (const hour of [13, 2]) {
    const f = createParkedLotField(city);
    f.loadAll(cam.x, cam.z);
    const bays = baysNear(cam.x, cam.z, 155, hour);
    for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = f.update(cam.x, cam.z, fx, fz, hour, 60);
      for (let i = 0; i < n; i++) {
        let best = null, bd = 1e9;
        for (const b of bays) { const d = Math.hypot(b.x - f.x[i], b.z - f.z[i]); if (d < bd) { bd = d; best = b; } }
        assert.ok(bd < 0.3 && best.car, `car ${i} at ${f.x[i]}, ${f.z[i]}: bay ${bd.toFixed(2)} m off, car there ${best && best.car}`);
        for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(f.x[i] - f.x[j], f.z[i] - f.z[j]) > 2.2, 'two cars in one bay');
      }
      for (let i = 1; i < n; i++) assert.ok(f.dist[i] >= f.dist[i - 1], 'nearest first');
    }
  }
});

test('lot field: the same cars as the old field for the same bays, deterministic', () => {
  const a = createParkedLotField(city), b = createParkedLotField(city), old = createLotCarField(city);
  a.loadAll(cam.x, cam.z); b.loadAll(cam.x, cam.z);
  const na = a.update(cam.x, cam.z, 1, 0, 13, 60), nb = b.update(cam.x, cam.z, 1, 0, 13, 60);
  assert.equal(na, nb);
  for (let i = 0; i < na; i++) {
    assert.equal(a.x[i], b.x[i]); assert.equal(a.yaw[i], b.yaw[i]); assert.equal(a.color[i], b.color[i]); assert.equal(a.spec[i], b.spec[i]);
  }
  // Every car of the new field is the old field's car of that bay (model,
  // paint, facing), the old one minus the bays now kept empty.
  const no = old.update(cam.x, cam.z, 1, 0, 13, 60);
  const oldAt = new Map();
  for (let i = 0; i < no; i++) oldAt.set(Math.round(old.x[i] * 10) + ',' + Math.round(old.z[i] * 10), i);
  let same = 0;
  for (let i = 0; i < na; i++) {
    const j = oldAt.get(Math.round(a.x[i] * 10) + ',' + Math.round(a.z[i] * 10));
    if (j === undefined) continue;
    same++;
    assert.equal(a.spec[i], old.spec[j]); assert.equal(a.color[i], old.color[j]); assert.ok(Math.abs(a.yaw[i] - old.yaw[j]) < 1e-5);
  }
  assert.ok(na === 0 || same > 0, `${same} of ${na} matched`);
});

test('lot field: loads a few lots a step, then reuses its records', () => {
  const f = createParkedLotField(city);
  f.update(cam.x, cam.z, 1, 0, 13, 40);
  const pending0 = f.pending();
  assert.ok(pending0 > 3, `${pending0} lots to load`);
  assert.equal(f.n, 0, 'nothing loaded before the first step');
  const loads0 = f.stats.loads;
  f.step();
  const one = f.stats.loads - loads0;
  assert.ok(one >= 1 && one < pending0, `${one} lots in one step`);
  let steps = 1;
  while (f.pending() && steps < 500) { f.step(); steps++; }
  assert.equal(f.pending(), 0);
  assert.ok(steps >= Math.ceil(pending0 / 30), `${steps} steps`);
  assert.ok(f.update(cam.x, cam.z, 1, 0, 13, 40) > 0, 'cars once loaded');
  // Away and back: the far lots give their records back, the near ones load again.
  f.update(cam.x + 2000, cam.z, 1, 0, 13, 40);
  while (f.pending()) f.step();
  assert.ok(f.stats.released > 0);
  assert.ok(LOAD_BAYS_STEP <= 400 && LOT_BAYS_MAX >= 256);
});

test('blocked bays: no car on a planter, a lamp or a sign', () => {
  let blocked = 0, checked = 0;
  for (const lot of carparks.slice(0, 400)) {
    const feats = cache.get(lot), bl = blockedBays(feats);
    const solids = feats.filter((g) => ['planter', 'lamp', 'sign', 'tree'].includes(g.kind));
    let k = 0;
    for (const f of feats) {
      if (f.kind !== 'bay') continue;
      eachBay(f, (bx, bz, h) => {
        const c = Math.cos(h), s = Math.sin(h);
        if (!bl[k]) {
          for (const g of solids) {
            const dx = g.x - bx, dz = g.z - bz;
            const lx = dx * c + dz * s, lz = -dx * s + dz * c;
            const r = g.r > 0 ? g.r : 0.15;
            assert.ok(!(Math.abs(lx) < 2.2 + r && Math.abs(lz) < 0.9 + r), `a car bay over a ${g.kind} at ${bx}, ${bz}`);
          }
          checked++;
        } else blocked++;
        k++;
      });
    }
  }
  assert.ok(checked > 1000 && blocked < checked * 0.02, `${blocked} blocked of ${checked + blocked}`);
});

test('occupancy: by lot, district and hour; some lots empty by chance, nights near empty', () => {
  const at = (h, keep) => {
    let bays = 0, cars = 0, empty = 0, lots = 0;
    for (const lot of carparks.filter(keep)) {
      const fill = lotFill(lot, h);
      let b = 0, c = 0;
      for (const f of cache.get(lot)) if (f.kind === 'bay') eachBay(f, (x, z) => { b++; const u = bayLotU(city, lot, x, z, f.v); if (u >= 0 && u < fill) c++; });
      if (!b) continue;
      lots++; bays += b; cars += c;
      if (c / b < 0.1) empty++;
    }
    return { occ: cars / bays, empty: empty / lots };
  };
  const dDay = at(13, (l) => l.district === 'downtown'), mDay = at(13, (l) => l.district === 'midtown');
  const night = at(2, (l) => l.district !== 'residential');
  assert.ok(dDay.occ > 0.28 && dDay.occ < 0.5, `downtown noon ${dDay.occ}`);
  assert.ok(mDay.occ > 0.2 && mDay.occ < dDay.occ, `midtown noon ${mDay.occ}`);
  assert.ok(dDay.empty > 0.04 && dDay.empty < 0.3, `downtown noon: ${dDay.empty} of lots nearly empty`);
  assert.ok(night.occ < 0.1 && night.empty > 0.6, `night ${night.occ}, ${night.empty} nearly empty`);
  // The pull is a function of the lot (seeded), about one lot in eight dead.
  const dead = carparks.filter((l) => lotPull(l) < 0.12).length / carparks.length;
  assert.ok(dead > 0.05 && dead < 0.2, `${dead} dead lots`);
  assert.equal(lotPull(carparks[0]), lotPull({ ...carparks[0] }));
});

function game(px, pz, clock = 13) {
  const collision = createCollisionWorld();
  const g = makeFightGame({ city, collision, px, pz });
  g.clock = clock;
  g.kinds = { car: {}, boat: {}, plane: {}, heli: {}, tank: {} };
  return g;
}

test('live parked cars: at most the cap (40, 30 on Low), all near the player, curb parking kept', () => {
  for (const [tier, cap] of [['Normal', 40], ['Low', 30]]) {
    const g = game(city.spawn.x, city.spawn.z);
    g.graphics = { tierNow: () => ({ name: tier }) };
    const p = createParkedCars(g);
    for (let i = 0; i < 600; i++) { g.time += 1 / 60; p.fixedUpdate(1 / 60); }
    assert.equal(p.cap, cap);
    assert.ok(p.live <= cap && g.vehicles.length <= cap, `${tier}: ${p.live} live`);
    assert.ok(p.live >= Math.min(cap, 10), `${tier}: ${p.live} live`);
    for (const v of g.vehicles) assert.ok(Math.hypot(v.x - g.player.x, v.z - g.player.z) < 125);
    const curb = p.spots.filter((s) => s.vehicle && !s.lot).length;
    assert.ok(curb >= p.live * 0.5, `${curb} of ${p.live} at the curb`);
    console.log(`# ${tier}: ${p.live} live parked, ${curb} at the curb`);
  }
  assert.deepEqual(PARKED_CAP, [30, 40, 48]);
  // A cap under what the street offers holds, with the nearest spots kept
  // and the cars far behind moved (not made anew) as the player goes on.
  const g = game(city.spawn.x, city.spawn.z);
  g.graphics = { parkedLive: 12 };
  const p = createParkedCars(g);
  for (let i = 0; i < 600; i++) { g.time += 1 / 60; p.fixedUpdate(1 / 60); }
  assert.equal(p.live, 12);
  const made = p.stats.spawned;
  for (let i = 0; i < 1200; i++) { g.time += 1 / 60; g.player.x += 0.25; p.fixedUpdate(1 / 60); }
  assert.ok(p.live <= 12 && g.vehicles.length <= 12, `${p.live} live`);
  for (const v of g.vehicles) assert.ok(Math.hypot(v.x - g.player.x, v.z - g.player.z) < 175);
  assert.ok(p.stats.relocated > 0, `${p.stats.relocated} moved, ${p.stats.spawned - made} made`);
});

test('listed lot bays take a car by their lot fill: at night the lots are near empty', () => {
  const night = game(cam.x, cam.z, 2), day = game(cam.x, cam.z, 13);
  const pn = createParkedCars(night), pd = createParkedCars(day);
  for (let i = 0; i < 600; i++) {
    night.time += 1 / 60; day.time += 1 / 60;
    pn.fixedUpdate(1 / 60); pd.fixedUpdate(1 / 60);
  }
  const lotCars = (p) => p.spots.filter((s) => s.vehicle && s.lot).length;
  console.log(`# listed lot bays with a car: night ${lotCars(pn)}, day ${lotCars(pd)}`);
  assert.ok(lotCars(pn) < lotCars(pd), `night ${lotCars(pn)}, day ${lotCars(pd)}`);
  // Deterministic: the same game gives the same cars.
  const again = game(cam.x, cam.z, 13), pa = createParkedCars(again);
  for (let i = 0; i < 600; i++) { again.time += 1 / 60; pa.fixedUpdate(1 / 60); }
  assert.deepEqual(again.vehicles.map((v) => [v.x, v.z, v.spec.id, v.color]), day.vehicles.map((v) => [v.x, v.z, v.spec.id, v.color]));
});

test('lot field: a lot no tile has dressed loads from the quick bays-only dressing, then again in full', () => {
  // A copy of the city object: its own (empty) dressing cache.
  const c2 = { ...city };
  const quick = createParkedLotField(c2, { quick: true }), full = createParkedLotField(city);
  full.loadAll(cam.x, cam.z);
  quick.update(cam.x, cam.z, 1, 0, 13, 60);
  while (quick.pending()) quick.step(240, false, 0);
  assert.equal(lotDressCache(c2).size(), 0, 'nothing dressed in full');
  const nq = quick.update(cam.x, cam.z, 1, 0, 13, 60), nf = full.update(cam.x, cam.z, 1, 0, 13, 60);
  // The same bays: every quick car is a full-dressing bay car or one of a bay the full dressing blocks.
  const bays = baysNear(cam.x, cam.z, 155, 13);
  for (let i = 0; i < nq; i++) {
    const b = bays.find((q) => Math.abs(q.x - quick.x[i]) < 0.3 && Math.abs(q.z - quick.z[i]) < 0.3);
    assert.ok(b && (b.car || b.blocked), `quick car ${i} off the bays`);
  }
  // Dressed in full (as a tile would): the records load again and match.
  for (const lot of carparks) {
    const qx = Math.max(lot.x0 - cam.x, 0, cam.x - lot.x1), qz = Math.max(lot.z0 - cam.z, 0, cam.z - lot.z1);
    if (Math.hypot(qx, qz) < 230) lotDressCache(c2).get(lot);
  }
  for (let i = 0; i < 400; i++) quick.step();
  assert.ok(quick.stats.reloads > 0);
  assert.equal(quick.update(cam.x, cam.z, 1, 0, 13, 60), nf);
  for (let i = 0; i < nf; i++) { assert.equal(quick.x[i], full.x[i]); assert.equal(quick.color[i], full.color[i]); }
});
