# Rustwater: review and plan to version 1.0

Written 2026-11-22 against version 0.4.0 (commit 398fadc) plus the uncommitted boost work that
was in the working tree at the time. Planning only: no source file was changed to write this.
"Measured" means a script or test ran today. "Judged" means a reading of code or of a screenshot
rendered in headless Chromium with a software renderer at 915x412, pixel ratio 1. Nothing here
was seen on a phone or heard by a person.

Why this plan exists: the owner is tired of work that stops midway. So the plan has one rule
above all others (section 2.1): nothing is published half built, and nothing is left on a
"not done" list without a version number next to it.

## 1. Review

### 1.1 Requirements matrix

Status: Done, Partial or Missing. Evidence is a file, a test or a screenshot from today.

Game and tone

| # | requirement | status | evidence |
|---|---|---|---|
| 1 | Original: no names, maps or art from other games | Done | invented craft, weapon and venue names (src/world/miami-spots.js:152 to 163); street names are real by decision D1 |
| 2 | No money, no shop, everything available, scores and medals only | Done | no shop code; score.js and medals only; the reward cars are the one planned exception |
| 3 | Full sandbox violence, blood, no dismemberment, no sexual content | Done | combatfx blood bursts and pools; test/combatfx.test.js |
| 4 | People die and drop | Done | one hit kills (test/combat.test.js) |
| 5 | Bodies stay 30 s | Missing | `OUT_LIE_T = 3`, `FADE_T = 1` (src/systems/combat.js:44): bodies are gone after 4 s |
| 6 | Wrecks stay 60 s, at most 6, and smoke | Missing | `WRECK_T = 3` (combat.js:70); today's blast shot at 6 s shows an empty street, no hull, no scorch |
| 7 | Cops can be killed in cars and on foot | Done | test/police-kill.test.js, scripts/combat-e2e.mjs |
| 8 | Bombs, grenades, sticky bombs, missiles | Done | src/core/weapons.js; combat-e2e |
| 9 | Fighter jet | Done | `fighter` spec (src/entities/aircraft.js:72); shot today |
| 10 | Police helicopter you can fly | Done | `patrolheli`; test/helipilot.test.js (pilot shot, lands whole, ENTER takes it) |
| 11 | Tanks you can steal | Done | `rustback` at the depot; test/tank.test.js; shot today |
| 12 | Unlimited ammo | Done | default rules in economy.js; the FIRE badge shows the magazine only |
| 13 | Player cannot die by default, hard mode switch | Done | "Hard: you can die" (src/ui/menu.js:469), `settings.mortal` false by default |
| 14 | Wanted meter with escalation | Partial | 5 stars, heat 1 to 4, roadblock and helicopter at 4 (police.js LEVEL_RULES); the heat 5 police tank is never spawned |
| 15 | Slow motion on big kills | Done | src/systems/cinematic.js, test/cinematic.test.js |
| 16 | Cinematic camera on blasts | Done | `chase.fx` swing within 40 m |
| 17 | Ragdolls | Partial | one rigid tumbling body with limb lag, only for blasts and car hits; no fall away from a gunshot (contract 6.7 not built) |
| 18 | Stunt ramps with medals | Done | test/stunts.test.js; six ramps on Miami |
| 19 | Weather that changes driving | Done | src/core/weather.js, test/weather.test.js |
| 20 | Radio stations (generated) | Done | four stations, test/radio.test.js |
| 21 | Carjacking, driver dragged out and thrown | Done | test/carjack.test.js |
| 22 | Saved car and place | Done | session.js, Continue on the title; test/garage.test.js, save.test.js |
| 23 | Garages and adventures | Partial | 12 and 16 built and tested; favorite loses its star on reload; reward cars can be duplicated; no cars shown inside a garage |
| 24 | Hidden secrets and the Ghostwake | Done | test/secrets.test.js, test/miami-places.test.js |
| 25 | Respawn button | Done | src/ui/touch.js:781 |
| 26 | Weapon wheel (hold SWAP, drag) | Done | src/ui/wheel.js, test/wheel.test.js |
| 27 | ENTER inactive until a craft is in reach | Done | `setEnterReady` (touch.js:825) |
| 28 | Exit moving cars and boats | Done | `game.exitVehicle` (src/game.js:300 on) |
| 29 | Handbrake button always visible | Done | HAND is a primary button; visible in every car shot today |
| 30 | American units | Done | mph on the HUD, "0.4 mi" on the objective; test/units.test.js |
| 31 | Time-of-day control | Done | menu.js:477 |
| 32 | Volume controls | Done | Master, Music, Effects, Ambience, Mute all; test/levels.test.js |
| 33 | Version on splash and pause, bumped each publish | Partial | shown (menu.js:196) and checked by release-check; no bump script and no CI refusal yet |
| 34 | Classic island selectable | Done | Settings, Map (menu.js:498) |
| 35 | Real Miami streets, invented venue names | Done | miami.json streets; 12 invented landmarks |
| 36 | Landmarks on the map | Done | pins with names (src/ui/minimap.js:38, 242, 491); test/miami-landmarks.test.js |

Open requests

| # | request | status | evidence |
|---|---|---|---|
| O1 | Boost for cars and boats, afterburner for jets, one button, a meter | Missing | being built now: src/entities/boost.js is new and uncommitted |
| O2 | Siren on: traffic pulls over, pedestrians step aside | Missing | no yield code; a SIREN button exists only for police aircraft and tanks (src/ui/armsctl.js:80) |
| O3 | Service vehicles with siren, lights and working extras | Missing | no such specs in vehicle.js (10 road specs, 5 body types) |
| O4 | Vehicles look like real vehicles | Partial | fighter, tank and boat pass (judged); cars do not (1.2) |
| O5 | Killing and blasts feel satisfying | Missing | W6 not started; see rows 5, 6, 17 and section 1.2 |
| O6 | Sound | Partial | measured only (docs/AUDIO.md, "Still weak, honestly"); never heard |
| O7 | Map and buildings no longer "CGA and alpha" | Partial | buildings and shop fronts pass; trees, ground, sky and people on the street do not (1.2) |
| O8 | No stutter, steady frame rate, nothing overlapping | Partial | over budget (K1 to K3); a real overlap found at top center of the HUD (1.3 item 2) |
| O9 | A 1.0 that could go to the Play Store | Partial | android project, store pictures and docs/STORE.md exist; privacy email, security review and phone test are open |

Known open issues from 0.4.0 (all still open; none was worked on since)

| # | issue | status |
|---|---|---|
| K1 | Street view 347 draw calls and 604k triangles against 342 and 585k | Open |
| K2 | City build plus renderer build over 3 s | Open |
| K3 | Tile build slices with garbage collection pauses over 5 ms | Open |
| K4 | A tree blocks the title frame | Open (visible in docs/preview/m1-first-view-title.png) |
| K5 | 4 start parking spots and 4 moving cars in the first view, target 6 and 6 | Open |
| K6 | Adventure map markers are plain dots | Open |
| K7 | Favorite car loses its star after a reload | Open |
| K8 | Reward cars can be duplicated from two garages | Open |
| K9 | Slalom accuracy test uses a weaker pass rule than the contract | Open |
| K10 | Sim grip slightly under the section 2 line | Open |
| K11 | Traffic brake gain scale left out (breaks AI tests) | Open, needs a contract change, not code |
| K12 | Security review ran only in a light form | Open |
| K13 | No real phone test since the overhaul | Open |
| K14 | Workflow actions pinned to tags, not commit SHAs | Open (both workflow files) |
| K15 | Privacy page contact email is a placeholder | Open (public/privacy.html:44), owner to supply |
| K16 | docs/STATUS.md and docs/SPEC.md lag the game (STATUS still says "Last updated 2026-11-20") | Open |

Summary: 36 requirements: 30 Done, 4 Partial, 2 Missing. 9 open requests: 0 Done, 5 Partial,
4 Missing. Together 45: 30 Done, 9 Partial, 6 Missing. 16 known issues, all open.

Health today (measured): `npm test` 600 pass, 0 fail, 19 s. The five views render with no page
errors at 221 to 285 draw calls and 361k to 515k triangles (traffic cleared); a close view with
ten cars reached 305 calls and 622k triangles.

### 1.2 Honest look at the screenshots

Taken today with scripts/m1-render-shots.mjs and a scratch script, 915x412.

- Downtown street, day: the best view in the game. Glass towers, a stucco block with arched
  windows and shutters, readable invented shop signs, awnings, lane lines. It reads as a city
  street in a mid-range mobile game. Weak: nobody on the sidewalk, the sidewalk is one large
  flat slab pattern, the car shadow is a hard dark blob.
- Downtown street, night: good. Lit windows vary, shop windows glow, headlight cones and tail
  lamps work. Weak: shop windows are the same flat orange panel repeated; no street reflections.
- Little Havana: recognisably low-rise and pastel, with tile roofs. Weak: lawns are one flat
  bright green with no edge to the sidewalk, trees are dark faceted lumps on a stick, the sky
  is a flat gray-blue with three blob clouds. This view still looks like a prototype.
- Waterfront: palms, bay water and far towers give the right idea. Weak: grass is one flat
  green, tree canopies are the same dark lumps, the tower on the right is a plain blue wall
  with no ground floor.
- Spawn street: dense and convincing at a glance. Weak: two palm trunks and a lamp post cross
  the frame in front of the camera, canopies are lumps, the right side is a bare plaza. With
  traffic on, eight cars sit nose to tail in one lane 30 steps after start and a sports car
  stands at an angle in the lane: it looks like a jam, not a living street.
- Title: the tree in the middle of the frame hides the street (K4).
- Car close-up (sports, sedan): correct proportions, real wheels with rims, lamps, plates. But
  the bodies are smooth soap bars: no panel lines with depth, glass is a black shell with no
  interior, paint has no reflection of the street, the shadow is a blob. Better than "blocky",
  short of "polished". Nine cars share five bodies.
- Fighter: good. Twin tails, intakes, gear, missiles on rails. Would pass in a store shot.
- Tank: good. Camouflage, road wheels, tracks, turret detail. Would pass.
- Boat (speedboat on a pier): good. Hull shape, outboard, rails, wooden pier with bollards.
  The water is a flat turquoise sheet near the wall: acceptable, not pretty.
- Person (docs/preview/people-close-day.png, model unchanged since): clothed figures with faces
  and hair, a little doll-like, fine at street distance. But in today's seven street shots not
  one pedestrian is in view: the people exist and the streets do not show them.
- Explosion (sedan, 18 m): at 0.07 s a flat pale yellow disc with the car floating in it; at
  0.3 s an orange disc and about five brown boxes; at 2 s thin smoke; at 6 s nothing at all: no
  hull, no scorch, no smoke, no parts. This is the "fake" the owner describes. The blast itself
  costs nothing in draw calls (274 to 285), so there is room to do it properly.
- HUD: clean layout, buttons on a grid, clear of the car. One real fault: the top center.

### 1.3 Top defects, ranked by how much a player notices

1. Destruction leaves no trace. Wrecks vanish after 3 s, bodies after 4 s, no scorch stays, the
   fireball is a flat disc, parts are plain boxes (rows 5, 6, O5).
2. The top center of the HUD piles up. The objective arrow and "First Light 0.4 mi", the
   district banner, the wanted stars, the "Wrecked +250" toast, "The police want a word!" and
   the tutorial hint all draw in the same place and cover each other (seen in six shots today).
   scripts/ui-test.mjs does not catch it.
3. Streets look empty of people, and the start traffic looks jammed (K5).
4. Trees: dark faceted lumps; trunks and posts cross the camera on the spawn street; a tree
   blocks the title (K4).
5. Cars read as soap bars with black glass and blob shadows (O4).
6. The three asked-for features are absent: boost, siren yield, service vehicles (O1 to O3).
7. Ground and sky: flat single-color lawns, huge uniform paving on plazas and the airfield
   apron, a flat sky with blob clouds and no sun.
8. Stutter risk on the phone: over the draw and triangle limits, build over 3 s, collection
   pauses over 5 ms in tile slices (K1 to K3). Not seen on the test machine; likely on a phone.
9. Garage faults a player will hit within an hour: the favorite star is lost on reload, reward
   cars can be copied, adventure markers are plain dots, garages look empty (K6 to K8).
10. Sound is unproven. It may be fine or may still be "garbage": no one knows (O6).
11. Wanted level 5 shows a fifth star but sends nothing new (row 14).
12. Bodies do not fall away from the shot; every death looks the same (row 17).

## 2. Plan to 1.0

### 2.1 Rules that stop work ending midway

1. Every workstream is cut into slices that each leave the game complete. A slice that is not
   finished when its budget ends is reverted or switched off, never published half working.
2. A publish may not carry a "Not done" note without a line in section 2.7 of this file naming
   the version that will finish it. The milestone review fails the publish otherwise.
3. Each workstream stops and reports at 80 percent of its token range with what is left. The
   coordinator then cuts scope to what fits, in whole slices.
4. One owner per file inside a wave. src/game.js, src/main.js, package.json and docs/STATUS.md
   belong to the coordinator, who applies the wiring lines each workstream asks for.
5. Three versions, three stops: 0.5.0, 0.6.0, 1.0.0. The owner plays each on the phone (two
   taps, section 4.2) before the next begins. Fixes between them are patch versions.

Tiers: Haiku for mechanical edits; Sonnet for standard work from a complete brief; Opus for hard
scoped work; Fable for design decisions only. Every Sonnet or Haiku result is reviewed by Opus;
every Opus result by the milestone review (a different Opus session); Fable work by the owner.

### 2.2 Overview

| version | theme | workstreams | spend |
|---|---|---|---|
| 0.5.0 | Feel | D0, B1, B2, W5, W6, W7, G1, then V1, U1, then R2 | 1.75M to 2.55M |
| 0.6.0 | Alive and smooth | W2b, W8, A1, H1, U2, W9, S1, then R3 | 1.05M to 1.6M |
| 1.0.0 | Release candidate | W10, P1, S2, R4 | 0.4M to 0.6M |

Total 3.2M to 4.75M. The two earlier stages cost 3.5M and 3.2M and both ran over.

### 2.3 Version 0.5.0: Feel

Wave A runs in parallel: B1, B2, W5, W6, W7, G1 (D0 first, one day ahead). Wave B starts when
B1, B2 and the first W5 car have landed: V1, U1. Then R2.

D0. Design brief (Fable, 40k to 70k; reviewed by the owner through section 3)
- Goal: the decisions wave B needs: what each service vehicle does (extras, controls, light
  bar pattern), where the boost meter and siren button sit in the HUD grid, the one-line rule
  for the top center stack, the go or no-go bar for the first W5 car.
- Owns: docs/REVAMP.md (new sections 6.11 to 6.13), docs/UI.md.
- Done when: V1 and U1 briefs can be cut without questions.

B1. Boost (running now as a helper; Sonnet, 120k to 180k; reviewed by Opus)
- Goal: one BOOST button with a meter: turbo for cars, boost for boats, afterburner for jets.
- Owns: src/entities/boost.js (new), the boost fields in src/entities/vehicle.js, boat.js and
  aircraft.js, src/core/input.js, src/ui/touch.js (action wiring), the meter in src/ui/hud.js
  and src/ui/styles.js, test/boost.test.js (new). Sound hook `boost { on, kind }` goes to W6.
- Depends on: nothing.
- Acceptance and check: test/boost.test.js (meter drains and refills in fixed steps, top speed
  and thrust rise by the stated factor, no boost when wrecked, AI never boosts); the handling
  band tests pass with boost off; ui-test shows the button at both sizes with no overlap; a
  shot of a car, a boat and the fighter with the meter visible and flame or spray on.

B2. Siren and yield (running now as a helper; Opus, 150k to 220k; reviewed by R2)
- Goal: with the siren on, traffic ahead pulls to the curb and stops, pedestrians step off the
  road; works in any vehicle that has a siren.
- Owns: src/systems/traffic.js, src/systems/peds.js, src/systems/police.js (siren state),
  test/traffic.test.js, test/peds.test.js, test/police.test.js. The SIREN button line in
  touch.js is applied by B1. Sound: event `siren { on, id }` handed to W6 (audio.js).
- Depends on: nothing. Hands V1 the flag `spec.siren` and `v.sirenOn`.
- Acceptance and check: tests: a siren car at 20 m/s down a two lane street with 6 cars ahead
  passes without contact in 9 of 10 seeds; cars return to their lane within 4 s after it has
  passed; peds within 12 m ahead leave the road; with the siren off nothing changes (same step
  hash as 0.4.0 for a fixed seed). Smoke: a 60 s siren drive with zero impacts.

W5. Cars (Opus, 350k to 500k; first car judged by Fable in D0 terms, the rest by R2)
- Goal: the Cars criteria of REVAMP section 2: nine silhouettes, panel lines with depth, a
  simple interior behind tinted glass, sky and street reflection in the paint, soft contact
  shadow, dirt and damage readable at 20 m.
- Owns: src/render/carbody.js, vehiclemesh.js, vehiclemats.js, loft.js, hullkit.js,
  scripts/vehicle-shots.mjs, scripts/vehicle-shots-entry.js, scripts/vehicle-perf.mjs,
  test/carmesh.test.js. Exports a kit (wheel, lamp, glass, paint, light bar mount) for V1.
- Depends on: nothing. Slice 1 is one car (the sedan) taken to the bar and a go or no-go shot;
  slices 2 to 4 are three cars each.
- Acceptance and check: test/carmesh.test.js (near 6,000 to 9,000 triangles, mid under 1,500,
  nine distinct outlines by a silhouette hash at 50 m); vehicle-perf: ten cars in view add no
  more than 40 draw calls; shots car-close day and night, cars-far, street day.

W6. Combat feel (Opus, 350k to 500k; reviewed by R2)
- Goal: contract 6.7 in full: layered blast with light on the street, 14 to 18 parts with four
  that can be recognized, hulls that stay 60 s (at most 6) and smoke, scorch 120 s, bodies that
  fall away from the hit and stay 30 s, kill freeze, hit and kill cues, three layer blast sound.
- Owns: src/systems/combat.js, cinematic.js, src/systems/audio.js, src/render/combatfx.js,
  effects.js, ragdoll.js, src/core/ragdoll.js, src/core/loop.js (hit stop only),
  src/audio/combatsounds.js, test/blast.test.js, combat.test.js, combatfx.test.js,
  ragdoll.test.js, cinematic.test.js, scripts/combat-e2e.mjs, scripts/blast-shots.mjs.
  Also plays the `boost` and `siren` sounds from B1 and B2 (audio.js is W6's).
- Depends on: nothing. Slices: hulls and bodies that stay (first, on its own publishable);
  blast layers; parts; directional falls; freeze and sounds.
- Acceptance and check: the tests named in 6.7 (16 directions per cause; hull count never over
  6; body count never over 12); combat-e2e; perf heavy fight under 520 draw calls and step
  under 2 ms; blast shots at 0.1 s, 0.5 s, 5 s and 30 s (the hull must be in the last one).

W7. Sky, light and water (Sonnet, 150k to 220k; reviewed by Opus)
- Goal: layered clouds, a sun disc with haze, softer shadow edge, sea color and foam line at
  the seawall, night glow.
- Owns: src/systems/daynight.js, src/render/water.js, nightlights.js, scripts/sky-preview.mjs,
  scripts/night-shots.mjs, test/daynight.test.js.
- Depends on: nothing. Does not touch graphics.js (W2b's in 0.6.0); asks the coordinator.
- Acceptance and check: test/daynight.test.js; at most 3 more draw calls and no new shader
  program after warm-up (perf.mjs); shots at noon, dusk and night of the waterfront and Little
  Havana.

G1. Garage and adventure fixes (Sonnet, 80k to 120k; reviewed by Opus)
- Goal: K7 and K8 fixed; parked cars visible inside an open garage.
- Owns: src/core/explore.js, src/core/garage.js, src/systems/garages.js,
  src/systems/adventures.js, src/ui/explore.js, src/render/exploremesh.js, test/explore.test.js,
  garages.test.js, adventures.test.js, garage.test.js.
- Acceptance and check: new tests: star survives save and load; a reward car taken out of one
  garage cannot be taken from another until stored or wrecked; scripts/menu-test.mjs; a shot of
  an open garage with two cars in it.

V1. Service vehicles (Opus, 350k to 500k; reviewed by R2). Starts after B1, B2 and W5 slice 1.
- Goal: steal and drive a fire truck, an ambulance, a garbage truck and a tow truck; the
  police car, ambulance and fire truck have a working siren and flashing lights; each has one
  working extra: fire truck water cannon (knocks people over, puts out burning hulls), garbage
  truck bin lift (lifts and empties a curb bin, crushes a small wreck part), tow truck hook
  (tows one car), ambulance (heals the player in hard mode). They appear parked at set places
  and now and then in traffic.
- Owns: src/entities/servicevehicles.js (new: specs, merged into `VEHICLE_SPECS` by one import
  line the coordinator adds to vehicle.js), src/render/servicebody.js (new: meshes built from
  the W5 kit), src/render/lightbar.js (new: also fitted to the police car), src/systems/service.js
  (new: extras and their rules), test/service.test.js, scripts/service-shots.mjs (new).
  Needs lines in touch.js (one EXTRA button) through U1, and a spawn share in traffic.js
  through the coordinator after B2 has landed.
- Depends on: B1 (touch slot), B2 (`spec.siren`, yield), W5 (kit), D0 (extras design).
- Slices: one per vehicle, fire truck first; each slice is drivable, has its siren and its
  extra, and is publishable alone. If the budget ends after three, the fourth is not shipped.
- Acceptance and check: test/service.test.js (each spec drives inside its handling band; siren
  toggles; each extra changes the world as stated, in fixed steps, seeded); carmesh triangle
  bands; perf street view within limits with two service vehicles in view; shots of each by day
  and with lights at night.

U1. HUD stack, map markers, phone check (Sonnet, 150k to 220k; reviewed by Opus). After B1.
- Goal: (a) one top center stack with fixed rows so the arrow, objective text, district banner,
  stars, toasts and hints never overlap; (b) adventure markers with a "?" glyph and a ring
  (K6); (c) the EXTRA button for V1; (d) a "Phone check" screen (section 4.2).
- Owns: src/ui/hud.js, styles.js, touch.js (after B1 lands), minimap.js, combathud.js,
  src/ui/menu.js, src/systems/mapui.js, objective.js, tutorial.js, new src/ui/phonecheck.js,
  scripts/ui-test.mjs, scripts/menu-test.mjs, docs/UI.md (after D0).
- Acceptance and check: ui-test extended to the running game with every top center item forced
  on at once (objective, banner, 5 stars, two toasts, a hint) at 780x360 and 915x412, insets 0
  and 40: zero overlaps, zero targets under 48 px; map shot with markers; phone check runs in
  headless and prints a result string.

R2. Review of 0.5.0 (Opus, 60k to 90k). Gates in 2.6. No new features.

### 2.4 Version 0.6.0: Alive and smooth

All in parallel except S1 (after the others land) and R3 (last).

W2b. World look and speed (Opus, 300k to 450k; reviewed by R3)
- Goal: K1 to K5; trees that read as trees; no trunk or post crossing the start and title
  frames; lawn edges and variation; paving variety on plazas and the apron; softer shadows.
- Owns: src/render/realcity.js, citymesh.js, lotmesh.js, buildings.js, miamilook.js, props.js,
  textures.js, graphics.js, adaptres.js, titlecam.js, src/world/lots.js, miami.js,
  miami-spots.js, scripts/perf.mjs, scripts/tile-bench.mjs, test/miamilook.test.js,
  lotmesh.test.js, world-density.test.js, firstview.test.js, docs/MAP.md.
- Acceptance and check: perf.mjs street view at most 342 draw calls and 585k triangles by day
  and night; city build plus renderer build under 3 s; tile-bench: no slice over 5 ms in three
  runs; firstview test: 6 parking spots, clear center of the title frame (no prop inside a
  cone of 8 degrees within 40 m); the five view shots.

W8. Street life (Sonnet, 150k to 250k; reviewed by Opus)
- Goal: people on the sidewalks and plazas by district and hour; 6 moving cars in the first
  view without a queue; cars in the parking lots; service vehicles in traffic; the heat 5 police
  tank if the owner says yes (decision 6).
- Owns: src/systems/peds.js, parked.js, traffic.js, police.js, armor.js, test/traffic.test.js,
  peds.test.js, police.test.js (B2 has finished with these).
- Acceptance and check: tests: at least 8 walkers within 80 m of the camera at five named
  spots at 14:00, at least 6 moving cars in the first view, no two start cars closer than 8 m;
  perf street view still inside the W2b limits; the five view shots show people.

A1. Sound (Opus, 150k to 250k; reviewed by the owner's ears through the phone check)
- Goal: fix what the phone check reports; until then, close the gaps listed in docs/AUDIO.md
  "Still weak, honestly"; level every group to one loudness target; a numbered sound test list.
- Owns: src/audio/* (combatsounds.js after W6 has landed), src/systems/radio.js,
  scripts/audio-test.mjs, audio-analyze.mjs, volume-test.mjs, test/audio.test.js,
  radio.test.js, levels.test.js, docs/AUDIO.md.
- Acceptance and check: audio-analyze: every group within 3 dB of target, no clipping, energy
  between 300 Hz and 4 kHz for every sound that must carry on a phone speaker; the owner marks
  at most 2 of the numbered sounds bad in the 0.6.0 phone check.

H1. Handling contract clean-up (Opus, 60k to 100k; reviewed by R3)
- Goal: K9 (the slalom test uses the contract rule), K10 (Sim grip on the line), K11 (the
  contract is amended to say the pedal S-curve replaces the traffic brake gain scale, with a
  test that pins the curve).
- Owns: src/entities/vehicle.js, handlingbands.js, src/core/input.js, src/render/chasecam.js,
  test/handling-bands.test.js, steering.test.js, vehicle.test.js, chasecam.test.js, boost.test.js.
- Acceptance and check: `npm test`; traffic and police lap tests unchanged.

U2. Menu and title polish (Sonnet, 100k to 160k; reviewed by Opus)
- Goal: an About screen (version, credits, map license, privacy link), the sound test list,
  a Blood switch if the owner says yes (decision 5), all menu texts checked against the game.
- Owns: src/ui/menu.js, title.js, hud.js, styles.js, touch.js, wheel.js, phonecheck.js,
  src/index.html, scripts/ui-test.mjs, menu-test.mjs, ui-harness.html, docs/UI.md.
- Acceptance and check: ui-test and menu-test; shots of every menu screen at both sizes.

W9. Release pipeline (Haiku for the scripts, Sonnet for the gate; 80k to 150k; Opus review)
- Goal: `node scripts/bump-version.mjs patch|minor`; `npm run gate` runs every gate in 2.6 and
  writes the review shots; CI refuses a publish whose version equals release/last.json; actions
  pinned to commit SHAs (K14); a tag `v<version>` on every publish.
- Owns: scripts/bump-version.mjs (new), review-shots.mjs (new), release-check.mjs, smoke.mjs,
  smoke-extra.mjs, .github/workflows/*.yml, android version files, docs/RELEASE.md.
- Acceptance and check: a dry run on a scratch branch: same version fails, bumped version
  passes; review-shots writes the named views in 2.6.

S1. Security review (Opus, independent session, read only; 60k to 90k)
- Scope: save loading and sanitisers, the service worker and cache keys, the page content
  policy, the build and workflows, the android wrapper config, dependencies, no runtime network.
- Output: findings by severity in docs/STATUS.md; fixes go through W10. Publish needs zero
  critical or high.

R3. Review of 0.6.0 (Opus, 60k to 90k).

### 2.5 Version 1.0.0: release candidate

W10. Phone test fixes (Opus or Sonnet by item, 200k to 300k reserve)
- Goal: fix what the owner reports from the phone after 0.5.0 and 0.6.0. One item at a time,
  only files no running workstream holds. Each fix is a patch version with the full gate.

P1. Store and documents (Sonnet, with Haiku for text sync; 60k to 100k; Opus review)
- Goal: docs/SPEC.md, STATUS.md and PLAN.md match the game (K16); privacy page with the
  owner's contact address (K15); store pictures retaken from 1.0 (scripts/store-shots.mjs);
  listing text, content rating answers and the license credit in docs/STORE.md; the manifest
  and icons checked. No APK or bundle is built (owner's instruction) unless decision 1 says so.
- Owns: docs/*.md except this file, public/privacy.html, public/manifest.webmanifest, store/,
  scripts/store-shots.mjs, README.md.

S2. Security re-check (Opus, independent, 30k to 50k): the diff since S1 only.

R4. Release candidate review (Opus, 80k to 120k): the checklist in 2.8, a 60 minute scripted
soak with zero errors and flat memory, every review shot looked at.

### 2.6 Quality gates for every publish

Run in this order; any failure stops the publish. After W9 lands this is `npm run gate`.

1. `npm run lint`: no errors.
2. `npm test`: all pass (600 today; the number may only fall with a written reason).
3. `npm run build` then `npm run release:check`: versions agree, code is higher than
   release/last.json, the splash shows the version.
4. `node scripts/smoke.mjs --extra`: loads at phone size, no page errors, no outside requests.
5. `node scripts/ui-test.mjs`: no overlap, no target under 48 px, 780x360 and 915x412, insets
   0 and 40, with the top center items forced on (from U1).
6. `node scripts/perf.mjs`: street view within the limits (342 and 585k from 0.6.0; no worse
   than 0.4.0 for 0.5.0), heavy fight under 520 draw calls, step under 2 ms.
7. An independent security review: a different session from the builders, read only. Light
   form (the diff) for 0.5.0 and patch versions, full form (S1) for 0.6.0, re-check for 1.0.0.
8. Screenshot review at 915x412 by a session that did not build the work, against REVAMP
   section 2: downtown street day; downtown night; Little Havana; waterfront; spawn street;
   title; car close-up day and night; fighter; tank; boat; a person at 3 m; a street with
   people; a car blast at 0.1 s, 0.5 s, 5 s and 30 s; each service vehicle with lights; boost
   on in a car, a boat and the jet; the HUD in car, on foot, boat, plane and tank with the top
   center forced on; every menu screen; the full map with markers. Any overlap, bare ground,
   missing hull or blocked frame fails.
9. Publish, wait for the deploy, open the live site, read the version, then
   `npm run release:record`.
10. The owner's two taps on the phone (4.2). The next milestone does not start before the
    result is in, or the owner says go without it.

### 2.7 Items carried forward (must be empty at 1.0.0)

| item | finishes in |
|---|---|
| Rows 5, 6, 17, O5 (destruction that stays, directional falls) | 0.5.0, W6 |
| O1 boost, O2 siren yield, O3 service vehicles | 0.5.0, B1, B2, V1 |
| O4 cars | 0.5.0, W5 |
| Top center HUD overlap, K6 markers | 0.5.0, U1 |
| K7, K8, empty garages | 0.5.0, G1 |
| K1 to K5, trees, ground | 0.6.0, W2b |
| People on streets, start traffic, row 14 (if yes) | 0.6.0, W8 |
| O6 sound | 0.6.0, A1, confirmed by ear at 1.0.0 |
| K9 to K11 | 0.6.0, H1 |
| Row 33, K14 | 0.6.0, W9 |
| K12 | 0.6.0, S1 and 1.0.0, S2 |
| K13 | after each version, owner |
| K15, K16, O9 | 1.0.0, P1 |
| Fighter stuck on the shore at part thrust; ramps with no side collision; heli on a roof pad cannot be reached on foot | 1.0.0, W10, or struck off by the owner |

### 2.8 Release candidate checklist (1.0.0)

- [ ] Every row in 1.1 is Done, or struck off by the owner in writing.
- [ ] Table 2.7 is empty.
- [ ] Gates 1 to 8 pass on the exact commit that is published.
- [ ] The owner's phone check on 0.6.x: median 55 frames a second or better, no drop under 30
      for more than half a second, no sound marked bad, no overlap reported.
- [ ] 60 minute soak: zero page errors, heap growth under 10 percent after the first 5 minutes.
- [ ] Saves from 0.3.1, 0.4.0, 0.5.0 and 0.6.0 load in 1.0.0 (fixtures in test/save.test.js).
- [ ] Offline: the installed page starts with the network off (scripts/offline-test.mjs).
- [ ] No outside request at runtime; no secret in the repository; dependencies pinned exactly.
- [ ] Security: zero critical, high or medium open; low findings listed with a reason.
- [ ] Privacy page has a real contact address; the map license credit shows in Settings, on
      the title and in the store text.
- [ ] No name, character, map or art from another game; venue names invented (a text scan of
      src/ and public/ against a list of real venue brands).
- [ ] Version 1.0.0 in package.json, android/package.json and version.properties, on the
      splash and in the pause menu; tag v1.0.0 on the published commit.
- [ ] docs/SPEC.md, STATUS.md and STORE.md describe the game as it is.
- [ ] Store pictures retaken from 1.0.0; content rating answers written down.
- [ ] Android: the project syncs and its version matches; the bundle is built only if the
      owner has said so (decision 1).

## 3. Decisions for the owner

Each has a recommended answer and one reason. Only choices that change what the product does,
costs or exposes.

1. Android bundle. Should 1.0.0 include building the signed bundle? Recommend: no, 1.0.0 is
   the web release candidate; build the bundle as 1.0.1 after you accept 1.0.0 on the phone.
   Reason: you said not yet, and a bundle of an unaccepted build is wasted work.
2. Budget. Approve 3.2M to 4.75M in three versions with a stop after each? Recommend: approve
   0.5.0 now (up to 2.55M) and the rest after you have played it. Reason: both earlier stages
   ran over, and 0.5.0 holds everything you asked for by name.
3. Service vehicle list. Fire truck, ambulance, garbage truck, plus which "others"? Recommend:
   add a tow truck now, a city bus later. Reason: the tow hook is a toy with real play in it;
   a bus is only a big van.
4. What each extra does. Recommend: water cannon that knocks people down and puts out burning
   wrecks, a bin lift that works on curb bins, a tow hook, an ambulance that heals in hard mode.
   Reason: each is a thing to play with, cheap to build on systems that exist.
5. Blood switch. Add a "Blood" setting (on by default)? Recommend: yes. Reason: one switch
   costs little and makes the store rating conversation easier; with blood on the game will
   be rated for adults (17 or 18 and up).
6. Fifth wanted star. Should heat 5 send the police tank? Recommend: yes, in 0.6.0. Reason:
   the fifth star is already drawn and the police tank already exists but is never sent.
7. Dying. D10 said decide after combat is rebuilt. Recommend: keep "cannot die" as the default
   for 1.0. Reason: your rule is fun before stakes; hard mode stays one switch away.
8. Real place names. Streets and districts stay real. Rename "PortMiami" to "the Port" and
   check every park and marina name? Recommend: yes. Reason: district names are geography, but
   named public venues are the legal gray area and renaming is a text change.
9. Scope of 1.0. Story missions, tuning garage and championships stay out? Recommend: yes,
   out, listed as "after 1.0". Reason: they are whole products, and the complaint is unfinished
   work, not missing modes.
10. Contact address. Which email goes on the privacy page and the store listing? Recommend: a
    new address used only for this game. Reason: it becomes public and permanent.
11. Field data. The game sends nothing, so nobody learns about crashes on other phones. Keep
    it that way? Recommend: yes for 1.0. Reason: no data means no privacy duties and a simpler
    store form; the phone check covers your own device.
12. Fable. Use it for D0 only (40k to 70k) and to judge the first new car? Recommend: yes.
    Reason: a wrong design call on the service vehicles or the cars costs ten times that.

## 4. Risks, and what only a phone can show

### 4.1 Risks

| # | risk | mitigation |
|---|---|---|
| 1 | Art made in code hits a ceiling; cars still read as toys after W5 | slice 1 is one car and a go or no-go shot; if no-go, stop W5 and spend the rest on paint, shadow and glass, which help all nine at once |
| 2 | Everything is judged on a software renderer again | phone check after each version; W10 reserve; no milestone starts without the result |
| 3 | Token overrun, as in both earlier stages | ranges per workstream, stop at 80 percent, whole slices only, no cap raised without the owner |
| 4 | Two workstreams edit one file (boost and siren are already running beside this plan) | ownership lists above; touch.js goes B1 then U1 then U2; traffic.js, peds.js, police.js go B2 then W8; vehicle.js goes B1 then H1; the coordinator applies all cross lines |
| 5 | Hulls that stay, service vehicles and more walkers push the phone over budget | W6 caps (6 hulls, 12 bodies, 2 draw calls a hull); perf gate each publish; W2b brings the base cost down before W8 adds people |
| 6 | Siren yield breaks traffic and police AI tests (they were fragile for the brake gain) | siren off must give the same step hash as 0.4.0; yield is a separate planner state, not a change to the lane follower |
| 7 | Hulls block roads, garages, races and spawn points | hulls never spawn inside a marker or garage radius; race start clears hulls; traffic steers round or waits; tests for each |
| 8 | A phone that cached an old version keeps it | cache keyed by version (exists); offline test in the checklist; the title shows the version |
| 9 | Store rules: adult rating, a target API level that rises each year, and tester requirements for new developer accounts | P1 writes the rating answers; targetSdk is 36 today; check the current Play rules before decision 1 |
| 10 | Map license: the credit must stay visible | a smoke check for the credit text; credit in the store text |
| 11 | Old saves break as hulls, boost and service cars enter the save | save version bump with loader tests for every published version |
| 12 | Sound work is done blind | A1 waits for the phone check where it can; the numbered list turns "garbage" into "sounds 3 and 7 are bad" |

### 4.2 What cannot be verified without the phone, and the two taps

Cannot be verified here: the real frame rate and stutter; heat slow-down after ten minutes;
how the touch wheel, pedals and the new BOOST and SIREN buttons feel under thumbs; whether
anything sits under the camera cut-out or the rounded corners; whether fullscreen is granted;
every sound; how the picture looks at the phone's real sharpness; install and offline start.

How the owner helps in two taps (built by U1 in 0.5.0, no network, nothing leaves the phone):

1. Open the live site, then Settings, Display, tap "Phone check". The game drives itself for
   60 seconds along a fixed route with a fight and a blast, then plays eight numbered sounds.
   Tap any sound number that sounds bad.
2. Tap "Copy result" and paste it into the chat. The result is one short line: version, screen
   size and insets, median and worst frame time, number of long frames, the resolution scale
   reached, whether fullscreen was granted, and the bad sound numbers.

Anything else the owner notices goes in the same message in plain words. That one line replaces
every guess in this document that starts with "judged".
