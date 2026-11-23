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
