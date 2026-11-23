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

test('parked cars fill the start curb spots first, at least 6 in the cone', () => {
  const g = fakeGame();
  const p = createParkedCars(g);
  const firstOther = p.spots.findIndex((s) => !s.start);
  assert.ok(p.spots.slice(firstOther).every((s) => !s.start), 'start spots come first');
  // The start fill is spread over the first second (two spawns a step).
  for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60);
  const inCone = coneOf();
  let filled = 0, start = 0;
  for (const s of p.spots) {
    if (!s.vehicle || !inCone(s.x, s.z, 80)) continue;
    filled++;
    if (s.start) start++;
  }
  console.log(`# parked cars in the cone within 80 m: ${filled} (${start} on start curb spots), start spots total ${p.spots.filter((s) => s.start).length}`);
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

test('title shot: behind the spawn, toward the south curb, dolly eases and returns', () => {
  const out = {};
  titlePose(sv, 0, false, out);
  const c = sv.camera, sp = sv.spawn;
  const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
  assert.ok(Math.abs(out.x - (sp.x - fx * c.back - fz * c.side)) < 1e-9 && Math.abs(out.z - (sp.z - fz * c.back + fx * c.side)) < 1e-9);
  assert.ok(out.z > sp.z, 'toward the south curb');
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
// post on the near sidewalk in front of the chase camera at the start
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
  assert.deepEqual(hits, [], 'title frame center is clear');
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
// street ahead and parked cars on the curb.
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
    for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60); // the start fill takes the first second
    let near = 0;
    for (const s of p.spots) if (s.vehicle && Math.hypot(s.x - v.spawn.x, s.z - v.spawn.z) < 80) near++;
    assert.ok(near >= 4, `${id}: ${near} parked cars within 80 m`);
  }
});

// ---- First person (docs/PLAN_V3.md 2.8, check 13) ----
// Every car class: the cockpit eye in the cabin box and clear of the body
// shell; no body, interior or neighbor triangle inside the near-plane
// pyramid in a full-lock turn at 30 mph beside a parked car, at every look
// direction; the hood fills 10 to 20 percent of the frame in the Hood
// view; the wheel follows steer; the drag look reaches 110 degrees and
// returns in 0.4 s.
const FP = await (async () => {
  const THREE = await import('three');
  const { VEHICLE_SPECS, createVehicle } = await import('../src/entities/vehicle.js');
  const { createVehicleMesh, updateVehicleMesh } = await import('../src/render/vehiclemesh.js');
  const ci = await import('../src/render/carinterior.js');
  const { createChaseCamera } = await import('../src/render/chasecam.js');
  return { THREE, VEHICLE_SPECS, createVehicle, createVehicleMesh, updateVehicleMesh, ci, createChaseCamera };
})();
const fpCars = Object.values(FP.VEHICLE_SPECS).filter((s) => !s.kind || s.kind === 'car');
// Bodies with no hood in front of the windshield (one-box van, cab-over
// trucks) and the steep-nosed hatchback, all three retired by PLAN_V3 2.6,
// have nothing to fill the Hood view.
const hasHood = (cab, spec) => cab.hoodLength >= 0.9 && cab.hoodY > 0.3 && spec.body !== 'hatch';

function placed(id, x, z, heading) {
  const v = FP.createVehicle(id, x, z, heading);
  v.mesh = FP.createVehicleMesh(v.spec);
  FP.updateVehicleMesh(v.mesh, v, 1);
  return v;
}
// World-space triangles of every drawn mesh under a root (layer mask not 0).
function worldTris(root) {
  root.updateMatrixWorld(true);
  const out = [];
  const p = new FP.THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.layers.mask === 0 || o.material.colorWrite === false) return;
    let vis = true;
    for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
    if (!vis || o.isInstancedMesh) return;
    const g = o.geometry, pa = g.attributes.position, ix = g.index ? g.index.array : null;
    const n = ix ? ix.length : pa.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pa, ix ? ix[i] : i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    out.push(arr);
  });
  return out;
}
// Does any triangle reach into the pyramid between the eye and the near
// plane (what the near plane would cut away)? Sampled on each triangle.
function nearHits(cam, lists) {
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse.elements;
  const tv = Math.tan((cam.fov * Math.PI) / 360), th = tv * cam.aspect, n = cam.near;
  const tx = (x, y, z, k) => inv[k] * x + inv[k + 4] * y + inv[k + 8] * z + inv[k + 12];
  let hits = 0;
  const S = 8;
  for (const arr of lists) {
    for (let t = 0; t < arr.length; t += 9) {
      const az = tx(arr[t], arr[t + 1], arr[t + 2], 2), bz = tx(arr[t + 3], arr[t + 4], arr[t + 5], 2), cz = tx(arr[t + 6], arr[t + 7], arr[t + 8], 2);
      if (Math.min(-az, -bz, -cz) > n || Math.max(-az, -bz, -cz) < 0) continue;
      const ax = tx(arr[t], arr[t + 1], arr[t + 2], 0), bx = tx(arr[t + 3], arr[t + 4], arr[t + 5], 0), cx = tx(arr[t + 6], arr[t + 7], arr[t + 8], 0);
      const ay = tx(arr[t], arr[t + 1], arr[t + 2], 1), by = tx(arr[t + 3], arr[t + 4], arr[t + 5], 1), cy = tx(arr[t + 6], arr[t + 7], arr[t + 8], 1);
      for (let i = 0; i <= S; i++) {
        for (let j = 0; j <= S - i; j++) {
          const u = i / S, w = j / S, v = 1 - u - w;
          const d = -(az * u + bz * w + cz * v);
          if (d <= 1e-4 || d >= n) continue;
          const x = ax * u + bx * w + cx * v, y = ay * u + by * w + cy * v;
          if (Math.abs(x) <= d * th && Math.abs(y) <= d * tv) hits++;
        }
      }
    }
  }
  return hits;
}

test('first person: every car eye is in the cabin box, >= 0.15 m from the body shell, on the left', () => {
  for (const spec of fpCars) {
    const mesh = FP.createVehicleMesh(spec);
    const g = FP.ci.carGeometry(mesh);
    const cab = FP.ci.measureCabin(spec, g.body, g.glass);
    const eye = FP.ci.eyePoint(spec, cab);
    const c = FP.ci.bodyClearance(g.body, eye.x, eye.y, eye.z, true);
    if (spec.eye && !eye.fromSpec) console.log(`# ${spec.id}: spec eye ${JSON.stringify(spec.eye)} is outside the cabin, the default is used`);
    assert.ok(FP.ci.inCabin(cab, eye), `${spec.id}: eye in the cabin box`);
    assert.ok(c >= FP.ci.MIN_CLEAR, `${spec.id}: ${c.toFixed(3)} m from the body`);
    assert.ok(eye.z < 0, `${spec.id}: left seat`);
  }
});

test('first person: no own-body, interior or neighbor triangle nearer than the near plane in a full-lock turn at 30 mph beside a parked car', () => {
  const ids = fpCars.map((s) => s.id);
  let checked = 0;
  for (const id of ids) {
    const spec = FP.VEHICLE_SPECS[id];
    // Our car pulls out beside a parked car on its left and turns right at full lock.
    const v = placed(id, 0, 0, 0);
    const parked = placed('sedan', 0.2, -(spec.width / 2 + FP.VEHICLE_SPECS.sedan.width / 2 + 0.35), 0.05);
    const cam = new FP.THREE.PerspectiveCamera(62, 915 / 412, 0.5, 1800);
    const chase = FP.createChaseCamera(cam);
    chase.setMode('car');
    const R = spec.wheelBase / Math.tan(spec.steerMax || 0.48);
    const spd = 13.4;
    for (const view of ['Cockpit', 'Hood']) {
      chase.setView(view);
      v.x = v.px = 0; v.z = v.pz = 0; v.heading = v.pheading = 0;
      const t = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: spd, height: 1.2, vehicle: v };
      FP.updateVehicleMesh(v.mesh, v, 1);
      chase.snap(t);
      for (let i = 0; i < 48; i++) {
        v.px = v.x; v.pz = v.z; v.pheading = v.heading;
        v.heading += (spd / R) / 60;
        v.x += Math.cos(v.heading) * spd / 60;
        v.z += Math.sin(v.heading) * spd / 60;
        v.steer = 1;
        v.speed = spd;
        v.roll = 0.075; // body lean at its limit
        v.pitch = 0.02;
        FP.updateVehicleMesh(v.mesh, v, 1);
        t.x = v.x; t.z = v.z; t.heading = v.heading;
        // A look around on some frames: ahead, both sides, up and down.
        const look = [[0, 0], [-110, 0], [110, 0], [-60, 25], [60, -25], [0, -25]][i % 6];
        const input = { lookX: 0, lookY: 0, lookHeld: true };
        const f = chase.getFirst();
        input.lookX = (look[0] - f.yawDeg) / (0.006 * 180 / Math.PI);
        input.lookY = -(look[1] - f.pitchDeg) / (0.006 * 180 / Math.PI);
        chase.update(t, 1 / 60, input, null);
        if (i % 4 !== 3) continue;
        const own = worldTris(v.mesh);
        const other = worldTris(parked.mesh);
        const hits = nearHits(cam, own) + nearHits(cam, other);
        assert.equal(hits, 0, `${id} ${view} frame ${i} look ${look}: ${hits} samples inside the near plane`);
        // The horizon stays level while the body rolls.
        const right = new FP.THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        assert.ok(Math.abs(right.y) < 1e-6, `${id} ${view}: level horizon`);
        checked++;
      }
    }
    chase.setView('Chase');
    chase.update({ x: v.x, z: v.z, y: 0, heading: v.heading, speed: 0, vehicle: v }, 1 / 60, null, null);
  }
  assert.ok(checked > fpCars.length * 10);
  // The check itself sees clipping: the cockpit with a 0.8 m near plane cuts the dash and the wheel.
  const v = placed('sedan', 0, 0, 0);
  const cam = new FP.THREE.PerspectiveCamera(78, 915 / 412, 0.5, 1800);
  const chase = FP.createChaseCamera(cam);
  chase.setMode('car');
  chase.setView('Cockpit');
  chase.snap({ x: 0, z: 0, y: 0, heading: 0, speed: 0, vehicle: v });
  cam.near = 0.8;
  cam.updateProjectionMatrix();
  assert.ok(nearHits(cam, worldTris(v.mesh)) > 50, 'the near-plane check finds a cut interior');
});

test('first person: the hood fills 10 to 20 percent of the frame in the Hood view at the three phone sizes', () => {
  const p = new FP.THREE.Vector3();
  for (const spec of fpCars) {
    const v = placed(spec.id, 0, 0, 0);
    const g = FP.ci.carGeometry(v.mesh);
    const cab = FP.ci.measureCabin(spec, g.body, g.glass);
    if (!hasHood(cab, spec)) continue;
    const shell = FP.ci.frontShell(g.body, cab);
    for (const [w, h] of [[915, 412], [780, 360], [748, 360]]) {
      const cam = new FP.THREE.PerspectiveCamera(62, w / h, 0.5, 1800);
      const chase = FP.createChaseCamera(cam);
      chase.setMode('car');
      chase.setView('Hood');
      chase.snap({ x: 0, z: 0, y: 0, heading: 0, speed: 0, vehicle: v });
      cam.updateMatrixWorld(true);
      v.mesh.updateMatrixWorld(true);
      const m = v.mesh.userData.body.matrixWorld;
      // The highest screen row the hood reaches (rows are what the player sees).
      let top = -1;
      const pa = shell.attributes.position, ix = shell.index.array;
      for (let i = 0; i < ix.length; i++) {
        p.fromBufferAttribute(pa, ix[i]).applyMatrix4(m).project(cam);
        if (p.z < 1 && p.z > -1 && Math.abs(p.x) <= 1 && p.y > top) top = p.y;
      }
      const share = (Math.min(1, top) + 1) / 2;
      assert.ok(share >= 0.1 && share <= 0.2, `${spec.id} at ${w}x${h}: hood ${(share * 100).toFixed(1)} percent of the frame`);
    }
  }
});

test('first person: the cockpit wheel follows steer; look drag reaches 110 degrees and returns in 0.4 s', () => {
  const v = placed('sedan', 0, 0, 0);
  const cam = new FP.THREE.PerspectiveCamera(62, 915 / 412, 0.5, 1800);
  const chase = FP.createChaseCamera(cam);
  chase.setMode('car');
  chase.setView('Cockpit');
  const t = { x: 0, z: 0, y: 0, heading: 0, speed: 5, vehicle: v };
  chase.snap(t);
  const it = chase.getFirst().interior;
  assert.ok(it, 'interior attached in the cockpit');
  for (const s of [0, 0.3, -0.7, 1, -1]) {
    v.steer = s;
    chase.update(t, 1 / 60, null, null);
    assert.equal(it.interior.state.wheelDeg, s * 90);
  }
  const input = { lookX: 4000, lookY: -4000, lookHeld: true };
  chase.update(t, 1 / 60, input, null);
  assert.equal(chase.getFirst().yawDeg, 110);
  assert.equal(chase.getFirst().pitchDeg, 25);
  input.lookHeld = false;
  for (let i = 0; i < 24; i++) chase.update(t, 1 / 60, input, null);
  assert.ok(Math.abs(chase.getFirst().yawDeg) < 1 && Math.abs(chase.getFirst().pitchDeg) < 1, `returned (${chase.getFirst().yawDeg.toFixed(2)})`);
  // Leaving the cockpit puts the car back as it was.
  chase.setView('Chase');
  assert.equal(chase.getFirst().interior, null);
  let hidden = 0;
  v.mesh.traverse((o) => { if (o.isMesh && o.layers.mask === 0) hidden++; });
  assert.equal(hidden, 0);
});
