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
  assert.ok(pos.x > target.x, 'in front of the car center (heading 0 faces +x)');
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

test('tank: chase behind the aim, far and gunner views, drag turns the aim (task 32)', () => {
  const cam = new THREE.PerspectiveCamera(62, 2, 0.5, 1800);
  const chase = createChaseCamera(cam);
  chase.setMode('tank');
  const ta = chase.tankAim;
  ta.yaw = Math.PI / 2; // aim south while the hull faces east
  ta.pitch = 0.1;
  const tk = { x: 0, z: 0, y: 0, heading: ta.yaw, pitch: ta.pitch, roll: 0, speed: 0, height: 0 };
  chase.snap(tk);
  const step = (n, input = null) => {
    for (let i = 0; i < n; i++) {
      tk.heading = ta.yaw;
      tk.pitch = ta.pitch;
      chase.update(tk, 1 / 60, input, null);
    }
    return cam.position.clone();
  };
  let pos = step(60);
  assert.equal(chase.getView(), 'Chase');
  assert.ok(pos.z < -9 && Math.abs(pos.x) < 1, `behind the aim (south), not the hull: ${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`);
  assert.ok(Math.abs(cam.fov - 62) < 1.5, 'FOV 62');
  // Drag right turns the aim right (toward -x when facing +z), up raises it.
  const input = { lookX: 0, lookY: 0 };
  for (let i = 0; i < 20; i++) {
    input.lookX = 10;
    input.lookY = -5;
    step(1, input);
  }
  assert.ok(ta.yaw > Math.PI / 2 + 0.5, `yaw turned (${ta.yaw.toFixed(2)})`);
  assert.ok(ta.pitch > 0.1 && ta.pitch <= 0.42 + 1e-9, 'pitch rose within limits');
  // A lock holds the drag.
  ta.holdDrag = true;
  const y0 = ta.yaw;
  input.lookX = 50;
  step(1, input);
  assert.equal(ta.yaw, y0);
  ta.holdDrag = false;
  assert.equal(chase.cycleView(), 'Far chase');
  pos = step(90);
  const d = Math.hypot(pos.x, pos.z);
  assert.ok(d > 13, `far view further back (${d.toFixed(1)})`);
  assert.equal(chase.cycleView(), 'Gunner');
  pos = step(90);
  assert.ok(Math.hypot(pos.x, pos.z) < 2.5 && pos.y > 2.5, 'gunner sits on the turret');
  assert.ok(Math.abs(cam.fov - 50) < 1.5, 'gunner FOV 50');
  // Reversing fast still follows the aim.
  chase.cycleView();
  tk.speed = -5;
  ta.yaw = 0;
  pos = step(120);
  assert.ok(pos.x < -8, 'follows the aim while reversing');
});

test('car weight: 0.18 s yaw lag, roll into turns up to 2 degrees, pitch under braking up to 1.5', async () => {
  const { LEAN } = await import('../src/render/chasecam.js');
  const { CAMERA } = await import('../src/entities/handlingbands.js');
  assert.equal(LEAN.yawLag, CAMERA.yawLag);
  assert.equal(LEAN.rollMaxDeg, CAMERA.rollMaxDeg);
  assert.equal(LEAN.pitchMaxDeg, CAMERA.pitchMaxDeg);
  const cam = new THREE.PerspectiveCamera(62, 2, 0.5, 1800);
  const chase = createChaseCamera(cam);
  chase.setMode('car');
  const t = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 20, height: 1.2 };
  chase.snap(t);
  // Heading step: 63 % of it after one time constant.
  t.heading = 0.5;
  chase.update(t, LEAN.yawLag, null, null);
  assert.ok(Math.abs(chase.getLean().heading / 0.5 - (1 - Math.exp(-1))) < 1e-6, `lag ${chase.getLean().heading}`);
  // A hard right turn (1.5 g): roll into it, capped.
  chase.snap(t);
  let maxRoll = 0;
  for (let i = 0; i < 180; i++) {
    t.heading += (1.5 * 9.81 / 20) / 60;
    t.x += Math.cos(t.heading) * 20 / 60;
    t.z += Math.sin(t.heading) * 20 / 60;
    chase.update(t, 1 / 60, null, null);
    maxRoll = Math.max(maxRoll, chase.getLean().rollDeg);
    assert.ok(Number.isFinite(cam.position.x) && Number.isFinite(cam.quaternion.w));
  }
  assert.ok(maxRoll > 1.9 && maxRoll <= LEAN.rollMaxDeg + 1e-9, `roll ${maxRoll}`);
  // A left turn rolls the other way.
  for (let i = 0; i < 120; i++) {
    t.heading -= (0.5 * 9.81 / 20) / 60;
    chase.update(t, 1 / 60, null, null);
  }
  assert.ok(chase.getLean().rollDeg < -0.5);
  // Hard braking: pitch down, capped; no pitch while accelerating.
  chase.snap(t);
  let maxPitch = 0;
  for (let i = 0; i < 120; i++) {
    t.speed = Math.max(0, t.speed - 9.5 / 60);
    chase.update(t, 1 / 60, null, null);
    maxPitch = Math.max(maxPitch, chase.getLean().pitchDeg);
  }
  assert.ok(maxPitch > 1.2 && maxPitch <= LEAN.pitchMaxDeg + 1e-9, `pitch ${maxPitch}`);
  for (let i = 0; i < 120; i++) {
    t.speed += 3 / 60;
    chase.update(t, 1 / 60, null, null);
  }
  assert.ok(chase.getLean().pitchDeg < 0.05);
  // Switched off (or reduced motion): no roll, no pitch.
  chase.setLean(false);
  for (let i = 0; i < 60; i++) {
    t.heading += 0.02;
    chase.update(t, 1 / 60, null, null);
  }
  assert.equal(chase.getLean().rollDeg, 0);
  assert.equal(chase.getLean().on, false);
});

test('reduced motion starts the car lean off; on foot never leans', () => {
  const saved = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q.includes('reduce') });
  try {
    const chase = createChaseCamera(new THREE.PerspectiveCamera(62, 2, 0.5, 1800));
    assert.equal(chase.getLean().on, false);
  } finally {
    globalThis.matchMedia = saved;
  }
  const chase = createChaseCamera(new THREE.PerspectiveCamera(62, 2, 0.5, 1800));
  chase.setMode('foot');
  const t = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 6, height: 1.5 };
  chase.snap(t);
  for (let i = 0; i < 60; i++) {
    t.heading += 0.05;
    chase.update(t, 1 / 60, null, null);
  }
  assert.equal(chase.getLean().rollDeg, 0);
});
