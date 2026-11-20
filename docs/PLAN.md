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
chases kept only as a light, optional extra.
