// Keeps parked cars around the player: cars appear in parking spots a
// little way off and are removed again once far behind, so the city
// feels full without simulating a thousand vehicles.
//
// Cost (docs/PLAN_V2.md 5.3 H1): the spots sit in a grid index
// (core/spatial.js), so a scan looks only at the spots near the player and
// at the ones holding a car, never the whole city list. Spots to fill go on
// a queue that is drained a couple of cars a step through the shared spawn
// gate, so the first fill at the start is spread over the first second
// and no step builds a burst of car meshes.
import * as THREE from 'three';
import { createVehicle, VEHICLE_SPECS } from '../entities/vehicle.js';
import { garageRemove } from '../core/garage.js';
import { createPointIndex, beginSpawnStep, takeSpawn, belowLiveCap, SPAWNER } from '../core/spatial.js';
import { LOT_CAR_SPECS, LOT_CAR_CAP, LOT_CAR_CAP_MAX, buildLotHull } from '../render/lotmesh.js';
import { createParkedLotField, createParkedCurbField, CURB_MAX, COL_MAX } from '../render/parkedfield.js';
import { mkShape } from '../world/shape.js';
import { lotFill, lotDressCache, blockedBays, bayCount, bayScale } from '../world/lots.js';
import { groundFn } from '../world/ground.js';
import { createVehicleMesh } from '../render/vehiclemesh.js';
import { paintMaterial, carGlassMaterial, wheelMaterial, lotShellMaterial } from '../render/vehiclemats.js';
import { buildCarL2, isFleetModel } from '../render/carbody.js';

const SPAWN_R = 120;
const DESPAWN_R = 170;
const MIN_R = 60; // never pop in right next to the player
const FIRST_FILL_S = 1; // the start fill may use spots inside MIN_R for this long
// Room left under the live cap for moving traffic and the police.
export const PARKED_RESERVE = 24;
// Most curb and listed-bay parked cars (real vehicles) alive at once, all
// within SPAWN_R of the player, by graphics tier (0.13.8: Low phones 30,
// Normal 40, High 48; before, every curb spot in 135 m up to the live cap).
export const PARKED_CAP = [30, 40, 48];
export const PARKED_CAP_DEFAULT = PARKED_CAP[1];
// Static cars (drawn, no vehicle) in the parking lanes in view, by the same
// tier (0.15 roads WP4), on top of the lot cars.
export const CURB_CAP = [14, 24, 32];
// A listed lot bay (city.parkingSpots, lot: true) holds a car when its own
// hash is under its lot's fill at the hour (lots.js lotFill), the same rule
// as the drawn bay cars; one not in a lot box as if its lot were this full.
const LOT_SPOT_FILL = 0.35;
function spotHash(x, z) {
  let h = Math.imul(Math.round(x * 3) * 0x27d4eb2d ^ Math.round(z * 3) * 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// Curbside parked cars by district (docs/FLEET.md): SUVs, crossovers and
// pickups about half; convertibles and sports cars at the beach; vans and
// box trucks where work is done. No buses or semis at the curb.
const MIX = {
  downtown: ['midsize', 'midsize', 'sedan', 'compact', 'taxi', 'suv', 'suv', 'crossover', 'crossover', 'crewcab', 'minivan', 'van', 'sports'],
  midtown: ['midsize', 'sedan', 'compact', 'suv', 'suv', 'crossover', 'crossover', 'crewcab', 'crewcab', 'minivan', 'van', 'muscle'],
  residential: ['midsize', 'compact', 'sedan', 'suv', 'suv', 'crossover', 'crossover', 'crewcab', 'crewcab', 'minivan', 'minivan', 'muscle', 'convertible'],
  docks: ['crewcab', 'pickup', 'van', 'van', 'truck', 'suv', 'midsize'],
  industrial: ['crewcab', 'pickup', 'van', 'van', 'truck', 'truck', 'suv'],
  beach: ['convertible', 'convertible', 'sports', 'sports', 'muscle', 'suv', 'crossover', 'midsize', 'compact', 'crewcab'],
  park: ['suv', 'crossover', 'midsize', 'minivan', 'compact'],
};


// ---- Static cars in the lot bays (drawn, not simulated) ----
// Real car bodies up close (the mid-level body of vehiclemesh, one instanced
// mesh per model and color, with its glass and wheels; a fleet body's L1,
// one mesh with its glass and wheels in it), a rounded low-poly hull for
// the rest, one instanced mesh per model with the color per instance: the
// fleet bodies' L2 shell (carbody buildCarL2, docs/FLEET.md), the older
// models' lotmesh buildLotHull. No simulation: cars in bays are scenery
// until the player shoots or drives into them (their collision shapes are
// the lot layer's). All made only when the game has a scene.
export const LOT_NEAR_M = 24; // the real body inside this camera distance
export const LOT_NEAR_MAX = 6; // at most this many real bodies at once

function createLotCarView(game, field) {
  const scene = game.scene;
  if (!scene || typeof THREE.InstancedMesh !== 'function') return null;
  const root = new THREE.Group();
  root.name = 'lotcars';
  scene.add(root);
  const nSpec = LOT_CAR_SPECS.length;
  const MAXC = field.x.length;
  const tmp = new THREE.Matrix4(), wm = new THREE.Matrix4();
  const col = new THREE.Color();
  // Hulls: one instanced mesh per model, the paint color per instance.
  const hullMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hulls = LOT_CAR_SPECS.map((id) => {
    const spec = VEHICLE_SPECS[id];
    let g, mat = hullMat;
    if (isFleetModel(spec)) {
      g = buildCarL2(spec);
      mat = lotShellMaterial();
    } else {
      const h = buildLotHull(spec);
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(h.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(h.nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(h.col, 3));
      g.setIndex(new THREE.BufferAttribute(h.idx, 1));
    }
    const m = new THREE.InstancedMesh(g, mat, MAXC);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The color per instance from the start (setColorAt would add it at
    // the first car): the warm-up then compiles the program play uses,
    // not one without instance colors that is never drawn.
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXC * 3).fill(1), 3);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.name = 'lothull-' + id;
    root.add(m);
    return m;
  });
  // Real bodies, made on first use per model: the template's shared
  // geometry, and one instanced body per color.
  const real = new Array(nSpec).fill(null);
  const realOf = (si) => {
    let r = real[si];
    if (r) return r;
    const spec = VEHICLE_SPECS[LOT_CAR_SPECS[si]];
    const ud = createVehicleMesh(spec, spec.colors[0]).userData;
    const mk = (geo, mat, cap) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      root.add(m);
      return m;
    };
    // A fleet body's L1 holds its glass and wheels: one draw per color.
    const own = !ud.fleet;
    r = {
      spec, bodyGeo: ud.bodyMid.geometry, byColor: new Map(),
      glass: own ? mk(ud.glassLevels[1].geometry, carGlassMaterial('clean'), LOT_NEAR_MAX) : null,
      wheels: own ? mk(ud.wheelLevels[1].geometry, wheelMaterial(), LOT_NEAR_MAX * 4) : null,
      wheelLocal: Float32Array.from(ud.wheelMatrix.array),
      n: 0,
    };
    if (r.glass) r.glass.renderOrder = 1;
    real[si] = r;
    return r;
  };
  const bodyOf = (r, color) => {
    let b = r.byColor.get(color);
    if (!b) {
      b = new THREE.InstancedMesh(r.bodyGeo, paintMaterial(color), LOT_NEAR_MAX);
      b.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // White instance colors (times 1: no change): every instanced caster
      // then has them, so the shadow pass needs one depth program for all.
      b.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LOT_NEAR_MAX * 3).fill(1), 3);
      b.frustumCulled = false;
      b.castShadow = true;
      b.count = 0;
      b.userData.n = 0;
      root.add(b);
      r.byColor.set(color, b);
    }
    return b;
  };
  const hullN = new Int32Array(nSpec);
  const view = {
    root, hulls, stats: { hull: 0, real: 0, draws: 0 },
    // Build the real body of model si ahead of its first use (and its
    // first paint's instanced body): a mesh build left to the first car
    // that comes within LOT_NEAR_M cost a step a few ms.
    warm(si, color) {
      if (si < 0 || si >= nSpec) return;
      const r = realOf(si);
      bodyOf(r, color === undefined ? r.spec.colors[0] : color);
    },
    // A real body sync asked for (model, paint), -1 when none.
    wantSi: -1, wantColor: 0,
    // The distance inside which the real body is drawn (a tool may change it).
    nearM: LOT_NEAR_M,
    // Write the field's cars into the instanced meshes.
    sync() {
      hullN.fill(0);
      for (const r of real) {
        if (!r) continue;
        r.n = 0;
        for (const b of r.byColor.values()) b.userData.n = 0;
      }
      let nReal = 0;
      for (let i = 0; i < field.n; i++) {
        const si = field.spec[i];
        // Heading h (x ahead, z toward +z) is a turn of -h about y.
        tmp.makeRotationY(-field.yaw[i]);
        // On the ground the moving cars stand on (world/ground.js), the
        // lot's height worked out when the field loaded it.
        tmp.setPosition(field.x[i], field.y[i], field.z[i]);
        // The real body only once it is built (view.warm, between
        // refreshes): a car whose body is not ready is a hull this time.
        const r0 = real[si];
        const b0 = r0 ? r0.byColor.get(field.color[i]) : null;
        if (field.dist[i] < view.nearM && nReal < LOT_NEAR_MAX && !b0 && view.wantSi < 0) {
          view.wantSi = si;
          view.wantColor = field.color[i];
        }
        if (field.dist[i] < view.nearM && nReal < LOT_NEAR_MAX && b0) {
          nReal++;
          const r = r0;
          const b = b0;
          b.setMatrixAt(b.userData.n++, tmp);
          if (r.glass) {
            r.glass.setMatrixAt(r.n, tmp);
            for (let w = 0; w < 4; w++) {
              wm.fromArray(r.wheelLocal, w * 16).premultiply(tmp);
              r.wheels.setMatrixAt(r.n * 4 + w, wm);
            }
          }
          r.n++;
          continue;
        }
        const h = hulls[si];
        const k = hullN[si]++;
        h.setMatrixAt(k, tmp);
        col.setHex(field.color[i]);
        h.setColorAt(k, col);
      }
      let draws = 0, nh = 0;
      for (let si = 0; si < nSpec; si++) {
        const h = hulls[si];
        h.count = hullN[si];
        h.visible = h.count > 0;
        if (h.count) {
          h.instanceMatrix.needsUpdate = true;
          if (h.instanceColor) h.instanceColor.needsUpdate = true;
          draws++;
          nh += h.count;
        }
        const r = real[si];
        if (!r) continue;
        if (r.glass) {
          r.glass.count = r.n;
          r.wheels.count = r.n * 4;
          r.glass.visible = r.wheels.visible = r.n > 0;
          if (r.n) { r.glass.instanceMatrix.needsUpdate = true; r.wheels.instanceMatrix.needsUpdate = true; draws += 2; }
        }
        for (const b of r.byColor.values()) {
          b.count = b.userData.n;
          b.visible = b.count > 0;
          if (b.count) { b.instanceMatrix.needsUpdate = true; draws++; }
        }
      }
      view.stats.hull = nh;
      view.stats.real = nReal;
      view.stats.draws = draws;
    },
  };
  return view;
}

// The collision shapes of the static curb cars (0.15 roads WP4) as a lazy
// layer of the collision world: two circles a car, as the lot bay cars
// (world/collision.js addBayCars), for the cars near the player. set()
// moves the pooled shapes to the cars given (x, z, yaw, three floats each);
// the cells are lists reused from one set to the next.
const CELL = 32;
const NO_ITEMS = Object.freeze([]);
export function createCurbCarLayer() {
  const shapes = [];
  for (let i = 0; i < COL_MAX * 2; i++) shapes.push(mkShape(1, 0, 0, 0, 0, 0, 0, 1.0, 1.4, 'car'));
  const lists = new Map();
  const used = [];
  const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
  const layer = {
    name: 'curbcars',
    shapes,
    count: 0,
    cell(cx, cz) {
      return lists.get(key(cx, cz)) || NO_ITEMS;
    },
    set(col, n) {
      for (let i = 0; i < used.length; i++) used[i].length = 0;
      used.length = 0;
      if (lists.size > 600) lists.clear();
      const m = Math.min(n, COL_MAX);
      for (let i = 0; i < m; i++) {
        const x = col[i * 3], z = col[i * 3 + 1], c = Math.cos(col[i * 3 + 2]), sn = Math.sin(col[i * 3 + 2]);
        for (let h = 0; h < 2; h++) {
          const sh = shapes[i * 2 + h], o = h ? 1.2 : -1.2;
          sh.x = x + c * o;
          sh.z = z + sn * o;
          sh.off = false;
          for (let cx = Math.floor((sh.x - sh.r) / CELL); cx <= Math.floor((sh.x + sh.r) / CELL); cx++) {
            for (let cz = Math.floor((sh.z - sh.r) / CELL); cz <= Math.floor((sh.z + sh.r) / CELL); cz++) {
              const k = key(cx, cz);
              let list = lists.get(k);
              if (!list) lists.set(k, (list = []));
              if (!list.length) used.push(list);
              list.push(sh);
            }
          }
        }
      }
      for (let i = m * 2; i < shapes.length; i++) shapes[i].off = true;
      layer.count = m * 2;
    },
  };
  return layer;
}

export function createParkedCars(game) {
  // The designed start street's curb spaces (`start`, docs/REVAMP.md 6.8)
  // come first, so the first scan fills them before any other.
  const spots = game.city.parkingSpots.map((s) => ({ ...s, vehicle: null, used: false, lane: 0, lotU: -1, lotRef: null }));
  spots.sort((a, b) => (b.start ? 1 : 0) - (a.start ? 1 : 0));
  const index = createPointIndex(spots.length, (i) => spots[i].x, (i) => spots[i].z, 64);
  const nearIds = [];
  const live = []; // spots holding a car of ours
  // The spots to fill, nearest first: a scan keeps the nearest PICK_MAX
  // empty ones it may fill (bounded insertion, no sort of every spot in
  // reach); the drain takes them a car a step.
  const PICK_MAX = 64;
  const pick = new Int32Array(PICK_MAX), pickD = new Float64Array(PICK_MAX);
  let nPick = 0, pHead = 0;
  let timer = 0;
  let first = true; // the start fill (spots inside MIN_R allowed)
  let firstLeft = FIRST_FILL_S;
  let garageWait = false;
  let cap = PARKED_CAP_DEFAULT;
  const stats = { scans: 0, looked: 0, spawned: 0, deferred: 0, evicted: 0, noLane: 0, lotEmpty: 0, capped: 0, relocated: 0 };
  // Static cars in the lot bays: a field of picked bays near the camera
  // (render/parkedfield.js, loaded a few lots a step) and, when the game
  // draws, the instanced meshes.
  const city = game.city;
  // The tiles dress the lots near the camera when the game draws: the
  // parked cars wait for them rather than dress a lot in a step themselves.
  const tilesDress = !!(city.lots && city.lots.length && game.scene);
  const lotField = city.lots && city.lots.length ? createParkedLotField(city, { quick: tilesDress, ground: tilesDress ? groundFn(city) : null }) : null;
  // The static cars of the parking lanes (0.15 roads WP4), where the city
  // has street geometry and lots. A curb station near a curb spot stays
  // empty: the live cars keep the spots.
  const spotTmp = [];
  const curbField = lotField && city.roadGeo && city.edges && city.edges.length
    ? createParkedCurbField(city, { spotNear: (x, z, r) => index.near(x, z, r, spotTmp).length > 0 })
    : null;
  const curbLayer = curbField ? createCurbCarLayer() : null;
  if (curbLayer && game.collision && typeof game.collision.addLayer === 'function') game.collision.addLayer(curbLayer);
  // What the view draws: the lot cars and the curb cars in one set.
  const carField = lotField ? {
    n: 0, x: new Float32Array(LOT_CAR_CAP_MAX + CURB_MAX), z: new Float32Array(LOT_CAR_CAP_MAX + CURB_MAX), yaw: new Float32Array(LOT_CAR_CAP_MAX + CURB_MAX),
    y: new Float32Array(LOT_CAR_CAP_MAX + CURB_MAX), spec: new Uint8Array(LOT_CAR_CAP_MAX + CURB_MAX), color: new Uint32Array(LOT_CAR_CAP_MAX + CURB_MAX), dist: new Float32Array(LOT_CAR_CAP_MAX + CURB_MAX),
  } : null;
  function mergeCars() {
    let n = 0;
    const f = lotField, c = curbField;
    for (let i = 0; i < f.n; i++, n++) {
      carField.x[n] = f.x[i]; carField.z[n] = f.z[i]; carField.yaw[n] = f.yaw[i]; carField.y[n] = f.y[i];
      carField.spec[n] = f.spec[i]; carField.color[n] = f.color[i]; carField.dist[n] = f.dist[i];
    }
    for (let i = 0; c && i < c.n; i++, n++) {
      carField.x[n] = c.x[i]; carField.z[n] = c.z[i]; carField.yaw[n] = c.yaw[i]; carField.y[n] = c.y[i];
      carField.spec[n] = c.spec[i]; carField.color[n] = c.color[i]; carField.dist[n] = c.dist[i];
    }
    carField.n = n;
  }
  const lotView = lotField && game.scene ? createLotCarView(game, carField) : null;
  const lotCache = lotField ? lotDressCache(city) : null;
  let lotTimer = 0;
  let warmAt = 0; // the next lot car model the view builds ahead
  const blockers = new Float32Array(6 * 48);
  const nearEdges = [];
  // True when the curb spot s lies where its street has a parking lane. The
  // streets say so with parkL / parkR (the side the spot is on, left or
  // right of a -> b) once the map has them; until then every street that is
  // not an avenue, bridge or causeway has one, as the city generator
  // placed its curb spots. Start spots (the designed first view) always do.
  // A listed lot bay is fine unless its car would stand on a lot feature
  // (lots.js blockedBays).
  function laneOk(s) {
    if (s.start) return true;
    if (s.lane) return s.lane === 1;
    if (s.lot) {
      s.lane = lotBayBlocked(s) ? 2 : 1;
      return s.lane === 1;
    }
    let best = null, bd = 1e9;
    // The island city has no edge index: every edge is looked at.
    const listed = typeof city.edgesNear === 'function';
    if (listed) city.edgesNear(s.x, s.z, 14, nearEdges);
    const nE = listed ? nearEdges.length : city.edges.length;
    for (let k = 0; k < nE; k++) {
      const e = city.edges[listed ? nearEdges[k] : k];
      const a = city.nodes[e.a];
      const { ux, uz } = edgeDir(e);
      const t = Math.max(0, Math.min(e.length, (s.x - a.x) * ux + (s.z - a.z) * uz));
      const d = Math.hypot(s.x - (a.x + ux * t), s.z - (a.z + uz * t));
      if (d < bd) { bd = d; best = e; }
    }
    let ok = true;
    if (best) {
      if (best.parkL !== undefined || best.parkR !== undefined) {
        const a = city.nodes[best.a];
        const { ux, uz } = edgeDir(best);
        // Right of a -> b is (-uz, ux).
        const right = (s.x - a.x) * -uz + (s.z - a.z) * ux > 0;
        ok = !!(right ? best.parkR : best.parkL);
      } else ok = !best.avenue && !best.bridge && !best.causeway;
    }
    s.lane = ok ? 1 : 2;
    return ok;
  }
  // The listed bay s: its lot (once) and whether its bay is a blocked one.
  function lotBayBlocked(s) {
    if (!lotField) return false;
    if (s.lotU < 0) hourWants(s, 12);
    const lot = s.lotRef;
    if (!lot) return false;
    const feats = lotCache.get(lot);
    const blocked = blockedBays(feats);
    let k = 0;
    for (let q = 0; q < feats.length; q++) {
      const f = feats[q];
      if (f.kind !== 'bay') continue;
      const nb = bayCount(f);
      const ca = Math.cos(f.heading), sa = Math.sin(f.heading);
      const half = (nb * 2.5) / 2;
      for (let b = 0; b < nb; b++, k++) {
        const o = -half + (b + 0.5) * 2.5;
        if (Math.abs(f.x + ca * o - s.x) < 0.3 && Math.abs(f.z + sa * o - s.z) < 0.3) return blocked[k] === 1;
      }
    }
    return false;
  }
  // A listed lot bay wants a car at this hour (by its lot's fill), a curb
  // spot always does.
  function hourWants(s, hour) {
    if (!s.lot) return true;
    if (s.lotU < 0) {
      s.lotRef = lotField ? lotField.lotAt(s.x, s.z) : null;
      s.lotU = spotHash(s.x, s.z) * bayScale(s.lotRef, s.x, s.z);
    }
    const fill = s.lotRef ? lotFill(s.lotRef, hour) : LOT_SPOT_FILL;
    return s.lotU < fill;
  }
  // An edge's unit direction (island edges carry no ux, uz).
  const DIR = { ux: 0, uz: 0 };
  function edgeDir(e) {
    if (e.ux !== undefined) { DIR.ux = e.ux; DIR.uz = e.uz; return DIR; }
    const a = city.nodes[e.a], b = city.nodes[e.b], l = e.length || 1;
    DIR.ux = (b.x - a.x) / l; DIR.uz = (b.z - a.z) / l;
    return DIR;
  }

  // Under the cap: the parked car farthest behind (outside the spawn
  // ring) makes way for a spot nearer the player. True when one went.
  function evictFar(px, pz, nearer, beyond = SPAWN_R) {
    let far = -1, fd = beyond;
    for (let i = 0; i < live.length; i++) {
      const s = live[i];
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d > fd && d > nearer + 20) { fd = d; far = i; }
    }
    if (far < 0) return false;
    const s = live[far];
    if (s.vehicle && !s.vehicle.removed) game.removeVehicle(s.vehicle);
    s.vehicle = null;
    live[far] = live[live.length - 1];
    live.length--;
    stats.evicted++;
    return true;
  }

  // The live parked car farthest behind, past SPAWN_R + 5 m and more than
  // 20 m farther than the spot, untouched (full health, never hit, asleep)
  // and of a model the spot's district parks: moved to spot s. True when one
  // was.
  function relocate(s, px, pz, d, kinds) {
    let far = -1, fd = Math.max(SPAWN_R + 5, d + 20);
    for (let i = 0; i < live.length; i++) {
      const o = live[i], v = o.vehicle;
      if (!v || v.removed || !v.asleep || v.driver || v.wrecked || v.onFire || v.garageEntry) continue;
      if (v.health !== v.spec.health || v.propHits || v.lastHitBy || v.combatHit) continue;
      const dd = Math.hypot(o.x - px, o.z - pz);
      if (dd <= fd || kinds.indexOf(v.spec.id) < 0) continue;
      fd = dd;
      far = i;
    }
    if (far < 0) return false;
    const old = live[far], v = old.vehicle;
    old.vehicle = null;
    live[far] = s;
    s.vehicle = v;
    v.x = v.px = s.x;
    v.z = v.pz = s.z;
    v.heading = v.pheading = s.heading;
    v.y = v.py = 0; v.vy = 0;
    v.vx = v.vz = 0; v.speed = 0; v.yawRate = 0;
    v.roll = v.pitch = v.proll = v.ppitch = 0; v.rollV = v.pitchV = 0;
    v.gPitch = v.gRoll = v.pgPitch = v.pgRoll = 0;
    v.grounded = false;
    v.wg.fill(0);
    v.wheelDy.fill(0);
    v.meshDirty = true;
    stats.relocated++;
    return true;
  }

  // Cars the player left behind (core/garage.js, kept by systems/session.js)
  // are parked exactly where they were left whenever the player is near.
  function scanGarage() {
    const list = game.garage;
    garageWait = false;
    if (!list) return;
    const px = game.player.x, pz = game.player.z;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const v = e.vehicle;
      if (v && !v.removed) {
        if (v.driver || v.wrecked) {
          // Taken by somebody else, or destroyed: no longer parked here.
          v.garageEntry = null;
          garageRemove(list, e);
        } else {
          e.x = v.x;
          e.z = v.z;
          e.heading = v.heading;
          if (v.spec && v.spec.health > 0) e.health = Math.max(0.05, Math.min(1, v.health / v.spec.health));
          if (v.parked && Math.hypot(v.x - px, v.z - pz) > DESPAWN_R) {
            game.removeVehicle(v);
            e.vehicle = null;
          }
        }
        continue;
      }
      e.vehicle = null;
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < SPAWN_R && (first || d > MIN_R)) {
        // The player's own cars always come back (no live cap), but at
        // most a couple a step like everything else.
        if (!takeSpawn(game)) {
          garageWait = true;
          continue;
        }
        const c = createVehicle(e.spec, e.x, e.z, e.heading, game.rng);
        c.color = e.color;
        c.health = Math.max(1, e.health * c.spec.health);
        c.parked = true;
        c.asleep = true;
        c.garageEntry = e;
        e.vehicle = c;
        game.addVehicle(c);
      }
    }
  }

  function nearGarage(x, z) {
    const list = game.garage;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      if (Math.abs(list[i].x - x) < 3.2 && Math.abs(list[i].z - z) < 3.2) return true;
    }
    return false;
  }

  // The cap of this tier (graphics.tierNow when the game has one).
  function readCap() {
    const g = game.graphics;
    let c = PARKED_CAP_DEFAULT;
    if (g && typeof g.tierNow === 'function') {
      const t = g.tierNow();
      c = t && t.name === 'Low' ? PARKED_CAP[0] : t && t.name === 'High' ? PARKED_CAP[2] : PARKED_CAP[1];
    }
    if (g && g.parkedLive > 0) c = g.parkedLive | 0;
    return c;
  }

  function scan() {
    const px = game.player.x, pz = game.player.z;
    stats.scans++;
    // The tier changes rarely: read it every eighth scan.
    if ((stats.scans & 7) === 1) cap = readCap();
    scanGarage();
    // The spots holding a car: driven off, shunted, or left far behind.
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i];
      const v = s.vehicle;
      let drop = false;
      if (!v) drop = true;
      else if (v.removed) {
        s.vehicle = null;
        drop = true;
      } else if (v.driver || Math.hypot(v.x - s.x, v.z - s.z) > 1.5) {
        // Once somebody has driven or shunted it, it is no longer ours.
        v.parked = false;
        s.vehicle = null;
        s.used = true;
        drop = true;
      } else if (Math.hypot(s.x - px, s.z - pz) > DESPAWN_R) {
        game.removeVehicle(v);
        s.vehicle = null;
        drop = true;
      }
      if (drop) {
        live[i] = live[live.length - 1];
        live.length--;
      }
    }
    // Over the live cap (the berthed craft came in, say) or over the parked
    // cap: the parked cars farthest behind go first.
    let trims = 4;
    while (trims-- > 0 && (!belowLiveCap(game, PARKED_RESERVE - 1) || live.length > cap) && evictFar(px, pz, 0, MIN_R));
    // The nearest empty spots in reach (start curb spots before all), so
    // the first view is full within a few steps and, under the cap, the
    // cars stand where the player looks.
    index.near(px, pz, SPAWN_R, nearIds);
    stats.looked += nearIds.length;
    const hour = game.clock ?? 12;
    nPick = 0;
    pHead = 0;
    for (let j = 0; j < nearIds.length; j++) {
      const i = nearIds[j];
      const s = spots[i];
      if (s.vehicle || s.used || s.lane === 2) continue;
      const dx = s.x - px, dz = s.z - pz;
      const d2 = dx * dx + dz * dz - (s.start ? 1e9 : 0);
      if (nPick === PICK_MAX && d2 >= pickD[nPick - 1]) continue;
      if (!hourWants(s, hour)) { stats.lotEmpty++; continue; }
      let at = nPick < PICK_MAX ? nPick++ : PICK_MAX - 1;
      while (at > 0 && (pickD[at - 1] > d2 || (pickD[at - 1] === d2 && pick[at - 1] > i))) {
        pick[at] = pick[at - 1]; pickD[at] = pickD[at - 1];
        at--;
      }
      pick[at] = i; pickD[at] = d2;
    }
  }

  // One car a step from the picked spots (and only through the shared
  // spawn gate); a spot no longer in reach is skipped (a later scan picks
  // it again when the player is back).
  function drain() {
    const px = game.player.x, pz = game.player.z;
    let made = 0;
    while (pHead < nPick && made < 1) {
      const i = pick[pHead];
      const s = spots[i];
      const d = Math.hypot(s.x - px, s.z - pz);
      const ok = !s.vehicle && !s.used && d < SPAWN_R && (first || d > MIN_R) && !nearGarage(s.x, s.z);
      // A listed lot bay whose lot no tile has dressed yet waits (its
      // blocked-bay test would dress the lot in this step); a later scan
      // picks it again.
      if (ok && s.lot && !s.lane && s.lotRef && tilesDress && !lotCache.has(s.lotRef)) {
        pHead++;
        continue;
      }
      if (ok && !laneOk(s)) {
        // No parking lane on that street (or the bay is on a lot feature): never a car there.
        s.used = true;
        stats.noLane++;
        pHead++;
        continue;
      }
      if (!ok) {
        pHead++;
        continue;
      }
      const kinds = MIX[game.city.districtOf(s.x, s.z)] || MIX.midtown;
      // A car of ours far behind, as new, moves here: no new vehicle, no
      // new mesh (the record and its mesh are reused).
      if (relocate(s, px, pz, d, kinds)) {
        pHead++;
        made++;
        continue;
      }
      if (live.length >= cap && !evictFar(px, pz, d)) {
        stats.capped++;
        pHead = nPick;
        break;
      }
      if (!belowLiveCap(game, PARKED_RESERVE) && !evictFar(px, pz, d)) {
        stats.deferred++;
        return;
      }
      if (!takeSpawn(game)) {
        stats.deferred++;
        return;
      }
      pHead++;
      const v = createVehicle(game.rng.pick(kinds), s.x, s.z, s.heading, game.rng);
      v.parked = true;
      v.asleep = true;
      s.vehicle = v;
      live.push(s);
      game.addVehicle(v);
      stats.spawned++;
      made++;
    }
    if (first && pHead >= nPick) first = false;
  }

  // The lot cars: a few lots loaded a step, the field refreshed a few
  // times a second from the camera and the clock. The cap counts every
  // static parked car in view, the curb cars (real vehicles) first.
  function updateLotCars(dt) {
    if (!lotField) return;
    lotTimer -= dt;
    if (lotTimer > 0) {
      // Between refreshes: a few lots loaded, and at most one real body
      // built (the one a refresh asked for, else the next model ahead),
      // never in the step that refreshes (each costs a step a few ms).
      // (A lot the tiles have not dressed waits for them up to 1.5 s.)
      lotField.step(undefined, false, tilesDress ? Math.min(255, Math.ceil(1.5 / Math.max(dt, 1e-3))) : 0);
      if (curbField) curbField.step();
      if (lotView && lotTimer < 0.2 && lotTimer > 0.05) {
        if (lotView.wantSi >= 0) {
          lotView.warm(lotView.wantSi, lotView.wantColor);
          lotView.wantSi = -1;
        } else if (warmAt < LOT_CAR_SPECS.length && stats.scans > 2 && (stats.scans & 1) === 0) lotView.warm(warmAt++);
      }
      return;
    }
    lotTimer = 0.25;
    const cam = game.camera;
    let cx = game.player.x, cz = game.player.z, fx = 1, fz = 0;
    if (cam && cam.matrixWorld) {
      const e = cam.matrixWorld.elements;
      cx = cam.position.x; cz = cam.position.z;
      fx = -e[8]; fz = -e[10];
      const l = Math.hypot(fx, fz) || 1;
      fx /= l; fz /= l;
    }
    const tier = game.graphics && game.graphics.parkedCars;
    const lotCap = Math.min(LOT_CAR_CAP_MAX, tier > 0 ? tier : LOT_CAR_CAP);
    const curbCap = Math.min(CURB_MAX, cap <= PARKED_CAP[0] ? CURB_CAP[0] : cap >= PARKED_CAP[2] ? CURB_CAP[2] : CURB_CAP[1]);
    let curb = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i].vehicle;
      if (!v) continue;
      const dx = v.x - cx, dz = v.z - cz, d = Math.hypot(dx, dz);
      if (d < 150 && (d < 14 || dx * fx + dz * fz > 0.54 * d)) curb++;
    }
    // Real vehicles standing near (not ones of the lot's own listed bays,
    // which the field never fills): their bays stay empty.
    let nb = 0;
    const vs = game.vehicles;
    for (let i = 0; vs && i < vs.length && nb < 48; i++) {
      const v = vs[i];
      if (!v || v.removed || !v.spec) continue;
      if (Math.abs(v.x - cx) > 170 || Math.abs(v.z - cz) > 170 || Math.abs(v.speed || 0) > 2) continue;
      const o = nb++ * 6;
      blockers[o] = v.x; blockers[o + 1] = v.z;
      blockers[o + 2] = Math.cos(v.heading); blockers[o + 3] = Math.sin(v.heading);
      blockers[o + 4] = (v.spec.length || 4.5) / 2; blockers[o + 5] = (v.spec.width || 1.8) / 2;
    }
    lotField.update(cx, cz, fx, fz, game.clock ?? 12, Math.max(8, lotCap - curb), blockers, nb);
    if (curbField) {
      curbField.update(cx, cz, fx, fz, game.player.x, game.player.z, curbCap, blockers, nb);
      curbLayer.set(curbField.col, curbField.nCol);
    }
    if (carField) mergeCars();
    if (lotView) lotView.sync();
  }

  return {
    name: 'parked',
    spots,
    stats,
    lotField,
    curbField,
    carField,
    curbLayer,
    lotView,
    get cap() {
      return cap;
    },
    // Live parked cars of ours (curb spots and listed lot bays).
    get live() {
      return live.length;
    },
    // Indices of the spots within r of (x, z), ascending (grid index).
    spotsNear(x, z, r, out = []) {
      return index.near(x, z, r, out);
    },
    get pending() {
      return nPick - pHead;
    },
    fixedUpdate(dt) {
      beginSpawnStep(game, SPAWNER.parked);
      // The lot bay cars that collide are the ones drawn at this hour.
      if (game.collision && game.collision.setLotHour) game.collision.setLotHour(game.clock ?? 12);
      timer -= dt;
      if (timer <= 0) {
        timer = 0.5;
        scan();
      } else if (garageWait) scanGarage();
      drain();
      updateLotCars(dt);
      if (first) {
        firstLeft -= dt;
        if (firstLeft <= 0) first = false;
      }
    },
  };
}
