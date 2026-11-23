// The first view (docs/REVAMP.md 6.8): the start spot on the road network,
// the moving cars and parked cars in the counts, the 17:30 clear clock at a
// new start (and the time a Continue or a fixed Settings time keeps), the
// title camera shot and its blend to the chase camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity, MIAMI_SPOTS } from '../src/world/miami.js';
import { dressLot } from '../src/world/lots.js';
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

// docs/PLAN_V1.md W2b (K4): nothing stands in the middle of the title
// frame. No prop (street furniture, lamp, tree, signal, lot dressing other
// than flat ground marks) within 40 m of the title camera inside a cone of
// 8 degrees round its view line, at any point of the dolly; and no trunk or
// post on the near pavement in front of the chase camera at the start
// (within 12 m, inside the 49 degree half width of the 915 by 412 view).
test('title and start frames: no prop in the 8 degree cone within 40 m; no post right in front of the start camera', () => {
  const sp = sv.spawn;
  const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
  const items = [];
  for (const f of city.furniture) items.push([`furniture ${f.type}`, f.x, f.z]);
  for (const p of city.props) items.push([`prop ${p.type}`, p.x, p.z]);
  for (const s of city.signals) items.push(['signal', s.x, s.z]);
  const FLAT = new Set(['drive', 'bay', 'path', 'towel']);
  for (const l of city.lots) {
    if (Math.hypot((l.x0 + l.x1) / 2 - sp.x, (l.z0 + l.z1) / 2 - sp.z) > 160) continue;
    for (const f of dressLot(city, l, [])) {
      if (FLAT.has(f.kind)) continue;
      const hl = (f.l || 0) / 2, ca = Math.cos(f.heading || 0), sa = Math.sin(f.heading || 0);
      items.push([`lot ${l.type} ${f.kind}`, f.x, f.z]);
      if (hl > 0) items.push([`lot ${l.type} ${f.kind} end`, f.x + ca * hl, f.z + sa * hl], [`lot ${l.type} ${f.kind} end`, f.x - ca * hl, f.z - sa * hl]);
    }
  }
  assert.ok(items.length > 100, `${items.length} props round the start`);
  const tan8 = Math.tan((8 * Math.PI) / 180);
  const hits = [];
  const pose = {};
  const period = (2 * sv.camera.dolly) / sv.camera.dollySpeed;
  for (let k = 0; k <= 8; k++) {
    titlePose(sv, (period / 2) * (k / 8), false, pose);
    // Taken flat (the bearing only, whatever the height): stricter than the
    // real cone, which a low bollard under the view line would miss.
    const ax = pose.lx - pose.x, az = pose.lz - pose.z, al = Math.hypot(ax, az);
    for (const [name, x, z] of items) {
      const dx = x - pose.x, dz = z - pose.z;
      const along = (dx * ax + dz * az) / al, lat = Math.abs(dx * az - dz * ax) / al;
      if (along > 0 && Math.hypot(dx, dz) <= 40 && lat < along * tan8) hits.push(`${name} at ${along.toFixed(1)} m, ${lat.toFixed(1)} m off the line (dolly ${k}/8)`);
    }
  }
  assert.deepEqual(hits, [], 'title frame centre is clear');
  // Start frame: the chase camera 7.5 m behind the spawn.
  const cx = sp.x - fx * 7.5, cz = sp.z - fz * 7.5;
  const cos49 = Math.cos((49 * Math.PI) / 180);
  const near = [];
  const TALL = /tree|palm|lamp|signal|sign|shelter|umbrella/;
  for (const [name, x, z] of items) {
    if (!TALL.test(name)) continue;
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d < 12 && dx * fx + dz * fz > d * cos49) near.push(`${name} ${d.toFixed(1)} m`);
  }
  assert.deepEqual(near, [], 'no trunk or post right in front of the start camera');
});

// ---- Every region has a start view (docs/PLAN_V2.md 3.3) ----
// Built like Downtown's: the spawn on a named street 300 m or more from
// every crop edge, the same camera and 17:30 clear sky, moving cars on the
// street ahead and parked cars on the kerb.
import { regionCity, NEW_REGIONS } from './regionfixture.js';
import { regionFor, START_EDGE } from '../src/world/regions.js';
import { REGION_STARTS } from '../src/world/regioncontent.js';

function regionGame(c) {
  const v = c.startView;
  return {
    city: c, rng: createRng(42), vehicles: [], time: 0, clock: 9, quality: 1,
    player: { x: v.spawn.x, z: v.spawn.z, heading: v.spawn.heading, vehicle: null },
    addVehicle(car) { this.vehicles.push(car); return car; },
    removeVehicle(car) { car.removed = true; this.vehicles = this.vehicles.filter((o) => o !== car); },
    events: { emit() {} },
  };
}

test('each other region: a start view on its named street, 300 m from every edge, with the 6.8 look', () => {
  for (const id of NEW_REGIONS) {
    const c = regionCity(id), r = regionFor(id), v = c.startView, sp = v.spawn;
    assert.ok(v, id);
    assert.equal(sp.street, REGION_STARTS[id].street, id);
    assert.deepEqual([sp.x, sp.z, sp.heading], [c.spawn.x, c.spawn.z, c.spawn.heading], id);
    assert.deepEqual(v.camera, MIAMI_SPOTS.startView.camera, id);
    assert.equal(v.time, 17.5);
    assert.equal(v.weather, 'clear');
    assert.ok(v.traffic >= 6 && v.parked >= 6, id);
    let best = Infinity, name = '';
    for (const e of c.edges) {
      if (e.bridge || e.causeway) continue;
      const a = c.nodes[e.a];
      const t = Math.max(0, Math.min(e.length, (sp.x - a.x) * e.ux + (sp.z - a.z) * e.uz));
      const d = Math.hypot(a.x + e.ux * t - sp.x, a.z + e.uz * t - sp.z);
      if (d < best) { best = d; name = e.name; }
    }
    assert.ok(best < 8, `${id}: ${best.toFixed(1)} m from a road`);
    assert.equal(name, REGION_STARTS[id].street, id);
    assert.ok(c.isGround(sp.x, sp.z), id + ' on ground');
    for (const d of [sp.x - r.crop.x0, r.crop.x1 - sp.x, sp.z - r.crop.z0, r.crop.z1 - sp.z]) assert.ok(d >= START_EDGE, id);
  }
});

test('each other region: traffic and parked cars fill the start view', () => {
  for (const id of NEW_REGIONS) {
    const c = regionCity(id), v = c.startView;
    const g = regionGame(c);
    const n = createTraffic(g).seedStart(v.traffic);
    assert.ok(n >= 3 && n <= v.traffic, `${id}: ${n} cars placed`);
    for (const car of g.vehicles) assert.ok(Math.hypot(car.x - v.spawn.x, car.z - v.spawn.z) < 120, id);
    const g2 = regionGame(c);
    const p = createParkedCars(g2);
    p.fixedUpdate(1 / 60);
    let near = 0;
    for (const s of p.spots) if (s.vehicle && Math.hypot(s.x - v.spawn.x, s.z - v.spawn.z) < 80) near++;
    assert.ok(near >= 4, `${id}: ${near} parked cars within 80 m`);
  }
});
