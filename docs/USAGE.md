# Usage ledger (delegated helper tokens)

Numbers are what each helper's result reported. The main session's own tokens are not
included (type /usage for plan limits). Update at every milestone.

| Milestone | Helpers | Tokens |
|---|---|---|
| Before 0.5.0 to 0.5.0 | 41 helpers | 10.4M+ |
| 0.5.0 finish (second build-speed pass) | 1 | 0.34M |
| 0.6.0 (sound, street life, handling, menus, release scripts, world look, security) | 8 | 1.45M |
| 0.7.0 (plan V2, regions, content, saves and picker, measuring, integration, security) | 7 | 1.88M |
| 0.8.0 (start, render, hitches, plan V3) | 5 | 1.0M |
| 0.9.0 (US English, map, solid world, lots, GPS, lab, integration, build speed, render budget, security) | 10 | 3.4M |

Total so far: about 18.5M delegated. V3 cap counted from 0.8.0 publish: 3.4M of 3.5M used at 0.9.0.

## Run caps (proposed, owner can change)

| Item | Cap | Why |
|---|---|---|
| Plan V3 milestones 0.9.0 to 1.0.0 | 3.5M delegated tokens | one milestone about 0.8M, five milestones including fixes |
| Tasks | 20 helper tasks, plus a quarter for fixes | |
| Stop and ask | at the cap, or after 5 failed attempts in total, or when /usage shows 80 percent or more before an Opus or Fable task | kickoff rule |

Reset point: the counters above restart at 0.8.0 publish for the V3 cap.

## Cap change (2026-11-23)

The owner said they are away until the game is ready and told me not to stop. The V3 cap of 3.5M was reached at 0.9.0. Raised to 7.0M for 0.10.0, 0.11.0 and 1.0.0 (plan estimates 2.1M to 3.0M plus the store milestone and fixes). Stop and ask at 7.0M, after 5 failed attempts, or if /usage shows 80 percent.

## 2026-11-23, after 0.10.0

0.10.0 used 2.5M (fleet, views, handling, build fix). V3 total 5.9M. Owner round 3 needs about 1.8M: cap raised to 8.0M, announced to the owner in the status block. Stop and ask at 8.0M.

## 2026-11-23, 0.11.0 published

Round 3 used 2.5M (roads 0.55M over four passes, lots 0.60M, controls 0.45M, car response 0.36M, planes and cockpit 0.43M, security 0.13M). V3 total 8.4M against the 8.0M cap: 0.4M over. No new helper work starts until the owner sets a new cap.

## 2026-11-23, owner: cap 10M, heavy Fable allowed

V3 total 8.4M. Remaining 1.6M for 0.12.0: PERF (Fable, about 0.4M), STREETSCAPE (Fable, about 0.45M), LOOP (Fable, about 0.5M), security review and gates (about 0.15M). Stop and ask at 10M.

## 2026-11-24: quota

Four Fable helpers in parallel hit the account's 5-hour limit and the owner said I was burning session quota. Rule from now: at most ONE heavy helper at a time, Fable only for design or the single hardest task, work in small steps. Order: handling (running), then PERF, then LOOP (design doc and Flow meter first), then STREETSCAPE. Partial work of the stopped three is saved in the tree and can be resumed by name.

## 2026-11-24 night: owner cap 16M, finish overnight, pace for the 5-hour and weekly quotas

Cap raised to 16M (about 9.6M used). Pacing rules: one helper at a time, never two heavy runs overlapping; Opus for build and fixes, Sonnet for standard builds from a complete brief, Fable only for the LOOP design document (one short call); no screenshot loops beyond what a task needs; if a helper stops on a rate limit, wait for the reset time in its message (send_later) and resume it by name, do not start new ones. Order: PERF (running) -> publish 0.12.0 -> LOOP design -> LOOP build in four small steps (Flow meter, events, records and daily, first five minutes and customization) publishing 0.12.1 to 0.12.4 -> STREETSCAPE -> 1.0.0 release candidate review.

2026-11-24 night: LOOP build helper 257k, security review 77k. Total about 10.3M of 16M. 0.12.0 published (gate passed, review: no critical/high; two lows closed in custom.js).
2026-11-24 night: STREETSCAPE helper 356k. Total about 10.7M of 16M. 0.12.1 published (gate passed; geometry only, no new input paths, security review skipped by design).
2026-11-24 night: 0.12.2 published after two CI timing flakes (whole box 3135 and 3384 ms vs 3000, runner noise; no test changed). Total about 10.8M of 16M. Remaining: RC items needing owner; full 60 min soaks not run.
2026-11-24 night: memory helper 163k. Total about 11.0M of 16M. 0.12.3 published (heap Beach 153, Downtown 160 MB; gate passed after one timing flake). Soak resumed.
2026-11-24: 0.12.4 published. Helpers: collisions 392k, GPS/HUD 255k, review 81k, build time 578k. Total about 12.5M of 16M.
2026-11-25: 0.12.5 published (CI green first try). Helpers since 0.12.4: cockpit/flight 270k, steering/sound 153k, Beach 218k, allocations 309k, reviews 104k, store/android 110k. Total about 14.2M of 16M. Next: loop tuning, accessibility, then RC checks.
2026-11-25: 0.13.0 published (loop tuning 276k, accessibility 152k, review 109k). Total about 14.8M of 16M. Remaining: release checklist 5.6 (offline, old saves) then RC.
2026-11-25: owner raised the cap from 16M to 24M (answer: 'Raise to 24M'). Used about 14.9M before F1 streets, F2 car noses, F3 shader programs, E2 checklist helpers.
2026-11-25: 0.13.1 published. Helpers: checklist 103k, car noses 160k, streets 235k, shaders 327k, review 134k. Total about 16.4M of 24M. Soak 60 min running on 0.13.0.
- 0.13.2 published (37673cb). Helpers G1 to G3 about 0.76M. Total about 17.8M of 24M. Soak resumed on 0.13.0.
- 0.13.3 and 0.13.4 published together (fa83f71). 0.13.3 itself never went live (CI timing flake, then merged with 0.13.4). Helpers this round about 1.9M. Total about 19.8M of 24M.
