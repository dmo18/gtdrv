# Plan

Stack: plain JavaScript modules + three.js (3D library, MIT license),
bundled by esbuild into one HTML file. Tests: node:test for game logic,
Playwright (already installed) for a load-and-drive smoke test at phone
size. Lint: eslint. Dependencies pinned to exact versions.

Architecture (decided): `src/core` (loop, input, save, rng),
`src/world` (city generator, roads graph, collision grid),
`src/entities` (player, vehicle, ped, cop), `src/systems` (traffic,
wanted, missions, economy, audio, daynight), `src/ui` (touch, hud,
minimap, menus). Game logic is kept free of rendering so it can be
tested in node. Fixed 60 Hz simulation step, render interpolated.
City is generated from a fixed seed, built from merged/instanced
geometry to keep draw calls low on mobile.

Every task: acceptance = its check passes, lint clean, reviewed one
tier up, committed.

## Milestone 1: drive around the city
1. Foundations: git, package.json, lint, test runner, CLAUDE.md,
   README, STATUS. Check: `npm test`, `npm run lint`. Model: Haiku
2. Core loop, renderer, seeded city generator (roads, blocks,
   buildings, water, collision grid). Check: unit tests for road
   graph connectivity and collision grid. Model: Fable
3. Vehicle physics and chase camera. Check: unit tests (accel,
   braking, steering, collision response). Depends 2. Model: Opus
4. Touch controls (stick, pedals, buttons) and HUD. Check:
   Playwright touch test. Depends 3. Model: Sonnet
5. Single-file build, phone preview, smoke test with screenshot.
   Depends 4. Model: Sonnet

## Milestone 2: sea and sky
6. On-foot walking, get in/out of any car, boat or aircraft. Model: Opus
7. Boats: speedboat, jet ski, fishing boat; water physics with waves
   and wake, marinas and piers. Check: unit tests. Model: Opus
8. Aircraft: small plane, seaplane, helicopter; flight physics with
   height, airfield islet with runway, camera for flying.
   Check: unit tests (take-off, stall, landing, hover). Model: Fable
9. Minimap, full map, waypoint. Model: Sonnet
10. Generated audio (engines, propeller, rotor, water, impacts).
    Model: Sonnet

## Milestone 3: a living island with things to do
11. Road traffic following the road graph and lights. Model: Opus
12. Pedestrians, plus drifting boats and a circling plane for life.
    Model: Sonnet
13. Activities: street races, boat races, sky ring courses, stunt
    jumps, timed deliveries, with medals. Model: Opus
14. Money, vehicle showroom and garage (unlock cars, boats,
    aircraft), save/load (validated on load). Model: Sonnet

## Milestone 4: polish
15. Light police chases for reckless driving (can be switched off).
    Model: Opus
16. Day/night, weather, phone performance pass (measured frame
    times). Model: Opus
17. Menus, settings, tutorial, accessibility. Model: Sonnet
18. Final verification and security review (fresh reviewer).
    Model: Fable

## Milestone 5: quality overhaul (after first play test)
The owner played the first build on the phone and found steering,
sound, graphics and realism poor. Four tasks, all with on-screen or
measured proof:
19. Steering and driving feel: steering wheel, buttons, tilt and
    slider styles with sensitivity; tire model, gears, weight
    transfer, body motion. Model: Opus
20. Sound rebuilt from generated samples: firing-pulse engines,
    tires, wind, impacts, reverb, ambience, siren. Model: Opus
21. City graphics: shadows, tone mapping, reflections, textured
    roads and facades, street props, traffic lights. Model: Fable
22. Vehicle looks and effects: smooth car bodies, glossy paint,
    damage, smoke, skid marks, sparks, spray, camera feel. Model: Opus

Run cap: 27 tasks, 3.5M delegated tokens.
Security items that apply: no secrets, no personal data, no network
calls at runtime, pinned and audited dependencies, license check,
save data validated on load, review at each milestone.

Change log: user redirected the game toward fun driving, boating and
flying. On-foot combat and crime story missions were dropped; police
chases kept only as a light, optional extra. (Superseded by Milestone 6.)

## Milestone 6: fun and fights
Supersedes the Milestone 3/4 "no combat" decision and the money,
showroom and unlock parts of task 14. Contracts: docs/COMBAT.md,
docs/MISSIONS.md. Every vehicle and weapon is available from the
start; the only progression is scores and best times.

T-steer (another helper, running now) owns vehicle.js, boat.js,
save.js, economy.js, menu.js, scripts/menu-test.mjs, docs/CRAFT.md and
the save/vehicle/steering/boat tests. Tasks marked "waits T-steer"
start only after it is committed. Combat never edits craft step
files: it changes `health`/`wrecked` on craft state from outside.

Estimates include the one-tier-up review (Opus work gets a fresh Opus
reviewer). Each task also passes `npm test`, `npm run lint`,
`npm run smoke`, and screenshots at 915x412 and 780x360.

Wave 1 (now; alone, it creates the stubs the others fill)
23. Combat core and wiring. Opus. New: src/systems/combat.js,
    src/core/weapons.js, test/combat.test.js, and no-op stubs with the
    final export names for src/render/combatfx.js, src/ui/combathud.js,
    src/systems/crew.js, src/systems/score.js, src/systems/missions.js.
    Edits: src/game.js (registers all of them, `game.actors`, player
    downed/respawn), src/entities/onfoot.js, src/systems/peds.js
    (actor fields, knock-down, flee). Accept: actor fields, `damage()`,
    weapons table, hitscan, projectiles, blasts, burning craft, chain
    cap, respawn as in COMBAT.md; peds go down when hit or run over and
    fade out. Check: unit tests for each rule plus a smoke run with
    keyboard fire (F) that shows a downed ped. 300k.

Wave 2 (parallel, disjoint files; after 23)
24. Score system, economy removal. Sonnet. Waits T-steer. Fills
    src/systems/score.js; new test/score.test.js. Edits economy.js,
    save.js (version 2 + migration), menu.js (no Showroom; Records shows
    high scores), fleet.js (drop PREMIUM gating), hud.js (score, combo,
    up to 4 heat badges), activities.js (points not money), game.js
    (progress shape, hudState), test/save.test.js,
    scripts/menu-test.mjs. Accept: MISSIONS.md "Score" rules; old saves
    load with medals, best times, settings and hint flags kept. Check:
    migration tests on old and hostile saves; menu test; HUD shot. 200k.
25. Combat effects and sound. Sonnet. Fills src/render/combatfx.js;
    edits src/render/personmesh.js (down pose, fade, held weapon),
    src/systems/audio.js, src/audio/banks.js; new
    scripts/combatfx-shots.mjs. Accept: every effect and sound event in
    COMBAT.md, pooled, at most 4 extra draw calls. Check: script fires
    scripted events and saves screenshots; draw-call count. 170k.
26. Touch aiming, weapon buttons, aim camera, combat HUD. Opus. Edits
    src/ui/touch.js, src/core/input.js, src/render/chasecam.js,
    src/systems/tutorial.js; fills src/ui/combathud.js; new
    scripts/aim-test.mjs. Accept: COMBAT.md "Touch" and "Camera",
    drive-by in cars and boats, left-handed layout mirrored. Check:
    Playwright touch test aims, locks, fires, swaps, reloads; shots. 220k.
27. Police that fight, rival crew AI, drivers who bail. Opus. Edits
    src/systems/police.js (violence heat, level 4 roadblocks, officers
    on foot, no fines), src/systems/traffic.js (drivers flee burning or
    shot cars); fills src/systems/crew.js; new test/crew.test.js,
    test/police-combat.test.js. Accept: COMBAT.md "Police" and "Crew".
    Check: unit tests for heat, accuracy formula, cover choice, attack
    slots; smoke shot of a level-3 shootout. 260k.

Toys (owner, direction change 3): bombs, grenades, fighter jets,
flyable police helicopters, tanks to steal, bigger police chases.
Contract: docs/ARMS.md. Shared hub files (weapons.js, combat.js,
input.js, touch.js, combathud.js, combatfx.js, audio.js, banks.js) are
edited by task 31 only, so 32 and 33 can run side by side. Every toy
task also passes the per-task checks above (tests, lint, smoke, shots).

Wave 3 (after 26; 27 may still be running: no shared files)
31. Explosives, craft weapon core and every armed-craft control.
    Opus. Waits 26. Edits src/core/weapons.js (sticky, blastScale,
    MOUNTS, createCraftArms), src/systems/combat.js (throw on release,
    predictThrow, stickies and detonate, shell/missile/bomb projectiles
    and type caps, fireMount, predictDrop, spec.armor, own-blast rule,
    craft playerControls incl. police SIREN), src/core/input.js (fire2,
    drop, detonate actions and keys), src/ui/touch.js (arc-aim FIRE,
    DETONATE, armed-aircraft arc, tank twin-stick layout, SIREN),
    src/ui/combathud.js (seeker box, pipper, tank cross and circle,
    pips), src/render/combatfx.js (arc, rings, blinkers, trails),
    src/systems/audio.js and src/audio/banks.js (ARMS.md section 7
    sounds and the 'tracks' and 'turbine' rigs), src/systems/tutorial.js
    (two hints), test/combat.test.js. New: src/core/seeker.js,
    test/arms.test.js, test/seeker.test.js, scripts/arms-test.mjs.
    Accept: ARMS.md sections 1, 2 and 7, tested with fixture specs (the
    real tank and fighter come in 32 and 33). Check: unit tests (arc
    preview lands within 0.5 m of the real throw; sticky sticks, rides a
    moving craft, fizzles, 5th replaces the oldest; detonate respects
    the chain cap; per-type caps; missile hits a turning target only
    when locked; predictDrop within 1 m; armor and own-blast rules;
    seeker 0.8 s lock, 1.0 s break, cycle); Playwright arms-test throws
    with preview, places and detonates 2 charges, fires GUN, MSL, BOMB
    from a fixture armed heli; draw calls at most +3. 220k.

Wave 4 (after 31; 32 and 33 in parallel, disjoint files)
32. Rustback tank, Ironbank Depot and spawn places. Opus. New:
    src/entities/tank.js, src/render/tankmesh.js, src/systems/armor.js
    (player turret aim, crush damage, crew bail, tankGunnerStep AI
    core), test/tank.test.js, scripts/tank-test.mjs. Edits src/game.js
    (kinds.tank, tank pairs via collideTank, parked-tank sleep),
    src/world/citygen.js and test/citygen.test.js (depot, tank spots,
    Cinder Row tank, fighter and patrolheli spots, roof pad, POI; all
    appended after rng use), src/systems/fleet.js (tank spots),
    src/render/chasecam.js and test/chasecam.test.js (tank views),
    src/render/vehiclemesh.js (crushed body), src/ui/minimap.js and
    src/systems/mapui.js (tank and police heli blips, depot icon).
    Accept: ARMS.md section 3; city before the appended items
    unchanged. Check: unit tests (pivot in place, speeds, no side slip,
    walls and shore stop it, crushes a sedan above 2 m/s but only pushes
    a bus, people knocked down not crushed, 200 Buzzbox hits barely
    scratch it and 3 charges wreck it, turret holds world aim while the
    hull turns, gunner rules); citygen tests (spots on land, clear of
    buildings, deterministic); Playwright tank-test enters the Cinder
    Row tank, drives, crushes a parked car, fires; shots; draw calls at
    most +4 per tank. 210k. (Until 33 lands the fighter and patrolheli
    spots fall back to the Pipwick spec.)
33. Gannetfang fighter, Lampwatch police heli, heli AI pilot. Opus.
    Edits src/entities/aircraft.js and test/aircraft.test.js (two specs,
    noStall, cruise floor, auto-level, Oxbarrow bombs),
    src/render/aircraftmesh.js (two models, light bar, fake beam). New:
    src/systems/helipilot.js, test/helipilot.test.js,
    scripts/flight-arms-test.mjs. Accept: ARMS.md section 4. Check: unit
    tests (fighter airborne within 3.5 s and 400 m; 60 s of random stick
    never stalls; cruise floor holds; Lampwatch hovers; pilot orbits a
    moving target over Glasswell for 60 s at 55..70 m without touching a
    roof; strafe cadence, evade, leave, crash reaches the ground and
    explodes; gunner formula); Playwright takes off from the depot,
    locks and missiles a fixture target, drops a bomb, flies the police
    heli with siren; shots; draw calls. 240k.

Wave 5 (after 27, 32, 33)
34. Escalating chases, heat 1 to 5. Opus. Waits 27. Edits
    src/systems/police.js (MAX_HEAT 5, unit table, helis through
    helipilot, level-5 tank through chaseStep and tankGunnerStep, heli
    sight and call-in, air and sea rule, swap-craft cooldown, caps, tank
    crew bail), test/police.test.js, test/police-combat.test.js,
    src/ui/hud.js (5 heat badges). New: test/chase5.test.js,
    scripts/chase-test.mjs. Accept: ARMS.md sections 5 and 6. Check:
    headless runs (units per level match the table; caps hold through a
    seeded 10-minute rampage; heli follows to sea at level 3; line of
    sight escape; tank never fires under 15 m or at a player on foot
    who has not hurt it, shell damage cap; a player who keeps moving is
    never downed by heavy units alone in 20 s); Playwright scripts a
    level-5 chase, shot with heli, tank and roadblock; draw calls under
    420, step time logged. 190k. Cut first: the level-5 tank (level 5
    then = 2 helis and a double roadblock; saves about 45k).

Wave 6 (after 34; uses the toys as SPAWN kinds 'tank' and 'patrolheli')
28. Mission engine and missions 1 to 3. Opus. Fills
    src/systems/missions.js; new src/world/missiondata.js,
    test/missions.test.js, scripts/mission-test.mjs; edits
    src/systems/activities.js (hide starts during a mission). Accept:
    MISSIONS.md schema, every objective type, retry and skip rules,
    briefing cards, map markers. Check: node tests run each objective
    type headless; Playwright plays mission 1 start to end. 240k.

Wave 7
30. Milestone review, phone performance and security pass. Opus, fresh
    reviewer. Read-only plus a findings list for the lead. Check: step
    time and draw calls in a 20-actor shootout and a level-5 chase
    versus the 370 baseline (under 420); save fuzz; no network. 100k.

Parked: 29. Missions 4 to 8 as data (Sonnet, 130k) does not fit the
2.8M cap; the game ships with missions 1 to 3.

Totals: about 1.45M spent when 26 and 27 finish. Remaining: 31 220k,
32 210k, 33 240k, 34 190k (toys 860k, planned 880k), 28 240k, 30 100k
= 1.20M. Stage total about 2.65M against the 2.8M cap (150k margin).
Cut first, in order: level-5 tank in 34 (45k), task 28 down to the
engine plus mission 1 (80k), stickies riding moving craft in 31 (15k),
police heli spotlight beam in 33 (10k).

Later (parked): tuning garage and car upgrades; championships with AI
rivals; missions 4 to 8; AI fighters; ejection seat; knocking over
lamps and trees; pickups and armor.

Change log: owner asked for "more GTA and Gran Turismo combined":
full sandbox combat (blood allowed, no dismemberment), story missions, and scores in
place of money. Earlier "no combat" decision superseded. Then (direction
change 3, cap 2.8M): bombs, grenades, fighter jets, flyable police
helicopters, stealable tanks and heat-5 chases added as tasks 31 to 34
(docs/ARMS.md) ahead of missions 28 and review 30; task 29 parked.

## 0.14.0 plan: external review round (2026-11-27)
Source: owner pasted a mobile review of commit 310b4b9. Claims re-checked against HEAD 438c1e3: travel save ignored result, Continue awaits fullscreen, recordTry drops first fails, sw.js single addAll, stale hints, knockout text all still present. Budget left about 1.3M of 32M, so two helpers on disjoint files, then one gate and review.
- S1 (Sonnet): saves and records. Files: src/systems/session.js, src/core/travel.js, src/core/records.js, src/systems/events.js, public/sw.js, src/systems/tutorial.js, src/ui/combathud.js and tests. Items 1, 6, 10, 8, 9.
- S2 (Sonnet): launch and quality. Files: src/main.js, src/index.html, src/core/qualitybench.js, src/game.js orientation pause and tests. Items 2, 3, 4, 5.
- Deferred (budget): tank fence overlap (item 7), publish workflow browser gate, combat harness fixtures, Daily Three midnight refresh, share link, privacy email (owner input).

## 0.15 plan: roads and gameplay to production (2026-11-27, owner approved, cap 60M, about 33M used)
Owner: "Roads are a mess and make no sense. Focus on gameplay, map and roads. Bring the game out of alpha."
- Milestone A, roads that make sense. D1 (Opus, read-only): diagnose with renders and data audits, rank root causes, write a design to docs/ROADS.md. Then implementers on disjoint files (data cleanup in src/world/miami.js and realcity.js; mesh and markings in citymesh.js and streetscape.js; junction geometry), each with measurable before/after audits (street-align.mjs, aerial-review.mjs, drive-review.mjs). Acceptance: fewer curb kinks, jogs and width jumps; lane count and markings consistent per street; no grass wedges in junctions; no props in lanes; every audit number reported before and after.
- Milestone B, gameplay to production: first-run flow (first medal teaching, clear feedback, retry on one tap), failure feedback, event approach routing, Records. Combat damage bug (burning car at 1 health becomes plain wreck). Review lows.
- Milestone C, release candidate hygiene: pin Playwright and make the smoke job block publishing (owner approved), concurrency fix, privacy email stays placeholder until owner supplies it.
- Routine: one gate and one independent Opus review per publish; models ladder; never loosen a test.
