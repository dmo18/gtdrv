// Dev-time tool (docs/PLAN_V2.md 3.6): writes one data file per Miami
// region from src/world/data/miami.json, as
// src/world/data/miami-<region>.json. Run after scripts/fetch-map.mjs:
//
//     node scripts/split-map.mjs
//
// The files are generated, committed and checked against the source by
// test/regions.test.js (same features, same bytes per feature, in source
// order). Never imported by src/; never run at runtime.
//
// What a region file keeps (a superset of what createMiamiCity reads for
// that region, so a region builds the same from its file as from the
// whole file):
// - roads, buildings and parks whose bounding box comes within SPLIT_MARGIN
//   m of the region's crop (the build keeps only roads that cross the
//   crop, buildings and parks that start inside it);
// - every coastline, water shape and label (small: about 35 KB; the
//   build votes land and sea with the whole coastline);
// - `buildingIds`, `region` and `crop` (see splitRegion).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS } from '../src/world/regions.js';

export const SPLIT_MARGIN = 200;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src', 'world', 'data');
export const regionFile = (id) => path.join(DATA, id + '.json');

// Bounding box of a delta-encoded polyline (decimeters), in meters.
function boxOf(p) {
  let x = 0, z = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    z += p[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0 / 10, z0 / 10, x1 / 10, z1 / 10];
}

export function nearCrop(feature, crop, m = SPLIT_MARGIN) {
  const [x0, z0, x1, z1] = boxOf(feature.p);
  return x1 >= crop.x0 - m && x0 <= crop.x1 + m && z1 >= crop.z0 - m && z0 <= crop.z1 + m;
}

// The region's data object: the source's header fields in their order,
// `region` and `crop`, then the kept features in source order.
// `buildingIds`: the source index of each kept building, so a box's
// footprint id (`fp`) is the same as in a whole-file build.
export function splitRegion(data, region) {
  const out = {};
  for (const k of Object.keys(data)) {
    const v = data[k];
    out[k] = k === 'roads' || k === 'buildings' || k === 'parks' ? v.filter((f) => nearCrop(f, region.crop)) : v;
  }
  out.buildingIds = [];
  data.buildings.forEach((f, k) => { if (nearCrop(f, region.crop)) out.buildingIds.push(k); });
  out.region = region.id;
  out.crop = { ...region.crop };
  return out;
}

export const splitText = (data, region) => JSON.stringify(splitRegion(data, region));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'miami.json'), 'utf8'));
  for (const r of REGIONS) {
    const text = splitText(data, r);
    fs.writeFileSync(regionFile(r.id), text);
    const d = JSON.parse(text);
    console.log(`${r.id}: ${(text.length / 1e6).toFixed(2)} MB, ${d.roads.length} roads, ${d.buildings.length} buildings, ${d.parks.length} parks`);
  }
}
