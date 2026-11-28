// The static cars of the parking lot bays near the camera, worked out a
// little at a time (0.13.8; systems/parked.js draws them). Replaces, for the
// game, render/lotmesh.js createLotCarField, which looked at every bay of
// every lot in 150 m on each refresh, hashing each bay and dressing any lot
// it had not seen in that same call (8.9 ms in one call on a phone in
// Downtown, frame hitches).
//
// Here a lot near the camera is loaded once, at most a few a step (by bay
// count, never the clock): its bays' car (position, facing, model, paint,
// the occupancy hash of world/collision.js bayCar, the bays lots.js
// blockedBays keeps empty) go into a pooled record of typed arrays. A
// refresh then only compares each loaded bay's hash with its lot's fill at
// the hour and keeps the nearest `cap` in view. Lots far behind give their
// record back to the pool. Nothing is allocated in step() or update() once
// the pool has its records (it grows only past POOL0 loaded lots at once).
//
// The cars are the same as the old field's for the same bays (same hashes,
// same model and paint rule), so the collision world's bay cars still match
// what is drawn. Pure: no three.js, no DOM (node tests use it).
import { bayCar, bayLotU } from '../world/collision.js';
import { lotDressCache, lotFill, dressLot, blockedBays, blockedBaysInto, bayCount, BAYS_ONLY_FAST } from '../world/lots.js';
import { LOT_CAR_MIX, LOT_CAR_SPECS, LOT_CAR_CAP, LOT_CAR_CAP_MAX, lotCarColor } from './lotmesh.js';
import { curbsAt, onJunction } from '../world/junctions.js';
import { GUTTER, PARK_W } from '../world/roadprofile.js';

const MIX_IDX = {};
for (const k of Object.keys(LOT_CAR_MIX)) MIX_IDX[k] = LOT_CAR_MIX[k].map((id) => LOT_CAR_SPECS.indexOf(id));

// The bay hash of render/lotmesh.js (model, facing, paint, a little play).
function hash2(x, z, k) {
  let h = Math.imul(x * 374761393 ^ z * 668265263 ^ k * 2246822519, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const FIELD_CELL = 128;
export const LOT_BAYS_MAX = 320; // bays a lot record holds (lots hold 256 at most)
export const LOAD_BAYS_STEP = 240; // bays loaded in one step (at least one lot)
export const DRESS_WAIT = 90; // steps a lot waits for the tiles to dress it
const POOL0 = 64;

function makeRecord() {
  const M = LOT_BAYS_MAX;
  return {
    lot: null, n: 0, fill: 0, x0: 0, z0: 0, x1: 0, z1: 0, prov: false, y: 0,
    x: new Float32Array(M), z: new Float32Array(M), yaw: new Float32Array(M),
    u: new Float32Array(M), spec: new Uint8Array(M), color: new Uint32Array(M),
  };
}

export function createParkedLotField(city, opts = {}) {
  const range = opts.range || 150;
  const dress = opts.dress || dressLot;
  // quick: a lot not in the dressing cache loads from the bays-only dressing
  // (when the game's tiles dress lots, systems/parked.js; else a full one).
  const quick = !!opts.quick;
  const ground = opts.ground || null;
  const MAX = LOT_CAR_CAP_MAX;
  const field = {
    n: 0, cap: opts.cap || LOT_CAR_CAP,
    x: new Float32Array(MAX), z: new Float32Array(MAX), yaw: new Float32Array(MAX), y: new Float32Array(MAX),
    spec: new Uint8Array(MAX), color: new Uint32Array(MAX), dist: new Float32Array(MAX),
    stats: { lots: 0, bays: 0, updates: 0, loaded: 0, loads: 0, released: 0, blocked: 0, reloads: 0 },
    update: null, step: null, pending: null, lotAt: null, lotCount: null,
  };
  // Parking lots by 128 m cell, and the lot whose box holds a point.
  const grid = new Map();
  const cx0 = (v) => Math.floor(v / FIELD_CELL);
  const lots = [];
  const local = new Map(); // lot -> index in lots
  for (const lot of city.lots || []) {
    if (!lot || lot.type !== 'carpark') continue;
    local.set(lot, lots.length);
    lots.push(lot);
    for (let i = cx0(lot.x0); i <= cx0(lot.x1); i++) {
      for (let j = cx0(lot.z0); j <= cx0(lot.z1); j++) {
        const key = i * 65536 + j;
        let a = grid.get(key);
        if (!a) grid.set(key, (a = []));
        a.push(lot);
      }
    }
  }
  field.lotCount = () => lots.length;
  field.lotAt = (x, z) => {
    const list = grid.get(cx0(x) * 65536 + cx0(z));
    if (!list) return null;
    for (let k = 0; k < list.length; k++) {
      const l = list[k];
      if (x >= l.x0 - 0.5 && x <= l.x1 + 0.5 && z >= l.z0 - 0.5 && z <= l.z1 + 0.5) return l;
    }
    return null;
  };
  const cache = lotDressCache(city, dress);
  // Loaded records (by lot id) and the free pool.
  const byLot = new Map();
  const active = [];
  const pool = [];
  for (let k = 0; k < POOL0; k++) pool.push(makeRecord());
  // Lots to load, nearest first (indices in lots).
  const queue = new Int32Array(Math.max(1, lots.length));
  const queueD = new Float32Array(Math.max(1, lots.length));
  const queued = new Uint8Array(Math.max(1, lots.length));
  const wait = new Uint8Array(Math.max(1, lots.length));
  let qHead = 0, qLen = 0, qCount = 0;
  let lastHalf = NaN;
  // The listed-bay set of world/collision.js, made now rather than at the first load.
  bayCar(city, 0, 0, 0, 2);

  // A lot no tile has dressed yet is loaded from the build's quick bays-only
  // dressing (the same bays; lots.js BAYS_ONLY_FAST) into scratch arrays:
  // provisional, loaded again from the full dressing once the cache has it
  // (its blocked bays may differ: the features after the rows are missing).
  const SCR = [];
  const SCR_BLOCK = new Uint8Array(LOT_BAYS_MAX * 2);
  let provisional = 0, provAt = 0;
  function load(lot, rec = null) {
    if (!rec) rec = pool.length ? pool.pop() : makeRecord();
    let feats, blocked;
    if (!quick || cache.has(lot) || dress !== dressLot) {
      feats = cache.get(lot);
      blocked = blockedBays(feats);
      if (rec.prov) provisional--;
      rec.prov = false;
    } else {
      feats = dressLot(city, lot, SCR, BAYS_ONLY_FAST);
      let nb = 0;
      for (let q = 0; q < feats.length; q++) if (feats[q].kind === 'bay') nb += bayCount(feats[q]);
      blocked = blockedBaysInto(feats, nb <= SCR_BLOCK.length ? SCR_BLOCK.subarray(0, nb) : new Uint8Array(nb));
      if (!rec.prov) provisional++;
      rec.prov = true;
    }
    const mix = MIX_IDX[lot.district] || MIX_IDX.midtown;
    rec.lot = lot;
    rec.x0 = lot.x0; rec.z0 = lot.z0; rec.x1 = lot.x1; rec.z1 = lot.z1;
    rec.fill = -1;
    // The lot's ground height, once (opts.ground: world/ground.js groundFn;
    // a lot is flat): a height asked per car at each refresh made the
    // ground build its cells in the draw's sync (2 to 30 ms at times).
    rec.y = ground ? ground((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2) : 0;
    let n = 0, k = 0;
    for (let q = 0; q < feats.length; q++) {
      const f = feats[q];
      if (f.kind !== 'bay') continue;
      const nb = bayCount(f);
      const ca = Math.cos(f.heading), sa = Math.sin(f.heading);
      const half = (nb * 2.5) / 2;
      for (let s = 0; s < nb; s++, k++) {
        if (blocked[k]) { field.stats.blocked++; continue; }
        if (n >= LOT_BAYS_MAX) continue;
        const o = -half + (s + 0.5) * 2.5;
        const bx = f.x + ca * o, bz = f.z + sa * o;
        // The occupancy hash (2: a bay the curb system fills, never here).
        const u = bayLotU(city, lot, bx, bz, f.v);
        if (u < 0) continue;
        const bi = Math.round(bx * 5), bj = Math.round(bz * 5);
        const r1 = hash2(bi, bj, 1), r2 = hash2(bi, bj, 2), r3 = hash2(bi, bj, 3), r4 = hash2(bi, bj, 4);
        const sp = mix[Math.floor(r1 * mix.length)];
        rec.x[n] = bx + ca * (r4 - 0.5) * 0.3;
        rec.z[n] = bz + sa * (r4 - 0.5) * 0.3;
        // Nose in or tail in, a few degrees off the bay line.
        rec.yaw[n] = f.heading + Math.PI / 2 + (r3 < 0.3 ? Math.PI : 0) + (r2 - 0.5) * 0.12;
        rec.spec[n] = sp;
        rec.color[n] = lotCarColor(sp, hash2(bi, bj, 5));
        rec.u[n] = u;
        n++;
      }
    }
    rec.n = n;
    if (!byLot.has(lot.id)) {
      byLot.set(lot.id, rec);
      active.push(rec);
    }
    field.stats.loads++;
    return n;
  }

  // Find the lots in reach of (cx, cz) and queue the ones not loaded,
  // nearest first; give back the records of lots far out of reach.
  let lastCx = NaN, lastCz = NaN;
  function plan(cx, cz) {
    lastCx = cx; lastCz = cz;
    const keep = range + 60, keep2 = keep * keep;
    for (let k = active.length - 1; k >= 0; k--) {
      const r = active[k];
      const qx = cx < r.x0 ? r.x0 - cx : cx > r.x1 ? cx - r.x1 : 0;
      const qz = cz < r.z0 ? r.z0 - cz : cz > r.z1 ? cz - r.z1 : 0;
      if (qx * qx + qz * qz <= keep2) continue;
      byLot.delete(r.lot.id);
      if (r.prov) provisional--;
      r.prov = false;
      r.lot = null;
      r.n = 0;
      active[k] = active[active.length - 1];
      active.length--;
      pool.push(r);
      field.stats.released++;
    }
    // The queue: drop what was left of it, then the lots in reach.
    for (let k = qHead; k < qLen; k++) if (queue[k] >= 0) queued[queue[k]] = 0;
    qHead = qLen = qCount = 0;
    const reach = range + 20, r2 = reach * reach;
    const i0 = cx0(cx - reach), i1 = cx0(cx + reach), j0 = cx0(cz - reach), j1 = cx0(cz + reach);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = grid.get(i * 65536 + j);
        if (!list) continue;
        for (let li = 0; li < list.length; li++) {
          const lot = list[li];
          const li2 = local.get(lot);
          if (queued[li2] || byLot.has(lot.id)) continue;
          const qx = cx < lot.x0 ? lot.x0 - cx : cx > lot.x1 ? cx - lot.x1 : 0;
          const qz = cz < lot.z0 ? lot.z0 - cz : cz > lot.z1 ? cz - lot.z1 : 0;
          const d = qx * qx + qz * qz;
          if (d > r2) continue;
          queued[li2] = 1;
          // Insert by distance (a few lots at a time: a short list).
          let at = qLen++;
          qCount++;
          while (at > 0 && queueD[at - 1] > d) {
            queue[at] = queue[at - 1]; queueD[at] = queueD[at - 1];
            at--;
          }
          queue[at] = li2; queueD[at] = d;
        }
      }
    }
  }
  field.pending = () => qCount;
  field.plan = plan;
  // One step of loading: lots off the queue up to `bays` bays (at least one lot).
  // One step of loading: lots off the queue, nearest first, up to `bays`
  // bays (at least one lot). A lot the tiles have not dressed yet (the
  // shared cache, lots.js lotDressCache) waits for them up to DRESS_WAIT
  // steps (waitMax, at most 255; the tile builder keeps to its own budget),
  // and the lots behind it go first; then it is dressed here. force: no waiting.
  field.step = (bays = LOAD_BAYS_STEP, force = false, waitMax = DRESS_WAIT) => {
    let done = 0, lotsDone = 0;
    for (let k = qHead, looked = 0; k < qLen && looked < 24 && (lotsDone === 0 || done < bays); k++) {
      const li = queue[k];
      if (li < 0) continue;
      looked++;
      const lot = lots[li];
      if (!force && wait[li] < waitMax && !cache.has(lot)) {
        wait[li]++;
        continue;
      }
      queue[k] = -1;
      queued[li] = 0;
      wait[li] = 0;
      qCount--;
      if (byLot.has(lot.id)) continue;
      done += load(lot) + 8;
      lotsDone++;
    }
    while (qHead < qLen && queue[qHead] < 0) qHead++;
    // A provisional record whose lot the tiles have dressed since: loaded
    // again from the full dressing (one a step, when nothing else loaded).
    if (provisional > 0 && lotsDone === 0 && active.length) {
      for (let t = 0; t < active.length; t++) {
        provAt = (provAt + 1) % active.length;
        const r = active[provAt];
        if (r.prov && cache.has(r.lot)) { load(r.lot, r); field.stats.reloads++; break; }
      }
    }
    field.stats.loaded = active.length;
    return lotsDone;
  };
  // Load every lot in reach now (tools and tests: the whole result at once).
  field.loadAll = (cx, cz) => {
    plan(cx, cz);
    while (field.step(1e9, true));
  };

  // (cx, cz): the camera; (fx, fz): its look direction on the ground
  // (unit); hour: the clock; cap: cars wanted (default field.cap). blk, nBlk:
  // the real vehicles standing in the lots, six floats each (x, z, cos, sin
  // of the heading, half length, half width): a bay one of them overlaps
  // stays empty (a parked fire truck, a car the player left). Plans the
  // loads when the camera has moved 24 m (or on the first call); the lots
  // not loaded yet show no car until a step loads them.
  field.update = (cx, cz, fx, fz, hour, cap = field.cap, blk = null, nBlk = 0) => {
    const want = Math.min(MAX, Math.max(0, cap | 0));
    field.stats.updates++;
    if (!(Math.abs(cx - lastCx) < 24 && Math.abs(cz - lastCz) < 24)) plan(cx, cz);
    const half = Math.floor((((hour % 24) + 24) % 24) * 2);
    const newHour = half !== lastHalf;
    lastHalf = half;
    let n = 0;
    const r2 = range * range;
    for (let a = 0; a < active.length; a++) {
      const rec = active[a];
      const qx = cx < rec.x0 ? rec.x0 - cx : cx > rec.x1 ? cx - rec.x1 : 0;
      const qz = cz < rec.z0 ? rec.z0 - cz : cz > rec.z1 ? cz - rec.z1 : 0;
      if (qx * qx + qz * qz > r2) continue;
      if (newHour || rec.fill < 0) rec.fill = lotFill(rec.lot, hour);
      const fill = rec.fill;
      if (fill <= 0) continue;
      field.stats.lots++;
      const X = rec.x, Z = rec.z, U = rec.u;
      for (let s = 0, m = rec.n; s < m; s++) {
        if (U[s] >= fill) continue;
        const dx = X[s] - cx, dz = Z[s] - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        // In view: ahead within about 57 degrees, or close by.
        if (d > 14 && dx * fx + dz * fz < 0.54 * d) continue;
        field.stats.bays++;
        if (n >= want && d >= field.dist[n - 1]) continue;
        let blocked = false;
        for (let k = 0; k < nBlk && !blocked; k++) {
          const o = k * 6, rx = X[s] - blk[o], rz = Z[s] - blk[o + 1];
          const lx = rx * blk[o + 2] + rz * blk[o + 3], lz = -rx * blk[o + 3] + rz * blk[o + 2];
          blocked = Math.abs(lx) < blk[o + 4] + 2.4 && Math.abs(lz) < blk[o + 5] + 1.0;
        }
        if (blocked) continue;
        // Insert by distance (the arrays hold the nearest `want`).
        let at = n < want ? n++ : want - 1;
        while (at > 0 && field.dist[at - 1] > d) {
          const t = at - 1;
          field.x[at] = field.x[t]; field.z[at] = field.z[t]; field.yaw[at] = field.yaw[t];
          field.spec[at] = field.spec[t]; field.color[at] = field.color[t]; field.dist[at] = field.dist[t]; field.y[at] = field.y[t];
          at--;
        }
        field.x[at] = X[s]; field.z[at] = Z[s]; field.yaw[at] = rec.yaw[s]; field.y[at] = rec.y;
        field.spec[at] = rec.spec[s]; field.color[at] = rec.color[s]; field.dist[at] = d;
      }
    }
    field.n = n;
    return n;
  };
  return field;
}

// ---- Static cars at the curb (0.15 roads WP4) ----
//
// The parking lanes of the streets near the camera hold static, drawn cars
// (no vehicle, no simulation): a station every CURB_STEP m along each
// parking lane (the grid the curb spots of world/miami.js use), a car at
// CURB_FILL of them by a position hash (no rng). A station is left empty
// at a junction approach, where another street (a drive) meets the lane,
// on a junction's asphalt, near the shore or a building, and where a curb
// spot is (opts.spotNear: the live cars of systems/parked.js keep those).
// One street side is loaded at a time, a few stations a step; the records
// are pooled, like the lot field's. update() fills the same arrays as the
// lot field (x, z, yaw, y, spec, color, dist: the nearest `cap` in view)
// and col: every station car within COL_R m of the player (x, z, yaw), for
// the collision shapes of systems/parked.js.
export const CURB_STEP = 6.5;
export const CURB_FILL = 0.74;
export const CURB_MAX = 40; // most cars the field hands back
export const CURB_NEAR_M = 28; // within this of the player a car is drawn whatever the view
export const COL_R = 26; // cars within this of the player get a collision shape
export const COL_MAX = 24;
export const CURB_APPROACH = 9; // m of lane left empty past a junction's trimmed end
const STATIONS_STEP = 48;
const REC0 = 48;
const REC_CAP = 64;

function makeCurbRecord(cap) {
  return { key: -1, edge: -1, n: 0, cap, x: new Float32Array(cap), z: new Float32Array(cap), yaw: new Float32Array(cap), spec: new Uint8Array(cap), color: new Uint32Array(cap) };
}

export function createParkedCurbField(city, opts = {}) {
  const range = opts.range || 150;
  const spotNear = opts.spotNear || null;
  const MAX = CURB_MAX;
  const field = {
    n: 0, cap: opts.cap || 24,
    x: new Float32Array(MAX), z: new Float32Array(MAX), yaw: new Float32Array(MAX), y: new Float32Array(MAX),
    spec: new Uint8Array(MAX), color: new Uint32Array(MAX), dist: new Float32Array(MAX), pri: new Float32Array(MAX),
    nCol: 0, col: new Float32Array(COL_MAX * 3), colD: new Float32Array(COL_MAX),
    stats: { loads: 0, released: 0, stations: 0, filled: 0, updates: 0, edges: 0 },
    update: null, step: null, plan: null, pending: null, loadAll: null,
  };
  const nodes = city.nodes, edges = city.edges || [];
  const geo = city.roadGeo || null;
  const listed = typeof city.edgesNear === 'function';
  const edgeTmp = [], nearTmp = [];
  const byKey = new Map();
  const active = [];
  const pool = [];
  for (let k = 0; k < REC0; k++) pool.push(makeCurbRecord(REC_CAP));
  // Street sides to load, nearest first.
  let qKeys = new Int32Array(256), qD = new Float32Array(256), qLen = 0, qHead = 0;
  const queuedKey = new Set();
  let lastCx = NaN, lastCz = NaN;
  const MIX = {};
  for (const k of Object.keys(LOT_CAR_MIX)) MIX[k] = LOT_CAR_MIX[k].map((id) => LOT_CAR_SPECS.indexOf(id));

  const parkOf = (e, side) => (side ? e.parkR : e.parkL) > 0;
  const usableEdge = (e) => !!e && !e.bridge && !e.causeway && !e.ped && !(geo && geo.inner[e.id]) && e.length > 30;
  function segDist(e, x, z) {
    const a = nodes[e.a];
    const t = Math.max(0, Math.min(e.length, (x - a.x) * e.ux + (z - a.z) * e.uz));
    return Math.hypot(x - (a.x + e.ux * t), z - (a.z + e.uz * t));
  }
  // Is point (x, z) on the strip of another street than e (a drive or a side
  // street meeting the lane), or on a junction's asphalt?
  function otherRoad(e, x, z) {
    if (geo && onJunction(geo, x, z)) return true;
    if (!listed) return false;
    city.edgesNear(x, z, 12, nearTmp);
    for (let q = 0; q < nearTmp.length; q++) {
      const o = edges[nearTmp[q]];
      if (!o || o === e || o.bridge) continue;
      if (segDist(o, x, z) < o.width / 2 + 0.6) return true;
    }
    return false;
  }

  // Load one street side: its stations and their cars.
  function load(key) {
    const eid = key >> 1, side = key & 1, e = edges[eid];
    const rec = pool.length ? pool.pop() : makeCurbRecord(REC_CAP);
    rec.key = key; rec.edge = eid; rec.n = 0;
    byKey.set(key, rec);
    active.push(rec);
    if (!usableEdge(e) || !parkOf(e, side)) return 0;
    const a = nodes[e.a], b = nodes[e.b];
    const ta = geo ? geo.trim[2 * eid] : 0, tb = geo ? geo.trim[2 * eid + 1] : 0;
    const d0 = Math.max(a.hx || 0, ta) + CURB_APPROACH, d1 = e.length - Math.max(b.hx || 0, tb) - CURB_APPROACH;
    const rx = -e.uz, rz = e.ux;
    const heading = side || e.oneway ? Math.atan2(e.uz, e.ux) : Math.atan2(-e.uz, -e.ux);
    const need = d1 > d0 ? Math.floor((d1 - d0) / CURB_STEP) + 1 : 0;
    if (need > rec.cap) {
      rec.cap = need;
      rec.x = new Float32Array(need); rec.z = new Float32Array(need); rec.yaw = new Float32Array(need);
      rec.spec = new Uint8Array(need); rec.color = new Uint32Array(need);
    }
    let n = 0;
    for (let k = 0; k < need; k++) {
      const d = d0 + k * CURB_STEP;
      field.stats.stations++;
      const C = curbsAt(geo, e, d);
      const off = side ? C.r - GUTTER - PARK_W / 2 : C.l + GUTTER + PARK_W / 2;
      const x = a.x + e.ux * d + rx * off, z = a.z + e.uz * d + rz * off;
      const bi = Math.round(x * 5), bj = Math.round(z * 5);
      if (hash2(bi, bj, 11) >= CURB_FILL) continue;
      if (spotNear && spotNear(x, z, 3.4)) continue;
      if (otherRoad(e, x, z) || city.mainShore(x, z) < 3 || city.inBuilding(x, z, 1.5)) continue;
      const mix = MIX[city.districtOf(x, z)] || MIX.midtown;
      const sp = mix[Math.floor(hash2(bi, bj, 1) * mix.length)];
      const slide = (hash2(bi, bj, 4) - 0.5) * 0.9;
      rec.x[n] = x + e.ux * slide;
      rec.z[n] = z + e.uz * slide;
      rec.yaw[n] = heading + (hash2(bi, bj, 2) - 0.5) * 0.07;
      rec.spec[n] = sp;
      rec.color[n] = lotCarColor(sp, hash2(bi, bj, 5));
      n++;
    }
    rec.n = n;
    field.stats.filled += n;
    field.stats.loads++;
    return need;
  }

  function plan(cx, cz) {
    lastCx = cx; lastCz = cz;
    const keep = range + 60;
    for (let k = active.length - 1; k >= 0; k--) {
      const r = active[k], e = edges[r.edge];
      if (e && segDist(e, cx, cz) <= keep) continue;
      byKey.delete(r.key);
      r.n = 0; r.key = -1; r.edge = -1;
      active[k] = active[active.length - 1];
      active.length--;
      pool.push(r);
      field.stats.released++;
    }
    for (let k = qHead; k < qLen; k++) queuedKey.delete(qKeys[k]);
    qHead = qLen = 0;
    const reach = range + 20;
    let n;
    if (listed) { city.edgesNear(cx, cz, reach, edgeTmp); n = edgeTmp.length; } else n = edges.length;
    for (let q = 0; q < n; q++) {
      const eid = listed ? edgeTmp[q] : q;
      const e = edges[eid];
      if (!usableEdge(e) || !(e.parkL > 0 || e.parkR > 0)) continue;
      const d = segDist(e, cx, cz);
      if (d > reach) continue;
      for (let side = 0; side < 2; side++) {
        const key = eid * 2 + side;
        if (!parkOf(e, side) || byKey.has(key) || queuedKey.has(key)) continue;
        if (qLen === qKeys.length) {
          const k2 = new Int32Array(qLen * 2), d2 = new Float32Array(qLen * 2);
          k2.set(qKeys); d2.set(qD); qKeys = k2; qD = d2;
        }
        let at = qLen++;
        while (at > 0 && qD[at - 1] > d) { qKeys[at] = qKeys[at - 1]; qD[at] = qD[at - 1]; at--; }
        qKeys[at] = key; qD[at] = d;
        queuedKey.add(key);
      }
    }
    field.stats.edges = active.length;
  }
  field.plan = plan;
  field.pending = () => qLen - qHead;
  // One step of loading: street sides off the queue, nearest first, up to
  // `stations` stations (at least one side).
  field.step = (stations = STATIONS_STEP) => {
    let done = 0, sides = 0;
    while (qHead < qLen && (sides === 0 || done < stations)) {
      const key = qKeys[qHead++];
      queuedKey.delete(key);
      if (byKey.has(key)) continue;
      done += load(key) + 4;
      sides++;
    }
    return sides;
  };
  field.loadAll = (cx, cz) => {
    plan(cx, cz);
    while (field.step(1e9));
  };
  // Cars of the loaded records within r m of (x, z) (tests, tools).
  field.countNear = (x, z, r) => {
    let c = 0;
    for (let a = 0; a < active.length; a++) {
      const rec = active[a];
      for (let s = 0; s < rec.n; s++) if (Math.hypot(rec.x[s] - x, rec.z[s] - z) < r) c++;
    }
    return c;
  };
  // (cx, cz): the camera, (fx, fz) its look direction, (px, pz) the player;
  // cap: cars wanted; blk, nBlk: real vehicles standing near (six floats
  // each, as the lot field's): a station one overlaps stays empty.
  field.update = (cx, cz, fx, fz, px, pz, cap = field.cap, blk = null, nBlk = 0) => {
    const want = Math.min(MAX, Math.max(0, cap | 0));
    field.stats.updates++;
    if (!(Math.abs(cx - lastCx) < 24 && Math.abs(cz - lastCz) < 24)) plan(cx, cz);
    let n = 0, nc = 0;
    const r2 = range * range, c2 = COL_R * COL_R, n2 = CURB_NEAR_M * CURB_NEAR_M;
    for (let a = 0; a < active.length; a++) {
      const rec = active[a];
      const X = rec.x, Z = rec.z;
      for (let s = 0, m = rec.n; s < m; s++) {
        const dx = X[s] - cx, dz = Z[s] - cz;
        const d2 = dx * dx + dz * dz;
        const qx = X[s] - px, qz = Z[s] - pz, p2 = qx * qx + qz * qz;
        if (d2 > r2 && p2 > c2) continue;
        let blocked = false;
        for (let k = 0; k < nBlk && !blocked; k++) {
          const o = k * 6, rx = X[s] - blk[o], rz = Z[s] - blk[o + 1];
          const lx = rx * blk[o + 2] + rz * blk[o + 3], lz = -rx * blk[o + 3] + rz * blk[o + 2];
          blocked = Math.abs(lx) < blk[o + 4] + 2.4 && Math.abs(lz) < blk[o + 5] + 1.0;
        }
        if (blocked) continue;
        if (p2 < c2) {
          // The COL_MAX nearest to the player get a collision shape.
          let slot = -1;
          if (nc < COL_MAX) slot = nc++;
          else {
            let far = 0;
            for (let k = 1; k < COL_MAX; k++) if (field.colD[k] > field.colD[far]) far = k;
            if (p2 < field.colD[far]) slot = far;
          }
          if (slot >= 0) {
            field.col[slot * 3] = X[s]; field.col[slot * 3 + 1] = Z[s]; field.col[slot * 3 + 2] = rec.yaw[s];
            field.colD[slot] = p2;
          }
        }
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        // Near the player or the camera, or ahead within about 57 degrees.
        const near = p2 < n2 || d <= 14;
        if (!near && dx * fx + dz * fz < 0.54 * d) continue;
        // Kept by priority (the near ones first, then by distance).
        const pri = near ? d - 1000 : d;
        if (n >= want && pri >= field.pri[n - 1]) continue;
        let at = n < want ? n++ : want - 1;
        while (at > 0 && field.pri[at - 1] > pri) {
          const t = at - 1;
          field.x[at] = field.x[t]; field.z[at] = field.z[t]; field.yaw[at] = field.yaw[t];
          field.spec[at] = field.spec[t]; field.color[at] = field.color[t]; field.dist[at] = field.dist[t]; field.pri[at] = field.pri[t];
          at--;
        }
        field.x[at] = X[s]; field.z[at] = Z[s]; field.yaw[at] = rec.yaw[s]; field.y[at] = 0;
        field.spec[at] = rec.spec[s]; field.color[at] = rec.color[s]; field.dist[at] = d; field.pri[at] = pri;
      }
    }
    field.n = n;
    field.nCol = nc;
    return n;
  };
  return field;
}
