// 0.13.2 wastelands (docs/STREETSCAPE.md, docs/STATUS.md): dead ends inside
// a region end in a barricade that stops a car; parking lot rows are broken
// by planted islands; lots are not filled to the brim by day.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { deadEnds, DEAD_END_GAP, DEAD_END_BASE } from '../src/world/deadends.js';
import { createCollisionWorld, fillCollision } from '../src/world/collision.js';
import { pairGap } from '../src/world/junctions.js';
import { dressLot, bayCount, lotFill, LOT_TYPES } from '../src/world/lots.js';

const load = (id) => createMiamiCity(JSON.parse(fs.readFileSync(new URL(`../src/world/data/${id}.json`, import.meta.url), 'utf8')), { region: id });
const beach = load('miami-beach');
const downtown = load('miami-downtown');

test('dead ends: every road that stops inside a region gets a barricade just past its end, off other roads, on land', () => {
  for (const city of [beach, downtown]) {
    const list = deadEnds(city);
    assert.equal(deadEnds(city), list, 'cached per city');
    const deg = new Map();
    for (const e of city.edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    const crop = new Set(city.roadEnds.map((r) => r.node));
    let open = 0;
    for (const [n, d] of deg) {
      if (d !== 1 || crop.has(n)) continue;
      const e = city.edges.find((q) => q.a === n || q.b === n);
      if (!e.ped && !e.bridge && e.length >= 8) open++;
    }
    // Most dead ends get one (the rest run on into a road or a building).
    assert.ok(list.length >= 50 && list.length >= open * 0.6, `${city.mapId}: ${list.length} of ${open}`);
    for (const de of list) {
      const n = city.nodes[de.node], e = city.edges[de.edge];
      assert.ok(Math.abs(Math.hypot(de.x - n.x, de.z - n.z) - DEAD_END_GAP) < 1e-6);
      // 0.13.3: the base covers the end of the strip (it runs past the
      // node by -trim): no sliver of asphalt beyond the barricade.
      const q = 2 * e.id + (e.b === de.node ? 1 : 0), past = Math.max(0, -city.roadGeo.trim[q]);
      assert.ok(DEAD_END_GAP + DEAD_END_BASE >= past + 0.05 && DEAD_END_GAP - DEAD_END_BASE <= past, `strip end ${past} m past the node`);
      assert.ok(de.w > e.width && de.w < e.width + 2);
      assert.ok(city.isLand(de.x, de.z) && !city.inBuilding(de.x, de.z), `${de.x}, ${de.z}`);
      // Out of the road: the barricade faces away from the edge's far node.
      const o = city.nodes[e.a === de.node ? e.b : e.a];
      assert.ok(Math.cos(de.heading) * (n.x - o.x) + Math.sin(de.heading) * (n.z - o.z) > 0);
    }
    assert.ok(!list.some((de) => city.roadEnds.some((r) => r.node === de.node)), 'not a crop road end');
  }
});

test('dead ends: the barricade is solid (barrier posts across the road)', () => {
  const col = createCollisionWorld();
  fillCollision(beach, col);
  const list = deadEnds(beach);
  for (const de of list.slice(0, 20)) {
    const px = -Math.sin(de.heading), pz = Math.cos(de.heading);
    for (const t of [-0.3, 0, 0.3]) {
      const hit = col.resolveCircle(de.x + px * de.w * t, de.z + pz * de.w * t, 0.6);
      assert.ok(hit.hit, `posts at ${de.x.toFixed(1)}, ${de.z.toFixed(1)}`);
    }
  }
});

test('parking lots: no row runs more than 11 bays without a planted island; day fills leave room', () => {
  let rows = 0, long = 0;
  for (const lot of downtown.lots) {
    if (lot.type !== 'carpark') continue;
    for (const f of dressLot(downtown, lot, [])) {
      if (f.kind !== 'bay') continue;
      rows++;
      if (bayCount(f) > 11) long++;
    }
  }
  assert.ok(rows > 500, `${rows} rows`);
  assert.equal(long, 0, `${long} rows over 11 bays`);
  for (const d of ['downtown', 'midtown', 'beach']) {
    assert.ok(lotFill({ district: d, seed: 0 }, 13) <= 0.45 + 0.07, `${d} at noon`);
  }
});

// 0.13.3 visual leftovers (docs/STATUS.md): big lawns, median seams, sand
// stair steps beside a causeway.
const south = load('miami-south');

test('lawns: a big green has a path with benches and trees standing on it, in the feature caps', () => {
  for (const city of [beach, south]) {
    let big = 0, benched = 0, area = 0, feats = 0, trees = 0;
    for (const lot of city.lots) {
      if (lot.type !== 'grass') continue;
      const F = dressLot(city, lot, []);
      area += lot.area; feats += F.length;
      for (const f of F) if (f.kind === 'tree') trees++;
      if (lot.area <= 1500 || !F.some((f) => f.kind === 'path')) continue;
      big++;
      if (F.some((f) => f.kind === 'bench')) benched++;
    }
    assert.ok(big > 100 && benched >= big * 0.8, `${city.mapId}: ${benched} of ${big} greens with a path have a bench`);
    assert.ok((trees / area) * 1e4 >= 55, `${city.mapId}: ${((trees / area) * 1e4).toFixed(0)} trees a hectare of lawn`);
    // (Paths are one feature for their length: the count a hectare stays
    // near what it was, 113 at the Beach and 124 in the South in 0.13.2.)
    assert.ok((feats / area) * 1e4 <= (city === beach ? 120 : 132), `${city.mapId}: ${((feats / area) * 1e4).toFixed(0)} features a hectare of lawn`);
  }
});

test('medians: the middle of a planted median of over 4 m is drawn ground, no bare seam', () => {
  const G = south.lotGrid, LG = south.landGrid;
  let n = 0, bare = 0;
  const at = [];
  for (const e of south.edges) {
    if (!(e.median > 4) || e.bridge || !(e.width > 0)) continue;
    const a = south.nodes[e.a], lc = (e.off || 0) - e.width / 2;
    for (let d = 2; d < e.length - 2; d += 5) {
      // The middle of the real gap to the partner (it can be wider than
      // the data's median), else of the median.
      const g = e.pair >= 0 ? pairGap(south, e, d, lc) : e.median;
      if (!(g < 40)) continue;
      const o = lc - Math.max(e.median, g) / 2;
      const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
      const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
      if (!LG.data[j * LG.w + i]) continue;
      n++;
      if (!G.ground[j * G.w + i] && bare++ < 3) at.push(`${x.toFixed(0)}, ${z.toFixed(0)}`);
    }
  }
  assert.ok(n > 300, `${n} samples`);
  assert.equal(bare, 0, `${bare} of ${n} median middles bare (${at.join('; ')})`);
});

test('beach ground runs on to the road beside it (no stair of sand cut into bare paving)', () => {
  const G = downtown.lotGrid, sand = LOT_TYPES.indexOf('beach') + 1;
  // Between the beach and the causeway ramp at Parrot Jungle Trail.
  for (const [x, z] of [[237, -829], [232, -824], [257, -819], [267, -814]]) {
    const k = Math.floor((z - G.z0) / G.cell) * G.w + Math.floor((x - G.x0) / G.cell);
    assert.equal(G.ground[k], sand, `${x}, ${z}`);
    assert.equal(G.type[k], 0, 'a cell in no lot (the lots are unchanged)');
  }
});
