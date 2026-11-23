// What a Miami region needs on top of the hand tables (docs/PLAN_V2.md 3.3):
// every region must have a start view, a pier with boats, a helipad with a
// helicopter, two stunt ramps, courses, garages and adventures. Downtown
// (and the whole box) holds all of it in miami-spots.js; the four other
// regions hold only the part of those tables that falls inside them, and
// this module generates the rest from the region's own roads, shore and
// lots. Pure and seeded: no DOM, no three.js, no wall-clock time, so the
// same region data always gives the same content.
//
// attachRegionContent(city) is called by attachExplore (world/adventures.js)
// before the garages are placed; it does nothing on the whole box, on the
// island, or on Downtown (which already has everything).
import { MIAMI_SPOTS, MIAMI_COURSES } from './miami-spots.js';
import { REGIONS, inRegion, holdsAll, pointsIn, PLACE_MARGIN, CORE_REGION } from './regions.js';
import { laneOffset } from './citygen.js';
import { SECRET_IDS, placeSecrets, openGroundNear } from './secrets.js';
import { buildSpecCourses, roadPath, gateIsClear, waterLineClear } from './courses.js';
import { generateRegionRamps } from './stunts.js';

export const REGION_RAMPS = 2; // the floor: stunt ramps in every region (3.3)

const hyp = Math.hypot;
const r1 = (v) => Math.round(v * 10) / 10;

// Short names of the four generated regions (course ids, names, text).
const FLAVOUR = {
  'miami-beach': {
    slug: 'beach', loop: 'Alton Road Loop', pier: 'Sandbar Landing',
    boot: 'Sand, salt and a long road down the beach.',
    craft: 'A boat waits at the pier by the bay, a seaplane floats beside it and a helicopter stands on the open pad.',
    fleet: 'The boats, the seaplane and the helicopter wait at the pier and the helipad on this side of the bay.',
    blurb: 'Two quick laps of the beach streets, out along Alton Road and back.',
  },
  'miami-north': {
    slug: 'north', loop: 'Northside Loop', pier: 'Northside Landing',
    boot: 'Warehouses, murals and a long shore road on the north side.',
    craft: 'Boats wait at the pier on the north shore. Aircraft are at Gullwing Airfield, out in the bay.',
    fleet: 'The jet, stunt plane and heavy helicopter wait at Gullwing Airfield; a boat and a helicopter wait on the north shore.',
    blurb: 'A lap of the north side blocks, out along Northwest 36th Street and back.',
  },
  'miami-west': {
    slug: 'west', loop: 'Civic Circuit', pier: 'Riverbend Landing',
    boot: 'Corner shops, a slow river and the old streets west of town.',
    craft: 'A boat waits at the landing on the river. A helicopter stands on the open pad nearby.',
    fleet: 'The boats wait at the river landing and a helicopter waits on the open pad.',
    blurb: 'A lap of the Little Havana and Civic Center blocks, along Southwest 8th Street.',
  },
  'miami-south': {
    slug: 'south', loop: 'Roads Run', pier: 'Roads Landing',
    boot: 'Quiet diagonal streets under old trees, down to the bay.',
    craft: 'A boat waits at the pier on the south shore, with a seaplane beside it and a helicopter on the open pad.',
    fleet: 'The boats, the seaplane and the helicopter wait at the pier and the helipad on the south shore.',
    blurb: 'A lap of the Roads and the south shore, along South Miami Avenue.',
  },
};

// ---- The tables, cut to a region -------------------------------------------

// The part of the six secrets (MIAMI_SPOTS.secrets) a region holds: a point
// secret when it is PLACE_MARGIN m inside, a found-in-a-rect secret when the
// whole rect is, the Ghostwake garage point likewise. Returns a partial spec
// for placeSecrets (empty when the region holds none).
export function regionSecretSpec(region, spec = MIAMI_SPOTS.secrets) {
  const out = {};
  if (!spec) return out;
  for (const id of SECRET_IDS) {
    const s = spec[id];
    if (!s) continue;
    if (s.region ? holdsAll(region, pointsIn(s.region), PLACE_MARGIN) : inRegion(region, s.x, s.z, PLACE_MARGIN)) out[id] = s;
  }
  if (spec.garage && inRegion(region, spec.garage.x, spec.garage.z, PLACE_MARGIN)) out.garage = spec.garage;
  return out;
}

// The part of the course spec (MIAMI_COURSES) a region holds, a spec for
// buildSpecCourses with every part optional. Street, delivery and sky parts
// need all their points PLACE_MARGIN m inside; boat parts may run out on
// the water up to LAND_MARGIN m past the crop (where the build still has sea;
// Palm Island Sprint's last gate lies 100 m outside Downtown). The sky parts
// need the airfield. Pure.
export function regionCourseSpec(city, spec = MIAMI_COURSES) {
  const region = city.region;
  const hold = (v, m = PLACE_MARGIN) => holdsAll(region, pointsIn(v), m);
  const out = {};
  out.street = spec.street.filter((s) => hold(s.via));
  if (city.airfield && hold(spec.causeway)) out.causeway = spec.causeway;
  out.boats = spec.boats.filter((b) => hold([b.start, b.gates]));
  const af = city.airfield;
  if (af) {
    out.gull = spec.gull;
    if (hold(spec.threader.rings)) out.threader = spec.threader;
    const icz = (af.islet.z0 + af.islet.z1) / 2;
    if (hold([{ x: af.islet.x0 - 380, z: icz - 140 }, { x: af.islet.x0 - 520, z: icz + 120 }, { x: af.islet.x0 - 300, z: icz + 260 }], 0)) out.rooftop = spec.rooftop;
    if (city.helipads.some((p) => !(p.x > af.islet.x0 && p.x < af.islet.x1 && p.z > af.islet.z0 && p.z < af.islet.z1))) out.airmail = spec.airmail;
  }
  if (hold([spec.courier.from, spec.courier.to])) out.courier = spec.courier;
  if (hold(spec.fare)) out.fare = spec.fare;
  if (hold([spec.tide.start, spec.tide.gates])) out.tide = spec.tide;
  return out;
}

// ---- Generated: start view, texts -----------------------------------------

// The designed start places of the four generated regions: regions.js
// `start` is the one source (the build, this module and core/travel.js
// regionStart all read it). Kept under this name for the callers. The
// spawn is snapped to the street like the build does, so the same numbers
// give the same spot.
export const REGION_STARTS = Object.freeze(Object.fromEntries(REGIONS.filter((r) => r.start).map((r) => [r.id, r.start])));

// The spawn snapped to the named street near (st.x, st.z): the right-hand
// lane of the direction closest to st.heading, off buildings and junction
// boxes (the rule of the build's own spawn step in miami.js).
function snapStart(city, st) {
  let best = null, bd = Infinity;
  const inBox = (x, z, m) => {
    for (const n of city.nodes) {
      if (n.edges.length !== 2 && Math.abs(x - n.x) < n.hx + m && Math.abs(z - n.z) < n.hz + m) return true;
    }
    return false;
  };
  for (const e of city.edges) {
    if (e.name !== st.street || e.causeway || e.bridge) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    if (hyp((a.x + b.x) / 2 - st.x, (a.z + b.z) / 2 - st.z) > e.length + 400) continue;
    const fwd = Math.cos(st.heading) * e.ux + Math.sin(st.heading) * e.uz >= 0;
    if (e.oneway && !fwd) continue;
    const from = fwd ? a : b, ux = fwd ? e.ux : -e.ux, uz = fwd ? e.uz : -e.uz;
    // The right-hand lane (docs/MAP.md "Edge contract"), as the build's spawn.
    const off = laneOffset(e, (fwd ? e.lanesF : e.lanesB) - 1, fwd);
    for (let d = Math.min(e.length / 2, 12); d <= e.length - 12; d += 2) {
      const dd = fwd ? d : e.length - d;
      const x = from.x + ux * dd - uz * off, z = from.z + uz * dd + ux * off;
      const dist = hyp(x - st.x, z - st.z);
      if (dist < bd && !city.inBuilding(x, z, 3) && !inBox(x, z, 4)) { bd = dist; best = { x, z, heading: Math.atan2(uz, ux) }; }
    }
  }
  return best;
}

function startView(city) {
  const base = MIAMI_SPOTS.startView;
  const st = REGION_STARTS[city.mapId] || city.region.start;
  return {
    spawn: { street: st ? st.street : base.spawn.street, x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading },
    camera: { ...base.camera },
    time: base.time, // 17:30 clear at every new start (REVAMP 6.8)
    weather: 'clear',
    traffic: base.traffic,
    parked: base.parked,
  };
}

// ---- Generated: a pier with boats ------------------------------------------

const BOAT_SETS = [['speedboat', 'dinghy', 'jetski', 'fisher'], ['dinghy', 'speedboat', 'fisher', 'jetski']];
const rectDist = (r, x, z) => hyp(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
const NEAR = [];

// The nearest spot to `anchor` where a pier fits: a shore point on the
// main land with open water straight out from it (cardinal, like the hand
// piers), clear of buildings and roads on the bank, with a boat berth on
// each side. `reach`: open water this far past the end. Returns { pier,
// boats, dx, dz } or null.
function findPier(city, anchor, label, seed, reach = 30) {
  const c = city.crop;
  const M = 120;
  const cands = [];
  for (let x = c.x0 + M; x <= c.x1 - M; x += 30) {
    for (let z = c.z0 + M; z <= c.z1 - M; z += 30) {
      const sh = city.mainShore(x, z);
      if (sh < 3 || sh > 45) continue;
      cands.push({ x, z, d: hyp(x - anchor.x, z - anchor.z) });
    }
  }
  cands.sort((p, q) => p.d - q.d || p.x - q.x || p.z - q.z);
  const boats = BOAT_SETS[seed % BOAT_SETS.length];
  const HALF = 2.6;
  for (const cand of cands) {
    const gx = city.mainShore(cand.x + 6, cand.z) - city.mainShore(cand.x - 6, cand.z);
    const gz = city.mainShore(cand.x, cand.z + 6) - city.mainShore(cand.x, cand.z - 6);
    if (hyp(gx, gz) < 0.3) continue;
    const dx = Math.abs(gx) > Math.abs(gz) ? (gx > 0 ? -1 : 1) : 0;
    const dz = dx ? 0 : (gz > 0 ? -1 : 1);
    let x = cand.x, z = cand.z;
    for (let k = 0; k < 40 && city.mainShore(x, z) > 0; k++) { x += dx * 2; z += dz * 2; }
    if (city.mainShore(x, z) > 0) continue;
    for (const LEN of [64, 48, 36]) {
      const ex = x + dx * LEN, ez = z + dz * LEN;
      const bx = x - dx * 8, bz = z - dz * 8;
      const pier = dx
        ? { x0: Math.min(bx, ex), x1: Math.max(bx, ex), z0: z - HALF, z1: z + HALF }
        : { x0: x - HALF, x1: x + HALF, z0: Math.min(bz, ez), z1: Math.max(bz, ez) };
      // Inside the crop, clear of the other piers.
      if (pier.x0 < c.x0 + 100 || pier.x1 > c.x1 - 100 || pier.z0 < c.z0 + 100 || pier.z1 > c.z1 - 100) continue;
      if ((city.piers || []).some((p) => rectDist(p, x, z) < 80)) continue;
      // Water straight out from the shore to the end, and past it.
      let wet = true;
      for (let d = 12; d <= LEN + reach && wet; d += 6) if (city.shoreDist(x + dx * d, z + dz * d) > -2) wet = false;
      if (!wet || city.shoreDist(ex, ez) > -6) continue;
      // The bank end: no building, no road under the first 8 m back.
      city.buildingsNear(pier.x0 - 3, pier.z0 - 3, pier.x1 + 3, pier.z1 + 3, NEAR);
      if (NEAR.length) continue;
      let bank = true;
      for (let d = 0; d <= 8 && bank; d += 2) if (city.onRoad(x - dx * d, z - dz * d) || !city.isLand(x - dx * d, z - dz * d)) bank = false;
      if (!bank) continue;
      // A berth on each side of the deck.
      const spots = [];
      let berths = true;
      boats.forEach((spec, k) => {
        const side = k % 2 ? 1 : -1;
        const d = 22 + Math.floor(k / 2) * 18;
        const off = HALF + 3.2;
        const sx = dx ? x + dx * d : x + side * off;
        const sz = dx ? z + side * off : z + dz * d;
        if (city.shoreDist(sx, sz) > -3) berths = false;
        spots.push({ x: sx, z: sz, heading: Math.atan2(dz, dx), spec });
      });
      if (!berths) continue;
      pier.label = label;
      return { pier, boats: spots, dx, dz, x, z, len: LEN };
    }
  }
  return null;
}

// ---- Generated: a helipad with a helicopter ---------------------------------

// Open ground (a 14 m disc clear of buildings, props and roads, 10 m inland)
// nearest `anchor` but at least `minD` from it and 60 m from any pier.
function findHelipad(city, anchor, minD = 140) {
  const c = city.crop;
  for (let r = minD; r <= 1200; r += 30) {
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 30));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const x = r1(anchor.x + Math.cos(a) * r), z = r1(anchor.z + Math.sin(a) * r);
      if (x < c.x0 + 120 || x > c.x1 - 120 || z < c.z0 + 120 || z > c.z1 - 120) continue;
      if ((city.piers || []).some((p) => rectDist(p, x, z) < 60)) continue;
      if (city.districtOf(x, z) === 'airfield' || !openGroundNear(city, x, z, 14, 10)) continue;
      return { x, z };
    }
  }
  return null;
}

// ---- Generated: courses ----------------------------------------------------

// Junction nodes (three roads or more) the spawn's road reaches, away from
// the crop edge and off the airfield.
function reachableJunctions(city) {
  const N = city.nodes;
  const sp = city.spawn;
  let start = null, bd = Infinity;
  for (const n of N) {
    if (n.edges.length < 3) continue;
    const d = hyp(n.x - sp.x, n.z - sp.z);
    if (d < bd) { bd = d; start = n; }
  }
  if (!start) return [];
  const seen = new Uint8Array(N.length);
  const queue = [start.id];
  seen[start.id] = 1;
  for (let h = 0; h < queue.length; h++) {
    for (const eid of N[queue[h]].edges) {
      const e = city.edges[eid];
      const o = e.a === queue[h] ? e.b : e.a;
      if (!seen[o]) { seen[o] = 1; queue.push(o); }
    }
  }
  const c = city.crop;
  const gate = city.airfield ? city.airfield.gate : null;
  return queue.map((i) => N[i]).filter((n) => n.edges.length >= 3 && n !== gate
    && n.x > c.x0 + 250 && n.x < c.x1 - 250 && n.z > c.z0 + 250 && n.z < c.z1 - 250);
}

// A closed street circuit: one junction in each quarter round the start
// place, about `R` m out, joined by road. Returns [{ x, z }] or null.
function loopVia(city, js, R) {
  const sp = city.spawn;
  const best = [null, null, null, null], bestD = [Infinity, Infinity, Infinity, Infinity];
  for (const n of js) {
    const d = hyp(n.x - sp.x, n.z - sp.z);
    if (d < R * 0.55 || d > R * 1.6) continue;
    const q = Math.min(3, Math.floor((((Math.atan2(n.z - sp.z, n.x - sp.x) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * 4));
    const s = Math.abs(d - R);
    if (s < bestD[q]) { bestD[q] = s; best[q] = n; }
  }
  const pick = best.filter(Boolean);
  if (pick.length < 3) return null;
  for (let k = 0; k < pick.length; k++) {
    if (!roadPath(city, pick[k].id, pick[(k + 1) % pick.length].id)) return null;
  }
  return pick.map((n) => ({ x: n.x, z: n.z }));
}

// A delivery run: from a junction near the start to the junction whose
// straight distance is nearest 1000 m, if the road joins them.
function courierPoints(city, js) {
  const sp = city.spawn;
  let from = null, fd = Infinity;
  for (const n of js) {
    const d = hyp(n.x - sp.x, n.z - sp.z);
    if (d >= 90 && d < fd) { fd = d; from = n; }
  }
  if (!from) return null;
  const order = js.filter((n) => n !== from).map((n) => ({ n, s: Math.abs(hyp(n.x - from.x, n.z - from.z) - 1000) }));
  order.sort((p, q) => p.s - q.s || p.n.id - q.n.id);
  for (const { n } of order.slice(0, 12)) {
    if (roadPath(city, from.id, n.id)) return { from: { x: from.x, z: from.z }, to: { x: n.x, z: n.z } };
  }
  return null;
}

// A sprint along the first pier: out from its end, then a wide arc. The
// gates are checked after the build (boatOk) and the course is dropped
// where the water is too narrow.
function boatSpec(city, g, id, name, blurb) {
  const p = g.pier;
  const ex = g.dx ? (g.dx > 0 ? p.x1 : p.x0) : (p.x0 + p.x1) / 2;
  const ez = g.dz ? (g.dz > 0 ? p.z1 : p.z0) : (p.z0 + p.z1) / 2;
  const px = -g.dz, pz = g.dx;
  const at = (a, b) => ({ x: r1(ex + g.dx * a + px * b), z: r1(ez + g.dz * a + pz * b) });
  return {
    id, name, blurb, r: 16,
    start: at(50, 0),
    gates: [at(130, 0), at(230, 70), at(300, 190), at(230, 300), at(120, 330)],
  };
}

// Every gate of a boat course 60 m inside the crop, at sea, clear of the piers, with open water
// between the gates (the rules of the island's boat gates, courses.test.js).
function boatOk(city, c) {
  let prev = c.start;
  const k = city.crop;
  for (const q of c.checkpoints) {
    if (q.x < k.x0 + 60 || q.x > k.x1 - 60 || q.z < k.z0 + 60 || q.z > k.z1 - 60) return false;
    if (!gateIsClear(city, q.x, q.z)) return false;
    if (!waterLineClear(city, prev.x, prev.z, q.x, q.z, -8)) return false;
    prev = q;
  }
  return true;
}

// ---- The entry -------------------------------------------------------------

// Adds what the region's tables lack. Idempotent (city.regionContent).
export function attachRegionContent(city) {
  const region = city && city.region;
  if (!region || city.regionContent || !city.nodes || !city.lots || !city.lots.length) return city;
  city.regionContent = true;
  // The core region (Downtown) has its hand tables; the others get generated content.
  const generated = region.id !== CORE_REGION;
  if (generated) dressRegion(city);

  // The secrets the region holds (Downtown's came with the build).
  if (!city.secretSpots.length && generated) {
    const spec = regionSecretSpec(region);
    if (Object.keys(spec).length) {
      const sec = placeSecrets(city, spec);
      const notes = MIAMI_SPOTS.secretNotes || {};
      for (const sp of sec.spots) if (notes[sp.id]) sp.note = notes[sp.id];
      city.secretSpots = sec.spots;
      city.secretGarage = sec.garage;
    }
  }

  // Courses: the spec cut to the region, plus the generated ones.
  if (!city.courseSpec && generated) {
    const spec = regionCourseSpec(city);
    const f = FLAVOUR[region.id];
    const gen = [];
    if (f) {
      const js = reachableJunctions(city);
      if (js.length) {
        for (const R of [520, 380, 700, 300]) {
          const via = loopVia(city, js, R);
          if (!via) continue;
          let per = 0;
          for (let k = 0; k < via.length; k++) per += hyp(via[k].x - via[(k + 1) % via.length].x, via[k].z - via[(k + 1) % via.length].z);
          spec.street.push({ id: 'street-' + f.slug + '-loop', name: f.loop, laps: per * 1.25 < 2600 ? 2 : 1, blurb: f.blurb, via });
          break;
        }
        const cp = courierPoints(city, js);
        if (cp && !spec.courier) {
          spec.courier = {
            id: 'deliver-' + f.slug + '-courier', name: f.slug === 'west' ? 'Corner Shop Parcel' : 'Parcel Dash ' + f.slug[0].toUpperCase() + f.slug.slice(1),
            blurb: 'A parcel for the other side of the district. Do not dawdle.', from: cp.from, to: cp.to,
          };
        }
      }
      if (city.regionPier) {
        const b = boatSpec(city, city.regionPier, 'boat-' + f.slug + '-sprint', f.pier + ' Sprint', 'A short dash out from ' + f.pier + ' and round the buoys.');
        gen.push(b.id);
        spec.boats.push(b);
      }
    }
    city.courseSpec = spec;
    city.courses = buildSpecCourses(city, spec).filter((c) => !gen.includes(c.id) || boatOk(city, c));
    // A generated sprint that failed its water check is not kept in the spec either.
    spec.boats = spec.boats.filter((b) => !gen.includes(b.id) || city.courses.some((c) => c.id === b.id));
  }
  return city;
}

// The generated content of a non-default region: start view and texts, a
// pier with boats when the region has no main-land pier, a helipad with a
// helicopter when it has none off the airfield, a seaplane at the pier for
// Beach and South, and ramps up to REGION_RAMPS.
export function dressRegion(city) {
  const region = city.region;
  const f = FLAVOUR[region.id];
  city.regionDressed = true;
  // The designed start place replaces the draft spawn (same object: the
  // game reads city.spawn after this).
  const ds = REGION_STARTS[region.id] ? snapStart(city, REGION_STARTS[region.id]) : null;
  if (ds) { city.spawn.x = ds.x; city.spawn.z = ds.z; city.spawn.heading = ds.heading; }
  city.startView = startView(city);
  if (f) city.texts = { ...(city.texts || {}), craft: f.craft, fleet: f.fleet, boot: f.boot };
  const af = city.airfield;
  const onIslet = (p) => !!af && p.x > af.islet.x0 && p.x < af.islet.x1 && p.z > af.islet.z0 && p.z < af.islet.z1;
  const sp = city.spawn;

  // A pier (the airfield dock does not count: it is the last pier and
  // belongs to Gullwing). Put first, so the dock stays last.
  const main = (city.piers || []).filter((p) => p.label !== 'Airfield Dock' && city.mainShore((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) > -200);
  let g = null;
  if (!main.length) {
    // Open water first (a sprint can run from it), then any water (a river).
    g = findPier(city, sp, f ? f.pier : 'Landing', region.id.length, 220) || findPier(city, sp, f ? f.pier : 'Landing', region.id.length);
    if (g) {
      city.piers.unshift(g.pier);
      for (const b of g.boats) city.boatSpots.push(b);
      city.pois.push({ type: 'marina', x: r1(g.x + g.dx * 20), z: r1(g.z + g.dz * 20), label: g.pier.label });
      city.regionPier = g;
    }
  } else city.regionPier = null;

  // A seaplane floats beside the pier (Beach and South).
  if (g && (region.id === 'miami-beach' || region.id === 'miami-south') && !city.aircraftSpots.some((a) => a.spec === 'seaplane')) {
    const ex = g.dx ? (g.dx > 0 ? g.pier.x1 : g.pier.x0) : (g.pier.x0 + g.pier.x1) / 2;
    const ez = g.dz ? (g.dz > 0 ? g.pier.z1 : g.pier.z0) : (g.pier.z0 + g.pier.z1) / 2;
    const px = -g.dz, pz = g.dx;
    let put = false;
    for (const [a, b] of [[30, 24], [30, -24], [44, 30], [44, -30], [60, 0]]) {
      const x = r1(ex + g.dx * a + px * b), z = r1(ez + g.dz * a + pz * b);
      if (city.shoreDist(x, z) < -25) {
        city.aircraftSpots.push({ x, z, heading: Math.atan2(g.dz, g.dx), spec: 'seaplane' });
        put = true;
        break;
      }
    }
    if (!put) city.aircraftSpots.push({ x: r1(ex + g.dx * 30), z: r1(ez + g.dz * 30), heading: Math.atan2(g.dz, g.dx), spec: 'seaplane' });
  }

  // A helipad on open ground, with a helicopter on it.
  if (!city.helipads.some((p) => !onIslet(p))) {
    const h = findHelipad(city, sp);
    if (h) {
      city.helipads.push({ x: h.x, z: h.z });
      city.aircraftSpots.push({ x: h.x, z: h.z, heading: -Math.PI / 2, spec: 'heli' });
    }
  }

  // Ramps to two.
  const more = generateRegionRamps(city, REGION_RAMPS);
  for (const r of more) {
    city.rampSpots.push(r);
    for (let i = city.parkingSpots.length - 1; i >= 0; i--) {
      if (hyp(city.parkingSpots[i].x - r.x, city.parkingSpots[i].z - r.z) < r.r + 6) city.parkingSpots.splice(i, 1);
    }
  }
  return city;
}
