# Status

## Done
- Task 1: foundations (package, lint, tests, docs)

## In progress
- Milestone 1: drive around the city

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
- Low (open): page style policy allows inline styles (needed by the UI code).
