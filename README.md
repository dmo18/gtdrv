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

## Package it (web app and Android)
The game is an installable web app and can be wrapped as an Android app
for Google Play. The step by step guide for the owner is `docs/PLAY.md`,
and the store listing and form answers are in `docs/STORE.md`.
1. `npm run build` also copies `public/` (manifest, icons, privacy page)
   into `dist/` and writes `dist/sw.js`, the offline service worker. It
   registers only in production builds served over https (or localhost),
   never inside the Android app and never under test automation unless
   the address has `?pwa`.
2. `node scripts/offline-test.mjs` loads the build, goes offline, reloads
   and checks the game still starts.
3. `node scripts/make-icons.mjs` redraws the icons and feature graphic
   (`public/icons`, `store/`, and the Android launcher icons).
   `node scripts/store-shots.mjs` retakes the 8 store screenshots.
4. `cd android && npm install && npm run apk` builds a debug APK (needs
   Java 21 and the Android SDK, platform 36). `npm run aab` builds the
   release bundle, signed when the keystore variables or
   `android/native/keystore.properties` exist. Never commit a keystore.
5. The workflow `.github/workflows/android-release.yml` builds the signed
   bundle by hand from repository secrets (names listed in the file).
