// Parking lot cars (docs/PLAN_V3.md 1.3, 2.6, 6 item 1): no box cars in the
// tile, the fill by lot type and hour, the cap in view, the rounded hull,
// and the same cars for the same lot and seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import {
  drawLotFeatures, createLotCarField, buildLotHull, lotCarAt, lotCarColor, LOT_CAR_SPECS, LOT_CAR_CAP, LOT_CAR_CAP_MAX, LOT_CAR_MIX,
} from '../src/render/lotmesh.js';
import { lotFill, FILL_MIN, FILL_MAX, FILL_BY_DISTRICT, eachBay, dressLot, CARPARK_BAYS_MAPPED, CARPARK_MIN, isMappedParking } from '../src/world/lots.js';
import { createMiamiCity } from '../src/world/miami.js';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const parkingLots = city.lots.filter((l) => l.type === 'carpark');

const KEYS = ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand', 'paint', 'ao', 'props', 'solid', 'detail', 'glow', 'trees', 'treesDetail', 'plain'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};
const trisOf = (b) => { let n = 0; for (const mb of b.map.values()) n += mb.idx.length / 3; return n; };

test('a lot tile draws bay lines and no car of any kind (no three-box cars)', () => {
  let bayFeats = 0;
  for (const lot of parkingLots.slice(0, 60)) {
    const feats = dressLot(city, lot, []).filter((f) => f.kind === 'bay');
    if (!feats.length) continue;
    bayFeats += feats.length;
    const B = builders();
    const C = { city, R: {}, props: B.props, solid: B.solid, detail: B.detail, paint: B.paint, sidewalk: B.sidewalk, ao: B.ao, glow: B.glow, trees: B.trees, treesDetail: B.treesDetail };
    drawLotFeatures(C, lot, feats, feats.length, null);
    assert.ok(trisOf(B.paint) > 0, 'the lines are there');
    for (const k of KEYS) if (k !== 'paint') assert.equal(trisOf(B[k]), 0, `${k} holds nothing for bays (lot ${lot.id})`);
  }
  assert.ok(bayFeats > 20, `${bayFeats} bay rows checked`);
});

// 0.11.0 (docs/PLAN_V3.md 13, LOTS): surface parking is the commonest use of
// a big piece of open land downtown, so parking lots are no longer rarer
// than the mapped ones. What holds: every mapped one is a parking lot, a
// lot's bays never take more than half its area (12.5 m2 a bay) nor stand
// in more than 256 (the half of the largest lot), and the cars in view stay
// capped (the field tests below).
test('parking lots: every mapped one is a parking lot; bays take at most half a lot, 256 at most', () => {
  const mapped = parkingLots.filter((l) => l.building >= 0 && isMappedParking(city.buildings[l.building]));
  assert.ok(mapped.length > 50, `${mapped.length} mapped parking lots`);
  for (const l of city.lots) {
    if (l.building >= 0 && isMappedParking(city.buildings[l.building]) && l.area >= CARPARK_MIN && !['site', 'airfield', 'works', 'verge', 'beach', 'wateredge', 'park', 'grass'].includes(l.type)) assert.equal(l.type, 'carpark', `mapped lot ${l.id}`);
  }
  let max = 0, total = 0;
  for (const l of parkingLots) {
    let n = 0;
    for (const f of dressLot(city, l, [])) if (f.kind === 'bay') eachBay(f, () => n++);
    assert.ok(n * 12.5 <= l.area * 0.5 + 1e-6 || n <= CARPARK_BAYS_MAPPED, `lot ${l.id}: ${n} bays on ${l.area} m2`);
    max = Math.max(max, n);
    total += n;
  }
  assert.ok(max <= 256, `largest lot ${max} bays`);
  console.log(`# ${parkingLots.length} parking lots (${mapped.length} mapped), ${(total / parkingLots.length).toFixed(1)} bays a lot, the largest ${max}`);
});

// 0.13.8: "never empty" (FILL_MIN 0.2) is gone on purpose: the owner saw
// "lots of car filled lots all over town" on two phones, and a real city has
// lots empty at night and some empty by chance. What the test protected is
// kept: never full (FILL_MAX under 0.6, the collision world's limit), the
// day and night shape by district, half hours; and it now also pins the
// spread over the real lots (some nearly empty, none crowded, nights emptier).
test('fill: by lot type and hour, never full, often empty at night', () => {
  const lot = (district, seed = 0x8000) => ({ district, seed });
  for (const d of Object.keys(FILL_BY_DISTRICT).concat(['nowhere'])) {
    for (let h = 0; h < 24; h += 0.25) {
      for (const seed of [0, 0x4000, 0xffff]) {
        const f = lotFill(lot(d, seed), h);
        assert.ok(f >= FILL_MIN && f <= FILL_MAX && FILL_MAX < 0.6 && FILL_MIN >= 0, `${d} ${h}: ${f}`);
      }
    }
  }
  // The real lots of the whole box at noon and at 2 am.
  const spread = (h, keep = () => true) => {
    const ls = parkingLots.filter(keep);
    let sum = 0, low = 0, high = 0;
    for (const l of ls) {
      const f = lotFill(l, h);
      sum += f;
      if (f < 0.1) low++;
      if (f > 0.5) high++;
    }
    return { mean: sum / ls.length, low: low / ls.length, high: high / ls.length };
  };
  const noon = spread(13), night = spread(2, (l) => l.district !== 'residential');
  assert.ok(noon.mean > 0.25 && noon.mean < 0.45, `noon mean ${noon.mean}`);
  assert.ok(noon.low > 0.05 && noon.low < 0.25, `noon: ${noon.low} of the lots nearly empty`);
  assert.ok(noon.high < 0.15, `noon: ${noon.high} of the lots over half full`);
  assert.ok(night.mean < 0.12 && night.low > 0.6, `night: mean ${night.mean}, ${night.low} nearly empty`);
  assert.ok(spread(13, (l) => l.district === 'downtown').mean > spread(13, (l) => l.district === 'midtown').mean, 'downtown fuller than midtown by day');
  assert.ok(lotFill(lot('downtown'), 13) > lotFill(lot('downtown'), 2) + 0.15, 'offices empty out at night');
  assert.ok(lotFill(lot('residential'), 2) > lotFill(lot('residential'), 13) + 0.1, 'homes fill up at night');
  assert.ok(lotFill(lot('beach'), 14) > lotFill(lot('beach'), 3), 'the beach is a day place');
  assert.equal(lotFill(lot('midtown'), 13), lotFill(lot('midtown'), 13.2), 'half hours');
});

// A camera on a big mapped parking lot, looking along it.
const biggest = parkingLots.map((l) => {
  let n = 0;
  for (const f of dressLot(city, l, [])) if (f.kind === 'bay') eachBay(f, () => n++);
  return [n, l];
}).sort((a, b) => b[0] - a[0])[0];
const bigLot = biggest[1];
const cam = { x: (bigLot.x0 + bigLot.x1) / 2, z: (bigLot.z0 + bigLot.z1) / 2 };

test('the field: at most the cap in view, nearest first, ahead of the camera', () => {
  const field = createLotCarField(city);
  for (const cap of [10, LOT_CAR_CAP, LOT_CAR_CAP_MAX, 200]) {
    const n = field.update(cam.x, cam.z, 1, 0, 13, cap);
    assert.ok(n <= Math.min(cap, LOT_CAR_CAP_MAX), `${n} cars for cap ${cap}`);
    assert.equal(field.n, n);
    for (let i = 1; i < n; i++) assert.ok(field.dist[i] >= field.dist[i - 1]);
    for (let i = 0; i < n; i++) {
      const dx = field.x[i] - cam.x, dz = field.z[i] - cam.z, d = Math.hypot(dx, dz);
      assert.ok(d < 151 && (d < 15 || dx > 0.5 * d), 'in view');
    }
  }
  assert.equal(LOT_CAR_CAP, 40);
  assert.equal(LOT_CAR_CAP_MAX, 60);
});

test('the field: deterministic, varied, never overlapping, some bays empty', () => {
  const a = createLotCarField(city), b = createLotCarField(city);
  // Look from the lot's middle along the way with the most cars.
  let best = [1, 0], most = -1;
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = a.update(cam.x, cam.z, d[0], d[1], 13, 60);
    if (n > most) { most = n; best = d; }
  }
  const na = a.update(cam.x, cam.z, best[0], best[1], 13, 60), nb = b.update(cam.x, cam.z, best[0], best[1], 13, 60);
  assert.equal(na, nb);
  assert.ok(na >= 6, `${na} cars`);
  for (let i = 0; i < na; i++) {
    assert.equal(a.x[i], b.x[i]); assert.equal(a.yaw[i], b.yaw[i]); assert.equal(a.color[i], b.color[i]); assert.equal(a.spec[i], b.spec[i]);
  }
  // A second update with the same arguments gives the same cars.
  const first = Array.from(a.x.slice(0, na));
  a.update(cam.x, cam.z, best[0], best[1], 13, 60);
  assert.deepEqual(Array.from(a.x.slice(0, na)), first);
  const colors = new Set(), specs = new Set(), yaws = new Set();
  for (let i = 0; i < na; i++) {
    colors.add(a.color[i]); specs.add(a.spec[i]); yaws.add(Math.round(a.yaw[i] * 100));
    for (let j = i + 1; j < na; j++) assert.ok(Math.hypot(a.x[i] - a.x[j], a.z[i] - a.z[j]) > 2.2, 'two cars in one bay');
  }
  assert.ok(colors.size >= 3 && specs.size >= 2 && yaws.size >= 3, `${colors.size} colors, ${specs.size} models, ${yaws.size} yaws`);
  for (let i = 0; i < na; i++) assert.ok(a.spec[i] < LOT_CAR_SPECS.length);
  // The whole lot, bay by bay: between a fifth and a bit over half hold a car.
  let bays = 0, cars = 0;
  const fill = lotFill(bigLot, 13);
  for (const f of dressLot(city, bigLot, [])) {
    if (f.kind !== 'bay') continue;
    eachBay(f, (x, z) => { bays++; if (lotCarAt(city, x, z, f.v, fill) >= 0) cars++; });
  }
  assert.ok(cars / bays > 0.1 && cars / bays < 0.6, `${cars} of ${bays} bays`);
  assert.ok(cars < bays, 'never full');
});

test('the field: the night is emptier at an office lot and fuller at a residential one', () => {
  const count = (district, hour) => {
    let bays = 0, cars = 0;
    for (const lot of parkingLots.filter((l) => l.district === district).slice(0, 60)) {
      const fill = lotFill(lot, hour);
      for (const f of dressLot(city, lot, [])) {
        if (f.kind !== 'bay') continue;
        eachBay(f, (x, z) => { bays++; if (lotCarAt(city, x, z, f.v, fill) >= 0) cars++; });
      }
    }
    return cars / Math.max(1, bays);
  };
  for (const d of ['downtown', 'midtown']) {
    if (parkingLots.some((l) => l.district === d)) assert.ok(count(d, 13) > count(d, 2), d);
  }
});

test('lot car paint comes from the fleet palette, models from the district mix', () => {
  for (const d of Object.keys(LOT_CAR_MIX)) for (const id of LOT_CAR_MIX[d]) assert.ok(VEHICLE_SPECS[id], id);
  for (let si = 0; si < LOT_CAR_SPECS.length; si++) {
    const allowed = new Set([...VEHICLE_SPECS[LOT_CAR_SPECS[si]].colors, 0xe8e8e6, 0x24272b]);
    for (let k = 0; k < 20; k++) assert.ok(allowed.has(lotCarColor(si, k / 20)));
  }
});

// Vertical rays down through the hull: the height field over the footprint.
function heightField(h, L, W, nx = 40, nz = 16) {
  const rows = [];
  const P = (i) => [h.pos[i * 3], h.pos[i * 3 + 1], h.pos[i * 3 + 2]];
  for (let a = 0; a < nx; a++) {
    for (let c = 0; c < nz; c++) {
      const x = -L / 2 + ((a + 0.5) / nx) * L, z = -W / 2 + ((c + 0.5) / nz) * W;
      let top = 0;
      for (let t = 0; t < h.idx.length; t += 3) {
        const A = P(h.idx[t]), B = P(h.idx[t + 1]), C = P(h.idx[t + 2]);
        // Barycentric in x, z.
        const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d;
        const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        top = Math.max(top, l1 * A[1] + l2 * B[1] + l3 * C[1]);
      }
      rows.push(top);
    }
  }
  return rows;
}

test('the hull is a rounded car, not a box: triangles, fill, crown, glass band', () => {
  for (const id of LOT_CAR_SPECS) {
    const spec = VEHICLE_SPECS[id];
    const h = buildLotHull(spec);
    assert.ok(h.tris >= 200 && h.tris <= 700, `${id}: ${h.tris} triangles`);
    assert.equal(h.pos.length, h.nor.length);
    assert.equal(h.col.length, h.pos.length);
    assert.ok(Math.max(...h.idx) < h.pos.length / 3);
    // Bounding box close to the spec's size (wheels and bumpers inside it).
    let x0 = 9, x1 = -9, y1 = 0, z1 = 0;
    for (let i = 0; i < h.pos.length; i += 3) { x0 = Math.min(x0, h.pos[i]); x1 = Math.max(x1, h.pos[i]); y1 = Math.max(y1, h.pos[i + 1]); z1 = Math.max(z1, Math.abs(h.pos[i + 2])); }
    assert.ok(Math.abs(x1 - x0 - spec.length) < 0.3, `${id} length ${(x1 - x0).toFixed(2)}`);
    assert.ok(y1 <= spec.height + 0.12 && y1 >= spec.height - 0.1, `${id} height ${y1.toFixed(2)}`);
    assert.ok(z1 <= spec.width / 2 + 0.01 && z1 >= spec.width / 2 - 0.1, `${id} width ${z1.toFixed(2)}`);
    // Fill: the volume under the top surface over the bounding box.
    const hf = heightField(h, spec.length, spec.width);
    const fill = hf.reduce((s, v) => s + Math.max(0, v - 0.17), 0) / hf.length / (spec.height - 0.17);
    assert.ok(fill <= 0.7 && fill >= 0.3, `${id}: fill ${fill.toFixed(2)}`);
    // The roof is narrower than the body (tumblehome), a glass band exists
    // and so do dark wheels.
    let glass = 0, paint = 0, dark = 0, roofW = 0;
    for (let i = 0; i < h.col.length; i += 3) {
      const c = h.col[i];
      if (c === 1) paint++; else if (c < 0.03) glass++; else dark++;
      if (h.pos[i + 1] > spec.height * 0.9) roofW = Math.max(roofW, Math.abs(h.pos[i + 2]));
    }
    assert.ok(glass > 30 && paint > 100 && dark > 20, `${id}: ${paint} paint, ${glass} glass, ${dark} dark vertices`);
    assert.ok(roofW * 2 <= spec.width * 0.82, `${id}: roof width ${(roofW * 2).toFixed(2)} of ${spec.width}`);
    // Sharpest turn of the side outline along the top (x, max y) stays
    // under 60 degrees between neighbors, and the outline has many points.
    const cols = new Map();
    for (let i = 0; i < h.pos.length; i += 3) {
      if (Math.abs(h.pos[i + 2]) > 0.02 && Math.abs(h.pos[i + 2]) < spec.width * 0.15) continue;
      const k = Math.round(h.pos[i] * 50);
      cols.set(k, Math.max(cols.get(k) || 0, h.pos[i + 1]));
    }
    assert.ok(cols.size >= 12, `${id}: ${cols.size} outline points`);
  }
});
