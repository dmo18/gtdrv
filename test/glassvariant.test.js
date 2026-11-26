// The car glass keeps one shader program (0.13.7 render safety). Its
// material (vehiclemats.js carGlassMaterial, program key 'rwglass') reads
// the contact shadow's clearance from one relative morph target
// (carbody.js shadowLift). three.js builds a separate program for a mesh
// whose geometry has no morph target, or a different count, so every glass
// mesh of every car, service vehicle, fleet level, damage state and LOD
// must carry exactly that one target (and no normal targets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh, setVehicleLod } from '../src/render/vehiclemesh.js';
import { fitServiceMesh } from '../src/render/servicebody.js';
import { BOAT_SPECS } from '../src/entities/boat.js';
import { AIRCRAFT_SPECS } from '../src/entities/aircraft.js';
import { createBoatMesh } from '../src/render/boatmesh.js';
import { createAircraftMesh } from '../src/render/aircraftmesh.js';

const isCarGlass = (m) => !!m && typeof m.customProgramCacheKey === 'function' && m.customProgramCacheKey() === 'rwglass';

// Every mesh drawn with the car glass, with what its program would need.
function glassVariants(root, into) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (!ms.some(isCarGlass)) return;
    const g = o.geometry;
    const pos = g.morphAttributes && g.morphAttributes.position;
    const nor = g.morphAttributes && g.morphAttributes.normal;
    into.add(`targets ${pos ? pos.length : 0} relative ${!!g.morphTargetsRelative} normals ${nor ? nor.length : 0}`);
  });
  return into;
}

const car = (spec) => ({
  kind: 'car', spec, x: 0, z: 0, px: 0, pz: 0, heading: 0, pheading: 0, y: 0, speed: 0, steer: 0,
  health: spec.health, brake: 0, handbrake: false, siren: false, beacon: false, wrecked: false, lodFar: null,
});

test('every car glass mesh carries the one contact-shadow morph target (one program)', () => {
  const seen = new Set();
  let meshes = 0;
  for (const id of Object.keys(VEHICLE_SPECS)) {
    const spec = VEHICLE_SPECS[id];
    const mesh = fitServiceMesh(createVehicleMesh(spec, spec.colors[0]), spec);
    const v = car(spec);
    const one = new Set();
    glassVariants(mesh, one);
    for (const s of [{ health: spec.health * 0.4 }, { health: spec.health * 0.1 }, { lodFar: true }, { lodFar: false }, { wrecked: true, health: 0 }]) {
      Object.assign(v, s);
      for (let t = 0; t < 1; t += 0.1) updateVehicleMesh(mesh, v, 1, t);
      if (s.lodFar !== undefined) setVehicleLod(mesh, s.lodFar);
      glassVariants(mesh, one);
    }
    mesh.traverse((o) => { if (o.isMesh && isCarGlass(o.material)) meshes++; });
    assert.deepEqual([...one], ['targets 1 relative true normals 0'], id);
    for (const k of one) seen.add(k);
  }
  assert.ok(meshes > Object.keys(VEHICLE_SPECS).length, `glass meshes ${meshes}`);
  assert.equal(seen.size, 1);
});

test('boats and aircraft do not draw with the car glass (their own glass material)', () => {
  const seen = new Set();
  for (const spec of Object.values(BOAT_SPECS)) glassVariants(createBoatMesh(spec, spec.colors ? spec.colors[0] : undefined), seen);
  for (const spec of Object.values(AIRCRAFT_SPECS)) glassVariants(createAircraftMesh(spec, spec.colors ? spec.colors[0] : undefined), seen);
  for (const k of seen) assert.equal(k, 'targets 1 relative true normals 0');
});
