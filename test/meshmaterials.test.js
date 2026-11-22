// Every drawable part of every craft has a material in every state it can
// be drawn in. A mesh whose material is missing (a key not in a material
// table for a new car style or service vehicle) makes three.js throw
// "Cannot read properties of undefined (reading 'visible')" from the
// draw, which used to stop the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';
import { LIGHTBARS } from '../src/entities/servicevehicles.js';
import { createVehicleMesh, updateVehicleMesh, setVehicleLod } from '../src/render/vehiclemesh.js';
import { fitServiceMesh } from '../src/render/servicebody.js';
import { lightbarState } from '../src/render/lightbar.js';
import { BOAT_SPECS } from '../src/entities/boat.js';
import { AIRCRAFT_SPECS } from '../src/entities/aircraft.js';
import { createBoatMesh, updateBoatMesh } from '../src/render/boatmesh.js';
import { createAircraftMesh, updateAircraftMesh } from '../src/render/aircraftmesh.js';
import { TANK_SPECS, createTank } from '../src/entities/tank.js';
import { createTankMesh, updateTankMesh } from '../src/render/tankmesh.js';

function missing(root) {
  const bad = [];
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    const m = o.material;
    const ok = Array.isArray(m) ? m.length > 0 && m.every((x) => x && typeof x.visible === 'boolean') : !!m && typeof m.visible === 'boolean';
    if (!ok) bad.push(o.name || o.type);
  });
  root.traverse((x) => { for (const c of x.children) if (!c) bad.push('undefined child of ' + (x.name || x.type)); });
  return bad;
}

const car = (spec) => ({
  kind: 'car', spec, x: 0, z: 0, px: 0, pz: 0, heading: 0, pheading: 0, y: 0, speed: 0, steer: 0,
  health: spec.health, brake: 0, handbrake: false, siren: false, beacon: false, wrecked: false, lodFar: null,
});

test('every car style and service vehicle keeps a material on every part through damage, lamps, siren, LOD and a wreck', () => {
  for (const id of Object.keys(VEHICLE_SPECS)) {
    const spec = VEHICLE_SPECS[id];
    const mesh = fitServiceMesh(createVehicleMesh(spec, spec.colors[0]), spec);
    const v = car(spec);
    const ud = mesh.userData;
    assert.deepEqual(missing(mesh), [], `${id} as built`);
    const states = [
      { health: spec.health * 0.4, brake: 1 }, { health: spec.health * 0.1, speed: -2, driver: 'player' },
      { siren: true, beacon: true }, { lodFar: true }, { lodFar: false }, { wrecked: true, health: 0 },
    ];
    for (const s of states) {
      Object.assign(v, s);
      for (let t = 0; t < 4; t += 0.05) {
        updateVehicleMesh(mesh, v, 1, t);
        if (ud.svcBar) ud.svcBar.material = lightbarState(ud.svcBarId, v, t, false);
      }
      if (s.lodFar !== undefined) setVehicleLod(mesh, s.lodFar);
      assert.deepEqual(missing(mesh), [], `${id} in ${JSON.stringify(s)}`);
    }
  }
});

test('light bars: every bar, phase and the reduced-motion form give a material', () => {
  for (const id of Object.keys(LIGHTBARS)) {
    for (const reduced of [false, true]) {
      for (const lit of [false, true]) {
        const v = { siren: lit, beacon: lit, wrecked: false };
        for (let t = 0; t < 6; t += 1 / 60) {
          const m = lightbarState(id, v, t, reduced);
          assert.ok(m && m.isMaterial, `${id} at ${t.toFixed(2)} s`);
        }
      }
    }
  }
});

test('boats, aircraft and tanks keep their materials when drawn, damaged and wrecked', () => {
  for (const spec of Object.values(BOAT_SPECS)) {
    const mesh = createBoatMesh(spec, spec.colors ? spec.colors[0] : undefined);
    const b = { kind: 'boat', spec, x: 0, z: 0, px: 0, pz: 0, heading: 0, pheading: 0, speed: 8, health: spec.health, wrecked: false };
    updateBoatMesh(mesh, b, 1, 0);
    b.wrecked = true;
    b.health = 0;
    updateBoatMesh(mesh, b, 1, 1);
    assert.deepEqual(missing(mesh), [], spec.id);
  }
  for (const spec of Object.values(AIRCRAFT_SPECS)) {
    const mesh = createAircraftMesh(spec, spec.colors ? spec.colors[0] : undefined);
    const a = { kind: spec.kind, spec, x: 0, y: 30, z: 0, heading: 0, pitch: 0, roll: 0, speed: 40, health: spec.health, engineOn: true, driver: 'player', siren: true, afterburner: 1, rotorSpeed: 1 };
    for (let t = 0; t < 2; t += 0.1) updateAircraftMesh(mesh, a, 1, t);
    a.wrecked = true;
    updateAircraftMesh(mesh, a, 1, 3);
    assert.deepEqual(missing(mesh), [], spec.id);
  }
  for (const id of Object.keys(TANK_SPECS)) {
    const t = createTank(id, 0, 0, 0);
    const mesh = createTankMesh(t.spec, t.color);
    updateTankMesh(mesh, t, 1);
    t.wrecked = true;
    t.health = 0;
    updateTankMesh(mesh, t, 1);
    assert.deepEqual(missing(mesh), [], 'tank ' + id);
  }
});
