# Real-map data (Miami)

`src/world/data/miami.json` is generated, development-time data. The game
never fetches anything at runtime; the file is bundled like any other asset.

## Re-run

    node scripts/fetch-map.mjs

Downloads OSM API 0.6 tiles (about 0.04 degrees, split further when the API
refuses more than 50000 nodes; the 0.9.0 east strip lon -80.135 to -80.115
comes as two extra tiles after the first box's, so the old features keep
their order and building ids), one request at a time with a 1 s pause and
User-Agent `rustwater-map-build/0.1 (dev tool)`. Raw responses are cached
gzipped in `build/osm-cache` (git ignored), so re-runs do not download again.
Delete that folder to refresh. `scripts/fetch-map.mjs` is never imported by `src/`.

## Source and license

Map data (c) OpenStreetMap contributors, ODbL
(https://www.openstreetmap.org/copyright). The string is stored in the
`attribution` field of the output and must be shown in the credits if the data
is used in the game.

## Area and projection

Box: lat 25.745 to 25.815, lon -80.225 to -80.115 (downtown, Brickell, Little
Havana, Biscayne Bay, all of South Beach and the Atlantic front to the sand;
0.9.0 moved only the east edge, from -80.135). Origin is the center of the
first box (lon -80.225 to -80.135), lat 25.78, lon -80.18, and stays there.
Equirectangular: x = (lon - lon0) * R * cos(lat0), z = -(lat - lat0) * R, with
R = 6371008.8 m. x east, z south, meters, flat ground y = 0. Bounds are
x -4505.8 to 6508.3 m, z +-3891.8 m (11.0 km by 7.8 km).

## Contents

`roads` (class, name, oneway (1 along the way, -1 against it; traffic circles and
motorways one-way by default), bridge, lanes, lf and lb (`lanes:forward`,
`lanes:backward`), mph (`maxspeed`), turn (`turn:lanes`), svc (`service`:
alley, parking_aisle, ...), area, mall (Lincoln Road Mall, mapped as a
footway, kept as `pedestrian`), p), `buildings` (h meters, kind,
name, p; height from `height`, then `building:levels` * 3.2, then a default by
class), `water` (polygons, or `line: 1` waterways), `coastline`, `parks`,
`labels` (name, kind, x, z); 0.9.0 (PLAN_V3 2.1 item 2): `parking`
(`amenity=parking` areas: kind, p; no names), `beaches` (`natural=beach`),
`piers` (`man_made=pier`, lines or `area: 1`), `slipways`, `barriers`
(`barrier` lines: wall, retaining_wall, fence, guard_rail, hedge,
jersey_barrier, city_wall, handrail), `signals` and `stops`
(`highway=traffic_signals` and `highway=stop` nodes, flat absolute decimeter
pairs). No business names are taken. Footways (but the two malls), steps,
paths, tracks and cycleways are dropped. Polylines are simplified with
Douglas-Peucker at 1.5 m. The region files (scripts/split-map.mjs) cut the
new lists to the crop like roads and buildings.

Polyline field `p` is delta-encoded integer decimeters: `[x0, z0, dx1, dz1,
...]`; decode by running sum, then divide by 10. Label x, z are plain meters.

## Size

2.8 MB plain JSON (0.9.0): 12,786 roads, 22,585 buildings, 95 water
shapes, 59 coastline lines, 727 parks, 92 labels, 426 parking areas, 17
beaches, 238 piers, 11 slipways, 228 barrier lines, 939 signals, 1,751 stop
signs. Region files: Beach 827 KB (250 KB gzip), Downtown 896 KB, West
871 KB, North 711 KB, South 683 KB. Checked by `test/mapdata.test.js`.

## Integration plan

Status: milestones 1 (core crop), 2 (places and activities) and 3
(whole box and performance) are in the game, and Miami is the default
map (`?map=island` for the procedural island); see "Milestone 1: done",
"Milestone 2: done" and "Milestone 3: done" at the end. The rest of
this section is the plan as written before it, from a read of
`src/world/citygen.js` and every consumer of its return value
(src/systems, src/render, src/ui, src/world, src/entities, src/game.js,
test/). The data format is described above; this section is about
plugging that data into the game. Polylines (`p`, delta-encoded
decimeters) carry no OSM node ids. The origin (lat 25.78, lon -80.18) is in
the bay between Bayfront Park and Watson Island, not on land.

### 1. What the game uses from the city object

`generateCity()` today gives 142 nodes, 256 edges, 758 buildings, 115
blocks, 967 parking spots on a 1.3 km island. The Miami box is about
9.0 x 7.8 km: roughly 40 times the area, with about 11.7k road polylines
(many thousands of graph segments once split at vertices) and 20.7k
buildings.

| Field / function | Used by | What it needs |
|---|---|---|
| `nodes[] {id, x, z, hx, hz, edges[], signal, i, j}` | traffic, police, crew, combat, session, courses, stunts, citymesh, minimap, graphics, tests | junction center; `hx/hz` half size of the junction box (traffic and police `extAt`, citymesh, courses `groundR`); `i < 0` marks the airfield gate (citymesh signals skip it); minimap reads `wx[n.i]`, `wz[n.j]` |
| `edges[] {id, a, b, horizontal, width, avenue, length, causeway}` | traffic, police, crew, session, courses, stunts, citymesh, minimap, props, tests | straight segment between two nodes. `horizontal` is assumed to mean "exactly along x" in citymesh road meshes, `onRoad`, curb parking, furniture, `avenueAt`, stunt heading; `signalState` only uses it to pick a phase |
| `laneOffset`, `lanePoint`, `lanesPerDirection`, `signalState` (exports) | traffic, crew, police, graphics, tests | work for any straight edge direction already; `signalState` needs a two-way phase key |
| `blocks[] {id, i, j, x0, z0, x1, z1, district}` | peds (sidewalk loops around the rect), crew (hangout corners), audio (park test), buildings.js (yards), props, citymesh (sidewalk ring), minimap, secrets (playground) | axis-aligned rectangles with a 4 m `SIDEWALK` ring, roads on all four sides |
| `buildings[] {x0, z0, x1, z1, h, district, kind, style, tint, vseed, block, street, billboard, depot}` | citymesh (draws them and adds the collision boxes), buildings.js, minimap, courses (`tallestNear`, `roofNear`), secrets (alley, roof, openGround), stunts, tests, fightgame | axis-aligned boxes; `kind` in building/house/warehouse/container; `street` bitmask of sides facing a road |
| `props`, `furniture`, `signals`, `landmarks {lighthouse, cranes, billboards, windsock, runwayLights}`, `streetNames {x[], z[]}` | props.js (also adds tree, crane and lighthouse collision), citymesh, textures, combatfx, armor, secrets, tests | points with type; `namesign` furniture indexes `streetNames.x/z` by `nx/nz` (0..15) |
| `parkingSpots [{x, z, heading, lot}]` | parked.js, secrets (`lot` industrial seeds the garage search), citygen (Cinder tank), traffic test | curb spots along non-avenue edges, `lot` spots in parking lots |
| `spawn {x, z, heading}` | game.js, session, combat respawn, tests | on a road, clear of collision |
| `piers [{x0, z0, x1, z1}]` (order matters) | game.js (waterCollision), courses (`mainPiers[0..2]`, last pier = airfield dock), stunts (last pier), secrets, props, citymesh, minimap | axis-aligned rects sticking out to sea |
| `pois [{type, x, z, label}]` | minimap legend and icons | types airfield, marina, depot |
| `boatSpots`, `aircraftSpots`, `tankSpots` `{x, z, heading, spec, ...}` | fleet, session, courses (start clearance), secrets, tests | spawn points with spec ids |
| `helipads [{x, z}]` | courses (`helipads[0]` start of Rooftop Hopper; airmail picks one off the islet), citymesh | first one on the airfield |
| `roofPads`, `depot {x0, z0, x1, z1, gate}` | fleet (via aircraftSpots), tests | roof pad: midtown roof nearest the origin |
| `airfield {islet, runway, apron, gate}` | courses (all sky courses and island boat lap are placed relative to `islet`/`runway`), stunts (dock ramps), game.js `findRescueSpot`, tests | `gate` is a node joined by one `causeway` edge |
| `extraLand [rect]`, `surfaces [rect]` | citymesh, minimap, secrets | islet and causeway rects; runway, apron, depot apron |
| `shoreDist(x, z)` | vehicle, tank, boat, aircraft (keep on land / in water, gradient by +-1 m samples), traffic, police, crew, peds, audio, combat, session, courses, stunts, game.js | meters inside land (+) or out at sea (-), smooth, called many times per craft per step |
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
| Cinder Row tank (citygen) | easternmost industrial `lot` spot | Hand-place (OSM data has no parking lots) |
| Spawn (citygen) | street next to the node nearest the origin, uses `wz[center.j]` | Hand-place on a named street |
| Secrets finder (world/secrets.js) | `shorePoint` marches in from `radiusAt`; headlands sorted by radius; garage scans `x 330..700`, then `-600..600` | Hand-place drowned box, cave, lighthouse, playground, garage. Roof Garden and Tag Alley can be derived with a region filter |
| Stunt ramps (world/stunts.js) | quiet-street pick by district; heading from `horizontal`; dock ramps from the last pier | Hand-place the four street ramps (names below); dock ramps derive as today |
| Courses (world/courses.js) | `ringNodes(mainNodes, 0, 0, 16)` rim loop; delivery points like `(-420, -420)`, `(300, 520)`, `(60, -150)`; Threader from `xs/zs` grid; boat routes from `radiusAt` and radial `pushOut` from the origin; sky routes relative to islet | Replace with a per-map course spec (waypoints by road name or point, buoy lists). Keep the generic helpers (`roadPath`, `pickAlongWalk`, `refineSea`, `skyCheckpoints`, medal maths) |
| `findRescueSpot` (game.js) | walks toward the islet or toward (0, 0) | Walk toward the nearest coast sample on land instead (origin is water) |
| `MAP_LIMIT = 3000` (core/garage.js) | saved coordinates clamped to +-3000 m | Raise to 6000. Silent today: a car saved at x 4000 (Miami Beach) comes back at 3000, in the bay |
| Sea plane 9000 x 9000 (citymesh), chunk builders sized by `city.size` with 5 and 3 tiles | sized for a 1.6 km map | Sea at least 12 km; chunk count from map size (about 500 m tiles) |
| Place names in text: tutorial.js, menu.js, courses names and blurbs, stunts labels, minimap legend, economy `'The Strand'` | procedural names | New names per map (see 3.4) |
| Parked-car rules (citygen) | curb spots on axis-aligned non-avenue edges, both sides, 6.5 m pitch | Derive with the edge direction; skip bridges, oneway one-lane streets and spots inside a building box |

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
   polygons. Bake a signed distance raster: 4 m cells, Int16 decimeters,
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
   sidewalk ring). Parks become `park` blocks the same way.
7. Districts. Hand table in `miami-spots.js`: rects and polygons by
   neighborhood mapped to the existing keys, baked into a 32 m Uint8
   raster so `districtOf` is O(1). Add `placeOf(x, z)` for the real
   neighborhood name shown on the HUD.

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
9. Extras: curb parking, lamps, furniture, signals, palms along the
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
| menu credits | "Map data (c) OpenStreetMap contributors, ODbL" (license condition) |

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
  pier west at about (4000, 1000); (2) Sunset Harbor Jetty, Miami Beach
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
- Cranes: the gantry cranes on the PortMiami south pier, about
  (2000, 1110).
- Secrets (keep ids and names, so saves stay valid):
  - drowned-box: in Fisherman's Channel off the PortMiami south pier, about (2000, 1180).
  - roof-garden: derived, a 9 to 20 m roof in Wynwood or Edgewater.
  - the-gullet: a storm culvert in the Brickell Key seawall, about (-550, 1400); the cave mesh is re-dressed as a culvert (render only).
  - rustlamp: east tip of Dodge Island facing Government Cut, about (3200, 1220); if the box is widened east, the South Pointe jetty instead.
  - tag-alley: derived, the longest 3 to 8 m gap between Wynwood buildings (fits the real murals).
  - lone-ride: Margaret Pace Park, about (-550, -1170).
  - Ghostwake garage: a lock-up off North River Drive by the Miami River boatyards, about (-3500, 60), checked with `openGround`.
- Stunt ramps (original names, quiet streets): Wynwood Kicker (a
  warehouse street off NW 2nd Avenue), Little Havana Hop (SW 4th Street),
  Edgewater Launch (a side street by Margaret Pace Park), Sunset Harbor
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
- Names: real streets and neighborhoods are fine. Invented names must
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
6. Parked-car spawn. Curb spots computed from real widths can land inside
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

### Milestone 1: done (2026-11-20)

Playable at `?map=miami` (the procedural island stays the default):
drive, walk, boat, fly, traffic, police, parked cars and peds on real
streets. Activities, secrets and stunt ramps are empty lists on Miami.

What is where:

- `src/world/miami.js`: `createMiamiCity(data, opts)` returns the
  `generateCity` shape plus `map: 'miami'`, `ux/uz` on edges, `bend` on
  degree-2 nodes, `edgesNear`, `buildingsNear`, `blockAt`, `inBuilding`,
  `landGrid` (the drawn land raster), `landRuns`, `landTarget` (nearest
  dry land, used by `findRescueSpot`), `graphStats`, `buildMs`.
  `opts`: `crop`, `spots`, `seed`.
- `src/world/miami-spots.js`: crop, spawn, causeway street, piers,
  seaplane, helipad, district table, hand links (none needed so far).
- `src/world/maps.js`: `mapFromSearch(search)`, the map choice (tested).
- `src/main.js`: reads `?map=miami` and loads `world/miami.js` and the
  data with a dynamic `import()`; `scripts/build.mjs` turns on esbuild code
  splitting, so the 2.2 MB data chunk is only loaded on the Miami map
  (the default `game.js` did not grow) and the chunks are in `sw.js`.
- `src/game.js`: `createGame({ city })`, `game.courses` from the city,
  stunt spots from `city.rampSpots`, `findRescueSpot` aims at
  `city.landTarget`, no session restore on a map other than the island.
- `src/world/collision.js`: `fillCollision(city, collision)` (citymesh and
  the tests use the same building boxes).
- `src/render/citymesh.js`: on a city with `landGrid`, land by marching
  squares over the raster (chamfered shore, a seawall face), roads as
  quads along each edge with a disc at every node, deck sides on bridges
  and the causeway; tile counts from the map size; sea plane from it too.
- `src/ui/minimap.js`: land from `landRuns`, junction squares from
  `hx/hz`, round line caps (real map only).
- `src/world/secrets.js`, `src/world/stunts.js`: a city's own
  `secretSpots` / `rampSpots` are used when present (Miami: empty).
- `src/systems/traffic.js`: no giving way and no oncoming-left wait at a
  `bend` node (two lines; procedural nodes have no `bend`).
- `src/core/garage.js`: `MAP_LIMIT` 6000.

Numbers (this machine): about 1750 nodes, 2300 edges, 285 blocks, 6400
building boxes, 7100 curb spots; 96 % of the junctions in the main
network; build about 0.9 s CPU in node (wall time doubles when other
jobs share the machine).

Tests: `test/miami.test.js` (build time, shape, graph and airfield link,
shoreDist probes and smoothness, every lane 2 m inside land, spawn and
curb spots, hand spots, buildings off the roads and collision, a 600
step traffic + parked + peds run, helper cost, map choice, determinism);
`test/garage.test.js` (6 km limit, strict sanitiser). Smoke:
`scripts/smoke-extra.mjs` opens `?map=miami`, drives 300 steps, checks
for page errors and outside requests. Screenshots:
`scripts/miami-shots.mjs` writes `docs/preview/miami-*.png`.

Deviations from the plan:

1. Crop x -2600..2450 (plan: ..1200), z -2600..1800. Star, Palm and
   Hibiscus Islands are only joined to the rest east of x 1200, and
   without them the main network held 92 % of the junctions. Land past
   the crop is cut 150 m outside it (a straight seawall); roads stop at
   the crop edge (dead ends there are well inside land).
2. The causeway leaves Northeast 26th Street, not 24th: from 24th the
   islet sits within 100 m of a small real island south of it. Islet x
   10..790, z -2621..-2321 (still citygen's anchor - 205 .. + 95).
3. Land raster 5 m (plan 4 m), for build time. `shoreDist` is one signed
   field in which every road strip (half width + 3 m), bridge and the
   causeway are stamped as land, so there is no analytic max and no
   seam anywhere a car can drive. `mainShore` is the drawn land only and
   is not a distance out at sea (-1 there). Boats cannot pass under
   bridges yet (milestone 4).
4. The Miami River is only a center line in the data: it is carved as
   water 38 m wide. Ponds narrower than 12 m are ignored.
5. Roads: freeway pieces at grade and bridges over land are dropped
   unless an end is within 40 m of water (that keeps the causeway
   approaches and drops the I-95, I-395 and Dolphin ramps); ways named
   "Tunnel" are dropped. One-way streets are two-way and 11 m wide;
   avenues are two-way trunk, primary and secondary roads or 4+ lanes.
   Junctions: shared vertices, a vertex within 2.2 m of another road
   (bridges only at their ends), street crossings with no shared vertex;
   merge radius 12 m; chains simplified at 2.5 m.
6. Blocks come from a flood fill of road-free land on the raster (not
   planar faces): regions at least 85 % of their bounding box, 20 to
   320 m, trimmed clear of the curb. Buildings in a block are clipped to
   keep the 4 m sidewalk ring; others are trimmed 1.5 m clear of the
   curb. Every footprint (not only rotated ones) is covered by up to 6
   boxes, largest rectangle first, on a 2 m grid.
7. Piers: Miami Beach Marina and Sunset Harbor are outside the crop, so
   the three main piers are Bayfront Marina, Watson Island Marina and
   Brickell Key Landing (then the Airfield Dock). Seaplanes: the islet
   dock and Watson Island. Watson Island Helipad at (640, -640).
8. The origin (0, 0) is on the west tip of Dodge Island in this data,
   not in the bay.
9. Not done yet: `coast` samples (`landTarget` serves `findRescueSpot`),
   `placeOf` and real names on the HUD, cranes, the Cinder tank, name
   signs, stop signs, crossing paint and road decals on Miami, a saved
   map id (a Miami session is not restored, but saving still writes the
   shared session record), perf budget on the phone profile.

### Milestone 2: done (2026-11-20)

On `?map=miami` the activities, secrets, stunt ramps and the other hand
places work; the HUD shows real neighborhood names; the tutorial and
menu texts name Miami places; Settings shows "Map data (c) OpenStreetMap
contributors, ODbL" on any map built from the data (`city.attribution`).

What changed:

- `src/world/miami-spots.js`: the course spec (`MIAMI_COURSES`), the six
  secrets and the garage, four street ramps, the roof pad anchor, the
  Cinder tank and crane points, the HUD place tables (`places`,
  `waterPlaces`, each entry with the `src` data name it comes from), the
  place texts (`texts`) and secret notes (`secretNotes`).
- `src/world/miami.js`: step 12 at the end of `createMiamiCity` fills
  `courses` (`buildCourses`, through `city.courseSpec`), `secretSpots`
  and `secretGarage` (`placeSecrets`), `rampSpots` (`placeRamps`, curb
  cars cleared off them); also `placeOf(x, z)` (land and water names
  baked at 16 m, a bridge's own street name on a bridge, Gullwing Airfield
  on the islet, "Miami" where no entry covers), `placeNames`, `texts`,
  cranes in `landmarks.cranes`, the Cinder tank in `tankSpots`, the roof
  pad from `roofPadAnchor`. Build about 0.6 s CPU in node (places 50 ms).
- `src/world/courses.js`: `buildSpecCourses(city, spec)` (called by
  `buildCourses` when the city has a `courseSpec`); street waypoints are
  points snapped to junctions and checkpoints are picked at junctions
  (not bends); boat gates are pushed down the shore field (`pushToSea`)
  instead of out from an island center; canyon rings are found on a named
  avenue where the ring's full width is clear. The islet courses (First
  Feathers, Rooftop Hopper, the Causeway Dash walk, Air Mail) are shared
  functions used by both maps. `roadPath` uses a binary heap on graphs of
  more than 400 nodes; `avenueAt` and canyon ring facing work on edges in
  any direction (`ux, uz`); `tallestNear` uses `buildingsNear`. The
  island's courses are byte-identical to before (checked).
- `src/world/secrets.js`: `placeSecrets(city, spec)`: shore spots
  (container, culvert, lighthouse) on open ground 5 to 6 m in from the
  shore near a point, facing the sea (the container's spot needs open
  water 23 and 30 m out); roof and alley searched inside a region with
  `buildingsNear`; playground and garage on open ground nearest a point.
- `src/world/stunts.js`: `placeRamps(city, spec)` (a straight stretch of
  the named street nearest the point, heading along the edge); the dock
  ramps are a shared function.
- `src/world/maps.js`: `hudPlace(city, x, z, out)` gives the HUD name and
  the district key; `SHORE_NAME`. `src/game.js` uses it and emits
  `district` with the key; `src/systems/economy.js` takes the key (known
  keys only) and falls back to the name map.
- `src/systems/tutorial.js`, `src/ui/menu.js`, `src/main.js`: place texts
  from `city.texts` when present; secret notes from the spot; the OSM
  credit at the end of Settings (`data-role="map-credit"`).

Places (checked against the data by `test/miami-places.test.js`):

- Courses (ids kept): Downtown Loop (2 laps), Calle Ocho Loop (2 laps),
  Bay Bridges Rally (Biscayne Boulevard, Venetian Causeway with a lap of
  Di Lido Island, MacArthur Causeway with a lap of Palm Island), Causeway
  Dash (Edgewater to the airfield gate); Palm Island Sprint, Venetian
  Slalom, Fisherman's Channel Round; First Feathers, Biscayne Threader (7
  canyon rings on Biscayne Boulevard and Northeast 2nd Avenue), Rooftop
  Hopper (Edgewater roofs); Port Parcel Dash (Wynwood to the PortMiami
  gate), Fare and Square (Downtown to Little Havana, Brickell and
  Edgewater), Brickell Key Parcel (boat, Bayfront Marina to Brickell
  Key), Gullwing Air Mail (to the Watson Island helipad).
- Secrets: drowned box off the PortMiami south pier, roof garden on a
  Wynwood roof, The Gullet in the Brickell Key seawall, Rustlamp Rock on
  the east tip of Palm Island, Tag Alley in Wynwood, The Lone Ride in
  Margaret Pace Park; the Ghostwake lock-up by the Miami River.
- Ramps: Wynwood Kicker (Northwest 24th Street), Little Havana Hop
  (Southwest 4th Street), Edgewater Launch (Northeast 19th Street), Palm
  Island Skip (Palm Avenue); Dock Kicker and Dock Splash at the islet.
- Roof pad on a 20 m Park West roof; Cinder tank on open ground in a
  Wynwood yard; three gantry cranes on the PortMiami south pier.

Tests: `test/miami-places.test.js` runs the course, secret and stunt
assertions of the island tests on Miami (plus a teleport run of every
course through the start offer, the secrets system to Ghostwake, a car
off every street ramp), checks each place against the data, the HUD
names, and the district flags on both maps; `test/miami.test.js` now
expects the lists filled. Smoke (`scripts/smoke-extra.mjs`): on Miami a
car off the Wynwood Kicker, then the Downtown Loop, the Venetian Slalom
and First Feathers each offered at the start, started with START and run
to a medal, all in simulated steps. Screenshots:
`node scripts/miami-m2-shots.mjs` writes `docs/preview/miami-m2-*.png`.

Deviations from the plan:

1. Bridges are solid to boats until milestone 4, and the Port Boulevard
   bridge and the MacArthur Causeway close the water round Dodge Island,
   so there is no "Dodge Island Round": boat-island is Fisherman's Channel
   Round, an open-water lap of the south bay along the port's south pier.
   The Main Channel narrows to nothing inside the crop and Government Cut
   is outside it, so boat-saltyard is the Palm Island Sprint (north of
   Hibiscus Island). The slalom runs north of the Venetian Causeway.
2. Both causeways end at the crop edge before Miami Beach, so the Bay
   Bridges Rally runs out and back on each (with a lap of Di Lido Island
   and of Palm Island at the far end). Alton Road is not in the crop.
3. Brickell Avenue is not an avenue in the data (no 18 m width) and has no
   stretch where a 14 m canyon ring clears the towers: the threader is the
   Biscayne Threader on Biscayne Boulevard and Northeast 2nd Avenue.
4. Miami Beach is outside the crop: the deliveries go to the PortMiami
   gate, Little Havana, Brickell, Edgewater and Brickell Key instead.
5. Several first estimates in 3.3 were inland or outside the crop: the
   drowned box is at the south pier near (1300, 1160), the cranes near
   x 1700 to 1860 on the same pier, Rustlamp Rock on Palm Island (Dodge
   Island's east tip is past the crop), the garage by the river near
   (-2350, 420), the Cinder tank in Wynwood (Allapattah is outside), and
   Sunset Harbor Skip (Purdy Avenue, outside) is the Palm Island Skip.
   The roof pad anchor moved to Park West (-1150, -350).
6. HUD names come from a hand table of rects and capsules (each naming
   the data feature it is taken from), not from nearest labels: the data
   has neighborhood labels for only a few areas. Some names come from
   street, park, building or water names (Palm Island from Palm Avenue,
   Hibiscus Island from the Hibiscus drives, Little Havana from building
   names, Dodge Island from Dodge Island Cut). On Miami the 'shore' key
   is reported out on the water (the island uses its 34 m coastal strip).
7. Not done: The Gullet keeps the sea-cave mesh (the culvert re-dress
   is render only and left for later); the Records "Areas explored" count
   is still the number of district keys seen, not of named places.


### Milestone 3: done (2026-11-22)

Miami is the default map: the page with no parameters builds the whole
data box (about 9.0 km by 7.8 km) and `?map=island` opens the procedural
island. Old saves keep working (see "Saves" below).

What changed:

- `src/world/miami.js`: no crop by default. `fullBox(data)` is the data
  bounds less 40 m: roads and buildings stop there and land is cut at the
  bounds, so a street that runs off the edge of the data ends with 40 m
  of land round it. A wall along the bounds closes the coast regions
  before they vote land or water (without it the coastline ways that stop
  just past the box let the mainland flood as sea). `opts.crop`
  (`MIAMI_CROP`) is kept as a test option. Street name signs (step 10):
  the 32 names that meet most often at signal junctions go on the sign
  plates (`streetNames.plates`, in the usual short forms: "SE 1st St",
  "Biscayne Blvd"), and every signal junction where two of them cross
  gets a `streetsign` on a corner clear of both roads (66 signs).
- `src/world/miami-spots.js`: HUD names and districts for the new areas
  (Allapattah, Civic Center, Little Havana west, Shenandoah, Bay
  Heights, The Roads, Brickell south, Brickell Hammock, Wynwood north,
  Midtown, Design District, Miami Beach, Fisher Island, Virginia Key),
  each from a name in the data.
- `src/render/realcity.js` (new): the real-map renderer, in two levels
  plus a middle step:
  - far: built at start for the whole map, one mesh (one draw call) per
    1.2 km block: land on a 20 m grid, roads as plain strips, runway,
    aprons and piers, every building as a box. A shader adds windows to
    the office, glass, brick and stucco boxes (darker glass by day, some
    lit at night, faded to their average past about 1 km so they do not
    shimmer). Tiles that are drawn near are hidden in the far mesh's
    vertex shader through a one-texel-per-tile mask texture.
  - near: full detail (citymesh's ground and roads, buildings.js,
    props.js) per 300 m tile, merged per material per tile, built in the
    render loop a slice at a time (3 ms a frame, 10 ms while the tile
    under the camera is not ready) for tiles within 520 m, shown within
    340 m (40 m of hysteresis), thrown away past 860 m.
  - middle: past 170 m a near tile hides its paint, decals, contact
    shadows, glows, shop signs and street props (on their own meshes for
    that).
  Collision, the lamp list (night light map and lamp points) and the
  glow list are made once for the whole map without drawing anything.
  Traffic-light bulbs: one instanced mesh holding only the bulbs of the
  near tiles (refilled when the near set changes; `graphics.js` resets
  its color cache by `signals.version`).
- `src/render/citymesh.js`: the ground pieces are shared functions
  (`realLand` over a cell range and stride, `realRoads` with an owner
  test, `addBlock`, `addSurfaces`); road tones come from the edge id. The
  island's mesh is built exactly as before.
- `src/render/props.js`: `addProps(C, own, side)` draws only the items
  `own` accepts and adds collision only when `side` is set (the island
  calls it as before); random numbers are used up in the same order
  whatever is drawn. New `streetsign` furniture: a post and one plate
  along each road.
- `src/render/nightlights.js`: the baked lamp light map is 2048 px when
  the lamps span more than 4 km (the island keeps 1024).
- `src/systems/traffic.js`, `src/systems/police.js`: the neighbor scans
  (`refreshNear`, `attachNearest`, police `attach`) use the city's edge
  grid (`edgesAround`, ids in ascending order, so the result is the one a
  full scan gives) when the city has one; the island still scans every
  edge. `onRoad`, `shoreDist`, `districtOf` and `placeOf` were already
  grid or raster lookups (milestone 1).
- Default map: `src/world/maps.js` (`DEFAULT_MAP = 'miami'`,
  `mapFromSearch` returns 'island' only for `?map=island`),
  `src/main.js`.
- Saves: a session has `map` (no field: an older save, made on the
  island). `progress.mapSessions` keeps the session of each map not being
  played; `selectMapSession` (core/garage.js) swaps them when a map
  starts, so an island save is never moved to Miami and comes back on
  `?map=island`, and the other way round. `game.js` now restores the
  session on every map. No save version change.
- `scripts/perf.mjs` takes an optional query (`map=island`), builds the
  near tiles before measuring and reports the city, mesh and streaming
  numbers. `scripts/smoke.mjs` loads the default page (Miami, 300 steps,
  build time budget 8 s), then `?map=island` for the island checks;
  `scripts/smoke-extra.mjs` reloads the default page for its Miami part.
  `scripts/miami-m3-shots.mjs` writes `docs/preview/miami-m3-*.png`.

Numbers (this machine, Chromium with the SwiftShader software renderer,
915 x 412, pixel ratio 1; `scripts/perf.mjs`, the spawn street view):

| | before (core crop, `?map=miami`) | after (whole box, default page) |
|---|---|---|
| draw calls, day / night | 312 / 320 | 221 / 223 |
| triangles, day / night | 436k / 450k | 311k / 333k |
| step (perf.mjs, 300 steps) | 0.82 ms | 0.91 ms |
| step (600 steps, per system timing) | 0.90 ms | 0.66 ms |
| draw CPU, day / night | 8.1 / 7.6 ms | 5.5 / 5.7 ms |
| city build in Chromium | 0.53 s | 1.5 to 1.6 s |
| city mesh | 0.89 s | 0.65 to 0.69 s (far blocks plus the tiles round the spawn) |
| JS heap after start | 157 MB | 167 to 177 MB |
| game created / first loop frame drawn | not measured / not measured | 3.0 s / 4.7 s (island: 1.1 s / 2.9 s) |

The task's starting figure of about 450 calls and 645k triangles was not
reproduced by perf.mjs here (312 and 436k at the same view). A first try
that built the whole box in full detail eagerly needed 1.7 GB of JS heap
and 15 s to the first frame, which is why the near level streams.
In node the whole box builds in about 1.3 to 1.5 s wall (1.9 s CPU),
with the courses, secrets and ramps. Tiles take 3 to 5 ms each on this
machine; in a 2 km drive at 35 m/s the tile under the camera was always
ready (worst streamer frame 4.2 ms, worst single slice 8.5 ms, the mesh
upload of a big tile; 14 ms for the first `addProps` call at start).
The island is unchanged: 253 / 264 calls before and after (its triangle
count fell from 422k to 406k because of the new person level of detail,
not this work). Every first frame after the loop starts takes several
seconds on both maps on this software renderer (shader compiles); that
is not map specific.

Tests: `test/miami.test.js` (the whole box with courses, secrets and
ramps in under 3 s and its extent; places outside the old crop have
land, streets and buildings; the core crop option; helper budget of 1e5
calls of `shoreDist`, `onRoad`, `districtOf` and `placeOf` over the whole
box; the edge grid finds every edge a full scan finds, in id order, and
is faster; street signs; traffic, parked cars and peds at the spawn and
for 1200 steps each in Miami Beach and west Little Havana; Miami is the
default and `?map=island` reaches the island); `test/garage.test.js` (map
ids on sessions, both directions through save and load and through the
session system); the island tests are unchanged. Smoke: the default page
is Miami, 300 steps, no page errors, no outside requests, build time
logged and checked; the island checks run on `?map=island`.

Deviations from the plan:

1. Two levels of detail and a middle step instead of three separately
   built levels: near (full) and far (one box per building, one draw
   call per 1.2 km block), with the middle level being a near tile that
   hides its small meshes. The near level is streamed: building it all
   at start is not possible on a phone (see the numbers).
2. Instancing: the street furniture stays merged per tile and per
   material (instancing per tile would add draw calls); only the
   traffic-light bulbs are instanced (one call, near tiles only). Street
   name signs are merged plates in the tile's prop mesh.
3. The box is not widened east (no South Beach sand or Atlantic shore):
   Miami Beach in the box is the bay side (Alton Road, West Avenue) and
   is a `residential` district. The courses, secrets and ramps are those
   of milestone 2; nothing was moved into the new areas.
4. Name signs only where two of the 32 plate names meet at a signal
   junction (the sign texture atlas holds 32 plates).
5. The other developer screenshot scripts that assumed the island on the
   default page (`scripts/*-shots.mjs` except the Miami ones) were not
   changed: add `&map=island` to their URL to get the island.

### W1 done: core area and lots (2026-11-22)

The contracts are docs/REVAMP.md 6.1 (core), 6.2 (lots) and 6.8 (first
view). What is where:

- `src/world/miami-spots.js`: `MIAMI_CORE` (x -2700..2450, z
  -2700..1900), `MIAMI_SPOTS.startView` (6.8; the spawn is shared with
  `MIAMI_SPOTS.spawn`), `MIAMI_SPOTS.beaches` (Watson Island north shore
  in the core, the Rickenbacker Causeway shore at the south edge),
  `MIAMI_SPOTS.landmarks` (12 invented landmarks with their own shapes),
  and the map labels of venue brands renamed (D1: Tidewater Arena, Opal
  Opera House, Brickell Twin Spires, Riverfront Hall, Flagler Street
  Theatre, Downtown Rail Hub, Design District; `src` keeps the data name).
  Watson Island's district is now midtown (its park polygons stay parks).
- `src/world/lots.js` (new, pure): `LOT_TYPES`, `FEATURE_KINDS`,
  `TREE_VARIANTS` (the `v` of a tree or shrub: royalpalm, coconut, oak,
  seagrape, ficus, pine, mahogany), the named constants of 6.2, `DRESS`
  and `DRESS_SETS` (two sets per type per district), `lotTypeFor` (the
  rule table), `buildLots`, `dressLot`, `featureCap`, `eachBay`,
  `planInfill`, `lotSeed`, `hash32`, `lotShares`, `stepDistance`.
- `src/world/miami.js`: buildings carry `osm` (the OSM kind), `fp` (the
  footprint), `gen` (an infill box) and `landmark` (a landmark id or '').
  Step 8b stamps the lot rasters, stands the open landmarks on free
  ground and adds the infill boxes; step 10b dresses the start street;
  step 11b builds the lots and lists parking lot bays as parking spots. The
  city gets `core`, `inCore`, `lots`, `lotGrid`, `lotAt`, `lotTypeAt`,
  `dressLot(lot, out)`, `startView` (spawn snapped) and `landmarkSites`
  (`{ id, name, shape, x, z, l, w, h, heading, buildings }`);
  `mapLandmarks` is the real places then the invented landmarks.

Rules beyond the contract (each is the same everywhere in the box):

1. Infill. The data has big empty pieces in built-up districts (port
   yards, Park West, Watson Island): with the data alone the core's 10th
   percentile was 9 buildings within 150 m (wanted 15). `planInfill` puts
   a plain box on a world grid of parcels (docks 34 m, industrial 38 m,
   downtown 34 m, midtown 31 m, residential 26 m) where every cell under
   the box plus 5 m is free, 15 m from any building and 20 m from the
   water, never in a park or grass polygon or near a hand place; a seeded
   10 to 40 % of parcels stay open. 2,925 boxes (1,283 in the core).
2. A `bay` feature is a row of bays (heading along the row, `l` = 2.5 m a
   bay, `w` = 5 m), as the W2 renderer draws it; the car faces across
   the row. `eachBay` lists the single bays. At most 3 bays a parking lot
   (never over 60 %) are parking spots: every listed spot spawns a real
   car near the player in parked.js.
3. The feature cap is `featureCap(lot)`: 120 a hectare and 24 a lot, but
   never below the type's minimum content (a 150 m2 yard needs its
   boundary, drive and tree). The core averages 75 features a hectare.
4. The start street (core hand content): street trees every 7 m on both
   curbs and curb spots marked `start: true` along Southeast 1st Street
   ahead of the title camera. The framed views stay clear (W2b): no tall
   prop (tree, lamp, sign, shelter) within 42 m of the title camera's
   view line inside 9.5 degrees, along the whole dolly, nor within
   16.5 m in front of the title camera or the start chase camera; a curb
   tree in that cone moves 4.8 m back into the plaza instead.
   `test/firstview.test.js` checks the 8 degree, 40 m cone. The title
   camera sits 0.5 m south of the spawn line (over the lane), not 6 m.
5. Lot ground edges (render/lotmesh.js `lotEdges`): lawns (yard, park)
   get a concrete edging and a rough grass band where they meet anything
   but lawn; plazas a darker stone border and, on most, stone courses in
   15 m squares; each plaza its own stone tone, slab size and lay.

Numbers (`test/world-density.test.js` prints them): 27,058 lots (6,715 in
the core, 7.3 km2 of lot land); core shares yard 16 %, carpark 18 %, plaza
32 %, grass 1.4 %, works 14 %, beach 0.2 %, park 7.8 %, wateredge 6.3 %,
site 0.2 %, verge 0.7 %, airfield 2.7 %; bare paving 0.7 % in the core,
0.6 % outside. Core road nodes: 10th percentile 15 buildings within 150 m
(median 33); no node on land more than 60 m from a building or a solid
or tall feature (bridge nodes excepted). Start view: 69 buildings within
150 m, 16 trees and 8 parked spots in the camera cone within 80 m. Build
in node: about 1.9 to 2.2 s wall on a loaded 4-core machine (1.2 to 2.0
s before), about 0.3 s more CPU. `dressLot` about 0.02 ms a lot warm.
The lot grid keeps 16 MB (Int32 ids and Uint8 types). No new data file.

## Edge contract

Version 0.9.0 (docs/PLAN_V3.md 2.1 items 3 to 5, 11; seam of 5.1). Written
before the code and kept stable: SOLID, LOTS and NAV build on it. Every
city edge (`city.edges[k]`, Miami and the island) carries the fields below;
`src/world/roadprofile.js` (pure) is the only place that decides them for
Miami. Distances in meters. "Forward" is travel from node `a` to node `b`
(`ux, uz` is that unit direction); "right" is the right-hand side of the
direction of travel, (-uz, ux) for forward travel. Traffic keeps right.

| field | type | meaning |
|---|---|---|
| `lanesF` | int >= 0 | driving lanes carrying traffic a to b |
| `lanesB` | int >= 0 | driving lanes carrying traffic b to a; 0 on a one-way edge |
| `laneW` | m | width of one driving lane: 3.3 (11 ft), 3.6 (12 ft) on trunk and motorway |
| `parkL` | m | parking lane on the left curb, seen traveling a to b (0 or 2.4) |
| `parkR` | m | parking lane on the right curb, seen traveling a to b (0 or 2.4) |
| `median` | m | raised median (0: none). Only on a paired one-way (`divided`): the data gap between its left curb and its partner's; the edge owns the half along its left curb (`median / 2` wide, curbed, planted from 1.5 m), which is not part of `width` |
| `width` | m | curb to curb: `(lanesF + lanesB) * laneW + center + parkL + parkR + 2 * GUTTER` (GUTTER 0.3) |
| `oneway` | bool | true: traffic only a to b (`lanesB` 0); the edge is stored in its legal direction |
| `name` | string | the real street name ('' when the data has none) |

Optional, 0 or absent on most edges: `center` (m, a painted two-way left-turn
lane in the middle of a two-way road with an odd tagged lane count; part of
`width`), `off` (m, the whole cross section moved this far to the right of
the node line: only on a paired one-way whose data gap is under 1.5 m
(`MEDIAN_MIN`, 1.0 m before 0.11.0), so
the two left curbs meet on the middle line and the two yellow edge lines
read as one double yellow, or on a one-way drawn over another one-way of
the same direction (each moves away from the other by half the overlap); every strip, lane and curb is measured from
`node line + off`), `pair` (the partner edge id of a divided road).

Also on every edge, derived (old callers): `avenue` = two or more lanes each
way (`min(lanesF, lanesB) >= 2`, or a one-way of 3 or more); optional
`sidewalk` (1.8 residential, 3.0 downtown and on Lincoln Road; the 0.15 m curb
is `CURB_H`), `ped` (true on a pedestrian street: Lincoln Road Mall, Espanola
Way; drivable in the sandbox), `divided` (true when two one-way ways were
paired into this edge; `median` then holds the data gap). Island edges
(citygen) get the same fields with values that keep their old lanes exactly:
a street (11 m) is 1 + 1 lanes of 4.0 m with 1.2 m parking each side; an
avenue (18 m) 2 + 2 lanes of 3.5 m, a 1.7 m painted `center` and 0.85 m
parking each side (lane centers 2.0, 2.6 and 6.1 m as before).

Cross section, from the left curb to the right curb seen traveling a to b:
gutter, `parkL`, the `lanesB` lanes, `center`, the `lanesF` lanes, `parkR`,
gutter. The middle of `width` lies `off` to the right of the node line.
The divide (center line of a two-way road, middle of its turn lane; the left
lane edge of a one-way) lies at
`s = off - width / 2 + GUTTER + parkL + lanesB * laneW + center / 2` to the
right of the node line (0 on a symmetric two-way road). Helpers in
roadprofile.js: `roadProfile(way, opts)`, `divideOf(edge)`,
`paintLines(edge, out)`, `pairDivided(nodes, edges, edgesNear)`, and the
constants `LANE_W` 3.3, `LANE_W_FAST` 3.6, `PARK_W` 2.4, `GUTTER` 0.3,
`CURB_H` 0.15, `SIDEWALK_RES` 1.8, `SIDEWALK_WIDE` 3.0.

Functions (src/world/citygen.js, pure, no allocation; `forward` defaults to
true so old callers keep working on symmetric roads):

- `lanesPerDirection(edge, forward = true)`: `forward ? lanesF : lanesB`
  (legacy edges without `lanesF`: 2 on an avenue, else 1).
- `laneOffset(edge, lane = 0, forward = true)`: the lane's center, in meters
  to the right of the node line seen in the direction of travel. Lane 0 is
  the innermost lane (next to the divide; the leftmost lane of a one-way),
  higher lanes are further right. Forward:
  `s + center / 2 + (lane + 0.5) * laneW`; backward:
  `-s + center / 2 + (lane + 0.5) * laneW`. `lane` is clamped to the lanes
  of that direction. Always > 0 on a two-way road (right of the center).
- `lanePoint(city, edge, from, d, lane = 0, out)`: the point `d` m from node
  `from` along the edge on that lane, `out = { x, z, heading }`; the direction
  is `from === edge.a` (forward) or not. On a one-way edge driven from `b`
  (illegal) it still gives a point inside the strip (the forward lane's
  offset), so callers must check `canDrive(edge, from)`.
- `canDrive(edge, from)`: false only for a one-way edge entered from `b`.
- `city.streetAt(x, z, out?, heading?)`: the street under (x, z):
  `{ edge, name, cross, d, side }` or null off every road. `edge` the edge id
  whose curb-to-curb strip holds the point (nearest center line wins), `name`
  its name (the nearest named edge within 40 m when it has none), `cross` the
  name of the next named cross street ahead (in the direction of `heading`
  when given, else the edge's forward direction; '' when none), `d` the signed offset from the node line (right positive),
  `side` 1 forward half, -1 backward half. Pure, grid indexed, no allocation
  when `out` is given.

Nodes keep `signal` (traffic light) and gain `stop` (all-way or minor stop
sign, from the data's `highway=stop` nodes) and `blade` (true: street-name
blades stand at this junction). `city.streetNames.atlas` lists every name of
the region in sign-atlas order; `plateIndex(name)` gives its slot.

### Junctions and strip ends (0.11.0, ROADS)

`world/junctions.js` (pure; `buildRoadGeo(nodes, edges)`, run once in
`createMiamiCity` after the cross sections and pairs) decides what is
drawn between the curbs; `city.roadGeo` holds it. Ids of nodes and edges
are unchanged: everything is in side arrays indexed by end
`q = 2 * edge id + (0 at node a, 1 at node b)`.

- Junctions: nodes joined by an edge under 14 m (both of degree 3+), a
  bend node within 8 m of one, the two nodes where a street crosses both
  halves of a divided road, and two junctions (or a junction and a bend)
  whose arms need more than the edge between them are one junction.
  `roadGeo.junctions[j]`: `{ id, lead (lowest node id), nodes, x, z,
  signal, stop, ring, tris, corners, arms, x0, z0, x1, z1, fan }`. `ring` is
  the junction's one asphalt polygon (x, z pairs): every arm's strip end
  (left curb, right curb) and between arms the curb return (radius 1.5 to
  4.5 m from the sidewalk widths, 5 segments) or a straight curb. `tris`
  its triangles. `fan` (about 2 % of junctions): the ring crosses itself
  and its area is the union of `tris`, a fan round (x, z); use
  `inJunctionArea(J, x, z)`. `corners[k]`: `{ curb, tris }`, the curb line
  of the corner (x, z pairs, the road on its right) and the sidewalk
  corner (triangles at `CURB_H`), whose back is where the two back of
  sidewalk lines meet. `nodeJ[node]`: the junction of a node or -1.
- Strip ends: `trim[q]` m from the node along the edge; the strip of an
  edge runs from `trim[2k] + miter[2k] * o` to `length - trim[2k+1] +
  miter[2k+1] * o` (o lateral, right of the node line). `jEnd[q]` the
  junction at that end or -1; `inner[k]` 1: both ends in one junction, the
  edge draws nothing. At a junction end the strip end lies on the ring;
  no two strips overlap outside the rings (test/junctions.test.js).
- Bends (a node of two edges that is not a junction): the two strips meet
  on the bisector (`miter`, `nbr`, `flip`). Where the cross sections differ
  the curbs taper over up to 10 m each side (`taper`, to `tcl`, `tcr` at
  the node, smoothstep); lane lines that do not continue stop before it.
  Two arms leaving a junction side by side whose lines converge (the halves
  of a pair, a fork) are moved apart at the node and taper back linearly
  (`tlin` 1). `curbsAt(geo, e, d)` gives both curbs anywhere.
- Back of sidewalk (the LOTS seam): along a strip, the right curb plus
  `walkOf(e)` and the left curb minus `walkLeftOf(e)` (0 on a divided
  one-way) or minus the median band `medianAt(city, e, d, lc)` (half the
  real gap to the partner, up to 4 m); at a junction, the corners' sidewalk
  triangles. Where more road space lies within 1.5 m beyond it, the gap is
  raised concrete too (`groundOf(city).fillOf(k)`, every 2 m, right then
  left). `city.surfaceAt` answers all of it (1 road, 2 sidewalk, 3 median).
- Paint (`edgePaint`): lines stop at the junction boundary (0.4 m short);
  on approaches to a junction with a signal or stop sign (`ctrl[q]`) a
  two-line crosswalk 0.65 and 3.65 m in and a stop bar at 4.65 m, and the
  lines stop there; nothing is painted on a junction. Traffic stops at the
  bar (`stopDistance`).

### 0.9.0 map truth: measured (2026-11-23)

Data: OSM API 0.6 (the Overpass API is not reachable from the build
container); the first box's tiles came from `build/osm-cache`, the east
strip was downloaded. Beach region (x 1400 to 6508): 2,071 edges, 434
paired one-way edges (211 with a raised median), 164 signals and 229 stop
sign junctions from the data (11 signals generated), 475 junctions with
blades, 169 names in the sign atlas, 10,040 building boxes of which 4.6 %
generated infill, 14.3 km2 of land. Widths: residential two-way 12.0 m,
Ocean Drive (one-way, 1 lane, parking both curbs) 8.7 m, 5th Street (4
lanes one-way, 9.2 m median) 13.8 m. Start: Ocean Drive at 10th Street;
the data maps Ocean Drive one-way southbound from 5th to 15th Street, so
the start faces south (regions.js). Memory at start (headless, after a
collection): Beach 150 MB, Downtown 149 MB (0.8.0 tree: 143 and 145).
