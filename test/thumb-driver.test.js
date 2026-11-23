// Task DRIVE (docs/PLAN_V3.md 13): the car answers a coarse, slow thumb.
// A thumb driver (test/thumbdriver.js: 180 ms late, 4 units of input per
// second, steps of 0.08, seeded noise of 0.04, pure pursuit) drives the
// real stepVehicle in Arcade / Standard. Every test prints its numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/entities/vehicle.js';
import {
  CARS, UTURN_CARS, LANE, LANE_CHANGE, CURVE, SLALOM, DT, MPH, junctionTurn, laneChange, curve, uTurn, slalom,
  trailBrake, runAll, formatRows, holdSpeed,
} from './thumbdriver.js';

const { setHandlingMode, setHandlingPreset, stepVehicle, createVehicle, steerShapeExp, shapeSteerBySpeed, fullLockCurvature } = V;
const TRAIL_KEEP = 0.7; // Arcade keeps at least 70 % of the steering response under brake
const RELEASE = { settle: 0.5, reverse: 0.004 }; // s to straight after a release, rad/s of yaw the other way

function arcade(fn, preset = 'standard') {
  setHandlingMode('arcade');
  setHandlingPreset(preset);
  try { return fn(); } finally { setHandlingPreset('standard'); setHandlingMode('arcade'); }
}

// One table for the whole file (the scenarios take a few seconds).
let table = null;
const rows = () => {
  if (!table) table = arcade(() => runAll(V));
  return table;
};

test('thumb driver, Arcade / Standard: the table', () => {
  console.log(`# thumb driver, Arcade / Standard\n# ${formatRows(rows()).split('\n').join('\n# ')}`);
});

test('(a), (b) 90 degree turns at 20 mph between 2-lane streets: the car stays inside its lane edges', () => {
  for (const r of rows()) {
    for (const side of ['right', 'left']) {
      const t = r[side];
      assert.ok(t.inLane, `${r.id} ${side} turn: body reaches ${t.edge.toFixed(2)} m from the lane center (edge ${LANE / 2})`);
    }
  }
});

test('(c) lane change at 45 and 65 mph: within 0.3 m of the new lane center in under 2.5 s, at most one overshoot', () => {
  for (const r of rows()) {
    for (const k of ['c45', 'c65']) {
      const c = r[k];
      assert.ok(c.settle < LANE_CHANGE.settle, `${r.id} ${k}: settled in ${c.settle.toFixed(2)} s`);
      assert.ok(c.overshoots <= LANE_CHANGE.overshoots, `${r.id} ${k}: ${c.overshoots} overshoots`);
      assert.ok(Math.abs(c.heading) < 0.03, `${r.id} ${k}: straight at the end (${c.heading.toFixed(3)} rad)`);
    }
  }
});

test('(d) a 60 m radius curve at 40 mph followed within 0.5 m', () => {
  for (const r of rows()) assert.ok(r.curve.worst <= CURVE.within, `${r.id}: ${r.curve.worst.toFixed(2)} m off the curve`);
});

test('(e) U-turn inside a 12 m street (cars): every tire between the curbs', () => {
  for (const r of rows()) {
    if (!UTURN_CARS.includes(r.id)) continue;
    const u = r.uturn;
    assert.ok(u.ok, `${r.id}: turned ${u.turned.toFixed(2)} rad, tires from ${u.zMax.toFixed(2)} to ${u.zMin.toFixed(2)} m`);
  }
});

test('(f) slalom, 6 cones 20 m apart at 30 mph: the body clears every cone', () => {
  for (const r of rows()) {
    assert.equal(r.slalom.clear.length, SLALOM.cones, `${r.id} reached every cone`);
    assert.ok(r.slalom.ok, `${r.id}: clearances ${r.slalom.clear.map((x) => x.toFixed(2)).join(' ')} m`);
  }
});

test('trail braking keeps at least 70 % of the steering response (Arcade)', () => {
  const out = [];
  arcade(() => {
    for (const id of CARS) {
      for (const s of [0.5, 1]) {
        const k = trailBrake(V, id, s);
        assert.ok(k >= TRAIL_KEEP, `${id} steer ${s}: ${(k * 100).toFixed(0)} % under brake`);
        out.push(`${id} ${s} ${(k * 100).toFixed(0)} %`);
      }
    }
  });
  console.log(`# trail braking, response kept: ${out.join(', ')}`);
});

test('release: the car settles straight within 0.5 s, no yaw back the other way', () => {
  const out = [];
  arcade(() => {
    for (const id of CARS) {
      for (const mph of [20, 45, 65]) {
        const u = mph / MPH;
        const v = createVehicle(id, 0, 0, 0);
        v.vx = u;
        const c = { steer: 0, throttle: 0, brake: 0, steerShape: true };
        for (let i = 0; i < 30; i++) { holdSpeed(v, c, u); stepVehicle(v, c, DT, {}); }
        c.steer = 0.5;
        for (let i = 0; i < 48; i++) { holdSpeed(v, c, u); stepVehicle(v, c, DT, {}); }
        const r0 = v.yawRate;
        c.steer = 0;
        let t = -1, back = 0;
        for (let i = 0; i < 90; i++) {
          holdSpeed(v, c, u);
          stepVehicle(v, c, DT, {});
          if (t < 0 && Math.abs(v.yawRate) < 0.01) t = (i + 1) * DT;
          if (v.yawRate * r0 < 0) back = Math.max(back, Math.abs(v.yawRate));
        }
        assert.ok(t > 0 && t <= RELEASE.settle, `${id} at ${mph} mph straight after ${t.toFixed(2)} s`);
        assert.ok(back <= RELEASE.reverse, `${id} at ${mph} mph yaws back ${back.toFixed(4)} rad/s`);
        if (id === 'sedan' || id === 'truck') out.push(`${id} ${mph} mph ${t.toFixed(2)} s`);
      }
    }
  });
  console.log(`# release to straight: ${out.join(', ')}`);
});

test('input shaping by speed: exponent 1 to 15 mph, about 1.8 at 70; full input stays full; monotonic, no dead zone', () => {
  assert.equal(steerShapeExp(0), 1);
  assert.equal(steerShapeExp(15 / MPH), 1);
  assert.ok(Math.abs(steerShapeExp(70 / MPH) - 1.8) < 1e-9 && steerShapeExp(90 / MPH) === steerShapeExp(70 / MPH));
  let last = 1;
  for (let mph = 15; mph <= 70; mph += 5) {
    const e = steerShapeExp(mph / MPH);
    assert.ok(e >= last, `rises with speed (${mph} mph: ${e.toFixed(3)})`);
    last = e;
  }
  for (const mph of [5, 30, 45, 65, 80]) {
    const u = mph / MPH;
    assert.equal(shapeSteerBySpeed(1, u), 1);
    assert.equal(shapeSteerBySpeed(-1, u), -1);
    assert.equal(shapeSteerBySpeed(0, u), 0);
    let prev = 0;
    for (let x = 0.01; x <= 1.0001; x += 0.01) {
      const y = shapeSteerBySpeed(x, u);
      assert.ok(y > prev, `strictly rising at ${x.toFixed(2)}, ${mph} mph`);
      assert.ok(Math.abs(shapeSteerBySpeed(-x, u) + y) < 1e-12, 'odd');
      prev = y;
    }
  }
  // Presets scale it: Relaxed finer, Sharp more direct.
  const at65 = (p) => arcade(() => steerShapeExp(65 / MPH), p);
  assert.ok(at65('relaxed') > at65('standard') && at65('sharp') < at65('standard') && at65('sharp') > 1);
  // Only the player's input is shaped: AI controls (no steerShape) are not.
  const run = (flag) => {
    const v = createVehicle('sedan', 0, 0, 0);
    v.vx = 29;
    for (let i = 0; i < 30; i++) stepVehicle(v, { steer: 0.3, throttle: 0.3, steerShape: flag }, DT, {});
    return v.steer;
  };
  assert.ok(Math.abs(run(false) - 0.3) < 1e-9 && run(true) < 0.15, `ai ${run(false)}, player ${run(true)}`);
  // One step of the touch widget (0.08) at 65 mph: the lateral g it asks.
  const u = 65 / MPH, k = fullLockCurvature(V.VEHICLE_SPECS.sedan, u) * u * u / 9.81;
  console.log(`# 65 mph sedan: one 0.08 input step asks ${(shapeSteerBySpeed(0.08, u) * k).toFixed(3)} g (unshaped ${(0.08 * k).toFixed(3)} g); half input ${(shapeSteerBySpeed(0.5, u) * k).toFixed(3)} g; full ${k.toFixed(3)} g`);
});

test('the steady turn grows with the input at every speed (no silent loss, full input is the most)', () => {
  arcade(() => {
    for (const id of CARS) {
      for (const u of [3, 8, 15, 25]) {
        if (u > V.VEHICLE_SPECS[id].maxSpeed * 0.9) continue;
        let prev = 0;
        for (const s of [0.2, 0.4, 0.6, 0.8, 0.9, 1]) {
          const v = createVehicle(id, 0, 0, 0);
          v.vx = u;
          const c = { steer: s, throttle: 0, brake: 0, steerShape: true };
          let k = 0, n = 0;
          for (let i = 0; i < 150; i++) {
            holdSpeed(v, c, u);
            stepVehicle(v, c, DT, {});
            if (i >= 90) { k += v.yawRate / Math.max(0.5, v.speed); n++; }
          }
          k /= n;
          assert.ok(k > prev * 1.01, `${id} at ${u} m/s: input ${s} turns ${k.toFixed(4)} after ${prev.toFixed(4)}`);
          prev = k;
          // At speed full input is the grip-limited turn with the front just
          // under its peak. (In town the lock is the limit; there a front-
          // or all-wheel-drive car held at speed on full lock can use some
          // front grip for the drive.)
          if (s === 1 && u >= 15) assert.ok(v.slipF < 1, `${id} at ${u} m/s: full input keeps the front under its peak (${v.slipF.toFixed(2)})`);
        }
      }
    }
  });
});

test('the Handling lab presets keep working with the thumb driver (Relaxed, Sharp)', () => {
  for (const p of ['relaxed', 'sharp']) {
    const t = arcade(() => runAll(V, ['sedan', 'suv', 'pickup', 'sports']), p);
    console.log(`# thumb driver, Arcade / ${p}\n# ${formatRows(t).split('\n').join('\n# ')}`);
    for (const r of t) {
      const tag = `${p} ${r.id}`;
      assert.ok(r.right.inLane && r.left.inLane, `${tag} turns in lane`);
      for (const c of [r.c45, r.c65]) assert.ok(c.settle < LANE_CHANGE.settle && c.overshoots <= LANE_CHANGE.overshoots, `${tag} lane change ${c.settle.toFixed(2)} s, ${c.overshoots}`);
      assert.ok(r.curve.worst <= CURVE.within, `${tag} curve ${r.curve.worst.toFixed(2)}`);
      assert.ok(r.uturn.ok, `${tag} U-turn`);
      assert.ok(r.slalom.ok, `${tag} slalom`);
    }
  }
});

// The scenarios themselves are pure functions of the seed: twice is the same.
test('the thumb driver is deterministic', () => {
  const a = arcade(() => [junctionTurn(V, 'sedan', 'right').edge, laneChange(V, 'sedan', 65).settle, curve(V, 'sedan').worst, uTurn(V, 'sedan').used, slalom(V, 'sedan').min]);
  const b = arcade(() => [junctionTurn(V, 'sedan', 'right').edge, laneChange(V, 'sedan', 65).settle, curve(V, 'sedan').worst, uTurn(V, 'sedan').used, slalom(V, 'sedan').min]);
  assert.deepEqual(a, b);
});
