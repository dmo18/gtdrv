# Rustwater revamp plan

Written 2026-11-22 against version 0.3.1 (commit f88593e). Planning only: no source file was
changed to produce this. Numbers marked "measured" come from node scripts run against the current
code and data on that date. Items marked "judged" are a reading of the code or a screenshot, not a
measurement.

Owner's complaint, in short: empty wasteland, nothing like Miami, cars look bad, gameplay and
handling not realistic, bad map, killing and blowing up feel fake, menus scattered and not working
right. Wanted: a proper revamp with a semantic review, a token plan and implementation.

## 1. Semantic review

### 1a. Why the Miami view is an empty grey plaza

Headline: the spawn itself is not empty. The emptiness is everywhere else, and it is built into
how land is drawn.

- Spawn (measured): `MIAMI_SPOTS.spawn` (src/world/miami-spots.js:62) resolves to x -1101, z 738
  on Southeast 1st Street, Downtown. There are 9 building boxes within 50 m, 33 within 100 m, 69
  within 150 m, the nearest 12.7 m away, the tallest 191 m. The spawn is fine.
- The owner's screenshot is not the spawn. It shows a van (the starter car is the sedan,
  src/systems/session.js:261) and a score of 67,094, so it is a restored session: Play continues
  from the last saved place. The player is standing inside a block, off the road, in a low rise
  area. So the first thing the owner sees on every launch is wherever the last session ended, not
  a view anyone designed.
- Root cause 1, all open land is one grey paving tile. In src/render/citymesh.js `realLand` (lines
  650 to 672) every land cell that is not in a `park` or `airfield` district is drawn with the one
  `PAVE` colour and paving texture. The map data (src/world/data/miami.json) has roads, buildings,
  water, coastline, parks and labels only: no land use, no yards, no parking lots, no fences, no
  driveways. Measured shares of the 40.4 km2 of land: roads 15.8 %, building boxes about 17 %
  (6.88 km2), grass (parks and the airfield) 5.0 %, and the rest, about 62 %, is bare paving tile
  with nothing on it.
- Root cause 2, nothing stands on that land. The whole map has 13,971 lamps, 2,570 street trees
  and 66 street signs (measured, `city.props` and `city.furniture`), all along kerbs. Nothing is
  placed inside a lot. 2,570 trees over 40 km2 is one tree per 1.6 hectares.
- Root cause 3, real gaps read as deserts. 14.5 % of non-park land is 60 m or more from any
  building, 8.2 % is 100 m or more, and 671 of 5,113 road nodes are 60 m or more from a building
  (measured on a 10 m grid). Car parks, rail yards, the port, causeways and places where the
  source data has no footprints all become flat tile.
- Root cause 4, the map is far bigger than the detail budget. 9.0 by 7.8 km, 559 km of road,
  33,077 building boxes cut from 20,674 footprints, but only 6 points of interest, 23 landmarks
  and 3 special surfaces. Median building height is 7 m and the 90th percentile is 14 m, so nine
  tenths of the map is one or two storey boxes on tile.
- Streaming (src/render/realcity.js:32, `LOD = { near: 340, mid: 170, build: 520, drop: 860 }`):
  full detail only within 340 m; past that every building is a plain box in a far block. In the
  screenshot the grey featureless towers on the left are far boxes seen from about 400 m. Small
  props vanish past 170 m, which makes open ground look even emptier.
- Minimap disagrees with the world: it paints land and blocks green (src/ui/minimap.js:10 to 11,
  `#6f7b5c`, `#7d8869`) while the 3D ground there is grey paving.
- Small losses: footprints with a bounding box over 400 m are skipped (src/world/miami.js:1155; 2
  footprints, 51,000 m2), `roof` and `patio` kinds are skipped (line 33), 335 footprints under 25
  m2 are dropped. Not the main cause.

### 1b. Why the cars look blocky

- The bodies are lofted from cross sections in code (src/render/carbody.js, 1,072 lines) with a
  custom paint shader (src/render/vehiclemats.js). In a clean close-up
  (docs/preview/car-close-sports.png) the shape is recognisable but reads as a smooth soap bar: no
  panel gaps with depth, no wheel arch lips, thin flat wheels, tiny lamps, no interior, no
  reflections of the street. (judged)
- On the phone it looks worse than the preview. Adaptive resolution (src/render/adaptres.js) runs
  the pixel ratio between 0.6 and 1.6 on a screen whose native ratio is 3.5, and MSAA is off when
  the device ratio is above 1.5 (docs/STATUS.md, smoothness pass). The owner's screenshot shows
  stair-stepped edges on the van and its shadow. So the phone gets under half native resolution
  with no edge smoothing.
- The van in the screenshot is a white box with a black rear panel: no visible tail lamp glow, no
  bumper break, no dirt, no contact shadow detail. Nine road vehicles share five body types
  (hatch, sedan, coupe, pickup, van, truck in src/entities/vehicle.js:29 to 100), so traffic
  repeats quickly.
- General bar for a modern mobile driving game: a clear silhouette per class, a reflective paint
  with a sky and street reflection, lit lamps with bloom at night, visible wheels that steer and
  spin with rim detail, a simple interior behind tinted glass, and smooth edges. The current cars
  miss reflection, wheel and lamp detail, and edge quality.

### 1c. Why handling and controls feel wrong

Measured with `stepVehicle` at 1/60 s (script in the session scratchpad, to be turned into
test/handling-bands.test.js):

| car | 0 to 60 mph | top speed | 60 to 0 mph |
|---|---|---|---|
| compact | 9.7 s | 79 mph | 39 m |
| sedan | 8.4 s | 92 mph | 38 m |
| sports | 4.0 s | 134 mph | 30 m |
| muscle | 5.6 s | 119 mph | 38 m |
| van | 12.1 s | 72 mph | 44 m |
| truck | 21.4 s | 62 mph | 50 m |

- Straight line numbers are believable. The corners are not. In the default Arcade mode lateral
  grip is `2.4 + 0.3 * grip` (src/entities/vehicle.js:199 to 203 and 228), about 2.7 g. Measured:
  a sedan at 15 m/s (34 mph) on full lock turns a circle of 8.6 m radius, which is 2.7 g; at 30
  m/s it turns 31 to 37 m radius, 2.5 to 2.9 g. A road car manages 0.8 to 1.0 g. This was done on
  purpose after the first complaint (steering radius too wide, STATUS decision 4), but it
  overshot: the car pivots like a toy.
- Steering reaches full lock in 0.08 s in Arcade (`steerRate: 14`) and 0.15 s in Sim. A real
  driver takes 0.3 to 0.5 s. Any thumb twitch is a full swerve.
- The Sim mode goes the other way: 0.76 to 0.79 g and a 120 m radius at 30 m/s with heavy
  understeer, plus a 3.1 m radius at walking pace for the compact, tighter than any real car
  (about 5 m). Neither mode sits in the believable middle.
- Touch wheel (src/ui/touch.js:264 to 275, src/core/input.js:134 to 152): 120 degrees of thumb
  travel is full lock, then a power curve with exponent 1.6. The first third of the travel gives
  about 17 % of lock, the last third gives half of it. Combined with 2.7 g grip and 0.08 s lock
  time, small corrections do nothing and larger ones snap. The wheel also only turns while the
  thumb circles its centre; a thumb that drifts into the 16 px core loses tracking.
- Four steering styles (wheel, buttons, tilt, slider), a sensitivity slider and two handling
  modes: ten settings to tune a feel that has no good default.
- The world is flat at y = 0 with 2D physics: no kerb bump, no slope, no visible suspension travel
  beyond body pitch and roll. Fine for this game, but the camera and body motion must sell weight.

### 1d. Why killing and explosions feel fake

Paper list is long (docs/COMBAT.md, src/render/combatfx.js 1,060 lines): fireball, shock ring,
sparks, smoke column, scorch, shake, debris, blood, slow motion. What falls short:

- The fireball is one flat orange disc with soft edges (docs/preview/boom-2-fireball.png): no dark
  smoke rolling through it, no bright core that fades to red, no light thrown on nearby walls and
  road, no dust skirt on the ground. (judged)
- A car blast radius is 8 m, a tank 12 m (src/systems/combat.js:49 to 58). On a 20 m wide street
  that is a small pop.
- The wreck vanishes 3 s after the blast and bodies fade after a few seconds (docs/STATUS.md,
  2026-11-20). Nothing you destroy stays. A burnt hull that sits and smokes is the proof that it
  happened.
- Debris is 6 to 10 chunks from a pool of 48; no doors, wheels or bonnet that can be recognised.
- Every person dies in one hit the same way. The ragdoll (src/render/ragdoll.js, 59 lines) turns
  the whole figure about its centre with loose limb angles; it is not a jointed body reacting to
  the direction and force of the hit.
- No hit-stop or kick on a normal kill; slow motion fires at most once per 6 s and only on special
  cases. No hit marker sound that differs from a miss.
- The player cannot die and has unlimited ammo by default, so nothing is at stake.
- Sound has been measured but never heard by a person (STATUS, known issues). A blast needs a
  sharp crack, a low thump and a tail; on a phone speaker the thump must be faked with mid
  harmonics.

Satisfying target: flash and light first (1 frame), fireball with dark smoke by 0.2 s, pressure
ring and dust, heavy parts thrown on arcs, camera kick sized by distance, a burning hull for at
least 60 s, a scorch that stays, people thrown away from the blast, and a three layer sound. A
kill needs a body that reacts to the hit direction, a short freeze of 2 to 3 frames, and a sound
cue.

### 1e. The map

- Scale: 9.0 by 7.8 km, larger than can be dressed. 62 % bare tile.
- Roads: 7,045 edges, 466 names, 1,432 signals. Road markings were added in the polish pass, but
  there are no driveways, alleys, car parks or kerb cuts.
- Buildings: 33,077 boxes, 8 styles (office, brick, stucco, glass, house, shed, hangar,
  container), 6 districts. 23,323 of them are plain stucco, brick or office boxes in "residential"
  or "midtown".
- Variety: districts differ by wall colour and window pattern only. No beach, no stadium shape, no
  elevated rail, no bridges with height (flat world), no shop fronts outside the island style.
- Landmarks: 23 map landmarks, mostly labels on ordinary boxes. Some carry real venue names
  (STATUS commit 55c54d9), which is a trademark risk for a published game and against the "must
  stay original" rule.
- What the player sees from a street: correct street grid, pastel boxes, lamps, a few palms, then
  tile to the horizon.

### 1f. Menus and HUD

Inventory (src/ui): pause menu with sections Resume, Scores, Records, Settings, How to play
(menu.js); first-run "Choose steering" dialog; HUD speed, health meter, score, wanted stars,
toasts, district name (hud.js); minimap and full map (minimap.js, systems/mapui.js); touch layer
with steering wheel or pad, GAS, BRAKE, HAND, EXIT or ENTER, FIRE, the "more" fan, LOCK, weapon
wheel on SWAP (touch.js, wheel.js); combat and tank HUDs (combathud.js, tankhud.js, armsctl.js).

Failing behaviours, in plain words:

1. Settings is one long scroll of about 22 controls with no groups: steering style, sensitivity,
   handling, five sound controls, radio, time of day, invert stick, left-handed, police, hard
   mode, map, HUD mode, graphics, new game, reset progress (menu.js:340 to 600).
2. The Map row's button reads "Miami (restart)" (menu.js:511). It looks like a button that
   restarts Miami, not a choice between maps.
3. Records and Scores split the same kind of numbers over two tabs; Records even ends with a note
   sending the player to Scores (menu.js:337).
4. New game and Reset progress, two destructive buttons, sit at the bottom of the same scroll list
   as the volume sliders.
5. The speed readout sits on top of the player's car at bottom centre (owner's screenshot: "2 mph"
   over the van's shadow).
6. The score is pale grey on a pale sky, top right, hard to read.
7. HAND sits a few pixels from BRAKE and the "more" button floats between them and the car; three
   sizes of round button and two square pedals with no shared grid.
8. The steering wheel is about 165 CSS px wide, 18 % of the screen, and covers the lower left of
   the road view.
9. A black bar about 37 CSS px wide on the left: the page does not draw the world under the camera
   cut-out even though `viewport-fit=cover` is set (src/index.html:5).
10. The minimap shows green where the world is grey (see 1a).
11. There is no title screen flow that lets the player choose "start downtown" over "continue
    where I left off".
12. scripts/ui-test.mjs checks overlap in a harness page (scripts/ui-harness.html), not the
    running game, with no safe area insets, and takes over 170 s. It passes while the items above
    are visible on the phone.

Items 5 to 9 are from one screenshot; W4 starts with a full audit at 780x360 and 915x412 with a 40
px left inset to confirm and extend.

### 1g. Other gaps against a "could be published" bar

- Never tested on the real phone since the overhaul (STATUS, known issues). Every look and feel
  claim so far rests on a software renderer at pixel ratio 1.
- Draw calls: 249 at the Miami spawn by day, but 417 on the island street and 544 in a heavy fight
  against a budget of 420.
- Start-up: 4.7 s to the first frame on the test machine, heap 167 to 177 MB, a 2.4 MB map file.
- Version: package.json, android/package.json and android/native/version.properties all say 0.3.1
  (code 4), and the rule to bump on every publish is written in STATUS. But nothing enforces it:
  there is no script that bumps all four values and no check that fails a publish when the version
  equals the published one. Publishing is a push to the default branch
  (.github/workflows/pages.yml), so every push is a release.
- No screenshot review gate. Dozens of one-off `*-shots.mjs` scripts, several still aimed at the
  island by default (MAP.md deviation 5).
- Spec drift: docs/SPEC.md still describes an invented island; the default game is a real city.
  PLAN.md and STATUS.md are logs, not a current plan.
- Real names: street names are fine; venue brand names should go.
- Sky is a flat gradient with blob clouds; shadows are blocky.

## 2. Target experience

Each line has a check. "Perf view" means scripts/perf.mjs at the named spot, 915x412, pixel ratio
1.

World (check: test/world-density.test.js, scripts/review-shots.mjs)
- Playable area is a dressed core of about 4.5 by 4 km (Downtown, Brickell, the port edge, Little
  Havana east, Wynwood south, the near bay islands). The rest of the box is far scenery or cut.
- Bare paving with nothing on it is under 10 % of core land (now 62 %). Every lot has a type:
  yard, car park, plaza, vacant grass, works yard, beach, and is dressed for it.
- At every road node in the core: at least 15 buildings within 150 m at the 10th percentile (now
  11 over the whole box), and no road node more than 60 m from a building or a dressed lot
  feature.
- Spawn street: at least 40 buildings within 150 m (now 69), at least 12 trees, 6 parked cars and
  4 moving cars in view at start.
- At least 5 districts that differ in building height, lot type, tree type and street furniture,
  and 12 landmarks with invented names and their own shapes, each visible from 600 m.
- Play always starts on a designed street view unless the player taps Continue.

Cars (check: test/carmesh.test.js, scripts/vehicle-shots.mjs)
- 9 road vehicles with 9 distinct silhouettes at 50 m.
- Paint reflects sky and street; wheels have rims with depth; lamps glow at night; a simple
  interior shows through glass.
- Near model 6,000 to 9,000 triangles, mid model under 1,500.
- No visible stair-steps at the phone's working resolution: either MSAA on or a post edge filter,
  pixel ratio floor 1.0.

Handling (check: test/handling-bands.test.js)
- One default mode. Lateral grip 0.9 to 1.1 g for ordinary cars, up to 1.3 g for the sports cars,
  at 15 and 30 m/s.
- Turning radius at walking pace 5 to 6.5 m (truck 9 to 11 m).
- Centre to full lock 0.25 to 0.40 s; back to centre 0.20 to 0.30 s.
- 0 to 60 mph: compact 9 to 11 s, sedan 7.5 to 9 s, sports 3.5 to 4.5 s, van 11 to 13 s. Top
  speed: compact 95 to 105 mph, sedan 110 to 120, sports 150 to 165, van 85 to 95. 60 to 0 mph in
  34 to 42 m.
- Touch wheel: half thumb travel gives 40 to 55 % of lock (now about 33 %). A slalom test (cones
  18 m apart at 20 m/s) passes with a scripted thumb limited to 300 degrees per second.
- Two steering styles (wheel, buttons). Tilt and slider go.

Combat (check: test/blast.test.js, test/combatfx.test.js, scripts/combat-e2e.mjs, review shots)
- Car blast: flash, fireball with smoke, ring, dust, light on surroundings; visible radius at
  least 12 m; at least 14 parts thrown with 4 that can be recognised (door, wheel, bonnet,
  bumper).
- The burnt hull stays at least 60 s (at most 6 at once) and smokes; the scorch stays 120 s.
- A person hit falls away from the shot or blast; bodies stay 30 s.
- A kill gives a 2 to 3 frame freeze and a distinct sound.
- Heavy fight view under 520 draw calls.

Menus and HUD (check: scripts/ui-test.mjs against the running game)
- Pause menu: 4 sections (Resume, Stats, Settings, Help). Settings has 4 groups (Controls, Sound,
  Game, Display) of at most 6 rows each; no group scrolls at 780x360.
- Every touch target at least 48 CSS px; no two elements overlap at 780x360 and 915x412, each with
  left insets of 0 and 40 px.
- Speed and score never cover the player's craft; text contrast at least 4.5 to 1 against sky and
  road.
- The world draws under the camera cut-out; controls stay clear of it.
- Destructive actions live on their own screen with a confirm.

Performance and quality (check: scripts/perf.mjs, npm run smoke)
- Street view at most 420 draw calls and 600k triangles; step under 2 ms; first frame under 6 s on
  the test machine; no page errors; no outside requests.
- On the phone: median 55 frames per second or better on a 2 km drive, never under 30 for more
  than half a second.

## 3. Change plan

Tiers: Haiku for mechanical edits, Sonnet for standard work from a complete brief, Opus for hard
scoped work, Fable for design decisions only. Note: STATUS decision 6 records that the owner
stopped using Fable; see decision D7.

Total estimated implementation spend: 3.0M to 4.3M tokens. For scale, the two earlier stages cost
3.5M and 3.2M.

| milestone | version | workstreams | spend |
|---|---|---|---|
| M1 First impression | 0.4.0 | W0, W1, W2, W3, W4, R1 | 1.6M to 2.2M |
| M2 Feel | 0.5.0 | W5, W6, W7, R2 | 0.9M to 1.3M |
| M3 Publishable | 0.6.0 | W8, W9, W10, R3 | 0.5M to 0.8M |

### W0. Design decisions and contracts (Fable, 60k to 100k)
- Goal: fix the things every other workstream needs: the core area rectangle, the lot data
  contract (`city.lots`: rect, type, district, seed), the handling bands in section 2, the menu
  map, the HUD grid.
- Owns: docs/REVAMP.md, docs/SPEC.md, docs/UI.md.
- Depends on: owner answers D1 to D7.
- Done when: SPEC matches the real game; the contracts are written with field names; W1 to W4
  briefs can be cut without questions.

### W1. World data: core area and lots (Opus, 450k to 600k)
- Goal: a dense, dressed core. Classify every piece of non-road land into lots with a type; place
  yard fences, hedges, driveways, car park bays with parked cars, lot trees, bins, plaza
  furniture; cut the play area to the core; invented landmark names; a designed start view.
- Owns: src/world/miami.js, src/world/miami-spots.js, new src/world/lots.js, src/world/maps.js,
  scripts/fetch-map.mjs, test/miami*.test.js, new test/world-density.test.js.
- Depends on: W0.
- Acceptance: the World criteria in section 2; whole build under 3 s in node; all existing Miami
  tests pass or are changed on purpose.
- Check: `npm test` (world-density), scripts/map-test.mjs.

### W2. World render: ground, lots, distance, sharpness (Opus, 450k to 600k)
- Goal: draw what W1 describes. Ground material per lot type (grass, asphalt with bays, concrete,
  sand, dirt); lot props merged per tile; far buildings with windows and roofs from 340 m out;
  pixel ratio floor 1.0 with edge smoothing; softer shadows near the camera.
- Owns: src/render/citymesh.js, realcity.js, buildings.js, miamilook.js, props.js, textures.js,
  adaptres.js, graphics.js, scripts/perf.mjs, test/miamilook.test.js, test/adaptres.test.js.
- Depends on: W0 contract; runs in parallel with W1 against a fixture of lots, then integrates.
- Acceptance: street view at most 420 calls and 600k triangles; no bare tile in the five review
  views; tile build slice under 5 ms.
- Check: scripts/perf.mjs, scripts/review-shots.mjs.

### W3. Driving feel (Opus, 300k to 400k)
- Goal: one believable default. New grip, steering rate and lock curves to the bands in section 2;
  a gentler touch curve; wheel tracking that does not drop out; camera that leans and lags to show
  weight; remove tilt and slider; keep a "Sport assist off" switch in place of the Sim mode.
- Owns: src/entities/vehicle.js, src/core/input.js, src/render/chasecam.js, src/systems/traffic.js
  (planner constants that copy the lock curve), test/vehicle.test.js, test/steering.test.js,
  test/chasecam.test.js, new test/handling-bands.test.js.
- Depends on: W0 bands. Parallel with W1, W2, W4.
- Acceptance: every band in section 2; traffic and police still complete their laps (existing
  tests); slalom test passes.
- Check: `npm test`.
- Note: W3 hands W4 the list of steering styles and the touch curve function; W4 owns touch.js and
  wires them.

### W4. Menus, HUD and touch layout (Fable layout in W0, then Sonnet, 300k to 400k)
- Goal: the Menus and HUD criteria in section 2. Audit first, then regroup Settings, merge Records
  into Stats, move destructive actions, one HUD grid, speed and score moved off the craft,
  safe-area drawing, minimap colours from the lot types, Continue or Start downtown on the title
  screen.
- Owns: src/ui/menu.js, hud.js, styles.js, touch.js, minimap.js, wheel.js, combathud.js,
  tankhud.js, armsctl.js, src/systems/mapui.js, src/index.html, scripts/ui-test.mjs,
  scripts/ui-harness.html, scripts/menu-test.mjs.
- Depends on: W0 menu map; W3's style list (late, small).
- Acceptance: ui-test runs against the built game at both sizes and both insets with zero overlaps
  and zero targets under 48 px; menu counts as in section 2.
- Check: `node scripts/ui-test.mjs`, review shots of pause and HUD.

### W5. Cars (Opus, 350k to 500k)
- Goal: the Cars criteria. Distinct silhouettes, wheel and lamp detail, interior card, street
  reflection (a small shared cube or matcap), dirt and damage that read at 20 m.
- Owns: src/render/carbody.js, vehiclemesh.js, vehiclemats.js, loft.js, hullkit.js,
  scripts/vehicle-shots.mjs, scripts/vehicle-perf.mjs, test/carmesh.test.js.
- Depends on: M1 published (so the cars are judged on the new street).
- Check: test/carmesh.test.js triangle bands, vehicle-perf, shots.

### W6. Combat feel (Opus, 350k to 500k)
- Goal: the Combat criteria. New fireball, lit surroundings, burning hulls that stay, recognisable
  parts, directional falls, kill freeze, sound layers.
- Owns: src/systems/combat.js, src/render/combatfx.js, effects.js, ragdoll.js,
  src/core/ragdoll.js, src/systems/cinematic.js, src/audio/combatsounds.js, test/blast.test.js,
  combatfx.test.js, ragdoll.test.js, cinematic.test.js, scripts/combat-e2e.mjs.
- Depends on: M1. Parallel with W5 and W7.
- Check: named tests, combat-e2e, perf heavy fight under 520 calls.

### W7. Sky, light and water (Sonnet, 150k to 220k)
- Goal: layered clouds, a sun disc and haze, warmer light, softer shadow edge, sea colour at the
  seawall, night glow.
- Owns: src/systems/daynight.js, src/render/water.js, nightlights.js, scripts/sky-preview.mjs,
  test/daynight.test.js.
- Depends on: M1 (graphics.js is W2's in M1; W7 does not touch it).
- Check: test/daynight.test.js, review shots at noon, dusk, night.

### W8. Street life (Sonnet, 150k to 250k)
- Goal: fuller streets within budget: traffic and walkers scaled by district, cars in the W1 car
  parks, people on plazas.
- Owns: src/systems/peds.js, parked.js, src/systems/traffic.js (after W3 has finished with it),
  test/traffic.test.js, peds.test.js.
- Depends on: W1, W3. Runs in M3.
- Check: named tests; perf street view still within budget.

### W9. Release pipeline (Haiku for the scripts, Sonnet for the gate, 80k to 150k)
- Goal: one command to bump every version value; one command that runs every gate and writes the
  review shots; CI refuses a publish whose version equals the last published one.
- Owns: new scripts/bump-version.mjs, scripts/release-check.mjs, scripts/review-shots.mjs,
  scripts/smoke.mjs, package.json scripts, .github/workflows/*.yml, android/ version files,
  docs/STATUS.md.
- Depends on: nothing; can start in M1 and finish in M3.

### W10. Phone test fixes (Opus or Sonnet by item, 200k to 300k)
- Goal: fix what the owner finds on the real phone after each milestone. Reserved budget, spent
  only on reported items.
- Owns: whatever the item touches, one item at a time, never while another workstream holds the
  file.

### R1, R2, R3. Milestone reviews (Opus, 50k to 80k each)
- Read the diff, run every gate, look at every review shot, list defects against section 2. No new
  features.

Parallel sets: M1 runs W1, W2, W3, W4 together after W0 (W9 alongside). M2 runs W5, W6, W7
together. M3 runs W8 and W9, then W10. File ownership above is exclusive inside a milestone;
src/game.js and src/main.js belong to the coordinator, who applies the few wiring lines each
workstream asks for.

## 4. Risks and decisions

Decisions for the owner:

- D1. Real Miami streets or an invented city? Recommend: keep the real street grid, cut to the
  core, invent the landmark and venue names. Reason: the streets are what make it feel like Miami;
  brand names are the legal risk.
- D2. Whole 9 by 7.8 km box or a 4.5 by 4 km core? Recommend: core. Reason: a small dense map
  beats a large empty one, and the budget only dresses about 18 km2.
- D3. One handling mode or two? Recommend: one believable default plus an "assists off" switch.
  Reason: two modes meant neither was tuned.
- D4. Steering styles? Recommend: wheel and buttons only. Reason: four styles quadruple the
  testing and tilt fails on some phones.
- D5. Should wrecks and bodies stay? Recommend: yes, 60 s and 30 s with caps. Reason: things that
  vanish are the main "fake" signal.
- D6. Launch behaviour? Recommend: title screen with Continue and Start downtown, Start downtown
  first. Reason: the first view must be a designed one.
- D7. May Fable be used for W0 only (about 100k)? Recommend: yes. Reason: STATUS decision 6
  dropped Fable, but the contracts in W0 decide whether 3M of other work lands; if no, Opus does
  W0.
- D8. Budget: approve 3.0M to 4.3M in three milestones with a stop after each? Recommend: approve
  M1 (up to 2.2M) now, the rest after a phone test. Reason: both earlier stages ran over their
  cap.
- D9. Keep the classic island? Recommend: keep as is behind the setting, no new work. Reason: it
  is free and it still tests the shared code.
- D10. Default difficulty? Recommend: keep "cannot die" off by default for now, decide after W6.
  Reason: stakes matter, but only once combat feels right.

Top risks:

1. Lot dressing blows the phone budget. Mitigation: merge per tile and material, cap props per
   tile, measure with perf.mjs after each lot type, cut the core further before cutting quality.
2. Judged on a software renderer again. Mitigation: the owner plays each milestone build on the
   phone before the next starts; W10 is reserved for that.
3. Handling change breaks traffic, police and race AI that copy the lock curve. Mitigation: W3
   owns those constants and their tests.
4. Token overrun. Mitigation: per workstream caps as listed, stop and report at 80 % with the
   remaining list, no cap raised without the owner.
5. Saves from 0.3.x point outside the new core. Mitigation: an out-of-core session falls back to
   the start view; save version bump with a loader test.
6. Menu rework breaks hidden flows (first-run steering dialog, tilt fallback, map restart).
   Mitigation: ui-test drives the real game through each flow before and after.
7. Art in code hits a ceiling: lofted cars may never look modelled. Mitigation: W5 starts with one
   car taken to the bar and a go or no-go shot for the owner before the other eight.
8. Real map licence: the ODbL credit must stay visible in the menu and the store listing.
   Mitigation: a smoke check for the credit text.

## 5. Verification and release

Gates before every publish, all run by `node scripts/release-check.mjs` (W9); until that exists,
by hand in this order:

1. `npm run lint`: no errors.
2. `npm test`: all pass (498 today), including the new world-density and handling-bands tests once
   they exist.
3. `npm run smoke`: default page loads at phone size, 300 steps, no page errors, no outside
   requests, build time under 8 s.
4. `node scripts/ui-test.mjs`: no overlaps, no small targets, at 780x360 and 915x412, insets 0 and
   40 px.
5. `node scripts/perf.mjs`: street view at most 420 draw calls and 600k triangles; heavy fight at
   most 520 calls.
6. Screenshot review at 915x412, written to docs/preview/review/ and looked at by a person or a
   reviewing model against section 2: start view; a residential street; a car park lot; the
   waterfront; a causeway; a car close-up by day and by night; a car blast at 0.1 s, 0.5 s and 5
   s; a gunfight; the pause menu on each section; the HUD in car, on foot, in a boat and in a
   plane; the full map. Any view with bare tile, an overlap or a blocky edge fails.
7. The owner plays the build on the phone for milestone releases.

Version rule (from docs/STATUS.md, unchanged): every publish bumps `version` in package.json and
android/package.json, and `VERSION_CODE` (plus one) and `VERSION_NAME` in
android/native/version.properties. Patch number for fixes, minor number for a milestone. The
version shows on the splash screen and in the pause menu. W9 adds `node scripts/bump-version.mjs
patch|minor` and a CI step that fails when the version equals the latest published tag. Planned:
0.4.0 for M1, 0.5.0 for M2, 0.6.0 for M3, patch numbers for W10 fixes.

Rollback: every publish is tagged `v<version>` on the commit that was published. To roll back,
revert to the previous tag's tree in a new commit, bump the patch number (a rollback is still a
publish, and the service worker cache is keyed by version), run gates 1 to 4, publish. Saves: a
build never writes a save an older build cannot read without a save version bump; when the save
version rises, the loader keeps reading the old one and a rollback build ignores newer saves
instead of erasing them (test/save.test.js covers both directions).
