// Pure rules for the title screen (docs/REVAMP.md 6.8): is there a saved
// place the Continue button can bring the player back to, and where does
// "Start" put them. No three.js, no DOM.
import { MODES } from './garage.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// True when `s` (a sanitised session, or anything at all) names a place on
// map `mapId` that can be restored: mode other than 'start', inside the
// land cut, and on ground the mode can use (ground for foot, car and tank,
// water for a boat, anywhere for aircraft). Never throws.
export function placeValid(s, mapId, city) {
  try {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    if ((s.map || 'island') !== mapId) return false;
    if (typeof s.mode !== 'string' || s.mode === 'start' || !MODES.includes(s.mode)) return false;
    if (!isNum(s.x) || !isNum(s.z)) return false;
    const cut = city && city.cut;
    if (cut && (s.x < cut.x0 || s.x > cut.x1 || s.z < cut.z0 || s.z > cut.z1)) return false;
    if (s.mode === 'plane' || s.mode === 'heli') return true;
    if (s.mode === 'boat') return !(city && city.isLand && city.isLand(s.x, s.z));
    return !(city && city.isGround && !city.isGround(s.x, s.z));
  } catch {
    return false;
  }
}

// The spot and heading "Start" uses: the designed view on a map that has
// one (city.startView.spawn), otherwise the map's own spawn.
export function startSpot(city, out) {
  const sv = city && city.startView && city.startView.spawn;
  const src = sv && isNum(sv.x) && isNum(sv.z) ? sv : city.spawn;
  out.x = src.x;
  out.z = src.z;
  out.heading = isNum(src.heading) ? src.heading : 0;
  return out;
}
