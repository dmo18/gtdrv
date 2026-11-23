// Car and person mesh structure: triangle budgets per LOD, draw calls per
// car, wheel and tire profiles, the plate atlas, people looks and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';
import { buildCar, buildWheel, wheelLayout, wheelStyle, tireProfile, FLEET_MODELS, buildCarL1, buildCarL2, loftRings, eyePoint } from '../src/render/carbody.js';
import { createVehicleMesh, updateVehicleMesh, vehicleStats, MID_LOD_M, setVehicleLod, setVehicleNearLevel, FLEET_L0_M, FLEET_L2_M, FLEET_HIDE_M, FLEET_L0_MAX } from '../src/render/vehiclemesh.js';
import { lampAtlasPixels, PLATE_TEXT, CLS } from '../src/render/vehiclemats.js';
import * as THREE from 'three';
import { createPersonMesh, personGeometry, resolveLook, walkPose, PERSON_PALETTES, PERSON_LOD_M } from '../src/render/personmesh.js';

const tris = (g) => g.index.count / 3;

// The ten road vehicles (the reward cars are checked with them).
const ROAD = ['compact', 'sedan', 'taxi', 'police', 'sports', 'muscle', 'ghostwake', 'pickup', 'van', 'truck'];

test('car LOD triangle budgets: near 6k..9k, mid under 1.5k, far light', () => {
  for (const id of Object.keys(VEHICLE_SPECS)) {
    // The fleet bodies have their own levels (the fleet tests below).
    if (FLEET_MODELS.includes(id)) continue;
    const s = vehicleStats(VEHICLE_SPECS[id]);
    // Whole near car: body, glass with contact shadow, lamps, four wheels.
    assert.ok(s.near >= 6000 && s.near <= 9000, `${id} near total ${s.near}`);
    assert.ok(s.midAll < 1500, `${id} mid total ${s.midAll}`);
    assert.ok(s.far < 1500 && s.far > 300, `${id} far body ${s.far}`);
    assert.ok(s.wheelMid < s.wheel * 0.25, `${id} wheel LOD ${s.wheelMid} vs ${s.wheel}`);
    assert.ok(s.lampsMid < s.lamps * 0.3, `${id} lamp LOD ${s.lampsMid} vs ${s.lamps}`);
  }
  assert.ok(MID_LOD_M > 10 && MID_LOD_M < 75);
});

// Draw calls of a car mesh seen from distance d (LOD levels resolved).
function callsAt(m, d) {
  const cam = new THREE.PerspectiveCamera(50, 2, 0.3, 1000);
  cam.position.set(d, 1.5, 0);
  cam.updateMatrixWorld(true);
  m.updateMatrixWorld(true);
  m.traverse((o) => {
    if (o.isLOD) o.update(cam);
  });
  let n = 0;
  m.traverseVisible((o) => {
    if (o.isMesh) n++;
  });
  return n;
}

test('a car is 4 draw calls near and mid (5 with a light bar), 1 far', () => {
  for (const id of ['sedan', 'police', 'truck', 'compact']) {
    const spec = VEHICLE_SPECS[id];
    const m = createVehicleMesh(spec, spec.colors[0]);
    const ud = m.userData;
    const want = id === 'police' ? 5 : 4;
    assert.equal(callsAt(m, 6), want, id + ' near');
    assert.equal(callsAt(m, 40), want, id + ' mid');
    assert.equal(ud.far.visible, false);
    // Far LOD (game.js toggles head / tail / wheels) hides every near part.
    ud.head.visible = false;
    ud.tail.visible = false;
    for (const w of ud.wheels) w.visible = false;
    assert.equal(ud.bodyLod.visible, false);
    assert.equal(ud.glass.visible, false);
    assert.equal(ud.far.visible, true);
    assert.equal(callsAt(m, 90), 1, id + ' far');
    // Only bodies cast sun shadows.
    assert.equal(ud.rwShadow, true);
    assert.equal(ud.body.castShadow, true);
    assert.ok(!ud.head.castShadow && !ud.wheelLevels[0].castShadow && !ud.glassLevels[0].castShadow);
  }
});

test('near model: see-through glass, cabin, contact shadow, lamps that follow a crumple', () => {
  const classes = (g) => new Set(g.attributes.aCls.array);
  for (const id of ROAD) {
    const r = buildCar(VEHICLE_SPECS[id], true);
    const gc = classes(r.glass), bc = classes(r.body);
    assert.ok(gc.has(CLS.GLASS) && gc.has(CLS.SHADOW), id + ' glass and shadow');
    assert.ok(!bc.has(CLS.GLASS), id + ' no opaque glass in the near body');
    assert.ok(bc.has(CLS.CABIN), id + ' cabin');
    assert.equal(r.lamps.morphAttributes.position.length, 2, id + ' lamp crumple targets');
    // Shadow opacity (u) peaks under the sills and fades to 0 outside.
    const u = r.glass.attributes.uv, k = r.glass.attributes.aCls;
    let lo = 1, hi = 0;
    for (let i = 0; i < k.count; i++) {
      if (k.getX(i) !== CLS.SHADOW) continue;
      lo = Math.min(lo, u.getX(i));
      hi = Math.max(hi, u.getX(i));
    }
    assert.ok(lo === 0 && hi >= 0.7 && hi <= 0.9, `${id} shadow ${lo}..${hi}`);
    const mid = buildCar(VEHICLE_SPECS[id], true, true);
    assert.ok(classes(mid.body).has(CLS.GLASS) && classes(mid.glass).has(CLS.SHADOW), id + ' mid glass opaque, shadow kept');
  }
});

test('wheels: one instanced draw, front wheels steer and all spin', () => {
  const spec = VEHICLE_SPECS.sedan;
  const m = createVehicleMesh(spec, spec.colors[0]);
  const ud = m.userData;
  const v = { x: 0, z: 0, px: 0, pz: 0, heading: 0, pheading: 0, y: 0, spec, steerAngle: 0.3, wheelSpin: 1.1, health: spec.health };
  updateVehicleMesh(m, v, 1, 0);
  const a = ud.wheelLevels[0].instanceMatrix.array;
  assert.equal(ud.wheelLevels[0].count, 4);
  assert.equal(ud.wheelLevels[1].instanceMatrix, ud.wheelLevels[0].instanceMatrix);
  const mat = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const axle = (i) => {
    mat.fromArray(a, i * 16);
    mat.decompose(pos, q, sc);
    return { p: pos.clone(), z: new THREE.Vector3(0, 0, 1).applyQuaternion(q) };
  };
  const { ax, az, wr } = ud.anchors;
  const f = axle(0), r = axle(2), fl = axle(1);
  assert.ok(Math.abs(f.p.x - ax) < 1e-6 && Math.abs(f.p.z - az) < 1e-6 && Math.abs(f.p.y - wr) < 0.04);
  assert.ok(Math.abs(fl.p.z + az) < 1e-6);
  // Rear axle points straight out (+z), front axle turned by the steer.
  assert.ok(Math.abs(r.z.z - 1) < 1e-6);
  assert.ok(Math.abs(Math.atan2(f.z.x, f.z.z) - -0.3) < 1e-6 || Math.abs(Math.atan2(-f.z.x, f.z.z) - 0.3) < 1e-6);
  assert.ok(Math.abs(fl.z.z + Math.cos(0.3)) < 1e-6, 'left wheel faces outward');
});

// Side outline of a car at 50 m on a 915 x 412 screen with a 50 degree
// field of view (about 8.8 px per meter): the mid model (what draws at
// that distance) plus its lamps and light bar, rasterised.
function outline(id) {
  const spec = VEHICLE_SPECS[id];
  const pxm = 412 / (2 * 50 * Math.tan((25 * Math.PI) / 180));
  const r = buildCar(spec, true, true);
  const geos = [r.body, r.lamps];
  const Wp = 80, Hp = 36;
  const grid = new Uint8Array(Wp * Hp);
  const addGeo = (g, dy = 0, dx = 0) => {
    const P = g.attributes.position, I = g.index.array;
    for (let t = 0; t < I.length; t += 3) {
      const v = [0, 1, 2].map((k) => [(P.getX(I[t + k]) + dx) * pxm + Wp / 2, (P.getY(I[t + k]) + dy) * pxm]);
      const x0 = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0]))), x1 = Math.min(Wp - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(v[0][1], v[1][1], v[2][1]))), y1 = Math.min(Hp - 1, Math.ceil(Math.max(v[0][1], v[1][1], v[2][1])));
      const d = (v[1][1] - v[2][1]) * (v[0][0] - v[2][0]) + (v[2][0] - v[1][0]) * (v[0][1] - v[2][1]);
      if (Math.abs(d) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l1 = ((v[1][1] - v[2][1]) * (px - v[2][0]) + (v[2][0] - v[1][0]) * (py - v[2][1])) / d;
          const l2 = ((v[2][1] - v[0][1]) * (px - v[2][0]) + (v[0][0] - v[2][0]) * (py - v[2][1])) / d;
          if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) grid[y * Wp + x] = 1;
        }
      }
    }
  };
  for (const g of geos) if (g) addGeo(g);
  if (id === 'police') {
    const m = createVehicleMesh(spec, spec.colors[0]);
    addGeo(m.userData.bar.geometry, m.userData.bar.position.y, m.userData.bar.position.x);
  }
  // Wheels: discs at the axles.
  const { wr, ax } = wheelLayout(spec);
  for (const wx of [ax, -ax]) {
    for (let y = 0; y < Hp; y++) {
      for (let x = 0; x < Wp; x++) {
        if (Math.hypot((x + 0.5 - Wp / 2) / pxm - wx, (y + 0.5) / pxm - wr) <= wr) grid[y * Wp + x] = 1;
      }
    }
  }
  let h = 2166136261;
  for (let i = 0; i < grid.length; i++) h = Math.imul(h ^ grid[i], 16777619);
  return { grid, hash: (h >>> 0).toString(16) };
}

test('silhouettes: the ten road vehicles have distinct outlines at 50 m', () => {
  const o = ROAD.map((id) => [id, outline(id)]);
  assert.equal(new Set(o.map(([, s]) => s.hash)).size, ROAD.length, 'hashes differ');
  // And not by a stray pixel: every pair differs in at least 12 pixels.
  for (let i = 0; i < o.length; i++) {
    for (let j = i + 1; j < o.length; j++) {
      let d = 0;
      const a = o[i][1].grid, b = o[j][1].grid;
      for (let k = 0; k < a.length; k++) d += a[k] !== b[k] ? 1 : 0;
      assert.ok(d >= 12, `${o[i][0]} vs ${o[j][0]}: ${d} px apart`);
    }
  }
});

test('bodies are distinct: low sports car, tall van, truck with cab', () => {
  const box = (id) => {
    const g = buildCar(VEHICLE_SPECS[id], false).body;
    g.computeBoundingBox();
    return g.boundingBox;
  };
  const sports = box('sports'), van = box('van'), sedan = box('sedan');
  assert.ok(sports.max.y < sedan.max.y && sedan.max.y < van.max.y);
});

test('wheel styles: 5 to 10 spokes, several distinct looks', () => {
  const looks = new Set();
  for (const id of Object.keys(VEHICLE_SPECS)) {
    const w = wheelStyle(VEHICLE_SPECS[id]);
    assert.ok(w.spokes >= 5 && w.spokes <= 10, id);
    looks.add(w.spokes + w.kind + w.rim);
  }
  assert.ok(looks.size >= 6, `only ${looks.size} wheel looks`);
});

test('tire profile: symmetric, tread at the radius, bead on the rim', () => {
  const wr = 0.33, tw = 0.25;
  const p = tireProfile(wr, tw);
  const n = p.length;
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(p[k][0] - p[n - 1 - k][0]) < 1e-9);
    assert.ok(Math.abs(p[k][1] + p[n - 1 - k][1]) < 1e-9);
    assert.ok(p[k][0] <= wr + 1e-9 && Math.abs(p[k][1]) <= tw / 2 + 1e-9);
  }
  assert.equal(Math.max(...p.map((q) => q[0])), wr);
  assert.ok(p[0][0] < wr * 0.75);
  const { wr: r, tw: w } = wheelLayout(VEHICLE_SPECS.sedan);
  assert.ok(tris(buildWheel(r, w, 5, 0xffffff, 'twin')) > tris(buildWheel(r, w, 5, 0xffffff, 'twin', true)));
});

test('lamp atlas holds an invented plate with dark glyphs', () => {
  assert.match(PLATE_TEXT, /^[A-Z0-9 -]+$/);
  const d = lampAtlasPixels([0x111111, 0x222222, 0x333333, 0x444444, 0x555555]);
  assert.equal(d.length, 128 * 32 * 4);
  let dark = 0, light = 0;
  for (let y = 9; y < 23; y++) {
    for (let x = 81; x < 127; x++) {
      const r = d[(y * 128 + x) * 4];
      if (r < 0x30) dark++;
      else if (r > 0xc0) light++;
    }
  }
  assert.ok(dark > 40 && light > dark, `${dark} dark, ${light} light`);
  // Lens cells keep their base color.
  assert.equal(d[(16 * 128 + 8) * 4], 0x11);
  assert.equal(d[(16 * 128 + 72) * 4], 0x55);
});

test('people: police and crew looks are recognized from their colors', () => {
  const cop = resolveLook({ shirt: 0x26406b, trousers: 0x1a2233, skin: 0xb98060, hair: 0x22180f });
  assert.equal(cop.outfit, 'police');
  assert.equal(cop.hairStyle, 'cap');
  assert.ok(cop.vest != null);
  assert.equal(resolveLook({ shirt: 0x6e1f4f, trousers: 0x1c1a2c }).outfit, 'crew');
  assert.equal(resolveLook(PERSON_PALETTES[1]).outfit, 'jacket');
  assert.equal(resolveLook({}).outfit, 'tee');
});

test('people: near and far bodies, one skeleton, sensible triangle count', () => {
  for (const p of [...PERSON_PALETTES, { shirt: 0x26406b }, { shirt: 0x6e1f4f }]) {
    for (const g of [personGeometry(p, 0), personGeometry(p, 1)]) {
      assert.ok(g.attributes.skinIndex && g.attributes.skinWeight);
      const w = g.attributes.skinWeight;
      for (let i = 0; i < w.count; i += 37) assert.ok(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < 1e-5);
      const n = g.attributes.normal;
      for (let i = 0; i < n.count; i += 11) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3);
    }
  }
  const m = createPersonMesh(PERSON_PALETTES[3]);
  const P = m.userData.person;
  for (const k of ['body', 'torso', 'head', 'legL', 'legR', 'armL', 'armR', 'kneeL', 'elbowR']) assert.ok(P[k] && P[k].isBone, k);
  // Two LOD levels (near and far body), both skinned to the same skeleton.
  const skins = [];
  m.traverse((o) => {
    if (o.isMesh) skins.push(o);
  });
  assert.equal(skins.length, 2);
  assert.ok(skins.every((o) => o.isSkinnedMesh && o.skeleton === P.skin.skeleton));
  assert.ok(P.skin.isSkinnedMesh && P.skin.boundingSphere.radius > 0.9);
});

test('people: triangle budget near (1.5k..2.5k) and far (coarse)', () => {
  for (const p of [...PERSON_PALETTES, { shirt: 0x26406b }, { shirt: 0x6e1f4f }]) {
    const near = tris(personGeometry(p, 0)), far = tris(personGeometry(p, 1));
    assert.ok(near >= 1500 && near <= 2500, `near ${near}`);
    assert.ok(far >= 250 && far <= 800 && far < near * 0.35, `far ${far}`);
  }
  assert.ok(PERSON_LOD_M >= 30 && PERSON_LOD_M <= 50);
});

test('people: one draw call per person near and far', () => {
  const m = createPersonMesh(PERSON_PALETTES[0]);
  const cam = new THREE.PerspectiveCamera(50, 2, 0.3, 1000);
  const drawn = (d) => {
    cam.position.set(d, 1.6, 0);
    cam.updateMatrixWorld(true);
    m.updateMatrixWorld(true);
    m.userData.person.lod.update(cam);
    let n = 0;
    m.traverseVisible((o) => {
      if (o.isMesh) n++;
    });
    return n;
  };
  assert.equal(drawn(5), 1);
  assert.equal(m.userData.person.skin.visible, true);
  assert.equal(drawn(25), 1);
  assert.equal(drawn(80), 1);
  assert.equal(m.userData.person.far.visible, true);
  assert.equal(m.userData.person.skin.visible, false);
});

test('walk pose: legs swing opposite, knees only fold backward', () => {
  const o = {};
  for (let k = 0; k < 16; k++) {
    walkPose(k * 0.4, 0.8, o);
    assert.ok(Math.abs(o.legL + o.legR) < 1e-9);
    assert.ok(o.kneeL <= 0 && o.kneeR <= 0);
    assert.ok(o.bob >= 0 && o.elbow > 0);
  }
  walkPose(1, 0, o);
  assert.equal(o.legL, 0);
  assert.ok(Math.abs(o.kneeL) < 1e-9);
});

// ---- the fleet bodies (docs/FLEET.md): three levels, smooth, American --------------
test('fleet: the three bodies, each with a spec, an invented name and US paint', () => {
  assert.deepEqual(FLEET_MODELS, ['midsize', 'suv', 'crewcab']);
  for (const id of FLEET_MODELS) {
    const s = VEHICLE_SPECS[id];
    assert.ok(s && s.id === id && /^[A-Z][a-z]+$/.test(s.label), id);
    assert.ok(s.colors.length >= 5, id + ' palette');
  }
  // American proportions: long, wide, the SUV and the pickup tall.
  const m = VEHICLE_SPECS.midsize, u = VEHICLE_SPECS.suv, p = VEHICLE_SPECS.crewcab;
  assert.ok(m.length >= 4.8 && m.wheelBase >= 2.8 && m.width >= 1.84);
  assert.ok(u.length >= 5.2 && u.height >= 1.85 && u.width >= 2.0);
  assert.ok(p.length >= 5.8 && p.wheelBase >= 3.6 && p.height >= 1.9);
});

test('fleet: triangles per level (L0 about 6,000 with 4 draws, L1 about 1,200 in 1, L2 about 260 in 1)', () => {
  for (const id of FLEET_MODELS) {
    const spec = VEHICLE_SPECS[id];
    const s = vehicleStats(spec);
    assert.ok(s.fleet, id);
    assert.ok(s.near >= 5500 && s.near <= 6800, `${id} L0 ${s.near}`);
    assert.ok(s.midAll >= 1000 && s.midAll <= 1400, `${id} L1 ${s.midAll}`);
    assert.ok(s.far >= 220 && s.far <= 300, `${id} L2 ${s.far}`);
    assert.equal(tris(buildCarL1(spec)), s.midAll);
    assert.equal(tris(buildCarL2(spec)), s.far);
  }
  assert.ok(FLEET_L0_M === 20 && FLEET_L2_M === 60 && FLEET_HIDE_M === 170 && FLEET_L0_MAX === 4);
});

test('fleet: draw calls per level (4, 1, 1) and the level switches', () => {
  const drawn = (m) => {
    let n = 0;
    m.updateMatrixWorld(true);
    m.traverseVisible((o) => { if (o.isMesh) n++; });
    return n;
  };
  for (const id of FLEET_MODELS) {
    const spec = VEHICLE_SPECS[id];
    const m = createVehicleMesh(spec, spec.colors[0]);
    const ud = m.userData;
    assert.equal(drawn(m), 4, id + ' L0');
    assert.ok(ud.body.visible && ud.glass.visible && ud.lamps.visible && ud.wheels[0].visible);
    setVehicleNearLevel(m, 1);
    assert.equal(drawn(m), 1, id + ' L1');
    assert.ok(ud.bodyMid.visible && !ud.body.visible && !ud.glass.visible && !ud.lamps.visible && !ud.wheels[0].visible);
    setVehicleLod(m, true);
    assert.equal(drawn(m), 1, id + ' L2');
    assert.ok(ud.far.visible && !ud.bodyMid.visible);
    // game.js writes the wheels' and lamps' visibility for its 75 m rule.
    for (const w of ud.wheels) w.visible = true;
    ud.head.visible = true;
    assert.equal(ud.level, 1);
    assert.equal(drawn(m), 1, id + ' back to L1');
    setVehicleNearLevel(m, 0);
    assert.equal(drawn(m), 4, id + ' back to L0');
    // Only the body levels cast sun shadows.
    assert.ok(ud.body.castShadow && ud.bodyMid.castShadow && ud.far.castShadow && !ud.glass.castShadow);
  }
});

// Unit normal of face (i, r) of a ring grid P[i][r] (outward for these grids).
function faceN(P, i, r) {
  const a = P[i][r], b = P[i + 1][r], c = P[i + 1][r + 1], d = P[i][r + 1];
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(...n);
  return l < 1e-9 ? null : n.map((v) => v / l);
}
const angle = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

// Largest turn between faces next to each other along the length, over the
// bands `bands` of grid P, between x0 and x1, skipping faces that touch a
// crease station.
function worstTurn(P, bands, x0, x1, creases) {
  const near = (x) => creases.some((c) => Math.abs(x - c) < 0.02);
  let worst = 0, at = null;
  for (const r of bands) {
    for (let i = 0; i + 2 < P.length; i++) {
      const xa = P[i][r][0], xb = P[i + 1][r][0], xc = P[i + 2][r][0];
      if (xa < x0 || xc > x1 || near(xa) || near(xb) || near(xc)) continue;
      const n0 = faceN(P, i, r), n1 = faceN(P, i + 1, r);
      if (!n0 || !n1) continue;
      const t = angle(n0, n1);
      if (t > worst) { worst = t; at = [r, xb.toFixed(2)]; }
    }
  }
  return { worst, at };
}

test('fleet: smooth lofts, the turn between neighboring sections stays small except at creases', () => {
  // Per level: the largest turn between neighbors along the length (deg).
  const LIMIT = [14, 30, 50];
  for (const id of FLEET_MODELS) {
    const spec = VEHICLE_SPECS[id];
    for (const level of [0, 1, 2]) {
      const R = loftRings(spec, level);
      const { sh, gs } = R;
      const J = R.half;
      // Upper side, shoulder and deck bands of the right half (ring index
      // from J - 1 at the top center down), the nose and tail rounding
      // (0.45 m at each end) left out.
      const bands = [];
      for (let r = Math.floor(J / 2); r < J - 1; r++) bands.push(r);
      const lo = worstTurn(R.lower, bands, sh.x0 + 0.45, sh.x1 - 0.45, R.creases);
      assert.ok(lo.worst < LIMIT[level], `${id} L${level} body turns ${lo.worst.toFixed(1)} deg at ${lo.at}`);
      if (R.gh) {
        // Over the roof: windshield to roof to rear glass, the center band.
        const G = R.gh, GJ = (G[0].length + 1) / 2;
        const g = worstTurn(G, [GJ - 2], gs.xC + 0.05, gs.xA - 0.05, [gs.xC, gs.xA]);
        assert.ok(g.worst < LIMIT[level] * 1.6, `${id} L${level} roof turns ${g.worst.toFixed(1)} deg at ${g.at}`);
      }
    }
  }
});

test('fleet: not a box: sloped windshield, rounded hood falling to the nose, roof highest, wheel arches', () => {
  for (const id of FLEET_MODELS) {
    const spec = VEHICLE_SPECS[id];
    const { sh, gs } = loftRings(spec, 0);
    // Windshield raked: run over rise at least 0.9 (about 42 degrees from vertical).
    const rise = gs.roofY - gs.baseY(gs.xA), run = gs.xA - gs.xR1;
    assert.ok(run / rise > 0.9, `${id} windshield run ${run.toFixed(2)} rise ${rise.toFixed(2)}`);
    // Hood: from the windshield base the deck never rises toward the nose and drops
    // at least 6 cm over its last 40 cm; it crowns (center over edge).
    let prev = Infinity;
    for (let x = gs.xA; x <= sh.x1; x += 0.05) {
      const y = sh.top(x);
      assert.ok(y <= prev + 1e-6, `${id} hood rises at ${x.toFixed(2)}`);
      prev = y;
    }
    assert.ok(sh.top(sh.x1 - 0.4) - sh.top(sh.x1) > 0.06, `${id} nose rounds down`);
    const hx = (gs.xA + sh.x1) / 2;
    assert.ok(sh.top(hx) > sh.yc(hx) + 0.012, `${id} hood crown`);
    // Long hood: the windshield base at least 1.25 m behind the nose (an American
    // proportion), and the roof is the highest point.
    assert.ok(sh.x1 - gs.xA >= 1.25, `${id} hood ${(sh.x1 - gs.xA).toFixed(2)} m`);
    for (let x = sh.x0; x <= sh.x1; x += 0.1) assert.ok(sh.top(x) <= gs.roofY + gs.crown + 1e-6, `${id} deck over the roof at ${x.toFixed(1)}`);
    // Windshield: the glass climbs from its base to the roof without a dip.
    prev = -Infinity;
    for (let x = gs.xA; x >= gs.xR1; x -= 0.04) {
      const y = gs.roof(x);
      assert.ok(y >= prev - 1e-6, `${id} windshield dips at ${x.toFixed(2)}`);
      prev = y;
    }
    // Tumblehome: the roof is narrower than the glass base.
    const mx = (gs.xR0 + gs.xR1) / 2;
    const G = loftRings(spec, 0).gh;
    let gi = 0;
    for (let i = 0; i < G.length; i++) if (Math.abs(G[i][0][0] - mx) < Math.abs(G[gi][0][0] - mx)) gi = i;
    const ring = G[gi], top = ring[(ring.length - 1) / 2];
    const edge = ring.reduce((w, p) => (p[1] > top[1] - 0.06 ? Math.max(w, Math.abs(p[2])) : w), 0);
    assert.ok(edge < gs.baseW(mx) - 0.06, `${id} roof ${edge.toFixed(2)} vs base ${gs.baseW(mx).toFixed(2)}`);
    // Wheel arches: the sill lifts over each wheel to clear the tire.
    for (const wx of sh.wheels) {
      assert.ok(sh.bottom(wx) >= sh.wr + sh.R - 0.01, `${id} arch over ${wx}`);
      assert.ok(sh.bottom((sh.wheels[0] + sh.wheels[1]) / 2) < sh.bottom(wx) - 0.3, `${id} sill between the wheels`);
    }
    // Trunk or bed behind the cabin (no hatchback): a sedan's deck behind
    // the rear glass, a pickup's bed, an SUV's upright tailgate.
    if (id === 'midsize') assert.ok(gs.xC - sh.x0 > 0.75, 'sedan trunk');
    if (id === 'crewcab') assert.ok(sh.bed && sh.bed[1] - sh.bed[0] > 1.5, 'pickup bed');
    if (id === 'suv') assert.ok(gs.xR0 - gs.xC < 0.12, 'SUV upright tailgate');
  }
});

// Points of a geometry by class (aCls).
function classPts(g, cls) {
  const P = g.attributes.position, K = g.attributes.aCls, out = [];
  for (let i = 0; i < K.count; i++) if (K.getX(i) === cls) out.push([P.getX(i), P.getY(i), P.getZ(i)]);
  return out;
}

test('fleet: four wheels, rear plate only, head and tail lamps at every level', () => {
  for (const id of FLEET_MODELS) {
    const spec = VEHICLE_SPECS[id];
    const { wr, ax, az } = wheelLayout(spec);
    const near = buildCar(spec, true);
    // L0: four wheel instances; lamps: head (u < 0.5) and tail (u >= 0.5)
    // halves; the plate cells (u over 0.625 of a half) in the tail only.
    const m = createVehicleMesh(spec, spec.colors[0]);
    assert.equal(m.userData.wheelLevels[0].count, 4);
    const uv = near.lamps.attributes.uv, P = near.lamps.attributes.position;
    let head = 0, tail = 0, plateF = 0, plateR = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      if (u < 0.5) { if (u >= 0.3125) plateF++; else head++; } else if (u >= 0.8125) plateR++; else tail++;
      if (u >= 0.8125) assert.ok(P.getX(i) < 0, id + ' plate at the rear');
    }
    assert.ok(head > 50 && tail > 50 && plateR >= 4 && plateF === 0, `${id} lamps ${head}/${tail}, plates ${plateF}/${plateR}`);
    // L1 and L2: rubber around each of the four wheel centers, lamps (GLOW)
    // front and rear; the L1 plate (class PLATE) at the rear only.
    for (const g of [buildCarL1(spec), buildCarL2(spec)]) {
      const rub = classPts(g, CLS.RUBBER);
      for (const [wx, wz] of [[ax, az], [ax, -az], [-ax, az], [-ax, -az]]) {
        assert.ok(rub.some((p) => Math.abs(p[0] - wx) < wr + 0.01 && Math.sign(p[2]) === Math.sign(wz) && Math.abs(p[1] - wr) <= wr + 0.01), `${id} wheel at ${wx}, ${wz}`);
      }
      const glow = classPts(g, CLS.GLOW);
      assert.ok(glow.some((p) => p[0] > spec.length * 0.4) && glow.some((p) => p[0] < -spec.length * 0.4), id + ' lamps front and rear');
    }
    const plates = classPts(buildCarL1(spec), CLS.PLATE);
    assert.ok(plates.length >= 4 && plates.every((p) => p[0] < -spec.length * 0.4), id + ' L1 rear plate only');
  }
});

test('fleet: the driver sits on the left; the eye point in the spec is in the cabin', () => {
  for (const id of FLEET_MODELS) {
    const spec = VEHICLE_SPECS[id];
    const e = spec.eye;
    assert.ok(e && Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z), id);
    // Matches the cabin the near body is built with.
    const p = eyePoint(spec);
    assert.ok(Math.abs(p.x - e.x) < 0.02 && Math.abs(p.y - e.y) < 0.02 && Math.abs(p.z - e.z) < 0.02, `${id} eye ${JSON.stringify(e)} vs ${JSON.stringify(p)}`);
    // Left of the center line (-z), inside the body, under the roof, over the belt.
    const { gs } = loftRings(spec, 0);
    assert.ok(e.z < -0.25 && e.z > -spec.width / 2 + 0.2, `${id} eye z ${e.z}`);
    assert.ok(e.x > gs.xC && e.x < gs.xA - 0.6, `${id} eye x ${e.x}`);
    assert.ok(e.y > gs.baseY(e.x) + 0.15 && e.y < gs.roof(e.x) - 0.1, `${id} eye y ${e.y}`);
    // The steering wheel is in front of the left seat: the near body has
    // cabin parts at the eye's side ahead of the eye.
    const cab = classPts(buildCar(spec, true).body, CLS.CABIN).filter((q) => q[0] > e.x + 0.3 && q[0] < gs.xA && q[1] > gs.baseY(q[0]));
    const left = cab.filter((q) => q[2] < -0.15).length, right = cab.filter((q) => q[2] > 0.15).length;
    assert.ok(left > right, `${id} steering wheel side ${left} left, ${right} right`);
  }
  // Sedan eye lowest, the SUV and pickup high.
  assert.ok(VEHICLE_SPECS.midsize.eye.y < 1.3 && VEHICLE_SPECS.suv.eye.y > 1.5 && VEHICLE_SPECS.crewcab.eye.y > 1.5);
});
