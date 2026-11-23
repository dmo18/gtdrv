// The sixteen Miami adventures (docs/REVAMP.md 6.6): definitions, placement
// on the real data, the locked routes, discovery and a scripted run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { generateCity } from '../src/world/citygen.js';
import {
  ADVENTURE_IDS, ADVENTURE_SEED, ADV_SEEN_R, ADV_FINALE_BONUS, KIND_SCORE, ROUTE_SPECS, ROUTE_IDS, REWARD_CARS,
  placeAdventures, attachExplore, stepReached, stepPlaceOk, playerStepMode,
} from '../src/world/adventures.js';
import { GARAGE_DEFS } from '../src/world/garages.js';
import { buildRoutes } from '../src/world/courses.js';
import { createEvents } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { defaultProgress } from '../src/core/save.js';
import { createScore } from '../src/systems/score.js';
import { createAdventures } from '../src/systems/adventures.js';
import { createActivities } from '../src/systems/activities.js';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';
import { EXPLORE_KEY, defaultExplore, saveExplore } from '../src/core/explore.js';

const DT = 1 / 60;
const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
attachExplore(city);
const advs = city.adventures;
const byId = Object.fromEntries(advs.map((a) => [a.id, a]));

test('sixteen adventures: ids, kinds, core split and the fixed ten', () => {
  assert.equal(ADVENTURE_SEED, 9241);
  assert.equal(advs.length, 16);
  assert.deepEqual(advs.map((a) => a.id), ADVENTURE_IDS);
  assert.equal(new Set(advs.map((a) => a.name)).size, 16);
  for (const k of ['lookout', 'clue', 'hidden', 'tour']) assert.ok(advs.filter((a) => a.kind === k).length >= 3, k);
  assert.equal(advs.filter((a) => a.core).length, 8, 'eight in the core');
  assert.equal(advs.filter((a) => !a.core).length, 8, 'eight outside');
  const fixed = {
    'a-first-light': ['lookout', {}], 'a-roads-end': ['clue', { garage: 'g-roads' }], 'a-sandbar': ['tour', { garage: 'g-beach' }],
    'a-far-key': ['lookout', { garage: 'g-key' }], 'a-river-run': ['clue', { route: 'boat-x-river' }], 'a-keys-dash': ['hidden', { route: 'street-x-keys' }],
    'a-beach-mile': ['tour', { route: 'street-x-beach' }], 'a-sunchaser': ['clue', { car: 'sunchaser' }], 'a-tidewinder': ['hidden', { car: 'tidewinder' }],
    'a-nightheron': ['lookout', { car: 'nightheron' }],
  };
  for (const [id, [kind, rw]] of Object.entries(fixed)) {
    const a = byId[id];
    assert.equal(a.kind, kind, id);
    for (const k of ['garage', 'car', 'route']) assert.equal(a.reward[k], rw[k] || null, id + ' ' + k);
  }
  assert.equal(byId['a-first-light'].giver.type, 'start');
  // Re-anchored inside The Roads and the South Shore (PLAN_V2 3.2): a notice board there, not the Havana garage.
  assert.equal(byId['a-roads-end'].giver.type, 'sign');
  assert.equal(city.placeOf(byId['a-roads-end'].giver.x, byId['a-roads-end'].giver.z), 'The Roads');
  assert.deepEqual(byId['a-beach-mile'].needs, ['a-sandbar']);
  assert.equal(byId['a-river-run'].steps.every((s) => s.mode === 'boat'), true);
  assert.equal(byId['a-nightheron'].steps[0].mode, 'air');
  // The other six reward score only.
  for (const a of advs) {
    if (fixed[a.id]) continue;
    assert.deepEqual([a.reward.garage, a.reward.car, a.reward.route], [null, null, null], a.id);
  }
  for (const a of advs) assert.equal(a.reward.score, KIND_SCORE[a.kind], a.id);
  assert.deepEqual(Object.values(REWARD_CARS).filter((c) => VEHICLE_SPECS[c]).length, 3);
  // Every garage neighborhood has one.
  const places = new Set();
  for (const a of advs) {
    places.add(city.placeOf(a.giver.x, a.giver.z));
    for (const s of a.steps) places.add(city.placeOf(s.x, s.z));
  }
  for (const g of GARAGE_DEFS) assert.ok([...places].some((p) => p.includes(g.hood)), 'an adventure in ' + g.hood);
});

test('step shapes: 1 to 3 steps, clues under 90 characters, radii and rings in range, orders by kind', () => {
  for (const a of advs) {
    assert.ok(a.steps.length >= 1 && a.steps.length <= 3, a.id);
    assert.equal(a.order, a.kind === 'tour' ? 'any' : 'seq', a.id);
    if (a.kind === 'lookout' || a.kind === 'hidden') assert.equal(a.steps.length, 1, a.id);
    if (a.kind === 'tour') assert.equal(a.steps.length, 3, a.id);
    if (a.kind === 'clue') assert.ok(a.steps.length >= 2, a.id);
    assert.ok(a.giver.line.length > 10 && !/[\u2013\u2014]/.test(a.giver.line + a.name), a.id);
    for (const s of a.steps) {
      assert.ok(s.clue.length <= 90, `${a.id} clue ${s.clue.length}`);
      assert.ok(!/[\u2013\u2014]/.test(s.clue) && !/-?\d{3,}/.test(s.clue), a.id + ' clue: no long dashes or coordinates');
      assert.ok(s.r >= 10 && s.r <= 25, a.id);
      assert.ok(s.hint >= 60 && s.hint <= 200, a.id);
      if (a.kind === 'hidden') { assert.equal(s.r, 10, a.id); assert.ok(s.hint >= 150, a.id); }
      assert.ok(Math.hypot(s.rx - s.x, s.rz - s.z) <= s.hint / 2 + 0.2, a.id + ' ring center within half the radius');
    }
  }
});

test('every step is reachable in its mode and at least 150 m from its giver', () => {
  const pierAt = (x, z) => city.piers.some((p) => x > p.x0 - 0.5 && x < p.x1 + 0.5 && z > p.z0 - 0.5 && z < p.z1 + 0.5);
  for (const a of advs) {
    for (const [k, s] of a.steps.entries()) {
      assert.ok(Math.hypot(s.x - a.giver.x, s.z - a.giver.z) >= 150, `${a.id} step ${k} too near the giver`);
      if (s.mode === 'boat') {
        assert.ok(city.shoreDist(s.x, s.z) < -6, `${a.id} step ${k} in open water`);
      } else if (s.mode === 'air') {
        assert.ok(s.minY > 20, `${a.id} step ${k}: a roof pad`);
      } else {
        assert.ok(city.isLand(s.x, s.z) || pierAt(s.x, s.z), `${a.id} step ${k} on land`);
        assert.ok(!city.inBuilding(s.x, s.z, 1), `${a.id} step ${k} in a building`);
      }
      assert.ok(stepPlaceOk(city, s.x, s.z, s.mode), a.id);
    }
    // Givers stand on open land (garage givers at the garage door).
    if (a.giver.type === 'sign' || a.giver.type === 'talker') {
      assert.ok(city.isLand(a.giver.x, a.giver.z) && !city.inBuilding(a.giver.x, a.giver.z, 1) && !city.onRoad(a.giver.x, a.giver.z), a.id + ' giver');
    }
  }
  assert.ok(byId['a-first-light'].steps[0].x > -430 && byId['a-first-light'].steps[0].x < -350, 'the end of the Bayfront Marina pier');
  assert.equal(city.placeOf(byId['a-far-key'].steps[0].x, byId['a-far-key'].steps[0].z), 'Virginia Key');
  assert.equal(city.placeOf(byId['a-keys-dash'].steps[0].x, byId['a-keys-dash'].steps[0].z), 'Brickell Key');
  assert.equal(city.placeOf(byId['a-tidewinder'].steps[0].x, byId['a-tidewinder'].steps[0].z), 'Allapattah');
  assert.equal(city.lotTypeAt(byId['a-tidewinder'].steps[0].x, byId['a-tidewinder'].steps[0].z), 'works');
  for (const s of byId['a-sandbar'].steps) assert.equal(city.placeOf(s.x, s.z), 'Miami Beach');
  assert.equal(city.placeOf(byId['a-roads-end'].steps[2].x, byId['a-roads-end'].steps[2].z), 'The Roads');
});

test('deterministic from the seed', () => {
  assert.deepEqual(placeAdventures(city), advs);
  assert.deepEqual(buildRoutes(city, ROUTE_SPECS), city.routes);
});

test('locked routes: three, in the course shape, each locked by its adventure', () => {
  const routes = city.routes;
  assert.deepEqual(routes.map((r) => r.id).sort(), [...ROUTE_IDS].sort());
  for (const r of routes) {
    const a = advs.find((q) => q.reward.route === r.id);
    assert.equal(r.locked, a.id);
    assert.ok(r.checkpoints.length >= 3 && r.medalTimes.gold > 0 && r.reward.gold > 0, r.id);
    assert.ok(!city.courses.some((c) => c.id === r.id || c.name === r.name), r.id + ' unique');
    for (const c of city.courses) assert.ok(Math.hypot(c.start.x - r.start.x, c.start.z - r.start.z) > 30, r.id + ' start clear of ' + c.id);
    if (r.type === 'boat') {
      let px = r.start.x, pz = r.start.z;
      for (const cp of r.checkpoints) {
        const L = Math.hypot(cp.x - px, cp.z - pz);
        for (let t = 0; t <= L; t += 4) {
          const x = px + ((cp.x - px) * t) / L, z = pz + ((cp.z - pz) * t) / L;
          assert.ok(city.shoreDist(x, z) < -2, `${r.id} leg crosses land at ${x.toFixed(0)},${z.toFixed(0)}`);
        }
        px = cp.x; pz = cp.z;
      }
    } else {
      for (const cp of r.checkpoints) assert.ok(city.onRoad(cp.x, cp.z), r.id);
    }
  }
  assert.ok(routes.find((r) => r.id === 'street-x-beach').checkpoints.every((cp) => city.placeOf(cp.x, cp.z) === 'Miami Beach'));
  assert.ok(routes.find((r) => r.id === 'street-x-keys').checkpoints.some((cp) => city.placeOf(cp.x, cp.z) === 'Brickell Key'));
  assert.equal(city.courses.length, 14, 'the 14 courses are unchanged');
});

test('step reach: radius, mode, height and stunt medal', () => {
  const s = { x: 0, z: 0, r: 10, mode: 'boat', minY: null, stunt: null };
  assert.equal(stepReached(s, 5, 0, 5, 'boat'), true);
  assert.equal(stepReached(s, 5, 0, 5, 'car'), false);
  assert.equal(stepReached(s, 9, 0, 9, 'boat'), false);
  const air = { x: 0, z: 0, r: 10, mode: 'air', minY: 40, stunt: null };
  assert.equal(stepReached(air, 0, 39, 0, 'air'), false);
  assert.equal(stepReached(air, 0, 41, 0, 'air'), true);
  const st = { x: 0, z: 0, r: 10, mode: 'any', minY: null, stunt: 'silver' };
  assert.equal(stepReached(st, 0, 0, 0, 'car', 'bronze'), false);
  assert.equal(stepReached(st, 0, 0, 0, 'car', 'gold'), true);
  assert.equal(playerStepMode('heli'), 'air');
  assert.equal(playerStepMode('tank'), 'car');
});

test('island: nothing placed, the system does nothing', () => {
  const island = generateCity();
  assert.deepEqual(placeAdventures(island), []);
  assert.deepEqual(buildRoutes(island, ROUTE_SPECS), []);
  const game = fakeGame(island);
  const st = memory();
  const sys = createAdventures(game, st);
  assert.equal(game.explore.active, false);
  sys.fixedUpdate(DT);
  assert.equal(st.map.size, 0, 'nothing written');
  assert.deepEqual(game.explore.counts(), { garagesFound: 0, garagesTotal: 12, adventuresDone: 0, adventuresTotal: 16, percent: 0 });
});

// ---- the system -------------------------------------------------------------------
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
function fakeGame(c = city) {
  const events = createEvents();
  const toasts = [], fired = [];
  for (const n of ['garageFound', 'adventureSeen', 'adventureStep', 'adventureDone', 'explored']) events.on(n, (e) => fired.push([n, e]));
  const markers = [];
  const game = {
    city: c, events, time: 0, rng: createRng(3), progress: defaultProgress(), vehicles: [], toasts, fired, courses: c.courses,
    hud: { toast: (t) => toasts.push(t), setPrompt: () => {} },
    map: { addMarker: (m) => markers.push(m), removeMarker: (m) => { const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); } },
    markers,
    player: { mode: 'foot', vehicle: null, x: 0, z: 0, y: 0, heading: 0, wanted: 0 },
  };
  game.score = createScore(game);
  return game;
}
function go(game, sys, x, z, y = 0, mode = 'foot', steps = 13) {
  const p = game.player;
  p.x = x; p.z = z; p.y = y; p.mode = mode;
  for (let i = 0; i < steps; i++) {
    game.time += DT;
    sys.fixedUpdate(DT);
  }
}
const count = (game, name, id) => game.fired.filter(([n, e]) => n === name && (!id || e.id === id)).length;

test('discovery fires once: rumours within 300 m, cells once each, quietly', () => {
  const game = fakeGame();
  const sys = createAdventures(game, memory());
  go(game, sys, city.spawn.x, city.spawn.z);
  assert.ok(game.explore.state.adventures.seen.includes('a-first-light'), 'known from the first launch');
  assert.equal(game.explore.state.adventures.tracked, 'a-first-light');
  const a = byId['a-port-pier'];
  go(game, sys, a.giver.x + ADV_SEEN_R + 50, a.giver.z);
  assert.ok(!game.explore.state.adventures.seen.includes(a.id));
  go(game, sys, a.giver.x + ADV_SEEN_R - 20, a.giver.z);
  assert.ok(game.explore.state.adventures.seen.includes(a.id));
  go(game, sys, a.giver.x, a.giver.z);
  go(game, sys, a.giver.x + 100, a.giver.z);
  go(game, sys, a.giver.x, a.giver.z);
  assert.equal(count(game, 'adventureSeen', a.id), 1, 'seen once');
  assert.ok(game.markers.some((m) => m.id === a.id), 'a "?" on the map');
  // Explore cells: 50 points each, no toast, once.
  const cells = count(game, 'explored');
  assert.ok(cells >= 2);
  const toasts = game.toasts.filter((t) => t.startsWith('Explored')).length;
  assert.equal(toasts, 0, 'no toast for a new cell');
  go(game, sys, city.spawn.x, city.spawn.z);
  assert.equal(count(game, 'explored'), cells, 'a cell counts once');
  const pc = game.explore.counts().percent;
  assert.ok(pc > 0 && pc < 5, 'explored ' + pc);
  // A garage within 400 m goes on the map.
  const g = city.garages[2];
  go(game, sys, g.door.x + 390, g.door.z);
  assert.ok(game.explore.state.garages.seen.includes(g.id));
  // A locked garage never does.
  const gr = city.garages.find((q) => q.id === 'g-roads');
  go(game, sys, gr.door.x, gr.door.z);
  assert.ok(!game.explore.state.garages.seen.includes('g-roads'));
});

test('scripted run: First Light and Roads End step by step, score, events and the unlock', () => {
  const game = fakeGame();
  const st = memory();
  const sys = createAdventures(game, st);
  const fl = byId['a-first-light'];
  go(game, sys, city.spawn.x, city.spawn.z);
  let before = game.score.total;
  go(game, sys, fl.steps[0].x, fl.steps[0].z);
  assert.ok(game.explore.isDone('a-first-light'));
  assert.equal(count(game, 'adventureStep', fl.id), 1);
  assert.equal(count(game, 'adventureDone', fl.id), 1);
  assert.ok(game.score.total - before >= KIND_SCORE.lookout);
  go(game, sys, fl.steps[0].x, fl.steps[0].z);
  assert.equal(count(game, 'adventureDone', fl.id), 1, 'done once');
  // Roads End: heard at the notice board in The Roads (here the giver is in
  // reach), then the three clue steps in order.
  const re = byId['a-roads-end'];
  go(game, sys, re.giver.x, re.giver.z);
  assert.ok(game.explore.state.adventures.seen.includes(re.id));
  sys.track(re.id);
  assert.equal(sys.objective.label, re.name);
  assert.ok(Math.hypot(sys.objective.x - re.steps[0].x, sys.objective.z - re.steps[0].z) <= re.steps[0].hint / 2 + 1, 'the arrow aims at the ring');
  go(game, sys, re.steps[1].x, re.steps[1].z);
  assert.equal(count(game, 'adventureStep', re.id), 0, 'steps go in order');
  before = game.score.total;
  for (let k = 0; k < 3; k++) {
    go(game, sys, re.steps[k].x, re.steps[k].z);
    assert.equal(count(game, 'adventureStep', re.id), k + 1, 'step ' + k);
  }
  assert.ok(game.explore.isDone(re.id));
  assert.ok(game.score.total - before >= KIND_SCORE.clue);
  assert.ok(game.toasts.some((t) => t.includes('Roads End done') && t.includes('Roads End Garage')));
  // The unlock: g-roads is now on the map and saved.
  assert.ok(game.explore.state.garages.seen.includes('g-roads'));
  assert.ok(game.explore.garageOpen('g-roads'));
  const saved = JSON.parse(st.map.get(EXPLORE_KEY));
  assert.ok(saved.adventures.done.includes('a-roads-end') && saved.garages.seen.includes('g-roads'));
  // Reloading the save keeps it; the stored text holds no derived extras.
  const game2 = fakeGame();
  createAdventures(game2, st);
  assert.ok(game2.explore.isDone('a-roads-end'));
  assert.equal(game2.explore.counts().adventuresDone, 2);
});

test('the boat clue needs a boat; the roof needs height; all sixteen pay the finale once', () => {
  const game = fakeGame();
  const st = memory();
  const ex = defaultExplore();
  ex.adventures.seen.push(...ADVENTURE_IDS);
  saveExplore(st, ex);
  const sys = createAdventures(game, st);
  const rr = byId['a-river-run'];
  go(game, sys, rr.steps[0].x, rr.steps[0].z, 0, 'car');
  assert.equal(count(game, 'adventureStep', rr.id), 0, 'not by car');
  go(game, sys, rr.steps[0].x, rr.steps[0].z, 0, 'boat');
  assert.equal(count(game, 'adventureStep', rr.id), 1);
  const nh = byId['a-nightheron'];
  go(game, sys, nh.steps[0].x, nh.steps[0].z, 5, 'heli');
  assert.ok(!game.explore.isDone(nh.id), 'not from the street');
  go(game, sys, nh.steps[0].x, nh.steps[0].z, nh.steps[0].minY + 1, 'heli');
  assert.ok(game.explore.isDone(nh.id));
  assert.ok(game.explore.state.garages.cars.some((c) => c.spec === 'nightheron' && c.reward), 'the reward car is in the collection');
  // Everything else, in an order the needs allow.
  const order = ADVENTURE_IDS.filter((id) => id !== 'a-beach-mile').concat(['a-beach-mile']);
  for (const id of order) {
    const a = byId[id];
    for (const s of a.steps) {
      const mode = s.mode === 'boat' ? 'boat' : s.mode === 'air' ? 'heli' : 'foot';
      go(game, sys, s.x, s.z, s.minY != null ? s.minY + 1 : 0, mode);
    }
    assert.ok(game.explore.isDone(id), id);
  }
  assert.equal(game.explore.counts().adventuresDone, 16);
  assert.equal(game.toasts.filter((t) => t.startsWith('Every adventure done')).length, 1);
  assert.equal(game.toasts.filter((t) => t.includes(String(ADV_FINALE_BONUS.toLocaleString('en-US')))).length >= 1, true);
});

test('activities: a locked route is hidden until its adventure is done', () => {
  const game = fakeGame();
  const st = memory();
  game.adventures = createAdventures(game, st);
  const acts = createActivities(game);
  assert.equal(acts.courses.length, 17);
  const r = city.routes.find((q) => q.id === 'street-x-keys');
  assert.ok(!game.markers.some((m) => m.label === r.name), 'no map marker while locked');
  const v = { kind: 'car', x: r.start.x, z: r.start.z, y: 0, speed: 0 };
  game.player.vehicle = v;
  game.player.mode = 'car';
  const put = (x, z, n = 3) => { game.player.x = v.x = x; game.player.z = v.z = z; for (let i = 0; i < n; i++) { game.time += DT; acts.fixedUpdate(DT); } };
  put(r.start.x, r.start.z);
  assert.equal(acts.offer, null, 'not offered while locked');
  // Finish its adventure: the route opens at once.
  const a = byId['a-keys-dash'];
  game.explore.state.adventures.seen.push(a.id);
  game.adventures.probe(a.steps[0].x, 0, a.steps[0].z, 'foot');
  assert.ok(game.explore.isDone(a.id));
  assert.ok(game.markers.some((m) => m.label === r.name), 'its start is on the map');
  put(r.start.x + 400, r.start.z + 400);
  put(r.start.x, r.start.z);
  assert.equal(acts.offer, r.id);
});

// ---- Regions (docs/PLAN_V2.md 3.2): an adventure belongs to the region that
// holds its giver and every step 40 m inside, and is offered only there. ----
import { regionCity, allRegionCities } from './regionfixture.js';
import { regionFor, inRegion, PLACE_MARGIN } from '../src/world/regions.js';
import { ADVENTURE_DEFS, adventurePoints, adventureInRegion } from '../src/world/adventures.js';

const OFFERED = {
  'miami-downtown': ['a-first-light', 'a-river-run', 'a-keys-dash', 'a-nightheron', 'a-watson-wings', 'a-edgewater-hush', 'a-brickell-crawl', 'a-port-pier'],
  'miami-beach': ['a-sandbar', 'a-far-key', 'a-beach-mile'],
  'miami-north': ['a-sunchaser', 'a-tidewinder'],
  'miami-west': ['a-civic-ledger'],
  'miami-south': ['a-roads-end', 'a-hammock-trail'],
};

test('regions: each offers the adventures it holds (the table of PLAN_V2 3.2), every one in exactly one', () => {
  const seen = {};
  for (const [id, c] of allRegionCities()) {
    assert.deepEqual(c.adventures.map((a) => a.id), OFFERED[id], id);
    for (const a of c.adventures) seen[a.id] = (seen[a.id] || 0) + 1;
    // The rule itself: the definition's giver and steps 40 m inside the crop.
    for (const d of ADVENTURE_DEFS) {
      const holds = adventurePoints(d).every((p) => inRegion(regionFor(id), p.x, p.z, PLACE_MARGIN));
      assert.equal(adventureInRegion(d, regionFor(id)), holds, id + ' ' + d.id);
      assert.equal(c.adventures.some((a) => a.id === d.id), holds, id + ' offers ' + d.id + ' iff it holds it');
    }
  }
  assert.deepEqual(Object.keys(seen).sort(), ADVENTURE_IDS.slice().sort(), 'all sixteen are offered somewhere');
  assert.ok(Object.values(seen).every((n) => n === 1), 'and in one region only');
  assert.equal(adventureInRegion(ADVENTURE_DEFS[0], null), true, 'the whole box offers all');
});

test('regions: Roads End is re-anchored inside the South: giver, two clues and the reward garage', () => {
  const def = ADVENTURE_DEFS.find((d) => d.id === 'a-roads-end');
  assert.ok(adventurePoints(def).every((p) => inRegion(regionFor('miami-south'), p.x, p.z, PLACE_MARGIN)));
  assert.ok(!adventurePoints(def).every((p) => inRegion(regionFor('miami-west'), p.x, p.z, PLACE_MARGIN)));
  const c = regionCity('miami-south');
  const a = c.adventures.find((q) => q.id === 'a-roads-end');
  assert.equal(a.steps.length, 3);
  assert.equal(a.giver.type, 'sign');
  assert.equal(c.placeOf(a.steps[2].x, a.steps[2].z), 'The Roads');
  const g = c.garages.find((q) => q.id === 'g-roads');
  assert.ok(g && a.reward.garage === 'g-roads');
  for (const s of a.steps) assert.ok(Math.hypot(s.x - a.giver.x, s.z - a.giver.z) >= 150);
});

test('regions: every step is reachable in its mode, 150 m from the giver, inside its region; rewards are in the region', () => {
  for (const [id, c] of allRegionCities()) {
    const r = regionFor(id);
    const pierAt = (x, z) => c.piers.some((p) => x > p.x0 - 0.5 && x < p.x1 + 0.5 && z > p.z0 - 0.5 && z < p.z1 + 0.5);
    for (const a of c.adventures) {
      assert.ok(inRegion(r, a.giver.x, a.giver.z, 20), `${id} ${a.id} giver inside`);
      for (const [k, s] of a.steps.entries()) {
        assert.ok(inRegion(r, s.x, s.z, 20), `${id} ${a.id} step ${k} inside`);
        assert.ok(Math.hypot(s.x - a.giver.x, s.z - a.giver.z) >= 150, `${id} ${a.id} step ${k} too near the giver`);
        assert.ok(stepPlaceOk(c, s.x, s.z, s.mode), `${id} ${a.id} step ${k}`);
        if (s.mode === 'boat') assert.ok(c.shoreDist(s.x, s.z) < -6);
        else if (s.mode !== 'air') assert.ok(c.isLand(s.x, s.z) || pierAt(s.x, s.z));
      }
      if (a.reward.garage) assert.ok(c.garages.some((g) => g.id === a.reward.garage), `${id} ${a.id} reward garage built here`);
      if (a.reward.route) assert.ok(c.routes.some((q) => q.id === a.reward.route), `${id} ${a.id} reward route built here`);
      if (a.giver.type === 'garage') assert.ok(c.garages.some((g) => g.id === a.giver.garage), `${id} ${a.id} giver garage built here`);
      for (const n of a.needs) assert.ok(c.adventures.some((q) => q.id === n), `${id} ${a.id} needs ${n} here`);
    }
    // The locked routes of a region are the ones its adventures open.
    for (const q of c.routes) assert.ok(c.adventures.some((a) => a.reward.route === q.id), `${id} route ${q.id} has its adventure`);
  }
});

test('regions: the locked routes are cut to the region and deterministic', () => {
  const beach = regionCity('miami-beach');
  assert.deepEqual(beach.routes.map((q) => [q.id, q.locked]), [['street-x-beach', 'a-beach-mile']]);
  assert.deepEqual(buildRoutes(beach, ROUTE_SPECS), beach.routes);
  const dt = regionCity('miami-downtown');
  assert.deepEqual(dt.routes.map((q) => q.id), ['street-x-keys', 'boat-x-river']);
  // Same shape as the whole box's.
  const w = city.routes.find((q) => q.id === 'street-x-keys'), d = dt.routes.find((q) => q.id === 'street-x-keys');
  assert.deepEqual([d.type, d.laps, d.locked], [w.type, w.laps, w.locked]);
});
