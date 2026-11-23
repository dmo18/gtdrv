// Stunt jumps: ramp spots from the seeded city, the ramp surface, air
// time and flip measurement, medal thresholds, and the system end to
// end (a car off a ramp scores a medal; a roof landing scores nothing).
// docs/SPEC.md "Stunt jumps".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAirState, beginAir, stepAir, judgeLanding, fullTurns, stuntPoints, medalFor,
  STUNT_MEDALS, STUNT_SCORE, STUNT_G, MIN_AIR, medalRank,
} from '../src/core/stunt.js';
import { generateStuntSpots, makeSpot, rampHeight, rampAt, groundUnder, RAMP_LAND, RAMP_WATER } from '../src/world/stunts.js';
import { generateCity } from '../src/world/citygen.js';
import { createStunts } from '../src/systems/stunts.js';
import { createScore } from '../src/systems/score.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createEvents } from '../src/core/events.js';
import { defaultProgress } from '../src/core/save.js';

const DT = 1 / 60;

test('ramps come from the seeded city: quiet streets plus the airfield dock, the same every time', () => {
  const city = generateCity();
  const a = generateStuntSpots(city), b = generateStuntSpots(city);
  assert.deepEqual(a.map((s) => [s.id, s.x, s.z]), b.map((s) => [s.id, s.x, s.z]));
  assert.ok(a.length >= 5 && a.length <= 8, `count ${a.length}`);
  assert.equal(new Set(a.map((s) => s.id)).size, a.length, 'unique ids');
  for (const s of a) {
    assert.match(s.id, /^stunt_[a-z0-9_]+$/);
    if (s.water) assert.ok(!city.isLand(s.x, s.z), `${s.name} in the water`);
    else assert.ok(city.isLand(s.x, s.z), `${s.name} on land`);
    if (!s.water && s.id !== 'stunt_dock_kicker') assert.notEqual(city.districtOf(s.x, s.z), 'downtown');
  }
  assert.ok(a.some((s) => s.id === 'stunt_dock_splash' && s.water));
  assert.ok(a.some((s) => s.id === 'stunt_dock_kicker' && !s.water));
  // Street ramps are spread out.
  const street = a.filter((s) => !s.id.startsWith('stunt_dock'));
  for (let i = 0; i < street.length; i++) {
    for (let j = i + 1; j < street.length; j++) assert.ok(Math.hypot(street[i].x - street[j].x, street[i].z - street[j].z) >= 240);
  }
});

test('ramp surface: up, flat top, down; zero beside it', () => {
  const s = makeSpot('stunt_t', 'T', 10, 20, Math.PI / 2, RAMP_LAND, false);
  const H = RAMP_LAND.height;
  assert.equal(rampHeight(s, 10, 20), H);
  assert.equal(rampHeight(s, 10, 20 + s.half + 0.1), 0);
  assert.ok(Math.abs(rampHeight(s, 10, 20 - (RAMP_LAND.top / 2 + RAMP_LAND.slope / 2)) - H / 2) < 1e-9);
  assert.equal(rampHeight(s, 10 + RAMP_LAND.width / 2 + 0.1, 20), 0);
  assert.equal(rampAt([s], 10, 20, false), s);
  assert.equal(rampAt([s], 10, 20, true), null, 'land ramps are not water ramps');
  assert.equal(groundUnder([s], 50, 50, false), 0);
  const w = makeSpot('stunt_w', 'W', 0, 0, 0, RAMP_WATER, true);
  assert.equal(groundUnder([w], 0, 0, true), RAMP_WATER.height);
});

test('air time matches the ballistic flight; height and distance are measured', () => {
  const st = createAirState();
  const vy = 6, y0 = 1.5, vx = 20;
  beginAir(st, 0, y0, 0, vx, vy, 0, 0.2);
  while (st.y > 0) stepAir(st, DT);
  const want = (vy + Math.sqrt(vy * vy + 2 * STUNT_G * y0)) / STUNT_G;
  assert.ok(Math.abs(st.t - want) < 2 * DT, `air ${st.t} vs ${want}`);
  const r = judgeLanding(st);
  assert.ok(Math.abs(r.dist - vx * st.t) < 1e-6);
  assert.ok(Math.abs(r.height - (vy * vy) / (2 * STUNT_G)) < 0.05);
  assert.equal(r.flips, 0);
  assert.equal(r.rolls, 0);
  assert.ok(r.ok, 'hands off lands on the wheels');
});

test('flips and rolls are counted from the summed rotation (from 315 degrees)', () => {
  assert.equal(fullTurns(0), 0);
  assert.equal(fullTurns(Math.PI * 1.7), 0);
  assert.equal(fullTurns(Math.PI * 1.76), 1);
  assert.equal(fullTurns(-Math.PI * 2), 1);
  assert.equal(fullTurns(Math.PI * 4.1), 2);
  // Brake in the air: a backflip.
  const st = createAirState();
  beginAir(st, 0, 1.5, 0, 25, 9, 0, 0.24);
  let t = 0;
  while (st.y > 0) {
    stepAir(st, DT, t < 1.05 ? 1 : 0, 0);
    t += DT;
  }
  const r = judgeLanding(st);
  assert.equal(r.flips, 1, `turned ${st.turnP}`);
  assert.ok(r.ok, `landed upright (pitch ${st.pitch})`);
  // Steer in the air: a barrel roll, the other way counts too.
  const s2 = createAirState();
  beginAir(s2, 0, 1.5, 0, 25, 9, 0, 0.24);
  t = 0;
  while (s2.y > 0) {
    stepAir(s2, DT, 0, t < 1.0 ? -1 : 0);
    t += DT;
  }
  assert.equal(judgeLanding(s2).rolls, 1, `rolled ${s2.turnR}`);
});

test('medal thresholds are clear and ordered; bad landings and short hops score nothing', () => {
  assert.ok(STUNT_MEDALS.gold > STUNT_MEDALS.silver && STUNT_MEDALS.silver > STUNT_MEDALS.bronze && STUNT_MEDALS.bronze > 0);
  assert.equal(medalFor(STUNT_MEDALS.gold), 'gold');
  assert.equal(medalFor(STUNT_MEDALS.gold - 1), 'silver');
  assert.equal(medalFor(STUNT_MEDALS.silver), 'silver');
  assert.equal(medalFor(STUNT_MEDALS.silver - 1), 'bronze');
  assert.equal(medalFor(STUNT_MEDALS.bronze), 'bronze');
  assert.equal(medalFor(STUNT_MEDALS.bronze - 1), null);
  assert.equal(stuntPoints(1, 10, 1, 1, 0), STUNT_SCORE.perAirSecond + 10 * STUNT_SCORE.perMeter + STUNT_SCORE.perHeightMeter + STUNT_SCORE.perFlip);
  assert.equal(stuntPoints(MIN_AIR - 0.01, 30, 2, 1, 1), 0);
  assert.ok(medalRank('gold') > medalRank('silver') && medalRank('silver') > medalRank('bronze') && medalRank('bronze') > medalRank(null));
  const st = createAirState();
  beginAir(st, 0, 2, 0, 20, 5, 0, 0);
  while (st.y > 0) stepAir(st, DT);
  st.roll = Math.PI; // on the roof
  let r = judgeLanding(st);
  assert.ok(!r.ok && r.upsideDown && r.points === 0 && r.medal === null);
  st.roll = 0;
  r = judgeLanding(st, true); // wrecked
  assert.ok(!r.ok && r.points === 0);
  st.roll = 1.2; // on its side
  assert.ok(!judgeLanding(st).ok);
  st.roll = 0;
  st.crashed = true;
  assert.ok(!judgeLanding(st).ok);
});

function jumpGame(speed, brakeFor = 0) {
  const car = createVehicle('sedan', -60, 0, 0);
  const toasts = [];
  const game = {
    events: createEvents(), vehicles: [car], progress: defaultProgress(),
    player: { vehicle: car, x: 0, z: 0 }, input: { steer: 0, throttle: 0, brake: 0 },
    hud: { toast: (t) => toasts.push(t) }, time: 0,
  };
  game.score = createScore(game);
  const stunts = createStunts(game, { spots: [makeSpot('stunt_test_hop', 'Test Hop', 0, 0, 0)] });
  const seen = [];
  game.events.on('stunt', (e) => seen.push({ ...e }));
  car.vx = speed;
  car.speed = speed;
  let maxY = 0, airborne = false;
  for (let i = 0; i < 480; i++) {
    car.px = car.x;
    car.pz = car.z;
    const air = !!(car.air && car.air.on);
    if (air) airborne = true;
    game.input.brake = air && car.air.t < brakeFor ? 1 : 0;
    game.input.throttle = air ? 0 : 0.6;
    stepVehicle(car, game.input, DT, null);
    game.score.fixedUpdate(DT);
    stunts.fixedUpdate(DT);
    maxY = Math.max(maxY, car.y);
  }
  return { game, car, toasts, seen, maxY, airborne };
}

test('system: a fast car flies off a ramp, lands, and gets points, a medal and a toast', () => {
  const j = jumpGame(25);
  assert.ok(j.airborne && j.maxY > 3, `peak ${j.maxY}`);
  assert.equal(j.car.y, 0);
  assert.equal(j.car.airPitch, 0);
  assert.equal(j.seen.length, 1);
  const e = j.seen[0];
  assert.ok(e.ok && e.air > 1.2 && e.points > 0, JSON.stringify(e));
  assert.equal(j.game.progress.medals.stunt_test_hop, e.medal);
  assert.ok(e.medal === 'silver' || e.medal === 'gold');
  assert.equal(j.game.score.total, e.points, 'banked straight into the score (no generic airtime on top)');
  assert.equal(j.game.progress.score.courses.stunt_test_hop, e.points);
  assert.ok(j.toasts.some((t) => t.startsWith('Test Hop') && t.includes('+')), j.toasts.join(' | '));
});

test('system: a backflip over the ramp is gold; a medal is never downgraded', () => {
  const j = jumpGame(27, 1.0);
  assert.equal(j.seen[0].flips, 1);
  assert.equal(j.game.progress.medals.stunt_test_hop, 'gold');
});

test('system: landing on the roof gives no points and no medal', () => {
  const j = jumpGame(27, 9);
  assert.equal(j.seen.length, 1);
  assert.ok(!j.seen[0].ok);
  assert.equal(j.game.score.total, 0);
  assert.equal(j.game.progress.medals.stunt_test_hop, undefined);
  assert.ok(j.toasts.some((t) => /no points/.test(t)));
});

test('system: a slow car just drives over the ramp', () => {
  const car = createVehicle('sedan', -12, 0, 0);
  const game = { events: createEvents(), vehicles: [car], progress: defaultProgress(), player: { vehicle: null }, time: 0 };
  const stunts = createStunts(game, { spots: [makeSpot('stunt_slow', 'Slow', 0, 0, 0)] });
  car.vx = 4;
  let maxY = 0;
  for (let i = 0; i < 360; i++) {
    car.px = car.x;
    car.pz = car.z;
    stepVehicle(car, { throttle: 0.05, brake: 0, steer: 0 }, DT, null);
    if (car.speed > 4.5) car.vx = 4;
    stunts.fixedUpdate(DT);
    assert.ok(!(car.air && car.air.on), 'never airborne');
    maxY = Math.max(maxY, car.y);
  }
  assert.ok(Math.abs(maxY - RAMP_LAND.height) < 1e-9, 'rode over the top');
  assert.ok(car.x > 12 && car.y === 0 && !car.stuntRamp, 'back on the road');
});

// ---- Regions (docs/PLAN_V2.md 3.3): every region has two ramps; a region
// build leaves out a hand ramp its street cannot hold instead of throwing. ----
import { regionCity, allRegionCities } from './regionfixture.js';
import { placeRamps, generateRegionRamps } from '../src/world/stunts.js';
import { regionFor, inRegion } from '../src/world/regions.js';

const RAMPS = {
  'miami-downtown': ['stunt_wynwood_kicker', 'stunt_little_havana_hop', 'stunt_edgewater_launch', 'stunt_palm_island_skip', 'stunt_dock_kicker', 'stunt_dock_splash'],
  // 0.9.0 re-pin (deliberate): with the real street data the Beach's generated
  // ramp is a leap (stunt_miami_beach_leap), no longer the launch.
  'miami-beach': ['stunt_palm_island_skip', 'stunt_miami_beach_leap'],
  'miami-north': ['stunt_wynwood_kicker', 'stunt_edgewater_launch', 'stunt_dock_kicker', 'stunt_dock_splash'],
  // 0.9.0 re-pin (deliberate): the West's generated ramp follows the settled
  // lots (junction-band boundary cells are lots now), a Little Havana launch.
  'miami-west': ['stunt_little_havana_hop', 'stunt_little_havana_launch'],
  // 0.9.0 re-pin (deliberate): the South's two generated ramps follow the
  // settled lots too.
  'miami-south': ['stunt_bay_heights_hop', 'stunt_shenandoah_kicker'],
};

test('regions: every region has at least two ramps, on land or in the water, clear of buildings, inside the crop', () => {
  for (const [id, c] of allRegionCities()) {
    assert.deepEqual(c.rampSpots.map((s) => s.id), RAMPS[id], id);
    assert.ok(c.rampSpots.length >= 2, id);
    assert.equal(new Set(c.rampSpots.map((s) => s.id)).size, c.rampSpots.length, id + ' unique ids');
    for (const s of c.rampSpots) {
      assert.match(s.id, /^stunt_[a-z0-9_]+$/);
      assert.ok(inRegion(regionFor(id), s.x, s.z, 40), `${id} ${s.id} inside`);
      const hx = s.ax * s.slope * 2, hz = s.az * s.slope * 2;
      if (s.water) {
        assert.ok(c.shoreDist(s.x, s.z) < 0, `${id} ${s.name} in the water`);
      } else {
        assert.ok(c.isLand(s.x, s.z) && c.isLand(s.x + hx, s.z + hz) && c.isLand(s.x - hx, s.z - hz), `${id} ${s.name} on land`);
        assert.ok(!c.inBuilding(s.x, s.z, RAMP_LAND.width), `${id} ${s.name} clear of buildings`);
        if (s.id !== 'stunt_dock_kicker') assert.ok(c.onRoad(s.x, s.z) && c.onRoad(s.x + hx, s.z + hz) && c.onRoad(s.x - hx, s.z - hz), `${id} ${s.name} on a straight stretch of road`);
        assert.ok(rampAt([s], s.x, s.z, false) === s);
      }
      // No parked car stands on a street ramp.
      if (!s.water) for (const p of c.parkingSpots) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) >= s.r + 5.9, `${id} ${s.name}: a parked car on the ramp`);
    }
    // Street ramps keep apart (the generated ones by MIN_GAP, the hand ones are far apart).
    const street = c.rampSpots.filter((s) => !s.water && s.id !== 'stunt_dock_kicker');
    for (let i = 0; i < street.length; i++) {
      for (let j = i + 1; j < street.length; j++) assert.ok(Math.hypot(street[i].x - street[j].x, street[i].z - street[j].z) >= 240, `${id} ${street[i].id} vs ${street[j].id}`);
    }
  }
});

test('regions: the generated ramps are seeded, off the start and never replace a hand ramp', () => {
  const c = regionCity('miami-south');
  assert.deepEqual(generateRegionRamps(c, 2).map((s) => s.id), [], 'two already: nothing more');
  const spare = { ...c, rampSpots: [] };
  const a = generateRegionRamps(spare, 2), b = generateRegionRamps(spare, 2);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  for (const s of a) assert.ok(Math.hypot(s.x - c.spawn.x, s.z - c.spawn.z) >= 120, 'off the start place');
  // A different seed picks other streets.
  assert.notDeepEqual(generateRegionRamps(spare, 2, 1).map((s) => [s.x, s.z]), a.map((s) => [s.x, s.z]));
});

test('regions: a hand ramp whose street is not in the region is left out; the whole box still throws', () => {
  const west = regionCity('miami-west');
  const spec = [{ name: 'Nowhere Hop', street: 'No Such Street', x: -3000, z: 1000 }];
  assert.deepEqual(placeRamps(west, spec).map((s) => s.id), [], 'a region leaves it out (only the dock ramps, which West lacks)');
  const bare = { edges: [], nodes: [], isLand: () => true, shoreDist: () => 99 };
  assert.throws(() => placeRamps(bare, spec), /no straight stretch/);
});
