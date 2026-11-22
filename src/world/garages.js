// The twelve garages of the Miami map (docs/REVAMP.md 6.6): lock-ups the
// player drives into to store, swap and repaint cars. Pure logic (no
// three.js, no DOM): placement reads the city's lots and a fixed seed, so
// every build puts them in the same places. systems/garages.js runs them,
// render/exploremesh.js draws them. The island has none.
//
// Coordinates: x east, z south, metres. Heading 0 faces +x.
import { createRng } from '../core/rng.js';

export const GARAGE_SEED = 7129;
export const GARAGE_FIND_R = 400; // m: coming this close puts it on the map
export const GARAGE_USE_R = 7; // m from `door`, speed under 3 m/s, to offer GARAGE
export const GARAGE_USE_SPEED = 3; // m/s
export const GARAGE_DOOR_R = 15; // m: the roller door opens this close
export const GARAGE_CARS_MAX = 24;
export const GARAGE_BONUS = 500; // points for the first visit to each garage
export const GARAGE_MOVE_MAX = 300; // m an anchor may move to find a legal spot
export const GARAGE_APART = 900; // m between any two garages

// Shed and forecourt sizes (the 16 by 22 m rect: shed 10 by 14 at the
// back, forecourt the front 8 m).
export const SHED_W = 10;
export const SHED_D = 14;
export const SHED_H = 4.5;
export const RECT_W = 16;
export const RECT_D = 22;
export const FORECOURT = 8;
const WALL = 0.4;
const DOOR_H = 3.6;
// m from the door, straight out, to the carriageway: the 8 m forecourt and
// the 4 m pavement plus a little for a road that is not square to it.
export const DOOR_ROAD = 15;

const LOT_OK = new Set(['works', 'carpark', 'grass', 'site']);
const LOT_FALLBACK = new Set(['works', 'carpark', 'grass', 'site', 'yard', 'plaza', 'park']);
const FAST_ROADS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

// Ids, invented names, neighbourhoods and anchors (the 6.6 table).
export const GARAGE_DEFS = [
  { id: 'g-downtown', name: 'First Street Lock-up', hood: 'Downtown', x: -1300, z: 560, known: true, locked: null, nearStart: 350 },
  { id: 'g-brickell', name: 'Keyside Garage', hood: 'Brickell', x: -1300, z: 1650, known: false, locked: null },
  { id: 'g-wynwood', name: 'The Paintshed', hood: 'Wynwood', x: -2100, z: -2150, known: false, locked: null },
  { id: 'g-edgewater', name: 'Bayline Garage', hood: 'Edgewater', x: -800, z: -1900, known: false, locked: null },
  { id: 'g-watson', name: 'Seaplane Sheds', hood: 'Watson Island', x: 450, z: -500, known: false, locked: null },
  { id: 'g-allapattah', name: 'Northwest Yard', hood: 'Allapattah', x: -3700, z: -2900, known: false, locked: null },
  { id: 'g-civic', name: 'Riverbend Garage', hood: 'Civic Center', x: -3400, z: -700, known: false, locked: null },
  { id: 'g-havana', name: 'Ocho Lock-up', hood: 'Little Havana', x: -3600, z: 1200, known: false, locked: null },
  { id: 'g-roads', name: 'Roads End Garage', hood: 'The Roads', x: -2400, z: 2500, known: false, locked: 'a-roads-end' },
  { id: 'g-design', name: 'Atelier Garage', hood: 'Design District', x: -1100, z: -3600, known: false, locked: null },
  { id: 'g-beach', name: 'Sandbar Garage', hood: 'Miami Beach', x: 3900, z: -1200, known: false, locked: 'a-sandbar' },
  { id: 'g-key', name: 'Key Point Shed', hood: 'Virginia Key', x: 2750, z: 3250, known: false, locked: 'a-far-key' },
];
export const GARAGE_IDS = GARAGE_DEFS.map((d) => d.id);
export const LOCKED_GARAGES = GARAGE_DEFS.filter((d) => d.locked).map((d) => d.id);

// Sixteen paint colours for the repaint grid, taken from the car palettes
// in entities/vehicle.js (the colours cars already come in).
export const PAINT_COLORS = [
  0xc8402e, 0xd81e2a, 0x8c1c13, 0xff7a1a, 0xf0a030, 0xf2d21b,
  0x6bbf59, 0x2d6a4f, 0x0f9e92, 0x3a7bd5, 0x1e6fd8, 0x14213d,
  0xe8e2d0, 0xb8b8b0, 0x5b6770, 0x111111,
];

const HEAD = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const r1 = (v) => Math.round(v * 10) / 10;

// The garage built round its door: door middle at (dx, dz), facing the
// cardinal direction `front` (0 +x, 1 +z, 2 -x, 3 -z). Everything is axis
// aligned because the heading is cardinal.
export function garageShape(def, doorX, doorZ, front) {
  const heading = HEAD[front];
  const ux = Math.round(Math.cos(heading)), uz = Math.round(Math.sin(heading));
  const px = -uz, pz = ux;
  const P = (f, s) => [doorX + ux * f + px * s, doorZ + uz * f + pz * s];
  const box = (f0, f1, s0, s1, h) => {
    const a = P(f0, s0), b = P(f1, s1);
    return { x0: r1(Math.min(a[0], b[0])), z0: r1(Math.min(a[1], b[1])), x1: r1(Math.max(a[0], b[0])), z1: r1(Math.max(a[1], b[1])), h };
  };
  const hw = SHED_W / 2;
  const c = P(-SHED_D / 2, 0);
  const bay = P(FORECOURT / 2, 0);
  const rect = box(-SHED_D, FORECOURT, -RECT_W / 2, RECT_W / 2, 0);
  return {
    id: def.id,
    name: def.name,
    hood: def.hood,
    place: '',
    x: r1(c[0]), z: r1(c[1]), heading,
    front,
    door: { x: r1(doorX), z: r1(doorZ) },
    bay: { x: r1(bay[0]), z: r1(bay[1]), heading },
    // Inside, where a stored car stands on show.
    inside: { x: r1(c[0]), z: r1(c[1]), heading },
    footprint: box(-SHED_D, 0, -hw, hw, SHED_H),
    walls: [
      box(-SHED_D, -SHED_D + WALL, -hw, hw, SHED_H),
      box(-SHED_D, 0, -hw, -hw + WALL, SHED_H),
      box(-SHED_D, 0, hw - WALL, hw, SHED_H),
    ],
    doorBox: box(-0.15, 0.15, -hw + WALL, hw - WALL, DOOR_H),
    rect,
    // The clear rect lot dressing skips (world/lots.js dressLot): the
    // shed and forecourt plus 2 m.
    x0: rect.x0 - 2, z0: rect.z0 - 2, x1: rect.x1 + 2, z1: rect.z1 + 2,
    known: !!def.known,
    locked: def.locked || null,
    core: false,
    road: true, // false: no road reaches it (see offRoadCandidates)
  };
}

const NEAR = [];
function clearOfBuildings(city, r, m) {
  if (!city.buildingsNear) return true;
  city.buildingsNear(r.x0 - m - 1, r.z0 - m - 1, r.x1 + m + 1, r.z1 + m + 1, NEAR);
  for (let i = 0; i < NEAR.length; i++) {
    const b = city.buildings[NEAR[i]];
    if (b.x0 < r.x1 + m && b.x1 > r.x0 - m && b.z0 < r.z1 + m && b.z1 > r.z0 - m) return false;
  }
  return true;
}

// Every 2 m inside the shed: a lot of an allowed type (so land, not road,
// not a building). Every 2 m of the forecourt: land, off the road, outside
// buildings (it may take in a strip of pavement). All of it 12 m inland.
function inRect(r, x, z) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}
function rectGround(city, g, types) {
  const r = g.rect, fp = g.footprint;
  for (let x = r.x0; x <= r.x1 + 1e-6; x += 2) {
    for (let z = r.z0; z <= r.z1 + 1e-6; z += 2) {
      if (city.onRoad(x, z)) return false;
      if (inRect(fp, x, z)) {
        const lot = city.lotAt(x, z);
        if (!lot || !types.has(lot.type)) return false;
      } else if (!city.isLand(x, z) || (city.inBuilding && city.inBuilding(x, z, 0))) return false;
    }
  }
  for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
    if (city.mainShore(x, z) < 12) return false;
  }
  return true;
}

// Distance from the door to the carriageway, looking out of the door
// (straight ahead and up to 45 degrees either side), or Infinity past
// `max`. A road at a slant to the shed is still close to its door.
const FAN = [0, -0.4, 0.4, -0.8, 0.8];
export function doorToRoad(city, g, max = 20) {
  let best = Infinity;
  for (let k = 0; k < FAN.length; k++) {
    const a = g.heading + FAN[k];
    const ux = Math.cos(a), uz = Math.sin(a);
    for (let d = 0; d <= max && d < best; d += 0.5) {
      if (city.onRoad(g.door.x + ux * d, g.door.z + uz * d)) { best = d; break; }
    }
  }
  return best;
}

// Things a garage keeps 30 m from: ramps, secrets, course starts.
function keepOuts(city) {
  const out = [];
  for (const r of city.rampSpots || []) out.push({ x: r.x, z: r.z });
  for (const s of city.secretSpots || []) out.push({ x: s.x, z: s.z });
  if (city.secretGarage) out.push({ x: city.secretGarage.x, z: city.secretGarage.z });
  for (const c of city.courses || []) out.push({ x: c.start.x, z: c.start.z });
  return out;
}

// Candidate door spots for one anchor: along every road edge within
// reach (not a bridge, causeway or motorway class) that runs close to a
// cardinal direction, on both sides, every 4 m, with the rect's front just
// past the 4 m pavement. Sorted by distance to the anchor; ties broken by
// the seeded rng.
export function candidates(city, def, rng) {
  const out = [];
  const N = city.nodes;
  const R = GARAGE_MOVE_MAX;
  for (const e of city.edges) {
    if (e.bridge || e.causeway || FAST_ROADS.has(e.cls)) continue;
    const a = N[e.a], b = N[e.b];
    if (!a || !b) continue;
    // Quick reject: the whole edge is far from the anchor.
    const minX = Math.min(a.x, b.x) - R, maxX = Math.max(a.x, b.x) + R;
    const minZ = Math.min(a.z, b.z) - R, maxZ = Math.max(a.z, b.z) + R;
    if (def.x < minX || def.x > maxX || def.z < minZ || def.z > maxZ) continue;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < 12) continue;
    const ux = dx / L, uz = dz / L;
    const off = e.width / 2 + 4.5 + FORECOURT;
    for (let t = 6; t <= L - 6; t += 2) {
      const px = a.x + ux * t, pz = a.z + uz * t;
      for (const side of [1, -1]) {
        // Facing back toward the road: the cardinal nearest to -normal.
        const nx = -uz * side, nz = ux * side;
        const front = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 2 : 0) : (nz > 0 ? 3 : 1);
        const hx = Math.round(Math.cos(HEAD[front])), hz = Math.round(Math.sin(HEAD[front]));
        // Door: off the centre line along the cardinal away from the road
        // (farther when the road runs at a slant to it), and a little more.
        const dot = Math.max(0.5, Math.abs(nx * hx + nz * hz));
        for (let extra = -4; extra <= 4; extra += 2) {
          const o = off / dot + extra;
          const doorX = px - hx * o, doorZ = pz - hz * o;
          const d = Math.hypot(doorX - def.x, doorZ - def.z);
          if (d > R) continue;
          out.push({ x: doorX, z: doorZ, front, d, tie: 0, road: true });
        }
      }
    }
  }
  for (const c of out) c.tie = rng.next();
  out.sort((p, q) => p.d - q.d || p.tie - q.tie);
  return out;
}

// No road within reach (Virginia Key has none in the data): an 8 m grid
// round the anchor, every facing, nearest first. Reached by boat, by air
// or by a car taken out there.
function offRoadCandidates(def, rng) {
  const out = [];
  const R = GARAGE_MOVE_MAX;
  for (let x = -R; x <= R; x += 8) {
    for (let z = -R; z <= R; z += 8) {
      const d = Math.hypot(x, z);
      if (d > R) continue;
      for (let f = 0; f < 4; f++) out.push({ x: def.x + x, z: def.z + z, front: f, d, tie: 0, road: false });
    }
  }
  for (const c of out) c.tie = rng.next();
  out.sort((p, q) => p.d - q.d || p.tie - q.tie);
  return out;
}

export function tryAt(city, def, c, taken, keep, types) {
  const g = garageShape(def, c.x, c.z, c.front);
  if (keep.some((p) => Math.hypot(p.x - g.x, p.z - g.z) < 30)) return null;
  if (def.nearStart && city.spawn && Math.hypot(city.spawn.x - g.x, city.spawn.z - g.z) > def.nearStart) return null;
  if (taken.some((t) => Math.hypot(t.x - g.x, t.z - g.z) < GARAGE_APART)) return null;
  if (!rectGround(city, g, types)) return null;
  if (!clearOfBuildings(city, g.rect, 6)) return null;
  if (c.road && doorToRoad(city, g) > DOOR_ROAD) return null;
  return g;
}

// city.garages: the twelve garages in GARAGE_DEFS order. Throws when an
// anchor has no legal spot (a data change the tests must catch). Returns
// [] on a map without lots (the island).
export function placeGarages(city, seed = GARAGE_SEED) {
  if (!city || !Array.isArray(city.lots) || !city.lots.length || !city.lotAt) return [];
  const keep = keepOuts(city);
  const out = [];
  GARAGE_DEFS.forEach((def, i) => {
    const rng = createRng(seed + i);
    const list = candidates(city, def, rng);
    let g = null;
    // The contract's lot types first; where a neighbourhood has none of
    // them within reach (The Roads and Little Havana are all gardens,
    // Virginia Key all park), any open lot that is not a verge or beach.
    for (const types of [LOT_OK, LOT_FALLBACK]) {
      for (let k = 0; k < list.length && !g; k++) g = tryAt(city, def, list[k], out, keep, types);
      if (g) break;
    }
    if (!g && !list.length) {
      const free = offRoadCandidates(def, rng);
      for (let k = 0; k < free.length && !g; k++) g = tryAt(city, def, free[k], out, keep, LOT_FALLBACK);
      if (g) g.road = false;
    }
    if (!g) throw new Error('garages: no spot for ' + def.id);
    g.place = city.placeOf ? city.placeOf(g.x, g.z) : def.hood;
    g.core = city.inCore ? city.inCore(g.x, g.z) : false;
    out.push(g);
  });
  return out;
}

export const garageById = (list, id) => {
  if (!list) return null;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
};

// Within reach of the door to use the garage: GARAGE_USE_R and slow.
export function atDoor(g, x, z, speed = 0) {
  const dx = x - g.door.x, dz = z - g.door.z;
  return dx * dx + dz * dz <= GARAGE_USE_R * GARAGE_USE_R && Math.abs(speed) < GARAGE_USE_SPEED;
}
