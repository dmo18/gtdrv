// Task DRIVE (docs/PLAN_V3.md 13) and task PLANTED (docs/REVAMP.md 6.3,
// owner round 5): the car answers a coarse, slow thumb, and in Arcade it is
// planted, sharp and direct. A thumb driver (test/thumbdriver.js: 180 ms
// late, 4 units of input per second, steps of 0.08, seeded noise of 0.04,
// pure pursuit) drives the real stepVehicle in Arcade / Standard. Every
// test prints its numbers.
// A before / after table: THUMB_OLD=/path/to/an/older/vehicle.js node --test
// test/thumb-driver.test.js prints the same table for that module first.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/entities/vehicle.js';
import { PLANTED, HB_TURN, HB_SLIP_CAP } from '../src/entities/handlingbands.js';
import {
  CARS, UTURN_CARS, LANE, LANE_CHANGE, CURVE, SLALOM, FAST, ABUSE, DELAY_MPH, DT, MPH, junctionTurn, laneChange, curve, uTurn, slalom,
  trailBrake, runAll, formatRows, holdSpeed, rearSlipDeg, yawDelay,
} from './thumbdriver.js';

const { setHandlingMode, setHandlingPreset, stepVehicle, createVehicle, steerShapeExp, shapeSteerBySpeed, fullLockCurvature } = V;
const TRAIL_KEEP = 0.7; // Arcade keeps at least 70 % of the steering response under brake
// Task PLANTED (deliberate): straight within 0.25 s of a release (was 0.5 s).
const RELEASE = { settle: PLANTED.release, reverse: 0.004 }; // s to straight after a release, rad/s of yaw the other way

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

test('thumb driver, Arcade / Standard: the table (and the same for THUMB_OLD, an older vehicle.js)', async () => {
  if (process.env.THUMB_OLD) {
    const old = await import(process.env.THUMB_OLD);
    old.setHandlingMode('arcade');
    old.setHandlingPreset('standard');
    console.log(`# BEFORE: thumb driver, ${process.env.THUMB_OLD}, Arcade / Standard\n# ${formatRows(runAll(old)).split('\n').join('\n# ')}`);
  }
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

test('90 degree turns at 30 mph (15 m lane-center corner right, 18.3 m left; box truck 25 mph): inside the lane, speed kept', () => {
  const out = [];
  for (const r of rows()) {
    for (const k of ['fastRight', 'fastLeft']) {
      const t = r[k];
      assert.equal(t.mph, r.id === 'truck' ? FAST.truckMph : FAST.mph);
      assert.ok(t.inLane, `${r.id} ${k} at ${t.mph} mph: body reaches ${t.edge.toFixed(2)} m from the lane center (edge ${LANE / 2})`);
      assert.ok(t.keep > 0.93, `${r.id} ${k}: kept ${(t.keep * 100).toFixed(0)} % of the speed`);
      out.push(`${r.id} ${k === 'fastRight' ? 'R' : 'L'} ${t.edge.toFixed(2)}`);
    }
  }
  console.log(`# 30 mph turns, body edge from the lane center (lane edge 1.65): ${out.join(', ')}`);
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

// (Task PLANTED, deliberate: 45 mph, was 40.)
test('(d) a 60 m radius curve at 45 mph followed within 0.5 m', () => {
  assert.equal(CURVE.mph, 45);
  for (const r of rows()) assert.ok(r.curve.worst <= CURVE.within, `${r.id}: ${r.curve.worst.toFixed(2)} m off the curve`);
});

// (Task PLANTED, deliberate: a 10.5 m street for the cars, 11 m for the SUV and the pickup; was 12 m for all four.)
test('(e) U-turn inside a 10.5 m street (cars; SUV and pickup 11 m): every tire between the curbs', () => {
  for (const r of rows()) {
    if (!UTURN_CARS.includes(r.id)) continue;
    const u = r.uturn;
    assert.equal(u.street, r.id === 'suv' || r.id === 'pickup' ? 11 : 10.5);
    assert.ok(u.ok, `${r.id}: turned ${u.turned.toFixed(2)} rad, tires from ${u.zMax.toFixed(2)} to ${u.zMin.toFixed(2)} m in a ${u.street} m street`);
  }
});

// (Task PLANTED, deliberate: 35 mph, was 30; the box truck keeps 30.)
test('(f) slalom, 6 cones 20 m apart at 35 mph (box truck 30): the body clears every cone', () => {
  assert.equal(SLALOM.mph, 35);
  for (const r of rows()) {
    assert.equal(r.slalom.clear.length, SLALOM.cones, `${r.id} reached every cone`);
    assert.ok(r.slalom.ok, `${r.id}: clearances ${r.slalom.clear.map((x) => x.toFixed(2)).join(' ')} m`);
  }
});

// ---- Task PLANTED: the car never fishtails unless the handbrake asks. ----

test('planted: the slip angle at the rear axle stays under 4 degrees in every thumb scenario and in six abuse cases', () => {
  const out = [];
  for (const r of rows()) {
    assert.ok(r.slip < PLANTED.slipDeg, `${r.id}: ${r.slip.toFixed(2)} deg in the thumb scenarios`);
    for (const k of ABUSE) assert.ok(r.abuse[k] < PLANTED.slipDeg, `${r.id} ${k}: ${r.abuse[k].toFixed(2)} deg`);
    assert.ok(r.abuse.jolts >= 4, `${r.id} did cross the curbs (${r.abuse.jolts} jolts)`);
    out.push(`${r.id} ${Math.max(r.slip, r.abuse.worst).toFixed(2)}`);
  }
  console.log(`# peak rear slip without the handbrake, deg (thumb scenarios; launch on full lock, lift and brake mid-corner at 50 mph, flick at 60, curbs mid-turn, rain): ${out.join(', ')}`);
  // Power and brakes never rotate the car: a held input gives the same
  // heading change whatever the pedals do with the speed the same.
  arcade(() => {
    for (const id of ['sedan', 'muscle']) {
      const turn = (throttle, brake) => {
        const v = createVehicle(id, 0, 0, 0);
        v.vx = 20;
        let h = 0, last = 0;
        const c = { steer: 0.5, throttle, brake, steerShape: true };
        for (let i = 0; i < 60; i++) {
          const u = v.speed || 20;
          stepVehicle(v, c, DT, {});
          // Yaw per meter traveled against what that input asks at that speed.
          h += (v.heading - last) / Math.max(1e-6, u * DT) / (0.5 * fullLockCurvature(v.spec, u));
          last = v.heading;
        }
        return h / 60;
      };
      const coast = turn(0, 0), power = turn(1, 0), braked = turn(0, 1);
      assert.ok(Math.abs(power / coast - 1) < 0.08 && Math.abs(braked / coast - 1) < 0.08, `${id}: turn per meter, coast ${coast.toFixed(3)}, power ${power.toFixed(3)}, brake ${braked.toFixed(3)}`);
    }
  });
});

test('direct: the yaw rate answers a full step within 0.12 s at 10, 30, 50 and 70 mph; shaping exponent at most 1.25', () => {
  const out = [];
  for (const r of rows()) {
    assert.ok(r.delay < PLANTED.delay, `${r.id}: ${r.delay.toFixed(3)} s`);
    out.push(`${r.id} ${r.delay.toFixed(3)}`);
  }
  arcade(() => {
    for (const mph of DELAY_MPH) assert.ok(yawDelay(V, 'sedan', mph, 0.3) < PLANTED.delay, `sedan, a 0.3 step at ${mph} mph`);
    assert.ok(steerShapeExp(70 / MPH) <= PLANTED.shapeExp && steerShapeExp(120 / MPH) <= PLANTED.shapeExp);
  });
  console.log(`# input to 63 % of the settled yaw rate, worst of ${DELAY_MPH.join(', ')} mph, s: ${out.join(', ')}`);
  // Steering holds exactly while the thumb holds: a held input, a constant yaw rate.
  arcade(() => {
    const v = createVehicle('sedan', 0, 0, 0);
    v.vx = 20;
    const c = { steer: 0.4, throttle: 0, brake: 0, steerShape: true };
    for (let i = 0; i < 60; i++) { holdSpeed(v, c, 20); stepVehicle(v, c, DT, {}); }
    // (The curvature a held input asks moves a little with the speed; the car gives exactly that.)
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 120; i++) {
      holdSpeed(v, c, 20);
      const u = v.speed;
      stepVehicle(v, c, DT, {});
      const k = v.yawRate / u / (Math.tan(V.steerAngle(v.spec, u, shapeSteerBySpeed(0.4, u))) / v.spec.wheelBase);
      lo = Math.min(lo, k); hi = Math.max(hi, k);
    }
    assert.ok(lo > 0.99 && hi < 1.01, `held input: ${lo.toFixed(4)} to ${hi.toFixed(4)} of the curvature asked`);
  });
});

test('the slide the player asks for: a handbrake turn at 25 mph fits a 12 m street, 25 to 37 degrees of slip, recovery within 0.6 s, no snap', () => {
  const out = [];
  for (const r of rows()) {
    if (!r.hb) continue;
    const h = r.hb;
    assert.ok(h.along <= HB_TURN.street, `${r.id} goes ${h.along.toFixed(1)} m on`);
    assert.ok(h.peak >= PLANTED.slideDeg[0] && h.peak <= PLANTED.slideDeg[1], `${r.id} slides ${h.peak.toFixed(1)} deg`);
    assert.ok(h.recover <= PLANTED.recover, `${r.id} recovers in ${h.recover.toFixed(2)} s`);
    assert.ok(h.snap <= 0.02, `${r.id} yaws back ${h.snap.toFixed(3)} rad/s`);
    assert.ok(h.endDeg <= HB_TURN.endDeg && h.vEnd > 8, `${r.id} ends ${h.endDeg.toFixed(1)} deg off at ${h.vEnd.toFixed(1)} m/s`);
    assert.ok(h.vRel > 4 && h.vRel < HB_TURN.mph / MPH, `${r.id} bleeds speed: ${h.vRel.toFixed(1)} m/s at the release`);
    out.push(`${r.id} ${h.along.toFixed(1)} m, ${h.peak.toFixed(0)} deg, ${h.recover.toFixed(2)} s, ${h.vRel.toFixed(1)} m/s`);
  }
  console.log(`# handbrake turn at 25 mph (travel on, peak slip, recovery after release, speed at release): ${out.join('; ')}`);
  // Held at 45 mph: the slide follows the thumb (right, then left), the
  // speed bleeds steadily, v.slip (smoke, squeal, the drift score's field)
  // follows the slip angle, and the drawn front wheels steer into the slide.
  arcade(() => {
    for (const id of ['sedan', 'muscle', 'pickup']) {
      const v = createVehicle(id, 0, 0, 0);
      v.vx = 45 / MPH;
      const c = { steer: 0, throttle: 0, brake: 0, handbrake: false, steerShape: true };
      for (let i = 0; i < 30; i++) { holdSpeed(v, c, 45 / MPH); stepVehicle(v, c, DT, {}); }
      Object.assign(c, { steer: 1, handbrake: true, throttle: 0, brake: 0 });
      let drift = 0, lastV = v.speed, maxDec = 0, minDec = Infinity, peak = 0, counter = 0;
      for (let i = 0; i < 60; i++) {
        stepVehicle(v, c, DT, {});
        const dec = (lastV - v.speed) / DT;
        lastV = v.speed;
        if (i >= 20) { maxDec = Math.max(maxDec, dec); minDec = Math.min(minDec, dec); }
        if (v.slip > 0.35 && v.speed > 12) drift += DT; // score.js: DRIFT_SLIP 0.35, DRIFT_SPEED 12
        peak = Math.max(peak, rearSlipDeg(v));
        if (i === 40) counter = v.steerAngle;
      }
      const sign = (w) => Math.sign(-w.vx * Math.sin(w.heading) + w.vz * Math.cos(w.heading) - w.spec.wheelBase * w.spec.cgFront * w.yawRate);
      assert.equal(sign(v), -1, `${id}: steering right, the tail is out to the left (the rear axle travels left of the nose)`);
      assert.ok(peak <= HB_SLIP_CAP * 180 / Math.PI + 2 && peak >= 30, `${id} slide ${peak.toFixed(1)} deg`);
      assert.ok(drift >= 0.5, `${id}: drift points run for ${drift.toFixed(2)} s of a 1 s slide`);
      assert.ok(v.slip > 0.9, `${id}: v.slip ${v.slip.toFixed(2)} in the full slide`);
      assert.ok(minDec > 3 && maxDec < 12 && maxDec - minDec < 3, `${id}: speed bleeds ${minDec.toFixed(1)} to ${maxDec.toFixed(1)} m/s2`);
      assert.ok(counter < V.steerAngle(v.spec, v.speed, 1), `${id}: the drawn wheels steer into the slide`);
      c.steer = -1;
      for (let i = 0; i < 48; i++) stepVehicle(v, c, DT, {});
      if (v.speed > 6) assert.equal(sign(v), 1, `${id}: thumb to the left, the slide follows`);
      // Release: the slip is gone within 0.6 s and v.slip is silent again.
      Object.assign(c, { steer: 0, handbrake: false });
      for (let i = 0; i < Math.round(PLANTED.recover / DT); i++) stepVehicle(v, c, DT, {});
      assert.ok(rearSlipDeg(v) < 1 && v.slip === 0, `${id}: after the release ${rearSlipDeg(v).toFixed(2)} deg, v.slip ${v.slip}`);
    }
  });
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

test('release: the car settles straight within 0.25 s, no yaw back the other way', () => {
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

// (Task PLANTED, deliberate: the exponent at 70 mph is 1.2, was 1.8, which felt vague near the center.)
test('input shaping by speed: exponent 1 to 15 mph, 1.2 at 70; full input stays full; monotonic, no dead zone', () => {
  assert.equal(steerShapeExp(0), 1);
  assert.equal(steerShapeExp(15 / MPH), 1);
  assert.ok(Math.abs(steerShapeExp(70 / MPH) - 1.2) < 1e-9 && steerShapeExp(90 / MPH) === steerShapeExp(70 / MPH));
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
  // Presets scale it: Relaxed finer, Sharp more direct; none over 1.25.
  const at65 = (p) => arcade(() => steerShapeExp(65 / MPH), p);
  assert.ok(at65('relaxed') > at65('standard') && at65('sharp') < at65('standard') && at65('sharp') > 1);
  assert.ok(arcade(() => steerShapeExp(70 / MPH), 'relaxed') <= PLANTED.shapeExp + 1e-12);
  // Only the player's input is shaped: AI controls (no steerShape) are not.
  // (Task PLANTED, deliberate: 0.3 of input at 65 mph is 0.24 at the wheels, was under 0.15.)
  const run = (flag) => {
    const v = createVehicle('sedan', 0, 0, 0);
    v.vx = 29;
    for (let i = 0; i < 30; i++) stepVehicle(v, { steer: 0.3, throttle: 0.3, steerShape: flag }, DT, {});
    return v.steer;
  };
  assert.ok(Math.abs(run(false) - 0.3) < 1e-9 && run(true) < 0.26 && run(true) > 0.22, `ai ${run(false)}, player ${run(true)}`);
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
          // under its peak. (In town the lock is the limit.)
          if (s === 1 && u >= 15) assert.ok(v.slipF < 1, `${id} at ${u} m/s: full input keeps the front under its peak (${v.slipF.toFixed(2)})`);
        }
      }
    }
  });
});

test('the Handling lab presets keep working with the thumb driver (Relaxed, Sharp)', () => {
  for (const p of ['relaxed', 'sharp']) {
    const t = arcade(() => runAll(V, ['sedan', 'suv', 'pickup', 'sports'], true), p);
    console.log(`# thumb driver, Arcade / ${p}\n# ${formatRows(t).split('\n').join('\n# ')}`);
    for (const r of t) {
      const tag = `${p} ${r.id}`;
      assert.ok(r.right.inLane && r.left.inLane, `${tag} turns in lane`);
      for (const c of [r.c45, r.c65]) assert.ok(c.settle < LANE_CHANGE.settle && c.overshoots <= LANE_CHANGE.overshoots, `${tag} lane change ${c.settle.toFixed(2)} s, ${c.overshoots}`);
      assert.ok(r.curve.worst <= CURVE.within, `${tag} curve ${r.curve.worst.toFixed(2)}`);
      assert.ok(r.uturn.ok, `${tag} U-turn`);
      assert.ok(r.slalom.ok, `${tag} slalom`);
      assert.ok(r.slip < PLANTED.slipDeg, `${tag} planted (${r.slip.toFixed(2)} deg)`);
    }
  }
});

// The scenarios themselves are pure functions of the seed: twice is the same.
test('the thumb driver is deterministic', () => {
  const a = arcade(() => [junctionTurn(V, 'sedan', 'right').edge, laneChange(V, 'sedan', 65).settle, curve(V, 'sedan').worst, uTurn(V, 'sedan').used, slalom(V, 'sedan').min]);
  const b = arcade(() => [junctionTurn(V, 'sedan', 'right').edge, laneChange(V, 'sedan', 65).settle, curve(V, 'sedan').worst, uTurn(V, 'sedan').used, slalom(V, 'sedan').min]);
  assert.deepEqual(a, b);
});
