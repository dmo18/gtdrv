// The sixteen adventures of the Miami map (docs/REVAMP.md 6.6): short
// discovery quests with a giver, one to three steps and a reward. Pure
// logic (no three.js, no DOM): the definitions are plain data, and
// placeAdventures resolves every step to a point on the city's real
// ground or water, so every build puts them in the same places.
// systems/adventures.js runs them; core/explore.js keeps the progress.
//
// Coordinates: x east, z south, metres. Heading 0 faces +x.
import { createRng, TAU } from '../core/rng.js';
import { placeGarages } from './garages.js';
import { buildRoutes } from './courses.js';

export const ADVENTURE_SEED = 9241;
export const ADV_SEEN_R = 300; // m from the giver: the adventure appears on the map
export const ADV_FINALE_BONUS = 5000; // for finishing all of them
export const ADV_SIGN_R = 4; // m from a notice board to read it
export const ADV_TALK_R = 2.5; // m on foot from a talker to offer TALK
export const ADV_TALKERS_MAX = 2;
export const ADV_TALKER_NEAR = 200; // m: talkers stand only this close
export const KIND_SCORE = { lookout: 1000, hidden: 1000, clue: 1500, tour: 1500 };
export const ADV_KINDS = ['lookout', 'clue', 'hidden', 'tour'];
export const STEP_MODES = ['any', 'foot', 'car', 'boat', 'air'];

// The three reward cars (entities/vehicle.js VEHICLE_SPECS), by adventure.
export const REWARD_CARS = { 'a-sunchaser': 'sunchaser', 'a-tidewinder': 'tidewinder', 'a-nightheron': 'nightheron' };

// The three locked routes: built by world/courses.js buildRoutes in the
// shape of MIAMI_COURSES.street and .boats entries; activities hide each
// until its adventure is done.
export const ROUTE_SPECS = {
  street: [
    { id: 'street-x-keys', name: 'Key Bridge Loop', laps: 2, locked: 'a-keys-dash',
      blurb: 'Two laps of Brickell: down the avenue, over the little bridge to Brickell Key and back.',
      via: [{ x: -1000, z: 1250 }, { x: -520, z: 1480 }, { x: -1050, z: 1800 }, { x: -1450, z: 1500 }] },
    { id: 'street-x-beach', name: 'Beach Mile Sprint', laps: 1, locked: 'a-beach-mile',
      blurb: 'One fast lap of Miami Beach, up the island and back down by the sand.',
      via: [{ x: 3700, z: -3000 }, { x: 4300, z: -3000 }, { x: 4300, z: -900 }, { x: 3700, z: -900 }] },
  ],
  boats: [
    { id: 'boat-x-river', name: 'River Mouth Run', r: 9, river: true, locked: 'a-river-run',
      blurb: 'From Bayfront Marina down the bay and in under the first bridge of the Miami River.',
      start: { x: -250, z: 600 },
      gates: [{ x: -250, z: 780 }, { x: -270, z: 950 }, { x: -380, z: 1030 }, { x: -520, z: 1060 }, { x: -680, z: 1076 },
        { x: -742, z: 1066 }, { x: -800, z: 1086 }, { x: -870, z: 1104 }] },
  ],
};
export const ROUTE_IDS = ['boat-x-river', 'street-x-keys', 'street-x-beach'];

// The sixteen definitions. `at` is resolved by placeAdventures into the
// step's x, z (see resolveStep). Clues never give coordinates.
const S = (clue, at, o = {}) => ({ clue, at, r: o.r || 15, minY: o.minY ?? null, mode: o.mode || 'any', stunt: o.stunt || null, hint: o.hint || 120 });
const R = (score, o = {}) => ({ score, garage: o.garage || null, car: o.car || null, route: o.route || null });
export const ADVENTURE_DEFS = [
  {
    id: 'a-first-light', name: 'First Light', kind: 'lookout', order: 'seq', needs: [],
    giver: { type: 'start', x: 0, z: 0, garage: null, line: 'Locals say the best sunrise in town is from the end of the marina pier.' },
    steps: [S('Walk or drive out to the very end of the Bayfront Marina pier.', { pier: 'Bayfront Marina' }, { r: 12, hint: 60 })],
    reward: R(KIND_SCORE.lookout),
  },
  {
    id: 'a-roads-end', name: 'Roads End', kind: 'clue', order: 'seq', needs: [],
    giver: { type: 'garage', x: 0, z: 0, garage: 'g-havana', line: 'The mechanic swears there is a forgotten lock-up where the Roads run out.' },
    steps: [
      S('Start where the river boats tie up by the little park in Little Havana.', { anchor: { x: -2312, z: 430 } }, { r: 18, hint: 150 }),
      S('Follow the river down and turn south, past the big towers, to the diagonal streets.', { anchor: { x: -2050, z: 1950 } }, { r: 20, hint: 160 }),
      S('Where the Roads run out toward the bay, look for an old shed.', { garage: 'g-roads' }, { r: 18, hint: 140 }),
    ],
    reward: R(KIND_SCORE.clue, { garage: 'g-roads' }),
  },
  {
    id: 'a-sandbar', name: 'Sandbar Walk', kind: 'tour', order: 'any', needs: [],
    giver: { type: 'sign', x: 3300, z: -1250, garage: null, line: 'Notice: three old sandbars along Miami Beach. See them all and the keys to a shed are yours.' },
    steps: [
      S('The north sandbar, up where the island narrows.', { anchor: { x: 4300, z: -3300 } }, { r: 20, hint: 180 }),
      S('The middle sandbar, halfway down the beach.', { anchor: { x: 4300, z: -1900 } }, { r: 20, hint: 180 }),
      S('The south sandbar, close to the far point.', { anchor: { x: 4300, z: 700 } }, { r: 20, hint: 180 }),
    ],
    reward: R(KIND_SCORE.tour, { garage: 'g-beach' }),
  },
  {
    id: 'a-far-key', name: 'The Far Key', kind: 'lookout', order: 'seq', needs: [],
    giver: { type: 'talker', x: 2300, z: 1250, garage: null, line: 'Ever been to the north point of the key across the channel? Nobody goes there. Take a boat.' },
    steps: [S('The north point of Virginia Key, across the water from the port.', { anchor: { x: 2875, z: 2720 } }, { r: 20, hint: 150 })],
    reward: R(KIND_SCORE.lookout, { garage: 'g-key' }),
  },
  {
    id: 'a-river-run', name: 'River Run', kind: 'clue', order: 'seq', needs: [],
    giver: { type: 'talker', x: -2350, z: 600, garage: null, line: 'The river pilots race at dusk. Bring a boat round the key and up into the river.' },
    steps: [
      S('Take a boat round the little island with the lighthouse, out on its bay side.', { water: { x: -150, z: 1500 } }, { r: 20, mode: 'boat', hint: 140 }),
      S('Then north up the bay to where the river comes out, past the hall on the bank.', { water: { x: -700, z: 1078 } }, { r: 18, mode: 'boat', hint: 120 }),
      S('Into the river itself, right under the first bridge.', { water: { x: -880, z: 1110 } }, { r: 16, mode: 'boat', hint: 100 }),
    ],
    reward: R(KIND_SCORE.clue, { route: 'boat-x-river' }),
  },
  {
    id: 'a-keys-dash', name: 'Keys Dash', kind: 'hidden', order: 'seq', needs: [],
    giver: { type: 'sign', x: -700, z: 1000, garage: null, line: 'Notice: a racer hid a stopwatch on Brickell Key. Find it and the loop is yours.' },
    steps: [S('Somewhere on the little island at the end of Brickell, off the road.', { lot: ['park', 'grass', 'plaza', 'carpark'], near: { x: -480, z: 1500 }, within: 220 }, { r: 10, hint: 160 })],
    reward: R(KIND_SCORE.hidden, { route: 'street-x-keys' }),
  },
  {
    id: 'a-beach-mile', name: 'Beach Mile', kind: 'tour', order: 'any', needs: ['a-sandbar'],
    giver: { type: 'sign', x: 3600, z: -2400, garage: null, line: 'Notice: three lifeguard posts, one mile apart. Run them all to open the Beach Mile.' },
    steps: [
      S('The northern lifeguard post.', { anchor: { x: 4380, z: -3700 } }, { r: 18, hint: 150 }),
      S('The lifeguard post by the middle of the beach.', { anchor: { x: 4380, z: -2600 } }, { r: 18, hint: 150 }),
      S('The southern lifeguard post.', { anchor: { x: 4380, z: -1100 } }, { r: 18, hint: 150 }),
    ],
    reward: R(KIND_SCORE.tour, { route: 'street-x-beach' }),
  },
  {
    id: 'a-sunchaser', name: 'Chasing the Sun', kind: 'clue', order: 'seq', needs: [],
    giver: { type: 'talker', x: -2050, z: -2350, garage: null, line: 'A painter left a car for whoever follows her colours. Start at the water tank.' },
    steps: [
      S('Start under the old water tank above the warehouses.', { landmark: 'wynwood-tank' }, { r: 20, hint: 120 }),
      S('Her colours lead north to the shops with the big glass fronts.', { anchor: { x: -1150, z: -3500 } }, { r: 20, hint: 160 }),
      S('The last mark is on a quiet corner at the top of the design blocks.', { anchor: { x: -1300, z: -3850 } }, { r: 18, hint: 140 }),
    ],
    reward: R(KIND_SCORE.clue, { car: 'sunchaser' }),
  },
  {
    id: 'a-tidewinder', name: 'Tidewinder', kind: 'hidden', order: 'seq', needs: [],
    giver: { type: 'garage', x: 0, z: 0, garage: 'g-allapattah', line: 'A pickup has been sitting in one of the works yards round here for years. Find it.' },
    steps: [S('Behind a works yard fence somewhere in Allapattah.', { lot: ['works'], near: { x: -3900, z: -2450 }, within: 200 }, { r: 10, hint: 180 })],
    reward: R(KIND_SCORE.hidden, { car: 'tidewinder' }),
  },
  {
    id: 'a-nightheron', name: 'Night Heron', kind: 'lookout', order: 'seq', needs: [],
    giver: { type: 'sign', x: -1550, z: 300, garage: null, line: 'Notice: land on the tower pad downtown and a dark sedan is yours. Helicopters only.' },
    steps: [S('Land on the rooftop pad of a Downtown tower.', { roof: { x: -1009, z: 492 } }, { r: 15, mode: 'air', hint: 120 })],
    reward: R(KIND_SCORE.lookout, { car: 'nightheron' }),
  },
  {
    id: 'a-watson-wings', name: 'Watson Wings', kind: 'tour', order: 'any', needs: [],
    giver: { type: 'talker', x: 470, z: -260, garage: null, line: 'Three things worth seeing on this island: the aviary, the helipad and the seaplane slip.' },
    steps: [
      S('The big glass aviary.', { landmark: 'watson-aviary' }, { r: 20, hint: 100 }),
      S('The helipad on open ground.', { anchor: { x: 640, z: -640 } }, { r: 18, hint: 100 }),
      S('The seaplane slip on the south shore.', { anchor: { x: 250, z: -260 } }, { r: 18, hint: 100 }),
    ],
    reward: R(KIND_SCORE.tour),
  },
  {
    id: 'a-edgewater-hush', name: 'Edgewater Hush', kind: 'hidden', order: 'seq', needs: [],
    giver: { type: 'sign', x: -630, z: -1500, garage: null, line: 'Notice: something is kept at the back of an Edgewater car park. Quietly.' },
    steps: [S('At the back of a car park, a few blocks in from the bay.', { lot: ['carpark'], near: { x: -900, z: -2100 }, within: 220 }, { r: 10, hint: 170 })],
    reward: R(KIND_SCORE.hidden),
  },
  {
    id: 'a-brickell-crawl', name: 'Brickell Crawl', kind: 'clue', order: 'seq', needs: [],
    giver: { type: 'garage', x: 0, z: 0, garage: 'g-brickell', line: 'Do the old Brickell crawl: the hall, the spires and the light, in that order.' },
    steps: [
      S('First the round hall on the river mouth.', { landmark: 'riverfront-hall' }, { r: 22, hint: 120 }),
      S('Then the foot of the twin spires.', { landmark: 'twin-spires' }, { r: 22, hint: 120 }),
      S('End at the little light on the far side of the key.', { landmark: 'key-point-light' }, { r: 18, hint: 110 }),
    ],
    reward: R(KIND_SCORE.clue),
  },
  {
    id: 'a-port-quay', name: 'End of the Quay', kind: 'lookout', order: 'seq', needs: [],
    giver: { type: 'sign', x: -620, z: 120, garage: null, line: 'Notice: the far end of the port is the best place in town to watch the ships come in.' },
    steps: [S('The far end of the port quays, past the last of the terminals.', { anchor: { x: 2380, z: 760 } }, { r: 20, hint: 150 })],
    reward: R(KIND_SCORE.lookout),
  },
  {
    id: 'a-civic-ledger', name: 'The Lost Ledger', kind: 'hidden', order: 'seq', needs: [],
    giver: { type: 'garage', x: 0, z: 0, garage: 'g-civic', line: 'A clerk dropped a ledger in a yard near here. There is a reward if you find it.' },
    steps: [S('Tucked in a yard in the Civic Center blocks.', { lot: ['grass', 'works', 'carpark', 'yard'], near: { x: -3600, z: -1050 }, within: 200 }, { r: 10, hint: 170 })],
    reward: R(KIND_SCORE.hidden),
  },
  {
    id: 'a-hammock-trail', name: 'Hammock Trail', kind: 'tour', order: 'any', needs: [],
    giver: { type: 'sign', x: -2600, z: 3000, garage: null, line: 'Notice: walk the hammock trail. Three old trees, one each in three neighbourhoods.' },
    steps: [
      S('The old tree in Shenandoah.', { anchor: { x: -3500, z: 2350 } }, { r: 18, hint: 150 }),
      S('The old tree in Bay Heights.', { anchor: { x: -3700, z: 3250 } }, { r: 18, hint: 150 }),
      S('The old tree in Brickell Hammock.', { anchor: { x: -2200, z: 3400 } }, { r: 18, hint: 150 }),
    ],
    reward: R(KIND_SCORE.tour),
  },
];
export const ADVENTURE_IDS = ADVENTURE_DEFS.map((d) => d.id);

// ---- resolving steps on the real map ------------------------------------------
const DIST = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function onPier(city, x, z, m = 0) {
  const P = city.piers || [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (x > p.x0 - m && x < p.x1 + m && z > p.z0 - m && z < p.z1 + m) return true;
  }
  return false;
}

// Where a step in `mode` may be: land outside buildings (or a pier deck)
// for foot, car and any; open water for boat; anywhere for air (the
// height check is minY).
export function stepPlaceOk(city, x, z, mode) {
  if (mode === 'boat') return city.shoreDist(x, z) < -6 && !onPier(city, x, z, 8);
  if (mode === 'air') return true;
  if (onPier(city, x, z)) return true;
  if (!city.isLand(x, z) || city.mainShore(x, z) < 2) return false;
  return !(city.inBuilding && city.inBuilding(x, z, 2));
}

// Spiral out from (x, z) in 4 m steps to `maxR`; the first point `ok`
// accepts wins (nearest ring first, then by angle).
export function nearestWhere(x, z, maxR, ok) {
  if (ok(x, z)) return { x, z };
  for (let r = 4; r <= maxR; r += 4) {
    const n = Math.max(8, Math.round((TAU * r) / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const px = Math.round((x + Math.cos(a) * r) * 10) / 10, pz = Math.round((z + Math.sin(a) * r) * 10) / 10;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

// The deepest water within R of a point (a river is narrow: aim for its
// middle).
export function deepWater(city, x, z, R = 40) {
  let best = null, bd = Infinity;
  for (let dx = -R; dx <= R; dx += 4) {
    for (let dz = -R; dz <= R; dz += 4) {
      if (dx * dx + dz * dz > R * R) continue;
      const d = city.shoreDist(x + dx, z + dz);
      if (d < bd) { bd = d; best = { x: x + dx, z: z + dz }; }
    }
  }
  return best && bd < -6 ? best : null;
}

const NEAR = [];
// A flat roof near (x, z): a building 30 to 120 m high, at least 20 m on
// each side, nearest the point. The pad is its centre, minY its roof.
function roofNear(city, x, z, R = 200) {
  city.buildingsNear(x - R, z - R, x + R, z + R, NEAR);
  let best = null, bd = Infinity;
  for (let i = 0; i < NEAR.length; i++) {
    const b = city.buildings[NEAR[i]];
    if (b.h < 30 || b.h > 120 || b.x1 - b.x0 < 20 || b.z1 - b.z0 < 20 || b.landmark) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const d = DIST(cx, cz, x, z);
    if (d < bd) { bd = d; best = { x: cx, z: cz, y: b.h, b }; }
  }
  return best;
}

// A tucked-away point inside the nearest lot of one of `types` whose
// centre is within `within` of `near`: the lot cell farthest from its
// road side. Same lot every build (lots are sorted by distance, then id).
function lotSpot(city, types, near, within) {
  const pool = [];
  for (const lot of city.lots || []) {
    if (!types.includes(lot.type)) continue;
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const d = DIST(cx, cz, near.x, near.z);
    if (d <= within && lot.area >= 400) pool.push({ lot, d });
  }
  pool.sort((a, b) => a.d - b.d || a.lot.id - b.lot.id);
  for (const { lot } of pool) {
    let best = null, bv = -Infinity;
    for (let x = lot.x0 + 2.5; x < lot.x1; x += 5) {
      for (let z = lot.z0 + 2.5; z < lot.z1; z += 5) {
        if (city.lotAt(x, z) !== lot || !stepPlaceOk(city, x, z, 'foot') || city.onRoad(x, z)) continue;
        // Away from the front (the road side).
        const v = lot.front === 0 ? -x : lot.front === 1 ? -z : lot.front === 2 ? x : z;
        if (v > bv) { bv = v; best = { x, z }; }
      }
    }
    if (best) return best;
  }
  return null;
}

function landmarkPoint(city, id) {
  const L = (city.landmarkSites || []).find((t) => t.id === id) || (city.mapLandmarks || []).find((t) => t.landmark === id || t.name === id);
  return L ? { x: L.x, z: L.z } : null;
}

// Resolves one step's `at` to { x, z, minY }. Null when it cannot.
export function resolveStep(city, step, garages = []) {
  const at = step.at;
  const mode = step.mode;
  const ok = (x, z) => stepPlaceOk(city, x, z, mode);
  let p = null, minY = step.minY;
  if (at.anchor) p = nearestWhere(at.anchor.x, at.anchor.z, 200, ok);
  else if (at.water) p = deepWater(city, at.water.x, at.water.z, 40);
  else if (at.pier) {
    const pier = (city.piers || []).find((q) => q.label === at.pier) || (city.piers || [])[0];
    if (pier) {
      // The end that is farthest out to sea.
      const a = { x: pier.x0 + 1, z: (pier.z0 + pier.z1) / 2 }, b = { x: pier.x1 - 1, z: (pier.z0 + pier.z1) / 2 };
      const c = { x: (pier.x0 + pier.x1) / 2, z: pier.z0 + 1 }, d = { x: (pier.x0 + pier.x1) / 2, z: pier.z1 - 1 };
      const ends = pier.x1 - pier.x0 > pier.z1 - pier.z0 ? [a, b] : [c, d];
      p = city.shoreDist(ends[0].x, ends[0].z) < city.shoreDist(ends[1].x, ends[1].z) ? ends[0] : ends[1];
    }
  } else if (at.landmark) {
    const L = landmarkPoint(city, at.landmark);
    if (L) p = nearestWhere(L.x, L.z, 200, (x, z) => ok(x, z) && !city.onRoad(x, z));
  } else if (at.garage) {
    const g = garages.find((q) => q.id === at.garage);
    if (g) p = { x: g.bay.x, z: g.bay.z };
  } else if (at.secret) {
    const s = (city.secretSpots || []).find((q) => q.id === at.secret);
    if (s) { p = { x: s.x, z: s.z }; if (s.minY != null) minY = s.minY; }
  } else if (at.ramp) {
    const r = (city.rampSpots || []).find((q) => q.id === at.ramp);
    if (r) p = { x: r.x, z: r.z };
  } else if (at.lot) {
    p = lotSpot(city, Array.isArray(at.lot) ? at.lot : [at.lot], at.near, at.within);
  } else if (at.roof) {
    const r = roofNear(city, at.roof.x, at.roof.z);
    if (r) { p = { x: r.x, z: r.z }; minY = r.y - 1; }
  }
  if (!p) return null;
  return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, minY };
}

// Where a giver stands. Signs go on the nearest plaza, park, car park or
// water-edge lot; talkers and the start on open land near the point.
const SIGN_LOTS = ['plaza', 'park', 'carpark', 'wateredge'];
function resolveGiver(city, g, garages) {
  if (g.type === 'start') {
    const s = city.spawn;
    return { x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10 };
  }
  if (g.type === 'garage') {
    const gar = garages.find((q) => q.id === g.garage);
    return gar ? { x: gar.door.x, z: gar.door.z } : null;
  }
  const open = (x, z) => stepPlaceOk(city, x, z, 'foot') && !city.onRoad(x, z) && !city.onRoad(x + 3, z) && !city.onRoad(x - 3, z)
    && !city.onRoad(x, z + 3) && !city.onRoad(x, z - 3);
  if (g.type === 'sign') {
    return nearestWhere(g.x, g.z, 400, (x, z) => {
      const t = city.lotTypeAt ? city.lotTypeAt(x, z) : '';
      return SIGN_LOTS.includes(t) && open(x, z);
    }) || nearestWhere(g.x, g.z, 300, open);
  }
  return nearestWhere(g.x, g.z, 300, open);
}

// city.adventures: the sixteen, resolved. Each is the definition plus
// `index`, `place`, `core`, the giver's x, z and every step's x, z, minY
// and its map ring centre (rx, rz). Throws when a step cannot be placed
// (a data change the tests must catch). [] on a map without lots.
export function placeAdventures(city, garages = city.garages || []) {
  if (!city || !Array.isArray(city.lots) || !city.lots.length) return [];
  return ADVENTURE_DEFS.map((def, index) => {
    const gp = resolveGiver(city, def.giver, garages);
    if (!gp) throw new Error('adventures: no giver spot for ' + def.id);
    const giver = { ...def.giver, x: gp.x, z: gp.z, heading: 0 };
    const steps = def.steps.map((s, k) => {
      const p = resolveStep(city, s, garages);
      if (!p) throw new Error('adventures: no place for ' + def.id + ' step ' + k);
      const rng = createRng(ADVENTURE_SEED + index * 8 + k);
      const a = rng.range(0, TAU), off = rng.range(0, s.hint / 2);
      return {
        clue: s.clue, at: s.at, r: s.r, minY: p.minY, mode: s.mode, stunt: s.stunt, hint: s.hint,
        x: p.x, z: p.z,
        rx: Math.round((p.x + Math.cos(a) * off) * 10) / 10, rz: Math.round((p.z + Math.sin(a) * off) * 10) / 10,
      };
    });
    const last = steps[steps.length - 1];
    const core = city.inCore ? steps.every((s) => city.inCore(s.x, s.z)) && city.inCore(giver.x, giver.z) : false;
    return {
      id: def.id, name: def.name, kind: def.kind, order: def.order, needs: def.needs.slice(), reward: { ...def.reward },
      index, giver, steps, core,
      place: city.placeOf ? city.placeOf(last.x, last.z) : '',
    };
  });
}

export const adventureById = (list, id) => {
  if (!list) return null;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
};

// The craft mode a player is in, as a step mode: 'foot', 'car' (cars and
// tanks), 'boat', 'air' (planes and helicopters).
export function playerStepMode(mode) {
  if (mode === 'plane' || mode === 'heli') return 'air';
  if (mode === 'tank') return 'car';
  return mode === 'foot' || mode === 'boat' || mode === 'car' ? mode : 'foot';
}

// Is a player at (x, y, z) in `pmode` (a step mode) on step `s`?
// `stunt` is the best medal landed there just now (or null).
const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
export function stepReached(s, x, y, z, pmode, stunt = null) {
  const dx = s.x - x, dz = s.z - z;
  if (dx * dx + dz * dz > s.r * s.r) return false;
  if (s.mode !== 'any' && s.mode !== pmode) return false;
  if (s.minY != null && !(y >= s.minY)) return false;
  if (s.stunt && !(stunt && MEDAL_RANK[stunt] >= MEDAL_RANK[s.stunt])) return false;
  return true;
}

// Puts garages, adventures and the locked routes on a real map (the
// island has no lots: nothing is added). Car park spots inside a garage's
// rect are dropped so no parked car spawns in a shed, and street props
// in front of a door are removed. Call once, after
// the city is built and before its tiles are drawn (dressLot then skips
// the garage rects). Returns the city.
export function attachExplore(city) {
  if (!city || !city.map || !Array.isArray(city.lots) || !city.lots.length || city.garages) return city;
  city.garages = placeGarages(city);
  city.adventures = placeAdventures(city, city.garages);
  city.routes = buildRoutes(city, ROUTE_SPECS);
  const inside = (x, z, m) => city.garages.some((g) => x > g.x0 - m && x < g.x1 + m && z > g.z0 - m && z < g.z1 + m);
  const P = city.parkingSpots || [];
  for (let i = P.length - 1; i >= 0; i--) if (inside(P[i].x, P[i].z, 3)) P.splice(i, 1);
  // Street lamps and trees on the pavement in front of a door would stand
  // in the way in and out: they go.
  const Q = city.props || [];
  for (let i = Q.length - 1; i >= 0; i--) if (inside(Q[i].x, Q[i].z, 5)) Q.splice(i, 1);
  return city;
}
