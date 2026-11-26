// 0.13.7 pace and scale. Owner on a phone in Miami Beach: "the streets are
// not proportional, a single city block feels like it takes an hour". The
// map is to scale (blocks about 100 m, lamps about 30 m apart, 3 m dashes
// every 12 m); what was off: the chase view 104 to 106 degrees across a
// phone (everything a fifth smaller and slower on the screen than at
// 16:9) and the signals of one junction out of phase with each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChaseCamera, chaseBaseFov, CHASE_ASPECT } from '../src/render/chasecam.js';
import { signalState, signalClusters, SIGNAL } from '../src/world/citygen.js';
import * as V from '../src/entities/vehicle.js';

const hfov = (v, a) => (2 * Math.atan(Math.tan((v * Math.PI) / 360) * a) * 180) / Math.PI;

test('chase view: as wide across a phone as across a 16:9 screen, never wider', () => {
  const h169 = hfov(62, CHASE_ASPECT);
  assert.ok(h169 > 93 && h169 < 95, `16:9 width ${h169.toFixed(1)}`);
  for (const a of [748 / 360, 915 / 412, 3120 / 1440]) {
    assert.ok(Math.abs(hfov(chaseBaseFov(62, a), a) - h169) < 0.01, `aspect ${a.toFixed(2)}`);
  }
  assert.equal(chaseBaseFov(62, 1.5), 62, 'narrower screens keep the vertical angle');
  assert.equal(chaseBaseFov(62, 0.5), 62, 'portrait too');
  // The real camera: Chase and Far chase at rest on the S24 Ultra in landscape.
  const cam = new THREE.PerspectiveCamera(62, 3120 / 1440, 0.5, 1800);
  const chase = createChaseCamera(cam);
  chase.setMode('car');
  const still = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 0, height: 1.2 };
  for (const view of ['Chase', 'Far chase']) {
    assert.ok(chase.setView(view));
    chase.snap(still);
    for (let i = 0; i < 60; i++) chase.update(still, 1 / 60, null, null);
    const h = hfov(cam.fov, cam.aspect);
    assert.ok(h >= 90 && h <= 99, `${view}: ${h.toFixed(1)} degrees across (was 106 and 109)`);
  }
  // The speed widening is still there at 60 mph.
  assert.ok(chase.setView('Chase'));
  const fast = { ...still, speed: 26.8 };
  chase.snap(still);
  const f0 = cam.fov;
  for (let i = 0; i < 240; i++) { fast.x += fast.speed / 60; chase.update(fast, 1 / 60, null, null); }
  assert.ok(cam.fov > f0 + 4, `widens with speed: ${f0.toFixed(1)} to ${cam.fov.toFixed(1)}`);
});

// A divided road crossing a street: four signal nodes 18 to 25 m apart, and
// another junction 110 m on.
function junctionCity() {
  const nodes = [
    { id: 0, x: 0, z: 0 }, { id: 1, x: 20, z: 0 }, { id: 2, x: 0, z: 18 }, { id: 3, x: 20, z: 18 },
    { id: 4, x: 130, z: 0 }, { id: 5, x: -100, z: 0 },
  ];
  for (const n of nodes) { n.signal = n.id !== 5; n.edges = []; }
  const edges = [[0, 1], [2, 3], [0, 2], [1, 3], [1, 4], [5, 0]].map(([a, b], id) => ({
    id, a, b, length: Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z), horizontal: nodes[a].z === nodes[b].z,
  }));
  for (const e of edges) { nodes[e.a].edges.push(e.id); nodes[e.b].edges.push(e.id); }
  return { nodes, edges };
}

test('signals: one junction shows one light, never both ways open, a cycle a car rarely waits long at', () => {
  const city = signalClusters(junctionCity());
  const [a, b, c, d, far] = city.nodes;
  assert.ok(a.sigC === b.sigC && b.sigC === c.sigC && c.sigC === d.sigC, 'the four nodes are one junction');
  assert.notEqual(far.sigC, a.sigC, '110 m on is another junction');
  let redRun = 0, longest = 0, green = 0;
  for (let t = 0; t < 96; t += 0.25) {
    for (const h of [true, false]) {
      const s = signalState(a, h, t);
      for (const n of [b, c, d]) assert.equal(signalState(n, h, t), s, `node ${n.id} at ${t}`);
    }
    const h = signalState(a, true, t), v = signalState(a, false, t);
    assert.ok(h === 'red' || v === 'red', `both ways open at ${t}`);
    if (h === 'green') green += 0.25;
    redRun = h === 'red' ? redRun + 0.25 : 0;
    longest = Math.max(longest, redRun);
  }
  assert.ok(longest <= 13, `longest red ${longest} s`);
  assert.ok(green / 96 >= 0.35, `green ${(green / 96 * 100).toFixed(0)} % of the time`);
  // The green wave (off by default): a car going east at SIGNAL.wave meets the far junction's light in the phase it left.
  assert.equal(SIGNAL.wave, 0);
  SIGNAL.wave = 13.4;
  try {
    const tt = (far.x + far.z - a.sigX - a.sigZ) / SIGNAL.wave;
    for (let t = 0; t < 48; t += 0.5) assert.equal(signalState(far, true, t + tt), signalState(a, true, t));
    for (let t = 0; t < 48; t += 0.5) assert.equal(signalState(b, true, t), signalState(a, true, t));
  } finally { SIGNAL.wave = 0; }
  // A node never clustered keeps its own place for the phase.
  assert.ok(['green', 'amber', 'red'].includes(signalState({ id: 9, x: -5, z: 3, signal: true }, true, 1)));
});

test('a normal car does 0 to 30 mph in about 3 s, and nothing caps it in town', () => {
  V.setHandlingMode('arcade');
  for (const preset of V.HANDLING_PRESETS) {
    V.setHandlingPreset(preset);
    try {
      for (const id of ['compact', 'sedan', 'midsize', 'taxi', 'suv']) {
        const v = V.createVehicle(id, 0, 0, 0);
        const ctl = { throttle: 1, steer: 0, steerShape: true };
        let t = 0;
        while (Math.hypot(v.vx, v.vz) * 2.23694 < 30 && t < 10) { V.stepVehicle(v, ctl, 1 / 60, null); t += 1 / 60; }
        assert.ok(t >= 2 && t <= 3.3, `${preset} ${id}: 0 to 30 mph in ${t.toFixed(2)} s`);
        for (let i = 0; i < 600; i++) V.stepVehicle(v, ctl, 1 / 60, null);
        assert.ok(Math.hypot(v.vx, v.vz) * 2.23694 > 60, `${preset} ${id}: past 60 mph after 13 s`);
      }
    } finally { V.setHandlingPreset('standard'); }
  }
});
