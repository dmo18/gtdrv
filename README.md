# Rustwater

An original open-world driving, boating and flying game that runs in a
phone browser. Cars, boats, planes, helicopters, a tank and a fighter
jet, with on-foot combat in a violent sandbox (blood, no dismemberment). Best
played on a phone turned sideways.

## Run it
1. `npm install`
2. `npm run dev`
3. Open http://localhost:8080 (turn the phone sideways).

## Build it
1. `npm run build` bundles the game into `dist/` (index.html and game.js).

## Check it
Run these from the repository folder, in this order.
1. `npm test` runs the unit tests (files in `test/`).
2. `npm run lint` runs eslint.
3. `npm run smoke` builds the game, loads it in headless Chromium at phone
   size, drives forward and fails on any error or outside network request.
4. `npm run smoke -- --extra` adds the long end-to-end checks (on foot,
   boat, plane, helicopter, races, combat, explosives, tank, fighter jet,
   police helicopter, and stuck-player cases). Takes a few minutes.
5. `node scripts/ui-test.mjs` touches every on-screen control in headless
   Chromium.
6. `node scripts/menu-test.mjs` tests the pause menu, scores and saving.
7. `node scripts/map-test.mjs` tests the minimap and the full map.
8. `node scripts/audio-test.mjs` measures the generated sound.

Screenshots from the browser tests land in `dist/` and `shots/`.

## Look at it and measure it
These helpers are for developers; none of them fails a build.
1. `node scripts/shot.mjs name x z heading` takes a screenshot from a spot.
2. `node scripts/perf.mjs` prints draw calls, triangles and step cost.
3. `node scripts/vehicle-perf.mjs` prints the draw calls spent on vehicles.
4. `node scripts/gfx-shots.mjs` takes city screenshots in different light.
5. `node scripts/vehicle-shots.mjs`, `act-shots.mjs`, `combatfx-shots.mjs`
   and the `*-preview.mjs` scripts (aircraft, boat, markers, sky) take
   screenshots of single features.
