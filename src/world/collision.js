// Static collision world: axis-aligned boxes (buildings) and circles
// (trees, posts) stored in a coarse grid so lookups stay cheap.
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
    const b = { kind: 0, x0, z0, x1, z1, h, tag, stamp: 0 };
    boxes.push(b);
    insert(b, x0, z0, x1, z1);
    return b;
  }

  function addCircle(x, z, r, h = 5, tag = null) {
    const c = { kind: 1, x, z, r, h, tag, stamp: 0 };
    circles.push(c);
    insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  let stamp = 0;
  const out = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0 };

  // Push a circle out of everything it overlaps. Returns a shared
  // result object: new position, last contact normal, deepest overlap.
  function resolveCircle(x, z, r) {
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

  return { addBox, addCircle, resolveCircle, raycast, lineClear, boxes, circles };
}
