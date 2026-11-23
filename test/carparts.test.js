// Thrown car parts (src/render/carparts.js, REVAMP 6.7 layer 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createParts, launchCarParts, stepParts, liveParts, partScale, PART, PARTS_MAX,
  PART_LIE_T, PART_FADE_T, PART_KEEP, PART_V0, PART_V1,
} from '../src/render/carparts.js';

const car = (id, extra = {}) => ({ id, kind: 'car', color: 0x3060c0, spec: { length: 4.5, width: 1.8, height: 1.4 }, ...extra });

test('a car throws 14 to 18 parts with a door, a wheel, the hood and a bumper', () => {
  for (let id = 0; id < 30; id++) {
    const P = createParts();
    const out = {};
    const n = launchCarParts(P, car(id), 0, 0.7, 0, out);
    assert.ok(n >= 14 && n <= 18, `${n} parts`);
    assert.equal(liveParts(P), n);
    assert.ok(out.door >= 1 && out.wheel >= 1 && out.hood === 1 && out.bumper === 1, JSON.stringify(out));
    assert.equal(out.door, 2, 'an empty pool has room for the second door');
    assert.equal(out.wheel, 2);
    for (let i = 0; i < P.max; i++) {
      if (P.age[i] < 0) continue;
      const h = Math.hypot(P.vx[i], P.vz[i]), sp = Math.hypot(h, P.vy[i]);
      const el = Math.atan2(P.vy[i], h) * 180 / Math.PI;
      assert.ok(sp >= PART_V0 - 1e-6 && sp <= PART_V1 + 1e-6, `speed ${sp}`);
      assert.ok(el >= 35 - 1e-6 && el <= 75 + 1e-6, `angle ${el}`);
    }
  }
});

test('seeded from the vehicle id: the same car comes apart the same way', () => {
  const a = createParts(), b = createParts(), c = createParts();
  launchCarParts(a, car(12), 0, 0.7, 0);
  launchCarParts(b, car(12), 0, 0.7, 0);
  launchCarParts(c, car(13), 0, 0.7, 0);
  for (let k = 0; k < 300; k++) {
    stepParts(a, 1 / 60);
    stepParts(b, 1 / 60);
  }
  assert.deepEqual([...a.x], [...b.x]);
  assert.deepEqual([...a.kind], [...b.kind]);
  assert.notDeepEqual([...a.vx], [...c.vx]);
});

test('parts fall, bounce once keeping 0.3 of the speed, lie flat 20 s, then shrink away', () => {
  const P = createParts();
  const lands = [];
  const n = launchCarParts(P, car(3), 0, 0.7, 0);
  const sp0 = new Float32Array(P.max);
  let bounced = 0;
  for (let k = 0; k < 60 * 6; k++) {
    for (let i = 0; i < P.max; i++) sp0[i] = Math.hypot(P.vx[i], P.vy[i], P.vz[i]);
    const before = Uint8Array.from(P.hits);
    stepParts(P, 1 / 60, (i, sp) => lands.push([i, sp]));
    for (let i = 0; i < P.max; i++) {
      if (before[i] === 0 && P.hits[i] === 1) {
        bounced++;
        const after = Math.hypot(P.vx[i], P.vy[i], P.vz[i]);
        assert.ok(Math.abs(after / sp0[i] - PART_KEEP) < 0.06, `kept ${after / sp0[i]}`);
      }
    }
  }
  assert.ok(bounced >= n - 2, `${bounced} of ${n} bounced`);
  assert.equal(new Set(lands.map((l) => l[0])).size, lands.length, 'one landing event per part');
  for (let i = 0; i < P.max; i++) {
    if (P.age[i] < 0) continue;
    assert.equal(P.hits[i], 2, 'all lying by 6 s');
    assert.ok(Math.abs(P.y[i] - P.sy[i] * 0.5) < 0.05, 'resting on the ground');
    assert.ok(Math.abs(Math.sin(P.rx[i])) < 0.05 && Math.abs(Math.sin(P.rz[i])) < 0.05, 'lying flat');
    assert.equal(partScale(P, i), 1);
  }
  for (let k = 0; k < 60 * (PART_LIE_T - 6 + PART_FADE_T * 0.5); k++) stepParts(P, 1 / 60);
  let some = false;
  for (let i = 0; i < P.max; i++) if (P.age[i] >= 0) some = some || (partScale(P, i) < 0.8 && partScale(P, i) > 0);
  assert.ok(some, 'shrinking in the last second');
  for (let k = 0; k < 60; k++) stepParts(P, 1 / 60);
  assert.equal(liveParts(P), 0);
});

test('the pool of 96 is a hard cap; the oldest parts make room', () => {
  const P = createParts();
  for (let id = 0; id < 12; id++) {
    launchCarParts(P, car(id), id * 10, 0.7, 0);
    stepParts(P, 0.5);
    assert.ok(liveParts(P) <= PARTS_MAX);
  }
  assert.equal(liveParts(P), PARTS_MAX);
  // Only cars shed doors and wheels.
  const Q = createParts();
  const out = {};
  launchCarParts(Q, { id: 1, kind: 'tank', color: 0x556644, spec: { length: 7, width: 3.4, height: 2.4 } }, 0, 1, 0, out);
  assert.equal(out.door + out.wheel + out.hood + out.bumper, 0);
  assert.ok([...Q.kind].includes(PART.panel));
});
