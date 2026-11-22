# Status

Last updated: 2026-11-20. The game is playable and published. Work is at
the final review and fix stage; nothing is in progress that blocks play.

## Features now in the game
- Driving: city with traffic and pedestrians, nine road vehicles, tank.
  Arcade handling (tight steering, the default) and Realistic handling.
- Boats (speedboat, jet ski, fishing boat), planes (prop, seaplane, jet,
  fighter), helicopters (including a flyable police helicopter).
- Tank (the Rustback, stealable at Ironbank Depot) and the Gannetfang
  fighter jet with nose gun, missiles and bombs.
- On-foot combat: six weapons plus grenades (Fizzpop Can) and sticky
  bombs, touch aiming, hold-to-aim throws, bombs dropped from planes,
  missiles from armed craft. People die in one hit and bleed; wrecks break apart and vanish.
- Rival crew and police shootouts; police heat 1 to 4 with officers on
  foot, pursuit cars, roadblocks and a police helicopter.
- Score and high scores only. No money or shop: every vehicle and weapon
  is available from the start, except one reward car (Ghostwake, below).
- Six hidden secrets and the Ghostwake, a secret car at the end of the chain
  (replaces the old submarine easter egg).
- Races, sky ring courses and timed deliveries with medals.
- Day and night, weather, quality scaling, generated sound.
- Calmer UI: a Minimal HUD (default) or Full HUD, one expanding "more"
  button, idle-shrinking controls, small minimap, full map with waypoint.
- Camera views per craft: chase, far chase, bumper or cockpit.
- Saves score, medals, best times and settings in the browser.
- Hard mode (Settings, "Hard: you can die", off by default): the player can
  be killed and respawns after the fade; a health meter under the minimap
  shows walker hp, or the craft's health while aboard. A RESPAWN button in
  the "more" fan (any mode, hard mode on or off) sets the player on foot at
  a safe spot, full health, heat cleared; the craft stays where it was.

## Decisions and direction changes, in order
1. Name: Rustwater, an original island harbour city. 3D, flat ground,
   physics in 2D (x, z). three.js 0.187.0, esbuild 0.28.2, eslint 10.15.0.
2. Preview on a public GitHub Pages site (user's choice). No separate main
   branch: the working branch is the default branch and publishes directly.
3. Direction change 1 (user): fun driving, boating and flying; combat
   and crime missions dropped; police chases a light optional extra.
4. Direction change 2 (owner, after the first phone play test): steering
   radius too wide (fixed: Arcade and Realistic handling), VIEW button did
   nothing (fixed: camera views per craft), wants violence and fun, "more
   GTA and Gran Turismo combined". Answers: full sandbox violence without
   blood or gore; combat and weapons first, then story missions; tuning
   garage and championships parked. This replaced direction change 1.
   (Later reversed by the owner, see the entry for 2026-11-20: blood is
   now allowed.)
5. Design principle (owner): "It's about more fun, not more points." No
   money, shop or unlocks; high scores only.
6. Models: Fable is no longer used (owner request). Opus takes the hard
   work, Sonnet the rest.
7. Direction change 3 (owner): bombs, grenades, police shootouts and
   chases, fighter jets, flyable police helicopters, stealable tanks.
8. Calmer UI pass: one expanding more button, Minimal HUD setting.

## Run cap history
- Original cap: 27 tasks and 3.5M delegated tokens. Reached at 3.51M
  after the quality overhaul; work paused for the owner's decision.
- The owner raised the cap for the combat stage: new stage cap 2.8M
  ("toys first"). Actual spend for the stage was about 3.2M, over the
  stage cap.
- The owner then approved a review only (no new features). This review
  and its fixes are the last work in this run.

## NOT built
- Escalating chases: police helicopters in chases, roadblocks at heat 5,
  tanks sent after the player (heat stops at 4; the police helicopter is
  there, but not the heat-5 escalation).
- Story missions engine and the missions (design in docs/MISSIONS.md).
- Tuning garage and car upgrades.
- Championships with AI rivals.
- Parked ideas: AI fighters, ejection seat, knockable lamps and trees.

## 2026-11-20: blood, lethal combat, breaking wrecks
- Owner change: blood is allowed (dismemberment and sexual content still
  out). Any bullet, blast or ram kills a non-player person outright; they
  fall, lie a few seconds, fade, never get up. Wrench kills on the 2nd
  hit. The player still cannot die and has unlimited ammo.
- combatfx: red hit burst, bigger death burst, ground pool that grows and
  fades in about 20 s (ring buffers: 16 pools, 24 spatters), blast
  deaths bleed more. Wrecks throw 6 to 10 pooled debris chunks (48 max),
  then the hull is removed 3 s after the blast (player ejected first).
- Also fixed: a chain blast queued while another was detonating lost its
  craft (wreck was never marked), now handled.
- Tests changed on purpose: combat.test.js (pistol, state machine, blast
  radius), crew.test.js (low-hp flee, 6 v 1 shot count), tank.test.js
  (ram kills), police-combat.test.js (heat points), combatfx.test.js.

## 2026-11-20: killable cops, cinematic blasts, missiles that hit
- Why cops could not be killed: nearly all police were inside patrol cars,
  and officers in cars were not actors at all (only officers who stepped out
  on foot were). Now every police car (patrol, chase, roadblock) and police
  heli carries `occ` seats; a bullet into the cabin hurts the driver first,
  blasts hurt everyone, a wreck kills everyone. Dead officers fall out as
  body actors (blood, score, heat as for any person). A car with no one left
  stops (`role: 'dead'`) and the chase calls a new one. See COMBAT.md.
- Blasts: layered fireball with colour over life, shock ring, sparks and
  embers, a 6 to 10 s smoke column, fading scorch, distance-scaled shake
  (off with Reduce motion), cars thrown and flipped, people tumbling, bins
  and benches scatter chunks, tanks and jets explode bigger.
- Missiles: an unlocked missile now homes on what the nose points at (18
  deg), proximity fuse 3.5 m, parked police craft are not lock targets,
  longer smoke trail. `scripts/combat-e2e.mjs` checks cops, missiles (parked
  car, moving car, tank, police heli) and a bomb on a car with people.
- Tests added: police-kill, blast, combatfx (shake, Reduce motion); seeker
  test changed on purpose (parked police craft is tier 4).
- Not done: police tank (heat 5) is not spawned by police.js, so there is no
  tank crew to kill; static street furniture meshes stay put (only chunks fly).

## Carjacking and persistent session
- Carjacking (core/carjack.js rules and timeline, systems/carjack.js): ENTER
  on a craft with someone at the controls (speed under 3 m/s, on the
  ground) runs: player runs to the door (3 s at most), door opens, the
  driver is dragged out and thrown (0.5 s), the player is in at 0.7 s. The
  driver is a real combat actor (game.actors): lies down 1.6 s, gets up,
  runs from the thief for up to 14 s, then fades; can be shot or run over.
  Events: 'carjack' { car, victim, thief }, 'down' (source null, kind
  'carjack'), 'carDoor'. Heat: civilian 0.3 to 0.6 only if a cop or civilian
  saw it, police car 1.5, crew car 0.3 if a cop saw it. Crew cars: the crew
  system already pulls its members out and has them fight once the player
  is in; the jack only adds the door and delay. Empty parked cars keep the
  instant entry. Debug hook: game.debug.spawnOccupied(spec, x, z, heading, team).
- Saved session (core/garage.js, systems/session.js, save version 3, v1 and
  v2 saves still load): last position and heading, mode, the craft (spec
  id, paint colour, health fraction, altitude and speed for aircraft) and a
  garage of the 8 most recently used cars (spec, colour, health, pose).
  Autosave: enter, exit, every 10 s of simulated time, visibilitychange
  hidden, pagehide, beforeunload. createGame calls game.restoreSession()
  so Play continues; "New game" in Settings calls game.newSession() (scores
  and settings stay). Bad spots fall back to the nearest road node, pier,
  airfield stand or rescue spot. Wrecked craft are never saved. Garage cars
  are parked where they were left (systems/parked.js).
- Tests: test/carjack.test.js, test/garage.test.js, test/save.test.js
  (version number 3). E2E in scripts/smoke-extra.mjs; screenshots by
  scripts/carjack-shots.mjs into docs/preview/.

## 2026-11-20: wanted stars, slow motion, blast camera
- Wanted meter: 0 to 5 stars in the top-right HUD block (under the score,
  clear of speed, minimap and touch buttons), red and blue flash from 3
  stars, a green escape bar fills while out of sight. Stars = heat level,
  fifth star once the police helicopter is up. `wantedStars` in police.js.
- Heat levels now differ (`LEVEL_RULES` in police.js): more cars, quicker
  spawn attempts, cars arrive faster and drive up to 16 percent quicker;
  at heat 4 a roadblock and a police helicopter (existing
  `spawnPoliceHeli`, called off when heat drops, replaced 30 s after a loss).
- Slow motion (`src/systems/cinematic.js`): last nearby enemy down, a
  blasted vehicle or a police takedown gives 0.8 s of real time at 35
  percent speed via `game.timeScale` (scales real time into the loop's
  accumulator; every step is still 1/60), a vignette overlay and a 4 percent
  zoom. At most one per 6 s; off with Reduce motion.
- Blast camera: a vehicle exploding within 40 m swings the chase camera
  back and aside for 1.5 s (`chase.fx`), cancelled at once by a camera drag.
- Tests: `test/cinematic.test.js`. Screenshots: `scripts/wanted-shots.mjs`.

## 2026-11-20: hidden secrets and the Ghostwake
- The submarine easter egg is gone (double-tap on the version number,
  `game.easterEgg`, the boat spec, mesh, test and screenshot script).
- Six hidden secrets, placed from the city layout by `findSecrets`
  (`src/world/secrets.js`, seed 4417): The Drowned Box (a half-sunk
  container just off the Saltyard shore), Roof Garden (a lounge on a
  midtown roof, counts only from about 3.5 m below the roof or higher, so a
  jump, a helicopter or a stunt ramp), The Gullet (a sea cave in the cliff
  on Pale Shore), Rustlamp Rock (a rusted lighthouse on the far headland),
  Tag Alley (a Saltyard alley with a graffiti tag) and The Lone Ride (a
  playground in a Greenmere park with a spinning one-off ride).
- Reaching within 12 m the first time toasts "Secret found", banks 750
  points and saves it (`progress.secrets.found`, allow-listed ids; old
  saves load with none). Records shows "Secrets found n / 6" and the names
  of the ones found. After the first find the full map and minimap show one
  faint dot, off by about 55 m, for the next secret still hidden.
- The sixth gives 2500 more points, toasts "Ghostwake unlocked" and puts a
  teal dot on the map for a lock-up garage in Cinder Row. Its roller door
  opens within 15 m. Ghostwake: teal and black coupe with an underbody
  glow, top speed 68.2 m/s (about 10 percent over the Vexari R). It is
  parked in the garage; if it is wrecked or removed it returns when the
  player is 160 m away. It is saved like any parked car.
- Files: `src/world/secrets.js`, `src/systems/secrets.js`,
  `src/render/secretsmesh.js`, spec in `src/entities/vehicle.js`.
  Tests: `test/secrets.test.js`. Screenshots: `scripts/secrets-shots.mjs`
  (`docs/preview/secrets-*.png`).
- Ramming people never damaged any car in this game, so "no collision
  damage from pedestrians" holds for every car; the spec flag
  `pedSafe: true` documents it for Ghostwake.

## 2026-11-20: smoothness and look pass
- Adaptive resolution (src/render/adaptres.js, pure, test/adaptres.test.js):
  the loop's real frame time moves the pixel ratio between 0.6 and a cap
  of 2.0 (High), 1.6 (Normal) or 1.2 (Low) physical pixels per CSS pixel.
  Steps down 0.1 (0.2 when far over) at once, probes up 0.05 after calm;
  a failed probe doubles the wait (up to 60 s). Nothing shown in the HUD.
  Before, Normal on the S24 Ultra drew at the full 3.5 device ratio.
- MSAA only when the device ratio is 1.5 or less (decided at start).
- No compile hitches: every material is compiled (compileAsync) behind
  the title screen; the sun keeps castShadow on through sunrise and sunset
  (switching it recompiled every lit material) and just skips the shadow
  map; car models not built yet are lofted one per idle slot.
- Look: colour grade in the tone curve (ACES, a little saturation, cool
  shadows, warm highlights, exposure 1.1), facade AO-lite (darker at the
  ground, lift toward the top), damp night streets with lamp reflection
  streaks (one draw call), a sun band along the horizon at dusk.
- Screens: docs/preview/graphics-before-*.png and graphics-after-*.png.
  Perf numbers: scripts/perf.mjs (now also night view, shader programs,
  worst per-system call).

## 2026-11-20: car radio
- RADIO in the "more" fan (car and boat) and "Car radio" in Settings: Off,
  Lagoon Drive (chill synth), Pulse Harbour (dance pop 118 to 124 BPM),
  Lamplight Keys (slow jazz-like) and Gullspeak (talk). Saved as
  `settings.station` (allow-list, old saves load as off).
- Gullspeak is a generated talk texture (vowel blips, jingles, ads) with
  on-screen captions of 40 original DJ lines. It is not real speech.
- Crossfade 0.6 s on per-station buses; the background score returns on
  foot. Music ducks under sirens as well as explosions.
- Files: src/core/radio.js, src/audio/radio.js, radiosounds.js,
  radioplayer.js, src/systems/radio.js; test/radio.test.js; details in
  docs/AUDIO.md. Screenshot: docs/preview/radio-talk-caption.png.

## Known issues
- A fighter that leaves the depot at part thrust can get stuck on the
  shore (full thrust is fine).
- Draw calls reach about 417 in a street view and 544 in a heavy fight,
  against a budget of about 420.
- No test on the real phone (Galaxy S24 Ultra) since the overhaul.
- Sound has been measured, never heard by a person. Audio pass after the
  owner called it garbage on a phone: phone-speaker harmonics, gun cracks,
  layered explosions, longer engine loops with rasp, turbo and limiter,
  generated music; numbers and honest gaps in docs/AUDIO.md.
- Fixed in the final review: player stuck after a craft was wrecked on a
  roof or at sea; flaky end-to-end, UI and audio test scripts.

## Open security findings
None critical or high.
- Low (open): GitHub Actions in the publish workflow are pinned to
  version tags, not commit ids.
- Low (open): the page style policy allows inline styles (needed by the
  UI code).
- Earlier reviews: milestone 1 and 2 findings (player stuck at sea, pause
  with the map open, abandoned craft piling up) are fixed; the 212-minute
  soak test had 0 errors.

## Weather that changes the drive
- `src/core/weather.js` (pure, tested in `test/weather.test.js`): wet-road
  grip, understeer, brake and top-speed factors from the blended
  `game.weather.rain` (exactly 1 when clear, so dry numbers are unchanged),
  a small wind push for light craft, and a fog sight scale.
- Cars read `world.weather` (set each step in game.js); boats get the wind
  push too. Police sight range shrinks in thick fog. Traffic has no sight
  check, so it is unchanged. Wet-road lamp reflections already existed in
  daynight.js; rain spray in effects.js is a bit stronger and adds droplets
  in heavy rain. Aircraft are not pushed by wind yet.

## 2026-11-20: ragdoll tumbles and stunt jumps
- Ragdolls (`src/core/ragdoll.js`, pure, `test/ragdoll.test.js`): a person
  killed by a blast or hit by a car tumbles: one rigid body under gravity
  with a ground clamp, a bounce, and ten loose limb springs that lag the
  spin; it topples flat and settles about 0.8 s after touching down, then
  the pose is baked onto the actor and the slot freed. At most 12 tumble
  at once (the rest use the old fall pose). Own seeded stream, so fights
  stay deterministic. A car at speed throws the person up over the bonnet
  (up speed 1.2 + 0.32 per m/s of car speed, cap 8). Drawn by the existing
  person mesh through `src/render/ragdoll.js`, hooked in `layDown`.
- Stunt jumps (`src/world/stunts.js`, `src/core/stunt.js`,
  `src/systems/stunts.js`, `test/stunts.test.js`): four tabletop ramps on
  quiet streets (Fernside, Pale Shore, Cinder Row) and two at the airfield
  dock (Dock Kicker on the quay, Dock Splash in the water for boats),
  placed from the seeded city. Violet ramp icon on the map and minimap and
  a violet start pillar beside each ramp. Brake in the air for a backflip,
  steer for a barrel roll. Points from air time, distance, height, flips
  and rolls; medals at 450 / 900 / 1500 points, saved per ramp in
  `progress.medals` and best points in `score.courses`. Wrecked, crashed
  into a wall, sideways or roof landings score nothing. Ramp jumps no
  longer also count as generic airtime.
- Screenshots: docs/preview/ragdoll-bonnet.png, docs/preview/stunt-jump.png
  (`node scripts/stunt-shots.mjs`).
- Not done: bikes do not exist in the game, so only cars and boats jump;
  traffic cars also fly off the street ramps (no score for them); ramps
  have no collision from the side, a car driving into one side-on passes
  through it.

## 2026-11-20: weapon wheel on SWAP
- Hold SWAP about 250 ms to open a ring of the seven weapons at the button;
  drag to a slice, lift to choose (name shown in the middle and toasted).
  Dead zone 24 px keeps the weapon, dragging past 128 px and lifting
  cancels. A tap under 250 ms cycles as before (now on finger lift). Opening
  the wheel cancels an aimed throw. Closed by blur, hidden, mode change and
  pause (`releaseAll`). `src/ui/wheel.js` (pure maths, placement clear of
  FIRE and pause), `touch.js` (`pointer` hook in `registerAction`,
  `setWeaponPicker`), `combat.pickWeapon`, `combathud.js`, styles,
  `test/wheel.test.js`. Docs in docs/UI.md.
- Screenshots: docs/preview/weapon-wheel-*.png (`node scripts/wheel-shots.mjs`).

## 2026-11-20: Miami map, milestone 1 (core crop)
- `?map=miami` plays a core crop of real Miami (OpenStreetMap, ODbL):
  Downtown, Brickell, Overtown, Edgewater, Wynwood south, Watson, Star,
  Palm and Hibiscus Islands, west PortMiami, plus the invented Gullwing
  Airfield islet on a causeway from NE 26th Street. Real streets,
  buildings with heights, water, coastline, parks; traffic, police, peds,
  parked cars, boats and aircraft work. The procedural island stays the
  default. Races, secrets and stunt ramps are off on Miami (milestone 2).
- New: `src/world/miami.js`, `src/world/miami-spots.js`,
  `src/world/maps.js`, `test/miami.test.js`, `scripts/miami-shots.mjs`.
  The map data loads as a separate chunk (esbuild code splitting), so the
  default `game.js` did not grow. Saved positions are clamped at 6 km
  (was 3 km). Details and deviations: docs/MAP.md, "Milestone 1: done".

## 2026-11-20: night lighting rework
- Lit windows (`src/render/nightlights.js`, `textures.js`): the facade
  shaders decide per window, from a seeded hash of building, floor and
  window, whether the room is lit and which of eight rooms shows (warm
  room, warm or cool blinds, cool office, curtains, ceiling lamp, dim
  hall, flickering TV blue), drawn from one shared 256x128 atlas. Offices
  light whole floors, homes window by window. Unlit glass goes dark at
  night. The four 512 px lit-window pictures became 128 px glass masks.
  `buildings.js` adds whole-number UV offsets (no change by day) that
  carry the building and wall number.
- Street lamps: every lamp and floodlight baked once into a 1024 px top
  down light map; ground, kerb, pavement, pier and shopfront shaders add
  it as light on their own colour (warm pools that take the asphalt or
  paving colour, walls catch it near the ground). The old additive pool
  decal is off when the map is in use.
- Car lamps: the player's and the 5 nearest cars light the ground in the
  same shaders: a widening headlight cone and a red tail glow (brighter
  when braking). Red tail glow sprites added. Boats and aircraft keep the
  pool decals. Signs glow brighter at night, shop windows warmer, softer.
- Sky: deeper blue night keys, a warm city glow low on the horizon, fog
  that matches it; less flat night fill (hemi 0.6 -> 0.36, moon 1.5 ->
  1.3), night pavement a little darker. Day unchanged (same screenshots).
- Draw calls (perf.mjs, street view): day 253 -> 253, night 264 -> 264;
  triangles night 451k -> 449k. Programs 84 -> 89, no new program at
  night after warm-up.
- Screenshots: docs/preview/night-before-*.png and night-after-*.png
  (`node scripts/night-shots.mjs <prefix> [views]`).

## 2026-11-20: Miami map, milestone 2 (places and activities)
- On `?map=miami`: all 14 activities (same ids as the island, Miami
  names and routes: Downtown Loop, Calle Ocho Loop, Bay Bridges Rally,
  Causeway Dash, Palm Island Sprint, Venetian Slalom, Fisherman's Channel
  Round, First Feathers, Biscayne Threader, Rooftop Hopper and four
  deliveries), the six secrets and the Ghostwake garage, four street stunt
  ramps plus the two dock ramps, the roof pad, the Cinder tank and three
  port cranes, all from `src/world/miami-spots.js`.
- HUD shows real neighbourhood, bridge and water names (`city.placeOf`,
  names taken from the map data); the HUD sends the district key with
  the name, so the economy's `seen_` flags keep working.
- Tutorial and menu place texts are Miami's on that map; Settings shows
  "Map data (c) OpenStreetMap contributors, ODbL".
- Tests: `test/miami-places.test.js` (courses, secrets, stunts, places,
  HUD names and district flags on Miami). Smoke: a land race, a boat
  course, a sky course and a stunt ramp on Miami. Details and
  deviations: docs/MAP.md, "Milestone 2: done".

## Volume controls
- Settings now has Master, Music, Sound effects and Ambience sliders (each
  with a percent), Mute all, and the Music on/off switch. Effective level
  is master times category (src/audio/levels.js); master 0 or Mute all is
  silent, music included. Routing audited: nothing bypassed the master;
  the world bus no longer follows the effects slider. Tests:
  `test/levels.test.js`, `scripts/volume-test.mjs` (real gains),
  `scripts/menu-test.mjs`. Preview: docs/preview/settings-audio.png.

## People: realistic clothed figures
- `src/render/personbody.js` (new) builds the person body: sculpted
  lofted torso (shoulders, chest, waist, hips wider than the waist),
  deltoids, tapered arms, closed fists with thumbs, thighs thicker than
  calves, trousers with volume and hems, shaped shoes with soles, a neck,
  a head with jaw, eyes (white and iris), brows, nose, mouth and ears,
  hair shells (short, long, bun, cap, beanie) and clothes in volume
  (tee sleeves, collars, open jackets with lapels, hoodie hood and
  pocket, police vest, badge, radio, holster, peaked cap). Smooth normals
  from the surface grid, a little baked shading per vertex.
- `src/render/personmesh.js`: same API and poses; the person now holds
  a THREE.LOD with a near body (about 2.2k to 2.5k triangles) and a far
  body past `PERSON_LOD_M` (40 m, about 600 to 720 triangles), both
  skinned to one skeleton: one draw call per person (plus a held gun).
  Before: about 1.85k triangles at every distance.
- Tests (`test/carmesh.test.js`): the "one skinned mesh" test now
  expects the two LOD bodies on one skeleton (and checks normals); new
  tests for the triangle budget (near 1.5k..2.5k, far coarse) and for
  one visible body per person near and far.
- Screenshots: docs/preview/people-*.png (close day and night, street
  day and night, police, crowd, poses, face, pair), made with
  `node scripts/vehicle-shots.mjs people-close-day ... --size=915x412`.

## 2026-11-22: Miami map, milestone 3 (whole box, default map)
- Miami is now the default map and covers the whole data box (about
  9.0 by 7.8 km: Downtown to Allapattah, Little Havana, The Roads,
  Midtown, the bay islands, Miami Beach bay side, Fisher Island, Virginia
  Key). `?map=island` opens the procedural island.
- New renderer for the real map (`src/render/realcity.js`): far boxes for
  the whole map (one draw call per 1.2 km block, lit windows at night),
  full detail streamed in 300 m tiles round the camera, small stuff
  hidden past 170 m. Spawn street view: 221 draw calls and 311k
  triangles by day (was 312 and 436k on the old core crop).
- Traffic and police neighbour scans use the edge grid; street name
  signs with real names at the major junctions.
- Saves: sessions carry their map; an island save stays on the island
  and a Miami save on Miami (`progress.mapSessions`).
- Details, numbers and deviations: docs/MAP.md, "Milestone 3: done".
  Screenshots: docs/preview/miami-m3-*.png.

## 2026-11-22: Police helicopter fixes (owner report: "messes with everything", horrible lights, cannot see it or interact)
- Causes found (scripts/heli-perf.mjs and a Miami flight run in node):
  - The AI flew into towers: its roof look-ahead sampled 3 points 20+ m
    apart along the wanted path only, so a narrow tower or the way it was
    actually drifting was missed. Over Miami, 4 of 8 three-minute hunts
    ended in a crash (one at 129 m up, 12.7 m/s into a wall, in under
    6 s of game time); the burning wreck then fell into the street.
  - Aircraft were turned back 2.6 km from the origin (the island's size):
    on the 9 by 8 km Miami map a heli sent after a player in the outer
    districts flew in circles 1.6 to 2 km away for minutes. Planes too.
  - It hovered nearly overhead: 35..50 m above the highest roof within
    40 m at 55..70 m out gave a mean elevation of 41..74 deg (50 deg in
    the browser hunt, 168 of 600 steps steeper than 60 deg). It was on
    screen in 0 of 60 sampled frames of a chase.
  - The beam: an additive, double-sided, capped cone of flat colour,
    13% as wide as long, aimed at the player, so the chase camera sat
    inside it and the whole screen was washed every frame, plus a white
    disc on the ground. Night frame with the heli on screen: +23%
    (1795 to 2207 ms in software GL), now +8.5% (1043 to 1132 ms). Draw
    calls +2 by day, +5 at night; no extra lights.
  - It wailed: an AI heli's siren counted as the nearest siren, so the
    siren loop played from the sky and ducked the music for the whole hunt.
  - Navy livery: a dark shape on a dark city and night sky.
  - Pistol and SMG range (45 / 35 m) could never reach it; killing the
    pilot did nothing.
  - Traffic was not affected (same stopped count, 95, and 0 impacts over
    600 steps with and without the heli; traffic ignores craft above 2.5 m).
- Fixes:
  - helipilot.js: look-ahead every 7 m along both the wanted path and the
    actual drift (3 m out first); stand-off 76..106 m, 16..24 m over the
    roofs near the target, further out over tall roofs (never more than
    34 deg up); a moving target gets the heli on station ahead of it and
    to one side (in view of the chase camera), a slow one a slow circle.
    Over Miami: 0 crashes in 8 runs, mean elevation 17..35 deg. Leaving
    when heat drops is unchanged. New `ditch` state: pilot shot dead, it
    settles in one piece and is left empty (ENTER takes it, it flies).
  - aircraft.js: on a map with a land box craft turn back 600 m past the
    box, not 2.6 km from the origin.
  - aircraftmesh.js: white livery with a blue band, blue tail and fin;
    brighter response at night; nav lights and blinking beacons as small
    glows at night; light bar with dark lenses, lit lenses and a small
    fixed-size glow per side, red and blue never together, soft edges
    (no one-frame pops); the beam is now a soft volume (light from how
    close each view ray passes the beam axis, brightest at the lamp, none
    near the camera or at the ground), narrow (4.5% of its length), open
    ended; a small lens glow at the lamp.
  - nightlights.js / graphics.js: the searchlight pool goes into the same
    lamp-light shader as the street lamps (one cone test per pixel, no
    light): a narrow bright pool on the street and on any wall in the cone,
    dim by day.
  - aim.js / combat.js: hand guns reach craft in the air out to 130 m
    (`AIR_REACH`; anything else past the gun's range is still a miss);
    LOCK and assist follow.
  - audio.js: AI aircraft never sound a siren (the light bar still flashes).
  - effects.js: a shot-down craft emits flames on the way down until its
    blast (not visible yet in the screenshots; the smoke trail is).
- Tests: helipilot (open-street orbit ahead of a moving target, pistol at
  90+ m, pilot dies, it lands whole, ENTER finds it, it flies; carjack on
  the ground, not in the air), craftmesh (light bar flashes, beam cone and
  pool data). Screenshots: docs/preview/heli-*.png
  (`node scripts/heli-shots.mjs`), numbers: `node scripts/heli-perf.mjs`.
- Not done: walkers stay at street level, so a heli on a roof pad cannot
  be reached on foot; the beam's shader compiles when the first heli
  appears (one program, not warmed at start); the falling wreck is dark
  and hard to see at night.

## 2026-11-22: Miami street polish (owner report: "very CGA and alpha again")
- Buildings (new src/render/miamilook.js, buildings.js): each Miami
  building gets a look from its neighbourhood and a seeded hash: Brickell
  and Downtown glass towers (teal and blue tints, fins, spandrel ledges,
  setbacks, roof railings, a plant penthouse) and white condo towers
  with a balcony and glass railing on every floor; Little Havana,
  Shenandoah and the like in pastel stucco with a new arched-window
  facade (shutters, sills, balconettes) and terracotta tile copings or
  hipped tile roofs; art-deco pastel blocks on Miami Beach (eyebrow
  ledges, a centre fin over the roof, speed-line bands); port sheds in
  light greys. All get a stone plinth, corner pilasters, string courses
  per floor and an entrance canopy on tall ones. Facades have normal
  maps (recessed windows, sills) and wear in the shader (darker, dirtier
  base, rain streaks under floor lines that fade by 150 m, patchy tone).
  The far blocks use the same colours. The island is unchanged.
- Trees (props.js): Miami street trees are round canopies of many leafy
  clumps (a foliage picture on them), or palms (ringed leaning trunk,
  crown of see-through leafy fronds, two old fronds hanging) in the palm
  neighbourhoods and by the water; extra palms down the avenues there,
  Brickell Avenue, Biscayne Boulevard, Calle Ocho and other named
  boulevards, and along the seawalls (with colliders). Trees stay drawn
  at the middle level (no pop-in at 170 m).
- Ground: edge lines along the kerbs, zebra crossings and stop lines at
  junctions; grass and open land vary in slow lusher and drier patches.
- Sky and sea: deeper blue overhead and a warm haze at the horizon by
  day, with the fog close to it so far towers fade into it
  (daynight.js, colours only); the sea is deeper and greener looking
  down, paler at a glancing view, with slow large patches (water.js,
  shading only; the waves are unchanged).
- Night: the new arched facade lights its windows like the others
  (nightlights.js: one style entry).
- Cost (scripts/perf.mjs, spawn street): day 221 -> 249 draw calls,
  311k -> 489k triangles; night 223 -> 249, 333k -> 491k. Kept in budget
  by merging everything per tile and material (2 new meshes per tile),
  fewer fins and railing panels, balconies on two sides only, no hidden
  balcony tops, and the tile vertex arrays freed once on the GPU.
- Screenshots: docs/preview/miami-polish-*.png (before:
  miami-polish-before-*.png), `node scripts/miami-polish-shots.mjs`.
- Still weak: canopies read as clumps up close; Little Havana has wide
  plain lawns between the street and the buildings; tall towers still
  share one window grid per style.
