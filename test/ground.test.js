// The one ground (docs/PLAN_V3.md 2.2 item 5, section 6 item 5):
// groundAt gives road 0, sidewalk and median +0.15, open land 0, a sea
// floor that slopes from the water line; a car's wheels sit on it (every
// wheel bottom within -2 cm and +3 cm of groundAt after 0.5 s, at 2,000
// seeded land points), the body never sinks below it, a curb crossing
// is a jolt, and a beach is waded into until the car bogs down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGround, groundFn, CURB_H, SEA_LEVEL, SEA_FLOOR, attachGround } from '../src/world/ground.js';
import { createVehicle, stepVehicle, wheelBottomY, CLEARANCE, BOG_DEPTH } from '../src/entities/vehicle.js';
import { createWalker, stepWalker } from '../src/entities/onfoot.js';
import { createMiamiCity } from '../src/world/miami.js';
import { generateCity } from '../src/world/citygen.js';
import { createRng } from '../src/core/rng.js';
import { createCollisionWorld, fillEdgeCollision } from '../src/world/collision.js';

const DT = 1 / 60, MPH = 2.23694;
const city = createMiamiCity(JSON.parse(fs.readFileSync(new URL('../src/world/data/miami-downtown.json', import.meta.url), 'utf8')), { region: 'miami-downtown' });
const g = createGround(city);
const nodes = city.nodes;

// Wheel ground points of a car (as vehicle.js followGround).
function wheelPoint(v, i) {
  const s = v.spec, c = Math.cos(v.heading), sn = Math.sin(v.heading);
  const hb = s.wheelBase / 2, ht = Math.max(0.3, s.width / 2 - 0.15);
  const lo = i < 2 ? hb : -hb, la = i % 2 === 0 ? ht : -ht;
  return [v.x + c * lo - sn * la, v.z + sn * lo + c * la];
}
function worstWheel(v, gf) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4; i++) {
    const [x, z] = wheelPoint(v, i);
    const d = wheelBottomY(v, i) - gf(x, z);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

test('groundAt: road 0, sidewalk +0.15, land beyond 0, the sea floor below the water; pure and repeatable', () => {
  let checked = 0;
  for (const e of city.edges) {
    if (e.bridge || e.causeway || e.length < 40) continue;
    const a = nodes[e.a];
    const mx = a.x + e.ux * e.length / 2, mz = a.z + e.uz * e.length / 2;
    const rx = -e.uz, rz = e.ux;
    if (city.mainShore(mx, mz) < 30) continue;
    // Only edges whose sides are clear of other roads.
    // (1 m past the right curb, which lies `off` right of the node line on
    // a tight divided pair: 0.13.7 drops the parking lane against the
    // partner, so such a half is narrower and sits further right.)
    const side = e.width / 2 + (e.off || 0) + 1;
    const clear = (k) => g.surfaceAt(mx + rx * k * (e.width / 2 + 8), mz + rz * k * (e.width / 2 + 8)) === 0;
    if (!clear(1) || !clear(-1)) continue;
    assert.equal(g.groundAt(mx, mz) - (e.median > 0 ? g.groundAt(mx, mz) : 0), 0, 'the road');
    assert.equal(g.groundAt(mx + rx * side, mz + rz * side), CURB_H, 'the sidewalk');
    assert.equal(g.groundAt(mx + rx * (e.width / 2 + 8), mz + rz * (e.width / 2 + 8)), 0, 'land past the sidewalk');
    if (++checked >= 200) break;
  }
  assert.ok(checked >= 100, `${checked} edges`);
  // Out at sea: below the water, never below the floor.
  let sea = 0;
  const rng = createRng(5);
  const B = city.bounds;
  for (let k = 0; k < 4000 && sea < 200; k++) {
    const x = rng.range(B.x0, B.x1), z = rng.range(B.z0, B.z1);
    const d = city.shoreDist(x, z);
    if (d > -4) continue;
    const y = g.groundAt(x, z);
    assert.ok(y < SEA_LEVEL && y >= SEA_FLOOR, `sea floor ${y}`);
    sea++;
  }
  assert.ok(sea > 50);
  // The same answer from a fresh ground, whatever was asked before.
  const h = createGround(city);
  const rr = createRng(9);
  for (let k = 0; k < 500; k++) {
    const x = rr.range(B.x0, B.x1), z = rr.range(B.z0, B.z1);
    assert.equal(h.groundAt(x, z), g.groundAt(x, z));
  }
});

test('2,000 seeded land points: after 0.5 s every wheel bottom is within -2 and +3 cm of groundAt, the body never under it', () => {
  const rng = createRng(20261123);
  const B = city.bounds;
  const world = { city, time: 0 };
  const gf = groundFn(city);
  let n = 0, onCurb = 0, worstLo = 0, worstHi = 0;
  for (let k = 0; k < 40000 && n < 2000; k++) {
    const x = rng.range(B.x0, B.x1), z = rng.range(B.z0, B.z1);
    if (!(city.shoreDist(x, z) > 8)) continue;
    const v = createVehicle('sedan', x, z, rng.range(-Math.PI, Math.PI));
    for (let i = 0; i < 30; i++) {
      stepVehicle(v, null, DT, world);
      const [lo] = worstWheel(v, gf);
      assert.ok(lo >= -0.03, `a wheel ${(-lo * 100).toFixed(1)} cm under at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      assert.ok(v.y >= gf(v.x, v.z) - CLEARANCE - 1e-9, 'body under the ground');
    }
    const [lo, hi] = worstWheel(v, gf);
    worstLo = Math.min(worstLo, lo);
    worstHi = Math.max(worstHi, hi);
    assert.ok(lo >= -0.02 && hi <= 0.03, `wheels ${lo.toFixed(3)} to ${hi.toFixed(3)} at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    for (let i = 0; i < 4; i++) if (gf(...wheelPoint(v, i)) > 0.1) { onCurb++; break; }
    n++;
  }
  assert.equal(n, 2000);
  assert.ok(onCurb > 100, `${onCurb} cars with a wheel on a sidewalk`);
  console.log(`# 2,000 points: wheels ${(worstLo * 100).toFixed(1)} to ${(worstHi * 100).toFixed(1)} cm from groundAt, ${onCurb} with a wheel up a curb`);
});

test('20 routes across curbs: no wheel more than 3 cm under, a jolt on every curb, about 5 percent speed lost per curb at 20 mph', () => {
  const rng = createRng(77);
  const gf = groundFn(city);
  const world = { city, time: 0 };
  let routes = 0;
  for (let k = 0; k < 5000 && routes < 20; k++) {
    const e = city.edges[rng.int(0, city.edges.length - 1)];
    if (e.bridge || e.causeway || e.length < 50 || e.width > 16) continue;
    const a = nodes[e.a];
    const mx = a.x + e.ux * e.length / 2, mz = a.z + e.uz * e.length / 2;
    const rx = -e.uz, rz = e.ux;
    const off = e.width / 2 + 1.0;
    // Start on one sidewalk, cross to the other; both sides clear of other roads.
    const sx = mx - rx * off, sz = mz - rz * off, ex = mx + rx * off, ez = mz + rz * off;
    if (gf(sx, sz) !== CURB_H || gf(ex, ez) !== CURB_H) continue;
    if (g.surfaceAt(mx + rx * (off + 4), mz + rz * (off + 4)) !== 0 || g.surfaceAt(mx - rx * (off + 6), mz - rz * (off + 6)) !== 0) continue;
    if (city.mainShore(mx, mz) < 40) continue;
    const hd = Math.atan2(rz, rx);
    const v = createVehicle('sedan', sx - rx * 2, sz - rz * 2, hd);
    const sp0 = 20 / MPH;
    v.vx = rx * sp0;
    v.vz = rz * sp0;
    stepVehicle(v, null, DT, world); // settle on the sidewalk
    const jolts0 = v.jolts;
    const crossing = e.width + 6;
    const steps = Math.ceil(crossing / sp0 / DT);
    for (let i = 0; i < steps; i++) {
      stepVehicle(v, null, DT, world);
      const [lo] = worstWheel(v, gf);
      assert.ok(lo >= -0.03, `route ${routes}: wheel ${(-lo * 100).toFixed(1)} cm under`);
    }
    // Down off the first curb and up the second: jolts at both axles.
    assert.ok(v.jolts - jolts0 >= 2, `route ${routes}: ${v.jolts - jolts0} jolts`);
    routes++;
  }
  assert.equal(routes, 20);
  // Speed lost up one curb at 20 mph, coasting, against the same run on flat ground.
  const flat = { nodes: [], edges: [], shoreDist: () => 500 };
  const step = { nodes: [{ id: 0, x: 0, z: -50, hx: 0, hz: 0 }, { id: 1, x: 0, z: 50, hx: 0, hz: 0 }], edges: [{ id: 0, a: 0, b: 1, width: 10, sidewalk: 3 }], shoreDist: () => 500 };
  const runAt = (c) => {
    const v = createVehicle('sedan', -12, 0, 0);
    v.vx = 20 / MPH;
    for (let i = 0; i < 40; i++) stepVehicle(v, null, DT, { city: c });
    return { sp: Math.hypot(v.vx, v.vz), jolts: v.jolts };
  };
  const a = runAt(flat), b = runAt(step);
  const loss = 1 - b.sp / a.sp;
  console.log(`# one curb at 20 mph: ${b.jolts} jolts, ${(loss * 100).toFixed(1)} % speed lost`);
  assert.ok(b.jolts >= 2, 'front and rear axle');
  assert.ok(loss > 0.03 && loss < 0.07, `loss ${loss}`);
});

test('a walker and a ped stand on the same ground', () => {
  const e = city.edges.find((q) => !q.bridge && q.length > 60 && q.width < 16 && city.mainShore(nodes[q.a].x, nodes[q.a].z) > 50);
  const a = nodes[e.a];
  const x = a.x + e.ux * 30 - e.uz * (e.width / 2 + 1), z = a.z + e.uz * 30 + e.ux * (e.width / 2 + 1);
  const w = createWalker(x, z, 0);
  stepWalker(w, { moveX: 0, moveY: 0 }, DT, { city });
  assert.equal(w.y, groundFn(city)(w.x, w.z));
});

test('a beach: the car wades in, slows and bogs down by 0.5 m of water', () => {
  const isl = generateCity();
  attachGround(isl);
  // The edge lines: a beach has no wall, and the land net sits 3 m out.
  const col = createCollisionWorld();
  fillEdgeCollision(isl, col);
  // A point on the island's beach shore (west side), heading out to sea.
  let start = null;
  for (let a = Math.PI * 0.8; a < Math.PI * 1.2 && !start; a += 0.01) {
    const dx = Math.cos(a), dz = Math.sin(a);
    for (let r = 100; r < 2000; r += 2) {
      const x = dx * r, z = dz * r;
      if (isl.shoreDist(x, z) < 12 && isl.shoreDist(x, z) > 8 && isl.districtOf(x, z) === 'beach') { start = { x, z, h: Math.atan2(dz, dx) }; break; }
    }
  }
  assert.ok(start, 'a beach');
  const v = createVehicle('sedan', start.x, start.z, start.h);
  v.vx = Math.cos(start.h) * 10;
  v.vz = Math.sin(start.h) * 10;
  const world = { city: isl, collision: col, time: 0 };
  for (let i = 0; i < 60 * 8; i++) stepVehicle(v, { throttle: 1 }, DT, world);
  const depth = SEA_LEVEL - isl.groundAt(v.x, v.z);
  assert.ok(Math.hypot(v.vx, v.vz) < 0.3, `stopped (${Math.hypot(v.vx, v.vz).toFixed(2)} m/s)`);
  assert.ok(depth > 0.3 && depth < BOG_DEPTH + 0.25, `bogged at ${depth.toFixed(2)} m of water`);
  // It can back out.
  for (let i = 0; i < 60 * 3; i++) stepVehicle(v, { brake: 1 }, DT, world);
  assert.ok(SEA_LEVEL - isl.groundAt(v.x, v.z) < depth, 'backs out to shallower water');
});
