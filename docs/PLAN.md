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

## Milestone 2: a living city
6. On-foot player, enter/exit/take vehicles. Model: Opus
7. Traffic AI following road graph, lights, avoidance. Model: Opus
8. Pedestrians (walk, flee, react). Model: Sonnet
9. Minimap, full map, waypoint. Model: Sonnet
10. Generated audio (engine, horn, siren, impacts). Model: Sonnet

## Milestone 3: crime and consequences
11. Wanted level (1 to 5), police cars and officers, pursuit,
    arrest/escape. Model: Opus
12. Health, damage, simple combat, vehicle damage, respawn.
    Model: Sonnet
13. Mission engine + 6 original story missions. Model: Opus
14. Money, shops, garage, save/load (validated on load). Model: Sonnet

## Milestone 4: polish
15. Day/night, weather, phone performance pass (measured frame
    times). Model: Opus
16. Menus, settings, tutorial, accessibility (contrast, labels,
    left-handed layout). Model: Sonnet
17. Final verification and security review (fresh reviewer).
    Model: Fable

Run cap: 21 tasks, 3.5M delegated tokens.
Security items that apply: no secrets, no personal data, no network
calls at runtime, pinned and audited dependencies, licence check,
save data validated on load, review at each milestone.
