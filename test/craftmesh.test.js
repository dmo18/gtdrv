// Craft meshes (boats, aircraft, tanks) and their pure helpers: shape
// maths, the shared detail texture, the visual rig, triangle budgets and
// the parts the game and the combat hooks rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airfoilHalf, chordShares, superPoint, monotone, detailPixels, blurPixels, stepAircraftRig, wrapAngle, storesLeft } from '../src/render/craftmath.js';
import { AIRCRAFT_SPECS, createAircraft } from '../src/entities/aircraft.js';
import { BOAT_SPECS, createBoat } from '../src/entities/boat.js';
import { TANK_SPECS, createTank } from '../src/entities/tank.js';
import { createAircraftMesh, updateAircraftMesh, aircraftStats, lightbarPhase, lightbarLevels } from '../src/render/aircraftmesh.js';
import { createBoatMesh, updateBoatMesh, boatStats } from '../src/render/boatmesh.js';
import { createTankMesh, updateTankMesh, tankStats } from '../src/render/tankmesh.js';
import { RIG } from '../src/render/hullkit.js';

test('airfoil is closed at both edges and thickest near 30% chord', () => {
  assert.equal(airfoilHalf(0, 0.12), 0);
  assert.ok(Math.abs(airfoilHalf(1, 0.12)) < 1e-3);
  let best = 0, at = 0;
  for (let u = 0; u <= 1; u += 0.01) {
    const h = airfoilHalf(u, 0.12);
    if (h > best) {
      best = h;
      at = u;
    }
  }
  assert.ok(at > 0.25 && at < 0.35, `max at ${at}`);
  assert.ok(Math.abs(best - 0.06) < 0.003, `half thickness ${best}`);
});

test('chord shares are sorted, clipped and include both ends', () => {
  const a = chordShares(8);
  assert.equal(a[0], 0);
  assert.equal(a[a.length - 1], 1);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1]);
  const b = chordShares(8, 0.75, 1);
  assert.equal(b[0], 0.75);
  assert.ok(b.every((u) => u >= 0.75 && u <= 1));
});

test('superellipse section spans its half width and heights', () => {
  const o = [0, 0];
  assert.deepEqual(superPoint(0, 1.5, 1, 0.5, 2, o).map((v) => +v.toFixed(6)), [1.5, 0]);
  superPoint(Math.PI / 2, 1.5, 1, 0.5, 2, o);
  assert.ok(Math.abs(o[1] - 1) < 1e-9);
  superPoint(-Math.PI / 2, 1.5, 1, 0.5, 2, o);
  assert.ok(Math.abs(o[1] + 0.5) < 1e-9);
  // Boxier with a larger exponent: the 45 degree point sits further out.
  const r2 = Math.hypot(...superPoint(Math.PI / 4, 1, 1, 1, 2, [0, 0]));
  const r6 = Math.hypot(...superPoint(Math.PI / 4, 1, 1, 1, 6, [0, 0]));
  assert.ok(r6 > r2 + 0.2);
});

test('monotone curve passes through its keys without overshoot', () => {
  const f = monotone([[0, 0], [1, 1], [2, 1], [3, 0]]);
  assert.equal(f(1), 1);
  assert.equal(f(-5), 0);
  for (let x = 0; x <= 3; x += 0.05) assert.ok(f(x) <= 1 + 1e-9 && f(x) >= -1e-9);
});

test('detail texture is seeded, tiling-sized and has seams, rivets, grime and camo', () => {
  const a = detailPixels(128, 7), b = detailPixels(128, 7), c = detailPixels(128, 8);
  assert.equal(a.length, 128 * 128 * 4);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  let seams = 0, rivets = 0, gMin = 255, gMax = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] > 200) seams++;
    if (a[i + 1] > 200) rivets++;
    gMin = Math.min(gMin, a[i + 2]);
    gMax = Math.max(gMax, a[i + 2]);
  }
  assert.ok(seams > 500 && seams < 128 * 128 * 0.25, `seams ${seams}`);
  assert.ok(rivets > 20, `rivets ${rivets}`);
  assert.ok(gMax - gMin > 60, 'grime varies');
  const blur = blurPixels(32, 4);
  assert.equal(blur[(0 * 32 + 0) * 4 + 3], 0, 'corner of the disc is clear');
  assert.ok(blur[(16 * 32 + 16) * 4 + 3] > 60, 'hub is opaque-ish');
});

test('aircraft rig: gear stays down on the ground, retracts when flying fast and high', () => {
  const a = createAircraft('fighter', 0, 0, 0);
  const st = { ail: 0, elev: 0, rud: 0, flap: 0, gear: 0, pitch: NaN };
  stepAircraftRig(st, a, 1 / 60);
  assert.equal(st.gear, 0);
  a.onGround = false;
  a.y = 200;
  a.airspeed = 120;
  a.driver = 'player';
  a.steer = 1;
  for (let i = 0; i < 300; i++) stepAircraftRig(st, a, 1 / 60);
  assert.equal(st.gear, 1);
  assert.ok(st.ail > 0.99, 'ailerons follow the stick');
  assert.equal(st.flap, 0);
  a.wrecked = true;
  for (let i = 0; i < 60; i++) stepAircraftRig(st, a, 1 / 60);
  assert.equal(st.ail, 0, 'a wreck has no live controls');
  assert.ok(Number.isFinite(st.elev));
});

test('wrapAngle and storesLeft', () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 7) - Math.PI) < 1e-9);
  assert.equal(wrapAngle(NaN), 0);
  assert.equal(storesLeft({}, 'missile', 2), 2);
  assert.equal(storesLeft({ arms: { mag: { missile: 1 } } }, 'missile', 2), 1);
  assert.equal(storesLeft({ arms: { mag: { bomb: 9 } } }, 'bomb', 6), 6);
});

test('every aircraft builds within the triangle budget with a coarser far LOD', () => {
  for (const id of Object.keys(AIRCRAFT_SPECS)) {
    const s = aircraftStats(AIRCRAFT_SPECS[id]);
    assert.ok(s.tris > 2500 && s.tris <= 12000, `${id} ${s.tris}`);
    assert.ok(s.farTris < s.tris * 0.6, `${id} far ${s.farTris}`);
  }
});

test('aircraft mesh keeps its hooks and draws in few calls', () => {
  for (const id of Object.keys(AIRCRAFT_SPECS)) {
    const a = createAircraft(id, 0, 0, 0);
    const m = createAircraftMesh(a.spec, a.color);
    const ud = m.userData;
    assert.ok(ud.body && ud.body.isMesh && ud.skin, id);
    assert.ok(ud.body.geometry.attributes.aHng && ud.body.geometry.attributes.aCls, `${id} rigged`);
    let near = 0;
    ud.lod.levels[0].object.traverse((o) => {
      if (o.isMesh) near++;
    });
    assert.ok(near <= 3, `${id} near meshes ${near}`);
    a.engineOn = true;
    a.rotorSpeed = 1;
    a.propSpin = 12345.6;
    a.hitT = 0.1;
    updateAircraftMesh(m, a, 0.5, 3);
    const r = ud.skin.userData.rig;
    for (const v of [r.r0, r.r1, r.r2]) assert.ok(Number.isFinite(v.x + v.y + v.z + v.w), id);
    assert.ok(r.r2.x >= 0 && r.r2.x < Math.PI * 2);
    if (ud.disc) assert.equal(ud.disc.visible, true, `${id} blur disc while spinning`);
    assert.ok(ud.skin.emissive.r > 0, 'hit flash');
  }
});

test('fighter: stores vanish with the magazine, afterburner glow, gear and surfaces rigged', () => {
  const a = createAircraft('fighter', 0, 0, 0);
  const m = createAircraftMesh(a.spec, a.color);
  const codes = new Set(m.userData.body.geometry.attributes.aHng.array.filter((_, i) => i % 4 === 0));
  for (const c of [RIG.AILERON, RIG.FLAP, RIG.RUDDER, RIG.TAIL_L, RIG.TAIL_R, RIG.GEAR, RIG.MISSILE, RIG.MISSILE + 1, RIG.BOMB, RIG.BOMB + 5, RIG.STROBE]) {
    assert.ok(codes.has(c), `code ${c}`);
  }
  a.arms = { mag: { missile: 1, bomb: 0 } };
  a.afterburner = 1;
  updateAircraftMesh(m, a, 1, 1);
  const r1 = m.userData.skin.userData.rig.r1;
  assert.equal(r1.y, 1);
  assert.equal(r1.z, 0);
  assert.equal(m.userData.glow.visible, true);
  const p = createAircraft('patrolheli', 0, 0, 0);
  const pm = createAircraftMesh(p.spec, p.color);
  assert.ok(pm.userData.lightbar && pm.userData.beam);
  updateAircraftMesh(pm, p, 1, 0.1);
  assert.equal(pm.userData.lightbar.visible, false, 'dark with the siren off');
  p.siren = true;
  const bar = pm.userData.bar;
  updateAircraftMesh(pm, p, 1, 0.1);
  assert.ok(pm.userData.lightbar.visible && bar.lr.visible && !bar.lb.visible && bar.gr.visible && !bar.gb.visible, 'red flash');
  updateAircraftMesh(pm, p, 1, 0.5);
  assert.ok(!bar.lr.visible && bar.lb.visible && bar.gb.visible && !bar.gr.visible, 'blue flash');
  // The two sides never light together, and levels move smoothly.
  let prev = lightbarLevels(0), jump = 0;
  for (let t = 0; t < 4; t += 1 / 60) {
    const f = lightbarLevels(t, { r: 0, b: 0 });
    assert.ok(!(f.r > 0 && f.b > 0));
    jump = Math.max(jump, Math.abs(f.r - prev.r), Math.abs(f.b - prev.b));
    prev = f;
  }
  assert.ok(jump < 0.45, `step ${jump}`);
  assert.equal(lightbarPhase(0), 0);
  // The beam: a soft open cone, aimed at the target, its world cone kept for the ground pool.
  p.spot = 1;
  p.spotAim = true;
  p.x = 0; p.y = 30; p.z = 0;
  p.spotX = 40; p.spotY = 0; p.spotZ = 0;
  updateAircraftMesh(pm, p, 1, 1);
  const sw = pm.userData.spotW;
  assert.ok(pm.userData.beam.visible && sw.on && sw.k === 1);
  assert.ok(sw.dy < -0.5 && sw.dx > 0.6 && Math.abs(sw.len - 50) < 3, JSON.stringify(sw));
  assert.ok(pm.userData.beam.material.uniforms.uK.value > 0);
});

test('boats build within budget, spray shows only under way', () => {
  for (const id of Object.keys(BOAT_SPECS)) {
    const s = boatStats(BOAT_SPECS[id]);
    assert.ok(s.tris > 1500 && s.tris <= 9000, `${id} ${s.tris}`);
    const b = createBoat(id, 0, 0, 0);
    const m = createBoatMesh(b.spec, b.color);
    updateBoatMesh(m, b, 1, 0);
    assert.equal(m.userData.spray.visible, false);
    b.speed = b.spec.maxSpeed * 0.8;
    b.throttle = 1;
    updateBoatMesh(m, b, 1, 0.5);
    assert.equal(m.userData.spray.visible, true, id);
    assert.ok(Number.isFinite(m.userData.skin.userData.rig.r2.x));
  }
});

test('tank: within budget, turret and gun hierarchy, tracks and wheels follow the phases', () => {
  for (const id of Object.keys(TANK_SPECS)) {
    const s = tankStats(TANK_SPECS[id]);
    assert.ok(s.tris > 5000 && s.tris <= 12000, `${id} ${s.tris}`);
  }
  const t = createTank('rustback', 0, 0, 0);
  const m = createTankMesh(t.spec, t.color);
  const ud = m.userData;
  assert.equal(ud.gun.parent, ud.turret);
  assert.equal(ud.barrel.parent, ud.gun);
  const codes = new Set(ud.hull.geometry.attributes.aHng.array.filter((_, i) => i % 4 === 0));
  for (const c of [RIG.TRACK_L, RIG.TRACK_R, RIG.WHEEL_L, RIG.WHEEL_R]) assert.ok(codes.has(c), `code ${c}`);
  t.turretYaw = t.pturretYaw = 0.5;
  t.gunPitch = t.pgunPitch = 0.1;
  t.trackPhaseL = 3;
  t.trackPhaseR = -2;
  t.recoil = 1;
  updateTankMesh(m, t, 1);
  assert.ok(Math.abs(ud.turret.rotation.y + 0.5) < 1e-9);
  assert.ok(Math.abs(ud.gun.rotation.z - 0.1) < 1e-9);
  assert.ok(ud.barrel.position.x < 0);
  assert.equal(ud.skin.userData.rig.r0.x, 3);
  assert.equal(ud.skin.userData.rig.r0.y, -2);
  t.wrecked = true;
  updateTankMesh(m, t, 1);
  assert.equal(ud.skin.userData.rig.dmg.y, 1, 'soot when wrecked');
});
