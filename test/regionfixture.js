// The five Miami regions built once per test file and wired like the game
// (attachExplore): shared by the region content tests (R2, PLAN_V2 3.3 and
// 3.7). Not a test file itself.
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { attachExplore } from '../src/world/adventures.js';
import { REGION_IDS } from '../src/world/regions.js';

export { REGION_IDS };
export const NEW_REGIONS = REGION_IDS.filter((id) => id !== 'miami-downtown');
const read = (f) => JSON.parse(fs.readFileSync(new URL('../src/world/data/' + f, import.meta.url), 'utf8'));
const cache = new Map();

// The region's city with garages, adventures, routes, courses, secrets,
// ramps and the generated dressing attached. Built on first use.
export function regionCity(id) {
  let c = cache.get(id);
  if (!c) {
    c = createMiamiCity(read(id + '.json'), { region: id });
    attachExplore(c);
    cache.set(id, c);
  }
  return c;
}
export const allRegionCities = () => REGION_IDS.map((id) => [id, regionCity(id)]);
