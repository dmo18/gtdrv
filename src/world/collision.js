// Static collision world: axis-aligned boxes (buildings) and circles
// (trees, posts) stored in a coarse grid so lookups stay cheap. A shape
// can be switched off and on again (setEnabled): an off shape stays in
// the grid but every query skips it.
//
// Lot solids come in a second, lazy layer (setLotLayer, made by
// attachLotCollision below): a cell of it is filled the first time a
// query touches it, from the lots overlapping the cell in lot id order.
// What a cell holds is a pure function of the city, so a query gives the
// same answer whenever and however often cells were touched before.
// More lazy layers work the same way (addLayer): the street props
// (world/propsolid.js) and the sea walls and rails (world/edgelines.js).
//
// Shapes: kind 0 axis-aligned box, kind 1 circle, kind 2 capsule segment
// (x0, z0)-(x1, z1) of radius r (sea walls, rails). A shape with `brk` (its
// PROP_SOLIDS entry) is breakable: breakShape switches it and its group
// (`grp`) off and queues a break record; stepBroken brings it back after
// BREAK_BACK_T s when the given point (the player) is BREAK_BACK_FAR away.
import { dressLot, eachBay, lotDressCache, lotFill, FILL_MAX } from './lots.js';
import { PROP_SOLIDS, createPropLayer, setBreakGroup } from './propsolid.js';
import { createEdgeLayer } from './edgelines.js';
import { attachGround } from './ground.js';
import { deadEnds } from './deadends.js';
import { mkShape } from './shape.js';

export const BREAK_BACK_T = 120, BREAK_BACK_FAR = 150, BREAK_RING = 16;

const CELL = 32;
const NO_ITEMS = [];

export function createCollisionWorld() {
  const cells = new Map();
  const boxes = [];
  const circles = [];
  const segments = [];
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const cellOf = (v) => Math.floor(v / CELL);
  // Lazy layers: slot 0 the lots (setLotLayer), then the others in the
  // order added (addLayer). A null slot is skipped.
  const layers = [null];
  let NL = 1;
  const layerList = (L, cx, cz) => (L ? L.cell(cx, cz) : NO_ITEMS);

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

  let joined = null; // boxes and circles with the lot layer's, by lot id
  function addBox(x0, z0, x1, z1, h = 10, tag = null) {
    const b = mkShape(0, x0, z0, x1, z1, 0, 0, 0, h, tag);
    boxes.push(b);
    insert(b, x0, z0, x1, z1);
    joined = null;
    return b;
  }

  function addCircle(x, z, r, h = 5, tag = null) {
    const c = mkShape(1, 0, 0, 0, 0, x, z, r, h, tag);
    circles.push(c);
    insert(c, x - r, z - r, x + r, z + r);
    joined = null;
    return c;
  }

  // A capsule segment (sea walls, rails): every point within r of the
  // segment from (x0, z0) to (x1, z1).
  function addSegment(x0, z0, x1, z1, r = 0.25, h = 0.9, tag = null) {
    const g = mkShape(2, x0, z0, x1, z1, 0, 0, r, h, tag);
    segments.push(g);
    insert(g, Math.min(x0, x1) - r, Math.min(z0, z1) - r, Math.max(x0, x1) + r, Math.max(z0, z1) + r);
    return g;
  }

  // Switches a shape (from addBox or addCircle) off or back on.
  function setEnabled(shape, on) {
    shape.off = !on;
  }

  let stamp = 0;
  // brk: the breakable shape with the deepest contact (null: none), with
  // its contact normal and depth.
  const out = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0, brk: null, bnx: 0, bnz: 0, bdepth: 0 };

  // Push a circle out of everything it overlaps. Returns a shared
  // result object: new position, last contact normal, deepest overlap.
  // `y` is the height of the thing being tested: obstacles that are
  // lower than that are ignored, so aircraft can fly over rooftops.
  // A cell's static shapes first, then its lot shapes.
  function resolveCircle(x, z, r, y = 0) {
    return resolveIn(x, z, r, y, -1);
  }
  // The same against one lazy layer only (by name; no such layer: no hit).
  // The tank rolls over what is 1 m tall but not over the sea walls and
  // rails (0.9 m): it resolves those on their own (entities/tank.js).
  function resolveLayer(name, x, z, r, y = 0) {
    for (let i = 1; i < layers.length; i++) if (layers[i] && layers[i].name === name) return resolveIn(x, z, r, y, i + 1);
    return resolveIn(x, z, r, y, -2);
  }
  // only: -1 every pass, -2 none, else the one pass (0 static, k layer k - 1).
  function resolveIn(x, z, r, y, only) {
    out.x = x;
    out.z = z;
    out.nx = 0;
    out.nz = 0;
    out.hit = false;
    out.depth = 0;
    out.brk = null;
    out.bdepth = 0;
    stamp++;
    const cx0 = cellOf(x - r), cx1 = cellOf(x + r);
    const cz0 = cellOf(z - r), cz1 = cellOf(z + r);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let pass = 0; pass <= NL; pass++) {
          if (only !== -1 && pass !== only) continue;
          const list = pass ? layerList(layers[pass - 1], cx, cz) : cells.get(key(cx, cz));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const it = list[i];
            if (it.stamp === stamp) continue;
            it.stamp = stamp;
            // off and h are read in each kind's branch: one read site sees
            // only that kind's object shapes, so V8 keeps it inline instead
            // of a generic lookup that boxes the height (docs/PERF.md).
            let nx, nz, depth;
            const kind = it.kind;
            if (kind === 0) {
              if (it.off || it.h <= y) continue;
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
                // Center is inside the box: leave by the nearest face.
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
            } else if (kind === 2) {
              if (it.off || it.h <= y) continue;
              const sx = it.x1 - it.x0, sz = it.z1 - it.z0;
              const L2 = sx * sx + sz * sz;
              let t = L2 > 1e-12 ? ((out.x - it.x0) * sx + (out.z - it.z0) * sz) / L2 : 0;
              if (t < 0) t = 0; else if (t > 1) t = 1;
              const dx = out.x - (it.x0 + sx * t), dz = out.z - (it.z0 + sz * t);
              const rr = r + it.r;
              const d2 = dx * dx + dz * dz;
              if (d2 >= rr * rr) continue;
              const d = Math.sqrt(d2);
              if (d > 1e-6) {
                nx = dx / d;
                nz = dz / d;
              } else {
                const l = Math.sqrt(L2) || 1;
                nx = -sz / l;
                nz = sx / l;
              }
              depth = rr - d;
            } else {
              if (it.off || it.h <= y) continue;
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
            if (it.brk && depth > out.bdepth) {
              out.brk = it;
              out.bnx = nx;
              out.bnz = nz;
              out.bdepth = depth;
            }
          }
        }
      }
    }
    return out;
  }

  // The ray against one list of shapes: the nearest hit before best.
  // (The nearest hit over all shapes does not depend on their order.)
  function rayList(list, x, z, dx, dz, best) {
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
          if (a > b) { const t = a; a = b; b = t; }
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
        }
        if (ok) {
          if (Math.abs(dz) < 1e-9) {
            if (z < it.z0 || z > it.z1) ok = false;
          } else {
            let a = (it.z0 - z) / dz, b = (it.z1 - z) / dz;
            if (a > b) { const t = a; a = b; b = t; }
            t0 = Math.max(t0, a);
            t1 = Math.min(t1, b);
          }
        }
        if (ok && t0 <= t1 && t0 < best) best = t0;
      } else if (it.kind === 2) {
        // Ray against a capsule, as against its swept circle: sampled at the
        // closest approach of the ray to the segment's line, then refined.
        const t = rayCapsule(x, z, dx, dz, it);
        if (t >= 0 && t < best) best = t;
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
    return best;
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
        if (list) best = rayList(list, x, z, dx, dz, best);
      }
    }
    for (let li = 0; li < NL; li++) {
      const L = layers[li];
      if (!L) continue;
      // Layer cells: only those the ray passes through (column by column,
      // the z span of the ray in the column, padded by a millimeter), so
      // a long ray fills few cells. A shape the ray hits is in the cell
      // of the hit point, which is one of them.
      for (let cx = cx0; cx <= cx1; cx++) {
        let za = z, zb = ez;
        if (Math.abs(dx) >= 1e-9) {
          let ta = (cx * CELL - 1e-3 - x) / dx, tb = ((cx + 1) * CELL + 1e-3 - x) / dx;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta < 0) ta = 0;
          if (tb > maxDist) tb = maxDist;
          za = z + dz * ta;
          zb = z + dz * tb;
        }
        const c0 = cellOf(Math.min(za, zb) - 1e-3), c1 = cellOf(Math.max(za, zb) + 1e-3);
        for (let cz = Math.max(c0, cz0); cz <= Math.min(c1, cz1); cz++) {
          const list = L.cell(cx, cz);
          if (list.length) best = rayList(list, x, z, dx, dz, best);
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
    let h = 0;
    for (let pass = 0; pass <= NL; pass++) {
      const list = pass ? layerList(layers[pass - 1], cellOf(x), cellOf(z)) : cells.get(key(cellOf(x), cellOf(z)));
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it.off) continue;
        if (it.kind === 0) {
          if (x >= it.x0 && x <= it.x1 && z >= it.z0 && z <= it.z1 && it.h > h) h = it.h;
        } else if (it.kind === 2) {
          if (segDist2(x, z, it) <= it.r * it.r && it.h > h) h = it.h;
        } else if ((x - it.x) * (x - it.x) + (z - it.z) * (z - it.z) <= it.r * it.r && it.h > h) h = it.h;
      }
    }
    return h;
  }

  // The lazy lot layer (attachLotCollision), or null to drop it.
  function setLotLayer(layer) {
    layers[0] = layer;
    joined = null;
  }
  // The game clock (h) for the lot layer's bay cars (createLotLayer setHour).
  function setLotHour(hour) {
    if (layers[0] && layers[0].setHour) layers[0].setHour(hour);
  }
  // Another lazy layer ({ name, cell(cx, cz) }), or a replacement for the
  // one of the same name. Its shapes are not in boxes / circles.
  function addLayer(layer) {
    for (let i = 1; i < layers.length; i++) {
      if (layers[i] && layers[i].name === layer.name) {
        layers[i] = layer;
        return layer;
      }
    }
    layers.push(layer);
    NL = layers.length;
    return layer;
  }
  const layerNamed = (name) => {
    for (let i = 1; i < layers.length; i++) if (layers[i] && layers[i].name === name) return layers[i];
    return null;
  };
  // boxes and circles hold every static and lot shape: reading them makes
  // all of the lot layer's shapes (not its cells) and lists them after the
  // static ones, by lot id, whatever was touched before. (The street prop
  // and edge layers are read through their own layer objects.)
  function join() {
    const lotLayer = layers[0];
    if (joined && (!lotLayer || joined.layer === lotLayer)) return joined;
    if (!lotLayer) return { boxes, circles };
    const lb = [], lc = [];
    lotLayer.allShapes((s) => (s.kind === 0 ? lb : lc).push(s));
    joined = { layer: lotLayer, boxes: boxes.concat(lb), circles: circles.concat(lc) };
    return joined;
  }

  // ---- Breakable props ----
  // Ring of the last BREAK_RING breaks (pooled records, read by combat.js
  // which turns them into 'propBreak' events): seq counts every break.
  const breaks = [];
  for (let i = 0; i < BREAK_RING; i++) breaks.push({ seq: 0, type: '', x: 0, z: 0, h: 0, vx: 0, vz: 0, speed: 0, spray: 0, fall: '', by: null, shape: null });
  let breakSeq = 0;
  const broken = []; // shapes off by a break: [shape, seconds since]
  const brokenT = [];
  // Breaks a breakable shape (and its group): off now, back later.
  function breakShape(shape, vx = 0, vz = 0, by = null) {
    if (!shape || !shape.brk || shape.off) return null;
    const grp = shape.grp || null;
    let cx = 0, cz = 0, n = 0;
    if (grp) {
      for (let i = 0; i < grp.length; i++) {
        const g = grp[i];
        g.off = true;
        cx += g.kind === 0 ? (g.x0 + g.x1) / 2 : g.x;
        cz += g.kind === 0 ? (g.z0 + g.z1) / 2 : g.z;
        n++;
      }
    } else {
      shape.off = true;
      cx = shape.kind === 0 ? (shape.x0 + shape.x1) / 2 : shape.x;
      cz = shape.kind === 0 ? (shape.z0 + shape.z1) / 2 : shape.z;
      n = 1;
    }
    broken.push(shape);
    brokenT.push(0);
    const rec = breaks[breakSeq % BREAK_RING];
    breakSeq++;
    rec.seq = breakSeq;
    rec.type = shape.ptype || shape.tag || '';
    rec.x = cx / n;
    rec.z = cz / n;
    rec.h = shape.h;
    rec.vx = vx;
    rec.vz = vz;
    rec.speed = Math.sqrt(vx * vx + vz * vz);
    rec.spray = shape.brk.spray || 0;
    rec.fall = shape.brk.fall || 'chunk';
    rec.by = by;
    rec.shape = shape;
    return rec;
  }
  // Ages the broken props; those BREAK_BACK_T s old with (px, pz) at least
  // BREAK_BACK_FAR away stand again.
  function stepBroken(dt, px = Infinity, pz = Infinity) {
    for (let i = broken.length - 1; i >= 0; i--) {
      brokenT[i] += dt;
      if (brokenT[i] < BREAK_BACK_T) continue;
      const s = broken[i];
      const sx = s.kind === 0 ? (s.x0 + s.x1) / 2 : s.x, sz = s.kind === 0 ? (s.z0 + s.z1) / 2 : s.z;
      if ((sx - px) * (sx - px) + (sz - pz) * (sz - pz) < BREAK_BACK_FAR * BREAK_BACK_FAR) continue;
      if (s.grp) for (let k = 0; k < s.grp.length; k++) s.grp[k].off = false;
      else s.off = false;
      broken.splice(i, 1);
      brokenT.splice(i, 1);
    }
  }
  // True when a broken prop of this type stands (stood) within r of (x, z):
  // the renderer leaves it out of a tile it rebuilds.
  function isBroken(x, z, r = 0.6) {
    for (let i = 0; i < broken.length; i++) {
      const s = broken[i];
      const sx = s.kind === 0 ? (s.x0 + s.x1) / 2 : s.x, sz = s.kind === 0 ? (s.z0 + s.z1) / 2 : s.z;
      if ((sx - x) * (sx - x) + (sz - z) * (sz - z) <= r * r) return true;
    }
    return false;
  }

  return {
    addBox, addCircle, addSegment, setEnabled, resolveCircle, resolveLayer, raycast, lineClear, heightAt, setLotLayer, setLotHour, addLayer, layerNamed,
    breakShape, stepBroken, isBroken, breaks,
    get breakSeq() { return breakSeq; },
    get brokenCount() { return broken.length; },
    get broken() { return broken.length; },
    get boxes() { return layers[0] ? join().boxes : boxes; },
    get circles() { return layers[0] ? join().circles : circles; },
    get segments() { return segments; },
    get lotLayer() { return layers[0]; },
  };
}

// Squared distance from (x, z) to a capsule shape's segment.
function segDist2(x, z, it) {
  const sx = it.x1 - it.x0, sz = it.z1 - it.z0;
  const L2 = sx * sx + sz * sz;
  let t = L2 > 1e-12 ? ((x - it.x0) * sx + (z - it.z0) * sz) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = x - (it.x0 + sx * t), dz = z - (it.z0 + sz * t);
  return dx * dx + dz * dz;
}

// Distance along the unit ray (x, z) + t (dx, dz) to a capsule, or -1.
// The capsule is the union of a slab (a rectangle about the segment) and
// two end circles; the smallest entry t of the three is the answer.
function rayCapsule(x, z, dx, dz, it) {
  let best = -1;
  const circ = (cx, cz) => {
    const ox = x - cx, oz = z - cz;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - it.r * it.r;
    const disc = b * b - c;
    if (disc < 0) return;
    const t = -b - Math.sqrt(disc);
    const tt = t >= 0 ? t : c <= 0 ? 0 : -1;
    if (tt >= 0 && (best < 0 || tt < best)) best = tt;
  };
  circ(it.x0, it.z0);
  circ(it.x1, it.z1);
  const sx = it.x1 - it.x0, sz = it.z1 - it.z0, L = Math.hypot(sx, sz);
  if (L > 1e-9) {
    const ux = sx / L, uz = sz / L, nx = -uz, nz = ux;
    // Ray in the segment's frame: u along, v across.
    const u0 = (x - it.x0) * ux + (z - it.z0) * uz, v0 = (x - it.x0) * nx + (z - it.z0) * nz;
    const du = dx * ux + dz * uz, dv = dx * nx + dz * nz;
    let t0 = 0, t1 = Infinity;
    if (Math.abs(dv) < 1e-12) { if (Math.abs(v0) > it.r) t1 = -1; } else {
      let a = (-it.r - v0) / dv, b = (it.r - v0) / dv;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (Math.abs(du) < 1e-12) { if (u0 < 0 || u0 > L) t1 = -1; } else {
      let a = (0 - u0) / du, b = (L - u0) / du;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 <= t1 && (best < 0 || t0 < best)) best = t0;
  }
  return best;
}

// The static boxes every city adds: one per building, as citymesh used
// to add them while drawing. Pure, so node tests use the same boxes.
// Also the lazy street prop and edge line layers (docs/PLAN_V3.md 2.2), and
// city.groundAt.
export function fillCollision(city, collision) {
  for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
  fillRoadEndCollision(city, collision);
  fillLandmarkCollision(city, collision);
  fillPropCollision(city, collision);
  fillEdgeCollision(city, collision);
  attachGround(city);
  if (collision.isBroken) city.propBroken = (x, z) => collision.broken > 0 && collision.isBroken(x, z);
  return collision;
}

// The landmarks' solids (moved from render/props.js): four legs per dock
// crane, the lighthouse tower.
export function fillLandmarkCollision(city, collision) {
  const L = city.landmarks;
  if (!L) return collision;
  for (const c of L.cranes || []) for (const ox of [-7, 7]) for (const oz of [-6, 6]) collision.addCircle(c.x + ox, c.z + oz, 0.9, 27, 'crane');
  if (L.lighthouse) collision.addCircle(L.lighthouse.x, L.lighthouse.z, 3.7, 24 + 5, 'lighthouse');
  return collision;
}

// The street props (lamps, signs, signal masts, furniture, trees, palms)
// as the lazy 'props' layer (world/propsolid.js). Returns the layer.
export function fillPropCollision(city, collision) {
  const layer = createPropLayer(city);
  if (collision.addLayer) collision.addLayer(layer);
  return layer;
}

// The sea walls and rails as the lazy 'edges' layer (world/edgelines.js).
// Returns the layer (city.edgeLines points at it for the renderer).
export function fillEdgeCollision(city, collision) {
  const layer = createEdgeLayer(city);
  if (collision.addLayer) collision.addLayer(layer);
  city.edgeLines = layer;
  return layer;
}

// The striped barriers of the generated road ends at a region's sea
// edges (city.roadEnds, docs/PLAN_V2.md 3.4): a row of posts across the
// road, 1 m apart, tag 'barrier'. Pure.
export const BARRIER_POST_R = PROP_SOLIDS.roadend.r, BARRIER_H = PROP_SOLIDS.roadend.h;
export function fillRoadEndCollision(city, collision) {
  for (const re of city.roadEnds || []) {
    const b = re.barrier;
    const px = -Math.sin(b.heading), pz = Math.cos(b.heading); // across the road
    const n = Math.max(2, Math.ceil(b.w));
    for (let k = 0; k <= n; k++) {
      const t = -b.w / 2 + (b.w * k) / n;
      collision.addCircle(b.x + px * t, b.z + pz * t, BARRIER_POST_R, BARRIER_H, 'barrier');
    }
  }
  // The barricades of the dead ends inside the region (world/deadends.js).
  for (const de of deadEnds(city)) {
    const px = -Math.sin(de.heading), pz = Math.cos(de.heading);
    const n = Math.max(2, Math.ceil(de.w));
    for (let k = 0; k <= n; k++) {
      const t = -de.w / 2 + (de.w * k) / n;
      collision.addCircle(de.x + px * t, de.z + pz * t, BARRIER_POST_R, BARRIER_H, 'barrier');
    }
  }
  return collision;
}

// ---- Lot solids (docs/REVAMP.md 6.2) ----
// Every solid feature that dressLot lists for a lot, and the static cars
// the renderer parks in parking lot bays, as collision shapes for the whole
// map at city build: the simulation never waits on a tile being drawn.

function cellHash(i, j) {
  let h = Math.imul(i * 73856093 ^ j * 19349663, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// Bays the parked-car system fills (city.parkingSpots entries with
// lot: true), keyed by the bay center on a 0.5 m grid.
const listedCache = new WeakMap();
function listedBays(city) {
  let s = listedCache.get(city);
  if (s) return s;
  s = new Set();
  for (const p of city.parkingSpots || []) if (p.lot) s.add(Math.round(p.x * 2) * 65536 + Math.round(p.z * 2));
  listedCache.set(city, s);
  return s;
}

// The static car of one bay (center bx, bz of a row feature with variant
// v) when the lot is `fill` full (lots.js lotFill; FILL_MAX, the most a
// lot ever holds, by default): -1 when the bay stays empty (a listed spot,
// or a hash at or over the fill), else the hash u in 0..fill that picks
// its color and facing. One rule for both: the renderer (render/lotmesh.js
// lotCarAt) draws a car where this says there is one at the hour's fill,
// and the lot layer switches a bay car's shapes off at an hour whose fill
// leaves that bay empty (setHour).
export function bayCar(city, bx, bz, v, fill = FILL_MAX) {
  const key = Math.round(bx * 2) * 65536 + Math.round(bz * 2);
  const u = cellHash(Math.round(bx * 3), Math.round(bz * 3) + v);
  return listedBays(city).has(key) || u >= fill ? -1 : u;
}

// Collision shapes for the features of one lot (pushed to `list` when
// given), by their PROP_SOLIDS entry (world/propsolid.js): 'solid' and
// 'break' kinds get a shape, 'flat' ones none. A circle for round ones
// (r), a box for boxes along the world axes, else a row of circles. A
// kind missing from the table falls back to the feature's own `solid`
// flag (test/prop-collision.test.js fails on such a kind).
export function addLotSolids(collision, feats, n, list = null) {
  let made = 0;
  const put = (s) => { made++; if (list) list.push(s); return s; };
  for (let q = 0; q < n; q++) {
    const f = feats[q];
    const e = PROP_SOLIDS[f.kind];
    if (e ? e.mode === 'flat' : !f.solid) continue;
    const hgt = e && Number.isFinite(e.h) ? e.h : f.h || 1.5;
    const first = made;
    const round = e ? !!e.r : f.r > 0;
    if (round) {
      const r = e ? (e.r === 'feat' ? f.r || 0.5 : e.lotR || e.r) : f.r;
      put(collision.addCircle(f.x, f.z, r, hgt, 'lot'));
    } else {
      const fixed = e && Array.isArray(e.box);
      const h = f.heading || 0, c = Math.cos(h), s = Math.sin(h);
      const hl = (fixed ? e.box[0] : f.l || 0) / 2, hw = Math.max(0.15, (fixed ? e.box[1] : f.w || 0) / 2);
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
    if (list && e) {
      const grp = e.mode === 'break' ? list.slice(list.length - (made - first)) : null;
      for (let i = list.length - (made - first); i < list.length; i++) {
        const sh = list[i];
        sh.ptype = f.kind;
        if (grp) setBreakGroup(sh, e, grp);
      }
    }
  }
  return made;
}

// A bay car circle's hash (the lot layer turns the car off at a lower
// fill), kept beside the shape rather than on it: one more property on
// some circles gave them a second object shape, and the circle reads in
// resolveIn then boxed every number (docs/PERF.md, 0.12.6).
const BAY_U = new WeakMap();
// Two circles per static bay car (front and back half), tag 'car'.
export function addBayCars(city, collision, feats, n, list = null) {
  let made = 0;
  for (let q = 0; q < n; q++) {
    const f = feats[q];
    if (f.kind !== 'bay') continue;
    eachBay(f, (bx, bz, ch) => {
      const u = bayCar(city, bx, bz, f.v);
      if (u < 0) return;
      const cx = Math.cos(ch), cz = Math.sin(ch);
      const a = collision.addCircle(bx - cx * 1.2, bz - cz * 1.2, 1.0, 1.4, 'car');
      const b = collision.addCircle(bx + cx * 1.2, bz + cz * 1.2, 1.0, 1.4, 'car');
      // The bay's hash: the lot layer turns the car off at a lower fill.
      if (a) BAY_U.set(a, u);
      if (b) BAY_U.set(b, u);
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

// ---- Lazy lot layer ----
// How far a lot's solid shapes may reach past its box (m): features stand
// on the lot's cells, round ones keep their disc in the lot, a bay car
// stays in its bay. test/collision-lazy.test.js checks every shape of the
// whole map against it.
export const LOT_SHAPE_REACH = 6;

// The shape objects of the collision world, made without a grid: the
// lazy layer lists them in its own cells.
const SHAPE_SINK = {
  addBox: (x0, z0, x1, z1, h = 10, tag = null) => mkShape(0, x0, z0, x1, z1, 0, 0, 0, h, tag),
  addCircle: (x, z, r, h = 5, tag = null) => mkShape(1, 0, 0, 0, 0, x, z, r, h, tag),
};

// The lots' solids as a lazy layer of `collision` (replacing any layer it
// had): no shape is made now. The first query that touches a collision
// cell fills that cell: for each lot whose box (plus LOT_SHAPE_REACH) overlaps
// it, in lot id order, the lot's shapes (made once per lot, from the
// shared dressing cache, lots.js lotDressCache) that overlap the cell, in
// the order addLotSolids and addBayCars make them. Nothing in a cell
// depends on when, or in what order, cells are touched; a full sweep has
// exactly the shapes fillLotCollision adds. Returns the layer: count()
// (every shape, all made), stats.
export function attachLotCollision(city, collision, dress = dressLot) {
  const layer = createLotLayer(city, dress);
  collision.setLotLayer(layer);
  return layer;
}

export function createLotLayer(city, dress = dressLot) {
  const lots = city.lots || [];
  const cache = lotDressCache(city, dress);
  const cellOf = (v) => Math.floor(v / CELL);
  // Cell range over every lot's box plus the reach.
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  const usable = (lot) => lot && lot.type !== 'verge' && lot.type !== 'airfield';
  for (let k = 0; k < lots.length; k++) {
    const lot = lots[k];
    if (!usable(lot)) continue;
    gx0 = Math.min(gx0, cellOf(lot.x0 - LOT_SHAPE_REACH));
    gz0 = Math.min(gz0, cellOf(lot.z0 - LOT_SHAPE_REACH));
    gx1 = Math.max(gx1, cellOf(lot.x1 + LOT_SHAPE_REACH));
    gz1 = Math.max(gz1, cellOf(lot.z1 + LOT_SHAPE_REACH));
  }
  const W = gx1 >= gx0 ? gx1 - gx0 + 1 : 0, H = gz1 >= gz0 ? gz1 - gz0 + 1 : 0;
  const NC = W * H;
  // Lots by cell (lot indices ascending), as start offsets and items.
  const start = new Int32Array(NC + 1);
  const each = (lot, fn) => {
    const i0 = cellOf(lot.x0 - LOT_SHAPE_REACH) - gx0, i1 = cellOf(lot.x1 + LOT_SHAPE_REACH) - gx0;
    const j0 = cellOf(lot.z0 - LOT_SHAPE_REACH) - gz0, j1 = cellOf(lot.z1 + LOT_SHAPE_REACH) - gz0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * W + i);
  };
  for (let k = 0; k < lots.length; k++) if (usable(lots[k])) each(lots[k], (c) => start[c + 1]++);
  for (let c = 0; c < NC; c++) start[c + 1] += start[c];
  const items = new Int32Array(NC ? start[NC] : 0);
  const fillAt = start.slice(0, NC);
  for (let k = 0; k < lots.length; k++) if (usable(lots[k])) each(lots[k], (c) => { items[fillAt[c]++] = k; });

  const cellLists = new Array(NC).fill(null);
  const lotShapes = new Array(lots.length).fill(null);
  // The bay cars by the hour (setHour): NaN until a game sets the clock,
  // when every bay car up to FILL_MAX stands (tests, tools).
  let fillHour = NaN;
  const carShapes = [], carLots = [];
  function setHour(hour) {
    const h = Math.floor((((hour % 24) + 24) % 24) * 2) / 2;
    if (!(h >= 0) || h === fillHour) return;
    fillHour = h;
    for (let i = 0; i < carShapes.length; i++) {
      carShapes[i].off = BAY_U.get(carShapes[i]) >= lotFill(carLots[i], h);
    }
  }
  const stats = { cells: 0, lots: 0, shapes: 0 };
  const F_EMPTY = [];

  // The shapes of lot k, made the first time.
  function shapesOf(k) {
    let list = lotShapes[k];
    if (list) return list;
    const lot = lots[k];
    const feats = cache.get(lot) || F_EMPTY;
    list = [];
    addLotSolids(SHAPE_SINK, feats, feats.length, list);
    const n0 = list.length;
    addBayCars(city, SHAPE_SINK, feats, feats.length, list);
    for (let i = n0; i < list.length; i++) {
      carShapes.push(list[i]);
      carLots.push(lot);
      if (fillHour === fillHour) list[i].off = BAY_U.get(list[i]) >= lotFill(lot, fillHour);
    }
    lotShapes[k] = list;
    stats.lots++;
    stats.shapes += list.length;
    return list;
  }
  function fill(c, cx, cz) {
    let list = null;
    for (let q = start[c]; q < start[c + 1]; q++) {
      const shapes = shapesOf(items[q]);
      for (let s = 0; s < shapes.length; s++) {
        const it = shapes[s];
        const x0 = it.kind === 0 ? it.x0 : it.x - it.r, x1 = it.kind === 0 ? it.x1 : it.x + it.r;
        const z0 = it.kind === 0 ? it.z0 : it.z - it.r, z1 = it.kind === 0 ? it.z1 : it.z + it.r;
        if (cx < cellOf(x0) || cx > cellOf(x1) || cz < cellOf(z0) || cz > cellOf(z1)) continue;
        (list || (list = [])).push(it);
      }
    }
    stats.cells++;
    cellLists[c] = list || NO_ITEMS;
    return cellLists[c];
  }
  // The lot shapes of collision cell (cx, cz), filled on first use.
  function cell(cx, cz) {
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return NO_ITEMS;
    const c = j * W + i;
    return cellLists[c] || fill(c, cx, cz);
  }
  // Every lot's shapes (all made), by lot id, to fn.
  function allShapes(fn) {
    for (let k = 0; k < lots.length; k++) {
      if (!usable(lots[k])) continue;
      const list = shapesOf(k);
      for (let s = 0; s < list.length; s++) fn(list[s]);
    }
  }
  // Fills every cell overlapping the rectangle now (a warm-up; the
  // answers are the same with or without it).
  function prepare(x0, z0, x1, z1) {
    for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) for (let cz = cellOf(z0); cz <= cellOf(z1); cz++) cell(cx, cz);
  }
  function count() {
    let n = 0;
    allShapes(() => n++);
    return n;
  }
  return { cell, allShapes, prepare, count, shapesOf, stats, cache, setHour };
}
