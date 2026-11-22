// The twelve Miami garages (docs/REVAMP.md 6.6): placement on the real
// data and the garage system (door, offer, store and take out).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { generateCity } from '../src/world/citygen.js';
import {
  placeGarages, doorToRoad, GARAGE_DEFS, GARAGE_IDS, GARAGE_APART, GARAGE_MOVE_MAX, GARAGE_SEED, DOOR_ROAD, GARAGE_DOOR_R,
  RECT_W, RECT_D, SHED_W, SHED_D, PAINT_COLORS, GARAGE_BONUS,
} from '../src/world/garages.js';
import { attachExplore } from '../src/world/adventures.js';
import { dressLot } from '../src/world/lots.js';
import { createEvents } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { defaultProgress } from '../src/core/save.js';
import { createScore } from '../src/systems/score.js';
import { createAdventures } from '../src/systems/adventures.js';
import { createGarages, favouriteCar } from '../src/systems/garages.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { EXPLORE_KEY } from '../src/core/explore.js';

const DT = 1 / 60;
const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const spotsBefore = city.parkingSpots.length;
attachExplore(city);
const garages = city.garages;
const NEAR = [];

test('twelve garages, ids and names as the contract, the same on every build', () => {
  assert.equal(garages.length, 12);
  assert.deepEqual(garages.map((g) => g.id), GARAGE_IDS);
  assert.equal(GARAGE_SEED, 7129);
  assert.equal(new Set(garages.map((g) => g.name)).size, 12);
  for (const g of garages) assert.ok(!/[\u2013\u2014]/.test(g.name + g.place), g.id);
  assert.deepEqual(placeGarages(city), garages, 'same result from the same city');
  assert.deepEqual(GARAGE_DEFS.filter((d) => d.locked).map((d) => [d.id, d.locked]),
    [['g-roads', 'a-roads-end'], ['g-beach', 'a-sandbar'], ['g-key', 'a-far-key']]);
  assert.deepEqual(GARAGE_DEFS.filter((d) => d.known).map((d) => d.id), ['g-downtown']);
  assert.equal(PAINT_COLORS.length, 16);
  assert.equal(GARAGE_BONUS, 500);
});

test('each garage is in its neighbourhood, within 300 m of its anchor; the Downtown one near the start', () => {
  for (const g of garages) {
    const d = GARAGE_DEFS.find((q) => q.id === g.id);
    assert.ok(Math.hypot(g.x - d.x, g.z - d.z) <= GARAGE_MOVE_MAX + RECT_D, `${g.id} moved ${Math.round(Math.hypot(g.x - d.x, g.z - d.z))} m`);
    assert.ok(g.place.includes(d.hood), `${g.id}: ${g.place} is not ${d.hood}`);
  }
  const dt = garages[0];
  assert.ok(Math.hypot(dt.x - city.spawn.x, dt.z - city.spawn.z) <= 350, 'within 350 m of the start view');
  assert.equal(garages.filter((g) => g.core).length, 5, 'five in the core');
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      const a = garages[i], b = garages[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= GARAGE_APART, `${a.id} vs ${b.id}`);
    }
  }
});

test('every rect is on land, off roads, 6 m clear of buildings, 12 m inland; the door faces a road', () => {
  for (const g of garages) {
    const r = g.rect;
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    assert.ok((Math.abs(w - RECT_W) < 0.2 && Math.abs(d - RECT_D) < 0.2) || (Math.abs(w - RECT_D) < 0.2 && Math.abs(d - RECT_W) < 0.2), g.id + ' 16 by 22');
    const fp = g.footprint;
    const fw = fp.x1 - fp.x0, fd = fp.z1 - fp.z0;
    assert.ok((Math.abs(fw - SHED_W) < 0.2 && Math.abs(fd - SHED_D) < 0.2) || (Math.abs(fw - SHED_D) < 0.2 && Math.abs(fd - SHED_W) < 0.2), g.id + ' shed 10 by 14');
    assert.equal(fp.h, 4.5);
    for (let x = r.x0; x <= r.x1; x += 2) {
      for (let z = r.z0; z <= r.z1; z += 2) {
        assert.ok(city.isLand(x, z), `${g.id} on land at ${x},${z}`);
        assert.ok(!city.onRoad(x, z), `${g.id} off road at ${x},${z}`);
      }
    }
    for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x1, r.z0]]) assert.ok(city.mainShore(x, z) >= 12, g.id + ' 12 m inland');
    city.buildingsNear(r.x0 - 8, r.z0 - 8, r.x1 + 8, r.z1 + 8, NEAR);
    for (const k of NEAR) {
      const b = city.buildings[k];
      const dx = Math.max(b.x0 - r.x1, 0, r.x0 - b.x1), dz = Math.max(b.z0 - r.z1, 0, r.z0 - b.z1);
      assert.ok(Math.hypot(dx, dz) >= 6, `${g.id} ${Math.hypot(dx, dz).toFixed(1)} m from a building`);
    }
    // Reachable: the door looks out at a road within reach (the forecourt
    // and the 4 m pavement). Virginia Key has no road in the data.
    if (g.id === 'g-key') {
      assert.equal(g.road, false);
      continue;
    }
    assert.ok(doorToRoad(city, g) <= DOOR_ROAD, `${g.id} door ${doorToRoad(city, g)} m from the road`);
    // Clear of ramps, secrets and course starts by 30 m.
    for (const p of [...city.rampSpots, ...city.secretSpots, ...city.courses.map((c) => c.start)]) {
      assert.ok(Math.hypot(p.x - g.x, p.z - g.z) >= 30, `${g.id} near ${p.id || p.name || 'a start'}`);
    }
  }
});

test('lot dressing skips the garage rects; no parked car spawns in one', () => {
  assert.ok(city.parkingSpots.length <= spotsBefore);
  for (const g of garages) {
    for (const s of city.parkingSpots) assert.ok(!(s.x > g.x0 && s.x < g.x1 && s.z > g.z0 && s.z < g.z1), g.id + ' parking spot inside');
    const lots = new Set();
    for (let x = g.x0; x <= g.x1; x += 4) for (let z = g.z0; z <= g.z1; z += 4) { const l = city.lotAt(x, z); if (l) lots.add(l); }
    for (const lot of lots) {
      for (const f of dressLot(city, lot)) assert.ok(!(f.x >= g.x0 && f.x <= g.x1 && f.z >= g.z0 && f.z <= g.z1), `${g.id}: ${f.kind} inside`);
    }
  }
});

test('island: no garages', () => {
  const island = generateCity();
  assert.deepEqual(placeGarages(island), []);
  attachExplore(island);
  assert.equal(island.garages, undefined);
});

// ---- the system -------------------------------------------------------------------
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
function fakeGame() {
  const events = createEvents();
  const toasts = [];
  const game = {
    city, events, time: 0, rng: createRng(5), progress: defaultProgress(), vehicles: [], paused: false,
    hud: { toast: (t) => toasts.push(t), setPrompt: () => {} },
    toasts,
    player: { mode: 'foot', vehicle: null, x: 0, z: 0, y: 0, heading: 0, wanted: 0, walker: { x: 0, z: 0, px: 0, pz: 0, heading: 0 } },
    addVehicle(v) { game.vehicles.push(v); return v; },
    removeVehicle(v) { const i = game.vehicles.indexOf(v); if (i >= 0) game.vehicles.splice(i, 1); v.removed = true; },
    setPlayerMode(m) { game.player.mode = m; },
    enterVehicle(v) { v.driver = 'player'; game.player.vehicle = v; game.player.mode = v.kind; },
    menu: { opened: [], open(id) { game.menu.opened.push(id); } },
  };
  game.score = createScore(game);
  return game;
}
function at(game, x, z, steps = 8) {
  const p = game.player;
  p.x = x; p.z = z;
  if (p.vehicle) { p.vehicle.x = x; p.vehicle.z = z; }
  for (let i = 0; i < steps; i++) {
    game.time += DT;
    game.adventures.fixedUpdate(DT);
    game.garages.fixedUpdate(DT);
  }
}

test('system: door opens within 15 m, GARAGE offered at the door when slow, first visit pays once', () => {
  const game = fakeGame();
  const st = memory();
  game.adventures = createAdventures(game, st);
  game.garages = createGarages(game);
  const g = garages[1];
  const i = 1;
  at(game, g.door.x + 200, g.door.z + 200);
  assert.equal(game.garages.doorOpen(i), 0);
  at(game, g.door.x + Math.cos(g.heading) * 12, g.door.z + Math.sin(g.heading) * 12, 90);
  assert.equal(game.garages.doorOpen(i), 1, 'open within 15 m');
  assert.ok(12 < GARAGE_DOOR_R);
  assert.equal(game.garages.offer, -1, 'not yet at the door');
  const car = createVehicle('muscle', g.door.x, g.door.z, g.heading + Math.PI, game.rng);
  game.addVehicle(car);
  game.enterVehicle(car);
  car.speed = 8;
  at(game, g.door.x + 1, g.door.z);
  assert.equal(game.garages.offer, -1, 'too fast');
  car.speed = 1;
  at(game, g.door.x + 1, g.door.z);
  assert.equal(game.garages.offer, i);
  const before = game.score.total;
  assert.equal(game.garages.open(), true);
  assert.deepEqual(game.menu.opened, ['garage']);
  assert.equal(game.score.total - before, GARAGE_BONUS);
  assert.ok(game.explore.state.garages.found.includes(g.id));
  assert.ok(game.garages.word && game.garages.word.text.startsWith('Word at the garage'));
  game.garages.open();
  assert.equal(game.score.total - before, GARAGE_BONUS, 'the bonus is paid once');
  // Store the car: it leaves the world, the player stands at the door.
  assert.equal(game.garages.store().ok, true);
  assert.equal(game.player.vehicle, null);
  assert.equal(game.player.mode, 'foot');
  assert.ok(car.removed);
  assert.equal(game.explore.state.garages.cars.length, 1);
  // Repaint and favourite it, then take it out: it comes out on the bay.
  assert.equal(game.garages.repaint(0, PAINT_COLORS[5]).ok, true);
  assert.equal(game.garages.favourite(0).fav, true);
  assert.equal(favouriteCar(game).spec, 'muscle');
  const r = game.garages.takeOut(0);
  assert.equal(r.ok, true);
  assert.equal(r.vehicle.spec.id, 'muscle');
  assert.equal(r.vehicle.color, PAINT_COLORS[5]);
  assert.equal(r.vehicle.health, r.vehicle.spec.health, 'full health');
  assert.ok(Math.hypot(r.vehicle.x - g.bay.x, r.vehicle.z - g.bay.z) < 0.01);
  assert.equal(game.player.vehicle, r.vehicle);
  assert.equal(game.explore.state.garages.cars.length, 0);
  assert.equal(favouriteCar(game).spec, 'muscle', 'the favourite out on the road still counts');
  // The save went to its own key.
  assert.ok(st.map.has(EXPLORE_KEY));
  assert.ok(JSON.parse(st.map.get(EXPLORE_KEY)).garages.found.includes(g.id));
});

test('system: a locked garage cannot be used before its adventure', () => {
  const game = fakeGame();
  game.adventures = createAdventures(game, memory());
  game.garages = createGarages(game);
  const k = GARAGE_IDS.indexOf('g-roads');
  const g = garages[k];
  at(game, g.door.x, g.door.z, 90);
  assert.equal(game.garages.offer, -1);
  assert.equal(game.garages.doorOpen(k), 0, 'the door stays shut');
  assert.equal(game.garages.open(k), false);
  assert.ok(!game.explore.state.garages.seen.includes('g-roads'));
});
