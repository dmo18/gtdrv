// Exploring the Miami map: garages found, the car collection, adventures
// seen and done, and the explore cells (docs/REVAMP.md 6.6). Pure logic.
//
// Saved under its own localStorage key (EXPLORE_KEY), never in the main
// save: an older build rebuilds the main save from the fields it knows, so
// new fields there would be lost on a rollback; this key is never touched
// by an older build. Text read back is untrusted (see core/save.js), so
// sanitizeExplore rebuilds every field from allow-lists and clamps, and
// everything that can be derived (unlocks, reward cars) is derived from
// the finished adventures, never trusted from storage.
import { sanitizeCraft, kindOfSpec, specOf } from './garage.js';
import { GARAGE_IDS, GARAGE_DEFS, GARAGE_CARS_MAX, PAINT_COLORS } from '../world/garages.js';
import { ADVENTURE_DEFS, ADVENTURE_IDS, REWARD_CARS } from '../world/adventures.js';

export const EXPLORE_KEY = 'rustwater.explore.v1';
export const EXPLORE_VERSION = 1;
export const EXPLORE_MAX_TEXT = 20000;
const MAX_SCAN = 64;

// The explore grid: 250 m cells over the whole box, 36 by 32.
export const EXPLORE_CELL = 250;
export const EXPLORE_W = 36;
export const EXPLORE_H = 32;
export const EXPLORE_X0 = -4500;
export const EXPLORE_Z0 = -4000;
export const EXPLORE_CELLS = EXPLORE_W * EXPLORE_H; // 1,152
export const CELL_BYTES = EXPLORE_CELLS / 8; // 144

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function defaultExplore() {
  return {
    version: EXPLORE_VERSION,
    garages: { found: [], seen: [], cars: [], last: null, out: [], road: null },
    adventures: { seen: [], done: [], step: {}, tracked: null },
    cells: '',
  };
}

// ---- base64 for the cell bits (no Buffer or btoa: runs anywhere) ---------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return s;
}
// Null for anything that is not clean base64.
export function b64ToBytes(s) {
  if (typeof s !== 'string' || s.length % 4 !== 0 || s.length > 4096) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12)
      | ((s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2])) << 6) | (s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3]));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ---- cells -------------------------------------------------------------------
// Index of the explore cell holding (x, z), or -1 outside the grid.
export function cellIndex(x, z) {
  const i = Math.floor((x - EXPLORE_X0) / EXPLORE_CELL), j = Math.floor((z - EXPLORE_Z0) / EXPLORE_CELL);
  if (!(i >= 0 && j >= 0 && i < EXPLORE_W && j < EXPLORE_H)) return -1;
  return j * EXPLORE_W + i;
}
export const cellBit = (bytes, c) => (bytes[c >> 3] >> (c & 7)) & 1;
export function setCellBit(bytes, c) {
  bytes[c >> 3] |= 1 << (c & 7);
}
export function cellsFrom(ex) {
  const b = ex && ex.cells ? b64ToBytes(ex.cells) : null;
  return b && b.length === CELL_BYTES ? b : new Uint8Array(CELL_BYTES);
}

// Which cells hold land: a Uint8Array(EXPLORE_CELLS) of 0 or 1, sampled on
// a 5 by 5 pattern inside each cell. `isLand(x, z)`.
export function landCells(isLand) {
  const out = new Uint8Array(EXPLORE_CELLS);
  for (let j = 0; j < EXPLORE_H; j++) {
    for (let i = 0; i < EXPLORE_W; i++) {
      let land = 0;
      for (let a = 0; a < 5 && !land; a++) {
        for (let b = 0; b < 5; b++) {
          if (isLand(EXPLORE_X0 + (i + (a + 0.5) / 5) * EXPLORE_CELL, EXPLORE_Z0 + (j + (b + 0.5) / 5) * EXPLORE_CELL)) { land = 1; break; }
        }
      }
      out[j * EXPLORE_W + i] = land;
    }
  }
  return out;
}

// The land cells of the WHOLE data box (36 by 32 grid of 250 m, measured on
// the built whole box with landCells), as the bits of the cell string. The
// percent shown is "of all Miami" in every region (PLAN_V2 3.5 rule 5), so
// it divides by these, not by the land of the region being played.
export const MIAMI_LAND_B64 = '//8AAP7/HwDw////////DwDA//8AgP//zwP4//8/wP//jwD4//8EgP//D+Dx///A////3/////8fn///z3n7///8D///f//2///fb//////2///8f///D//////B//3/H/DP//8B8Pj/FwD8/38AwP//BwD0/38A4v7/AcAP/w8g/PB/AMc////f/fHHx/sf';
let miamiLandCache = null;
export function miamiLand() {
  if (!miamiLandCache) {
    const b = b64ToBytes(MIAMI_LAND_B64);
    miamiLandCache = new Uint8Array(EXPLORE_CELLS);
    for (let c = 0; c < EXPLORE_CELLS; c++) miamiLandCache[c] = cellBit(b, c);
  }
  return miamiLandCache;
}

// Percent of land cells visited, 0..100.
export function explorePercent(bytes, land) {
  let n = 0, seen = 0;
  for (let c = 0; c < EXPLORE_CELLS; c++) {
    if (!land[c]) continue;
    n++;
    if (cellBit(bytes, c)) seen++;
  }
  return n ? (seen * 100) / n : 0;
}

// ---- the sanitiser ---------------------------------------------------------
function idList(src, allow) {
  const out = [];
  if (!Array.isArray(src)) return out;
  const n = Math.min(src.length, MAX_SCAN);
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (typeof v === 'string' && allow.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

const DEF_BY_ID = {};
for (const d of ADVENTURE_DEFS) DEF_BY_ID[d.id] = d;
const LOCK_OF = {};
for (const g of GARAGE_DEFS) LOCK_OF[g.id] = g.locked;
// Reward car spec id -> adventure id.
const REWARD_OF = {};
for (const id of Object.keys(REWARD_CARS)) REWARD_OF[REWARD_CARS[id]] = id;
export const isRewardSpec = (spec) => typeof spec === 'string' && has(REWARD_OF, spec);

// The colors a car may wear: the paint grid plus its model's own.
export function paintAllowed(specId, color) {
  if (!Number.isInteger(color) || color < 0 || color > 0xffffff) return false;
  if (PAINT_COLORS.includes(color)) return true;
  const spec = specOf(specId);
  return !!(spec && spec.colors && spec.colors.includes(color));
}

function cleanCar(raw) {
  if (!isObj(raw)) return null;
  const c = sanitizeCraft(raw);
  if (!c || kindOfSpec(c.spec) !== 'car' || c.spec === 'ghostwake') return null;
  if (!paintAllowed(c.spec, c.color)) {
    const spec = specOf(c.spec);
    c.color = spec.colors ? spec.colors[0] : PAINT_COLORS[0];
  }
  c.fav = has(raw, 'fav') && raw.fav === true;
  c.reward = isRewardSpec(c.spec);
  return c;
}

// The favorite taken out of a garage: it leaves the list, so the star is
// kept as { spec, color } until the car is stored again (or another star is
// set). Reward cars never come here (their record stays in the list).
function cleanRoad(raw) {
  if (!isObj(raw)) return null;
  const c = cleanCar({ spec: raw.spec, color: raw.color, health: 1 });
  if (!c || c.reward) return null;
  return { spec: c.spec, color: c.color };
}

// Reward car out on the road: one copy only (docs/PLAN_V1.md K8).
export const isRewardOut = (ex, spec) => ex.garages.out.includes(spec);

// Rebuild the derived parts from `done`: locked garages, reward cars,
// steps, tracking. Changes `ex` in place and returns it.
export function deriveExplore(ex) {
  const A = ex.adventures, G = ex.garages;
  A.done = A.done.filter((id) => A.seen.includes(id));
  const done = A.done;
  const open = (gid) => !LOCK_OF[gid] || done.includes(LOCK_OF[gid]);
  G.seen = G.seen.filter(open);
  G.found = G.found.filter((id) => open(id) && G.seen.includes(id));
  if (G.last !== null && !G.found.includes(G.last)) G.last = null;
  // Reward cars: one each, only for done adventures, always present.
  const cars = [];
  const gotReward = {};
  for (const c of G.cars) {
    if (c.reward) {
      const adv = REWARD_OF[c.spec];
      if (!done.includes(adv) || gotReward[c.spec]) continue;
      gotReward[c.spec] = true;
    }
    cars.push(c);
  }
  for (const spec of Object.keys(REWARD_OF)) {
    if (done.includes(REWARD_OF[spec]) && !gotReward[spec]) {
      const s = specOf(spec);
      if (s) cars.push({ spec, color: s.colors ? s.colors[0] : PAINT_COLORS[0], health: 1, fav: false, reward: true });
    }
  }
  // At most GARAGE_CARS_MAX, reward cars always kept: drop the oldest
  // other cars past the cap.
  while (cars.length > GARAGE_CARS_MAX) {
    let k = cars.length - 1;
    while (k >= 0 && cars[k].reward) k--;
    if (k < 0) break;
    cars.splice(k, 1);
  }
  let fav = false;
  for (const c of cars) {
    if (c.fav && !fav) fav = true;
    else c.fav = false;
  }
  G.cars = cars;
  // Reward cars out on the road: only ones that are in the collection.
  G.out = G.out.filter((spec, i) => G.out.indexOf(spec) === i && cars.some((c) => c.reward && c.spec === spec));
  // One star: a favorite in the list means none out on the road.
  if (fav) G.road = null;
  // Steps only for seen and not done, clamped to the step count.
  const step = {};
  for (const id of A.seen) {
    if (done.includes(id) || !has(A.step, id)) continue;
    const v = A.step[id];
    const def = DEF_BY_ID[id];
    if (!Number.isInteger(v) || v <= 0) continue;
    const n = def.steps.length;
    const max = def.order === 'any' ? (1 << n) - 1 : n - 1;
    const val = def.order === 'any' ? v & max : Math.min(v, max);
    if (val > 0) step[id] = val;
  }
  A.step = step;
  if (A.tracked !== null && (!A.seen.includes(A.tracked) || done.includes(A.tracked))) A.tracked = null;
  return ex;
}

// Ids saved by older builds under their British spelling: read as the new id.
const LEGACY_ADVENTURE_IDS = { 'a-port-quay': 'a-port-pier' };
function modernIds(list) {
  return Array.isArray(list) ? list.map((id) => (typeof id === 'string' && has(LEGACY_ADVENTURE_IDS, id) ? LEGACY_ADVENTURE_IDS[id] : id)) : list;
}

// Anything -> a valid explore state. Returns { state, newer }: `newer` is
// true for a save from a later build (left alone on disk: the game plays
// on defaults and does not write).
export function readExplore(raw) {
  const ex = defaultExplore();
  try {
    if (!isObj(raw) || !has(raw, 'version') || !Number.isInteger(raw.version)) return { state: ex, newer: false };
    if (raw.version > EXPLORE_VERSION) return { state: ex, newer: true };
    if (raw.version < 1) return { state: ex, newer: false };
    const g = has(raw, 'garages') && isObj(raw.garages) ? raw.garages : {};
    const a = has(raw, 'adventures') && isObj(raw.adventures) ? raw.adventures : {};
    const G = ex.garages, A = ex.adventures;
    G.seen = idList(has(g, 'seen') ? g.seen : null, GARAGE_IDS);
    G.found = idList(has(g, 'found') ? g.found : null, GARAGE_IDS);
    for (const id of G.found) if (!G.seen.includes(id)) G.seen.push(id);
    if (has(g, 'cars') && Array.isArray(g.cars)) {
      const n = Math.min(g.cars.length, MAX_SCAN);
      for (let i = 0; i < n && G.cars.length < GARAGE_CARS_MAX; i++) {
        const c = cleanCar(g.cars[i]);
        if (c) G.cars.push(c);
      }
    }
    G.out = has(g, 'out') && Array.isArray(g.out) ? g.out.slice(0, MAX_SCAN).filter((v) => isRewardSpec(v)) : [];
    G.road = has(g, 'road') ? cleanRoad(g.road) : null;
    G.last = has(g, 'last') && typeof g.last === 'string' && GARAGE_IDS.includes(g.last) ? g.last : null;
    A.seen = idList(has(a, 'seen') ? modernIds(a.seen) : null, ADVENTURE_IDS);
    A.done = idList(has(a, 'done') ? modernIds(a.done) : null, ADVENTURE_IDS);
    if (has(a, 'step') && isObj(a.step)) {
      for (const id of ADVENTURE_IDS) {
        if (has(a.step, id) && Number.isInteger(a.step[id])) A.step[id] = a.step[id];
      }
      for (const old of Object.keys(LEGACY_ADVENTURE_IDS)) {
        const id = LEGACY_ADVENTURE_IDS[old];
        if (has(a.step, old) && !has(a.step, id) && Number.isInteger(a.step[old])) A.step[id] = a.step[old];
      }
    }
    const tracked = has(a, 'tracked') && typeof a.tracked === 'string' && has(LEGACY_ADVENTURE_IDS, a.tracked) ? LEGACY_ADVENTURE_IDS[a.tracked] : a.tracked;
    A.tracked = typeof tracked === 'string' && ADVENTURE_IDS.includes(tracked) ? tracked : null;
    if (has(raw, 'cells')) {
      const b = b64ToBytes(raw.cells);
      ex.cells = b && b.length === CELL_BYTES ? raw.cells : '';
    }
    deriveExplore(ex);
  } catch {
    return { state: defaultExplore(), newer: false };
  }
  return { state: ex, newer: false };
}

export const sanitizeExplore = (raw) => readExplore(raw).state;

export function loadExplore(storage) {
  let raw = null;
  try {
    const text = storage ? storage.getItem(EXPLORE_KEY) : null;
    if (typeof text === 'string' && text.length <= EXPLORE_MAX_TEXT) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  return readExplore(raw);
}

export function saveExplore(storage, ex) {
  try {
    if (!storage) return false;
    storage.setItem(EXPLORE_KEY, JSON.stringify(sanitizeExplore({ ...ex, version: EXPLORE_VERSION })));
    return true;
  } catch {
    return false;
  }
}

export function clearExplore(storage) {
  try {
    if (storage) storage.removeItem(EXPLORE_KEY);
  } catch {
    // storage blocked: nothing to clear
  }
}

// ---- unlocks (derived from the finished adventures only) --------------------
export function unlocks(ex) {
  const done = ex.adventures.done;
  const out = { garages: [], cars: [], routes: [] };
  for (const d of ADVENTURE_DEFS) {
    if (!done.includes(d.id)) continue;
    if (d.reward.garage) out.garages.push(d.reward.garage);
    if (d.reward.car) out.cars.push(d.reward.car);
    if (d.reward.route) out.routes.push(d.reward.route);
  }
  return out;
}
export const garageOpen = (ex, gid) => !LOCK_OF[gid] || ex.adventures.done.includes(LOCK_OF[gid]);
export const routeOpen = (ex, advId) => !advId || ex.adventures.done.includes(advId);

export function counts(ex, percent = 0) {
  return {
    garagesFound: ex.garages.found.length,
    garagesTotal: GARAGE_IDS.length,
    adventuresDone: ex.adventures.done.length,
    adventuresTotal: ADVENTURE_IDS.length,
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
  };
}

// ---- the car collection (pure, on the explore state) ---------------------------
// Each returns { ok, reason?, ... }; the state is changed only on ok.

// A car record from a live craft or a stored one.
export function carRecord(src) {
  if (!src) return null;
  const spec = src.spec && typeof src.spec === 'object' ? src.spec : null;
  const id = spec ? spec.id : src.spec;
  const maxHp = spec && spec.health > 0 ? spec.health : 1;
  const health = spec ? (Number.isFinite(src.health) ? src.health / maxHp : 1) : src.health;
  // A taken-out favorite carries its star on the live car (v.fav).
  return cleanCar({ spec: id, color: src.color, health, fav: src.fav === true });
}

export function storeCar(ex, src) {
  const rec = carRecord(src);
  if (!rec) return { ok: false, reason: 'not-a-car' };
  if (rec.reward) {
    // A reward car is always in the collection: driving one in just
    // puts it back (its paint is kept).
    const i = ex.garages.cars.findIndex((c) => c.spec === rec.spec);
    if (i >= 0) {
      ex.garages.cars[i].color = rec.color;
      ex.garages.out = ex.garages.out.filter((o) => o !== rec.spec);
      return { ok: true, index: i };
    }
    return { ok: false, reason: 'not-a-car' };
  }
  if (ex.garages.cars.length >= GARAGE_CARS_MAX) return { ok: false, reason: 'full' };
  if (rec.fav) {
    for (const c of ex.garages.cars) c.fav = false;
    ex.garages.road = null;
  }
  ex.garages.cars.push(rec);
  return { ok: true, index: ex.garages.cars.length - 1 };
}

// Take car `index` out; `arriving` (a live car or null) is stored first,
// or left on the forecourt when the collection is full. Returns the
// record to spawn and whether the arriving car was left outside.
export function takeOut(ex, index, arriving = null) {
  const cars = ex.garages.cars;
  if (!Number.isInteger(index) || index < 0 || index >= cars.length) return { ok: false, reason: 'no-car' };
  const pick = cars[index];
  const arr = arriving ? carRecord(arriving) : null;
  // A reward car has one copy: out on the road already, or the very car
  // being driven in, it cannot be taken out again.
  if (pick.reward && (ex.garages.out.includes(pick.spec) || (arr && arr.spec === pick.spec))) return { ok: false, reason: 'out' };
  let left = false;
  let stored = false;
  // The picked car leaves the list (reward cars stay: they are always in
  // the collection, the one on the road is the same car, marked out).
  if (!pick.reward) cars.splice(index, 1);
  else ex.garages.out.push(pick.spec);
  if (arr) {
    const r = storeCar(ex, arriving);
    if (r.ok) stored = true;
    else left = true;
  }
  // One star only: an arriving favorite stored just now keeps it.
  const fav = pick.fav && !(stored && arr.fav);
  if (!pick.reward && fav) ex.garages.road = { spec: pick.spec, color: pick.color };
  return { ok: true, car: { spec: pick.spec, color: pick.color, health: 1, fav, reward: pick.reward }, stored, left };
}

export function repaint(ex, index, color) {
  const c = ex.garages.cars[index];
  if (!c) return { ok: false, reason: 'no-car' };
  if (!paintAllowed(c.spec, color)) return { ok: false, reason: 'color' };
  c.color = color;
  return { ok: true };
}

// Star toggle: at most one favorite.
export function toggleFavorite(ex, index) {
  const cars = ex.garages.cars;
  const c = cars[index];
  if (!c) return { ok: false, reason: 'no-car' };
  const on = !c.fav;
  for (const o of cars) o.fav = false;
  c.fav = on;
  if (on) ex.garages.road = null;
  return { ok: true, fav: on };
}

export function release(ex, index) {
  const c = ex.garages.cars[index];
  if (!c) return { ok: false, reason: 'no-car' };
  if (c.reward) return { ok: false, reason: 'reward' };
  ex.garages.cars.splice(index, 1);
  return { ok: true };
}

export function favorite(ex) {
  for (const c of ex.garages.cars) {
    if (c.fav && !(c.reward && ex.garages.out.includes(c.spec))) return { spec: c.spec, color: c.color, health: 1, reward: c.reward };
  }
  const r = ex.garages.road;
  return r ? { spec: r.spec, color: r.color, health: 1, reward: false } : null;
}

// ---- garages and adventures -------------------------------------------------
// Each returns true when it changed something.
export function markGarageSeen(ex, gid) {
  if (!GARAGE_IDS.includes(gid) || !garageOpen(ex, gid) || ex.garages.seen.includes(gid)) return false;
  ex.garages.seen.push(gid);
  return true;
}
export function markGarageFound(ex, gid) {
  if (!GARAGE_IDS.includes(gid) || !garageOpen(ex, gid) || ex.garages.found.includes(gid)) return false;
  markGarageSeen(ex, gid);
  ex.garages.found.push(gid);
  return true;
}
export function markAdventureSeen(ex, id) {
  if (!ADVENTURE_IDS.includes(id) || ex.adventures.seen.includes(id)) return false;
  ex.adventures.seen.push(id);
  return true;
}
export function track(ex, id) {
  const A = ex.adventures;
  if (id === null) { A.tracked = null; return true; }
  if (!A.seen.includes(id) || A.done.includes(id)) return false;
  A.tracked = id;
  return true;
}
export const adventureReady = (ex, def) => ex.adventures.seen.includes(def.id) && !ex.adventures.done.includes(def.id)
  && def.needs.every((n) => ex.adventures.done.includes(n));

// Steps done of an adventure: the count (seq) or the number of bits (any).
export function stepsDone(ex, def) {
  if (ex.adventures.done.includes(def.id)) return def.steps.length;
  const v = ex.adventures.step[def.id] || 0;
  if (def.order !== 'any') return v;
  let n = 0;
  for (let k = 0; k < def.steps.length; k++) if (v & (1 << k)) n++;
  return n;
}
// The index of the next step to show (seq: the next one; any: the first
// not yet visited), or -1 when done.
export function nextStep(ex, def) {
  if (ex.adventures.done.includes(def.id)) return -1;
  const v = ex.adventures.step[def.id] || 0;
  if (def.order !== 'any') return v < def.steps.length ? v : -1;
  for (let k = 0; k < def.steps.length; k++) if (!(v & (1 << k))) return k;
  return -1;
}

// Record step k of `def` as reached. Returns 'step', 'done' or null.
export function completeStep(ex, def, k) {
  if (!adventureReady(ex, def) || k < 0 || k >= def.steps.length) return null;
  const A = ex.adventures;
  const v = A.step[def.id] || 0;
  let nv;
  if (def.order === 'any') {
    if (v & (1 << k)) return null;
    nv = v | (1 << k);
    if (nv === (1 << def.steps.length) - 1) nv = -1;
  } else {
    if (k !== v) return null;
    nv = v + 1 >= def.steps.length ? -1 : v + 1;
  }
  if (nv === -1) {
    delete A.step[def.id];
    A.done.push(def.id);
    if (A.tracked === def.id) A.tracked = null;
    deriveExplore(ex);
    return 'done';
  }
  A.step[def.id] = nv;
  return 'step';
}
