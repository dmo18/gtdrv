# Rustwater: plan version 3, "a real American city you can drive"

Written 2026-11-23 against the 0.8.0 work in progress (commit 2349e0d plus uncommitted work).
Design only: no source file was changed. It replaces docs/PLAN_V2.md section 5 from 0.9.0 on
(V2's "0.9.0 Polish" and "1.0.0 Store" move behind the three versions below). The rules of
PLAN_V1 2.1 and 2.6 and PLAN_V2 5.4 (gates, one owner per file, Phone check) stay in force.

This file is in American English on purpose (owner's item 9). From 0.9.0 the whole project is.

"Measured" means a script ran today in this container: node on the pure modules, or the built
game in headless Chromium with the software renderer (flags of scripts/smoke.mjs, 915 x 412).
Nothing here was felt on a phone. The scripts were throwaway; each one becomes a permanent
test in the workstream that fixes the item (section 6).

Owner's verdict after real play on the Galaxy S24 Ultra: not fun, not addictive, nothing built
out right; 14 items. He lived in Miami Beach.

## 0. Verdict in eight lines

1. The owner is right on every item, and most have one hard cause, not a taste problem.
2. His own neighborhood is not in the game. The map data stops at longitude -80.135, a straight
   north-south cut through the middle of South Beach (about Euclid Avenue). Collins Avenue,
   Ocean Drive, the beach and the ocean are absent; Washington Avenue exists for 800 m; Lincoln
   Road for 460 m. The projection itself is correct (nothing mirrored, rotated or mis-scaled).
3. What is there is dressed by rule, not by data: every road is 11 m or 18 m wide whatever
   OpenStreetMap says, 61 percent of the Beach region's buildings are invented, 451 parking
   lots with 16,720 bays are generated where the real data has 417 lots in the whole box.
4. The world is not solid: street lamps, street signs and traffic signal poles have no collision
   at all, the sea edge and bridge edges are an invisible soft push, and the physics ground is
   one flat plane while the drawn ground has five heights.
5. The rules punish ordinary play: the "cannot die" default still wrecks the player's car in
   4 crashes at 60 mph; in Hard mode a parked car knocks a sprinting player down.
6. The cars near the camera are smooth; the thousands of parked "cars" in lots are literally
   three boxes each, and the fleet is European in shape (hatchback, one-box van, cab-over truck).
7. There is no GPS: a waypoint is a pin and a straight-line distance. No street names on the
   map, the minimap or the HUD; street signs stand at 6 percent of the junctions.
8. Order of work: 0.9.0 makes the streets real and the world solid, 0.10.0 gives it American
   cars, handling and a cockpit, 0.11.0 gives it a loop that pulls. Then polish and the store.

## 1. Diagnosis per item (measured)

### 1.1 Item 2: "not a single street was familiar or accurate"

Projection check (src/world/data/miami.json, origin 25.78, -80.18, x east, z south):

| street | game position back to lat, lon | real | verdict |
|---|---|---|---|
| Lincoln Road at Alton Road | 25.7904, -80.1412 | 25.7904, -80.1411 | correct |
| Alton Road, south to north | -80.1414 to -80.1357, 25.769 to 25.816 | same | correct, 9.7 km |
| 5th Street | 25.7743 to 25.7746 | 25.7745 | correct |
| MacArthur Causeway | x -606 to 3821, one-way pairs | same | correct |
| Venetian Way, Julia Tuttle, Biscayne, Brickell, SW 8th St | present, plausible | | correct |
| Collins Avenue, Ocean Drive, Pennsylvania Ave, Drexel Ave | ABSENT | east of -80.135 | outside the data box |
| Washington Avenue | 8 ways, 1.66 km, south of 8th St only | 3 km | cut by the box |
| Lincoln Road | 460 m, west of Alton only | mall east of Alton is `highway=pedestrian` | dropped by class and cut by the box |
| I-95, I-395 | not by name; flyovers are dropped by rule | | missing by design (flat world) |

- The data box is lat 25.745 to 25.815, lon -80.225 to -80.135. In the Beach region the land
  runs to x = 4500 at every latitude tested (Lincoln Road, 11th Street, 5th Street): the map
  ends at a straight wall where South Beach should continue 1.3 km east to the sand.
- Beach region: crop 3.1 x 7.7 km, 38 percent land (9.1 km2), 115 named streets, 94 percent
  of road length named. So names exist; the player never sees them (1.10).
- Buildings in the Beach region: 7,587, of which 2,934 are real footprints and 4,609
  (61 percent) are generator infill. A local sees invented four-story blocks on every street.
- Start place: Alton Road near 11th Street, drawn as an 18 m four-lane road (screenshot).
- Axes: x east, z south with y up is a right-handed frame; traffic keeps right
  (`lanePoint` offsets to (-dz, dx), verified); the driver sits on the left. Nothing is mirrored.
- The OSM API answers from this container (HTTP 200), so a wider box can be fetched with the
  existing scripts/fetch-map.mjs.

### 1.2 Item 3: "streets are wide and do not make sense, multiple lanes and medians"

- Width is a generator rule (src/world/miami.js line 934, citygen.js): two widths only,
  STREET_W 11 m and AVENUE_W 18 m. `avenue` = two-way and (trunk, primary, secondary or
  `lanes` >= 4). Every one-way road is 11 m with one driven lane 2.0 m right of center, the
  left half empty. The `lanes` tag (on 4,852 of 11,705 ways) is used for nothing else.
- Road length by drawn type: Downtown 8 percent 18 m, 49 percent one-way 11 m, 43 percent
  two-way 11 m; Beach 7, 42, 51.
- Divided roads: OSM maps each direction as its own one-way way. The game draws each as a full
  11 m street. Downtown 28.9 km and Beach 19.3 km of road are such pairs, median center gap
  12.1 m and 10.9 m: 22 to 23 m of pavement with a strip between, for a real road of two lanes
  each way. At the tenth percentile the gap is 3.3 to 3.9 m, so the two slabs overlap.
  These are the "medians that do not make sense".
- Sidewalk 4 m each side on everything. No parking lanes, no turn lanes, no alleys
  (6,011 `service` ways dropped, among them 80 alleys and 962 parking aisles).
- Signals and stop signs are generated; the raw data has 928 signal nodes and 2,055 stop signs.

### 1.3 Items 1 and 12: box cars in lots, cars are boxes

- Parked cars in lot bays are not cars: src/render/lotmesh.js lines 265 to 267 draw each as
  three oriented boxes (body, cabin, base). `bayCar` fills 55 percent of bays.
- Beach region: 451 lots of type `carpark`, 16,720 bays, so about 9,200 box cars; the largest
  lot has 265 bays. Lots are generated from leftover land; the raw data has 417
  `amenity=parking` areas in the whole box (all five regions).
- Real cars: near 7,068 to 8,950 triangles (under 24 m), mid 1,092 to 1,470, far 540 to 728.
  The far body starts at 36, 46 or 75 m by quality tier (46 m on Normal): one paint-colored
  shell with no glass, the "smooth blob" in dist/vehicle-shots/cars-far.png. On a straight
  street most cars in view are past 46 m.

### 1.4 Item 4: "obstacles are not real, you can drive through light poles"

Car driven at 27 mph at each object from four directions, in the running game (Downtown):

| object | source | passes straight through |
|---|---|---|
| street lamp (4,630 Downtown, 1,896 Beach) | city.props | 27 of 33 (the other 6 hit something else) |
| street name sign | city.furniture | 42 of 42 |
| traffic signal pole | city.signals | 34 of 34 |
| street tree | city.furniture | 0 of 35 |
| lot bench, gate, pallet, bin, umbrella | dressLot, `solid: false` | 19/22, 48/49, 36/40, 28/35, 55/75 |
| lot wall, fence, hedge, bollard, lamp, planter, tree, shrub, rock, cabin, stack | dressLot | 0 (also 0 at 22, 67 and 134 mph: no tunneling) |

Cause: street props get collision only inside the render module (src/render/props.js lines 651
to 672), and only for trees and palms. That also breaks the project rule that game logic must
not live in render code, and it is why no node test ever covered it.

### 1.5 Item 5: "cars go through the ground"

- The car's height is constant 0 (src/entities/vehicle.js never writes `y`; only stunts do).
- The drawn ground is not: road 0, sidewalk and block surface +0.16 (citymesh.js line 282,
  realcity.js `makeGroundY`), lots -0.035, open land -0.06 or -0.12, sand sloping to -2.2.
- So on any sidewalk, plaza or block a 0.33 m wheel is sunk 16 cm; body roll (measured 4.2
  degrees at full input, 7 cm at the sill) and brake dive add to it; on sand the car floats.
- No curb step, no ramp slope except scripted stunt ramps. Bridges are flat at water level.

### 1.6 Item 6: "walls and sea walls are not realistic and you can drive over"

- There is no sea wall object. The shore is `keepOnLand`: a soft position push when the car
  center is within 2 m of the water line. Measured: center stops 1.2 to 1.7 m inside the line,
  so the nose (2.3 m ahead) hangs 0.6 to 1.1 m over the water; screenshot shows paving that
  ends in the sea with nothing standing there.
- Bridges: Julia Tuttle Causeway, deck edge 5.5 m from center; a car driven sideways puts its
  nose at 6.87 m, 1.4 m past the edge. No rail is drawn above the deck and none collides.
- Lot walls are solid but 0.6 m tall and read as curbs; collision ignores height for cars
  (any `h` above 0 blocks), so "solid" and "looks drivable" disagree in both directions.

### 1.7 Item 7: "car blows up too easily, you die bumping into a car"

Sedan (900 health), wall impact, `impactDamage` in vehicle.js:

| speed | health lost | hits to wreck |
|---|---|---|
| 11 mph | 0 | - |
| 30 mph | 83 (9 %) | 11 |
| 45 mph | 163 (18 %) | 6 |
| 60 mph | 257 (29 %) | 4 |
| 89 mph | 479 (53 %) | 2 |

- Default mode ("cannot die"): the rule `RULES.invulnerable` is checked only in combat.js
  `damage()`. Crash damage goes through vehicle.js `damageVehicle` and ignores it. Measured:
  the player's car is wrecked after 4 hits at 60 mph in the default mode and the player sits
  in a dead car. Car against car the lighter car takes up to 1.7 times the damage.
- Fire and explosion: a car under 25 percent health that any weapon has touched burns and
  explodes 6 s later (BURN_BELOW 0.25, BURN_T 6). Crash damage counts toward the 25 percent,
  so a few crashes plus one police bullet is a fireball.
- On foot, Hard mode, measured: a car at 10 mph knocks the player down and takes 18 health,
  at 13 mph 46; the player sprinting (6 m/s) into a PARKED car is knocked down and loses 20.
  Cause: onfoot.js line 109 counts the walker's own speed as closing speed, the threshold is
  4 m/s (RAM_MIN) and a ram always knocks down. Five sprints into parked cars kill.
- First 6 seconds from the Beach start, holding GAS only: a rear-end into the signal queue
  ahead and one wanted star (observed once, screenshot).

### 1.8 Item 8: "steering, handling, turn radius are all off"

Sedan, Arcade mode, steady circle (node, `stepVehicle`):

| speed | full input: radius, lateral g, wheel angle | half input |
|---|---|---|
| 4 mph | 5.3 m, 0.08 g, 27.5 deg | 11.2 m |
| 11 mph | 5.4 m, 0.47 g, 27.5 deg | 11.4 m |
| 18 mph | 6.7 m, 0.98 g, 26.9 deg | 12.9 m |
| 25 mph | 12.6 m, 0.97 g, 15.5 deg | 24.8 m |
| 34 mph | 23.3 m, 0.98 g, 9.6 deg | 46.1 m |
| 45 mph | 41.1 m, 0.99 g | 82 m |

- Lock: 27.5 degrees (real cars 33 to 38 at the inner wheel). Curb to curb circle 41 ft for the
  sedan (real midsize 37 to 38 ft), 48 ft pickup (real, fine), 73 ft box truck.
- Every ordinary car holds 0.98 g at full input from 18 mph up (a real family sedan 0.80 to
  0.85 g), with no visible slide: it feels like rails, then like a wall.
- Between 18 and 25 mph the turn radius doubles (6.7 to 12.6 m) because the lock is cut to the
  grip limit: exactly at street-corner speed the same thumb travel gives half the turn. A
  right turn into an 11 m street needs about 8 m radius: fine at 18 mph, impossible at 25.
- Roll 4 degrees for every class; no handbrake turn tuned; 0 to 60: sedan 8.0 s, sports 3.7,
  pickup 9.4, muscle 5.2, truck 19.4 (plausible).
- The existing bands (handlingbands.js) pin these numbers, so the tests pass and the feel is
  untested: no tuning was ever chosen by the owner on the phone.

### 1.9 Items 9 and 10: British, not American

Word counts in src (code, comments and text):

| word | count | word | count |
|---|---|---|---|
| centre | 214 | colour | 107 |
| metre | 119 | grey | 111 |
| tyre | 78 | pavement | 55 |
| kerb | 48 | favourite | 34 (also a save key) |
| bonnet | 24 | car park | 16 |
| windscreen | 14 | neighbourhood | 13 |
| harbour | 14 | quay | 11 |

- Shown to the player today: "Paint colours", "Colour", "Favourite", "Tyre squeal", "civic
  centre", "car park", "neighbourhoods", a shop sign "TIN WHISTLE PUB".
- Already American: mph, feet and miles (src/core/units.js), right-hand traffic, left driver
  seat (carbody.js line 912).
- Fleet (dist/vehicle-shots/cars-side.png, looked at): a short Euro hatchback ("Bramlet"), a
  one-box Euro van ("Portaby"), a cab-over box truck ("Bulkora"), a small single-cab pickup,
  a short sedan ("Selwick") reused for taxi and police. No SUV, crossover, full-size pickup,
  minivan, school bus, semi. Plates: one text "RW-4821", front and rear (Florida is rear only).
- Road paint: zebra bars at every junction arm; no stop bars with STOP signs, no US signs.

### 1.10 Item 11: "maps are hard to follow and GPS does not work right"

- There is no route. A waypoint (tap on the full map) is a pin plus a straight-line distance
  chip. A road path finder exists (src/world/courses.js `roadPath`) and is used only to place
  courses.
- The full map shows land, roads and landmark pins from all five regions over empty space;
  no street names at any zoom (screenshot). The minimap rotates with the heading, 0 names.
- The HUD shows the neighborhood ("MIAMI BEACH"), never the street.
- Street name signs: 22 in the Beach region for 376 junctions (6 percent); 58 Downtown. The
  sign atlas holds 32 names; the Beach region has 115.

### 1.11 Item 13: "first person is horrible"

- The car has no first-person view. "Bumper" is a camera 2.2 m ahead of the car center, about
  0.6 m above the road, FOV 74, no hood, no dashboard, no wheel (chasecam.js VIEWS.car).
- Its turn-look shift moves the camera sideways; in a turn it ends up inside the car's own
  body or a neighbor's (screenshot: the frame filled by a body shell seen from inside).
- Planes and helicopters have a "Cockpit" view that is also only a camera offset.

### 1.12 Item 14: "not fun or addictive"

- The pieces of a loop exist but nothing ties them to the minute-to-minute drive: score.js has
  combo, drift, near miss, air time; stunts, courses, garages and adventures exist; missions
  are an 18-line stub. The combo is a number in the corner; nothing asks for one more try.
- The first minute teaches "Hold GAS to drive" and then, measured, ends in a crash and a star.
- Items 2 to 13 are the larger part of "not fun": an unfamiliar city, a ghost world, a car that
  dies for no reason, no way to find anything. Fixing them is the first fun work.

## 2. Decisions (firm)

### 2.1 Map truth (items 2, 3, 11) - version 0.9.0

1. Fetch a wider box: east edge -80.135 to -80.115 (the Atlantic), same origin and projection,
   so every saved position, id and placed thing stays valid. Only `BOX.x1` grows (4505 to about
   6510). The Beach region crop becomes x 1400 to 6510. If its memory misses the 0.8.0 budget,
   the region is cut at z = -2400 and the north part waits; the south part (South Pointe to
   Dade Boulevard, the owner's ground) ships first.
2. New in the data file, from tags already in the raw download: `lanes`, `lanes:forward`,
   `lanes:backward`, `oneway`, `maxspeed`, `turn:lanes`; `highway=pedestrian` and
   `service=alley` ways; `amenity=parking` areas; `natural=beach`; `man_made=pier`;
   `leisure=slipway`; `highway=traffic_signals` and `highway=stop` nodes; `barrier` lines.
   No business names are taken (real street and public place names only).
3. One pure function `roadProfile(way)` (new src/world/roadprofile.js) gives every edge its
   cross section; nothing else decides a width:
   - lanes: the tag when present; else by class: residential, living street, unclassified,
     tertiary 1 each way; secondary 2 each way; primary and trunk 2 each way (3 when the tag
     says); motorway 3 per carriageway; one-way streets 1 (residential) or 2.
   - lane width 3.3 m (11 ft) on streets, 3.6 m (12 ft) on trunk and motorway.
   - parking lane 2.4 m per side on residential and tertiary streets, none elsewhere.
   - gutter 0.3 m per side. A two-way residential street: 2 x 3.3 + 2 x 2.4 + 0.6 = 12.0 m
     curb to curb; without parking 7.2 m. A one-way downtown street of 3 lanes: 10.5 m.
   - one-way roads are centered on their line and every lane runs one way.
4. Divided roads: a pass pairs one-way ways of the same name that run opposite within 30 m.
   A pair becomes one road with two carriageways and a raised median exactly as wide as the
   data gap leaves (curbed, solid, planted where over 1.5 m). A gap under 1.0 m becomes one
   undivided road with a double yellow line. Unpaired one-ways stay one-way. Medians exist
   nowhere else.
5. `laneOffset`, `lanesPerDirection` and `lanePoint` read the profile; `edge.avenue` stays as
   a derived flag (two or more lanes each way) for old callers. Traffic, police and crew use
   the same three functions already.
6. Paint, US style: double yellow center on two-way roads, white dashed lane lines, yellow left
   edge on one-way and divided roads, a white stop bar and two-line crosswalk at signals and
   stop signs (no zebra bars), parking lane line. Signals and stop signs stand where the data
   has them; generated only where the data has none at a junction of two named streets.
7. Sidewalk 1.8 m on residential streets, 3 m downtown and on Lincoln Road, with a 0.15 m curb.
8. Lincoln Road Mall and Espanola Way: pedestrian paving, drivable in the sandbox, crowded.
9. Buildings: real footprints always; infill only on blocks with no footprint at all, and
   then by a per-neighborhood style table (South Beach: 2 to 4 floors, pastel, flat roofs;
   towers only on West Avenue, the bay front and the ocean front). Target: infill under
   30 percent of buildings in the Beach region.
10. Start place: default region becomes the Beach, default start Ocean Drive at 10th Street
    facing north with Lummus Park and the sea on the right (owner decision 1).
11. The street under the car is always on screen: HUD line "Alton Rd" with the cross street
    ahead ("at 11th St"), from a new `city.streetAt(x, z)`; street blades (white on green) at
    every signal and every junction of two named streets; the sign atlas holds every name of
    the region.

### 2.2 Solid world (items 4, 5, 6) - version 0.9.0

1. Collision leaves the render code. New pure src/world/propsolid.js holds one table,
   `PROP_SOLIDS`: every prop type the city can emit (props, furniture, signals, dressLot kinds,
   road-end barriers) maps to `{ r or box, h, mode, breakSpeed, slow }`.
   `fillPropCollision(city, collision)` adds them at city build. A type missing from the
   table fails a test, so a new prop cannot ship as a ghost.
2. Modes:
   - `solid`: tree and palm trunks (r 0.25 to 0.3), signal mast poles, bollards, walls,
     planters, rocks, cabins, stacks, boats, hedges.
   - `break`: lamp poles, street and stop signs, parking meters, benches, bins, umbrellas,
     pallets, gates, fence panels, hydrants. Under `breakSpeed` (lamp 8 m/s, sign and bin 3,
     fence 5, hydrant 6) it is solid. Over it the prop shears: the car loses `slow` of its
     speed (lamp 12 percent, sign 3), takes a small fixed damage only in Hard mode, the
     collider switches off, a pooled falling piece plays (the existing wreck part pool, at
     most 8 alive), a hydrant sprays for 6 s. The prop comes back when its tile is rebuilt
     or after 120 s out of view. Breaks score (2.8).
   - `flat`: paint, paths, towels, drives, bays: no shape.
3. The collision world gets one new primitive, a capsule segment (`addSegment`), used for all
   long thin things: sea walls, bridge rails, medians' curbs are not segments (see 5).
4. Sea wall and rails. A new build step traces the land outline (the zero line of
   `shoreDist`, simplified to 2 m) into `city.edgeLines`: closed polylines tagged `seawall`,
   `rail` (bridge and causeway deck edges), `beach` (no wall: OSM beach areas and the island
   sand), `gap` (piers, slipways, designed boat ramps, 6 m wide). Sea wall and rail segments
   go into the collision world (h 0.9 m, half thickness 0.25 m) and the same lines are drawn:
   a concrete cap wall on the shore, a Jersey barrier with a steel rail on bridges. What you
   see is what you hit, with a real impact. A car jumping higher than 0.9 m clears it
   (the collision height rule already exists) and lands in the bay: splash and rescue, as now.
   On a beach the car wades and bogs down to a stop at 0.5 m depth. `keepOnLand` stays only as
   the last net 3 m outside the wall.
5. Ground. New pure src/world/ground.js: `city.groundAt(x, z)` is the one height function for
   meshes and physics (road 0, sidewalk and median +0.15, lot 0, land 0, sand slope, stunt
   ramps). `stepVehicle` samples it under the four wheels each step: body height, pitch and
   roll follow the wheel plane, a curb is a real step (a suspension jolt, 5 percent speed loss
   above 10 mph, mountable by every vehicle), wheels are drawn on the ground with spring
   travel. Walkers and static parked cars use the same function. Bridges stay flat in 0.9.0
   (now with rails); raised decks with approach slopes come in 0.11.0 through the same function.

### 2.3 Damage and death (item 7) - version 0.9.0

1. One rule object decides all damage, for crashes too: vehicle.js `damageVehicle` callers
   pass through a `damageRule(target, amount, kind, source)` hook that combat.js sets.
2. Default mode (cannot die): crashes dent, smoke and slow the player's car (below 30 percent
   health: smoke, 15 percent less power) but never take it under 15 percent. Only fire, blasts
   and heavy weapons can wreck it, always through a visible fire stage first. The player on
   foot takes no damage and is never knocked down by a car under 15 mph.
3. Hard mode: crash damage as today below 60 mph, with no damage under 11 mph relative speed;
   the player in a car that is wrecked by a crash gets out, the car does not explode.
4. Fire before explosion, always: burning starts only from weapon, blast or fire damage under
   20 percent health (crash damage alone never lights a car); it burns 8 s with rising flames
   and a "Get out" prompt, then explodes. A doused car does not relight (already so).
5. People and cars: contact uses the car's speed only, never the walker's. Car under 5 mph:
   a nudge, nobody falls. 5 to 15 mph: the person stumbles aside, no damage, no star.
   Over 15 mph: knocked down; damage (speed in mph - 15) x 3 in Hard mode. A person can never
   damage a car. A parked car can never hurt anyone.
6. Wanted stars: no star for car contact under 11 mph relative speed or for breaking props.

### 2.4 Handling (item 8) - data in 0.9.0, model in 0.10.0

1. A spec table per class from real US vehicles replaces the invented one. Figures are
   approximate published values for the named reference class and are re-checked by the
   handling task before they become bands:

| class (reference) | wheelbase m | curb-to-curb ft | grip g | 0-60 s | 60-0 ft | roll deg at limit |
|---|---|---|---|---|---|---|
| compact sedan | 2.70 | 36 | 0.83 | 8.5 | 125 | 4.5 |
| midsize sedan | 2.83 | 38 | 0.84 | 7.5 | 125 | 4.5 |
| full-size sedan, taxi | 2.95 | 40 | 0.82 | 7.5 | 130 | 5 |
| police cruiser | 2.95 | 40 | 0.88 | 6.0 | 125 | 4 |
| crossover SUV | 2.75 | 37 | 0.80 | 8.0 | 130 | 5.5 |
| full-size SUV | 3.07 | 40 | 0.76 | 7.0 | 135 | 6 |
| full-size pickup | 3.68 | 47 | 0.74 | 7.0 | 135 | 6 |
| muscle coupe | 2.72 | 38 | 0.95 | 4.8 | 110 | 3.5 |
| sports car | 2.72 | 38 | 1.03 | 3.6 | 100 | 2.5 |
| convertible cruiser | 2.85 | 39 | 0.85 | 7.0 | 125 | 4.5 |
| minivan | 3.03 | 39 | 0.78 | 8.0 | 130 | 5.5 |
| cargo van | 3.30 | 42 | 0.72 | 9.5 | 140 | 6 |
| box truck | 4.50 | 55 | 0.62 | 16 | 170 | 5 |
| semi tractor | 3.90 | 60 | 0.55 | 20 | 200 | 4 |
| school bus | 6.40 | 72 | 0.52 | 22 | 190 | 5 |
| city bus | 7.20 | 86 | 0.52 | 24 | 190 | 5 |

2. Steering lock 33 to 36 degrees for cars (the table's circle follows from wheelbase and
   lock; the test checks the circle, not the angle).
3. Arcade (default) gets a low-speed grip boost so a street corner is takeable at the speed a
   player arrives: grip x 1.35 up to 22 mph, falling to x 1.0 at 55 mph. With it the sedan's
   full-input radius is about 4.5 m at 11 mph, 9 m at 25 mph, 17 m at 34 mph and the radius
   may not grow faster than 1.0 m per mph anywhere (today 0.84 m per mph across 18 to 25 mph,
   after a flat 5 to 7 m: the jump is the bug, the test pins the slope). Sim keeps real grip.
4. Model work (0.10.0): past the limit the front pushes wide with tire noise instead of the
   lock being cut silently; the handbrake swings the tail (a 90 degree handbrake turn at
   25 mph inside one 12 m street); roll by class from the table; steering return 0.25 s.
5. A "Handling lab" page in Settings (0.10.0): three presets (Tight, Standard, Heavy), a
   steering sensitivity slider and a 20 s test loop on a closed lot. The owner's choice on his
   phone becomes the shipped default. This is the only honest way to close item 8.

### 2.5 American pass (items 9, 10) - version 0.9.0, first task, alone on the tree

1. Rename wave before any other 0.9.0 work starts (it touches most files): spelling in code,
   comments, tests, scripts and player text to US (center, color, meter, tire, curb, sidewalk,
   hood, trunk, windshield, favorite, neighborhood, gray, armor, harbor, parking lot).
   Save keys keep reading the old spelling in the sanitizer (`favourite` to `favorite`), listed
   in an allowlist with the reason.
2. A lint test (test/us-english.test.js) fails on a British word anywhere in src, public,
   store, scripts, test and the current docs, except allowlisted lines. It also fails on
   metric units, "km/h", 24-hour clock text or a "£" in any player-visible string.
3. Units everywhere the player reads: mph, ft, mi, lb, gal, degrees F, 12-hour clock.
4. Names: vehicle labels become American-sounding invented names (no real make or model);
   shop signs lose "PUB"; "car park" is "parking lot"; adventure text re-read.
5. Florida flavor: rear plate only, an original plate (white, green characters, an orange
   blossom mark, pattern "ABC D12", 16 seeded texts), yellow school bus, white-on-green street
   blades, octagon STOP signs, yellow diamond warning signs, speed limit signs in mph, blue
   mail drop boxes, red hydrants, signals on mast arms.

### 2.6 Fleet (items 10, 12, 1) - version 0.10.0 (parked box cars go in 0.9.0)

1. Sixteen road vehicles, the classes of the table in 2.4, built on the existing loft kit
   (src/render/carbody.js): long hoods, three-box sedans with a real trunk, upright SUV and
   pickup greenhouses, crew-cab pickup with a bed, conventional (long-nose) van, box truck and
   semi, a flat-front school bus and city bus. Retired: the hatchback, the one-box van, the
   cab-over truck. Police is the full-size sedan in black and white with a push bar; the taxi
   is the same body in yellow. The four service vehicles keep their bodies and get US details.
2. Three levels, none of them a box:
   - L0, under 20 m, at most 4 cars: about 6,000 triangles, 4 draws (body, glass, lamps,
     wheels), cabin behind the glass.
   - L1, 20 to 60 m: about 1,200 triangles, 1 draw (glass, lamps and wheels as dark and
     colored vertex bands on one mesh).
   - L2, 60 to 170 m and every static parked car: about 260 triangles, a lofted shell of 8
     sections with a hood, a cabin with tumblehome, a dark glass band, wheel arcs and lamp
     dots in vertex color, a cheap unlit-plus-sun material, instanced per model (one draw per
     model in view). Hidden past 170 m.
3. Parked cars (0.9.0, with the old far body until L2 exists): `carpark` lots only where the
   data maps parking; other generated car parks become yards, plazas or grass by district. Fill
   by lot type and hour: store lot 45 percent by day, 10 at night; office 55 and 5; residential
   30 and 60; beach 50 and 5. At most 60 static parked cars in view; curbside parked cars come
   from the parking lanes of 2.1. No three-box car anywhere after 0.9.0.
4. Go or no-go before the fleet is built in full: side, front and three-quarter sheets of three
   bodies (midsize sedan, full-size SUV, pickup) at L0, L1 and L2 go to the owner. The other
   thirteen start only after his yes.

### 2.7 GPS and map (item 11) - version 0.9.0

1. New pure src/core/route.js: A* over the road graph with lane-legal one-ways, cost by road
   class; returns the polyline, its length and a turn list (slight, turn, sharp, U-turn,
   arrive; street name after the turn; distance to it). Re-route when the car is 35 m off the
   line for 2 s or has passed the turn; at most one search per 0.5 s, under 8 ms each.
2. Minimap: the route as a thick line under the car arrow; heading-up by default with a
   north-up switch in Settings; two zoom steps by speed.
3. Turn prompt, top center: arrow, distance ("500 ft", "0.3 mi"), "onto Lincoln Rd"; a chime at
   500 ft and at the turn; chevrons on the road surface at the turn itself.
4. Full map: this region only by default (other regions dimmed), street names along major
   roads from zoom 1 and all named streets from zoom 2, neighborhood labels, landmark names,
   tap a point or a landmark to route there, tap the pin to clear, zoom buttons next to pinch.
5. Objectives, adventures and travel pads set the same route, so the line always means "go here".

### 2.8 First person (item 13) - version 0.10.0

1. "Bumper" is removed. Two views replace it, cycled by the VIEW button after the chase views:
   - Hood: camera on the car's center line at the base of the windshield, driver eye height,
     FOV 80; the hood fills the lowest 10 to 20 percent of the frame.
   - Cockpit: camera at the driver's head (left seat, per-class `eye` point in the spec table),
     FOV 78, near plane 0.12 m; an interior of about 1,500 triangles (dash, gauges, a steering
     wheel that turns up to 90 degrees with the input, A-pillars, rear-view mirror frame, door
     tops); the car's own exterior is hidden except the hood and fenders.
2. Look around: drag on the right half turns the head up to 110 degrees each way and 25 up or
   down, springing back when released; no sideways camera shift in turns (turn look 0); the
   head leans 3 cm into braking and bumps.
3. Planes, helicopters and boats keep their views; their cockpit interiors are out of scope.

### 2.9 The loop (item 14) - version 0.11.0

Standing rules kept: no money, no shop, everything unlocked, scores and medals only, sandbox
violence allowed, cannot die by default with a Hard switch. Original names and content only.

1. Flow, the moment-to-moment loop. The combo that score.js already keeps becomes the center
   of the screen's top edge: a meter that fills from near misses, drifts, air time, driving
   over the limit, oncoming-lane driving, clean passes, prop breaks ("Wrecking x12"), jumps
   and takedowns, with a multiplier up to x5, banked after 4 quiet seconds, lost on a hard
   crash. Every source has a short word, a sound and a small camera kick. A banked flow over a
   personal best says so.
2. Heat. Stars rise with what the player does while in flow; escaping pays the banked flow
   times the star level. A pursuit clock and a best per star level.
3. Street events found by driving, no menu: speed traps (best mph through a gate, per
   street), drift zones (best points through a marked bend), jump boards (distance in feet),
   landmark sprints (route.js makes a timed run between two landmarks), the existing races,
   deliveries and stunt jumps. Each has bronze, silver and gold. About 40 per region, placed by
   seed on the real graph, pinned by test.
4. The board (pause menu and title): medals by region with a percent, records (top speed,
   longest jump in feet, longest drift, biggest flow, longest pursuit, most props in one flow),
   and "three closest medals" with a button that routes to each.
5. Daily three: three challenges a day from the local date used as a seed (read once at
   start, outside the simulation), one easy, one skill, one mayhem; a streak count; a weekly
   long one. No network, no account.
6. First five minutes, guided, skippable: 0:00 in a convertible on Ocean Drive, sea on the
   right; 0:10 the route line leads four blocks to a speed trap; 1:00 a drift bend and a jump
   board; 2:00 a one-star chase that teaches escaping; 3:00 the route leads to a garage: pick
   any vehicle; 4:00 the daily three appear; 5:00 the first adventure marker and free roam.
   The start view has no traffic queue within 150 m ahead.
7. Missions stay out. Adventures and garages (already built) are the long arc.

## 3. Priority (what moves the owner first)

Smallest set that changes "not fun, nothing real" to "a real American city driving game",
all in 0.9.0, in this order of value:

1. Ocean Drive, Collins, Washington and Lincoln Road exist, at their real widths, with their
   names on the HUD, the signs and the map, and the game starts there.
2. Everything you see stops you or breaks; the sea has a wall; wheels sit on the ground.
3. The car and the player stop dying for nothing.
4. A route line and a turn prompt.
5. American words; no box cars in lots.
6. Corner-speed steering fix (data only).

Then 0.10.0: American fleet with three real levels of detail, handling model and lab, hood and
cockpit views. Then 0.11.0: flow, events, daily three, the board, the guided start, raised
bridges. Then V2's polish (0.12.0) and store (1.0.0) as planned there.

Cut for good from this plan: missions, interiors for aircraft and boats, real business names,
flyovers and I-95 on stilts, a second handling rewrite, online boards.

## 4. Milestones

| version | theme | workstreams | spend (tokens) | exit |
|---|---|---|---|---|
| 0.9.0 | Real streets, solid world | U0 alone, then MAP, SOLID, LOTS, NAV in parallel, then SEC-L, RV | 1.5M to 2.1M | section 6 checks for items 1 to 7, 9, 11; budgets of section 7; owner's Phone check with the "local test" (he names five intersections, drives to each by GPS) |
| 0.10.0 | American iron | FLEET-0 (three bodies) then owner yes, then FLEET, HANDLE, VIEW in parallel, then RV | 1.2M to 1.7M | checks for items 8, 10, 12, 13; the owner's preset chosen in the Handling lab |
| 0.11.0 | Hooked | LOOP-D (design), then LOOP, START, BRIDGE in parallel, then SEC-F, RV | 0.9M to 1.3M | checks for item 14; a 20 minute session by the owner without a stuck moment |
| 0.12.0 | Polish (V2's 0.9.0) | as PLAN_V2 5.3 Q1, A2, W | as V2 | as V2 |
| 1.0.0 | Store | as PLAN_V2 5.3 P1, S2, R4 | as V2 | as V2 |

Each version publishes and the owner plays it before the next starts. Patch versions carry
phone fixes. 0.9.0 starts only after 0.8.0 is published and its tree is quiet.

## 5. Workstreams, owners and models

Models: Haiku for mechanical edits; Sonnet for standard work from a complete brief; Opus for
hard scoped work and every review; Fable for design steps only (this plan, FLEET-0's style
sheet brief and LOOP-D). Every Sonnet or Haiku result is reviewed by Opus before it lands;
every Opus result by the milestone review RV in a different session.

One owner per file inside a milestone. The coordinator owns src/game.js, src/main.js,
package.json, scripts/gate.mjs, docs/STATUS.md and applies wiring lines on request. A file not
listed belongs to the coordinator.

### 5.1 Version 0.9.0

| id | task | model, range | owns |
|---|---|---|---|
| U0 | Rename wave to US English across the tree, save-key migration, test/us-english.test.js with its allowlist, units and clock text, vehicle labels, shop signs. Runs alone; everything after obeys the lint | Haiku for the renames, Sonnet for the test and migration, Opus review, 150k to 220k | every file for one day; then test/us-english.test.js, src/core/units.js |
| MAP | Wider box and richer tags (2.1 items 1, 2), roadprofile.js, divided-road pairing, lane functions, US paint, real signals and stop signs, sidewalks and curbs, infill rule, new Beach crop and start, `city.streetAt`, every-name sign atlas and blades | Opus, 400k to 550k | scripts/fetch-map.mjs, scripts/split-map.mjs, src/world/data/*, src/world/miami.js, roadprofile.js (new), citygen.js (lane functions), regions.js, miami-spots.js, regioncontent.js, src/systems/traffic.js, src/render/citymesh.js, realcity.js, textures.js, test/mapdata, miami*, regions*, traffic tests, test/roadprofile.test.js (new) |
| SOLID | propsolid.js and `fillPropCollision`, capsule segments, edge lines with sea wall and rails drawn, ground.js and wheel following, the damage rule of 2.3, person and car contact, star rule, corner-speed data fix of 2.4 item 3 with the spec table and new bands | Opus, 400k to 550k | src/world/collision.js, propsolid.js (new), ground.js (new), edgelines.js (new), src/entities/vehicle.js, onfoot.js, handlingbands.js, src/systems/combat.js, police.js, peds.js, src/render/props.js, vehiclemesh.js, combatfx.js, test/prop-collision, ground, seawall, damage-rules tests (new) |
| LOTS | Parking lots only where mapped, fill by type and hour, the 60-in-view cap, bay cars drawn with the real far body (instanced), no oboxes, curbside spots from the parking lanes | Sonnet, Opus review, 150k to 220k | src/world/lots.js, src/render/lotmesh.js, src/systems/parked.js, test/lotmesh, world-density tests |
| NAV | route.js, minimap route line and north-up switch, turn prompt, road chevrons, full map names and zoom, tap to route, HUD street line, objectives and adventures route through it | Opus for route.js, Sonnet for the UI, Opus review, 250k to 350k | src/core/route.js (new), src/ui/minimap.js, hud.js, src/systems/mapui.js, objective.js, test/route.test.js (new), map-test script |
| SEC-L | Security review, light: the data pipeline (dev-time fetch only, no runtime request, attribution), the save migration, new storage keys, the precache list | Opus, independent, read only, 30k to 40k | none |
| RV | Milestone review: all gates, section 6 and 7, review shots of Ocean Drive, Lincoln Road, Alton at 5th, a divided road, a sea wall, a bridge rail, a lot, the map at three zooms, a turn prompt | Opus, different session, 70k to 100k | none |

Seams: MAP gives SOLID and NAV the edge shape on day one (fields `lanesF`, `lanesB`, `laneW`,
`parkL`, `parkR`, `median`, `width`, `oneway`, `name`) as a written contract before code;
SOLID gives MAP and LOTS `groundAt` and the `PROP_SOLIDS` type list; LOTS and MAP both add
prop types only through that table.

### 5.2 Version 0.10.0

| id | task | model, range | owns |
|---|---|---|---|
| FLEET-0 | Style sheet (Fable brief, 20k) and three bodies at L0, L1, L2 with the smoothness test; review sheets to the owner | Opus, 150k to 200k | src/render/carbody.js, test/carmesh.test.js, scripts/vehicle-shots.mjs |
| FLEET | The other thirteen bodies, L2 instancing by model, static parked cars on L2, plates, US service details, spawn mix by district (SUVs and pickups half the traffic) | Opus, 350k to 500k | src/render/carbody.js, servicebody.js, vehiclemesh.js, vehiclemats.js, graphics.js (car level switch), src/entities/vehicle.js (specs only: sizes, eye points), servicevehicles.js, traffic spawn table |
| HANDLE | Understeer past the limit, handbrake turn, roll by class, steering return, the Handling lab page and its closed test lot, bands for all sixteen classes | Opus, 250k to 350k | src/entities/vehicle.js (model; FLEET sends spec lines through this owner), handlingbands.js, src/ui/menu.js (lab page), test/handling-bands, steering tests |
| VIEW | Hood and cockpit views, interior mesh kit, drag look, per-class eye points, view tests | Opus, 200k to 280k | src/render/chasecam.js, carinterior.js (new), src/ui/touch.js (look drag), test/chasecam, firstview tests |
| RV | Milestone review with every body's sheet and both views in every class looked at | Opus, 70k to 100k | none |

### 5.3 Version 0.11.0

| id | task | model, range | owns |
|---|---|---|---|
| LOOP-D | Design spec: flow sources and values, event rules and medal times by formula, daily three generator, board layout, the scripted first five minutes beat by beat | Fable, 40k to 60k | docs/LOOP.md (new) |
| LOOP | Flow meter and sources, street events and their placement, records, the board, daily three and streak, save fields with sanitizer | Opus, 350k to 500k | src/systems/score.js, stunts.js, activities.js, events systems (new files), src/world/courses.js, src/ui/hud.js (meter), menu.js (board), src/core/save.js |
| START | The guided first five minutes, clear start view, skip and replay | Sonnet, Opus review, 120k to 180k | src/systems/tutorial.js, session.js, src/core/startplace.js |
| BRIDGE | Raised bridge decks and approach slopes through `groundAt`, rails follow, boats pass under | Opus, 150k to 220k | src/world/ground.js, edgelines.js, src/render/citymesh.js (decks) |
| SEC-F | Security review, full: storage growth and sanitizers (records, daily state), the date seed, URL parameters, service worker list, build | Opus, independent, read only, 50k to 70k | none |
| RV | Milestone review | Opus, 70k to 100k | none |

## 6. Acceptance checks per item (all automatic unless marked "owner")

| item | check | where |
|---|---|---|
| 1 | No `obox` car: lotmesh emits zero box cars; static parked cars in any view of the runner <= 60; `carpark` lots in the Beach region <= mapped parking areas + 10 percent | test/lotmesh.test.js, perf runner |
| 2 | Named streets present with length within 10 percent of the data: Ocean Drive, Collins Avenue, Washington Avenue, Lincoln Road, Alton Road, 5th Street, Espanola Way, Meridian Avenue; each at its real lat/lon within 15 m at three sample points; land reaches the ocean beach; infill share of Beach buildings < 30 percent; start is on Ocean Drive | test/miami-places.test.js |
| 2 | Local test: the owner names five intersections and reaches each by GPS, and says the streets are his | owner |
| 3 | For every edge: width = profile sum; lanes from the tag when tagged; no edge wider than 15 m unless tagged >= 4 lanes; medians only on paired one-ways; no two drivable surfaces overlap by more than 0.5 m outside junctions; traffic runs 10 minutes with every car on a legal lane and right of the center line | test/roadprofile.test.js, traffic.test.js |
| 4 | Every type in `PROP_SOLIDS` and every type a city emits (census): a sedan at 11, 34 and 67 mph from 4 directions never passes through; `solid` stops it, `break` stops it below and shears above the break speed with one event; a type missing from the table fails | test/prop-collision.test.js |
| 5 | At 2,000 seeded land points and along 20 routes across curbs, lots and sand: every wheel bottom within -2 cm and +3 cm of `groundAt` after 0.5 s; no frame with a wheel more than 3 cm under; a curb crossing produces a jolt event | test/ground.test.js |
| 6 | Along every `seawall` and `rail` line, a car at 11, 45 and 90 mph at 30, 60 and 90 degrees never gets its center past the line with y < 0.9; no part of the car box crosses by more than 0.2 m; `gap` and `beach` stretches let it pass; a boat launches from each pier and slipway; the drawn wall lies within 0.1 m of the collision line | test/seawall.test.js |
| 7 | Default mode: 50 crashes at 60 mph leave the player's car driveable (health >= 15 percent, not wrecked); a walker at sprint into a parked car: no fall, no damage, both modes; car at 10 mph into the player: no fall; Hard mode table of 2.3 item 5; no car explodes without 8 s of fire; crash damage alone never starts a fire; no star under 11 mph contact | test/damage-rules.test.js |
| 8 | Spec table test per class: curb-to-curb circle within 5 percent of the table, steady grip within 0.03 g (Sim) and the boost curve (Arcade), 0-60 within 8 percent, 60-0 within 8 percent, roll within 0.5 degree; radius growth <= 1.0 m per mph from 5 to 60 mph; a right turn into a 12 m street at 22 mph stays in lane (Arcade); handbrake turn test | test/handling-bands.test.js |
| 8 | The owner picks a preset in the Handling lab and says the car turns right | owner |
| 9 | Zero British words, metric units or 24-hour clock text outside the allowlist | test/us-english.test.js |
| 10 | Fleet list equals the sixteen classes; none of the retired bodies; hood length share >= 0.24 of length for sedans and pickups; driver eye z on the left; rear plate only; traffic mix by district | test/carmesh.test.js, traffic.test.js |
| 12 | Smoothness, every body at every level: on hood, roof, trunk and fender surfaces the angle between neighboring face normals <= 25 degrees except marked crease edges (creases < 12 percent of edges); the side outline has >= 24 points at L0 and >= 12 at L2 with no turn sharper than 35 degrees outside wheel arches and the underside; fill ratio (mesh volume over its bounding box) <= 0.70 at every level (a box is 1.0); roof width <= 0.82 of body width; L2 has a dark glass band on >= 4 sections | test/carmesh.test.js |
| 11 | route.js: every route is connected and legal on one-ways; Alton at 5th to Lincoln at Alton follows Alton Road for >= 90 percent and is within 5 percent of 1.8 km; an L route gives exactly one "turn right onto <name>"; leaving the route re-routes within 2.5 s; a search takes < 8 ms on the largest region; prompts read in ft under 1,000 ft and mi above; the map draws >= 30 street names at zoom 2 on Downtown | test/route.test.js, scripts/map-test.mjs |
| 13 | Every class: the cockpit eye is inside the cabin box, >= 0.15 m from any body surface; no body or neighbor triangle nearer than the near plane during a full-lock turn at 30 mph beside a parked car; hood rows fill 10 to 20 percent of the frame in Hood view; the wheel angle follows steer; look drag reaches 110 degrees and returns in 0.4 s | test/firstview.test.js |
| 14 | Flow: each source adds its value once; bank and loss rules; events: every region has >= 30 with reachable starts and medal times from the formula; daily three: same seed same set, three different kinds; save round trip; the scripted start completes headless in under 5 minutes of sim time with no crash and no star before the chase beat | test/score, events, daily, tutorial tests |
| 14 | A 20 minute session without a stuck moment, and "one more try" said at least once | owner |

## 7. Budgets (the phone stays at 60)

The base is whatever 0.8.0 publishes (its targets: Normal 200 calls and 250k triangles, High
260 and 380k; measured before it: Normal about 306 calls and 397k). No V3 version may publish
above the allowance below, measured by scripts/perf-scenarios.mjs at the new Ocean Drive start
and on Downtown. The Phone check stays: median 16.7 ms, worst 34 ms, no frame over 33 ms
after the first 2 s.

| version | allowed change to the street view (Normal) | ceiling, Normal | ceiling, High |
|---|---|---|---|
| 0.9.0 | medians, curbs, parking lines +8k tris in existing tile draws; sea wall and rails +6k, 0 new draws (tile merged); blades and signs +3k; static parked cars at most 60 x 700 = 42k but replacing about 9k of boxes and capped (was uncapped); falling props 1 instanced draw, 8 alive; chevrons 1 draw | 210 calls, 290k | 270 calls, 410k |
| 0.10.0 | cars, 40 in view: L0 4 cars x 4 draws x 6k = 16 draws, 24k; L1 8 cars x 1 draw x 1.2k = 8 draws, 9.6k; L2 28 cars, <= 8 model draws, 7.3k: total <= 32 draws and 41k (today 42 draws and 45.6k for ten cars); parked cars move to L2: 60 x 260 = 15.6k; cockpit +1 draw, +1.5k while the exterior is hidden | 205 calls, 265k | 265 calls, 390k |
| 0.11.0 | event gates and boards <= 6 draws, 4k; flow meter is DOM; raised decks +10k in tile draws | 211 calls, 269k | 271 calls, 394k |

Other limits: region data chunk for the Beach <= 0.75 MB gzip (today 0.5 MB plain file of
509 KB before gzip grows by the east strip); script memory at start <= the 0.8.0 budget
(120 MB) + 10 MB; city build <= the 0.8.0 budget + 15 percent; route search < 8 ms; ground
sampling <= 0.05 ms a step for 70 vehicles (4 lookups each on a grid); no allocation per step
in route following, ground sampling or prop breaks.

## 8. Security review points

1. SEC-L in 0.9.0: fetch-map stays a development tool (never imported by src, one request at a
   time, generic user agent, no owner detail); no runtime request added; map attribution
   shown; no business names in data; save migration and allowlist; precache list.
2. SEC-F in 0.11.0: new save fields (records, daily state, streak) sanitized and bounded; the
   date is read once in the UI layer and enters the game only as a seed; tap-to-route and the
   Handling lab clamp their inputs; no new URL parameter in the production build.
3. S2 before 1.0.0 as in PLAN_V2.

## 9. Risks

| # | risk | mitigation |
|---|---|---|
| 1 | Nothing here was felt on a phone; handling and "fun" cannot be proven by tests | owner checks in section 6; the Handling lab; one version at a time |
| 2 | The wider Beach region misses the memory or build budget | the fallback crop in 2.1 item 1; measured in MAP's first slice before anything depends on it |
| 3 | Divided-road pairing makes wrong medians at ramps and forks | pairs need the same name, opposite direction and overlap of 60 m; unpaired stays as is; the overlap test of item 3; review shots of MacArthur, 5th Street, Alton, Biscayne |
| 4 | Traffic, police and crew break on the new lane model | they already go through three lane functions; MAP owns traffic.js; the 10 minute legal-lane test |
| 5 | The rename wave collides with 0.8.0 work | it runs alone after 0.8.0 is published, in one day, behind the full gate |
| 6 | Fleet quality is judged by eye and has failed that judgment once | FLEET-0 go or no-go on three bodies; the smoothness test; the owner's yes before the other thirteen |
| 7 | 0.9.0 is large (four parallel streams) | written seam contract first; each stream ships whole slices; SOLID and MAP can publish as 0.9.0 with NAV or LOTS following as 0.9.1 if either reaches 80 percent of range |
| 8 | Ground following costs frame time or shakes the car | grid lookups only; spring on the body, not the wheels' contact; the step budget in section 7 |
| 9 | Real-place likeness | street and public place names only; invented businesses, vehicles and people; no art or names from any game |

## 10. Decisions for the owner (silence means the default)

1. Extend the map east to the ocean and start the game on Ocean Drive at 10th Street, with
   the Beach as the default region. Default: yes. (Or name another intersection.)
2. In the default mode crashes can never wreck your car; only fire and weapons can, with a
   visible fire first. Hard mode keeps full damage. Default: yes.
3. Retire the hatchback, the one-box van and the cab-over truck; sixteen American classes with
   invented American-sounding names; police cruiser and taxi on the full-size sedan. Default: yes.
4. Real street and public place names; no real business names. Default: yes.
5. Arcade handling stays the default, with the corner-speed grip boost; you choose the final
   preset in the Handling lab in 0.10.0. Default: Standard until then.
6. Lincoln Road Mall and Espanola Way are pedestrian streets you can still drive on. Default: yes.
7. Bridges get rails now and stay flat until 0.11.0, when they are raised. Default: yes.
8. Fewer parked cars: lots only where the map has them, at most 60 in view. Default: yes.
9. Daily challenges use the phone's date as a seed, with no network. Default: yes.
10. Order: streets and solid world (0.9.0) before the new fleet (0.10.0) before the loop
    (0.11.0); V2's polish and store versions move to 0.12.0 and 1.0.0. Default: yes.
11. Budget: approve 0.9.0 now (1.5M to 2.1M); each later version after the Phone check of the
    one before. Default: yes.
12. Fable is used for this plan and two short design briefs (fleet style sheet, loop spec)
    only. Default: yes.

## 11. How these numbers were made

- Map: node over src/world/data/miami.json (names, positions back to lat/lon, lane tags) and
  over `createMiamiCity` for Downtown and Beach (widths by length, one-way pairs and gaps,
  buildings by source, signs, junctions); tag counts from the cached raw tiles in
  build/osm-cache; one request to the OSM capabilities endpoint to confirm reach.
- Collision, sea edge, bridge, damage, on-foot contact: the 0.8.0 work-in-progress tree built
  unminified to a scratch folder, opened in headless Chromium, the player's car placed and
  stepped through `game.kinds.car.step` or `game.step` at 1/60 s.
- Handling: node, `createVehicle` and `stepVehicle` with no world, steady circles of 8 s.
- Cars: `vehicleStats` in node; dist/vehicle-shots/cars-side.png and cars-far.png looked at.
- Views, map, lots, sea edge, bridge: screenshots of the running game looked at.
- Not measured: anything on a phone; GPU time; the fleet's look in motion; whether the new
  rules are fun. Those are the owner checks.
