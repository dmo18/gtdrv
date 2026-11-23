// The Miami map split into regions (docs/PLAN_V2.md 3, tests of 3.7 that
// belong to the world data): the crops, the filter rule, every region
// building from its own data file, the fingerprints, the region budget,
// the start places, the generated road ends and the travel links.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMiamiCity, MIAMI_CORE, MIAMI_SPOTS, regionSpots, buildWindow } from '../src/world/miami.js';
import {
  REGIONS, REGION_IDS, DEFAULT_REGION, CORE_REGION, BOX, WHOLE_BOX, REGION_BUDGET, PLACE_MARGIN, START_EDGE,
  regionFor, inRegion, holdsAll, pointsIn, regionsAt, regionOfPoint, cityFingerprint, loadRegionData,
} from '../src/world/regions.js';
import { loadMapCity, MAP_IDS } from '../src/world/maps.js';
import { createCollisionWorld, fillCollision } from '../src/world/collision.js';
import { splitText, nearCrop, regionFile } from '../scripts/split-map.mjs';

const read = (f) => fs.readFileSync(new URL('../src/world/data/' + f, import.meta.url), 'utf8');
const data = JSON.parse(read('miami.json'));
const files = Object.fromEntries(REGION_IDS.map((id) => [id, read(id + '.json')]));
const regionData = Object.fromEntries(REGION_IDS.map((id) => [id, JSON.parse(files[id])]));
const timesMs = {};
const cities = {};
for (const id of REGION_IDS) {
  const t = performance.now();
  cities[id] = createMiamiCity(regionData[id], { region: id });
  timesMs[id] = Math.round(performance.now() - t);
}
const whole = createMiamiCity(data);
const inCrop = (c, x, z, m = 0) => x >= c.x0 + m && x <= c.x1 - m && z >= c.z0 + m && z <= c.z1 - m;

// Fingerprints (regions.js cityFingerprint) measured 2026-11-23. The
// whole box was measured on the code before the split (commit e09a4f2)
// and is unchanged. The regions were re-pinned when the integration put
// every raster origin on the whole box's lattice (miami.js
// RASTER_LATTICE): before it Downtown, West and South rastered 1 m off
// in z and Beach on other district cells, so their lots and some
// buildings differed from the whole box's (North was already aligned and
// kept its pin). Downtown is still today's core crop, value for value,
// and now also the whole box inside it (test below).
// The landmark id harbour-wheel became harbor-wheel (American pass): two buildings hashes re-pinned.
// Re-pinned for 0.9.0 map truth (docs/PLAN_V3.md 2.1, task MAP): the data
// file gained the east strip to lon -80.115 and new tags (same origin, the
// old features kept their order, so building footprint ids are unchanged),
// every edge got its cross section from world/roadprofile.js (widths,
// lanes, one-way direction, paired divided roads, signals and stop signs
// from the data), buildings keep a 1.8 m sidewalk (3 m inside blocks) and
// drop footprint slivers under 30 m2, infill only on blocks with no real
// footprint (outside the core). All six change: nodes and edges (graph and
// edge fields), buildings, and lots and the lot grid that follow them.
// A change here means the build changed: find out why before re-pinning.
// 0.9.0 integration re-pin (deliberate): nodes and edges as MAP left them;
// lots, lot grids (and the North's infill buildings) after the lot band
// keeps a cell exactly LOT_SETBACK from a junction box free (world-density's
// two missed cells), and site gates move to a long side.
const PINNED = {
[WHOLE_BOX]: { nodes: '2396c3b4', edges: '5a266754', buildings: '1e4c554c', lots: 'd01f1a7f', lotGrid: '15923ee0' },
  'miami-downtown': { nodes: '4ff513f1', edges: '88eaf928', buildings: '1043fe9b', lots: 'ee572ab3', lotGrid: '6f448a01' },
  'miami-beach': { nodes: '623e78f0', edges: '18948af8', buildings: '2686c288', lots: 'ffc51318', lotGrid: '2f187719' },
  'miami-north': { nodes: 'f3393081', edges: '214bfab7', buildings: '519e29ef', lots: '248c5b55', lotGrid: '40de85d6' },
  'miami-west': { nodes: '93b20d30', edges: '7ccb511d', buildings: 'd768b63c', lots: 'dc63a084', lotGrid: 'd81ec6b2' },
  'miami-south': { nodes: 'be069633', edges: 'd3decc88', buildings: '1baefd1e', lots: 'a1443502', lotGrid: 'c350c3bf' },
};
const fpOf = (c) => {
  const f = cityFingerprint(c);
  delete f.counts;
  return f;
};

test('the five regions: exact crops, ids, names, the default', () => {
  assert.deepEqual(REGIONS.map((r) => [r.id, r.name, r.crop]), [
    ['miami-downtown', 'Downtown and the Bay', { x0: -2700, z0: -2700, x1: 2450, z1: 1900 }],
    // 0.9.0: the Beach reaches the Atlantic (docs/PLAN_V3.md 2.1 item 1).
    ['miami-beach', 'Miami Beach and the Islands', { x0: 1400, z0: -3891, x1: 6508, z1: 3891 }],
    ['miami-north', 'Wynwood and the North Side', { x0: -4505, z0: -3891, x1: 1500, z1: -1500 }],
    ['miami-west', 'Little Havana and Civic Center', { x0: -4505, z0: -1700, x1: -1900, z1: 2050 }],
    ['miami-south', 'The Roads and the South Shore', { x0: -4505, z0: 1850, x1: 1400, z1: 3891 }],
  ]);
  // 0.9.0 (2.1 item 10): a new game starts on the Beach; Downtown is the core.
  assert.equal(DEFAULT_REGION, 'miami-beach');
  assert.equal(CORE_REGION, 'miami-downtown');
  assert.deepEqual(regionFor(CORE_REGION).crop, MIAMI_CORE, 'Downtown is the core');
  // Only x1 grew (the east strip); origin, x0, z0, z1 and the lattice stay.
  assert.deepEqual(BOX, { x0: -4505, z0: -3891, x1: 6508, z1: 3891 });
  for (const r of REGIONS) assert.equal(regionFor(r.id), r);
  for (const junk of ['island', WHOLE_BOX, '', null, undefined, '__proto__', 'constructor', 'miami-Downtown']) assert.equal(regionFor(junk), null, String(junk));
  for (const id of REGION_IDS) assert.ok(MAP_IDS.includes(id), id);
});

test('the filter rule: 40 m inside the crop; the whole box holds everything', () => {
  const d = regionFor(CORE_REGION);
  assert.equal(PLACE_MARGIN, 40);
  assert.ok(inRegion(d, -2660, 0) && !inRegion(d, -2661, 0) && inRegion(d, -2690, 0, 0));
  assert.ok(inRegion('miami-downtown', 0, 0) && !inRegion('miami-downtown', 4000, 0));
  assert.ok(inRegion(null, 99999, 99999) && inRegion(WHOLE_BOX, 99999, 0), 'no region: the whole box');
  assert.ok(!inRegion('elsewhere', 0, 0) && !inRegion('island', 0, 0), 'an id that is no region holds nothing');
  assert.ok(inRegion({ region: null }, 99999, 0) && !inRegion({ region: d }, 4000, 0), 'a city: its region');
  assert.ok(inRegion(whole, 99999, 0) && inRegion(cities['miami-beach'], 4100, -500) && !inRegion(cities['miami-beach'], 0, 0));
  assert.ok(holdsAll(d, [{ x: 0, z: 0 }, { x: -1000, z: 500 }]) && !holdsAll(d, [{ x: 0, z: 0 }, { x: 3000, z: 0 }]));
  assert.deepEqual(pointsIn({ a: [{ x: 1, z: 2 }], b: { region: { x0: 0, z0: 1, x1: 2, z1: 3 } } }), [{ x: 1, z: 2 }, { x: 0, z: 1 }, { x: 2, z: 3 }]);
  // Overlaps: Wynwood is in Downtown and North; Downtown wins.
  assert.deepEqual(regionsAt(-2000, -2300), ['miami-downtown', 'miami-north']);
  assert.equal(regionOfPoint(-2000, -2300), 'miami-downtown');
  assert.equal(regionOfPoint(4100, -500), 'miami-beach');
  assert.equal(regionOfPoint(NaN, 0), DEFAULT_REGION);
  assert.equal(regionOfPoint(9000, 9000), DEFAULT_REGION);
  // Gullwing Airfield is in Downtown and North.
  for (const id of ['miami-downtown', 'miami-north']) assert.ok(cities[id].airfield && cities[id].airfield.gate, id);
  for (const id of ['miami-beach', 'miami-west', 'miami-south']) assert.equal(cities[id].airfield, null, id);
});

test('every land cell of the box is in a region (5 m land grid of the whole box)', () => {
  const g = whole.landGrid;
  let land = 0, missed = 0;
  for (let j = 0; j < g.h; j++) {
    const z = g.z0 + (j + 0.5) * g.cell;
    for (let i = 0; i < g.w; i++) {
      if (!g.data[j * g.w + i]) continue;
      const x = g.x0 + (i + 0.5) * g.cell;
      if (!inCrop(BOX, x, z)) continue;
      land++;
      if (!REGIONS.some((r) => inCrop(r.crop, x, z))) missed++;
    }
  }
  assert.ok(land * 25 / 1e6 > 38, `${(land * 25 / 1e6).toFixed(1)} km2 of land`);
  assert.equal(missed, 0, `${missed} land cells in no region`);
});

test('every region builds from its own data file; fingerprints pinned; Downtown is the core crop byte for byte', () => {
  assert.deepEqual(fpOf(whole), PINNED[WHOLE_BOX], 'the whole box is unchanged');
  for (const id of REGION_IDS) {
    const c = cities[id];
    assert.equal(c.mapId, id);
    assert.equal(c.map, 'miami');
    assert.equal(c.region, regionFor(id));
    assert.deepEqual(fpOf(c), PINNED[id], id);
    assert.ok(c.nodes.length > 500 && c.buildings.length > 3000 && c.lots.length > 1000, id);
  }
  // Today's core crop (the crop option on the whole data file).
  const core = createMiamiCity(data, { crop: MIAMI_CORE });
  assert.deepEqual(fpOf(core), fpOf(cities[CORE_REGION]));
  assert.deepEqual(core.spawn, cities[CORE_REGION].spawn);
  assert.deepEqual(core.parkingSpots, cities[CORE_REGION].parkingSpots);
  assert.equal(core.courses.length, 14);
  assert.equal(cities[CORE_REGION].courses.length, 14);
  // A region built from the whole file is the region built from its own
  // file (West: its shore lies outside the window, see coarseLand).
  assert.deepEqual(fpOf(createMiamiCity(data, { region: 'miami-west' })), PINNED['miami-west']);
  assert.equal(whole.mapId, WHOLE_BOX);
  assert.equal(whole.region, null);
  assert.deepEqual(whole.roadEnds, [], 'the whole box has no sea edge');
  assert.deepEqual(whole.travelPads, []);
});

test(`region budget: at most ${REGION_BUDGET.buildings} building boxes and ${REGION_BUDGET.landKm2} km2 of land (build ms ${JSON.stringify(timesMs)})`, () => {
  for (const id of REGION_IDS) {
    const c = cities[id], k = regionFor(id).crop;
    const own = c.buildings.filter((b) => inCrop(k, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)).length;
    const g = c.landGrid;
    let land = 0;
    for (let q = 0; q < g.data.length; q++) {
      if (!g.data[q]) continue;
      const i = q % g.w, j = (q - i) / g.w;
      if (inCrop(k, g.x0 + (i + 0.5) * g.cell, g.z0 + (j + 0.5) * g.cell)) land++;
    }
    const km2 = (land * g.cell * g.cell) / 1e6;
    assert.ok(own <= REGION_BUDGET.buildings, `${id}: ${own} building boxes`);
    assert.ok(km2 <= REGION_BUDGET.landKm2 && km2 > 5, `${id}: ${km2.toFixed(2)} km2`);
  }
});

test('start places: on a road, on land, 300 m or more from every edge; the arrival of every link is on a road', () => {
  for (const id of REGION_IDS) {
    const c = cities[id], k = regionFor(id).crop, s = c.spawn;
    assert.ok(c.onRoad(s.x, s.z) && c.shoreDist(s.x, s.z) > 5, `${id} spawn on a road`);
    assert.ok(inCrop(k, s.x, s.z, START_EDGE), `${id} spawn ${s.x.toFixed(0)}, ${s.z.toFixed(0)} is ${START_EDGE} m from the edges`);
    const st = regionFor(id).start;
    if (st) assert.ok(c.edgesNear(s.x, s.z, 1, []).some((e) => c.edges[e].name === st.street), `${id} on ${st.street}`);
  }
  assert.equal(cities[CORE_REGION].startView.spawn.x, cities[CORE_REGION].spawn.x, 'Downtown keeps the designed first view');
});

test('road ends: every road cut by a sea edge ends in a barrier and a turning pad on land', () => {
  for (const id of REGION_IDS) {
    const c = cities[id], k = c.crop;
    assert.ok(c.roadEnds.length > 5, id);
    const col = fillCollision(c, createCollisionWorld());
    const posts = col.circles.filter((q) => q.tag === 'barrier').length;
    assert.ok(posts >= c.roadEnds.length * 3, `${id}: ${posts} barrier posts`);
    for (const e of c.roadEnds) {
      assert.ok(!c.boxSides[e.side], `${id} end ${e.id} on a box side`);
      const dl = Math.min(Math.abs(e.x - k.x0), Math.abs(e.x - k.x1), Math.abs(e.z - k.z0), Math.abs(e.z - k.z1));
      assert.ok(dl < 14, `${id} end ${e.id} is ${dl.toFixed(1)} m from the crop line`);
      const n = c.nodes[e.node];
      assert.ok(n && n.edges.includes(e.edge), `${id} end ${e.id} node`);
      assert.ok(c.shoreDist(e.pad.x, e.pad.z) > 2, `${id} pad ${e.id} on land`);
      // A bridge cut over water ends at its head on the last land.
      if (e.head) assert.ok(c.mainShore(e.head.x, e.head.z) > 0, `${id} head ${e.id}`);
      else assert.ok(c.mainShore(e.x, e.z) > 0, `${id} end ${e.id} over water without a head`);
      // The barrier blocks the way on, past the end.
      assert.ok(col.resolveCircle(e.barrier.x, e.barrier.z, 0.3, 0).hit, `${id} barrier ${e.id}`);
      assert.ok(Number.isFinite(e.heading + e.pad.r + e.barrier.w));
    }
  }
});

test('travel links: every link snaps to a cut road end of its road and has a twin', () => {
  const pads = {};
  for (const id of REGION_IDS) {
    const c = cities[id], r = regionFor(id);
    assert.ok(r.links.length >= 1, id);
    assert.equal(c.travelPads.length, r.links.length, `${id}: every link has a pad`);
    for (const p of c.travelPads) {
      const lk = r.links.find((l) => l.id === p.id);
      const end = c.roadEnds[p.end];
      assert.equal(end.road, lk.road, p.id);
      assert.ok(Math.hypot(end.x - lk.x, end.z - lk.z) < 60, `${id} ${p.id} snaps within 60 m`);
      assert.ok(c.onRoad(p.arrive.x, p.arrive.z) && c.shoreDist(p.arrive.x, p.arrive.z) > 2, `${id} ${p.id} arrival on a road`);
      const dIn = Math.hypot(p.arrive.x - end.x, p.arrive.z - end.z);
      assert.ok(dIn > 15 && dIn < 45, `${id} ${p.id} arrives ${dIn.toFixed(0)} m inside`);
      // Facing in: against the end's way out.
      assert.ok(Math.cos(p.arrive.heading - end.heading) < 0, `${id} ${p.id} faces in`);
      pads[id + '/' + p.id] = p;
    }
    for (const lk of r.links) {
      const other = regionFor(lk.to);
      assert.ok(other && other !== r, `${id} ${lk.id} to ${lk.to}`);
      const twin = other.links.filter((l) => l.id === lk.id);
      assert.equal(twin.length, 1, `${lk.id} has one twin in ${lk.to}`);
      assert.equal(twin[0].to, id);
      assert.equal(twin[0].road, lk.road);
    }
  }
  // The named pairs of 3.4 (Beach and South share no road).
  const pairs = new Set(REGIONS.flatMap((r) => r.links.map((l) => [r.id, l.to].sort().join(' '))));
  assert.deepEqual([...pairs].sort(), ['miami-beach miami-downtown', 'miami-beach miami-north', 'miami-downtown miami-north', 'miami-downtown miami-south',
    'miami-downtown miami-west', 'miami-north miami-west', 'miami-south miami-west']);
});

test('placement filter: a region is offered only what it holds; every hand place is in some region', () => {
  for (const id of REGION_IDS) {
    const c = cities[id], k = regionFor(id).crop, S = regionSpots(MIAMI_SPOTS, regionFor(id));
    for (const list of ['piers', 'helipads', 'ramps', 'cranes', 'landmarks']) {
      for (const p of S[list]) assert.ok(inRegion(id, p.x, p.z), `${id} ${list} ${p.x}, ${p.z}`);
    }
    for (const r of c.rampSpots) assert.ok(inCrop(k, r.x, r.z, -200), `${id} ramp ${r.id}`);
    for (const h of c.helipads) assert.ok(inCrop(k, h.x, h.z), `${id} helipad`);
    for (const p of c.piers) assert.ok(inCrop(k, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, -200), `${id} pier ${p.label}`);
    if (S.secrets) assert.ok(holdsAll(id, pointsIn(S.secrets)));
    assert.equal(c.secretSpots.length, S.secrets ? 6 : 0, id);
  }
  for (const list of ['piers', 'helipads', 'ramps']) {
    for (const p of MIAMI_SPOTS[list]) assert.ok(regionsAt(p.x, p.z).length > 0, `${list} ${p.x}, ${p.z}`);
  }
  for (const p of pointsIn(MIAMI_SPOTS.secrets)) assert.ok(regionsAt(p.x, p.z).length > 0);
  // Downtown's content floor (3.3: as today).
  const d = cities[CORE_REGION];
  assert.equal(d.piers.length, 4);
  assert.equal(d.rampSpots.length, 6);
  assert.equal(d.secretSpots.length, 6);
  assert.ok(d.helipads.length >= 3 && d.tankSpots.length === 3);
  assert.equal(regionSpots(MIAMI_SPOTS, null), MIAMI_SPOTS);
});

test('split data files: generated from miami.json, same features and bytes; the union covers the box', () => {
  for (const r of REGIONS) {
    assert.equal(files[r.id], splitText(data, r), `${r.id}: run node scripts/split-map.mjs`);
    assert.ok(regionFile(r.id).endsWith(r.id + '.json'));
    const d = regionData[r.id];
    assert.equal(d.region, r.id);
    assert.equal(d.attribution, data.attribution);
    assert.deepEqual(d.bounds, data.bounds);
    assert.equal(d.buildings.length, d.buildingIds.length);
    for (let k = 0; k < d.buildings.length; k++) assert.equal(JSON.stringify(d.buildings[k]), JSON.stringify(data.buildings[d.buildingIds[k]]));
    assert.equal(d.coastline.length, data.coastline.length);
    assert.equal(d.water.length, data.water.length);
    assert.ok(files[r.id].length < 1.0e6, `${r.id} ${(files[r.id].length / 1e6).toFixed(2)} MB`);
  }
  // Every feature that reaches into the box is in some region's file.
  for (const kind of ['roads', 'buildings', 'parks']) {
    const sets = REGIONS.map((r) => new Set(regionData[r.id][kind].map((f) => JSON.stringify(f))));
    let missed = 0;
    for (const f of data[kind]) {
      if (!nearCrop(f, BOX, 0)) continue;
      if (!sets.some((s) => s.has(JSON.stringify(f)))) missed++;
    }
    assert.equal(missed, 0, `${kind}: ${missed} missed`);
  }
});

test('the build window: sea sides and box sides', () => {
  assert.deepEqual(buildWindow(data, regionFor(CORE_REGION)).box, { x0: false, z0: false, x1: false, z1: false });
  assert.deepEqual(buildWindow(data, regionFor('miami-beach')).box, { x0: false, z0: true, x1: true, z1: true });
  assert.deepEqual(buildWindow(data, regionFor('miami-south')).crop, { x0: -4465, z0: 1850, x1: 1400, z1: 3851 });
  assert.deepEqual(buildWindow(data, null).box, { x0: true, z0: true, x1: true, z1: true });
});

test('the map loader: one data chunk per region in the bundle; the island is null, junk throws', async () => {
  assert.equal(await loadMapCity('island'), null);
  await assert.rejects(() => loadMapCity('elsewhere'), /unknown map/);
  await assert.rejects(() => loadRegionData('miami'), /no data/);
  await assert.rejects(() => loadRegionData('__proto__'), /no data/);
  // The loaders are dynamic imports the bundler splits (node cannot load
  // JSON that way without import attributes; esbuild can).
  const { build } = await import('esbuild');
  const r = await build({
    entryPoints: [fileURLToPath(new URL('../src/world/maps.js', import.meta.url))], bundle: true, format: 'esm', splitting: true,
    outdir: 'out', write: false, metafile: true, logLevel: 'silent',
  });
  const dataChunks = Object.values(r.metafile.outputs).map((o) => Object.keys(o.inputs).filter((k) => k.endsWith('.json'))).filter((l) => l.length);
  for (const l of dataChunks) assert.equal(l.length, 1, 'one data file a chunk');
  const names = dataChunks.map((l) => l[0].split('/').pop()).filter((n) => n !== 'miami.json').sort();
  assert.deepEqual(names, REGION_IDS.map((id) => id + '.json').sort());
});

// Every raster origin sits on the whole box's lattice (miami.js
// RASTER_LATTICE), so a region away from its edges is the whole box: the
// same building boxes, the same lots, the same lot under every point. When
// Downtown rastered 1 m off in z, none of its lots matched the whole box's
// and 8 of the 20 service homes tuned on the whole box hung off their lot.
// What may still differ: hangar heights drawn from the build's rng
// sequence, and a few shore lots where land past the crop is cut.
test('a region 300 m inside its edges holds the whole box\'s buildings and lots', () => {
  for (const id of REGION_IDS) {
    const c = cities[id], k = regionFor(id).crop, M = 300;
    const inner = (x, z) => inCrop(k, x, z, M);
    const bkey = (b) => [b.x0, b.z0, b.x1, b.z1, b.kind].join(',');
    const lkey = (l) => [l.type, l.x0, l.z0, l.x1, l.z1].join(',');
    const share = (a, b, key, pick) => {
      const want = a.filter(pick).map(key), have = new Set(b.filter(pick).map(key));
      return want.filter((q) => have.has(q)).length / Math.max(1, want.length);
    };
    const bs = share(whole.buildings, c.buildings, bkey, (b) => inner(b.x0, b.z0));
    const ls = share(whole.lots, c.lots, lkey, (l) => inner(l.x0, l.z0) && inner(l.x1, l.z1));
    assert.ok(bs >= 0.99, `${id}: ${(bs * 100).toFixed(1)} % of the whole box's buildings`);
    assert.ok(ls >= 0.98, `${id}: ${(ls * 100).toFixed(1)} % of the whole box's lots`);
    assert.equal(c.lotGrid.cell, whole.lotGrid.cell);
    assert.equal((c.lotGrid.x0 - whole.lotGrid.x0) % 160, 0, id + ' lattice x');
    assert.equal((c.lotGrid.z0 - whole.lotGrid.z0) % 160, 0, id + ' lattice z');
    let n = 0, off = 0;
    for (let x = k.x0 + M; x < k.x1 - M; x += 23.3) {
      for (let z = k.z0 + M; z < k.z1 - M; z += 23.3) {
        n++;
        if (c.lotTypeAt(x, z) !== whole.lotTypeAt(x, z) || c.inBuilding(x, z) !== whole.inBuilding(x, z)) off++;
      }
    }
    assert.ok(off / n < 0.005, `${id}: lot or building differs at ${off} of ${n} points`);
  }
});
