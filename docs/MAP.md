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

## Integration plan

Status: plan only, no game code changed. Written from a read of
`src/world/citygen.js` and every consumer of its return value
(src/systems, src/render, src/ui, src/world, src/entities, src/game.js,
test/). The data format is described above; this section is about
plugging that data into the game. Polylines (`p`, delta-encoded
decimetres) carry no OSM node ids. The origin (lat 25.78, lon -80.18) is in
the bay between Bayfront Park and Watson Island, not on land.

### 1. What the game uses from the city object

`generateCity()` today gives 142 nodes, 256 edges, 758 buildings, 115
blocks, 967 parking spots on a 1.3 km island. The Miami box is about
9.0 x 7.8 km: roughly 40 times the area, with about 11.7k road polylines
(many thousands of graph segments once split at vertices) and 20.7k
buildings.

| Field / function | Used by | What it needs |
|---|---|---|
| `nodes[] {id, x, z, hx, hz, edges[], signal, i, j}` | traffic, police, crew, combat, session, courses, stunts, citymesh, minimap, graphics, tests | junction centre; `hx/hz` half size of the junction box (traffic and police `extAt`, citymesh, courses `groundR`); `i < 0` marks the airfield gate (citymesh signals skip it); minimap reads `wx[n.i]`, `wz[n.j]` |
| `edges[] {id, a, b, horizontal, width, avenue, length, causeway}` | traffic, police, crew, session, courses, stunts, citymesh, minimap, props, tests | straight segment between two nodes. `horizontal` is assumed to mean "exactly along x" in citymesh road meshes, `onRoad`, kerb parking, furniture, `avenueAt`, stunt heading; `signalState` only uses it to pick a phase |
| `laneOffset`, `lanePoint`, `lanesPerDirection`, `signalState` (exports) | traffic, crew, police, graphics, tests | work for any straight edge direction already; `signalState` needs a two-way phase key |
| `blocks[] {id, i, j, x0, z0, x1, z1, district}` | peds (pavement loops around the rect), crew (hangout corners), audio (park test), buildings.js (yards), props, citymesh (pavement ring), minimap, secrets (playground) | axis-aligned rectangles with a 4 m `SIDEWALK` ring, roads on all four sides |
| `buildings[] {x0, z0, x1, z1, h, district, kind, style, tint, vseed, block, street, billboard, depot}` | citymesh (draws them and adds the collision boxes), buildings.js, minimap, courses (`tallestNear`, `roofNear`), secrets (alley, roof, openGround), stunts, tests, fightgame | axis-aligned boxes; `kind` in building/house/warehouse/container; `street` bitmask of sides facing a road |
| `props`, `furniture`, `signals`, `landmarks {lighthouse, cranes, billboards, windsock, runwayLights}`, `streetNames {x[], z[]}` | props.js (also adds tree, crane and lighthouse collision), citymesh, textures, combatfx, armor, secrets, tests | points with type; `namesign` furniture indexes `streetNames.x/z` by `nx/nz` (0..15) |
| `parkingSpots [{x, z, heading, lot}]` | parked.js, secrets (`lot` industrial seeds the garage search), citygen (Cinder tank), traffic test | kerb spots along non-avenue edges, `lot` spots in car parks |
| `spawn {x, z, heading}` | game.js, session, combat respawn, tests | on a road, clear of collision |
| `piers [{x0, z0, x1, z1}]` (order matters) | game.js (waterCollision), courses (`mainPiers[0..2]`, last pier = airfield dock), stunts (last pier), secrets, props, citymesh, minimap | axis-aligned rects sticking out to sea |
| `pois [{type, x, z, label}]` | minimap legend and icons | types airfield, marina, depot |
| `boatSpots`, `aircraftSpots`, `tankSpots` `{x, z, heading, spec, ...}` | fleet, session, courses (start clearance), secrets, tests | spawn points with spec ids |
| `helipads [{x, z}]` | courses (`helipads[0]` start of Rooftop Hopper; airmail picks one off the islet), citymesh | first one on the airfield |
| `roofPads`, `depot {x0, z0, x1, z1, gate}` | fleet (via aircraftSpots), tests | roof pad: midtown roof nearest the origin |
| `airfield {islet, runway, apron, gate}` | courses (all sky courses and island boat lap are placed relative to `islet`/`runway`), stunts (dock ramps), game.js `findRescueSpot`, tests | `gate` is a node joined by one `causeway` edge |
| `extraLand [rect]`, `surfaces [rect]` | citymesh, minimap, secrets | islet and causeway rects; runway, apron, depot apron |
| `shoreDist(x, z)` | vehicle, tank, boat, aircraft (keep on land / in water, gradient by +-1 m samples), traffic, police, crew, peds, audio, combat, session, courses, stunts, game.js | metres inside land (+) or out at sea (-), smooth, called many times per craft per step |
| `mainShore(x, z)` | secrets (`openGround`, `shorePoint`), courses (`mainPiers` filter), citymesh `groundY` | as shoreDist but without the islet and causeway |
| `radiusAt(theta)` | minimap outline, citymesh beach rings, secrets `shorePoint` and headland sort, courses `coastPoint` | the island is one star-shaped polygon around the origin |
| `isLand`, `isGround` (land or pier) | session, stunts, onfoot, aircraft, carjack, combat, peds, effects | boolean |
| `onRoad(x, z)` | peds, audio (per frame), effects, secrets, game.js HUD, police, tests | loops every edge (O(E)) |
| `districtOf(x, z)` | game.js HUD name (via `DISTRICTS[key].name`), audio (per frame), traffic and parked car mix, courses, stunts, secrets, helipilot test | one of downtown, midtown, residential, docks, industrial, beach, airfield (park comes from blocks) |
| `DISTRICTS` (export) | game.js (HUD names), economy (maps the HUD name back to a key for `seen_` flags), crew | key to display name |
| `nodeAt`, `xs`, `zs`, `wx`, `wz`, `N` | courses (Glasswell Threader uses grid lines `xs[aCol + k]`), minimap (junction squares), police.test | the regular grid |
| `seed`, `size`, `mapHalf` | citymesh (rng, chunk builder extent `S`), stunts (seed), minimap (scale) | |

### 2. Hard-coded to the procedural layout

| Consumer | What is fixed | Miami: derive or hand-place |
|---|---|---|
| Airfield islet, causeway, runway, apron, hangars, gate node (citygen) | placed east of the anchor node at the island's east end | Hand-place the islet rect and the causeway landing node; everything inside the islet (runway, apron, hangars, aircraft spots, windsock, runway lights, depot, airfield dock, seaplane) is relative to `islet` and can be reused as is |
| Ironbank Depot (citygen) | east end of the islet | Derived (relative to islet), keep the name |
| Piers (citygen `addPier`) | march along grid lines `xs[9]`, `zs[8]`, `xs[7]`; order Saltyard, Pale Shore, Northpoint, Airfield Dock | Hand-placed list, same order contract (3 main piers, then the airfield dock last) |
| Docks helipad, roof pad (citygen) | `xs[11]`, `zs[N-3]`; roof nearest the origin | Docks pad: hand-place. Roof pad: derive, but measure from a named downtown anchor, not the origin |
| Cinder Row tank (citygen) | easternmost industrial `lot` spot | Hand-place (OSM data has no car parks) |
| Spawn (citygen) | street next to the node nearest the origin, uses `wz[centre.j]` | Hand-place on a named street |
| Secrets finder (world/secrets.js) | `shorePoint` marches in from `radiusAt`; headlands sorted by radius; garage scans `x 330..700`, then `-600..600` | Hand-place drowned box, cave, lighthouse, playground, garage. Roof Garden and Tag Alley can be derived with a region filter |
| Stunt ramps (world/stunts.js) | quiet-street pick by district; heading from `horizontal`; dock ramps from the last pier | Hand-place the four street ramps (names below); dock ramps derive as today |
| Courses (world/courses.js) | `ringNodes(mainNodes, 0, 0, 16)` rim loop; delivery points like `(-420, -420)`, `(300, 520)`, `(60, -150)`; Threader from `xs/zs` grid; boat routes from `radiusAt` and radial `pushOut` from the origin; sky routes relative to islet | Replace with a per-map course spec (waypoints by road name or point, buoy lists). Keep the generic helpers (`roadPath`, `pickAlongWalk`, `refineSea`, `skyCheckpoints`, medal maths) |
| `findRescueSpot` (game.js) | walks toward the islet or toward (0, 0) | Walk toward the nearest coast sample on land instead (origin is water) |
| `MAP_LIMIT = 3000` (core/garage.js) | saved coordinates clamped to +-3000 m | Raise to 6000. Silent today: a car saved at x 4000 (Miami Beach) comes back at 3000, in the bay |
| Sea plane 9000 x 9000 (citymesh), chunk builders sized by `city.size` with 5 and 3 tiles | sized for a 1.6 km map | Sea at least 12 km; chunk count from map size (about 500 m tiles) |
| Place names in text: tutorial.js, menu.js, courses names and blurbs, stunts labels, minimap legend, economy `'The Strand'` | procedural names | New names per map (see 3.4) |
| Parked-car rules (citygen) | kerb spots on axis-aligned non-avenue edges, both sides, 6.5 m pitch | Derive with the edge direction; skip bridges, oneway one-lane streets and spots inside a building box |

### 3. The adapter

#### 3.1 Shape

New pure module `src/world/miami.js`, exporting `createMiamiCity(data,
opts)`. `data` is the parsed `miami.json`, imported by the caller (esbuild
bundles JSON; nothing is fetched at runtime). `opts.crop` limits the
playable rect (milestone 1 uses a core crop). It returns the same object
shape as `generateCity`, so traffic, police, crew, peds, fleet, session,
entities and most of the renderer do not change. Hand-placed places live in
`src/world/miami-spots.js` (plain data: piers, islet, helipads, spawn,
secrets, ramps, course spec, district table). `generateCity` stays as is:
the existing unit tests keep running on it, and the game picks the map in
`game.js` (`?map=miami` while in progress, default later).

Build steps inside `createMiamiCity`, all deterministic (seeded `createRng`
where a choice is random):

1. Roads. Keep drivable classes: trunk, primary, secondary, tertiary
   (and their `_link`), residential, unclassified, living_street. Drop
   service and pedestrian (the data already drops footways, paths,
   cycleways, steps and tracks). Drop
   motorway segments that are bridges over land (I-95, I-395 and Dolphin
   flyovers): the world is flat at y = 0, so they would cross streets at
   grade. Keep bridges over water (MacArthur, Venetian, Rickenbacker,
   river bridges) as flat roads.
2. Junctions. The JSON has no node ids and simplification may have dropped
   shared vertices. Snap endpoints to any segment within 2.5 m and split
   it there; merge vertices closer than 12 m into one junction; never join
   two edges where either is a bridge over land. Ask the data helper to
   keep shared OSM nodes as must-keep vertices in `simplify` and to emit a
   junction flag; that removes most of the snapping guesswork.
3. Graph. Every polyline vertex becomes a node (degree-2 bend nodes get
   `hx = hz = 2`; junctions get `hx = hz` = half of the widest edge). Edge
   `width` 18 and `avenue: true` for trunk, primary and secondary (or
   `lanes >= 4`), else 11. `horizontal = |dx| >= |dz|`. Add `ux, uz` (unit
   direction) to every edge for the consumers that need a true direction.
   `signal` on degree >= 3 with an avenue, as today. Set `i = j = 0` on
   city nodes (`i = -1` stays the gate marker). Keep the largest connected
   component only. Oneway is ignored in milestone 1 (all two-way).
4. Land. Stitch `coastline` ways into rings (land on the left of an OSM
   coastline way), close them along the box edge, subtract `water`
   polygons. Bake a signed distance raster: 4 m cells, Int16 decimetres,
   clamped to +-250 m (all thresholds in the code are inside that: boats
   -1.5, gates -25, peds -150, traffic -120). `shoreDist` = bilinear
   sample, then `max` with analytic rects for the islet, the causeway and
   one oriented strip per bridge-over-water edge (half width + 4 m), so
   cars do not hit a seam on the causeways. `mainShore` = the raster only.
   `isLand`, `isGround` unchanged in meaning.
5. Buildings. Footprints whose main axis is within 10 degrees of x or z
   become one box (the polygon's inner box). Others are cut into 2 to 6
   axis-aligned boxes by rasterising at 2 m. Drop footprints under 25 m2.
   `kind` from the OSM tag (house, warehouse, else building), `district`
   from step 7, style fields exactly as citygen fills them. Remove boxes
   that overlap a road strip. Move collision filling out of citymesh into
   a pure `fillCollision(city, collision)` in `src/world/collision.js`, so
   tests and the game use the same boxes.
6. Blocks. Extract faces of the planar road graph. A face whose area is at
   least 85 percent of its axis-aligned bounding box becomes a block rect
   (the Miami grid is north-south, so most downtown, Wynwood and Little
   Havana blocks qualify). Others get no block (no peds loop, no
   pavement ring). Parks become `park` blocks the same way.
7. Districts. Hand table in `miami-spots.js`: rects and polygons by
   neighbourhood mapped to the existing keys, baked into a 32 m Uint8
   raster so `districtOf` is O(1). Add `placeOf(x, z)` for the real
   neighbourhood name shown on the HUD.

   | Key | Miami areas |
   |---|---|
   | downtown | Downtown, Brickell, Brickell Key |
   | midtown | Edgewater, Overtown, Park West, Midtown, Omni |
   | residential | Little Havana, Shenandoah, Venetian Islands, Belle Isle, Miami Beach west (Flamingo, West Avenue) |
   | docks | Dodge Island (PortMiami), Miami River marine yards |
   | industrial | Wynwood warehouses, Allapattah |
   | beach | South Beach (needs the box widened, see risk 9) |
   | park | Watson Island, Bayfront Park, Museum Park, Margaret Pace Park |
   | airfield | the invented islet |

8. Spatial indexes. A 64 m grid of edges and of buildings, exposed as
   `edgesNear(x, z, r, out)` and `buildingsNear(x0, z0, x1, z1, out)`.
   `onRoad` uses the edge grid (today it loops every edge). The secrets,
   stunts and courses searches must use `buildingsNear` (see risk 3).
9. Extras: kerb parking, lamps, furniture, signals, palms along the
   coast, generated from edge directions with the same rules and rng
   order as citygen. `streetNames`: the 32 most frequent road names; name
   signs only at junctions of those roads.
10. Places from `miami-spots.js`: islet, piers, helipads, spawn, Cinder
    tank, cranes, then the same relative code as citygen for runway,
    apron, hangars, depot, aircraft and boat spots.
11. `radiusAt` is not defined for a map with many islands. Add
    `coast: [{x, z, nx, nz}]` (samples every 10 m on land rings, normal
    out to sea). Consumers that used `radiusAt` switch to `coast` or to
    the spot file.

#### 3.2 Changes per consumer

| Consumer | Change |
|---|---|
| game.js | pick the map; Miami: `game.courses = city.courses`; `findRescueSpot` to nearest `coast` sample; HUD shows `placeOf` but emits the district key too |
| systems/economy.js | map `seen_` flags from the key, not from the HUD display name |
| core/garage.js | `MAP_LIMIT` 6000 |
| world/courses.js | `buildCourses(city, spec = city.courseSpec)`: Miami builds from the spec; procedural path unchanged; `avenueAt` uses distance to the segment, not `horizontal`; `roadPath` gets a binary heap (O(n^2) is fine for 142 nodes, not for a graph of many thousand nodes) |
| world/stunts.js | heading `atan2(uz, ux)` instead of `horizontal`; take `city.rampSpots` when present (systems/stunts.js already accepts `opts.spots`) |
| world/secrets.js | `findSecrets` takes `city.secretSpots` when present; Roof Garden and Tag Alley searches get a region rect and use `buildingsNear` |
| render/citymesh.js | roads as oriented quads per edge (not x/z strips); land from polygons (earcut) with a seawall strip, not radius rings; sea plane and chunk count from `city.size` |
| ui/minimap.js | land polygons instead of `radiusAt`; junction squares from `2 * hx`, `2 * hz` |
| render/props.js, buildings.js | none if blocks, furniture and buildings keep the shape; check yard code with `b.block = -1` |
| traffic, police, crew | none in milestone 1 (they use `lanePoint`); later: oneway, and replace the full-edge scans at traffic.js 363 and 723 and police.js 262 with `edgesNear` |
| systems/tutorial.js, ui/menu.js | place names in text from the map |
| menu credits | "Map data (c) OpenStreetMap contributors, ODbL" (licence condition) |

#### 3.3 Miami locations (positions are first estimates; check each against the data)

Converted with the fetch script's projection (x east, z south).

- Airfield: keep Gullwing Airfield on an invented islet in open water in
  north Biscayne Bay, east of Edgewater: islet about x 10..790,
  z -2370..-2070, with a 700 m causeway to Biscayne Boulevard near NE
  24th Street (shore near x -700). Why: there is no airport in the box
  (Miami International and Opa-locka are 10 km and more to the
  north-west), Watson Island is too small for a 710 m runway plus the
  depot without flattening real places, and PortMiami is the docks. Open
  bay keeps every runway approach over water, sits about 900 m north of
  the Venetian Causeway and about 800 m south of the Julia Tuttle
  Causeway, and reuses all of citygen's islet-relative code (runway, depot,
  dock, Causeway Dash) unchanged. Test: the islet plus 100 m is all water
  in the raw data before the islet is added.
- Piers, in contract order: (0) Bayfront Marina, by Bayfront Park,
  pier east at about (-680, 170); (1) Miami Beach Marina, Alton Road,
  pier west at about (4000, 1000); (2) Sunset Harbour Jetty, Miami Beach
  bay side, pier west at about (3650, -1500); (3) Airfield Dock (derived).
  Seaplane: one at the islet dock as today, and one by the real seaplane
  base on Watson Island's south shore at about (800, 110).
- Depot: Ironbank Depot, east end of the islet (derived).
- Helipads: the two airfield pads and the depot pad (derived);
  Watson Island Helipad on open ground at about (700, -500) (the
  `dockPad` replacement, so Gullwing Air Mail flies off the islet); roof
  pad derived (midtown roof nearest a downtown anchor at about
  (-1100, 600), likely Edgewater or Park West).
- Spawn: SE 1st Street in Downtown, facing east, about (-1100, 780).
- Cinder tank: an Allapattah industrial yard, about (-3200, -2550).
- Cranes: the gantry cranes on the PortMiami south quay, about
  (2000, 1110).
- Secrets (keep ids and names, so saves stay valid):
  - drowned-box: in Fisherman's Channel off the PortMiami south quay, about (2000, 1180).
  - roof-garden: derived, a 9 to 20 m roof in Wynwood or Edgewater.
  - the-gullet: a storm culvert in the Brickell Key seawall, about (-550, 1400); the cave mesh is re-dressed as a culvert (render only).
  - rustlamp: east tip of Dodge Island facing Government Cut, about (3200, 1220); if the box is widened east, the South Pointe jetty instead.
  - tag-alley: derived, the longest 3 to 8 m gap between Wynwood buildings (fits the real murals).
  - lone-ride: Margaret Pace Park, about (-550, -1170).
  - Ghostwake garage: a lock-up off North River Drive by the Miami River boatyards, about (-3500, 60), checked with `openGround`.
- Stunt ramps (original names, quiet streets): Wynwood Kicker (a
  warehouse street off NW 2nd Avenue), Little Havana Hop (SW 4th Street),
  Edgewater Launch (a side street by Margaret Pace Park), Sunset Harbour
  Skip (Purdy Avenue); Dock Kicker and Dock Splash derived at the islet.
- Course spec (ids kept, names new): street-glasswell -> Downtown Loop;
  street-fernside -> Calle Ocho Loop; street-rim -> Bay Bridges Rally
  (MacArthur Causeway, Alton Road, Venetian Causeway, Biscayne
  Boulevard); street-causeway -> Causeway Dash (unchanged idea);
  boat-saltyard -> Government Cut Sprint; boat-slalom -> Venetian Slalom
  (between the Venetian Islands); boat-island -> Dodge Island Round;
  sky-threader -> Brickell Threader (canyon rings down Brickell Avenue);
  sky-gull, sky-rooftop, deliver-airmail stay islet-relative; deliveries
  re-pointed at Little Havana, Wynwood, the port gate and Miami Beach.
- Names: real streets and neighbourhoods are fine. Invented names must
  stay original and must not echo the well-known 2002 game set in a
  fictional Miami (no "Vice", "Ocean Beach", "Starfish Island", "Leaf
  Links", "Prawn Island"). No brand names (marina operators, malls).

### 4. Risks, most likely to break silently first

1. Road graph connectivity. Simplified polylines without node ids may lose
   junctions; bridges may join streets they pass over. Symptoms: traffic
   loops on a fragment, `roadPath` returns null, courses throw.
   Test: largest component keeps at least 95 percent of road length;
   every course waypoint reachable; no junction where a land bridge
   crosses a street; a named check that Biscayne Boulevard connects to
   the MacArthur and Venetian causeways.
2. shoreDist correctness and seams. Coastline rings with the wrong side,
   unclosed rings at the box edge, or seams where bridge strips meet land
   (today's causeway seam already stops traffic: `CAUSEWAY_WEIGHT = 0`).
   Test: probe points (Freedom Tower, Wynwood Walls, Watson Island: land;
   mid bay, Government Cut: sea); along every bridge-over-water edge,
   `shoreDist >= width / 2 - 1`; finite gradient everywhere; a car driven
   across every causeway keeps speed.
3. Startup cost with about 27 times the buildings and a far larger graph. `findAlley` is O(B^2), the garage
   scan calls `openGround` (O(buildings + props + furniture)) thousands
   of times, stunts call `clearOfBuildings` per edge, `roadPath` is
   O(n^2) and is called dozens of times. Any one can hang the phone.
   Test: `createMiamiCity` plus courses, secrets and stunts in under 3 s
   in node; smoke logs build time and fails above a budget.
4. Per-frame helper cost. `onRoad` loops every edge and runs per frame in
   audio and effects; `shoreDist` runs about 5 times per craft per step.
   Test: micro-benchmark (1e6 calls of `shoreDist`, `onRoad`,
   `districtOf` under fixed limits); `scripts/perf.mjs` frame time on the
   Miami map.
5. Collision versus rendering. Rotated footprints cut into boxes, boxes
   that overlap roads, collision filled in render code. Test: no building
   box overlaps a road strip (sampled), spawn and every spot clear,
   `fillCollision` used by both game and tests.
6. Parked-car spawn. Kerb spots computed from real widths can land inside
   buildings, on bridges or in junction boxes. Test: every spot on land,
   off junction boxes, not in a building box, not on a bridge.
7. Courses generator. Hard-coded coordinates and `radiusAt` produce
   nonsense, not errors, unless the spec path is used. Test: run the
   existing courses.test.js assertions (gates at sea, rings clear,
   checkpoints joined, starts clear) against the Miami city as well.
8. District and HUD names. Showing real names breaks economy's name to
   key map, so `seen_` records stop silently. Test: emit every district
   key and check the flag is set.
9. Box edge. The box's east edge (lon -80.135) cuts Miami Beach about
   500 m short of the Atlantic, so there is no ocean beach and no South
   Pointe. Recommend the data helper widens east to about -80.118.
   Test: a `beach` district exists with sand coast.
10. Save compatibility. `MAP_LIMIT`, saved positions from the old island,
    and medal ids. Test: save round trip at (4000, 1000); an old save
    loads at the Miami spawn (positions are not meaningful across maps:
    store a `map` id and drop positions when it differs).
11. Renderer and memory. Chunk builders sized for 1.6 km; 20 700
    buildings with facade detail. Test: smoke at phone size with draw
    calls and triangle count logged, budget checked; milestone 1 uses a
    crop.

### 5. Milestones

Four milestones. Each ends with the game playable at `?map=miami` and
`npm test`, `npm run lint`, `npm run smoke` green. The procedural island
stays the default until milestone 3.

1. Core crop: streets, land, water, buildings. Crop about x -2600..1200,
   z -2600..1800 (Downtown, Brickell, Overtown, Edgewater, Wynwood south,
   Watson Island, PortMiami west) plus the islet. Adapter steps 1 to 8
   and 10, `fillCollision`, citymesh roads and land from polygons,
   minimap polygons, `MAP_LIMIT`, `findRescueSpot`. Activities, secrets
   and stunts get empty lists on Miami (guard the systems if needed).
   Playable: drive, walk, boat, fly, traffic, police, parked cars.
   Tests: new `test/miami.test.js` (graph connected, nodes on land,
   shoreDist probes and bridge strips, spawn clear, no building on a
   road, parking spots valid, helper benchmarks, build time), the traffic
   two-minute eight-car run and the peds no-NaN run on the Miami city.
   Smoke: load `?map=miami`, no errors, build time and frame time logged.
2. Places and activities. `miami-spots.js` complete; course spec, ramps,
   secrets and garage, roof pad, Cinder tank, cranes; HUD `placeOf` with
   economy keys; texts in tutorial and menu; OSM credit in the menu.
   Tests: courses, secrets and stunts assertions run on Miami too; district
   flags test. Smoke: start one race, one boat course, one sky course.
3. Whole box and performance. Remove the crop, chunk count by map size,
   far LOD for buildings, rotated-footprint decomposition tuned, edge
   grid in traffic and police scans, street name signs. Miami becomes the
   default map. Tests: build-time and helper budgets on the full box;
   `scripts/perf.mjs` budget on the phone profile. Smoke on the default.
4. Water and roads polish. Miami River as navigable water with bridges
   that stop boats cleanly, oneway streets in traffic and police routing,
   the widened east edge (if the data helper adds it) with South Beach
   sand, save `map` id. Tests: oneway respected over a traffic run, boat
   river run, save migration.
