// Lot to lot boundaries (docs/STREETSCAPE.md 4d, docs/PLAN_V4.md task 11):
// two lot grounds meeting along a diagonal are drawn along it, not in the
// 5 m stair steps of the lot raster (src/render/lotmesh.js lotCut).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import { lotGround, lotEdges, lotCut, LOT_TYPES, LOT_GROUND } from '../src/render/lotmesh.js';
import { allRegionCities } from './regionfixture.js';

const KEYS = ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};
const YARD = LOT_TYPES.indexOf('yard') + 1, PLAZA = LOT_TYPES.indexOf('plaza') + 1;
const N = 14, CELL = 5;
// A ground's look (builder key and color: yard and park look alike), or 0.
const L = (t) => { const o = t ? LOT_GROUND[LOT_TYPES[t - 1]] : null; return o ? o.key + o.col : 0; };

// A lot grid of N x N cells: yard south-west of the line z = x + s * CELL,
// plaza north-east of it (a staircase of 1-cell steps), or a yard square
// in plaza (`square`).
function stairCity(shape) {
  const ground = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) ground[j * N + i] = shape(i, j) ? YARD : PLAZA;
  const lotGrid = { x0: 0, z0: 0, cell: CELL, w: N, h: N, id: new Int32Array(N * N), type: ground, ground };
  return { lots: [], lotGrid };
}
// Every ground triangle of a builder set: [ax, az, bx, bz, cx, cz, key].
function triangles(B) {
  const out = [];
  for (const k of KEYS) {
    for (const mb of B[k].map.values()) {
      const I = mb.idx, P = mb.pos;
      for (let t = 0; t < I.length; t += 3) out.push([P[I[t] * 3], P[I[t] * 3 + 2], P[I[t + 1] * 3], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3], P[I[t + 2] * 3 + 2], k]);
    }
  }
  return out;
}
const side = (ax, az, bx, bz, x, z) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
function keyAt(T, x, z) {
  for (const [ax, az, bx, bz, cx, cz, k] of T) {
    const a = side(ax, az, bx, bz, x, z), b = side(bx, bz, cx, cz, x, z), c = side(cx, cz, ax, az, x, z);
    if ((a <= 0 && b <= 0 && c <= 0) || (a >= 0 && b >= 0 && c >= 0)) return k;
  }
  return null;
}

test('a 1-cell staircase between two lot grounds is drawn as a straight line: no step over 0.3 m', () => {
  for (const s of [0, 3]) {
    const city = stairCity((i, j) => j >= i + s);
    const B = builders();
    lotGround(city, B, 0, N, 0, N);
    const T = triangles(B);
    let worst = 0, sampled = 0;
    // Inside the grid (lotCut leaves the outermost cells whole).
    for (let z = CELL * 1.5; z < CELL * (N - 1.5); z += 0.25) {
      for (let x = CELL * 1.5; x < CELL * (N - 1.5); x += 0.25) {
        const d = (z - x - s * CELL) / Math.SQRT2; // > 0 on the yard side
        if (Math.abs(d) > 4) continue;
        const k = keyAt(T, x, z);
        assert.ok(k, `ground drawn at ${x}, ${z}`);
        sampled++;
        if ((k === 'grass') !== (d > 0)) worst = Math.max(worst, Math.abs(d));
      }
    }
    assert.ok(sampled > 1000);
    assert.ok(worst <= 0.3, `boundary off the diagonal by ${worst.toFixed(2)} m (shift ${s})`);
    // The lawn's edging runs along the cut, not round the steps.
    const E = builders();
    assert.ok(lotEdges(city, E, 0, N, 0, N) > 0);
    for (const [ax, az, bx, bz, cx, cz] of triangles(E)) {
      const x = (ax + bx + cx) / 3, z = (az + bz + cz) / 3;
      if (x < CELL * 2 || z < CELL * 2 || x > CELL * (N - 2) || z > CELL * (N - 2)) continue;
      assert.ok(Math.abs(z - x - s * CELL) / Math.SQRT2 < 1, `edging at ${x.toFixed(1)}, ${z.toFixed(1)} is off the cut`);
    }
  }
});

test('a square lot corner stays square; a 1-cell bump is not cut', () => {
  const sq = stairCity((i, j) => i >= 4 && i < 9 && j >= 4 && j < 9);
  for (let k = 0; k < N * N; k++) assert.equal(lotCut(sq.lotGrid, sq.lotGrid.ground, k), 0, `cell ${k}`);
  const bump = stairCity((i, j) => j >= 7 || (i === 6 && j === 6));
  for (let k = 0; k < N * N; k++) assert.equal(lotCut(bump.lotGrid, bump.lotGrid.ground, k), 0, `cell ${k}`);
});

test('five regions: every 1-cell stair between two lot grounds is cut once, on lot cells', () => {
  for (const [id, city] of allRegionCities()) {
    const G = city.lotGrid, g = G.ground, w = G.w;
    let cuts = 0, stairs = 0;
    for (let j = 1; j < G.h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        const cut = lotCut(G, g, k);
        if (cut) cuts++;
        // A clean NE stair step at k: ground b north and east of k, a
        // south and west, a along the cut both ways, the steps going on
        // beyond. k or one of its two b neighbors must be cut.
        const a = L(g[k]), b = L(g[k - w]);
        if (!a || !b || a === b || L(g[k + 1]) !== b || L(g[k + w]) !== a || L(g[k - 1]) !== a) continue;
        if (L(g[k - w - 1]) !== a || L(g[k + w + 1]) !== a || L(g[k - w + 1]) !== b) continue;
        // (Not a band of b one cell wide: a beyond both b neighbors.)
        if (L(g[k + 2]) === a && L(g[k - 2 * w]) === a) continue;
        stairs++;
        assert.ok(lotCut(G, g, k) || lotCut(G, g, k + 1) || lotCut(G, g, k - w), `${id}: stair at cell ${k} not cut`);
      }
    }
    assert.ok(cuts > 0 && stairs > 0, `${id}: some lot to lot stairs cut (${cuts}, ${stairs} clean stairs)`);
    console.log(`# ${id}: ${cuts} cells cut, ${stairs} clean stairs`);
  }
});
