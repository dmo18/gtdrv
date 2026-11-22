// Static collision world: axis-aligned boxes (buildings) and circles
// (trees, posts) stored in a coarse grid so lookups stay cheap. A shape
// can be switched off and on again (setEnabled): an off shape stays in
// the grid but every query skips it.
import { dressLot, eachBay } from './lots.js';

const CELL = 32;

export function createCollisionWorld() {
  const cells = new Map();
  const boxes = [];
  const circles = [];
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const cellOf = (v) => Math.floor(v / CELL);

  function insert(item, x0, z0, x1, z1) {
    for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) {
      for (let cz = cellOf(z0); cz <= cellOf(z1); cz++) {
        const k = key(cx, cz);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  function addBox(x0, z0, x1, z1, h = 10, tag = null) {
    const b = { kind: 0, x0, z0, x1, z1, h, tag, stamp: 0, off: false };
    boxes.push(b);
    insert(b, x0, z0, x1, z1);
    return b;
  }

  function addCircle(x, z, r, h = 5, tag = null) {
    const c = { kind: 1, x, z, r, h, tag, stamp: 0, off: false };
    circles.push(c);
    insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  // Switches a shape (from addBox or addCircle) off or back on.
  function setEnabled(shape, on) {
    shape.off = !on;
  }

  let stamp = 0;
  const out = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0 };

  // Push a circle out of everything it overlaps. Returns a shared
  // result object: new position, last contact normal, deepest overlap.
  // `y` is the height of the thing being tested: obstacles that are
  // lower than that are ignored, so aircraft can fly over rooftops.
  function resolveCircle(x, z, r, y = 0) {
    out.x = x;
    out.z = z;
    out.nx = 0;
    out.nz = 0;
    out.hit = false;
    out.depth = 0;
    stamp++;
    const cx0 = cellOf(x - r), cx1 = cellOf(x + r);
    const cz0 = cellOf(z - r), cz1 = cellOf(z + r);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it.stamp === stamp) continue;
          it.stamp = stamp;
          if (it.off || it.h <= y) continue;
          let nx, nz, depth;
          if (it.kind === 0) {
            const px = out.x < it.x0 ? it.x0 : out.x > it.x1 ? it.x1 : out.x;
            const pz = out.z < it.z0 ? it.z0 : out.z > it.z1 ? it.z1 : out.z;
            const dx = out.x - px, dz = out.z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 > 1e-9) {
              const d = Math.sqrt(d2);
              nx = dx / d;
              nz = dz / d;
              depth = r - d;
            } else {
              // Centre is inside the box: leave by the nearest face.
              const l = out.x - it.x0, rr = it.x1 - out.x;
              const t = out.z - it.z0, b = it.z1 - out.z;
              const m = Math.min(l, rr, t, b);
              nx = 0;
              nz = 0;
              if (m === l) nx = -1;
              else if (m === rr) nx = 1;
              else if (m === t) nz = -1;
              else nz = 1;
              depth = m + r;
            }
          } else {
            const dx = out.x - it.x, dz = out.z - it.z;
            const rr = r + it.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-6;
            nx = dx / d;
            nz = dz / d;
            depth = rr - d;
          }
          out.x += nx * depth;
          out.z += nz * depth;
          out.nx = nx;
          out.nz = nz;
          out.hit = true;
          if (depth > out.depth) out.depth = depth;
        }
      }
    }
    return out;
  }

  // Distance along a ray to the first static obstacle, or maxDist.
  function raycast(x, z, dx, dz, maxDist) {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const ex = x + dx * maxDist, ez = z + dz * maxDist;
    let best = maxDist;
    stamp++;
    const cx0 = cellOf(Math.min(x, ex)), cx1 = cellOf(Math.max(x, ex));
    const cz0 = cellOf(Math.min(z, ez)), cz1 = cellOf(Math.max(z, ez));
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it.stamp === stamp) continue;
          it.stamp = stamp;
          if (it.off) continue;
          if (it.kind === 0) {
            let t0 = 0, t1 = best, ok = true;
            if (Math.abs(dx) < 1e-9) {
              if (x < it.x0 || x > it.x1) ok = false;
            } else {
              let a = (it.x0 - x) / dx, b = (it.x1 - x) / dx;
              if (a > b) [a, b] = [b, a];
              t0 = Math.max(t0, a);
              t1 = Math.min(t1, b);
            }
            if (ok) {
              if (Math.abs(dz) < 1e-9) {
                if (z < it.z0 || z > it.z1) ok = false;
              } else {
                let a = (it.z0 - z) / dz, b = (it.z1 - z) / dz;
                if (a > b) [a, b] = [b, a];
                t0 = Math.max(t0, a);
                t1 = Math.min(t1, b);
              }
            }
            if (ok && t0 <= t1 && t0 < best) best = t0;
          } else {
            const ox = x - it.x, oz = z - it.z;
            const b = ox * dx + oz * dz;
            const c = ox * ox + oz * oz - it.r * it.r;
            const disc = b * b - c;
            if (disc < 0) continue;
            const t = -b - Math.sqrt(disc);
            if (t >= 0 && t < best) best = t;
          }
        }
      }
    }
    return best;
  }

  // True when the straight line between two points is unobstructed.
  function lineClear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (d < 1e-6) return true;
    return raycast(x0, z0, x1 - x0, z1 - z0, d) >= d - 1e-6;
  }

  // Height of the tallest obstacle covering a point (0 if none): the
  // roof an aircraft or a dropped object would land on.
  function heightAt(x, z) {
    const list = cells.get(key(cellOf(x), cellOf(z)));
    let h = 0;
    if (!list) return h;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.off) continue;
      if (it.kind === 0) {
        if (x >= it.x0 && x <= it.x1 && z >= it.z0 && z <= it.z1 && it.h > h) h = it.h;
      } else if ((x - it.x) * (x - it.x) + (z - it.z) * (z - it.z) <= it.r * it.r && it.h > h) h = it.h;
    }
    return h;
  }

  return { addBox, addCircle, setEnabled, resolveCircle, raycast, lineClear, heightAt, boxes, circles };
}

// The static boxes every city adds: one per building, as citymesh used
// to add them while drawing. Pure, so node tests use the same boxes.
export function fillCollision(city, collision) {
  for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
  return collision;
}

// ---- Lot solids (docs/REVAMP.md 6.2) ----
// Every solid feature that dressLot lists for a lot, and the static cars
// the renderer parks in car park bays, as collision shapes for the whole
// map at city build: the simulation never waits on a tile being drawn.

function cellHash(i, j) {
  let h = Math.imul(i * 73856093 ^ j * 19349663, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// Bays the parked-car system fills (city.parkingSpots entries with
// lot: true), keyed by the bay centre on a 0.5 m grid.
const listedCache = new WeakMap();
function listedBays(city) {
  let s = listedCache.get(city);
  if (s) return s;
  s = new Set();
  for (const p of city.parkingSpots || []) if (p.lot) s.add(Math.round(p.x * 2) * 65536 + Math.round(p.z * 2));
  listedCache.set(city, s);
  return s;
}

// The static car of one bay (centre bx, bz of a row feature with variant
// v): -1 when the bay stays empty (a listed spot, or the other half of
// the bays), else a number in 0..0.55 that picks its colour and facing.
// The renderer draws exactly the cars this says are there.
export function bayCar(city, bx, bz, v) {
  const key = Math.round(bx * 2) * 65536 + Math.round(bz * 2);
  const u = cellHash(Math.round(bx * 3), Math.round(bz * 3) + v);
  return listedBays(city).has(key) || u > 0.55 ? -1 : u;
}

// Collision shapes for the solid features of one lot (pushed to `list`
// when given): a circle for round ones (r), a box for boxes along the
// world axes, else a row of circles.
export function addLotSolids(collision, feats, n, list = null) {
  let made = 0;
  const put = (s) => { made++; if (list) list.push(s); };
  for (let q = 0; q < n; q++) {
    const f = feats[q];
    if (!f.solid) continue;
    const hgt = f.h || 1.5;
    if (f.r > 0) {
      put(collision.addCircle(f.x, f.z, f.r, hgt, 'lot'));
      continue;
    }
    const h = f.heading || 0, c = Math.cos(h), s = Math.sin(h);
    const hl = (f.l || 0) / 2, hw = Math.max(0.15, (f.w || 0) / 2);
    if (Math.abs(s) < 0.02 || Math.abs(c) < 0.02) {
      const ex = Math.abs(c) * hl + Math.abs(s) * hw, ez = Math.abs(s) * hl + Math.abs(c) * hw;
      put(collision.addBox(f.x - ex, f.z - ez, f.x + ex, f.z + ez, hgt, 'lot'));
    } else {
      const k = Math.max(1, Math.ceil(hl / hw));
      for (let i = 0; i <= k; i++) {
        const o = -hl + (2 * hl * i) / k;
        put(collision.addCircle(f.x + c * o, f.z + s * o, hw, hgt, 'lot'));
      }
    }
  }
  return made;
}

// Two circles per static bay car (front and back half), tag 'car'.
export function addBayCars(city, collision, feats, n, list = null) {
  let made = 0;
  for (let q = 0; q < n; q++) {
    const f = feats[q];
    if (f.kind !== 'bay') continue;
    eachBay(f, (bx, bz, ch) => {
      if (bayCar(city, bx, bz, f.v) < 0) return;
      const cx = Math.cos(ch), cz = Math.sin(ch);
      const a = collision.addCircle(bx - cx * 1.2, bz - cz * 1.2, 1.0, 1.4, 'car');
      const b = collision.addCircle(bx + cx * 1.2, bz + cz * 1.2, 1.0, 1.4, 'car');
      made += 2;
      if (list) list.push(a, b);
    });
  }
  return made;
}

// Every lot of the city, in lot order (deterministic: dressLot depends on
// the lot alone). dress: dressLot or another with the same contract.
// Returns the shapes made (list) so they can be switched off together.
export function fillLotCollision(city, collision, dress = dressLot, list = []) {
  if (!city.lots || !dress) return list;
  const feats = [];
  for (const lot of city.lots) {
    if (!lot || lot.type === 'verge' || lot.type === 'airfield') continue;
    feats.length = 0;
    dress(city, lot, feats);
    addLotSolids(collision, feats, feats.length, list);
    addBayCars(city, collision, feats, feats.length, list);
  }
  return list;
}
