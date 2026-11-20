# Status

## Done
- Milestone 1: drivable city, touch controls, HUD
- Milestone 2: walking, boats, planes, helicopters, map, sound

- Milestone 3: traffic, pedestrians, races and deliveries, showroom, save
- Milestone 4: police chases (optional), day/night, weather, hints

## In progress
- Milestone 5: quality overhaul after the owner's first play test
  (steering and driving feel, sound, city graphics, vehicle looks)
- Fixes from the final review (race start button, map markers, HUD
  leftovers)

## Paused: usage limit reached
The account's 5-hour usage limit stopped three Milestone 5 helpers
part-way (limit resets 02:50 UTC). Their partial work is committed and
the game runs with no errors, but these are unfinished:
- City graphics and lighting: roads, pavements, shopfronts and props
  are in; shadows, tone mapping, reflections (src/render/graphics.js)
  are NOT built yet, so building walls look too dark.
- Vehicle looks and effects: smooth car bodies are in; effects
  (src/render/effects.js exists, not yet registered in game.js),
  damage, boat/aircraft materials and camera feel unfinished/unverified.
- Sound overhaul: new sample-based engine is partly in; one check
  fails (engine pitch does not rise with revs). scripts/audio-test.mjs.
To resume: message each of the three stopped helpers to continue from
where it stopped, then wire createGraphics and createEffects into
src/game.js, run all checks, look at screenshots, and publish.
Steering and driving physics (task 19) are complete and wired in.

## Decisions
- Name: Rustwater (original setting, an island harbour city).
- 3D, flat ground, physics in 2D (x,z) for speed and testability.
- three.js 0.187.0 (MIT), esbuild 0.28.2 (MIT), eslint 10.15.0 (MIT).
- Preview: public GitHub Pages site (user's choice).
- Direction change (user): the game is about fun driving, boating and
  flying. Combat and crime missions dropped; police chases are a light
  optional extra.
- Run cap: 27 tasks, 3.5M delegated tokens.
- No separate main branch exists: the working branch is the
  repository's default branch and publishes to GitHub Pages directly.

## Known issues
- none yet

## Open security findings
- Milestone 1 review: no critical or high.
- Low (open): GitHub Actions are pinned to version tags, not commit ids.
- Milestone 2 review: no critical. Two high (player could get stuck at
  sea; pause with map open) fixed. Two medium (abandoned craft piling
  up) fixed with a periodic sweep.
- Final review (212 simulated minutes of soak testing, 0 errors):
  no critical or high findings. Medium usability items being fixed.
- Low (open): page style policy allows inline styles (needed by the UI code).
