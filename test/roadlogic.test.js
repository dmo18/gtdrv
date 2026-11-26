// Road logic (0.13.7, docs/STATUS.md "0.13.7 road logic"): the owner
// drove the game and found grass in the streets, five to eight lane minor
// streets, streets going from big to small, and lines all over the place.
// Sane lanes by class, one cross section along a street, local streets
// unmarked, paint only on road, and the road the ground has drawn as road.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { roadProfile, laneCaps, harmonizeStreets, paintLines, PARK_W } from '../src/world/roadprofile.js';
import { groundOf } from '../src/world/ground.js';
import { edgePaint } from '../src/world/junctions.js';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import { realRoads, netRoads } from '../src/render/citymesh.js';

const lanesOf = (p) => [p.lanesF, p.lanesB, p.center ? 1 : 0];

test('lanes by class: local 1 + 1, collector 1 + 1 and a turn lane, arterial 2 + 2 and a turn lane, trunks and motorways more', () => {
  // Tags past the class's lanes are cut back; on a class with a turn lane
  // the cut leaves the turn lane.
  assert.deepEqual(lanesOf(roadProfile({ class: 'residential', lanes: 4 })), [1, 1, 0]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'residential', lanes: 3, lf: 2, lb: 1 })), [1, 1, 0]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'living_street', lanes: 6 })), [1, 1, 0]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'tertiary', lanes: 4 })), [1, 1, 1]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'tertiary', lanes: 2 })), [1, 1, 0]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'secondary', lanes: 6 })), [2, 2, 1]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'primary', lanes: 8, lf: 4, lb: 4 })), [2, 2, 1]);
  assert.deepEqual(lanesOf(roadProfile({ class: 'trunk', lanes: 6 })), [3, 3, 0]);
  // Unequal tags each way are equal lanes and the turn lane.
  assert.deepEqual(lanesOf(roadProfile({ class: 'secondary', lanes: 3, lf: 1, lb: 2 })), [1, 1, 1]);
  // One-ways: local 2, collector 2, arterial 3, trunk 4, motorway 5; a
  // collector one-way untagged has one lane (was two).
  assert.equal(roadProfile({ class: 'residential', oneway: 1, lanes: 4 }).lanesF, 2);
  assert.equal(roadProfile({ class: 'tertiary', oneway: 1 }).lanesF, 1);
  assert.equal(roadProfile({ class: 'tertiary', oneway: 1, lanes: 3 }).lanesF, 2);
  assert.equal(roadProfile({ class: 'primary', oneway: 1, lanes: 5 }).lanesF, 3);
  assert.equal(roadProfile({ class: 'motorway', oneway: 1, lanes: 6 }).lanesF, 5);
  // A two-way street with a turn lane parks on neither curb (it parked on
  // one, a lopsided street).
  const t = roadProfile({ class: 'tertiary', lanes: 3 });
  assert.deepEqual([t.parkL, t.parkR, t.width], [0, 0, 10.5]);
  assert.deepEqual(laneCaps('residential'), laneCaps('service'));
});

test('one cross section along a street: a turn bay or an untagged block takes the street\'s lanes; a fork joins neither branch', () => {
  // A straight one-way street of four blocks along x, tagged 2, 3, 2, 2
  // lanes (a turn bay on the second block), then a fork at its end.
  const nodes = [0, 1, 2, 3, 4].map((k) => ({ id: k, x: k * 100, z: 0, edges: [] }));
  nodes.push({ id: 5, x: 500, z: 8, edges: [] }, { id: 6, x: 500, z: -8, edges: [] });
  const P2 = roadProfile({ class: 'secondary', oneway: 1, lanes: 2 }), P3 = roadProfile({ class: 'secondary', oneway: 1, lanes: 3 });
  const P1 = roadProfile({ class: 'secondary', oneway: 1, lanes: 1 });
  const edges = [];
  const add = (a, b, P) => {
    const A = nodes[a], B = nodes[b], L = Math.hypot(B.x - A.x, B.z - A.z);
    const e = { id: edges.length, a, b, length: L, ux: (B.x - A.x) / L, uz: (B.z - A.z) / L, name: 'Fifth', cls: 'secondary', ...P, off: 0, median: 0 };
    edges.push(e);
    A.edges.push(e.id);
    B.edges.push(e.id);
    return e;
  };
  add(0, 1, P2); add(1, 2, P3); add(2, 3, P2); add(3, 4, P2);
  // Two branches of one lane leave the end a few degrees apart.
  const f1 = add(4, 5, P1), f2 = add(4, 6, P1);
  harmonizeStreets(nodes, edges);
  assert.deepEqual(edges.slice(0, 4).map((e) => e.lanesF), [2, 2, 2, 2]);
  assert.equal(edges[1].width, P2.width);
  assert.deepEqual([f1.lanesF, f2.lanesF], [1, 1], 'a fork keeps its branches');
});

test('paint: a local street of one lane each way is not marked; a collector keeps its center line and parking lines', () => {
  const out = [];
  const kinds = (p) => { paintLines({ ...p, off: 0 }, out); const k = []; for (let i = 1; i < out.length; i += 2) k.push(out[i]); return k.sort(); };
  assert.deepEqual(kinds({ ...roadProfile({ class: 'residential' }), cls: 'residential' }), []);
  assert.deepEqual(kinds({ ...roadProfile({ class: 'residential', oneway: 1 }), cls: 'residential' }), []);
  assert.deepEqual(kinds({ ...roadProfile({ class: 'residential', oneway: 1, lanes: 2 }), cls: 'residential' }), ['dash']);
  assert.deepEqual(kinds({ ...roadProfile({ class: 'tertiary' }), cls: 'tertiary' }), ['park', 'park', 'yellow2']);
  assert.equal(roadProfile({ class: 'tertiary' }).parkL, PARK_W);
});

test('every region: lanes inside the class, no lane change where a street runs straight on, no local street of 2 + 2', () => {
  const local = new Set(['residential', 'living_street', 'unclassified', 'service']);
  for (const id of REGION_IDS) {
    const c = regionCity(id), E = c.edges;
    let joins = 0, changes = 0;
    for (const e of E) {
      if (e.causeway || e.lanesF === undefined) continue;
      const cap = laneCaps(e.cls);
      assert.ok(e.lanesF <= cap[e.oneway ? 3 : 1], `${id} edge ${e.id} ${e.cls} ${e.lanesF} lanes`);
      if (!e.oneway) assert.equal(e.lanesF, e.lanesB, `${id} edge ${e.id} equal each way`);
      if (local.has(e.cls) && !e.oneway) assert.ok(e.lanesF === 1 && !e.center, `${id} edge ${e.id} local ${e.lanesF} + ${e.lanesB}`);
    }
    for (const n of c.nodes) {
      if (n.edges.length !== 2) continue;
      const a = E[n.edges[0]], b = E[n.edges[1]];
      if (a.ped || b.ped || a.causeway || b.causeway || a.oneway !== b.oneway || a.name !== b.name) continue;
      const sa = a.a === n.id ? 1 : -1, sb = b.a === n.id ? 1 : -1;
      if (-(a.ux * sa * b.ux * sb + a.uz * sa * b.uz * sb) < Math.cos((35 * Math.PI) / 180) || (a.oneway && sa === sb)) continue;
      joins++;
      if (a.lanesF !== b.lanesF || !!a.center !== !!b.center) changes++;
    }
    // Before 0.13.7: 52 to 160 lane changes a region at such joins (a
    // fifth to a third of them); now 0 to 6 (blocks the data tags under 4
    // lanes on a street of 4 or more, which stay under MAX_UNTAGGED_W).
    assert.ok(joins > 250 && changes <= joins * 0.025, `${id}: ${changes} lane changes at ${joins} straight joins`);
  }
});

// Flat triangles of the builders, rastered into a 0.5 m grid of bits.
function raster(B, key, bit, maxY, x0, z0, NX, NZ, cov) {
  const S = 0.5;
  for (const mb of B[key].map.values()) {
    const P = mb.pos, I = mb.idx, n = mb.ni ?? I.length;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      if (Math.abs(P[a + 1] - P[b + 1]) > 0.05 || Math.abs(P[a + 1] - P[c + 1]) > 0.05 || P[a + 1] > maxY) continue;
      const i0 = Math.max(0, Math.floor((Math.min(P[a], P[b], P[c]) - x0) / S)), i1 = Math.min(NX - 1, Math.floor((Math.max(P[a], P[b], P[c]) - x0) / S));
      const j0 = Math.max(0, Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / S)), j1 = Math.min(NZ - 1, Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / S));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + 0.5) * S, z = z0 + (j + 0.5) * S;
          const d1 = (P[b] - P[a]) * (z - P[a + 2]) - (P[b + 2] - P[a + 2]) * (x - P[a]);
          const d2 = (P[c] - P[b]) * (z - P[b + 2]) - (P[c + 2] - P[b + 2]) * (x - P[b]);
          const d3 = (P[a] - P[c]) * (z - P[c + 2]) - (P[a + 2] - P[c + 2]) * (x - P[c]);
          if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
          cov[j * NX + i] |= bit;
        }
      }
    }
  }
}
const KEYS = ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand', 'paint', 'ao', 'props', 'solid', 'detail', 'glow', 'trees', 'treesDetail', 'plain'];

test('road the ground calls road is drawn as asphalt, with no lawn or sidewalk on it, and paint lies only on road (300 m round each start)', () => {
  const R = 150;
  for (const id of REGION_IDS) {
    const c = regionCity(id), G = groundOf(c), cx = c.spawn.x, cz = c.spawn.z;
    const B = {};
    for (const k of KEYS) B[k] = new ChunkedBuilder(1e8, 1, true, 4);
    const x0 = cx - R, z0 = cz - R, near = [];
    c.edgesNear(cx, cz, R * 1.5, near);
    realRoads(c, B, c.nodes.filter((n) => Math.abs(n.x - cx) < R + 50 && Math.abs(n.z - cz) < R + 50), near.map((k) => c.edges[k]));
    netRoads(c, B, x0, z0, cx + R, cz + R);
    const NX = 4 * R, NZ = 4 * R, cov = new Uint8Array(NX * NZ);
    raster(B, 'asphalt', 1, 0.1, x0, z0, NX, NZ, cov);
    raster(B, 'sidewalk', 2, 1, x0, z0, NX, NZ, cov);
    raster(B, 'grass', 2, 1, x0, z0, NX, NZ, cov);
    let road = 0, bare = 0, raised = 0;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        if (G.surfaceAt(x0 + (i + 0.5) * 0.5, z0 + (j + 0.5) * 0.5) !== 1) continue;
        road++;
        if (!(cov[j * NX + i] & 1)) bare++;
        if (cov[j * NX + i] & 2) raised++;
      }
    }
    // 0.13.7, these boxes: bare 0 to 0.16 % (South, small spots at sidewalk
    // corners; 0.22 % before; Downtown's core was 0.19 % before, 0.04 %
    // now, with forks of near-parallel arms), raised on road under 0.2 %.
    assert.ok(road > 20000 && bare / road < 0.0025, `${id}: ${bare} of ${road} road cells bare`);
    assert.ok(raised / road < 0.004, `${id}: ${raised} of ${road} road cells under lawn or sidewalk`);
    let pts = 0, off = 0;
    const P = [];
    for (const e of near.map((k) => c.edges[k])) {
      edgePaint(c, e, P);
      const a = c.nodes[e.a];
      for (let k = 0; k + 5 < P.length; k += 6) {
        const n = Math.max(1, Math.ceil(Math.hypot(P[k + 2] - P[k], P[k + 3] - P[k + 1])));
        for (let m = 0; m <= n; m++) {
          const d = P[k] + ((P[k + 2] - P[k]) * m) / n, o = P[k + 1] + ((P[k + 3] - P[k + 1]) * m) / n;
          pts++;
          if (G.surfaceAt(a.x + e.ux * d - e.uz * o, a.z + e.uz * d + e.ux * o) !== 1) off++;
        }
      }
    }
    assert.ok(pts > 500 && off === 0, `${id}: ${off} of ${pts} paint points off road`);
  }
});
