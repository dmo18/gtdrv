# Rustwater: diagnosis, map split and plan to 1.0.0 (plan version 2)

Written 2026-11-23 against version 0.6.0 (commit 943ae29). Design only: no source file was
changed to write this. It replaces docs/PLAN_V1.md sections 2.5 to 4 (the road from 0.6.0 to
1.0.0). The rules in PLAN_V1 2.1 (whole slices only, stop at 80 percent, one owner per file)
and the gate order in 2.6 stay in force; this file adds to them.

"Measured" means a script ran in this container today (4 cores, headless Chromium with the
software renderer, flags as in scripts/smoke.mjs). The software renderer cannot time the GPU, so
every GPU statement below is a count (draw calls, triangles, shader programs), never a time.
"Phone estimate" means the measured desktop number times 3 to 5 for a mid-range Android phone
(the 4x CPU throttle run in 1.1 is the proxy). Nothing here was seen on a phone.

Owner's report: "the game feels like it has regressed because there is now too much for it to
handle and the map is too big". Phone check on the Galaxy S24 Ultra: median 16.6 ms, worst
frame 83 ms, 4 frames over 33 ms, resolution 2.00.

## 0. Verdict in six lines

1. The owner is right about weight, and half right about the cause. The simulation is cheap
   (0.4 ms a step with 100 vehicles and heat 5). What a player feels is: a long frozen start,
   a very large memory footprint, and hitches from a handful of specific causes.
2. The map size is the direct cause of the memory (265 MB of script memory, about 600 MB for the
   tab), of half the start time, and of the periodic hitches (four systems walk whole-city lists).
3. The map size is not the cause of the GPU load: the street view draws 478k triangles on the
   whole map, 485k on a cropped map and 423k on the small island. That needs its own work.
4. Decision: split. Miami becomes five regions that load one at a time, in the same coordinate
   frame, with the tested core as the default. Measured on a prototype: memory 265 to 161 MB,
   city build 1.10 to 0.55 s, far triangles 305k to 125k, before any tuning.
5. The split alone does not reach the budgets. Version 0.8.0 removes the hitches and the fixed
   costs (98 shader programs, 480k triangles, textures and fleet built at start).
6. Four versions to the store: 0.7.0 Split and light, 0.8.0 Smooth, 0.9.0 Polish, 1.0.0 Store.

## 1. Diagnosis (measured)

### 1.1 Start

| measure (whole Miami, default map today) | desktop | 4x CPU throttle (phone proxy) |
|---|---|---|
| Page load to game running | 4.6 s | 13.5 s |
| Main thread blocked inside start-up | 3.3 s | 8.5 s |
| createMiamiCity | 1.03 to 1.10 s | 4.2 to 4.5 s |
| buildRealCity (far level and first 17 tiles) | 0.76 to 0.80 s | 3.4 to 3.5 s |
| Textures drawn in script (grain, normal maps, lamp bake) | 0.25 s | 1.19 s |
| createFleet (all 33 boats, aircraft and tanks of the whole map, with meshes) | 0.21 s | 0.78 s |
| attachExplore | 0.14 s | 0.69 s |
| Map UI raster (the full map, drawn before anyone opens it) | 0.09 s | 0.41 s |
| First draw: 95 to 98 shader programs compiled and linked | 1.1 s in the software renderer; unknown on a phone GPU, typically 10 to 40 ms a program |

The splash is one line of text with no progress, so on a mid-range phone the game looks frozen
for 13 to 18 s. Download is small and not the problem: game.js 1.70 MB (563 KB gzip), map
chunk 2.21 MB (683 KB gzip).

### 1.2 Memory

| measure (whole Miami, at start, after a forced collection) | value |
|---|---|
| performance.memory used (script heap plus typed arrays) | 255 to 265 MB (289 to 340 MB before a collection) |
| Script objects only (36,009 building boxes, 27,058 lots, 5,113 nodes) | 57 to 85 MB |
| Typed arrays kept by the far level of the whole box (CPU copies) | 71 MB |
| Lot grid | 15 MB |
| Chromium renderer process (resident) | 577 to 667 MB |
| Chromium GPU process (software renderer, for scale only) | 320 to 349 MB |
| Growth over a 6 km fast drive and a jet crossing | 63 to 76 MB script heap: no leak found |

A tab or WebView of 600 MB and more is where mid-range Android phones (4 to 6 GB) start killing
the page in the background and where collections get long. Node agrees: 66 MB heap plus 182 MB
of buffers for the whole box.

### 1.3 Steady cost (not the problem)

| scenario (whole Miami, desktop) | step mean | step worst | draw submit median | vehicles, people |
|---|---|---|---|---|
| Parked at the start, after the first 10 s | 0.39 ms | 7.3 | 3.5 ms | 96, 27 |
| Cruise 20 m/s for 1.5 km | 0.45 ms | 12.6 | 4.0 ms | 109, 21 |
| Fast drive 50 m/s for 6 km (98 tiles built, 80 dropped) | 0.38 ms | 12.3 | 3.9 ms | 79 |
| Heat 5 for 90 s: police cars, helicopter and tank | 0.56 ms | 11.9 | 4.1 ms | 102, 30 |
| Jet at 220 m/s across the box twice | 0.26 ms | 13.1 | 5.1 ms | 43 |

The code added since 0.4.0 (boost, siren clearing, service vehicles, hulls, tank, crowds) costs
little per frame: boost and siren are flags and one pass over the vehicle list; hulls and parts
are pooled; the crowd is 0.09 to 0.14 ms a step. No per-frame regression was found in them.
Collection pauses total 100 to 180 ms over 80 to 115 s of play: small.

### 1.4 Hitches, ranked by what a phone player feels

Desktop milliseconds; multiply by 3 to 5 for a mid-range phone.

| # | cause | measured | where |
|---|---|---|---|
| 1 | First step of play spawns every parked car and the crowd at once | step 90 to 200 ms (parked 50 to 134, peds 26 to 33), first draw 77 to 97 ms | systems/parked.js scan, systems/peds.js scan |
| 2 | Whole-city list walks on timers | parked 4.7 to 7.1 ms every 0.5 s when it spawns (27,576 spots, Math.hypot each); traffic 6 to 11.6; service scanHomes 5.9 to 11; peds 5 to 5.6; stunts 8.7; police 10.8 | parked.js, traffic.js, service.js, peds.js (nearestBlock), stunts.js, police.js |
| 3 | Shader programs first used in play, not covered by the warm-up | 1 new program each at: first blast, first shot on foot, first boat, first helicopter, first plane; 5 to 87 new geometries each | render/combatfx.js, boatmesh.js, aircraftmesh.js, graphics.js warmUp |
| 4 | Flying fast builds street-level tiles that are thrown away seconds later | 336 tiles built and 318 dropped in one jet run; tile work up to 12.4 ms in a frame; worst slice 9.2 ms; draw frames of 22 to 31 ms | render/realcity.js update |
| 5 | Tile slices on the ground | worst slice 4.4 to 5.0 ms against a 3 ms budget (lots, props, buildings) | realcity.js, lotmesh.js |
| 6 | Night falls: one frame about twice as long as normal | first night draw 914 ms against a 430 ms baseline in the software renderer | graphics.js, nightlights.js |
| 7 | Every object's matrix is recomputed every frame | updateMatrixWorld, updateMatrix and multiplyMatrices are the top three script costs of a draw (about a third of it) | all static meshes keep matrixAutoUpdate |
| 8 | Resolution probing | starts at 1.5 and climbs to 2.0 in steps of 0.05, each a resize of every render target (read in code, not timed) | render/adaptres.js, graphics.js |

Hitches 1, 2 and 3 match the phone result: a smooth median with a few long frames.

### 1.5 GPU load (counts only)

Street view at the start: 322 draw calls, 478k triangles, 98 programs, a 2048 shadow map, at
pixel ratio 2.0 on the owner's phone. One built tile ring holds 134k tree-detail triangles,
80k lot solids, 50k props; ten cars add about 46k. The Normal and High quality settings draw
almost the same thing. The S24 Ultra holds 60; a mid-range GPU will not at these counts.

### 1.6 What the split changes (prototype, measured)

A scratch copy of the source with out-of-region content skipped instead of thrown, same build:

| measure | whole Miami | core region (5.15 x 4.6 km) | narrow Downtown (3.2 x 4.65 km) | island |
|---|---|---|---|---|
| createMiamiCity in Chromium | 1097 ms | 552 | 322 | none |
| Tile renderer build | 701 ms | 580 | 453 | 416 |
| Page load to game running | 4.2 s | 3.4 | 2.6 | n/a |
| performance.memory after a collection | 265 MB | 161 | 144 | 86 |
| Script heap | 61 MB | 39 | 34 | 20 |
| Far level triangles | 304,616 | 125,004 | 69,258 | 0 |
| Parking spots walked by the scans | 27,576 | 11,108 | 5,246 | 967 |
| Street view draw calls, triangles | 345, 509k | 321, 485k | 331, 485k | 267, 423k |

The prototype still parses the whole 2.3 MB data file and keeps data 3 km past the crop
(miami.js line 756), so a real region build will do better than these numbers.

## 2. Where the game is not yet at Play Store quality (one page, honest)

From code, tests and today's screenshots (dist/w2b, dist/menu-test). Not seen on a phone.

- Performance: section 1. Start of 13 to 18 s on a mid-range phone with no progress shown;
  about 600 MB for the tab; long frames at known moments. This alone fails a store review by
  players ("laggy", "does not load").
- Gameplay feel: a toy box, not yet a game with a pull. There is no goal in the first five
  minutes beyond hints ("Hold GAS to drive"); the missions system is an 18-line stub; the
  player cannot die by default, so chases have no stakes; rewards are medals and three cars.
  This is the owner's chosen design ("more fun, not more points"), so the plan does not add
  modes. It does require the first five minutes to lead somewhere (0.9.0, Q2). Handling cannot
  be judged here at all.
- Visuals: downtown by day and night is at mid-range mobile store level (glass towers, signs,
  lit windows, good cars). Below that level: the waterfront (flat blue boxes, a plain green
  and purple wall beside the camera, one huge paving pattern); black speckle on the crossing
  paint at night (downtown-night.png); blob contact shadows; people are doll-like up close.
  The region edges this plan creates (a straight seawall where the city continued) will be a
  new weak spot and need their own review shots.
- Audio: every sound is synthesised and none has been confirmed by ear. The owner's "bigger
  issues than sound" means sound is still an issue. Until the owner marks the Phone check
  sound numbers, audio is unproven, not done.
- UI: menus are clean and consistent, targets are large, the HUD grid holds. Faults seen: the
  map switch confirmation squeezes its text to one word a line at 915 px wide
  (mapchoice-armed-915x412.png); the splash has no progress; the map choice is three taps
  deep in Settings; no in-game word for "this is the edge of the map".
- Content: 16 adventures, 12 garages, 6 secrets, about a dozen courses, 14 craft types and the
  classic island. Enough for a playground. Nearly all hand-made content sits in the core;
  two thirds of the land has generator dressing only.
- Store readiness: the Android project exists (Capacitor, targetSdk 36, no permissions) but
  no bundle has been built and nothing has run in the Android WebView. docs/STORE.md still
  describes "an open island" and "missions" that do not exist; contact address and owner
  fields are empty; workflow actions are not pinned to commit SHAs (docs/RELEASE.md); new
  personal Play developer accounts must run a closed test with 12 testers for 14 days before
  production. None of this is hard; all of it is undone.
- Stability: good. The loop survives errors, a soak script exists, saves are sanitised and
  versioned, 600 or more unit tests pass. This is the strongest part of the product.

## 3. The map split (contract)

### 3.1 Decision

Split Miami into five regions plus the classic island. One region is loaded at a time. Changing
region is a page reload behind a loading veil (the path the Settings map switch uses today), so
memory starts clean every time. All Miami regions keep the one coordinate frame of
docs/MAP.md (origin lat 25.78, lon -80.18; x east, z south, metres). Nothing is re-centred, so
every saved position, explore cell, garage id, adventure id, course id and medal stays valid.

The default is the existing core, not a smaller new box. Reason: docs/REVAMP.md 6.1 already
puts every course, ramp, secret, pier, the airfield and the start view inside it, it has
determinism fingerprints and tests today, and the narrower box measured only 17 MB lighter
while it would force three courses, two ramps and two secrets to move.

### 3.2 Regions (exact crops, metres)

BOX is x -4505 to 4505, z -3891 to 3891. Counts measured on the built whole box.

| id | name in the picker | crop x0, z0, x1, z1 | size km | land km2 | building boxes | road nodes | garages | adventures inside |
|---|---|---|---|---|---|---|---|---|
| `miami-downtown` (default) | Downtown and the Bay | -2700, -2700, 2450, 1900 (= MIAMI_CORE) | 5.15 x 4.60 | 13.3 | 8,261 | 1,811 | downtown, brickell, wynwood, edgewater, watson | 8 |
| `miami-beach` | Miami Beach and the Islands | 1400, -3891, 4505, 3891 | 3.11 x 7.78 | 9.5 | 7,427 | 1,002 | beach, key | 3 |
| `miami-north` | Wynwood and the North Side | -4505, -3891, 1500, -1500 | 6.01 x 2.39 | 9.8 | about 7,900 | about 1,020 | wynwood, edgewater, allapattah, design | 2 |
| `miami-west` | Little Havana and Civic Center | -4505, -1700, -1900, 2050 | 2.61 x 3.75 | 9.6 | 9,124 | 1,150 | civic, havana | 1 |
| `miami-south` | The Roads and the South Shore | -4505, 1850, 1400, 3891 | 5.91 x 2.04 | 6.3 | 10,291 | 1,105 | roads | 2 |
| `island` | Classic island | unchanged | | | 758 | 142 | none | none |

- The five crops cover all 40.3 km2 of land (checked on the 5 m land grid). They overlap on
  purpose: a street may be in two regions. Wynwood and Edgewater are in Downtown and North;
  Gullwing Airfield (islet x 10 to 790, z -2621 to -2321) is in both too.
- Region budget, pinned by a test: at most 10.5k building boxes and 14 km2 of land.
- The whole box (`miami`) leaves the picker and the production bundle. `createMiamiCity(data)`
  without a region stays for tests, benches and a development build (`?map=miami`).
- Adventures: 15 of 16 already sit inside one region with a 40 m margin. `a-roads-end` spans
  West and South: its giver and first two steps are re-anchored inside South (the reward
  garage `g-roads` is there). `a-port-quay` and `a-sunchaser` have a last step 41 to 62 m from
  an edge and stay. Rule: an adventure belongs to the region that holds its giver and every
  step at least 40 m inside; it is offered only there.
- Secrets: the six keep their places and ids. Downtown holds the-gullet, lone-ride, roof-garden,
  tag-alley, drowned-box and rustlamp (all inside the core today); the Ghostwake garage
  (-2350, 420) is in Downtown and West. No secret moves.
- Courses and locked routes keep their ids. A course is listed in every region that holds all
  its points 40 m inside. `street-x-keys`, `street-x-beach` and `boat-x-river` are checked by
  the same rule and re-routed inside one region if they fail.

### 3.3 What each region must have (content floor, pinned by test)

| item | Downtown | Beach, North, West, South |
|---|---|---|
| Start place (spawn on a named street, start view, 300 m or more from any edge) | as today | new, one each |
| Piers with boats | 4 as today | 1 or more (West: on the river) |
| Helipad with a helicopter | as today | 1 |
| Airfield with planes and the jet | Gullwing | North shares Gullwing; Beach and South get a seaplane at the pier; West has none |
| Stunt ramps | 4 land, 2 dock | 2 |
| Garages, adventures | 5, 8 | 1 or more of each (already true, table above) |
| Service vehicle homes, police | as today | whatever SERVICE_SPOTS falls inside, plus 1 police home |
| Hand tuning of lots and buildings | as today | none: the generator is what ships (REVAMP 6.1 whole-box rule) |
| Tank | Ironbank Depot and the Wynwood yard | North keeps the Wynwood yard; others get the police tank at heat 5 only |

Region data lives in a new `src/world/regions.js`: id, name, crop, and the spots that differ
(spawn, startView, piers, seaplane, helipads, ramps, links). `MIAMI_SPOTS` stays the Downtown
table. Every placement function filters by region instead of throwing: today a crop build
dies in stunts.js:178, secrets.js:380, garages.js:430, adventures.js:355 and miami.js:1112.

### 3.4 Edges: how roads, bridges and causeways leave a region

- Sea. A region edge that is not the BOX edge uses the crop rule that exists and is tested:
  land ends 150 m past the crop in a straight seawall, roads end at the crop line, water
  beyond. No invisible walls on land; the seawall is the collision. Each region reads as its
  own piece of the bay city. A ring of fake scenery was considered and is cut (cost and risk).
- Road ends. Every road cut by the crop line gets a generated end: a striped barrier and a
  turning pad, so no lane runs into a wall. Bridges and causeways cut by the line end at a
  bridge head on the last land, not in mid-span.
- Travel points. `regions.js` lists links, at most five per region, on main roads that are
  in the data under these names and cross the shared edge (checked today): Downtown to Beach
  (MacArthur Causeway), to North (Biscayne Boulevard, Northwest 2nd Avenue), to West
  (Southwest 8th Street, West Flagler Street), to South (Brickell Avenue, South Miami
  Avenue); North to Beach (Julia Tuttle Causeway); North to West (Northwest 12th Avenue);
  West to South (Southwest 12th Avenue). Each is snapped to the cut road end and drawn as a
  marked pad with a sign ("To Miami Beach"). Beach and South have no shared road: the Travel
  list covers that pair.
- Prompt. Stopping on the pad shows "Drive on to Miami Beach?" with Yes and Stay. Yes saves,
  fades, reloads into the other region at the twin link, 30 m inside, facing in, in the same
  car (model, colour, health). Travel is refused with a wanted level ("Lose the police first").
- Boats and aircraft are turned back 600 m past the crop by the code that exists
  (entities/aircraft.js edgeSteer reads city.crop) with a new HUD line: "Edge of this map.
  Open the map to travel."
- The full map screen and the pause menu get a Travel list: every region, tap to go. On foot,
  in a boat or an aircraft the player arrives at that region's start place.

### 3.5 Saves (sanitiser rules)

No save key or version changes. `rustwater.save.v1`, `rustwater.explore.v1` and
`rustwater.map` stay; an older build that reads them still works.

1. Map ids: `MAP_IDS` and `SESSION_MAPS` gain the five region ids. `DEFAULT_MAP` becomes
   `miami-downtown`. An unknown stored id falls back to the default.
2. Stored choice `miami` (every 0.4.0 to 0.6.0 player): on first load it becomes the region
   that contains the saved Miami position, Downtown winning where regions overlap, Downtown
   when there is no saved position. Done once; the stored choice is rewritten.
3. Sessions stay one per map id (core/garage.js mapSessions). The old `miami` session is
   copied, not moved, into the chosen region's slot when its position is 60 m or more inside
   that crop and `placeValid` accepts it; otherwise the region starts fresh. The `miami` slot
   itself is kept untouched.
4. A session is only ever restored on the map whose id it carries, and only if its position
   is inside that map's crop; otherwise the region's start place. Wrecked craft are never
   restored (as today).
5. Explore save: untouched. Cells stay the 36 by 32 grid over the whole box, so progress made
   in one region shows on the map of every region. The percent shown stays "of all Miami".
6. Garages: found, seen and stored cars are global by garage id. A garage is built in every
   region whose crop holds it 60 m inside. Cars stored in a garage of another region are
   listed with the region name and "travel there to take it out".
7. Cars left on the road (`garages.out`, session garage of 8) carry positions: they are
   spawned only when inside the current crop and kept in the save otherwise.
8. Medals, best times, secrets found, adventure steps: by id, unchanged. An adventure being
   tracked whose region is not the current one shows "in Miami Beach" and keeps its step.
9. Travel writes the target region's session (pose at the twin link, the craft) and the map
   choice in one save call before the reload; if the reload is interrupted the player is
   simply in the new region.
10. Everything read back stays untrusted: ids from allow-lists, numbers clamped to the crop.

### 3.6 Data files, chunks and offline

- `scripts/split-map.mjs` (new, development time) writes one file per region from
  `src/world/data/miami.json`: `src/world/data/miami-<id>.json`, features with any point within
  200 m of the crop. Expected raw sizes: downtown about 0.9 MB, beach 0.45, north 0.65,
  west 0.95, south 0.65 (700 m margin measured 1.11, 0.48, 0.71, 1.03, 0.70). The files are
  generated, committed, and checked against the source by test (same features, same bytes
  per feature, union covers the box).
- `src/world/regions.js` holds one static `import()` per region file, so esbuild makes one
  chunk per region and the game fetches only the chosen one. Still no request leaves the
  origin; the service worker precaches every chunk at install so travel works offline.
- `miami.json` itself is not in the production bundle (development and tests only).
- Budgets: first play of the default region transfers at most 0.95 MB gzip (today 1.29);
  the whole offline precache at most 2.0 MB gzip (today about 1.3; the overlap between
  regions is the price of five simple files and is accepted).
- createMiamiCity keeps only data within the crop margin (the 3 km allowance at miami.js:756
  goes for region builds).

### 3.7 Tests that must pin the split

- test/regions.test.js (new): the five crops as constants; every land cell of the box is in
  a region; every region builds without throwing; a fingerprint of nodes, edges, buildings,
  lots and lot grid per region; the Downtown region equals today's core crop fingerprint
  byte for byte; the whole-box fingerprint is unchanged; region budget (building boxes, land).
- Content floor per region (3.3); spawn on a road and 300 m from every edge; every link
  snaps within 60 m of a cut road end and has a twin; arrival pose is on a road.
- Every garage, adventure, course, route, secret and ramp is in at least one region; none is
  offered in a region that does not hold it.
- test/save.test.js, garage.test.js, explore.test.js, maps.test.js: fixtures from 0.3.1,
  0.4.0, 0.5.0 and 0.6.0 load; a `miami` session at ten sample points lands in the expected
  region or at its start; the explore text is byte-identical after a region change; unknown
  ids fall back; `mapFromSearch` for every id.
- Data: split files equal the source; the build lists exactly one data chunk per region;
  scripts/smoke.mjs fails if the default start requests more than one data chunk;
  scripts/offline-test.mjs travels to a second region with the network off.
- test/collision-determinism.test.js and collision-lazy.test.js run on the Downtown region.
- test/build-budget.test.js: per-region ratio against the calibration workload; the 3 s
  whole-box tests move to the bench (no longer a gate).

## 4. Budgets (acceptance, measurable)

Reference devices: the owner's Galaxy S24 Ultra (Phone check) and a mid-range proxy: Chromium
with 4x CPU throttle, default region, Normal quality. A real mid-range phone is optional
(decision 6). "Runner" is the new scripts/perf-scenarios.mjs (T1), desktop, unthrottled.

| measure | today (whole Miami) | 0.7.0 | 0.8.0 and 1.0.0 |
|---|---|---|---|
| Page load to title with Start enabled, desktop | 4.6 s | 3.2 s | 2.0 s |
| Same, 4x throttle | 13.5 s | 9 s | 6 s |
| Same on the S24 Ultra (new Phone check field) | unknown | reported | 4 s |
| Splash shows moving progress the whole time | no | yes | yes |
| City plus tile renderer build, desktop | 1.9 s | 1.0 s | 0.8 s |
| performance.memory after a collection, at start | 265 MB | 160 MB | 120 MB |
| Renderer process resident | 577 to 667 MB | 450 MB | 350 MB |
| Growth over a 60 minute soak after the first 5 minutes | not run | under 10 % | under 10 % |
| Street view, High: draw calls, triangles | 322, 478k | no worse | 260, 380k |
| Street view, Normal (default on mid-range) | 322, 478k | no worse | 200, 250k |
| Heavy fight (6 hulls, 96 parts) draw calls | 391 | no worse | 330 |
| Shader programs at start; new ones during play | 95 to 98; 5 | no worse | 60; 0 |
| First step of play | 90 to 200 ms | 50 ms | 8 ms |
| Steps over 4 ms per minute after the first 2 s (runner: cruise, fast, heat 5, jet) | 4 to 8 | 2 | 0 |
| Worst tile slice | 4.4 to 9.2 ms | 5 ms | 3 ms |
| Street tiles built during one jet crossing | 336 | 336 | 40 |
| Live vehicles with the player downtown | 96 to 109 | 80 | 70 |
| Phone check, S24 Ultra: median, worst, frames over 33 ms | 16.6, 83, 4 | 16.7, 50, 2 | 16.7, 34, 0 after the first 2 s |
| Phone check on a mid-range phone, if one is lent | unknown | reported | median 16.7 at Normal, at most 3 over 33 ms |
| First play download, gzip | 1.29 MB | 0.95 MB | 0.95 MB |

A budget missed at a milestone blocks the publish unless the owner strikes it off in writing.

## 5. Plan

### 5.1 Milestones (each publishes a version; the owner plays each before the next starts)

| version | theme | workstreams | spend (tokens) | exit |
|---|---|---|---|---|
| 0.7.0 | Split and light | R1, R2, R3, T1, then SL, RV | 0.9M to 1.3M | 3.7 tests pass; 0.7.0 column of section 4; Phone check line from the owner |
| 0.8.0 | Smooth | H1, G1, ST1, then S1, RV | 0.7M to 1.0M | 1.0.0 column of section 4 on the runner; Phone check worst 34 ms or better |
| 0.9.0 | Polish (release candidate) | Q1, Q2, A2, W, then RV | 0.5M to 0.8M | section 2 list closed or struck off; closed test track started |
| 1.0.0 | Store | P1, S2, R4 | 0.3M to 0.5M | checklist 5.6; signed bundle accepted by the owner |

Total 2.4M to 3.6M. Patch versions (0.7.1 and so on) carry phone fixes between milestones.

### 5.2 Models

Haiku: mechanical edits (text sync, renames, version bumps). Sonnet: standard work from a
complete brief (R2, R3, T1, ST1, A2, P1). Opus: hard scoped work (R1, H1, G1, Q1, Q2) and
every review. Fable: design decisions only; this document is the Fable step and no further
Fable work is planned. Every Sonnet or Haiku result is reviewed by Opus before it lands;
every Opus result by the milestone review RV (a different Opus session); this plan by the owner.

### 5.3 Workstreams and owned files

One owner per file inside a milestone. The coordinator owns src/game.js, src/main.js,
src/pwa.js, public/sw.js, scripts/build.mjs, scripts/gate.mjs, package.json, docs/STATUS.md
and applies the wiring lines a workstream asks for. A file not listed belongs to the coordinator.

Version 0.7.0 (R1 first for one slice: regions.js shape and the filter rule; then all four
in parallel)

| id | task | model, range | owns |
|---|---|---|---|
| R1 | World regions: `regions.js`, `createMiamiCity(data, { region })`, filter instead of throw, data margin trimmed, generated road ends, links, split data files and per-region chunks, region fingerprints | Opus, 250k to 350k | src/world/miami.js, miami-spots.js, regions.js (new), maps.js, lots.js, collision.js, src/world/data/*, scripts/split-map.mjs (new), fetch-map.mjs, city-build-bench.mjs, tile-bench.mjs, test/regions.test.js (new), miami*.test.js, maps.test.js, mapdata.test.js, build-budget.test.js, collision-*.test.js, world-density.test.js |
| R2 | Region content: placement by region for garages, adventures, courses, routes, secrets, ramps, service homes; the four new start places, piers, helipads, ramps; `a-roads-end` re-anchored; travel pads and barrier props drawn | Sonnet, 180k to 250k, Opus review | src/world/garages.js, adventures.js, courses.js, secrets.js, stunts.js, src/systems/service.js (SERVICE_SPOTS only), src/render/exploremesh.js, secretsmesh.js, markers.js, props.js, test/garages.test.js, adventures.test.js, courses.test.js, secrets.test.js, stunts.test.js, service.test.js, firstview.test.js, scripts/review-shots.mjs |
| R3 | Saves, picker and travel: rules 3.5, the picker on the title and in the pause menu, Travel list on the full map, the pad prompt, the loading veil, the edge HUD line | Sonnet, 150k to 220k, Opus review | src/core/save.js, garage.js, explore.js, startplace.js, src/systems/session.js, mapui.js, garages.js, adventures.js, src/ui/menu.js, title.js, explore.js, minimap.js, hud.js, styles.js, src/index.html, scripts/menu-test.mjs, ui-test.mjs, offline-test.mjs, test/save.test.js, garage.test.js, explore.test.js, startplace.test.js |
| T1 | Measuring: scripts/perf-scenarios.mjs (start breakdown with CPU throttle, memory after collection, per-step attribution for cruise, fast, heat 5, jet, first-use probes), budgets as data in docs/PERF.md, wired into the gate; Phone check line gains start time, map id, memory and the worst system | Sonnet, 80k to 120k, Opus review | scripts/perf.mjs, perf-scenarios.mjs (new), soak.mjs, smoke.mjs, src/ui/phonecheck.js, test/phonecheck.test.js, docs/PERF.md (new) |
| SL | Security review, light: the diff, with eyes on the save migration, storage keys, URL parameters and the precache list | Opus, independent, read only, 30k to 40k | none |
| RV | Milestone review: gates, budgets, review shots of every region start, edge and travel pad | Opus, different session, 60k to 90k | none |

Version 0.8.0 (three in parallel; no shared file)

| id | task | model, range | owns |
|---|---|---|---|
| H1 | Hitches 1 and 2: a shared grid index for spots, blocks, homes and ramps (new src/core/spatial.js); at most two vehicle or person spawns a step; meshes built ahead; fleet craft made by distance, not all at start; live vehicle cap | Opus, 200k to 300k | src/systems/parked.js, peds.js, traffic.js, service.js, fleet.js, stunts.js, police.js, crew.js, src/core/spatial.js (new), their tests |
| G1 | Render and memory budget: static meshes stop recomputing matrices; materials merged to 60 programs or fewer and all warmed, effects and craft included; Normal tier at 200 calls and 250k triangles (tree and car detail by distance, fewer shadow casters); no street tiles above 60 m height or 60 m/s; slices of 3 ms; night switch spread over frames; far-level CPU copies dropped or packed; resolution starts at the last good value and changes at most once in 5 s | Opus, 250k to 350k | src/render/* except title and chase cameras, src/systems/daynight.js, test/lotmesh.test.js, miamilook.test.js, adaptres.test.js, meshmaterials.test.js, carmesh.test.js, craftmesh.test.js, combatfx.test.js, daynight.test.js |
| ST1 | Start: the build runs in stages that yield to the browser with a real progress bar; textures cheaper or cached; map raster on first open; a 3 s first-run benchmark picks Low, Normal or High | Sonnet, 100k to 150k, Opus review | src/index.html, src/ui/title.js, src/ui/minimap.js, src/systems/mapui.js, src/render/textures.js (agreed with G1: ST1 edits it last), src/main.js (lent by the coordinator) |
| S1 | Security review, full: storage, URL input, service worker, build and workflow (pin every action to a commit SHA), Android project settings | Opus, independent, read only, 50k to 70k | none |
| RV | Milestone review | Opus, 60k to 90k | none |

Version 0.9.0

| id | task | model, range | owns |
|---|---|---|---|
| Q1 | Look: the faults in section 2 (waterfront boxes and bare walls, paving scale, night speckle, contact shadow), region edges and road ends, the five start views, store-shot views | Opus, 200k to 300k | src/render/*, src/world/lots.js, miami-spots.js, regions.js |
| Q2 | First five minutes and feel: a short guided start that ends in the first adventure, the three open items of PLAN_V1 2.7 (fighter stuck on the shore, ramps without side collision, roof helipad reached on foot) fixed or struck off, handling notes from the owner | Opus, 150k to 250k | src/systems/tutorial.js, objective.js, adventures.js, stunts.js, src/entities/*, src/ui/hud.js, touch.js |
| A2 | Sound: only the Phone check numbers the owner marks bad | Sonnet, 60k to 100k, Opus review | src/audio/*, src/systems/audio.js |
| W | Phone fix reserve, one item at a time in files nobody holds | by item, 100k to 150k | by item |
| RV | Milestone review, with every review shot looked at | Opus, 60k to 90k | none |

Version 1.0.0

| id | task | model, range | owns |
|---|---|---|---|
| P1 | Store: signed Android bundle from the existing Capacitor project, checked in the WebView (start, memory, Back button, pause in background, sound after a call), store pictures and text rewritten for Miami and without "missions", content rating answers, privacy page with the contact address, map credit visible, target API re-checked | Sonnet with Haiku for text, 100k to 160k, Opus review | android/*, docs/STORE.md, PLAY.md, SPEC.md, RELEASE.md, public/privacy.html, public/manifest.webmanifest, scripts/store-shots.mjs, README.md |
| S2 | Security re-check: the diff since S1 and the built bundle | Opus, independent, 30k to 50k | none |
| R4 | Release candidate review: checklist 5.6, a 60 minute soak in each region | Opus, 80k to 120k | none |

### 5.4 Quality gates for every publish

As PLAN_V1 2.6 (lint, tests, build and release check, smoke, ui-test, perf, security review,
screenshot review, publish and record, the owner's Phone check), with these changes:

- Gate 6 becomes `node scripts/perf-scenarios.mjs --gate`: every row of section 4 that has a
  runner number, for the default region and for the heaviest region (South).
- Smoke and ui-test run on Downtown and on one other region in rotation; the soak runs on
  two regions.
- The screenshot list adds: each region's start view, one cut road end, one travel pad, the
  picker on the title and in the pause menu, the loading veil, the splash with progress.
- The test count may only fall with a written reason (it is over 600 today).

### 5.5 What is cut

- "All of Miami" as a playable choice in the shipped game (kept for tests and development).
- A scenery ring past region edges; boat and air travel points; airfields in Beach, West and
  South; new adventures, garages or secrets for the outer regions; hand tuning outside the core.
- Bloom (already off); real crumpled car geometry; blast light on walls; foam on the far sea
  (the "Not done" notes in docs/STATUS.md are struck off, not carried).
- Story missions, tuning garage, championships, AI fighters, ejection seat, a city bus,
  knockable lamps and trees: after 1.0.0, as PLAN_V1 decision 9.
- Any new feature before 1.0.0. The classic island gets no work.

### 5.6 Release candidate checklist (1.0.0)

- [ ] Every 1.0.0 budget in section 4 met on the published commit, on the runner.
- [ ] The owner's Phone check on 0.9.x: median 16.7 ms or better, worst 34 ms or better after
      the first 2 s, no sound marked bad, start in 4 s or less.
- [ ] All 3.7 tests pass; saves from 0.3.1, 0.4.0, 0.5.0, 0.6.0, 0.7.0 and 0.8.0 load.
- [ ] 60 minute soak in each of the five regions: zero errors, growth under 10 percent.
- [ ] Offline: installed page starts and travels between two regions with the network off.
- [ ] No outside request at runtime; no secret in the repository; dependencies pinned
      exactly; workflow actions pinned to commit SHAs.
- [ ] Security: zero critical, high or medium findings open.
- [ ] Section 2 list: every line closed or struck off by the owner in writing.
- [ ] Store text, pictures and docs/SPEC.md describe the game as it is; privacy page has a
      real contact address; the map licence credit shows in Settings, on the title and in
      the store text; no real venue brand in src/ or public/.
- [ ] Android: signed bundle built from the tagged commit, version and code agree, tested in
      the WebView on the owner's phone, closed test finished if the account needs one.
- [ ] Version 1.0.0 everywhere it is shown; tag v1.0.0.

## 6. Decisions for the owner (each has a default; silence means the default)

1. Split the map into five Miami regions plus the island, with "Downtown and the Bay" (the
   tested core) as the start, and remove "All of Miami" from the game? Default: yes. Reason:
   memory 265 to 161 MB and build time halved in a prototype, with no content moved.
2. Region edges are sea behind a seawall, with travel pads on the main roads and a Travel list
   on the map. Default: yes. Reason: it is the tested crop behaviour and has no invisible
   walls; a ring of fake city costs more than it shows.
3. Keep all land, as five regions, with the four outer regions on generator dressing and a
   minimum of hand content (start, pier, helipad, two ramps)? Default: yes. If 0.7.0 reaches
   80 percent of its range first, West and South ship in 0.8.0 instead; nothing is cut for good.
4. Jets only at Gullwing Airfield (Downtown and North); Beach and South get a seaplane and a
   helicopter, West a helicopter. Default: yes. Reason: a second airfield is a map design job.
5. Travel keeps your car and is refused while wanted. Default: yes.
6. Mid-range target: is an older or cheaper Android phone available for one Phone check per
   version? Default: no; the 4x throttle proxy and the S24 Ultra decide. Reason: a borrowed
   phone is the only real proof for "plays well on most phones", but the plan does not wait
   for one.
7. First run picks the graphics quality itself from a 3 second test (changeable in Settings).
   Default: yes. Reason: Normal and High are nearly the same today and too heavy for mid-range.
8. Play Store: 1.0.0 includes the signed Android bundle (this reverses PLAN_V1 decision 1,
   because "Play Store ready" is now the goal). Default: yes, and the closed test track starts
   with 0.9.0. Needed from the owner before 0.9.0: a Play developer account, whether it is a
   new personal account (then 12 testers for 14 days are required by Google), and the contact
   email for the privacy page and listing (a new address used only for this game).
9. Budget: approve 0.7.0 now (up to 1.3M) and each later version after the Phone check of the
   one before. Default: yes. Reason: both earlier stages ran over; four stops cap the damage.
10. No new features until 1.0.0, and the cut list in 5.5 stands. Default: yes.
11. Fable is used for this plan only. Default: yes.

## 7. Risks

| # | risk | mitigation |
|---|---|---|
| 1 | Everything is still judged on a software renderer; GPU cost is counted, never timed | Phone check after every version with the new fields; budgets in counts; decision 6 |
| 2 | The split is done and the phone still hitches | the hitch causes in 1.4 are separate work (0.8.0) with their own numbers; 0.7.0 is not sold as the whole cure |
| 3 | A region build drifts from the whole-box build and breaks saves or tests | one coordinate frame; Downtown pinned byte for byte to today's core fingerprint; explore save pinned byte-identical across a region change |
| 4 | Straight seawalls where the city continued look cheap | generated road ends and bridge heads; review shots of every edge type in RV; Q1 owns the look; decision 2 can be reopened after the owner sees 0.7.0 |
| 5 | Outer regions feel empty next to Downtown | content floor test; they already hold 7 garages and 8 adventures; honest names in the picker; no promise of hand tuning |
| 6 | Old players lose their place or cars | rules 3.5 with fixtures from four versions; copy, never move; stored cars listed with their region |
| 7 | Travel reload is slow or loses audio or fullscreen | start budget of section 4 applies to travel; veil shown before the reload; fullscreen re-requested on the first tap; tested in the WebView in P1 |
| 8 | Five data files drift from the source | generated by one script; equality test in the gate |
| 9 | Token overrun, as in every earlier stage | ranges per task, stop at 80 percent, whole slices, four stops, decision 3 fallback |
| 10 | Two workstreams need one file (service.js, textures.js, adventures.js) | ownership tables in 5.3; where a file changes hands the order is written there; the coordinator applies cross lines |
| 11 | Merging materials or cutting triangles changes the look the owner liked | G1 keeps High as the reference look; Normal is judged by shots side by side; shots in RV |
| 12 | WebView differs from Chrome (memory limits, audio focus, Back) | P1 tests in the WebView on the owner's phone; the closed test starts at 0.9.0, not at the end |
| 13 | Play policy: adult rating, target API, tester rule for new accounts | decision 8 asks for the account facts now; the 14 days run beside 0.9.0 |
| 14 | A stage-by-stage start (ST1) changes build order and determinism | the city build stays one pure function; only the calls between stages yield; fingerprints unchanged |

## 8. How these numbers were made

Scratch scripts, not in the repository: a start profile through the Chromium CPU profiler with
and without `Emulation.setCPUThrottlingRate` 4; `performance.memory` and
`HeapProfiler.collectGarbage`; a frame pump that times every `game.step` and every sixth
`game.draw` with each system's update wrapped (cruise, fast drive, heat held at 4 with the
helicopter and tank, a jet carried across the box, first-use probes); a node script that
builds `createMiamiCity` with a crop and reports time, heap and buffers; a copy of the source
with the placement throws of 3.3 turned into skips to measure regions in Chromium. T1 turns these
into scripts/perf-scenarios.mjs so every later number is made the same way. One trap for T1:
drawing every frame in the software renderer takes about half a second a frame, so the pump
draws every sixth frame and never more than 24 frames per call.
