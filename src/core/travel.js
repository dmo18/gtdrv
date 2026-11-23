// Travel between Miami regions (docs/PLAN_V2.md 3.4 and 3.5): the list the
// picker shows, the pad rules, the refusal while wanted, the approximate
// arrival pose from the link table, and the one save that writes the
// target region's session and the map choice before the page reloads.
// Pure: runs in node tests (no DOM, no three.js).
import { REGIONS, regionFor, inRegion, regionsAt, DEFAULT_REGION } from '../world/regions.js';
import { ADVENTURE_DEFS } from '../world/adventures.js';
import { GARAGE_DEFS } from '../world/garages.js';
import { MIAMI_SPOTS } from '../world/miami-spots.js';
import { MAP_CHOICE_KEY } from '../world/maps.js';
import { saveProgress } from './save.js';
import { sanitizeSession, craftRecord, savable, selectMapSession } from './garage.js';

export const ISLAND = 'island';
export const ISLAND_NAME = 'Classic island';

// The picker: the five regions in table order, then the classic island.
export const PICKER = [
  ...REGIONS.map((r) => ({ id: r.id, name: r.name })),
  { id: ISLAND, name: ISLAND_NAME },
];

// The picker's name for a map id ('' for anything else; the whole box shows as Miami).
export function mapName(id) {
  if (id === ISLAND) return ISLAND_NAME;
  if (id === 'miami') return 'Miami (whole map)';
  const r = regionFor(id);
  return r ? r.name : '';
}

// The id the picker shows as playing: junk or no choice is the default.
export function pickerCurrent(id) {
  return PICKER.some((p) => p.id === id) ? id : id === 'miami' ? id : DEFAULT_REGION;
}

export const REFUSED_WANTED = 'Lose the police first';
export const PAD_RANGE = 55; // m from a pad's edge: the "Drive onto the pad" hint
export const PAD_STOP = 3; // m/s: slower than this on the pad counts as stopped
export const ARRIVE_IN = 30; // m inside the twin's crop edge for the approximate arrival

// Null when travel is allowed, else the plain message.
export function travelRefusal(wanted) {
  return wanted > 0 ? REFUSED_WANTED : null;
}

// The pad nearest to (x, z) that is within PAD_RANGE of its edge, or null.
// out: { pad, d, on } is filled and returned (no allocation per frame).
export function padNear(city, x, z, out) {
  out.pad = null;
  out.d = Infinity;
  out.on = false;
  const pads = city && city.travelPads;
  if (!pads) return out;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const d = Math.hypot(p.x - x, p.z - z) - (p.r || 8);
    if (d < PAD_RANGE && d < out.d) {
      out.pad = p;
      out.d = d;
    }
  }
  out.on = !!out.pad && out.d <= 0;
  return out;
}

// What the hint line says about a pad (a plain sentence).
export function padHint(pad, wanted) {
  const name = mapName(pad.to);
  return travelRefusal(wanted) ? REFUSED_WANTED + ' to travel to ' + name : 'Drive onto the pad to travel to ' + name;
}

// The approximate arrival of link `linkId` in region `toId`: its table
// point moved ARRIVE_IN m inward from the nearest crop side, facing in.
// The exact pose is the twin pad's `arrive` once that region is built.
export function arrivalApprox(toId, linkId) {
  const r = regionFor(toId);
  const lk = r && r.links.find((l) => l.id === linkId);
  if (!lk) return null;
  const c = r.crop;
  const sides = [[lk.x - c.x0, 1, 0], [c.x1 - lk.x, -1, 0], [lk.z - c.z0, 0, 1], [c.z1 - lk.z, 0, -1]];
  let best = sides[0];
  for (const s of sides) if (Math.abs(s[0]) < Math.abs(best[0])) best = s;
  return { x: lk.x + best[1] * ARRIVE_IN, z: lk.z + best[2] * ARRIVE_IN, heading: Math.atan2(best[2], best[1]) };
}

// The spot and heading of a region's start place (Downtown: MIAMI_SPOTS).
export function regionStart(id) {
  const r = regionFor(id);
  const s = r && r.start ? r.start : MIAMI_SPOTS.spawn;
  return { x: s.x, z: s.z, heading: Number.isFinite(s.heading) ? s.heading : 0 };
}


// Writes travel to region `toId` into `progress` (a save object, changed in
// place): the session being left is parked as "start" (the car goes with
// the player), the target region's session is made with the player at
// `pose` in the same car (or on foot; any other craft arrives at the start
// place, when `pose` is null the player starts fresh there). The target's
// parked garage is kept. Returns the new session.
//   from: the map id being left; car: the live car (or null); player: { mode }
export function travelSession(progress, fromId, toId, car, player, pose) {
  const cur = progress.session;
  if (cur && cur.map === fromId) {
    // The car and the player leave with the travel: what stays behind is the garage.
    progress.session = sanitizeSession({ map: fromId, mode: 'start', garage: cur.garage });
  }
  const old = selectMapSession(progress, toId);
  const garage = old && Array.isArray(old.garage) ? old.garage : [];
  const raw = { map: toId, mode: 'start', garage };
  const at = pose || regionStart(toId);
  const driving = car && savable(car) && (car.kind === 'car' || car.kind === 'tank');
  if (driving) {
    const rec = craftRecord(car);
    rec.y = 0;
    rec.speed = 0;
    rec.airborne = false;
    Object.assign(raw, { mode: car.kind, x: at.x, z: at.z, heading: at.heading, craft: rec });
  } else if (!car && player && player.mode === 'foot' && pose) {
    Object.assign(raw, { mode: 'foot', x: at.x, z: at.z, heading: at.heading });
  }
  progress.session = sanitizeSession(raw);
  return progress.session;
}

// One save call: the session of the target region and the map choice
// (PLAN_V2 3.5 rule 9). Returns true when both were written.
export function travelSave(storage, progress, fromId, toId, car, player, pose) {
  travelSession(progress, fromId, toId, car, player, pose);
  const ok = saveProgress(storage, progress);
  try {
    storage.setItem(MAP_CHOICE_KEY, toId);
  } catch {
    return false;
  }
  return ok;
}

// Is (x, z) inside region `id`'s crop (the rule the saves use)?
export const insideRegion = (id, x, z, margin = 0) => inRegion(id, x, z, margin);

// The region that holds an adventure (rule: its giver; a garage giver is
// the garage's own place, the start is the start place of Downtown).
export function adventureRegion(def) {
  const g = def && def.giver;
  if (!g) return DEFAULT_REGION;
  let x = g.x, z = g.z;
  if (g.type === 'garage') {
    const gd = GARAGE_DEFS.find((q) => q.id === g.garage);
    if (gd) { x = gd.x; z = gd.z; }
  } else if (g.type === 'start') {
    return DEFAULT_REGION;
  }
  const ids = regionsAt(x, z);
  return ids.length ? ids[0] : DEFAULT_REGION;
}

// The adventure being tracked when this map does not hold it (rule 8):
// { id, name, where: 'Miami Beach and the Islands' }, else null. The step
// it is on is kept; it shows "in <region>".
export function trackedElsewhere(trackedId, cityRegionId, localIds) {
  if (typeof trackedId !== 'string' || localIds.includes(trackedId)) return null;
  const def = ADVENTURE_DEFS.find((d) => d.id === trackedId);
  if (!def) return null;
  const home = adventureRegion(def);
  if (home === cityRegionId) return null;
  return { id: def.id, name: def.name, where: mapName(home) };
}

// ---- The arrival note ---------------------------------------------------
// Travel reloads the page. Per-tab sessionStorage carries one note to the
// new page: which region the player was heading for and which link they
// came through (so the exact pad pose of the twin can be used). Read back
// as untrusted: ids come from the allow-lists below, the note is removed
// when read.
export const TRAVEL_NOTE_KEY = 'rustwater.travel';
const LINK_IDS = [];
for (const r of REGIONS) for (const l of r.links) if (!LINK_IDS.includes(l.id)) LINK_IDS.push(l.id);

export function writeTravelNote(storage, toId, linkId) {
  try {
    const link = LINK_IDS.includes(linkId) ? linkId : null;
    storage.setItem(TRAVEL_NOTE_KEY, JSON.stringify({ to: toId, link }));
    return true;
  } catch {
    return false;
  }
}

// { to, link } for the page now loaded as `mapId`, or null. Always clears it.
export function takeTravelNote(storage, mapId) {
  let out = null;
  try {
    const text = storage ? storage.getItem(TRAVEL_NOTE_KEY) : null;
    if (storage) storage.removeItem(TRAVEL_NOTE_KEY);
    if (typeof text === 'string' && text.length < 200) {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && v.to === mapId && regionFor(mapId)) {
        out = { to: mapId, link: typeof v.link === 'string' && LINK_IDS.includes(v.link) ? v.link : null };
      }
    }
  } catch {
    out = null;
  }
  return out;
}
