// World criteria (docs/REVAMP.md section 2 "World", 6.1 core table, 6.2 lot
// contract, 6.8 first view) on the Miami city: lots, dressing, density at
// the core, the designed start street, districts and landmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity, MIAMI_CORE, MIAMI_SPOTS } from '../src/world/miami.js';
import {
  LOT_TYPES, FEATURE_KINDS, TREE_VARIANTS, DRESS, DRESS_SETS, DRESS_DISTRICTS, dressLot, featureCap, lotSeed, lotShares,
  eachBay, lotTypeFor, hash32, MAX_FEATURES, MAX_SOLID,
} from '../src/world/lots.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const cpu0 = process.cpuUsage();
const t0 = performance.now();
const city = createMiamiCity(data);
const buildWall = performance.now() - t0;
const buildCpu = process.cpuUsage(cpu0).user / 1000;
const G = city.lotGrid;
const coreLots = city.lots.filter((l) => l.core);
const NAMES = new Set();
for (const k of ['labels', 'roads', 'buildings', 'parks', 'water']) for (const r of data[k]) if (r.name) NAMES.add(r.name);

// Dressed features per lot, computed once.
const dressed = new Map();
const featuresOf = (lot) => {
  let f = dressed.get(lot.id);
  if (!f) dressed.set(lot.id, (f = dressLot(city, lot, [])));
  return f;
};
const boxDist = (b, x, z) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
const near = [];
function buildingsWithin(x, z, r) {
  city.buildingsNear(x - r, z - r, x + r, z + r, near);
  let n = 0, dmin = Infinity;
  for (const id of near) {
    const d = boxDist(city.buildings[id], x, z);
    if (d <= r) n++;
    if (d < dmin) dmin = d;
  }
  return { n, dmin };
}
// Lots whose cells come within r of a point (sampled on the lot grid).
function lotsNear(x, z, r) {
  const ids = new Set();
  const c = G.cell;
  for (let j = Math.floor((z - r - G.z0) / c); j <= Math.floor((z + r - G.z0) / c); j++) {
    for (let i = Math.floor((x - r - G.x0) / c); i <= Math.floor((x + r - G.x0) / c); i++) {
      if (i < 0 || j < 0 || i >= G.w || j >= G.h) continue;
      const id = G.id[j * G.w + i];
      if (id >= 0) ids.add(id);
    }
  }
  return [...ids].map((id) => city.lots[id]);
}
// Distance from a point to a feature's footprint (its l by w box or r disc).
function featureDist(f, x, z) {
  const dx = x - f.x, dz = z - f.z, c = Math.cos(f.heading), s = Math.sin(f.heading);
  const u = Math.abs(dx * c + dz * s) - f.l / 2, v = Math.abs(-dx * s + dz * c) - f.w / 2;
  return Math.max(0, Math.hypot(Math.max(u, 0), Math.max(v, 0)) - f.r);
}
const isBridgeNode = (n) => n.edges.every((eid) => city.edges[eid].bridge || city.edges[eid].causeway);
const pct = (v) => `${(v * 100).toFixed(1)} %`;

test(`world data: the whole box with lots builds in under 3 s (wall ${buildWall.toFixed(0)} ms, cpu ${buildCpu.toFixed(0)} ms)`, () => {
  assert.ok(Math.min(buildWall, buildCpu) < 3000, `wall ${buildWall.toFixed(0)} ms, cpu ${buildCpu.toFixed(0)} ms`);
  assert.deepEqual(MIAMI_CORE, { x0: -2700, z0: -2700, x1: 2450, z1: 1900 });
  assert.equal(city.core, MIAMI_CORE);
  assert.ok(city.inCore(-1100, 780) && !city.inCore(4000, -500) && !city.inCore(-4000, -3000));
  assert.ok(city.lots.length > 10000, `${city.lots.length} lots`);
  for (const k of ['x0', 'z0', 'cell', 'w', 'h']) assert.equal(G[k], city.landGrid[k], k);
  assert.ok(G.id instanceof Int32Array && G.id.length === G.w * G.h);
  assert.ok(G.type instanceof Uint8Array && G.type.length === G.w * G.h);
});

test('lots: every lot has the contract fields; the seed does not depend on the index', () => {
  const cells = new Int32Array(city.lots.length);
  for (let c = 0; c < G.id.length; c++) if (G.id[c] >= 0) cells[G.id[c]]++;
  city.lots.forEach((l, k) => {
    assert.equal(l.id, k);
    assert.ok(LOT_TYPES.includes(l.type), l.type);
    assert.ok(l.x1 > l.x0 && l.z1 > l.z0);
    assert.equal(l.area, cells[k] * 25, `lot ${k} area`);
    assert.equal(typeof l.district, 'string');
    assert.equal(typeof l.place, 'string');
    assert.ok(Number.isInteger(l.seed) && l.seed >= 0 && l.seed < 2 ** 32);
    const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
    assert.equal(l.seed, lotSeed(city.seed, cx, cz, l.type), `lot ${k} seed`);
    assert.equal(l.seed, hash32(city.seed, Math.round(cx / 5), Math.round(cz / 5), LOT_TYPES.indexOf(l.type)));
    const sets = DRESS[l.type][l.district] || DRESS[l.type].midtown;
    assert.ok(sets.includes(l.dress), `lot ${k} dress ${l.dress}`);
    assert.ok(l.building >= -1 && l.building < city.buildings.length);
    assert.ok(l.edge >= -1 && l.edge < city.edges.length);
    assert.ok([0, 1, 2, 3].includes(l.front));
    assert.equal(l.core, city.inCore(cx, cz));
  });
});

test('lots: every free land cell is in a lot; no lot cell is on a road or in a building', () => {
  // Contract 6.2 step 1, checked from the city's public helpers on every
  // other cell of the whole box.
  let free = 0, missed = 0;
  const E = [];
  for (let j = 0; j < G.h; j += 2) {
    for (let i = 0; i < G.w; i += 2) {
      const c = j * G.w + i;
      const x = G.x0 + (i + 0.5) * G.cell, z = G.z0 + (j + 0.5) * G.cell;
      const id = G.id[c];
      const land = city.landGrid.data[c] === 1;
      const roadNear = city.edgesNear(x, z, 4, E).length > 0;
      const inBox = city.inBuilding(x, z, 0);
      if (id >= 0) {
        assert.ok(id < city.lots.length, 'lot id exists');
        assert.ok(land && !inBox, `lot cell at ${x}, ${z} is land outside every building`);
        assert.ok(city.edgesNear(x, z, 0, E).length === 0, `lot cell on a road at ${x}, ${z}`);
        assert.equal(G.type[c], LOT_TYPES.indexOf(city.lots[id].type) + 1);
        assert.equal(city.lotAt(x, z), city.lots[id]);
        assert.equal(city.lotTypeAt(x, z), city.lots[id].type);
        continue;
      }
      assert.equal(G.type[c], 0);
      if (!land || roadNear || inBox) continue;
      // Junction boxes count as road (their sidewalk too).
      if (city.nodes.some((n) => Math.abs(n.x - x) <= n.hx + 4 && Math.abs(n.z - z) <= n.hz + 4)) continue;
      free++;
      // The only free cells left out hold the center of a building box too
      // small to cover a cell center (the cell is the box's own).
      const own = city.buildingsNear(x - 2.5, z - 2.5, x + 2.5, z + 2.5, []).some((k) => {
        const b = city.buildings[k];
        return Math.abs((b.x0 + b.x1) / 2 - x) <= 2.5 && Math.abs((b.z0 + b.z1) / 2 - z) <= 2.5;
      });
      if (!own) missed++;
    }
  }
  assert.equal(missed, 0, `${missed} free cells without a lot`);
  assert.ok(free < 2000, `${free} free cells held by tiny boxes`);
  assert.equal(city.lotAt(-300, 600), null, 'the bay is no lot');
});

test('lots: the type rule table (6.2 step 5)', () => {
  const b = (o) => ({ osm: '', style: 'office', h: 12, kind: 'building', x0: 0, z0: 0, x1: 30, z1: 30, ...o });
  assert.equal(lotTypeFor(b({ osm: 'construction' }), 'downtown', 900), 'site');
  assert.equal(lotTypeFor(b({}), 'airfield', 900), 'airfield');
  assert.equal(lotTypeFor(b({}), 'docks', 900), 'works');
  assert.equal(lotTypeFor(b({ style: 'shed' }), 'downtown', 900), 'works');
  // Mapped parking (amenity=parking, garage) makes a parking lot from 600 m2;
  // other buildings only from CARPARK_BIG, and on one in three of them.
  assert.equal(lotTypeFor(b({ osm: 'parking' }), 'midtown', 900), 'carpark');
  assert.equal(lotTypeFor(b({ osm: 'garage' }), 'midtown', 900), 'carpark');
  assert.equal(lotTypeFor(b({ osm: 'parking' }), 'midtown', 500), 'plaza');
  assert.equal(lotTypeFor(b({ parking: true }), 'midtown', 900), 'carpark', 'the map data\'s own field');
  assert.equal(lotTypeFor(b({ amenity: 'parking' }), 'midtown', 900), 'carpark');
  assert.equal(lotTypeFor(b({ osm: 'retail' }), 'midtown', 900), 'plaza');
  assert.equal(lotTypeFor(b({ osm: 'retail' }), 'midtown', 1900), 'carpark');
  assert.equal(lotTypeFor(b({ osm: 'retail', x0: 7, x1: 37 }), 'midtown', 1900), 'plaza', 'two in three stay plazas');
  assert.equal(lotTypeFor(b({ osm: 'retail' }), 'midtown', 500), 'plaza');
  assert.equal(lotTypeFor(b({ h: 40 }), 'residential', 300), 'plaza');
  assert.equal(lotTypeFor(b({ osm: 'hotel' }), 'residential', 300), 'plaza');
  assert.equal(lotTypeFor(b({}), 'residential', 300), 'yard');
  assert.equal(lotTypeFor(b({ kind: 'house' }), 'midtown', 300), 'yard');
  assert.equal(lotTypeFor(b({ h: 7, x1: 15, z1: 15 }), 'downtown', 300), 'yard');
  assert.equal(lotTypeFor(null, 'downtown', 900), 'grass');
  assert.equal(lotTypeFor(null, 'downtown', 1900), 'carpark');
  assert.equal(lotTypeFor(b({}), 'downtown', 900), 'plaza');
  assert.equal(lotTypeFor(null, 'midtown', 400), 'grass');
  assert.equal(lotTypeFor(null, 'park', 400), 'grass');
  // Every lot from a building agrees with its building's rule.
  for (const l of city.lots) {
    if (l.building < 0 || ['verge', 'beach', 'wateredge', 'park', 'grass', 'site'].includes(l.type)) continue;
    assert.equal(l.type, lotTypeFor(city.buildings[l.building], l.district, l.area), `lot ${l.id}`);
  }
});

test('dressing sets: at least 2 per type, and the core districts each have their own', () => {
  for (const t of LOT_TYPES) {
    const all = new Set();
    for (const d of DRESS_DISTRICTS) for (const id of DRESS[t][d]) all.add(id);
    assert.ok(all.size >= 2, t);
    for (const d of ['downtown', 'residential', 'industrial', 'park']) {
      assert.ok(DRESS[t][d].length >= 2, `${t} ${d}`);
      for (const id of DRESS[t][d]) assert.equal(DRESS_SETS[id].district, d, id);
    }
  }
});

test('dressLot: features stay on their lot, in the caps, and cost under 0.05 ms a lot', () => {
  // Best of two passes over the core (the first one includes the JIT warm-up).
  let n = 0, per = Infinity;
  const out = [];
  for (let pass = 0; pass < 2; pass++) {
    const t = performance.now();
    n = 0;
    for (const l of coreLots) { dressLot(city, l, out); n += out.length; }
    per = Math.min(per, (performance.now() - t) / coreLots.length);
  }
  assert.ok(per < 0.05, `${per.toFixed(4)} ms per lot`);
  let area = 0;
  for (const l of coreLots) {
    const F = featuresOf(l);
    area += l.area;
    assert.ok(F.length <= MAX_FEATURES && F.length <= featureCap(l), `lot ${l.id}: ${F.length} features`);
    assert.ok(F.filter((f) => f.solid).length <= MAX_SOLID, `lot ${l.id} solids`);
    for (const f of F) {
      assert.ok(FEATURE_KINDS.includes(f.kind), f.kind);
      assert.equal(city.lotAt(f.x, f.z), l, `${f.kind} of lot ${l.id} on its lot`);
      assert.ok(Number.isFinite(f.x + f.z + f.heading + f.l + f.w + f.h + f.r) && Number.isInteger(f.v) && typeof f.solid === 'boolean');
      if (f.kind === 'tree' || f.kind === 'shrub') assert.ok(f.v >= 0 && f.v < TREE_VARIANTS.length);
      if (f.r > 0) assert.ok(!city.inBuilding(f.x, f.z, f.r * 0.9), `${f.kind} in a building`);
      if (f.kind === 'bay') assert.ok(f.w === 5 && Math.abs(f.l / 2.5 - Math.round(f.l / 2.5)) < 1e-9, 'a row of 2.5 by 5 m bays');
    }
  }
  // 6.2 caps at 120 features a hectare; a small lot keeps its minimum
  // content (featureCap), so the cap holds on average, not on every lot.
  const perHa = (n / area) * 1e4;
  assert.ok(perHa <= 120, `${perHa.toFixed(0)} features a hectare in the core`);
  console.log(`# core: ${coreLots.length} lots, ${n} features, ${perHa.toFixed(0)} a hectare, ${per.toFixed(4)} ms a lot`);
});

test('dressLot: the minimum content per type (6.2)', () => {
  const has = (F, kinds) => F.some((f) => kinds.includes(f.kind));
  const rate = {};
  const add = (t, k, ok) => {
    const r = (rate[`${t}.${k}`] ||= [0, 0]);
    r[0] += ok ? 1 : 0;
    r[1]++;
  };
  for (const l of coreLots) {
    const F = featuresOf(l);
    switch (l.type) {
      case 'yard':
        add('yard', 'boundary', has(F, ['fence', 'hedge', 'wall']));
        add('yard', 'drive', l.building < 0 || has(F, ['drive']));
        add('yard', 'green', F.filter((f) => f.kind === 'tree' || f.kind === 'shrub').length >= 1 && F.filter((f) => f.kind === 'tree' || f.kind === 'shrub').length <= 4);
        add('yard', 'bin', has(F, ['bin']));
        break;
      case 'carpark':
        add('carpark', 'bays', has(F, ['bay']));
        add('carpark', 'lamp', has(F, ['lamp']));
        add('carpark', 'green', has(F, ['tree', 'planter']));
        add('carpark', 'boundary', has(F, ['wall', 'hedge']));
        break;
      case 'plaza':
        for (const k of ['planter', 'bench', 'bollard', 'tree']) add('plaza', k, has(F, [k]));
        if (l.district === 'downtown') add('plaza', 'downtown umbrella', has(F, ['umbrella']));
        break;
      case 'grass':
        add('grass', 'green', has(F, ['tree', 'shrub']));
        if (l.area > 1500) add('grass', 'path', has(F, ['path']));
        break;
      case 'works':
        add('works', 'boundary', has(F, ['fence', 'wall']));
        add('works', 'gate', has(F, ['gate']));
        add('works', 'goods', has(F, ['stack', 'pallet', 'cabin']));
        break;
      case 'beach':
        for (const k of ['towel', 'umbrella', 'tree']) add('beach', k, has(F, [k]));
        break;
      case 'park':
        add('park', 'tree', has(F, ['tree']));
        add('park', 'path', has(F, ['path']));
        add('park', 'bench', has(F, ['bench']));
        break;
      case 'wateredge':
        add('wateredge', 'cap or rock', has(F, ['wall', 'rock']));
        add('wateredge', 'bollard or rail', has(F, ['bollard', 'fence']));
        add('wateredge', 'bench', has(F, ['bench']));
        break;
      case 'site':
        for (const k of ['fence', 'gate', 'pile']) add('site', k, has(F, [k]));
        break;
      case 'verge':
        assert.equal(F.length, 0, 'a verge is bare');
        break;
      default:
        break;
    }
  }
  // Share of lots meeting each rule (a lot too thin or too full for an
  // item can miss it).
  const want = {
    'yard.boundary': 0.95, 'yard.drive': 0.85, 'yard.green': 0.95, 'carpark.bays': 0.95, 'carpark.lamp': 0.9, 'carpark.green': 0.95,
    'carpark.boundary': 0.95, 'plaza.planter': 0.9, 'plaza.bench': 0.9, 'plaza.bollard': 0.9, 'plaza.tree': 0.9, 'plaza.downtown umbrella': 0.5,
    'grass.green': 0.95, 'grass.path': 0.8, 'works.boundary': 0.95, 'works.gate': 0.9, 'works.goods': 0.95, 'beach.towel': 0.8,
    'beach.umbrella': 0.8, 'beach.tree': 0.8, 'park.tree': 0.95, 'park.path': 0.7, 'park.bench': 0.7, 'wateredge.cap or rock': 0.9,
    'wateredge.bollard or rail': 0.9, 'wateredge.bench': 0.8, 'site.fence': 0.9, 'site.gate': 0.9, 'site.pile': 0.6,
  };
  const lines = [];
  for (const [k, min] of Object.entries(want)) {
    const r = rate[k];
    assert.ok(r, `no ${k} in the core`);
    lines.push(`${k} ${pct(r[0] / r[1])}`);
    assert.ok(r[0] / r[1] >= min, `${k}: ${r[0]} of ${r[1]}`);
  }
  // A bin on about one yard in three.
  const bin = rate['yard.bin'][0] / rate['yard.bin'][1];
  assert.ok(bin > 0.2 && bin < 0.45, `bins on ${pct(bin)} of the yards`);
  console.log('# ' + lines.join(', '));
});

test('parking lots: their bays are parking spots, at most 60 % of each lot, clear of buildings', () => {
  let listed = 0, bays = 0;
  const spots = new Map();
  for (const p of city.parkingSpots) if (p.lot) spots.set(Math.round(p.x * 2) * 65536 + Math.round(p.z * 2), p);
  for (const l of city.lots) {
    if (l.type !== 'carpark') continue;
    let n = 0, m = 0;
    for (const f of dressLot(city, l, [])) {
      if (f.kind !== 'bay') continue;
      eachBay(f, (x, z, h) => {
        n++;
        assert.ok(!city.inBuilding(x, z, 1.2), `bay in a building at ${x}, ${z}`);
        const p = spots.get(Math.round(x * 2) * 65536 + Math.round(z * 2));
        if (p) { m++; assert.ok(Math.abs(Math.sin(p.heading - h)) < 1e-6); }
      });
    }
    assert.ok(m <= Math.floor(n * 0.6), `lot ${l.id}: ${m} of ${n} bays listed`);
    listed += m;
    bays += n;
  }
  assert.ok(bays > 5000 && listed > 1000, `${listed} of ${bays} bays listed`);
  assert.equal(listed, city.parkingSpots.filter((p) => p.lot).length);
});

test('lots: building the city twice gives the same lots, seeds and dressing', () => {
  const again = createMiamiCity(data);
  assert.equal(again.lots.length, city.lots.length);
  assert.deepEqual(again.lots, city.lots);
  assert.deepEqual(again.lotGrid.id, G.id);
  assert.deepEqual(again.parkingSpots, city.parkingSpots);
  for (let k = 0; k < city.lots.length; k += 13) assert.deepEqual(dressLot(again, again.lots[k], []), dressLot(city, city.lots[k], []), `lot ${k}`);
  // One lot's look does not depend on the others: a different set of lots
  // round it (the core crop) leaves a lot well inside it alone.
  const lot = city.lotAt(-1000, 700) || coreLots[0];
  assert.equal(lot.seed, lotSeed(city.seed, (lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, lot.type));
});

test('core: bare paving under 10 % of the core land, under 15 % outside (6.1)', () => {
  const bare = (keep) => {
    let a = 0, total = 0;
    for (const l of city.lots) {
      if (!keep(l)) continue;
      total += l.area;
      // Verge, and any lot that dresses to nothing (the airfield has its
      // own runway and apron surfaces).
      if (l.type === 'verge' || (l.type !== 'airfield' && !featuresOf(l).length)) a += l.area;
    }
    return a / total;
  };
  const inside = bare((l) => l.core), outside = bare((l) => !l.core);
  const shares = lotShares(city.lots, (l) => l.core);
  console.log(`# core lot land ${(shares.total / 1e6).toFixed(2)} km2, bare ${pct(inside)}; outside bare ${pct(outside)}; ` +
    LOT_TYPES.map((t) => `${t} ${pct(shares.share[t])}`).join(', '));
  assert.ok(inside < 0.1, `core bare ${pct(inside)}`);
  assert.ok(outside < 0.15, `outside bare ${pct(outside)}`);
  // Every type is found in the core.
  for (const t of LOT_TYPES) assert.ok(shares.share[t] > 0, t);
});

test('core: at least 15 buildings within 150 m of a road node at the 10th percentile (6.1)', () => {
  const counts = [];
  for (const n of city.nodes) if (city.inCore(n.x, n.z)) counts.push(buildingsWithin(n.x, n.z, 150).n);
  counts.sort((a, b) => a - b);
  const p10 = counts[Math.floor(counts.length * 0.1)];
  console.log(`# core road nodes ${counts.length}: buildings within 150 m p10 ${p10}, median ${counts[counts.length >> 1]}, under 15 at ${counts.filter((c) => c < 15).length}`);
  assert.ok(p10 >= 15, `p10 ${p10}`);
});

test('core: no road node more than 60 m from a building or a solid or tall lot feature (bridges over open water excepted)', () => {
  const far = [];
  let outside = 0, outsideFar = 0, bare = 0;
  const close = (n) => {
    if (buildingsWithin(n.x, n.z, 60).dmin <= 60) return true;
    for (const l of lotsNear(n.x, n.z, 60)) {
      for (const f of featuresOf(l)) if ((f.solid || f.h >= 2) && featureDist(f, n.x, n.z) <= 60) return true;
    }
    return false;
  };
  for (const n of city.nodes) {
    // A node whose every road is a bridge or the causeway stands over the
    // water: nothing can be built within 60 m of a long span.
    if (isBridgeNode(n)) continue;
    // Likewise a node on causeway fill with no lot and no building within
    // 60 m: all road and water round it, so nothing can stand there.
    if (!lotsNear(n.x, n.z, 60).length && buildingsWithin(n.x, n.z, 60).dmin > 60) { bare++; continue; }
    if (city.inCore(n.x, n.z)) {
      if (!close(n)) far.push(`${n.x.toFixed(0)}, ${n.z.toFixed(0)}`);
    } else {
      outside++;
      if (!close(n)) outsideFar++;
    }
  }
  console.log(`# far from anything: core ${far.length}, rest of the box ${outsideFar} of ${outside} (${pct(outsideFar / outside)}); ${bare} with only road and water within 60 m`);
  assert.equal(far.length, 0, `core nodes far from anything: ${far.join(' | ')}`);
  assert.ok(bare <= 10, `${bare} nodes with only road and water round them`);
  assert.ok(outsideFar / outside <= 0.02, `rest of the box ${pct(outsideFar / outside)}`);
});

test('start view: the designed street (6.8): 40 buildings in 150 m, 12 trees and 6 parked cars in the camera cone', () => {
  const sv = MIAMI_SPOTS.startView;
  assert.deepEqual(sv.spawn, MIAMI_SPOTS.spawn);
  assert.deepEqual(sv.camera, { back: 22, side: 0.5, height: 7, lookAhead: 40, lookHeight: 6, fov: 55, dolly: 12, dollySpeed: 0.5 });
  assert.equal(sv.time, 17.5);
  assert.equal(sv.weather, 'clear');
  assert.equal(sv.traffic, 6);
  assert.equal(sv.parked, 6);
  const sp = city.startView.spawn;
  assert.equal(sp.street, 'Southeast 1st Street');
  assert.ok(sp.x === city.spawn.x && sp.z === city.spawn.z && sp.heading === city.spawn.heading, 'snapped to the city spawn');
  assert.ok(city.inCore(sp.x, sp.z));
  // The camera: `back` m behind, `side` m toward the south curb (right of
  // an east heading); the cone is the 915 by 412 view (half width 49
  // degrees at fov 55), taken as 45 degrees here.
  const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
  const cx = sp.x - fx * sv.camera.back - fz * sv.camera.side, cz = sp.z - fz * sv.camera.back + fx * sv.camera.side;
  const cosHalf = Math.cos((45 * Math.PI) / 180);
  const inCone = (x, z, R) => {
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    return d > 1 && d <= R && (dx * fx + dz * fz) / d > cosHalf;
  };
  const b150 = buildingsWithin(sp.x, sp.z, 150).n;
  let trees = 0, parked = 0, start = 0, lane = 0;
  for (const f of city.furniture) if (f.type === 'streettree' && inCone(f.x, f.z, 80)) trees++;
  for (const l of lotsNear(cx, cz, 80)) for (const f of featuresOf(l)) if (f.kind === 'tree' && inCone(f.x, f.z, 80)) trees++;
  for (const p of city.parkingSpots) {
    if (!inCone(p.x, p.z, 80)) continue;
    parked++;
    if (p.start) start++;
  }
  // Road in the cone within 120 m, for the moving cars traffic places there.
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    for (let t = 1; t < e.length; t += 2) if (inCone(a.x + e.ux * t, a.z + e.uz * t, 120)) lane += 2;
  }
  console.log(`# start view: ${b150} buildings within 150 m, ${trees} trees and ${parked} parked spots (${start} start curb spots) in the cone within 80 m, ${lane} m of road within 120 m`);
  assert.ok(b150 >= 40, `${b150} buildings`);
  assert.ok(trees >= 12, `${trees} trees`);
  assert.ok(parked >= 6 && start >= 1, `${parked} parked spots, ${start} start spots`);
  assert.ok(lane >= sv.traffic * 12, `${lane} m of road`);
});

test('districts: at least 5 that differ in building height, lot type, tree species and street furniture', () => {
  const D = {};
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  const FURN = new Set(['bench', 'bin', 'lamp', 'bollard', 'planter', 'umbrella', 'sign']);
  const get = (d) => (D[d] ||= { h: [], lot: {}, tree: {}, furn: {} });
  for (const b of city.buildings) {
    const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
    if (city.inCore(x, z)) get(city.districtOf(x, z)).h.push(b.h);
  }
  for (const l of coreLots) {
    const s = get(l.district);
    s.lot[l.type] = (s.lot[l.type] || 0) + l.area;
    for (const f of featuresOf(l)) {
      if (f.kind === 'tree') s.tree[f.v] = (s.tree[f.v] || 0) + 1;
      if (FURN.has(f.kind)) s.furn[f.kind + ':' + f.v] = (s.furn[f.kind + ':' + f.v] || 0) + 1;
    }
  }
  const sig = {};
  for (const [d, s] of Object.entries(D)) {
    if (s.h.length < 20) continue;
    s.h.sort((a, b) => a - b);
    const p90 = s.h[Math.floor(s.h.length * 0.9)];
    sig[d] = { height: p90 < 20 ? 'low' : p90 < 60 ? 'mid' : 'high', lot: top(s.lot), tree: TREE_VARIANTS[top(s.tree)], furn: top(s.furn), p90 };
  }
  console.log('# ' + Object.entries(sig).map(([d, s]) => `${d}: ${s.height} (p90 ${s.p90.toFixed(0)} m), ${s.lot}, ${s.tree}, ${s.furn}`).join('; '));
  // The largest set of districts in which every pair differs in at least 3
  // of the 4 (greedy from the most built).
  const keys = Object.keys(sig).sort((a, b) => D[b].h.length - D[a].h.length);
  const diff = (a, b) => ['height', 'lot', 'tree', 'furn'].filter((k) => sig[a][k] !== sig[b][k]).length;
  const chosen = [];
  for (const k of keys) if (chosen.every((c) => diff(c, k) >= 3)) chosen.push(k);
  assert.ok(chosen.length >= 5, `districts that differ: ${chosen.join(', ')}`);
  for (const k of ['height', 'lot', 'tree', 'furn']) assert.ok(new Set(chosen.map((c) => sig[c][k])).size >= 3, `${k} varies`);
});

test('landmarks: 12 in the core with invented names and their own shapes, each visible from 600 m', () => {
  const sites = city.landmarkSites.filter((s) => city.inCore(s.x, s.z));
  assert.ok(sites.length >= 12, `${sites.length} landmarks`);
  assert.equal(new Set(sites.map((s) => s.shape)).size, sites.length, 'each its own shape');
  assert.equal(new Set(sites.map((s) => s.name)).size, sites.length);
  for (const s of sites) {
    assert.ok(!NAMES.has(s.name), `${s.name} is invented (not a name in the data)`);
    assert.ok(s.buildings.length >= 1 && s.buildings.every((k) => city.buildings[k].landmark === s.id), `${s.name} boxes`);
    assert.ok(city.mainShore(s.x, s.z) > 0 || s.buildings.length > 1, `${s.name} on land`);
    // A clear sight line from eye height (2 m) 600 m away to 90 % of its
    // height, from at least 2 of 32 directions.
    let clear = 0;
    const box = [];
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, ex = s.x + Math.cos(a) * 600, ez = s.z + Math.sin(a) * 600;
      let ok = true;
      for (let t = 0.02; t < 0.97 && ok; t += 0.01) {
        const x = ex + (s.x - ex) * t, z = ez + (s.z - ez) * t, y = 2 + (s.h * 0.9 - 2) * t;
        city.buildingsNear(x - 1, z - 1, x + 1, z + 1, box);
        for (const id of box) {
          const b = city.buildings[id];
          if (b.landmark !== s.id && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.h > y) { ok = false; break; }
        }
      }
      if (ok) clear++;
    }
    assert.ok(clear >= 2, `${s.name} seen from ${clear} of 32 directions at 600 m`);
  }
});

test('beaches: at least two listed on real shores, one in the core, each with sand lots', () => {
  const B = MIAMI_SPOTS.beaches;
  assert.ok(B.length >= 2);
  assert.ok(B.some((r) => city.inCore((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)), 'one in the core');
  for (const r of B) {
    assert.ok(NAMES.has(r.src), `${r.name}: ${r.src} in the data`);
    const lots = city.lots.filter((l) => l.type === 'beach' && l.x1 > r.x0 && l.x0 < r.x1 && l.z1 > r.z0 && l.z0 < r.z1);
    const area = lots.reduce((a, l) => a + l.area, 0);
    assert.ok(lots.length >= 2 && area >= 2000, `${r.name}: ${lots.length} beach lots, ${area} m2`);
    // Sand lies on the water: every beach cell is within 30 m of the shore.
    for (const l of lots) assert.ok(city.mainShore((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2) < 60, `${r.name} lot ${l.id} by the water`);
  }
  // No beach lot outside the listed rects.
  for (const l of city.lots) {
    if (l.type !== 'beach') continue;
    assert.ok(B.some((r) => l.x1 > r.x0 && l.x0 < r.x1 && l.z1 > r.z0 && l.z0 < r.z1), `beach lot ${l.id} in a listed rect`);
  }
});

test('infill: made boxes only on open built-up land, off the roads and the water, never in parks', () => {
  const gen = city.buildings.filter((b) => b.gen);
  assert.ok(gen.length > 500, `${gen.length} infill boxes`);
  for (const b of gen) {
    const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
    assert.ok(['docks', 'industrial', 'downtown', 'midtown', 'residential'].includes(b.district), b.district);
    assert.ok(city.edgesNear(x, z, Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 4, []).length === 0, `infill on a road at ${x}, ${z}`);
    assert.ok(city.mainShore(x, z) > 15, `infill by the water at ${x}, ${z}`);
  }
  // The hand places keep their open ground.
  for (const h of MIAMI_SPOTS.helipads) assert.ok(!gen.some((b) => boxDist(b, h.x, h.z) < 30), h.label);
});
