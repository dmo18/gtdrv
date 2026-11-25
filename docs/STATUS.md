## Release rule

Every publish bumps the version: `version` in package.json and android/package.json (patch number for fixes, minor number for a new batch of features), `VERSION_CODE` and `VERSION_NAME` in android/native/version.properties, and the version shows on the splash screen and in the pause menu.

# Status

Last updated: 2026-11-20. The game is playable and published. Work is at
the final review and fix stage; nothing is in progress that blocks play.

## 0.13.0 accessibility (task 16)
- Four settings on one new screen, Settings, "Access" button in the head (every Settings group already holds 6 rows, so no row
  was added anywhere; the four-group and 6-row menu-test checks are unchanged). Rows: HUD text size (Normal/Large),
  Reduce motion, High contrast HUD, Color-safe markers. All default off, applied at once, saved.
- `src/core/access.js`: allow-lists, `sanitizeAccess` (called by the save sanitizer: strict booleans, text size only
  'normal' or 'large'; anything else keeps the default; absent keys stay absent), `markerLook`, `applyAccess` (economy
  `applySettings` runs it at load and on every change). Text size sets `--rw-text-scale` (1.15) and `data-rw-text` on <html>;
  high contrast sets `data-rw-contrast` (white outlines by `outline`, nothing moves); styles.js holds the rules.
- Reduce motion: `settings.reduceMotion` was already read by flow, events, cinematic (hit-stop), combatfx, daynight and the
  service lightbar; now it is also saved by the sanitizer, and it turns the chase camera shake and FOV kick off
  (`chase.setShake(0)`; FOV kick follows it).
- Color-safe markers (render/markers.js, race gates from activities.js): blue/amber/white palette, an arrow over the next
  and finish checkpoints (bigger on finish), the far gate thinner; a change redraws shown markers at once. Not covered: event
  gates (events.js, other helper's file) and the HUD objective arrow.
- Tests: test/access.test.js; scripts/menu-test.mjs checks the screen at 915x412, 780x360, 748x360 (4 rows, 48 px, no scroll)
  and a save/apply round trip.

## 0.12.6 Beach checklist (2026-11-24)
- Task 9, Miami Beach familiarity. `node scripts/beach-checklist.mjs` builds the Beach region from the repo's OSM file (no
  network) and checks 43 streets and 12 places: name present, the streets it meets, typical lanes, one-way share, width in
  feet, share of length with a raised median, sidewalk, curb parking, equal lanes each way on two-way roads, and the order of
  numbered cross streets (5th to 41st) or named avenues along Lincoln Road, 17th Street, Alton Road, Washington Avenue and
  Ocean Drive. test/beach-checklist.test.js pins all of it (every item passes) plus the Ocean Drive, Lincoln Road, Collins,
  Washington and numbered-street facts.
- Found and fixed: Collins Avenue, Alton Road, 17th, 23rd, 41st Streets and Dade Boulevard swapped 2 + 1 and 1 + 2 (3 + 2 and
  2 + 3) lanes every block, because OSM gives the shared middle lane to one direction or the other by way (16 % of Collins,
  38 % of 17th Street, 43 % of Dade Boulevard had unequal lanes). `roadProfile(way, { turnLane: true })` (set in miami.js
  `cachedProfile` for ways on the Miami Beach island, x from 3500 m; not the Venetian Islands, Downtown or the other regions,
  to keep their pins) draws such a road as equal lanes each way plus the painted center turn lane; width is unchanged, and
  neighboring equal edges merge (Beach 3 edges fewer). The default profile keeps the tag as before.
- Also: event gates need an edge at least 5 m wide (`eventspots.js usable`): with the edges merged a Downtown rush-drop gate
  landed on a 4.2 m one-lane ramp (test "gates stand on a street" failed at width 2).
- Re-pinned (deliberate): test/regions.test.js, the Beach (nodes unchanged; edges, and with them buildings, lots and lot grid
  as pinned now) and the whole box; Downtown, North, West, South unchanged. docs/MAP.md edge contract gained one note; no
  field was added.
- Open, for the lead: test/gps-audit.test.js "miami-beach" fails by 0.01 (worst route 1.2106 against the 1.2 limit). The
  seeded pair draw follows the edge list, so the merged edges draw a different pair 163 (41st Street to Dade Boulevard by
  Alton Road, 3005 m against a 2483 m shortest way; the router prefers the trunk). Before, the worst of 200 was 1.196. Not
  changed (src/core/route.js and the test are not mine). test/service.test.js passes (a hand curb bay of the whole box
  moved when the edge set changed under the first attempt; the island-only rule keeps it).
- Checked and kept as mapped (not clearly wrong): Ocean Drive is one-way south from 5th to 15th Street in the data (the
  brief expected two-way; two-way with parking from 1st to 5th and 100 % curb parking kept); Collins Avenue is two-way with
  odd 2 and 3 lane blocks (a turn lane that comes and goes); Washington Avenue and Alton Road are mostly one-way pairs with
  1.5 to 10 m medians (the data's gaps); 5th Street west of Alton is a divided pair; Euclid and Drexel Avenues end at 16th
  Street (the OSM footway to Lincoln Road is dropped by the importer); Lincoln Road is pedestrian paving only between
  Washington and Alton (plain street elsewhere). Residential streets draw 39 ft curb to curb (two 11 ft lanes and two 8 ft
  parking lanes), the top of the plausible 26 to 44 ft; not narrowed, it would change every region's lots.
- Not changed: curb parking on Collins and Washington (the data has no parking tags; real streets park there) and the
  lane width on residential streets.

## 0.12.6 steering and sound (2026-11-24)
- Task 3, steering lock-in. Measured full lock held (Arcade, thumb driver `fullWheel`) at 15, 30, 50, 70 mph for the 22
  driveable specs at all three presets. Standard sedan: 12 / 26 / 64 / 123 ft at 1.2 / 2.2 / 2.5 / 2.6 g, no rear slip
  (sports 11 / 24 / 59 / 114 ft; pickup and SUV 32 to 33 ft at 30 mph, 152 ft at 70; van, truck, buses 36 to 40 ft at
  30 mph, 178 to 191 ft at 70). Sharp cuts the radius about 10 %, Relaxed widens it about 25 %. Every spec was already
  inside a US-car envelope, so TURN_G, tallK and the shape tables are unchanged ("no model change unless a class
  fails"). test/steering-envelope.test.js pins radius, lateral g and rear slip (spin-out) per spec and preset, the
  sedan under 120 ft at 30 mph and still 1.8 g at 70, and Sharp < Standard < Relaxed in radius.
- Presets: Settings, Controls now has a Steering feel row (Standard, Relaxed, Sharp), two taps from pause; the
  Handling lab keeps the same pick. menu-test gained one check; no rect loosened.
- Task 14, sound by numbers (offline, node; nobody has listened). No buffer clipped. Over the limits: turbo whistle
  (2 to 5 kHz band -12.6 dBFS RMS, 96 % of power there), blink beep (-15.1), jet turbine whine (-16.8), wet-road hiss
  (-17.0, centroid 4.2 kHz), bullet whiz (-18.0), can pin (-19.5), rocket launch (centroid 5.4 kHz, peak -0.9), tank
  boom (peak -0.3). Lowered or darkened: turbo to 0.3, beep 0.25, turbine 0.45, wet 0.45 with a 4.2 kHz low-pass, whiz 0.4,
  pin 0.4, rocket hiss and roar top (centroid 3.3 kHz, level 0.8), tank boom 0.9. After: worst 2 to 5 kHz band -19.9 dBFS.
  test/audio-harsh.test.js pins, for all 219 buffers, peak at most -0.9 dBFS, no sample over 0.95, the 2 to 5 kHz band
  at most -19.5 dBFS RMS, and centroid ceilings per class (engines 1.0 kHz, sirens and horns 1.5, tires 4.2,
  weapons 3.8, impacts 6.0, UI 3.5).

## City build time, second pass (2026-11-22)
- Lot collision is lazy (src/world/collision.js `attachLotCollision`, `createLotLayer`): no lot shape is made at
  build. A collision cell (32 m) gets its lot shapes the first time any query (resolveCircle, raycast, lineClear,
  heightAt) touches it: the lots whose box plus `LOT_SHAPE_REACH` (6 m; the largest reach measured is 0.5 m)
  overlaps the cell, in lot id order, each lot's shapes made once (addLotSolids, then addBayCars) and the ones
  overlapping the cell listed in that order. A cell's list is a pure function of the city, so no answer depends on
  when or in what order cells are touched; a query walks a cell's static shapes, then its lot shapes. A long ray
  fills only the cells it passes through. `boxes` and `circles` (getters) make every lot shape and list them after
  the static ones by lot id. A full sweep has exactly the 226,317 shapes of the eager fill (fillLotCollision is
  kept for tests and tools). test/collision-lazy.test.js: a cell touched first or after others, two visit orders,
  every answer against the eager fill, the reach. test/collision-determinism.test.js unchanged and passing.
- One dressing cache (lots.js `lotDressCache`, per city and dressing function, by lot id, the last 4,096 lots,
  emptied when the lot list or the garages change): the collision layer, the tiles (lotJob takes the returned list)
  and the bin search of service.js read the same arrays. A built tile also fills the collision cells under its lots
  (from the features it just dressed), so a step seldom has to; the answers are the same either way.
- dressLot: scatter tests against flat scratch arrays of the features already put and squares distances first
  (hypot only at the rounding edge); about 20 % faster, the same features.
- Garages: the candidates in flat arrays, the center tests (keep-outs, start, other garages) on squared distances
  before sorting, the survivors walked in 1 m bands of distance (only the bands reached are sorted), the ground
  tests on a scratch shape (the shape made for the winner only), the type test first and type-free failures
  remembered for the fallback pass. The same twelve sites (byte equal).
- Smaller: planInfill's rare path in its own function, the heap of roadPath in typed arrays with top-level push and
  pop, buildLots' piece flood and lot objects as top-level functions, the capsule stamp filling one run per row,
  owner boxes by fill, parking spot removal by an in-place filter. Background TurboFan compile in createMiamiCity
  about 520 to 410 ms. Every output identical (fingerprint as in the first pass, whole box and core crop, plus the
  lazy layer's shapes and every cell's list in two visit orders).
- Bench (scripts/city-build-bench.mjs, median of 5; it now times the game's start path and a full sweep for
  reference): createMiamiCity normal about the same (1255 / 1294 ms, noise), slow 3162 to 2912 ms (-8 %); after
  it, garages 275 to 106, attachExplore 236 to 90, lot collision 413 to 19 ms (normal), 625 to 295, 486 to 206,
  868 to 65 (slow). Game start path (city to service spots) normal about 2218 to 1540 ms (-31 %), slow about 5242
  to 3573 ms (-32 %). Chromium (scripts/perf.mjs): meshMs 1366 to 773-867, heap 364 to 304 MB, draw calls and
  triangles unchanged, step ms within run-to-run noise (0.77-1.00 before, 0.88-1.02 after; 28 lazy cells filled
  in the 300 measured steps). Fast 2 km drive (soak.mjs, new first leg): mean step 0.53-0.58 ms before, 0.50 after
  with the tile warm-up, worst step 33-37 before, 27-40 after (JIT and GC spikes in both), steps over 8 ms 10 before,
  7 after.
- Not met: the 2.6 s slow-runner goal for createMiamiCity itself (the 3 s test). The lazy collision, garages and
  attachExplore are outside createMiamiCity; inside it the profile is flat and moving loops out of it trades main
  thread time for compile time on a shared CPU (tried and reverted for the extras loops). Budget guard limits left
  as they are.

## City build time (2026-11-22, after the 0.5.0 CI failure)
- CI failed the 3 s whole-box build tests (wall 3984 ms, cpu 4256 ms). Profile: `node scripts/city-build-bench.mjs`
  (cold runs in fresh processes, median; `--slow` shares one CPU with a busy loop; `--child` under `node --cpu-prof`).
- Cause: createMiamiCity is too big for the optimiser, so its inline loops ran unoptimised; hot closures deoptimised
  10 to 13 times each (the rect-shaped objects' maps were deprecated during the build). Fixes, all byte-identical
  (fingerprint of nodes, edges, buildings, lots, lot grid, every land cell's shoreDist, garages, adventures, routes,
  every lot's dressing and all 226,317 lot collision shapes, whole box and core crop):
  hot loops moved to small top-level functions (free cells, land votes, footprint rasters, block flood, junction
  splits, owner stamps, landmark spot search); the signed shore field done with capped column sweeps and a row
  envelope over the near cells only, with lookup tables; a span fill for the land regions; fillPolygon without per
  row arrays or sort closures; raster and crop lookups from constants; buildLots without a Map per cell or a
  generator per lot (`firstNext` in core/rng.js); garage placement tests the cheap rules first.
- Node, median of cold runs: createMiamiCity wall 1622 to 1214 ms, cpu 2036 to 1689 ms; single-threaded node
  (compile and GC on the main thread) about 2110 to 1485 ms (-30 %); `--slow` wall 3692 to 3188 ms (-14 %).
  The 35 % goal for the slow-runner simulation is not met: background TurboFan compiles (about 450 to 550 ms CPU)
  and the lot stages are the next targets. Chromium (scripts/perf.mjs): cityMs 1511 to 1313-1366.
- Guard: test/build-budget.test.js (three cold builds in child processes, each against a fixed calibration
  workload; best ratio of the three, whole build and per stage). The 3 s tests are unchanged.

## V1 Service vehicles (2026-11-22)
- Fire truck (Brandwell), ambulance (Careline), garbage truck (Haulmark), tow truck (Hookton): specs in
  src/entities/servicevehicles.js (6.11 table), merged into `VEHICLE_SPECS` (one import and one merge line in
  vehicle.js, which also sets `siren` on the police spec) and their bands into `BANDS` (handlingbands.js), so the
  whole handling-bands suite runs on them too. Drivetrain tuned to the bands (ambulance power 195, heavy
  lockRate 2.55 so a 0.10 s button tap reaches 0.25 of lock). All five keep BOOST; all can be stolen.
- Siren: police.js `stepOwnSiren` already serves any `hasSiren` spec (police or `emergency`); the `siren` event now
  carries `kind`. Off on leaving, on a wreck (service.js) and when the player takes an on-call vehicle. Audio plays the
  siren for any `spec.siren` vehicle (also AI on call): police wail and yelp, fire truck deep wail (the wail lowered),
  ambulance hi-lo (a square tone, 960 / 770 Hz every 0.5 s); the fire truck horn is the deep air horn.
- Light bars (src/render/lightbar.js): one mesh per vehicle, shared materials per lit lamp set, phases from
  `lightbarPhase` (game time, 50 ms steps), steady half brightness under reduced motion. The police car's bar mesh
  keeps its place (vehiclemesh.js) and gets the new geometry with headlamp wig-wag. Amber beacons of the garbage and
  tow trucks follow `v.beacon` (lifting, towing, reversing, 2 s after). No point light (the city fakes all lights).
- Extras (src/systems/service.js), EXTRA button via touch.js `setExtra` (slot `extra`, input `extra`):
  cannon (hold, 20 s tank, 40 s refill, 25 % restart, 28 m, auto-aim 35 degrees at 90 degrees/s; people knocked down
  unhurt for 3 s then flee, +1 star for an officer; hulls and burning cars put out after 1.5 s, +150 "Fire out", white
  steam 4 s; cars pushed 3000 N); treat (tap under 2 m/s: revive a civilian body within 8 m in 2 s, +200 and its blood
  pool cleared; hard mode heals to full in 2 s and 5 %/s seated; normal mode with nobody to treat refills boost; 5 s
  cooldown); lift (side loader: curb bin within 4 m, 3 s cycle, +50, 300 s lock, 20 loads, yard stop +400; crusher
  takes up to 3 lying wreck parts, +20 each; driving off tips the bin over); hook (tap: car up to 2600 kg or a hull in
  the rear cone, 1 s attach, one-axle kinematic trailer, mass share 0.6 on acceleration and braking (braking no worse
  than 0.82), 26.8 m/s cap, slips over 75 degrees, 2 s stop in the tow yard or a garage +300, police car 2 stars).
- Homes: `SERVICE_SPOTS` (20: fire 4, ambulance 4, garbage 3, tow 3, police 6) checked against the built city by
  SV-P1; parked by service.js, back 300 s after being taken when 250 m away; parked.js bays near them are kept free.
  Deviations: the third garbage truck is in a Downtown lot (Bayside Bin Depot), not Wynwood, to meet "one of each
  within 600 m of the start"; the tow yard is on the Port's works land (no legal yard on the river strip); the medical
  center is in Overtown. Island: one of each on the largest parking lots.
- Traffic: seeded share (garbage 1.2 % 05:00 to 15:00, tow 1.0, ambulance 0.8, fire 0.5), at most 2, one of a kind,
  150 m apart, inside the core; one in four ambulance or fire truck spawns on call (siren, 1.3 x lane speed). The
  yield code accepted an AI siren vehicle unchanged, so on-call ships. A hooked traffic car's driver bails out.
- Small edits outside V1 files: combat.js (a doused hull or car does not flame or re-ignite), combatfx.js (no flames
  and steam when doused; blood cleared on `revived`), traffic.js, police.js, audio.js, game.js (one system line),
  scripts/perf.mjs (`RW_SERVICE=1` puts two service vehicles in the street view).
- Tests: test/service.test.js SV-H1 to SV-M1 (21 tests; SV-M1 lives here, not in carmesh.test.js).
- Shots: docs/preview/v1-*.png (`node scripts/service-shots.mjs`).

## W5 Cars (2026-11-22)
- Bodies (src/render/carbody.js): new section (tucked sill, character line, crisp shoulder, flat crowned deck), noses
  and tails that round over (`lean`), hood creases, shut lines with depth, glass with tumblehome, fender peaks over
  a lower hood on the sports cars (`valley`). Thirteen bodies, ten road outlines plus the three reward cars
  (Sunchaser speedster, Tidewinder off-road wagon, Night Heron fastback) on their own silhouettes.
- Glass is tinted and see-through with a cabin behind it (seats, dash, steering wheel, headliner); crazed when badly
  hurt, blown out when burnt. A contact shadow (dark under the sills and tires, fading out) rides in the glass draw,
  pressed onto the ground; the sun shadow is unchanged.
- Paint (src/render/vehiclemats.js): a hotter clear coat and a cheap street reflection (a skyline with windows, lit
  at night, and the road) mixed into the sky reflection; no probes. Burnt lamps go dark.
- Draw calls: 4 per car near and mid (body, glass with shadow, head and tail lamps in one mesh with crumple morph
  targets, the four wheels instanced), 5 with a light bar; far 1. Near 7,068 to 8,950 triangles, mid 1,092 to 1,470.
  Ten cars in view: 42 car draws (was 72), +45.6k triangles (was +135k). Street view (scripts/perf.mjs, day):
  346 calls 592k triangles before, 315 calls 468k after.
- Kit for service vehicles: `addCarStyle`, `buildWheel`, `wheelStyle` (carbody.js), `lampMaterial`,
  `carGlassMaterial`, `paintMaterial` (vehiclemats.js), `lightBarGeometry`, `roofMount` (vehiclemesh.js).
- Shots: docs/preview/w5-*.png (`node scripts/vehicle-shots.mjs --game g:<id>:<view>:<hour>[:hurt|burnt]`).
- Not done: real crumpled geometry (the crumple is still a shader dent at the ends); the contact shadow also sits
  under the effects blob shadow (effects.js), which could be lightened.

## W7 Sky, light and water (2026-11-22)
- Sky dome (src/systems/daynight.js): two procedural cloud layers (low deck, thin high veil) drift with the wind and
  take the sun color at dusk, go dark blue and pick up the city glow at night, gray out with overcast and rain and
  vanish in fog. Sun disc with a warm haze, moon with halo, and a horizon haze band in the fog color so far towers
  fade into it. The old puff clouds are hidden (SHOW_PUFFS). Cloud drift is slowed with the reduce-motion setting.
  All in the existing dome shader: no new draw call, no new program.
- Sea (src/render/water.js): a small scrolling shore-distance map (two 128x128 R8 textures, filled 16 rows a frame,
  swapped) gives lighter turquoise shallows and a lapping foam line along the seawall and beach; wake foam is twice
  as bright. Wave simulation is unchanged. The shore function is `createWater({ shoreDist })`, or falls back to
  `window.__rw.city.shoreDist` (game.js can pass `city.shoreDist` to drop the fallback).
- Not done: softer shadow edge (lives in graphics.js, W2b), foam on the far sea plane, night glow on low clouds is
  in the dome only (no separate mesh).
- Shots: docs/preview/w7-*.png (scripts/w7-shots.mjs).

## W6 Combat feel (2026-11-22)
Contract: docs/REVAMP.md 6.7. Details: docs/COMBAT.md.
- Destruction stays: a burnt hull lies 60 s (at most 6; a seventh makes the oldest sink away early), flames 12 s
  with firelight on the road, smokes the whole time, then sinks into the ground over 2 s. Bodies lie 30 s (at most
  12), their blood pools as long. The scorch stays 120 s (9 m across under a car).
- The blast in ten layers (src/render/blastplan.js holds the numbers): frame-0 flash, warm light on the street and
  walls for 0.35 s (pooled sprites, no real light), a three-billboard fireball 2 m to 7 m by 0.25 s cooling to dark
  red, a smoke roll seen 12 m out by 0.5 s, a 16 m pressure ring, a dust skirt colored by the ground, 24 sparks,
  the smoke column. Blast radius by craft: car 10 m, heavy car 11, heli 12, plane 12 (fighter 13), tank 14; visual
  scale 1 to 1.5. Shake 1 at the center to 0 at 60 m.
- Parts (src/render/carparts.js): 14 to 18 per car from a pool of 96, always a door, a wheel, the hood and a bumper,
  one bounce with sparks and a clatter, lying 20 s.
- Falls: every killing hit throws the body along its fall direction (shot, blast or car) and lays it along it: on
  the back from the front, on the face from behind, on the side from the side; 16 directions per cause tested.
- Kill freeze (3 frames, 4 for a vehicle; core/loop.js `hold`), a crosshair kill flash, the player's hit tick and
  kill cue, a three-layer blast sound (crack, 55 Hz thump with harmonics, tail from 60 ms; delay at most 0.5 s;
  music ducks 6 dB within 60 m), body-fall thuds where bodies land, part clatter, a crackle loop on the nearest two
  burning hulls.
- Heavy fight (6 hulls, 96 parts, a dozen dead; `node scripts/blast-shots.mjs w6-perf`): 391 draw calls, step mean
  1.5 ms on the loaded test machine.
- Shots: docs/preview/w6-*.png (`node scripts/blast-shots.mjs w6`).
- Not done: the blast light does not use the lamp light map (nightlights.js is W7's: a blast uniform there would light
  walls properly); the car body parts are W6's own shapes, not carbody.js meshes.

## Features now in the game
- Driving: city with traffic and pedestrians, nine road vehicles, tank.
  Arcade handling (tight steering, the default) and Realistic handling.
- Boats (speedboat, jet ski, fishing boat), planes (prop, seaplane, jet,
  fighter), helicopters (including a flyable police helicopter).
- Tank (the Rustback, stealable at Ironbank Depot) and the Gannetfang
  fighter jet with nose gun, missiles and bombs.
- On-foot combat: six weapons plus grenades (Fizzpop Can) and sticky
  bombs, touch aiming, hold-to-aim throws, bombs dropped from planes,
  missiles from armed craft. People die in one hit and bleed; wrecks break apart and vanish.
- Rival crew and police shootouts; police heat 1 to 4 with officers on
  foot, pursuit cars, roadblocks and a police helicopter.
- Score and high scores only. No money or shop: every vehicle and weapon
  is available from the start, except one reward car (Ghostwake, below).
- Six hidden secrets and the Ghostwake, a secret car at the end of the chain
  (replaces the old submarine easter egg).
- Races, sky ring courses and timed deliveries with medals.
- Day and night, weather, quality scaling, generated sound.
- Calmer UI: a Minimal HUD (default) or Full HUD, one expanding "more"
  button, idle-shrinking controls, small minimap, full map with waypoint.
- Camera views per craft: chase, far chase, bumper or cockpit.
- BOOST (hold): one button above MORE for cars (turbo), boats (planing
  surge), the Gannetfang (afterburner) and other planes and helicopters (short
  thrust or speed surge); not on the tank or on foot. One meter: about 6 s of
  boost, about 12 s to refill, and a 20 percent restart level after it runs
  dry (`src/entities/boost.js`). Cars get 1.6 times engine force and up to 25
  percent more top speed; grip, steering and brakes are untouched (tests in
  `test/handling-bands.test.js` and `test/boost.test.js`). Flame at the tailpipes
  (cars, boats), wider field of view and speed lines (off with Reduce motion),
  a thin meter bar under the speed readout, a `boost` game event and a whoosh
  and blow-off. Keyboard: N or Shift. Traffic, police and AI jets do not boost.
- Saves score, medals, best times and settings in the browser.
- Hard mode (Settings, "Hard: you can die", off by default): the player can
  be killed and respawns after the fade; a health meter under the minimap
  shows walker hp, or the craft's health while aboard. A RESPAWN button in
  the "more" fan (any mode, hard mode on or off) sets the player on foot at
  a safe spot, full health, heat cleared; the craft stays where it was.

## Decisions and direction changes, in order
1. Name: Rustwater, an original island harbor city. 3D, flat ground,
   physics in 2D (x, z). three.js 0.187.0, esbuild 0.28.2, eslint 10.15.0.
2. Preview on a public GitHub Pages site (user's choice). No separate main
   branch: the working branch is the default branch and publishes directly.
3. Direction change 1 (user): fun driving, boating and flying; combat
   and crime missions dropped; police chases a light optional extra.
4. Direction change 2 (owner, after the first phone play test): steering
   radius too wide (fixed: Arcade and Realistic handling), VIEW button did
   nothing (fixed: camera views per craft), wants violence and fun, "more
   GTA and Gran Turismo combined". Answers: full sandbox violence without
   blood or gore; combat and weapons first, then story missions; tuning
   garage and championships parked. This replaced direction change 1.
   (Later reversed by the owner, see the entry for 2026-11-20: blood is
   now allowed.)
5. Design principle (owner): "It's about more fun, not more points." No
   money, shop or unlocks; high scores only.
6. Models: Fable is no longer used (owner request). Opus takes the hard
   work, Sonnet the rest.
7. Direction change 3 (owner): bombs, grenades, police shootouts and
   chases, fighter jets, flyable police helicopters, stealable tanks.
8. Calmer UI pass: one expanding more button, Minimal HUD setting.

## Run cap history
- Original cap: 27 tasks and 3.5M delegated tokens. Reached at 3.51M
  after the quality overhaul; work paused for the owner's decision.
- The owner raised the cap for the combat stage: new stage cap 2.8M
  ("toys first"). Actual spend for the stage was about 3.2M, over the
  stage cap.
- The owner then approved a review only (no new features). This review
  and its fixes are the last work in this run.

## NOT built
- Escalating chases: police helicopters in chases, roadblocks at heat 5,
  tanks sent after the player (heat stops at 4; the police helicopter is
  there, but not the heat-5 escalation).
- Story missions engine and the missions (design in docs/MISSIONS.md).
- Tuning garage and car upgrades.
- Championships with AI rivals.
- Parked ideas: AI fighters, ejection seat, knockable lamps and trees.

## 2026-11-20: blood, lethal combat, breaking wrecks
- Owner change: blood is allowed (dismemberment and sexual content still
  out). Any bullet, blast or ram kills a non-player person outright; they
  fall, lie a few seconds, fade, never get up. Wrench kills on the 2nd
  hit. The player still cannot die and has unlimited ammo.
- combatfx: red hit burst, bigger death burst, ground pool that grows and
  fades in about 20 s (ring buffers: 16 pools, 24 spatters), blast
  deaths bleed more. Wrecks throw 6 to 10 pooled debris chunks (48 max),
  then the hull is removed 3 s after the blast (player ejected first).
- Also fixed: a chain blast queued while another was detonating lost its
  craft (wreck was never marked), now handled.
- Tests changed on purpose: combat.test.js (pistol, state machine, blast
  radius), crew.test.js (low-hp flee, 6 v 1 shot count), tank.test.js
  (ram kills), police-combat.test.js (heat points), combatfx.test.js.

## 2026-11-20: killable cops, cinematic blasts, missiles that hit
- Why cops could not be killed: nearly all police were inside patrol cars,
  and officers in cars were not actors at all (only officers who stepped out
  on foot were). Now every police car (patrol, chase, roadblock) and police
  heli carries `occ` seats; a bullet into the cabin hurts the driver first,
  blasts hurt everyone, a wreck kills everyone. Dead officers fall out as
  body actors (blood, score, heat as for any person). A car with no one left
  stops (`role: 'dead'`) and the chase calls a new one. See COMBAT.md.
- Blasts: layered fireball with color over life, shock ring, sparks and
  embers, a 6 to 10 s smoke column, fading scorch, distance-scaled shake
  (off with Reduce motion), cars thrown and flipped, people tumbling, bins
  and benches scatter chunks, tanks and jets explode bigger.
- Missiles: an unlocked missile now homes on what the nose points at (18
  deg), proximity fuse 3.5 m, parked police craft are not lock targets,
  longer smoke trail. `scripts/combat-e2e.mjs` checks cops, missiles (parked
  car, moving car, tank, police heli) and a bomb on a car with people.
- Tests added: police-kill, blast, combatfx (shake, Reduce motion); seeker
  test changed on purpose (parked police craft is tier 4).
- Not done: police tank (heat 5) is not spawned by police.js, so there is no
  tank crew to kill; static street furniture meshes stay put (only chunks fly).

## Carjacking and persistent session
- Carjacking (core/carjack.js rules and timeline, systems/carjack.js): ENTER
  on a craft with someone at the controls (speed under 3 m/s, on the
  ground) runs: player runs to the door (3 s at most), door opens, the
  driver is dragged out and thrown (0.5 s), the player is in at 0.7 s. The
  driver is a real combat actor (game.actors): lies down 1.6 s, gets up,
  runs from the thief for up to 14 s, then fades; can be shot or run over.
  Events: 'carjack' { car, victim, thief }, 'down' (source null, kind
  'carjack'), 'carDoor'. Heat: civilian 0.3 to 0.6 only if a cop or civilian
  saw it, police car 1.5, crew car 0.3 if a cop saw it. Crew cars: the crew
  system already pulls its members out and has them fight once the player
  is in; the jack only adds the door and delay. Empty parked cars keep the
  instant entry. Debug hook: game.debug.spawnOccupied(spec, x, z, heading, team).
- Saved session (core/garage.js, systems/session.js, save version 3, v1 and
  v2 saves still load): last position and heading, mode, the craft (spec
  id, paint color, health fraction, altitude and speed for aircraft) and a
  garage of the 8 most recently used cars (spec, color, health, pose).
  Autosave: enter, exit, every 10 s of simulated time, visibilitychange
  hidden, pagehide, beforeunload. createGame calls game.restoreSession()
  so Play continues; "New game" in Settings calls game.newSession() (scores
  and settings stay). Bad spots fall back to the nearest road node, pier,
  airfield stand or rescue spot. Wrecked craft are never saved. Garage cars
  are parked where they were left (systems/parked.js).
- Tests: test/carjack.test.js, test/garage.test.js, test/save.test.js
  (version number 3). E2E in scripts/smoke-extra.mjs; screenshots by
  scripts/carjack-shots.mjs into docs/preview/.

## 2026-11-20: wanted stars, slow motion, blast camera
- Wanted meter: 0 to 5 stars in the top-right HUD block (under the score,
  clear of speed, minimap and touch buttons), red and blue flash from 3
  stars, a green escape bar fills while out of sight. Stars = heat level,
  fifth star once the police helicopter is up. `wantedStars` in police.js.
- Heat levels now differ (`LEVEL_RULES` in police.js): more cars, quicker
  spawn attempts, cars arrive faster and drive up to 16 percent quicker;
  at heat 4 a roadblock and a police helicopter (existing
  `spawnPoliceHeli`, called off when heat drops, replaced 30 s after a loss).
- Slow motion (`src/systems/cinematic.js`): last nearby enemy down, a
  blasted vehicle or a police takedown gives 0.8 s of real time at 35
  percent speed via `game.timeScale` (scales real time into the loop's
  accumulator; every step is still 1/60), a vignette overlay and a 4 percent
  zoom. At most one per 6 s; off with Reduce motion.
- Blast camera: a vehicle exploding within 40 m swings the chase camera
  back and aside for 1.5 s (`chase.fx`), canceled at once by a camera drag.
- Tests: `test/cinematic.test.js`. Screenshots: `scripts/wanted-shots.mjs`.

## 2026-11-20: hidden secrets and the Ghostwake
- The submarine easter egg is gone (double-tap on the version number,
  `game.easterEgg`, the boat spec, mesh, test and screenshot script).
- Six hidden secrets, placed from the city layout by `findSecrets`
  (`src/world/secrets.js`, seed 4417): The Drowned Box (a half-sunk
  container just off the Saltyard shore), Roof Garden (a lounge on a
  midtown roof, counts only from about 3.5 m below the roof or higher, so a
  jump, a helicopter or a stunt ramp), The Gullet (a sea cave in the cliff
  on Pale Shore), Rustlamp Rock (a rusted lighthouse on the far headland),
  Tag Alley (a Saltyard alley with a graffiti tag) and The Lone Ride (a
  playground in a Greenmere park with a spinning one-off ride).
- Reaching within 12 m the first time toasts "Secret found", banks 750
  points and saves it (`progress.secrets.found`, allow-listed ids; old
  saves load with none). Records shows "Secrets found n / 6" and the names
  of the ones found. After the first find the full map and minimap show one
  faint dot, off by about 55 m, for the next secret still hidden.
- The sixth gives 2500 more points, toasts "Ghostwake unlocked" and puts a
  teal dot on the map for a lock-up garage in Cinder Row. Its roller door
  opens within 15 m. Ghostwake: teal and black coupe with an underbody
  glow, top speed 68.2 m/s (about 10 percent over the Vexari R). It is
  parked in the garage; if it is wrecked or removed it returns when the
  player is 160 m away. It is saved like any parked car.
- Files: `src/world/secrets.js`, `src/systems/secrets.js`,
  `src/render/secretsmesh.js`, spec in `src/entities/vehicle.js`.
  Tests: `test/secrets.test.js`. Screenshots: `scripts/secrets-shots.mjs`
  (`docs/preview/secrets-*.png`).
- Ramming people never damaged any car in this game, so "no collision
  damage from pedestrians" holds for every car; the spec flag
  `pedSafe: true` documents it for Ghostwake.

## 2026-11-20: smoothness and look pass
- Adaptive resolution (src/render/adaptres.js, pure, test/adaptres.test.js):
  the loop's real frame time moves the pixel ratio between 0.6 and a cap
  of 2.0 (High), 1.6 (Normal) or 1.2 (Low) physical pixels per CSS pixel.
  Steps down 0.1 (0.2 when far over) at once, probes up 0.05 after calm;
  a failed probe doubles the wait (up to 60 s). Nothing shown in the HUD.
  Before, Normal on the S24 Ultra drew at the full 3.5 device ratio.
- MSAA only when the device ratio is 1.5 or less (decided at start).
- No compile hitches: every material is compiled (compileAsync) behind
  the title screen; the sun keeps castShadow on through sunrise and sunset
  (switching it recompiled every lit material) and just skips the shadow
  map; car models not built yet are lofted one per idle slot.
- Look: color grade in the tone curve (ACES, a little saturation, cool
  shadows, warm highlights, exposure 1.1), facade AO-lite (darker at the
  ground, lift toward the top), damp night streets with lamp reflection
  streaks (one draw call), a sun band along the horizon at dusk.
- Screens: docs/preview/graphics-before-*.png and graphics-after-*.png.
  Perf numbers: scripts/perf.mjs (now also night view, shader programs,
  worst per-system call).

## 2026-11-20: car radio
- RADIO in the "more" fan (car and boat) and "Car radio" in Settings: Off,
  Lagoon Drive (chill synth), Pulse Harbor (dance pop 118 to 124 BPM),
  Lamplight Keys (slow jazz-like) and Gullspeak (talk). Saved as
  `settings.station` (allow-list, old saves load as off).
- Gullspeak is a generated talk texture (vowel blips, jingles, ads) with
  on-screen captions of 40 original DJ lines. It is not real speech.
- Crossfade 0.6 s on per-station buses; the background score returns on
  foot. Music ducks under sirens as well as explosions.
- Files: src/core/radio.js, src/audio/radio.js, radiosounds.js,
  radioplayer.js, src/systems/radio.js; test/radio.test.js; details in
  docs/AUDIO.md. Screenshot: docs/preview/radio-talk-caption.png.

## Known issues
- Closed in 0.12.6: a fighter that left the depot at part thrust could
  not turn onto the runway and ran into the shore (see 0.12.6 below).
- Draw calls reach about 417 in a street view and 544 in a heavy fight,
  against a budget of about 420.
- No test on the real phone (Galaxy S24 Ultra) since the overhaul.
- Sound has been measured, never heard by a person. Audio pass after the
  owner called it garbage on a phone: phone-speaker harmonics, gun cracks,
  layered explosions, longer engine loops with rasp, turbo and limiter,
  generated music; numbers and honest gaps in docs/AUDIO.md.
- Fixed in the final review: player stuck after a craft was wrecked on a
  roof or at sea; flaky end-to-end, UI and audio test scripts.

## Open security findings
None critical or high.
- Low (open): GitHub Actions in the publish workflow are pinned to
  version tags, not commit ids.
- Low (open): the page style policy allows inline styles (needed by the
  UI code).
- Earlier reviews: milestone 1 and 2 findings (player stuck at sea, pause
  with the map open, abandoned craft piling up) are fixed; the 212-minute
  soak test had 0 errors.

## Weather that changes the drive
- `src/core/weather.js` (pure, tested in `test/weather.test.js`): wet-road
  grip, understeer, brake and top-speed factors from the blended
  `game.weather.rain` (exactly 1 when clear, so dry numbers are unchanged),
  a small wind push for light craft, and a fog sight scale.
- Cars read `world.weather` (set each step in game.js); boats get the wind
  push too. Police sight range shrinks in thick fog. Traffic has no sight
  check, so it is unchanged. Wet-road lamp reflections already existed in
  daynight.js; rain spray in effects.js is a bit stronger and adds droplets
  in heavy rain. Aircraft are not pushed by wind yet.

## 2026-11-20: ragdoll tumbles and stunt jumps
- Ragdolls (`src/core/ragdoll.js`, pure, `test/ragdoll.test.js`): a person
  killed by a blast or hit by a car tumbles: one rigid body under gravity
  with a ground clamp, a bounce, and ten loose limb springs that lag the
  spin; it topples flat and settles about 0.8 s after touching down, then
  the pose is baked onto the actor and the slot freed. At most 12 tumble
  at once (the rest use the old fall pose). Own seeded stream, so fights
  stay deterministic. A car at speed throws the person up over the hood
  (up speed 1.2 + 0.32 per m/s of car speed, cap 8). Drawn by the existing
  person mesh through `src/render/ragdoll.js`, hooked in `layDown`.
- Stunt jumps (`src/world/stunts.js`, `src/core/stunt.js`,
  `src/systems/stunts.js`, `test/stunts.test.js`): four tabletop ramps on
  quiet streets (Fernside, Pale Shore, Cinder Row) and two at the airfield
  dock (Dock Kicker on the pier, Dock Splash in the water for boats),
  placed from the seeded city. Violet ramp icon on the map and minimap and
  a violet start pillar beside each ramp. Brake in the air for a backflip,
  steer for a barrel roll. Points from air time, distance, height, flips
  and rolls; medals at 450 / 900 / 1500 points, saved per ramp in
  `progress.medals` and best points in `score.courses`. Wrecked, crashed
  into a wall, sideways or roof landings score nothing. Ramp jumps no
  longer also count as generic airtime.
- Screenshots: docs/preview/ragdoll-hood.png, docs/preview/stunt-jump.png
  (`node scripts/stunt-shots.mjs`).
- Not done: bikes do not exist in the game, so only cars and boats jump;
  traffic cars also fly off the street ramps (no score for them); ramps
  have no collision from the side, a car driving into one side-on passes
  through it.

## 2026-11-20: weapon wheel on SWAP
- Hold SWAP about 250 ms to open a ring of the seven weapons at the button;
  drag to a slice, lift to choose (name shown in the middle and toasted).
  Dead zone 24 px keeps the weapon, dragging past 128 px and lifting
  cancels. A tap under 250 ms cycles as before (now on finger lift). Opening
  the wheel cancels an aimed throw. Closed by blur, hidden, mode change and
  pause (`releaseAll`). `src/ui/wheel.js` (pure maths, placement clear of
  FIRE and pause), `touch.js` (`pointer` hook in `registerAction`,
  `setWeaponPicker`), `combat.pickWeapon`, `combathud.js`, styles,
  `test/wheel.test.js`. Docs in docs/UI.md.
- Screenshots: docs/preview/weapon-wheel-*.png (`node scripts/wheel-shots.mjs`).

## 2026-11-20: Miami map, milestone 1 (core crop)
- `?map=miami` plays a core crop of real Miami (OpenStreetMap, ODbL):
  Downtown, Brickell, Overtown, Edgewater, Wynwood south, Watson, Star,
  Palm and Hibiscus Islands, west PortMiami, plus the invented Gullwing
  Airfield islet on a causeway from NE 26th Street. Real streets,
  buildings with heights, water, coastline, parks; traffic, police, peds,
  parked cars, boats and aircraft work. The procedural island stays the
  default. Races, secrets and stunt ramps are off on Miami (milestone 2).
- New: `src/world/miami.js`, `src/world/miami-spots.js`,
  `src/world/maps.js`, `test/miami.test.js`, `scripts/miami-shots.mjs`.
  The map data loads as a separate chunk (esbuild code splitting), so the
  default `game.js` did not grow. Saved positions are clamped at 6 km
  (was 3 km). Details and deviations: docs/MAP.md, "Milestone 1: done".

## 2026-11-20: night lighting rework
- Lit windows (`src/render/nightlights.js`, `textures.js`): the facade
  shaders decide per window, from a seeded hash of building, floor and
  window, whether the room is lit and which of eight rooms shows (warm
  room, warm or cool blinds, cool office, curtains, ceiling lamp, dim
  hall, flickering TV blue), drawn from one shared 256x128 atlas. Offices
  light whole floors, homes window by window. Unlit glass goes dark at
  night. The four 512 px lit-window pictures became 128 px glass masks.
  `buildings.js` adds whole-number UV offsets (no change by day) that
  carry the building and wall number.
- Street lamps: every lamp and floodlight baked once into a 1024 px top
  down light map; ground, curb, sidewalk, pier and shopfront shaders add
  it as light on their own color (warm pools that take the asphalt or
  paving color, walls catch it near the ground). The old additive pool
  decal is off when the map is in use.
- Car lamps: the player's and the 5 nearest cars light the ground in the
  same shaders: a widening headlight cone and a red tail glow (brighter
  when braking). Red tail glow sprites added. Boats and aircraft keep the
  pool decals. Signs glow brighter at night, shop windows warmer, softer.
- Sky: deeper blue night keys, a warm city glow low on the horizon, fog
  that matches it; less flat night fill (hemi 0.6 -> 0.36, moon 1.5 ->
  1.3), night sidewalk a little darker. Day unchanged (same screenshots).
- Draw calls (perf.mjs, street view): day 253 -> 253, night 264 -> 264;
  triangles night 451k -> 449k. Programs 84 -> 89, no new program at
  night after warm-up.
- Screenshots: docs/preview/night-before-*.png and night-after-*.png
  (`node scripts/night-shots.mjs <prefix> [views]`).

## 2026-11-20: Miami map, milestone 2 (places and activities)
- On `?map=miami`: all 14 activities (same ids as the island, Miami
  names and routes: Downtown Loop, Calle Ocho Loop, Bay Bridges Rally,
  Causeway Dash, Palm Island Sprint, Venetian Slalom, Fisherman's Channel
  Round, First Feathers, Biscayne Threader, Rooftop Hopper and four
  deliveries), the six secrets and the Ghostwake garage, four street stunt
  ramps plus the two dock ramps, the roof pad, the Cinder tank and three
  port cranes, all from `src/world/miami-spots.js`.
- HUD shows real neighborhood, bridge and water names (`city.placeOf`,
  names taken from the map data); the HUD sends the district key with
  the name, so the economy's `seen_` flags keep working.
- Tutorial and menu place texts are Miami's on that map; Settings shows
  "Map data (c) OpenStreetMap contributors, ODbL".
- Tests: `test/miami-places.test.js` (courses, secrets, stunts, places,
  HUD names and district flags on Miami). Smoke: a land race, a boat
  course, a sky course and a stunt ramp on Miami. Details and
  deviations: docs/MAP.md, "Milestone 2: done".

## Volume controls
- Settings now has Master, Music, Sound effects and Ambience sliders (each
  with a percent), Mute all, and the Music on/off switch. Effective level
  is master times category (src/audio/levels.js); master 0 or Mute all is
  silent, music included. Routing audited: nothing bypassed the master;
  the world bus no longer follows the effects slider. Tests:
  `test/levels.test.js`, `scripts/volume-test.mjs` (real gains),
  `scripts/menu-test.mjs`. Preview: docs/preview/settings-audio.png.

## People: realistic clothed figures
- `src/render/personbody.js` (new) builds the person body: sculpted
  lofted torso (shoulders, chest, waist, hips wider than the waist),
  deltoids, tapered arms, closed fists with thumbs, thighs thicker than
  calves, trousers with volume and hems, shaped shoes with soles, a neck,
  a head with jaw, eyes (white and iris), brows, nose, mouth and ears,
  hair shells (short, long, bun, cap, beanie) and clothes in volume
  (tee sleeves, collars, open jackets with lapels, hoodie hood and
  pocket, police vest, badge, radio, holster, peaked cap). Smooth normals
  from the surface grid, a little baked shading per vertex.
- `src/render/personmesh.js`: same API and poses; the person now holds
  a THREE.LOD with a near body (about 2.2k to 2.5k triangles) and a far
  body past `PERSON_LOD_M` (40 m, about 600 to 720 triangles), both
  skinned to one skeleton: one draw call per person (plus a held gun).
  Before: about 1.85k triangles at every distance.
- Tests (`test/carmesh.test.js`): the "one skinned mesh" test now
  expects the two LOD bodies on one skeleton (and checks normals); new
  tests for the triangle budget (near 1.5k..2.5k, far coarse) and for
  one visible body per person near and far.
- Screenshots: docs/preview/people-*.png (close day and night, street
  day and night, police, crowd, poses, face, pair), made with
  `node scripts/vehicle-shots.mjs people-close-day ... --size=915x412`.

## 2026-11-22: Miami map, milestone 3 (whole box, default map)
- Miami is now the default map and covers the whole data box (about
  9.0 by 7.8 km: Downtown to Allapattah, Little Havana, The Roads,
  Midtown, the bay islands, Miami Beach bay side, Fisher Island, Virginia
  Key). `?map=island` opens the procedural island.
- New renderer for the real map (`src/render/realcity.js`): far boxes for
  the whole map (one draw call per 1.2 km block, lit windows at night),
  full detail streamed in 300 m tiles round the camera, small stuff
  hidden past 170 m. Spawn street view: 221 draw calls and 311k
  triangles by day (was 312 and 436k on the old core crop).
- Traffic and police neighbor scans use the edge grid; street name
  signs with real names at the major junctions.
- Saves: sessions carry their map; an island save stays on the island
  and a Miami save on Miami (`progress.mapSessions`).
- Details, numbers and deviations: docs/MAP.md, "Milestone 3: done".
  Screenshots: docs/preview/miami-m3-*.png.

## 2026-11-22: Police helicopter fixes (owner report: "messes with everything", horrible lights, cannot see it or interact)
- Causes found (scripts/heli-perf.mjs and a Miami flight run in node):
  - The AI flew into towers: its roof look-ahead sampled 3 points 20+ m
    apart along the wanted path only, so a narrow tower or the way it was
    actually drifting was missed. Over Miami, 4 of 8 three-minute hunts
    ended in a crash (one at 129 m up, 12.7 m/s into a wall, in under
    6 s of game time); the burning wreck then fell into the street.
  - Aircraft were turned back 2.6 km from the origin (the island's size):
    on the 9 by 8 km Miami map a heli sent after a player in the outer
    districts flew in circles 1.6 to 2 km away for minutes. Planes too.
  - It hovered nearly overhead: 35..50 m above the highest roof within
    40 m at 55..70 m out gave a mean elevation of 41..74 deg (50 deg in
    the browser hunt, 168 of 600 steps steeper than 60 deg). It was on
    screen in 0 of 60 sampled frames of a chase.
  - The beam: an additive, double-sided, capped cone of flat color,
    13% as wide as long, aimed at the player, so the chase camera sat
    inside it and the whole screen was washed every frame, plus a white
    disc on the ground. Night frame with the heli on screen: +23%
    (1795 to 2207 ms in software GL), now +8.5% (1043 to 1132 ms). Draw
    calls +2 by day, +5 at night; no extra lights.
  - It wailed: an AI heli's siren counted as the nearest siren, so the
    siren loop played from the sky and ducked the music for the whole hunt.
  - Navy livery: a dark shape on a dark city and night sky.
  - Pistol and SMG range (45 / 35 m) could never reach it; killing the
    pilot did nothing.
  - Traffic was not affected (same stopped count, 95, and 0 impacts over
    600 steps with and without the heli; traffic ignores craft above 2.5 m).
- Fixes:
  - helipilot.js: look-ahead every 7 m along both the wanted path and the
    actual drift (3 m out first); stand-off 76..106 m, 16..24 m over the
    roofs near the target, further out over tall roofs (never more than
    34 deg up); a moving target gets the heli on station ahead of it and
    to one side (in view of the chase camera), a slow one a slow circle.
    Over Miami: 0 crashes in 8 runs, mean elevation 17..35 deg. Leaving
    when heat drops is unchanged. New `ditch` state: pilot shot dead, it
    settles in one piece and is left empty (ENTER takes it, it flies).
  - aircraft.js: on a map with a land box craft turn back 600 m past the
    box, not 2.6 km from the origin.
  - aircraftmesh.js: white livery with a blue band, blue tail and fin;
    brighter response at night; nav lights and blinking beacons as small
    glows at night; light bar with dark lenses, lit lenses and a small
    fixed-size glow per side, red and blue never together, soft edges
    (no one-frame pops); the beam is now a soft volume (light from how
    close each view ray passes the beam axis, brightest at the lamp, none
    near the camera or at the ground), narrow (4.5% of its length), open
    ended; a small lens glow at the lamp.
  - nightlights.js / graphics.js: the searchlight pool goes into the same
    lamp-light shader as the street lamps (one cone test per pixel, no
    light): a narrow bright pool on the street and on any wall in the cone,
    dim by day.
  - aim.js / combat.js: hand guns reach craft in the air out to 130 m
    (`AIR_REACH`; anything else past the gun's range is still a miss);
    LOCK and assist follow.
  - audio.js: AI aircraft never sound a siren (the light bar still flashes).
  - effects.js: a shot-down craft emits flames on the way down until its
    blast (not visible yet in the screenshots; the smoke trail is).
- Tests: helipilot (open-street orbit ahead of a moving target, pistol at
  90+ m, pilot dies, it lands whole, ENTER finds it, it flies; carjack on
  the ground, not in the air), craftmesh (light bar flashes, beam cone and
  pool data). Screenshots: docs/preview/heli-*.png
  (`node scripts/heli-shots.mjs`), numbers: `node scripts/heli-perf.mjs`.
- Not done: walkers stay at street level, so a heli on a roof pad cannot
  be reached on foot; the beam's shader compiles when the first heli
  appears (one program, not warmed at start); the falling wreck is dark
  and hard to see at night.

## 2026-11-22: Miami street polish (owner report: "very CGA and alpha again")
- Buildings (new src/render/miamilook.js, buildings.js): each Miami
  building gets a look from its neighborhood and a seeded hash: Brickell
  and Downtown glass towers (teal and blue tints, fins, spandrel ledges,
  setbacks, roof railings, a plant penthouse) and white condo towers
  with a balcony and glass railing on every floor; Little Havana,
  Shenandoah and the like in pastel stucco with a new arched-window
  facade (shutters, sills, balconettes) and terracotta tile copings or
  hipped tile roofs; art-deco pastel blocks on Miami Beach (eyebrow
  ledges, a center fin over the roof, speed-line bands); port sheds in
  light grays. All get a stone plinth, corner pilasters, string courses
  per floor and an entrance canopy on tall ones. Facades have normal
  maps (recessed windows, sills) and wear in the shader (darker, dirtier
  base, rain streaks under floor lines that fade by 150 m, patchy tone).
  The far blocks use the same colors. The island is unchanged.
- Trees (props.js): Miami street trees are round canopies of many leafy
  clumps (a foliage picture on them), or palms (ringed leaning trunk,
  crown of see-through leafy fronds, two old fronds hanging) in the palm
  neighborhoods and by the water; extra palms down the avenues there,
  Brickell Avenue, Biscayne Boulevard, Calle Ocho and other named
  boulevards, and along the seawalls (with colliders). Trees stay drawn
  at the middle level (no pop-in at 170 m).
- Ground: edge lines along the curbs, crosswalk crossings and stop lines at
  junctions; grass and open land vary in slow lusher and drier patches.
- Sky and sea: deeper blue overhead and a warm haze at the horizon by
  day, with the fog close to it so far towers fade into it
  (daynight.js, colors only); the sea is deeper and greener looking
  down, paler at a glancing view, with slow large patches (water.js,
  shading only; the waves are unchanged).
- Night: the new arched facade lights its windows like the others
  (nightlights.js: one style entry).
- Cost (scripts/perf.mjs, spawn street): day 221 -> 249 draw calls,
  311k -> 489k triangles; night 223 -> 249, 333k -> 491k. Kept in budget
  by merging everything per tile and material (2 new meshes per tile),
  fewer fins and railing panels, balconies on two sides only, no hidden
  balcony tops, and the tile vertex arrays freed once on the GPU.
- Screenshots: docs/preview/miami-polish-*.png (before:
  miami-polish-before-*.png), `node scripts/miami-polish-shots.mjs`.
- Still weak: canopies read as clumps up close; Little Havana has wide
  plain lawns between the street and the buildings; tall towers still
  share one window grid per style.

## 2026-11-22: garages and adventures (W11, milestone 1)
- Twelve garages (First Street Lock-up, Keyside Garage, The Paintshed,
  Bayline Garage, Seaplane Sheds, Northwest Yard, Riverbend Garage, Ocho
  Lock-up, Roads End Garage, Atelier Garage, Sandbar Garage, Key Point
  Shed), placed from the lots with seed 7129. Store, take out, repaint,
  favorite and release; the favorite is the Start car.
- Sixteen adventures (seed 9241), four of each kind, eight in the core:
  signs, talkers (TALK on foot), garage word and the start rumour; a
  tracked adventure shows a fuzzy ring and the objective arrow.
- Save: `rustwater.explore.v1`, strict sanitiser, unlocks derived from
  the done list. Erase all progress clears it; New game keeps it.
- Screens: Garage, Garages and Adventures through menu.registerScreen;
  hub tiles show the counts on Miami only.
- Tests: test/explore.test.js, test/garages.test.js,
  test/adventures.test.js. Screenshots: docs/preview/m1-garage-*.png.
- Not yet: the map draws explore markers as plain dots (no "?" glyph or
  ring circle until mapui offers a layer with those shapes).

## 2026-11-22: garage fixes G1 (K7, K8, cars inside the shed)
- K7 fixed: a favorite taken out of a garage keeps its star in
  `rustwater.explore.v1` (`garages.road`, `{ spec, color }`, strict
  sanitiser, same version 1: older and newer data read as no star). After a
  reload the live car gets its star back; a wrecked favorite loses it; the
  title Start uses it.
- K8 fixed: a reward car taken out is marked in `garages.out`. Other
  garages show it as "Out on the road" and refuse (`reason: 'out'`) until it
  is stored again, wrecked or lost (no live copy and not in the left-behind
  cars). A reward car driven without being marked is marked on entering. A
  reward favorite that is out is not used by Start.
- Parked cars show inside an open garage: up to four stored cars (two rows,
  nose to the door) for the one garage whose door is open; rebuilt only when
  the list changes. Screenshot: docs/preview/g1-garage-open.png.
- Tests: explore.test.js (road star, out list), garages.test.js (one copy
  across two garages, wreck, reload, star after a cold start, the shed).

## Sirens: traffic and pedestrians give way

- The player's SIREN: in a car with `spec.police` (the Selwick Patrol spec now
  carries the flag) or `spec.emergency` (read by `hasSiren`, no spec has it yet)
  a SIREN button toggles `v.siren` (default off): light bar flashes, the audio
  loop plays (it still needs `v.police` or `spec.police`). It sits on the LOCK
  rect (675, 272 / 564, 224), which a car never uses; the touch action is
  `carsiren` (input `siren`, `touch.setSiren(can, on)` called by police.js).
  Leaving the car switches it off.
- Traffic: `src/core/yield.js` (`yieldTarget`, `stepYield`, `curbShift`). Any
  vehicle with `siren` on and moving over 4 m/s (the player's, an AI police
  car) makes AI cars up to 60 m ahead in the same or the neighboring lane
  (oncoming ones within 40 m) pull to the right curb at up to 6 m/s, stop,
  and drive off 0.8 to 1.8 s after it has passed or the siren goes off. Not
  inside a junction or about to enter one; never held longer than 25 s, then
  an 8 s cooldown. Hook in `driveStep` only; parked cars are never touched.
- Pedestrians: within 25 m ahead of a siren car over 5 m/s, anybody closer than
  5.2 m to its line walks to the curb side and waits 1.2 s after it passes. No
  panic, no heat.
- Tests: test/yield.test.js (16). Street run: 4 cars pulled over, no impact,
  2 came to a full stop; avenue run: 6 cars, 3 full stops; siren off while a car
  waits: it drives on after 2.7 s; longest hold 4.7 s; no deadlock, no NaN, no
  car in water or a building, no parked car woken.
- Not yet: no indicator blink (the meshes have no per-side signal); the audio
  siren ignores emergency specs without `police`.

## 2026-11-22: frame loop errors (release blocker)

- Root cause found and fixed: "g.draw threw a null userData error after the
  car drove far from the start". The Phone check (src/ui/phonecheck.js)
  leaves the player's car at the start, drives the test car 1.1 km away, and
  on finish got back into the saved car if it was not wrecked. The 3 s sweep
  in game.js had removed that car (over 300 m away, nobody in it), so its
  mesh was null and every later draw threw in setVehicleLights. Introduced
  with the Phone check (e088395). Fix: finish skips a removed car (the player
  stays on foot); `game.enterVehicle` refuses a removed or meshless craft and
  returns false; `game.removeVehicle` of the craft the player sits in puts
  the player out on foot first; the player-car lights call checks the mesh.
- The frame loop no longer stops on a throw: `createLoop` catches a step or
  a draw, the step still counts (same clock), and game.js also catches round
  each system's always, fixedUpdate and render and the final draw, so one bad
  system cannot stop the rest. Each distinct message is logged once
  (`console.error`), all are counted in `game.errors` (src/core/errorlog.js).
- "Cannot read properties of undefined (reading 'visible')": not reproduced
  on the current tree. It is what three.js throws for a drawn mesh with no
  material; test/meshmaterials.test.js checks every car style, service
  vehicle, boat, aircraft and tank through damage, lamps, siren, LOD and a
  wreck, every light bar phase, and the soak checks the whole scene each leg.
- Tests: errorlog.test.js (once per message; a throwing step or draw keeps
  the loop and the clock), phonecheck.test.js (no re-entry of a removed car),
  meshmaterials.test.js. 693 to 699.
- scripts/soak.mjs [simSeconds=600] [drawEvery=12]: unminified build, loop
  stopped, a regression prelude (swept car re-entered, craft removed with the
  player in it), then legs over ten places across the Miami box: driving with
  boost and the siren, blasts near traffic, carjacks, every craft, a garage,
  the fire truck's water and the tow hook. Fails on any page or console error,
  any caught exception and any mesh without a material.
  Run: 683 simulated s (50 legs) in 58 min wall, 0 exceptions, 0 errors.
  perf.mjs against a HEAD copy: draw calls 315 / 297 and triangles the same,
  step 0.78 ms (0.86 before), draw CPU 9.8 / 7.1 ms (9.4 / 7.2 before).
- scripts/smoke-extra.mjs: the fighter take-off check holds BOOST (the
  afterburner has been on the BOOST button since b902efd) and reads the
  afterburner at lift-off; it failed on every run before this.

## 2026-11-23: version 0.9.0 Real streets, solid world

- Map to the ocean, real lane widths and street names, Beach default start (Ocean Drive, facing south because the street is one way), solid props and sea walls, ground following, fair damage rules, parking lots without box cars, GPS with turn prompts, American English, Handling lab, lighter rendering (Normal street view Beach 135 calls / 237k triangles, Downtown 200 / 283k).
- Gates: lint, 887 tests, smoke --extra, five region smoke, full ui-test 731/731. Security review: 0 critical, high, medium.
- Open: shader programs 73 to 75 (target 60); heat 5 tank not on the Beach; handling model per class (0.10.0).

## 2026-11-23: version 0.10.0 American iron

- 18 smooth American vehicle bodies at three detail levels (about 6,300 / 1,300 / 290 triangles), left-hand driver, rear Florida-style plates; retired hatchback, one-box van and cab-over truck. Hood and cockpit first-person views (Bumper removed). Real handling per class from US reference figures (circle, 0-60, 60-0, skidpad g, handbrake, understeer, U-turns), Arcade and Sim brake identically.
- Gates: lint, 916 tests, smoke --extra, five region smoke, ui-test 744/744. Normal street view Beach 130 calls / 216k, Downtown 188 / 262k.
- Open: shader programs 73 to 76 (target 60); L1 and L2 noses faceted up close; semi without trailer; closed-lot test loop in the Handling lab not built.

## 2026-11-23: version 0.11.0 What you saw (owner round 3)

- Roads: one asphalt area per junction, strips trimmed, no paint through, round curb corners, medians only where the gap is 6 m or more, facing-curb gaps and a narrow-gap net in ground.js (test/junctions.test.js a to e, all five regions).
- Touch steering: the wheel was absolute (a slide right below its center steered left); now a relative drag anywhere on the left 40 percent; scripts/touch-test.mjs (240 two-finger checks) is a gate step. SWAP in cars and boats. Turn prompt is a small pill in the top row; street name under the minimap.
- Car response: speed shaping of the player's input, no push past grip in Arcade, calm damper for the player only (AI unchanged), quicker chase camera.
- Planes: arcade model (rotation speed, coordinated turns, hands-off level, landing assist); cockpit interior rebuilt.
- Lots: surface parking, forecourts, parks and yards by rule; low shrubs and hedges; one ground per block.
- Gates: lint, 966 tests, smoke --extra, touch-test, five region smoke, ui-test 747/747. Security review: 0 critical, high, medium.
- Open: Phone check showed 20 frames over 33 ms on 0.10.0 (PERF not started); net-filled road gaps are flat in physics but not drawn as asphalt; shader programs 73 to 77; owner screenshots (with metadata) remain in three earlier commits.

## 2026-11-24: version 0.11.1 Planted handling (owner: loose, cannot turn sharp, fishtails)

- Arcade is a planted model: the nose follows the steering (0.04 s lag), the travel follows the nose, power and brakes cannot rotate the car (worst slip over six abuse cases 0.1 degrees, was 27 to 35). Grip 1.6x up to 35 mph easing to 1.25x at 75, lock 40 degrees, speed shaping exponent 1.2 at 70 mph, input to yaw 0.08 s (was 0.17). Handbrake swings the tail to 34 degrees, steerable, recovers by itself; slip, smoke, squeal and drift score follow the real slip. Touch wheel: 80 px for full input. Sim unchanged.
- Real touch drive through four Beach blocks: 0.51 m worst from lane center, five corners at 18 to 27 mph.
- Gate: lint, tests, smoke --extra, touch-test 240/240 (regions and ui-test not rerun: no UI or world change). Curb pull-over margin widened by 0.5 m for the new car path (yield test).
- Risk: at 1.3 g with a 0.08 s response it may read twitchy; knobs: 80 px travel, Relaxed preset.
- Open: PERF, LOOP and STREETSCAPE partial work stays in the tree (0.12.0).

Note on 0.11.1 (2026-11-24): the first release commit also carried unfinished PERF, LOOP and STREETSCAPE edits and failed the lots build-time check on the build server. Those edits were pulled out into docs/wip/0.12-partial.patch (apply with `git apply`) and 0.11.1 is the handling change only, from 0.11.0. Lesson: never publish with partial helper work in the tree; park it as a patch first.

## 2026-11-24: version 0.11.2 Strong steering at speed (owner: fully rotated wheel barely changed trajectory)

- Cause measured: wheel, curve and shaping passed full input through; the loss was the grip-limited turn (1.06 g at 70 mph, 18 degrees in the first second, 93 m radius). Arcade player steering is now a yaw-rate command, linear in the input (0.04 s lag), target lateral g 2.0 at 20 mph, 2.3 at 35, 2.6 from 55 to 110, 2.3 at 130, scaled for tall bodies (SUV, pickup 0.81; van, box truck 0.65). Sedan at 70 mph full wheel: 44 degrees in the first second, 38 m radius, rear slip under 0.1 degree. Sim, AI, service vehicles, handbrake slide, straight line unchanged.
- Center response: Standard arcShape 1.4 (seed sweep of 30 thumb models: lane changes at 65 and 90 mph under 3.3 s, at most one overshoot; pinned as LANE_CHANGE_SWEEP). Relaxed 1.6, Sharp linear.
- Wheel: travel past full lock is capped at 10 percent slack, so reversing responds at once.
- Gate: lint, 974 tests, smoke --extra, touch-test 243/243.
- If twitchy near center: raise arcShape; if still loose: it is not the model, tell me what you see.

## 2026-11-24: version 0.11.3 Crowd spike (owner Phone check: peds 10.7 ms, 4 slow frames)

- peds read a typed per-step snapshot of vehicles (no per-read allocation), spawn tries capped at 4 per step, mesh warmers build one mesh per step while the title is up. Under 4x throttle: peds worst call 16.6 to 7.8 ms, frames over budget 1 to 0, heat scenario steps over 4 ms per minute 77 to 60, start at 4x 11.0 to 9.5 s.
- scripts/perf-phonecheck.mjs (--alloc) drives the Phone check headless at 4x throttle.
- Not done: memory 185 MB at 4x forced GC (111 MB typed arrays: tile mesh pool cap 48 MB in meshbuilder.js, lot and block grids ~30 MB); combat 9.6 ms in the check's own fight; stepVehicle, resolveCircle, ground and traffic scan allocate (GC pauses 15 ms); 83 ms frame probably the Phone check's own resize.

## 2026-11-24: 0.12.0 the loop, in the tree (not published)

- The LOOP parts of docs/wip/0.12-partial.patch applied by file (`git apply --include`); its PERF and STREETSCAPE parts (game.js matrix walk, phonecheck.js, ground, lots, junctions, citymesh, lotmesh, realcity, spatial, gate.mjs, drive-review, phonecheck-run) left in the patch. game.js needed no loop wiring: systems/missions.js, which game.js already registers, hosts flow, events, daily and custom.
- Fixed from the scripted play-through (scripts/loop-test.mjs, 748x360): a heat gate never raised its star after a calm spell (pending point faded below the step); the first run got a star from a bump at 7 s (until the police beat, bumps and speed do not call the police) and ran into a queue at the first light (it goes 40 to 70 m ahead); a car into the player standing still paid a Ram and cost a crash; the wrong-way line now says "turn around". Stunt ramps are one draw each (were seven) and event ramps have no pillar: Downtown Normal street view was 222 calls with the loop, now 209 / 293k (Beach 123 / 241k).
- ui-test: the wheel checks follow DRAG_FULL_PX (80 px since 0.11.1; they still asserted 55 and failed since then), the event line check is the prompt strip's real rect, the car-event state repaints the line force() overwrote.
- Gates: lint, 1035 tests, menu-test 219, ui-test 771/771, touch-test 243/243, smoke --extra, smoke-regions (5), loop-test 32 ok, perf both maps in budget; step +0.04 to 0.16 ms against a HEAD copy.

## 2026-11-24: 0.12.1 Streetscape, in the tree (not published, no version bump)

- STREETSCAPE parts of docs/wip/0.12-partial.patch applied by file (the patch left as it is) and finished; the defect list, fixes and what remains are in docs/STREETSCAPE.md. Checked with drive-review shots of all five routes and the defect places, and in node by comparing what the ground says with what the meshes draw.
- Narrow-gap net drawn: flat net as asphalt, and the net between two sidewalks is now raised sidewalk in physics and mesh (was a 15 cm slot). Into existing builders, no new draw calls.
- S Miami Ave: no rail pair down the 3.5 m gap between the two river bridge decks (world/edgelines.js), the gap paved; at SW 6th St no sidewalk drawn on another carriageway's asphalt.
- Junction corners judged by the ground (cut where they straddle road), fan junctions (32) drawn as arm carriageways plus a middle hull, no curb through them.
- Beds as rows of faceted shrubs, forecourts on a loose per-lot grid, lawns run under the sidewalk (lot fringe), lot ground merged down z as well as along x. lotGrid.ground made lazily (lots build stage back to about 4 of its 5.4 limit).
- Normal street view, day: Beach 122 / 233k (was 130 / 244k), Downtown 209 / 292k (208 / 293k), North 164 / 232k (166 / 246k), West 146 / 255k (152 / 280k), South 114 / 249k (119 / 260k); static city calls unchanged.
- Gates: lint, 1039 tests (4 new in test/streetscape.test.js; node fingerprints repinned for the street-name blades near fan junctions), menu-test 219, ui-test 771/771, touch-test 243/243, smoke --extra, smoke-regions (5), perf five regions in budget.
- Open: lot to lot raster steps, long hedges read heavy, an arm's real sidewalk can cross a fan junction, crossing lane paint where two carriageways overlap.

## 2026-11-24: 0.12.2 look crash fix
- Soak found `keepLook` throwing (reading wheelLevels of a mesh without them) in the render loop after 0.12.0; guarded. Soak of 191 sim s now has zero errors.
- The full 60 minute soak per region is not run overnight: it takes about 3.5 hours of wall time each here. Left for the release candidate.
- smoke --extra 'blast over the sea' failed once on a loaded machine and passed on rerun; watch for a repeat.

## 2026-11-24: 0.12.3 memory (in the tree, no version bump)
- Cause (heap snapshot attributed by owner): createMiamiCity's scope is held by closures kept on the city (visualAt, cellAt, edgesNear), so every build raster it still pointed at stayed alive: the lot inputs (owner and queue Int32, free, park, water, near, list: about 24 MB on Beach), the block labels (Int32, 7.5 MB), the coast and base land copies. Now released once the lots are built (lotIn, labelBuf, queueBuf, parkCells, blockLab, baseLand set to null; coastLand a plain local). Output identical: regions fingerprints unchanged.
- Mesh scratch pool cap (render/meshbuilder.js POOL_MAX) 48 to 24 MB: a start already pools 14 to 20 MB, so the cap bounds the growth in play.
- perf-phonecheck at 4x, memory after a forced collection, before / after the check: Beach 191 / 200 MB to 153 / 162 MB; Downtown 189 / 190 MB to 160 / 161 MB. (Timing not compared: a soak shared the CPU.)
- Gates: lint, tests (two build-time tests failed only while the CPU was shared, pass alone), menu-test, smoke --extra, smoke-regions (first run: a Downtown Play click timed out under load; rerun passed all five).
- Left: lotGrid.id could be Int16 (2.5 to 3.8 MB; a test asserts Int32 and the fingerprint hashes bytes); tile meshes not yet drawn keep their pooled arrays (about 7 MB).

## 2026-11-24: 0.12.4 solid (part 1) (in the tree, no version bump)
- Collision sweep, `node scripts/collision-sweep.mjs` (docs/PLAN_V4.md task 1): in all five regions it drives a sedan, a truck, the tank, a taxiing prop plane and the player on foot into every solid class (each PROP_SOLIDS street and lot kind found in the region, bay cars, buildings by face, road end barriers, crane legs, sea walls, rails) at up to 5 speeds (15 to 100 mph by craft) and 8 angles (5 against a face), and boats at the shore and the piers. Fails a run more than 0.3 m into the solid (also between steps), 0.3 m below the ground, ending inside any solid, or a body point or box corner past a wall toward the water.
- Holes found and fixed (before: 317 failing runs of about 35,000; after: 0):
  - Tank over sea walls and rails: it resolves at y 1 m, so the 0.9 m walls never stopped it (all tank wall runs failed, 1 m and more over). Now the tank resolves its two circles and four corners against the edge layer alone (collision.js `resolveLayer`), still rolling over other things up to 1 m.
  - Tank shore push: up to 4 m a step after the walls, so a tank near the water jumped through a lamp. Now at most 1 m a step and before the walls.
  - Truck corners past a bridge rail (0.4 to 0.7 m): the corner probes ran only when the center's 32 m cell listed a wall; a long truck's front reached a wall in the next cell. Now any cell the box can reach.
  - Car pulled through a thin lot wall (0.33 m): a corner probe resolved against every solid and left a 0.3 to 0.5 m wall by its far face. The corner probes now see only the sea walls and rails.
  - Plane taxiing on a bridge deck shoved into the rail and wrecked by the shore push (keepShoreSide). No push while standing on ground over the water.
  - Wide boats (fisher) put a hull corner 0.3 to 0.5 m onto the shore at an angle: the shore check used bow, middle and stern only. The four corners are kept off the land too.
- By class, all regions (runs, stopped / deflected / sheared / rolled over by the tank): lamp 1,609 (884 / 44 / 681 / 0), palm 1,537, street tree 1,347, stop sign 1,517, street sign 1,546, signal mast 1,468, lot wall 687, bollard 635, bench 767, lot tree 1,037, lot lamp 924, fence 671, gate 837, boat on a trailer 905, stack 1,090, pallet 863, cabin 1,119, planter 905, bed 745, hedge 458, sign 825, bay car 654, rack 513, flagpole 650, bin 704, dumpster 967, shrub 973, pile 1,231, rock 328, umbrella 1,028, building 2,048, barrier 1,192, crane 424, sea wall 581, rail 941, shore (boats) 756, pier (boats) 468. No sample below the ground. Lamps, signs and other 'break' props still shear above their break speed by design (lamp 18 mph).
- Survival, `node scripts/survival.mjs` (task 4): a clumsy player (route following at 1.3 times the lane speed with no braking for anything, a late and quantized thumb, a swerve every 15 to 30 s, one 60 mph run straight on at minute 5, then 10 minutes on foot crossing streets and sprinting) with traffic, people, parked cars, police and combat, 4 seeds of 10 + 10 minutes per region and mode:
  - Default: Beach and Downtown 0 wrecks, 0 fires, 0 deaths (Downtown car down to the 15 percent floor).
  - Hard, Beach: 1 wreck in 40 minutes (a crash, in a 95 mph run), 0 deaths, 0 knock-downs by a car under 15 mph.
  - Hard, Downtown: 6 wrecks in 40 minutes (3 crashes, 3 fires after police gunfire at 3 to 4 stars, which the clumsy driver earns by hitting people), 2 deaths, both police bullets. 0 deaths or wrecks from bumps, people or parked cars; bumps under 20 mph took 0.77 of a car in 40 minutes, weapons and fire 3.7.
  - No threshold changed: the data does not blame bumps. A fade-in of crash damage from 11 to 20 mph was tried and taken out again (it saved under 0.1 of a car per 10 minutes). Open for the lead: police gunfire in Hard Downtown is what blows the car up.
- Tests: test/collision-sweep.test.js (each hole on a hand-made world, failing before the fix, and a reduced Downtown sweep), test/survival.test.js (Beach, default and Hard). docs/PLAN_V4.md: one British spelling fixed (the us-english test failed on it).

## 2026-11-24: 0.12.4 solid (part 2) (in the tree, no version bump)
- GPS audit (docs/PLAN_V4.md task 2), `node scripts/gps-audit.mjs [pairs]` and test/gps-audit.test.js: 200 seeded (createRng) origin and destination pairs on lane points in each of the five regions through `createRouter`, plus a drive of 100 routes per region at 14 m/s 2 m off the lane line and 200 wrong-turn tries.
  - Held already: every pair in one strongly connected piece of the road graph got a full route (0 missed in 1,000 pairs; the 5 to 36 per 200 without one start or end on an island of the crop or a one-way sink); 0 wrong-way or broken edge sequences; length within 1.20 of the shortest legal way that leaves out pedestrian malls and living streets (worst 1.14 Downtown, 1.20 Beach, 1.14 North, 1.11 West, 1.08 South; Lincoln Road mall is avoided on purpose); every turn names the road taken, 0 arrows against the line; the cursor never re-routes on the line and the next turn never goes back.
  - Bug 1, a missed turn was told late: the off-route rule was 40 m for 1 s, so after a wrong turn at 12 m/s the new route came after about 4.4 s (median 3.8 s from 8 m off the line, worst 6.8 s). Now 18 m for 0.5 s, or 10 m while moving at more than 2 m/s and heading away from the line (not along it) for 0.4 s: median 0.6 to 1.4 s, 90th percentile 1.5 to 1.7 s from 8 m off, and no re-route while following a route 2 m to the side (6 m: 1 of 440). `OFF_ROUTE_M` 40 to 18, `OFF_ROUTE_S` 1 to 0.5, new `OFF_NEAR_M`, `OFF_NEAR_S`.
  - Bug 2, the HUD arrow pointed at the goal through the blocks, not along the route: with a route it disagreed with the turn pill (on 1 route in 4 by more than 45 degrees). It now aims at the point 45 m ahead on the route (`tracker.lookAhead`, no allocation); with no route it still points at the goal.
  - Bug 3, a merged pair of turns (a divided road's two junctions) replaced a street name with an empty one when the second road was an unnamed ramp ("turn left" with no street); it now keeps the street before it.
  - Found, not changed: Downtown has 161 separate one-way pieces and 17 percent of its road length is outside the main one (Beach 4, North 4, West 1, South 7 percent); a goal there gets a partial route to the nearest reachable junction. Cursor snaps up to 10 m at a hairpin when the car cuts the inside of a corner (the line really is that close); a tie-break by distance along was tried and made it worse, so it was taken out.
  - Tests that fail on the old code: the wrong-turn timing in all five regions, the arrow, the unnamed-ramp name (8 of 18 failed before, 18 pass now).
- Weapon switch (task 5): scripts/touch-test.mjs now enters the boat, tank, helicopter and plane with a steering finger down and checks each weapon control: on screen, 48 px or more, clear of the steering zone. Boat: SWAP (carswap) tap switches the drive-by gun (`arms.lastGun`) and hold opens the wheel while the thumb steers. Tank (CANNON, COAX), helicopter and plane (GUN, MSL, BOMB, as far as the craft carries them): each fires with the steering finger down and lets go on lift. No gap found at 748x360, 748x285 and 915x412 (car was already covered), so no code change. In an aircraft or tank there is nothing to swap between: every mount has its own button.
- HUD cover (task 6), `node scripts/hud-cover.mjs` (union of painted boxes, Minimal, right-handed, fan closed, street name and GPS pill showing): 915x412 foot 14.7, car 18.9, boat 18.3, tank 14.1, heli 16.1, plane 17.9 percent; 780x360 17.9, 21.9, 21.0, 17.6, 19.5, 21.9; 748x360 17.7, 21.7, 20.9, 17.9, 19.2, 21.8. All under 22, so nothing was trimmed and no contract rect changed.
- 0.12.4 review follow-up: the missed-turn reroute (10 m off the line) now searches at most every 3 s, so cross-country walking or tank travel cannot run a route search twice a second.

## 2026-11-24: 0.12.5 build time (in the tree, no version bump)
- Why: CI built the whole box in about 3.0 to 3.5 s against the 3 s limits (miami.test.js, world-density.test.js). No limit or test changed; the output is byte for byte the same (regions.test.js fingerprints unchanged; a deeper check also hashed every city field, every lot's dressing and a grid of world queries, before and after).
- Measured here, 5 cold runs each, old and new interleaved, medians: createMiamiCity wall 1623 to 1350 ms (-17 %), process CPU 2531 to 2209 ms (-13 %); dressing every lot afterwards wall 829 to 720 ms, CPU 1371 to 1246 ms; the dressLot test's per-lot figure 0.0247 to 0.0209 ms. scripts/city-build-bench.mjs --runs 5: wall 1850 to 1441 ms, CPU 2762 to 2306 ms (a busier moment).
- Biggest wins: building heights stored as a double field from the first box (33,000 object migrations a build when the first fractional height arrived); buildLots reuses the spent owner and block-label rasters for its lot ids and nearest-box raster (two fresh 15 MB arrays fewer: lots pieces 99 to 70 ms); parking bays dressed only as far as the bay rows (dressLot baysOnly), bays picked by index instead of listing all 159,000; junction drafts keep plain arrays and only the kept one is triangulated and made typed.
- Also: flat building boxes for inBuilding and buildingsNear; bounding-box rejects before segment distances (rectGap, boxFar) in trimRect, roadClearance, edgesNear, onOtherRoad, onRoad and the lot road; largestRects stops a histogram pass at the first row a pick cannot change and counts cells in its first pass; triangulate on a typed index list; the cluster merge pass, the parking bay rows and the footprint block marks as top-level loops; indexed loops instead of for-of in the one-shot build code; dressLot: lot-grid fields read once, building boxes as a flat array, the junction test skipped for lots with no junction near, its constant tables made once; the title camera poses made once; piecesOf without per-cell division and without a second flood to undo a big piece; signed field scratch in the free label and queue buffers.
- Tried and left out (no gain measured): fusing the two signed-field row passes, integer column steps, pooling the spent byte rasters, a per-row building filter for bays, warming the step-distance kernels.
- Gates: lint, 1067 tests, smoke --extra.
- 0.12.4 published with the 0.12.5 build time work (city builds about 17 percent faster); CI failed the 3 s whole box tests three times before it.

## 2026-11-24: 0.12.6 cockpit and flight (in the tree, no version bump)
- Why: the owner called the dashboard view bad and first person horrible; planes "do not fly right" (docs/PLAN_V4.md tasks 7 and 8).
- Review: headless shots at 748x360 of Hood and Cockpit in the sedan, pickup, sports car, van and truck, day and night, parked and at 55 mph, plus the boat's Bow and the plane and helicopter cockpits. Hood view was fine. Defects found in the cockpit:
  - Fish-eye: a 78 degree vertical FOV is 118 degrees across a phone; the A-pillars cut the frame as thick diagonals, the mirror stretched into a bar, the road warped. Bow (74) and the plane (78) and helicopter (80) cockpits had the same.
  - Gauges unreadable: the dial numbers were 6 to 7 px tall; the truck's four 45 degree spokes and hub covered both dials.
  - Washed-out dash: the charcoal dash took full sun (the kit takes no shadow) and read as a pale gray slab.
  - Truck wheel: a near wheel (short cab) kept its bottom edge in place and pushed its rim up into the road ahead.
- Fixes: cockpit FOV 100 degrees across (COCKPIT_FOV_H; 59.7 vertical at 748x360), the rim's top and the whole cluster in frame, the bottom of the wheel may leave it. A digital mph readout between the dials (three digit quads from the atlas, UVs rewritten only when the shown speed changes, no allocation), 12 px or more at phone size. Cabin direct light share 0.45 (SHADE). Big wheels: spokes as a low and a near level pair, a smaller cluster under the rim (scaled with distance on buses), a near wheel keeps its top edge. The bus mirror hangs into the narrower frame. Bow 60, plane and helicopter cockpits 62 degrees vertical (about 100 across).
- Flight review: scripts/flight-review.mjs flies scripted thumb sorties in the real worlds of all five regions: every plane off the runway (climb to 150 m, 30 degree circle, return, landing on its own strip downtown), every parked plane taxiing out at 0.35 and 0.6 thrust, each seaplane from its water spot, each helicopter up, out, back and down on its pad. Take-off runs (prop 295 m, stunt 165, jet 507, fighter 69 on BOOST-free full thrust) and rotation speeds are sensible; no stall or spin on gentle input; landings 0.7 to 0.9 m/s sink with wings level. The bug: both depot fighters and the apron fighter crashed in every part thrust exit (the 14 m/s2 push reached 30 m/s before the nose wheel could turn them, across the runway into the sea wall or the runway end). Fix: taxi assist in planeGround: with the stick over past 0.45 the push holds a taxi speed (9 m/s at 0.85 and beyond); straight ahead the run is unchanged. After: 0 failures but one pilot-pattern limit (the downtown seaplane's straight-in glide ends in a shore wall: the script's path, not the model). Touch stick: steer and pitch as before (dead band widens with sideways push, autolevel only with the stick centered), nothing found fighting the thumb.
- Tests: carinterior (framing at 100 degrees for seven bodies incl. van and truck: rim top 56 to 90 percent down, cluster corners in frame, mph digits 12 px or more, horizon at mid height; readout digits and no upload while the speed holds), chasecam (cockpit 100 across; Bow and aircraft cockpits 90 to 105 across), aircraft (taxi out at 0.35, 0.6 and full thrust for fighter, jet, prop and stunt stays within the runway, under 14 m/s). The old "whole wheel in frame" check was what forced the fish-eye; it is replaced by the stricter readability checks above. ui-test cockpit check now 100 degrees across.
- Draw budget unchanged: smoke street view 210 calls, 294k triangles.
- Gates: lint, 1070 tests, smoke --extra, touch-test 309/309 (one rerun: a slider touchcancel check flaked once), ui-test 765/771: the 6 failures are the handling lab "Controls has 6 rows" check against the concurrent menu.js change (a seventh row) from task 3, not this work.
- Router: trunk class cost 0.75 to 0.8 so a correct Alton Rd route stays within 1.2 of the shortest after the Beach lane merge (no test limit changed).

## 2026-11-25: 0.12.6 allocations (in the tree, no version bump)
- docs/PLAN_V4.md task 10. Cause: V8 boxed numbers read through generic lookups at read sites that saw several object shapes (cars with fields added later by different systems; collision circles with and without a bay hash). Fixes in src/entities/vehicle.js (createVehicle declares the later fields as undefined: one car shape) and src/world/collision.js (resolveIn reads `off`/`h` per shape kind; the bay hash in a WeakMap). Details and the table in docs/PERF.md, "Allocation pass".
- Bytes allocated per simulated second, before to after: node survival-harness drive Beach 8.6 to 4.2 MB/s, Downtown 11.9 to 7.6; Chrome steps only, Beach 6.1 to 3.5, Downtown five stars 11.4 to 8.6; perf-phonecheck --alloc at 4x with draws, Beach 20.4 to 19.6, Downtown 21.2 to 19.8 (three.js uniforms and the ground net now lead).
- Same behavior: the drives end in the same state hashes before and after; no test or fingerprint changed.
- Open: Beach Phone check `heightAt` about 1.7 MB/s new (cause not found), ground `geoSurface`/`netRound`, three.js uniform uploads; the 5 ms collection target is not met.
- Gates: lint (changed files), 1082 tests (one timing test, dressLot cost, failed once under load and passed alone), smoke --extra.
- 0.12.5: the extra Steering feel row made the Controls page scroll on phones (340 px against 304), so it was removed; presets stay in the Handling lab (three taps). Menu and ui tests are back to their original expectations.

## 2026-11-25: 0.13.0 loop tuning (in the tree, no version bump)
- docs/PLAN_V4.md task 12, from the previous helper's fun review. Design notes in docs/LOOP.md (sections a, b, e).
- First run: moving traffic in its lane is cleared, so it only paid close shaves on parked cars. Now three slow cars (6 m/s) are staged in the lane 50, 90 and 135 m past the first gate when the player comes within 45 m of it from behind (each approach, a RETRY too; at least traffic's 90 m spawn distance away). `traffic.stageAhead` (a spot that is taken slides on 12 m, up to 4 tries; at the traffic cap the farthest ordinary car makes way); the lane clearing keeps a staged car while it moves and takes it like any queue when it stands.
- Approach from behind: the router takes an arrival heading (`search(..., arrive)`, tracker `setGoal(x, z, legal, arrive)`, the objective passes the gate's heading). The goal edge is never driven the other way (also the fix for the node search closing its far end first), a start on it never runs back past the goal, and with an arrival set the route may turn round at a dead end; with no such way it routes as before. Placement: the first heat escape and the first jump now face away from the start place (nearFirst). Node test: every Beach gate from ahead, behind and beside: never back through the gate, arriving the gate's way (without the heading 31 of 90 routes went back through it).
- Event line: a trap shows the next medal above the speed the car is doing ("Trap 974 ft · silver 73 mph"), a rush drop and a heat escape the best medal the clock still allows (gold, then silver, then bronze). Same prompt strip, contract rects unchanged; the ui-test fit list has five new lines.
- Tier up: its own chime (`chimeTier`, banks.js: a low thump and an original four-note rise over a held octave, peak -2.2 dBFS, centroid 628 Hz), 0.85 on the UI bus against the chime's 0.6, a whole tone higher per tier; event `flowTier` instead of the plain reward chime. docs/AUDIO.md row added.
- loop-test: new checks for staged cars, passes on moving cars in the first run, the GPS line to the red and the purple gate (ends the gate's way, never crosses it backward), the trap and drop marks. Before: the driver reached a dash gate instead of the red one and failed the ramp beat (2 FAIL, intro 7.0 min); after: 39 ok, intro 5.8 min, first medal gold at 30 s.
- Draw budget: smoke Downtown street view 210 calls, 294k triangles. A staged car in view costs one call (seen at 211 when they were placed 75 m out; now placed later, so the snapshot does not see them).
- Open: the thumb driver often rams the first staged car (it slows when the player closes up) and drives through the red gate again on its way to the purple one (the GPS does not route around other gates); in one run a one-star heat escape ran out of time twice while the stars rose to three. Not done from task 12: each template from 3 directions by the thumb driver, the bronze / gold seed shares.
- Gates: lint, 1093 tests, loop-test 39 ok, smoke --extra, ui-test 781/781.
- 0.13.0 note: the new gate ordering (jump and heat face away from the start) renumbers some street event ids, so a few medals saved on 0.12.x may sit on a different gate. Accepted: the loop is one day old.
