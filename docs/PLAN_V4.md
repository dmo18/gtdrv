# Rustwater plan version 4: from 0.12.3 to the 1.0.0 release candidate

Written 2026-11-24 from the docs only (STATUS, PLAN_V2 5.6, PLAN_V3 13 to 15, RC, USAGE,
MARKET, STREETSCAPE, LOOP). No code was run for this plan. Budget: cap 16.0M, used about
11.0M, reserve 0.5M, so 4.5M to spend. This plan uses about 4.1M (section 3).

## 1. Audit: each owner goal against the evidence

"Verified" means a test or script in the gate proves it. "Assumed" means built, but nothing
measures the owner's actual complaint. Nothing at all has been confirmed on the real phone
since the Phone check that led to 0.11.3, and that check reported timing, not feel.

| goal | verified here | only assumed | never checked on the phone |
|---|---|---|---|
| Real Miami streets, familiar | junction tests a to e in five regions, street names, one-way start on Ocean Drive, drive-review shots | that names, one-ways and lane counts match OSM for the streets a Beach resident knows (no named checklist exists); fan junctions (32), crossing lane paint, Lincoln Road wedge still open | the owner's eye since 0.11.0 |
| American cars, smooth, US units | 18 bodies at three levels, left-hand drive, units and us-english tests | L1 and L2 noses faceted up close; semi has no trailer | looks at phone size |
| Handling and steering | 0.11.2 numbers (44 degrees in the first second at 70 mph, slip under 0.1 degree), 30 thumb models, touch-test 243 | that this is "sharp enough": the owner has not answered since 0.11.2; classes other than sedan and non-Beach routes not driven by the thumb driver | yes, the key open question |
| No clipping (poles, walls, sea walls, ground) | prop-collision, seawall, ground, collision-determinism tests | no sweep of every solid class in every region at speed and angle; boats at sea walls, tank, aircraft on the ground, on-foot not swept | yes |
| Not dying too easily | damage-rules and health tests | no long clumsy-drive measure of deaths per 10 minutes | yes |
| Working GPS | route, objective, hud-nav tests; turn pill | route legality and length at scale on the real map, prompt timing, reroute | yes |
| First person and dashboard | firstview and carinterior tests; cockpit rebuilt in 0.11.0 | not reviewed by eye for all 18 vehicles since the owner called it poor | yes |
| Planes fly right | aircraft and thumb-pilot tests | fighter stuck on the shore at part thrust (known issue, open); landing at every strip | yes |
| Weapon switch while driving | SWAP in cars and boats, ui-test 771 | tank, aircraft and at-speed two-finger use | yes |
| HUD off the view | LOOP.md screen budget, ui-test rects | covered area never measured per mode | yes |
| Sound not harsh | audio-analyze numbers | "measured, never heard" (AUDIO.md) | yes, the judge |
| No wastelands | lots by rule, wasteland-probe, streetscape tests | lot to lot 5 m steps, heavy hedges, plain paving round downtown towers | yes |
| Smooth at 60 | headless 4x: 0 frames over budget, heap 153 to 162 MB | GC pauses 15 ms (stepVehicle, resolveCircle, ground, traffic allocate); shader programs 75 (target 60) | last real line: 4 slow frames, peds 10.7 ms |
| Fun, not points | loop-test 32 ok; no money, ads, purchases | that events are fun: slow staged cars and approach direction untuned | yes |
| Offline, Play Store ready | pwa test, offline-test script, no runtime network, pinned deps | store pictures and text may predate Miami and the loop; 60 minute soaks not run; Android bundle deferred; Actions not pinned to SHAs | WebView behaviour |

## 2. Ranked work an agent can do alone

Rank is owner pain first, then release blockers, then polish. Tokens are helper totals.
Model is the cheapest adequate one; Fable is not needed (no new design: LOOP.md stands).

| # | task | goal it serves | model | tokens | check that proves it | files |
|---|---|---|---|---|---|---|
| 1 | Collision sweep: script drives car, tank, boat, on-foot and taxiing aircraft into every solid class (poles, walls, sea walls, buildings, curbs, bridge rails) at 5 speeds and 8 angles in five regions; fix every penetration and fall-through | no clipping | Opus | 300k | new scripts/collide-sweep.mjs in the gate: 0 penetrations over 0.3 m, 0 samples below ground, 0 tunnelling at top speed | src/world/propsolid.js, ground.js, src/core collision, src/entities/*, test/prop-collision, seawall |
| 2 | GPS audit: 200 seeded origin and destination pairs per region; fix what fails | working GPS | Sonnet | 200k | test: every route legal (no wrong way, no water), length within 1.15 of shortest, prompt street name equals the edge name, prompt fires 4 to 8 s before the turn, reroute within 2 s of leaving the route | src/systems/objective.js, src/world route code, src/ui/hud.js, minimap.js, test/route, hud-nav |
| 3 | Steering lock-in: thumb driver over all 18 vehicles and one route per region; wheel travel and Sharp preset reachable in two taps from pause; no model change unless a class fails | handling | Sonnet, Opus review 30k | 150k | per class: full wheel at 35 and 70 mph within 10 percent of the sedan's turn, lane error under 0.8 m, pinned in test/thumb-driver | src/entities/handlingbands.js, handlingpreset.js, src/ui/wheel.js, menu.js |
| 4 | Survival measure: a clumsy scripted 10 minute drive per region (curb hits, 30 mph bumps, one 60 mph crash); tune only if it dies | not dying easily | Sonnet | 100k | 0 deaths from bumps, at most 1 wreck per 10 minutes, pinned as a test | src/systems damage rules, test/damage-rules |
| 5 | Weapon switch everywhere: SWAP in car, boat, tank, aircraft at speed with the steering finger down | weapon switching | Sonnet | 80k | touch-test: swap succeeds in each vehicle type while steering stays held; wheel never under the steering zone | src/ui/touch.js, combathud.js, scripts/touch-test.mjs |
| 6 | HUD coverage: measure the covered share of 748x360 in drive, fight, fly, event and GPS modes; trim what is over | HUD off the view | Sonnet | 80k | ui-test: middle 60 percent of the screen has 0 covered pixels in drive mode; total cover under the LOOP.md g budget | src/ui/hud.js, styles.js, scripts/ui-test.mjs |
| 7 | First person and dashboard review by screenshot: all 18 vehicles plus aircraft, hood and cockpit, day and night, straight and full lock | first person | Opus | 250k | shot sheet: road visible over the dash (horizon above 45 percent of the height), mph gauge readable at phone size, no mesh through the camera; carinterior tests extended | src/render/carinterior.js, chasecam.js, scripts/vehicle-shots.mjs |
| 8 | Flight review: fix the shore-stuck fighter, takeoff and landing at every strip with the thumb pilot, stall and low thrust cases | planes | Opus | 200k | thumb-pilot test: takeoff, circuit and landing from every strip with 0 crashes over 20 seeds; part-thrust depot exit passes; known issue closed | src/entities/aircraft.js, test/thumb-pilot, aircraft |
| 9 | Beach familiarity audit: a checklist of about 50 streets and places (Ocean Dr, Collins, Washington, Alton, Lincoln Rd, Espanola Way, 5th St, 41st St, the causeways, numbered streets in order) against the OSM data already in the repo | familiar streets | Sonnet | 200k | test/miami-familiar.test.js: name, one-way direction, lane count and the next cross street match for every line; mismatches fixed or listed with a reason | src/world/miami.js, mapdata, test/miami-landmarks, miami-places |
| 10 | Allocation pass: remove per-step allocation in stepVehicle, resolveCircle, ground and the traffic scan | smooth | Opus | 250k | perf-phonecheck --alloc at 4x: longest GC pause under 5 ms, 0 frames over 33 ms, heap growth under 10 percent in 10 minutes | src/entities/vehicle.js, src/core collision, src/world/ground.js, src/systems/traffic.js |
| 11 | Streetscape leftovers: lot to lot steps, hedges, plain paving round towers, fan junction width, crossing lane paint, Lincoln Road wedge | no wastelands | Opus | 300k | wasteland-probe: no block over the bare-area limit in five regions; no step over 0.3 m between lots; draw budget 210 calls / 295k kept | src/world/lots.js, junctions.js, src/render/lotmesh.js, citymesh.js |
| 12 | Loop tuning: staged slow cars in front of events, approach direction, medal times from the thumb driver, first five minutes | fun | Opus | 280k | loop-test: each event template started from 3 directions is completable by the thumb driver, bronze by 90 percent of seeds, gold by under 20 percent; no queue at the start line | src/systems (events, flow, activities, tutorial), docs/LOOP.md |
| 13 | Shader programs 75 to 60 | smooth, start time | Opus | 180k | perf.mjs program count at most 60 in five regions; shots unchanged | src/render/* materials, graphics.js |
| 14 | Sound harshness by numbers: energy in 2 to 5 kHz, crest, clipping, loudness per sound; soften the worst, lower default levels | sound | Sonnet | 120k | audio-analyze limits as a test; no sound over the limit; honest note that nobody has heard it | src/audio/*, docs/AUDIO.md |
| 15 | Vehicle looks: smooth the L1 and L2 noses, check silhouettes at phone size | smooth cars | Opus | 150k | vehicle-shots sheet at 3 distances; triangle budget per level kept | src/render/vehiclemesh.js, carparts |
| 16 | Accessibility: reduced motion (no shake, no slow motion flash), larger text option, cues not by color alone, left-handed layout | store quality | Sonnet | 100k | ui-test cases for each setting; settings survive a reload | src/ui/menu.js, styles.js, hud.js, src/core/save.js (security review) |
| 17 | Store assets and docs: new pictures from 0.12.x, text for Miami and the loop, SPEC, PLAY, README, map credit in Settings, title and store text | Play Store ready | Sonnet, Haiku for text | 120k | release-check passes; no "missions", money or venue brand in text; credit visible in three places | store/*, docs/STORE.md, SPEC.md, PLAY.md, scripts/store-shots.mjs, public/privacy.html |
| 18 | Android prep without secrets: version name and code from package.json, Back button, pause in background, sound after a call, target API, unsigned debug build if the SDK is present | Play Store ready | Sonnet | 150k | version check test; debug bundle builds or the missing tool is named; a one-page owner signing guide | android/*, docs/RELEASE.md |
| 19 | Release checklist run: offline test between two regions, old saves from 0.3.1 to 0.8.0 load, try pinning Actions to SHAs with `gh api` | PLAN_V2 5.6 | Sonnet | 80k | checklist 5.6 marked line by line in docs/RC.md | scripts/offline-test.mjs, test/save, .github/workflows |
| 20 | 60 minute soak in each region, in the background, one at a time, never during a gate | PLAN_V2 5.6 | Haiku to read results | 60k | 0 errors, memory growth under 10 percent, five regions | scripts/soak.mjs |
| 21 | Gates and security reviews: 5 gates, 4 reviews (any save, input or settings change) | every publish | Opus read-only | 400k | no critical, high or medium open | none |

Sum 3.75M, plus about 0.35M for the lead's own turns: 4.1M of the 4.5M. If a task passes
its check without a fix, stop it there and bank the rest.

Cut if the budget runs short, in this order: 15, 16, 13, 11 (keep steps only), 18.

Not planned (still cut): heat 5 escalation, story missions, tuning garage, rivals, new
sounds, network features, money of any kind (MARKET.md default A).

## 3. Sequence

Rules: one heavy helper at a time; soaks only between helpers or alongside a Sonnet task
that does no timing; park partial work as a patch before any publish; one batched gate per
milestone; security review where save, input or settings changed.

| step | version | tasks | review | tokens |
|---|---|---|---|---|
| A | 0.12.4 Solid and found | 1, 2, 4, 5, 6 | gate; security (input paths in 5) | 0.90M |
| B | 0.12.5 Feels right | 3, 7, 8, 15; soak Beach after | gate; no security unless menu or save changed | 0.87M |
| C | 0.12.6 Smooth and familiar | 9, 10, 13, 11; soak Downtown, North | gate | 1.07M |
| D | 0.13.0 Hooked | 12, 14, 16; soak West, South | gate; security (settings in save) | 0.64M |
| E | 1.0.0-rc.1 | 17, 18, 19, 20 results | final gate; full security review of the diff since 0.12.0 and the built bundle | 0.55M |

Do not tag 1.0.0. The release candidate waits for the owner's phone line (section 4).
Stop and ask only at the 16M cap; at 15.5M finish the running milestone and publish it.

## 4. What truly needs the owner, and the default until they answer

| need | why an agent cannot | default |
|---|---|---|
| Phone check on the newest version (median, worst, steering feel, sound, first person, planes) | only a real S24 and a real thumb and ear can judge | keep publishing; put the three questions (steering sharp enough, any harsh sound, any place you fell through) at the top of STATUS.md; treat silence as "not yet confirmed", never as "passed" |
| Privacy contact email | personal detail | placeholder stays; release-check keeps failing the 1.0.0 tag on it |
| Play developer account, closed test | identity and payment | prepare everything up to the upload; write the steps in docs/RELEASE.md |
| Signing key | owner secret, must never be in the repo or a session | build unsigned debug only; guide for the owner to sign locally |
| Monetization | owner decision | A: free, no ads, no purchases |
| Scrub old screenshots from three commits | rewrites published history | leave as is |
| Version 1.0.0 tag | owner acceptance in PLAN_V2 5.6 | stay at release candidate |
