// 0.13.2 wastelands (docs/STREETSCAPE.md, docs/STATUS.md): dead ends inside
// a region end in a barricade that stops a car; parking lot rows are broken
// by planted islands; lots are not filled to the brim by day.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { deadEnds, DEAD_END_GAP } from '../src/world/deadends.js';
import { createCollisionWorld, fillCollision } from '../src/world/collision.js';
import { dressLot, bayCount, lotFill } from '../src/world/lots.js';

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
