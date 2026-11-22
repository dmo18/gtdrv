// Car and person mesh structure: triangle budgets per LOD, draw calls per
// car, wheel and tyre profiles, the plate atlas, people looks and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';
import { buildCar, buildWheel, wheelLayout, wheelStyle, tyreProfile } from '../src/render/carbody.js';
import { createVehicleMesh, vehicleStats, MID_LOD_M } from '../src/render/vehiclemesh.js';
import { lampAtlasPixels, PLATE_TEXT } from '../src/render/vehiclemats.js';
import * as THREE from 'three';
import { createPersonMesh, personGeometry, resolveLook, walkPose, PERSON_PALETTES, PERSON_LOD_M } from '../src/render/personmesh.js';

const tris = (g) => g.index.count / 3;

test('car bodies: near, mid and far LOD triangle budgets', () => {
  for (const id of Object.keys(VEHICLE_SPECS)) {
    const s = vehicleStats(VEHICLE_SPECS[id]);
    assert.ok(s.body >= 5000 && s.body <= 10000, `${id} near body ${s.body}`);
    assert.ok(s.mid < s.body * 0.65, `${id} mid body ${s.mid} vs ${s.body}`);
    assert.ok(s.far < 1500 && s.far > 300, `${id} far body ${s.far}`);
    assert.ok(s.wheelMid < s.wheel * 0.6, `${id} wheel LOD ${s.wheelMid} vs ${s.wheel}`);
    // Whole near car (body, lamps, four wheels) stays in the 6k..16k band.
    const total = s.body + s.head + s.tail + 4 * s.wheel;
    assert.ok(total >= 6000 && total <= 16000, `${id} near total ${total}`);
  }
  assert.ok(MID_LOD_M > 10 && MID_LOD_M < 75);
});

test('near car is 7 draw calls (8 with a light bar), far car is 1', () => {
  for (const id of ['sedan', 'police', 'truck']) {
    const spec = VEHICLE_SPECS[id];
    const m = createVehicleMesh(spec, spec.colors[0]);
    const ud = m.userData;
    let near = 0;
    m.traverse((o) => {
      if (!o.isMesh || o === ud.far) return;
      // Inside an LOD only one level draws at a time.
      if (o.parent && o.parent.isLOD && o.parent.levels[0].object !== o) return;
      near++;
    });
    assert.equal(near, id === 'police' ? 8 : 7, id);
    assert.equal(ud.far.visible, false);
    // Far LOD hides every near part.
    ud.head.visible = false;
    assert.equal(ud.bodyLod.visible, false);
    assert.equal(ud.far.visible, true);
    // Only bodies cast sun shadows.
    assert.equal(ud.rwShadow, true);
    assert.equal(ud.body.castShadow, true);
    assert.ok(!ud.head.castShadow && !ud.wheels[0].levels[0].object.castShadow);
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

test('tyre profile: symmetric, tread at the radius, bead on the rim', () => {
  const wr = 0.33, tw = 0.25;
  const p = tyreProfile(wr, tw);
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
  assert.match(PLATE_TEXT, /^[A-Z0-9-]+$/);
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
  // Lens cells keep their base colour.
  assert.equal(d[(16 * 128 + 8) * 4], 0x11);
  assert.equal(d[(16 * 128 + 72) * 4], 0x55);
});

test('people: police and crew looks are recognised from their colours', () => {
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
