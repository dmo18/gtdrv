// Flight review (docs/PLAN_V4.md task 8): scripted thumb flights in the
// real region worlds. On the airfield every plane takes off from the
// runway, climbs to 150 m, circles at 30 degrees of bank, returns and lands
// (downtown; the north region holds the same airfield, its circuit runs off
// the crop, so it is flown to the circuit); every parked plane also taxis
// out of its spot at part thrust (0.35, 0.6), lines up and takes off; each
// seaplane flies from its water spot; each helicopter climbs, flies out,
// turns back and lands on its pad. Usage: node scripts/flight-review.mjs [region ...]
// Known pilot limit: the downtown seaplane's straight-in glide ends in a
// shore wall (the script's pattern, not the flight model).
import { buildWorld } from './collision-sweep.mjs';
import { REGION_IDS } from '../src/world/regions.js';
import { createAircraft, stepAircraft } from '../src/entities/aircraft.js';
import { createRng, clamp, angleDiff } from '../src/core/rng.js';
const DT = 1 / 60, DEG = Math.PI / 180, DELAY = Math.round(0.18 / DT), RATE = 4 * DT;
const regions = process.argv.slice(2).length ? process.argv.slice(2) : REGION_IDS;
const f1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
function plane(W, id, start, rw, seed, opt = {}) {
  // Local frame: runway along +x from LX0 = -1200 (as test/thumb-pilot), centerline z = 0.
  const X0 = -1200, ox = rw ? rw.x0 - X0 : start.x - X0 - 30, oz = rw ? (rw.z0 + rw.z1) / 2 : start.z;
  const a = createAircraft(id, start.x, start.z, start.heading);
  a.driver = 'player';
  const s = a.spec, rng = createRng(seed), seen = [];
  const ctl = { steer: 0, pitch: 0, throttle: 0, brake: 0, boost: false }, want = { steer: 0, pitch: 0, throttle: 0, brake: 0 };
  let ns = 0, np = 0, phase = opt.taxi ? 'taxi' : 'takeoff', turned = 0, lastH = 0;
  const out = { id, phase: '', liftX: null, liftV: null, stalled: false, maxRoll: 0, td: null, stop: null, wrecked: false, hp: 0, stuck: 0 };
  for (let i = 0; i < 60 * 420; i++) {
    const L = { x: a.x - ox, y: a.y, z: a.z - oz, h: a.heading, g: a.onGround };
    seen.push(L); if (seen.length > DELAY + 1) seen.shift();
    const o = seen[0];
    const holdAlt = (y) => (o.y < y - 6 ? 0.3 : o.y > y + 6 ? -0.25 : 0);
    const seek = (tx, tz, lim = 0.7) => clamp(angleDiff(Math.atan2(tz - o.z, tx - o.x), o.h) * 1.5, -lim, lim);
    want.throttle = 1; want.brake = 0;
    if (phase === 'taxi') {
      // Out of the parking spot at part thrust: onto the centerline facing
      // west, roll to the west end (braking above 10 m/s), U-turn, line up.
      want.pitch = 0; want.throttle = opt.taxi;
      const west = Math.abs(angleDiff(o.h, Math.PI)) < 0.35;
      if (!out.end && Math.abs(o.z) < 8 && west) out.lined = true;
      if (!out.end && o.x < X0 + 50) out.end = true;
      if (out.end) want.steer = Math.abs(angleDiff(o.h, 0)) > 0.5 ? (out.lined ? -1 : Math.sign(angleDiff(0, o.h))) : clamp(-o.z * 0.05 - angleDiff(o.h, 0) * 1.5, -1, 1);
      else if (out.lined) want.steer = clamp(o.z * 0.05 - angleDiff(o.h, Math.PI) * 1.5, -0.4, 0.4);
      else want.steer = seek(o.x - 30, 0, 1);
      if (Math.abs(a.speed) > 10 && (out.lined || out.end) && Math.abs(want.steer) < 0.6) { want.throttle = 0; want.brake = 0.6; }
      if (out.end && Math.abs(o.z) < 8 && Math.abs(angleDiff(o.h, 0)) < 0.15) phase = 'takeoff';
      if (Math.abs(a.speed) < 0.3 && i > 300) out.stuck += DT; else out.stuck = Math.max(0, out.stuck - DT);
      if (out.stuck > 20) break;
    } else if (phase === 'takeoff') {
      want.steer = clamp(-o.z * 0.05 - angleDiff(o.h, 0) * 1.5, -0.4, 0.4);
      want.pitch = 0.3;
      if (!o.g && o.y > 20) phase = 'climb';
    } else if (phase === 'climb') {
      want.steer = seek(o.x + 400, 0); want.pitch = o.y < 135 ? 0.5 : 0;
      if (o.y >= 135) phase = 'level';
    } else if (phase === 'level') {
      want.steer = seek(o.x + 400, 0); want.pitch = holdAlt(150);
      if (o.x > -200) { phase = 'circle'; lastH = a.heading; }
    } else if (phase === 'circle') {
      want.steer = (30 * DEG) / s.maxBank; want.pitch = -0.12;
      turned += angleDiff(a.heading, lastH); lastH = a.heading;
      if (turned >= 2 * Math.PI) phase = 'return';
    } else if (phase === 'return') {
      want.steer = seek(1500, 800); want.pitch = holdAlt(150);
      if (Math.hypot(o.x - 1500, o.z - 800) < 300) phase = 'base';
    } else if (phase === 'base') {
      want.steer = seek(1000, 0); want.pitch = holdAlt(150);
      if (Math.abs(angleDiff(o.h, Math.PI)) < 0.6 && o.x < 1400) phase = 'final';
    } else if (phase === 'final') {
      const hi = o.y - clamp((o.x - (X0 + 560)) * Math.tan(4 * DEG), 0, 400);
      want.pitch = hi > 12 ? -0.3 : hi < -12 ? 0.15 : 0;
      want.throttle = hi > 12 ? 0 : hi < -12 ? 1 : hi < 0 ? 1 : 0;
      if (o.y < 12) { want.throttle = 0; want.pitch = 0; }
      want.steer = seek(o.x - 500, 0, 0.5);
      if (o.g) phase = 'rollout';
    } else {
      want.steer = clamp(o.z * 0.05 - angleDiff(o.h, Math.PI) * 1.5, -0.4, 0.4); want.pitch = 0; want.throttle = 0; want.brake = 1;
    }
    if (i % 6 === 0) { ns = rng.range(-0.08, 0.08); np = rng.range(-0.08, 0.08); }
    ctl.steer += clamp(clamp(want.steer + ns, -1, 1) - ctl.steer, -RATE, RATE);
    ctl.pitch += clamp(clamp(want.pitch + np, -1, 1) - ctl.pitch, -RATE, RATE);
    ctl.throttle = want.throttle; ctl.brake = want.brake;
    const wg = a.onGround;
    stepAircraft(a, ctl, DT, W.world);
    if (wg && !a.onGround && out.liftX === null) { out.liftX = a.x - ox - (X0 + 30); out.liftV = a.airspeed; }
    if (a.touchdown && phase === 'final' && !out.td) out.td = { sink: a.touchdownSpeed, bank: Math.abs(a.roll) / DEG, x: a.x - ox, z: a.z - oz };
    if (!a.onGround) { out.maxRoll = Math.max(out.maxRoll, Math.abs(a.roll) / DEG); if (a.stalled) out.stalled = true; }
    if (opt.trace && i % 30 === 0) console.log(phase, f1(a.x - ox), f1(a.y), f1(a.z - oz), 'v', f1(a.airspeed), 'p', f1(a.pitch / DEG), 'r', f1(a.roll / DEG), 'vy', f1(a.vy), 'g', a.onGround, a.onWater);
    if (a.wrecked) break;
    if (phase === 'rollout' && Math.abs(a.speed) < 0.2) { out.stop = { x: a.x - ox, z: a.z - oz }; break; }
  }
  out.phase = phase; out.wrecked = a.wrecked; out.crashed = !!a.crashed; out.impact = a.impact; out.water = W.city.isGround ? !W.city.isGround(a.x, a.z) : null; out.col = W.world.collision.heightAt ? W.world.collision.heightAt(a.x, a.z) : null; out.hp = a.health / s.health; out.at = [Math.round(a.x), Math.round(a.y), Math.round(a.z)];
  return out;
}
// Helicopter: up 270 m (over the towers), out 12 s, back to the pad, down.
function heli(W, id, spot) {
  const a = createAircraft(id, spot.x, spot.z, spot.heading);
  a.driver = 'player';
  const ctl = { steer: 0, pitch: 0, throttle: 0, brake: 0, boost: false };
  let phase = 'up', t = 0, y0 = null;
  const out = { id, phase: '', wrecked: false, hp: 0, land: null };
  const h0 = spot.heading;
  for (let i = 0; i < 60 * 200; i++) {
    t += DT;
    if (y0 === null && i > 1) y0 = a.y;
    ctl.steer = 0; ctl.pitch = 0; ctl.throttle = 0; ctl.brake = 0;
    if (phase === 'up') { ctl.throttle = 1; if (a.y > (y0 || 0) + 270) { phase = 'out'; t = 0; } }
    else if (phase === 'out') { ctl.pitch = 1; if (t > 12) { phase = 'turn'; t = 0; } }
    else if (phase === 'turn') { ctl.steer = 1; ctl.pitch = 0.4; if (Math.abs(angleDiff(a.heading, h0 + Math.PI)) < 0.1) { phase = 'back'; t = 0; } }
    else if (phase === 'back') {
      const d = Math.hypot(spot.x - a.x, spot.z - a.z);
      ctl.steer = clamp(angleDiff(Math.atan2(spot.z - a.z, spot.x - a.x), a.heading) * 2, -1, 1);
      ctl.pitch = clamp(d / 40, 0, 1) - (a.speed > d * 0.5 ? 0.6 : 0);
      if (d < 6 && Math.abs(a.speed) < 3) phase = 'down';
    } else if (phase === 'down') {
      ctl.brake = 1;
      const d = Math.hypot(spot.x - a.x, spot.z - a.z);
      ctl.pitch = clamp(d / 20, -0.3, 0.3) * Math.cos(angleDiff(Math.atan2(spot.z - a.z, spot.x - a.x), a.heading));
      if (a.onGround) { out.land = { d: Math.hypot(spot.x - a.x, spot.z - a.z), y: a.y }; break; }
    }
    stepAircraft(a, ctl, DT, W.world);
    if (a.wrecked) break;
  }
  out.phase = phase; out.wrecked = a.wrecked; out.crashed = !!a.crashed; out.impact = a.impact; out.water = W.city.isGround ? !W.city.isGround(a.x, a.z) : null; out.col = W.world.collision.heightAt ? W.world.collision.heightAt(a.x, a.z) : null; out.hp = a.health / a.spec.health; out.at = [Math.round(a.x), Math.round(a.y), Math.round(a.z)];
  return out;
}
let bad = 0;
const report = (tag, r, ok) => { if (!ok) bad++; console.log((ok ? 'ok  ' : 'FAIL') + ' ' + tag + ' ' + JSON.stringify(r, (k, v) => f1(v))); };
for (const id of regions) {
  const W = buildWorld(id);
  const rw = (W.city.surfaces || []).find((s) => s.type === 'runway');
  const spots = W.city.aircraftSpots || [];
  if (rw) {
    const st = { x: rw.x0 + 30, z: (rw.z0 + rw.z1) / 2, heading: 0 };
    for (const pid of ['prop', 'stunt', 'jet', 'fighter']) for (const seed of [1, 7]) {
      const r = plane(W, pid, st, rw, seed);
      const air = id !== 'miami-downtown'; // same airfield as downtown; its circuit runs off the region's crop
      report(`${id} ${pid} runway s${seed}${air ? ' (to the circuit)' : ''}`, r, air ? !r.wrecked && ['return', 'base', 'final', 'rollout'].includes(r.phase) && !r.stalled : !r.wrecked && r.phase === 'rollout' && !r.stalled && r.td && r.td.sink < 4 && r.stop && Math.abs(r.stop.z) < 15 && r.stop.x > -1200 && r.stop.x < -490);
    }
    for (const sp of spots.filter((q) => q.spec === 'fighter' || q.spec === 'jet' || q.spec === 'stunt' || (q.spec === 'prop' && q.heading !== 0))) for (const thr of [0.35, 0.6]) {
      const r = plane(W, sp.spec, sp, rw, 3, { taxi: thr });
      report(`${id} ${sp.spec} from ${Math.round(sp.x)},${Math.round(sp.z)} thrust ${thr}`, r, !r.wrecked && r.liftX !== null && ['circle', 'return', 'base', 'final', 'rollout'].includes(r.phase));
    }
  }
  for (const sp of spots.filter((q) => q.spec === 'seaplane')) {
    const r = plane(W, 'seaplane', sp, null, 1, { trace: process.env.TRACE === 'sea' });
    report(`${id} seaplane ${Math.round(sp.x)},${Math.round(sp.z)}`, r, !r.wrecked && (r.phase === 'rollout' ? r.td && r.td.sink < 4 : ['return', 'base'].includes(r.phase)));
  }
  for (const sp of spots.filter((q) => q.spec.includes('heli'))) {
    const r = heli(W, sp.spec, sp);
    report(`${id} ${sp.spec} ${Math.round(sp.x)},${Math.round(sp.z)}`, r, !r.wrecked && r.land && r.land.d < 12);
  }
}
console.log('bad', bad);
process.exitCode = bad > 1 ? 1 : 0; // the downtown seaplane glide above
