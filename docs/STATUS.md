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
