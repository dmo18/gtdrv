// Solid props (docs/PLAN_V3.md 2.2 items 1 and 2). One table, PROP_SOLIDS,
// says what every prop type the city can emit is to a car: its shape, its
// height and whether it stops the car, shears off above a speed, or is only
// paint. fillPropCollision puts the street props (city.props, furniture,
// signals and the Miami avenue palms) into the collision world as a lazy
// layer: a collision cell gets its prop shapes the first time a query
// touches it, so the answer never depends on what was touched before.
// The lot layer (world/collision.js addLotSolids) reads the same table for
// the dressLot kinds. Pure: no three.js, no DOM.
//
// Entry fields:
//   r       circle radius (m), or 'feat': the feature's own r (lot features)
//   box     [length, width] (m) along the heading, or 'feat': the feature's l, w
//   turn    added to a street item's `rot` to get the box heading (the
//           render templates' long axis; lot features carry their heading)
//   h       height (m), or 'feat'
//   mode    'solid' stops a car at any speed; 'break' stops it below
//           breakSpeed and shears off above it; 'flat' has no shape
//   breakSpeed  m/s closing speed that shears a 'break' prop
//   slow    share of its speed a car loses shearing it
//   spray   s of water (hydrants)
//   fall    'pole' | 'chunk': the piece that falls when it breaks
export const PROP_SOLIDS = {
  // ---- street props (city.props) ----
  lamp: { r: 0.18, h: 7, mode: 'break', breakSpeed: 8, slow: 0.12, fall: 'pole' },
  tree: { r: 0.3, h: 6, mode: 'solid' },
  palm: { r: 0.3, h: 8, mode: 'solid' },
  // ---- street furniture (city.furniture) ----
  streettree: { r: 0.25, h: 5, mode: 'solid' },
  palmtree: { r: 0.3, h: 6, mode: 'solid' },
  bench: { box: [1.7, 0.55], turn: Math.PI / 2, h: 0.9, mode: 'break', breakSpeed: 4, slow: 0.06, fall: 'chunk' },
  bin: { r: 0.3, h: 1.0, mode: 'break', breakSpeed: 3, slow: 0.03, fall: 'chunk' },
  hydrant: { r: 0.18, h: 0.75, mode: 'break', breakSpeed: 6, slow: 0.06, spray: 6, fall: 'chunk' },
  mailbox: { r: 0.3, h: 1.1, mode: 'break', breakSpeed: 4, slow: 0.05, fall: 'chunk' },
  meter: { r: 0.1, h: 1.4, mode: 'break', breakSpeed: 3, slow: 0.02, fall: 'pole' },
  planter: { r: 0.65, h: 0.9, mode: 'solid' },
  barrier: { box: [2.0, 0.6], turn: 0, h: 0.82, mode: 'solid' },
  shelter: { box: [3.5, 1.55], turn: Math.PI / 2, h: 2.56, mode: 'solid' },
  bikes: { box: [2.6, 0.5], turn: Math.PI / 2, h: 1.0, mode: 'break', breakSpeed: 4, slow: 0.04, fall: 'chunk' },
  stopsign: { r: 0.08, h: 2.7, mode: 'break', breakSpeed: 3, slow: 0.03, fall: 'pole' },
  namesign: { r: 0.08, h: 3.4, mode: 'break', breakSpeed: 3, slow: 0.03, fall: 'pole' },
  streetsign: { r: 0.08, h: 3.4, mode: 'break', breakSpeed: 3, slow: 0.03, fall: 'pole' },
  umbrella: { r: 0.12, h: 2.3, mode: 'break', breakSpeed: 3, slow: 0.02, fall: 'pole' },
  // ---- traffic signal mast (city.signals) ----
  signal: { r: 0.16, h: 5.7, mode: 'solid' },
  // ---- the striped barrier posts of a generated road end (city.roadEnds) ----
  roadend: { r: 0.55, h: 1.2, mode: 'solid' },
  // ---- dressLot kinds (world/lots.js) ----
  wall: { box: 'feat', h: 'feat', mode: 'solid' },
  hedge: { box: 'feat', h: 'feat', mode: 'solid' },
  fence: { box: 'feat', h: 'feat', mode: 'break', breakSpeed: 5, slow: 0.06, fall: 'chunk' },
  gate: { box: 'feat', h: 'feat', mode: 'break', breakSpeed: 5, slow: 0.05, fall: 'chunk' },
  pallet: { box: 'feat', h: 'feat', mode: 'break', breakSpeed: 3, slow: 0.05, fall: 'chunk' },
  bollard: { r: 0.2, h: 0.9, mode: 'solid' },
  rock: { r: 'feat', h: 'feat', mode: 'solid' },
  cabin: { box: 'feat', h: 'feat', mode: 'solid' },
  stack: { box: 'feat', h: 'feat', mode: 'solid' },
  pile: { r: 'feat', h: 'feat', mode: 'solid' },
  boat: { r: 'feat', h: 'feat', mode: 'solid' },
  shrub: { r: 'feat', h: 'feat', mode: 'break', breakSpeed: 3, slow: 0.08, fall: 'chunk' },
  towel: { mode: 'flat' },
  drive: { mode: 'flat' },
  bay: { mode: 'flat' }, // its static cars are the lot layer's 'car' shapes
  path: { mode: 'flat' },
  // 0.11.0 lot kinds (docs/PLAN_V3.md 13, LOTS).
  sign: { r: 0.1, h: 2.3, mode: 'break', breakSpeed: 3, slow: 0.03, fall: 'pole' },
  loading: { mode: 'flat' },
  // A bed of low shrubs (on paving with a 45 cm curb): stops a car.
  bed: { box: 'feat', h: 0.9, mode: 'solid' },
  rack: { box: 'feat', h: 1.0, mode: 'break', breakSpeed: 4, slow: 0.04, fall: 'chunk' },
  flagpole: { r: 0.12, h: 9, mode: 'break', breakSpeed: 8, slow: 0.1, fall: 'pole' },
  dumpster: { box: [1.9, 1.3], h: 1.3, mode: 'solid' },
};
// Lot trees are drawn with a canopy radius (f.r up to 1.2 m); the trunk is
// what a car hits.
PROP_SOLIDS.tree.lotR = 0.3;

// The prop types of each source, as written by the generators today. The
// census in test/prop-collision.test.js checks a city's real output against
// PROP_SOLIDS, so a new type cannot ship as a ghost.
export const STREET_SOURCES = ['props', 'furniture', 'signals', 'roadEnds', 'palms'];

export function propSolid(type) {
  return PROP_SOLIDS[type] || null;
}

// ---- Miami avenue and seawall palms (moved here from render/props.js) ----
// Which Miami streets get palms (the rest get round shade trees).
export const PALM_PLACES = new Set(['Brickell', 'Downtown Miami', 'Brickell Key', 'Bayfront Park', 'Park West', 'Edgewater', 'Margaret Pace Park', 'Museum Park',
  'Miami Beach', 'Watson Island', 'Fisher Island', 'Venetian Islands', 'Hibiscus Island', 'Palm Island', 'Virginia Key', 'Miami']);
// Named boulevards lined with palms whatever their width.
export const PALM_STREET = /Southwest 8th Street|Brickell Avenue|Brickell Bay|Biscayne Boulevard|Bayshore|Ocean Drive|Collins Avenue|Alton Road|Venetian|MacArthur|Coral Way|Port Boulevard/;

// The hash props.js uses for its per-item variety (kept bit for bit).
export function propHash(x, z) {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// Trees are kept off the landmarks (cranes, lighthouse).
export function propBlocked(city, x, z) {
  const L = city.landmarks;
  if (!L) return false;
  for (const c of L.cranes || []) if (Math.abs(x - c.x) < 11 && z > c.z - 18 && z < c.z + 42) return true;
  if (L.lighthouse && Math.hypot(x - L.lighthouse.x, z - L.lighthouse.z) < 8) return true;
  return false;
}

// Where the extra Miami palms stand (x, z, height triples): down the
// avenues of the palm neighborhoods and the named palm boulevards, and
// along the seawalls there. Worked out once per city and kept. Only a
// real map with Miami's fields has them (else an empty list).
const palmCache = new WeakMap();
const NO_PALM_LOTS = new Set(['carpark', 'yard', 'works', 'site']);
export function miamiPalmSpots(city) {
  let out = palmCache.get(city);
  if (out) return out;
  out = [];
  palmCache.set(city, out);
  if (city.map !== 'miami' || typeof city.placeOf !== 'function' || typeof city.blockAt !== 'function') return out;
  const hash = propHash;
  const lampNear = new Set();
  for (const l of city.props || []) if (l.type === 'lamp') lampNear.add(Math.round(l.x / 4) * 100000 + Math.round(l.z / 4));
  const nearLamp = (x, z) => {
    const i = Math.round(x / 4), j = Math.round(z / 4);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (lampNear.has((i + a) * 100000 + j + b)) return true;
    return false;
  };
  for (const e of city.edges) {
    if (e.causeway || e.bridge) continue;
    const named = !!(e.name && PALM_STREET.test(e.name));
    if (e.width < 18 && !named) continue;
    const a = city.nodes[e.a], bn = city.nodes[e.b];
    if (!named && !PALM_PLACES.has(city.placeOf((a.x + bn.x) / 2, (a.z + bn.z) / 2))) continue;
    const half = e.width / 2, rx = -e.uz, rz = e.ux;
    for (const sd of [-1, 1]) {
      for (let d = (a.hx || 0) + 8; d + 8 <= e.length - (bn.hx || 0); d += 13) {
        const x = a.x + e.ux * d + rx * sd * (half + 1.15), z = a.z + e.uz * d + rz * sd * (half + 1.15);
        // Diagonal streets have no block beside them: any open land will do.
        const ground = city.blockAt(x, z) || (city.isLand && city.isLand(x, z) && city.onRoad && !city.onRoad(x, z));
        if (!ground || (city.inBuilding && city.inBuilding(x, z, 1)) || nearLamp(x, z)) continue;
        out.push(x, z, 8 + hash(x, z + 5) * 4);
      }
    }
  }
  if (city.mainShore && city.bounds) {
    const B = city.bounds, st = 15;
    for (let z = B.z0 + 7; z < B.z1; z += st) {
      for (let x = B.x0 + 7; x < B.x1; x += st) {
        const sd = city.mainShore(x, z);
        if (sd < 4 || sd >= 4 + st * 0.7) continue;
        const jx = x + (hash(x, z) - 0.5) * 6, jz = z + (hash(z, x) - 0.5) * 6;
        const s2 = city.mainShore(jx, jz);
        if (s2 < 3.5 || hash(jx + 1, jz) > 0.75) continue;
        if (!PALM_PLACES.has(city.placeOf(jx, jz))) continue;
        if ((city.onRoad && city.onRoad(jx, jz)) || (city.inBuilding && city.inBuilding(jx, jz, 1.5)) || propBlocked(city, jx, jz)) continue;
        // Not in a parking lot, a yard, a works or a site: their bays,
        // drives and fences are the lot's own (world/lots.js dressLot).
        const lot = city.lotAt ? city.lotAt(jx, jz) : null;
        if (lot && NO_PALM_LOTS.has(lot.type)) continue;
        out.push(jx, jz, 7.5 + hash(jx, jz + 5) * 4.5);
      }
    }
  }
  return out;
}

// Every street prop of the city in a fixed order (props, palms, furniture,
// signals), as fn(type, x, z, rot, h). Trees and palms on a landmark are
// left out, as the renderer leaves them out.
export function eachStreetProp(city, fn) {
  for (const p of city.props || []) {
    if ((p.type === 'tree' || p.type === 'palm') && propBlocked(city, p.x, p.z)) continue;
    fn(p.type, p.x, p.z, p.rot || 0, p.h || 0);
  }
  const palms = miamiPalmSpots(city);
  for (let i = 0; i < palms.length; i += 3) fn('palm', palms[i], palms[i + 1], 0, palms[i + 2]);
  for (const f of city.furniture || []) fn(f.type, f.x, f.z, f.rot || 0, 0);
  for (const s of city.signals || []) fn('signal', s.x, s.z, 0, 0);
}

// ---- Shapes ----
// The collision shape objects of one prop (pushed to `list`): a circle,
// an axis-aligned box, or a row of circles along an oblique box. Same
// objects as the collision world's (kind 0 box, kind 1 circle), with
// `brk` (the table entry of a breakable prop, else null), `ptype` and a
// hidden `grp` (all shapes of the same prop: they break together).
const TAGS = { tree: 'tree', palm: 'tree', streettree: 'tree', palmtree: 'tree' };
function circle(x, z, r, h, tag) {
  return { kind: 1, x, z, r, h, tag, stamp: 0, off: false, brk: null, ptype: '', bayU: undefined };
}
function box(x0, z0, x1, z1, h, tag) {
  return { kind: 0, x0, z0, x1, z1, h, tag, stamp: 0, off: false, brk: null, ptype: '' };
}
// A breakable shape's group (every shape of its prop), kept out of the
// shape's enumerable fields (shapes are compared and printed as JSON).
export function setBreakGroup(shape, entry, grp) {
  shape.brk = entry;
  Object.defineProperty(shape, 'grp', { value: grp, enumerable: false, writable: true, configurable: true });
}
// Shapes for an oriented box of half length hl and half width hw.
function orientedBox(list, x, z, heading, hl, hw, h, tag) {
  const c = Math.cos(heading), s = Math.sin(heading);
  hw = Math.max(0.12, hw);
  if (Math.abs(s) < 0.02 || Math.abs(c) < 0.02) {
    const ex = Math.abs(c) * hl + Math.abs(s) * hw, ez = Math.abs(s) * hl + Math.abs(c) * hw;
    list.push(box(x - ex, z - ez, x + ex, z + ez, h, tag));
    return;
  }
  const k = Math.max(1, Math.ceil(hl / hw));
  for (let i = 0; i <= k; i++) {
    const o = -hl + (2 * hl * i) / k;
    list.push(circle(x + c * o, z + s * o, hw, h, tag));
  }
}

// The shapes of prop `type` at (x, z): street items pass rot (their
// facing) and h (their own height, 0 for the table's); lot features pass
// the feature (heading, l, w, r, h). Returns the number of shapes made.
export function propShapes(type, x, z, rot, hIn, list, feat = null, tagIn = null) {
  const e = PROP_SOLIDS[type];
  if (!e || e.mode === 'flat') return 0;
  const n0 = list.length;
  const tag = tagIn || (feat ? 'lot' : TAGS[type] || 'prop');
  const h = e.h === 'feat' ? (feat && feat.h) || 1.5 : hIn > 0 && (type === 'tree' || type === 'palm' || type === 'lamp') ? hIn : e.h;
  if (e.box) {
    let l, w, hd;
    if (e.box === 'feat') {
      l = (feat && feat.l) || 1; w = (feat && feat.w) || 0.3; hd = (feat && feat.heading) || 0;
    } else {
      l = e.box[0]; w = e.box[1]; hd = feat ? feat.heading || 0 : rot + (e.turn || 0);
    }
    orientedBox(list, x, z, hd, l / 2, w / 2, h, tag);
  } else {
    let r = e.r;
    if (r === 'feat') r = (feat && feat.r) || 0.5;
    else if (feat && e.lotR) r = e.lotR;
    list.push(circle(x, z, r, h, tag));
  }
  if (list.length === n0) return 0;
  const grp = e.mode === 'break' ? list.slice(n0) : null;
  for (let i = n0; i < list.length; i++) {
    const s = list[i];
    s.ptype = type;
    if (grp) setBreakGroup(s, e, grp);
  }
  return list.length - n0;
}

// ---- The lazy street prop layer ----
const CELL = 32; // the collision world's cell
// How far a street prop's shapes reach from its point (the bus shelter's
// half diagonal, rounded up).
export const PROP_REACH = 2.5;
const NO_ITEMS = [];

// The street props of a city as a lazy layer for the collision world
// (collision.addLayer). Items are binned by cell now (numbers only); the
// shape objects of an item are made the first time a cell that holds it
// is touched, once, and shared by every cell it reaches.
export function createPropLayer(city) {
  const types = [], xs = [], zs = [], rots = [], hs = [];
  eachStreetProp(city, (type, x, z, rot, h) => {
    const e = PROP_SOLIDS[type];
    if (!e || e.mode === 'flat') return;
    types.push(type); xs.push(x); zs.push(z); rots.push(rot); hs.push(h);
  });
  const N = types.length;
  const cellOf = (v) => Math.floor(v / CELL);
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  for (let i = 0; i < N; i++) {
    gx0 = Math.min(gx0, cellOf(xs[i] - PROP_REACH)); gx1 = Math.max(gx1, cellOf(xs[i] + PROP_REACH));
    gz0 = Math.min(gz0, cellOf(zs[i] - PROP_REACH)); gz1 = Math.max(gz1, cellOf(zs[i] + PROP_REACH));
  }
  const W = gx1 >= gx0 ? gx1 - gx0 + 1 : 0, H = gz1 >= gz0 ? gz1 - gz0 + 1 : 0;
  const NC = W * H;
  const start = new Int32Array(NC + 1);
  const span = (i, fn) => {
    const i0 = cellOf(xs[i] - PROP_REACH) - gx0, i1 = cellOf(xs[i] + PROP_REACH) - gx0;
    const j0 = cellOf(zs[i] - PROP_REACH) - gz0, j1 = cellOf(zs[i] + PROP_REACH) - gz0;
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) fn(j * W + k);
  };
  for (let i = 0; i < N; i++) span(i, (c) => start[c + 1]++);
  for (let c = 0; c < NC; c++) start[c + 1] += start[c];
  const items = new Int32Array(NC ? start[NC] : 0);
  const fillAt = start.slice(0, NC);
  for (let i = 0; i < N; i++) span(i, (c) => { items[fillAt[c]++] = i; });
  const itemShapes = new Array(N).fill(null);
  const cellLists = new Array(NC).fill(null);
  const stats = { items: N, cells: 0, made: 0, shapes: 0 };

  function shapesOf(i) {
    let list = itemShapes[i];
    if (list) return list;
    list = [];
    propShapes(types[i], xs[i], zs[i], rots[i], hs[i], list);
    itemShapes[i] = list;
    stats.made++;
    stats.shapes += list.length;
    return list;
  }
  function fill(c, cx, cz) {
    let list = null;
    for (let q = start[c]; q < start[c + 1]; q++) {
      const shapes = shapesOf(items[q]);
      for (let s = 0; s < shapes.length; s++) {
        const it = shapes[s];
        const x0 = it.kind === 0 ? it.x0 : it.x - it.r, x1 = it.kind === 0 ? it.x1 : it.x + it.r;
        const z0 = it.kind === 0 ? it.z0 : it.z - it.r, z1 = it.kind === 0 ? it.z1 : it.z + it.r;
        if (cx < cellOf(x0) || cx > cellOf(x1) || cz < cellOf(z0) || cz > cellOf(z1)) continue;
        (list || (list = [])).push(it);
      }
    }
    stats.cells++;
    cellLists[c] = list || NO_ITEMS;
    return cellLists[c];
  }
  function cell(cx, cz) {
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return NO_ITEMS;
    const c = j * W + i;
    return cellLists[c] || fill(c, cx, cz);
  }
  function allShapes(fn) {
    for (let i = 0; i < N; i++) {
      const list = shapesOf(i);
      for (let s = 0; s < list.length; s++) fn(list[s]);
    }
  }
  function count() {
    let n = 0;
    allShapes(() => n++);
    return n;
  }
  // Item i's type and point (tests, the renderer).
  const item = (i) => ({ type: types[i], x: xs[i], z: zs[i], rot: rots[i], h: hs[i] });
  return { name: 'props', cell, allShapes, count, shapesOf, item, stats, size: N };
}

// Census: every prop type a city emits, by source, with counts
// ({ props: { lamp: 4630, ... }, furniture: {...}, ... }). Lot kinds come
// from dressing every lot (dress = city.dressLot or lots.js dressLot).
export function propCensus(city, dress = null) {
  const out = { props: {}, furniture: {}, signals: {}, roadEnds: {}, palms: {}, lots: {} };
  const add = (k, t, n = 1) => { out[k][t] = (out[k][t] || 0) + n; };
  for (const p of city.props || []) add('props', p.type);
  for (const f of city.furniture || []) add('furniture', f.type);
  if ((city.signals || []).length) add('signals', 'signal', city.signals.length);
  if ((city.roadEnds || []).length) add('roadEnds', 'roadend', city.roadEnds.length);
  const palms = miamiPalmSpots(city);
  if (palms.length) add('palms', 'palm', palms.length / 3);
  if (dress && city.lots) {
    const feats = [];
    for (const lot of city.lots) {
      if (!lot || lot.type === 'verge' || lot.type === 'airfield') continue;
      feats.length = 0;
      dress(city, lot, feats);
      for (const f of feats) add('lots', f.kind);
    }
  }
  return out;
}
