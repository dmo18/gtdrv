// The first view (docs/REVAMP.md 6.8): the start spot on the road network,
// the moving cars and parked cars in the counts, the 17:30 clear clock at a
// new start (and the time a Continue or a fixed Settings time keeps), the
// title camera shot and its blend to the chase camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity, MIAMI_SPOTS } from '../src/world/miami.js';
import { createRng } from '../src/core/rng.js';
import { createTraffic } from '../src/systems/traffic.js';
import { createParkedCars } from '../src/systems/parked.js';
import { createDayNight } from '../src/systems/daynight.js';
import { createTitleCam, titlePose, dollyAt, BLEND_S } from '../src/render/titlecam.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const sv = city.startView;

function fakeGame() {
  const g = {
    city, rng: createRng(42), vehicles: [], time: 0, clock: 9, quality: 1,
    player: { x: sv.spawn.x, z: sv.spawn.z, heading: sv.spawn.heading, vehicle: null },
    addVehicle(v) { this.vehicles.push(v); return v; },
    removeVehicle(v) { v.removed = true; this.vehicles = this.vehicles.filter((o) => o !== v); },
    events: { emit() {} },
  };
  return g;
}

// The camera cone as in test/world-density.test.js: 45 degrees half angle.
function coneOf() {
  const fx = Math.cos(sv.spawn.heading), fz = Math.sin(sv.spawn.heading);
  const cx = sv.spawn.x - fx * sv.camera.back - fz * sv.camera.side, cz = sv.spawn.z - fz * sv.camera.back + fx * sv.camera.side;
  const cosHalf = Math.cos((45 * Math.PI) / 180);
  return (x, z, R) => {
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    return d > 1 && d <= R && (dx * fx + dz * fz) / d > cosHalf;
  };
}

test('start view spot is on the core road network', () => {
  const sp = sv.spawn;
  assert.ok(city.inCore(sp.x, sp.z), 'inside the core');
  let best = Infinity, name = '';
  for (const e of city.edges) {
    if (e.bridge || e.causeway) continue;
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.length, (sp.x - a.x) * e.ux + (sp.z - a.z) * e.uz));
    const d = Math.hypot(a.x + e.ux * t - sp.x, a.z + e.uz * t - sp.z);
    if (d < best) { best = d; name = e.name; }
  }
  assert.ok(best < e0width(), `${best.toFixed(1)} m from a road`);
  assert.equal(name, MIAMI_SPOTS.startView.spawn.street);
  assert.ok(city.isGround(sp.x, sp.z), 'on ground');
  assert.deepEqual(city.startView.camera, MIAMI_SPOTS.startView.camera);
  function e0width() { return 8; }
});

test('traffic places the start cars on the street ahead, within the 6.8 counts', () => {
  const g = fakeGame();
  const t = createTraffic(g);
  const n = t.seedStart(sv.traffic);
  assert.ok(n >= 4 && n <= sv.traffic, `${n} cars placed`);
  assert.equal(g.vehicles.length, n);
  const inCone = coneOf();
  let seen = 0;
  for (const v of g.vehicles) {
    assert.ok(v.traffic && v.ai, 'a moving traffic car');
    assert.ok(Math.hypot(v.x - sv.spawn.x, v.z - sv.spawn.z) < 120);
    if (inCone(v.x, v.z, 120)) seen++;
  }
  assert.ok(seen >= 4, `${seen} moving cars in the cone`);
  // The same seed gives the same cars.
  const g2 = fakeGame();
  createTraffic(g2).seedStart(sv.traffic);
  assert.deepEqual(g2.vehicles.map((v) => [Math.round(v.x * 10), Math.round(v.z * 10)]), g.vehicles.map((v) => [Math.round(v.x * 10), Math.round(v.z * 10)]));
});

test('parked cars fill the start kerb spots first, at least 6 in the cone', () => {
  const g = fakeGame();
  const p = createParkedCars(g);
  const firstOther = p.spots.findIndex((s) => !s.start);
  assert.ok(p.spots.slice(firstOther).every((s) => !s.start), 'start spots come first');
  p.fixedUpdate(1 / 60);
  const inCone = coneOf();
  let filled = 0, start = 0;
  for (const s of p.spots) {
    if (!s.vehicle || !inCone(s.x, s.z, 80)) continue;
    filled++;
    if (s.start) start++;
  }
  console.log(`# parked cars in the cone within 80 m: ${filled} (${start} on start kerb spots), start spots total ${p.spots.filter((s) => s.start).length}`);
  assert.ok(filled >= 6 && filled <= 40 && start >= 1, `${filled} parked cars in the cone, ${start} on start spots`);
});

test('a new start is at 17:30 clear; Continue and a fixed Settings time keep theirs', () => {
  const mk = (settings) => {
    const g = { clock: 9, events: { emit() {} }, progress: { settings } };
    const dn = createDayNight(g);
    return { g, dn };
  };
  // New start: 17:30 clear for the title, and it stays when play begins.
  let { g, dn } = mk({});
  dn.setWeather('rain', true);
  assert.ok(dn.enterTitle(sv));
  assert.equal(g.clock, 17.5);
  assert.equal(g.weather.name, 'clear');
  for (let i = 0; i < 600; i++) dn.fixedUpdate(1 / 60);
  assert.equal(g.clock, 17.5, 'held while the title shows');
  dn.leaveTitle('start');
  assert.equal(g.clock, 17.5);
  assert.equal(g.weather.name, 'clear');
  assert.ok(!g.timeLocked);
  dn.fixedUpdate(1 / 60);
  assert.ok(g.clock > 17.5, 'runs on after Start');
  // Continue: the time from before the title.
  ({ g, dn } = mk({}));
  g.clock = 8;
  dn.enterTitle(sv);
  dn.leaveTitle('continue');
  assert.equal(g.clock, 8);
  assert.ok(!g.timeLocked);
  // A time fixed in Settings wins at Start.
  ({ g, dn } = mk({ liveTime: false, timeOfDay: 22 }));
  assert.equal(g.clock, 22);
  dn.enterTitle(sv);
  assert.equal(g.clock, 17.5);
  dn.leaveTitle('start');
  assert.equal(g.clock, 22);
  assert.ok(g.timeLocked);
});

test('title shot: behind the spawn, toward the south kerb, dolly eases and returns', () => {
  const out = {};
  titlePose(sv, 0, false, out);
  const c = sv.camera, sp = sv.spawn;
  const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
  assert.ok(Math.abs(out.x - (sp.x - fx * c.back - fz * c.side)) < 1e-9 && Math.abs(out.z - (sp.z - fz * c.back + fx * c.side)) < 1e-9);
  assert.ok(out.z > sp.z, 'toward the south kerb');
  assert.equal(out.y, c.height);
  assert.ok(Math.abs(out.lx - (sp.x + fx * c.lookAhead)) < 1e-9 && out.ly === c.lookHeight);
  const period = (2 * c.dolly) / c.dollySpeed;
  assert.ok(Math.abs(dollyAt(c, period / 2) - c.dolly) < 1e-9);
  assert.ok(Math.abs(dollyAt(c, period)) < 1e-9);
  assert.ok(dollyAt(c, period / 4) > 0 && dollyAt(c, period / 4) < c.dolly);
  titlePose(sv, period / 2, true, out);
  assert.ok(Math.abs(out.x - (sp.x - fx * c.back - fz * c.side)) < 1e-9, 'reduced motion does not move');
});

test('title camera blends to the chase camera in 1.2 s', () => {
  const cam = {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lookAt() {}, fov: 55, updateProjectionMatrix() {},
  };
  const chase = { ray: { x: 100, y: 3, z: 50, dx: 1, dy: 0, dz: 0 } };
  const tc = createTitleCam(cam, chase);
  assert.ok(tc.start(sv, false));
  const place = () => { cam.position.x = 100; cam.position.y = 3; cam.position.z = 50; };
  place();
  tc.apply(0, 1 / 60); // the title pose
  const p0 = titlePose(sv, 0, false, {});
  assert.ok(Math.abs(cam.position.x - p0.x) < 1e-9 && Math.abs(cam.position.z - p0.z) < 1e-9);
  let done = false;
  assert.ok(tc.blend(() => { done = true; }));
  let t = 0;
  while (!done && t < 3) {
    place(); // the chase camera places itself each frame
    tc.apply(0, 1 / 60);
    t += 1 / 60;
  }
  assert.ok(done && t >= BLEND_S - 0.05 && t <= BLEND_S + 0.05, `blend took ${t.toFixed(2)} s`);
  assert.equal(tc.active, false);
});
