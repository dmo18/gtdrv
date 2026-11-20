# Status

## Done
- Milestone 1: drivable city, touch controls, HUD
- Milestone 2: walking, boats, planes, helicopters, map, sound

## In progress
- Milestone 3: traffic, pedestrians (done), activities, showroom, save
- Milestone 4 started early: day/night and weather

## Decisions
- Name: Rustwater (original setting, an island harbour city).
- 3D, flat ground, physics in 2D (x,z) for speed and testability.
- three.js 0.187.0 (MIT), esbuild 0.28.2 (MIT), eslint 10.15.0 (MIT).
- Preview: public GitHub Pages site (user's choice).
- Direction change (user): the game is about fun driving, boating and
  flying. Combat and crime missions dropped; police chases are a light
  optional extra. Run cap now 23 tasks.
- Run cap: 21 tasks, 3.5M delegated tokens.

## Known issues
- none yet

## Open security findings
- Milestone 1 review: no critical or high.
- Low (open): GitHub Actions are pinned to version tags, not commit ids.
- Milestone 2 review: no critical. Two high (player could get stuck at
  sea; pause with map open) fixed. Two medium (abandoned craft piling
  up) fixed with a periodic sweep.
- Low (open): page style policy allows inline styles (needed by the UI code).
