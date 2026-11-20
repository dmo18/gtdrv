import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChaseCamera } from '../src/render/chasecam.js';

const target = { x: 100, z: 50, y: 0, heading: 0, pitch: 0, roll: 0, speed: 12, height: 1.2 };
const settle = (cam, chase, n = 120) => {
  for (let i = 0; i < n; i++) chase.update(target, 1 / 60, null, null);
  return cam.position.clone();
};

test('VIEW cycles through distinct camera views for every kind', () => {
  for (const kind of ['car', 'foot', 'boat', 'plane', 'heli']) {
    const cam = new THREE.PerspectiveCamera(62, 2, 0.5, 1800);
    const chase = createChaseCamera(cam);
    chase.setMode(kind);
    chase.snap(target);
    const names = new Set([chase.getView()]);
    const dists = [];
    for (let i = 0; i < 4; i++) {
      const pos = settle(cam, chase);
      dists.push(Math.hypot(pos.x - target.x, pos.z - target.z));
      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), `${kind} finite`);
      names.add(chase.cycleView());
    }
    assert.ok(names.size >= 2, `${kind} has more than one view`);
    assert.ok(Math.max(...dists) - Math.min(...dists) > 1, `${kind} views sit at different distances`);
  }
});

test('bumper view puts the camera ahead of the target and low', () => {
  const cam = new THREE.PerspectiveCamera(62, 2, 0.5, 1800);
  const chase = createChaseCamera(cam);
  chase.setMode('car');
  chase.snap(target);
  assert.equal(chase.cycleView(), 'Far chase');
  assert.equal(chase.cycleView(), 'Bumper');
  const pos = settle(cam, chase, 240);
  assert.ok(pos.x > target.x, 'in front of the car centre (heading 0 faces +x)');
  assert.ok(pos.y < 1.2, 'low');
  assert.equal(chase.cycleView(), 'Chase', 'wraps around');
});

test('each kind remembers its own view', () => {
  const cam = new THREE.PerspectiveCamera(62, 2, 0.5, 1800);
  const chase = createChaseCamera(cam);
  chase.setMode('car');
  chase.cycleView();
  chase.setMode('boat');
  assert.equal(chase.getView(), 'Chase');
  chase.setMode('car');
  assert.equal(chase.getView(), 'Far chase');
});

test('aim view: over the right shoulder, FOV 55, eases in 0.2 s, drag turns it, no jump on leaving', () => {
  const cam = new THREE.PerspectiveCamera(60, 2, 0.3, 1800);
  const chase = createChaseCamera(cam);
  chase.setMode('foot');
  const t = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 0, height: 1.5 };
  chase.snap(t);
  for (let i = 0; i < 60; i++) chase.update(t, 1 / 60, null, null);
  chase.setAim(true);
  assert.ok(Math.abs(chase.aim.yaw) < 0.05, 'starts where the camera already looked');
  for (let i = 0; i < 6; i++) chase.update(t, 1 / 60, null, null);
  assert.ok(chase.aim.k > 0.4 && chase.aim.k < 0.6, `half way at 0.1 s (${chase.aim.k})`);
  for (let i = 0; i < 6; i++) chase.update(t, 1 / 60, null, null);
  assert.equal(chase.aim.k, 1);
  assert.ok(Math.abs(cam.fov - 55) < 0.01, `fov ${cam.fov}`);
  // Heading 0 faces +x; right is +z. Camera behind (-x) and to the right.
  assert.ok(Math.abs(cam.position.x + 3.2) < 0.05, `x ${cam.position.x}`);
  assert.ok(Math.abs(cam.position.z - 0.6) < 0.05, `z ${cam.position.z}`);
  assert.ok(Math.abs(chase.ray.dx - 1) < 1e-3, 'looks along the aim');
  const input = { lookX: 100, lookY: 0 };
  chase.update(t, 1 / 60, input, null);
  assert.equal(input.lookX, 0, 'drag consumed');
  assert.ok(Math.abs(chase.aim.yaw - 0.42) < 0.01, `drag turned the aim (${chase.aim.yaw})`);
  chase.aim.dragScale = 0.6;
  chase.update(t, 1 / 60, { lookX: 100, lookY: 0 }, null);
  assert.ok(Math.abs(chase.aim.yaw - 0.672) < 0.01, 'slower over a target');
  // Leaving the aim view: the chase camera stays behind the aim direction.
  t.heading = chase.aim.yaw;
  chase.setAim(false);
  let maxStep = 0, last = chase.viewYaw();
  for (let i = 0; i < 40; i++) {
    chase.update(t, 1 / 60, null, null);
    const y = chase.viewYaw();
    maxStep = Math.max(maxStep, Math.abs(y - last));
    last = y;
  }
  assert.equal(chase.aim.k, 0);
  assert.ok(maxStep < 0.06, `no whip when leaving (${maxStep})`);
  assert.ok(Math.abs(last - t.heading) < 0.15, `ends behind the aim (${last})`);
  for (const v of [cam.position.x, cam.position.y, cam.position.z, cam.fov]) assert.ok(Number.isFinite(v));
  chase.setMode('car');
  chase.setAim(true);
  assert.equal(chase.aim.on, false, 'no aim view in craft');
});
