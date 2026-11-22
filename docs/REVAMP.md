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

Note (2026-11-22): the owner's decisions D1 to D10 changed three lines below (the cut to a core,
one handling mode, two steering styles). Section 6.0 lists the changes and section 6 wins.

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

### W11. Garages, adventures and session (added by decision D2; Opus, then Sonnet, 250k to 350k)
- Goal: the exploration layer of section 6.6 (12 garages, 16 adventures, explore cells, their
  save) and the session calls the title screen needs (section 6.8).
- Owns: see the M1 table in section 6.9.
- Depends on: W0; W1's lots for placement; W4's menu and map hooks; W3's three reward car specs.
- Acceptance: the tests named in section 6.6.
- Check: `npm test` (garages, adventures, explore), scripts/menu-test.mjs.
- Note: not in the M1 budget approved under D8; see section 6.10 item 1.

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

Decisions for the owner (answered 2026-11-22; the answers are in section 6.0):

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

## 6. Contracts (W0)

Written 2026-11-22. This section is the brief for every workstream. Where it differs from sections
2 to 4, this section wins. Numbers marked "measured" come from a node script run against
`createMiamiCity` on the current data. Values marked "start value" may be tuned by the owning
workstream as long as the named test still passes; everything else is fixed.

### 6.0 Owner decisions and what they change above

| id | decision | changes to sections 2 to 4 |
|---|---|---|
| D1 | Real Miami streets from src/world/data/miami.json, ODbL credit kept. Landmarks and venues get invented names wherever a real venue brand would appear. | none |
| D2 | The whole data box is playable and dressed. The world must reward exploration: garages and adventures (6.6). | Section 2 "the rest of the box is far scenery or cut" is void. No land is cut. New workstream W11. |
| D3 | Two driving modes, Arcade and Sim. Both must steer and brake accurately. | Section 2 "one default mode" and W3 "Sport assist off" are void. See 6.3. |
| D4 | All four steering styles stay: wheel, buttons, tilt, slider. Each must be accurate. | Section 2 "tilt and slider go" is void. See 6.3. |
| D5 | Wrecks stay 60 s, at most 6 at once. Bodies stay 30 s. | as section 2 |
| D6 | The title screen shows a designed view downtown with a Start button. Continue resumes the saved place. | See 6.4 and 6.8. |
| D7 | Fable is used for this design step only. | none |
| D8 | Milestone 1 is approved to build now. | W11 adds 250k to 350k to M1; see "open items" at the end. |
| D9 | The classic island stays as it is. No new work: no lots, garages or adventures there. | Every new system must work with `city.lots`, `city.garages` and `city.adventures` missing or empty. |
| D10 | "Cannot die" stays the default (`settings.mortal` false) until combat is rebuilt. Decide after M2. | none |

### 6.1 Core area and the whole-box rule

```
CORE = { x0: -2700, z0: -2700, x1: 2450, z1: 1900 }   // metres, x east, z south
BOX  = city.cut = { x0: -4505, z0: -3891, x1: 4505, z1: 3891 }
```

- Size 5.15 by 4.6 km. Measured inside CORE: 13.3 km2 of land, 6,971 building boxes, 1,811 road
  nodes (the box has 40.3 km2, 33,077 and 5,113).
- Reason: it is the old milestone 1 crop (`MIAMI_CROP`) pushed out to edges the data already uses.
  x -2700 and z -2700 are district rect edges in `MIAMI_SPOTS.districts`; z 1900 is the Brickell
  place edge; x 2450 is the east tip of Palm and Hibiscus Islands. It holds Downtown, Brickell
  north of Southwest 15th Road, Brickell Key, Overtown, Park West, Edgewater, Wynwood, the Miami
  River mouth, Watson, the west Venetian Islands, Palm and Hibiscus Islands and the west half of
  Dodge Island. Every course, ramp, secret, pier and the start view are already inside it.
- Export `MIAMI_CORE` from src/world/miami-spots.js (W1). `MIAMI_CROP` stays as a test option.
- `city.inCore(x, z)` returns true inside CORE (W1 adds it to the city object).

What the core means (D2 keeps the whole box playable, so the core is a quality tier, not a wall):

| rule | core | rest of the box |
|---|---|---|
| Land is cut | no | no |
| Every free land cell belongs to a lot with a type (6.2) | yes | yes |
| Bare paving with nothing on it (lot type `verge` plus any untyped cell) | under 10 % of land | under 15 % of land |
| Buildings within 150 m of a road node, 10th percentile | at least 15 | not tested |
| A road node more than 60 m from a building or a solid or tall lot feature | none | at most 2 % of nodes |
| Hand-placed content (start view, landmarks with their own shapes, courses, ramps, secrets) | all of it | none needed |
| Garages and adventures | 5 and 8 | 7 and 8 |
| Landmarks with invented names and own shapes, visible from 600 m | at least 12 | none needed |

Whole-box rule: there is one dressing function and it runs for any lot whose tile is built, in
the core or not. Outside the core nothing is hand tuned: what the generator gives is what ships.
Seen from the core, the rest of the box is far scenery (far blocks past 340 m as today). When the
player goes there, the same tiles build with the same lots. No code path may test `inCore` to
skip dressing; `inCore` is only for tests, for placing hand content and for the Continue check.

### 6.2 Lot contract (`city.lots`)

Module: new src/world/lots.js (W1). Pure, no three.js, no DOM. The island has no lots
(`city.lots` undefined); every consumer must treat that as "no lots".

Data shape. All lengths in metres, areas in m2, angles in radians, rects axis-aligned.

```
city.lots: Lot[]                       // index = lot id
Lot = {
  id: int,                             // index in city.lots
  type: string,                        // one of LOT_TYPES
  x0, z0, x1, z1: number,              // bounding rect of the lot's cells
  area: number,                        // m2 of cells that belong to the lot (cells * 25)
  district: string,                    // districtOf(centre): downtown midtown residential industrial docks park airfield
  place: string,                       // placeOf(centre), '' if none
  seed: int,                           // uint32, see "seed" below
  dress: string,                       // dressing set id, see the dressing table
  building: int,                       // index into city.buildings of the lot's main building, -1 if none
  edge: int,                           // id of the nearest road edge that touches the lot, -1 if none
  front: int,                          // side of the rect that faces `edge`: 0 +x, 1 +z, 2 -x, 3 -z
  core: boolean,                       // centre inside MIAMI_CORE
}

city.lotGrid = {                       // the ground truth for ground material and for clipping props
  x0, z0: number, cell: 5, w: int, h: int,   // same origin, cell and size as city.landGrid
  id: Int32Array(w * h),               // lot id per cell, -1 = road, pavement ring, building, water
  type: Uint8Array(w * h),             // index into LOT_TYPES + 1, 0 = no lot
}
city.lotAt(x, z) -> Lot | null
city.lotTypeAt(x, z) -> string | ''    // for the minimap, audio, peds, dust colour
```

```
export const LOT_TYPES = ['yard', 'carpark', 'plaza', 'grass', 'works', 'beach', 'park',
  'wateredge', 'site', 'verge', 'airfield'];
```

| type | meaning | ground | minimap colour (W4) |
|---|---|---|---|
| yard | private garden round a low building | lawn with a paved drive strip | #7d8f62 |
| carpark | surface car park | asphalt with painted bays | #6a6d72 |
| plaza | paved forecourt of a tall or public building | light paving slabs | #b8b0a2 |
| grass | vacant grass, landuse grass, road-side green | rough grass | #86965f |
| works | works yard, depot, container yard, boatyard | concrete and dirt patches | #8a8378 |
| beach | sand along a listed shore | sand | #d9c9a0 |
| park | public park or wood | mown grass with paths | #6f8f55 |
| wateredge | the strip beside the water that is not beach | seawall cap, riprap, boardwalk | #9a9a94 |
| site | building site (OSM building kind `construction`, or a seeded 2 % of large `grass` lots) | dirt | #a08a66 |
| verge | sliver too small or thin to dress | kerb paving | #8f8f8a |
| airfield | the Gullwing islet surfaces (existing `city.surfaces`) | as today | as today |

How lots are produced (W1, at city build, deterministic, no randomness beyond `lot.seed`):

1. Free cells. On the 5 m raster a cell is free when it is drawn land (`landGrid.data` = 1), is
   not within `edge.width / 2 + 4` m of a road edge (the road and its 4 m pavement), and its
   centre is not inside a building box.
2. Mask layers, stamped once: `parkMask` (data.parks kinds `park` and `forest`, plus the `park`
   district rects), `grassMask` (data.parks kind `grass`), `beachMask` (rects in the new
   `MIAMI_SPOTS.beaches`; W1 lists at least 2, one in the core, each on a real sandy or open
   shore), `shore` = `city.mainShore(x, z)` (metres to the water).
3. Regions. Flood fill free cells into road-free regions (the existing `floodBlock` pass).
4. Split a region into lots, in this order:
   a. Cells with `shore < SHORE_STRIP` (8 m): `beach` if in `beachMask` (the beach strip is 30 m
      deep there), else `wateredge`. One lot per 80 m run of shore.
   b. Cells in `parkMask`: `park`. Cells in `grassMask`: `grass`. One lot per connected piece,
      pieces over `LOT_MAX_AREA` are cut by the 80 m world grid.
   c. Every other free cell goes to the nearest building box in the same region if that box is
      within `LOT_REACH` (40 m, measured to the box edge). The cells that share a building make
      one lot, with `building` set.
   d. Free cells left over (more than 40 m from any building) form open lots: connected pieces,
      cut by the 80 m world grid when over `LOT_MAX_AREA`. `building` is -1.
   e. Any lot under `LOT_MIN_AREA` or with a bounding rect thinner than `LOT_MIN_WIDTH` becomes
      `verge`.
5. Type for lots from 4c and 4d, first rule that matches. `b` is the main building, `kind` its
   OSM kind (W1 carries `kind` from the data onto `city.buildings[i].osm`), `free` the lot area:

| order | condition | type |
|---|---|---|
| 1 | `b.osm` is `construction` | site |
| 2 | district `airfield` | airfield |
| 3 | district `industrial` or `docks`, or `b.style` in shed, hangar, container | works |
| 4 | `b.osm` in parking, garage, garages, retail, commercial, hospital, school, university, college, train_station and `free >= 600` | carpark |
| 5 | `b.h >= 30`, or `b.osm` in public, museum, library, church, cathedral, synagogue, hotel, cruise_terminal | plaza |
| 6 | district `residential`, or `b.kind` is house, or (`b.h <= 8` and box area `<= 300`) | yard |
| 7 | district `downtown` or `midtown`, no building, `free >= 600` | carpark |
| 8 | district `downtown` or `midtown`, with a building | plaza |
| 9 | no building, any other district | grass |

Named constants in lots.js (start values): `SHORE_STRIP = 8`, `BEACH_DEPTH = 30`, `LOT_REACH =
40`, `LOT_MAX_AREA = 6400`, `LOT_MIN_AREA = 100`, `LOT_MIN_WIDTH = 10`, `CARPARK_MIN = 600`.

Seed: `lot.seed = hash32(city.seed, round(cx / 5), round(cz / 5), typeIndex)` where cx, cz is the
centre of the bounding rect. It does not depend on the lot's index, so adding or removing other
lots never changes a lot's look. All dressing randomness is `createRng(lot.seed)`.

Dressing. A lot's features are not stored. They come from one pure function that both the
renderer and the collision and parking code call:

```
export function dressLot(city, lot, out = []) -> Feature[]
Feature = {
  kind: string,                 // see the list below
  x, z: number,                 // centre, metres
  heading: number,              // radians, 0 faces +x
  l, w, h: number,              // length along heading, width, height, metres (0 if not used)
  r: number,                    // collision radius for round solids, else 0
  solid: boolean,               // true: blocks cars and people (box l by w, or circle r)
  v: int,                       // variant picked from the seed (tree species, bin colour, paint)
}
FEATURE_KINDS = ['fence', 'hedge', 'wall', 'gate', 'drive', 'bay', 'tree', 'shrub', 'bin',
  'bench', 'planter', 'lamp', 'bollard', 'umbrella', 'stack', 'pallet', 'cabin', 'boat',
  'path', 'sign', 'towel', 'rock', 'pile']
```

- A feature is only emitted where `lotGrid.id` at its centre equals `lot.id` (so nothing lands
  on a road, in a building or in the water).
- `lot.dress` is picked at build time as `DRESS[lot.type][lot.district]` (a short list of set
  ids), entry `rng.int(list.length)` with `createRng(lot.seed)`. W1 writes the table; each type
  must have at least 2 sets and each of downtown, residential, industrial and park must have its
  own set for the types it contains (this is what makes districts differ).
- Minimum content per type (the density tests count these):

| type | must contain |
|---|---|
| yard | a boundary (fence, hedge or wall) on the sides that do not face the road, a `drive` from the road to the building, 1 to 4 trees or shrubs, a bin on 1 lot in 3 |
| carpark | rows of `bay` (2.5 by 5 m) with aisles 6 m wide, a lamp per 400 m2, a tree or planter per 300 m2, a boundary wall or hedge on the road side with one gap |
| plaza | planters, benches, bollards along the road side, 1 tree per 150 m2, umbrellas in downtown sets |
| grass | 1 tree or shrub per 250 m2, a `path` on lots over 1,500 m2 |
| works | boundary fence with a gate, `stack` (container stacks) or `pallet` or `cabin` to 20 % of the area, a `boat` on stands near the river |
| beach | `towel` and `umbrella` groups, a palm per 200 m2 at the back edge |
| park | 1 tree per 120 m2, paths, benches along paths, lamps |
| wateredge | a seawall cap along the water, bollards or a rail, a bench per 40 m, `rock` where there is no wall |
| site | fence all round with a gate, `pile`, `cabin`, a `stack` |
| verge | nothing (it is the only type that may be bare) |

- Caps (phone budget): at most 24 features per lot, at most 120 per hectare, at most 12 `solid`
  per lot. `dressLot` for one lot under 0.05 ms on the test machine (measured in the test).
- Parking: every `bay` is also added to `city.parkingSpots` at build time as `{ x, z, heading,
  lot: true }` (the field exists today), with at most 60 % of a car park's bays listed, chosen
  by the lot seed. The parked-car system then fills them with no change. W8 tunes the fill later.
- Correction (W2, owner approved): a `bay` is a row of bays (`l` = n x 2.5 m along `heading`, `w` = 5 m, split by `eachBay`), a single 2.5 by 5 m bay being the row of one; the renderer and the collision fill take both; collision shapes for all lots are made once at city build (`fillLotCollision`), not per tile.
- Collision: W2 adds a collision shape for each `solid` feature when its tile is built and
  removes it with the tile (the pattern src/render/props.js uses for trees today).

Fixture for W2: W1's first commit is lots.js with `LOT_TYPES`, `FEATURE_KINDS`, the `Lot` shape
and a first `dressLot`; until it lands W2 builds against its own fixture of 12 lots (one or more
of each type) in test/fixtures/lots-fixture.js that follows this contract exactly.

Acceptance (W1): new test/lots.test.js and test/world-density.test.js.
- Every free land cell has `lotGrid.id >= 0`; every lot id in the grid exists; no lot overlaps a
  road cell or a building.
- Building the city twice gives identical lots, seeds and `dressLot` output.
- The table in 6.1, and the spawn street numbers of section 2 (40 buildings in 150 m, 12 trees,
  6 parked cars in view).
- Share of land by type is printed; `verge` under 10 % in the core.
- City build under 3 s in node (1.76 s today, measured).

### 6.3 Handling contract

New file src/entities/handlingbands.js (W3): plain constants, imported by
test/handling-bands.test.js and by nothing at runtime. Units: m/s, m, s, g = 9.81 m/s2.
"mph" below is m/s times 2.23694. All measurements use `stepVehicle` at 1/60 s on dry ground with
no wind, starting from rest or from a settled speed.

```
export const MODES = ['arcade', 'sim'];                 // settings.handling, default 'arcade'
export const LAT_G_FACTOR = { arcade: [1.00, 1.12], sim: [0.88, 1.00] };  // times spec.grip
export const LAT_TEST_SPEEDS = [15, 30];                // m/s; a car whose top speed is under 36 uses 0.8 * maxSpeed for the second
export const LOCK_TIME = [0.25, 0.40];                  // s, centre to full lock, at 0 to 10 m/s
export const RETURN_TIME = [0.20, 0.30];                // s, full lock to centre, hands off
export const LOCK_TIME_FAST_MAX = 0.55;                 // s, at 30 m/s
export const MODE_BRAKE_DIFF = 0.05;                    // Arcade and Sim stopping distance within 5 %
export const MODE_STRAIGHT_DIFF = 0.03;                 // 0 to 60 and top speed within 3 %
export const BANDS = {                                  // [min, max]
  compact:  { r0: [5.0, 6.5],  t60: [9, 11],     top: [95, 105],  stop: [34, 42] },
  sedan:    { r0: [5.0, 6.5],  t60: [7.5, 9],    top: [110, 120], stop: [34, 42] },
  taxi:     { r0: [5.0, 6.5],  t60: [7.5, 9.5],  top: [110, 120], stop: [34, 42] },
  police:   { r0: [5.0, 6.5],  t60: [6, 7],      top: [130, 140], stop: [33, 40] },
  sports:   { r0: [5.0, 6.5],  t60: [3.5, 4.5],  top: [150, 165], stop: [30, 36] },
  ghostwake:{ r0: [5.0, 6.5],  t60: [3.3, 4.3],  top: [165, 180], stop: [30, 36] },
  muscle:   { r0: [5.0, 6.5],  t60: [5, 6],      top: [130, 145], stop: [34, 42] },
  pickup:   { r0: [6.0, 7.5],  t60: [9, 11],     top: [95, 105],  stop: [36, 44] },
  van:      { r0: [6.0, 7.5],  t60: [11, 13],    top: [85, 95],   stop: [40, 46] },
  truck:    { r0: [9.0, 11.0], t60: [18, 24],    top: [65, 75],   stop: [46, 55] },
};
// r0: radius (m) of the path of the car's centre at 2 m/s on full lock.
// t60: s from rest to 26.82 m/s. top: mph, reached within 90 s. stop: m from 26.82 m/s to rest.
```

The sports stop band (30 to 36 m) and the heavier vehicles' bands are deliberate exceptions to
the single 34 to 42 m line in section 2.

Car spec table: fields that change in `VEHICLE_SPECS` (W3). Start values; the bands are the law.

| id | grip | steerMax (rad) | lockRate (1/s) | returnRate (1/s) | maxSpeed (m/s) | mass (kg) |
|---|---|---|---|---|---|---|
| compact | 0.92 | 0.43 | 3.3 | 4.2 | 44.7 | 1100 |
| sedan | 0.95 | 0.48 | 3.3 | 4.2 | 51.4 | 1450 |
| taxi | 0.95 | 0.48 | 3.3 | 4.2 | 51.4 | 1500 |
| police | 1.05 | 0.49 | 3.6 | 4.5 | 60.4 | 1700 |
| sports | 1.18 | 0.45 | 3.8 | 5.0 | 70.0 | 1400 |
| ghostwake | 1.22 | 0.45 | 3.8 | 5.0 | 77.0 | 1350 |
| muscle | 1.00 | 0.48 | 3.3 | 4.2 | 61.5 | 1700 |
| pickup | 0.85 | 0.47 | 3.0 | 3.8 | 44.7 | 2100 |
| van | 0.82 | 0.45 | 2.8 | 3.6 | 40.2 | 2200 |
| truck | 0.70 | 0.42 | 2.5 | 3.3 | 31.3 | 7500 |

- `lockRate` and `returnRate` are new fields: units of full lock per second. The steer value
  moves toward the input at `lockRate` when moving away from centre and at `returnRate` when
  moving toward it. `1 / lockRate` must sit in `LOCK_TIME`, `1 / returnRate` in `RETURN_TIME`.
  They replace the per-mode `steerRate` and the 1.6 return factor. At speed the rate may fall,
  but never below `1 / LOCK_TIME_FAST_MAX`.
- `steerMax` is the true wheel angle at walking pace in both modes (`lockK` = 1 in both), so
  `wheelBase / tan(steerMax)` lands in the `r0` band.
- `power`, `firstGear`, `gears` and `brake` are tuned by W3 to hit `t60`, `top` and `stop`. The
  three reward cars of 6.6 are added by W3 from the table there.
- The Ghostwake top speed stays 10 % above the sports car.

What is the same in both modes (D3: accurate steering and braking in both):

1. Straight line: `t60` and `top` within 3 % between modes; `stop` within 5 %. ABS is on in both.
2. Steering timing: `lockRate`, `returnRate`, `r0`.
3. Input: the touch curve, all four steering styles, sensitivity, pedals.
4. Steering accuracy tests, run in both modes for sedan, sports, van and truck:
   - A1 linear: at 10 m/s a held steer of 0.25, 0.5 and 0.75 gives a path curvature within 12 %
     of that share of the curvature at 1.0.
   - A2 settle: a step from 0 to 0.5 at 20 m/s overshoots the final yaw rate by at most 15 %
     (Arcade) or 30 % (Sim) and stays within 5 % of it after 0.6 s (Arcade) or 1.0 s (Sim).
   - A3 mirror: left and right give the same radius within 1 %.
   - A4 straight: hands off at 30 m/s for 5 s drifts under 0.2 m sideways.
   - A5 lane change: 3.5 m sideways within 30 m of road at 20 m/s (truck 15 m/s), ending within
     0.4 m of the new lane centre and 3 degrees of straight, 1.5 s after the move.
5. Braking accuracy tests, both modes:
   - B1 linear: a brake input of 0.5 gives 45 to 55 % of the full-brake deceleration at 20 m/s.
   - B2 straight: a full stop from 26.82 m/s turns the car less than 1 degree and moves it less
     than 0.3 m sideways.
   - B3 no creep: after a stop with the brake held the car does not move; reverse keeps the
     rule the game has today.
   - B4 turn-in under brake: at 20 m/s, brake 0.6 and steer 0.5 together still give at least 60
     % of the curvature of steer 0.5 alone (the car must steer while braking).

What differs:

| item | Arcade (default) | Sim |
|---|---|---|
| Steady lateral grip on full lock | 1.00 to 1.12 times `spec.grip` | 0.88 to 1.00 times `spec.grip` |
| Tyre past its peak | force sags at most 6 % | force sags 18 to 22 % |
| Full steering input at speed asks for | 1.00 of lateral grip (the front never ploughs) | 1.10 of lateral grip (too much lock scrubs speed and runs wide) |
| Stability assist (yaw and slide correction) | on; body slip held under 8 degrees (rear drive 16) | off, apart from a light yaw damper; the car can spin |
| Traction control | on; drive is cut in a slide, no less than 30 % kept | off; rear drive cars step out under power |
| Handbrake | slide capped (slip 0.6 rad) and it recovers by itself | free; holds the slide until released |
| Weight transfer on the balance (lift off, trail brake) | half effect | full effect |
| Tyre squeal starts at | 1.3 times peak slip | 0.9 times peak slip |
| Rain | grip loss as today | grip loss as today, plus the sag above |

Nothing else may differ. The mode table in vehicle.js (`HANDLING`) keeps only the fields that
implement these rows. `lateralGrip(spec)` becomes `factor * spec.grip` with factor 1.06 (Arcade)
and 0.94 (Sim) as start values. Traffic, police and crew planners use `steerLock(spec, u)` from
vehicle.js and no private copy of the curve (today: traffic.js lines 243 and 663, police.js line
551); they drive the same in both modes because they stay under 0.6 g.

Touch curve and travel (src/core/input.js, W3):

```
export const STEER_STYLES = ['wheel', 'buttons', 'tilt', 'slider'];
export const CURVE_LINEAR = 0.85;
// Raw input x in -1..1 (right positive) to steering target in -1..1.
// Odd, strictly rising, wheelCurve(0) = 0, wheelCurve(1) = 1,
// wheelCurve(0.5) = 0.444 (band 0.40 to 0.55), slope at 0 is 0.85.
export function wheelCurve(x) -> number      // 0.85 * x + 0.15 * x^3, clamped
// How much thumb or phone travel is full lock for a style. sensitivity is
// settings.steerSensitivity, 0.5 to 1.5; more sensitivity means less travel.
export function steerTravel(style, sensitivity = 1) -> number
//   wheel: degrees of wheel turn, 110 / sensitivity
//   slider: CSS px from the bar centre, 90 / sensitivity
//   tilt: degrees of phone roll past the dead zone, 22 / sensitivity
//   buttons: seconds from centre to a full target, 0.30 / sensitivity
export function rawFromTravel(style, travel, sensitivity = 1) -> number   // clamp(travel / steerTravel, -1, 1)
```

`shapeSteer(x, sensitivity)` stays as a thin alias of `wheelCurve(x)` until W4 has moved touch.js
over. Sensitivity now changes travel only, never the curve shape. One filter rule for every
style: a style produces a target; the car's `lockRate` and `returnRate` are the only rate limit.
A style may not add its own smoothing, except the two named below.

| style | input mapping | acceptance (test/steering.test.js plus a slalom in test/handling-bands.test.js) |
|---|---|---|
| wheel | The thumb's angle about the wheel centre is summed from one pointer event to the next (`angleDelta`), starting at 0 where the thumb lands, so a touch never jumps the wheel. raw = summed degrees / `steerTravel('wheel')`. Inside 16 px of the centre the sum holds its value and tracking is kept. The pointer is tracked by id until it lifts, wherever it goes. On lift the target is 0. | 55 degrees gives raw 0.5 and a target of 0.40 to 0.55. A path through the centre core changes the target by under 0.02. 110 degrees is full lock. Slalom (cones 18 m apart, 20 m/s, Arcade, sedan) passes with the thumb limited to 300 degrees per second; in Sim it passes at 17 m/s. |
| buttons | LEFT and RIGHT. While one is held the target ramps from its current value toward -1 or 1 over `steerTravel('buttons')` seconds (this ramp is the one allowed input filter; it equals the car's own lock time so the two do not add up). Release: target 0. Both held: target 0. The keyboard uses the same mapping. | Hold to full lock takes 0.25 to 0.40 s measured at the car's wheels. A 0.10 s tap peaks between 0.25 and 0.40 of lock. Both held gives 0. The slalom passes with a scripted press and release driver. |
| tilt | `tiltAngle(beta, gamma, screenAngle)` gives the roll of the phone like a steering wheel. Dead zone 1.5 degrees, then raw = (degrees - 1.5) / `steerTravel('tilt')`, then `wheelCurve`. A low-pass with a 0.08 s time constant is the one allowed filter. If no orientation event arrives within 1.0 s of choosing tilt, or permission is refused, the game shows a toast, uses the wheel for this run and keeps the saved setting. | 12.5 degrees gives raw 0.5. Both landscape ways give the same sign. Lying flat gives 0. Noise of 0.5 degrees at rest gives 0. The fallback fires in a test with no events. The slalom passes with the roll limited to 60 degrees per second. |
| slider | A bar 180 px wide. raw = (pointer x - bar centre x) / `steerTravel('slider')`, then `wheelCurve`. Absolute: where the thumb lands is the value. The pointer is tracked by id until it lifts, even off the bar. On lift the target is 0. | 45 px gives raw 0.5. A pointer that leaves the bar still steers. Ends clamp at 1. The slalom passes with the thumb limited to 400 px per second. |

The first-run "Choose steering" dialog stays (W4), with the wheel as the default.

Chase camera (W3, src/render/chasecam.js): rolls up to 2 degrees into the turn and lags yaw by a
0.18 s time constant; pitch follows braking up to 1.5 degrees. Same in both modes. Off under
`prefers-reduced-motion`.

### 6.4 Menu map

Rules for every screen: rows are at least 48 CSS px high; no screen scrolls at 780x360 except
Help, the car list in the Garage screen and the two lists in Adventures; every screen has one
Back or Resume button at the same place (top left, 48 by 48); the version shows on Title and Help.

Confirm rules (the same everywhere):
- An action that erases or restarts something needs two taps. The first tap replaces the row's
  button with two buttons: "Cancel" in the place of the first button (so a double tap cancels)
  and a red "Yes, ..." button beside it.
- The armed state ends on Cancel, on leaving the screen and on closing the menu. No timer.
- Actions that need it: New game, Erase all progress, Switch map, Release car. Nothing else asks.
- The red button text says what goes: "Yes, new game", "Yes, erase everything", "Yes, switch to
  the classic island", "Yes, release the Selwick".

Screens:

| screen | reached from | rows |
|---|---|---|
| Title | launch | Game name. "Start" (primary). "Continue" (only when `game.session.canContinue()` is true). Credit line "Map data (c) OpenStreetMap contributors, ODbL". Version. See 6.8. |
| Pause: Resume (hub) | pause button | "Resume" (primary). Three tiles: "Adventures n / 16", "Garages n / 12", "Map" (opens the full map). On the island the first two tiles are hidden. |
| Pause: Stats | rail | One page that merges the old Scores and Records: total score, session best, best combo, best jump, air time, drift, near miss; distance, flights, races; medals count; secrets "n / 6" with the names found; explored "n %". Two columns, no tabs. |
| Pause: Settings | rail | Four group tabs: Controls, Sound, Game, Display (below). |
| Pause: Help | rail | How to play text (existing sections), credits with the ODbL line, version. May scroll. |
| New game | Settings, Game, "New game" row | Two rows, each with the confirm rule: "New game: back to the start street in the starter car. Score, garages and adventures are kept." and "Erase all progress: score, medals, secrets, garages, adventures and settings." |
| Map choice | Settings, Game, "Map" row | Two cards: "Miami" and "Classic island", the current one marked. Tapping the other arms the confirm ("Switching restarts the game. Your place on each map is kept."). |
| Garage | in the world, at a garage (6.6) | Car list and actions. |
| Garages | hub tile | List of the 12 garages: found ones by name and neighbourhood, unfound ones as "Unknown". Tap a found one: "Show on map". |
| Adventures | hub tile | "Active" list (name, current clue, "Track" button), "Done" list (name, reward), a line "Rumours to hear: n". |

Settings groups (4 groups, at most 6 rows each):

| group | row | control | save key |
|---|---|---|---|
| Controls | Steering | 4 choices: Wheel, Buttons, Tilt, Slider | `settings.steering` |
| Controls | Steering sensitivity | slider 50 to 150 % | `settings.steerSensitivity` |
| Controls | Handling | 2 choices: Arcade, Sim | `settings.handling` |
| Controls | Left-handed | switch | `settings.leftHanded` |
| Controls | Invert flying stick | switch | `settings.invertPitch` |
| Sound | Master | slider | `settings.master` |
| Sound | Mute all | switch | `settings.muteAll` |
| Sound | Music | slider (0 is off; the old music on or off switch is removed from the menu and `settings.music` is left true) | `settings.musicVol` |
| Sound | Sound effects | slider | `settings.sfxVol` |
| Sound | Ambience | slider | `settings.ambVol` |
| Sound | Car radio | choice: Off and the four stations | `settings.station` |
| Game | Police chases | switch | `settings.police` |
| Game | Hard: you can die | switch, default off (D10) | `settings.mortal` |
| Game | Map | button showing the current map name with an arrow; opens Map choice | (restart) |
| Game | New game | button with an arrow; opens New game | none |
| Display | HUD | 2 choices: Minimal, Full | `settings.hud` |
| Display | Graphics quality | 3 choices: Low, Normal, High | `settings.quality` |
| Display | Live day and night | switch | `settings.liveTime` |
| Display | Time of day | slider, greyed while Live is on | `settings.timeOfDay` |

No new settings keys. Menu API that W4 provides for W11 (so W11 never edits menu.js):
`menu.registerScreen({ id, title, render(body, api) })` and `menu.open(id)`; `api.back()`,
`api.confirmRow(label, yesText, onYes)` builds a row with the confirm rule.
Session API that W11 provides for W4 (so W4 never edits session.js): `game.session.canContinue()`,
`game.session.startFresh()`, `game.session.continueSaved()`, `game.session.newGame()`.

Acceptance (W4, scripts/menu-test.mjs and scripts/ui-test.mjs against the built game): every
screen above opens and returns; row counts as in the tables; no scroll at 780x360 outside the
three allowed lists; every confirm needs two taps and a double tap on the first button cancels;
the credit text is present on Title and Help.

### 6.5 HUD grid

Rectangles are `x, y, w, h` in CSS px, origin top left of the viewport, for the right-handed
layout with all insets 0. V is the viewport width, H its height.

Insets: `L, R, T, B` = `env(safe-area-inset-left, right, top, bottom)`; the test uses L = 0 and
L = 40 (the S24 Ultra camera cut-out in landscape), with R = T = B = 0.
- The canvas always covers the whole viewport, insets included. The world draws under the
  cut-out. No black bar may come from the page: `html`, `body` and `#ui` have no background and
  no padding; only HUD items are moved.
- Left-anchored items (minimap, speed, steering slot) move right by L. Right-anchored items
  (score, pause, the button cluster) move left by R. Top items move down by T, bottom items up
  by B. Centred items stay centred on the viewport.
- Left-handed: the steering slot and the button cluster are mirrored (`x' = V - x - w`). The
  minimap, speed, score, stars and pause do not move.
- In a normal Chrome tab the browser may keep its own bar beside the cut-out. The Start tap
  therefore asks for fullscreen (`requestFullscreen`), and the installed app uses display
  `fullscreen`; the grid is checked in that state.

Keep-out rect (where the player's craft is drawn): x 0.36 V to 0.64 V, y 0.40 H to 0.90 H. That
is `329, 165, 257, 206` at 915x412 and `281, 144, 218, 180` at 780x360. Nothing permanent may
touch it. Allowed inside it for a short time only: the aim reticle and hit marker, the weapon
wheel while held, the open "more" fan, toasts in their own strip above it.

| item | 915x412 | 780x360 | notes |
|---|---|---|---|
| Minimap | 8, 8, 84, 84 | 8, 8, 76, 76 | tap grows it to 170 (140) square from the same corner, shrinks after 5 s |
| Speed | 100, 8, 88, 44 | 92, 8, 80, 40 | always 8 px right of the minimap, also when it is grown; number 28 px bold, unit 11 px; in a craft only |
| Health (hard mode only) | 100, 56, 88, 12 | 92, 52, 80, 12 | under the speed |
| Stars | 383, 8, 150, 24 | 315, 8, 150, 24 | centred; only while wanted; cooldown bar 150 by 4 right under it |
| District and toasts strip | 290, 56, 335, 80 | 240, 56, 300, 72 | centred; clear of the speed readout when the minimap is grown; district title 3 s, toasts stack downward, never past the strip |
| Score | 691, 8, 160, 28 | 564, 8, 152, 26 | right aligned text; combo line 18 px high right under it |
| Pause | 859, 8, 48, 48 | 724, 8, 48, 48 | |
| Radio caption (talk station) | 8, 100, 180, 36 | 8, 92, 170, 32 | under the minimap; hidden while the minimap is grown |
| Prompt strip ("ENTER", "GARAGE", "TALK" hints) | 308, 376, 300, 28 | 240, 324, 300, 28 | centred, under the keep-out rect |
| Steering slot | 16, 240, 160, 160 | 16, 204, 140, 140 | holds one of: wheel (150 round, 136 at 780), two arrow buttons (72 by 72 each, 8 apart, bottom of the slot), slider bar (full slot width by 56, bottom of the slot), tilt bar (120 by 20, display only). The foot and flight sticks use the same slot. |
| GAS (THRUST) | 835, 316, 72, 88 | 708, 280, 64, 72 | |
| BRAKE (DOWN) | 751, 316, 72, 88 | 632, 280, 64, 72 | |
| EXIT or ENTER | 843, 248, 56, 56 | 716, 216, 56, 56 | above GAS; also GARAGE and TALK when offered |
| HAND | 759, 248, 56, 56 | 636, 216, 56, 56 | above BRAKE, a full 12 px (8 at 780) clear of it; car and boat only |
| FIRE | 671, 340, 64, 64 | 560, 288, 64, 64 | only when a weapon can fire |
| LOCK | 675, 272, 56, 56 | 564, 224, 56, 56 | above FIRE, only when there is something to lock |
| MORE | 843, 180, 56, 56 | 716, 152, 56, 56 | above EXIT |
| Fan (open) | 3 columns by 2 rows of 56 with 8 gaps, left of MORE: columns at x 779, 715, 651; rows at y 180, 116 | columns at x 652, 588, 524; rows at y 152, 88 | at most 6 fan items per mode; folds as today |

Per mode:
- Car and boat: everything above. Tank: FIRE and LOCK as above, HAND hidden, the tank HUD keeps
  its own dials in the left column under the radio caption, above the steering slot.
- On foot: the stick in the steering slot; FIRE takes the GAS rect; RUN takes the BRAKE rect;
  SWAP takes the HAND rect (hold opens the weapon wheel); the reload chip (48 by 48) takes the
  LOCK rect when the magazine is low.
- Plane and heli: stick in the steering slot; THRUST and DOWN (heli UP and DOWN) in the pedal
  rects; the weapon arc of docs/ARMS.md section 8 stays, limited to the box `V - 352 - R, H -
  220 - B, 352, 220` and it must not cover EXIT or MORE.

Rules:
- Touch targets: every hit box at least 48 by 48; primaries 56 or more. Idle shrink (85 %, 70 %
  opacity) applies to the drawn face only, as today.
- Gaps: at least 8 px between any two hit boxes; at least 8 px to the safe edge.
- Contrast: all HUD text is white (#ffffff) on its own dark pill, `rgba(0, 0, 0, 0.55)` or
  darker, radius 6. Over a white sky that gives 4.7 to 1. No bare text on the world.
- Full HUD mode: the fan stays open (so its 6 cells are permanent and must stay clear of the
  keep-out rect, which they do at both sizes), ammo panel under the score at `691, 60, 160, 40`
  (`564, 56, 152, 24`, which leaves 8 px above the fan row), clock under the health slot.
- Mirror check: with L = 40 the steering slot ends at x 216 (196 at 780), still left of the
  keep-out rect.

Acceptance (W4): scripts/ui-test.mjs loads the built game (not the harness page), at 915x412 and
780x360, each with L = 0 and L = 40, in every mode (foot, car, boat, plane, heli, tank), fan
open and closed, Minimal and Full, right and left handed. It reads `getBoundingClientRect` of
every HUD element and fails on: an overlap, a gap under 8, a hit box under 48, anything
permanent in the keep-out rect, anything inside an inset strip, a rect that differs from the
table by more than 2 px, text contrast under 4.5. Run time under 60 s.

### 6.6 Garages and adventures (W11)

Purpose (D2): give the player reasons to drive to every part of the box. No money, no shop.

Words: the existing list of up to 8 cars left behind (`session.garage`, src/core/garage.js) is
now called "left-behind cars" in text and comments; its save field and code stay. "Garage" from
here on means a place in the world.

#### Garages

World data (new src/world/garages.js, pure; `city.garages = placeGarages(city, spots)`; missing
on the island):

```
export const GARAGE_SEED = 7129;
export const GARAGE_FIND_R = 400;      // m: coming this close puts it on the map
export const GARAGE_USE_R = 7;         // m from `door`, speed under 3 m/s, to offer GARAGE
export const GARAGE_CARS_MAX = 24;
export const GARAGE_BONUS = 500;       // points for the first visit to each garage
Garage = {
  id: string,                 // 'g-downtown' ...; the allow-list GARAGE_IDS
  name: string,               // invented
  place: string,              // neighbourhood name from city.placeOf
  x, z, heading: number,      // centre of the shed and the way the door faces
  door: { x, z },             // middle of the door line
  bay: { x, z, heading },     // where a car taken out appears, on the forecourt
  footprint: { x0, z0, x1, z1, h },   // shed, 10 by 14 m, 4.5 m high
  walls: [{ x0, z0, x1, z1, h }],     // collision, as city.secretGarage has today
  known: boolean,             // on the map from the first launch
  locked: string | null,      // adventure id that reveals it, else null
  core: boolean,
}
```

The 12 garages. Anchors are start values; W11 may move one up to 300 m to find a legal spot.

| id | name | neighbourhood | anchor x, z | notes |
|---|---|---|---|---|
| g-downtown | First Street Lock-up | Downtown | -1300, 560 | `known`; within 350 m of the start view |
| g-brickell | Keyside Garage | Brickell | -1300, 1650 | |
| g-wynwood | The Paintshed | Wynwood | -2100, -2150 | |
| g-edgewater | Bayline Garage | Edgewater | -800, -1900 | |
| g-watson | Seaplane Sheds | Watson Island | 450, -500 | |
| g-allapattah | Northwest Yard | Allapattah | -3700, -2900 | |
| g-civic | Riverbend Garage | Civic Center | -3400, -700 | |
| g-havana | Ocho Lock-up | Little Havana | -3600, 1200 | |
| g-roads | Roads End Garage | The Roads | -2400, 2500 | `locked` by a-roads-end |
| g-design | Atelier Garage | Design District | -1100, -3600 | |
| g-beach | Sandbar Garage | Miami Beach | 3900, -1200 | `locked` by a-sandbar |
| g-key | Key Point Shed | Virginia Key | 2750, 3250 | `locked` by a-far-key |

Placement rule (deterministic): for each anchor, search lots within 300 m in order of distance
for the first lot of type `works`, `carpark`, `grass` or `site` that has a clear 16 by 22 m
rect touching a road edge that is not a bridge or a motorway class, at least 6 m from any
building, 30 m from any ramp, secret, course start or other garage, and 12 m inland. The shed
goes at the back of the rect with the door facing the road; the forecourt is the front 8 m.
Ties are broken with `createRng(GARAGE_SEED + index)`. The garage takes its rect out of the
lot's dressing (dressLot skips features inside any garage footprint plus 2 m). The Ghostwake
lock-up (`city.secretGarage`) is not one of the 12 and does not change.

What a garage does. Drive or walk to the door. The EXIT slot offers GARAGE. It opens the Garage
screen and pauses the game. Everything is free.

- Store: the car the player arrived in joins the collection (any `kindOfSpec` = 'car', taken
  from traffic or not; not a tank, boat or aircraft). At `GARAGE_CARS_MAX` the screen asks the
  player to release one first.
- Take out: pick any car in the collection. The car the player arrived in is stored first (or
  left on the forecourt if the collection is full), then the picked car appears on `bay` with
  the player in it, at full health. The collection is shared by all garages.
- Repaint: a grid of 16 colours plus the model's own colours; applies at once to the selected
  car, stored or just driven in.
- Favourite: a star toggle; at most one favourite. The favourite is the car the player starts
  in on "Start" (6.8) and after "New game".
- Release: removes a car from the collection (confirm rule). Reward cars cannot be released.
- "Word at the garage": one line under the list that names the nearest thing the player has not
  found yet (an unfound garage that is not locked, or an adventure not yet seen) and puts it on
  the map. One per visit, picked by distance, so it is the same for every player.

Garage screen layout (inside the 6.4 rules): left half, the car list as cards 2 across (model
name, colour swatch, star, "Reward" tag), scrolls; right half, the selected car's name and four
buttons (Take out or Store, Repaint, Favourite, Release), then the "Word at the garage" line.
Repaint replaces the right half with the swatch grid (swatches 48 by 48) and a Back button.

#### Adventures

World data (new src/world/adventures.js, pure; `city.adventures = placeAdventures(city)`;
missing on the island):

```
export const ADVENTURE_SEED = 9241;
export const ADV_SEEN_R = 300;         // m from the giver: the adventure appears on the map
export const ADV_FINALE_BONUS = 5000;  // for finishing all of them
AdventureDef = {
  id: string,                 // 'a-first-light' ...; the allow-list ADVENTURE_IDS
  name: string,               // invented
  kind: 'lookout' | 'clue' | 'hidden' | 'tour',
  place: string,              // neighbourhood, for the list
  core: boolean,
  giver: { type: 'start' | 'sign' | 'talker' | 'garage', x, z, garage: id | null, line: string },
  steps: Step[],              // 1 to 3
  order: 'any' | 'seq',       // 'tour' uses 'any', the rest 'seq'
  needs: string[],            // adventure ids that must be done first (usually empty)
  reward: { score: int, garage: id | null, car: id | null, route: id | null },
}
Step = {
  clue: string,               // at most 90 characters, never the coordinates
  x, z: number,               // resolved at build time from `at`
  r: number,                  // m: reach radius, 10 to 25
  minY: number | null,        // m: height needed (a roof or a flight), else null
  mode: 'any' | 'foot' | 'car' | 'boat' | 'air',
  at: { anchor: { x, z } } | { secret: id } | { ramp: id } | { garage: id } | { landmark: name }
     | { lot: type, near: { x, z }, within: number },
  stunt: 'bronze' | 'silver' | 'gold' | null,   // with at.ramp: land this medal or better there
  hint: number,               // m: radius of the fuzzy ring shown on the map for this step, 60 to 200
}
```

Kinds:
- lookout: reach a high or far point (a pier end, a causeway middle, a rooftop pad by
  helicopter, the far tip of an island). One step.
- clue: 2 or 3 steps in order; each step's clue describes the next place in words ("where the
  river meets the bay, under the last crane").
- hidden: find a tucked-away spot inside one fuzzy ring of 150 to 200 m (a yard behind a works
  lot, the back of a car park, a gap between buildings). One step with a small `r` (10 m).
- tour: visit 3 named places in any order.

The set: 16 adventures, 8 in the core and 8 outside, at least 3 of each kind, at least one in
each of the 12 garage neighbourhoods. W11 writes the 16 definitions (names, clues, anchors) to
this shape. Fixed by this contract:

| id | kind | where | reward beyond score |
|---|---|---|---|
| a-first-light | lookout | the end of the Bayfront Marina pier, 600 m from the start; `giver.type` 'start' (known from the first launch) | none; teaches the system |
| a-roads-end | clue | starts at g-havana, ends in The Roads | garage g-roads |
| a-sandbar | tour | three points along Miami Beach | garage g-beach |
| a-far-key | lookout | the north point of Virginia Key | garage g-key |
| a-river-run | clue | Miami River, by boat (`mode` 'boat') | route boat-x-river |
| a-keys-dash | hidden | Brickell Key | route street-x-keys |
| a-beach-mile | tour | Miami Beach, needs a-sandbar | route street-x-beach |
| a-sunchaser | clue | Wynwood to the Design District | car sunchaser |
| a-tidewinder | hidden | Allapattah works yards | car tidewinder |
| a-nightheron | lookout | a Downtown rooftop pad, `mode` 'air' | car nightheron |
| 6 more | W11's choice, to meet the counts above | | score only |

Rewards:
- Score: lookout and hidden 1,000; clue and tour 1,500; all 16 done adds `ADV_FINALE_BONUS`.
  Paid through the score system as banked points (not lost on a crash).
- Places: the three locked garages.
- Routes: three extra courses in the shape of `MIAMI_COURSES.street` and `.boats` entries, kept
  in adventures.js as `ROUTE_SPECS` with ids `boat-x-river`, `street-x-keys`, `street-x-beach`;
  src/world/courses.js builds them with the others and marks them `locked: adventureId`;
  src/systems/activities.js hides a locked course until its adventure is done.
- Cars: three reward models added to `VEHICLE_SPECS` by W3 from this table (the Ghostwake
  pattern: an existing chassis and body, its own id, label and one colour):

| id | label | based on | changes | colour |
|---|---|---|---|---|
| sunchaser | Sunchaser | muscle | power plus 8 %, maxSpeed 64.0, grip 1.05 | 0xff5a1f |
| tidewinder | Tidewinder | pickup | power plus 15 %, maxSpeed 49.0, grip 0.92, health 1400 | 0x1f8a8a |
| nightheron | Night Heron | sedan | power plus 40 %, maxSpeed 58.0, grip 1.05 | 0x1a1a2e |

  They get bands in handlingbands.js like any car and their own bodies in W5.

How things are found:
1. Exploring. The box is cut into explore cells of 250 m (36 by 32). Entering a new cell that
   holds land sets its bit, pays 50 points with no toast, and updates "explored n %" in Stats.
   A garage appears on the map (grey marker, then its name on the first visit) when the player
   comes within `GARAGE_FIND_R`. An adventure appears (a "?" marker at the giver) within
   `ADV_SEEN_R`.
2. Signs. Each adventure with `giver.type` 'sign' has a notice board placed by the adventures
   system on the nearest `plaza`, `park`, `carpark` or `wateredge` lot to the giver point.
   Walking or driving within 4 m shows the giver line as a toast and marks the adventure seen.
3. Talkers. Each adventure with `giver.type` 'talker' has a person standing at the giver point
   (the adventures system's own static figure, drawn with the person mesh; src/systems/peds.js
   is not touched). On foot within 2.5 m the EXIT slot offers TALK; the giver line shows in the
   prompt strip for 5 s and the adventure is seen. At most 2 talkers exist at once (the two
   nearest within 200 m). A talker cannot be hurt and is hidden while the player is wanted.
4. Garages. "Word at the garage" (above), and `giver.type` 'garage' adventures start there.
5. Map. Seen adventures show a "?"; the tracked one shows its current step as a fuzzy ring of
   radius `step.hint` whose centre is offset from the true point by up to half the radius
   (offset from `createRng(ADVENTURE_SEED + index * 8 + stepIndex)`). Done adventures show a
   small tick. Locked garages show nothing until revealed. Markers come from a layer W11
   registers: `game.mapui.addLayer({ id, markers() })` (W4 provides this on minimap and full map).
6. Tracking. One adventure can be tracked; the objective arrow (src/systems/objective.js) points
   at the ring centre, not the true point.

A step is done when the player is within `r` of the true point in the right `mode` (and above
`minY`, and with the stunt medal when `stunt` is set, heard from the existing `stunt` event).
Reaching a step toasts the next clue; the last step toasts the reward.

Fit with the existing systems:
- Secrets (src/world/secrets.js, src/systems/secrets.js): unchanged. Ids, the 750 points, the
  12 m rule, `progress.secrets` and the Ghostwake all stay. A step may point at a secret
  (`at.secret`); arriving finishes the step and, as today, also finds the secret. Ghostwake is
  in the collection whenever `secrets.ghostwake` is true (derived, not stored twice).
- Stunt ramps (src/world/stunts.js): unchanged. A step may point at a ramp and ask for a medal.
- Courses (src/world/courses.js): the 14 existing courses are unchanged and never locked. Only
  the three `ROUTE_SPECS` are locked. Medals and best times use the existing maps keyed by id.
- Score (src/systems/score.js): all rewards go through it; single awards stay under `MAX_EVENT`.
- New events: `garageFound { id }`, `garageUsed { id, action }`, `adventureSeen { id }`,
  `adventureStep { id, step }`, `adventureDone { id }`, `explored { cell, percent }`.

Saving (new src/core/explore.js, pure, sanitised in the style of src/core/save.js):

```
export const EXPLORE_KEY = 'rustwater.explore.v1';   // its own localStorage key
export const EXPLORE_VERSION = 1;
defaultExplore() = {
  version: 1,
  garages: {
    found: [],            // garage ids visited, each once, allow-list GARAGE_IDS
    seen: [],             // garage ids shown on the map (found is a subset)
    cars: [],             // at most 24 of { spec, color, health, fav, reward }
    last: null,           // garage id last used, or null
  },
  adventures: {
    seen: [],             // adventure ids, allow-list ADVENTURE_IDS
    done: [],             // subset of seen
    step: {},             // id -> int steps done (seq) or bit mask (any), only for seen and not done
    tracked: null,        // id or null
  },
  cells: '',              // base64 of 144 bytes: one bit per explore cell (1,152 cells)
}
```

Sanitiser rules (`sanitizeExplore(raw)`), all tested:
- Not an object, a version that is not an integer, or text over 20,000 characters: defaults.
  A version above `EXPLORE_VERSION`: the data is left alone on disk and the game runs on
  defaults without writing (so a rollback build never erases a newer save).
- Id lists: strings on the allow-list only, each once, scan at most 64 entries.
- `cars`: each through `sanitizeCraft` of core/garage.js and `kindOfSpec` = 'car'; `fav` and
  `reward` are strict booleans; at most one `fav` (the first wins); at most 24.
- Derived, never trusted: `done` must be a subset of `seen`; `found` a subset of garage `seen`;
  a locked garage is dropped from `found` and `seen` unless its adventure is in `done`; a reward
  car is added if its adventure is in `done` and it is missing, and dropped if it is not;
  `step` values are clamped to the adventure's step count; `tracked` must be seen and not done.
- `cells`: must decode to exactly 144 bytes, else empty.
- Why a second key: the 0.3.x loader rebuilds the main save from known fields, so a rollback
  would silently drop new fields kept in the main save. A separate key is never touched by an
  older build. The main save stays at version 3 and is not changed by this work.
- "Erase all progress" clears both keys. "New game" keeps this one. Map switch keeps this one
  (it only holds Miami ids; on the island the systems are off).
- Written with the main save (on pause, on hide, on quit and after each change here).

Acceptance (W11): test/garages.test.js, test/adventures.test.js, test/explore.test.js.
- Placement: 12 garages and 16 adventures on the real data, identical on two builds; every
  garage rect is on land, off roads, clear of buildings, reachable (its door within 12 m of a
  road edge); every step point is reachable in its `mode` (on land for foot and car, in water
  for boat, clear air for air); 5 garages and 8 adventures in the core; no two garages within
  900 m; every step at least 150 m from its giver.
- Rules: store, take out, repaint, favourite, release and the full-collection case as pure
  functions on the explore state; a locked garage cannot be used before its adventure.
- A scripted run completes a-first-light and one clue adventure step by step and gets the score,
  the events and the unlock.
- Sanitiser: each rule above, hostile input (`__proto__`, huge arrays, wrong types), a newer
  version left untouched, round trip of a full state.
- Island: all three modules do nothing and the menu tiles are hidden.

### 6.7 Combat feel contract (W6, milestone 2)

Car blast, scale 1 (an ordinary car). Times are from the blast step; "s" is game time.

| layer | numbers |
|---|---|
| 1 Flash | frame 0 only: a white-yellow sprite 6 m across; one pooled point light, colour 0xffc870, range 30 m, full at 0 s, gone by 0.35 s; at most 2 blast lights alive |
| 2 Fireball | 3 additive billboards; radius 2 m at 0 s to 7 m at 0.25 s; colour white to yellow (0.1 s) to orange (0.3 s) to dark red (0.7 s); gone by 0.7 s |
| 3 Smoke roll | 8 to 12 dark puffs from 0.08 s, rising 3 m/s, spreading so smoke is seen to at least 12 m from the centre by 0.5 s; each lives 2.5 s |
| 4 Pressure ring | a ground ring from 0 to 16 m radius in 0.3 s, fading as it grows |
| 5 Dust skirt | 10 ground puffs thrown outward at 8 m/s, life 1.2 s, colour from `city.lotTypeAt` (sand, dirt, grey) |
| 6 Sparks | 24, life 0.4 to 0.9 s |
| 7 Parts | 14 to 18 per car from a pool of 96. Always 4 that can be recognised: a door, a wheel, the bonnet, a bumper (a second wheel and door when the pool allows). Launch speed 6 to 16 m/s, 35 to 75 degrees up, spinning; one bounce (0.3 of the speed kept); lie 20 s, fade 1 s. Seeded from the vehicle id. |
| 8 Scorch | a ground mark 9 m across, stays 120 s, fades 5 s, at most 8 |
| 9 Hull | the burnt body stays 60 s then fades over 2 s (D5); flames for the first 12 s, smoke the whole time; solid; at most 6 hulls, a seventh makes the oldest start its fade at once |
| 10 Camera | shake 1.0 at 0 m falling in a straight line to 0 at 60 m, for 0.5 s; the existing blast camera (40 m) stays; both off under reduced motion |

Scale by craft (`craftBlast` in src/systems/combat.js): the damage radius becomes car 10 m,
heavy car (2,500 kg or more) 11 m, heli 12 m, plane 12 m (fighter 13 m), tank 14 m; visual
scale 1, 1.1, 1.2, 1.3, 1.5 multiplies the sizes in layers 1 to 5 and 8. `CRAFT_PUSH` 12 to 14.
Budget: a blast adds at most 9 draw calls while it burns and 2 per hull after; a heavy fight
stays under 520.

Body fall direction rule. For every killing hit the code computes one unit vector `d` on the
ground plane:
- gunshot: the direction the shot travelled;
- blast: from the blast centre to the victim (a random seeded direction if they are within 0.2 m);
- vehicle: the vehicle's velocity direction.
The body moves along `d` and ends lying along `d`: the line from feet to head is within 25
degrees of `d`. Start speed along `d`: bullet 1.5 m/s (shotgun 4), vehicle 0.6 times the closing
speed up to 14, blast 6 + 10 * (1 - distance / radius) with 3 to 6 m/s upward. Hit from the
front (`d` against the way they face) they go down on their back, from behind on their face,
from the side on that side. Bodies stay 30 s then fade over 1 s (D5); at most 12, the oldest
fades early. Blood pools last as long as their body. test/ragdoll.test.js checks 16 directions
for each cause: travel along `d` is positive and the lying axis is within 25 degrees.

Kill freeze. A kill by the player within 60 m stops the simulation for 3 render frames
(`game.hitStop(3)`); a vehicle destroyed by the player, 4 frames. Not more than once per 0.25 s
of game time, never stacked past 4 frames, off under reduced motion. The loop simply runs no
simulation steps for those frames (no wall clock in logic). The existing slow motion (35 % for
0.8 s, at most once per 6 s) stays and starts after the freeze.

Sound hooks. New events from src/systems/combat.js; sounds in src/audio/combatsounds.js.

| event | payload | sound |
|---|---|---|
| `hit` | `{ x, z, kind: 'flesh' or 'metal' or 'miss', byPlayer }` | byPlayer and not a miss: hit marker, a 30 ms tick at 1.8 kHz, not positioned. `metal`: a short clank at the place. `miss`: the ricochet used today. |
| `kill` | `{ x, z, cause, byPlayer, dx, dz }` | byPlayer: the kill cue, two notes falling 660 to 440 Hz in 90 ms, not positioned, 40 ms after the hit marker. Always: a body fall thud at the place when the body lands. |
| `blast` | `{ x, z, r, scale, kind }` | three layers: crack at 0 ms (noise 2 to 6 kHz, 40 ms); thump at 0 ms (a 55 Hz drop with harmonics at 110, 165 and 220 Hz so a phone speaker carries it, 250 ms); tail from 60 ms (low filtered rumble, 1.2 s). The whole sound is delayed by distance / 340 s, at most 0.5 s. Music ducks 6 dB for 0.8 s when within 60 m. |
| `partLand` | `{ x, z, part }` | a metal clatter, at most 4 per blast |
| `hullBurn` | `{ id, on }` | a fire crackle loop at the hull, at most 2 loops heard at once, the nearest win |
| `shot`, `reload`, `shockRing`, `vehicleRemoved` | as today | as today |

Defaults: `settings.mortal` stays false (D10). Unlimited ammo stays as today.

### 6.8 Title screen and first view

Designed street: the current spawn, Southeast 1st Street in Downtown, measured at x -1101, z 738,
facing east (69 buildings within 150 m, tallest 191 m). W1 exports it as:

```
MIAMI_SPOTS.startView = {
  spawn:  { street: 'Southeast 1st Street', x: -1100, z: 780, heading: 0 },   // snapped as today
  camera: { back: 22, side: 6, height: 7, lookAhead: 40, lookHeight: 6, fov: 55, dolly: 12, dollySpeed: 0.5 },
  time: 17.5,            // hours; fixed for the title
  weather: 'clear',
  traffic: 6,            // moving cars placed on the street at build
  parked: 6,             // kerb spots filled first
}
```

- Camera (W4 with the coordinator, using src/render/chasecam.js only through a new
  `setTitleShot(spec)` that W3 adds): it sits `back` metres behind the spawn point along the
  street, `side` metres toward the south kerb, `height` metres up, and looks at a point
  `lookAhead` metres ahead at `lookHeight`. It moves forward `dolly` metres at `dollySpeed`
  m/s, eases, and comes back the same way, for ever. The player's car is in the shot, lower
  centre. Under reduced motion it does not move.
- Time: 17:30, clear sky. The sun is low in the west, behind the camera, so the towers ahead
  are lit and the street has long shadows. The title ignores "Live day and night"; when play
  begins the clock jumps to the setting during the camera blend.
- World state on the title: the simulation runs (traffic, walkers, lights). Police are off, the
  player cannot be hurt, input does nothing, the HUD and touch layer are hidden.
- What must be in the first frame (test/world-density.test.js for the data, the smoke test for
  the frame): at least 40 buildings within 150 m; at least 12 trees and 6 parked cars inside
  the camera's view cone within 80 m; at least 4 moving cars in the cone within 120 m (the
  traffic system places `traffic` cars on the edges ahead of the spawn at build, from a fixed
  seed, in addition to its normal spawning); at least 6 walkers.
- Layout (CSS px, 915x412; at 780x360 the same rules): game name top left at `24 + L, 20`, 40 px
  high. "Start" 180 by 56 and "Continue" 180 by 56 side by side, 16 apart, centred, bottom edge
  24 above the safe bottom; Start is on the right and is the filled button. With no Continue,
  Start is centred. Credit line bottom left, 11 px. Version bottom right, 11 px. Nothing in the
  keep-out rect.
- Loading: the title shows as soon as the page does, on the plain boot colour, with Start
  disabled and reading "Loading". When the city is built the designed view fades in (0.4 s) and
  Start enables. First frame of the view under 6 s on the test machine.
- Start: asks for fullscreen, blends the camera to the chase camera over 1.2 s, shows the HUD
  and controls when the blend ends. The player is at the spawn in the favourite car (6.6), or
  the starter sedan in its first colour when there is none. If the saved session held a car, it
  joins the left-behind cars exactly as leaving a car does today. Score and all progress are
  kept. No confirm is needed, since nothing is lost.
- Continue: shown only when `game.session.canContinue()`: a saved session exists for the
  current map, its mode is not 'start', and its position is inside `city.cut` and on ground the
  mode can use (`isGround` for foot and car, water for a boat, any for aircraft). Tap: fade to
  black 0.3 s, restore the session as today, fade in 0.3 s. If the restore fails, fall back to
  Start and toast "Could not restore your place".
- Island (D9): the same title, with `city.spawn` and the same camera numbers; no other work.

Acceptance: the smoke test (W9 owns the script; the coordinator adds the checks) asserts the
title shows, Start begins play at the spawn within 2 s, Continue is absent on a fresh profile
and present after a saved run, and the credit text is on screen.

### 6.9 File ownership

One owner per file inside a milestone. A file not listed belongs to the coordinator. A
workstream that needs a line in someone else's file asks the coordinator, who applies it after
both sides agree on the interface named in this section.

Milestone 1 (0.4.0): W1, W2, W3, W4, W11 in parallel after W0; W9 alongside.

| workstream | files |
|---|---|
| W1 World data | src/world/miami.js, src/world/miami-spots.js, src/world/lots.js (new), src/world/maps.js, scripts/fetch-map.mjs, scripts/map-test.mjs, test/miami.test.js, test/miami-landmarks.test.js, test/miami-places.test.js, test/mapdata.test.js, test/maps.test.js, test/lots.test.js (new), test/world-density.test.js (new), docs/MAP.md |
| W2 World render | src/render/citymesh.js, realcity.js, buildings.js, miamilook.js, props.js, textures.js, adaptres.js, graphics.js, src/render/lotmesh.js (new), test/fixtures/lots-fixture.js (new), scripts/perf.mjs, test/miamilook.test.js, test/adaptres.test.js |
| W3 Driving feel | src/entities/vehicle.js, src/entities/handlingbands.js (new), src/core/input.js, src/render/chasecam.js, src/systems/traffic.js, src/systems/police.js (the lock curve line only), test/vehicle.test.js, test/steering.test.js, test/chasecam.test.js, test/traffic.test.js, test/handling-bands.test.js (new) |
| W4 Menus, HUD, touch | src/ui/menu.js, hud.js, styles.js, touch.js, minimap.js, wheel.js, combathud.js, tankhud.js, armsctl.js, src/ui/title.js (new), src/systems/mapui.js, src/systems/tutorial.js, src/index.html, scripts/ui-test.mjs, scripts/ui-harness.html, scripts/menu-test.mjs, test/wheel.test.js, docs/UI.md |
| W11 Garages, adventures, session | src/world/garages.js (new), src/world/adventures.js (new), src/world/courses.js, src/core/explore.js (new), src/core/garage.js, src/core/save.js, src/systems/garages.js (new), src/systems/adventures.js (new), src/systems/session.js, src/systems/activities.js, src/systems/objective.js, src/render/exploremesh.js (new), src/ui/explore.js (new: the Garage, Garages and Adventures screen bodies), test/garages.test.js, test/adventures.test.js, test/explore.test.js (all new), test/garage.test.js, test/save.test.js, test/courses.test.js, test/objective.test.js |
| W9 Release pipeline | scripts/bump-version.mjs, scripts/release-check.mjs, scripts/review-shots.mjs (all new), scripts/smoke.mjs, .github/workflows/*.yml, android/ version files |
| Coordinator | src/game.js, src/main.js, src/pwa.js, package.json, docs/STATUS.md, docs/REVAMP.md, docs/SPEC.md |

Interfaces between M1 workstreams (each side codes to these and nothing else):

| from | to | interface |
|---|---|---|
| W1 | W2, W4, W11 | `city.lots`, `city.lotGrid`, `city.lotAt`, `city.lotTypeAt`, `dressLot`, `LOT_TYPES`, `FEATURE_KINDS`, `MIAMI_CORE`, `city.inCore`, `MIAMI_SPOTS.startView`, `MIAMI_SPOTS.beaches` (6.1, 6.2, 6.8) |
| W3 | W4 | `STEER_STYLES`, `wheelCurve`, `steerTravel`, `rawFromTravel`, `setTitleShot` (6.3, 6.8) |
| W3 | W11 | the three reward specs in `VEHICLE_SPECS` (6.6) |
| W4 | W11 | `menu.registerScreen`, `menu.open`, `api.confirmRow`, `game.mapui.addLayer`, the GARAGE and TALK use of the EXIT slot through `touch.registerAction` (6.4, 6.5, 6.6) |
| W11 | W4 | `game.session.canContinue`, `startFresh`, `continueSaved`, `newGame`; hub tile counts `game.explore.counts()` giving `{ garagesFound, garagesTotal, adventuresDone, adventuresTotal, percent }` |
| W11 | W1 | garage footprints are passed to `dressLot` through `city.garages` (dressLot skips them); W11 builds after lots exist and never edits lots.js |

Order inside M1: W1 lands the lots.js shapes first. W11 starts with explore.js, the session API
and the pure rules (no dependency), then placement once W1's lots are in. W4 starts with the
audit and the grid, then wires W3's and W11's interfaces last.

Milestone 2 (0.5.0): W5, W6, W7 in parallel.

| workstream | files |
|---|---|
| W5 Cars | src/render/carbody.js, vehiclemesh.js, vehiclemats.js, loft.js, hullkit.js, scripts/vehicle-shots.mjs, scripts/vehicle-perf.mjs, test/carmesh.test.js |
| W6 Combat feel | src/systems/combat.js, src/systems/cinematic.js, src/systems/audio.js, src/render/combatfx.js, effects.js, ragdoll.js, src/core/ragdoll.js, src/core/loop.js (hit stop only), src/audio/combatsounds.js, test/blast.test.js, combat.test.js, combatfx.test.js, ragdoll.test.js, cinematic.test.js, scripts/combat-e2e.mjs |
| W7 Sky, light, water | src/systems/daynight.js, src/render/water.js, nightlights.js, scripts/sky-preview.mjs, test/daynight.test.js |

Milestone 3 (0.6.0): W8 and W9, then W10.

| workstream | files |
|---|---|
| W8 Street life | src/systems/peds.js, parked.js, traffic.js (W3 is finished with it), test/traffic.test.js, test/peds.test.js |
| W9 Release pipeline | as in M1 |
| W10 Phone fixes | one item at a time, only files no running workstream holds |

W8 may read `city.lots` and `dressLot` output (bays, plazas) but does not edit lots.js; a change
there in M3 goes through W10.

### 6.10 Open items for the owner

1. Budget. D2's garages and adventures are a new workstream (W11, about 250k to 350k, Opus for
   placement and save, Sonnet for the screens). With it M1 is 1.85M to 2.55M, above the 2.2M
   that D8 approved. Options: approve the higher cap, or ship M1 without W11 and build W11 first
   in M2.
2. The black bar beside the camera cut-out. In a normal Chrome tab the browser itself keeps
   that bar and a page cannot draw there. The contract fixes it for fullscreen (asked for on
   Start) and for the installed app. If Chrome refuses fullscreen the bar stays.
3. The three reward cars are new models on existing bodies until W5 gives them their own in M2.
4. Arcade is the default mode. If the owner prefers Sim as the default, it is one constant.
5. "Whole box playable" keeps Miami Beach, Fisher Island and Virginia Key at generator quality
   only (no hand work). If they look thin on the phone, W10 budget is the place to fix them.
