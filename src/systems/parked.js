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
import { createLotCarField, LOT_CAR_SPECS, LOT_CAR_CAP, LOT_CAR_CAP_MAX, buildLotHull, LOT_Y } from '../render/lotmesh.js';
import { createVehicleMesh } from '../render/vehiclemesh.js';
import { paintMaterial, carGlassMaterial, wheelMaterial } from '../render/vehiclemats.js';

const SPAWN_R = 135;
const DESPAWN_R = 185;
const MIN_R = 60; // never pop in right next to the player
const FIRST_FILL_S = 1; // the start fill may use spots inside MIN_R for this long
// Room left under the live cap for moving traffic and the police.
export const PARKED_RESERVE = 24;

const MIX = {
  downtown: ['sedan', 'sedan', 'taxi', 'sports', 'compact', 'van'],
  midtown: ['sedan', 'compact', 'compact', 'pickup', 'van', 'muscle'],
  residential: ['compact', 'sedan', 'pickup', 'sedan', 'muscle'],
  docks: ['pickup', 'van', 'truck', 'sedan'],
  industrial: ['pickup', 'van', 'truck', 'compact'],
  beach: ['sports', 'compact', 'muscle', 'sedan', 'sports'],
  park: ['compact', 'sedan'],
};


// ---- Static cars in the lot bays (drawn, not simulated) ----
// Real car bodies up close (the mid-level body of vehiclemesh, one instanced
// mesh per model and color, with its glass and wheels), a rounded low-poly
// hull (lotmesh buildLotHull) for the rest, one instanced mesh per model
// with the color per instance. No simulation: cars in bays are scenery
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
  const MAXC = LOT_CAR_CAP_MAX;
  const tmp = new THREE.Matrix4(), wm = new THREE.Matrix4();
  const col = new THREE.Color();
  // Hulls: one instanced mesh per model, the paint color per instance.
  const hullMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hulls = LOT_CAR_SPECS.map((id) => {
    const spec = VEHICLE_SPECS[id];
    const h = buildLotHull(spec);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(h.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(h.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(h.col, 3));
    g.setIndex(new THREE.BufferAttribute(h.idx, 1));
    const m = new THREE.InstancedMesh(g, hullMat, MAXC);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
    r = {
      spec, bodyGeo: ud.bodyMid.geometry, byColor: new Map(),
      glass: mk(ud.glassLevels[1].geometry, carGlassMaterial('clean'), LOT_NEAR_MAX),
      wheels: mk(ud.wheelLevels[1].geometry, wheelMaterial(), LOT_NEAR_MAX * 4),
      wheelLocal: Float32Array.from(ud.wheelMatrix.array),
      n: 0,
    };
    r.glass.renderOrder = 1;
    real[si] = r;
    return r;
  };
  const bodyOf = (r, color) => {
    let b = r.byColor.get(color);
    if (!b) {
      b = new THREE.InstancedMesh(r.bodyGeo, paintMaterial(color), LOT_NEAR_MAX);
      b.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
        tmp.setPosition(field.x[i], LOT_Y, field.z[i]);
        if (field.dist[i] < LOT_NEAR_M && nReal < LOT_NEAR_MAX) {
          nReal++;
          const r = realOf(si);
          const b = bodyOf(r, field.color[i]);
          b.setMatrixAt(b.userData.n++, tmp);
          r.glass.setMatrixAt(r.n, tmp);
          for (let w = 0; w < 4; w++) {
            wm.fromArray(r.wheelLocal, w * 16).premultiply(tmp);
            r.wheels.setMatrixAt(r.n * 4 + w, wm);
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
        r.glass.count = r.n;
        r.wheels.count = r.n * 4;
        r.glass.visible = r.wheels.visible = r.n > 0;
        if (r.n) { r.glass.instanceMatrix.needsUpdate = true; r.wheels.instanceMatrix.needsUpdate = true; draws += 2; }
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

export function createParkedCars(game) {
  // The designed start street's curb spaces (`start`, docs/REVAMP.md 6.8)
  // come first, so the first scan fills them before any other.
  const spots = game.city.parkingSpots.map((s) => ({ ...s, vehicle: null, used: false }));
  spots.sort((a, b) => (b.start ? 1 : 0) - (a.start ? 1 : 0));
  const index = createPointIndex(spots.length, (i) => spots[i].x, (i) => spots[i].z, 64);
  const nearIds = [];
  const live = []; // spots holding a car of ours
  const queue = []; // spot indices waiting for a car, in fill order
  const queued = new Uint8Array(spots.length);
  let qHead = 0;
  let timer = 0;
  let first = true; // the start fill (spots inside MIN_R allowed)
  let firstLeft = FIRST_FILL_S;
  let garageWait = false;
  const stats = { scans: 0, looked: 0, spawned: 0, deferred: 0, evicted: 0, noLane: 0 };
  // Static cars in the lot bays: a field of picked bays near the camera
  // (render/lotmesh.js) and, when the game draws, the instanced meshes.
  const city = game.city;
  const lotField = city.lots && city.lots.length ? createLotCarField(city) : null;
  const lotView = lotField && game.scene ? createLotCarView(game, lotField) : null;
  let lotTimer = 0;
  const nearEdges = [];
  // True when the curb spot s lies where its street has a parking lane. The
  // streets say so with parkL / parkR (the side the spot is on, left or
  // right of a -> b) once the map has them; until then every street that is
  // not an avenue, bridge or causeway has one, as the city generator
  // placed its curb spots. Start spots (the designed first view) always do.
  function laneOk(s) {
    if (s.lot || s.start) return true;
    if (s.lane) return s.lane === 1;
    let best = null, bd = 1e9;
    city.edgesNear(s.x, s.z, 14, nearEdges);
    for (let k = 0; k < nearEdges.length; k++) {
      const e = city.edges[nearEdges[k]];
      const a = city.nodes[e.a];
      const t = Math.max(0, Math.min(e.length, (s.x - a.x) * e.ux + (s.z - a.z) * e.uz));
      const d = Math.hypot(s.x - (a.x + e.ux * t), s.z - (a.z + e.uz * t));
      if (d < bd) { bd = d; best = e; }
    }
    let ok = true;
    if (best) {
      if (best.parkL !== undefined || best.parkR !== undefined) {
        const a = city.nodes[best.a];
        // Right of a -> b is (-uz, ux).
        const right = (s.x - a.x) * -best.uz + (s.z - a.z) * best.ux > 0;
        ok = !!(right ? best.parkR : best.parkL);
      } else ok = !best.avenue && !best.bridge && !best.causeway;
    }
    s.lane = ok ? 1 : 2;
    return ok;
  }
  let sortX = 0, sortZ = 0;
  const d2 = (s) => (s.x - sortX) * (s.x - sortX) + (s.z - sortZ) * (s.z - sortZ);
  const byNear = (a, b) => ((spots[b].start ? 1 : 0) - (spots[a].start ? 1 : 0)) || (d2(spots[a]) - d2(spots[b])) || a - b;

  // Under the live cap: the parked car farthest behind (outside the spawn
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
    live.splice(far, 1);
    stats.evicted++;
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

  function scan() {
    const px = game.player.x, pz = game.player.z;
    stats.scans++;
    scanGarage();
    // The spots holding a car: driven off, shunted, or left far behind.
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i];
      const v = s.vehicle;
      if (!v) {
        live.splice(i, 1);
        continue;
      }
      if (v.removed) {
        s.vehicle = null;
        live.splice(i, 1);
      } else if (v.driver || Math.hypot(v.x - s.x, v.z - s.z) > 1.5) {
        // Once somebody has driven or shunted it, it is no longer ours.
        v.parked = false;
        s.vehicle = null;
        s.used = true;
        live.splice(i, 1);
      } else if (Math.hypot(s.x - px, s.z - pz) > DESPAWN_R) {
        game.removeVehicle(v);
        s.vehicle = null;
        live.splice(i, 1);
      }
    }
    // Over the live cap (the berthed craft came in, say): the parked cars
    // farthest behind go first.
    let trims = 4;
    while (trims-- > 0 && !belowLiveCap(game, PARKED_RESERVE - 1) && evictFar(px, pz, 0, MIN_R));
    // Empty spots in reach go on the queue.
    if (qHead > 0 && qHead >= queue.length) {
      queue.length = 0;
      qHead = 0;
    }
    index.near(px, pz, SPAWN_R, nearIds);
    stats.looked += nearIds.length;
    // Nearest first (start curb spots before all), so the first view is
    // full within a few steps and, under the live cap, the cars stand
    // where the player looks.
    sortX = px;
    sortZ = pz;
    nearIds.sort(byNear);
    for (let j = 0; j < nearIds.length; j++) {
      const i = nearIds[j];
      const s = spots[i];
      if (s.vehicle || s.used || queued[i]) continue;
      queued[i] = 1;
      queue.push(i);
    }
  }

  // A couple of cars a step from the queue; a spot no longer in reach is
  // dropped (it is queued again by a later scan when the player is back).
  function drain() {
    const px = game.player.x, pz = game.player.z;
    while (qHead < queue.length) {
      const i = queue[qHead];
      const s = spots[i];
      const d = Math.hypot(s.x - px, s.z - pz);
      const ok = !s.vehicle && !s.used && d < SPAWN_R && (first || d > MIN_R) && !nearGarage(s.x, s.z);
      if (ok && !laneOk(s)) {
        // No parking lane on that street: never a car there.
        s.used = true;
        stats.noLane++;
        queued[i] = 0;
        qHead++;
        continue;
      }
      if (!ok) {
        queued[i] = 0;
        qHead++;
        continue;
      }
      if (!belowLiveCap(game, PARKED_RESERVE) && !evictFar(px, pz, d)) {
        stats.deferred++;
        return;
      }
      if (!takeSpawn(game)) {
        stats.deferred++;
        return;
      }
      queued[i] = 0;
      qHead++;
      const kinds = MIX[game.city.districtOf(s.x, s.z)] || MIX.midtown;
      const v = createVehicle(game.rng.pick(kinds), s.x, s.z, s.heading, game.rng);
      v.parked = true;
      v.asleep = true;
      s.vehicle = v;
      live.push(s);
      game.addVehicle(v);
      stats.spawned++;
    }
    if (first && qHead >= queue.length) first = false;
  }

  // The lot cars: refresh the field a few times a second from the camera
  // and the clock. The cap counts every static parked car in view, the
  // curb cars (real vehicles) first.
  function updateLotCars(dt) {
    if (!lotField) return;
    lotTimer -= dt;
    if (lotTimer > 0) return;
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
    const cap = Math.min(LOT_CAR_CAP_MAX, tier > 0 ? tier : LOT_CAR_CAP);
    let curb = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i].vehicle;
      if (!v) continue;
      const dx = v.x - cx, dz = v.z - cz, d = Math.hypot(dx, dz);
      if (d < 150 && (d < 14 || dx * fx + dz * fz > 0.54 * d)) curb++;
    }
    lotField.update(cx, cz, fx, fz, game.clock ?? 12, Math.max(8, cap - curb));
    if (lotView) lotView.sync();
  }

  return {
    name: 'parked',
    spots,
    stats,
    lotField,
    lotView,
    // Indices of the spots within r of (x, z), ascending (grid index).
    spotsNear(x, z, r, out = []) {
      return index.near(x, z, r, out);
    },
    get pending() {
      return queue.length - qHead;
    },
    fixedUpdate(dt) {
      beginSpawnStep(game, SPAWNER.parked);
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
