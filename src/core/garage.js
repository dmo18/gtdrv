// The saved "session": where the player was, what they were driving, and
// the garage of cars they left behind. Pure logic. Everything read from
// storage is untrusted (see core/save.js), so every field is rebuilt from
// strict checks: finite numbers, known spec ids, clamped coordinates.
import { VEHICLE_SPECS } from '../entities/vehicle.js';
import { BOAT_SPECS } from '../entities/boat.js';
import { AIRCRAFT_SPECS } from '../entities/aircraft.js';
import { TANK_SPECS } from '../entities/tank.js';

export const GARAGE_MAX = 8;
// Metres from the origin, either axis: the Miami map reaches about 4.5 km
// from it (docs/MAP.md), so 6 km with room to spare. Still a hard bound.
export const MAP_LIMIT = 6000;
export const MAX_ALT = 1500;
export const MODES = ['start', 'foot', 'car', 'boat', 'plane', 'heli', 'tank'];
export const SAFE_ALT = 120; // altitude an airborne craft comes back at
const MIN_HEALTH = 0.05;
const MAX_SCAN = 64;
const TAU = Math.PI * 2;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// kind of craft for a spec id: 'car' | 'boat' | 'plane' | 'heli' | 'tank' | null
export function kindOfSpec(id) {
  if (typeof id !== 'string' || id.length > 30) return null;
  if (has(VEHICLE_SPECS, id)) return 'car';
  if (has(BOAT_SPECS, id)) return 'boat';
  if (has(AIRCRAFT_SPECS, id)) return AIRCRAFT_SPECS[id].kind === 'heli' ? 'heli' : 'plane';
  if (has(TANK_SPECS, id)) return 'tank';
  return null;
}

export function specOf(id) {
  const k = kindOfSpec(id);
  if (k === 'car') return VEHICLE_SPECS[id];
  if (k === 'boat') return BOAT_SPECS[id];
  if (k === 'tank') return TANK_SPECS[id];
  if (k) return AIRCRAFT_SPECS[id];
  return null;
}

const coord = (v) => Math.max(-MAP_LIMIT, Math.min(MAP_LIMIT, v));
export function wrapAngle(a) {
  let h = a % TAU;
  if (h > Math.PI) h -= TAU;
  else if (h <= -Math.PI) h += TAU;
  return Math.round(h * 1000) / 1000;
}
const round2 = (v) => Math.round(v * 100) / 100;

function cleanColor(v) {
  return isNum(v) && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : null;
}

// One craft record: { spec, color, health }. Null when it is not usable.
export function sanitizeCraft(raw) {
  if (!isObj(raw) || !has(raw, 'spec')) return null;
  const kind = kindOfSpec(raw.spec);
  if (!kind) return null;
  const spec = specOf(raw.spec);
  let color = has(raw, 'color') ? cleanColor(raw.color) : null;
  if (color === null) color = spec.colors ? spec.colors[0] : 0x888888;
  let health = has(raw, 'health') && isNum(raw.health) ? raw.health : 1;
  health = round2(Math.max(MIN_HEALTH, Math.min(1, health)));
  return { spec: raw.spec, color, health };
}

// A craft placed on the map: adds x, z, heading.
export function sanitizePlaced(raw) {
  const c = sanitizeCraft(raw);
  if (!c) return null;
  if (!isNum(raw.x) || !isNum(raw.z)) return null;
  c.x = round2(coord(raw.x));
  c.z = round2(coord(raw.z));
  c.heading = has(raw, 'heading') && isNum(raw.heading) ? wrapAngle(raw.heading) : 0;
  return c;
}

// A garage list: at most GARAGE_MAX valid cars (cars only), most recent first.
export function sanitizeGarage(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const n = Math.min(raw.length, MAX_SCAN);
  for (let i = 0; i < n && out.length < GARAGE_MAX; i++) {
    const g = sanitizePlaced(raw[i]);
    if (g && kindOfSpec(g.spec) === 'car') out.push(g);
  }
  return out;
}

// The whole session. Returns null for anything that is not an object.
export function sanitizeSession(raw) {
  if (!isObj(raw)) return null;
  const s = { mode: 'start', x: 0, z: 0, heading: 0, craft: null, garage: sanitizeGarage(has(raw, 'garage') ? raw.garage : null) };
  const mode = has(raw, 'mode') && typeof raw.mode === 'string' && MODES.includes(raw.mode) ? raw.mode : 'start';
  if (mode === 'start' || !isNum(raw.x) || !isNum(raw.z)) return s;
  const x = round2(coord(raw.x)), z = round2(coord(raw.z));
  const heading = has(raw, 'heading') && isNum(raw.heading) ? wrapAngle(raw.heading) : 0;
  if (mode === 'foot') {
    s.mode = 'foot';
    s.x = x;
    s.z = z;
    s.heading = heading;
    return s;
  }
  const c = sanitizeCraft(has(raw, 'craft') ? raw.craft : null);
  // The mode must agree with the craft; otherwise start fresh.
  if (!c || kindOfSpec(c.spec) !== mode) return s;
  const cr = isObj(raw.craft) ? raw.craft : {};
  c.y = has(cr, 'y') && isNum(cr.y) ? round2(Math.max(0, Math.min(MAX_ALT, cr.y))) : 0;
  c.speed = has(cr, 'speed') && isNum(cr.speed) ? round2(Math.max(0, Math.min(200, cr.speed))) : 0;
  c.airborne = has(cr, 'airborne') && cr.airborne === true && (mode === 'plane' || mode === 'heli') && c.y > 8;
  s.mode = mode;
  s.x = x;
  s.z = z;
  s.heading = heading;
  s.craft = c;
  return s;
}

// --- Taking a snapshot of the live game ---------------------------------

export function craftRecord(v) {
  const spec = v.spec;
  const maxHp = spec && spec.health > 0 ? spec.health : 1;
  const rec = {
    spec: spec ? spec.id : '',
    color: isNum(v.color) ? v.color : 0,
    health: Math.max(0, Math.min(1, (isNum(v.health) ? v.health : maxHp) / maxHp)),
    x: v.x, z: v.z, heading: v.heading,
  };
  return rec;
}

// Usable for saving: alive, not removed, a known spec, finite pose.
export function savable(v) {
  return !!(v && !v.wrecked && !v.removed && !v.onFire && v.spec && kindOfSpec(v.spec.id) && isNum(v.x) && isNum(v.z) && isNum(v.heading) && v.health > 0);
}

// Build a session from plain facts: player position, mode, the craft
// being driven (or null) and the garage entries (objects with spec,
// color, health, x, z, heading). Returns a sanitised session.
export function buildSession(player, craft, garage) {
  const raw = { mode: 'start', garage };
  if (craft && savable(craft)) {
    const r = craftRecord(craft);
    r.y = craft.y || 0;
    r.speed = Math.abs(craft.speed || 0);
    r.airborne = (craft.kind === 'plane' || craft.kind === 'heli') && craft.onGround === false && (craft.y || 0) > 8;
    raw.mode = craft.kind;
    raw.x = craft.x;
    raw.z = craft.z;
    raw.heading = craft.heading;
    raw.craft = r;
  } else if (!craft && player && player.mode === 'foot') {
    raw.mode = 'foot';
    raw.x = player.x;
    raw.z = player.z;
    raw.heading = player.heading;
  }
  return sanitizeSession(raw);
}

// --- Garage list operations ---------------------------------------------

// Put a car at the front of the garage (replacing the same car), keep
// at most GARAGE_MAX. `list` is changed in place and returned.
export function garageAdd(list, rec) {
  const r = sanitizePlaced(rec);
  if (!r || kindOfSpec(r.spec) !== 'car') return list;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    if (g.spec === r.spec && g.color === r.color && Math.hypot(g.x - r.x, g.z - r.z) < 3) list.splice(i, 1);
  }
  list.unshift(r);
  if (list.length > GARAGE_MAX) list.length = GARAGE_MAX;
  return list;
}

export function garageRemove(list, entry) {
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
  return list;
}
