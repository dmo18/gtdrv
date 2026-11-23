// Service vehicles (docs/REVAMP.md 6.11, tests SV-H1 to SV-M1): specs in
// their handling bands, siren and light bars, the four extras changing the
// world in fixed steps, the parking list on the Miami city, the traffic
// share, and the meshes' triangle bands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  VEHICLE_SPECS, createVehicle, stepVehicle, setHandlingMode, fullLockCurvature,
} from '../src/entities/vehicle.js';
import {
  MODES, LAT_SHARE, arcadeFactor, LOCK_TIME, RETURN_TIME, LOCK_TIME_FAST_MAX, BANDS, A1_LINEAR, A2_OVERSHOOT, A2_SETTLE,
  A3_MIRROR, A4_DRIFT, A5, B1_HALF, B2, B4_KEEP, REFERENCE, curbCircleFt,
} from '../src/entities/handlingbands.js';
import {
  SERVICE_SPECS, SERVICE_BANDS, SERVICE_IDS, LIGHTBARS, SIRENS, EXTRAS, SERVICE_SPOTS, SPOT_RULES, TRAFFIC_SHARES,
  TRAFFIC_RULES, lightbarPhase, pickTrafficService, onCallDraw, specSiren,
} from '../src/entities/servicevehicles.js';
import { createService, checkSpot, roadDistances, nearestRoad, serviceHash, svcState } from '../src/systems/service.js';
import { createPolice } from '../src/systems/police.js';
import { initActor, addActor } from '../src/systems/combat.js';
import { createInput } from '../src/core/input.js';
import { createRng } from '../src/core/rng.js';
import { createParts } from '../src/render/carparts.js';
import { hasSiren, isSirenCar } from '../src/core/yield.js';
import { makeFightGame, yard, cityAndCollision } from './fightgame.js';

const DT = 1 / 60;
const G = 9.81;
const MPH = 2.23694;
const DEG = Math.PI / 180;
const W = {};
const FOUR = ['ambulance', 'towtruck', 'firetruck', 'garbage'];
const ctl = (o) => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, ...o });
const inBand = (x, [lo, hi]) => x >= lo && x <= hi;
const inMode = (mode, fn) => {
  setHandlingMode(mode);
  try { return fn(mode); } finally { setHandlingMode('arcade'); }
};

// ---- the handling-band measures of test/handling-bands.test.js ----
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
function tTo(id, target, pre = null) {
  const v = createVehicle(id, 0, 0, 0);
  const c = ctl({ throttle: 1 });
  for (let i = 1; i < 60 * 80; i++) {
    stepVehicle(v, c, DT, W);
    if (pre) pre(v);
    if (v.speed >= target) return i * DT;
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
function stopFrom(id, u0) {
  const v = createVehicle(id, 0, 0, 0);
  v.vx = u0;
  v.speed = u0;
  for (let i = 0; i < 1200; i++) {
    stepVehicle(v, ctl({ brake: 1 }), DT, W);
    if (v.speed <= 1e-6 && i > 5) break;
  }
  return { dist: Math.hypot(v.x, v.z), side: Math.abs(v.z), turn: Math.abs(v.heading) };
}
function r0(id) {
  const v = createVehicle(id, 0, 0, 0);
  const c = ctl({});
  for (let i = 0; i < 300; i++) { hold(v, c, 2); stepVehicle(v, c, DT, W); }
  c.steer = 1;
  let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity;
  for (let i = 0; i < 60 * 30; i++) {
    hold(v, c, 2);
    stepVehicle(v, c, DT, W);
    if (i > 600) { a = Math.min(a, v.x); b = Math.max(b, v.x); d = Math.min(d, v.z); e = Math.max(e, v.z); }
  }
  return (b - a + e - d) / 4;
}
// HANDLE (deliberate, as test/handling-bands.test.js): settled from 2 to 4 s
// after the turn-in (was 5 to 8 s), while the heavy trucks still hold the
// speed against the scrub of a front pushed past its limit (full input now
// asks 115 % of the grip, docs/PLAN_V3.md 2.4 item 4).
function latShare(id, u) {
  const { v, c } = moving(id, u);
  c.steer = 1;
  let s = 0, n = 0;
  for (let i = 0; i < 60 * 4; i++) {
    hold(v, c, u);
    stepVehicle(v, c, DT, W);
    if (i >= 120) { s += v.yawRate * v.speed; n++; }
  }
  return s / n / G / v.spec.grip;
}
// atSpeed: report lateral acceleration / atSpeed^2 (the curvature at that held speed).
function curvature(id, u, steer, secs = 5, tail = 1.5, atSpeed = 0) {
  const { v, c } = moving(id, u);
  c.steer = steer;
  let s = 0, n = 0;
  for (let i = 0; i < 60 * secs; i++) {
    hold(v, c, u);
    stepVehicle(v, c, DT, W);
    if (i >= 60 * (secs - tail)) { s += atSpeed ? v.yawRate * v.speed / (atSpeed * atSpeed) : v.yawRate / v.speed; n++; }
  }
  return s / n;
}
function pathSteer(v, z, tau = 0.1, k1 = 0.03, k2 = 0.2) {
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

test('SV-H1: each service spec measures inside its band in both modes; police keeps its own row', () => {
  for (const id of FOUR) assert.deepEqual(BANDS[id], SERVICE_BANDS[id], `${id} band merged`);
  // HANDLE (deliberate): the police row is now the reference table's (PLAN_V3 2.4):
  // 40 ft curb to curb, 0-60 in 6.0 s and 60-0 in 125 ft within 5 / 8 / 8 %, top as before.
  assert.deepEqual(REFERENCE.police, { wb: 2.95, circle: 40, grip: 0.88, t60: 6.0, stop: 125, roll: 4 });
  assert.deepEqual(BANDS.police.top, [130, 140]);
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of [...FOUR, 'police']) {
        const b = BANDS[id], tag = `${mode} ${id}`;
        const t60 = tTo(id, 26.82), top = topMph(id), stop = stopFrom(id, 26.82).dist, r = r0(id);
        assert.ok(inBand(t60, b.t60), `${tag} 0-60 ${t60.toFixed(2)} band ${b.t60}`);
        assert.ok(inBand(top, b.top), `${tag} top ${top.toFixed(1)} band ${b.top}`);
        assert.ok(inBand(stop, b.stop), `${tag} stop ${stop.toFixed(1)} band ${b.stop}`);
        // (Task PLANTED, deliberate: the police sedan's 40 ft circle is Sim's; in
        // Arcade it cuts 40 degrees like every car, about 35 ft. The four
        // service trucks are over 3000 kg and keep their own lock in both modes.)
        if (b.circle && mode === 'arcade') assert.ok(inBand(curbCircleFt(VEHICLE_SPECS[id], r), [33, 36]), `${tag} circle ${curbCircleFt(VEHICLE_SPECS[id], r).toFixed(1)} ft`);
        else if (b.circle) assert.ok(inBand(curbCircleFt(VEHICLE_SPECS[id], r), b.circle), `${tag} circle ${curbCircleFt(VEHICLE_SPECS[id], r).toFixed(1)} ft band ${b.circle}`);
        else assert.ok(inBand(r, b.r0), `${tag} r0 ${r.toFixed(2)} band ${b.r0}`);
      }
    });
  }
  // The 6.11 table: sizes, masses, steering and top speed as written.
  const T = { ambulance: [6.2, 2.2, 2.8, 3.7, 4200, 0.80, 0.46, 42.5, 1600, 0.38], towtruck: [6.8, 2.3, 2.6, 4.0, 5200, 0.76, 0.45, 38.0, 1800, 0.45],
    firetruck: [9.0, 2.5, 3.3, 5.0, 14000, 0.68, 0.42, 30.0, 2600, 0.52], garbage: [8.2, 2.5, 3.5, 4.6, 12000, 0.66, 0.43, 29.5, 2400, 0.52] };
  for (const id of FOUR) {
    const s = SERVICE_SPECS[id];
    assert.deepEqual([s.length, s.width, s.height, s.wheelBase, s.mass, s.grip, s.steerMax, s.maxSpeed, s.health, s.wheelRadius], T[id], id);
    assert.equal(s.drive, 'rwd');
    assert.equal(VEHICLE_SPECS[id], s, `${id} merged into VEHICLE_SPECS`);
  }
});

test('SV-H2: lateral grip at both test speeds, lock and return times', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of FOUR) {
        const s = VEHICLE_SPECS[id];
        for (const u0 of [15, 30]) {
          const u = u0 === 30 && s.maxSpeed < 36 ? 0.8 * s.maxSpeed : u0;
          const k = latShare(id, u);
          // HANDLE: on the mode's grip curve (Arcade 1.25 to 1.1 of spec.grip by speed, Sim 1).
          // (Task PLANTED: the Arcade curve is 1.6 to 1.25 now; the service vehicles keep 5/12 of its gain, 1.25 to 1.10 as before.)
          const f = mode === 'arcade' ? arcadeFactor(u, VEHICLE_SPECS[id]) : 1;
          assert.ok(inBand(k / f, LAT_SHARE), `${mode} ${id} at ${u.toFixed(1)}: ${(k / f).toFixed(3)} of the curve x grip`);
        }
        assert.ok(inBand(1 / s.lockRate, LOCK_TIME) && 1 / s.lockRate >= 0.355, `${id} lock ${(1 / s.lockRate).toFixed(3)}`);
        assert.ok(inBand(1 / s.returnRate, RETURN_TIME), `${id} return`);
        const { v } = moving(id, 30);
        const c = ctl({ steer: 1 });
        let t = 0;
        for (let i = 1; i < 120 && Math.abs(v.steer - 1) >= 1e-3; i++) { stepVehicle(v, c, DT, W); t = i * DT; }
        assert.ok(t <= LOCK_TIME_FAST_MAX, `${mode} ${id} lock at 30 m/s ${t.toFixed(2)}`);
      }
    });
  }
});

test('SV-H3: steering A1 to A5 and braking B1 to B4 for all four; no wheel unloads on full lock', () => {
  for (const mode of MODES) {
    inMode(mode, () => {
      for (const id of FOUR) {
        const tag = `${mode} ${id}`;
        // A1 linear. (HANDLE, deliberate: the curvature at the held 10 m/s,
        // lateral acceleration over 10^2. On full lock in Arcade's town grip
        // these heavy trucks scrub off a little speed, and the path curvature
        // of a slower car at the same grip is not the steering's share.)
        const full = curvature(id, 10, 1, 1.6, 0.6, 10);
        for (const s of [0.25, 0.5, 0.75]) {
          const k = curvature(id, 10, s, 1.6, 0.6, 10);
          assert.ok(Math.abs(k / (s * full) - 1) <= A1_LINEAR, `${tag} A1 ${s}: ${(k / full).toFixed(3)}`);
        }
        // A2 settle.
        {
          const { v, c } = moving(id, 20);
          c.steer = 0.5;
          const ys = [];
          for (let i = 0; i < 180; i++) { hold(v, c, 20); stepVehicle(v, c, DT, W); ys.push(v.yawRate); }
          const fin = ys.slice(-30).reduce((a, b) => a + b, 0) / 30;
          let last = -1;
          ys.forEach((y, i) => { if (Math.abs(y / fin - 1) > 0.05) last = i; });
          assert.ok(Math.max(...ys) / fin - 1 <= A2_OVERSHOOT[mode], `${tag} A2 overshoot`);
          assert.ok((last + 1) * DT <= A2_SETTLE[mode], `${tag} A2 settle ${((last + 1) * DT).toFixed(2)}`);
        }
        // A3 mirror, A4 straight.
        for (const s of [0.5, 1]) {
          const kr = curvature(id, 12, s, 4), kl = curvature(id, 12, -s, 4);
          assert.ok(Math.abs(-kl / kr - 1) <= A3_MIRROR, `${tag} A3`);
        }
        {
          const u = Math.min(30, VEHICLE_SPECS[id].maxSpeed * 0.9);
          const { v, c } = moving(id, u);
          const z0 = v.z;
          for (let i = 0; i < 300; i++) { hold(v, c, u); stepVehicle(v, c, DT, W); }
          assert.ok(Math.abs(v.z - z0) < A4_DRIFT, `${tag} A4`);
        }
        // A5 lane change: 15 m/s for the fire and garbage trucks, 20 for the others.
        {
          const u = id === 'firetruck' || id === 'garbage' ? A5.truckSpeed : A5.speed;
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
          assert.ok(Math.abs(v.z - A5.side) <= A5.endErr, `${tag} A5 ends ${v.z.toFixed(2)}`);
          assert.ok(Math.abs(v.heading) <= A5.endDeg * DEG, `${tag} A5 heading`);
        }
        // B1 linear brake, B2 straight stop.
        const decel = (b) => {
          const { v } = moving(id, 20);
          const c = ctl({ brake: b });
          for (let i = 0; i < 18; i++) stepVehicle(v, c, DT, W);
          const u1 = v.speed;
          for (let i = 0; i < 12; i++) stepVehicle(v, c, DT, W);
          return (u1 - v.speed) / (12 * DT);
        };
        assert.ok(inBand(decel(0.5) / decel(1), B1_HALF), `${tag} B1`);
        const st = stopFrom(id, 26.82);
        assert.ok(st.turn < B2.deg * DEG && st.side < B2.side, `${tag} B2`);
        // B3 no creep after a stop.
        {
          const v = createVehicle(id, 0, 0, 0);
          v.vx = 15;
          v.speed = 15;
          const c = ctl({ brake: 1 });
          let i = 0;
          while (v.speed > 0 && i++ < 600) stepVehicle(v, c, DT, W);
          const x0 = v.x;
          for (let k = 0; k < 24; k++) stepVehicle(v, c, DT, W);
          assert.ok(Math.abs(v.x - x0) < 0.01, `${tag} B3`);
        }
        // B4 turn-in under brake.
        const turn = (brake) => {
          const { v } = moving(id, 20);
          const c = ctl({ steer: 0.5, brake });
          let s = 0, n = 0;
          for (let i = 0; i < 60; i++) { stepVehicle(v, c, DT, W); if (i >= 30) { s += v.yawRate / Math.max(1, v.speed); n++; } }
          return s / n;
        };
        assert.ok(turn(0.6) / turn(0) >= B4_KEEP, `${tag} B4`);
      }
    });
  }
  // A tall body does not roll over: on full lock at 0.8 x top speed in
  // Arcade, the inner wheels keep load (lateral transfer m a h / track).
  for (const id of FOUR) {
    const s = VEHICLE_SPECS[id];
    const g = latShare(id, 0.8 * s.maxSpeed) * s.grip;
    const h = s.height * 0.36, track = s.width - 0.4;
    const inner = 0.5 - g * h / track;
    assert.ok(inner > 0, `${id} inner wheel load share ${inner.toFixed(3)} at ${g.toFixed(2)} g`);
  }
});

// ---- a small game on a flat yard: vehicles, actors, combat, service ----
function svcGame({ seed = 1, mortal = false, spots = [] } = {}) {
  const { city, collision } = yard();
  const game = makeFightGame({ seed, city, collision });
  game.input = createInput();
  game.progress.settings.mortal = mortal;
  game.events.log = [];
  const emit0 = game.events.emit.bind(game.events);
  game.events.emit = (name, p) => {
    game.events.log.push([name, p && typeof p === 'object' ? { ...p } : p]);
    return emit0(name, p);
  };
  const service = createService(game, { spots });
  game.service = service;
  return { game, service };
}
function drive(game, id, x = 0, z = 0, h = 0) {
  const v = createVehicle(id, x, z, h);
  v.driver = 'player';
  game.addVehicle(v);
  game.player.vehicle = v;
  game.player.mode = 'car';
  return v;
}
// One game step: vehicles, combat, service (game.js order). c: the
// player's controls (else none).
function tick(game, service, c = null, n = 1) {
  for (let k = 0; k < n; k++) {
    game.time += DT;
    game.world.time = game.time;
    for (const v of game.vehicles) {
      if (v.asleep) continue;
      stepVehicle(v, v === game.player.vehicle ? c || ctl({ handbrake: true }) : v.controls || null, DT, game.world);
    }
    const p = game.player;
    if (p.vehicle) { p.x = p.vehicle.x; p.z = p.vehicle.z; }
    game.combat.fixedUpdate(DT);
    service.fixedUpdate(DT);
    game.input.endStep();
  }
}
const tap = (game) => game.input.press('extra') || game.input.release('extra');
const person = (game, x, z, team = 'civ') => {
  const a = initActor({ x, z, y: 0, heading: 0, radius: 0.35, px: x, pz: z, vx: 0, vz: 0 }, team);
  addActor(game, a);
  return a;
};
const events = (game, name) => game.events.log.filter((e) => e[0] === name).map((e) => e[1]);

test('SV-S1: siren flags, the SIREN input toggles v.siren with its kind, off after exit and after a wreck', () => {
  for (const id of ['police', 'ambulance', 'firetruck']) assert.equal(specSiren(VEHICLE_SPECS[id]), true, id);
  for (const id of ['garbage', 'towtruck', 'sedan']) assert.equal(specSiren(VEHICLE_SPECS[id]), false, id);
  assert.equal(VEHICLE_SPECS.police.siren, true);
  for (const id of ['ambulance', 'firetruck']) assert.ok(hasSiren(VEHICLE_SPECS[id]), `${id} yields traffic (src/core/yield.js)`);
  for (const id of ['garbage', 'towtruck']) assert.ok(!hasSiren(VEHICLE_SPECS[id]) && VEHICLE_SPECS[id].beacon, `${id} beacons only`);
  const { city } = cityAndCollision();
  const game = makeFightGame({ px: city.spawn.x, pz: city.spawn.z });
  game.input = createInput();
  const log = [];
  game.events.on('siren', (e) => { if (e && typeof e === 'object') log.push({ on: e.on, kind: e.kind }); });
  const police = createPolice(game);
  const service = createService(game, { spots: [] });
  for (const id of ['ambulance', 'firetruck', 'police']) {
    const v = createVehicle(id, city.spawn.x, city.spawn.z, 0);
    v.driver = 'player';
    game.addVehicle(v);
    game.player.vehicle = v;
    game.input.press('siren');
    police.fixedUpdate(DT);
    service.fixedUpdate(DT);
    game.input.release('siren');
    game.input.endStep();
    assert.equal(v.siren, true, `${id} siren on`);
    assert.deepEqual(log[log.length - 1], { on: true, kind: id });
    assert.ok(isSirenCar(Object.assign(v, { speed: 10 })), `${id} counts for the yield rule`);
    // Leaving switches it off.
    game.player.vehicle = null;
    v.driver = null;
    police.fixedUpdate(DT);
    service.fixedUpdate(DT);
    assert.equal(v.siren, false, `${id} off after exit`);
    assert.deepEqual(log[log.length - 1], { on: false, kind: id });
    // A wreck switches it off too.
    game.player.vehicle = v;
    v.driver = 'player';
    game.input.press('siren');
    police.fixedUpdate(DT);
    service.fixedUpdate(DT);
    game.input.release('siren');
    game.input.endStep();
    assert.equal(v.siren, true);
    v.wrecked = true;
    police.fixedUpdate(DT);
    service.fixedUpdate(DT);
    assert.equal(v.siren, false, `${id} off after a wreck`);
    game.removeVehicle(v);
    game.player.vehicle = null;
    police.fixedUpdate(DT);
    service.fixedUpdate(DT);
  }
  // The garbage and tow trucks offer no siren.
  const g = createVehicle('garbage', 0, 0, 0);
  g.driver = 'player';
  game.player.vehicle = g;
  game.input.press('siren');
  police.fixedUpdate(DT);
  assert.equal(!!g.siren, false);
});

test('SV-L1: light bar phases follow the table, repeat with the cycle, 50 ms steps; reduced motion is steady', () => {
  const names = (id, mask) => LIGHTBARS[id].slots.filter((_, i) => mask & (1 << i)).map(([n]) => n).sort().join(' ');
  const table = {
    police: [100, ['barL headL', 'headL', 'barL headL', 'headL', 'barR headR', 'headR', 'barR headR', 'headR']],
    ambulance: [150, ['frontReds', '', 'frontReds', 'rearReds white', '', 'rearReds white']],
    garbage: [400, ['beaconL', 'beaconR']],
    towtruck: [150, ['seg0', 'seg1', 'seg2', 'seg3']],
  };
  const out = {};
  for (const id in table) {
    const [ms, sets] = table[id];
    const cycle = ms * sets.length;
    assert.equal(LIGHTBARS[id].cycle, cycle, id);
    for (let k = 0; k < sets.length * 3; k++) {
      const t = (k * ms) / 1000;
      lightbarPhase(id, t, false, out);
      assert.equal(names(id, out.mask), sets[k % sets.length].split(' ').filter(Boolean).sort().join(' '), `${id} phase ${k}`);
    }
  }
  // Fire truck: halves every 250 ms, sides opposite, white for the first 50 ms.
  const ft = (t) => names('firetruck', lightbarPhase('firetruck', t, false, out).mask);
  assert.equal(ft(0), 'barL sideR white');
  assert.equal(ft(0.05), 'barL sideR');
  assert.equal(ft(0.25), 'barR sideL white');
  assert.equal(ft(0.3), 'barR sideL');
  assert.equal(ft(0.5), 'barL sideR white');
  assert.equal(LIGHTBARS.firetruck.cycle, 500);
  for (const id in LIGHTBARS) {
    for (const [ms] of LIGHTBARS[id].phases) assert.equal(ms % 50, 0, `${id} phase ${ms} ms`);
    lightbarPhase(id, 0.123, true, out);
    assert.equal(out.mask, LIGHTBARS[id].all);
    assert.equal(out.half, true);
  }
  // Siren table (sound is W6's): tones and timings of 6.11.
  assert.deepEqual([SIRENS.police.lo, SIRENS.police.hi, SIRENS.police.cycle, SIRENS.police.yelpCycle], [600, 1300, 3.2, 0.3]);
  assert.deepEqual([SIRENS.ambulance.hi, SIRENS.ambulance.lo, SIRENS.ambulance.step], [960, 770, 0.5]);
  assert.deepEqual([SIRENS.firetruck.lo, SIRENS.firetruck.hi, SIRENS.firetruck.cycle], [400, 1000, 5.0]);
  assert.deepEqual(SIRENS.garbage.reverse, { hz: 1000, on: 0.4, off: 0.4 });
});

test('SV-L2: beacons are on exactly while lifting, towing or reversing and for 2 s after', () => {
  const { game, service } = svcGame();
  const g = drive(game, 'garbage');
  tick(game, service, null, 10);
  assert.equal(g.beacon, false);
  game.extraBins = [{ x: 0.5, z: 2.6 }];
  tap(game);
  tick(game, service, null, 1);
  assert.equal(g.beacon, true, 'lifting');
  tick(game, service, null, 3 * 60);
  assert.equal(g.svc.lift, 0);
  tick(game, service, null, 110);
  assert.equal(g.beacon, true, 'within 2 s after');
  tick(game, service, null, 15);
  assert.equal(g.beacon, false, 'off 2 s after');
  // Reversing.
  for (let k = 0; k < 90; k++) tick(game, service, ctl({ brake: 1 }), 1);
  assert.ok(g.speed < -0.2 && g.beacon, 'reversing');
  for (let k = 0; k < 60; k++) tick(game, service, ctl({ brake: 0, throttle: 0, handbrake: true }), 1);
  tick(game, service, ctl({ handbrake: true }), 2.2 * 60);
  assert.equal(g.beacon, false);
});

test('SV-C1: the water tank empties in 20 s of hold, refills in 40 s, and will not restart under 25 %', () => {
  const { game, service } = svcGame();
  const f = drive(game, 'firetruck');
  const s = svcState(f);
  game.input.press('extra');
  tick(game, service, null, 1);
  assert.equal(s.spray, true);
  tick(game, service, null, 20 * 60 - 2);
  assert.ok(s.spray && s.tank > 0, 'still spraying just before 20 s');
  tick(game, service, null, 1);
  assert.equal(s.tank, 0);
  assert.equal(s.spray, false, 'dry at 20 s');
  game.input.release('extra');
  tick(game, service, null, 9.9 * 60);
  game.input.press('extra');
  tick(game, service, null, 1);
  assert.equal(s.spray, false, 'under 25 %: no restart');
  game.input.release('extra');
  tick(game, service, null, 0.2 * 60);
  game.input.press('extra');
  tick(game, service, null, 1);
  assert.equal(s.spray, true, 'restarts at 25 %');
  game.input.release('extra');
  tick(game, service, null, 1);
  s.tank = 0;
  tick(game, service, null, 39.5 * 60);
  assert.ok(s.tank < EXTRAS.cannon.tank - 0.2, 'not full at 39.5 s');
  tick(game, service, null, 0.5 * 60 + 1);
  assert.ok(Math.abs(s.tank - EXTRAS.cannon.tank) < 1e-6, 'full in 40 s');
  // Works at any speed.
  for (let k = 0; k < 300; k++) tick(game, service, ctl({ throttle: 1 }), 1);
  game.input.press('extra');
  tick(game, service, ctl({ throttle: 1 }), 1);
  assert.ok(f.speed > 10 && s.spray);
  assert.ok(events(game, 'extra').some((e) => e.kind === 'cannon' && e.on));
});

test('SV-C2: a person 20 m ahead is knocked down, moved along the jet, unhurt, no blood, up after 3 s; 30 m is untouched', () => {
  const { game, service } = svcGame();
  drive(game, 'firetruck');
  const near = person(game, 20, 0);
  const far = person(game, 31.5, 0);
  const hp = near.hp;
  game.input.press('extra');
  let t = 0;
  while (near.life === 'ok' && t < 1) { tick(game, service, null, 1); t += DT; }
  assert.equal(near.life, 'down');
  assert.ok(t <= 0.5, `down within 0.5 s (${t.toFixed(2)})`);
  game.input.release('extra');
  tick(game, service, null, 60);
  assert.ok(near.x > 20.5, `moved along the jet to ${near.x.toFixed(2)}`);
  assert.equal(near.hp, hp, 'no damage');
  assert.equal(events(game, 'hit').length, 0, 'no hit (no blood)');
  assert.equal(events(game, 'kill').length, 0, 'never a kill');
  const down = events(game, 'down');
  assert.ok(down.length === 1 && down[0].kind === 'water' && down[0].source === null);
  assert.equal(near.life, 'down', 'still down at 1.3 s');
  tick(game, service, null, 2 * 60 + 2);
  assert.notEqual(near.life, 'down', 'up after 3 s');
  tick(game, service, null, 60);
  assert.equal(near.life, 'ok');
  assert.equal(far.life, 'ok', 'a person at 30 m is untouched');
  assert.equal(far.x, 31.5);
});

test('SV-C3: a burning hull 15 m ahead is put out after 1.5 s of summed jet time, +150, and still goes at 60 s', () => {
  const { game, service } = svcGame();
  drive(game, 'firetruck');
  const hull = createVehicle('sedan', 15, 0, 0.5);
  hull.health = 0;
  hull.wrecked = true;
  hull.wreckT = 0;
  game.addVehicle(hull);
  tick(game, service, null, 2);
  assert.ok(hull.hullFlame && game.combat.hulls.includes(hull), 'burning hull');
  const hulls0 = game.combat.hulls.length;
  // 1.0 s, a pause, then 0.5 s more: summed, not in a row.
  game.input.press('extra');
  tick(game, service, null, 60);
  game.input.release('extra');
  tick(game, service, null, 30);
  assert.equal(hull.hullFlame, true, 'still burning after 1.0 s');
  assert.ok(hull.douseT > 0.5 && hull.douseT < 1.5, `summed so far ${hull.douseT}`);
  game.input.press('extra');
  for (let k = 0; k < 120 && hull.hullFlame; k++) tick(game, service, null, 1);
  assert.equal(hull.hullFlame, false, 'out after 1.5 s in the jet');
  assert.ok(hull.douseT >= 1.5 && hull.douseT < 1.5 + 2 * DT, `out at ${hull.douseT.toFixed(3)} s of summed jet time`);
  game.input.release('extra');
  const offs = events(game, 'hullBurn').filter((e) => e.on === false);
  assert.equal(offs.length, 1, 'hullBurn off once');
  assert.ok(game.scoreLog.some(([p, w]) => p === 150 && w === 'Fire out'));
  tick(game, service, null, 30 * 60);
  assert.equal(events(game, 'hullBurn').filter((e) => e.on === false).length, 1, 'and only once');
  assert.ok(!hull.removed && hull.hullFlame === false);
  assert.equal(game.combat.hulls.length, hulls0);
  while (!hull.removed && game.time < 70) tick(game, service, null, 30);
  assert.ok(hull.removed, 'the hull still fades at its 60 s');
  assert.ok(game.time > 60 && game.time < 64, `gone at ${game.time.toFixed(1)} s`);
});

test('SV-C4: the jet turns to a target 30 degrees off the nose at 90 degrees per second at most, ignores 40 degrees', () => {
  for (const [deg, follows] of [[30, true], [40, false]]) {
    const { game, service } = svcGame();
    const f = drive(game, 'firetruck');
    const s = svcState(f);
    const ox = f.spec.length * 0.15;
    const a = person(game, ox + Math.cos(deg * DEG) * 15, Math.sin(deg * DEG) * 15);
    game.input.press('extra');
    let last = 0, maxStep = 0;
    for (let k = 0; k < 90; k++) {
      tick(game, service, null, 1);
      maxStep = Math.max(maxStep, Math.abs(s.jetYaw - last));
      last = s.jetYaw;
    }
    assert.ok(maxStep <= 90 * DEG * DT + 1e-9, `turn rate ${(maxStep / DT / DEG).toFixed(1)} deg/s`);
    if (follows) assert.equal(a.life === 'ok', false, 'the turned jet reaches the target');
    else {
      assert.ok(Math.abs(s.jetYaw) < 1e-9, 'jet stays on the nose');
      assert.equal(a.life, 'ok');
    }
  }
});

test('SV-A1: treat revives a body 6 m away after 2.0 s at rest; 9 m does nothing; moving off cancels; 5 s cooldown', () => {
  const { game, service } = svcGame();
  const am = drive(game, 'ambulance');
  const body = person(game, 0, 6);
  body.hp = 0;
  body.life = 'out';
  body.lifeT = 2;
  const bodies = () => game.actors.filter((x) => x.life === 'out').length;
  assert.equal(bodies(), 1);
  tap(game);
  tick(game, service, null, 1.95 * 60);
  assert.equal(body.life, 'out', 'not yet at 1.95 s');
  tick(game, service, null, 4);
  assert.equal(bodies(), 0, 'revived');
  assert.equal(body.life, 'ok');
  assert.ok(Math.abs(body.x) < 1e-6 && Math.abs(body.z - 6) < 1e-6, 'stands at that place');
  assert.ok(game.scoreLog.some(([p, w]) => p === 200 && w === 'Revived'));
  assert.equal(events(game, 'revived').length, 1);
  // Cooldown: a second body is not treated for 5 s.
  const b2 = person(game, 2, 5);
  b2.hp = 0;
  b2.life = 'out';
  tap(game);
  tick(game, service, null, 2.2 * 60);
  assert.equal(b2.life, 'out', 'cooldown holds');
  tick(game, service, null, 3 * 60);
  tap(game);
  tick(game, service, null, 2.05 * 60);
  assert.equal(b2.life, 'ok', 'after the cooldown');
  // 9 m: nothing to treat.
  tick(game, service, null, 5.1 * 60);
  const b3 = person(game, 0, 9);
  b3.hp = 0;
  b3.life = 'out';
  game.toasts.length = 0;
  am.boostMeter = 1;
  tap(game);
  tick(game, service, null, 2.5 * 60);
  assert.equal(b3.life, 'out');
  assert.ok(game.toasts.includes('Nobody to treat'));
  // Moving off cancels.
  const b4 = person(game, 0, -5);
  b4.hp = 0;
  b4.life = 'out';
  tap(game);
  tick(game, service, null, 60);
  for (let k = 0; k < 120; k++) tick(game, service, ctl({ throttle: 1 }), 1);
  assert.ok(am.speed > 2);
  assert.equal(b4.life, 'out', 'canceled by driving off');
  assert.equal(am.svc.treat, 0);
  // Normal mode, nobody to treat: the boost meter refills at once.
  for (let k = 0; k < 400 && am.speed > 0.05; k++) tick(game, service, ctl({ brake: 1 }), 1);
  tick(game, service, ctl({ handbrake: true }), 6 * 60);
  am.boostMeter = 0.2;
  am.boostLock = true;
  game.actors.length = 0;
  tap(game);
  tick(game, service, ctl({ handbrake: true }), 1);
  assert.equal(am.boostMeter >= 0.999, true, 'boost refilled');
});

test('SV-A2: hard mode heals to full in 2.0 s and 5 % per second while seated; normal mode leaves health alone', () => {
  {
    const { game, service } = svcGame({ mortal: true });
    drive(game, 'ambulance');
    const w = game.player.walker;
    w.maxHp = 100;
    w.hp = 40;
    w.sinceHit = -1000; // keep combat's own regen out of this measure
    tap(game);
    tick(game, service, null, 1.0 * 60);
    assert.ok(w.hp > 60 && w.hp < 100, `half way ${w.hp.toFixed(1)}`);
    tick(game, service, null, 1.0 * 60 + 1);
    assert.equal(w.hp, 100, 'full at 2.0 s');
    w.hp = 50;
    tick(game, service, null, 60);
    assert.ok(Math.abs(w.hp - 55) < 0.2, `seated regen ${w.hp.toFixed(2)}`);
  }
  {
    const { game, service } = svcGame({ mortal: false });
    drive(game, 'ambulance');
    const w = game.player.walker;
    w.maxHp = 100;
    w.hp = 50;
    w.sinceHit = -1000;
    tap(game);
    tick(game, service, null, 3 * 60);
    assert.equal(w.hp, 50);
  }
});

test('SV-G1: a bin 3 m away is emptied in a 3.0 s cycle (+50, load +1), locked 300 s; 5 m is ignored; driving off tips it', () => {
  const { game, service } = svcGame();
  const g = drive(game, 'garbage');
  game.extraBins = [{ x: 0, z: 3 }, { x: 40, z: 5 }];
  tap(game);
  tick(game, service, null, 1);
  assert.ok(g.svc.lift > 0);
  tick(game, service, null, 3 * 60 - 3);
  assert.equal(g.svc.load, 0, 'not done before 3.0 s');
  tick(game, service, null, 3);
  assert.equal(g.svc.load, 1);
  assert.ok(game.scoreLog.some(([p, w]) => p === 50 && w === 'Bin emptied'));
  tap(game);
  tick(game, service, null, 3.5 * 60);
  assert.equal(g.svc.load, 1, 'the same bin cannot be lifted again');
  game.time += 300;
  tap(game);
  tick(game, service, null, 3.1 * 60);
  assert.equal(g.svc.load, 2, 'after 300 s it can');
  // A bin 5 m away is out of reach (and there are no parts: nothing to lift).
  game.extraBins = [{ x: 0, z: 5 }];
  game.toasts.length = 0;
  tap(game);
  tick(game, service, null, 5);
  assert.equal(g.svc.lift, 0);
  assert.ok(game.toasts.includes('Nothing to lift'));
  // Driving off aborts the cycle and drops the bin on its side.
  game.extraBins = [{ x: 0, z: 3 }, { x: 1, z: 3.2 }];
  game.time += 400;
  tap(game);
  tick(game, service, null, 30);
  for (let k = 0; k < 120 && g.svc.lift > 0; k++) tick(game, service, ctl({ throttle: 1 }), 1);
  assert.equal(g.svc.lift, 0);
  assert.equal(g.svc.load, 2);
  assert.equal(service.tipped.length, 1);
});

test('SV-G2: with no bin the crusher takes up to 3 parts within 4 m (+20 each); a full hopper waits for the yard (+400)', () => {
  const { game, service } = svcGame();
  const g = drive(game, 'garbage');
  const P = createParts();
  game.combatFx = { parts: P };
  const put = (i, x, z) => { P.age[i] = 5; P.hits[i] = 2; P.x[i] = x; P.z[i] = z; };
  put(0, 1, 1); put(1, -2, 1); put(2, 3, -1); put(3, 0, 2); put(4, 9, 0);
  tap(game);
  tick(game, service, null, 61);
  const live = [0, 1, 2, 3, 4].filter((i) => P.age[i] >= 0);
  assert.equal(live.length, 2, 'three crushed');
  assert.ok(live.includes(4), 'the far one stays');
  assert.ok(game.scoreLog.some(([p]) => p === 60));
  // Load cap.
  g.svc.load = EXTRAS.lift.cap;
  game.extraBins = [{ x: 0, z: 3 }];
  game.toasts.length = 0;
  tap(game);
  tick(game, service, null, 5);
  assert.equal(g.svc.lift, 0);
  assert.ok(game.toasts.includes('Full'));
  // The yard stop empties it.
  game.extraYards = [{ x: 0, z: 0, r: 20 }];
  tick(game, service, null, 2 * 60 + 2);
  assert.equal(g.svc.load, 0);
  assert.ok(game.scoreLog.some(([p, w]) => p === 400 && w === 'Load dumped'));
});

// A tow truck at the origin facing +x, a car behind it.
function towSetup(id = 'sedan', gap = 6.4, opts = {}) {
  const { game, service } = svcGame(opts);
  const t = drive(game, 'towtruck');
  const c = createVehicle(id, -gap, 0, 0);
  game.addVehicle(c);
  return { game, service, t, c };
}

test('SV-T1: a 1450 kg car is hooked after 1.0 s and follows through a 90 degree corner; a truck and a moving car are refused', () => {
  {
    const { game, service, t, c } = towSetup();
    assert.equal(c.spec.mass, 1450);
    tap(game);
    tick(game, service, null, 57);
    assert.equal(t.svc.hook, null, 'not before 1.0 s');
    tick(game, service, null, 4);
    assert.equal(t.svc.hook, c, 'hooked at 1.0 s');
    assert.ok(Math.hypot(c.x + 4.2 + 2.3, c.z) < 0.6, 'pinned behind the hitch');
    // Drive a 90 degree right corner at about 6 m/s, recording the truck's path.
    // The truck's path: the straight road it came along, then its track.
    const path = [];
    for (let x = -25; x < 0; x += 0.25) path.push([x, 0]);
    let maxOff = 0;
    for (let k = 0; k < 60 * 30 && Math.abs(t.heading) < Math.PI / 2; k++) {
      const steer = t.x > 10 ? 0.55 : 0;
      tick(game, service, ctl({ throttle: t.speed < 6 ? 0.5 : 0, brake: t.speed > 7 ? 0.2 : 0, steer }), 1);
      path.push([t.x, t.z]);
      let best = Infinity;
      for (const [x, z] of path) best = Math.min(best, Math.hypot(c.x - x, c.z - z));
      maxOff = Math.max(maxOff, best);
    }
    assert.ok(Math.abs(t.heading) >= Math.PI / 2 - 0.05, 'turned the corner');
    assert.equal(t.svc.hook, c, 'still on the hook');
    assert.ok(maxOff <= 1.2, `stays within 1.2 m of the truck's path (${maxOff.toFixed(2)} m)`);
    assert.ok(events(game, 'extra').some((e) => e.kind === 'hook' && e.on));
  }
  {
    const { game, service, t } = towSetup('truck', 6.4);
    assert.equal(VEHICLE_SPECS.truck.mass, 7500);
    tap(game);
    tick(game, service, null, 90);
    assert.equal(t.svc.hook, null, 'a 7500 kg truck is refused');
  }
  {
    const { game, service, t, c } = towSetup();
    c.vx = 3;
    c.speed = 3;
    c.controls = ctl({ throttle: 0.4 });
    tap(game);
    tick(game, service, null, 90);
    assert.equal(t.svc.hook, null, 'a moving car is refused');
  }
});

test('SV-T2: towing keeps t60 within 135 % and stop within 125 %, caps 26.8 m/s; over 75 degrees releases; release keeps velocity', () => {
  const run = (towing) => {
    const { game, service, t } = towSetup();
    if (towing) { tap(game); tick(game, service, null, 62); assert.ok(t.svc.hook); }
    let t25 = Infinity, top = 0;
    for (let k = 0; k < 60 * 70; k++) {
      tick(game, service, ctl({ throttle: 1 }), 1);
      if (t25 === Infinity && t.speed >= 25) t25 = (k + 1) * DT;
      top = Math.max(top, t.speed);
    }
    // Stop from 25 m/s.
    const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
    t.vx = ch * 25;
    t.vz = sh * 25;
    t.speed = 25;
    if (t.svc) t.svc.u0 = 25;
    const x0 = t.x, z0 = t.z;
    for (let k = 0; k < 1200 && t.speed > 1e-6; k++) tick(game, service, ctl({ brake: 1 }), 1);
    return { t25, top, stop: Math.hypot(t.x - x0, t.z - z0), game, service, t };
  };
  const solo = run(false), tow = run(true);
  assert.ok(tow.t25 <= solo.t25 * 1.35 && tow.t25 > solo.t25, `t60 ${solo.t25.toFixed(2)} -> ${tow.t25.toFixed(2)}`);
  assert.ok(tow.stop <= solo.stop * 1.25 && tow.stop > solo.stop, `stop ${solo.stop.toFixed(1)} -> ${tow.stop.toFixed(1)}`);
  assert.ok(tow.top <= EXTRAS.hook.topCap + 1e-9 && solo.top > EXTRAS.hook.topCap, `top ${tow.top.toFixed(2)}`);
  // Hitch angle over 75 degrees: the hook slips; the car keeps its velocity.
  const { game, service, t, c } = towSetup();
  tap(game);
  tick(game, service, null, 62);
  for (let k = 0; k < 120; k++) tick(game, service, ctl({ throttle: 0.6 }), 1);
  assert.equal(t.svc.hook, c);
  const vx = c.vx, vz = c.vz;
  assert.ok(Math.hypot(vx, vz) > 2);
  t.heading += 80 * DEG;
  tick(game, service, ctl({}), 1);
  assert.equal(t.svc.hook, null, 'released over 75 degrees');
  assert.equal(c.towedBy, null);
  assert.ok(Math.abs(c.vx - vx) < 0.5 && Math.abs(c.vz - vz) < 0.5, 'keeps its velocity');
  // Release by tap at any speed keeps the car's heading too.
  const s2 = towSetup();
  tap(s2.game);
  tick(s2.game, s2.service, null, 62);
  for (let k = 0; k < 120; k++) tick(s2.game, s2.service, ctl({ throttle: 0.6 }), 1);
  const h = s2.c.heading;
  tap(s2.game);
  tick(s2.game, s2.service, ctl({ throttle: 0.6 }), 1);
  assert.equal(s2.t.svc.hook, null);
  assert.ok(Math.abs(s2.c.heading - h) < 0.05);
  // Hooking a police car brings two stars.
  const s3 = towSetup('police');
  s3.game.police = { heat: { level: 0 } };
  tap(s3.game);
  tick(s3.game, s3.service, null, 62);
  assert.equal(s3.t.svc.hook, s3.c);
  assert.equal(s3.game.police.heat.level, 2);
});

test('SV-T3: a burnt hull can be towed; a 2 s stop in the tow yard removes it and adds 300', () => {
  const { game, service, t, c } = towSetup();
  c.health = 0;
  c.wrecked = true;
  c.wreckT = 20;
  tick(game, service, null, 1);
  const hulls0 = game.combat.hulls.length;
  assert.equal(hulls0, 1);
  tap(game);
  tick(game, service, null, 62);
  assert.equal(t.svc.hook, c, 'hull hooked');
  game.extraYards = [{ x: 30, z: 0, r: 15 }];
  for (let k = 0; k < 60 * 15 && t.x < 30; k++) tick(game, service, ctl({ throttle: 0.5 }), 1);
  for (let k = 0; k < 300 && t.speed > 0.3; k++) tick(game, service, ctl({ brake: 1 }), 1);
  tick(game, service, ctl({ handbrake: true }), 2 * 60 + 2);
  assert.ok(c.removed, 'handed in');
  assert.ok(game.scoreLog.some(([p, w]) => p === 300 && w === 'Towed in'));
  tick(game, service, null, 1);
  assert.equal(game.combat.hulls.length, hulls0 - 1, 'one hull fewer');
});

test('SV-X1: no extra when wrecked or AI-driven or without spec.extra; same seed and inputs give the same world', () => {
  for (const id of ['firetruck', 'ambulance', 'garbage', 'towtruck']) {
    const { game, service } = svcGame();
    const v = drive(game, id);
    game.extraBins = [{ x: 0, z: 3 }];
    const body = person(game, 0, 5);
    body.hp = 0;
    body.life = 'out';
    const near = person(game, 18, 0);
    const car = createVehicle('sedan', -6.4, 0, 0);
    game.addVehicle(car);
    v.wrecked = true;
    game.input.press('extra');
    tick(game, service, null, 200);
    game.input.release('extra');
    assert.equal(service.hudFor(v).can, false, `${id} wrecked: no button`);
    const s = svcState(v);
    assert.ok(!s.spray && !s.treat && !s.lift && !s.hook && near.life === 'ok' && body.life === 'out', `${id} wrecked does nothing`);
    v.wrecked = false;
    v.health = v.spec.health;
    v.driver = { ai: true };
    game.player.vehicle = null;
    tap(game);
    game.input.press('extra');
    tick(game, service, null, 200);
    assert.ok(!s.spray && !s.treat && !s.lift && !s.hook && near.life === 'ok' && body.life === 'out', `${id} AI does nothing`);
  }
  {
    const { game, service } = svcGame();
    const sed = drive(game, 'sedan');
    assert.equal(service.hudFor(sed).can, false, 'no extra in a sedan');
    assert.equal(service.hudFor(drive(game, 'police')).can, false, 'no extra in the police car');
  }
  const run = () => {
    const { game, service } = svcGame({ seed: 4 });
    const f = drive(game, 'firetruck');
    for (let i = 0; i < 6; i++) person(game, 10 + i * 3, (i - 2.5) * 2);
    for (let k = 0; k < 600; k++) {
      if (k === 30) game.input.press('extra');
      if (k === 400) game.input.release('extra');
      tick(game, service, ctl({ throttle: k < 200 ? 0.3 : 0, steer: k > 100 ? 0.2 : 0 }), 1);
    }
    void f;
    return serviceHash(game);
  };
  assert.equal(run(), run());
});

// ---- the Miami city: parking spots (SV-P1) ----
const miamiData = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
let miami = null;
async function miamiCity() {
  if (!miami) {
    const { createMiamiCity } = await import('../src/world/miami.js');
    const { attachExplore } = await import('../src/world/adventures.js');
    miami = attachExplore(createMiamiCity(miamiData));
  }
  return miami;
}

test('SV-P1: every service spot obeys the parking rules on the built Miami city', async () => {
  const city = await miamiCity();
  const { MIAMI_SPOTS } = await import('../src/world/miami.js');
  const cache = new Map();
  const counts = {};
  for (const s of SERVICE_SPOTS) counts[s.kind] = (counts[s.kind] || 0) + 1;
  assert.deepEqual(counts, SPOT_RULES.counts);
  // Real venue names in the map data (the D1 list) are not used.
  const real = new Set();
  for (const k of ['labels', 'roads', 'buildings', 'parks', 'water']) for (const r of miamiData[k]) if (r.name) real.add(r.name);
  for (const s of SERVICE_SPOTS) assert.ok(!real.has(s.name), `${s.name} is a real venue name`);
  const box = (s) => {
    const sp = VEHICLE_SPECS[s.kind];
    const L = (sp.length + 2) / 2, Wd = (sp.width + 1.5) / 2, c = Math.cos(s.heading), n = Math.sin(s.heading);
    return [[L, Wd], [L, -Wd], [-L, -Wd], [-L, Wd]].map(([a, b]) => [s.x + a * c - b * n, s.z + a * n + b * c]);
  };
  const overlap = (A, B) => {
    for (const P of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 4];
        const nx = -(z2 - z1), nz = x2 - x1;
        const span = (Q) => Q.reduce(([lo, hi], [x, z]) => [Math.min(lo, x * nx + z * nz), Math.max(hi, x * nx + z * nz)], [Infinity, -Infinity]);
        const [a0, a1] = span(A), [b0, b1] = span(B);
        if (a1 < b0 || b1 < a0) return false;
      }
    }
    return true;
  };
  const out = {};
  for (const s of SERVICE_SPOTS) {
    const sp = VEHICLE_SPECS[s.kind];
    assert.ok(city.inCore(s.x, s.z), `${s.name} in the core`);
    if (s.curb) {
      // A marked curb bay: one of the city's curb spaces, its heading.
      const bay = city.parkingSpots.find((q) => !q.lot && Math.hypot(q.x - s.x, q.z - s.z) < 0.5);
      assert.ok(bay, `${s.name}: a curb bay`);
      assert.ok(Math.abs(Math.sin(bay.heading - s.heading)) < 0.05 && Math.cos(bay.heading - s.heading) > 0, `${s.name}: the bay's heading`);
      assert.ok(nearestRoad(city, s.x, s.z).dist < SPOT_RULES.roadNear);
      assert.ok(!city.inBuilding(s.x, s.z) && city.isLand(s.x, s.z));
    } else {
      const r = checkSpot(city, s, sp, cache, out);
      assert.ok(r.ok, `${s.name} ${s.kind} at ${s.x}, ${s.z}: ${r.why}`);
      const lot = city.lotAt(s.x, s.z);
      assert.ok(lot && SPOT_RULES.lotTypes.includes(lot.type), `${s.name}: lot type ${lot && lot.type}`);
    }
    assert.ok(!city.garages.some((g) => s.x > g.x0 - 2 && s.x < g.x1 + 2 && s.z > g.z0 - 2 && s.z < g.z1 + 2), `${s.name}: not on a garage`);
  }
  // No two boxes overlap.
  for (let i = 0; i < SERVICE_SPOTS.length; i++) {
    for (let j = i + 1; j < SERVICE_SPOTS.length; j++) {
      assert.ok(!overlap(box(SERVICE_SPOTS[i]), box(SERVICE_SPOTS[j])), `${SERVICE_SPOTS[i].name} and ${SERVICE_SPOTS[j].name} overlap`);
    }
  }
  // Same kind 400 m apart unless they share a station.
  for (let i = 0; i < SERVICE_SPOTS.length; i++) {
    for (let j = i + 1; j < SERVICE_SPOTS.length; j++) {
      const a = SERVICE_SPOTS[i], b = SERVICE_SPOTS[j];
      if (a.kind !== b.kind || a.name === b.name) continue;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= SPOT_RULES.apart, `${a.kind}: ${a.name} and ${b.name} too close`);
    }
  }
  // One of each within 600 m by road of the start; none in the title shot.
  const st = MIAMI_SPOTS.startView.spawn;
  const dist = roadDistances(city, st.x, st.z);
  const rd = (x, z) => {
    const r = nearestRoad(city, x, z, 80);
    const e = r.edge, a = city.nodes[e.a], b = city.nodes[e.b];
    return Math.min(dist[e.a] + Math.hypot(r.x - a.x, r.z - a.z), dist[e.b] + Math.hypot(r.x - b.x, r.z - b.z));
  };
  for (const kind of Object.keys(SPOT_RULES.counts)) {
    const best = Math.min(...SERVICE_SPOTS.filter((s) => s.kind === kind).map((s) => rd(s.x, s.z)));
    assert.ok(best <= SPOT_RULES.startNear, `${kind} nearest by road ${best.toFixed(0)} m`);
  }
  for (const s of SERVICE_SPOTS) {
    const dx = s.x - st.x, dz = s.z - st.z, d = Math.hypot(dx, dz);
    assert.ok(d > SPOT_RULES.titleClear, `${s.name} inside the title shot`);
    const off = Math.abs(Math.atan2(dz, dx) - st.heading);
    assert.ok(!(d < 400 && off < 35 * DEG), `${s.name} in the title view cone`);
  }
});

test('SV-P2: traffic share over 20,000 seeded spawns; at most 2 alive, never two of a kind, garbage 05:00 to 15:00', () => {
  const rng = createRng(99);
  const n = 20000;
  const got = { garbage: 0, towtruck: 0, ambulance: 0, firetruck: 0 };
  for (let i = 0; i < n; i++) {
    const k = pickTrafficService(rng, 10, [], i * 1000, 0, true);
    if (k) got[k]++;
  }
  for (const k in TRAFFIC_SHARES) {
    const share = got[k] / n;
    assert.ok(Math.abs(share / TRAFFIC_SHARES[k] - 1) <= 0.25, `${k} share ${(share * 100).toFixed(2)} %`);
  }
  // At night no garbage trucks; with live ones the caps hold.
  const night = createRng(5);
  for (let i = 0; i < 5000; i++) assert.notEqual(pickTrafficService(night, 21, [], 0, 0, true), 'garbage');
  const alive = [];
  const r2 = createRng(7);
  let x = 0;
  for (let i = 0; i < 20000; i++) {
    x += 200;
    const k = pickTrafficService(r2, 10, alive, x, 0, true);
    if (k) {
      assert.ok(alive.length < TRAFFIC_RULES.maxAlive, 'never more than 2 alive');
      assert.ok(!alive.some((o) => o.spec.id === k), 'never two of a kind');
      assert.ok(alive.every((o) => Math.hypot(o.x - x, o.z) >= TRAFFIC_RULES.minGap), '150 m from another');
      alive.push({ spec: VEHICLE_SPECS[k], x, z: 0 });
      if (alive.length > 1 && i % 3 === 0) alive.shift();
    }
  }
  assert.equal(pickTrafficService(createRng(1), 10, [], 0, 0, false), null, 'only inside the core');
  // One in four ambulance or fire truck spawns is on call; never the others.
  assert.equal(onCallDraw('ambulance', 0.2), true);
  assert.equal(onCallDraw('firetruck', 0.3), false);
  assert.equal(onCallDraw('garbage', 0.1), false);
});

// ---- meshes (SV-M1) ----
test('SV-M1: service meshes inside their triangle bands; the light bar adds one draw call', async () => {
  const { createVehicleMesh } = await import('../src/render/vehiclemesh.js');
  const { fitServiceMesh, serviceStats } = await import('../src/render/servicebody.js');
  const callsAt = (m, d) => {
    const cam = new THREE.PerspectiveCamera(50, 2, 0.3, 1000);
    cam.position.set(d, 1.5, 0);
    cam.updateMatrixWorld(true);
    m.updateMatrixWorld(true);
    m.traverse((o) => { if (o.isLOD) o.update(cam); });
    let n = 0;
    m.traverseVisible((o) => { if (o.isMesh) n++; });
    return n;
  };
  for (const id of SERVICE_IDS) {
    const spec = VEHICLE_SPECS[id];
    const m = fitServiceMesh(createVehicleMesh(spec, spec.colors[0]), spec);
    const s = serviceStats(m);
    const hi = id === 'firetruck' || id === 'garbage' ? 12000 : 11000;
    assert.ok(s.near >= 7000 && s.near <= hi, `${id} near ${s.near}`);
    assert.ok(s.mid < 1800, `${id} mid ${s.mid}`);
    assert.ok(s.far < 400, `${id} far ${s.far}`);
    assert.equal(callsAt(m, 6), 5, `${id} near: 4 + the bar`);
    assert.equal(callsAt(m, 40), 5, `${id} mid`);
  }
  const pol = VEHICLE_SPECS.police;
  const pm = fitServiceMesh(createVehicleMesh(pol, pol.colors[0]), pol);
  assert.equal(callsAt(pm, 6), 5, 'police: still one bar');
  assert.ok(pm.userData.svcBar === pm.userData.bar);
});

// ---- Regions (docs/PLAN_V2.md 3.3): a region parks the service vehicles whose
// home SERVICE_SPOTS puts inside its crop, plus one patrol bay when it has no
// police home. ----
import { regionCity, allRegionCities } from './regionfixture.js';
import { regionFor, inRegion } from '../src/world/regions.js';
import { regionServiceSpots, SERVICE_MARGIN } from '../src/systems/service.js';

test('SV-R1: each region keeps the homes inside its crop and has a police home; Downtown and the whole box keep all twenty', () => {
  const dt = regionCity('miami-downtown');
  assert.deepEqual(regionServiceSpots(dt), SERVICE_SPOTS, 'Downtown: every home as today');
  assert.equal(regionServiceSpots({ region: null }), SERVICE_SPOTS, 'the whole box: the same list');
  const want = {
    'miami-beach': ['Patrol bay'], // the Port Fire Station's streets are Downtown's: no road reaches it here
    'miami-north': ['City Yard', 'City Yard', 'Patrol bay'],
    'miami-west': ['Calle Fire House', 'Calle Fire House', 'Tideline Medical Center', 'Tideline Medical Center', 'Ocho Patrol Base', 'Ocho Patrol Base'],
    'miami-south': ['Patrol bay'],
  };
  for (const [id, c] of allRegionCities()) {
    const list = regionServiceSpots(c);
    if (id in want) assert.deepEqual(list.map((s) => s.name), want[id], id);
    assert.ok(list.some((s) => s.kind === 'police'), id + ' has a police home');
    for (const s of list) assert.ok(inRegion(regionFor(id), s.x, s.z, s.name === 'Patrol bay' ? 150 : SERVICE_MARGIN), `${id} ${s.name} inside`);
    // Same list from the same city.
    assert.deepEqual(regionServiceSpots(c), list, id + ' deterministic');
  }
  // Every home lies in some region.
  for (const s of SERVICE_SPOTS) assert.ok(allRegionCities().some(([id]) => inRegion(regionFor(id), s.x, s.z, SERVICE_MARGIN)), s.name);
});

test('SV-R2: every home of every region, hand-placed or generated, passes the parking rules', () => {
  // The hand homes were tuned on the whole box (SV-P1). Every region rasters its
  // lots on the whole box's lattice (miami.js RASTER_LATTICE), so a home keeps the
  // lot it was tuned on and the full rule holds for it in the region too (before
  // that, 8 of Downtown's 20 failed: "box off the lot", "solid feature").
  let generated = 0;
  for (const [id, c] of allRegionCities()) {
    const cache = new Map();
    const out = {};
    const list = regionServiceSpots(c);
    for (const s of list) {
      const sp = VEHICLE_SPECS[s.kind];
      assert.ok(c.isLand(s.x, s.z) && !c.inBuilding(s.x, s.z), `${id} ${s.name} on land, off buildings`);
      assert.ok(nearestRoad(c, s.x, s.z).dist < SPOT_RULES.roadNear, `${id} ${s.name} by a road`);
      if (s.curb) continue; // a curb bay: the region's curb spots are seeded again, only the ground is checked
      const r = checkSpot(c, s, sp, cache, out);
      assert.ok(r.ok, `${id} ${s.name} ${s.kind} at ${s.x}, ${s.z}: ${r.why}`);
      const lot = c.lotAt(s.x, s.z);
      assert.ok(lot && SPOT_RULES.lotTypes.includes(lot.type), `${id} ${s.name} lot type ${lot && lot.type}`);
      if (s.name === 'Patrol bay') {
        generated++;
        assert.ok(Math.hypot(s.x - c.spawn.x, s.z - c.spawn.z) > SPOT_RULES.titleClear, `${id} ${s.name} inside the title shot`);
      }
      assert.ok(!c.garages.some((g) => s.x > g.x0 - 2 && s.x < g.x1 + 2 && s.z > g.z0 - 2 && s.z < g.z1 + 2), `${id} ${s.name}: not on a garage`);
    }
  }
  assert.equal(generated, 3, 'Beach, North and South have no police home of their own');
});

test('SV-R3: the service system parks the region\'s homes', () => {
  const c = regionCity('miami-south');
  const { game } = svcGame({ spots: null });
  game.city = c;
  const sys = createService(game);
  assert.deepEqual(sys.spots, regionServiceSpots(c));
  assert.equal(sys.homes.length, sys.spots.length);
});
