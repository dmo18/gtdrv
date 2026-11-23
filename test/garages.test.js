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
import { EXPLORE_KEY, defaultExplore, deriveExplore, saveExplore, storeCar } from '../src/core/explore.js';
import { createExploreMeshes } from '../src/render/exploremesh.js';
import { createVehicleMesh } from '../src/render/vehiclemesh.js';

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

// ---- K7, K8 and the cars inside the shed (docs/PLAN_V1.md G1) -------------------------------
function rewardStore() {
  const st = memory();
  const ex = defaultExplore();
  for (const id of ['a-sunchaser', 'a-tidewinder', 'a-nightheron']) { ex.adventures.seen.push(id); ex.adventures.done.push(id); }
  deriveExplore(ex);
  saveExplore(st, ex);
  return st;
}
function boot(st) {
  const game = fakeGame();
  game.garage = [];
  game.adventures = createAdventures(game, st);
  game.garages = createGarages(game);
  return game;
}
const idx = (game, spec) => game.explore.state.garages.cars.findIndex((c) => c.spec === spec);
function visit(game, k) {
  const g = garages[k];
  at(game, g.door.x + Math.cos(g.heading) * 2, g.door.z + Math.sin(g.heading) * 2, 12);
  game.garages.open(k);
  return g;
}

test('K8: a reward car taken out of one garage is out in the others until stored or wrecked', () => {
  const st = rewardStore();
  const game = boot(st);
  visit(game, 1);
  const r = game.garages.takeOut(idx(game, 'sunchaser'));
  assert.equal(r.ok, true);
  const out = r.vehicle;
  // Walk to a second garage: the same car shows as out and cannot be taken.
  game.garages.close();
  visit(game, 2);
  assert.equal(game.garages.isOut('sunchaser'), true);
  const n = game.vehicles.length;
  assert.deepEqual(game.garages.takeOut(idx(game, 'sunchaser')), { ok: false, reason: 'out' });
  assert.equal(game.vehicles.filter((v) => v.spec.id === 'sunchaser').length, 1, 'one copy in the world');
  assert.equal(game.vehicles.length, n);
  // Other reward cars still come out.
  assert.equal(game.explore.state.garages.cars.filter((c) => c.reward).length, 3);
  // Wrecked: gone for good, available again.
  out.wrecked = true;
  assert.equal(game.garages.isOut('sunchaser'), false);
  const r2 = game.garages.takeOut(idx(game, 'sunchaser'));
  assert.equal(r2.ok, true);
  assert.notEqual(r2.vehicle, out);
});

test('K8: storing the reward car makes it available again; a reload keeps it out', () => {
  const st = rewardStore();
  let game = boot(st);
  visit(game, 1);
  const car = game.garages.takeOut(idx(game, 'tidewinder')).vehicle;
  // Reload: the car is still on the road (the session brings it back).
  game = boot(st);
  assert.deepEqual(game.explore.state.garages.out, ['tidewinder']);
  const back = createVehicle('tidewinder', 10, 10, 0, game.rng);
  game.addVehicle(back);
  visit(game, 2);
  assert.equal(game.garages.isOut('tidewinder'), true);
  assert.deepEqual(game.garages.takeOut(idx(game, 'tidewinder')), { ok: false, reason: 'out' });
  // Driven into the garage and stored: it can come out again.
  game.enterVehicle(back);
  assert.equal(game.garages.store().ok, true);
  assert.equal(game.garages.isOut('tidewinder'), false);
  assert.equal(game.garages.takeOut(idx(game, 'tidewinder')).ok, true);
  assert.ok(car);
});

test('K8: a reward car left in the left-behind cars still counts as out; with no copy anywhere it is free', () => {
  const st = rewardStore();
  const game = boot(st);
  visit(game, 1);
  const car = game.garages.takeOut(idx(game, 'nightheron')).vehicle;
  game.garages.close();
  game.removeVehicle(car);
  game.garage.push({ spec: 'nightheron', color: car.color, health: 1, x: 5, z: 5, heading: 0, vehicle: null });
  assert.equal(game.garages.isOut('nightheron'), true, 'parked far away, kept in the session list');
  game.garage.length = 0;
  assert.equal(game.garages.isOut('nightheron'), false, 'lost: back in the garages');
});

test('K8: driving a reward car that was never marked out marks it out', () => {
  const st = rewardStore();
  const game = boot(st);
  const v = createVehicle('sunchaser', 0, 0, 0, game.rng);
  game.addVehicle(v);
  game.enterVehicle(v);
  game.events.emit('enter', v);
  assert.deepEqual(game.explore.state.garages.out, ['sunchaser']);
});

test('K7: the favourite car keeps its star after a reload and the live car is starred again', () => {
  const st = memory();
  let game = boot(st);
  const g = garages[1];
  const car = createVehicle('muscle', g.door.x, g.door.z, 0, game.rng);
  game.addVehicle(car);
  game.enterVehicle(car);
  visit(game, 1);
  assert.equal(game.garages.store().ok, true);
  game.garages.favourite(0);
  const out = game.garages.takeOut(0).vehicle;
  assert.equal(out.fav, true);
  // Cold start: new game object, same storage; the session restored an unstarred copy.
  game = boot(st);
  assert.equal(favouriteCar(game).spec, 'muscle', 'the title Start still uses it');
  const again = createVehicle('muscle', 0, 0, 0, game.rng);
  again.color = out.color;
  game.addVehicle(again);
  assert.ok(!again.fav);
  at(game, 0, 0, 40);
  assert.equal(again.fav, true, 'the star is back on the live car');
  // Wrecked: the star is gone with it.
  again.wrecked = true;
  at(game, 0, 0, 40);
  assert.equal(game.explore.state.garages.road, null);
  assert.equal(favouriteCar(game), null);
});

test('shed: stored cars are drawn inside the open garage, only the nearest, up to four', () => {
  const st = memory();
  const ex = defaultExplore();
  for (const s of ['sedan', 'muscle', 'sedan', 'muscle', 'sedan']) storeCar(ex, { spec: s, color: PAINT_COLORS[1], health: 1 });
  saveExplore(st, ex);
  const game = boot(st);
  const calls = [];
  game.garages.setMeshes({ setDoor() {}, setStored: (i, cars, n) => calls.push([i, cars.map((c) => c.spec).slice(0, n)]) });
  const render = () => game.garages.render();
  at(game, garages[1].door.x + 300, garages[1].door.z, 4);
  render();
  assert.deepEqual(calls, [], 'door shut and nobody near: nothing drawn');
  const g = garages[1];
  at(game, g.door.x + Math.cos(g.heading) * 10, g.door.z + Math.sin(g.heading) * 10, 30);
  render();
  assert.deepEqual(calls, [[1, ['sedan', 'muscle', 'sedan', 'muscle']]]);
  render();
  assert.equal(calls.length, 1, 'not rebuilt every frame');
  storeCar(game.explore.state, { spec: 'sedan', color: PAINT_COLORS[2], health: 1 });
  game.garages.fixedUpdate(DT);
  render();
  assert.equal(calls.length, 1, 'a fifth car is not drawn: same four');
  game.explore.state.garages.cars.shift();
  render();
  assert.equal(calls.length, 2, 'rebuilt when the list changes');
  at(game, g.door.x + 300, g.door.z, 120);
  render();
  assert.deepEqual(calls[calls.length - 1], [-1, []], 'door closed: cleared');
  // The reward car out on the road is not shown inside.
  assert.equal(game.garages.storedShown(), 0);
});

test('shed: the meshes put the cars inside the shed, facing the door, and clear them', () => {
  const added = [];
  const scene = { add: (o) => added.push(o) };
  const gs = [garages[1]];
  const m = createExploreMeshes(scene, { garages: gs, adventures: [], makeCar: (spec, color) => createVehicleMesh(spec, color) });
  assert.equal(m.bay.visible, false);
  m.setStored(0, [{ spec: 'sedan', color: PAINT_COLORS[0] }, { spec: 'muscle', color: PAINT_COLORS[4] }], 2);
  assert.equal(m.bay.visible, true);
  assert.equal(m.bay.children.length, 2);
  const g = gs[0];
  const ux = Math.cos(g.heading), uz = Math.sin(g.heading);
  for (const c of m.bay.children) {
    const dx = c.position.x - g.door.x, dz = c.position.z - g.door.z;
    const along = dx * ux + dz * uz, across = -dx * uz + dz * ux;
    assert.ok(along < -3 && along > -SHED_D + 1, 'inside the shed depth: ' + along);
    assert.ok(Math.abs(across) < SHED_W / 2 - 1.5, 'inside the width: ' + across);
  }
  assert.notEqual(m.bay.children[0].position.z * 1e3 + m.bay.children[0].position.x, m.bay.children[1].position.z * 1e3 + m.bay.children[1].position.x);
  m.setStored(-1, [], 0);
  assert.equal(m.bay.children.length, 0);
  assert.equal(m.bay.visible, false);
});

// ---- Regions (docs/PLAN_V2.md 3.5 rule 6): a garage is built in every region
// whose crop holds its anchor 60 m inside; the rest are skipped, not thrown. ----
import { regionCity, allRegionCities } from './regionfixture.js';
import { regionFor, inRegion, GARAGE_MARGIN } from '../src/world/regions.js';

const HELD = {
  'miami-downtown': ['g-downtown', 'g-brickell', 'g-wynwood', 'g-edgewater', 'g-watson'],
  'miami-beach': ['g-beach', 'g-key'],
  'miami-north': ['g-wynwood', 'g-edgewater', 'g-allapattah', 'g-design'],
  'miami-west': ['g-civic', 'g-havana'],
  'miami-south': ['g-roads'],
};

test('regions: each builds the garages its crop holds, the table of PLAN_V2 3.2', () => {
  for (const [id, c] of allRegionCities()) {
    assert.deepEqual(c.garages.map((g) => g.id), HELD[id], id);
    for (const g of c.garages) {
      const d = GARAGE_DEFS.find((q) => q.id === g.id);
      assert.ok(inRegion(regionFor(id), d.x, d.z, GARAGE_MARGIN), id + ' ' + g.id + ' anchor 60 m inside');
      assert.ok(inRegion(regionFor(id), g.x, g.z, 40), id + ' ' + g.id + ' shed inside the crop');
      assert.ok(g.place.includes(d.hood), `${id} ${g.id}: ${g.place} is not ${d.hood}`);
    }
  }
  // Every garage is in some region.
  const all = new Set(Object.values(HELD).flat());
  assert.deepEqual([...all].sort(), GARAGE_IDS.slice().sort());
});

test('regions: every rect is on land, off roads, 6 m clear of buildings, 12 m inland, door to a road, 30 m clear of the rest', () => {
  for (const [id, c] of allRegionCities()) {
    const near = [];
    for (const g of c.garages) {
      const r = g.rect;
      for (let x = r.x0; x <= r.x1; x += 2) {
        for (let z = r.z0; z <= r.z1; z += 2) {
          assert.ok(c.isLand(x, z) && !c.onRoad(x, z), `${id} ${g.id} ground at ${x},${z}`);
        }
      }
      for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x1, r.z0]]) assert.ok(c.mainShore(x, z) >= 12, `${id} ${g.id} 12 m inland`);
      c.buildingsNear(r.x0 - 8, r.z0 - 8, r.x1 + 8, r.z1 + 8, near);
      for (const k of near) {
        const b = c.buildings[k];
        assert.ok(Math.hypot(Math.max(b.x0 - r.x1, 0, r.x0 - b.x1), Math.max(b.z0 - r.z1, 0, r.z0 - b.z1)) >= 6, `${id} ${g.id} near a building`);
      }
      if (g.road !== false) assert.ok(doorToRoad(c, g) <= DOOR_ROAD, `${id} ${g.id} door ${doorToRoad(c, g)} m from the road`);
      const others = [...c.rampSpots, ...c.secretSpots, ...c.courses.map((q) => q.start), ...c.helipads, ...c.piers.map((p) => ({ x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2 }))];
      for (const p of others) assert.ok(Math.hypot(p.x - g.x, p.z - g.z) >= 30, `${id} ${g.id} near ${p.id || 'a start'}`);
      for (const s of c.parkingSpots) assert.ok(!(s.x > g.x0 && s.x < g.x1 && s.z > g.z0 && s.z < g.z1), `${id} ${g.id} parking spot inside`);
    }
    for (let i = 0; i < c.garages.length; i++) {
      for (let j = i + 1; j < c.garages.length; j++) {
        assert.ok(Math.hypot(c.garages[i].x - c.garages[j].x, c.garages[i].z - c.garages[j].z) >= GARAGE_APART, id);
      }
    }
  }
});

test('regions: Downtown puts its five within 60 m of where the whole box does (the keep-outs differ); Wynwood is one place in Downtown and North', () => {
  for (const g of regionCity('miami-downtown').garages) {
    const w = garages.find((q) => q.id === g.id);
    assert.ok(Math.hypot(g.x - w.x, g.z - w.z) <= 60, `${g.id} moved ${Math.round(Math.hypot(g.x - w.x, g.z - w.z))} m from the whole box`);
  }
  const n = regionCity('miami-north').garages.find((g) => g.id === 'g-wynwood');
  const d = regionCity('miami-downtown').garages.find((g) => g.id === 'g-wynwood');
  assert.ok(Math.hypot(n.x - d.x, n.z - d.z) <= 60, 'Wynwood garage in Downtown and North is one place');
});
