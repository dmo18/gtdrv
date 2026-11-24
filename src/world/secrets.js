// Hidden secrets: six odd spots on the island, and the lock-up garage
// that the sixth one gives away. Pure logic (no three.js, no DOM): the
// spot finder reads the city layout and a fixed seed, so the same island
// always hides them in the same places. systems/secrets.js watches the
// player and draws them; docs/SPEC.md "Secrets" describes the rules.
//
// Coordinates: x east, z south, meters. Heading 0 faces +x.
import { createRng, TAU } from '../core/rng.js';

export const SECRETS_SEED = 4417;
export const DISCOVER_R = 12; // m: walk or drive this close to find one
export const SECRET_BONUS = 750; // points for each secret
export const FINALE_BONUS = 2500; // extra for the sixth
export const HINT_FUZZ = 55; // m: how far the faint map marker is off

// One entry per secret, in the order they are listed in Records.
export const SECRET_DEFS = [
  { id: 'drowned-box', name: 'The Drowned Box', kind: 'container', note: 'A shipping container sinking just off the Saltyard shore.' },
  { id: 'roof-garden', name: 'Roof Garden', kind: 'rooftop', note: 'Somebody keeps a lounge on a rooftop nobody can walk up to.' },
  { id: 'the-gullet', name: 'The Gullet', kind: 'cave', note: 'A sea cave cut into the rocks of the coast.' },
  { id: 'rustlamp', name: 'Rustlamp Rock', kind: 'lighthouse', note: 'A rusted lighthouse on the farthest headland.' },
  { id: 'tag-alley', name: 'Tag Alley', kind: 'alley', note: 'A narrow alley with a tag that was not there yesterday.' },
  { id: 'lone-ride', name: 'The Lone Ride', kind: 'playground', note: 'A playground in the park with one ride too many.' },
];
export const SECRET_IDS = SECRET_DEFS.map((d) => d.id);
export const GARAGE_NAME = 'Ghostwake';

const DIST = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// Distance from a point to a rectangle (0 inside it).
function rectDist(r, x, z) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

const nearList = (list, x, z, d) => list.some((r) => rectDist(r, x, z) < d);

// True when a disc of radius r around (x, z) is open ground: no building,
// tree, bench, road or airfield inside it, and at least `shore` meters of
// land to the sea.
function openGround(city, x, z, r, shore = 0) {
  if (city.districtOf(x, z) === 'airfield') return false;
  if (city.mainShore(x, z) < Math.max(shore, 3)) return false;
  const b = city.buildings;
  for (let i = 0; i < b.length; i++) if (rectDist(b[i], x, z) < r) return false;
  const p = city.props;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    if (q.type === 'lamp') continue;
    if (Math.abs(q.x - x) < r + 1 && Math.abs(q.z - z) < r + 1 && DIST(q.x, q.z, x, z) < r + (q.r || 0.5)) return false;
  }
  const f = city.furniture;
  for (let i = 0; i < f.length; i++) {
    if (Math.abs(f[i].x - x) < r && Math.abs(f[i].z - z) < r && DIST(f[i].x, f[i].z, x, z) < r) return false;
  }
  if (city.onRoad(x, z)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    if (city.onRoad(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
  }
  return true;
}

// A point on the coast, `want` meters inside the shoreline, at angle theta
// from the island center. `heading` points out to sea.
function shorePoint(city, theta, want) {
  const c = Math.cos(theta), s = Math.sin(theta);
  let r = city.radiusAt(theta);
  while (r > 50 && city.mainShore(c * r, s * r) < want) r -= 1;
  return { x: c * r, z: s * r, heading: theta };
}

function shoreCandidates(city, rng, want) {
  const out = [];
  const offset = rng.range(0, 3);
  const extra = city.extraLand || [];
  for (let k = 0; k < 120; k++) {
    const theta = ((k * 3 + offset) * Math.PI) / 180;
    const p = shorePoint(city, theta, want);
    if (city.districtOf(p.x, p.z) === 'airfield') continue;
    if (nearList(city.piers, p.x, p.z, 45)) continue;
    if (nearList(extra, p.x, p.z, 160)) continue;
    if (city.boatSpots.some((s) => DIST(s.x, s.z, p.x, p.z) < 45)) continue;
    if (!openGround(city, p.x, p.z, 8, 0)) continue;
    out.push(p);
  }
  return out;
}

// Pick from `list` something at least `sep` meters from every spot in
// `taken`, easing the separation if nothing fits.
function pickApart(rng, list, taken, seps = [260, 160, 80, 0]) {
  for (const sep of seps) {
    const ok = list.filter((c) => taken.every((t) => DIST(t.x, t.z, c.x, c.z) >= sep));
    if (ok.length) return rng.pick(ok);
  }
  return list.length ? rng.pick(list) : null;
}

function findAlley(city, rng, taken) {
  const bl = city.buildings.filter((b) => b.district !== 'airfield' && b.kind !== 'container' && b.h >= 5);
  const found = [];
  const clearGap = (x0, z0, x1, z1, a, b) => !bl.some((o) => o !== a && o !== b && o.x0 < x1 && o.x1 > x0 && o.z0 < z1 && o.z1 > z0);
  for (let i = 0; i < bl.length; i++) {
    const A = bl[i];
    for (let j = i + 1; j < bl.length; j++) {
      const B = bl[j];
      // Gap along x (buildings side by side): the alley runs along z.
      let lo = A, hi = B;
      if (A.x0 > B.x0) { lo = B; hi = A; }
      let gap = hi.x0 - lo.x1;
      let ov = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
      if (gap >= 3 && gap <= 8 && ov >= 14 && clearGap(lo.x1, Math.max(A.z0, B.z0), hi.x0, Math.min(A.z1, B.z1), A, B)) {
        const z = (Math.max(A.z0, B.z0) + Math.min(A.z1, B.z1)) / 2;
        // The tag goes on the west wall (lo), facing east into the gap.
        found.push({ x: (lo.x1 + hi.x0) / 2, z, heading: Math.PI / 2, gap, len: ov, tag: { x: lo.x1, z, nx: 1, nz: 0 }, district: A.district });
      }
      // Gap along z: the alley runs along x.
      lo = A;
      hi = B;
      if (A.z0 > B.z0) { lo = B; hi = A; }
      gap = hi.z0 - lo.z1;
      ov = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      if (gap >= 3 && gap <= 8 && ov >= 14 && clearGap(Math.max(A.x0, B.x0), lo.z1, Math.min(A.x1, B.x1), hi.z0, A, B)) {
        const x = (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2;
        found.push({ x, z: (lo.z1 + hi.z0) / 2, heading: 0, gap, len: ov, tag: { x, z: lo.z1, nx: 0, nz: 1 }, district: A.district });
      }
    }
  }
  const good = found.filter((f) => ['downtown', 'midtown', 'docks', 'industrial'].includes(f.district));
  const pool = (good.length ? good : found).sort((p, q) => q.len - p.len || p.x - q.x || p.z - q.z).slice(0, 14);
  const near = (c) => taken.every((t) => DIST(t.x, t.z, c.x, c.z) >= 120);
  const far = pool.filter(near);
  return far.length ? rng.pick(far) : pool.length ? rng.pick(pool) : null;
}

function findRooftop(city, rng, taken) {
  const pool = [];
  for (let bIdx = 0; bIdx < city.buildings.length; bIdx++) {
    const b = city.buildings[bIdx];
    if (b.kind !== 'building' || b.district === 'airfield') continue;
    if (b.h < 9 || b.h > 20 || b.x1 - b.x0 < 14 || b.z1 - b.z0 < 14) continue;
    const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
    if (taken.some((t) => DIST(t.x, t.z, x, z) < 120)) continue;
    pool.push({ b, x, z });
  }
  pool.sort((p, q) => Math.abs(p.b.h - 12) - Math.abs(q.b.h - 12) || p.x - q.x || p.z - q.z);
  const top = pool.slice(0, 14);
  if (!top.length) return null;
  const c = rng.pick(top);
  return { x: c.x, z: c.z, roofY: c.b.h, heading: rng.range(0, TAU), roof: { x0: c.b.x0, z0: c.b.z0, x1: c.b.x1, z1: c.b.z1 } };
}

function findPlayground(city, rng, taken) {
  const parks = city.blocks.filter((b) => b.district === 'park' && b.x1 - b.x0 > 40 && b.z1 - b.z0 > 40);
  const pool = parks.length ? parks : city.blocks.filter((b) => b.district === 'residential' && b.x1 - b.x0 > 60);
  const order = pool.slice().sort((p, q) => p.id - q.id);
  const blocks = order.filter((b) => taken.every((t) => DIST(t.x, t.z, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) >= 120));
  const block = rng.pick(blocks.length ? blocks : order);
  if (!block) return null;
  let best = { x: (block.x0 + block.x1) / 2, z: (block.z0 + block.z1) / 2, d: -1 };
  for (let k = 0; k < 70; k++) {
    const x = rng.range(block.x0 + 14, block.x1 - 14), z = rng.range(block.z0 + 14, block.z1 - 14);
    let d = Infinity;
    for (const p of city.props) d = Math.min(d, DIST(p.x, p.z, x, z));
    for (const f of city.furniture) d = Math.min(d, DIST(f.x, f.z, x, z) * 1.4);
    if (d > best.d) best = { x, z, d };
  }
  return { x: best.x, z: best.z, heading: rng.range(0, TAU) };
}

// The lock-up garage: footprint, wall boxes (x0, z0, x1, z1, h) and where
// the car is parked. The roller door is at the front, facing `heading`.
export const GARAGE_DEPTH = 9;
export const GARAGE_HALF = 2.6; // inner half width
const WALL = 0.4;

export function garageGeometry(ox, oz, heading) {
  const dx = Math.round(Math.cos(heading)), dz = Math.round(Math.sin(heading));
  const px = -dz, pz = dx;
  const W = (f, s) => [ox + dx * f + px * s, oz + dz * f + pz * s];
  const box = (f0, f1, s0, s1, h) => {
    const a = W(f0, s0), b = W(f1, s1);
    return { x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]), h };
  };
  const D = GARAGE_DEPTH, H = GARAGE_HALF;
  const car = W(-D / 2, 0);
  const c = W(-D / 2, 0);
  return {
    x: c[0], z: c[1], heading, ox, oz,
    carX: car[0], carZ: car[1],
    walls: [
      box(-D - WALL, -D, -H - WALL, H + WALL, 4),
      box(-D, 0, -H - WALL, -H, 4),
      box(-D, 0, H, H + WALL, 4),
    ],
    door: box(-0.15, 0.15, -H, H, 3),
    footprint: box(-D - WALL, 2.5, -H - WALL, H + WALL, 4),
  };
}

function findGarage(city, rng, taken) {
  const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const tryAt = (x, z) => {
    if (!openGround(city, x, z, 12, 12)) return null;
    const turn = rng.int(0, 3);
    for (let q = 0; q < 4; q++) {
      const h = dirs[(q + turn) % 4];
      const ox = x + Math.cos(h) * 4.5, oz = z + Math.sin(h) * 4.5;
      // Open ground in front of the door so the car can drive out.
      if (!openGround(city, ox + Math.cos(h) * 8, oz + Math.sin(h) * 8, 5, 5)) continue;
      return garageGeometry(ox, oz, h);
    }
    return null;
  };
  const lots = city.parkingSpots.filter((s) => s.lot && city.districtOf(s.x, s.z) === 'industrial');
  const seeds = lots.slice();
  for (let x = 330; x < 700; x += 10) for (let z = -520; z < 520; z += 10) if (city.districtOf(x, z) === 'industrial') seeds.push({ x, z });
  for (const s of seeds) {
    if (taken.some((t) => DIST(t.x, t.z, s.x, s.z) < 100)) continue;
    const g = tryAt(s.x, s.z);
    if (g) return g;
  }
  for (let x = -600; x < 600; x += 16) {
    for (let z = -600; z < 600; z += 16) {
      if (taken.some((t) => DIST(t.x, t.z, x, z) < 100)) continue;
      const g = tryAt(x, z);
      if (g) return g;
    }
  }
  return null;
}

// ---- a real map: hand-placed spots (world/miami-spots.js) ---------------------
// The same open-ground test, with the building grid of a real map.
const NEAR = [];
export function openGroundNear(city, x, z, r, shore = 0) {
  if (city.districtOf(x, z) === 'airfield') return false;
  if (city.mainShore(x, z) < Math.max(shore, 3)) return false;
  city.buildingsNear(x - r - 1, z - r - 1, x + r + 1, z + r + 1, NEAR);
  for (let i = 0; i < NEAR.length; i++) if (rectDist(city.buildings[NEAR[i]], x, z) < r) return false;
  const p = city.props;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    if (q.type === 'lamp') continue;
    if (Math.abs(q.x - x) < r + 1 && Math.abs(q.z - z) < r + 1 && DIST(q.x, q.z, x, z) < r + (q.r || 0.5)) return false;
  }
  const f = city.furniture;
  for (let i = 0; i < f.length; i++) {
    if (Math.abs(f[i].x - x) < r && Math.abs(f[i].z - z) < r && DIST(f[i].x, f[i].z, x, z) < r) return false;
  }
  if (city.onRoad(x, z)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    if (city.onRoad(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
  }
  if (city.piers && nearList(city.piers, x, z, r + 6)) return false;
  return true;
}

// Heading from (x, z) straight out to sea (down the shore field).
function seaward(city, x, z) {
  const gx = city.shoreDist(x + 3, z) - city.shoreDist(x - 3, z);
  const gz = city.shoreDist(x, z + 3) - city.shoreDist(x, z - 3);
  return Math.atan2(-gz, -gx);
}

// Spiral out from (x, z) in 4 m steps to `maxR`; the first point `ok`
// accepts wins (nearest ring first, then by angle).
function nearestWhere(x, z, maxR, ok) {
  if (ok(x, z)) return { x, z };
  for (let r = 4; r <= maxR; r += 4) {
    const n = Math.max(8, Math.round((TAU * r) / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const px = Math.round((x + Math.cos(a) * r) * 10) / 10, pz = Math.round((z + Math.sin(a) * r) * 10) / 10;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

// A spot on open ground `want` meters in from the shore, facing the sea.
function shoreSpot(city, x, z, want, extra = null) {
  const p = nearestWhere(x, z, 220, (px, pz) => {
    const s = city.mainShore(px, pz);
    if (s < want - 1.5 || s > want + 1.5 || !openGroundNear(city, px, pz, 8, 0)) return false;
    return !extra || extra(px, pz, seaward(city, px, pz));
  });
  return p ? { x: p.x, z: p.z, heading: seaward(city, p.x, p.z) } : null;
}

// Buildings whose center is inside `region` (a rect), by the grid.
function buildingsIn(city, region) {
  city.buildingsNear(region.x0, region.z0, region.x1, region.z1, NEAR);
  const out = [];
  for (let i = 0; i < NEAR.length; i++) {
    const b = city.buildings[NEAR[i]];
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (cx > region.x0 && cx < region.x1 && cz > region.z0 && cz < region.z1) out.push(b);
  }
  return out.sort((p, q) => p.x0 - q.x0 || p.z0 - q.z0);
}

// The longest 3 to 8 m gap between two buildings of the region, with
// nothing else in it (the tag-alley rule of findAlley, on a region).
function alleyIn(city, region) {
  const bl = buildingsIn(city, region).filter((b) => b.kind !== 'container' && b.h >= 5);
  let best = null;
  const near = [];
  const clearGap = (x0, z0, x1, z1, a, b) => {
    city.buildingsNear(x0, z0, x1, z1, near);
    for (let i = 0; i < near.length; i++) {
      const o = city.buildings[near[i]];
      if (o !== a && o !== b && o.x0 < x1 && o.x1 > x0 && o.z0 < z1 && o.z1 > z0) return false;
    }
    return !city.onRoad((x0 + x1) / 2, (z0 + z1) / 2);
  };
  const nb = [];
  for (const A of bl) {
    city.buildingsNear(A.x0 - 9, A.z0 - 9, A.x1 + 9, A.z1 + 9, nb);
    for (let i = 0; i < nb.length; i++) {
      const B = city.buildings[nb[i]];
      if (B === A || B.h < 5 || B.kind === 'container' || !(A.x0 < B.x0 || (A.x0 === B.x0 && A.z0 < B.z0))) continue;
      // Side by side along x (the alley runs along z).
      const gx = B.x0 - A.x1, ovz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
      if (gx >= 3 && gx <= 8 && ovz >= 14 && (!best || ovz > best.len) && clearGap(A.x1, Math.max(A.z0, B.z0), B.x0, Math.min(A.z1, B.z1), A, B)) {
        const z = (Math.max(A.z0, B.z0) + Math.min(A.z1, B.z1)) / 2;
        best = { x: (A.x1 + B.x0) / 2, z, heading: Math.PI / 2, gap: gx, len: ovz, tag: { x: A.x1, z, nx: 1, nz: 0 } };
      }
      // One above the other along z (the alley runs along x).
      const lo = A.z0 <= B.z0 ? A : B, hi = lo === A ? B : A;
      const gz = hi.z0 - lo.z1, ovx = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      if (gz >= 3 && gz <= 8 && ovx >= 14 && (!best || ovx > best.len) && clearGap(Math.max(A.x0, B.x0), lo.z1, Math.min(A.x1, B.x1), hi.z0, A, B)) {
        const x = (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2;
        best = { x, z: (lo.z1 + hi.z0) / 2, heading: 0, gap: gz, len: ovx, tag: { x, z: lo.z1, nx: 0, nz: 1 } };
      }
    }
  }
  return best;
}

// A 9 to 20 m flat roof in the region, nearest 12 m high, then nearest
// the region's center.
function roofIn(city, region, rng) {
  const cx = (region.x0 + region.x1) / 2, cz = (region.z0 + region.z1) / 2;
  const pool = buildingsIn(city, region).filter((b) => b.kind === 'building' && b.h >= 9 && b.h <= 20 && b.x1 - b.x0 >= 14 && b.z1 - b.z0 >= 14);
  if (!pool.length) return null;
  const d = (b) => Math.abs(b.h - 12) * 40 + DIST((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, cx, cz);
  pool.sort((p, q) => d(p) - d(q));
  const b = pool[0];
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, roofY: b.h, heading: rng.range(0, TAU), roof: { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 } };
}

// The lock-up garage on open ground nearest (x, z), door out to open ground.
function garageNear(city, x, z, rng) {
  const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let g = null;
  nearestWhere(x, z, 400, (px, pz) => {
    if (!openGroundNear(city, px, pz, 12, 12)) return false;
    const turn = rng.int(0, 3);
    for (let q = 0; q < 4; q++) {
      const h = dirs[(q + turn) % 4];
      const ox = px + Math.cos(h) * 4.5, oz = pz + Math.sin(h) * 4.5;
      if (!openGroundNear(city, ox + Math.cos(h) * 8, oz + Math.sin(h) * 8, 5, 5)) continue;
      g = garageGeometry(ox, oz, h);
      return true;
    }
    return false;
  });
  return g;
}

// { spots, garage } from a spec: drowned-box, the-gullet and rustlamp near
// a shore point; roof-garden and tag-alley found inside a region;
// lone-ride on open park ground near a point; the garage near a point.
// A partial spec (a map region that holds only some of the six, see
// world/regioncontent.js regionSecretSpec) places just the ids it lists; a
// listed secret that cannot be placed throws on the whole box (a data
// change the tests must catch) and is left out on a region build.
export function placeSecrets(city, spec, seed = SECRETS_SEED) {
  const rng = createRng(seed);
  const out = {};
  const put = (id, p, extra = {}) => {
    if (!p) {
      if (city.region) return;
      throw new Error('secrets: no place for ' + id);
    }
    const def = SECRET_DEFS.find((d) => d.id === id);
    out[id] = { id, kind: def.kind, name: def.name, x: p.x, z: p.z, heading: p.heading || 0, minY: null, ...extra };
  };
  // The container lies 23 m out along the heading: that must be open water.
  const wet = (px, pz, h) => city.shoreDist(px + Math.cos(h) * 23, pz + Math.sin(h) * 23) < -4 && city.shoreDist(px + Math.cos(h) * 30, pz + Math.sin(h) * 30) < -6;
  if (spec['drowned-box']) put('drowned-box', shoreSpot(city, spec['drowned-box'].x, spec['drowned-box'].z, 5, wet));
  const roof = spec['roof-garden'] ? roofIn(city, spec['roof-garden'].region, rng) : null;
  if (roof) put('roof-garden', roof, { minY: roof.roofY - 3.5, roofY: roof.roofY, roof: roof.roof });
  if (spec['the-gullet']) put('the-gullet', shoreSpot(city, spec['the-gullet'].x, spec['the-gullet'].z, 5, wet));
  if (spec.rustlamp) put('rustlamp', shoreSpot(city, spec.rustlamp.x, spec.rustlamp.z, 6));
  const alley = spec['tag-alley'] ? alleyIn(city, spec['tag-alley'].region) : null;
  if (alley) put('tag-alley', alley, { tag: alley.tag, gap: alley.gap, len: alley.len });
  const lr = spec['lone-ride'];
  if (lr) {
    const ride = nearestWhere(lr.x, lr.z, 200, (px, pz) => openGroundNear(city, px, pz, 7, 10));
    put('lone-ride', ride && { x: ride.x, z: ride.z, heading: rng.range(0, TAU) });
  }
  const spots = SECRET_IDS.map((id) => out[id]).filter(Boolean);
  const garage = spec.garage ? garageNear(city, spec.garage.x, spec.garage.z, rng) : null;
  return { spots, garage };
}

// The whole hidden layout: { spots: [six secrets in SECRET_DEFS order],
// garage }. Each spot has id, x, z, heading and `minY` (null, or the
// height you must be at to count: the rooftop).
export function findSecrets(city, seed = SECRETS_SEED) {
  // A map with its own hand-placed list (Miami: empty until milestone 2).
  if (Array.isArray(city.secretSpots)) return { spots: city.secretSpots.slice(), garage: city.secretGarage || null };
  const rng = createRng(seed);
  const spots = {};
  const taken = [];
  const put = (id, p, extra = {}) => {
    if (!p) return;
    const def = SECRET_DEFS.find((d) => d.id === id);
    spots[id] = { id, kind: def.kind, name: def.name, x: p.x, z: p.z, heading: p.heading || 0, minY: null, ...extra };
    taken.push(spots[id]);
  };

  // Shore spots first. The container hides near the docks, the lighthouse
  // on the farthest headland, the cave on the beach side.
  const shore = shoreCandidates(city, rng, 5);
  const docks = shore.filter((p) => city.districtOf(p.x, p.z) === 'docks');
  put('drowned-box', rng.pick(docks.length ? docks : shore));
  const heads = shore.slice().sort((a, b) => city.radiusAt(b.heading) - city.radiusAt(a.heading)).slice(0, 6);
  put('rustlamp', pickApart(rng, heads, taken));
  const beach = shore.filter((p) => city.districtOf(p.x, p.z) === 'beach');
  put('the-gullet', pickApart(rng, beach.length ? beach : shore, taken));

  const roof = findRooftop(city, rng, taken);
  if (roof) put('roof-garden', roof, { minY: roof.roofY - 3.5, roofY: roof.roofY, roof: roof.roof });
  const alley = findAlley(city, rng, taken);
  if (alley) put('tag-alley', alley, { tag: alley.tag, gap: alley.gap, len: alley.len });
  put('lone-ride', findPlayground(city, rng, taken));

  const list = SECRET_IDS.map((id) => spots[id]).filter(Boolean);
  const garage = findGarage(city, rng, list);
  return { spots: list, garage };
}

// ---- progress ----------------------------------------------------------------
export function emptySecrets() {
  return { found: [], ghostwake: false };
}

export const secretsDone = (s) => !!s && SECRET_IDS.every((id) => s.found.includes(id));

// Is a player at (x, y, z) close enough to count as having found `spot`?
export function inReach(spot, x, y, z) {
  const dx = spot.x - x, dz = spot.z - z;
  if (dx * dx + dz * dz > DISCOVER_R * DISCOVER_R) return false;
  return spot.minY == null || y >= spot.minY;
}

// Record the first not-yet-found secret within reach and return it, or
// null. Fires once per secret: a found id is never returned again.
export function discover(state, spots, x, y, z) {
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (state.found.includes(s.id) || !inReach(s, x, y, z)) continue;
    state.found.push(s.id);
    if (secretsDone(state)) state.ghostwake = true;
    return s;
  }
  return null;
}

// Where the faint map hint sits: the first secret not yet found, nudged by
// a fixed amount so it points at a neighborhood, not at the spot. Null
// until the first secret is found, and again when all are.
export function hintFor(state, spots) {
  if (!state.found.length || secretsDone(state)) return null;
  const s = spots.find((p) => !state.found.includes(p.id));
  if (!s) return null;
  const a = (SECRET_IDS.indexOf(s.id) + 1) * 2.399;
  return { id: s.id, x: s.x + Math.cos(a) * HINT_FUZZ, z: s.z + Math.sin(a) * HINT_FUZZ };
}
