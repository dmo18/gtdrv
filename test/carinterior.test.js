// The cockpit interior kit and the measured cabin (src/render/carinterior.js,
// docs/PLAN_V3.md 2.8): about 1,500 triangles, the eye from the spec or the
// per-kind default, the front shell (hood and fenders only), attach and
// detach leave the car exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VEHICLE_SPECS, createVehicle } from '../src/entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh } from '../src/render/vehiclemesh.js';
import { CLS } from '../src/render/vehiclemats.js';
import {
  carGeometry, measureCabin, eyePoint, hoodPoint, inCabin, buildInterior, attachInterior, frontShell, interiorLayout,
  pointTri, bodyClearance, EYE_DEFAULTS, WHEEL_MAX_DEG,
} from '../src/render/carinterior.js';

const cars = Object.values(VEHICLE_SPECS).filter((s) => !s.kind || s.kind === 'car');
function cabinOf(spec) {
  const mesh = createVehicleMesh(spec);
  const g = carGeometry(mesh);
  return { mesh, g, cab: measureCabin(spec, g.body, g.glass) };
}

test('point to triangle distance', () => {
  assert.equal(pointTri(0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), 1);
  assert.ok(Math.abs(pointTri(2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) - 1) < 1e-12, 'nearest a corner');
  assert.ok(Math.abs(pointTri(0.5, 0, -1, 0, 0, 0, 1, 0, 0, 0, 0, 1) - 1) < 1e-12, 'nearest an edge');
});

test('every car: a cabin behind the windshield, an eye on the left inside it, a hood camera on the center line', () => {
  for (const spec of cars) {
    const { cab } = cabinOf(spec);
    assert.ok(cab.wsX > cab.rfX && cab.rfX > cab.rearX, `${spec.id}: windshield base ahead of its top, ahead of the cabin rear`);
    assert.ok(cab.rfY > cab.wsY, `${spec.id}: windshield rises`);
    const eye = eyePoint(spec, cab);
    assert.ok(eye.z < -0.15, `${spec.id}: driver on the left (${eye.z.toFixed(2)})`);
    assert.ok(inCabin(cab, eye), `${spec.id}: eye in the cabin`);
    const hp = hoodPoint(cab, eye);
    assert.equal(hp.z, 0);
    assert.equal(hp.y, eye.y, 'hood camera at the driver eye height');
    assert.ok(Math.abs(hp.x - cab.wsX) < 0.05, 'at the windshield base');
  }
});

test('the spec eye is used when it is inside the cabin; a placeholder falls back to the per-kind default', () => {
  const base = VEHICLE_SPECS.sedan;
  const { g } = cabinOf(base);
  const def = eyePoint(base, measureCabin(base, g.body, g.glass));
  assert.equal(def.fromSpec, false);
  assert.ok(EYE_DEFAULTS.sedan && EYE_DEFAULTS.suv && EYE_DEFAULTS.pickup && EYE_DEFAULTS.default);
  const withEye = { ...base, id: 'sedan-eye-test', eye: { x: def.x - 0.05, y: def.y - 0.02, z: def.z + 0.03 } };
  const e2 = eyePoint(withEye, measureCabin(withEye, g.body, g.glass));
  assert.equal(e2.fromSpec, true);
  assert.deepEqual([e2.x, e2.y, e2.z], [withEye.eye.x, withEye.eye.y, withEye.eye.z]);
  const zero = { ...base, id: 'sedan-eye-zero', eye: { x: 0, y: 0, z: 0 } };
  assert.equal(eyePoint(zero, measureCabin(zero, g.body, g.glass)).fromSpec, false, 'an eye on the ground is not a driver');
  const right = { ...base, id: 'sedan-eye-right', eye: { x: def.x, y: def.y, z: -def.z } };
  assert.equal(eyePoint(right, measureCabin(right, g.body, g.glass)).fromSpec, false, 'right-hand drive is not American');
});

test('interior kit: about 1,500 triangles, four draws, the parts in front of the driver', () => {
  for (const spec of cars) {
    const { cab } = cabinOf(spec);
    const eye = eyePoint(spec, cab);
    const it = buildInterior(spec, cab, eye);
    assert.ok(it.tris >= 1200 && it.tris <= 1800, `${spec.id}: ${it.tris} triangles`);
    let draws = 0, counted = 0;
    it.group.traverse((o) => {
      if (!o.isMesh) return;
      draws++;
      counted += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    assert.equal(counted, it.tris);
    assert.ok(draws <= 5, `${draws} draws`);
    const lay = interiorLayout(cab, eye);
    assert.ok(lay.wheelX > eye.x + 0.3 && lay.wheelY < eye.y - 0.2, 'wheel ahead and below the eye');
    assert.ok(lay.clusterX > lay.wheelX && lay.clusterX < cab.wsX, 'cluster behind the wheel, under the glass');
    assert.ok(Math.abs(lay.wheelR - 0.185) < 0.02);
  }
});

test('the steering wheel turns with the input, up to 90 degrees; the needles follow speed and rpm', () => {
  const spec = VEHICLE_SPECS.sedan;
  const { cab } = cabinOf(spec);
  const it = buildInterior(spec, cab, eyePoint(spec, cab));
  for (const steer of [-1, -0.5, 0, 0.25, 1, 1.4]) {
    it.update({ steer, speed: 10, rpm: 0.5 });
    const want = Math.max(-1, Math.min(1, steer)) * WHEEL_MAX_DEG;
    assert.equal(it.state.wheelDeg, want);
    assert.ok(Math.abs(it.spinner.rotation.z + (want * Math.PI) / 180) < 1e-12, 'clockwise for a right turn, as the driver sees it');
  }
  it.update({ steer: 0, speed: 0, rpm: 0 });
  const a0 = it.speedo.rotation.z;
  it.update({ steer: 0, speed: 60 / 2.23694, rpm: 0.6 });
  assert.ok(Math.abs(it.state.mph - 60) < 1e-9);
  assert.ok(Math.abs(a0 - it.speedo.rotation.z - (60 / 160) * 1.5 * Math.PI) < 1e-9, 'speedometer at 60 of 160 mph');
  // The wheel's +z (toward the driver) points back and up along the column.
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(it.mount.quaternion);
  assert.ok(n.x < -0.8 && n.y > 0.3, `column axis ${n.x.toFixed(2)}, ${n.y.toFixed(2)}`);
});

test('front shell: only hood, fenders and nose (ahead of the windshield base), no cabin parts', () => {
  for (const id of ['sedan', 'suv', 'pickup', 'sports']) {
    const spec = VEHICLE_SPECS[id];
    if (!spec) continue;
    const { g, cab } = cabinOf(spec);
    const fs = frontShell(g.body, cab);
    const p = fs.attributes.position.array, ix = fs.index.array, cls = fs.attributes.aCls ? fs.attributes.aCls.array : null;
    assert.ok(ix.length / 3 > 200, `${id}: ${ix.length / 3} front triangles`);
    assert.ok(ix.length < g.body.index.count * 0.7, 'a part of the body');
    for (let t = 0; t < ix.length; t += 3) {
      const mx = (p[ix[t] * 3] + p[ix[t + 1] * 3] + p[ix[t + 2] * 3]) / 3;
      assert.ok(mx > cab.wsX - 0.03, 'ahead of the windshield base');
      if (cls) assert.notEqual(cls[ix[t]], CLS.CABIN);
    }
    assert.equal(fs.attributes.position, g.body.attributes.position, 'shares the body buffers');
  }
});

test('attach hides the exterior (front shell and shadow stay), detach restores every mesh exactly', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  v.mesh = createVehicleMesh(v.spec);
  updateVehicleMesh(v.mesh, v, 1);
  const before = [];
  v.mesh.traverse((o) => { if (o.isMesh) before.push([o, o.layers.mask, o.visible]); });
  const h = attachInterior(v);
  assert.ok(h && h.interior && h.front && h.shadow);
  const rig = v.mesh.userData.rig;
  assert.ok(rig.children.includes(h.interior.group));
  for (const [o] of before) {
    if (o.parent === rig || rig.children.includes(o.parent) || (o.parent && o.parent.parent === rig)) assert.equal(o.layers.mask, 0, 'exterior hidden');
  }
  assert.notEqual(h.front.layers.mask, 0);
  assert.equal(h.front.material, v.mesh.userData.body.material, 'the hood keeps the car paint');
  assert.equal(h.shadow.castShadow, true);
  assert.equal(h.shadow.material.colorWrite, false, 'the shadow copy draws nothing');
  v.steer = 1;
  h.update(v);
  assert.equal(h.interior.state.wheelDeg, 90);
  h.detach();
  assert.ok(!rig.children.includes(h.interior.group) && !rig.children.includes(h.front));
  for (const [o, mask, vis] of before) {
    assert.equal(o.layers.mask, mask);
    assert.equal(o.visible, vis);
  }
});

test('eye clearance helper sees the body shell', () => {
  const spec = VEHICLE_SPECS.sedan;
  const { g, cab } = cabinOf(spec);
  const eye = eyePoint(spec, cab);
  assert.ok(bodyClearance(g.body, eye.x, eye.y, eye.z, true) >= 0.15);
  assert.ok(bodyClearance(g.body, cab.wsX + 0.5, cab.hoodY + 0.01, 0, true) < 0.05, 'a point on the hood is on the body');
});
