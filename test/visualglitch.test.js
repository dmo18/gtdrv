// 0.13.9 visual glitches (docs/STATUS.md): checks for the sorting and
// layering faults found in the phone-resolution sweep that a node test can
// hold (scripts/glitch-seq.mjs measures the rest in frames).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDayNight, SKY_ORDER, BEHIND_GLASS } from '../src/systems/daynight.js';
import { createVehicleMesh, GLASS_ORDER } from '../src/render/vehiclemesh.js';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';
import { BOAT_SPECS } from '../src/entities/boat.js';
import { AIRCRAFT_SPECS } from '../src/entities/aircraft.js';
import { createBoatMesh } from '../src/render/boatmesh.js';
import { createAircraftMesh } from '../src/render/aircraftmesh.js';

// See-through glass (transparent, no depth write) in a vehicle's mesh.
function glassOrders(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => m && m.transparent && !m.depthWrite && m.blending === THREE.NormalBlending && /glass/i.test(o.name + ' ' + (m.name || '') + ' ' + (m.customProgramCacheKey ? m.customProgramCacheKey() : '')))) out.push(o.renderOrder);
  });
  return out;
}

test('rain, lamp glows, wet streaks and clouds draw before any vehicle glass (no rain or clouds over windows)', () => {
  const scene = new THREE.Scene();
  const game = { clock: 13, scene, camera: new THREE.PerspectiveCamera(60, 2, 0.5, 2000), cityMesh: { userData: { lamps: [{ x: 0, z: 0, h: 7 }], glows: [] } } };
  createDayNight(game, { dayMinutes: 14 });
  const order = (n) => {
    const o = scene.getObjectByName(n);
    assert.ok(o, n);
    return o.renderOrder;
  };
  // The sky first of all the see-through layers.
  for (const n of ['sky-dome', 'stars', 'clouds']) assert.ok(order(n) < 0, n);
  assert.equal(order('clouds'), SKY_ORDER.clouds);
  // The rain, the lamp glows (and the wet streaks when built) after the
  // ground's decals (order 0) and before the glass.
  for (const n of ['rain', 'lamp-glow']) {
    assert.ok(order(n) > 0 && order(n) < GLASS_ORDER, n);
  }
  for (const k of Object.values(BEHIND_GLASS)) assert.ok(k > 0 && k < GLASS_ORDER);
  // Every vehicle's glass at GLASS_ORDER or later.
  let n = 0;
  for (const id of Object.keys(VEHICLE_SPECS)) {
    const spec = VEHICLE_SPECS[id];
    const os = glassOrders(createVehicleMesh(spec, spec.colors[0]));
    assert.ok(os.length > 0, `${id} has glass`);
    for (const o of os) assert.ok(o >= GLASS_ORDER, `${id} glass order ${o}`);
    n += os.length;
  }
  for (const [id, spec] of Object.entries(BOAT_SPECS)) for (const o of glassOrders(createBoatMesh(spec, spec.colors ? spec.colors[0] : 0xffffff))) { assert.ok(o >= GLASS_ORDER, `boat ${id} ${o}`); n++; }
  for (const [id, spec] of Object.entries(AIRCRAFT_SPECS)) for (const o of glassOrders(createAircraftMesh(spec, spec.colors ? spec.colors[0] : 0xffffff))) { assert.ok(o >= GLASS_ORDER, `aircraft ${id} ${o}`); n++; }
  assert.ok(n > Object.keys(VEHICLE_SPECS).length);
});

// ---- the sun's shadow frame (render/shadowframe.js) ----
import { createShadowFrame, shadowFrame, shadowMapXY } from '../src/render/shadowframe.js';
import { skyAt } from '../src/systems/daynight.js';

// The sun at the clock (graphics.js reads it every frame), or as the sky
// applied it before (daynight.js: a new sky every 1/150 h, about every 18
// frames at the 14 minute day).
const SKY = {};
function sunAt(hour, out, stepped = false) {
  skyAt(stepped ? Math.round(hour * 150) / 150 : hour, SKY);
  out.x = SKY.sunDirX; out.y = SKY.sunDirY; out.z = SKY.sunDirZ;
  return out;
}
const frac = (v, t) => v / t - Math.floor(v / t);
const dphase = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1 - d); };

test('shadow frame: a sun ray falls on one map point, the focus in the middle, depth toward the sun', () => {
  const st = createShadowFrame(), p = {}, q = {}, s = sunAt(15.2, {});
  const texel = 144 / 2048, D = 260;
  shadowFrame(st, s.x, s.y, s.z, 4871.3, -233.9, texel, D);
  const f = shadowMapXY(st, st.tx, 0, st.tz, {});
  assert.ok(Math.abs(f.x) < 1e-9 && Math.abs(f.y) < 1e-9, 'focus centered');
  assert.ok(Math.abs(f.z + D) < 0.5 && Math.abs(st.tx - 4871.3) <= texel / 2 && Math.abs(st.tz + 233.9) <= texel / 2);
  // A point and the point 40 m up the sun ray: one map point, nearer the sun.
  shadowMapXY(st, 4890, 0, -220, p);
  shadowMapXY(st, 4890 + s.x * 40, s.y * 40, -220 + s.z * 40, q);
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-9);
  assert.ok(Math.abs(q.z - p.z - 40) < 1e-9);
  // The ground's map point does not depend on the sun.
  const s2 = sunAt(17.6, {});
  const st2 = shadowFrame(createShadowFrame(), s2.x, s2.y, s2.z, 4871.3, -233.9, texel, D);
  shadowMapXY(st2, 4890, 0, -220, q);
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-9);
});

// Where on its texel a shadow caster's point falls, frame to frame: a jump
// of a good part of a texel redraws its shadow edge on other texels (the
// shimmer); a crawl of a few hundredths moves it smoothly.
function phaseSteps(frameFn) {
  const texel = 144 / 2048;
  // Lamp-post tops and ground points round the camera, 4.9 km from the
  // world origin, ten seconds at 12 m/s, the 14 minute day.
  const pts = [];
  for (let i = 0; i < 9; i++) pts.push([4900 + i * 7.3, (i % 3) * 4, -120 + i * 4.1]);
  const last = new Float64Array(pts.length * 2);
  let worst = 0, jumps = 0, hour = 9.4, fx = 4880, fz = -130;
  for (let f = 0; f < 600; f++) {
    const skip = frameFn(hour, fx, fz, pts, texel, last, f);
    if (skip !== null) {
      for (let k = 0; k < skip.length; k++) {
        const d = skip[k];
        worst = Math.max(worst, d);
        if (d > 0.15) jumps++;
      }
    }
    hour += 24 / (14 * 60 * 60);
    fx += 0.2; fz += 0.05;
  }
  return { worst, jumps };
}

test('shadow frame: the texel grid holds still as the sun moves and the camera drives (no shadow shimmer)', () => {
  const D = 260, st = createShadowFrame(), s = {}, m = {};
  const r = phaseSteps((hour, fx, fz, pts, texel, last, f) => {
    sunAt(hour, s);
    shadowFrame(st, s.x, s.y, s.z, fx, fz, texel, D);
    const out = f > 0 ? [] : null;
    pts.forEach(([x, y, z], k) => {
      shadowMapXY(st, x, y, z, m);
      const px = frac(m.x, texel), py = frac(m.y, texel);
      if (out) out.push(dphase(px, last[k * 2]), dphase(py, last[k * 2 + 1]));
      last[k * 2] = px; last[k * 2 + 1] = py;
    });
    return out;
  });
  // (Ground points do not move at all; points 4 and 8 m up move with the
  // sun, under a twentieth of a texel a frame.)
  assert.ok(r.worst < 0.05, `worst phase step ${r.worst.toFixed(4)} of a texel`);
  assert.equal(r.jumps, 0);
  // The old frame (axes turned with the stepped sun, snapped from the world
  // origin) jumped by much of a texel at every sky step.
  const old = phaseSteps((hour, fx, fz, pts, texel, last, f) => {
    sunAt(hour, s, true);
    let rx = s.z, rz = -s.x;
    const rl = Math.hypot(rx, rz);
    rx /= rl; rz /= rl;
    const ux = s.y * rz, uy = s.z * rx - s.x * rz, uz = -s.y * rx;
    const out = f > 0 ? [] : null;
    pts.forEach(([x, y, z], k) => {
      const px = frac(x * rx + z * rz, texel), py = frac(x * ux + y * uy + z * uz, texel);
      if (out) out.push(dphase(px, last[k * 2]), dphase(py, last[k * 2 + 1]));
      last[k * 2] = px; last[k * 2 + 1] = py;
    });
    return out;
  });
  assert.ok(old.jumps > 100, `the old frame's jumps: ${old.jumps}`);
});

test('the alpha-tested detail panels (fences, sign cut-outs) use alpha to coverage, nothing else changes', async () => {
  const { patchCityMaterials } = await import('../src/render/citypatch.js');
  const detailMat = new THREE.MeshStandardMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
  const paintMat = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  const plain = new THREE.MeshStandardMaterial();
  patchCityMaterials({ detailMat, paintMat, plain });
  assert.equal(detailMat.alphaToCoverage, true);
  assert.equal(detailMat.alphaTest, 0.5, 'the cut stays for a canvas without MSAA');
  assert.equal(paintMat.alphaToCoverage, false);
  assert.equal(plain.alphaToCoverage, false);
});

test('the far sea plane stays clear under the near patch rim (no z-fighting square 200 m out)', async () => {
  const { createWater, FAR_PLANE_Y, NEAR_RIM_Y } = await import('../src/render/water.js');
  const w = createWater({ shoreDist: (x) => -x });
  // At 200 m a 24-bit depth step is about 5 mm: keep 5 cm.
  assert.ok(NEAR_RIM_Y - FAR_PLANE_Y >= 0.05);
  assert.ok(Math.abs(w.far.position.y - FAR_PLANE_Y) < 1e-9);
  w.update(12.5, new THREE.Vector3(5123, 30, -812));
  assert.ok(Math.abs(w.far.position.y - FAR_PLANE_Y) < 1e-9);
  // The near patch's shader puts its rim at NEAR_RIM_Y (the mix toward it).
  const sh = { vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <color_fragment>\n#include <normal_fragment_maps>', uniforms: {} };
  w.near.material.onBeforeCompile(sh);
  assert.ok(sh.vertexShader.includes(`mix(${NEAR_RIM_Y}, rwRaw, rwF)`), 'the rim height in the shader');
  assert.ok(NEAR_RIM_Y > -0.31 && NEAR_RIM_Y < -0.24 - 0.04, 'the rim stays under the deepest trough');
});
