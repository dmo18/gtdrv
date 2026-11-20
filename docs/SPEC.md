# Spec: Rustwater (working title)

An original open-world vehicle playground: drive, boat and fly
around an island. Not based on any
existing game: own name, city, characters, art and missions.

- Player: one person, on a Galaxy S24 Ultra, in Chrome, landscape, touch.
- Runs as a web page. No install, no account, no network after load.
- Must-haves: a 3D island city to roam, many cars, boats and aircraft
  to hop between, traffic and pedestrians, races and stunt challenges
  on road, sea and air, weapons and shootouts, a short story with a
  rival crew, police chases, and high scores. No money, shop or
  unlocks: everything is available from the start.
- Art: stylised low-poly shapes built in code (no downloaded art).
- Sound: generated in code (engine, sirens, impacts). No licensed music.
- Tone: loud, violent sandbox fun. Action violence is allowed: weapons
  and explosions kill people outright (they fall, lie still and fade),
  blood is shown (red bursts and pools on the ground that fade), and
  destroyed vehicles explode, break into flying debris and vanish.
  Never dismemberment or sexual content.
- Carjacking: ENTER on a craft with someone at the controls (under 3 m/s)
  drags the driver out and throws them to the ground; the player drives
  off. Quitting the game saves the place, craft and a garage of up to 8
  left-behind cars; Play continues from there (Settings has New game).
- Target: smooth play (aim 60 frames per second, never under 30) on the
  phone; all controls usable with two thumbs.

## Hard mode, respawn and health meter
- `settings.mortal` (boolean, absent means false; menu: "Hard: you can die").
  `economy.applySettings` sets `RULES.invulnerable = !mortal`. With it on,
  hits hurt the player on foot; hits while aboard hurt the craft, and a
  destroyed craft ejects the player into its blast (existing path). Death
  uses the existing flow: down, fade, `combat.respawn()` to a quiet road
  node with full health.
- RESPAWN (touch "more" fan, input `respawn`, all modes, hard mode or not):
  `game.respawnPlayer()` cancels a carjack, leaves any craft where it is,
  puts the player on foot at `findRescueSpot` beside the craft (on foot: a
  quiet road node), restores hp, clears weapon cooldowns and police heat,
  toast "Respawned". Placement logic: `src/core/health.js`.
- Health meter (`.rw-hpmeter` in the HUD top-left block, display only):
  only in hard mode; red to green by `healthFraction`; "HP n" on foot,
  "CRAFT n" aboard.

## Wanted stars, slow motion, blast camera
- WANTED: the HUD shows 0 to 5 stars only while wanted (heat 1 to 4, fifth
  star when the helicopter is up). From 3 stars they flash red and blue.
  A bar under them fills while the player is out of sight (`heat.cooldown`);
  full means escaped. Heat 4 adds a roadblock and a police helicopter.
- SLOW MOTION: taking out the last enemy within 45 m, blasting a vehicle or
  downing a police officer slows play to 35 percent for 0.8 s (real time),
  at most once per 6 s, with a vignette and a 4 percent zoom. Simulation
  steps stay 1/60 s: `game.timeScale` scales real time into the
  accumulator. Off with the Reduce motion setting.
- BLAST CAMERA: a vehicle exploding within 40 m pulls the chase camera back
  and aside for about 1.5 s, eased; moving the camera cancels it.

