// Developer helper (0.13.8 street alignment, docs/STATUS.md): prints the
// street alignment audit (test/streetaudit.js) for every region.
// usage: node scripts/street-align.mjs [region,...] [--json]
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { REGION_IDS } from '../src/world/regions.js';
import { auditStreets } from '../test/streetaudit.js';
import { auditJunctions } from '../test/junctionaudit.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ids = args[0] ? args[0].split(',') : REGION_IDS;
const read = (f) => JSON.parse(fs.readFileSync(new URL('../src/world/data/' + f, import.meta.url), 'utf8'));
const all = {};
for (const id of ids) {
  const c = createMiamiCity(read(id + '.json'), { region: id });
  all[id] = { ...auditStreets(c), junction: auditJunctions(c) };
  if (!process.argv.includes('--json')) console.log(id, JSON.stringify(all[id]));
}
if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 1));
