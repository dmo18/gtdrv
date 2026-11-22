// The lazy lot layer of the collision world (world/collision.js,
// attachLotCollision): a collision cell gets its lot shapes the first time
// a query touches it, as a pure function of the city. Whatever cells were
// touched before, and in whatever order, every query answers the same,
// and a full sweep holds exactly the shapes of the eager fill.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity, MIAMI_CROP } from '../src/world/miami.js';
import {
  createCollisionWorld, fillCollision, fillLotCollision, attachLotCollision, createLotLayer, LOT_SHAPE_REACH,
} from '../src/world/collision.js';
import { lotDressCache, dressLot } from '../src/world/lots.js';
import { createRng } from '../src/core/rng.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data, { crop: MIAMI_CROP });
const CELL = 32;
const cellOf = (v) => Math.floor(v / CELL);
// A shape's values without the per-query scratch.
const val = (s) => JSON.stringify(s, (k, x) => (k === 'stamp' ? undefined : x));
const listVal = (list) => list.map(val).join('|');

// Every cell some lot shape covers, from the eager fill.
const eager = createCollisionWorld();
const eagerShapes = fillLotCollision(city, eager);
const shapeCells = [];
{
  const seen = new Set();
  for (const s of eagerShapes) {
    const x0 = s.kind ? s.x - s.r : s.x0, x1 = s.kind ? s.x + s.r : s.x1;
    const z0 = s.kind ? s.z - s.r : s.z0, z1 = s.kind ? s.z + s.r : s.z1;
    for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) {
      for (let cz = cellOf(z0); cz <= cellOf(z1); cz++) {
        const k = cx * 100000 + cz;
        if (!seen.has(k)) { seen.add(k); shapeCells.push([cx, cz]); }
      }
    }
  }
}

test('lazy lots: nothing is made at attach, a query makes only the lots round it', () => {
  const col = createCollisionWorld();
  fillCollision(city, col);
  const layer = attachLotCollision(city, col);
  assert.equal(layer.stats.shapes, 0);
  assert.equal(layer.stats.cells, 0);
  const [cx, cz] = shapeCells[shapeCells.length >> 1];
  col.resolveCircle(cx * CELL + 16, cz * CELL + 16, 2);
  assert.ok(layer.stats.cells >= 1 && layer.stats.cells <= 4, `${layer.stats.cells} cells`);
  assert.ok(layer.stats.lots > 0 && layer.stats.lots < 60, `${layer.stats.lots} lots`);
  // The dressing came from the shared cache: the renderer's get gives
  // the same array, and dresses nothing new.
  const cache = lotDressCache(city, dressLot);
  const lot = city.lots.find((l) => l && l.type !== 'verge' && l.type !== 'airfield' && layer.shapesOf(l.id).length);
  const before = cache.stats.dressed;
  assert.equal(cache.get(lot), cache.get(lot));
  assert.equal(cache.stats.dressed, before);
  assert.deepEqual(cache.get(lot), dressLot(city, lot, []));
});

test('lazy lots: a full sweep has exactly the eager shapes, each within LOT_SHAPE_REACH of its lot', () => {
  const layer = createLotLayer(city);
  const lazy = [];
  layer.allShapes((s) => lazy.push(s));
  assert.equal(lazy.length, eagerShapes.length);
  assert.ok(lazy.length > 10000, `${lazy.length} shapes`);
  for (let i = 0; i < lazy.length; i++) assert.equal(val(lazy[i]), val(eagerShapes[i]), `shape ${i}`);
  assert.equal(layer.count(), eagerShapes.length);
  for (const lot of city.lots) {
    if (!lot || lot.type === 'verge' || lot.type === 'airfield') continue;
    for (const s of layer.shapesOf(lot.id)) {
      const x0 = s.kind ? s.x - s.r : s.x0, x1 = s.kind ? s.x + s.r : s.x1;
      const z0 = s.kind ? s.z - s.r : s.z0, z1 = s.kind ? s.z + s.r : s.z1;
      const reach = Math.max(lot.x0 - x0, x1 - lot.x1, lot.z0 - z0, z1 - lot.z1);
      assert.ok(reach <= LOT_SHAPE_REACH, `lot ${lot.id}: a shape reaches ${reach.toFixed(2)} m out`);
    }
  }
});

test('lazy lots: a cell holds the same shapes whether it is touched first or after others', () => {
  const rng = createRng(4401);
  for (let t = 0; t < 40; t++) {
    const [cx, cz] = shapeCells[rng.int(0, shapeCells.length - 1)];
    const first = createLotLayer(city).cell(cx, cz);
    const later = createLotLayer(city);
    // Touch a random block of cells round it first, then the cell.
    for (let k = 0; k < 30; k++) later.cell(cx + rng.int(-4, 4), cz + rng.int(-4, 4));
    later.prepare(cx * CELL - 200, cz * CELL - 200, cx * CELL - 100, cz * CELL - 100);
    assert.ok(first.length > 0);
    assert.equal(listVal(later.cell(cx, cz)), listVal(first), `cell ${cx},${cz}`);
  }
});

test('lazy lots: two visit orders give the same collision world, and the same answers as the eager fill', () => {
  const make = () => {
    const col = createCollisionWorld();
    fillCollision(city, col);
    attachLotCollision(city, col);
    return col;
  };
  const full = createCollisionWorld();
  fillCollision(city, full);
  fillLotCollision(city, full);
  const A = make(), B = make();
  // Probe points over the lot cells, and long rays (fill few cells).
  const rng = createRng(99);
  const probes = [];
  for (let k = 0; k < 3000; k++) {
    const [cx, cz] = shapeCells[rng.int(0, shapeCells.length - 1)];
    const a = rng.next() * Math.PI * 2;
    probes.push([cx * CELL + rng.next() * CELL, cz * CELL + rng.next() * CELL, 0.5 + rng.next() * 3, Math.cos(a), Math.sin(a), 5 + rng.next() * 300]);
  }
  const ask = (col, p) => {
    const r = col.resolveCircle(p[0], p[1], p[2]);
    return [r.x, r.z, r.nx, r.nz, r.hit, r.depth, col.raycast(p[0], p[1], p[3], p[4], p[5]), col.heightAt(p[0], p[1]), col.lineClear(p[0], p[1], p[0] + p[3] * p[5], p[1] + p[4] * p[5])];
  };
  // A forward, B backward: each answer is the same in both, and the same
  // as in the world with every lot shape added up front.
  const resA = probes.map((p) => ask(A, p));
  const resB = [];
  for (let k = probes.length - 1; k >= 0; k--) resB[k] = ask(B, probes[k]);
  for (let k = 0; k < probes.length; k++) {
    assert.deepEqual(resB[k], resA[k], `probe ${k}`);
    assert.deepEqual(resA[k], ask(full, probes[k]), `probe ${k} against the eager fill`);
  }
  // Then every lot cell, in two orders: the same lists.
  const LA = A.lotLayer, LB = B.lotLayer;
  const order = shapeCells.slice();
  for (let k = order.length - 1; k > 0; k--) {
    const q = rng.int(0, k);
    const t = order[k]; order[k] = order[q]; order[q] = t;
  }
  for (const [cx, cz] of order) LB.cell(cx, cz);
  for (const [cx, cz] of shapeCells) assert.equal(listVal(LA.cell(cx, cz)), listVal(LB.cell(cx, cz)), `cell ${cx},${cz}`);
  // The whole world's lists (boxes, circles) are in lot order either way.
  assert.equal(A.boxes.length, full.boxes.length);
  assert.equal(A.circles.length, full.circles.length);
  assert.equal(A.boxes.map(val).join('|'), B.boxes.map(val).join('|'));
  assert.equal(A.circles.map(val).join('|'), full.circles.map(val).join('|'));
});
