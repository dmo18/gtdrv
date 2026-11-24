// Collision sweep (docs/PLAN_V4.md task 1): in every region, drive each
// vehicle class at speed into every solid class (each PROP_SOLIDS street
// and lot kind, parked bay cars, buildings, road end barriers, landmarks,
// sea walls and rails) from several angles, and check the craft is
// stopped or deflected (or shears a breakable prop above its break speed),
// never gets more than 0.3 m into the solid (also between steps: no
// tunnelling), never sinks below the ground, never ends inside any solid,
// and never gets past a sea wall or rail toward the water. Boats are driven
// at the shore and the piers from the water.
//
//   node scripts/collision-sweep.mjs [--region miami-beach] [--per 3] [--json out.json]
//
// Pure logic: the same modules the game steps, no three.js, no DOM.
// sweepRegion() is also run (reduced) by test/collision-sweep.test.js.
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { attachExplore } from '../src/world/adventures.js';
import { REGION_IDS } from '../src/world/regions.js';
import { createCollisionWorld, fillCollision, attachLotCollision, addLotSolids } from '../src/world/collision.js';
import { dressLot } from '../src/world/lots.js';
import { groundFn } from '../src/world/ground.js';
import { isWallTag } from '../src/world/edgelines.js';
import { PROP_SOLIDS } from '../src/world/propsolid.js';
import { createVehicle, stepVehicle, vehicleCorners } from '../src/entities/vehicle.js';
import { createTank, stepTank } from '../src/entities/tank.js';
import { createAircraft, stepAircraft } from '../src/entities/aircraft.js';
import { createWalker, stepWalker } from '../src/entities/onfoot.js';
import { createBoat, stepBoat } from '../src/entities/boat.js';

export const DT = 1 / 60;
const MPH = 2.23694;
export const PEN_MAX = 0.3; // m a craft may be inside a solid
export const BELOW_MAX = 0.3; // m a craft may sit below the ground (CLEARANCE is 0.14)
const CELL = 32;
const CORNER_IN = 0.15; // m a box corner may be inside a wall capsule (see runOne)

// ---- the world, as the game builds it (game.js, render/realcity.js) ----
const read = (id) => JSON.parse(fs.readFileSync(new URL(`../src/world/data/${id}.json`, import.meta.url), 'utf8'));
export function buildWorld(id, city = null) {
  if (!city) {
    city = createMiamiCity(read(id), { region: id });
    attachExplore(city);
  }
  const collision = createCollisionWorld();
  fillCollision(city, collision);
  const statics = { boxes: collision.boxes.slice(), circles: collision.circles.slice() };
  attachLotCollision(city, collision, dressLot);
  const waterCollision = createCollisionWorld();
  for (const r of city.piers || []) waterCollision.addBox(r.x0, r.z0, r.x1, r.z1, 2, 'pier');
  return { city, collision, waterCollision, statics, world: { collision, waterCollision, city, time: 0, crafts: null }, g: groundFn(city) };
}

// ---- shape geometry ----
function shapeCenter(s, out) {
  if (s.kind === 0) { out[0] = (s.x0 + s.x1) / 2; out[1] = (s.z0 + s.z1) / 2; } else if (s.kind === 2) { out[0] = (s.x0 + s.x1) / 2; out[1] = (s.z0 + s.z1) / 2; } else { out[0] = s.x; out[1] = s.z; }
  return out;
}
// How far a circle (x, z, r) is inside shape s (<= 0: not touching).
export function penetration(s, x, z, r) {
  if (s.kind === 0) {
    const px = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x, pz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
    const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
    if (d2 > 1e-12) return r - Math.sqrt(d2);
    return r + Math.min(x - s.x0, s.x1 - x, z - s.z0, s.z1 - z);
  }
  if (s.kind === 2) {
    const sx = s.x1 - s.x0, sz = s.z1 - s.z0, L2 = sx * sx + sz * sz;
    let t = L2 > 1e-12 ? ((x - s.x0) * sx + (z - s.z0) * sz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return r + s.r - Math.hypot(x - s.x0 - sx * t, z - s.z0 - sz * t);
  }
  return r + s.r - Math.hypot(x - s.x, z - s.z);
}

// ---- crafts: one adapter per class ----
// body(c, fn): fn(x, z, r) for each body circle at the craft's pose.
// yRule: the height a solid must top to stop it (resolveCircle's y).
const carBody = (spec) => (c, x, z, hd, fn) => {
  const r = spec.width / 2, half = Math.max(0, spec.length / 2 - r);
  const ch = Math.cos(hd), sh = Math.sin(hd);
  fn(x + ch * half, z + sh * half, r); fn(x, z, r); fn(x - ch * half, z - sh * half, r);
};
function landCar(specId) {
  return {
    land: true,
    make(x, z, hd, u) { const v = createVehicle(specId, x, z, hd); v.vx = Math.cos(hd) * u; v.vz = Math.sin(hd) * u; return v; },
    step(v, W) { stepVehicle(v, CTL_CAR, DT, W.world); },
    body: null,
    len: 0, width: 0, yRule: (v) => (Number.isFinite(v.y) ? v.y : 0),
    corners(v, out) { return vehicleCorners(v, out); },
    init(spec) { this.body = carBody(spec); this.len = spec.length; this.width = spec.width; return this; },
  };
}
const CTL_CAR = { steer: 0, throttle: 1, brake: 0 };
const CTL_TANK = { steer: 0, throttle: 1, brake: 0 };
const CTL_PLANE = { steer: 0, pitch: 0, throttle: 0.25, brake: 0 };
const CTL_FOOT = { moveX: 0, moveY: 1, sprint: true };
const CTL_BOAT = { steer: 0, throttle: 1, brake: 0 };

export const CRAFTS = {
  car: { ...landCar('sedan').init(createVehicle('sedan', 0, 0, 0).spec), speeds: [15, 30, 45, 70, 100].map((m) => m / MPH) },
  truck: { ...landCar('truck').init(createVehicle('truck', 0, 0, 0).spec), speeds: [15, 30, 45, 65].map((m) => m / MPH) },
  tank: (() => {
    const spec = createTank('rustback', 0, 0, 0).spec;
    return {
      land: true, len: spec.length, width: spec.width, speeds: [3, 7, 13],
      // The tank's own rule (tank.js wallCircle): it rolls over what is 1 m
      // tall or less (benches, bins, bollards, hydrants, planters).
      yRule: () => 1,
      make(x, z, hd, u) { const t = createTank('rustback', x, z, hd); t.vx = Math.cos(hd) * u; t.vz = Math.sin(hd) * u; t.driver = {}; return t; },
      step(t, W) { stepTank(t, CTL_TANK, DT, W.world); },
      body(c, x, z, hd, fn) { const o = spec.length / 4, ch = Math.cos(hd), sh = Math.sin(hd); fn(x + ch * o, z + sh * o, spec.width / 2); fn(x - ch * o, z - sh * o, spec.width / 2); },
      corners(t, out) { return vehicleCorners(t, out); },
    };
  })(),
  plane: (() => {
    const spec = createAircraft('prop', 0, 0, 0).spec;
    return {
      land: true, len: spec.hitRadius * 2, width: spec.hitRadius * 2, speeds: [5, 15, 28],
      yRule: (a) => (a.y < 0 ? 0 : a.y),
      make(x, z, hd, u) { const a = createAircraft('prop', x, z, hd); a.speed = u; a.vx = Math.cos(hd) * u; a.vz = Math.sin(hd) * u; a.engineOn = true; a.driver = {}; return a; },
      step(a, W) { stepAircraft(a, CTL_PLANE, DT, W.world); },
      // The taxiing plane's one hit circle (aircraft.js move).
      body(c, x, z, hd, fn) { fn(x, z, spec.hitRadius); },
      corners: null,
    };
  })(),
  foot: {
    land: true, len: 0.7, width: 0.7, speeds: [6],
    yRule: () => 0,
    make(x, z, hd, u) { const w = createWalker(x, z, hd); w.vx = Math.cos(hd) * u; w.vz = Math.sin(hd) * u; w.cam = hd; return w; },
    step(w, W) { stepWalker(w, CTL_FOOT, DT, W.world, w.cam); },
    body(c, x, z, hd, fn) { fn(x, z, 0.35); },
    corners: null,
  },
};

// ---- targets ----
// { cls, shapes, px, pz, nx, nz (face normal, or 0 0 for a point), reach, h, brk }
function groupReach(shapes, px, pz) {
  let reach = 0;
  for (const s of shapes) {
    let d;
    if (s.kind === 0) d = Math.max(Math.hypot(s.x0 - px, s.z0 - pz), Math.hypot(s.x1 - px, s.z1 - pz), Math.hypot(s.x0 - px, s.z1 - pz), Math.hypot(s.x1 - px, s.z0 - pz));
    else if (s.kind === 2) d = Math.max(Math.hypot(s.x0 - px, s.z0 - pz), Math.hypot(s.x1 - px, s.z1 - pz)) + s.r;
    else d = Math.hypot(s.x - px, s.z - pz) + s.r;
    if (d > reach) reach = d;
  }
  return reach;
}
const C2 = [0, 0];
function pointTarget(cls, shapes) {
  let px = 0, pz = 0;
  for (const s of shapes) { shapeCenter(s, C2); px += C2[0]; pz += C2[1]; }
  px /= shapes.length; pz /= shapes.length;
  return { cls, shapes, px, pz, nx: 0, nz: 0, reach: groupReach(shapes, px, pz), h: Math.max(...shapes.map((s) => s.h)), brk: shapes[0].brk || null };
}

const COUNT_SINK = { addBox: () => ({}), addCircle: () => ({}) };
// Every target class of the region, with up to `pool` candidates each,
// spread over the map (every k-th of the class in a fixed order).
export function collectTargets(W, pool = 40) {
  const { city, collision, statics } = W;
  const byCls = new Map();
  const add = (cls, t) => { let a = byCls.get(cls); if (!a) byCls.set(cls, (a = [])); a.push(t); };
  // Street props.
  const props = collision.layerNamed('props');
  for (let i = 0; i < props.size; i++) {
    const it = props.item(i);
    add('street:' + it.type, () => pointTarget('street:' + it.type, props.shapesOf(i)));
  }
  // Lot features (one feature's shapes together) and bay cars.
  const lotL = collision.lotLayer;
  const lots = city.lots || [];
  for (let k = 0; k < lots.length; k++) {
    const lot = lots[k];
    if (!lot || lot.type === 'verge' || lot.type === 'airfield') continue;
    const feats = lotL.cache.get(lot) || [];
    let solidFeats = 0;
    for (const f of feats) { const e = PROP_SOLIDS[f.kind]; if (e ? e.mode !== 'flat' : f.solid) solidFeats++; }
    const hasBay = feats.some((f) => f.kind === 'bay');
    if (!solidFeats && !hasBay) continue;
    let pos = 0;
    for (let q = 0; q < feats.length; q++) {
      const f = feats[q];
      const n = addLotSolids(COUNT_SINK, [f], 1, null);
      if (!n) continue;
      const start = pos;
      pos += n;
      add('lot:' + f.kind, () => pointTarget('lot:' + f.kind, lotL.shapesOf(k).slice(start, start + n)));
    }
    if (hasBay) {
      const base = pos;
      add('lot:car', () => {
        const all = lotL.shapesOf(k);
        // The first standing bay car (two circles) of the lot.
        for (let i = base; i + 1 < all.length; i += 2) if (!all[i].off) return pointTarget('lot:car', [all[i], all[i + 1]]);
        return null;
      });
    }
  }
  // Buildings (by face), road end barriers, landmarks.
  for (const b of statics.boxes) {
    if (!b.tag || b.x1 - b.x0 < 6 || b.z1 - b.z0 < 6) continue;
    add('building', () => {
      // The face toward the nearest road (the side a car comes from).
      const faces = [[b.x0, (b.z0 + b.z1) / 2, -1, 0], [b.x1, (b.z0 + b.z1) / 2, 1, 0], [(b.x0 + b.x1) / 2, b.z0, 0, -1], [(b.x0 + b.x1) / 2, b.z1, 0, 1]];
      const out = [];
      for (const [px, pz, nx, nz] of faces) out.push({ cls: 'building', shapes: [b], px, pz, nx, nz, reach: 0, h: b.h, brk: null });
      return out;
    });
  }
  // Road end barriers: one row of posts (1 m apart) each.
  const barrier = statics.circles.filter((c) => c.tag === 'barrier');
  for (let i = 0; i < barrier.length;) {
    let j = i + 1;
    while (j < barrier.length && Math.hypot(barrier[j].x - barrier[j - 1].x, barrier[j].z - barrier[j - 1].z) < 1.6) j++;
    const row = barrier.slice(i, j);
    add('barrier', () => pointTarget('barrier', row));
    i = j;
  }
  for (const c of statics.circles) if (c.tag === 'crane' || c.tag === 'lighthouse') add(c.tag, () => pointTarget(c.tag, [c]));
  // Sea walls and rails: segments with only wall lines round them.
  const E = collision.layerNamed('edges');
  const B = city.crop || city.bounds;
  const seen = { seawall: [], rail: [] };
  for (let cz = Math.floor(B.z0 / CELL); cz <= Math.floor(B.z1 / CELL); cz++) {
    for (let cx = Math.floor(B.x0 / CELL); cx <= Math.floor(B.x1 / CELL); cx++) {
      const r = E.rawCell(cx, cz);
      for (let s = 0, t = 0; s < r.segs.length; s += 4, t++) {
        const tag = r.tags[t];
        if (!isWallTag(tag)) continue;
        const x0 = r.segs[s], z0 = r.segs[s + 1], x1 = r.segs[s + 2], z1 = r.segs[s + 3];
        if (Math.hypot(x1 - x0, z1 - z0) < 0.8) continue;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (seen[tag].some((p) => Math.abs(p[0] - mx) < 60 && Math.abs(p[1] - mz) < 60)) continue;
        seen[tag].push([mx, mz]);
        add(tag, () => {
          let clean = true;
          E.eachLine(mx - 20, mz - 20, mx + 20, mz + 20, (a, b, c, d, tg) => { if (!isWallTag(tg) && Math.hypot((a + c) / 2 - mx, (b + d) / 2 - mz) < 20) clean = false; });
          if (!clean) return null;
          let nx = -(z1 - z0), nz = x1 - x0;
          const nl = Math.hypot(nx, nz);
          nx /= nl; nz /= nl;
          if (E.fieldAt(mx + nx, mz + nz) < E.fieldAt(mx - nx, mz - nz)) { nx = -nx; nz = -nz; }
          // The wall line round the point (10 m each way): a glancing car
          // slides along it.
          const shapes = [];
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              for (const q of E.cell(Math.floor(mx / CELL) + i, Math.floor(mz / CELL) + j)) {
                const qx = (q.x0 + q.x1) / 2, qz = (q.z0 + q.z1) / 2;
                if (shapes.includes(q) || Math.hypot(qx - mx, qz - mz) > 10 || Math.abs((qx - mx) * nx + (qz - mz) * nz) > 3) continue;
                // Its land normal from the field; only the target's own
                // side (not the rail across a deck).
                const ql = Math.hypot(q.x1 - q.x0, q.z1 - q.z0);
                if (ql < 1e-3) continue;
                let ax = -(q.z1 - q.z0) / ql, az = (q.x1 - q.x0) / ql;
                if (E.fieldAt(qx + ax * 1.5, qz + az * 1.5) < E.fieldAt(qx - ax * 1.5, qz - az * 1.5)) { ax = -ax; az = -az; }
                if (ax * nx + az * nz < 0.3) continue;
                q.lnx = ax; q.lnz = az;
                shapes.push(q);
              }
            }
          }
          if (!shapes.length) return null;
          return { cls: tag, shapes, px: mx, pz: mz, nx, nz, reach: 0, h: shapes[0].h, brk: null, wall: true };
        });
      }
    }
  }
  // Spread: every k-th candidate.
  const out = new Map();
  for (const [cls, list] of byCls) {
    const k = Math.max(1, Math.floor(list.length / pool));
    const pick = [];
    for (let i = Math.floor(k / 2); i < list.length && pick.length < pool; i += k) pick.push(list[i]);
    out.set(cls, { total: list.length, make: pick });
  }
  return out;
}

// ---- one run ----
function restoreBreaks(W, seq0) {
  const col = W.collision;
  for (const rec of col.breaks) {
    if (rec.seq <= seq0 || !rec.shape) continue;
    const g = rec.shape.grp;
    if (g) for (const s of g) s.off = false;
    else rec.shape.off = false;
  }
}
const CORN = new Array(8);
function bodyClear(W, C, x, z, hd, skip, y) {
  let ok = true;
  C.body(null, x, z, hd, (bx, bz, r) => {
    if (!ok) return;
    if (C.land && W.city.isGround && !W.city.isGround(bx, bz)) { ok = false; return; }
    if (W.collision.resolveCircle(bx, bz, r + 0.05, y).hit) ok = false;
  });
  if (ok && skip && skip.wall && C.corners) {
    // The whole box on the land side.
    const E = W.collision.layerNamed('edges');
    const fake = { x, z, heading: hd, spec: { length: C.len, width: C.width } };
    vehicleCorners(fake, CORN);
    for (let i = 0; i < 8 && ok; i += 2) if (E.fieldAt(CORN[i], CORN[i + 1]) < 0.3) ok = false;
  }
  return ok;
}
function targetPen(C, T, x, z, hd) {
  let m = -Infinity;
  C.body(null, x, z, hd, (bx, bz, r) => {
    for (const s of T.shapes) { if (s.off) continue; const p = penetration(s, bx, bz, r); if (p > m) m = p; }
  });
  return m;
}

// How far (x, z) is past the wall line of T toward the water (0: not):
// on the water side (lnx, lnz: a segment's land normal) of the nearest
// segment, within 3 m of it.
export function wallCross(T, x, z) {
  // The nearest segment of the line decides (corners of a turning wall).
  let best = Infinity, side = 0;
  for (const s of T.shapes) {
    const sx = s.x1 - s.x0, sz = s.z1 - s.z0, L2 = sx * sx + sz * sz;
    if (L2 < 1e-6) continue;
    let t = ((x - s.x0) * sx + (z - s.z0) * sz) / L2;
    const end = t < 0 || t > 1;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - s.x0 - sx * t, ez = z - s.z0 - sz * t, d = Math.hypot(ex, ez);
    if (d < best) { best = d; side = end ? 0 : ex * s.lnx + ez * s.lnz; }
  }
  // (Past the end of the listed line, where the wall turns: not judged.)
  return best < 3 && side < 0 ? -side : 0;
}

// Drives craft class C at target T along direction (dx, dz) at speed u.
// Returns null when the approach is not clear, else an outcome.
export function runOne(W, C, T, dx, dz, u, trace = null) {
  const hd = Math.atan2(dz, dx);
  const yGround = (x, z) => W.g(x, z);
  // Contact distance: back off along -d until the body is clear of T.
  let S;
  if (T.nx || T.nz) {
    const cosA = -(dx * T.nx + dz * T.nz);
    if (cosA < 0.3) return null;
    S = Math.min(30, (C.len / 2 + 1.2) / cosA + 0.5);
  } else S = T.reach + C.len / 2 + 1.2;
  const sx = T.px - dx * S, sz = T.pz - dz * S;
  // Clear approach (T off): from the start until the center reaches the
  // target point (a face: until the front reaches it).
  for (const s of T.shapes) s.off = true;
  let clear = true;
  const yRule0 = C.yRule({ y: yGround(sx, sz) });
  const end = T.nx || T.nz ? S - (C.len / 2 + 0.5) / -(dx * T.nx + dz * T.nz) : S;
  for (let t = 0; t <= end && clear; t += 0.4) clear = bodyClear(W, C, sx + dx * t, sz + dz * t, hd, T, yRule0);
  for (const s of T.shapes) s.off = false;
  if (!clear) return null;
  if (targetPen(C, T, sx, sz, hd) > -0.05) return null;
  // Tank: what is 1 m tall or less is rolled over by design.
  if (C.yRule({ y: 0 }) >= T.h && !T.wall) return { out: 'over-low' };

  const v = C.make(sx, sz, hd, u);
  if (!C.land) v.y = 0;
  W.world.time = 0;
  const steps = Math.ceil(Math.min(6, (S + 12) / Math.max(u, 2) + 1.5) / DT);
  let maxPen = -Infinity, below = 0, over = 0, sheared = false;
  const E = T.wall ? W.collision.layerNamed('edges') : null;
  const breakSeq0 = W.collision.breakSeq;
  for (let i = 0; i < steps; i++) {
    const ox = v.x, oz = v.z, oh = v.heading;
    C.step(v, W);
    W.world.time += DT;
    if (T.shapes[0].off) { sheared = true; continue; }
    // In the target now, or on the way there (tunnelling between steps).
    const dh = Math.atan2(Math.sin(v.heading - oh), Math.cos(v.heading - oh));
    for (let k = 1; k <= 4; k++) {
      const f = k / 4;
      const p = targetPen(C, T, ox + (v.x - ox) * f, oz + (v.z - oz) * f, oh + dh * f);
      if (p > maxPen) maxPen = p;
    }
    if (trace) trace(i, v, targetPen(C, T, v.x, v.z, v.heading));
    if (C.land && Number.isFinite(v.y)) {
      const b = yGround(v.x, v.z) - v.y;
      if (b > below) below = b;
    }
    if (E) {
      let o = wallCross(T, v.x, v.z);
      if (C.corners) {
        C.corners(v, CORN);
        for (let q = 0; q < 8; q += 2) {
          o = Math.max(o, wallCross(T, CORN[q], CORN[q + 1]));
          // A box corner inside any wall capsule: the corner probes keep it
          // 0.08 m clear, so deeper than 0.15 m is a corner going through.
          const list = E.cell(Math.floor(CORN[q] / CELL), Math.floor(CORN[q + 1] / CELL));
          for (const w of list) {
            const dep = penetration(w, CORN[q], CORN[q + 1], 0);
            if (dep > CORNER_IN && dep - CORNER_IN + PEN_MAX > o) o = dep - CORNER_IN + PEN_MAX;
          }
        }
      }
      if (o > over) over = o;
    }
    if (v.wrecked && C !== CRAFTS.plane) break;
  }
  // Ends inside any solid?
  let stuck = 0;
  C.body(null, v.x, v.z, v.heading, (bx, bz, r) => {
    const res = W.collision.resolveCircle(bx, bz, r, C.yRule(v));
    if (res.hit && res.depth > stuck) stuck = res.depth;
  });
  // Breakables restored for the next run.
  // Every prop this run broke stands again (the ring holds the last 16).
  restoreBreaks(W, breakSeq0);
  const fwd = v.vx * dx + v.vz * dz;
  const fails = [];
  if (maxPen > PEN_MAX) fails.push('pen');
  if (below > BELOW_MAX) fails.push('below');
  if (stuck > PEN_MAX) fails.push('stuck');
  if (over > PEN_MAX) fails.push('over');
  return {
    out: fails.length ? 'FAIL' : sheared ? 'sheared' : fwd < 1 ? 'stopped' : 'deflected',
    fails, maxPen, below, over, stuck, sx, sz, hd, u, x: v.x, z: v.z,
  };
}

const ANGLES8 = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
const FACE_ANG = [0, 35, -35, 65, -65].map((d) => (d * Math.PI) / 180);

// Every class in one region: per class and craft, runs and outcomes.
export function sweepRegion(W, { per = 3, pool = 40, crafts = Object.keys(CRAFTS), classes = null, angles = ANGLES8, onFail = null } = {}) {
  const targets = collectTargets(W, pool);
  const rows = [];
  for (const [cls, { total, make }] of targets) {
    if (classes && !classes.includes(cls)) continue;
    for (const cname of crafts) {
      const C = CRAFTS[cname];
      const row = { cls, craft: cname, total, targets: 0, runs: 0, stopped: 0, deflected: 0, sheared: 0, overLow: 0, fail: 0, fails: [] };
      for (const mk of make) {
        if (row.targets >= per) break;
        let ts = mk && mk();
        if (!ts) continue;
        if (!Array.isArray(ts)) ts = [ts];
        let used = false;
        for (const T of ts) {
          const dirs = T.nx || T.nz ? FACE_ANG.map((a) => { const c = Math.cos(a), s = Math.sin(a); return [-(T.nx * c - T.nz * s), -(T.nx * s + T.nz * c)]; }) : angles.map((a) => [Math.cos(a), Math.sin(a)]);
          for (const [dx, dz] of dirs) {
            for (const u of C.speeds) {
              const r = runOne(W, C, T, dx, dz, u);
              if (!r) break; // the approach is blocked at every speed
              used = true;
              row.runs++;
              if (r.out === 'over-low') { row.overLow++; break; }
              if (r.out === 'FAIL') {
                row.fail++;
                const rec = { cls, craft: cname, fails: r.fails, mph: +(u * MPH).toFixed(0), at: [+T.px.toFixed(1), +T.pz.toFixed(1)], hd: +r.hd.toFixed(2), pen: +r.maxPen.toFixed(2), below: +r.below.toFixed(2), over: +r.over.toFixed(2), stuck: +r.stuck.toFixed(2) };
                if (row.fails.length < 5) row.fails.push(rec);
                if (onFail) onFail(rec);
              } else row[r.out]++;
            }
          }
        }
        if (used) row.targets++;
      }
      if (row.runs) rows.push(row);
    }
  }
  return rows;
}

// ---- boats: the shore and the piers from the water ----
export function sweepBoats(W, { per = 6, specs = ['speedboat', 'jetski', 'fisher'] } = {}) {
  const { city, waterCollision } = W;
  const rows = [];
  const E = W.collision.layerNamed('edges');
  const B = city.crop || city.bounds;
  // Shore points: sea wall segments with open water 40 m out.
  const shore = [];
  for (let cz = Math.floor(B.z0 / CELL); cz <= Math.floor(B.z1 / CELL) && shore.length < per * 8; cz += 3) {
    for (let cx = Math.floor(B.x0 / CELL); cx <= Math.floor(B.x1 / CELL) && shore.length < per * 8; cx += 3) {
      const r = E.rawCell(cx, cz);
      for (let s = 0; s < r.segs.length; s += 4) {
        const x0 = r.segs[s], z0 = r.segs[s + 1], x1 = r.segs[s + 2], z1 = r.segs[s + 3];
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        let nx = -(z1 - z0), nz = x1 - x0;
        const nl = Math.hypot(nx, nz);
        if (nl < 0.8) continue;
        nx /= nl; nz /= nl;
        if (city.shoreDist(mx + nx * 3, mz + nz * 3) < city.shoreDist(mx - nx * 3, mz - nz * 3)) { nx = -nx; nz = -nz; }
        let open = true;
        for (let d = 6; d <= 40 && open; d += 3) if (city.shoreDist(mx - nx * d, mz - nz * d) > -d * 0.5 || waterCollision.resolveCircle(mx - nx * d, mz - nz * d, 3, 0).hit) open = false;
        if (open) { shore.push({ cls: 'shore', px: mx, pz: mz, nx, nz }); break; }
      }
    }
  }
  const piers = (city.piers || []).map((p) => ({ cls: 'pier', p }));
  for (const spec of specs) {
    for (const group of [shore.slice(0, per), piers.slice(0, per)]) {
      const row = { cls: group[0] ? group[0].cls : 'none', craft: 'boat:' + spec, total: group.length, targets: 0, runs: 0, stopped: 0, deflected: 0, sheared: 0, overLow: 0, fail: 0, fails: [] };
      for (const T of group) {
        let used = false;
        const dirs = [];
        if (T.cls === 'shore') for (const a of [0, 35, -35, 65, -65]) { const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); dirs.push([T.nx * c - T.nz * s, T.nx * s + T.nz * c, T.px, T.pz]); } else {
          const p = T.p, mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2;
          for (const a of ANGLES8) dirs.push([Math.cos(a), Math.sin(a), mx, mz]);
        }
        for (const [dx, dz, px, pz] of dirs) {
          // Start 30 m out on open water, run in.
          let sx = px - dx * 30, sz = pz - dz * 30;
          if (T.cls === 'pier') {
            // Back off to the pier's edge plus 25 m.
            const p = T.p;
            let t = 0;
            while (t < 200 && px - dx * t >= p.x0 - 1 && px - dx * t <= p.x1 + 1 && pz - dz * t >= p.z0 - 1 && pz - dz * t <= p.z1 + 1) t += 0.5;
            sx = px - dx * (t + 25); sz = pz - dz * (t + 25);
          }
          let ok = true;
          for (let d = 0; d <= 22 && ok; d += 2) if (city.shoreDist(sx + dx * d, sz + dz * d) > -4 || waterCollision.resolveCircle(sx + dx * d, sz + dz * d, 2, 0).hit) ok = false;
          if (!ok) continue;
          for (const u of [8, 18, 30]) {
            const b = createBoat(spec, sx, sz, Math.atan2(dz, dx));
            b.vx = dx * u; b.vz = dz * u; b.speed = u; b.driver = {};
            W.world.time = 0;
            let land = 0, pen = 0;
            for (let i = 0; i < 300; i++) {
              stepBoat(b, CTL_BOAT, DT, W.world);
              W.world.time += DT;
              const fake = { x: b.x, z: b.z, heading: b.heading, spec: b.spec };
              vehicleCorners(fake, CORN);
              for (let q = 0; q < 8; q += 2) {
                const d = city.shoreDist(CORN[q], CORN[q + 1]);
                // On land (not over a pier's root gap) by more than PEN_MAX.
                if (d > land) land = d;
              }
              if (T.cls === 'pier') {
                const p = T.p, rr = b.spec.width / 2, half = Math.max(0, b.spec.length / 2 - rr);
                for (const o of [half, -half]) {
                  const q = penetration({ kind: 0, x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 }, b.x + Math.cos(b.heading) * o, b.z + Math.sin(b.heading) * o, rr);
                  if (q > pen) pen = q;
                }
              }
            }
            used = true;
            row.runs++;
            const fails = [];
            if (land > PEN_MAX) fails.push('land');
            if (pen > PEN_MAX) fails.push('pen');
            if (fails.length) {
              row.fail++;
              if (row.fails.length < 5) row.fails.push({ cls: T.cls, craft: 'boat:' + spec, fails, mph: +(u * MPH).toFixed(0), at: [+sx.toFixed(1), +sz.toFixed(1)], land: +land.toFixed(2), pen: +pen.toFixed(2) });
            } else row.stopped++;
          }
        }
        if (used) row.targets++;
      }
      if (row.runs) rows.push(row);
    }
  }
  return rows;
}

// ---- CLI ----
function table(rows) {
  const lines = [];
  lines.push('class'.padEnd(20) + 'craft'.padEnd(16) + 'targets'.padStart(8) + 'runs'.padStart(7) + 'stop'.padStart(6) + 'defl'.padStart(6) + 'shear'.padStart(6) + 'low'.padStart(5) + 'FAIL'.padStart(6));
  for (const r of rows) lines.push(r.cls.padEnd(20) + r.craft.padEnd(16) + String(r.targets).padStart(8) + String(r.runs).padStart(7) + String(r.stopped).padStart(6) + String(r.deflected).padStart(6) + String(r.sheared).padStart(6) + String(r.overLow).padStart(5) + String(r.fail).padStart(6));
  return lines.join('\n');
}

const isMain = process.argv[1] && process.argv[1].endsWith('collision-sweep.mjs');
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const regions = arg('--region', null) ? [arg('--region')] : REGION_IDS;
  const per = +arg('--per', 3);
  const crafts = arg('--crafts', null) ? arg('--crafts').split(',') : Object.keys(CRAFTS);
  const all = {};
  let fails = 0;
  for (const id of regions) {
    const W = buildWorld(id);
    const rows = sweepRegion(W, { per, crafts }).concat(process.argv.includes('--no-boats') ? [] : sweepBoats(W));
    all[id] = rows;
    console.log(`\n== ${id}`);
    console.log(table(rows));
    for (const r of rows) for (const f of r.fails) console.log('  FAIL', JSON.stringify(f));
    fails += rows.reduce((n, r) => n + r.fail, 0);
  }
  // Every region together, by class.
  const sum = new Map();
  for (const id of Object.keys(all)) {
    for (const r of all[id]) {
      let a = sum.get(r.cls);
      if (!a) sum.set(r.cls, (a = { cls: r.cls, craft: new Set(), targets: 0, runs: 0, stopped: 0, deflected: 0, sheared: 0, overLow: 0, fail: 0 }));
      a.craft.add(r.craft.replace(/:.*/, ''));
      for (const k of ['targets', 'runs', 'stopped', 'deflected', 'sheared', 'overLow', 'fail']) a[k] += r[k];
    }
  }
  console.log('\n== all regions, by class');
  console.log(table([...sum.values()].map((a) => ({ ...a, craft: [...a.craft].join(',').slice(0, 15) }))));
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify(all, null, 1));
  console.log(`\n${fails} failing runs`);
  process.exitCode = fails ? 1 : 0;
}
