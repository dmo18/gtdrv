## Release rule

Every publish bumps the version: `version` in package.json and android/package.json (patch number for fixes, minor number for a new batch of features), `VERSION_CODE` and `VERSION_NAME` in android/native/version.properties, and the version shows on the splash screen and in the pause menu.

# Status

Last updated: 2026-11-20. The game is playable and published. Work is at
the final review and fix stage; nothing is in progress that blocks play.

## 0.14.1 tank fence and lows (2026-11-27, in the tree, no version bump)
- Tank and fence (fixed): the sweep finding (miami-west, lot:fence, tank, x -3012.5, z -233.7, 0.62 m) was a wedge: the fence converges on a building face and each body circle was resolved alone. `stepTank` (entities/tank.js) now checks both body circles after the resolve passes; if one still overlaps more than 0.12 m (WEDGE_DEPTH) it restores the pre-move position and removes the forward speed. Full sweep (--per 3, all regions, all crafts): 0 failing runs. Test: test/tank-fence-wedge.test.js.
- Service worker: the cache version hash now includes the sw.js template (`swVersion` in scripts/build.mjs), and a failed install deletes the cache only if it did not exist before the install. Tests: test/sw-cache.test.js.
- Travel: no storage at all gives "Saving is blocked in this browser. Turn on site data to travel." (`TRAVEL_NO_STORAGE`), no reload; a failing write still gives "Could not save, try again". Tests: test/travel-nostorage.test.js.
- Portrait start (game.js): the rotation gate only clears held input while the title (#boot) shows, so no pause menu opens behind it. Tests: test/launch-title.test.js.
- Knockout fade (ui/combathud.js): the "Knocked out" text toggles aria-hidden only (`setAriaShown`), so display none no longer cuts its opacity fade. `setShown` is unchanged. Tests: test/knockout-shell.test.js.
- Startup shell (main.js): an error after `__rwOk` is written to the visible message line, since the shell ignores failures once ready.
## 0.14.1 ci and daily (2026-11-27, in the tree, no version bump)
- Workflow (.github/workflows/pages.yml): new `smoke` job (`npm run smoke`) next to `check`, `continue-on-error`, 20 min limit, not a `needs` of publish. Why not blocking: smoke.mjs imports playwright but package.json does not list it (falls back to /opt/node-tools, which a runner lacks), and I may not add a dependency. The job installs `playwright@1.63.0` (the version in /opt/node-tools) with `--no-save`, then `npx playwright install --with-deps chromium`. Unverified on a runner (software WebGL speed, time). Lint, test and build are unchanged and still gate publishing. Owner decision: pin playwright as a devDependency, then move smoke into `needs`.
- combat-e2e (scripts/combat-e2e.mjs): pinned to `?map=miami-downtown` (has the airfield; Beach has none). Each case makes its craft (`__ensure` steps the fleet until the berth holds one; the tank is the 'rustback'), resets a reused fighter's water/crash state (a ditched fighter refused the bomb), waits out the 8 s car burn before asserting a wreck, locks the tank (`needLock`), starts the bomb run over land (350 m, not 500), and the feel case runs on the runway with its own person. Cases take a comma list (`missiles,bombs`). Result: all 16 assertions pass, alone and in the full run.
- Possible game defect, not fixed: a car held at 1 health burning that takes any crash hit (a bump on the street at the spawn) becomes a crash wreck with no blast, no parts and no hull (damageVehicle sets crashWreck). Reproduced by the old feel case at the spawn road.
- Daily Three (systems/daily.js): `refresh()` re-reads the date through the injected `now` and rebuilds the picks when the day changed; skipped while `streetEvents.active`, so a run in flight keeps its day and still counts. Called when the Daily screen renders and when the menu home tiles build (ui/menu.js), and on `visibilitychange` to visible. `day` and `picks` are getters. Test: midnight crossing and an active run (test/daily.test.js).

## 0.14.0 saves and records (2026-11-27, not yet published)
- Travel save (core/travel.js, systems/session.js): `travelSave` is all or nothing. It remembers the stored progress and map values and the in-memory session, writes both keys, and on any failure puts the earlier values back; `travelTo` then returns "Could not save, try again", holds nothing, writes no arrival note and does not reload. Tests inject blocked progress, blocked map key and all blocked; after recovery one departure succeeds.
- Records (core/records.js): `recordTry` makes the empty record (no medal, no best) on the first failed attempt, within the same event limit. Tests: five failures then a completion gives n=6 with the medal and best kept; saved-data validation accepts it. Two older tests expected no record after a failed first try and now expect the empty one.
- Service worker (public/sw.js): play files go in with one atomic `addAll`; icons and artwork (png, svg, ico, webp, jpg) one by one, failures ignored. A failed required file deletes the new cache and rejects the install, so the previous cache stays. Node test with a faked cache and fetch.
- Hints (systems/tutorial.js): the car steering line follows settings.steering (wheel, buttons, tilt, slider) and settings.leftHanded; the fighter says hold BOOST for afterburner; the map is top left.
- Combat HUD (ui/combathud.js): the "Knocked out" text sets hidden and aria-hidden with its visible state (`setShown`).
- Tests: test/saves-records.test.js.
## 0.14.0 launch and quality (2026-11-27, in the tree, no version bump)
- Continue (main.js): fullscreen and orientation lock no longer block restoring the saved game; `continueAfter` (core/launch.js) runs the restore exactly once when the browser promise settles, rejects, is absent, or after 1.5 s.
- Quality benchmark (core/qualitybench.js): 20 to 59 counted frames now give a verdict when the median is over 24 ms (Low); fast or stall-heavy runs with few frames still give none. 60 or more frames: unchanged.
- Rotation (game.js, core/launch.js `createRotationGate`): the portrait cover pauses the simulation and releases held controls (a window blur, which the touch layer already handles); only a pause the gate made is undone on return, a manual pause stays.
- Launch failure (index.html, main.js): inline shell script (CSP allows exactly its sha256; test checks the hash) with a window error listener, an unhandled rejection listener and a 25 s no-progress timer (re-armed when the page is hidden or the thread was blocked); the failed state stops the bar, shows plain guidance via textContent and a Retry button that only reloads. main.js startup catch calls it; progress calls reset the timer.
- Tests: test/launch.test.js. Not verified: real browser behavior (headless smoke not run), the failed state on a real WebGL loss, the rotation on a device.

## 0.13.9 hitches and start (2026-11-27, published)
- Owner on 0.13.7 (weak phone, Downtown): 397 frames over 33 ms, worst 83.7 ms, start 9.8 s. Measured with `scripts/perf-phonecheck.mjs --profile --passes 2` at 4x, Downtown and Beach (the script now prints a "top 10 frames" line: frame, excess, cause, top function). Before, Downtown drive top 10: 1090, 1091, 1089, 3564 street tiles 'roads' (geoSurface, pointInRing under citymesh.js cornerTri: cold narrow-gap net asks, one slice 104 ms); 1080 police (createSkin); 556 police/core; 1717 core (fixedUpdate); 1456 and 2012 new tile geometries (upload up to 1.2 MB); 522 map with a collection. Beach: 1082 combat's first hit (15 ms), 1081 the fixture's spawn.
- Junction corners and strips (render/citymesh.js, world/ground.js, render/realcity.js): `realJunctionJob` and `realEdgeJob` (realRoads per junction and per edge as generators; realRoads drives them straight) ask the ground through `surfaceTry` (the answer when it is cheap: off the net, or the net point known) and else `surfaceAtJob` (surfaceAt as a generator: stops between the net's probes and inside each cold first-round probe, `net1Job`, the clock read every 24 probes); the raised net's median test the same (`betweenMediansJob`); nqIsJob uses net1Job. Same answers and caches, so the same meshes: hash of every mesh of the 24 tiles nearest the spawn, Downtown and Beach, before = after; new test/hitches139.test.js (1500 points sliced against surfaceAt on fresh grounds; junctions and strips sliced with a stop at every ask against realRoads). Slices now labeled 'junction', 'edge', 'net'. Node, 24 Downtown tiles, worst slice 110.8 ms -> 5 to 10 ms (load dependent), total the same.
- Start tiles: a flush (budget Infinity) builds tiles unsliced (`tileJob(t, false)`: no clock, the ground asked straight; the slices' clock reads were about a tenth of the start tiles in a 4x profile). Node: 4 start tiles 921 -> 851 ms cpu (mean of 3).
- Combat's first hit: `warmCombat` (systems/combat.js), run by game.js after the first frames (`game.later`, one job a drawn frame): a throwaway combat on a stand-in game (own events, own empty collision world, own dice, a player in its own car holding fire at a crew car and a crew member, the drive-by aim assist, a blast, a knock-down, one simulated second). Nothing of the game changes (test: a seeded fight on the real city gives the same events and results before and after it); 8 ms at 1x the first time, 1 ms after. No mesh, no program. Beach drive: the fight frame's combat call 15.2 -> 6.4 ms (now the fixture's car spawn, generateUUID).
- Textures: normalFromHeight without a remainder per pixel (same pixels).
- Measured, 4x, 2 passes, profiled, load 4 to 10 (other jobs on the machine): Downtown drive frames over 15 -> 8, worst 79 -> 66 phone ms, worst tile work in a frame 104 -> 12 ms; Beach 4 -> 0, worst 61 -> 32 phone ms; programs 60 -> 60 both, no new program. Start in those runs: Downtown 13.9 -> 12.5 s, Beach 12.2 -> 9.8 s; alternating unprofiled runs at load 7 to 9: 12.7 to 15.7 s before, 11.6 to 15.1 s after (inside the machine's spread).
- 10 minute headless Downtown drive (1x, a route driver over the graph, forced collection each minute): no page error; no periodic hitch (gaps between slow frames irregular; two lone frames of 52 and 108 ms with no system over 0.5 ms: draw or a major collection). Heap 172 -> 212 MB driving into new streets (ground cells, lot dressing, net quads: per region, bounded); a drive that returns to the start every 2 minutes holds 186 to 188 MB from minute 2 to 10 (no leak). Textures 119 -> 135 to 141 (+1 to 2 every 2 minutes, slowing; created in play by the vehicle and effect files, not followed here).
- Not reached: start under 7 s at 4x. Profile of the throttled Downtown start (busy 15 s of 15.3 s): createMiamiCity 3.3 s (world/miami.js, not in this pass), start tiles 2.6 s (the ground's narrow-gap net, which the first view needs), buildRealCity 1.9 s (far level 0.8, whole-map props 0.6 of which 0.5 their ground heights), textures 1.4 s (one seeded stream in order, so a texture cannot be put off without changing every later one; the atlases' rects are read by the first tiles), graphics.js shader warm-up 1.6 s and the first draw 1.4 s (not in this pass), attachExplore 0.4, traffic seedStart 0.4. Still over: tile uploads (all of a tile's meshes go up in the frame it is shown; a frame of 14 new geometries, 1.2 MB, was 31 ms over at 4x), police heli spawn (25 ms at the fight), ragdoll posing (11 ms), score's first call (13 ms).
- Gates: eslint clean; npm test 1259 of 1259; smoke --extra 83 ok, no page errors, no network.

## 0.13.8 remaining hitches (2026-11-26, in the tree, no version bump)
- Left by "0.13.8 stutter and start": the net flood (world/ground.js netQuads, 30 to 50 ms at 4x a box), the check's first route (objective 30 ms), combat's first hit (a 61st shader program), the start (11 s at 4x).
- Net flood: `netQuadsJob` (ground.js), the same flood as a generator that stops whenever the tile slice's time is up, between cells and, inside a cell, between the second round's probes (one cold cell was 5 to 10 ms at 1x); its own seen set and lists, so boxes flooded between its slices change nothing. citymesh.js `netRoadsJob` (and a stop between raised quads, whose median test asks the ground), realcity.js tile job uses it. Worst piece of 200 Downtown boxes at 1x: 33 to 42 ms -> 1.4 ms, total the same; quads identical (hash of 200 boxes; test/stutter.test.js: two boxes interleaved a stop at every ask, plus another box between, against netQuads, and the mesh path).
- Route: core/route.js search in parts (`begin`, `step(budget)`: A* closes at most `budget` nodes a call, the fallbacks too; the route is only written when done, so the old guidance stays meanwhile; a newer search drops one under way). createTracker `{ budget }` (objective: ROUTE_BUDGET 150 nodes a step, about 1.5 ms on a slow phone; most searches fit, a search across Downtown takes about 10 steps; `settle` for the full map's tap, `searchSoon` for the U-turn replan). setAvoid asks the city's edge grid per gate (radius: the beam's half length plus the largest `off`): same edges and costs, 2500 edge tests a gate before. A throwaway search at load warms the search code (its first run was 3 ms at 1x). Routes identical (new test/hitches.test.js: 120 seeded Downtown pairs with a budget of 37 against the whole search, every field and turn; avoidance from the grid against a scan of every edge; the tracker with a budget against without); gps-audit and route tests unchanged and passing.
- Combat's first hit: the program was the gun in a person's hand (render/personmesh.js `gunMat`, a MeshStandardMaterial with no other user: frame 525 of the drive, police drawing). Now a MeshLambertMaterial of the gun's color, the program of the water and buoys that every region compiles at the warm-up. Programs in the drive 60 -> 61 before, 60 -> 60 now. New smoke check (smoke.mjs, Miami): out of the car, hold fire at the nearest person with draws between, programs unchanged and at most 60 (fails on the old gun: 61); smoke-extra's island fight checks no new program. perf-phonecheck prints how a program compiled in play differs from its nearest program (which material variant).
- Textures: noiseField and grain without a remainder per pixel (pixels identical: hash of all 36 canvas textures, both trees).
- Measured, same session, 4x, 2 passes, Downtown (perf-phonecheck, the tree before then this one; load 4 to 6): drive frames over 7 -> 4; programs 60 to 61 -> 60 to 60; worst calls: objective 13.9 ms at the drive's first frame -> not in the top eight, first play 32.5 -> 8.2; worst frame unchanged at 78 phone ms (frame 1323, a street tile: see below). Start 11.3 -> 11.6 s (four alternating runs each: 11.2 to 12.7 vs 11.2 to 16.2 s, within the machine's spread: no gain measured).
- Not reached: (1) the worst tile slices are now not the net flood but single ground asks from realRoads' junction corners (citymesh.js cornerTri `onRoad`, 100 ms at 4x on frame 1323) and the median test: `surfaceAt` there works out the net of a point where nothing near is known yet (up to thousands of probes); making those resumable is in citymesh.js (road meshes). (2) Combat's own first-hit step (11 ms at 4x, the same frame in both passes) is still there: spread over the hit's event listeners, not found. (3) Start: createMiamiCity (world/miami.js, 2.4 s at 4x) and attachExplore are not in this pass's files and their fingerprints are pinned; of what is here, the start tiles' net (1 s at 4x) is needed by the first view, the warm-up's craft meshes (0.9 s) by the 60 program rule. Nothing was deferred, so the progress bar is as before.
- Gates: eslint clean; npm test 1247 of 1248 at load 4 to 6 (spatial.test.js "H1 budget", a timing test, passes alone); smoke --extra 83 ok, no FAIL, no page errors, no network.

## 0.13.8 street alignment (2026-11-26, in the tree, no version bump)
- Owner on 0.13.7, two phones: streets still do not line up; a screenshot at SW 20th Road and SW 5th Avenue (South): the cross street wider on one side, grass wedges and slanted sidewalk slabs in the crossing, a step in the road ahead.
- Method: top-down orthographic views of the game's own render (new `scripts/aerial-review.mjs`: near tiles in full detail, paint shown at any distance, no trees, traffic or fog; `--at=name:x:z:side`, 1080 px), and node measurements over all five regions (new `test/streetaudit.js`, `test/junctionaudit.js`, printed by new `scripts/street-align.mjs`): curb step and added kink at every degree-2 joint, curbs and divide of a street running straight through a junction, arm mouths off their junction's asphalt, the drawn gap along divided pairs, the two yellow lines of a pair drawn as one road, curb parking spots against the drawn parking lane, stub arms, asphalt reach past the arms, sidewalk triangles and non-road inside a junction.
- Causes found and fixed at the source:
  1. The owner's junction (and 21 others): a small one-way traffic circle whose four arm vertices merge into one junction node left its ring as four 8 m dead-end stubs (a way running node -> ring point -> node is one link there and back; two passes make a two-way road, 12 m wide). world/miami.js `linkReps` drops such folds, `simplifyChain` a loop that keeps under two points. Junctions with a stub arm under 12 m: 28 -> 6 (South 14 -> 1). SW 20th Road at SW 5th Avenue: 8 arms -> 4, a plain symmetric crossing (docs/preview/0138-align-before-sw20.png, -after-sw20.png).
  2. Halves of a one-way pair drawn as one road (gap under 1.5 m, `off`): `off` was set from the gap at each edge's midpoint, so where the data's halves converge or part each block sat on its own line; the curbs stepped (tapered in 10 m) at every joint and the two yellow edge lines parted and crossed (NW 1st Avenue, Water Avenue). Now roadprofile.js `pairDivided` takes `off` as the mean of the middle line at both nodes (`endGap`: the nearest opposite half of the street, any edge), and junctions.js `pairEnds` puts each end's curbs on the middle line with linear tapers over half the edge (not on bridges: the land was stamped along `off`). Each half's yellow edge line is painted on the middle between the two left curbs every 4 m (`midYellow`). Yellow samples more than 0.6 m apart: 7043 of 9277 (76 %) -> 766 of 10214 (7.5 %) over five regions (docs/preview/0138-align-before-nw1st.png, -after-nw1st.png).
  3. Bend tapers: a 10 m smoothstep made a 3 m jog read as a kink; now linear, 25 m per m of change (at least 10 m, at most half of each edge).
  4. Curb parking spots stood on the nominal cross section, up to 3.9 m off the drawn parking lane (tapers, side shifts): now placed from `curbsAt`. Spots over 0.4 m off: 47 -> 0.
- Measured and not changed (numbers before -> after, five regions): drawn curb step at a joint over 0.2 m 0 -> 0; arm mouths off their junction 0 -> 0; added curb kink over 0.1 m/m at a joint 149 -> 152 (short edges where the data's own middle line bends); a same-named street straight through a junction with curbs over 0.3 m apart 441 -> 426 (mostly real jogs of the data, cluster nodes 3 to 20 m apart, and same-direction duplicate carriageways moved apart by `eoff`); divided runs whose median varies over 1 m 421 -> 389 (data). Lots, lot fronts and driveways are lots.js (not mine) and were not measured; building footprints are the data's.
- Tests: new test/streetalign.test.js (the owner's junction: four named arms, no stub, asphalt reach within a curb return, all road inside the hull and across every mouth, no corner sidewalk on the asphalt; stub arms at most 8; yellow lines apart under 15 % a region; curb spots 0 off; no joint step; no mouth miss): all four fail on 0.13.7, pass now. Re-pinned on purpose with notes: region fingerprints, all six (test/regions.test.js; ids shift after the dropped stubs); the edge and node ids of the West ramp case in test/gps-audit.test.js (same edges).
- Gates: eslint clean; npm test 1240 of 1241 at load near 10 (the dressLot timing test, passes alone); smoke --extra 81 ok, no page errors (Miami street view 199 calls, 292k triangles); routes: gps-audit and routability tests pass (a 0.13.8 draft that also dropped loops under 60 m removed a real turning loop on Dodge Island and made one route U-turn: only folds are dropped now). Build time, best of 5 cold whole-box runs, this tree vs 0.13.7 in the same minutes: cpu 2546 / 2560 vs 2566 / 2620 ms (no slower; wall drifted 1.7 to 2.2 s on the shared VM). No new shader program, no per-frame code changed (the paint and strips are built at tile time).

## 0.13.8 parked cars (2026-11-26)
- Owner on two phones (0.13.7): "lots of car filled lots all over town"; a phone's slowest system in Downtown was parked cars, 8.9 ms in one call (hitches).
- Why the lots looked packed: every parking lot was 30 to 60 % full at noon and never under 20 % at night (lotFill floor 0.2), every lot alike; the three listed bays of each lot always held a real car (100 %); the curb system filled every curb spot within 135 m up to the live cap.
- Occupancy (world/lots.js lotFill, lotPull, bayScale; world/collision.js bayLotU): the fill floor is gone (FILL_MIN 0, FILL_MAX still 0.55, a lot is never full); [day, night] by district downtown 0.48/0.05, midtown (shops) 0.38/0.04, residential 0.24/0.44 (fuller at night), beach 0.48/0.05, docks and industrial 0.14/0.02, park 0.26/0.02; shops and offices open and close (a steeper day curve); a public lot (no building) keeps 1.5 times the night share; each lot has its own seeded pull: one lot in eight (one in sixteen over 3000 m2) nearly empty whatever the hour, the rest 0.55 to 1.15 times the district share. A lot fills from its front (the road side with the entrance) back: a bay's hash is scaled 0.55 at the front to 1.45 at the back, so back rows are the empty ones, scattered (not a checkerboard). Listed lot bays take a real car by the same lot fill (their own hash), not always. The collision world's bay cars use the same rule (bayLotU), so drawn and solid cars match.
- Impossible places: 174 of 83 714 Downtown bays put a car on a planter, a lamp, a sign or a tree at a row end; such bays never hold a car (lots.js blockedBays, used by the lot layer, the drawn field and the listed bays). Checked: no bay outside its lot, no bay over another row (the lot dressing, its features, density floor and caps are unchanged).
- Numbers, Downtown region, every bay of 1301 parking lots (scratch probe; listed bays counted by the rule in force): noon 45.4 % -> 33.2 % of bays hold a car, lots under 10 % full 2 -> 165 (13 %); 2 am 25.5 % -> 3.8 %, lots under 10 % full 3 -> 1223 (94 %).
- Live parked cars (curb spots and listed bays, real vehicles): a cap by graphics tier, PARKED_CAP Low 30, Normal 40, High 48 (graphics.tierNow; `graphics.parkedLive` overrides), all within SPAWN_R 120 m (was 135; despawn 170, was 185). On-street parking stays where the road profile has parking lanes (parkL/parkR) at the generator's density (a spot in about one 6.5 m slot in five), nearest first. Downtown start, node harness: live parked 56 -> 29, within 120 m 37 -> 26.
- Cost (systems/parked.js, new render/parkedfield.js; the old render/lotmesh.js createLotCarField is kept for its tests and tools, the game no longer uses it):
  1. The lot car field loads a lot once into a pooled record of typed arrays (bay positions, facing, model, paint, occupancy hash, the blocked bays left out), a few lots a step (240 bays, at least one lot), nearest first; a refresh (every 0.25 s) only compares each loaded bay's hash with its lot's fill (worked out once per half hour) and keeps the nearest in view. Lots far behind give their records back to the pool. No per-bay hashing, no dressing, no allocation in a refresh.
  2. A lot the tiles have not dressed yet waits for them up to 1.5 s (lotDressCache.has), then loads from the build's quick bays-only dressing (BAYS_ONLY_FAST) as a provisional record, loaded again from the full dressing once the cache has it.
  3. The lot's ground height once per lot at load (was a ground query per car at every refresh, which built ground cells inside the draw sync).
  4. Real car bodies near the camera are built between refreshes (one a step: the one a refresh asked for, else the next model ahead), never inside a sync; a car whose body is not built yet is a hull for that refresh.
  5. Curb cars: a scan keeps the nearest 64 empty spots by bounded insertion (no sort of every spot in reach), one car a step; a car of ours far behind (past 125 m, untouched, of a model the new spot's district parks) is moved to the new spot instead of a new vehicle and mesh (records and meshes reused; 37 of 151 spawns in a 2 minute Downtown drive); a listed bay whose lot is not dressed waits for the tiles.
  6. world/collision.js lot layer setHour: the half-hour switch of the bay car shapes is spread over steps (2500 shapes a call), each lot's fill worked out once per run of its shapes, the hashes in an array (was a WeakMap read and a lotFill per shape in one step).
- Measured, scripts/perf-phonecheck.mjs at 4x throttle, Downtown, 3 passes, the parked system's time per frame taken as the fastest pass of each frame (a copy of the script that keeps it; the script's own "slowest system call" is the worst of each pass, and trivial systems read 4 to 8 ms there on this shared machine): 0.13.7 worst 9.2 ms (three frames at 8.9 to 9.2), mean 0.025 ms; 0.13.8 worst 2.1 ms in one frame (a lot loaded: its quick dressing; every other frame 1.0 ms or less), mean 0.012 ms; the script's own reading 9.2 -> 5.2 ms. First seconds of play: parked worst 106 -> 49 ms, both in the first spawns' vehicle mesh builds (game.js createMesh, first car of a model: not this system's code). The drive itself now covers 537 m in 60 s (was 284; likely fewer parked cars in the scripted car's way, not traced), so the tiles build more and the drive's frames over read 5 -> 10, tile builds (none blamed on parked).
- Heap profile of the drive (--alloc, 1 pass): no function of the parked system is among the top 25 allocating ones before or after; total allocated about the same (1060 -> 1069 MB, traffic's scan and the vehicle step lead).
- Tests: test/parkedfield.test.js (new): drawn cars only where the collision world has one, never two in a bay; the same model, paint and facing as the old field for a bay; loading a few lots a step and records reused; no car on a planter, lamp or sign; occupancy by district and hour, some lots empty by chance, nights near empty; the live cap (40, 30 on Low, a lower override held while driving, cars moved rather than made); listed bays by fill and deterministic; the quick dressing then the full one. Updated with reasons in the test: test/lotmesh-cars.test.js "fill" (FILL_MIN 0.2 dropped on purpose; never full, the day and night shape and half hours kept; spread over the real lots pinned), test/traffic.test.js lot cars (at noon and 90 m off, was 9 am and 70 m: the listed bays follow the lot fill now, and most of that lot lies inside MIN_R from 70 m).
- Gates: eslint clean; npm test 1245 of 1245 (the dressLot cost timing test read just over 0.05 ms a lot in the loaded full run and passed alone; dressLot is unchanged); smoke --extra 81 ok, no FAIL; whole-box build 1568 ms wall best of 3 (scripts/city-build-bench.mjs; not slower). Previews: docs/preview/0138-parked-before.png and 0138-parked-after.png (Downtown lot from its road side, noon above, 23:00 below).
- Not done: residential driveways have no cars (yards have drives, no bays; a driveway car would need its own collision shapes); the first-spawn mesh builds at the start are game.js and render work.

## 0.13.7 build time (2026-11-26)
- Goal: the whole-box build back to 1.6 s wall locally (CI runs about 1.8x slower and read 3.0 to 3.5 s against the 3 s tests). Not reached: best of 5 cold runs (scripts/city-build-bench.mjs --runs 5 --best, new flag; base and this tree in the same minutes, the shared VM drifted 1.8 to 2.0 s between hours): createMiamiCity wall 1790 -> 1707 ms, cpu 3090 -> 2920 ms; game path wall 2193 -> 2114.
- Per stage before -> after (ms): roads and graph 165 -> 126, buildings 178 -> 157, parking lot bays 191 -> 105, street props settle 97 -> 132 (it now pays the first, cold use of the disc tests and the ground's gap stations the bays used to pay), others within run noise (junctions 204/206, shore field 176/182, infill 171/176, lot grid 236/251, extras 136/130). The bench now also lists the junctions and the settle laps.
- Changes (output identical: a hash of every city field, the shore field at every cell, and every lot's dressing, whole box and Beach; fingerprints unchanged, no re-pin):
  1. world/lots.js `BAYS_ONLY_FAST`: the build's parking-spot pass dresses parking lots without the road test of their solid features (no bay depends on them but through the cap, which counts a road-skipped row as if it stood) and keeps no verdicts; the first tile that draws a lot works them out (the bays-only test API is unchanged).
  2. world/miami.js keepJoinedRamps: ramp boxes before the ramp-to-ramp test; meetsWay asks a 200 m grid of the ways' boxes (its answer does not depend on the order).
  3. Footprint cover: cells that fill their own box are one rectangle (23 % of footprints); histRows sweeps only each row's filled span (fillPolygon records it).
  4. bayRows tests a row's slots only against the boxes reaching across that row; junctions/ground typed arrays made with `new` instead of `.from`.
- Tried and dropped (no gain or slower): one sweep for both sides of the shore field's row pass, division-free envelope compares, analytic capsule rows, a lazy step distance to buildings for the infill, a load-time warm-up of the step kernels.
- Where the time is: about 600 ms of the cold build is JIT warm-up (the same build warm is about 1.15 s): createMiamiCity is too large to optimize, so its own loops run in baseline code, and every stage's helpers start in the interpreter. The steady-state kernels (shore field 135, footprint cover about 100, step distances about 150) are memory bound. Reaching 1.6 s needs a structural change (splitting createMiamiCity into stage functions, fewer distinct cold code paths), not more local tuning.
- Heap after gc unchanged (796 MB in the bench, which dresses every lot). Gates: eslint clean; npm test 1237 of 1237; smoke --extra 81 ok, no FAIL.

## 0.13.7 build speed and density (2026-11-26)
- The 0.13.7 gate failed four tests on the new road logic and the props-off-the-road work: the two whole-box 3 s build tests (cpu 3083 and 3368 ms), dressLot cost (0.079 ms a lot against 0.05) and the density floor (Beach lot 2068, a yard at 0.76 of the floor). Profiled in node (`--cpu-prof`, `--trace-opt`, cpu time best of 5; the machine shared, load 1 to 5).
- Street props (world/streetscape.js): per edge numbers read once per road geometry into typed arrays (`edgeTable`: node a, direction, length, strip offset and half width, sidewalks, median band, taper amplitude, end flags; the edge objects come in many shapes and the tests ran polymorphic); the paved-gap test asks the ground only where a strip in the list faces the curb within GAP_MAX (`gapCould`: 56 000 asks to 5 400, the same answers); the junction test reads the junction grid cells the disc covers once (was five point lookups, one of them redundant, and it missed a corner cell); the disc test split into small functions (one large function was compiled again at each rare first path, 109 ms of compile). The settle step alone: cpu 400 to about 180 ms, the same props placed (hash checked).
- Ground (world/ground.js): a gap station asks the city's edge index for the strips within reach of a facing curb instead of building its 32 m ground cell (same values); `roadAt`, the road answer of baseAt without the sliver fills, for the disc tests (a test checks it against baseAt).
- Lot features (world/lots.js dressLot): the road verdicts of a lot's solid features are kept per lot (`roadVerdicts`, WeakMap: a hash of each feature and its verdict, in the order the dressing asks; a feature that does not match is worked out again), so a lot dressed again (every tile that draws it) reads them; the strips round a lot gathered only when a verdict is worked out; `interior` takes cells of any lot but a verge or the airfield as land (was this lot's only); a row (hedge, wall, fence) is tested by world/streetscape.js `rowOnRoad`: per edge once whether a gap can face it and whether it can reach the row at all, per disc only where an edge or a junction cell can (same verdicts, disc by disc). The whole-box quick disc test round a row is gone (rowOnRoad does it per disc; one feature of the core changes). dressLot cost, core, alone: 0.036 to 0.024 ms a lot (first pass 0.058 to 0.046).
- miami.js edgesNear reads the strips from a flat array once they are final (after pairDivided): same results (fingerprints unchanged).
- Review fixes: (a) a signaled junction keeps a mast: where every mast of a junction (one polygon may join several nodes) was dropped, each is tried again 6 to 12 m back and 2.5 m out; if none fits the node loses its light (`stats.unlit`; none in the five regions: Beach node 124 lost its masts but its junction is lit at nodes 123 and 125); (b) startLight walks at most 64 hops; (c) the build's parking-spot pass (baysOnly) runs the same road test as a full dressing (its verdicts are kept for the tiles); (d) test/roadprofile.test.js: lane tags kept up to the class cap, clamped past it (every class, one-way and two-way, tags 1 to 9; on the map 81 to 93 % of tagged edges keep the clamped tag, the rest take their street's cross section); (e) test/roadlogic.test.js: every road node of each region is reached from the player start, and legal reach (one-ways) no worse than 0.13.6 (one-way runs cut by the crop).
- Density floor: a yard's fill now tries a short bed turned either way where a long one does not fit, and in a fragment a shrub (four plants at most) before a 3 m hedge. Beach lot 2068: 0.76 to 1.06 of the floor; every region's least dressed lot at 1.00.
- Fingerprints: unchanged (no re-pin). Street props: identical. Lot dressing: changes in yards that reach the fill and one core feature.
- New tests (test/props-offroad.test.js): a junction whose masts all fail loses its light, one with a mast keeps it, none lost in any region; bays-only and full dressings place the same hedges and bays, every lot parking spot on a drawn bay; kept verdicts give the dressing worked out afresh; roadAt equals baseAt 1.
- Numbers, whole box, cpu best of 5 (b.mjs bench, node 22): 0.13.7 tree before 3135 ms, after about 3060 to 3180 (0.13.6 code 2600 to 2700). Alone, the 3 s tests pass on wall time (1.9 to 2.1 s) but read cpu 3.1 to 3.3 s: still over 3 s by cpu, so under a loaded gate they can still fail. What is left: the settle step and the parking spots' road test (review c) cost some 200 ms of run time and about 200 ms of compile in the build (the ground, the disc tests); the dressLot test passes with margin (0.024 to 0.028 ms a lot alone); the density floor passes.
- Gates: eslint clean; npm test 1228 of 1228; smoke --extra 81 ok, no FAIL.

## 0.13.7 pace and scale (2026-11-26)
- Owner on the phone in Miami Beach: "the streets are not proportional, a single city block feels like it takes an hour". Measured with a node harness on the real city and the game's systems (survival.mjs makeGame/stepGame): the player's sedan driven by the traffic driver's own route and pedals at 1.35 times the lane speed (33 mph streets, 48 avenues), lawful (stops at reds and stop signs, brakes for cars ahead), 8 seeds x 4 min a region; time lost against that speed split by cause each step.
- Seconds per 100 m (per junction, average speed), before -> after:
  - Beach 11.9 (10.2 s, 18.8 mph) -> 12.5 (10.7 s, 17.9 mph); Downtown 15.6 (10.2 s, 14.3 mph) -> 16.1 (11.0 s, 13.9 mph). Same within run noise (a second seed set gave Downtown 15.8 -> 17.1 with traffic, 31 -> 27 % lost to signals). No traffic, no signals, no parked cars ("free"): 9.0 to 9.2 s per 100 m (24 to 25 mph, a real 30 mph street is 7.5 s and a real city average 12 to 18 mph).
  - Lost time, Beach: signals 15 %, traffic 9 to 12 %, turns 7 to 9 %, stop signs 7 %, accel 4 %, parked cars 0 %, curb or prop hits 0 %. Downtown: signals 23 to 31 %, traffic 15 to 24 %, turns 6 to 11 %, parked cars 0 to 4 %. Staged slow cars (events, tutorial) are not on free-roam routes.
  - Signals: cycle 24 s (green 9, amber 2.5, red 12.5), half a real one on purpose; 17 to 34 % of junctions stopped at, median wait 3 to 6 s, alone at most 12.5 s; queued waits up to 39 to 100 s Downtown before, 23 to 35 s after.
  - Speed limits: none in town. 0 to 30 mph 2.9 s (sedan, compact, midsize, taxi), the same in all presets and both modes (presets change steering only; no taxCap or cap exists), 0 to 60 7.5 s, top 100+ mph; coasting loses 15 mph in 3 s from 113. The HUD's mph is right (m/s x 2.237). No auto-brake on the player.
  - Scale is right: junction edges median 99 m, lamps 30 m apart (median nearest), lane dashes 3 m every 12 m (US 10/30 ft), buildings median 12 m wide (40 ft) and 10 m tall.
- So the map and the pace are to scale; what was not: the chase view. Its FOV is vertical (62, Far chase 66), so a wider screen saw more to the sides: 94 degrees across at 16:9 but 104 on a 748x360 phone and 106 on the S24 Ultra (109 and 112 at 30 to 60 mph). The street, cars and facades came out about a fifth smaller and slower on the screen than the view was tuned for, and a block looks a fifth longer.
- Fixes:
  1. render/chasecam.js `chaseBaseFov`: a car's chase views keep their 16:9 width on wider screens (Chase 52.4 degrees vertical on the S24 Ultra, 94 across; Far chase 56, 98 across); the speed, kick and boost widening add on top as before. Things at the center of the screen are 1.22 times as big and pass 1.22 times as fast. First-person views (Hood 80, Cockpit 100 across) unchanged.
  2. world/citygen.js signals: one phase per junction (`signalClusters`, called by the traffic system at start: signal nodes under 30 m apart share the lowest id's phase). Before, 50 of 51 such pairs in Beach and Downtown were out of phase (green at the first line, red 15 m on, in the median). Timing table `SIGNAL`; a green wave by position is there (`wave`) but off: tried at 13.4 m/s, Downtown signal stops went from 21 to 31 % of junctions.
  3. systems/audio.js: the car's wind rush is heard from town speed (0.05 at 30 mph, was 0.027; 0.33 at 100 mph, was 0.30).
- Left (not my files): street traffic runs at 11 m/s (25 mph, traffic.js LANE_SPEED) and costs 10 to 24 % of the time behind it; real Miami Beach streets are 30 mph. The loop runs at most 5 steps a frame (core/loop.js): under 12 fps on the phone the game runs in slow motion, which "laggy" in the owner's note may be.
- Tests: test/pace-scale.test.js (chase width at 16:9 and three phone sizes, speed widening kept; one light per junction, never both ways open, red at most 13 s; 0 to 30 mph 2 to 3.3 s in every preset). Steering envelope tests untouched and passing. No new shader, nothing allocated per frame.
- Gates: eslint; npm test 1198 of 1201 under load 15 to 20 (the three timing tests rerun alone: the whole-box helpers and Beach routes pass, dressLot 0.054 ms, lots.js not touched); smoke --extra: two runs under load 17 to 22 failed on screenshot timeouts (30 s, "player gets out of the car" in the first).
## 0.13.7 car looks (2026-11-26)
- Owner: "the cars are bad". Looked at all 18 fleet bodies at L0, L1, L2 (`node scripts/vehicle-shots.mjs --fleet`, new view `chase`: straight behind at 14 degrees, as the chase camera sees the player car), close-ups at the phone's 2x, and in the game at 748x360 (player car in chase and cockpit view, traffic at 2.5 to 58 m in both lanes, day 13:00 and night 22:30). The fleet harness flatters: the defects below are what the game showed.
- Fixed (no new draw, no new shader program, triangle counts unchanged for every body and level):
  1. A black plank through every near car's windshield base and A pillars: the dashboard was as wide as the mid cabin with its front at the glass base. It now stands behind the raked glass and inside the pillars (carbody.js `cabin`; the steering wheel moves back with it).
  2. Pickup and crew-cab beds: the 8-point bed section against the fleet's 5-point deck (the grid takes the first ring's length) dropped the bed's right half and stretched a paint-colored triangle over the bed floor. The bed section now has the deck's point count. At L1 the dipped bed floor is liner-dark (a pickup at 20 to 60 m read as a hatchback).
  3. L1 mirrors were bricks floating off the car (a gap to the coarse glass): one swept box from inside the glass out.
  4. A hard striped rectangle on hoods and roofs (one block of the paint's skyline reflection filled a flat hood): the skyline is mostly kept off up-facing panels (vehiclemats.js `rwTop`); sides and glass keep it.
  5. L1 sports and muscle cars black up to the door handles (the skirt rule on the mid section's wide band 1): no skirt band at L1.
  6. L1 wheels read as dark cones (hub near black): the hub is a shade of the rim, and dark rims are lifted to dark gray.
  7. White paints burnt out to one flat shape in the noon sun under the clear coat: paint color held at 0.68 linear (vehiclemats.js `PAINT_MAX`).
  8. LOD pop: after a jump of the camera (teleport, respawn) the player's own car was drawn as the L2 shell or L1 for up to 8 frames (game.js checks the 75 m rule in slices). vehiclemesh.js keeps the car with `driver === 'player'` near on every path (`ud.own`); graphics.js `updateCarLod` no longer takes game.js's far flag for the own car (one line).
- Contact shadow on jumps (owner, test drive): the dark contact shadow is baked into the glass geometry under the car and flew with it over ramps. Every glass geometry now has one relative morph target lifting the SHADOW vertices 1 m (carbody.js `shadowLift`); vehiclemesh.js `contactClearance` sets the influence to the car's height over the surface under it while a ramp jump or a blast owns its height (`v.air.on`, `v.tossing`), else 0 (road, bridge, a ramp deck it rides); the glass shader reads the lift back, keeps the shadow on that surface and shrinks and fades it from 0.3 m (`SHADOW_FULL_M`) to 1.5 m (`SHADOW_GONE_M`). The surface is the ground with the stunt ramp decks (`setContactGround`, set by graphics.js). The sun shadow is unchanged. Checked on the Beach "Palm Island Skip" ramp (the SW 1st Ave name did not match a spot in the current Beach data) with a node-driven page: docs/preview/0137-jump-shadow.png (top before, bottom after; the patch left on the road is the sun shadow).
- Not changed: proportions, ride height and wheel gaps were already right at L0 (side line-up); L2 octagon wheels at 60 m and more; the cockpit (plain but no defect).
- Tests (test/carmesh.test.js, 0.13.7): one ring length per loft and level (fails on 0.13.6: crewcab and pickup), the dashboard and steering wheel behind the glass and inside the pillars (fails on 0.13.6), the L1 bed reads open (fails on 0.13.6), the own car never far, the shadow lift and clearance over a fake ground (deck, air, blast, fallback to the wheels' last ground).
- Shots: docs/preview/0137-cars-close.png (close-ups before and after), 0137-cars-front.png (front line-up), 0137-cars-L1.png (L1 line-up).
- Checks (shared machine, load average 15 to 21 on 4 cores): eslint clean; npm test 1201 of 1203 (Miami helpers and dressLot timing; helpers passes alone, dressLot 0.058 ms a lot alone under that load, world code not touched). smoke --extra: three runs; the first two failed "player gets out of the car" (a 60 ms tap on a slow frame; it passed in the third run) and every run, 0.13.6 code too, stopped at a 30 s screenshot timeout after the foot walk, so the later extra checks were reached only in run two (all passed there, including the Wynwood Kicker jump).

## 0.13.7 props off the road (2026-11-26)
- The owner, on the live game: light poles in the middle of the road. A check over the five regions (every street prop's and every solid lot feature's collision footprint against the ground, world/ground.js surfaceAt 1: strips, lanes, the paved gap between two carriageways, junction areas and fans, crosswalks, gores) found on the drivable surface in 0.13.6: 841 lamps (Downtown 248, Beach 166, North 86, West 115, South 226), 420 palms (212, 174, 20, 1, 13), 185 signal masts, 45 street-name posts, 39 stop signs, 6 street trees and 159 lot features (45 hedges, 36 fences, 31 walls, 17 beds, 7 trees and 23 others). Causes: a street prop stood at half the edge's width plus a fixed step, so it landed on asphalt wherever the real curb was elsewhere: in the paved gap to a facing strip under 6 m (most lamps and palms), on a strip moved sideways at a junction (roadGeo.eoff), in a taper, a junction's area or another road; corner posts and stop signs were tested at their center only; lot rows 1 m inside a lot cell that lies partly under a strip or a curb return.
- Fix at the source, new world/streetscape.js: `curbSpot` places a prop from the real profile of its edge's side at that point (junctions.js curbsAt with taper and side shift; the sidewalk, walkOf / walkLeftOf, clamped to it; the median: lamps from 2 m and trees from 3 m, centered, one edge of a pair only, nothing else; else the verge past the sidewalk; nothing on a side whose curb faces a paved gap); `discOnRoad` tests the footprint plus 0.15 m against the drivable surface (strips, lanes, paved gaps, junction areas with crosswalks and fans, gores: ground.js baseAt 1) from the cross sections, and asks the ground only where they cannot tell (a fan's arm end, a nose); `settleStreetProps` (miami.js, last build step, no rng) moves each lamp, tree, signal and stop sign to that place, sliding up to 3 m along the edge (a signal or stop sign back from its junction, a signal also to the far curb, its arm still reaching the lanes), drops it with no room, and nudges a corner post up to 2 m. The avenue palms (propsolid.js miamiPalmSpots) use curbSpot, the seawall palms the footprint test. Lot features (lots.js dressLot `put`): a solid feature whose footprint reaches the strips, gaps, junctions or gores (baseAt: not the narrow-gap net) is not placed; a boundary row moves in or shortens until it is off (a row left out for the road still counts against the cap, so a parking lot's bays are the same in the build's baysOnly pass, which skips the test).
- After: 0 in all five regions (test/props-offroad.test.js, TOL 0.03 m, against baseAt). Dropped for want of room: 2.4 to 9.3 % of a region's settled props (whole box 1152 of 23533; lamps Downtown 4288 to 3992, South 2419 to 2051); signaled junctions with no mast unchanged (13 in five regions, as in 0.13.6). Street-level shots before and after at NW 1st Avenue (lamp in the paved gap between the two carriageways), SE 3rd Street, Biscayne Boulevard and Alton Road (palms and lamps down the paved middle): the road is clear.
- Tests: test/props-offroad.test.js (no solid street prop or lot feature on the road in any region, the 0.13.6 places, the median and gap rules, lamps and masts kept); smoke --extra adds a street-level view down NW 1st Avenue with an in-page check of every street prop within 120 m (shots/props-street.png).
- Cost: the settle step is about 0.2 to 0.4 s of a whole-box build (the ground's lazy cells and gap stations near props, worked out at build now, not at the first tile; baysOnly skips the lot test). Testing the narrow-gap net as well (surfaceAt) cost about 0.5 s more and is not done: 35 street props (17 name posts, 13 signal masts, 2 stop signs, 2 palms, 1 lamp) stand on a net sliver, the asphalt ground.js fills into gaps under 2 m between two roads (the in-page smoke check near NW 1st Avenue uses surfaceAt and passes).
- Gates: eslint; npm test 1198 of 1203 at a load average near 11 (after: the British spelling fixed; H1 budget passes alone); alone, the whole-box 3 s build tests read cpu 3.0 to 3.1 s (0.13.6 code 2.5 to 2.8 s in the same minutes) and dressLot 0.058 to 0.062 ms a lot (0.13.6: 0.050 to 0.052) against its 0.05 limit, so these timing tests sit at or over their limits under this load; build-budget not run. smoke --extra: 81 ok, no FAIL (Downtown street view 207 calls, 293k triangles).
- Left (road model, not mine): ground.js gapAt holds one value per 2 m station, so the paved gap starts and stops in 2 m steps along a curb; 17 parking-lot bays (Downtown 12, West 5) lie partly on a strip (bayRows, not touched: their static cars are cars).
## 0.13.7 UI redesign (2026-11-26)
- The owner: "the UI and settings menus and buttons are hideous". A styling pass, no behavior change: same element ids, classes, data roles, row counts and hit boxes.
- Look: dark blue-gray glass panels (radius 14 to 18, 1 px light edge, soft shadow), one accent (the orange #e2733a) for selected and primary, one system sans stack, title 21 to 22 px bold, row label 16 px, hints 12 to 13 px, section headers 12 px small caps with spacing, inline SVG line icons (2 px stroke).
- Pause menu (menu.js CSS + small DOM wrappers): the rail is one glass strip with icon tabs (accent bar on the chosen one); Settings groups are underline tabs; each run of setting rows is one grouped card (48 px rows, 52 at 412 high); On/Off buttons draw a real switch track beside their On/Off text (the text and `aria-checked` stay); segmented controls on a dark track; sliders with a 26 px thumb and an accent fill (`--p`, set in sliderRow); go rows show value and chevron; Access and Done draw a slim pill inside their 48 px hit box; the hub tiles carry icons; confirm rows, stats tiles, Records table, Daily cards, Customize chips, the steering question, sound test, map and travel pickers (mappicker.js), the title's About and map panels (title.js), the travel prompt, the Phone check and lab cards, and the garage screens (explore.js, small text 11 to 12 px) follow the same tokens. Reduce motion (`data-rw-calm`) and prefers-reduced-motion turn transitions off; high contrast makes panels solid and outlines every control.
- Title (index.html): name in heavy italic with an accent stripe, Start as an accent pill with a play mark (a spinner while Loading), Continue, Map (pin mark) and About as glass pills, credit and version 12 px pills. Rects unchanged (Start 180x56 at 24 from the bottom, name at 24, 20, 40 high).
- HUD buttons (styles.js, touch.js wheel SVG): every face is dark glass (alpha 0.46) with a 1.5 px light edge, 24 px icon and an 11 px label (10 px in the 48 px fan cells, now rounded squares); pressed: accent fill plus a 3 px ring; GAS carries the accent, FIRE and the weapon slots a red glass; the wheel is a dark rim with light edges, grips that light up under the thumb and an accent top mark; stick and slider rings match. The idle face is now drawn 7.5 percent in from the hit box (`inset`, not `scale`), so icons and labels keep full size; it fills the box under a finger.
- Not done, and why: idle faces stay at 85 percent of the hit box (48 px for a 56 px button). Full-size idle faces measured 25.0 percent worst case on hud-cover (780x360 plane; car 24.7), over its 22 percent limit, and the 780x360 contract rects leave no room elsewhere; the pressed face is the full 56. Pause, MORE at 748 and the fan stay 48 px hit boxes (contract rects).
- The other helper's graphics row text ('Now Normal at 2.25x') is not in this branch; the Display rows keep their markup, so it should merge as plain row content.
- Tests: none changed (no re-pin needed: the idle check reads the face's width, 85 percent with the inset as with the scale).
- Gates: eslint clean; npm test 1198 of 1198; ui-test 781 of 781; touch-test 309 of 309; hud-cover worst 21.9 percent (780x360 car and plane, the same as before; limit 22); menu-test 211 of 212, the one failure the map screen's zoom tap timing out under a load average near 20, which fails the same way on the unchanged 0.13.6 code. Screens viewed at 748x360, 780x360 and 780x360 with large text: title, its map and About panels, HUD (car, fan open, foot, boat, heli), every Settings group, Access, Handling lab, Records, Daily, Customize, Garage, Garages, Adventures, Travel, map choice, New game (armed), sound test, About, the steering question.
- Previews: docs/preview/ui0137-before-*.png and ui0137-after-*.png (HUD car, fan, foot, title, Settings Controls and Display, hub, New game, map choice, sound test, steering question).

## 0.13.5 on-foot review (2026-11-25)
- On foot in the five regions with node harnesses on the real city (the game's own step functions, seeded): 40 walker bots a region for 60 s each (random stick, sprint, camera turns), 800 step-outs a region from cars on random streets pushed to the curb, 3000 random street-level shots a region, plus `scripts/foot-review.mjs` (new: the real game at 748x360 touch, stepped by hand: step out and back in with the camera jump a frame, walk, every weapon by SWAP with FIRE held, RELOAD, LOCK).
- Defects fixed:
  1. Shots and sight through buildings: combat.js `trace` looked only at the first solid on the ray, so a shot that cleared a bench, a hedge, a bay car or a fence went on through the building behind it (11 to 13 % of random street shots, 308 to 406 of 3000 a region; crew and police shots at the player too), and aim.js `lineOfSight` gave up after 4 steps of 0.3 m (inside a parked car's box it never got past it). New aim.js `wallAlong` (both use it): steps past what the line clears over, 0.8 m at a time from inside a low box, up to 8 solids.
  2. Step out through a fence: onfoot.js `exitPosition` checked only the spot, so beside a garden hedge or picket fence the player stood in the yard behind it (3 to 33 of 800 step-outs a region, North most). The line from the craft to the spot must now clear everything over STEP_OVER (0.95 m; a 0.9 m sea wall or curb post is still stepped over, BOAT_STEP_OVER 1.25 m from a boat onto a pier). 0 of 4000 after, no step-out refused.
  3. ENTER through a wall: `findEnterable` took a car parked on the far side of a fence or wall within reach, and the step out then left the player there. Same line rule (the walker keeps its last collision world, so game.js needs no change).
  4. Melee: the wrench hit people through walls and fences, and a parked car beside the target always took the swing (a car's reach is its radius) though the aim had turned the player to the person. Swings need a clear line at 1.1 m, and craft only when no person is in reach.
  5. Aim assist bent shots to a bystander (a pedestrian, a traffic car with a civilian driver) nearer in the cone than the gunman shooting at the player. A bystander's score now carries ASSIST_BYSTANDER (0.6): centered on it, it still wins.
- Checked, no defect found: walker bots (no wall crossing, inside a solid, off the ground, NaN or height jump in 720k steps; one bot in North pressed into a wall corner for 5 s, it walks off when the stick turns), a car shoving a walker against a fence (slides out, never through), knock-back and ragdoll steps (shorter than a fence is thick), weapon switch during a reload, throw cancel, controls while down. Not present in the game: crouch, climbing, ladders, swimming (the walker stops at the shore; crew take cover by their own rule, crew.js chooseCover, unchanged).
- Left (not mine): game.js sets `player.y` to 0 on foot while the walker stands at ground height (beach slopes); a thrown body lands at y 0, not the ground height.
- Tests: test/onfoot-review.test.js (all five fail on 0.13.4). No per-frame allocation; cannot-die and the Hard switch unchanged.
- foot-review (Beach, Downtown, North): step out ok and clear, camera at most 0.51 m a frame; all seven weapons fire through SWAP; RELOAD and LOCK leave nothing stuck; no page errors. Getting back in moves the camera 3.8 to 10.5 m in one frame (the chase camera's change from the foot view to the car's; game.js and render/chasecam.js, not this work's files, left for their owner).
- Gates: eslint; npm test 1144 of 1147 with a load average near 37 (a British word in my comment, fixed; the two timing tests, Miami helpers and dressLot, fail alone under that load on 0.13.4 code too); smoke --extra did not get past its first screenshot twice (30 s timeout, Miami build 9 to 11 s against 8 s, load near 37), so it is not run for this work.
## 0.13.5 weather and night (2026-11-25)
- Looked at dawn (6.2, 6.6), dusk (19.3, 19.9), night (22.5), noon, clear, rain and fog in all five regions at 748x360: the start street chase view, a view from 180 m, three sea-front points a region (Downtown, South), and a Downtown survey at rainy dusk. `scripts/drive-review.mjs` takes `--hour=H` (the day shots at that hour) and `--weather=rain|fog|overcast|clear`.
- Defects fixed (no new shader program, no new draw, nothing per frame):
  1. Rain all but invisible (a few faint hairs, day and night): 1200 drops in a 70 m box. The box is now 42x26x42 m (four times the drops near the eye), streaks 1.1 m, opacity 0.55 by day and 0.33 at night (light lines on a dark sky read as scratches), and drops under 2.5 m from the lens fade out instead of crossing the screen as one line (systems/daynight.js RAIN_VS).
  2. A flat fog-colored band under the horizon from the air, with a lighter strip of sky above it: the dome at and below the horizon is now the fog color itself, fading into the sky over about 3 degrees, so the fogged sea and land meet the sky without an edge.
  3. Stars in a pink dusk sky (19.3) and at dawn: they come out from night 0.45 (smoothstep to 0.95).
  4. Headlights burning the road white for 30 m with hard sides (the throw clips in the tone curve), worst in eye views: the car lamp throw handed to the ground shaders at half strength, the red tail glow at 0.75 (it flooded a wet road at night) (graphics.js HEAD_K, TAIL_K).
  5. Rings on the sea (the 1 to 4 m ripples aliasing under a pixel out to 140 m, plain at dusk): ripples gone by 75 m (water.js). The shore tint and foam stopped on a hard straight line at the edge of the 512 m shore map; now they fade over its last tenth.
  6. The sea at dusk a flat pink-brown (the whole sunset sky mirrored): it keeps 60 % of its day tone until night.
  7. A rain day looked like a sunny one under a gray sky: exposure down 0.1 overcast, 0.06 rain by day; wet streets mirror more sky (environment +0.18 in rain).
  8. Smoke and spray blown onto the camera grew to fill the screen and cut off at the near plane: billboards fade out under 2.2 m (effects.js; combat effects share the pool).
- Checked, no defect: sky gradients (dithered, no banding at phone size), the sun disc at dusk, the moon, fog weather at street level, lamp glows, wet-road lamp streaks, wakes. Not mine: the pale cyan strip along the causeways (a ground mesh in the water, citymesh), the shape of the headlight cone (citypatch.js), particles use a home-made LCG for visuals (effects.js, as before).
- Tests: test/weather-night.test.js (stars at dusk and night, the dome horizon, rain box, opacity and near fade, the sea shore fade and ripple range, the particle lens fade).
- Gates: eslint; npm test 1144 of 1147 under a load average near 40, the three timing tests rerun alone at load 16: "random routes across the Beach" and the whole-box build pass, dressLot (0.05 ms a lot, world/lots.js, not touched here) still fails; smoke --extra 80 ok, no FAIL (Downtown street view 207 calls, 294k triangles; an earlier run under load failed "player gets out of the car", as did the unchanged 0.13.4 code in the same minute).

## 0.13.4 craft review (2026-11-25)
- Boats, planes, helis and tanks driven in the five regions by node harnesses (the game's own step functions, seeded bots): every berth's boat type wandering 90 s at full throttle along the shores and piers, tanks on 25 random street routes a region with the chase camera, helis set down on 300 random points of carparks, parks and plazas, helis flown low between the towers and boats along the shore with the chase camera, a step-out check at every berth, `scripts/flight-review.mjs` (all regions) and `scripts/collision-sweep.mjs --per 2` (0 failing runs) before and after.
- Defects fixed:
  1. "Cannot die" did not hold for boats, tanks and aircraft: their crash damage skipped the damage rule, so the player's boat wrecked on the shore (a jetski lost 75 % of its health in 90 s of shore bumps; a wrecked boat cannot move, only the rescue gets you out), a tank wrecked after about 20 wall hits at top speed and five taxi bumps wrecked the prop plane on the ground. boat.js `damageBoat`, tank.js wall damage, aircraft.js `damageAircraft` and the aircraft-vs-craft hit now pass through `getDamageRule()` (kind 'crash'), so combat.js keeps the player's craft above CRASH_FLOOR as it does a car. A real aircraft crash (over 8 m/s into a wall, a bad touchdown, a ditching) still wrecks; Hard mode and craft nobody drives are unchanged.
  2. A heli coming down onto a parked car or a bench perched on it (1.4 m up on a bay car in 9 % of carpark landings; the North region's heli pad sits by a carpark and the flight review landed there at 1.4 m), and game.js refuses the exit above 0.6 m ("Land first"). aircraft.js `settleDrift`: within 6 m of something under PERCH_MIN (2.5 m) the heli drifts off it sideways at up to 4 m/s before the skids touch. Carpark landings perched 28 of 299 to 1, the North pad lands at y 0, 2.8 m off its mark. Roofs and pads (2.5 m and up) as before.
  3. No way out of a boat at its berth (all 34 berths of the five regions): the berth is 3.2 m off the pier edge, the step-out point (onfoot.js, 0.8 m past the hull) fell in the water: "Pull up to a pier to get out". fleet.js `mooredBerth` slides each boat sideways until its hull is 0.15 m off the pier; city.boatSpots and the fingerprints are unchanged.
  4. Chase camera inside a tower: the pull-in snapped the wanted distance in, but the eased position lagged (a heli's follow rate took 25 frames out of a 59 m tower beside it) and a snap had no collision at all. chasecam.js: when the eased point is inside something it comes in along its own line to the target (one height query a frame while clear); snap uses the world of the last update. Downtown low heli flights 25 frames inside a tower to 0; tank routes, boats: none inside before or after.
- Checked, no defect found: boat jumps (largest 0.5 m a step, the speedboat's top speed), boats never on land, shore scrapes stay under the 1.5 m/s thud and shake thresholds; tank position jumps (only when spawned inside a solid by the harness), tank camera never inside a building; all runway, taxi and heli pad flights of the flight review as before (61 ok). Bridges over water are land for boats (they cannot pass under); seaplanes and the police roof pads have no step out by design (the rescue; no rooftop walking).
- Left: the Downtown seaplane's straight-in glide still ends in a shore wall (the review script's pattern, known); game.js "Land first" on a roof (not this task's file); thin poles (a lamp, a palm trunk) can still be inside the near plane for a frame.
- Tests: test/craft-review.test.js (the floor for boat, tank and plane, Hard mode and other craft; heli off a car and a bench, roofs as pads; moored berths step out on the pier for every boat type; the camera never inside a tower). No new shader program, no per-frame allocation.
- Gates: eslint; npm test 1129 of 1131 (two timing tests under a load average near 16: the whole-box build, 19 s wall against 3 s cpu, passes alone; dressLot 0.066 ms a lot, files this work does not touch); smoke --extra 80 ok (the first run timed out waiting for parked cars under load, the rerun passed).
## 0.13.4 loop playtest (2026-11-25)
- Played the loop with `node scripts/loop-test.mjs --map <region>` in all five regions (748x360), twice before the
  fixes and once after, plus single-event probes (new: `--event <id> [--class <spec>]` traces speed, lane and the
  nearest car every 0.5 s; `--garage-from <jump id>` plays the garage beat alone; `--approach-only` now skips the intro).
- Garage beat wedge (the flake), two causes:
  1. A door set back from the road (Sandbar Garage, Beach: the route ends 25 m short, GARAGE_NEAR is 40 m): the GPS
     said "You have arrived", then searched again and "arrived" every step with no line to follow, and the beat
     never ended. objective.js: after an arrival the same goal is searched again only once the player is REARM_M
     (60 m) away; it emits `gpsArrived`, and the garage beat ends on it within 90 m (tutorial.js GARAGE_ARRIVED).
  2. The nearest garage can be locked (Key Point Shed, Virginia Key, no road): the beat now picks the nearest open one.
  The thumb driver still needs a RESPAWN now and then after the ramp in Downtown (police or traffic boxing it in;
  `--garage-from` alone drives there clean in 42 and 57 s); the log now prints where and why it wedged.
- The ramp beat became police chases: the GPS line to the purple gate ran back through the red gate just escaped
  (Beach). While an intro beat leads somewhere a gate already played does not restart ("Not now: follow the GPS
  first."); new gates, a RETRY or a Daily Go gate still start; Skip intro opens them (events.js holdOthers). A first
  version shut every other gate: in North, where the driver never escaped, it shut all 36 approaches.
- Unfair jump: Ocean Dr (one lane between parked rows) jump_2, the Beach intro ramp: a car pulling in at the light
  left the run-up at 22 to 36 mph, 31 ft, no medal 3 runs in 4. A jump now clears driven cars in the lane from the
  gate to 40 m past the ramp at the start, then whatever comes in over 30 m ahead (parked cars stay): gold 3 of 3.
- Dead near-miss runs: on Biscayne Blvd, Alton Rd, SW 22nd St the driver met 0 to 3 cars in 45 s (0 or 1 pass). A
  near-miss run now stages a slow car 125 m ahead every 3 s when nothing going its way is in the road ahead (25 to
  170 m, 7 m to the side). Alton Rd: no medal 3 of 3 to bronze, silver, bronze. Biscayne stays poor for the driver
  (it holds a straight line past the road's bends and into the end of the street).
- HUD at 748x360: "100 mph" cut the unit off in the 80 px speed box (speed traps run 85 to 100 mph); three digits
  now draw at 21 px (hud.js), checked in loop-test.
- loop-test driver (scripts only): keeps the last GPS line after the GPS lets go near a gate and then lines up with
  the gate's street (Beach approach-only: 10 of 18 approaches did not start without it, 2 with it); passes cars a
  lane over in a near-miss run; RESPAWN when wedged on the way to the red gate (North: through a fence into a yard).
- Medal targets: not changed (the bot gets bronze on every template and gold is never 100 %). Final Beach run, 36
  approaches: bronze or better trap 100 %, jump 83 %, heat 83 %, dash 67 %, wreck 67 %, miss 17 %; 31 of 36 started.
  Daily twist classes on a 420 m trap: Fieldhand 84 mph, Cartway 85 mph top (silver 73 reachable, gold 86 hard).
- Final loop-test: Beach all ok. Downtown, North, West, South fail only on the driver's GPS approaches ("a third of the
  approaches": Downtown 10, West 3, South 9 of 36; North 0, and 5 of 18 on the unchanged 0.13.3 code, so not new:
  the driver ends 40 to 60 m short of the gate going round the block), on the purple-gate route arriving against the
  gate in Downtown and North (core/route.js arrive, not mine) or through another gate in South and West (a route
  penalty, not a ban), and in Downtown on wreck bronze (2 or 3 of 4 smashes for the ramming driver). The intro ends
  at the garage in all five (4.6 to 8 min); the driver still takes a RESPAWN to the garage now and then (a GPS U-turn
  after the landing, a traffic queue that does not move), logged as "wedged:".
- Not fixed (not mine): the police beat often ends on a star from a bump before the red gate is reached.
- Checks: eslint; npm test 1130 of 1130; loop-test (above); drive-review --survey at 748x360 in all five regions
  (no loop issue); smoke --extra 80 ok, no FAIL.

## 0.13.3 visual leftovers (2026-11-25)
- The five leftovers of "0.13.2 wastelands", checked with `node scripts/drive-review.mjs <out> <tag> --survey --size=748x360 --day` (Beach, South) and `--at` shots (Downtown hedge and causeway beach, South median, Beach dead ends), before and after.
  1. Big sparse lawns (grass lots, 37 % of lot land at Beach and South): world/lots.js `case 'grass'`: benches along the path (one per 18 m, up to 4, a bin by the first on half the lots), a cross path on a green over 3000 m2; `greens(.., lone)`: every other bed point of the 17 m grid a lone tree, beds there 13 to 15 m. A path is one feature for its length, so the fill adds fewer beds: grass features a hectare Beach 113 to 117, South 124 to 130, Downtown 121 to 128 (every lot within `featureCap`; the core average 117, test floor 120); trees on lawns +21 % Beach, +24 % South. render/lotmesh.js `lawnMottle`: soft darker patches on grass and park lots (one a 500 m2, at most 8, the contact shadow material, under the paths) and a shade disc under a broadleaf on a lawn.
  2. Hedges like tubes: render/lotmesh.js softStrip, hedge profile squarer (shoulder 0.86 of the half width, 0.12 m round), the clipped top lit apart from the sides, a leaf tone per 5 m section, bigger lumps. Same triangle count (sections every 2.2 m looked better but cost 5k triangles in the Downtown street view).
  3. Sand triangles beside a beach (Downtown causeway at Parrot Jungle Trail): the land in no lot between a beach and the road was bare paving with the beach's 5 m stair steps in it. world/lots.js `spreadSand`: beach ground runs on SAND_RINGS (3) cells into land in no lot where three of eight neighbors are sand, never onto a carriageway (drawn ground only: lotGrid.type and id unchanged).
  4. Gray seam down planted medians (South): the raised net between the two median bands (world/ground.js net, kind 2) and the sliver fills past a planted median were drawn as sidewalk concrete; now lawn (render/citymesh.js `betweenMedians`, the fill on the median side). Also the median-middle lawn of spreadGround from medians over 4 m (was 8), 3 m past the middle, and out to the middle of the real gap to the partner (land in no lot, pairs under 40 m apart).
  5. Asphalt sliver past dead ends: a dead end's strip runs 1.5 m past its node (world/junctions.js); `DEAD_END_GAP` 0.8 to 1.25 m, so the barricade base (`DEAD_END_BASE` 0.34) covers the strip end. Collision posts move with it (world/collision.js reads deadEnds, not changed).
- Fingerprints unchanged (lot types, rects, lot grid id and type; only lotGrid.ground and dressing changed), not repinned.
- Budget (scripts/perf.mjs, a clean checkout of 0.13.2 against it with these files): Downtown day 206 calls / 287k to 206 / 289k, Beach start 121 / 233k to 121 / 234k, South 114 / 251k to 114 / 257k; 60 programs (no new material). smoke --extra Downtown street view 207 calls, 294k triangles. No per-frame work: all of it at tile build or city build (spreadSand about 12 ms once, lazy with lotGrid.ground).
- Tests: test/wastelands.test.js (the barricade base covers the strip end; greens with a path have benches, trees and the features a hectare; no bare median middle in the South; sand runs to the causeway). Gates: eslint; npm test 1125 of 1125; smoke --extra 79 ok, one FAIL in combat ("the player cannot die: a blast over the sea", the known one of 0.13.2, not this work).
- Left: wide pale works yards and parking lot margins (North); the lawn patches are subtle at street level.

## 0.13.2 combat allocations (2026-11-25)
- Measured by allocation (`perf-phonecheck --alloc`, 4x, one pass, the 60 s drive; numbers in docs/PERF.md "Combat
  allocations"). Combat allocates little: 7.4 MB in the Downtown drive (123 KB/s, 0.7 % of 17.3 MB/s), 1.4 MB at the
  Beach; in node the same fight (player firing from a car, five stars, a blast every 10 s) is 7 KB/s and 0.06 to 0.13 ms
  a step. Most of the Chrome share is number boxing in `stepActor` (6.0 MB) and the drive-by aim assist (`core/aim.js
  consider`, 6.7 MB). combat.js has no literals, closures or spreads in its step loops.
- The combat spikes of the Phone check (9.6 ms before, 12.8 ms in this run) are mostly the listeners that run inside
  combat's step: the first shot's `damage` (crime and witness listeners) and the blast (`combatfx` onExplosion and
  scatterProps). Combat's own mean is 0.15 to 0.24 ms a step.
- Changed (behavior byte-identical: a node fight harness ends in the same state with and without the change, Downtown
  and Beach): actors keep one shape each. `resetActor` declares `stumbleT`, `createFootActor` declares `seatNo` (police.js
  set it later, so officers and crew had two shapes), `createWalker` declares the rest of resetActor's fields. Six actor
  shapes in the drive became three. The allocation change is within noise (stepActor 6.0 to 5.7 MB, consider 6.7 to
  5.8 MB, combat 7.4 to 7.0 MB in Downtown; Beach 1.4 to 1.5 MB).
- `perf-phonecheck --alloc --alloc-raw file` also writes the raw sampled heap profile (callers, inclusive totals).
- heightAt (1.7 MB/s in the Beach drive): ours, not three.js. 75 of its 103 MB come from the police helicopter pilot
  (`helipilot.js` pathRoof and roofAt, about 150 calls a step over Beach roofs); the chase camera and crews add under
  11 MB. Cause: collision shapes have eight or more shapes (building, prop and tree literals, lot shapes, edge segments,
  and the hidden `grp` that `setBreakGroup` adds with defineProperty), so heightAt's field reads see too many shapes and
  box every number they read. Tried in a scratch copy only (src/world is not mine this pass): one shape constructor for
  every collision shape (all fields, `grp` hidden at creation) took heightAt from 103.6 MB to 0.4 MB, pathRoof 23.8 to
  3.1 MB, rayList 49.6 MB to below the top 15, the whole Beach drive from 19.4 to 16.1 MB/s. Not applied: it adds
  enumerable fields to shapes, which tests compare as JSON. Open, for the world owner.
- Also found, not fixed: in Chrome hot functions (stepActor, consider, heightAt, pathRoof) end the drive as Maglev code
  after repeated deopts "dependent prototype chain changed" (518 of 2817 deopts in a 40 s Downtown drive, in bursts every
  few seconds). Nothing calls Object.create or setPrototypeOf and the Object, Array and Function prototypes keep their
  keys; the cause is not found. It is the likely reason Chrome boxes numbers where node does not.
- Checks: eslint, npm test (1118 of 1120: two timing tests over their limit under the soak's load,
  miami.test.js helpers 436 ms and world-density dressLot 0.094 ms a lot), smoke --extra.

## 0.13.1 car noses (task 15, 2026-11-25)
- Reviewed all 18 fleet bodies front, side and three-quarter at L0, L1 and L2 (`node scripts/vehicle-shots.mjs --fleet`,
  `dist/fleet/`). L0 was fine; the fixes are at L1 and L2, all in `src/render/carbody.js`, no new draws.
- L2 shell: straight sill (`sh.sill`, the sill without arch cut-outs) instead of `sh.bottom` at its 8 stations, which
  tilted whole panels up into wedges over the wheels (wheels hanging under a raised sill); the dark wheel arcs are 5 cm
  wider so the arch reads round the tire.
- L2 face: lamp, grille and tail quads follow the nose's and tail's lean (they floated ahead of rounded noses) and stop
  at 0.93 of the cap width (they stuck out past its corners); one dark band behind lamps and grille (lamps read on white
  paint); the grille spans to the lamps (wide US face) in a chrome or dark frame. Triangles unchanged (cars 288, taxi 300).
- L1 head lamps: the lens sits 2 cm out and stops at 0.93 of the width (the coarser one-draw body buried its edges:
  spiky bow-tie lamps on the trucks), as a dark rim round a lit core like the near lamp's smoked housing (white lamps
  vanished on white paint). L1 +8 triangles a car (taxi 1,396 of 1,400).

## 0.13.1 streets (task 11, 2026-11-25)
- Lot to lot steps (STREETSCAPE 4d): `render/lotmesh.js lotCut`. A lot cell on a stair between two drawn grounds (two
  perpendicular sides on one other ground, the other two not, the stair going on along the cut) is drawn split on its
  diagonal, the corner half in the other ground; of a stair's two candidate cells only the one of the lower look rank is split,
  so 1-cell staircases become one straight line and square lot corners stay square. Lawn edging and carpark curbs follow the
  cut (`cutStrip`). Five regions: 1641 (South) to 8506 (Downtown) cells cut; lot ground in a 600 m square +98 tris (Downtown).
- Fan junctions (fan1, S 1st Ave at SE 4th St): `world/junctions.js fanMouthHull` (convex hull of the arm mouths). In
  `world/ground.js` an arm's sidewalk or median band no longer runs on past its mouth inside that hull (the slip lane's left
  sidewalk crossed the other arms, raised in physics); `render/citymesh.js` paves the hull under the arms (-0.007).
- Crossing lane paint (S Miami Ave at SW 6th St): `clipPaint` also drops paint lying on a strip that overlaps this one away
  from junctions and outranks it (wider, else lower id; not the divided partner, no shared node; `paintRivals`, once per edge).
  Paint points on another painted carriageway: Downtown 425 to 0, Beach 43 to 0.
- Lincoln Road wedge: where a pedestrian street meets two or more streets, the junction ring outside the hull of the
  streets' mouths is drawn as the mall's flush paving (`mallTri`), not asphalt; the ring and physics are unchanged (both flat).
- Hedges and plain paving round towers: not done (skipped by the task).
- Fingerprints in test/regions.test.js: not repinned (no change to nodes, edges, buildings, lots or lot grid).
- Tests: test/lotsteps.test.js (staircase drawn within 0.3 m of its diagonal, edging on the cut, square corners kept, every
  clean stair cut in five regions); test/streetscape.test.js (fan1 crossing flat and paved, no paint on another painted
  carriageway in Downtown and Beach, Lincoln Road rings: asphalt only inside the streets' hull, paving outside);
  test/lotmesh.test.js reads lone triangles as well as quads.

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

## 2026-11-25: 0.13.1 shader programs (in the tree, no version bump)
- docs/PLAN_V4.md task 13. Shader programs after the warm-up and a day and night street view (perf.mjs-style, software renderer), before to after: Beach 75 to 60, Downtown 79 (76 at warm-up, 3 compiled in play by the parked lot cars) to 60 (none in play), North 76 to 60, West 75 to 60, South 75 to 60.
- Causes found by mapping `renderer.info.programs` to their materials: shader patches with their own program keys (far blocks, grass, facades, lamp light, wet asphalt; near and far sea), ShaderMaterials differing only in fragment code (smoke and glow pools, tire marks; contact shadows, scorch and blood; lamp, tail and headlight pools), attribute flags (white vertex colors, alpha or instance colors missing on one user), the warm-up compiling never-drawn variants (a view program for the shadow-layer-only proxies, a cut-out depth program for road paint) and the lot cars' instance colors appearing only in play.
- Fixes: `src/render/citypatch.js` puts the city features in one patch switched per material by uniforms (the street tile materials, far blocks, ramps, secrets and explore solids; the normal-mapped ground takes a white roughness map so it shares the asphalt's program; lit windows stay one extra program); one sea program (uRwNear); effects pools, skids, ground decals and daynight pools take uniform switches (smoke and tire marks write transparent black instead of discarding: same pixels); debris, edge walls, alley tag and boat spray get neutral vertex colors; lot hulls and bodies get white instance colors from the start; the warm-up skips shadow-layer-only meshes and paint casting and warms the instanced lot body.
- Same picture: WebGL read-back of four views (Downtown day, Beach night, South dusk with wet roads, West with a blast and skid marks) is bit-identical before and after; draw calls and triangles unchanged (212/290k, 127/234k, 128/279k, 147/255k).
- Left: citymesh.js keeps its old grass, facade and wet patches for the island map (overridden for Miami by patchCityMaterials); a shadow proxy normal (sharing the position buffer) would save one more depth program but needs the lotmesh test's "positions only" check changed.
- Gates: lint, 1114 tests (one timing test failed once under load, passed on rerun), smoke --extra, smoke-regions (Downtown's Play click timed out once, passed on rerun).
- 0.13.1 review note: citypatch.js sets CITY_U.uWet = M.wet (replaces the shared uniform); fine today (no patched material outlives a region), worth making in place later.

## 2026-11-25: 0.13.2 wastelands (in the tree, no version bump)
- Why: the owner: "map is still full of glitchy wastelands", roads look bad, "lots with brick cars filling them", repetitive.
- Review: `node scripts/drive-review.mjs <out> <tag> --survey --size=748x360` (new): in each of the five regions ten places picked from the city data (downtown core, beach strip, longest bridge, residential yards, industrial, park, airfield or its approach, biggest parking lot, biggest grass lot, a street near the start), each from the player's eye at street level (1.6 m) and the chase camera, day and night (`--day` skips night). About 180 shots before (North has no residential yard lot; the South run stopped at its time limit after 15 views of each kind), day shots of Beach, Downtown and North after.
- Defects, by how often a player sees them:
  1. Every lane line, stop bar and crosswalk: ragged, chipped edges (the worn paint texture cut holes in 8 % of it; at street level they read as broken paint). Fixed: holes in about 1.6 % (render/textures.js makePaint). Same shader program.
  2. Big parking lots (30 % of lot land in Downtown, North and West): unbroken rows of cars, a grid of bricks, filled to the 0.55 cap by day. Fixed: a planted island with a tree every 11 bays (was 14; 10 would push the Downtown shaped-prop share under its 85 % test floor), day fills Downtown 0.45, midtown and beach 0.42 (were 0.55, 0.5, 0.5).
  3. Dead ends inside a region (399 drawn ends: Beach 63, Downtown 83, North 118, West 79, South 56, residential streets and cut-off motorway stubs): the asphalt stopped as a square cut in the lawn. Fixed: world/deadends.js `deadEnds(city)` (from the graph, cached, no city field changes) puts a striped barricade just past each end, drawn in render/props.js (same look as a road end, `drawBarrier`) and solid in world/collision.js (the road end posts). Skipped where the end runs on into another road, a building or water.
  4. Shipping containers in works yards (North is 43 % works): flat saturated boxes. Fixed: weathered paint and a darker top rail (render/lotmesh.js, 10 triangles a tier more).
  5. Review tooling: the lot cars follow the camera, which moves in draw, so the first shot at a new place showed empty lots. drive-review steps again after its draws (in play the field refreshes every 0.25 s).
- Left (seen, not changed): big lawns with sparse shrubs and palms (grass lots are 37 % of lot land at Beach and South; their dressing is at the 120 a hectare feature cap); wide pale works yards and parking lot margins with nothing on them (North); hedges along parking lots still read as smooth tubes; the sand fringe triangles of `lotCut` poking into a beachfront plaza (Downtown); a gray seam along some planted medians (South); an asphalt sliver past a few dead ends where the road capsule runs past the node.
- Fingerprints unchanged (lot types, rects and the lot grid are as before; bays and islands are dressing). Tests: test/wastelands.test.js (dead end barricades: count, place, solid; no parking lot row over 11 bays; day fills).

## 2026-11-25: 0.13.2 loop open items (in the tree, no version bump)
- From the open list of 0.13.0 loop tuning. Design notes in docs/LOOP.md (sections b and e).
- Staged slow cars (first run): Ocean Drive is one lane between two rows of parked cars, so a car in the lane could not be passed at all (the thumb driver rammed it: 2 to 4 Ram toasts per run). `traffic.stageAhead` now keeps staged cars at least 30 m apart and clears the row of parked cars on the emptier side of each one (1.2 to 4.2 m out, 6 m behind to 70 m ahead: the car moves on at 6 m/s while the player closes up) so there is a bay to pass in; the other row stays for the close shaves. Node test: both rows full, one side open to pass afterwards, not both rows cleared.
- loop-test driver: a pass of a driven car starts about 50 m out, holds the side chosen once per car (no flip-flop), measures the offset from the line (it halved the swing before: the target followed the car's own sway) and passes 0.9 m off the flank. Result: 2 near misses on staged cars in the first run (`Near miss +150`), no Ram on a staged car; two new checks (a pass on a moving car, a near miss).
- GPS and other gates: `router.setAvoid(gates, goalX, goalZ)` adds `AVOID_COST` (350 m) to every street edge that runs through another gate's beam (gate half width + 1.5 m); the goal gate is skipped. A penalty, not a ban (a dead end or the only street still goes through). Set by the objective when the goal changes. Node test, 30 Beach gate pairs: gates crossed 46 to 22, total length +1 percent (the rest are streets with no other way, or the start edge). loop-test checks the red and the purple gate's line (0 other gates) and that no other gate starts on the way to the purple gate.
- Heat escape: the stars climbed because of the chase itself (fleeing above 62 mph in sight of a patrol car adds 0.15 point per second after 3 s, a ram adds one), so a one-star gate went to three stars (25 s out of sight, 90 s limit). `heat.ceiling` (police.js; `heatCeiling(level)` in streetevents.js = the gate's level + 1, set by systems/events.js only while a heat event runs): at the ceiling the points are held below one, no step up. Node test (police.test.js). Targets and the 90 s limit are unchanged.
- Medal shares (loop-test, "every template from three approaches": behind the gate, beside it, ahead of it; the car stands on a street grid point 160 to 320 m off in that direction, the GPS leads in, the thumb driver plays it; `--approach-events N` gates per template, default 2; "seed" = the gate: placement seed 41077 gives each its street, traffic and targets, and the game's rng is one stream that cannot be reseeded). Full run, two gates per template (36 runs, 23 started; bronze-or-better / gold share of the started runs): trap 80 / 80 percent of 5 (gold at 86 to 89 mph for a bot that holds the throttle: the one to watch, not changed), near-miss run 0 / 0 of 3 (0 to 1 passes from a cold approach; the staged first run gave silver and gold), jump 75 / 25 of 4, rush drop 67 / 33 of 6, heat escape 100 / 33 of 3 (stars 0 at the end of every run), wrecking spree 50 / 0 of 2. Before the approach runs the staged runs gave bronze or better on all six templates. So bronze is reachable and gold is not handed out on every template (the trap is close): no medal target was changed. 13 of the 36 approaches did not start (the driver wedges; 'wrong gate' twice: another gate on the leg).
- Not done: a driver that reaches every gate from every approach (the check asks for a third of them); the near-miss run from a cold approach pays 0 to 1 passes for the bot. In one loop-test run the garage beat wedged the driver (RESPAWN, intro not ended; it passed in the runs before and after).
- Gates: eslint, npm test (1120: two failures not from this change: a Beach `shoreDist` timing test under load and the US English test on the British phrase for a parking lot in docs/STREETSCAPE.md and STATUS lines of another helper), loop-test, smoke --extra, ui-test: smoke --extra had one FAIL in combat ("the player cannot die: a blast over the sea", another helper's area), ui-test all ok (one transient fail under load on the first run).
- Budget: smoke Downtown street view 208 calls, 293k triangles; perf North day 165 / 234k, night 164 / 230k, 60 programs (no new program: same materials).
- Gates: lint; npm test 1117 of 1120 (the British-spelling check, since fixed in these docs, and two timing tests under a load average near 20, helpers on the whole box and dressLot cost, which fail alike with the old island spacing); smoke-regions passed; smoke --extra 79 ok, one FAIL in the combat checks ("the player cannot die: a blast over the sea"), files other helpers are changing, not this work.

## 2026-11-25: 0.13.3 store shots (in the tree, no version bump)
- scripts/store-shots.mjs retaken for Miami: 8 shots, 1920x1080 (960x540 viewport at 2x), Beach (day, dusk, night), Downtown (dusk, night rain), North, West, South. Checks that no PNG has EXIF, text or time chunks. store/screenshot-1..8.png replaced.
- render/citypatch.js: `CITY_U.uWet` is no longer replaced by the weather's object; the shared object stays and the weather's `value` forwards to it. Test: test/citypatch-wet.test.js.
- docs/RC.md lists exactly the five owner-only items (privacy email, phone check, Play account, signing key, closed test); docs/STORE.md screenshot note updated.

## 2026-11-25: 0.13.3 allocations and routing (in the tree, no version bump)
- Allocations, `node scripts/perf-phonecheck.mjs --alloc --alloc-raw f --passes 1 --map miami-beach` (4x, 60 s, five stars), one pass each, KB in the drive: helipilot `pathRoof` 2754 to 689 (roofNear and pathRoof now have one roofAt call site in their loop, so the optimizer inlines roofAt and heightAt once and the sample coordinates are not boxed as call arguments), `fly` 937 to 1025 and `stepHeliPilot` 1185 to 1457 (noise, untouched), heightAt 240 to 344, chase camera `clearDist` 480 to 456. Whole drive 969 to 971 MB (other helpers' work changed the tree between the runs). Since 0.13.2 (one collision shape constructor) heightAt and rayList are no longer leads: under 0.4 MB of 970.
- Chase camera: two attempts measured no change and were taken out again: its per-frame closure numbers moved into one object (place 1.5 to 2.0 MB, updateFeel 1.34 to 1.35, update 0.94 to 1.19) and a single heightAt call site in clearDist. What is left there is most likely boxed arguments and returns at calls the optimizer does not inline (clamp, angleDiff, the three.js position.set, lookAt and rotate calls, clearDist's own 8 arguments): about 35 numbers a frame, 75 KB/s.
- Behavior: node scratch check of the old and new helipilot (two pilots, orbit, strafe, hover, 3000 steps) and chase camera: every control, position and roof value identical (Object.is).
- "dependent prototype chain changed" deopts (V8 `--trace-deopt-verbose --trace-prototype-users`, maps matched to objects with `--allow-natives-syntax` %DebugPrint): Downtown drive, 600 such marks, 507 of them in three bursts in the drive itself, each when Blink builds a DOM interface's prototype on its first use: IdleDeadline (28, the first requestIdleCallback callback), URL (151) and the Event family up to HTMLInputElement (328, the Settings page's sliders the Phone check opens). Not game code: no prototype the game owns changes, and heightAt, pathRoof, roofAt, clearDist and rayList had no such deopt in the trace. Each burst is once a page load. Possible fix, not done (src/main.js is not this task's file): touch those interfaces at boot, before the hot code is optimized.
- Routing (docs/STATUS.md 0.12.4 "Found, not changed"): the router was right; the data had no way in. readRoad drops at-grade freeway pieces between dropped flyovers, which also dropped the two ramps from Biscayne Boulevard onto the eastbound MacArthur Causeway, so that carriageway began at a dead end and Watson, Palm, Hibiscus and Star Islands (13 km of road) could be left but not reached. world/miami.js `keepJoinedRamps`: dropped at-grade motorway_link ramps that touch end to end form groups; a group is kept when every end meets another ramp of it or a kept road that goes on there, and one end merges into a kept motorway or trunk past its ends. Only Downtown and the whole box change: 2 nodes, 4 edges, 2 lots more; legal strongly connected pieces 161 to 113, road length outside the main piece 15.2 to 6.4 percent (scratch Tarjan count). Goals with a partial route from the start (every garage, landmark site, helipad, poi, secret, ramp, ground race checkpoint): 9 to 0.
- Fingerprints: whole box and Downtown re-pinned on purpose (comment in test/regions.test.js); Beach, North, West, South unchanged. The Bay Bridges Rally's last via point moves from (1800, -100) to (1760, 40) (world/miami-spots.js) so its lap still visits Palm Island (the new ramp changed its shortest walk).
- Left: the Port of Miami can be entered but not left (its westbound Port Boulevard flyover bridges are dropped as flyovers: 4 percent of Downtown road; goals there route, a route out of it is partial). Travel pads on a one-way that enters at the crop edge still get a partial route: downtown-west-sw8 (ends 104 m off), downtown-south-miamiave (25), north-beach-tuttle (1842: the Beach has no westbound Julia Tuttle Causeway, its ramps start on pieces cut off the same way), downtown-north-nw2 (50), downtown-west-flagler (32).
- Tests: test/route.test.js new check (all those Downtown goals routed in full and legally; fails before with 9 partial). Gates: eslint (changed files), npm test 1124 of 1125 (the spatial H1 budget timing test under load; passes alone), smoke --extra ok.

## 2026-11-25: 0.13.4 importer and shots (in the tree, no version bump)
- world/miami.js `keepJoinedRamps`: a ramp group is now kept whole or not at all. `readRoad` returns whether the road became a way; if any member of a group is rejected (not drivable, outside the crop, cut to nothing), the members read so far are taken back (ways, points, crop cuts), so a kept ramp can never end at a dead end beside a dropped one. Fingerprints: no change, every region and the whole box match the pins in test/regions.test.js (no repin; no test loosened), so on today's data no group had a rejected member and this is a guard for later data.
- scripts/store-shots.mjs: each of the 8 shots has its own camera place: the nearest car road to a point, the car facing along it (or against), landscape 960x540 at 2x: Ocean Drive (region start), Biscayne Boulevard by the arena, Beach south of the start (facing back), Wynwood, Calle Ocho, Brickell, the port in rain, the MacArthur Causeway at night. The PNG metadata check stays. store/screenshot-1..8.png replaced. (Software GL: about 3 minutes a shot; resume with `node scripts/store-shots.mjs <n>`.)
- "dependent prototype chain changed" warm-up at boot (IdleDeadline, URL, an input element in src/main.js): tried and NOT kept. A warm-up (new URL, a range input with a listener, a requestIdleCallback whose callback reads the deadline) at the top of main.js, against the same build without it, Downtown, `--js-flags=--trace-deopt-verbose`, 8 s idle, 1800 steps, then a new URL and input: "dependent prototype chain changed" lines 205 and 199 without, 199 and 197 with (two runs each), which is run to run noise; boot to running 13.3 and 12.2 s without, 11.0 and 10.9 s with (swiftshader, load noise, not a cost). The deopts did not go away, most likely because the functions they hit are optimized later and the interfaces they depend on are built by Blink on other paths than the ones touched (the Event family of the Settings sliders, the first idle callback of the graphics prebuild). Not worth code: no measurable reduction. The finding of 0.13.3 stands (not game code, once a page load each).
## 2026-11-25: 0.13.4 tests and touch audit (in the tree, no version bump)
- Tests: test/stage-avoid-shape.test.js (new): `mkShape` field layout and hidden `grp`; `deadEnds` on a small synthetic city (both loose ends, none for a 5 m stub, crop end, building, water, a road the graph does not join, no roadGeo, cached); `router.setAvoid` (marks edges through the beam, skips the goal gate, clears on null, still routes); `stageAhead`/`stageBay` never remove parked cars with `home`, `svcHome`, `staged` or the player car while clearing ordinary parked cars in the bay; `heat.ceiling` (default MAX_HEAT, holds at the ceiling); `keepJoinedRamps` through the Downtown Watson garage route. No src change needed, no bug found.
- Touch audit, 748x360 landscape, car, boat, plane, heli, tank and on foot, Minimal and Full HUD: `scripts/hud-cover.mjs` worst 21.9 percent (limit 22); `scripts/touch-test.mjs --size 748x360` 103 of 103; a probe of every touch target (buttons, pointer cursor): none under 44 px, no overlaps (readings taken mid fan transition show 27 px cells, not real); settings menu at large text: no button under 44 px, nothing clipped or off screen. No defects, no src/ui or CSS change.
- Note: under a load average of 20 the game load takes minutes (the scripts 240 s wait for the fleet timed out); killed runs leave headless Chromium processes behind.
- 0.13.4 note: a player's car hit by an aircraft now also gets the crash floor (consistent with damageVehicle).

## 2026-11-25: 0.13.5 audio mix (in the tree, no version bump)
- Offline review in node of all 220 buffers (scripts/audio-analyze.mjs, JS path): seams, edges, DC, dropouts, level per group and per craft (car, boat, prop plane and heli, tank). No clipping, no buffer over -0.9 dBFS (audio-harsh.test.js unchanged, nothing loosened). Nobody has listened; numbers are proxies.
- Found and fixed: `fireCrackle` is played as a loop (systems/audio.js loopSrc) but the bank listed it as a one-shot, so no loop rule ever saw it; banks.js `LOOP_SHOTS` now lists it in `loops` (seam measured 0.00 of the largest inner step: it was already seamless).
- Seen, not changed: loops that are quiet on purpose (birds, crickets, lap); horns and the tail rotor loop have a seam step of 0.7 to 0.85 of their largest inner step (no click, pinned at 1.0); tankTracks RMS -8.5 dBFS is the loudest bed (90 percent under 100 Hz, a phone speaker drops it); sirens run -6.6 dBFS RMS with 3.5 dB crest but the system gain tops at 0.5. Mix gains live in src/systems/audio.js (not this task's file), so the per-bus balance is measured on buffers only.
- Tests: test/audio-mix.test.js (new): loop seam step at most the largest inner step, DC, no 50 ms gap under 0.3 of the RMS (birds, crickets, lap excepted), RMS caps (-8, sirens -6); one-shots start under 2 percent and end under 1 percent of peak, sound within 30 ms, tail 45 dB down, at most 5 s; engine rpm ladders per craft (steps at most 6 dB, never quieter, lift-off quieter than throttle on, character spread 7.5 dB at idle and 6 at full rpm); loudness caps for UI (-9.5), weapons (-10.5) and ambience (-12).
## 2026-11-25: 0.13.5 menus and saves (in the tree, no version bump)
- About (src/ui/title.js, shared by the title and pause menu): new line "free and plays offline. It has no ads and no purchases." beside the original-game credit and the OpenStreetMap (ODbL) map credit. public/privacy.html contact is now the literal PRIVACY_EMAIL_PLACEHOLDER (it had a different bracket text that a single search missed; docs/STORE.md asks for the literal).
- Saves: test/badsaves.test.js (new) feeds empty, garbage, truncated, wrong-type, future-version (99), proto-key, 300 KB and 50k-deep values to rustwater.save.v1, rustwater.explore.v1 (also over its 20 KB cap) and rustwater.map, plus blocked/throwing storage: load never throws, defaults or sanitized values come back, and the result saves and reloads. No save.js change was needed. Note: a main save over 100000 characters or an explore save over 20000 reads as a new game (by design, not a crash).
- Tests: test/about.test.js. ui-test: 711 checks ok, no FAIL; the final liveLayout step timed out waiting for the game (240 s) at load average 37, not rerun. The menu walkthrough found no overflow or keyboard-only dead end in the existing ui-test checks; no menu.js change.

## 2026-11-26: 0.13.6 RC audit (in the tree, no version bump)
- Full audit of 0.13.5, details in docs/RC.md "0.13.6 RC audit": lint, build, offline test, npm audit, versions, store assets and privacy all pass; two timing tests flaked under load and pass alone; release:check fails only because the 0.13.5 code is already recorded.
- Fixed (docs and public only): ANDROID.md and STORE.md version references, privacy.html (session storage, Daily Three, map data, date).
- Open: first play gzip about 1.0 MB against the 0.95 MB figure in docs/PERF.md.
- 0.13.6 note: the audit helper measured first-play gzip about 1.0 MB against 0.95 MB in PERF.md; the game bundle alone is 0.70 MB gzip. Not re-measured end to end, so PERF.md is unchanged.
## 2026-11-25: 0.13.5 AI behavior (in the tree, no version bump)
- Review: a node harness (scratch, not committed) on the survival.mjs game (traffic, peds, parked cars, police, combat in game.js order): the player's car drives the streets on a route driver for 10 minutes in each of the five regions, seeds 3 and 4, counting AI car pairs in contact (once per pair per 10 s), contacts over 3 m/s, cars flagged stuck, cars standing 45 s or more, wrong way and left of the divider, cars and walkers appearing in view within 80 / 60 m, walkers in the sea or in solids; a walking run with a shot every 15 s for walkers; heat 1 and 3 chases. drive-review.mjs (browser) not run: load average 30 to 45 on the shared machine.
- Before to after (all regions, both seeds, 10 minutes each): cars stuck 75 to 5, cars standing 45 s 47 to 20, car pairs in contact 116 to 65, contacts over 3 m/s 60 to 30, wrong way on the path 26 to 11, the harness car's distance 37.6 to 42.9 km (run to run noise is about 20 on the counts; the stuck and contact counts moved well past it). No pop-in in view, no walker in the sea, before or after.
- Defects fixed (src/systems/traffic.js unless said):
  1. Dead ends (the most common): the U-turn keyhole swung 12 m past the end node, into the 0.13.2 barricades (1.25 m past it): the car wedged there for 20 s and was flagged stuck (West 19, South 11, North 13 of a run). At a node with one road the U-turn is now as tight as the car can make it and stays 0.5 m short of the node, between the two lanes; `deadEndAhead(city, edge, from)` (cached, through two-way bends) keeps through traffic out of cul-de-sacs (weight 0; roads to the crop edge 0.2), and a spawn on a dead-end street faces out.
  2. Bends: a left-hand bend (degree two, no junction) got the 11 m left-turn radius, so cars on short bent streets (the South Pointe turning loop at the end of Ocean Drive, 6 to 12 m edges) ran off the path, lost it (lat 16 m) and hit each other. Bends use the car's own turning radius.
  3. Merges: two approaches into the same lane of one exit (a side street onto a one-way, the arms of a fan junction), or two cars from one approach whose turns cross (a left turner heading for the far lane for its next turn, SW 8th Street at SW 9th Avenue), met past the box where neither saw the other on its path. Zipper rule: the car nearer the exit is the car ahead at that distance, the other keeps its gap. The deadlock breaker now also covers it.
  4. The box: a crossing car moving in the junction box now holds a car at its line however long it has waited (the 3 s give-way timeout sent cars into it at all-way stops) and at a light gone green (a late car still crossing).
  5. A car right at the bumper but off the local path (a path cut short by short edges, a car swung wide) counts as the car ahead (2 m), with the deadlock breaker.
  6. Gridlock: a car that has stood behind another for 40 s goes once it is out of the player's sight and 30 m off.
  10. Left turns onto a short link (the 15 m links of cluster junctions, South SW 15th Road at SW 1st Avenue): the 11 m wide left curve ended past the link's far node, so cars ran 5 to 7 m off their path and into each other; the radius is now capped by what the two edges hold.
  11. The zipper of item 3 holds only near the merge (35 m to the exit, the other car within 10 m of its turn and moving or in it): a U-turner at a Downtown light waited on a patrol car 50 m off at its own red.
  12. A car held at its line by a queued exit now counts as waiting, so the deadlock breaker sees a turner across a queue and the queue's head waiting on each other (Downtown 408, the harness car's 10 minutes went from 0.6 to 3.8 km).
  7. Peds (peds.js): sidewalk lines and park and beach strolls were built only inside MIAMI_CORE, the old whole map's core box (= Downtown), so the Beach start (Ocean Drive) and most of the North, West and South streets had no walkers (Beach start 0, now 13 to 18 within 80 m; South start 0, now 2 to 6). A region map is played whole; the whole box keeps the core rule. The last-resort spawn in view took the last try's place, which could be 25 m off in plain view: now only a place over 60 m off.
  8. Service vehicles in traffic were limited to the same core box: on a region map they may now appear anywhere (traffic.js; pickTrafficService unchanged).
  9. Police (police.js `isRam`): a contact counted as the player ramming when the player's whole speed was the higher one, so a patrol car swiping a faster player from the side or behind gave the player heat (seen at heat 3: up to 4 stars, never escaped in 5 minutes). Now each car's speed toward the other.
- Tests: test/ai-behavior.test.js (dead end U-turn short of the barricade and out, in three regions; no driver headed into a dead end where another way exists; ten merges in West without contact; walkers at four region starts; the ram rule), test/police.test.js (a heat 1 chase car never touches a car at 12 m/s from five start places; passed before as well). The dead end, merge, walker and ram tests fail on the old code.
- Seen, not changed: 14 of 784 signals give two crossing approaches green together (`e.horizontal` decides the phase per edge; the drawn lights use the same flag, world/render); gridlocks still form in tight signal clusters (Downtown 405/408/409 near Biscayne, North 589/590) and the jam rule clears them only out of sight; a jogger slid along inside a building seam in Downtown (-822, 611) once; heat 1 chase cars touched the harness car 1 or 2 times a run at 4 to 5 m/s (the route driver brakes hard; no contact in the node chase test).
## 2026-11-26: 0.13.5 frame hotspots (in the tree, no version bump)
- Step profile of the Phone check drive (4x, `perf-phonecheck.mjs --profile`, samples cut to the step) in Beach and Downtown, outside combat and helipilot: collision.js (resolveIn, heightAt, rayList, raycast) 9 to 15 % of the step, ground.js with junctions.js 1 to 3 % (Beach) and 9 to 12 % (Downtown), the minimap 1.5 to 2 %, route tracker and HUD under 20 ms a minute. Numbers in docs/PERF.md "Frame hotspots of the step (0.13.5)".
- Changed (world/collision.js, world/ground.js): exact quick rejects in front of the circle and capsule tests of resolveIn and the capsule test of rayList, no closure per capsule in rayCapsule; ground's gap and fill caches as arrays, an interleaved per-edge record for geoSurface's reject, the junction box before the gore rings, the narrow-gap net caches as typed direct-mapped tables (no boxed keys).
- Behavior: byte-identical (node hash of ground, resolve, height and ray answers, netQuads, fills, gaps and a 900-step survival drive, Beach and Downtown, same before and after). Node replays: raycasts 1.8 times faster, ground on fresh caches and resolveCircle about the same to a few percent; in Chrome at 4x no change beyond this machine's run-to-run noise (10 to 15 % on the step's total).
- Tried and taken out: a cell-list cache with packed shape boxes (node: resolveCircle -28 %, heightAt -18 %; Chrome: the cache itself cost 380 to 650 ms a drive, a net loss).
- Gates: eslint, npm test 1191 of 1192 (the H1 spatial timing test under load; passes alone), smoke --extra ok.
- 0.13.6 review lows (not fixed): traffic.js:143 dead-end fallback order; police.js:220 ram closing speed measured along the center line; traffic.js:632 boxOcc wait has no timeout (jam despawn at 40 s covers it).
- Phone check from the owner on 0.13.6 (miami-south, 780x360, standard handling): median 16.6 ms, worst 33.4 ms, 3 frames over 33 ms, render scale 1.75, start 3.5 s, memory 215 MB, slowest system police 2.4 ms. Frame rate is fine; the soft look matches scale 1.75 (raised in 0.13.7). Police 2.4 ms in South is worth a look.
## 2026-11-26: 0.13.7 sharpness and lag (in the tree, no version bump)
- Owner on a Galaxy S24 Ultra (Chrome, landscape, devicePixelRatio 3.5, 915x412 CSS px): the picture was soft, pixelated and laggy. Causes found on the code path:
  1. Caps too low for a dense screen: Normal drew at 1.6 (1464x659 on a 3200x1440 screen, each drawn pixel blown up 2.2 times), Low at 1.2, High at 2 (render/adaptres.js `maxRatioFor`).
  2. The adaptive resolution blamed the pixels for frames the main thread made late (a slow step, tile builds, a collection). A phone with a GPU to spare but one late frame in nine was walked from 1.6 down to the 1.0 floor (each drawn pixel 3.5 screen pixels wide) and stayed there, still laggy; the level was saved and the next start began there, 30 s before the first probe up, 0.05 a probe, the wait doubling to 60 s.
  3. The first-run benchmark counted the frames of the shader warm-up behind the title (a run spoiled that way set Low, cap 1.2) and a benchmarked Low or High was never measured again.
- Changed: caps High 2.5, Normal 2.25, Low 1.5 (never over the device ratio); a floor by screen density (`floorFor`: 1.0, 1.5 at a 3.5 ratio; below it detail is shed instead); graphics.js measures each frame's own main-thread time (document.timeline frame start to the end of the draw) and adaptres.js counts a late frame whose work is over 0.8 of the budget as on budget; probes up in 0.1 steps, the probe wait tops at 20 s, a saved lower level probes after 10 s (was 30); main.js starts the benchmark after the warm-up; qualitybench.js `neverChosen` measures a benchmarked Low or High again (never a player's choice). Settings, Display: the Graphics quality row says the tier drawn now ("Now Normal at 2.25x", "of 2.25x" under the cap, "detail shed").
- Measured (headless Chromium, 915x412 at deviceScaleFactor 3.5, same run): default buffer 1464x659 before, 2058x927 after; sharpness of the street view (Laplacian std. dev. of a 1:1 crop) 5.6 at 1.0, 8.7 at 1.6, 12.1 at 2.25. Adaptive controller on phone traces (node, old against new): one late main-thread frame in nine, 180 s: old lowest 1.0 and stays (mean 1.07), new 2.25 throughout; a 15 s GPU-bound spell: old back to its cap 36.8 s after it, new 22.7 s; GPU-bound over 1.8: new settles at 1.8 to 1.85.
- Seen, not changed: draw calls and triangles unchanged (Beach start Normal day 130 calls, 240k; shadow pass about 17 of them); textures already have anisotropy 8 (4 on roughness and emissive maps) and mipmaps; paint edges are geometry under 4x MSAA, its 256 px chip texture needs nothing more; no shadow acne in 1:1 crops at 2.25; rain is one draw of 1200 one-pixel lines and the 0.13.5 car lamps are a ground shader loop at night only (pool quads scaled away), neither a real frame cost. Fill cost at Normal on that phone is about twice the old (1.9 MP against 0.96 MP); the adaptive controller now steps down only for GPU-bound frames, to 1.5 at the lowest.
- Gates: eslint clean; npm test 1203 of 1204 (the dressLot timing test under load, passes alone); smoke --extra ok (80 checks, no page errors, no network); ui-test 711 checks ok, no FAIL, the final liveLayout step (dpr 1, not touched here) timed out waiting for the fleet at load average 20 to 22, twice, as in 0.13.5.

## 2026-11-26: 0.13.7 road logic (in the tree, no version bump)
- Owner's test drive on a phone: grass in the streets, illogical multi-lane streets, streets going from big to small, lines all over the place. Street-level review (`scripts/drive-review.mjs --size=748x360`, routes and `--survey --day`, all five regions, before and after; `--at` top views on the Beach) and node checks of the drawn road against the ground. Details and the defect table: docs/STREETSCAPE.md "0.13.7 road logic"; the rules: docs/MAP.md "0.13.7 road logic".
- Lanes by class (world/roadprofile.js `laneCaps`): local 1 + 1, collector 1 + 1 and a turn lane, arterial 2 + 2 and a turn lane, more only on trunks and motorways; two-way roads always equal each way (the 0.12.6 Beach turn lane rule now everywhere); an untagged collector one-way has 1 lane (was 2 lanes and 2 parking lanes, 12 m). A divided half never parks on its left curb (two such halves side by side were 24 m of asphalt); its median is judged as if both halves parked on both curbs. Local two-way streets of 2 + 2 or more: 55 to 0.
- One cross section along a street (`harmonizeStreets`, after the graph walk): a straight run of one street (each edge the other's straightest partner, no fork) takes the lanes, turn lane and parking of most of its length; a block tagged under 4 lanes is not widened past 15 m. Lane changes at straight same-street joins, five regions: 576 to 7.
- Paint: local streets unmarked (a local one-way of two lanes keeps its lane line); park lines only on collectors and up; `paintRivals` samples 3 m past both strip ends (a bend's miter paint crossed South Pointe Drive).
- Grass in the streets: median ends were two lobes with a notch (each half's half disc), now one round end (render/citymesh.js `nose`), a wide median's middle filled 6 m back; no median or nose drawn where the ground says road (a crossing street, South SW 15th Road); `medianAt` measures pairs over 8 m too. Forks of near-parallel arms: the arms' strips from node to mouth drawn as junction asphalt (`armUnderlay`). Road the ground calls road but drawn bare: Downtown core 0.19 % to 0.04 %, North 0.13 to 0.03; lawn or sidewalk drawn on road, South 0.43 % to 0.10 %.
- Followed the road change: event spots skip a run that starts at a dead end (world/eventspots.js; a 38th Street gate could only be reached through itself); the service homes' three marked curb bays are kept as curb spots (world/miami.js `CURB_BAYS`: the seeded curb draws run in one sequence over every edge); Central Patrol Base police home 0.9 m east (entities/servicevehicles.js data, Water Avenue's west curb is 2.4 m nearer its middle); the first light ahead of the designed start turns green as the game starts (world/miami.js `startLight`, `node.phase` read by citygen.js `signalState`; the phase came from the node id, and the renumbered graph left the first view's cars at a red light for 8 s).
- Re-pinned on purpose with notes: region fingerprints, all six (test/regions.test.js); the generated ramps of Beach, West and South (test/stunts.test.js). Tests changed with the rules: roadprofile (tag kept inside the class's lanes, 2 + 1 is 1 + 1 and the turn lane, a secondary one-way of 4 is 3), beach-checklist (the turn lane rule holds everywhere), ground (the sidewalk probe 1 m past the real right curb, `off` included). New: test/roadlogic.test.js.
- Gates: eslint clean; npm test 1201 of 1203 at load 10 (the dressLot timing test, passes alone; the density floor below); smoke --extra ok; gps-audit no illegal or missed routes.
- Open: test/world-density.test.js "density floor" fails on one Beach yard (lot 2068, 5100 -2636, 475 m2 at 0.76 of the floor): West 26th Street's narrower halves gave the yard two more raster cells (425 to 475 m2) and its dressing did not grow. Lot dressing (world/lots.js) is props work, not changed here.
- Budget, Normal street view (perf.mjs): Beach day 127 calls / 234k; Downtown day 208 / 294.5k (static city 64.2k to 62.0k triangles; the rest is traffic, which varies run to run); North 187 / 253k, West 150 / 268k, South 118 / 264k; 60 programs. No new shader program, no per-frame code changed.

## 2026-11-26: 0.13.7 render safety (in the tree, no version bump)
- Follows the independent review of "0.13.7 sharpness and lag" (raised caps on a 3.5 ratio phone). Four risks fixed or checked:
  1. GPU stalls counted as JavaScript: the frame's `work` ran from the frame start to the end of the draw, so a GPU wait inside the draw calls (the bloom copy most of all) made a GPU-bound phone look main-thread bound and it never stepped down. Now game.js marks the frame's first step (`game.frameStartMs`, set by the loop's own step and draw wrappers; game logic never reads it) and graphics.js `noteWork` stops the clock just before `renderer.render`. adaptres.js excuses a late frame only when its work is over 0.8 of the budget and at least half the frame (`cpuShare`), so 14 ms of steps in a 33 ms GPU-bound frame still lowers the resolution.
  2. No canvas size cap and no context-loss handling: the ratio is now also capped so the drawing buffer stays within the context's MAX_RENDERBUFFER_SIZE, MAX_VIEWPORT_DIMS and MAX_TEXTURE_SIZE (bloom copies the frame into a texture) and a pixel budget of 2.6 million (Normal, Low) or 3.2 million (High) (adaptres.js `contextLimits`, `sizeCapFor`, `pixelBudgetFor`; game.js resize passes the CSS size). The phone at 915x412 keeps 2.25 (1.9 million pixels, "Now Normal at 2.25x" unchanged); a 1280x800 tablet is held to 1.55. `watchContext` claims a lost context (preventDefault); when it comes back the rest of the session draws Low (tier and the 1.5 cap), the sky reflection is redrawn and the canvas resized; a notice shows while it is gone and a tap on it reloads. Checked in headless Chromium at 3.5 dpr with WEBGL_lose_context: 2058x927 before, notice shown while lost, 1372x618 at Low after the restore, 99 draw calls, no page errors.
  3. Low could not adapt on a dense screen (floor 1.5 = Low cap 1.5): `floorFor` now tops at 1.25 (`FLOOR_MAX`).
  4. Glass program variants from the contact-shadow morph target: every region still has 60 programs after the first draws (perf.mjs, Beach, Downtown, North, West, South, day and night views). New test/glassvariant.test.js: every car glass mesh of every car and service vehicle, through damage, LOD and a wreck, carries exactly the one relative morph target (one program); boats and aircraft do not use the car glass. scripts/perf-phonecheck.mjs `--check` has a fourth row, programs in all at most 60 (`LIMITS.maxPrograms`), for any `--map`.
- Tests changed with the rules (reasons in the tests): adaptres floor 1.5 to 1.25 at a 3.5 ratio; quality-tier floor at least 1.25 and under the Low cap; perf-phonecheck gate rows 3 to 4. New adaptres tests with synthetic frame timings: GPU-bound steps down (light work, and 14 ms of work in a 33 ms frame), JavaScript-bound does not (every frame, and one in four), recovery after a 15 s GPU-bound spell (under 60 s), Low adapts on a dense screen, size caps, context limits from a fake context, context loss on a fake canvas.
- Not changed: `resAfter` in perf-phonecheck still feeds frame times without a work hint (the resolution if every late frame were the GPU's). No new shader program, no per-frame allocation (the context watcher and the caps run on events and resizes only).
- Gates: eslint clean; npm test 1226 of 1231 at load 6 (fixed after: quality-tier floor; passing alone: the two whole-box build timing tests and dressLot; failing: the density floor, open since "0.13.7 road logic"); smoke --extra ok (81 checks, no page errors, no network).
- 0.13.7 released: logical streets, props off the road, car fixes, ground-bound jump shadow, higher and safer render scale, chase camera view, redesigned menus. Review mediums fixed (signal cluster phase, unlit junctions, reduce motion). Open lows: GPU draw before noteWork in updateEnv, context-loss notice height, double dropped count on failed retry, tier note wrap, high-contrast faces specificity.

## 2026-11-26: 0.13.8 stutter and start (in the tree, no version bump)
- Owner on 0.13.7: "glitchy and slow" (weaker phone, Downtown: worst 83.7 ms, 397 frames over 33 ms, scale 1.35, start 9.8 s). Hitches found with `scripts/perf-phonecheck.mjs` at 4x (details and the cause list: docs/PERF.md "Stutter and start (0.13.8)"): street tile slices up to 168 ms (a 60 m box of the narrow-gap net flood, three junctions in one piece), per-frame uploads of empty or unused instance slots (seawall view 300 KB a frame, signal lamps, the wake trail), first-play mesh builds with ?autostart.
- Changed: tile job one junction a piece, the net one kind a piece and kept per box (render/realcity.js, citymesh.js netRoads); start builds only the 2 or 3 tiles the first view needs, one progress stage each, the rest stream (6 ms a frame behind the title); Normal near tiles to 300 m (Low 280, High 340); props and lot dressing by tile quarter within 110 m (Normal); signal bulbs short of the middle level; wake trail off when idle; cars body-only past 60 m; edge-walls and signal lamps upload only slots in use. perf-phonecheck names the tile work of slow frames, each system's worst-call frame per pass and the programs compiled in play.
- Measured (4x, 2 passes, same session, 0.13.7 then 0.13.8): drive frames over 14 to 8, worst 72 to 45 phone ms, frames with over 256 KB uploaded 213 to 80, start 14.9 to 11.4 s; Downtown street view with the same tiles 210.6 calls / 292k triangles to 171 / 217k (perf.mjs as it stands: day 163 / 209k, night 163 / 206k, was 208 / 294.5k; 60 programs). Tile meshes identical (hash of six Downtown tiles); no simulation change, no new program.
- Not reached: the 80 % cut of frames over, every system call under 4 ms and a 5 s start at 4x. Left: the net flood in world/ground.js netQuads (30 to 50 ms at 4x a box, needs a resumable form there), the check start's objective route (30 ms), combat's first hit (13 ms and one physical program compiled), parked's first lot cars in first play, createMiamiCity, textures and attachExplore at start.
- New test/stutter.test.js (net by kind and from the cache, staged start tiles, props quarters by distance, bulbs).
- Gates: eslint clean; npm test 1239 of 1239; smoke --extra ok (81 checks, no page errors, no network).
- 0.13.8 released: junction stubs (traffic circles) fixed at the root, paired one-way roads keep one yellow line, gradual width tapers, drawing load down about 29 percent in Downtown, hitch fixes (route search, ground net, gun shader back to 60 programs), realistic parking lot occupancy, parked system 9.2 to 2.1 ms. Review medium fixed (spawn tiles flushed at start). Open lows: route job drop handling, netCache growth, provisional parked records, start time still about 11 s throttled.
- Phone check from the owner on 0.13.8 (miami-south, 700x278 windowed): median 16.6 ms, worst 50.0 ms, 6 frames over 33 ms, render scale 2.40, start 4.6 s, memory 257 MB, slowest system peds 1.9 ms. Better than 0.13.7 on the same map (10 over 33, peds 7.2 ms).

## 2026-11-27: 0.13.9 visual glitches (published)
- Sweep at the phone's size (780x360 CSS px, deviceScaleFactor 3, render scale 2.25, buffer 1755x810): `scripts/drive-review.mjs --survey --dpr=3` (new `--dpr`), Beach day and night, and the new `scripts/glitch-seq.mjs` (drive, fly at 70 m, boat along the shore; 24 to 40 consecutive 1/60 s frames read back and diffed, a pixel flagged when its brightness reverses three times or more; `--dump` saves every frame) in Beach; node checks of the street tiles' ground in all five regions. Previews (before | after): docs/preview/0139-bridge-slot.png, 0139-bridge-top.png, 0139-fence-shimmer.png, 0139-flicker-start.png.
- Found and fixed:
  1. Bridges: a slot of open sea between the deck and the barrier along every bridge and causeway, 0.25 m wide, about 0.9 m beside a deck drawn off the edge's center line (MacArthur Causeway, off -0.65): the rail line runs RAIL_OFF outside the half width from the center line and the barrier stood centered on it. A concrete ledge now runs from under the barrier to 0.3 m onto the drawn deck (render/props.js `railInward`, the road side and reach once per traced cell; same instanced mesh, no draw call). Test: test/seawall.test.js (Downtown and Beach: the ledge's road end on the drawn deck, more than ten shifted pieces on the Beach).
  2. Picket and chain-link fences and sign cut-outs sparkled at 20 to 80 m (alpha-tested detail atlas, the mipmapped alpha round the 0.5 cut): the detail material uses alpha to coverage (render/citypatch.js; the same 60 programs). Flagged pixels on the Beach start fence: gone (0139-fence-shimmer.png).
  3. See-through draw order: three.js ignores an LOD's renderOrder, so the glass of every LOD car drew at 0, and the rain (4), lamp glows (3) and clouds (2) drew after it, over the windows (clouds untinted through windshields). Glass order on the LOD's meshes (render/vehiclemesh.js `GLASS_ORDER`), the sky first (`SKY_ORDER`), the rain, glows and wet streaks after the ground decals and before any glass (systems/daynight.js `BEHIND_GLASS`). Test: test/visualglitch.test.js (every car, boat and aircraft glass after the rain; fails on the old code at the first LOD car).
  4. Shadow frame: the shadow camera's axes turned with the sun, which daynight.js moves in 0.1 degree steps (three a second at the 14 minute day), and its texel snap was taken from the world origin 2 to 6 km away, so each step slid the texel grid by meters and drew every shadow edge again on other texels. The map is now the ground seen along the sun (render/shadowframe.js): the texel grid lies fixed on the ground in world axes, the middle snaps by whole texels, the sun is read at the frame's clock (smooth), shading keeps the true sun. Test: test/visualglitch.test.js (ground points never change texel phase; 4 and 8 m high points under 0.05 texel a frame; the old frame jumped over 100 times in the same 10 s). Shadows look the same in side-by-side frames at 9:30, 13:00 and 16:48 from the street, 45 m and 70 m.
  5. Sea: the near patch's rim fades down to FAR_Y, the height of the far plane, so its last meters 200 m out lay on it and could fight for depth; the far plane now sits 10 cm lower (render/water.js `FAR_PLANE_Y`). Test: test/visualglitch.test.js.
- Checks added: test/coplanar.test.js builds the start tiles of all five regions in node and finds overlapping flat opaque ground faces under 2 mm apart: across materials none (lots, edging, sidewalks, roads, paint keep their layers); lot layers 2 cm apart.
- Found, not fixed (another helper's files):
  1. render/citymesh.js: white and yellow paint quads lie level on each other at 1.5 cm (Beach start 4749, -200; Downtown -1342, 980), the static frames flag the lane line; two asphalt tones level at 0 (Downtown -860, 917). Recorded as todo tests in test/coplanar.test.js.
  2. A sidewalk flickers in a wedge beside a palm on the Beach parking lot street (about 3800, -300): two slab patterns fight; the node scan of the tile meshes finds no overlap there, so one surface is outside the tiles (citymesh or the lot dressing).
  3. Building roofs and plinths of touching buildings lie level with different colors (Downtown -1106, 882 at 32 m; North, West, South at 0.55 m): z-fighting rooftops seen from the air.
  4. Not reproduced: shadow acne, peter-panning, sky banding (the dome is dithered), tile seams; the eye views' empty lots are a review script artifact (lot cars follow the chase camera). HUD overlap not checked (src/ui).
- Budget (perf.mjs, Normal): Beach day 126 calls / 209k, night 125 / 205k; Downtown day 168 / 212k, night 160 / 199k; 60 programs. No new shader program, no per-frame allocation (the ledge reach and road side are computed once per traced cell; the shadow frame is plain numbers and preallocated matrices).
- Gates: eslint clean; npm test 1269 of 1274 pass, 0 fail, 5 todo (the citymesh coplanar records); smoke --extra ok (83 checks, no page errors, no network).

## 2026-11-27: 0.13.10 saves, launch and review fixes (published)
Independent review of the S1 and S2 work found: the 25 s startup timer began before the 3.9 MB game download (false failure on slow first loads), a latched failure state, rollback that could wipe a save whose old value could not be read, and a harmless rejection flipping the screen to failed. Fixed: 90 s limit until the first progress tick then 25 s, a tick clears a false failure, rollback skips keys it could not read, unrelated rejections no longer fail the shell. CSP hash updated (test recomputes it). Left open (low): sw.js template not in the cache version hash, no-storage browsers now see "could not save", error after ready shows nothing, pause menu opens behind title on a portrait start, knockout text fade lost with hidden.
