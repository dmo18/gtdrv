# Performance budgets (data for scripts/perf-scenarios.mjs)

Source: docs/PLAN_V2.md section 4. The runner is `scripts/perf-scenarios.mjs`
(desktop headless Chromium with the software renderer, phone size 915x412; the 4x rows use
Chrome DevTools Protocol CPU throttling as the mid-range proxy).

    npm run perf:scenarios                  measure, write shots/perf-scenarios.json, print tables
    npm run perf:scenarios -- --check       the same, then fail when a budget of the current milestone is missed
    node scripts/perf-scenarios.mjs --from shots/perf-scenarios.json --check     check an old result, no browser

Options: `--quick` (shorter scenarios), `--no-4x`, `--no-profile` (skip the unminified CPU
profile that attributes the start), `--milestone 0.8.0`, `--out file.json`, `--draw-every N`.

Current milestone: 0.7.0

## Budgets

The runner reads this table. A row is a backticked key, a description, `max` or `min`, then one
column per milestone. A `-` means "no budget at that milestone" (the value is still reported).
A budget missed at a milestone blocks the publish unless the owner strikes it off in writing.
Values are in the unit named by the key (ms, MB, count). "No worse" rows carry today's
measured value as the 0.7.0 limit: PLAN_V2 section 1, except `programs_new_in_play` (6: the runner's shot
probe finds two, the plan counted one), `street_calls` and `street_tris`, which use the runner's own
view (parked sedan at the start place, hour 13: 346 calls, 524k triangles measured, limits rounded up).

| key | what | check | 0.7.0 | 0.8.0 | 1.0.0 |
|---|---|---|---|---|---|
| `start_ms_1x` | page load to game running, desktop, ms | max | 3200 | 2000 | 2000 |
| `start_ms_4x` | the same at 4x CPU throttle, ms | max | 9000 | 6000 | 6000 |
| `build_ms_1x` | city plus tile renderer build, desktop, ms | max | 1000 | 800 | 800 |
| `mem_mb_1x` | performance.memory used after a forced collection, at start, MB | max | 160 | 120 | 120 |
| `programs_start` | shader programs after the first draws | max | 98 | 60 | 60 |
| `programs_new_in_play` | new programs over the five first-use probes | max | 6 | 0 | 0 |
| `first_step_ms` | first step of play (sum of the systems' first calls), ms | max | 50 | 8 | 8 |
| `over4_per_min` | steps over 4 ms per minute after the first 2 s, worst of the four scenarios | max | 2 | 0 | 0 |
| `worst_tile_slice_ms` | worst street tile slice, ms | max | 5 | 3 | 3 |
| `jet_tiles_built` | street tiles built during one jet crossing | max | 336 | 40 | 40 |
| `live_vehicles` | live vehicles with the player downtown (cruise, highest) | max | 80 | 70 | 70 |
| `street_calls` | street view draw calls at the start place | max | 350 | 260 | 260 |
| `street_tris` | street view triangles at the start place | max | 530000 | 380000 | 380000 |

## Not checked by the runner

Measured by hand or by another script; they stay in PLAN_V2 section 4.

| measure | 0.7.0 | 0.8.0 and 1.0.0 | how |
|---|---|---|---|
| Splash shows moving progress the whole time | yes | yes | look |
| Renderer process resident | 450 MB | 350 MB | `ps` on the renderer process during `perf:scenarios` |
| Growth over a 60 minute soak after the first 5 minutes | under 10 % | under 10 % | `node scripts/soak.mjs 3600` |
| Heavy fight (6 hulls, 96 parts) draw calls | no worse (391) | 330 | scripts/perf.mjs |
| Phone check, S24 Ultra: median, worst, frames over 33 ms | 16.7, 50, 2 | 16.7, 34, 0 after 2 s | Phone check line |
| First play download, gzip | 0.95 MB | 0.95 MB | scripts/release-check.mjs |

## How each key is measured

- Start: an init script wraps `window.__rw`'s `loop.start` and first `draw`; the start time is
  `performance.now()` when the loop starts (page load to running), the first draw time and its
  program count come from the first `draw` call. Memory is read after
  `HeapProfiler.collectGarbage`, three seconds after the loop starts.
- Start breakdown: a second load of an unminified build under the CDP CPU profiler (sampling
  every 0.5 ms). The table gives inclusive time of the outermost call of each function group.
  Textures are part of the tile renderer build; shader programs are part of the first draw.
  Profiling slows the run a little, so the profiled total is not the budget figure.
- Scenarios: the loop is stopped; the runner calls `game.step(1/60)` and draws every N steps.
  Every system's `always` and `fixedUpdate` calls are wrapped to give per-step milliseconds by
  system ("core" is the part of a step outside the systems: vehicle physics and collisions).
  The wrappers add a few microseconds a call, so absolute numbers run slightly high.
  A step over 4 ms is blamed on the system that cost most in that step.
- First-use probes (fresh state, in order): first blast, first shot on foot, first boat,
  helicopter, plane. Each records new shader programs, new geometries and the draw and step
  times for 48 steps. The software renderer draws in hundreds of ms, so "draws over 16 ms" is
  informational; the budget is on new programs.

## G1b: the Normal street view at the 0.9.0 budget

Budget (docs/PLAN_V3.md section 7): Normal at most 210 draw calls and 295k triangles, High at
most 270 and 425k, on both street views, day and night. Measured with `scripts/perf.mjs`
(phone size, software renderer, pixel ratio 1; `RW_QUALITY=1.25` for High; the last line of its
output checks the budget):

    node scripts/perf.mjs                      Beach start (the default map)
    node scripts/perf.mjs map=miami-downtown   Downtown start

| view (Normal) | before: calls, triangles | after: calls, triangles |
|---|---|---|
| Beach start, day | 187, 563k | 135, 237k |
| Beach start, night | 195, 568k | 141, 238k |
| Downtown start, day | 306, 415k | 200, 283k |
| Downtown start, night | 291, 414k | 202, 283k |
| High: Beach day / Downtown day | - | 161, 251k / 237, 302k |

Shader programs after the first draws: 105 (Beach) and 110 (Downtown) before, 73 and 75 after,
with every street material compiled at the warm-up (none compiles in play; `newPrograms` 0).
Screenshots before and after (915x412, day and night): `dist/g1b/` (Beach start, Downtown
start, a parking lot, a divided road).

What changed (all in `src/render`, plus the lamp streaks in `src/systems/daynight.js`):

- Trees (`treebatch.js`): every Miami tree and palm is an instance of one `BatchedMesh` (one
  draw, one shadow draw; needs `WEBGL_multi_draw`, else the tiles stamp them as before). Each
  species has three shapes: near (the full template) within `TREE_NEAR_R` (30, 45, 75 m by
  tier), far (two leafy balls, or eight solid two-piece fronds; 64 to 72 triangles) within
  `TREE_FAR_R` (90, 120, 180 m), distant (28 to 32 triangles) beyond. Culled by 50 m cells; the
  shadow pass culls tree by tree. Before, crowns past 110 m were not drawn at all (bare trunks);
  now every tree of a near tile has its crown.
- Shadows: a near tile casts through position-only proxies, one per quarter, on its own layer
  (`SHADOW_LAYER`, seen by the sun's shadow camera only), so the shadow pass is a draw per
  quarter instead of one per material. Building trim and lot solids do not cast. A car casts
  through its one-call far body (a tenth of the near body's triangles), on the same layer.
- Draws per tile: facades, props, contact shadows and lot solids are one mesh per tile (their
  quarters only split the proxies); lot solids are drawn in the plain quarters, building trim
  (string courses, pilasters, eyebrows, plinths) with the props, the props' cut-out detail with the
  buildings' detail; trim and props are gone at the middle level.
- Far level: tiles wholly inside the fog by view depth are left out of the far blocks
  (`ud.fogFar`, checked every fourth frame); boats and cars past 65 % of the fog's depth range
  by distance, and any vehicle past its far end by depth, are not drawn.
- Cars: the far body from 36 m on Normal (was 46; High stays 75).
- Lamp reflection streaks: only the lamps within 260 m are in the index (was every lamp of
  the map, 9k triangles at night).
- Programs: the sky reflection map exists before the warm-up compiles (before, every lit
  material compiled twice, without and with it, and kept both); brick, stucco and havana take
  neutral roughness and metalness maps (one program with glass and office); ground, sand and
  wood take a flat normal map (one program with the sidewalk); the windsock is in the detail
  material; two-sided see-through markers, spray, rotor discs and jet flames draw in one pass.

## Phone check drive at 4x (0.12.0 work, after 0.11.2)

Owner's phone (S24 Ultra, 0.11.2, Downtown, five stars): median 16.6 ms, worst 83.3 ms,
4 frames over 33 ms, res 2.00, start 2.8 s, 202 MB, slowest system call `peds 10.7 ms`.

Stand-in: `node scripts/perf-phonecheck.mjs` (taken from the parked
`docs/wip/0.12-partial.patch`, plus `--alloc`, a sampled heap profile of the drive). It builds
the game, plays 10 s of first play and then the Phone check's own 60 s drive with five stars
held, at 4x CPU throttle, one fixed step and one draw a frame, main-thread time only (draw calls
left out), each frame the fastest of 2 passes. "Over" is a frame more than 28 ms above the
running level, which matched the phone's frames over 33 ms on 0.7.0 and 0.10.0. On 0.11.2 the
slowest peds call here (16.6 ms) was about 1.55 times the phone's (10.7 ms).

    node scripts/perf-phonecheck.mjs --passes 2 --settle 10            the table below
    node scripts/perf-phonecheck.mjs --passes 1 --profile --all        functions behind each slow frame or call over 4 ms
    node scripts/perf-phonecheck.mjs --passes 1 --alloc                where the drive allocates
    node scripts/perf-phonecheck.mjs --root <copy of an older tree>    the same for another version

Causes, ranked by milliseconds (0.11.2, 4x):

1. peds: worst call 16.6 ms, mean 1.51 ms a step (the costliest system on average). Every ped
   tested every craft twice a step (threat scan and body push), about 4,500 reads of `x`, `z`,
   `vx`, `vz`, `y`, `radius` from craft of many object shapes, and each such read boxed a number:
   `stepPed` plus `scanThreat` were 158 MB of the drive's 1.2 GB of allocation. A refill
   (teleport, quiet street) could also make a dozen failed spawn tries (pick plus ten sight lines)
   in one step.
2. Garbage collection: 312 KB allocated a frame, two major collections of 17 and 24 ms in the
   drive, landing on whichever system ran at the time. After peds, the largest sources are
   outside the systems: `stepVehicle` 128 MB, three.js uniform upload 97 MB, `resolveCircle`
   54 MB, ground `geoSurface`/`net1` 67 MB, traffic `scan` 32 MB (the same many-shape craft reads).
3. Mesh builds in the first seconds of play: one car body of each of the 18 specs (traffic
   warmer, 50 to 80 ms each, near body 80 percent of it), parked lots (70 to 90 ms) and the fleet
   (40 ms): the 250 to 300 ms frames of first play. The drive itself compiled no shader program.

What changed:

- `src/systems/peds.js`: the system snapshots the craft once a step into a Float64Array
  (`snapVehicles`), and `stepPed` reads that (alone, as in node tests, it snapshots per call; a
  test pins that both walk the same). At most `SPAWN_TRIES_PER_STEP` (4) spawn tries a step; the
  rest go on the next step.
- `src/core/spatial.js`: the mesh warmers (traffic, police) build one mesh every step while the
  title screen is up, so on the phone the list is done before Start is tapped (test added).
- `scripts/perf-phonecheck.mjs` and `test/perf-phonecheck.test.js`.

| measure (4x, 2 passes) | 0.11.2 | after |
|---|---|---|
| drive: frames over (28 ms excess) | 1 | 0 |
| drive: worst excess, in phone ms | 28.3 (34) | 20.2 (29) |
| drive: median, p99, worst main-thread frame, ms | 20.2, 38.0, 53.9 | 20.3, 33.4, 54.5 |
| drive: slowest system call | peds 16.6 | combat 9.6 (peds 7.8) |
| drive: peds mean a step, ms | 1.51 | 1.32 |
| drive: allocated a frame; worst collection | 312 KB; 24.3 ms | 279 KB; 15.5 ms |
| first play: slowest system call | parked 89.3 | traffic 73.7 |
| start at 4x, s; memory after collection, MB | 11.0; 185 | 9.5; 185 |
| perf-scenarios --quick: heat over4/min, worst step | 77.1, 19.7 | 60, 12.3 |
| perf-scenarios --quick: memory 1x, MB | 169.3 | 170.0 |

Start and the scenarios' small steps vary by 10 percent or more from run to run here.

Not reached yet, and where to look next:

- Memory (target under 185 MB on the phone): the heap is 111 MB of typed arrays. Holders after a
  forced collection: the tile mesh scratch pool in `src/render/meshbuilder.js` 25.6 MB (its cap
  `POOL_MAX` is 48 MB), lot and block grids in the city (`lotIn`, `blockLab`, `lotGrid`) about
  30 MB, three.js binding states 6.5 MB, compiled code 13 MB. Car geometry is small (the spec
  cache holds about 1 MB). A lower pool cap is the cheapest saving but means more collections
  while tiles stream: measure with this script before changing it.
- Slowest calls still over 4 phone ms (about 6 ms here): combat (the check's own fight
  fixture), parked (lot hour change), peds, police spawns (car, tank, helicopter).
- Allocation in `stepVehicle`, collision and ground (core files): the same many-shape reads.
- The phone's 83 ms worst frame is not reproduced here; the check's own full screen request
  resizes every render target at its start (the parked patch skips those frames in phonecheck.js).

## Allocation pass (0.12.6, docs/PLAN_V4.md task 10)

Most per-step garbage was V8 boxing numbers, not literals or closures: a property read site that
has seen more than one or two object shapes (V8 "maps") reads a number field through a generic
lookup that allocates a fresh 16-byte number box on every read. What changed:

- `src/entities/vehicle.js` `createVehicle`: every field the systems and the renderer add to a
  car later (controls, ai, traffic, parked, police fields, mesh, combat hit and toss fields,
  stunt ramp fields, wreck fields) is declared as `undefined` up front, so all cars share one
  shape. Before, a Downtown drive had 4 to 6 car shapes (parked, traffic, police, hit, ramp),
  and stepVehicle, collideVehicles and the traffic scan read through generic lookups.
- `src/world/collision.js` `resolveIn`: `off` and `h` are read inside each shape kind's branch
  (one read site per kind), and a bay car's hash `bayU` lives in a WeakMap instead of on the
  circle (it gave bay circles their own shape). The circle height read boxed about 22 numbers a
  call in Downtown before.
- Tried and left out: passing ground query points through Float64Arrays (geoSurface then
  boxed the same numbers at its own calls: more garbage, not less).

Measured by allocation, not time (bytes per simulated second, sampled heap, collected objects
included). Behavior is the same: the drives end in the same state before and after.

| drive | before | after |
|---|---|---|
| node, survival harness drive, Beach, 60 s | 8.6 MB/s | 4.2 MB/s |
| node, survival harness drive, Downtown, 60 s | 11.9 MB/s | 7.6 MB/s |
| Chrome, steps only, Beach start, 30 s | 6.1 MB/s | 3.5 MB/s |
| Chrome, steps only, Downtown, five stars, 30 s | 11.4 MB/s | 8.6 MB/s |
| perf-phonecheck --alloc, 4x, steps and draws, Beach | 20.4 MB/s | 19.6 MB/s |
| perf-phonecheck --alloc, 4x, steps and draws, Downtown | 21.2 MB/s | 19.8 MB/s |

Still open: in the Beach Phone check drive `heightAt` (collision, called by the chase camera
and crews) now shows about 1.7 MB/s that it did not show before (cause not found; node shows
none); three.js uniform uploads (`setValueM4`, `setValueV3f`), `geoSurface`/`netRound`
(ground) and the remaining stepVehicle boxing (numbers passed to calls V8 does not inline).
The task's 5 ms collection target is not met; worst collections in single throttled passes
vary from 18 to over 60 ms here while other work runs.
