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
