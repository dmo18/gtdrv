// The cockpit interior kit and the measured cabin (src/render/carinterior.js,
// docs/PLAN_V3.md 2.8 and section 13, AIR): at most 1,800 triangles in four
// draws, the eye from the spec or the per-kind default framed for the
// cockpit, the windshield as the hero of the frame (glass, header, pillar
// and wheel limits measured by rasterizing the kit from the eye), the
// gauge atlas, the front shell (hood and fenders only), attach and detach
// leave the car exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VEHICLE_SPECS, createVehicle } from '../src/entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh } from '../src/render/vehiclemesh.js';
import { CLS } from '../src/render/vehiclemats.js';
import {
  carGeometry, measureCabin, eyePoint, hoodPoint, inCabin, buildInterior, attachInterior, frontShell, interiorLayout,
  pointTri, bodyClearance, EYE_DEFAULTS, WHEEL_MAX_DEG, COCKPIT_FOV_H, cockpitFov, LOOKS, lookOf, paintAtlas, DIAL,
} from '../src/render/carinterior.js';

const cars = Object.values(VEHICLE_SPECS).filter((s) => !s.kind || s.kind === 'car');
function cabinOf(spec) {
  const mesh = createVehicleMesh(spec);
  const g = carGeometry(mesh);
  return { mesh, g, cab: measureCabin(spec, g.body, g.glass) };
}

test('point to triangle distance', () => {
  assert.equal(pointTri(0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), 1);
  assert.ok(Math.abs(pointTri(2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) - 1) < 1e-12, 'nearest a corner');
  assert.ok(Math.abs(pointTri(0.5, 0, -1, 0, 0, 0, 1, 0, 0, 0, 0, 1) - 1) < 1e-12, 'nearest an edge');
});

test('every car: a cabin behind the windshield, an eye on the left inside it, a hood camera on the center line', () => {
  for (const spec of cars) {
    const { cab } = cabinOf(spec);
    assert.ok(cab.wsX > cab.rfX && cab.rfX > cab.rearX, `${spec.id}: windshield base ahead of its top, ahead of the cabin rear`);
    assert.ok(cab.rfY > cab.wsY, `${spec.id}: windshield rises`);
    const eye = eyePoint(spec, cab);
    assert.ok(eye.z < -0.15, `${spec.id}: driver on the left (${eye.z.toFixed(2)})`);
    assert.ok(inCabin(cab, eye), `${spec.id}: eye in the cabin`);
    const hp = hoodPoint(cab, eye);
    assert.equal(hp.z, 0);
    assert.equal(hp.y, eye.y, 'hood camera at the driver eye height');
    assert.ok(Math.abs(hp.x - cab.wsX) < 0.05, 'at the windshield base');
  }
});

test('the spec eye is used when it is inside the cabin; a placeholder falls back to the per-kind default', () => {
  const base = VEHICLE_SPECS.sedan;
  const { g } = cabinOf(base);
  const def = eyePoint(base, measureCabin(base, g.body, g.glass));
  assert.equal(def.fromSpec, false);
  assert.ok(EYE_DEFAULTS.sedan && EYE_DEFAULTS.suv && EYE_DEFAULTS.pickup && EYE_DEFAULTS.default);
  const withEye = { ...base, id: 'sedan-eye-test', eye: { x: def.x - 0.05, y: def.y - 0.02, z: def.z + 0.03 } };
  const cab2 = measureCabin(withEye, g.body, g.glass);
  const e2 = eyePoint(withEye, cab2);
  assert.equal(e2.fromSpec, true);
  // AIR: the spec eye is the seat; the cockpit framing (frameEye) may only
  // move it a little forward and up, to bring the cowl down to the dash
  // line of its class. The seat side (z) is kept exactly.
  const lk = lookOf(withEye);
  assert.equal(e2.z, withEye.eye.z);
  assert.ok(e2.x >= withEye.eye.x && e2.x <= withEye.eye.x + lk.fwd + 1e-9, `x ${e2.x}`);
  assert.ok(e2.y >= withEye.eye.y && e2.y <= withEye.eye.y + 0.2, `y ${e2.y}`);
  assert.ok(inCabin(cab2, e2));
  const cowl = Math.atan2(cab2.wsY - e2.y, cab2.wsX - e2.x) * 180 / Math.PI;
  assert.ok(cowl <= lk.dash + 0.5, `cowl at ${cowl.toFixed(1)} degrees`);
  const zero = { ...base, id: 'sedan-eye-zero', eye: { x: 0, y: 0, z: 0 } };
  assert.equal(eyePoint(zero, measureCabin(zero, g.body, g.glass)).fromSpec, false, 'an eye on the ground is not a driver');
  const right = { ...base, id: 'sedan-eye-right', eye: { x: def.x, y: def.y, z: -def.z } };
  assert.equal(eyePoint(right, measureCabin(right, g.body, g.glass)).fromSpec, false, 'right-hand drive is not American');
});

test('interior kit: 1,200 to 1,800 triangles, at most four draws, the parts in front of the driver', () => {
  for (const spec of cars) {
    const { cab } = cabinOf(spec);
    const eye = eyePoint(spec, cab);
    const it = buildInterior(spec, cab, eye);
    // The brief allows about 2,500; scripts/ui-test.mjs holds the kit to 1,800.
    assert.ok(it.tris >= 1200 && it.tris <= 1800, `${spec.id}: ${it.tris} triangles`);
    let draws = 0, counted = 0;
    it.group.traverse((o) => {
      if (!o.isMesh) return;
      draws++;
      counted += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    assert.equal(counted, it.tris);
    assert.ok(draws <= 4, `${draws} draws`);
    const lay = interiorLayout(cab, eye, spec);
    // A bus or truck wheel lies nearly flat (AIR), so in a short cab its
    // center sits a little higher: at least 0.1 m under the eye there.
    const flat = spec.body === 'bus' || spec.body === 'truck';
    assert.ok(lay.wheelX > eye.x + 0.45 && lay.wheelY < eye.y - (flat ? 0.1 : 0.2), `${spec.id}: wheel ahead and below the eye`);
    assert.ok(lay.clusterX > lay.wheelX && lay.clusterX < cab.wsX, 'cluster behind the wheel, under the glass');
    const big = spec.body === 'bus' || spec.body === 'truck';
    assert.ok(big ? lay.wheelR >= 0.19 : Math.abs(lay.wheelR - 0.19) < 0.01, `${spec.id}: wheel radius ${lay.wheelR}`);
    assert.ok(big ? lay.tilt > 50 * Math.PI / 180 : lay.tilt < 30 * Math.PI / 180, `${spec.id}: ${big ? 'flat bus wheel' : 'upright car wheel'}`);
    assert.ok(it.face.geometry.attributes.uv, 'the dials, needles and screen are mapped on the atlas');
    // Only the lit cabin material and the unlit dial material (two programs).
    const progs = new Set();
    it.group.traverse((o) => { if (o.isMesh) progs.add(o.material.type); });
    assert.deepEqual([...progs].sort(), ['MeshBasicMaterial', 'MeshLambertMaterial']);
  }
});

test('the steering wheel turns with the input, up to 90 degrees; the needles follow speed and rpm', () => {
  const spec = VEHICLE_SPECS.sedan;
  const { cab } = cabinOf(spec);
  const it = buildInterior(spec, cab, eyePoint(spec, cab));
  for (const steer of [-1, -0.5, 0, 0.25, 1, 1.4]) {
    it.update({ steer, speed: 10, rpm: 0.5 });
    const want = Math.max(-1, Math.min(1, steer)) * WHEEL_MAX_DEG;
    assert.equal(it.state.wheelDeg, want);
    assert.ok(Math.abs(it.spinner.rotation.z + (want * Math.PI) / 180) < 1e-12, 'clockwise for a right turn, as the driver sees it');
  }
  it.update({ steer: 0, speed: 0, rpm: 0 });
  const a0 = it.state.speedAngle;
  const pos = it.face.geometry.attributes.position;
  const before = Array.from(pos.array);
  it.update({ steer: 0, speed: 60 / 2.23694, rpm: 0.6 });
  assert.ok(Math.abs(it.state.mph - 60) < 1e-9);
  assert.ok(Math.abs(a0 - it.state.speedAngle - (60 / DIAL.mph) * 1.5 * Math.PI) < 1e-9, `speedometer at 60 of ${DIAL.mph} mph`);
  assert.ok(it.state.rpmAngle < a0, 'the tach needle moved up');
  let moved = 0;
  for (let i = 0; i < pos.array.length; i++) if (pos.array[i] !== before[i]) moved++;
  assert.ok(moved >= 12 && moved <= 24, `the two needles moved (${moved} coordinates)`);
  // The wheel's +z (toward the driver) points back and up along the column.
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(it.mount.quaternion);
  assert.ok(n.x < -0.8 && n.y > 0.3, `column axis ${n.x.toFixed(2)}, ${n.y.toFixed(2)}`);
});

test('front shell: only hood, fenders and nose (ahead of the windshield base), no cabin parts', () => {
  for (const id of ['sedan', 'suv', 'pickup', 'sports']) {
    const spec = VEHICLE_SPECS[id];
    if (!spec) continue;
    const { g, cab } = cabinOf(spec);
    const fs = frontShell(g.body, cab);
    const p = fs.attributes.position.array, ix = fs.index.array, cls = fs.attributes.aCls ? fs.attributes.aCls.array : null;
    assert.ok(ix.length / 3 > 200, `${id}: ${ix.length / 3} front triangles`);
    assert.ok(ix.length < g.body.index.count * 0.7, 'a part of the body');
    for (let t = 0; t < ix.length; t += 3) {
      const mx = (p[ix[t] * 3] + p[ix[t + 1] * 3] + p[ix[t + 2] * 3]) / 3;
      assert.ok(mx > cab.wsX - 0.03, 'ahead of the windshield base');
      if (cls) assert.notEqual(cls[ix[t]], CLS.CABIN);
    }
    assert.equal(fs.attributes.position, g.body.attributes.position, 'shares the body buffers');
  }
});

test('attach hides the exterior (front shell and shadow stay), detach restores every mesh exactly', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  v.mesh = createVehicleMesh(v.spec);
  updateVehicleMesh(v.mesh, v, 1);
  const before = [];
  v.mesh.traverse((o) => { if (o.isMesh) before.push([o, o.layers.mask, o.visible]); });
  const h = attachInterior(v);
  assert.ok(h && h.interior && h.front && h.shadow);
  const rig = v.mesh.userData.rig;
  assert.ok(rig.children.includes(h.interior.group));
  for (const [o] of before) {
    if (o.parent === rig || rig.children.includes(o.parent) || (o.parent && o.parent.parent === rig)) assert.equal(o.layers.mask, 0, 'exterior hidden');
  }
  assert.notEqual(h.front.layers.mask, 0);
  assert.equal(h.front.material, v.mesh.userData.body.material, 'the hood keeps the car paint');
  assert.equal(h.shadow.castShadow, true);
  assert.equal(h.shadow.material.colorWrite, false, 'the shadow copy draws nothing');
  v.steer = 1;
  h.update(v);
  assert.equal(h.interior.state.wheelDeg, 90);
  h.detach();
  assert.ok(!rig.children.includes(h.interior.group) && !rig.children.includes(h.front));
  for (const [o, mask, vis] of before) {
    assert.equal(o.layers.mask, mask);
    assert.equal(o.visible, vis);
  }
});

test('eye clearance helper sees the body shell', () => {
  const spec = VEHICLE_SPECS.sedan;
  const { g, cab } = cabinOf(spec);
  const eye = eyePoint(spec, cab);
  assert.ok(bodyClearance(g.body, eye.x, eye.y, eye.z, true) >= 0.15);
  assert.ok(bodyClearance(g.body, cab.wsX + 0.5, cab.hoodY + 0.01, 0, true) < 0.05, 'a point on the hood is on the body');
});

// ---- cockpit framing (AIR): rasterize the kit from the eye ----------------------
// Coverage of the interior kit seen from the eye with the cockpit camera
// (horizontal FOV 100, level), at a quarter of the phone resolution. What the
// kit does not cover is seen through the glass (sky, road, the hood).
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function frameOf(spec, W, H, S = 4) {
  const { cab } = cabinOf(spec);
  const eye = eyePoint(spec, cab);
  const it = buildInterior(spec, cab, eye);
  it.update({ steer: 0, speed: 0, rpm: 0 });
  const cam = new THREE.PerspectiveCamera(cockpitFov(W / H), W / H, 0.12, 100);
  cam.position.set(eye.x, eye.y, eye.z);
  cam.lookAt(eye.x + 1, eye.y, eye.z);
  cam.updateMatrixWorld(true);
  it.group.updateMatrixWorld(true);
  const w = Math.round(W / S), h = Math.round(H / S);
  const buf = new Int8Array(w * h).fill(-1), zb = new Float32Array(w * h).fill(Infinity);
  const names = [];
  const tag = (mesh, t) => {
    if (mesh === it.wheel) return 'wheel';
    if (mesh === it.face) return 'face';
    for (const [n, ranges] of Object.entries(it.parts)) for (const [a, b] of ranges) if (t >= a && t < b) return n;
    return 'other';
  };
  const v = new THREE.Vector3();
  let wheelOut = 0, wheelIn = 0;
  it.group.traverse((o) => {
    if (!o.isMesh) return;
    const pa = o.geometry.attributes.position, ix = o.geometry.index.array;
    for (let t = 0; t < ix.length; t += 3) {
      const name = tag(o, t / 3);
      if (!names.includes(name)) names.push(name);
      const li = names.indexOf(name);
      const poly = [];
      for (let j = 0; j < 3; j++) {
        v.fromBufferAttribute(pa, ix[t + j]).applyMatrix4(o.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        poly.push([v.x, v.y, v.z]);
      }
      const clip = [];
      for (let j = 0; j < 3; j++) {
        const a = poly[j], b = poly[(j + 1) % 3];
        const ia = -a[2] >= 0.12, ib = -b[2] >= 0.12;
        if (ia) clip.push(a);
        if (ia !== ib) { const k = (-0.12 - a[2]) / (b[2] - a[2]); clip.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, -0.12]); }
      }
      if (clip.length < 3) continue;
      const pr = clip.map((q) => {
        v.set(q[0], q[1], q[2]).applyMatrix4(cam.projectionMatrix);
        if (name === 'wheel') { if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) wheelOut++; else wheelIn++; }
        return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, -q[2]];
      });
      for (let f = 1; f + 1 < pr.length; f++) {
        const A = pr[0], B = pr[f], C = pr[f + 1];
        const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
        if (Math.abs(area) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
        const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const px = x + 0.5, py = y + 0.5;
            const u = ((B[0] - px) * (C[1] - py) - (C[0] - px) * (B[1] - py)) / area;
            const q = ((C[0] - px) * (A[1] - py) - (A[0] - px) * (C[1] - py)) / area;
            if (u < 0 || q < 0 || u + q > 1) continue;
            const z = u * A[2] + q * B[2] + (1 - u - q) * C[2];
            const k = y * w + x;
            if (z < zb[k]) { zb[k] = z; buf[k] = li; }
          }
        }
      }
    }
  });
  let glass = 0;
  const share = {};
  for (let k = 0; k < buf.length; k++) {
    if (buf[k] < 0) glass++;
    else share[names[buf[k]]] = (share[names[buf[k]]] || 0) + 1 / buf.length;
  }
  // Header band: rows from the top covered by the header or headliner, worst column (10 to 90 percent across).
  let header = 0;
  for (let x = Math.floor(w * 0.1); x < w * 0.9; x++) {
    let y = 0;
    while (y < h && buf[y * w + x] >= 0 && (names[buf[y * w + x]] === 'header' || names[buf[y * w + x]] === 'liner')) y++;
    header = Math.max(header, y / h);
  }
  // Pillar thickness: pixels over length of each A-pillar (left and right half).
  const pil = names.indexOf('pillars');
  const sides = [[], []];
  for (let k = 0; k < buf.length; k++) if (buf[k] === pil) sides[(k % w) < w / 2 ? 0 : 1].push([k % w, (k / w) | 0]);
  const pillars = sides.map((ps) => {
    if (!ps.length) return 0;
    let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
    for (const [x, y] of ps) { ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y); by = Math.max(by, y); }
    return ps.length / Math.max(1, Math.hypot(bx - ax, by - ay)) / w;
  });
  // Screen points (full resolution pixels): the rim's top, the cluster
  // face corners, the digital readout's top and bottom.
  const scr = (x, y, z) => { v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
  const L = it.layout;
  const rimTop = scr(L.wheelX + Math.sin(L.tilt) * (L.wheelR + L.rimR), L.wheelY + Math.cos(L.tilt) * (L.wheelR + L.rimR), eye.z);
  const cl = it.face.geometry.attributes.position.array;
  const cluster = [0, 1, 2, 3].map((k) => scr(cl[k * 3], cl[k * 3 + 1], cl[k * 3 + 2]));
  const r = it.readout[1], up = it.readoutH / 2;
  const n = norm3([eye.x - r[0], eye.y - r[1], 0]);
  const rt = scr(r[0] + n[1] * up, r[1] - n[0] * up, r[2]), rb = scr(r[0] - n[1] * up, r[1] + n[0] * up, r[2]);
  return { glass: glass / buf.length, header, pillars, wheelOut, wheelIn, share, it, rimTop, cluster, digitPx: rb[1] - rt[1], horizon: scr(eye.x + 50, eye.y, eye.z)[1] / H };
}

test('cockpit framing: the windshield is the hero at 915x412 and 748x360', () => {
  for (const id of ['sedan', 'suv', 'pickup', 'sports', 'van', 'truck', 'schoolbus']) {
    for (const [W, H] of [[915, 412], [748, 360]]) {
      const f = frameOf(VEHICLE_SPECS[id], W, H);
      const tag = `${id} ${W}x${H}`;
      assert.ok(f.glass >= 0.55, `${tag}: clear glass ${(f.glass * 100).toFixed(1)} percent`);
      assert.ok(f.header < 0.08, `${tag}: roof header ${(f.header * 100).toFixed(1)} percent of the height`);
      for (const p of f.pillars) assert.ok(p < 0.05, `${tag}: A-pillar ${(p * 100).toFixed(1)} percent of the width`);
      assert.ok(f.pillars[0] > 0.005, `${tag}: the driver's A-pillar is in view`);
      assert.ok((f.share.mirror || 0) > 0.002 && (f.share.mirror || 0) < 0.02, `${tag}: a small mirror (${((f.share.mirror || 0) * 100).toFixed(2)} percent)`);
      // A level look with a 100 degree horizontal FOV (the old 78 degree
      // vertical one was a fish-eye): the rim's top and every corner of the
      // gauge cluster in the frame, the mph readout at least 12 px tall,
      // the horizon at mid height, the road clear down to the rim.
      assert.ok(f.wheelIn > 0, `${tag}: the wheel is in the frame`);
      assert.ok(f.rimTop[1] > H * 0.56 && f.rimTop[1] < H * 0.9, `${tag}: rim top at ${(f.rimTop[1] / H * 100).toFixed(0)} percent of the height`);
      for (const c of f.cluster) assert.ok(c[0] > 0 && c[0] < W && c[1] > 0 && c[1] < H - 2, `${tag}: cluster corner ${c.map((q) => q.toFixed(0))} in the frame`);
      assert.ok(f.digitPx >= 12, `${tag}: mph digits ${f.digitPx.toFixed(1)} px tall`);
      assert.ok(Math.abs(f.horizon - 0.5) < 0.01, `${tag}: horizon at ${(f.horizon * 100).toFixed(0)} percent`);
      assert.ok((f.share.wheel || 0) > 0.008, `${tag}: the wheel shows`);
      assert.ok((f.share.face || 0) > 0.008, `${tag}: the gauges show`);
      assert.ok((f.share.dash || 0) > 0.05, `${tag}: the dash shows`);
    }
  }
});

test('per class: low cowl in cars, a taller dash in SUVs and pickups, a flat wheel in buses', () => {
  assert.ok(LOOKS.tall.dash > LOOKS.low.dash && LOOKS.tall.face > LOOKS.low.face);
  assert.ok(LOOKS.big.wheelR > LOOKS.low.wheelR && LOOKS.big.tilt > 45 && LOOKS.big.spokes === 4);
  assert.equal(lookOf(VEHICLE_SPECS.suv), LOOKS.tall);
  assert.equal(lookOf(VEHICLE_SPECS.pickup), LOOKS.tall);
  assert.equal(lookOf(VEHICLE_SPECS.sedan), LOOKS.low);
  assert.equal(lookOf(VEHICLE_SPECS.schoolbus), LOOKS.big);
  const eyeOf = (id) => { const { cab } = cabinOf(VEHICLE_SPECS[id]); return eyePoint(VEHICLE_SPECS[id], cab); };
  assert.ok(eyeOf('suv').y > eyeOf('sedan').y + 0.2 && eyeOf('pickup').y > eyeOf('sedan').y + 0.2, 'SUV and pickup sit higher');
});

test('gauge atlas: two round dials with ticks and numbers (mph and rpm), a stitched seam, the screen', () => {
  const calls = { text: [], strokes: 0, arcs: 0, rects: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'fillText') return (s) => calls.text.push(s);
      if (k === 'stroke') return () => calls.strokes++;
      if (k === 'arc') return () => calls.arcs++;
      if (k === 'fillRect') return () => calls.rects++;
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  paintAtlas(ctx);
  for (let v = 0; v <= DIAL.mph; v += 20) assert.ok(calls.text.includes(String(v)), `mph ${v}`);
  for (let v = 0; v <= DIAL.rpm; v++) assert.ok(calls.text.includes(String(v)), `rpm ${v}`);
  assert.ok(calls.text.includes('MPH') && calls.text.includes('RPM'));
  assert.ok(calls.strokes >= DIAL.mph / 10 + DIAL.rpm * 2 + 2, `${calls.strokes} tick strokes`);
  assert.ok(calls.arcs >= 4 && calls.rects > 100, 'dial faces, rings, grain, stitches');
});

test('cockpit FOV: 100 degrees across, the vertical one follows the screen; a digital mph readout', () => {
  assert.equal(COCKPIT_FOV_H, 100);
  assert.ok(Math.abs(cockpitFov(748 / 360) - 59.7) < 0.1, `748x360: ${cockpitFov(748 / 360).toFixed(2)}`);
  assert.ok(Math.abs(cockpitFov(915 / 412) - 56.4) < 0.1, `915x412: ${cockpitFov(915 / 412).toFixed(2)}`);
  const { cab } = cabinOf(VEHICLE_SPECS.sedan);
  const it = buildInterior(VEHICLE_SPECS.sedan, cab, eyePoint(VEHICLE_SPECS.sedan, cab));
  const uv = it.face.geometry.attributes.uv;
  const before = Array.from(uv.array.slice(-24));
  it.update({ speed: 60 / 2.23694, steer: 0 });
  assert.equal(it.state.shown, 60);
  const after = Array.from(uv.array.slice(-24));
  assert.notDeepEqual(after, before, 'the digits change with the speed');
  assert.deepEqual(after.slice(0, 8), before.slice(0, 8), 'the hundreds stay blank under 100 mph');
  const v0 = uv.version;
  it.update({ speed: 60.1 / 2.23694, steer: 0 });
  assert.equal(uv.version, v0, 'no upload while the shown speed holds');
});
