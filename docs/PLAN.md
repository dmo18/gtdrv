# Plan

Stack: plain JavaScript modules + three.js (3D library, MIT licence),
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
    slider styles with sensitivity; tyre model, gears, weight
    transfer, body motion. Model: Opus
20. Sound rebuilt from generated samples: firing-pulse engines,
    tyres, wind, impacts, reverb, ambience, siren. Model: Opus
21. City graphics: shadows, tone mapping, reflections, textured
    roads and facades, street props, traffic lights. Model: Fable
22. Vehicle looks and effects: smooth car bodies, glossy paint,
    damage, smoke, skid marks, sparks, spray, camera feel. Model: Opus

Run cap: 27 tasks, 3.5M delegated tokens.
Security items that apply: no secrets, no personal data, no network
calls at runtime, pinned and audited dependencies, licence check,
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

Wave 3 (after 24, 26, 27)
28. Mission engine and missions 1 to 3. Opus. Fills
    src/systems/missions.js; new src/world/missiondata.js,
    test/missions.test.js, scripts/mission-test.mjs; edits
    src/systems/activities.js (hide starts during a mission). Accept:
    MISSIONS.md schema, every objective type, retry and skip rules,
    briefing cards, map markers. Check: node tests run each objective
    type headless; Playwright plays mission 1 start to end. 240k.

Wave 4
29. Missions 4 to 8 as data, plus tuning. Sonnet. Edits
    src/world/missiondata.js only (plus test fixtures). Check: each
    mission passes a scripted headless run and a start-point shot. 130k.
30. Milestone review, phone performance and security pass. Opus, fresh
    reviewer. Read-only plus a findings list for the lead. Check: step
    time and draw calls in a 20-actor shootout versus the 370 baseline;
    save fuzz; no network. 100k.

Total about 1.62M; target 1.5M. Cut first, in order: task 29 (ship 3
missions; saves 130k), level-4 roadblocks in 27 (about 40k), drive-by
in 26 (about 30k), grenades from the weapons table (about 20k).

Later (parked): tuning garage and car upgrades; championships with AI
rivals; police helicopter; weapons on aircraft; pickups and armour;
more missions.

Change log: owner asked for "more GTA and Gran Turismo combined":
full sandbox combat (no blood or gore), story missions, and scores in
place of money. Earlier "no combat" decision superseded.
