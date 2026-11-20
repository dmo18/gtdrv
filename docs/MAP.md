# Real-map data (Miami)

`src/world/data/miami.json` is generated, development-time data. The game
never fetches anything at runtime; the file is bundled like any other asset.

## Re-run

    node scripts/fetch-map.mjs

Downloads OSM API 0.6 tiles (about 0.04 degrees, split further when the API
refuses more than 50000 nodes), one request at a time with a 1 s pause and
User-Agent `rustwater-map-build/0.1 (dev tool)`. Raw responses are cached
gzipped in `build/osm-cache` (git ignored), so re-runs do not download again.
Delete that folder to refresh. `scripts/fetch-map.mjs` is never imported by `src/`.

## Source and licence

Map data (c) OpenStreetMap contributors, ODbL
(https://www.openstreetmap.org/copyright). The string is stored in the
`attribution` field of the output and must be shown in the credits if the data
is used in the game.

## Area and projection

Box: lat 25.745 to 25.815, lon -80.225 to -80.135 (downtown, Brickell, Little
Havana, part of Biscayne Bay). Origin is the box centre, lat 25.78, lon -80.18.
Equirectangular: x = (lon - lon0) * R * cos(lat0), z = -(lat - lat0) * R, with
R = 6371008.8 m. x east, z south, metres, flat ground y = 0. Bounds are about
x +-4506 m, z +-3892 m (9.0 km by 7.8 km).

## Contents

`roads` (class, name, oneway, bridge, lanes, p), `buildings` (h metres, kind,
name, p; height from `height`, then `building:levels` * 3.2, then a default by
class), `water` (polygons, or `line: 1` waterways), `coastline`, `parks`,
`labels` (name, kind, x, z). Footways, steps, paths, tracks and cycleways are
dropped. Polylines are simplified with Douglas-Peucker at 1.5 m.

Polyline field `p` is delta-encoded integer decimetres: `[x0, z0, dx1, dz1,
...]`; decode by running sum, then divide by 10. Label x, z are plain metres.

## Size

About 2.4 MB plain JSON: roughly 11.7k roads, 20.7k buildings, 83 water
shapes, 58 coastline lines, 607 parks, 82 labels. Checked by `test/mapdata.test.js`.
