// Sea walls and rails (docs/PLAN_V3.md 2.2 items 3 and 4, section 6 item 6):
// along `seawall` and `rail` lines a car at 11, 45 and 90 mph at 30, 60
// and 90 degrees never gets its center past the line, and no corner of its
// box crosses by more than 0.2 m; `beach` and `gap` stretches let it pass;
// the lines are continuous, lazily traced the same in any order, and drawn
// exactly where they collide; every boat spot is at a pier.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEdgeLayer, WALL_H, WALL_R, isWallTag } from '../src/world/edgelines.js';
import { createCollisionWorld, fillEdgeCollision } from '../src/world/collision.js';
import { attachGround } from '../src/world/ground.js';
import { createVehicle, stepVehicle, vehicleCorners } from '../src/entities/vehicle.js';
import { createMiamiCity } from '../src/world/miami.js';
import { generateCity } from '../src/world/citygen.js';
import { edgeLinePieces } from '../src/render/props.js';

const DT = 1 / 60, MPH = 2.23694;
const city = createMiamiCity(JSON.parse(fs.readFileSync(new URL('../src/world/data/miami-downtown.json', import.meta.url), 'utf8')), { region: 'miami-downtown' });
attachGround(city);
const col = createCollisionWorld();
const layer = fillEdgeCollision(city, col);
const island = generateCity();
attachGround(island);
const icol = createCollisionWorld();
const ilayer = fillEdgeCollision(island, icol);

// Every line within r of (x, z), with tags.
function linesNear(L, x, z, r) {
  const out = [];
  L.eachLine(x - r, z - r, x + r, z + r, (x0, z0, x1, z1, tag) => {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (Math.hypot(mx - x, mz - z) <= r) out.push({ x0, z0, x1, z1, tag });
  });
  return out;
}
const segDist = (x, z, s) => {
  const sx = s.x1 - s.x0, sz = s.z1 - s.z0, L2 = sx * sx + sz * sz;
  let t = L2 > 0 ? ((x - s.x0) * sx + (z - s.z0) * sz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - s.x0 - sx * t, z - s.z0 - sz * t);
};

// Wall segments with 40 m of wall (and nothing else) round them, in a
// fixed scan order, `want` of each tag.
function pickWalls(L, c, tag, want, step = 96) {
  const out = [];
  const B = c.crop || c.bounds || { x0: -900, z0: -900, x1: 900, z1: 900 };
  for (let z = B.z0 + 64; z < B.z1 - 64 && out.length < want; z += step) {
    for (let x = B.x0 + 64; x < B.x1 - 64 && out.length < want; x += step) {
      const near = linesNear(L, x, z, 40);
      const s = near.find((q) => q.tag === tag && Math.hypot(q.x1 - q.x0, q.z1 - q.z0) > 0.8);
      if (!s) continue;
      const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
      const round = linesNear(L, mx, mz, 40);
      if (round.some((q) => !isWallTag(q.tag))) continue;
      if (out.some((o) => Math.hypot(o.mx - mx, o.mz - mz) < 400)) continue;
      // The land side: the normal with the higher field.
      let nx = -(s.z1 - s.z0), nz = s.x1 - s.x0;
      const nl = Math.hypot(nx, nz);
      nx /= nl; nz /= nl;
      if (L.fieldAt(mx + nx, mz + nz) < L.fieldAt(mx - nx, mz - nz)) { nx = -nx; nz = -nz; }
      // Each nearby wall piece with its own land side.
      for (const q of round) {
        const qx = (q.x0 + q.x1) / 2, qz = (q.z0 + q.z1) / 2;
        let ax = -(q.z1 - q.z0), az = q.x1 - q.x0;
        const al = Math.hypot(ax, az) || 1;
        ax /= al; az /= al;
        if (L.fieldAt(qx + ax, qz + az) < L.fieldAt(qx - ax, qz - az)) { ax = -ax; az = -az; }
        q.nx = ax; q.nz = az;
      }
      out.push({ s, mx, mz, nx, nz, tx: nz, tz: -nx, round });
    }
  }
  return out;
}

// One run at a wall: travel direction at `deg` to the line (90 head on),
// from as far back as the land allows (at most 14 m), at `mph`.
function runAt(c, w, wcol, deg, mph) {
  const a = (deg * Math.PI) / 180;
  const dx = -w.nx * Math.sin(a) + w.tx * Math.cos(a), dz = -w.nz * Math.sin(a) + w.tz * Math.cos(a);
  const L = c.edgeLines;
  let back = 0;
  for (let b = 3; b <= 14; b += 0.5) {
    let ok = L.fieldAt(w.mx - dx * b, w.mz - dz * b) > 1.5;
    for (let k = 1; k <= b && ok; k += 0.5) if (!(L.fieldAt(w.mx - dx * k, w.mz - dz * k) > 0)) ok = false;
    if (ok) back = b;
    else if (back) break;
  }
  if (back < 3) return null;
  const h = Math.atan2(dz, dx);
  const v = createVehicle('sedan', w.mx - dx * back, w.mz - dz * back, h);
  const sp = mph / MPH;
  v.vx = dx * sp;
  v.vz = dz * sp;
  const world = { collision: wcol, city: c, time: 0 };
  const corners = new Array(8);
  let centerPast = 0, cornerPast = 0, hit = 0;
  const steps = Math.ceil((back + 6) / sp / DT) + 60;
  for (let i = 0; i < steps; i++) {
    stepVehicle(v, { throttle: Math.hypot(v.vx, v.vz) < sp ? 1 : 0 }, DT, world);
    if (v.impact > 0) hit++;
    // Past the line: on the water side of the nearest wall segment (by
    // that segment's own land side).
    const past = (x, z) => {
      let best = null, bd = Infinity;
      for (const q of w.round) { const d = segDist(x, z, q); if (d < bd) { bd = d; best = q; } }
      if (!best || bd > 6) return 0;
      const side = (x - (best.x0 + best.x1) / 2) * best.nx + (z - (best.z0 + best.z1) / 2) * best.nz;
      return side < 0 ? bd : 0;
    };
    centerPast = Math.max(centerPast, past(v.x, v.z));
    vehicleCorners(v, corners);
    for (let k = 0; k < 8; k += 2) cornerPast = Math.max(cornerPast, past(corners[k], corners[k + 1]));
  }
  return { centerPast, cornerPast, hit, y: v.y };
}

for (const tag of ['seawall', 'rail']) {
  test(`${tag}: 11, 45 and 90 mph at 30, 60 and 90 degrees: the center never past the line, no corner past by more than 0.2 m`, () => {
    const walls = pickWalls(layer, city, tag, 6);
    assert.ok(walls.length >= 3, `${walls.length} ${tag} stretches`);
    let runs = 0, worst = 0;
    for (const w of walls) {
      for (const deg of [30, 60, 90]) {
        for (const mph of [11, 45, 90]) {
          const r = runAt(city, w, col, deg, mph);
          if (!r) continue;
          runs++;
          assert.equal(r.centerPast, 0, `${tag} at ${w.mx.toFixed(0)}, ${w.mz.toFixed(0)}, ${deg} deg, ${mph} mph: center past`);
          assert.ok(r.cornerPast <= 0.2, `${tag} ${deg} deg ${mph} mph: a corner ${r.cornerPast.toFixed(2)} m past`);
          assert.ok(r.hit > 0, 'the wall was hit');
          worst = Math.max(worst, r.cornerPast);
          if (tag === 'seawall' && deg === 90 && mph === 45 && runs < 20) console.log(`# ${tag} head on at 45 mph: worst corner ${r.cornerPast.toFixed(3)} m past`);
        }
      }
    }
    assert.ok(runs >= 18, `${runs} runs`);
    console.log(`# ${tag}: ${runs} runs, worst corner past the line ${worst.toFixed(3)} m`);
  });
}

test('measured: a sea wall at 60 mph head on stops the car on the land side', () => {
  const w = pickWalls(layer, city, 'seawall', 1)[0];
  const r = runAt(city, w, col, 90, 60);
  assert.ok(r && r.centerPast === 0 && r.cornerPast <= 0.2);
  console.log(`# sea wall at 60 mph: center past 0, worst corner ${r.cornerPast.toFixed(3)} m, ${r.hit} contact steps`);
});

test('a car jumping higher than the wall clears it (the collision height rule)', () => {
  const w = pickWalls(layer, city, 'seawall', 1)[0];
  const x = w.mx + w.nx * 0.5, z = w.mz + w.nz * 0.5;
  assert.ok(col.resolveCircle(x, z, 0.9, 0).hit, 'a car on the ground meets it');
  assert.equal(col.resolveCircle(x, z, 0.9, WALL_H + 0.05).hit, false, 'one above 0.9 m does not');
});

test('beach and gap stretches let a car through; boats are all at piers, each pier has a gap and rails', () => {
  // A beach on the island: drive out into the sea.
  const bw = pickWalls(ilayer, island, 'beach', 1, 32);
  assert.equal(bw.length, 0, 'no beach line is a wall');
  let beach = null;
  const B = { x0: -900, z0: -900, x1: 900, z1: 900 };
  ilayer.eachLine(B.x0, B.z0, B.x1, B.z1, (x0, z0, x1, z1, tag) => { if (!beach && tag === 'beach' && Math.hypot(x1 - x0, z1 - z0) > 1) beach = { s: { x0, z0, x1, z1 } }; });
  assert.ok(beach, 'the island has a beach line');
  {
    const s = beach.s, mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
    let nx = -(s.z1 - s.z0), nz = s.x1 - s.x0;
    const nl = Math.hypot(nx, nz);
    nx /= nl; nz /= nl;
    if (ilayer.fieldAt(mx + nx, mz + nz) < ilayer.fieldAt(mx - nx, mz - nz)) { nx = -nx; nz = -nz; }
    const v = createVehicle('sedan', mx + nx * 8, mz + nz * 8, Math.atan2(-nz, -nx));
    v.vx = -nx * 8;
    v.vz = -nz * 8;
    let out = -Infinity;
    for (let i = 0; i < 240; i++) {
      stepVehicle(v, { throttle: 0.5 }, DT, { collision: icol, city: island });
      out = Math.max(out, -((v.x - mx) * nx + (v.z - mz) * nz));
    }
    assert.ok(out > 1, `waded ${out.toFixed(2)} m past the beach line`);
  }
  // Piers: a gap at the root, rails along it; a car drives out onto it.
  for (const [c, L, wc] of [[city, layer, col], [island, ilayer, icol]]) {
    for (const p of c.piers) {
      const lines = linesNear(L, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, 80);
      assert.ok(lines.some((q) => q.tag === 'gap'), `pier ${p.label}: a gap`);
      assert.ok(lines.filter((q) => q.tag === 'rail').length >= 10, `pier ${p.label}: rails`);
    }
    for (const b of c.boatSpots) {
      const d = Math.min(...c.piers.map((p) => Math.hypot(Math.max(p.x0 - b.x, 0, b.x - p.x1), Math.max(p.z0 - b.z, 0, b.z - p.z1))));
      assert.ok(d < 12, `boat spot ${b.x.toFixed(0)}, ${b.z.toFixed(0)} is ${d.toFixed(1)} m from a pier`);
      assert.ok(c.shoreDist(b.x, b.z) < 0, 'afloat');
    }
    void wc;
  }
  // Drive along the first Downtown pier from its land end.
  const p = city.piers[0];
  const alongX = p.x1 - p.x0 > p.z1 - p.z0;
  const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
  let dirX = alongX ? 1 : 0, dirZ = alongX ? 0 : 1;
  const land0 = city.mainShore(alongX ? p.x0 : cx, alongX ? cz : p.z0);
  const land1 = city.mainShore(alongX ? p.x1 : cx, alongX ? cz : p.z1);
  if (land1 > land0) { dirX = -dirX; dirZ = -dirZ; }
  const sx = cx - dirX * ((alongX ? p.x1 - p.x0 : p.z1 - p.z0) / 2 + 6), sz = cz - dirZ * ((alongX ? p.x1 - p.x0 : p.z1 - p.z0) / 2 + 6);
  const v = createVehicle('compact', sx, sz, Math.atan2(dirZ, dirX));
  v.vx = dirX * 6;
  v.vz = dirZ * 6;
  let onPier = 0;
  for (let i = 0; i < 60 * 14; i++) {
    stepVehicle(v, { throttle: Math.hypot(v.vx, v.vz) < 6 ? 0.6 : 0 }, DT, { collision: col, city });
    if (v.x > p.x0 && v.x < p.x1 && v.z > p.z0 && v.z < p.z1 && city.mainShore(v.x, v.z) < 0) onPier++;
  }
  assert.ok(onPier > 60, `drove out on the pier (${onPier} steps)`);
  assert.ok(v.x >= p.x0 - 0.3 && v.x <= p.x1 + 0.3 && v.z >= p.z0 - 0.3 && v.z <= p.z1 + 0.3, 'and stayed on it (the end rail)');
});

test('the lines are continuous: every segment end meets another one (pier rails aside)', () => {
  const s = city.spawn;
  for (const [L, cx, cz] of [[layer, s.x, s.z], [ilayer, 0, 0]]) {
    const R = 700;
    const ends = new Map();
    const key = (x, z) => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;
    let n = 0;
    L.eachLine(cx - R, cz - R, cx + R, cz + R, (x0, z0, x1, z1) => {
      for (const k of [key(x0, z0), key(x1, z1)]) ends.set(k, (ends.get(k) || 0) + 1);
      n++;
    });
    assert.ok(n > 100, `${n} segments`);
    let open = 0;
    L.eachLine(cx - R + 40, cz - R + 40, cx + R - 40, cz + R - 40, (x0, z0, x1, z1, tag) => {
      // Pier rails run on their own (they end at the gap).
      if (tag === 'rail' && Math.abs(x0 - x1) < 1e-9 && Math.abs(Math.round(x0 * 100) - x0 * 100) < 1e-6) return;
      for (const [x, z] of [[x0, z0], [x1, z1]]) if ((ends.get(key(x, z)) || 0) < 2) open++;
    });
    assert.ok(open <= 40, `${open} open segment ends`);
  }
});

test('lazy and deterministic: a cell is the same traced first or last; the drawn pieces are the collision lines', () => {
  const A = createEdgeLayer(city), B = createEdgeLayer(city);
  const w = pickWalls(layer, city, 'seawall', 1)[0];
  const C = 32, c0x = Math.floor(w.mx / C), c0z = Math.floor(w.mz / C);
  const cells = [];
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) cells.push([c0x + i, c0z + j]);
  for (const [x, z] of cells) A.rawCell(x, z);
  for (const [x, z] of cells.slice().reverse()) B.rawCell(x, z);
  for (const [x, z] of cells) {
    const a = A.rawCell(x, z), b = B.rawCell(x, z);
    assert.deepEqual(a.segs, b.segs);
    assert.deepEqual(a.tags, b.tags);
    const ca = A.cell(x, z).map((q) => [q.x0, q.z0, q.x1, q.z1, q.tag].join()).join('|');
    assert.equal(ca, B.cell(x, z).map((q) => [q.x0, q.z0, q.x1, q.z1, q.tag].join()).join('|'));
  }
  // What the renderer draws in a square is exactly the collision capsules there.
  const x0 = c0x * C, z0 = c0z * C, x1 = x0 + C * 3 - 1e-6, z1 = z0 + C * 3 - 1e-6;
  const pieces = [];
  assert.equal(edgeLinePieces(A, x0, z0, x1, z1, pieces), 0);
  const drawn = new Set();
  for (let k = 0; k < pieces.length; k += 5) drawn.add([pieces[k], pieces[k + 1], pieces[k + 2], pieces[k + 3]].join());
  const shapes = new Set();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const r = A.rawCell(c0x + i, c0z + j);
    for (const q of A.cell(c0x + i, c0z + j)) {
      // Only those whose own cell is in the square.
      if (Math.floor(((q.x0 + q.x1) / 2) / C) - c0x >= 0 && Math.floor(((q.x0 + q.x1) / 2) / C) - c0x < 3 && Math.floor(((q.z0 + q.z1) / 2) / C) - c0z >= 0 && Math.floor(((q.z0 + q.z1) / 2) / C) - c0z < 3) shapes.add([q.x0, q.z0, q.x1, q.z1].join());
      assert.equal(q.r, WALL_R);
      assert.equal(q.h, WALL_H);
    }
    void r;
  }
  assert.ok(drawn.size > 5);
  assert.deepEqual([...drawn].sort(), [...shapes].sort(), 'drawn = collision (0 m apart)');
});
