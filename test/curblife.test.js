// 0.15 roads WP4: static cars in the parking lanes, parking lots that read as
// lots (lighter tone, bay lines on top, a curb and a planting strip).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { onJunction } from '../src/world/junctions.js';
import { GUTTER, PARK_W } from '../src/world/roadprofile.js';
import { createParkedCurbField, CURB_MAX, CURB_STEP, COL_R, COL_MAX } from '../src/render/parkedfield.js';
import { createParkedCars, createCurbCarLayer, CURB_CAP } from '../src/systems/parked.js';
import { lotEdges, lotGround, drawLotFeatures, LOT_GROUND, EDGE_Y } from '../src/render/lotmesh.js';
import { dressLot } from '../src/world/lots.js';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import { makeFightGame } from './fightgame.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami-downtown.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data, { region: 'miami-downtown' });
const { x: sx, z: sz } = city.spawn;
const spotNear = (x, z, r) => city.parkingSpots.some((s) => Math.abs(s.x - x) < r && Math.abs(s.z - z) < r);

function edgeSide(x, z) {
  // The nearest street and the side (1 right, 0 left of a -> b) of a point.
  const out = [];
  city.edgesNear(x, z, 16, out);
  let best = null, bd = 1e9, side = 0, lat = 0;
  for (const i of out) {
    const e = city.edges[i], a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.length, (x - a.x) * e.ux + (z - a.z) * e.uz));
    const d = Math.hypot(x - a.x - e.ux * t, z - a.z - e.uz * t);
    if (d < bd) { bd = d; best = e; lat = -(x - a.x) * e.uz + (z - a.z) * e.ux; side = lat - (e.off || 0) > 0 ? 1 : 0; }
  }
  return { e: best, side, lat, d: bd };
}

test('curb field: cars only in parking lanes, clear of junctions, curb spots and each other', () => {
  const f = createParkedCurbField(city, { range: 150, spotNear });
  f.loadAll(sx, sz);
  assert.equal(f.pending(), 0);
  const cars = f.countNear(sx, sz, 150);
  assert.ok(cars > 40, `${cars} static curb cars near the start`);
  // Every car is inside the parking lane of its street's side.
  const n = f.update(sx, sz, 1, 0, sx, sz, CURB_MAX);
  assert.ok(n > 10 && n <= CURB_MAX, `${n} in view`);
  for (let i = 0; i < n; i++) {
    const { e, side, lat } = edgeSide(f.x[i], f.z[i]);
    assert.ok(e && (side ? e.parkR : e.parkL) > 0, `car ${i} is on a side with a parking lane`);
    const half = e.width / 2;
    const want = side ? half - GUTTER - PARK_W / 2 : -(half - GUTTER - PARK_W / 2);
    assert.ok(Math.abs(lat - (e.off || 0) - want) < 1.2, `car ${i} lateral ${lat.toFixed(2)} vs lane ${want.toFixed(2)}`);
    assert.ok(!onJunction(city.roadGeo, f.x[i], f.z[i]), `car ${i} is not on a junction`);
    assert.ok(!spotNear(f.x[i], f.z[i], 3.2), `car ${i} is not on a curb spot`);
    for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(f.x[i] - f.x[j], f.z[i] - f.z[j]) > 3.5, `cars ${i} and ${j} overlap`);
  }
});

test('curb field: deterministic, fills about 60 percent of the lane stations, capped, nearest first', () => {
  const a = createParkedCurbField(city, { spotNear }), b = createParkedCurbField(city, { spotNear });
  a.loadAll(sx, sz); b.loadAll(sx, sz);
  const na = a.update(sx, sz, 1, 0, sx, sz, 24), nb = b.update(sx, sz, 1, 0, sx, sz, 24);
  assert.equal(na, nb);
  assert.ok(na <= 24);
  for (let i = 0; i < na; i++) { assert.equal(a.x[i], b.x[i]); assert.equal(a.color[i], b.color[i]); assert.equal(a.spec[i], b.spec[i]); }
  for (let i = 1; i < na; i++) assert.ok(a.pri[i] >= a.pri[i - 1], 'by priority');
  // Share of the parking lane within 135 m held by a static car (live cars
  // stand on the curb spots on top of this).
  let lane = 0;
  for (const e of city.edges) {
    if (e.bridge || e.causeway || e.ped) continue;
    const s0 = city.nodes[e.a];
    for (let side = 0; side < 2; side++) {
      if (!((side ? e.parkR : e.parkL) > 0)) continue;
      for (let d = 0; d < e.length; d++) if (Math.hypot(s0.x + e.ux * d - sx, s0.z + e.uz * d - sz) < 135) lane++;
    }
  }
  const cars = a.countNear(sx, sz, 135);
  const spots = city.parkingSpots.filter((s) => !s.lot && Math.hypot(s.x - sx, s.z - sz) < 135).length;
  const share = ((cars + Math.min(40, spots)) * CURB_STEP) / lane;
  assert.ok(share >= 0.55, `static plus live cars hold ${(share * 100).toFixed(0)} % of the lane`);
  assert.ok(cars * CURB_STEP / lane < 0.8, 'never a solid wall of cars');
});

test('curb field: real vehicles keep their station empty; collision cars only near the player', () => {
  const f = createParkedCurbField(city, { spotNear });
  f.loadAll(sx, sz);
  const n0 = f.update(sx, sz, 1, 0, sx, sz, CURB_MAX);
  assert.ok(n0 > 0);
  // A car stopped on the first one's station.
  const blk = new Float32Array([f.x[0], f.z[0], 1, 0, 2.3, 0.9]);
  const x0 = f.x[0], z0 = f.z[0];
  f.update(sx, sz, 1, 0, sx, sz, CURB_MAX, blk, 1);
  for (let i = 0; i < f.n; i++) assert.ok(Math.hypot(f.x[i] - x0, f.z[i] - z0) > 1, 'the blocked station is empty');
  assert.ok(f.nCol > 0 && f.nCol <= COL_MAX);
  for (let i = 0; i < f.nCol; i++) assert.ok(Math.hypot(f.col[i * 3] - sx, f.col[i * 3 + 1] - sz) <= COL_R + 1e-3);
  // Far away from the player but looking at the street: drawn, no collision shape.
  f.update(sx, sz, 1, 0, sx + 2000, sz, CURB_MAX);
  assert.equal(f.nCol, 0);
});

test('curb field: loads a few street sides a step and gives its records back', () => {
  const f = createParkedCurbField(city, { spotNear });
  f.update(sx, sz, 1, 0, sx, sz, 24);
  const p0 = f.pending();
  assert.ok(p0 > 5, `${p0} street sides to load`);
  assert.equal(f.n, 0, 'nothing before the first step');
  f.step();
  assert.ok(f.pending() < p0 && f.pending() > 0, 'a step loads some, not all');
  while (f.pending()) f.step();
  f.update(sx + 3000, sz, 1, 0, sx + 3000, sz, 24);
  assert.ok(f.stats.released > 0);
});

test('curb car layer: two circles a car, tagged car, found by the collision world', () => {
  const col = createCollisionWorld();
  const layer = createCurbCarLayer();
  col.addLayer(layer);
  layer.set(new Float32Array([100, 200, 0, 140, 200, Math.PI / 2]), 2);
  assert.equal(layer.count, 4);
  assert.ok(layer.shapes.slice(0, 4).every((s) => s.tag === 'car' && !s.off));
  assert.ok(layer.shapes.slice(4).every((s) => s.off));
  // A circle pushed out of the first car.
  const r = col.resolveCircle(100, 200, 1, 0);
  assert.ok(r.hit, 'the car is solid');
  const free = col.resolveCircle(120, 200, 1, 0);
  assert.ok(!free.hit, 'nothing between the two');
  // A new set replaces the old one.
  layer.set(new Float32Array([300, 300, 0]), 1);
  assert.ok(!col.resolveCircle(100, 200, 1, 0).hit, 'the old car is gone');
  assert.ok(col.resolveCircle(300, 300, 1, 0).hit);
  layer.set(new Float32Array(0), 0);
  assert.ok(!col.resolveCircle(300, 300, 1, 0).hit);
});

test('parked system: the curb field feeds the drawn set and the collision layer', () => {
  const collision = createCollisionWorld();
  const g = makeFightGame({ city, collision, px: sx, pz: sz });
  g.clock = 13;
  g.kinds = { car: {}, boat: {}, plane: {}, heli: {}, tank: {} };
  const p = createParkedCars(g);
  assert.ok(p.curbField && p.carField && p.curbLayer);
  for (let i = 0; i < 300; i++) p.fixedUpdate(0.1);
  assert.ok(p.curbField.n > 0, `${p.curbField.n} curb statics`);
  assert.ok(p.curbField.n <= CURB_CAP[1]);
  assert.equal(p.carField.n, p.lotField.n + p.curbField.n);
  assert.ok(p.curbLayer.count > 0, 'collision cars stand near the player');
  // No static car stands where a live parked car does.
  for (const s of p.spots) {
    if (!s.vehicle) continue;
    for (let i = 0; i < p.curbField.n; i++) assert.ok(Math.hypot(p.curbField.x[i] - s.x, p.curbField.z[i] - s.z) > 3, 'a live curb car and a static one share a station');
  }
});

test('parking lot ground is a lighter, warmer tone than the road asphalt', () => {
  const roadAsphalt = 0x5a5d62;
  const c = LOT_GROUND.carpark.col;
  const lum = (h) => 0.3 * ((h >> 16) & 255) + 0.59 * ((h >> 8) & 255) + 0.11 * (h & 255);
  assert.ok(lum(c) > lum(roadAsphalt) + 40, 'lighter');
  assert.ok(((c >> 16) & 255) - (c & 255) > 20, 'warmer: red over blue');
});

const KEYS = ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand', 'paint', 'ao', 'props', 'solid', 'detail', 'glow', 'trees', 'treesDetail', 'plain'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};

test('parking lots: a curb and a planting strip toward the street, bay lines facing up', () => {
  const lots = city.lots.filter((l) => l.type === 'carpark').sort((a, b) => b.area - a.area);
  const lot = lots[0];
  const G = city.lotGrid;
  const i0 = Math.max(0, Math.floor((lot.x0 - G.x0) / G.cell) - 2), i1 = Math.min(G.w, Math.ceil((lot.x1 - G.x0) / G.cell) + 2);
  const j0 = Math.max(0, Math.floor((lot.z0 - G.z0) / G.cell) - 2), j1 = Math.min(G.h, Math.ceil((lot.z1 - G.z0) / G.cell) + 2);
  const B = builders();
  lotGround(city, B, i0, i1, j0, j1);
  lotEdges(city, B, i0, i1, j0, j1);
  // A green planting strip (grass builder) lies in a lot of this kind, at the edge height.
  let strips = 0, onEdge = 0;
  for (const mb of B.grass.map.values()) {
    for (let v = 0; v < mb.count; v += 4) {
      if (Math.abs(mb.pos[v * 3 + 1] - EDGE_Y) > 1e-6) continue;
      const x = (mb.pos[v * 3] + mb.pos[(v + 2) * 3]) / 2, z = (mb.pos[v * 3 + 2] + mb.pos[(v + 2) * 3 + 2]) / 2;
      const l = city.lotAt(x, z);
      if (l && l.type === 'carpark') strips++;
      const w = Math.abs(mb.pos[v * 3] - mb.pos[(v + 2) * 3]), h = Math.abs(mb.pos[v * 3 + 2] - mb.pos[(v + 2) * 3 + 2]);
      if (l && l.type === 'carpark' && (Math.abs(w - 1.0) < 1e-3 || Math.abs(h - 1.0) < 1e-3)) onEdge++;
    }
  }
  assert.ok(strips > 0, 'planting strips inside parking lots');
  assert.ok(onEdge > 0, 'one of them is the 1 m planting strip');
  // Bay lines wound as the road paint (negative area in x, z: the top face).
  const feats = dressLot(city, lot, []);
  const bay = feats.filter((f) => f.kind === 'bay');
  assert.ok(bay.length > 0);
  const P = builders();
  drawLotFeatures({ ...P, city, R: {}, DR: {}, props: P.props, solid: P.solid, detail: P.detail, paint: P.paint, sidewalk: P.sidewalk, ao: P.ao, glow: P.glow, plain: P.props, trees: P.plain, treesDetail: P.treesDetail },
    lot, bay, bay.length, { tree() {}, palm() {}, lamp() {}, bench() {}, bin() {}, bollard() {}, planter() {}, umbrella() {} });
  let quads = 0, up = 0;
  for (const mb of P.paint.map.values()) {
    const I = mb.idx;
    for (let t = 0; t + 5 < I.length; t += 6) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ax = mb.pos[a * 3], az = mb.pos[a * 3 + 2], bx = mb.pos[b * 3], bz = mb.pos[b * 3 + 2], cx = mb.pos[c * 3], cz = mb.pos[c * 3 + 2];
      quads++;
      // Counter-clockwise seen from above (y up, x east, z south) is negative in x, z.
      if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0) up++;
    }
  }
  assert.ok(quads > 5 && up === quads, `${up} of ${quads} bay line quads face up`);
});
