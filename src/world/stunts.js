// Stunt ramps: where they are and what shape they are. Pure data from
// the seeded city layout (no drawing), so node tests can use it.
//
// Every ramp is a "tabletop": a slope up, a flat top and a slope down,
// along `heading` (both ways work). A car (or boat, on the water ramp)
// that crests the slope fast enough flies off it; systems/stunts.js does
// the flying and the scoring. Docs: docs/SPEC.md "Stunt jumps".
import { createRng } from '../core/rng.js';

// Shapes (metres): slope length, flat top length, height, width.
export const RAMP_LAND = { slope: 6, top: 4, height: 1.5, width: 6.5 };
export const RAMP_WATER = { slope: 7, top: 2.5, height: 1.25, width: 6 };
export const STREET_RAMPS = 4; // quiet-street ramps, plus the two at the airfield dock
const MIN_GAP = 240; // m between street ramps
const QUIET = { residential: 3, park: 3, beach: 2, industrial: 1 }; // district preference
const SUFFIX = ['Hop', 'Kicker', 'Leap', 'Launch', 'Skip'];
const DISTRICT_LABEL = {
  residential: 'Fernside', park: 'Greenmere', beach: 'Pale Shore', industrial: 'Cinder Row',
};

export function makeSpot(id, name, x, z, heading, shape = RAMP_LAND, water = false) {
  const half = shape.slope + shape.top / 2;
  return {
    id, name, x, z, heading, water,
    ax: Math.cos(heading), az: Math.sin(heading), // along the ramp
    slope: shape.slope, top: shape.top, height: shape.height, width: shape.width,
    half, // half the total length
    angle: Math.atan2(shape.height, shape.slope), // slope angle (rad)
    r: Math.hypot(half, shape.width / 2), // bounding radius
  };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Surface height of a ramp at (x, z): 0 off the ramp, `height` on top.
export function rampHeight(spot, x, z) {
  const dx = x - spot.x, dz = z - spot.z;
  const u = dx * spot.ax + dz * spot.az;
  const v = -dx * spot.az + dz * spot.ax;
  if (v > spot.width / 2 || v < -spot.width / 2) return 0;
  const au = u < 0 ? -u : u;
  if (au > spot.half) return 0;
  const t2 = spot.top / 2;
  if (au <= t2) return spot.height;
  return spot.height * (1 - (au - t2) / spot.slope);
}

// The ramp under (x, z), or null. `water` picks land or water ramps.
export function rampAt(spots, x, z, water) {
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (s.water !== water) continue;
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz > s.r * s.r) continue;
    if (rampHeight(s, x, z) > 0) return s;
  }
  return null;
}

// Highest ramp surface under (x, z) (0 = the ground or the sea).
export function groundUnder(spots, x, z, water) {
  let h = 0;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (s.water !== water) continue;
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz > s.r * s.r) continue;
    const y = rampHeight(s, x, z);
    if (y > h) h = y;
  }
  return h;
}

function clearOfBuildings(city, x, z, r) {
  const bs = city.buildings || [];
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return false;
  }
  return true;
}

// The ramps for a city: a few on quiet streets (seeded pick of
// residential, park, beach and industrial street middles, spread apart)
// and two at the airfield dock (one on the quay, one in the water).
export function generateStuntSpots(city, seed = (city && city.seed) || 1) {
  const out = [];
  if (!city || !city.nodes || !city.edges) return out;
  if (Array.isArray(city.rampSpots)) return city.rampSpots.slice(); // hand-placed (Miami)
  const rng = createRng((seed ^ 0x57a7) >>> 0);
  const cands = [];
  for (const e of city.edges) {
    if (e.avenue || e.causeway || !(e.length > 60)) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    const d = city.districtOf ? city.districtOf(x, z) : 'residential';
    const w = QUIET[d];
    if (!w) continue;
    const heading = e.horizontal ? 0 : Math.PI / 2;
    const hx = Math.cos(heading) * RAMP_LAND.slope * 2, hz = Math.sin(heading) * RAMP_LAND.slope * 2;
    if (city.isLand && (!city.isLand(x + hx, z + hz) || !city.isLand(x - hx, z - hz))) continue;
    if (city.shoreDist && city.shoreDist(x, z) < 30) continue;
    cands.push({ x, z, heading, d, key: w + rng.next() });
  }
  cands.sort((p, q) => q.key - p.key);
  const used = new Set();
  const perDistrict = {};
  // Two passes: first one ramp per district (variety), then fill up.
  const picks = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const c of cands) {
      if (picks.length >= STREET_RAMPS) break;
      if (picks.includes(c) || (pass === 0 && perDistrict[c.d])) continue;
      if (picks.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < MIN_GAP)) continue;
      perDistrict[c.d] = (perDistrict[c.d] || 0) + 1;
      picks.push(c);
    }
  }
  for (const c of picks) {
    const base = DISTRICT_LABEL[c.d] || 'Quiet Street';
    let name = '';
    for (let k = 0; k < SUFFIX.length && !name; k++) {
      const n = base + ' ' + SUFFIX[(rng.int(0, SUFFIX.length - 1) + k) % SUFFIX.length];
      if (!used.has(n)) name = n;
    }
    if (!name) continue;
    used.add(name);
    out.push(makeSpot('stunt_' + slug(name), name, c.x, c.z, c.heading, RAMP_LAND, false));
  }
  dockRamps(city, out);
  return out;
}

// The two ramps at the airfield dock (the last pier is the dock off the
// islet's south edge): one on the quay, one in the water.
function dockRamps(city, out) {
  const af = city.airfield;
  const dock = city.piers && city.piers.length ? city.piers[city.piers.length - 1] : null;
  if (af && af.islet && dock) {
    const dx = (dock.x0 + dock.x1) / 2;
    // On the quay: the strip of islet between the depot wall and the sea.
    const qz = af.islet.z1 - 11;
    for (const off of [-70, -100, -130, -40]) {
      const qx = dx + off;
      if (!clearOfBuildings(city, qx, qz, RAMP_LAND.slope + 4)) continue;
      if (city.isLand && !city.isLand(qx - 14, qz) && !city.isLand(qx + 14, qz)) continue;
      out.push(makeSpot('stunt_dock_kicker', 'Dock Kicker', qx, qz, 0, RAMP_LAND, false));
      break;
    }
    // In the water beside the dock, along the dock (north-south).
    out.push(makeSpot('stunt_dock_splash', 'Dock Splash', dock.x1 + 34, dock.z1 - 18, Math.PI / 2, RAMP_WATER, true));
  }
}

// A real map: hand-placed street ramps, each on the named street nearest
// its point, in the middle of a straight stretch (along the street, both
// ways), then the dock ramps. Spec: [{ name, street, x, z }].
export function placeRamps(city, spec) {
  const out = [];
  const need = RAMP_LAND.slope * 2 + RAMP_LAND.top / 2 + 6; // m of straight road each side of the centre
  for (const r of spec) {
    let best = null, bd = Infinity;
    for (const e of city.edges) {
      if (e.name !== r.street || e.bridge || e.causeway || e.avenue) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t0 = Math.max(a.hx, a.hz) + need, t1 = e.length - Math.max(b.hx, b.hz) - need;
      for (let t = t0; t <= t1; t += 2) {
        const x = a.x + e.ux * t, z = a.z + e.uz * t;
        const d = Math.hypot(x - r.x, z - r.z);
        if (d >= bd) continue;
        const hx = e.ux * RAMP_LAND.slope * 2, hz = e.uz * RAMP_LAND.slope * 2;
        if (!city.isLand(x + hx, z + hz) || !city.isLand(x - hx, z - hz) || city.shoreDist(x, z) < 30) continue;
        if (city.inBuilding && city.inBuilding(x, z, RAMP_LAND.width)) continue;
        bd = d;
        best = { x, z, heading: Math.atan2(e.uz, e.ux) };
      }
    }
    if (!best || bd > 200) throw new Error('stunts: no straight stretch of ' + r.street);
    const x = Math.round(best.x * 10) / 10, z = Math.round(best.z * 10) / 10;
    out.push(makeSpot('stunt_' + slug(r.name), r.name, x, z, Math.round(best.heading * 1000) / 1000, RAMP_LAND, false));
  }
  dockRamps(city, out);
  return out;
}
