// Solid props (docs/PLAN_V3.md 2.2 items 1 and 2, section 6 item 4): every
// prop type a city emits is in PROP_SOLIDS (a census of the real output
// and of the generators' sources); a sedan at 11, 34 and 67 mph from four
// directions never passes through a solid prop; a breakable one stops it
// below its break speed and shears above it with one break; the prop
// layer is lazy and the same whatever order its cells are touched in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROP_SOLIDS, propShapes, propCensus, createPropLayer, eachStreetProp } from '../src/world/propsolid.js';
import { createCollisionWorld, fillCollision, addLotSolids, BREAK_BACK_T, BREAK_BACK_FAR } from '../src/world/collision.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { generateCity } from '../src/world/citygen.js';
import { createMiamiCity } from '../src/world/miami.js';
import { dressLot } from '../src/world/lots.js';

const DT = 1 / 60, MPH = 2.23694;
const load = (id) => JSON.parse(fs.readFileSync(new URL(`../src/world/data/${id}.json`, import.meta.url), 'utf8'));
let downtown = null, beach = null;
const miami = () => downtown || (downtown = createMiamiCity(load('miami-downtown'), { region: 'miami-downtown' }));
const miamiBeach = () => beach || (beach = createMiamiCity(load('miami-beach'), { region: 'miami-beach' }));
const island = generateCity();

// ---- the census ----
function typesOf(census) {
  const out = new Set();
  for (const src of Object.keys(census)) for (const t of Object.keys(census[src])) out.add(t);
  return out;
}

test('census: every prop type the island and two Miami regions emit is in PROP_SOLIDS', () => {
  const missing = [];
  for (const [name, city] of [['island', island], ['miami-downtown', miami()], ['miami-beach', miamiBeach()]]) {
    const census = propCensus(city, dressLot);
    for (const t of typesOf(census)) if (!PROP_SOLIDS[t]) missing.push(`${name}: ${t}`);
    assert.ok(Object.keys(census.props).length && Object.keys(census.furniture).length, `${name} has props and furniture`);
  }
  assert.deepEqual(missing, [], 'prop types missing from PROP_SOLIDS');
});

test('census: every kind the generators can write (source scan) is in PROP_SOLIDS', () => {
  const read = (f) => fs.readFileSync(new URL(`../src/world/${f}`, import.meta.url), 'utf8');
  const kinds = new Set();
  const lots = read('lots.js');
  for (const m of lots.matchAll(/\b(?:put|putLong)\('([a-z]+)'/g)) kinds.add(m[1]);
  for (const m of lots.matchAll(/\bscatter\([^,]+, (?:rng\.chance\([^)]*\) \? )?'([a-z]+)'(?: : '([a-z]+)')?/g)) { kinds.add(m[1]); if (m[2]) kinds.add(m[2]); }
  for (const m of lots.matchAll(/bound: \[([^\]]*)\]/g)) for (const k of m[1].matchAll(/'([a-z]+)'/g)) kinds.add(k[1]);
  for (const m of lots.matchAll(/\bboundary\([^)]*'([a-z]+)'/g)) kinds.add(m[1]);
  for (const f of ['citygen.js', 'miami.js', 'regioncontent.js']) {
    const src = read(f);
    for (const m of src.matchAll(/(?:props|furniture)\.push\(\{\s*type: '([a-z]+)'/g)) kinds.add(m[1]);
    for (const m of src.matchAll(/(?:props|furniture)\.push\(\{\s*type: [^'{}]*\? '([a-z]+)' : '([a-z]+)'/g)) { kinds.add(m[1]); kinds.add(m[2]); }
  }
  // The street furniture lists by district (citygen SMALL).
  const gen = read('citygen.js');
  const small = gen.match(/const SMALL = \{([\s\S]*?)\};/);
  if (small) for (const m of small[1].matchAll(/'([a-z]+)'/g)) kinds.add(m[1]);
  for (const k of ['downtown', 'midtown', 'residential', 'beach', 'docks', 'industrial', 'park', 'plaza']) kinds.delete(k);
  assert.ok(kinds.size >= 20, `${kinds.size} kinds found`);
  const missing = [...kinds].filter((k) => !PROP_SOLIDS[k]);
  assert.deepEqual(missing, [], 'kinds in the sources missing from PROP_SOLIDS');
});

test('table: every entry has a mode, and solid / break entries a shape, a height and (break) a speed and a slow', () => {
  for (const [t, e] of Object.entries(PROP_SOLIDS)) {
    assert.ok(['solid', 'break', 'flat'].includes(e.mode), `${t} mode`);
    if (e.mode === 'flat') continue;
    assert.ok(e.r || e.box, `${t} shape`);
    assert.ok(e.h === 'feat' || e.h > 0, `${t} height`);
    if (e.mode === 'break') {
      assert.ok(e.breakSpeed >= 3 && e.breakSpeed <= 8, `${t} breakSpeed ${e.breakSpeed}`);
      assert.ok(e.slow > 0 && e.slow <= 0.12, `${t} slow ${e.slow}`);
    }
  }
  // The plan's numbers (2.2 item 2).
  assert.equal(PROP_SOLIDS.lamp.mode, 'break');
  assert.equal(PROP_SOLIDS.lamp.breakSpeed, 8);
  assert.equal(PROP_SOLIDS.lamp.slow, 0.12);
  assert.equal(PROP_SOLIDS.streetsign.breakSpeed, 3);
  assert.equal(PROP_SOLIDS.bin.breakSpeed, 3);
  assert.equal(PROP_SOLIDS.fence.breakSpeed, 5);
  assert.equal(PROP_SOLIDS.hydrant.breakSpeed, 6);
  assert.equal(PROP_SOLIDS.hydrant.spray, 6);
  for (const t of ['tree', 'palm', 'signal', 'bollard', 'wall', 'planter', 'rock', 'cabin', 'stack', 'boat', 'hedge']) assert.equal(PROP_SOLIDS[t].mode, 'solid', t);
  for (const t of ['towel', 'drive', 'bay', 'path']) assert.equal(PROP_SOLIDS[t].mode, 'flat', t);
  assert.ok(PROP_SOLIDS.tree.lotR <= 0.3 && PROP_SOLIDS.palm.r <= 0.3, 'trunks, not canopies');
});

// ---- driving into one prop ----
// A collision world holding one prop at the origin: street types through
// propShapes, lot kinds through addLotSolids (the lot layer's path).
const LOT_FEAT = {
  wall: { l: 6, w: 0.3, h: 2 }, hedge: { l: 6, w: 0.9, h: 1.6 }, fence: { l: 6, w: 0.12, h: 1.5 }, gate: { l: 6, w: 0.15, h: 1.6 },
  pallet: { l: 1.2, w: 1.2, h: 1 }, cabin: { l: 6, w: 2.5, h: 2.6 }, stack: { l: 12.2, w: 2.5, h: 2.6 },
  rock: { r: 1.1, h: 0.9 }, pile: { r: 2.5, h: 2.2 }, boat: { r: 2.2, h: 3 }, shrub: { r: 0.8, h: 1.4 },
};
function oneProp(type, heading) {
  const col = createCollisionWorld();
  const f = LOT_FEAT[type];
  if (f) {
    const feat = { kind: type, x: 0, z: 0, heading: heading + Math.PI / 2, l: f.l || 0, w: f.w || 0, h: f.h, r: f.r || 0, solid: true, v: 0 };
    addLotSolids(col, [feat], 1, []);
  } else {
    const list = [];
    propShapes(type, 0, 0, heading + 0.3, 0, list);
    col.addLayer({ name: 'one', cell: () => list });
  }
  return col;
}
const flatCity = { nodes: [], edges: [], shoreDist: () => 500 };
// A sedan from 14 m out along `heading`, aimed at the origin, held near
// `speed` by a simple cruise control. Returns the furthest its center got
// along the heading (0 = the prop's point), break count, and the speed
// kept across the break step.
function ram(type, heading, speed) {
  const col = oneProp(type, heading);
  const c = Math.cos(heading), s = Math.sin(heading);
  const v = createVehicle('sedan', -c * 14, -s * 14, heading);
  v.vx = c * speed;
  v.vz = s * speed;
  const world = { collision: col, city: flatCity, time: 0 };
  let far = -Infinity, keep = 1, before;
  const n = Math.max(150, Math.ceil(22 / speed / DT));
  for (let i = 0; i < n; i++) {
    const sp = Math.hypot(v.vx, v.vz);
    const seq = col.breakSeq;
    before = sp;
    stepVehicle(v, { throttle: sp < speed ? 1 : 0 }, DT, world);
    if (col.breakSeq !== seq) keep = Math.hypot(v.vx, v.vz) / before;
    far = Math.max(far, v.x * c + v.z * s);
  }
  return { far, breaks: col.breakSeq, keep, end: Math.hypot(v.vx, v.vz) };
}
const HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

test('a sedan at 11, 34 and 67 mph from four directions never passes a solid prop; a breakable one shears above its break speed with one break', () => {
  const report = [];
  for (const [type, e] of Object.entries(PROP_SOLIDS)) {
    if (e.mode === 'flat' || type === 'roadend') continue;
    for (const hd of HEADINGS) {
      const speeds = [11 / MPH, 34 / MPH, 67 / MPH];
      if (e.mode === 'break') speeds.push(e.breakSpeed * 0.6);
      for (const sp of speeds) {
        const r = ram(type, hd, sp);
        const shears = e.mode === 'break' && sp > e.breakSpeed;
        if (shears) {
          assert.equal(r.breaks, 1, `${type} at ${(sp * MPH).toFixed(0)} mph: one break`);
          assert.ok(r.far > 3, `${type}: the car goes on through (${r.far.toFixed(2)})`);
          assert.ok(Math.abs(r.keep - (1 - e.slow)) < 0.03, `${type}: keeps ${r.keep.toFixed(3)} of its speed, want ${1 - e.slow}`);
        } else {
          assert.equal(r.breaks, 0, `${type} at ${(sp * MPH).toFixed(1)} mph: no break`);
          assert.ok(r.far < 0, `${type} at ${(sp * MPH).toFixed(1)} mph heading ${hd.toFixed(2)}: stopped before it (${r.far.toFixed(2)})`);
        }
      }
    }
    report.push(type);
  }
  assert.ok(report.length >= 30, `${report.length} types driven into`);
});

test('measured: a lamp pole at 30 mph shears with one break and keeps 88 percent; at 11 mph it stops the car', () => {
  const fast = ram('lamp', 0, 30 / MPH);
  assert.equal(fast.breaks, 1);
  assert.ok(Math.abs(fast.keep - 0.88) < 0.02, `kept ${fast.keep}`);
  const slow = ram('lamp', 0, 11 / MPH);
  assert.equal(slow.breaks, 0);
  assert.ok(slow.far < -1, `stopped ${slow.far}`);
  console.log(`# lamp 30 mph: ${fast.breaks} break, speed kept ${(fast.keep * 100).toFixed(1)} %; 11 mph: stopped ${(-slow.far).toFixed(2)} m short of the pole center`);
});

test('a broken prop stands again after 120 s only once the player is 150 m away; walkers never break props', () => {
  const col = oneProp('lamp', 0);
  const v = createVehicle('sedan', -14, 0, 0);
  v.vx = 20;
  const world = { collision: col, city: flatCity, time: 0 };
  for (let i = 0; i < 90; i++) stepVehicle(v, { throttle: 1 }, DT, world);
  assert.equal(col.breakSeq, 1);
  assert.equal(col.brokenCount, 1);
  assert.equal(col.resolveCircle(0, 0, 0.3).hit, false, 'off while broken');
  assert.equal(col.isBroken(0, 0), true);
  col.stepBroken(BREAK_BACK_T + 1, 10, 0);
  assert.equal(col.brokenCount, 1, 'not while the player is near');
  col.stepBroken(1, BREAK_BACK_FAR + 10, 0);
  assert.equal(col.brokenCount, 0);
  assert.equal(col.resolveCircle(0, 0, 0.3).hit, true, 'stands again');
  // A walker at a run is only pushed out.
  const r = col.resolveCircle(0.3, 0, 0.35, 0);
  assert.ok(r.hit && col.breakSeq === 1);
});

// ---- the street layer on a real city ----
test('the street prop layer is lazy, and a cell holds the same shapes whatever was touched first', () => {
  const city = miami();
  const A = createPropLayer(city), B = createPropLayer(city);
  assert.equal(A.stats.made, 0, 'no shape made at build');
  const val = (s) => JSON.stringify({ k: s.kind, x: s.x ?? s.x0, z: s.z ?? s.z0, r: s.r, h: s.h, t: s.ptype });
  const s = city.spawn, C = 32;
  const cells = [];
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) cells.push([Math.floor(s.x / C) + i, Math.floor(s.z / C) + j]);
  for (const [cx, cz] of cells) A.cell(cx, cz);
  for (const [cx, cz] of cells.slice().reverse()) B.cell(cx, cz);
  for (const [cx, cz] of cells) assert.equal(A.cell(cx, cz).map(val).join('|'), B.cell(cx, cz).map(val).join('|'), `cell ${cx},${cz}`);
  assert.ok(A.stats.made > 50 && A.stats.made < A.size, `${A.stats.made} of ${A.size} props made near the start`);
  // A full sweep: every prop's shapes, as propShapes makes them.
  let want = 0;
  eachStreetProp(city, (type, x, z, rot, h) => { want += propShapes(type, x, z, rot, h, []); });
  assert.equal(A.count(), want);
});

test('on the real map: lamps and signal masts stop a sedan at 11 mph from their road; every prop with a shape is in the world', () => {
  const city = miami();
  const col = createCollisionWorld();
  fillCollision(city, col);
  const census = propCensus(city, dressLot);
  let total = 0, shaped = 0;
  for (const src of Object.keys(census)) {
    for (const [t, n] of Object.entries(census[src])) {
      total += n;
      if (PROP_SOLIDS[t].mode !== 'flat') shaped += n;
    }
  }
  console.log(`# Downtown: ${Object.keys(PROP_SOLIDS).length} prop types in the table, ${total} props emitted, ${shaped} with a shape (${((shaped / total) * 100).toFixed(1)} %)`);
  assert.ok(shaped / total > 0.85, `${shaped} / ${total} solid or breakable`);
  // Drive into lamps (and masts) from the road side, at 11 mph.
  const posts = [];
  for (const p of city.props) if (p.type === 'lamp' && posts.length < 12 && Math.hypot(p.x - city.spawn.x, p.z - city.spawn.z) < 1500) posts.push(p);
  for (const sg of city.signals.slice(0, 8)) posts.push({ x: sg.x, z: sg.z, type: 'signal' });
  const world = { collision: col, city, time: 0 };
  let tried = 0;
  for (const p of posts) {
    // From 9 m out, toward the nearest road (the lamp stands at its curb).
    let best = null;
    for (let a = 0; a < 16; a++) {
      const h = (a / 16) * Math.PI * 2;
      const x = p.x - Math.cos(h) * 9, z = p.z - Math.sin(h) * 9;
      if (!city.onRoad(x, z) || col.resolveCircle(x, z, 1.2).hit || col.raycast(x, z, Math.cos(h), Math.sin(h), 9) < 8.4) continue;
      best = h;
      break;
    }
    if (best === null) continue;
    tried++;
    const c = Math.cos(best), s = Math.sin(best);
    const v = createVehicle('sedan', p.x - c * 9, p.z - s * 9, best);
    v.vx = c * (11 / MPH);
    v.vz = s * (11 / MPH);
    let far = -Infinity;
    for (let i = 0; i < 120; i++) {
      stepVehicle(v, { throttle: Math.hypot(v.vx, v.vz) < 11 / MPH ? 1 : 0 }, DT, world);
      far = Math.max(far, (v.x - p.x) * c + (v.z - p.z) * s);
    }
    assert.ok(far < 0, `${p.type} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}: the car got ${far.toFixed(2)} m past it`);
  }
  assert.ok(tried >= 8, `${tried} posts tried`);
});
