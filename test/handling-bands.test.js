// Handling bands and the same-in-both-modes tests of docs/REVAMP.md 6.3.
// Every number comes from src/entities/handlingbands.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VEHICLE_SPECS, createVehicle, stepVehicle, setHandlingMode, steerLock, fullLockCurvature, lateralGrip, tireCurve, handlingParams,
  brakePedal,
} from '../src/entities/vehicle.js';
import {
  MODES, LAT_G_FACTOR, LAT_TEST_SPEEDS, LOCK_TIME, RETURN_TIME, LOCK_TIME_FAST_MAX, MODE_BRAKE_DIFF,
  MODE_STRAIGHT_DIFF, BANDS, A1_LINEAR, A2_OVERSHOOT, A2_SETTLE, A3_MIRROR, A4_DRIFT, A5, B1_HALF, B2, B4_KEEP,
  ARCADE_SLIP_MAX_DEG, SAG, ASK, HB_SLIP_CAP, SQUEAL, HALF_TRAVEL, SLALOM, LAT_G_LINE, ORDINARY_CARS, BRAKE_PEDAL_S,
} from '../src/entities/handlingbands.js';
import {
  wheelCurve, steerTravel, rawFromTravel, createWheelTracker, rampSteer, tiltToSteer, tiltFilter, sliderRaw,
  TILT_DEAD_DEG,
} from '../src/core/input.js';

const DT = 1 / 60;
const G = 9.81;
const MPH = 2.23694;
const DEG = Math.PI / 180;
const W = {};
const WET = { weather: { rain: 1 } };
const IDS = Object.keys(BANDS);
const ACCURACY_CARS = ['sedan', 'sports', 'van', 'truck'];
const ctl = (o) => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, ...o });
const inMode = (mode, fn) => {
  setHandlingMode(mode);
  try { return fn(mode); } finally { setHandlingMode('arcade'); }
};
const bodySlip = (v) => {
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  return Math.atan2(-v.vx * sh + v.vz * ch, v.vx * ch + v.vz * sh);
};
const inBand = (x, [lo, hi]) => x >= lo && x <= hi;

// Hold a speed with the pedals.
function hold(v, c, u) {
  const e = u - v.speed;
  c.throttle = Math.max(0, Math.min(1, e * 0.8 + 0.15));
  c.brake = e < -0.5 ? Math.min(1, -e * 0.3) : 0;
}
function moving(id, u) {
  const v = createVehicle(id, 0, 0, 0);
  v.vx = u;
  v.speed = u;
  const c = ctl({});
  for (let i = 0; i < 60; i++) { hold(v, c, u); stepVehicle(v, c, DT, W); }
  return { v, c };
}

// ---- Straight line and walking-pace radius. ----
function t60(id) {
  const v = createVehicle(id, 0, 0, 0);
  const c = ctl({ throttle: 1 });
  for (let i = 1; i < 60 * 60; i++) {
    stepVehicle(v, c, DT, W);
    if (v.speed >= 26.82) return i * DT;
  }
  return Infinity;
}
function topMph(id) {
  const v = createVehicle(id, 0, 0, 0);
  const c = ctl({ throttle: 1 });
  let m = 0;
  for (let i = 0; i < 90 * 60; i++) { stepVehicle(v, c, DT, W); if (v.speed > m) m = v.speed; }
  return m * MPH;
}
function stopFrom(id, u0, c = ctl({ brake: 1 })) {
  const v = createVehicle(id, 0, 0, 0);
  v.vx = u0;
  v.speed = u0;
  let jerk = 0, lastA = null, lastV = u0;
  for (let i = 0; i < 1200; i++) {
    stepVehicle(v, c, DT, W);
    const a = (v.speed - lastV) / DT;
    if (lastA !== null) jerk = Math.max(jerk, Math.abs(a - lastA) / DT);
    lastA = a;
    lastV = v.speed;
    if (v.speed <= 1e-6 && i > 5) break;
  }
  return { dist: Math.hypot(v.x, v.z), side: Math.abs(v.z), turn: Math.abs(v.heading), v, jerk };
}
function r0(id) {
  const v = createVehicle(id, 0, 0, 0);
  const c = ctl({});
  for (let i = 0; i < 300; i++) { hold(v, c, 2); stepVehicle(v, c, DT, W); }
  c.steer = 1;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 60 * 30; i++) {
    hold(v, c, 2);
    stepVehicle(v, c, DT, W);
    if (i > 600) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
  }
  return (maxX - minX + maxZ - minZ) / 4;
}
// Steady lateral acceleration on full lock at a held speed, in g / spec.grip.
function latShare(id, u) {
  const { v, c } = moving(id, u);
  c.steer = 1;
  let s = 0, n = 0;
  for (let i = 0; i < 60 * 8; i++) {
    hold(v, c, u);
    stepVehicle(v, c, DT, W);
    if (i > 60 * 5) { s += v.yawRate * v.speed; n++; }
  }
  return s / n / G / v.spec.grip;
}
// Steady path curvature at a held speed and steer.
function curvature(id, u, steer, secs = 5, tail = 1.5) {
  const { v, c } = moving(id, u);
  c.steer = steer;
  let s = 0, n = 0;
  for (let i = 0; i < 60 * secs; i++) {
    hold(v, c, u);
    stepVehicle(v, c, DT, W);
    if (i >= 60 * (secs - tail)) { s += v.yawRate / v.speed; n++; }
  }
  return s / n;
}

const straight = {}; // mode -> id -> { t60, top, stop, stop30 }
function straightTable(mode) {
  if (!straight[mode]) {
    straight[mode] = inMode(mode, () => {
      const t = {};
      for (const id of IDS) t[id] = { t60: t60(id), top: topMph(id), stop: stopFrom(id, 26.82).dist, stop30: stopFrom(id, 13.41).dist };
      return t;
    });
  }
  return straight[mode];
}

test('bands: every car has a band, steering rates sit in the lock and return times', () => {
  assert.deepEqual(MODES, ['arcade', 'sim']);
  for (const id of IDS) {
    const s = VEHICLE_SPECS[id];
    assert.ok(s, `${id} spec`);
    assert.ok(inBand(1 / s.lockRate, LOCK_TIME), `${id} 1/lockRate ${(1 / s.lockRate).toFixed(3)}`);
    assert.ok(inBand(1 / s.returnRate, RETURN_TIME), `${id} 1/returnRate ${(1 / s.returnRate).toFixed(3)}`);
    assert.ok(s.steerMax > 0.3 && s.steerMax < 0.6, `${id} steerMax`);
  }
  for (const id of Object.keys(VEHICLE_SPECS)) assert.ok(BANDS[id], `${id} has a band`);
  // The Ghostwake stays 10 % above the sports car at the top.
  assert.ok(Math.abs(VEHICLE_SPECS.ghostwake.maxSpeed / VEHICLE_SPECS.sports.maxSpeed - 1.1) < 0.005);
  // The reward cars follow the 6.6 table.
  const r = VEHICLE_SPECS;
  assert.equal(r.sunchaser.power, Math.round(r.muscle.power * 1.08));
  assert.equal(r.tidewinder.power, Math.round(r.pickup.power * 1.15));
  assert.equal(r.nightheron.power, Math.round(r.sedan.power * 1.4));
  assert.deepEqual([r.sunchaser.maxSpeed, r.tidewinder.maxSpeed, r.nightheron.maxSpeed], [64, 49, 58]);
  assert.deepEqual([r.sunchaser.grip, r.tidewinder.grip, r.nightheron.grip, r.tidewinder.health], [1.05, 0.92, 1.05, 1400]);
  assert.deepEqual([r.sunchaser.body, r.tidewinder.body, r.nightheron.body], [r.muscle.body, r.pickup.body, r.sedan.body]);
});

test('bands: 0 to 60 mph, top speed and 60 to 0 mph stop for every car, both modes', () => {
  for (const mode of MODES) {
    const t = straightTable(mode);
    for (const id of IDS) {
      const b = BANDS[id], m = t[id], tag = `${mode} ${id}`;
      assert.ok(inBand(m.t60, b.t60), `${tag} 0-60 ${m.t60.toFixed(2)} s, band ${b.t60}`);
      assert.ok(inBand(m.top, b.top), `${tag} top ${m.top.toFixed(1)} mph, band ${b.top}`);
      assert.ok(inBand(m.stop, b.stop), `${tag} stop ${m.stop.toFixed(1)} m, band ${b.stop}`);
      // From 30 mph the stop is about a quarter of it (no fixed lag).
      assert.ok(m.stop30 > m.stop * 0.22 && m.stop30 < m.stop * 0.3, `${tag} 30-0 ${m.stop30.toFixed(1)} m`);
    }
  }
});

test('bands: straight line the same in both modes (0-60 and top within 3 %, stop within 5 %)', () => {
  const a = straightTable('arcade'), s = straightTable('sim');
  for (const id of IDS) {
    assert.ok(Math.abs(a[id].t60 / s[id].t60 - 1) <= MODE_STRAIGHT_DIFF, `${id} 0-60`);
    assert.ok(Math.abs(a[id].top / s[id].top - 1) <= MODE_STRAIGHT_DIFF, `${id} top`);
    assert.ok(Math.abs(a[id].stop / s[id].stop - 1) <= MODE_BRAKE_DIFF, `${id} stop`);
  }
});

test('bands: turning radius at walking pace, the same in both modes', () => {
  for (const id of IDS) {
    const ra = inMode('arcade', () => r0(id)), rs = inMode('sim', () => r0(id));
    assert.ok(inBand(ra, BANDS[id].r0), `${id} r0 ${ra.toFixed(2)} m, band ${BANDS[id].r0}`);
    assert.ok(Math.abs(ra / rs - 1) < 0.01, `${id} r0 arcade ${ra.toFixed(2)} sim ${rs.toFixed(2)}`);
    // steerMax is the true wheel angle: the kinematic radius of the center.
    const s = VEHICLE_SPECS[id], b = s.wheelBase * (s.cgFront || 0.55);
    const kin = Math.hypot(s.wheelBase / Math.tan(s.steerMax), b);
    assert.ok(Math.abs(ra / kin - 1) < 0.1, `${id} r0 ${ra.toFixed(2)} vs geometry ${kin.toFixed(2)}`);
  }
});

test('bands: steady lateral grip on full lock at 15 and 30 m/s, per mode', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of IDS) {
        const s = VEHICLE_SPECS[id];
        for (const u0 of LAT_TEST_SPEEDS) {
          const u = u0 === 30 && s.maxSpeed < 36 ? 0.8 * s.maxSpeed : u0;
          const k = latShare(id, u);
          assert.ok(inBand(k, LAT_G_FACTOR[mode]), `${mode} ${id} at ${u.toFixed(1)} m/s: ${k.toFixed(3)} x grip, band ${LAT_G_FACTOR[mode]}`);
          // K10: ordinary cars sit on the section 2 line in both modes.
          if (ORDINARY_CARS.includes(id)) {
            const g = k * s.grip;
            assert.ok(inBand(g, LAT_G_LINE), `${mode} ${id} at ${u.toFixed(1)} m/s: ${g.toFixed(3)} g, line ${LAT_G_LINE}`);
          }
        }
      }
    });
  }
  // lateralGrip is factor * spec.grip.
  inMode('sim', () => assert.ok(Math.abs(lateralGrip(VEHICLE_SPECS.sedan) / VEHICLE_SPECS.sedan.grip - handlingParams('sim').latK) < 1e-12));
});

test('bands: center to full lock and back at the wheels, the same in both modes', () => {
  const lockTime = (id, u, from, to) => {
    const { v } = moving(id, u);
    const c = ctl({ steer: from });
    for (let i = 0; i < 120; i++) stepVehicle(v, c, DT, W);
    c.steer = to;
    for (let i = 1; i < 120; i++) {
      stepVehicle(v, c, DT, W);
      if (Math.abs(v.steer - to) < 1e-3) return i * DT;
    }
    return Infinity;
  };
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of IDS) {
        for (const u of [0, 5, 10]) {
          const tl = lockTime(id, u, 0, 1), tr = lockTime(id, u, 1, 0);
          assert.ok(inBand(tl, [LOCK_TIME[0] - DT, LOCK_TIME[1]]), `${mode} ${id} at ${u}: lock ${tl.toFixed(3)} s`);
          assert.ok(inBand(tr, [RETURN_TIME[0] - DT, RETURN_TIME[1]]), `${mode} ${id} at ${u}: return ${tr.toFixed(3)} s`);
        }
        assert.ok(lockTime(id, 30, 0, 1) <= LOCK_TIME_FAST_MAX, `${mode} ${id} lock at 30 m/s`);
      }
    });
  }
});

test('A1 linear: held steer 0.25, 0.5, 0.75 at 10 m/s gives that share of the full curvature', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of ACCURACY_CARS) {
        // A short hold (1.6 s, the mean over its last 0.6 s): the truck
        // cannot hold 10 m/s on full lock for long.
        const full = curvature(id, 10, 1, 1.6, 0.6);
        for (const s of [0.25, 0.5, 0.75]) {
          const k = curvature(id, 10, s, 1.6, 0.6);
          assert.ok(Math.abs(k / (s * full) - 1) <= A1_LINEAR, `${mode} ${id} steer ${s}: ${(k / full).toFixed(3)} of full`);
        }
      }
    });
  }
});

test('A2 settle: a step to 0.5 at 20 m/s overshoots little and settles in time', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of ACCURACY_CARS) {
        const { v, c } = moving(id, 20);
        c.steer = 0.5;
        const ys = [];
        for (let i = 0; i < 60 * 3; i++) { hold(v, c, 20); stepVehicle(v, c, DT, W); ys.push(v.yawRate); }
        const fin = ys.slice(-30).reduce((a, b) => a + b, 0) / 30;
        const over = Math.max(...ys) / fin - 1;
        let last = -1;
        ys.forEach((y, i) => { if (Math.abs(y / fin - 1) > 0.05) last = i; });
        const settle = (last + 1) * DT;
        assert.ok(fin > 0.1, `${mode} ${id} turns`);
        assert.ok(over <= A2_OVERSHOOT[mode], `${mode} ${id} overshoot ${(over * 100).toFixed(1)} %`);
        assert.ok(settle <= A2_SETTLE[mode], `${mode} ${id} settles in ${settle.toFixed(2)} s`);
      }
    });
  }
});

test('A3 mirror and A4 straight: left equals right, hands off runs true', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of ACCURACY_CARS) {
        for (const s of [0.5, 1]) {
          const kr = curvature(id, 12, s, 4), kl = curvature(id, 12, -s, 4);
          assert.ok(Math.abs(-kl / kr - 1) <= A3_MIRROR, `${mode} ${id} mirror ${kr} ${kl}`);
        }
        const u = Math.min(30, VEHICLE_SPECS[id].maxSpeed * 0.9);
        const { v, c } = moving(id, u);
        const z0 = v.z;
        for (let i = 0; i < 300; i++) { hold(v, c, u); stepVehicle(v, c, DT, W); }
        assert.ok(Math.abs(v.z - z0) < A4_DRIFT, `${mode} ${id} drift ${v.z - z0}`);
      }
    });
  }
});

// A scripted driver along a reference path z(x): feedforward of the path
// curvature plus feedback on the lateral and heading error. Returns the
// steer target (share of lock, -1..1).
function pathSteer(v, z, tau = 0.1, k1 = 0.03, k2 = 0.2) {
  // Predict where the car will be in tau seconds and steer to put that
  // point on the path (look-ahead error), plus the path's own curvature.
  const u = Math.max(1, v.speed), kNow = v.yawRate / u, L = u * tau;
  const xp = v.x + L * Math.cos(v.heading);
  const zp = v.z + L * Math.sin(v.heading) + 0.5 * L * L * kNow * Math.cos(v.heading);
  const hp = v.heading + v.yawRate * tau;
  const d1 = (z(xp + 0.05) - z(xp - 0.05)) / 0.1;
  const d2 = (z(xp + 0.05) - 2 * z(xp) + z(xp - 0.05)) / 0.0025;
  const kff = d2 / Math.pow(1 + d1 * d1, 1.5);
  const k = kff + k1 * (z(xp) - zp) + k2 * (Math.atan(d1) - hp);
  return Math.max(-1, Math.min(1, k / fullLockCurvature(v.spec, v.speed)));
}

test('A5 lane change: 3.5 m in 30 m of road, settled 1.5 s after the move', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of ACCURACY_CARS) {
        const u = id === 'truck' ? A5.truckSpeed : A5.speed;
        const z = (x) => (x <= 0 ? 0 : x >= A5.road ? A5.side : A5.side * (0.5 - 0.5 * Math.cos(Math.PI * x / A5.road)));
        const v = createVehicle(id, -40, 0, 0);
        v.vx = u;
        const c = ctl({});
        let tEnd = -1, t = 0;
        while (t < 20) {
          hold(v, c, u);
          c.steer = pathSteer(v, z);
          stepVehicle(v, c, DT, W);
          t += DT;
          if (tEnd < 0 && v.x >= A5.road) tEnd = t;
          if (tEnd >= 0 && t >= tEnd + A5.after) break;
        }
        const tag = `${mode} ${id}`;
        assert.ok(Math.abs(v.z - A5.side) <= A5.endErr, `${tag} ends ${v.z.toFixed(2)} m over`);
        assert.ok(Math.abs(v.heading) <= A5.endDeg * DEG, `${tag} heading ${(v.heading / DEG).toFixed(2)} deg`);
      }
    });
  }
});

test('B1 linear brake and B2 straight stop, both modes', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of IDS) {
        const decel = (b) => {
          const { v } = moving(id, 20);
          const c = ctl({ brake: b });
          for (let i = 0; i < 18; i++) stepVehicle(v, c, DT, W); // pressure built
          const u1 = v.speed;
          for (let i = 0; i < 12; i++) stepVehicle(v, c, DT, W);
          return (u1 - v.speed) / (12 * DT);
        };
        const k = decel(0.5) / decel(1);
        assert.ok(inBand(k, B1_HALF), `${mode} ${id} half brake gives ${(k * 100).toFixed(1)} %`);
        const s = stopFrom(id, 26.82);
        assert.ok(s.turn < B2.deg * DEG && s.side < B2.side, `${mode} ${id} straight stop ${s.turn} ${s.side}`);
        // ABS works in both modes: a full stop in the rain never locks up.
        const v = createVehicle(id, 0, 0, 0);
        v.vx = 20;
        let absSeen = false;
        for (let i = 0; i < 60; i++) {
          stepVehicle(v, ctl({ brake: 1 }), DT, WET);
          absSeen = absSeen || v.abs;
          assert.ok(Math.abs(bodySlip(v)) < 0.01, `${mode} ${id} no skid`);
        }
        assert.ok(absSeen, `${mode} ${id} ABS in the wet`);
      }
    });
  }
});

test('B3 no creep after a stop, then reverse as before; brakes come on and off smoothly', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of IDS) {
        const v = createVehicle(id, 0, 0, 0);
        v.vx = 15;
        v.speed = 15;
        const c = ctl({ brake: 1 });
        let i = 0;
        while (v.speed > 0 && i++ < 600) stepVehicle(v, c, DT, W);
        const x0 = v.x;
        for (let k = 0; k < 24; k++) stepVehicle(v, c, DT, W); // 0.4 s held
        assert.ok(Math.abs(v.x - x0) < 0.01 && v.speed === 0, `${mode} ${id} crept ${(v.x - x0).toFixed(3)} m`);
        // Keep holding: reverse engages (the old rule, after the short hold).
        for (let k = 0; k < 120; k++) stepVehicle(v, c, DT, W);
        assert.ok(v.speed < -0.5 && v.gear === 0, `${mode} ${id} reverses (${v.speed.toFixed(2)})`);
        // From rest, holding the brake reverses at once as before.
        const r = createVehicle(id, 0, 0, 0);
        for (let k = 0; k < 30; k++) stepVehicle(r, c, DT, W);
        assert.ok(r.speed < 0, `${mode} ${id} reverse from rest`);
      }
      // No jolt at the stop: jerk stays under 60 m/s^3 at 1/60 s steps.
      for (const id of ACCURACY_CARS) {
        const s = stopFrom(id, 13.41);
        assert.ok(s.jerk < 600, `${mode} ${id} jerk ${s.jerk.toFixed(0)}`);
      }
    });
  }
});

test('B4 turn-in under brake keeps at least 60 % of the curvature', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of IDS) {
        const turn = (brake) => {
          const { v } = moving(id, 20);
          const c = ctl({ steer: 0.5, brake });
          let s = 0, n = 0;
          for (let i = 0; i < 60; i++) {
            stepVehicle(v, c, DT, W);
            if (i >= 30) { s += v.yawRate / Math.max(1, v.speed); n++; }
          }
          return s / n;
        };
        const k = turn(0.6) / turn(0);
        assert.ok(k >= B4_KEEP, `${mode} ${id} keeps ${(k * 100).toFixed(0)} % of the turn under brake`);
      }
    });
  }
});

test('mode rows: tire sag, steering ask, squeal onset, assists', () => {
  for (const mode of MODES) {
    const p = handlingParams(mode);
    inMode(mode, () => {
      const sag = 1 - tireCurve(8);
      assert.ok(inBand(sag, SAG[mode]), `${mode} sag ${sag.toFixed(3)}`);
      assert.ok(Math.abs(tireCurve(1) - 1) < 1e-12 && tireCurve(-1) === -tireCurve(1));
    });
    assert.equal(p.ask, ASK[mode]);
    assert.equal(p.squeal, SQUEAL[mode]);
  }
  // Only the listed rows differ.
  const a = handlingParams('arcade'), s = handlingParams('sim');
  assert.deepEqual(Object.keys(a).sort(), Object.keys(s).sort());
  assert.equal(a.transfer, 0.5);
  assert.equal(s.transfer, 1);
  assert.ok(a.assist && a.tc && a.hbCap && a.hbBeta === HB_SLIP_CAP);
  assert.ok(!s.assist && !s.tc && !s.hbCap);
});

test('Arcade: stability and traction hold the body slip; Sim lets a rear-drive car step out', () => {
  const powerSlide = (id) => {
    const { v } = moving(id, 15);
    let maxBeta = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepVehicle(v, ctl({ steer: 1, throttle: 1 }), DT, W);
      maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
    }
    return maxBeta / DEG;
  };
  inMode('arcade', () => {
    for (const id of IDS) {
      const lim = VEHICLE_SPECS[id].drive === 'rwd' ? ARCADE_SLIP_MAX_DEG.rwd : ARCADE_SLIP_MAX_DEG.fwd;
      const b = powerSlide(id);
      assert.ok(b < lim, `arcade ${id} body slip ${b.toFixed(1)} deg`);
    }
  });
  const arcadeMuscle = inMode('arcade', () => powerSlide('muscle'));
  const simMuscle = inMode('sim', () => powerSlide('muscle'));
  assert.ok(simMuscle > arcadeMuscle + 4, `sim muscle steps out ${simMuscle.toFixed(1)} vs ${arcadeMuscle.toFixed(1)}`);
});

test('handbrake: Arcade caps the slide and recovers by itself; Sim holds it while held', () => {
  const slide = (mode, id) => inMode(mode, () => {
    const { v } = moving(id, 20);
    let maxBeta = 0;
    for (let i = 0; i < 90; i++) {
      stepVehicle(v, ctl({ steer: 1, handbrake: true }), DT, W);
      maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
    }
    const endBeta = Math.abs(bodySlip(v));
    let recovered = -1;
    for (let i = 0; i < 240; i++) {
      stepVehicle(v, ctl({ throttle: 0.3 }), DT, W);
      if (recovered < 0 && Math.abs(bodySlip(v)) < 3 * DEG && Math.abs(v.yawRate) < 0.1) recovered = (i + 1) * DT;
    }
    return { maxBeta, endBeta, recovered, slip: v.slip };
  });
  for (const id of ['sedan', 'sports', 'muscle']) {
    const a = slide('arcade', id), s = slide('sim', id);
    assert.ok(a.maxBeta > 20 * DEG && a.maxBeta < HB_SLIP_CAP + 0.08, `arcade ${id} slide ${(a.maxBeta / DEG).toFixed(1)} deg`);
    assert.ok(a.recovered > 0 && a.recovered < 2, `arcade ${id} recovers in ${a.recovered.toFixed(2)} s`);
    assert.ok(s.maxBeta > a.maxBeta, `sim ${id} slides further (${(s.maxBeta / DEG).toFixed(1)} deg)`);
  }
});

// ---- Steering styles and the slalom. ----

test('touch curve: half travel gives 40 to 55 % of lock for every style', () => {
  for (const st of ['wheel', 'slider', 'tilt']) {
    const half = steerTravel(st) / 2;
    const raw = st === 'tilt' ? tiltToSteer(TILT_DEAD_DEG + half) : rawFromTravel(st, half);
    assert.ok(Math.abs(raw - 0.5) < 1e-9, `${st} half travel raw ${raw}`);
    assert.ok(inBand(wheelCurve(raw), HALF_TRAVEL), `${st} target ${wheelCurve(raw)}`);
  }
  assert.ok(Math.abs(wheelCurve(0.5) - 0.44375) < 1e-12);
});

// Inverse of wheelCurve (bisection, test only).
function invCurve(t) {
  let lo = -1, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (wheelCurve(m) < t) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

// Slalom: cones on the x axis 18 m apart, passed on alternate sides
// (first on the +z side). The scripted driver follows a weave of
// amplitude `amp` through the style's own input, rate limited like a
// thumb or a phone. Returns the car center's side offset at each cone.
// One driver for every style (the contract rule, K9): preview time,
// lateral and heading gains and the weave amplitude asked for are the
// same; only the input device and its rate limit differ.
const SLALOM_DRIVER = [0.3, 0.13, 0.1, 0.7];
function slalom(id, u, style) {
  const [tau, k1, k2, amp] = SLALOM_DRIVER;
  const GAP = SLALOM.gap, N = SLALOM.cones, Wk = Math.PI / GAP;
  const env = (x) => (x <= 0 ? 0 : x >= GAP ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x / GAP));
  const z = (x) => (x > GAP * (N + 1) ? 0 : amp * env(x) * Math.cos(Wk * (x - GAP)));
  const v = createVehicle(id, -30, 0, 0);
  v.vx = u;
  const c = ctl({});
  const wheel = createWheelTracker();
  const R = 60; // px from the wheel center
  wheel.down(R, 0, 0, 0);
  let thumb = 0, roll = 0, rollF = 0, px = 0, btn = 0;
  const offs = [];
  let next = 1, minSp = Infinity;
  for (let i = 0; i < 60 * 12 && next <= N; i++) {
    hold(v, c, u);
    const want = pathSteer(v, z, tau, k1, k2);
    if (style === 'wheel') {
      const step = SLALOM.thumbDegPerS * DT;
      thumb += Math.max(-step, Math.min(step, invCurve(want) * steerTravel('wheel') - thumb));
      wheel.move(R * Math.cos(thumb * DEG), R * Math.sin(thumb * DEG));
      c.steer = wheel.target();
    } else if (style === 'slider') {
      const step = SLALOM.sliderPxPerS * DT;
      px += Math.max(-step, Math.min(step, invCurve(want) * steerTravel('slider') - px));
      c.steer = wheelCurve(sliderRaw(500 + px, 500));
    } else if (style === 'tilt') {
      const r = invCurve(want);
      const goal = r === 0 ? 0 : Math.sign(r) * (TILT_DEAD_DEG + Math.abs(r) * steerTravel('tilt'));
      const step = SLALOM.tiltDegPerS * DT;
      roll += Math.max(-step, Math.min(step, goal - roll));
      rollF = tiltFilter(rollF, roll, DT);
      c.steer = wheelCurve(tiltToSteer(rollF));
    } else {
      // Buttons: press toward the side wanted, release near the middle.
      const press = want > btn + 0.08 ? 1 : want < btn - 0.08 ? -1 : 0;
      btn = press === 0 ? (Math.abs(want) < 0.15 ? 0 : btn) : rampSteer(btn, press, DT);
      c.steer = btn;
    }
    const x0 = v.x;
    stepVehicle(v, c, DT, W);
    minSp = Math.min(minSp, v.speed);
    if (x0 < GAP * next && v.x >= GAP * next) {
      offs.push(v.z * (next % 2 ? 1 : -1));
      next++;
    }
  }
  return { offs, minSp };
}
// SLALOM.clear (m): the car's center passes each cone on its own side by
// at least this much (docs/REVAMP.md 6.3, the slalom pass rule). Full body
// clearance (half the width) is out of reach within the contract's lock
// and return times: at 20 m/s an 18 m weave gives 0.9 s per side, of which
// about 0.55 s goes on moving the wheel from one lock to the other.

test('slalom: every style weaves through six cones 18 m apart (Arcade 20 m/s, Sim 17 m/s)', () => {
  for (const style of ['wheel', 'buttons', 'tilt', 'slider']) {
    for (const [mode, u] of [['arcade', SLALOM.speed], ['sim', SLALOM.simSpeed]]) {
      const r = inMode(mode, () => slalom('sedan', u, style));
      const tag = `${style} ${mode} at ${u}`;
      assert.equal(r.offs.length, SLALOM.cones, `${tag} reached every cone`);
      for (const o of r.offs) assert.ok(o >= SLALOM.clear, `${tag}: cones ${r.offs.map((x) => x.toFixed(2)).join(' ')}`);
      assert.ok(r.minSp > u * SLALOM.keep, `${tag} kept its speed (${r.minSp.toFixed(1)})`);
    }
  }
});

test('buttons: hold reaches full lock at the wheels in 0.25 to 0.40 s, a tap peaks at 0.25 to 0.40', () => {
  for (const id of IDS) {
    const { v } = moving(id, 5);
    let target = 0, t = 0;
    while (t < 1) {
      target = rampSteer(target, 1, DT);
      stepVehicle(v, ctl({ steer: target }), DT, W);
      t += DT;
      if (v.steerAngle / steerLock(v.spec, v.speed) > 0.999) break;
    }
    assert.ok(inBand(t, LOCK_TIME), `${id} button hold to full lock ${t.toFixed(3)} s`);
    const w = moving(id, 5).v;
    target = 0;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      target = i < 6 ? rampSteer(target, 1, DT) : rampSteer(target, 0, DT);
      stepVehicle(w, ctl({ steer: target }), DT, W);
      peak = Math.max(peak, w.steerAngle / steerLock(w.spec, w.speed));
    }
    assert.ok(inBand(peak, [0.25, 0.4]), `${id} 0.10 s tap peaks at ${peak.toFixed(3)}`);
  }
});

// ---- Boost on (src/entities/boost.js): the BOOST button adds engine force and
// a higher redline; grip, steering and brakes must stay as above. ----
const BOOST_CTL = { boost: true };
// One step with the meter held full so a long test never runs dry.
const stepBoosted = (v, c) => { v.boostMeter = 1; v.boostLock = false; stepVehicle(v, c, DT, W); };
// A car cruising at u with BOOST held (throttle only, so the boost gate stays open).
function movingBoosted(id, u) {
  const v = createVehicle(id, 0, 0, 0);
  v.vx = u;
  v.speed = u;
  const c = ctl({ ...BOOST_CTL });
  for (let i = 0; i < 90; i++) { holdThrottle(v, c, u); stepBoosted(v, c); }
  return { v, c };
}
function holdThrottle(v, c, u) {
  c.throttle = Math.max(0, Math.min(1, (u - v.speed) * 0.8 + 0.15));
}
function stopFromBoosted(id, level, c) {
  const v = createVehicle(id, 0, 0, 0);
  v.vx = 26.82;
  v.speed = 26.82;
  v.boostLevel = level; // the redline is still raised: the worst case for the brake
  v.boostMeter = 0.4;
  for (let i = 0; i < 1200; i++) {
    stepVehicle(v, c, DT, W);
    if (v.speed <= 1e-6 && i > 5) break;
  }
  return { dist: Math.hypot(v.x, v.z), side: Math.abs(v.z), turn: Math.abs(v.heading) };
}

test('boost: 60 to 0 stop with boost released (or the button still held) stays in band and matches the plain stop', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of IDS) {
        const plain = stopFrom(id, 26.82).dist;
        for (const [name, c] of [['released', ctl({ brake: 1 })], ['held', ctl({ brake: 1, boost: true })]]) {
          const m = stopFromBoosted(id, 1, c);
          assert.ok(inBand(m.dist, BANDS[id].stop), `${mode} ${id} boost ${name}: stop ${m.dist.toFixed(2)} m, band ${BANDS[id].stop}`);
          assert.ok(Math.abs(m.dist / plain - 1) <= 0.01, `${mode} ${id} boost ${name}: ${m.dist.toFixed(2)} m vs plain ${plain.toFixed(2)} m`);
          assert.ok(m.turn <= B2.deg * DEG && m.side <= B2.side, `${mode} ${id} boost ${name}: turn ${(m.turn / DEG).toFixed(2)} deg, side ${m.side.toFixed(2)} m`);
        }
      }
    });
  }
});

test('boost: steady lateral grip on full lock is unchanged with boost held', () => {
  for (const id of ACCURACY_CARS) {
    const u = Math.min(20, VEHICLE_SPECS[id].maxSpeed * 0.6);
    const share = (boosted) => {
      const { v, c } = boosted ? movingBoosted(id, u) : moving(id, u);
      c.steer = 1;
      let s = 0, n = 0;
      for (let i = 0; i < 60 * 4; i++) {
        if (boosted) { holdThrottle(v, c, u); stepBoosted(v, c); } else { hold(v, c, u); stepVehicle(v, c, DT, W); }
        if (i > 60 * 2.5) { s += v.yawRate * v.speed; n++; }
      }
      return s / n / G / v.spec.grip;
    };
    const k0 = share(false), k1 = share(true);
    assert.ok(inBand(k1, LAT_G_FACTOR.arcade), `${id} boosted lateral grip ${k1.toFixed(3)} x grip`);
    assert.ok(Math.abs(k1 / k0 - 1) <= 0.03, `${id} lateral grip ${k1.toFixed(3)} boosted vs ${k0.toFixed(3)} plain`);
  }
});

test('boost: A1 linear steering and the A5 lane change stay accurate with boost held', () => {
  for (const id of ACCURACY_CARS) {
    const curv = (s) => {
      const { v, c } = movingBoosted(id, 10);
      c.steer = s;
      let sum = 0, n = 0;
      for (let i = 0; i < 96; i++) {
        holdThrottle(v, c, 10);
        stepBoosted(v, c);
        if (i >= 60) { sum += v.yawRate / v.speed; n++; }
      }
      return sum / n;
    };
    const full = curv(1);
    for (const s of [0.25, 0.5, 0.75]) {
      const k = curv(s);
      assert.ok(Math.abs(k / (s * full) - 1) <= A1_LINEAR, `${id} boosted steer ${s}: ${(k / full).toFixed(3)} of full`);
    }
    const u = id === 'truck' ? A5.truckSpeed : A5.speed;
    const z = (x) => (x <= 0 ? 0 : x >= A5.road ? A5.side : A5.side * (0.5 - 0.5 * Math.cos(Math.PI * x / A5.road)));
    const v = createVehicle(id, -40, 0, 0);
    v.vx = u;
    const c = ctl({ ...BOOST_CTL });
    let tEnd = -1, t = 0;
    while (t < 20) {
      holdThrottle(v, c, u);
      c.steer = pathSteer(v, z);
      stepBoosted(v, c);
      t += DT;
      if (tEnd < 0 && v.x >= A5.road) tEnd = t;
      if (tEnd >= 0 && t >= tEnd + A5.after) break;
    }
    assert.ok(Math.abs(v.z - A5.side) <= A5.endErr, `${id} boosted lane change ends ${v.z.toFixed(2)} m over`);
    assert.ok(Math.abs(v.heading) <= A5.endDeg * DEG, `${id} boosted lane change heading ${(v.heading / DEG).toFixed(2)} deg`);
  }
});

test('boost: hands off at speed with boost held runs straight (A4)', () => {
  for (const id of ACCURACY_CARS) {
    const u = Math.min(30, VEHICLE_SPECS[id].maxSpeed * 0.7);
    const { v, c } = movingBoosted(id, u);
    const z0 = v.z;
    for (let i = 0; i < 300; i++) { holdThrottle(v, c, u); stepBoosted(v, c); }
    assert.ok(Math.abs(v.z - z0) < A4_DRIFT, `${id} boosted drift ${v.z - z0}`);
  }
});

// ---- K11 and the owner's accuracy checks (H1). ----

test('brake pedal S-curve (PEDAL_S = 1.0) is pinned: it replaces the traffic brake gain scale', () => {
  const S = BRAKE_PEDAL_S;
  assert.equal(S, 1.0);
  for (let i = 0; i <= 100; i++) {
    const p = i / 100;
    const want = p + S * p * (1 - p) * (1 - 2 * p);
    assert.ok(Math.abs(brakePedal(p) - want) < 1e-12, `pedal ${p}: ${brakePedal(p)} vs ${want}`);
    // Point symmetric about half pedal: firmer in the first half, softer in the second.
    assert.ok(Math.abs(brakePedal(p) + brakePedal(1 - p) - 1) < 1e-12, `symmetry at ${p}`);
  }
  assert.ok(Math.abs(brakePedal(0.25) - 0.34375) < 1e-12);
  assert.ok(Math.abs(brakePedal(0.75) - 0.65625) < 1e-12);
  assert.ok(Math.abs(brakePedal(0.1) - 0.172) < 1e-12);
  assert.equal(brakePedal(0.5), 0.5);
  assert.equal(brakePedal(-1), 0);
  assert.equal(brakePedal(3), 1);
  // Slope 1 + S at the top of the pedal travel, 1 - S / 2 at half: still rising.
  const e = 1e-6;
  assert.ok(Math.abs(brakePedal(e) / e - (1 + S)) < 1e-4, 'slope at 0');
  assert.ok(Math.abs((brakePedal(0.5 + e) - brakePedal(0.5 - e)) / (2 * e) - (1 - S / 2)) < 1e-6, 'slope at half');
});

test('owner check: 60 to 0 mph on dry ground is the same distance in Arcade and Sim', () => {
  const a = straightTable('arcade'), s = straightTable('sim');
  for (const id of IDS) {
    assert.ok(Math.abs(a[id].stop / s[id].stop - 1) <= 0.001, `${id} stop arcade ${a[id].stop.toFixed(3)} m, sim ${s[id].stop.toFixed(3)} m`);
  }
});

test('owner check: steering at the wheel center is near linear, at the curve and at the car', () => {
  // The touch curve: within 1.2 % of its center slope over the first quarter of the travel.
  for (let i = 1; i <= 25; i++) {
    const x = i / 100;
    assert.ok(Math.abs(wheelCurve(x) / (0.85 * x) - 1) <= 0.012, `wheelCurve(${x}) ${wheelCurve(x)}`);
  }
  // At the car: thumb degrees on the wheel to path curvature at 10 m/s, both
  // modes. Curvature per degree at 10, 20 and 30 degrees stays within 5 % of
  // its value at 5 degrees (the A1 linear steering through the touch curve).
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of ACCURACY_CARS) {
        const per = (deg) => curvature(id, 10, wheelCurve(rawFromTravel('wheel', deg)), 3, 1) / deg;
        const k5 = per(5);
        assert.ok(k5 > 0, `${mode} ${id} turns`);
        for (const deg of [10, 20, 30]) {
          const r = per(deg) / k5;
          assert.ok(Math.abs(r - 1) <= 0.05, `${mode} ${id} ${deg} deg: ${(r * 100).toFixed(1)} % of the 5 deg rate`);
        }
      }
    });
  }
});
