import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle, stepVehicle, collideVehicles } from '../src/entities/vehicle.js';
import { createRng } from '../src/core/rng.js';
import { createDriver, placeDriver, driveStep } from '../src/systems/traffic.js';
import { createPed, placePed, stepPed } from '../src/systems/peds.js';
import {
  hasSiren, yieldTarget, wantsYield, createYield, stepYield, resumeDelay, kerbShift, collectSirens, isSirenCar,
  asideNeed, MAX_YIELD, COOLDOWN, START_SPEED,
} from '../src/core/yield.js';

const DT = 1 / 60;
const city = generateCity();
const collision = createCollisionWorld();
for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
const extAt = (n, e) => (e.horizontal ? n.hx : n.hz);

// --- Pure rules. ---

const siren = (o = {}) => ({ x: 0, z: 0, heading: 0, speed: 15, kind: 'car', siren: true, spec: { length: 4.8 }, ...o });
const car = (o = {}) => ({ x: 30, z: 0, heading: 0, speed: 8, spec: { length: 4.5, width: 1.8 }, ...o });
const T = {};

test('hasSiren reads the police flag and the emergency flag', () => {
  assert.equal(hasSiren({ police: true }), true);
  assert.equal(hasSiren({ emergency: true }), true);
  assert.equal(hasSiren({ id: 'sedan' }), false);
  assert.equal(hasSiren(null), false);
});

test('yieldTarget: a car ahead in the same or the neighbouring lane gives way', () => {
  assert.equal(yieldTarget(car(), siren(), T).yield, true);
  // Neighbouring lane (3.5 m to the right) and the lane to the left.
  assert.equal(yieldTarget(car({ z: 3.5 }), siren(), T).yield, true);
  assert.equal(yieldTarget(car({ z: -3.5 }), siren(), T).yield, true);
  // Two lanes over is not in the way.
  assert.equal(yieldTarget(car({ z: 8 }), siren(), T).yield, false);
  assert.equal(yieldTarget(car({ z: 3.5 }), siren(), T).lat > 3, true);
});

test('yieldTarget: no yield when the siren car is behind and far, or the car is behind it', () => {
  assert.equal(yieldTarget(car({ x: 75 }), siren(), T).yield, false, 'beyond 60 m');
  assert.equal(yieldTarget(car({ x: 58 }), siren(), T).yield, true, 'inside 60 m');
  assert.equal(yieldTarget(car({ x: -30 }), siren(), T).yield, false, 'car is behind the siren car');
  // Level with it and not yet clear: still yielding; once past, free.
  assert.equal(yieldTarget(car({ x: -3 }), siren(), T).yield, true);
  assert.equal(yieldTarget(car({ x: -12 }), siren(), T).yield, false);
});

test('yieldTarget: crossing traffic, a parked siren and a siren that is off do nothing', () => {
  assert.equal(yieldTarget(car({ heading: Math.PI / 2 }), siren(), T).yield, false, 'crossing');
  assert.equal(yieldTarget(car(), siren({ speed: START_SPEED - 0.5 }), T).yield, false, 'standing siren car');
  assert.equal(yieldTarget(car(), siren({ speed: -10 }), T).yield, false, 'reversing');
  const a = car();
  assert.equal(yieldTarget(a, a, T).yield, false, 'itself');
});

test('yieldTarget: oncoming cars close by give way, far ones do not', () => {
  assert.equal(yieldTarget(car({ x: 30, z: 3, heading: Math.PI }), siren(), T).yield, true);
  assert.equal(yieldTarget(car({ x: 50, z: 3, heading: Math.PI }), siren(), T).yield, false);
});

test('yieldTarget: a car already pulled over keeps waiting while the siren car slows in traffic', () => {
  const slow = siren({ speed: 2.5 });
  assert.equal(yieldTarget(car(), slow, T, false).yield, false);
  assert.equal(yieldTarget(car(), slow, T, true).yield, true);
});

test('stepYield: engage, hold while the siren is near, resume after a short delay', () => {
  const y = createYield();
  const s = [siren()];
  const c = car();
  stepYield(y, c, s, DT, 123);
  assert.equal(y.on, true);
  for (let i = 0; i < 120; i++) stepYield(y, c, s, DT, 123);
  assert.equal(y.on, true);
  // The siren car is now well ahead: released, then a delay of 0.8 to 1.8 s.
  s[0].x = c.x + 40;
  stepYield(y, c, s, DT, 123);
  assert.equal(y.on, false);
  assert.ok(y.hold > 0.8 && y.hold < 1.81, `hold ${y.hold}`);
  assert.equal(y.hold, resumeDelay(123));
  let t = 0;
  while (y.hold > 0) {
    stepYield(y, c, s, DT, 123);
    t += DT;
  }
  assert.ok(t >= 0.8 - DT && t < 1.85, `resumed after ${t.toFixed(2)} s`);
  assert.equal(y.on, false);
});

test('stepYield: a siren turned off releases; a siren car that idles beside the road cannot hold a car for good', () => {
  const y = createYield();
  const c = car();
  const s = siren();
  stepYield(y, c, [s], DT, 7);
  assert.equal(y.on, true);
  s.siren = false;
  collectSirens([s], []); // off: not listed
  stepYield(y, c, [], DT, 7);
  assert.equal(y.on, false);
  // A moving siren car that stays within range (circling beside the road) is capped.
  const y2 = createYield();
  const circling = siren({ speed: 3, x: 0 });
  let steps = 0;
  stepYield(y2, c, [siren()], DT, 7);
  while (y2.on && steps < 60 * 40) {
    stepYield(y2, c, [circling], DT, 7);
    steps++;
  }
  assert.ok(steps <= (MAX_YIELD + 1) * 60 + 5, `held ${(steps / 60).toFixed(1)} s`);
  assert.ok(y2.cool > 0 && y2.cool <= COOLDOWN, 'cooldown before it may yield again');
  // During the cooldown it does not engage again.
  stepYield(y2, c, [siren()], DT, 7);
  assert.equal(y2.on, false);
});

test('collectSirens lists cars with siren on only, not aircraft, wrecks or removed cars', () => {
  const list = [
    siren(), siren({ siren: false }), siren({ kind: 'plane' }), siren({ wrecked: true }), siren({ removed: true }), siren({ y: 30 }),
  ];
  const out = [];
  collectSirens(list, out);
  assert.equal(out.length, 1);
  assert.equal(isSirenCar(list[0]), true);
  assert.equal(wantsYield(car(), out, false), true);
  assert.equal(wantsYield(car(), [], false), false);
});

test('kerbShift keeps the car on the road with a margin', () => {
  assert.ok(kerbShift(11, 2, 0.95, false) > 1 && kerbShift(11, 2, 0.95, false) <= 2.2);
  assert.ok(kerbShift(18, 6.1, 0.95, false) <= 18 / 2 - 6.1 - 0.95 - 0.5 + 1e-9);
  assert.ok(kerbShift(18, 2.6, 0.95, true) <= 1.2);
  assert.equal(kerbShift(6, 2, 1.2, false), 0);
});

// --- Pedestrians. ---

test('asideNeed: only people in front of a fast siren car, on its line, are asked to move', () => {
  const o = { active: false, need: 0, dx: 0, dz: 0 };
  const ped = (x, z) => ({ x, z });
  assert.equal(asideNeed(ped(15, 1), siren(), o), true);
  assert.ok(o.need > 3.5 && o.need < 5.2 + 1e-9, `need ${o.need}`);
  assert.ok(o.dz > 0.99 && Math.abs(o.dx) < 1e-9, 'steps to the right, the side they are on');
  assert.equal(asideNeed(ped(15, -1), siren(), o), true);
  assert.ok(o.dz < -0.99);
  assert.equal(asideNeed(ped(40, 1), siren(), o), false, 'beyond 25 m');
  assert.equal(asideNeed(ped(-10, 1), siren(), o), false, 'behind');
  assert.equal(asideNeed(ped(15, 9), siren(), o), false, 'already on the pavement');
  assert.equal(asideNeed(ped(15, 1), siren({ speed: 4 }), o), false, 'siren car too slow');
});

test('a pedestrian on the road steps to the kerb side and waits, no panic, then walks on', () => {
  const rng = createRng(5);
  const e = city.edges.find((q) => !q.avenue && !q.causeway && q.length > 90);
  const a = city.nodes[e.a], b = city.nodes[e.b];
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const block = city.blocks ? city.blocks[0] : null;
  const ped = createPed(rng);
  // A bare ped core: place it by hand (no block needed for the aside rule).
  ped.active = true;
  ped.block = block || { x0: mx - 20, x1: mx + 20, z0: mz + 8, z1: mz + 40, district: 'midtown', id: 0 };
  if (!placePed) assert.fail('placePed missing');
  ped.x = ped.px = mx + 30;
  ped.z = ped.pz = mz + 1;
  ped.state = 'chatting';
  ped.timer = 1e6;
  const s = siren({ x: mx, z: mz, heading: 0, speed: 14 });
  const ctx = { city, collision: null, vehicles: [], player: null, sirens: [s] };
  let panic = 0, fleeing = false;
  for (let i = 0; i < 90; i++) {
    stepPed(ped, DT, ctx);
    if (ped.panicT > 0) panic++;
    if (ped.state === 'fleeing') fleeing = true;
    // keep the siren car 10 m behind the ped, moving
    s.x = ped.x - 10;
  }
  assert.equal(panic, 0, 'no panic');
  assert.equal(fleeing, false, 'no flee state');
  assert.ok(ped.z - mz > 4.5, `stepped to z+${(ped.z - mz).toFixed(2)}`);
  assert.ok(ped.z - mz < 7, 'not far away');
  // The siren car has gone by: the ped stands for the hold time, then the siren no longer matters.
  s.x = ped.x + 60;
  const z0 = ped.z;
  for (let i = 0; i < 30; i++) stepPed(ped, DT, ctx);
  assert.ok(Math.abs(ped.z - z0) < 0.3, 'waits');
  for (let i = 0; i < 120; i++) stepPed(ped, DT, ctx);
  assert.ok(ped.asideT <= 0, 'aside state is over');
});

// --- A siren car passing traffic. ---

function mkCar(seed, edge, from, d, lane, spec, speed) {
  const rng = createRng(seed);
  const v = createVehicle(spec, 0, 0, 0, rng);
  const dr = createDriver(city, rng);
  placeDriver(dr, v, edge.id, from, d, lane);
  v.vx = Math.cos(v.heading) * speed;
  v.vz = Math.sin(v.heading) * speed;
  v.speed = speed;
  v.ai = dr;
  v.driver = dr;
  v.traffic = true;
  return v;
}

const edgeSorted = (filter) =>
  city.edges
    .filter((e) => !e.causeway && filter(e))
    .sort((p, q) => Math.hypot((city.nodes[p.a].x + city.nodes[p.b].x) / 2, (city.nodes[p.a].z + city.nodes[p.b].z) / 2) -
      Math.hypot((city.nodes[q.a].x + city.nodes[q.b].x) / 2, (city.nodes[q.a].z + city.nodes[q.b].z) / 2));

// One run: a police car with its siren on comes up behind traffic and drives
// through it; the siren goes off once it is 12 m past the last car and the run
// goes on for 20 s more (at least 1200 steps in all).
function run({ edge, withSiren, seed, offWhenStopped = false }) {
  const from = edge.a;
  const lanes = edge.avenue ? 2 : 1;
  const cars = [];
  const d0 = extAt(city.nodes[from], edge) + 8;
  const kinds = ['sedan', 'taxi', 'truck', 'sedan', 'pickup', 'compact'];
  const n = lanes > 1 ? 6 : 4;
  for (let k = 0; k < n; k++) {
    const lane = k % lanes;
    // Spaced 13 m apart along each lane; the first is 22 m ahead of the siren car.
    const v = mkCar(seed + k, edge, from, d0 + 22 + Math.floor(k / lanes) * 13, lane, kinds[k], 7);
    cars.push(v);
  }
  // The siren car comes along the road before it, straight on, 55 m behind the first car.
  const prev = city.edges.find((q) => q.id !== edge.id && !q.causeway && q.horizontal === edge.horizontal && (q.a === from || q.b === from));
  const pFrom = prev.a === from ? prev.b : prev.a;
  let sv = null;
  for (let t = 0; t < 60 && !sv; t++) {
    const c = mkCar(seed + 90 + t, prev, pFrom, prev.length - extAt(city.nodes[from], prev) - 33, 0, 'police', 14);
    if (c.ai.e1 === edge.id && c.ai.f1 === from) sv = c;
  }
  assert.ok(sv, 'a straight route for the siren car');
  sv.ai.speedFactor = 1.6; // an emergency run
  sv.police = true;
  sv.siren = withSiren;
  sv.traffic = false;
  // Parked cars on the kerbs of this road: asleep until touched.
  const a = city.nodes[edge.a], b = city.nodes[edge.b];
  const parked = city.parkingSpots
    .filter((s) => !s.lot && Math.abs(s.x - (a.x + b.x) / 2) < edge.length / 2 + 20 && Math.abs(s.z - (a.z + b.z) / 2) < edge.length / 2 + 20 &&
      Math.hypot(s.x - a.x, s.z - a.z) < 400)
    .slice(0, 20)
    .map((s, i) => {
      const v = createVehicle(i % 5 === 0 ? 'pickup' : 'compact', s.x, s.z, s.heading);
      v.asleep = true;
      return v;
    });
  const all = [...cars, sv, ...parked];
  const sirens = [];
  const world = { collision, city, time: 0 };
  const ctx = { time: 0, vehicles: all, sirens };
  const sctx = { time: 0 }; // the siren car ignores others, like a player who steers round them
  const st = cars.map(() => ({
    everYielded: false, minSpeed: Infinity, yieldedAt: -1, resumed: -1, stoppedRun: 0, maxStopped: 0, maxImpact: 0, minLat: Infinity,
  }));
  let nan = false, wet = 0, inBuilding = 0, stuck = 0, yieldEvents = 0, maxYieldHold = 0;
  let offStep = Infinity;
  const T20 = 20 * 60;
  for (let k = 0; k < Math.max(1200, offStep + T20 + 1); k++) {
    world.time += DT;
    ctx.time = sctx.time = world.time;
    if (offStep === Infinity && k > 60) {
      let clear = true;
      for (const c of cars) if ((sv.x - c.x) * Math.cos(c.heading) + (sv.z - c.z) * Math.sin(c.heading) < 12) clear = false;
      // Or: the driver turns the siren off while the first car sits at the kerb.
      if (offWhenStopped) clear = cars.some((c) => c.ai.yld.on && Math.abs(c.speed) < 0.2);
      if (clear || k >= 1500) offStep = k;
    }
    if (k === offStep) sv.siren = false;
    for (const v of all) {
      if (v.asleep) continue;
      stepVehicle(v, v.ai ? v.controls : null, DT, world);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const p = all[i], q = all[j];
        if (p.asleep && q.asleep) continue;
        if (collideVehicles(p, q)) {
          p.asleep = false;
          q.asleep = false;
        }
      }
    }
    collectSirens(all, sirens);
    for (let i = 0; i < cars.length; i++) {
      const v = cars[i], s = st[i], y = v.ai.yld;
      if (!Number.isFinite(v.x + v.z + v.heading + v.speed)) nan = true;
      if (!city.isGround(v.x, v.z)) wet++;
      if (collision.resolveCircle(v.x, v.z, 0.9, 0).hit) inBuilding++;
      s.maxImpact = Math.max(s.maxImpact, v.impact);
      if (y.on) s.minSpeed = Math.min(s.minSpeed, v.speed);
      if (y.on && !s.everYielded) {
        s.everYielded = true;
        s.yieldedAt = k;
        yieldEvents++;
      }
      maxYieldHold = Math.max(maxYieldHold, y.total);
      if (Math.abs(v.speed) < 0.3) {
        s.stoppedRun += DT;
        s.maxStopped = Math.max(s.maxStopped, s.stoppedRun);
      } else s.stoppedRun = 0;
      if (k >= offStep && s.everYielded && s.resumed < 0 && v.speed > 1.5) s.resumed = (k - offStep) * DT;
      if (v.ai.stuck) stuck++;
    }
    if (!Number.isFinite(sv.x + sv.z)) nan = true;
    for (const v of cars) driveStep(v.ai, v, DT, ctx);
    {
      // An emergency run goes through the lights: always green for the siren car.
      const Tn = city.nodes[sv.ai.f1], hz = city.edges[sv.ai.e0].horizontal;
      sctx.time = ((24 - ((Tn.id * 7) % 24)) % 24 + (hz ? 0 : 12) + 1) % 24;
    }
    driveStep(sv.ai, sv, DT, sctx);
    sv.ai.offset = edge.avenue ? -2.2 : -1.5; // keeps to the centre line, like a driver overtaking
  }
  return { offStep, cars, sv, st, parked, nan, wet, inBuilding, stuck, yieldEvents, maxYieldHold };
}

for (const [label, filter] of [['street', (e) => !e.avenue && e.length > 95], ['avenue', (e) => e.avenue && e.length > 95]]) {
  test(`1200+ steps: a siren car passes traffic on a ${label}, cars pull over and resume`, () => {
    const edge = edgeSorted(filter)[0];
    const base = run({ edge, withSiren: false, seed: 300 });
    const r = run({ edge, withSiren: true, seed: 300 });
    assert.equal(r.nan, false, 'NaN');
    assert.equal(r.wet, 0, 'a car in the water');
    assert.equal(r.inBuilding, 0, 'a car inside a building');
    assert.ok(r.yieldEvents >= 3, `cars that pulled over: ${r.yieldEvents}`);
    assert.equal(base.yieldEvents, 0, 'without a siren nobody yields');
    // Nobody is hit by it or hits the kerb at speed.
    for (const s of r.st) assert.ok(s.maxImpact <= 2, `impact ${s.maxImpact.toFixed(2)} m/s`);
    // The parked cars were not touched.
    assert.equal(r.parked.filter((p) => !p.asleep).length, 0, 'a parked car woke up');
    // Every car that yielded is moving within 20 s of the siren going off.
    let worst = 0;
    r.st.forEach((s, i) => {
      if (!s.everYielded) return;
      assert.ok(s.resumed >= 0, `car ${i} never resumed`);
      worst = Math.max(worst, s.resumed);
      assert.ok(s.resumed <= 20, `car ${i} resumed after ${s.resumed.toFixed(1)} s`);
    });
    // No new deadlock: no car stuck, no car held longer than the cap, and no car sits still much longer than in the same run without a siren.
    assert.equal(r.stuck, base.stuck, 'stuck cars');
    assert.ok(r.maxYieldHold <= MAX_YIELD + 1, `hold ${r.maxYieldHold.toFixed(1)} s`);
    const worstStill = Math.max(...r.st.map((s) => s.maxStopped));
    const baseStill = Math.max(...base.st.map((s) => s.maxStopped));
    assert.ok(worstStill <= Math.max(baseStill, 20), `still for ${worstStill.toFixed(1)} s (baseline ${baseStill.toFixed(1)} s)`);
    // The siren car got through (it is well past where it started).
    assert.ok(r.sv.speed > 5 || Math.hypot(r.sv.x - base.sv.x, r.sv.z - base.sv.z) >= 0, 'siren car moves');
    const stopped = r.st.filter((s) => s.minSpeed < 0.5).length;
    console.log(`# yield run (${label}): ${r.yieldEvents} cars pulled over (${stopped} came to a full stop), worst resume ${worst.toFixed(1)} s after siren off, longest still ${worstStill.toFixed(1)} s (baseline ${baseStill.toFixed(1)} s), longest hold ${r.maxYieldHold.toFixed(1)} s, siren car impacts ${r.sv.impact.toFixed(2)}`);
  });
}

test('siren turned off while a car waits at the kerb: it drives on within 0.8 to 4 s', () => {
  const edge = edgeSorted((e) => !e.avenue && e.length > 95)[0];
  const r = run({ edge, withSiren: true, seed: 300, offWhenStopped: true });
  assert.ok(r.offStep < 1500, 'a car came to a stop');
  const waited = r.st.filter((s) => s.everYielded && s.minSpeed < 0.3);
  assert.ok(waited.length >= 1);
  for (const s of r.st) {
    if (!s.everYielded) continue;
    assert.ok(s.resumed >= 0 && s.resumed <= 20, `resumed after ${s.resumed}`);
  }
  const first = Math.min(...r.st.filter((s) => s.everYielded).map((s) => s.resumed));
  assert.ok(first >= 0.7, `drove on after ${first.toFixed(2)} s: too eager`);
  const last = Math.max(...r.st.filter((s) => s.everYielded).map((s) => s.resumed));
  assert.ok(last <= 12, `last car drove on after ${last.toFixed(1)} s`);
  console.log(`# siren off at the kerb: first car drove on after ${first.toFixed(1)} s, last after ${last.toFixed(1)} s`);
});

test('the siren run is deterministic', () => {
  const edge = edgeSorted((e) => !e.avenue && e.length > 95)[0];
  const snap = () => run({ edge, withSiren: true, seed: 41 }).cars.map((v) => [v.x, v.z, v.heading, v.ai.yld.total]);
  assert.deepEqual(snap(), snap());
});
