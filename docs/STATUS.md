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
- Score and high scores only. No money, shop or unlocks: every vehicle
  and weapon is available from the start.
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
