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
