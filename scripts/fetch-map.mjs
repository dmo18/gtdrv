// Dev-time tool: downloads OpenStreetMap data for the Miami box and writes
// src/world/data/miami.json. Never imported by src/ and never run at runtime.
// Map data (c) OpenStreetMap contributors, ODbL. See docs/MAP.md.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'build', 'osm-cache');
const OUT = path.join(ROOT, 'src', 'world', 'data', 'miami.json');
// The data box. 0.9.0 (docs/PLAN_V3.md 2.1 item 1) moved only the east
// edge, -80.135 to -80.115, so the whole of South Beach and the ocean front
// are in. The origin and the projection stay those of the first box
// (ORIGIN_BOX's center, lat 25.78, lon -80.18): every saved position, id
// and placed thing keeps its meaning, and the old tiles keep their cache
// keys (the east strip is fetched as extra tiles after them, so the
// features of the old box keep their order and their source indices).
const ORIGIN_BOX = { s: 25.745, n: 25.815, w: -80.225, e: -80.135 };
const BOX = { s: 25.745, n: 25.815, w: -80.225, e: -80.115 };
const TILE = 0.04;
const MIN_TILE = 0.002;
const UA = 'rustwater-map-build/0.1 (dev tool)';
const ATTRIBUTION = 'Map data (c) OpenStreetMap contributors, ODbL';
const TOL = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];

fs.mkdirSync(CACHE, { recursive: true });

async function fetchBox(w, s, e, n, depth = 0) {
  const key = [w, s, e, n].map((v) => v.toFixed(5)).join('_');
  const file = path.join(CACHE, key + '.xml.gz');
  if (fs.existsSync(file)) return [zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')];
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${w},${s},${e},${n}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA } }); } catch {
      await sleep(3000 * (attempt + 1)); continue;
    }
    if (res.status === 400 || res.status === 509) {
      // Too many nodes (or bandwidth limit): split into quarters.
      if (res.status === 509) { await sleep(30000); continue; }
      if (e - w <= MIN_TILE) break;
      console.log(`  split ${key} (too many nodes)`);
      const mx = (w + e) / 2, my = (s + n) / 2, out = [];
      for (const [a, b, c, d] of [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]) {
        out.push(...await fetchBox(a, b, c, d, depth + 1));
        await sleep(1000);
      }
      return out;
    }
    if (!res.ok) { await sleep(3000 * (attempt + 1)); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, zlib.gzipSync(buf));
    console.log(`  tile ${key} ${(buf.length / 1e6).toFixed(1)} MB`);
    await sleep(1000);
    return [buf.toString('utf8')];
  }
  failed.push(key);
  console.log(`  FAILED ${key}`);
  return [];
}

const nodes = new Map(); // id -> [lat, lon]
const ways = new Map(); // id -> {refs, tags}
const rels = new Map(); // id -> {members, tags}
const placeNodes = new Map();
// Point features read from node tags (2.1 item 2): traffic signals, stop
// signs and slipways. id -> kind.
const pointNodes = new Map();

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (line, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(line);
  return m ? m[1] : null;
};

function parseXml(text) {
  let cur = null; // {kind, id, refs, members, tags}
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('<node ')) {
      const id = attr(line, 'id');
      nodes.set(id, [parseFloat(attr(line, 'lat')), parseFloat(attr(line, 'lon'))]);
      cur = line.endsWith('/>') ? null : { kind: 'node', id, tags: {} };
    } else if (line.startsWith('<way ')) {
      cur = { kind: 'way', id: attr(line, 'id'), refs: [], tags: {} };
    } else if (line.startsWith('<relation ')) {
      cur = { kind: 'rel', id: attr(line, 'id'), members: [], tags: {} };
    } else if (line.startsWith('<nd ') && cur) {
      cur.refs.push(attr(line, 'ref'));
    } else if (line.startsWith('<member ') && cur) {
      cur.members.push({ type: attr(line, 'type'), ref: attr(line, 'ref'), role: attr(line, 'role') });
    } else if (line.startsWith('<tag ') && cur) {
      cur.tags[unesc(attr(line, 'k'))] = unesc(attr(line, 'v'));
    } else if (line.startsWith('</') && cur) {
      if (cur.kind === 'way') ways.set(cur.id, cur);
      else if (cur.kind === 'rel') rels.set(cur.id, cur);
      else if (cur.kind === 'node') {
        const t = cur.tags;
        if (t.name && (t.place || t.railway === 'station' || t.amenity)) placeNodes.set(cur.id, { tags: t, ll: nodes.get(cur.id) });
        if (t.highway === 'traffic_signals') pointNodes.set(cur.id, 'signal');
        else if (t.highway === 'stop') pointNodes.set(cur.id, 'stop');
        else if (t.leisure === 'slipway') pointNodes.set(cur.id, 'slipway');
      }
      cur = null;
    }
  }
}

// ---- projection ----
const lat0 = (ORIGIN_BOX.s + ORIGIN_BOX.n) / 2, lon0 = (ORIGIN_BOX.w + ORIGIN_BOX.e) / 2;
const R = 6371008.8;
const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
const kz = (Math.PI / 180) * R;
const proj = ([lat, lon]) => [(lon - lon0) * kx, -(lat - lat0) * kz];
const bounds = { minX: (BOX.w - lon0) * kx, maxX: (BOX.e - lon0) * kx, minZ: -(BOX.n - lat0) * kz, maxZ: -(BOX.s - lat0) * kz };

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = pts[i];
      let t = len2 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, pz - az - t * dz);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r1 = (v) => Math.round(v * 10) / 10;
// Delta-encoded integer decimeters: [x0, z0, dx1, dz1, ...] (first pair absolute).
const flat = (pts) => {
  const o = []; let px = 0, pz = 0;
  for (const p of pts) {
    const x = Math.round(p[0] * 10), z = Math.round(p[1] * 10);
    o.push(x - px, z - pz); px = x; pz = z;
  }
  return o;
};
const wayPts = (w) => { const o = []; for (const r of w.refs) { const n = nodes.get(r); if (n) o.push(proj(n)); } return o; };
const closed = (w) => w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1];

function area(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

const LEVEL_H = 3.2;
const DEFAULT_H = { house: 6, residential: 7, detached: 6, apartments: 24, commercial: 18, office: 30, retail: 8, industrial: 9, warehouse: 8, garage: 4, garages: 4, parking: 9, hotel: 30, hospital: 24, school: 10, church: 10, yes: 10 };

function buildingHeight(t) {
  const h = parseFloat(t.height);
  if (h > 0) return Math.round(h);
  const lv = parseFloat(t['building:levels']);
  if (lv > 0) return Math.round(lv * LEVEL_H);
  return DEFAULT_H[t.building] || 10;
}

function stitch(wayList) {
  // join open ways end to end into rings (best effort)
  const rings = [];
  const pool = wayList.map((w) => w.refs.slice());
  while (pool.length) {
    let ring = pool.pop();
    let grew = true;
    while (grew && ring[0] !== ring[ring.length - 1]) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (p[0] === ring[ring.length - 1]) ring = ring.concat(p.slice(1));
        else if (p[p.length - 1] === ring[ring.length - 1]) ring = ring.concat(p.slice().reverse().slice(1));
        else if (p[p.length - 1] === ring[0]) ring = p.concat(ring.slice(1));
        else if (p[0] === ring[0]) ring = p.slice().reverse().concat(ring.slice(1));
        else continue;
        pool.splice(i, 1); grew = true; break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// The tiles: the first box's grid (its cached tiles), then the east strip
// ORIGIN_BOX.e .. BOX.e in the same rows.
function tileList() {
  const out = [];
  const cols = Math.ceil((ORIGIN_BOX.e - ORIGIN_BOX.w) / TILE - 1e-9), rows = Math.ceil((BOX.n - BOX.s) / TILE - 1e-9);
  const tw = (ORIGIN_BOX.e - ORIGIN_BOX.w) / cols, th = (BOX.n - BOX.s) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push([ORIGIN_BOX.w + c * tw, BOX.s + r * th, ORIGIN_BOX.w + (c + 1) * tw, BOX.s + (r + 1) * th]);
  }
  if (BOX.e > ORIGIN_BOX.e) {
    for (let r = 0; r < rows; r++) out.push([ORIGIN_BOX.e, BOX.s + r * th, BOX.e, BOX.s + (r + 1) * th]);
  }
  return out;
}

// Road tags kept (2.1 item 2). oneway: 1 along the way, -1 against it
// (`oneway=-1`); traffic circles and motorways are one-way by default.
const ONEWAY_YES = new Set(['yes', 'true', '1']);
function onewayOf(t) {
  if (ONEWAY_YES.has(t.oneway)) return 1;
  if (t.oneway === '-1' || t.oneway === 'reverse') return -1;
  if (t.oneway === 'no') return undefined;
  if (t.junction === 'roundabout' || t.highway === 'motorway' || t.highway === 'motorway_link') return 1;
  return undefined;
}
const intTag = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : undefined;
};
// maxspeed in mph (the US tag is "30 mph"; a bare number is km/h).
function mphOf(v) {
  if (!v) return undefined;
  const m = /^(\d+)\s*(mph)?/.exec(v);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return m[2] ? n : Math.round(n / 1.609);
}
const PED_MALLS = new Set(['Lincoln Road', 'Espanola Way', 'Española Way']);
const BARRIER_LINES = new Set(['wall', 'retaining_wall', 'fence', 'guard_rail', 'hedge', 'jersey_barrier', 'city_wall', 'handrail']);

async function main() {
  const tiles = tileList();
  console.log(`Fetching ${tiles.length} tiles (cache: ${CACHE})`);
  for (const [w, s, e, n] of tiles) {
    const texts = await fetchBox(w, s, e, n);
    for (const t of texts) parseXml(t);
  }
  console.log(`Parsed ${nodes.size} nodes, ${ways.size} ways, ${rels.size} relations`);

  const roads = [], buildings = [], water = [], coast = [], parks = [], labels = [];
  const parking = [], beaches = [], piers = [], slipways = [], barriers = [];
  const inBox = (x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

  for (const w of ways.values()) {
    const t = w.tags;
    // The two pedestrian streets of South Beach (2.1 item 8): Lincoln Road
    // Mall is mapped as a footway; it is kept as a `pedestrian` way
    // (`mall: 1`), drivable in the sandbox.
    const mall = t.highway === 'footway' && PED_MALLS.has(t.name);
    if (mall) {
      const pts = simplify(wayPts(w), TOL);
      if (pts.length >= 2) roads.push({ class: 'pedestrian', name: t.name, mall: 1, p: flat(pts) });
    } else if (t.highway && !['proposed', 'construction', 'platform', 'bus_stop', 'elevator', 'footway', 'steps', 'path', 'track', 'cycleway', 'corridor', 'bridleway'].includes(t.highway)) {
      const pts = simplify(wayPts(w), TOL);
      if (pts.length >= 2) {
        roads.push({
          class: t.highway, name: t.name || undefined, oneway: onewayOf(t), bridge: t.bridge && t.bridge !== 'no' ? 1 : undefined,
          lanes: intTag(t.lanes), lf: intTag(t['lanes:forward']), lb: intTag(t['lanes:backward']), mph: mphOf(t.maxspeed),
          turn: t['turn:lanes'] ? t['turn:lanes'].slice(0, 60) : undefined, svc: t.highway === 'service' && t.service ? t.service : undefined,
          area: t.area === 'yes' ? 1 : undefined, p: flat(pts),
        });
      }
    } else if (t.building && t.building !== 'no' && closed(w)) {
      const pts = simplify(wayPts(w).slice(0, -1), TOL);
      if (pts.length >= 3 && Math.abs(area(pts)) > 15) buildings.push({ h: buildingHeight(t), kind: t.building === 'yes' ? undefined : t.building, name: t.name || undefined, p: flat(pts) });
    } else if (t.natural === 'coastline') {
      const pts = simplify(wayPts(w), TOL);
      if (pts.length >= 2) coast.push({ p: flat(pts) });
    } else if (t.natural === 'water' || t.waterway || t.landuse === 'reservoir') {
      const pts = wayPts(w);
      if (closed(w) && t.natural === 'water') { const s = simplify(pts.slice(0, -1), TOL); if (s.length >= 3) water.push({ name: t.name || undefined, p: flat(s) }); }
      else if (t.waterway) { const s = simplify(pts, TOL); if (s.length >= 2) water.push({ line: 1, kind: t.waterway, name: t.name || undefined, p: flat(s) }); }
    } else if ((t.leisure === 'park' || t.landuse === 'grass' || t.landuse === 'forest') && closed(w)) {
      const s = simplify(wayPts(w).slice(0, -1), TOL);
      if (s.length >= 3) parks.push({ kind: t.leisure || t.landuse, name: t.name || undefined, p: flat(s) });
    }
    // 0.9.0 features (2.1 item 2). Checked apart from the chain above, so
    // the old feature lists stay exactly as they were.
    if (t.amenity === 'parking' && closed(w)) {
      // No business names: only the kind of the lot.
      const s = simplify(wayPts(w).slice(0, -1), TOL);
      if (s.length >= 3 && Math.abs(area(s)) > 20) parking.push({ kind: t.parking || undefined, p: flat(s) });
    } else if (t.natural === 'beach' && closed(w)) {
      const s = simplify(wayPts(w).slice(0, -1), TOL);
      if (s.length >= 3) beaches.push({ name: t.name || undefined, p: flat(s) });
    }
    if (t.man_made === 'pier') {
      const pts = wayPts(w);
      const s = closed(w) ? simplify(pts.slice(0, -1), TOL) : simplify(pts, TOL);
      if (s.length >= 2) piers.push({ area: closed(w) && t.area !== 'no' ? 1 : undefined, name: t.name || undefined, p: flat(s) });
    }
    if (t.leisure === 'slipway') {
      const s = simplify(wayPts(w), TOL);
      if (s.length >= 2) slipways.push({ p: flat(s) });
    }
    if (t.barrier && BARRIER_LINES.has(t.barrier)) {
      const s = simplify(wayPts(w), TOL);
      if (s.length >= 2) barriers.push({ kind: t.barrier, p: flat(s) });
    }
  }

  // multipolygon water and parks (outer rings only)
  for (const rel of rels.values()) {
    const t = rel.tags;
    if (t.type !== 'multipolygon') continue;
    if (t.amenity === 'parking' || t.natural === 'beach') {
      const outer = rel.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => ways.get(m.ref)).filter(Boolean);
      for (const ring of stitch(outer)) {
        const pts = [];
        for (const ref of ring.slice(0, -1)) { const n = nodes.get(ref); if (n) pts.push(proj(n)); }
        const s = simplify(pts, TOL);
        if (s.length < 3) continue;
        if (t.amenity === 'parking') parking.push({ kind: t.parking || undefined, p: flat(s) });
        else beaches.push({ name: t.name || undefined, p: flat(s) });
      }
      continue;
    }
    const isWater = t.natural === 'water', isPark = t.leisure === 'park' || t.landuse === 'grass' || t.landuse === 'forest';
    if (!isWater && !isPark) continue;
    const outer = rel.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => ways.get(m.ref)).filter(Boolean);
    for (const ring of stitch(outer)) {
      const pts = [];
      for (const ref of ring.slice(0, -1)) { const n = nodes.get(ref); if (n) pts.push(proj(n)); }
      const s = simplify(pts, TOL);
      if (s.length < 3) continue;
      if (isWater) water.push({ name: t.name || undefined, p: flat(s) });
      else parks.push({ kind: t.leisure || t.landuse, name: t.name || undefined, p: flat(s) });
    }
  }

  // labels: places, stations, a few named amenities, big named parks and roads handled by name in data
  const KEEP_AMENITY = new Set(['hospital', 'university', 'college', 'theatre', 'arts_centre', 'townhall', 'courthouse', 'library', 'marketplace']);
  for (const n of placeNodes.values()) {
    const t = n.tags;
    const ok = t.place || t.railway === 'station' || KEEP_AMENITY.has(t.amenity);
    if (!ok || !n.ll) continue;
    const [x, z] = proj(n.ll);
    if (!inBox(x, z)) continue;
    labels.push({ name: t.name, kind: t.place || (t.railway === 'station' ? 'station' : t.amenity), x: r1(x), z: r1(z) });
  }

  // Signals, stop signs and slipway points: absolute integer decimeters,
  // [x0, z0, x1, z1, ...], inside the box, in node id order.
  const signals = [], stops = [];
  for (const [id, kind] of [...pointNodes.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const ll = nodes.get(id);
    if (!ll) continue;
    const [x, z] = proj(ll);
    if (!inBox(x, z)) continue;
    const xi = Math.round(x * 10), zi = Math.round(z * 10);
    if (kind === 'signal') signals.push(xi, zi);
    else if (kind === 'stop') stops.push(xi, zi);
    else slipways.push({ p: [xi, zi] });
  }

  const out = {
    attribution: ATTRIBUTION,
    encoding: 'Polyline field p is delta-encoded integer decimeters [x0,z0,dx,dz,...]; decode: x=sum(dx)/10 meters. Label x,z are plain meters.',
    source: 'OpenStreetMap API 0.6',
    origin: { lat: lat0, lon: lon0, note: 'x east, z south, meters; equirectangular, x=(lon-lon0)*R*cos(lat0), z=-(lat-lat0)*R' },
    bounds: { minX: r1(bounds.minX), maxX: r1(bounds.maxX), minZ: r1(bounds.minZ), maxZ: r1(bounds.maxZ) },
    latLonBox: BOX,
    roads, buildings, water, coastline: coast, parks, labels,
    // 0.9.0 (docs/PLAN_V3.md 2.1 item 2; docs/MAP.md "Contents").
    parking, beaches, piers, slipways, barriers,
    points: 'signals and stops are absolute integer decimeters [x0, z0, x1, z1, ...]',
    signals, stops,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(out);
  fs.writeFileSync(OUT, json);
  console.log('Origin lat/lon:', lat0, lon0);
  console.log('Bounds (m):', JSON.stringify(out.bounds));
  console.log('Now run node scripts/split-map.mjs to write the region files (docs/PLAN_V2.md 3.6).');
  console.log(`Counts: roads ${roads.length}, buildings ${buildings.length}, water ${water.length}, coastline ${coast.length}, parks ${parks.length}, labels ${labels.length}`);
  console.log(`  parking ${parking.length}, beaches ${beaches.length}, piers ${piers.length}, slipways ${slipways.length}, barriers ${barriers.length}, signals ${signals.length / 2}, stops ${stops.length / 2}`);
  console.log(`Wrote ${OUT} (${(json.length / 1e6).toFixed(2)} MB)`);
  if (failed.length) console.log('FAILED tiles:', failed.join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
