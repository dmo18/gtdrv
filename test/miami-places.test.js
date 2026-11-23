// Miami map, milestone 2 (docs/MAP.md): the courses, secrets and stunt
// assertions that run on the procedural island (courses.test.js,
// secrets.test.js, stunts.test.js), here on the Miami city; every hand
// spot checked against the data; the HUD names and the economy's
// first-visit flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity, MIAMI_SPOTS } from '../src/world/miami.js';
import { generateCity, DISTRICTS } from '../src/world/citygen.js';
import { createCollisionWorld, fillCollision } from '../src/world/collision.js';
import { buildCourses, roadDistance, avenueAt, tallestNear, REF_SPEED, MEDAL_FACTOR, CANYON_RING_R } from '../src/world/courses.js';
import { createActivities, COUNTDOWN } from '../src/systems/activities.js';
import { createScore } from '../src/systems/score.js';
import { createEvents } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { defaultProgress } from '../src/core/save.js';
import { findSecrets, discover, secretsDone, emptySecrets, SECRET_IDS, DISCOVER_R } from '../src/world/secrets.js';
import { createSecrets } from '../src/systems/secrets.js';
import { generateStuntSpots, rampHeight, RAMP_LAND } from '../src/world/stunts.js';
import { createStunts } from '../src/systems/stunts.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createEconomy } from '../src/systems/economy.js';
import { hudPlace, SHORE_NAME } from '../src/world/maps.js';

const DT = 1 / 60;
const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const collision = fillCollision(city, createCollisionWorld());
const courses = city.courses;
const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
const KINDS = ['car', 'boat', 'plane', 'heli'];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const island = generateCity();

// Every name in the map data (labels, streets, parks, buildings, water).
const DATA_NAMES = new Set();
for (const k of ['labels', 'roads', 'buildings', 'parks', 'water']) for (const r of data[k]) if (r.name) DATA_NAMES.add(r.name);

function pierDist(x, z) {
  let best = Infinity;
  for (const p of city.piers) {
    const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

test('Miami courses: the same ids and mix as the island, valid numbers', () => {
  const ids = buildCourses(island).map((c) => c.id);
  assert.deepEqual(courses.map((c) => c.id), ids, 'same ids, same order (medals and best times keep their slots)');
  const count = (t) => courses.filter((c) => c.type === t).length;
  assert.equal(count('street'), 4);
  assert.equal(count('boat'), 3);
  assert.equal(count('sky'), 3);
  assert.equal(count('delivery'), 4);
  assert.equal(new Set(courses.map((c) => c.name)).size, courses.length);
  for (const c of courses) {
    assert.ok(typeof c.name === 'string' && c.name.length > 2 && typeof c.blurb === 'string' && c.blurb.length > 10, c.id);
    assert.ok(!/[\u2013\u2014]/.test(c.name + c.blurb), c.id + ' no long dashes');
    assert.ok(c.kinds.length > 0 && c.kinds.every((k) => KINDS.includes(k)), c.id);
    for (const k of ['x', 'z', 'y', 'heading']) assert.ok(fin(c.start[k]), `${c.id} start.${k}`);
    assert.ok(c.checkpoints.length >= 1, c.id);
    for (const cp of c.checkpoints) {
      for (const k of ['x', 'z', 'y', 'r', 'dir']) assert.ok(fin(cp[k]), `${c.id} cp.${k}`);
      assert.ok(cp.r > 0 && cp.y >= 0, c.id);
    }
    const m = c.medalTimes, r = c.reward;
    assert.ok(m.gold > 0 && m.gold < m.silver && m.silver < m.bronze, `${c.id} medal times`);
    assert.ok(r.gold > r.silver && r.silver > r.bronze && r.bronze > 0, `${c.id} rewards`);
    assert.ok(c.length / m.gold <= REF_SPEED[c.kinds[0]] + 1e-9, c.id);
    assert.ok(m.bronze >= m.gold * MEDAL_FACTOR.bronze - 1e-9, c.id);
    if (c.type === 'delivery') assert.equal(c.timeLimit, m.bronze);
    if (c.type === 'street') assert.ok(c.checkpoints.length >= 8 && c.checkpoints.length <= 16, `${c.id}: ${c.checkpoints.length}`);
  }
  // Deterministic from the city.
  assert.equal(JSON.stringify(buildCourses(city)), JSON.stringify(courses));
});

test('Miami street checkpoints sit on road junctions joined through the graph', () => {
  for (const c of courses) {
    const cps = c.checkpoints.filter((cp) => cp.kind === 'ground');
    if (!cps.length) continue;
    assert.equal(cps.length, c.checkpoints.length, c.id);
    assert.ok(city.onRoad(c.start.x, c.start.z), `${c.id} start off road`);
    const closed = c.type === 'street';
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k];
      assert.ok(city.onRoad(cp.x, cp.z), `${c.id} cp ${k} off road`);
      assert.equal(collision.heightAt(cp.x, cp.z), 0, `${c.id} cp ${k} in a building`);
      const node = city.nodes[cp.node];
      assert.ok(node && Math.hypot(node.x - cp.x, node.z - cp.z) < 0.2, `${c.id} cp ${k} not a node`);
      if (k === 0 && !closed) continue;
      const prev = cps[(k + cps.length - 1) % cps.length];
      if (prev === cp) continue;
      const straight = Math.hypot(cp.x - prev.x, cp.z - prev.z);
      const road = roadDistance(city, prev.node, cp.node);
      assert.ok(straight > 1, `${c.id} cp ${k} repeats the previous one`);
      assert.ok(road < 4 * straight, `${c.id} cp ${k}: road ${road} vs straight ${straight}`);
    }
  }
  const gate = city.airfield.gate;
  assert.ok(byId['street-causeway'].checkpoints.some((cp) => cp.node === gate.id), 'the Causeway Dash reaches the airfield gate');
  for (const c of courses) {
    if (c.id !== 'street-causeway') assert.ok(!c.checkpoints.some((cp) => cp.kind === 'ground' && cp.node === gate.id), c.id);
  }
  // Each race is where its name says.
  const places = (id) => new Set(byId[id].checkpoints.map((cp) => city.placeOf(cp.x, cp.z)));
  assert.ok(places('street-glasswell').has('Downtown Miami'));
  assert.ok(places('street-fernside').has('Little Havana'));
  const rally = places('street-rim');
  for (const p of ['Venetian Islands', 'Palm Island']) assert.ok(rally.has(p), 'Bay Bridges Rally visits ' + p);
});

test('Miami boat gates are at sea with clear water between them; the lap closes', () => {
  for (const c of courses) {
    const cps = c.checkpoints.filter((cp) => cp.kind === 'buoy');
    if (!cps.length) continue;
    assert.equal(cps.length, c.checkpoints.length, c.id);
    assert.ok(city.shoreDist(c.start.x, c.start.z) < -10, `${c.id} start not at sea`);
    let px = c.start.x, pz = c.start.z;
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k];
      assert.ok(city.shoreDist(cp.x, cp.z) < -25, `${c.id} gate ${k} too near the shore`);
      assert.ok(pierDist(cp.x, cp.z) > 20, `${c.id} gate ${k} too near a pier`);
      const ox = -Math.sin(cp.dir) * cp.r, oz = Math.cos(cp.dir) * cp.r;
      assert.ok(city.shoreDist(cp.x + ox, cp.z + oz) < -3 && city.shoreDist(cp.x - ox, cp.z - oz) < -3, `${c.id} buoy ${k}`);
      const L = Math.hypot(cp.x - px, cp.z - pz);
      const n = Math.max(1, Math.ceil(L / 5));
      for (let i = 0; i <= n; i++) {
        const x = px + ((cp.x - px) * i) / n, z = pz + ((cp.z - pz) * i) / n;
        assert.ok(city.shoreDist(x, z) < -3, `${c.id} leg to gate ${k} crosses land at ${x.toFixed(0)},${z.toFixed(0)}`);
      }
      px = cp.x;
      pz = cp.z;
    }
  }
  // The big lap ends where it began and goes once round its own middle.
  const lap = byId['boat-island'].checkpoints;
  const first = lap[0], last = lap[lap.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 1, 'the lap ends where it began');
  let cx = 0, cz = 0;
  for (const cp of lap) { cx += cp.x / lap.length; cz += cp.z / lap.length; }
  let turned = 0;
  for (let k = 1; k < lap.length; k++) {
    let d = Math.atan2(lap[k].z - cz, lap[k].x - cx) - Math.atan2(lap[k - 1].z - cz, lap[k - 1].x - cx);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
  }
  assert.ok(Math.abs(Math.abs(turned) - 2 * Math.PI) < 0.3, `lap turns ${turned}`);
});

test('Miami sky rings are above ground and clear of buildings; canyon rings fit the avenue', () => {
  let canyon = 0;
  for (const c of courses) {
    for (let k = 0; k < c.checkpoints.length; k++) {
      const cp = c.checkpoints[k];
      if (cp.kind === 'pad') {
        const roof = collision.heightAt(cp.x, cp.z);
        assert.ok(Math.abs(cp.y - (roof + 1)) < 0.6, `${c.id} pad ${k} not on its roof`);
        continue;
      }
      if (cp.kind !== 'ring') continue;
      assert.ok(cp.y - cp.r > 5, `${c.id} ring ${k} too close to the ground`);
      if (cp.canyon) {
        canyon++;
        const e = avenueAt(city, cp.x, cp.z);
        assert.ok(city.onRoad(cp.x, cp.z) && e, `${c.id} canyon ring ${k} not over an avenue`);
        assert.ok(cp.r >= CANYON_RING_R, c.id);
        // Faces along the avenue, and its full width fits between the buildings.
        assert.ok(Math.abs(Math.sin(cp.dir - Math.atan2(e.uz, e.ux))) < 0.01, `${c.id} canyon ring ${k} faces the avenue`);
        for (const s of [-1, -0.5, 0, 0.5, 1]) {
          assert.equal(collision.heightAt(cp.x - e.uz * s * cp.r, cp.z + e.ux * s * cp.r), 0, `${c.id} canyon ring ${k} touches a building`);
        }
        continue;
      }
      for (let a = 0; a < 8; a++) {
        for (const f of [0, 0.5, 1]) {
          const x = cp.x + Math.cos((a * Math.PI) / 4) * cp.r * f, z = cp.z + Math.sin((a * Math.PI) / 4) * cp.r * f;
          assert.ok(cp.y - cp.r > collision.heightAt(x, z) + 10, `${c.id} ring ${k} over a roof`);
        }
      }
      const tall = tallestNear(city, cp.x, cp.z, 40);
      if (tall > 0) assert.ok(cp.y - cp.r >= tall + 25, `${c.id} ring ${k} too near a tower`);
    }
  }
  assert.ok(canyon >= 4, 'the threader runs through street canyons');
  assert.ok(byId['sky-rooftop'].checkpoints.filter((cp) => cp.kind === 'pad' && cp.y > 5).length >= 3, 'three rooftop touch points');
  const rw = city.airfield.runway, s = byId['sky-gull'].start;
  assert.ok(s.x > rw.x0 && s.x < rw.x1 && s.z > rw.z0 && s.z < rw.z1, 'First Feathers starts on the runway');
  const am = byId['deliver-airmail'].checkpoints.at(-1);
  const pad = city.helipads.find((h) => Math.hypot(h.x - am.x, h.z - am.z) < 1);
  assert.ok(pad, 'air mail ends on a helipad');
  assert.equal(city.placeOf(pad.x, pad.z), 'Watson Island');
});

test('Miami start zones do not overlap and keep clear of parked craft', () => {
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i].start, b = courses[j].start;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 30, `${courses[i].id} vs ${courses[j].id}`);
    }
  }
  const spots = [...city.aircraftSpots, ...city.boatSpots];
  for (const c of courses) {
    if (c.id === 'sky-gull') continue;
    for (const q of spots) assert.ok(Math.hypot(q.x - c.start.x, q.z - c.start.z) >= 14, `${c.id} start near a ${q.spec} spawn`);
  }
});

function fakeGame() {
  const toasts = [], fired = [], markers = [];
  const events = createEvents();
  for (const n of ['reward', 'fail', 'checkpoint']) events.on(n, (a) => fired.push([n, a]));
  const game = {
    city, events, toasts, fired, time: 0, courses,
    hud: { toast: (t) => toasts.push(t) },
    map: { addMarker: (m) => markers.push(m), removeMarker: (m) => { const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); } },
    mapMarkers: markers,
    progress: defaultProgress(),
    player: { mode: 'foot', vehicle: null, x: 0, z: 0, y: 0 },
  };
  game.score = createScore(game);
  return game;
}
function put(game, sys, x, z, y = 0, steps = 1) {
  const v = game.player.vehicle;
  if (v) { v.x = x; v.z = z; v.y = y; }
  game.player.x = x;
  game.player.z = z;
  game.player.y = y;
  for (let i = 0; i < steps; i++) {
    game.time += DT;
    sys.fixedUpdate(DT);
  }
}

test('Miami activities: every course is offered at its start in its craft and runs to the finish', () => {
  const game = fakeGame();
  const sys = createActivities(game);
  assert.equal(sys.courses.length, courses.length);
  assert.equal(game.mapMarkers.length, courses.length, 'a map marker per start');
  for (const c of courses) {
    const craft = { kind: c.kinds[0], x: 0, z: 0, y: 0, speed: 0, wrecked: false };
    game.player.vehicle = craft;
    game.player.mode = craft.kind;
    put(game, sys, c.start.x + 500, c.start.z + 500, 0, 3);
    put(game, sys, c.start.x, c.start.z, c.start.y, 2);
    assert.equal(sys.offer, c.id, `${c.id} offered`);
    assert.equal(sys.acceptOffer(), true);
    put(game, sys, c.start.x, c.start.z, c.start.y, Math.round(COUNTDOWN / DT) + 2);
    assert.equal(sys.active && sys.active.phase, 'running', c.id);
    for (let lap = 0; lap < c.laps; lap++) for (const cp of c.checkpoints) put(game, sys, cp.x, cp.z, cp.y, 2);
    assert.equal(sys.active, null, `${c.id} finished`);
    assert.ok(sys.lastResult && sys.lastResult.medal === 'gold', `${c.id} gold for a teleport run`);
    put(game, sys, c.start.x + 500, c.start.z + 500, 0, 3);
  }
  assert.equal(game.progress.stats.races, courses.length);
});

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const layout = findSecrets(city);

test('Miami secrets: six, one per id, hand-placed and the same every build', () => {
  assert.equal(layout.spots.length, 6);
  assert.deepEqual(layout.spots.map((s) => s.id), SECRET_IDS);
  assert.deepEqual(layout.spots, city.secretSpots);
  for (const s of layout.spots) assert.ok(typeof s.note === 'string' && s.note.length > 10 && !/Saltyard|Pale Shore|Fernside/.test(s.note), s.id);
});

test('Miami secrets: on land, off the airfield, spread out, none inside a building but the roof', () => {
  for (const s of layout.spots) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z), s.id);
    assert.ok(city.mainShore(s.x, s.z) > 0 && city.isLand(s.x, s.z), s.id + ' on land');
    assert.notEqual(city.districtOf(s.x, s.z), 'airfield', s.id);
  }
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const a = layout.spots[i], b = layout.spots[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 3 * DISCOVER_R, a.id + ' / ' + b.id);
    }
  }
  for (const s of layout.spots) {
    if (s.kind === 'rooftop') continue;
    assert.ok(!city.buildings.some((b) => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1), s.id + ' not inside a building');
  }
  const roof = layout.spots.find((s) => s.kind === 'rooftop');
  assert.ok(roof.minY > 3 && roof.minY < roof.roofY);
  assert.ok(Math.abs(collision.heightAt(roof.x, roof.z) - roof.roofY) < 1e-6, 'the lounge stands on its roof');
});

test('Miami secrets: each spot checked against the data where the plan puts it', () => {
  const at = Object.fromEntries(layout.spots.map((s) => [s.id, s]));
  const ahead = (s, d) => city.shoreDist(s.x + Math.cos(s.heading) * d, s.z + Math.sin(s.heading) * d);
  // The container sinks off the port's south pier: its spot on the pier
  // edge, the box (23 m out along the heading) in open water.
  const box = at['drowned-box'];
  assert.equal(city.placeOf(box.x, box.z), 'Dodge Island');
  assert.ok(city.mainShore(box.x, box.z) < 10 && ahead(box, 23) < -4, 'container in the water');
  // The culvert and the lighthouse are on the shore, facing the water.
  const cave = at['the-gullet'], lamp = at.rustlamp;
  assert.equal(city.placeOf(cave.x, cave.z), 'Brickell Key');
  assert.equal(city.placeOf(lamp.x, lamp.z), 'Palm Island');
  for (const s of [cave, lamp]) assert.ok(city.mainShore(s.x, s.z) < 10 && ahead(s, 20) < 0, s.id + ' on the shore, facing the sea');
  // Wynwood roof and alley; the playground in Margaret Pace Park.
  assert.equal(city.placeOf(at['roof-garden'].x, at['roof-garden'].z), 'Wynwood');
  const alley = at['tag-alley'];
  assert.equal(city.placeOf(alley.x, alley.z), 'Wynwood');
  assert.ok(alley.gap >= 3 && alley.gap <= 8 && alley.len >= 14);
  assert.ok(city.inBuilding(alley.tag.x - alley.tag.nx * 0.5, alley.tag.z - alley.tag.nz * 0.5), 'the tag is on a wall');
  assert.equal(collision.heightAt(alley.x, alley.z), 0, 'the alley itself is open');
  assert.equal(city.placeOf(at['lone-ride'].x, at['lone-ride'].z), 'Margaret Pace Park');
  // Lighthouse: the collision circle the system adds stays off roads.
  assert.ok(!city.onRoad(lamp.x, lamp.z));
});

test('Miami garage: open ground by the river, clear of buildings and the sea', () => {
  const g = layout.garage;
  assert.ok(g, 'a garage was found');
  assert.ok(city.mainShore(g.x, g.z) > 10);
  assert.notEqual(city.districtOf(g.x, g.z), 'airfield');
  assert.ok(Math.hypot(g.x - MIAMI_SPOTS.secrets.garage.x, g.z - MIAMI_SPOTS.secrets.garage.z) < 150, 'near the boatyards');
  const f = g.footprint;
  const near = [];
  city.buildingsNear(f.x0, f.z0, f.x1, f.z1, near);
  for (const id of near) {
    const b = city.buildings[id];
    assert.ok(!(f.x0 < b.x1 && f.x1 > b.x0 && f.z0 < b.z1 && f.z1 > b.z0), 'garage overlaps a building');
  }
  for (const [x, z] of [[f.x0, f.z0], [f.x1, f.z1], [f.x0, f.z1], [f.x1, f.z0]]) assert.ok(!city.onRoad(x, z), 'garage on a road');
  assert.ok(g.carX > f.x0 && g.carX < f.x1 && g.carZ > f.z0 && g.carZ < f.z1);
});

test('Miami secrets system: discovery once each; the sixth unlocks and parks Ghostwake', () => {
  const st = emptySecrets();
  for (const s of layout.spots) discover(st, layout.spots, s.x, s.minY == null ? 0 : s.roofY, s.z);
  assert.ok(secretsDone(st) && st.ghostwake);
  const toasts = [], vehicles = [];
  const game = {
    city, events: createEvents(), rng: createRng(5), progress: defaultProgress(),
    collision: createCollisionWorld(), vehicles, garage: [],
    player: { x: 0, y: 0, z: 0 },
    hud: { toast: (t) => toasts.push(t) },
    score: { add: () => {} },
    map: { addMarker: () => {}, removeMarker: () => {} },
    addVehicle: (v) => vehicles.push(v),
  };
  const sys = createSecrets(game);
  for (const s of sys.spots) {
    game.player.x = s.x;
    game.player.z = s.z;
    game.player.y = s.minY == null ? 0 : s.roofY;
    for (let i = 0; i < 20; i++) sys.fixedUpdate(DT);
  }
  assert.equal(sys.count(), 6);
  assert.ok(sys.unlocked());
  assert.equal(vehicles.filter((v) => v.spec.id === 'ghostwake').length, 1);
  assert.ok(toasts.some((t) => t.includes('Ghostwake unlocked')));
});

// ---------------------------------------------------------------------------
// Stunt ramps
// ---------------------------------------------------------------------------

const ramps = generateStuntSpots(city);

test('Miami ramps: four named street ramps plus the airfield dock, the same every time', () => {
  assert.deepEqual(ramps.map((s) => [s.id, s.x, s.z]), city.rampSpots.map((s) => [s.id, s.x, s.z]));
  assert.ok(ramps.length >= 5 && ramps.length <= 8, `count ${ramps.length}`);
  assert.equal(new Set(ramps.map((s) => s.id)).size, ramps.length, 'unique ids');
  for (const s of ramps) {
    assert.match(s.id, /^stunt_[a-z0-9_]+$/);
    if (s.water) assert.ok(!city.isLand(s.x, s.z), `${s.name} in the water`);
    else assert.ok(city.isLand(s.x, s.z), `${s.name} on land`);
    if (!s.water && !s.id.startsWith('stunt_dock')) assert.notEqual(city.districtOf(s.x, s.z), 'downtown');
  }
  assert.ok(ramps.some((s) => s.id === 'stunt_dock_splash' && s.water));
  assert.ok(ramps.some((s) => s.id === 'stunt_dock_kicker' && !s.water));
  const street = ramps.filter((s) => !s.id.startsWith('stunt_dock'));
  assert.equal(street.length, MIAMI_SPOTS.ramps.length);
  for (let i = 0; i < street.length; i++) {
    for (let j = i + 1; j < street.length; j++) assert.ok(Math.hypot(street[i].x - street[j].x, street[i].z - street[j].z) >= 240);
  }
  const want = { stunt_wynwood_kicker: 'Wynwood', stunt_little_havana_hop: 'Little Havana', stunt_edgewater_launch: 'Edgewater', stunt_palm_island_skip: 'Palm Island' };
  for (const s of street) {
    assert.equal(city.placeOf(s.x, s.z), want[s.id], s.name);
    // Along its street: the whole ramp on the road, clear of buildings and parked cars.
    for (const u of [-s.half, 0, s.half]) {
      for (const v of [-s.width / 2, s.width / 2]) {
        const x = s.x + s.ax * u - s.az * v, z = s.z + s.az * u + s.ax * v;
        assert.ok(city.onRoad(x, z), `${s.name} corner off the road`);
        assert.equal(collision.heightAt(x, z), 0, `${s.name} in a building`);
      }
    }
    for (const p of city.parkingSpots) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) > s.r + 4, `${s.name}: a car is parked on it`);
  }
});

test('Miami ramps: a fast car down the street flies off each street ramp and lands', () => {
  for (const spot of ramps.filter((s) => !s.water && !s.id.startsWith('stunt_dock'))) {
    const car = createVehicle('sedan', spot.x - spot.ax * 60, spot.z - spot.az * 60, Math.atan2(spot.az, spot.ax));
    const game = { events: createEvents(), vehicles: [car], progress: defaultProgress(), player: { vehicle: car, x: 0, z: 0 }, input: { steer: 0, throttle: 0, brake: 0 }, time: 0 };
    game.score = createScore(game);
    const stunts = createStunts(game, { spots: [spot] });
    const seen = [];
    game.events.on('stunt', (e) => seen.push(e));
    car.vx = spot.ax * 25;
    car.vz = spot.az * 25;
    car.speed = 25;
    let maxY = 0;
    for (let i = 0; i < 300; i++) {
      car.px = car.x;
      car.pz = car.z;
      const air = !!(car.air && car.air.on);
      game.input.throttle = air ? 0 : 0.6;
      stepVehicle(car, game.input, DT, null);
      game.score.fixedUpdate(DT);
      stunts.fixedUpdate(DT);
      maxY = Math.max(maxY, car.y);
    }
    assert.ok(maxY > RAMP_LAND.height + 1, `${spot.name} peak ${maxY}`);
    assert.equal(seen.length, 1, spot.name);
    assert.ok(seen[0].ok && seen[0].points > 0, spot.name);
    assert.ok(rampHeight(spot, spot.x, spot.z) === RAMP_LAND.height);
  }
});

// ---------------------------------------------------------------------------
// Other hand-placed places
// ---------------------------------------------------------------------------

test('Miami places: roof pad, Cinder tank and the port cranes, checked against the data', () => {
  const roof = city.roofPads[0];
  assert.ok(roof && roof.y >= 12 && roof.y <= 30 && Math.abs(collision.heightAt(roof.x, roof.z) - roof.y) < 1e-6, 'police pad on a roof');
  assert.ok(city.aircraftSpots.some((s) => s.roof && s.spec === 'patrolheli' && s.x === roof.x));
  assert.equal(city.placeOf(roof.x, roof.z), 'Park West');
  const cinder = city.tankSpots.find((s) => s.place === 'cinder');
  assert.ok(cinder && city.districtOf(cinder.x, cinder.z) === 'industrial' && city.placeOf(cinder.x, cinder.z) === 'Wynwood');
  for (const off of [-1.8, 1.8]) {
    const x = cinder.x + Math.cos(cinder.heading) * off, z = cinder.z + Math.sin(cinder.heading) * off;
    assert.equal(collision.resolveCircle(x, z, 1.9, 1).hit, false, 'Cinder tank clear of buildings');
    assert.ok(city.shoreDist(x, z) > 3 && !city.onRoad(x, z));
  }
  for (const s of city.parkingSpots) assert.ok(Math.hypot(s.x - cinder.x, s.z - cinder.z) >= 6, 'no parking loted on the tank');
  assert.equal(city.landmarks.cranes.length, MIAMI_SPOTS.cranes.length);
  for (const c of city.landmarks.cranes) {
    assert.equal(city.placeOf(c.x, c.z), 'Dodge Island');
    for (const ox of [-7, 7]) for (const oz of [-6, 6]) assert.ok(city.mainShore(c.x + ox, c.z + oz) > 1 && !city.onRoad(c.x + ox, c.z + oz), 'crane leg on the pier');
    assert.ok(city.shoreDist(c.x, c.z + 30) < -2, 'boom out over the water');
  }
});

// ---------------------------------------------------------------------------
// HUD names and first-visit flags
// ---------------------------------------------------------------------------

test('Miami HUD names: real neighborhoods from the data; bridges and water named', () => {
  for (const list of [MIAMI_SPOTS.places, MIAMI_SPOTS.waterPlaces]) {
    for (const p of list) {
      assert.ok(DATA_NAMES.has(p.src), `${p.name}: ${p.src} is in the data`);
      assert.ok(p.src.includes(p.name.split(' ')[0]), `${p.name} from ${p.src}`);
    }
  }
  const allowed = new Set(['Miami', DISTRICTS.airfield.name, ...MIAMI_SPOTS.places.map((p) => p.name), ...MIAMI_SPOTS.waterPlaces.map((p) => p.name)]);
  for (const e of city.edges) if (e.name && (e.bridge || e.causeway)) allowed.add(e.name);
  const seen = new Set();
  const out = { key: '', name: '' };
  for (let x = city.crop.x0; x <= city.crop.x1; x += 25) {
    for (let z = city.crop.z0; z <= city.crop.z1; z += 25) {
      hudPlace(city, x, z, out);
      assert.ok(allowed.has(out.name), `${out.name} at ${x}, ${z}`);
      assert.ok(out.key === 'shore' || Object.hasOwn(DISTRICTS, out.key), out.key);
      seen.add(out.name);
    }
  }
  for (const n of ['Downtown Miami', 'Brickell', 'Little Havana', 'Wynwood', 'Edgewater', 'Overtown', 'Watson Island', 'Dodge Island', 'Biscayne Bay', 'Miami River', 'MacArthur Causeway']) assert.ok(seen.has(n), n);
  // Probes.
  const name = (x, z) => hudPlace(city, x, z, out).name;
  assert.equal(name(city.spawn.x, city.spawn.z), 'Downtown Miami');
  assert.equal(name(0, -2000), 'Biscayne Bay');
  assert.equal(name(-450, -2416), 'Gullwing Causeway');
  assert.equal(name(400, -2470), DISTRICTS.airfield.name);
});

function flagRun(c, step) {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const toasts = [];
  const game = { events: createEvents(), progress: defaultProgress(), hud: { toast: (t) => toasts.push(t) }, player: { x: 0, z: 0 } };
  createEconomy(game, storage);
  const keys = new Set();
  const out = { key: '', name: '' };
  let last = '', lastKey = '';
  // The HUD's own loop: emit on every change of name or key.
  for (let x = c.bounds ? c.crop.x0 : -900; x <= (c.bounds ? c.crop.x1 : 900); x += step) {
    for (let z = c.bounds ? c.crop.z0 : -900; z <= (c.bounds ? c.crop.z1 : 900); z += step) {
      hudPlace(c, x, z, out);
      keys.add(out.key);
      if (out.name !== last || out.key !== lastKey) {
        last = out.name;
        lastKey = out.key;
        game.events.emit('district', out.name, out.key);
      }
    }
  }
  return { game, keys, toasts };
}

test('district flags: every key the Miami HUD reports sets its seen_ flag (names are real, keys are not lost)', () => {
  const { game, keys, toasts } = flagRun(city, 25);
  for (const k of ['downtown', 'midtown', 'residential', 'docks', 'industrial', 'park', 'airfield', 'shore']) assert.ok(keys.has(k), 'Miami has ' + k);
  for (const k of keys) assert.equal(game.progress.medals['seen_' + k], 'bronze', 'seen_' + k);
  assert.equal(toasts.length, keys.size, 'one New area toast per key');
  assert.ok(toasts.every((t) => t.startsWith('New area: ') && !t.includes(SHORE_NAME)));
  // Only known keys: a forged key falls back to the name map (and is ignored).
  game.events.emit('district', 'Nowhere', '__proto__');
  assert.equal(game.progress.medals.seen___proto__, undefined);
});

test('district flags: the island still sets them from the HUD name alone', () => {
  const { game, keys } = flagRun(island, 40);
  assert.ok(keys.has('shore') && keys.size >= 6);
  for (const k of keys) assert.equal(game.progress.medals['seen_' + k], 'bronze', 'seen_' + k);
  const g2 = { events: createEvents(), progress: defaultProgress(), player: { x: 0, z: 0 } };
  createEconomy(g2, { getItem: () => null, setItem: () => {} });
  g2.events.emit('district', DISTRICTS.docks.name);
  g2.events.emit('district', SHORE_NAME);
  assert.equal(g2.progress.medals.seen_docks, 'bronze');
  assert.equal(g2.progress.medals.seen_shore, 'bronze');
});

test('texts: the Miami tutorial and menu name Miami places, and the menu shows the OSM credit', () => {
  assert.equal(city.attribution, 'Map data (c) OpenStreetMap contributors, ODbL');
  assert.ok(/Northeast 26th Street/.test(city.texts.craft) && /Bayfront Marina/.test(city.texts.fleet));
  const src = fs.readFileSync(new URL('../src/ui/menu.js', import.meta.url), 'utf8');
  assert.ok(src.includes("'Map data (c) OpenStreetMap contributors, ODbL'"));
  for (const t of Object.values(city.texts)) assert.ok(!/[\u2013\u2014]/.test(t));
  assert.ok(city.piers.some((p) => p.label === 'Bayfront Marina') && city.boatSpots.some((b) => b.spec === 'yacht'));
});

// ---------------------------------------------------------------------
// 0.9.0 map truth (docs/PLAN_V3.md 2.1, acceptance item 2 of section 6).
// ---------------------------------------------------------------------
const decodeLine = (p) => {
  const o = [];
  let x = 0, z = 0;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; o.push([x / 10, z / 10]); }
  return o;
};
const lineLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
const TRUTH = ['Ocean Drive', 'Collins Avenue', 'Washington Avenue', 'Lincoln Road', 'Alton Road', '5th Street', 'Española Way', 'Meridian Avenue'];

test('South Beach streets: present, length within 10 % of the data, at their real place within 15 m', async () => {
  const { BOX } = await import('../src/world/regions.js');
  const R = 6371008.8, lat0 = data.origin.lat, lon0 = data.origin.lon;
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180), kz = (Math.PI / 180) * R;
  // The data box now reaches the Atlantic: east edge -80.115, same origin.
  assert.equal(data.latLonBox.e, -80.115);
  assert.ok(Math.abs(data.bounds.maxX - BOX.x1) < 1, `box x1 ${data.bounds.maxX}`);
  assert.deepEqual([data.origin.lat, data.origin.lon], [25.78, -80.18]);
  const inBox = (x, z) => x > BOX.x0 + 40 && x < BOX.x1 - 40 && z > BOX.z0 + 40 && z < BOX.z1 - 40;
  for (const nm of TRUTH) {
    // The data's drivable ways of the name, inside the box.
    let want = 0;
    const samples = [];
    for (const r of data.roads) {
      if (r.name !== nm || (r.class === 'service') || (r.class === 'pedestrian' && !r.mall && nm !== 'Española Way')) continue;
      const pts = decodeLine(r.p).filter(([x, z]) => inBox(x, z));
      want += lineLen(pts);
      if (pts.length) samples.push(pts[Math.floor(pts.length / 2)]);
    }
    let got = 0;
    // A tight one-way pair merged into one two-way edge stands for both ways.
    for (const e of city.edges) if (e.name === nm) got += e.length * (e.merged ? 2 : 1);
    assert.ok(want > 50, `${nm}: ${want.toFixed(0)} m in the data`);
    assert.ok(Math.abs(got - want) <= want * 0.1 + 15, `${nm}: ${got.toFixed(0)} m drawn, ${want.toFixed(0)} m in the data`);
    // Three sample points: the data point (lat, lon back through the
    // projection) lies within 15 m of a drawn edge of that name.
    const pick = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]];
    for (const [x, z] of pick) {
      const lat = lat0 - z / kz, lon = lon0 + x / kx;
      assert.ok(lat > 25.745 && lat < 25.815 && lon > -80.16 && lon < -80.115, `${nm} at ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      const near = city.edgesNear(x, z, 15, []).some((id) => city.edges[id].name === nm);
      assert.ok(near, `${nm}: drawn within 15 m of ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    }
  }
});

test('the Beach region: land to the ocean beach, under 30 % infill, the start on Ocean Drive', async () => {
  const { DEFAULT_REGION } = await import('../src/world/regions.js');
  const beach = createMiamiCity(JSON.parse(fs.readFileSync(new URL('../src/world/data/miami-beach.json', import.meta.url), 'utf8')), { region: 'miami-beach' });
  assert.equal(DEFAULT_REGION, 'miami-beach');
  // Ocean Drive at 10th Street (the data maps it one-way southbound).
  const s = beach.streetAt(beach.spawn.x, beach.spawn.z, undefined, beach.spawn.heading);
  assert.ok(s && s.name === 'Ocean Drive', 'start on Ocean Drive');
  assert.ok(beach.edges.some((e) => e.name === '10th Street' && Math.hypot(beach.nodes[e.a].x - beach.spawn.x, beach.nodes[e.a].z - beach.spawn.z) < 120), '10th Street at the start');
  // Land runs east of Ocean Drive to the Atlantic at 5th, 10th and 15th Street.
  for (const z of [600, -60, -800]) {
    let x = beach.spawn.x, last = x;
    for (; x < 6500; x += 5) if (beach.mainShore(x, z) > 0) last = x;
    assert.ok(last > 5050, `land to x ${last} at z ${z}`);
    assert.ok(beach.shoreDist(6300, z) < 0, 'the ocean past it');
  }
  // Infill (generated boxes) under 30 % of the Beach's buildings.
  const own = beach.buildings.filter((b) => !b.depot);
  const gen = own.filter((b) => b.gen).length;
  assert.ok(gen / own.length < 0.3, `infill ${(100 * gen / own.length).toFixed(1)} %`);
});
