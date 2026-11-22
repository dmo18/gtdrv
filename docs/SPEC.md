# Spec: Rustwater (working title)

An original open-world vehicle playground: drive, boat and fly around a
city on the water. Not based on any existing game: own name, characters,
art and missions.

Status of this file: it describes the game the revamp is building
(docs/REVAMP.md). Lines marked (0.4.0) or (0.5.0) are approved targets
that ship with that version; everything else is in the game today. The
design contracts with field names and numbers are in docs/REVAMP.md
section 6; where this file and that section differ, that section wins.

- Player: one person, on a Galaxy S24 Ultra, in Chrome, landscape, touch.
- Runs as a web page (and as an installed app). No account, no network
  after load.
- Maps: the default map is Miami, built from real street data
  (OpenStreetMap, ODbL; the credit "Map data (c) OpenStreetMap
  contributors" must stay visible in the menu and on the title screen).
  Street and neighbourhood names are real. Landmarks and venues have
  invented names wherever a real venue brand would appear; no real brand
  names anywhere. The whole 9.0 by 7.8 km data box is playable. A core of
  5.15 by 4.6 km (Downtown, Brickell, Wynwood, Edgewater, the near bay
  islands) holds the hand-placed content; the rest is dressed by the same
  rules (0.4.0). The classic invented island is kept as a second map,
  chosen in Settings, with no new work.
- Must-haves: a 3D city to roam, many cars, boats and aircraft to hop
  between, traffic and pedestrians, races and stunt challenges on road,
  sea and air, weapons and shootouts, a short story with a rival crew,
  police chases, and high scores.
- No money and no shop. Every vehicle in the world can be taken and
  driven from the start. Exploring is rewarded (0.4.0): garages across
  the map store, swap and repaint cars for free, and adventures (short
  discovery quests) pay score and unlock new garages, three reward cars
  and three extra routes.
- Every open piece of land is a lot with a type (yard, car park, plaza,
  grass, works yard, beach, park, water edge, building site) and is
  dressed for it; no bare paving plains (0.4.0).
- Art: stylised shapes built in code (no downloaded art).
- Sound: generated in code (engine, sirens, impacts). No licensed music.
- Tone: loud, violent sandbox fun. Action violence is allowed: weapons
  and explosions kill people outright, blood is shown (red bursts and
  pools on the ground), and destroyed vehicles explode and break into
  flying parts. A person who is hit falls away from the shot or blast and
  the body stays 30 s; a burnt wreck stays and smokes for 60 s, at most 6
  at once (0.5.0; today bodies and wrecks fade within a few seconds).
  Never dismemberment or sexual content.
- Driving: two modes, Arcade (default) and Sim. Both steer and brake
  accurately and share the same acceleration, top speed, braking and
  steering speed; Sim has less grip and no stability or traction help
  (0.4.0). Four steering styles: wheel, buttons, tilt, slider.
- Carjacking: ENTER on a craft with someone at the controls (under 3 m/s)
  drags the driver out and throws them to the ground; the player drives
  off.
- Starting: the title screen shows a designed street view in Downtown
  with a Start button; Continue resumes the saved place (0.4.0; today
  Play continues from the saved place). Quitting saves the place, the
  craft and up to 8 cars left behind. Settings has New game on its own
  screen with a confirm.
- The player cannot die by default; "Hard: you can die" is a setting.
- Target: smooth play (aim 60 frames per second, never under 30) on the
  phone; all controls usable with two thumbs.

## Garages and adventures (0.4.0)
Contract: docs/REVAMP.md section 6.6. In short:
- Twelve garages on the Miami map, one known from the start (Downtown),
  three revealed only by adventures. A garage shows on the map once the
  player has been within 400 m of it. At a garage: store the car, take
  out any car in the collection (up to 24, shared by all garages),
  repaint, mark one favourite (the car you start in), release a car.
  Everything is free.
- Sixteen adventures: lookouts, clue trails, hidden spots and tours.
  They are found by exploring (a "?" on the map within 300 m), from
  notice boards, from people who talk, and from the "word at the
  garage". Rewards are score (1,000 or 1,500, and 5,000 for all), the
  three hidden garages, three reward cars (Sunchaser, Tidewinder, Night
  Heron) and three extra routes.
- Places come from the city layout and fixed seeds, so they are the same
  on every device. Progress is saved under its own storage key
  (`rustwater.explore.v1`), sanitised field by field.
- The six secrets, the stunt ramps and the 14 courses are unchanged; an
  adventure step may point at a secret or ask for a medal on a ramp.

## Hard mode, respawn and health meter
- Volume (Settings tab): `master` (0..1), `musicVol`, `sfxVol`,
  `ambVol` (0..1, each shown as a percent), `muteAll` (boolean) and the
  existing `music` on/off switch. The last three new keys are optional:
  absent means sfx 100%, ambience 100%, not muted; the sanitiser clamps
  numbers to 0..1 and drops non-numbers. Effective level = master times
  category; Mute all silences everything without moving a slider
  (docs/AUDIO.md).
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

## Hidden secrets and the Ghostwake
- Six secrets are hidden on each map (list and rules in
  `src/world/secrets.js`, found from the city layout with a fixed seed so
  they are in the same places on every device; on Miami their places are
  set in `src/world/miami-spots.js`). On the island they are: a half-sunk shipping
  container off the docks, a rooftop lounge, a sea cave, a rusted
  lighthouse on a headland, a graffiti alley and a playground with a
  one-off ride. None is in the sea or on the airfield islet.
- Finding one: walk, drive, sail or fly within 12 m (the rooftop also needs
  height, about 3.5 m under the roof or more). Once per secret: a toast, 750
  points banked, saved in `progress.secrets.found`.
- Pause menu, Stats: "Secrets found n / 6" and the names found. The map
  shows one faint dot, offset by about 55 m, only after the first find.
- Finding all six unlocks Ghostwake (toast, 2500 bonus points, saved) and
  marks a lock-up garage on the map. A roller door opens when you come near
  and the car is parked inside. Ghostwake is a teal and black coupe with an
  underbody light, top speed about 10 percent above the sports car.
- There is no hidden menu trick any more (the submarine is removed).


## Car radio
In a car or boat the player can switch between four invented stations or
turn the radio off (the default): a RADIO button in the "more" fan and a
"Car radio" row in Settings. The choice is saved in `settings.station`
(only a known id is kept). Stations are fully generated: a chill synth
station, a dance-pop station (118 to 124 BPM), a slow jazz-like station and a
talk station. The talk station has no speech: it plays a jingle, short
vowel-blip texture and songs, and shows the DJ's words (40 funny lines about
the city, plus ads every third song) as captions in a small strip under the
minimap while it plays. Changing station crossfades over 0.6 s; music steps
back under explosions and sirens.

## Weather and driving
Rain lowers grip (down to 72 percent in a downpour), adds slight
understeer, lengthens stops and trims top speed above rain 0.6. Strong wind
(above 5 m/s) gently pushes light cars and boats, at most 0.9 m/s squared.
Thick fog cuts the distance police can spot you to 45 percent.

## Stunt jumps
Six ramps: four on quiet streets (picked from the seeded city, at least
240 m apart, never downtown or on avenues) and two at the airfield dock (a
quay ramp for cars and a floating ramp for boats). Each is a tabletop
(slope up, flat top, slope down) so it works both ways, and shows as a
violet ramp icon on the map. A car or boat that crests the slope faster
than about 23 km/h flies. In the air, brake pulls the nose up into a
backflip and steering rolls; hands off, the nose follows the flight path
and the wings level, so a plain jump lands on its wheels. On landing a
toast shows the ramp name, the medal, the air time and any flips and the
points, which go straight into the score:

    points = 400 per second of air + 10 per metre + 40 per metre of height
             + 700 per flip + 500 per roll   (no score under 0.35 s)
    bronze 450, silver 900, gold 1500

A fast run is silver; add a flip or a roll for gold. Medals are kept per
ramp and only ever go up. A wrecked car, a crash into a wall in the air,
or landing more than 50 degrees off upright (sideways or on the roof)
scores nothing; a bad landing also damages the car. No money.
