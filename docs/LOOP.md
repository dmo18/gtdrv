# The loop (version 0.12.0)

The owner after every version: "The experience is not fun or addicting", "killing and blowing
up is no fun and feels fake". This is the design that was built, with the numbers in the code.
Every element is checked against the standing rules in section h and the screen budget in g.

Files: `src/core/flow.js`, `streetevents.js`, `records.js`, `daily.js`, `custom.js` (pure rules),
`src/world/eventspots.js` (placement), `src/systems/flow.js`, `events.js`, `daily.js`,
`custom.js`, `tutorial.js`, `missions.js` (the host: `game.flow`, `game.streetEvents`,
`game.daily`, `game.custom`), `src/ui/hud.js` (meter, event line), `src/ui/menu.js` (screens).
Play test: `node scripts/loop-test.mjs` (748x360, simulated thumbs, a screenshot per beat).

## a. Flow: the moment-to-moment loop

One run of unbanked points, one multiplier (x1 to x5), one meter toward the next tier.

| source | points (times the multiplier) | meter fill | detected by |
|---|---|---|---|
| Near miss (gap under 1.2 m, over 45 mph, a driven car) | 150 | 0.25 | score.js |
| Head-on miss (the same, the car coming the other way) | 225 | 0.35 | score.js |
| Close shave (a parked car passed flank to flank within 0.6 m, over 45 mph, one per 0.5 s) | 50 | 0.1 | score.js |
| Clean pass (a moving car ahead ends up behind, within 4.2 m to the side, 3 m/s faster, over 27 mph, no contact) | 60 | 0.12 | systems/flow.js |
| Drift (slip over 0.35 above 27 mph, 0.5 s or more) | 50 per second | 0.2 + 0.2 per second | score.js |
| Air (0.5 s or more off the ground), and the jump's length | 100 per second, 10 per meter | 0.3 + 0.15 per second, 0.3 | score.js |
| Speed over 70 mph | 10 every 0.5 s | 0.03 | core/flow.js |
| Takedown (vehicle wrecked 250, rival crew 100 to 400, +50 within 3 s) | 100 to 450 | 0.4 | combat, score.js |
| Chain blast (a blast set off by a blast) | double | 0.6 | combat, score.js |
| Smash (a prop broken by the car), chain within 3 s | 25, +5 per link up to +50 | 0.07 | systems/flow.js |
| Ram (a driven car hit at 11 mph or more by the player, the faster of the two, once per 4 s per car) | 80 | 0.1 | systems/flow.js |
| Escape (lost the police) | 500 per star | 1.0 (a whole tier) | police, score.js |

Rules (all in `src/core/flow.js`, fixed 1/60 s steps):
- Tier up when the meter is full. Tier n to n+1 needs `1 + 0.35 (n - 1)` meter: 1.0, 1.35, 1.7,
  2.05 (four near misses reach x2, about sixteen in a row reach x5). After a tier up the meter
  starts at 0.3 plus the overflow. One source fills at most 0.8 (an escape 1.0).
- Hold, then decay: after a source the meter holds `3.2 - 0.4 (n - 1)` s (3.2 s at x1, 1.6 s at
  x5), then drains `0.18 + 0.05 (n - 1)` per second (0.18 at x1, 0.38 at x5). Over 50 mph the
  drain is halved; in the air it stops. An empty meter costs one tier and refills to 0.5.
- Bank it: standing still (under 2 mph) for 0.7 s with no stars banks the run into the score,
  plus 10 percent of the run per tier above x1 (x5: +40 percent), and resets to x1. Finishing
  a street event banks the same way. A flow gone cold (x1, empty, 4 s) banks without the bonus.
  No bank while wanted, during an event, or in the air.
- Hard crash (an impact over 18 mph that takes away more than 45 percent of the speed, the car
  moving at over 9 mph before it; a car into one standing still is no crash): two
  tiers and 20 percent of the unbanked run, once per second at most. Wrecked, pulled over or
  downed: the whole unbanked run. The banked score is never touched.
- Caps: 20,000 per source before the multiplier, 1,000,000 per run.

Juice (`src/systems/flow.js`; off under Reduce motion except the text and the sound):

| moment | callout (top stack, row 2) | sound (existing) | camera or time |
|---|---|---|---|
| Near miss | "Near miss x3  +300  x2" | checkpoint ping | kick 5.5 |
| Head-on miss | "Head-on miss  +225" | checkpoint ping | kick 8, 2 frame hold |
| Close shave, clean pass | "Close shave  +50", "Clean pass  +60" | UI click | kick 4.5, 3.5 |
| Drift, air | "Drift 2.1 s  +105", "Air 1.4 s  +140" | click, ping | kick 4, kick 7 |
| Smash, ram | "Smash x4  +40", "Ram  +80" | the prop's and the crash's own | kick 4, 2 frame hold |
| Takedown | "Wrecked  +250" | the blast (combat) | kick 6, combat's 4 frame hold |
| Escape | "Escaped  +1,000" | chime | 3 frame hold |
| Tier up | "FLOW x3" | its own bigger chime (`chimeTier`: a low thump and a four-note rise, a whole tone higher per tier; 0.13.0) | kick 8, 2 frame hold, edge flash in the tier color |
| Bank | "Banked  4,620  (x3 bonus)" or "Best flow run!  4,620" | chime | 3 frame hold, green edge flash |
| Crash, wipe | "Crash  -840", "Run lost  -4,200" | fail tone | red edge flash |

Kicks are `chase.kick` strengths (a closing speed in m/s); holds are `loop.hold` frames (4 at
most). The meter pops (scale 1.16, 0.22 s) on every source and harder (1.45, 0.4 s) on a tier
up, a bank and a crash.

## b. Street events

Six templates, 30 gates in every region (quota: 6 speed traps, 6 near-miss runs, 4 jumps, 6 rush
drops, 3 heat escapes, 5 wrecking sprees; never under 20), placed by `placeEvents(city)` from
seed 41077 on named streets: 150 m inside the region, on land, 170 m from any other gate, 420 m
from a gate of the same template, clear of garages, travel pads and the old ramps. A gate is two
posts and a beam across the street with a see-through curtain in the template's color (three
instanced draws for all of them). Driving through it the right way at 7 mph or more starts the
event at once: no menu, no countdown, no card. The wrong way says "Wrong way: turn around, then
drive through." (the play test showed the player is then on the near side, facing away). A gate the GPS leads to is approached from 18 m behind it, in the lane, and the route
arrives the gate's way (0.13.0, core/route.js `search(..., arrive)`): it never drives the gate's
street back through the gate, and turns round at a dead end if that is the only way in. The first
heat escape and the first jump face away from the start place, so the natural way there is from behind.

| template (color) | rule | value | bronze / silver / gold | limit |
|---|---|---|---|---|
| Speed trap (yellow) | a white line 260 to 420 m down the same straight street | mph at the line | 62 / 78 / 92 percent of `min(94 mph, sqrt(13^2 + 2 x 2.6 x run))` | 30 s |
| Near-miss run (blue) | main roads; near misses, head-on misses, clean passes and close shaves count 1 each | passes | gold `round(45 x 0.16 x busy)`, silver 65, bronze 40 percent of gold (7 / 5 / 3 on an avenue) | 45 s, ends at gold |
| Jump (violet) | a ramp 95 m past the gate on a quiet street, 70 m of landing | feet flown | the ballistic distance off the 1.5 m ramp at 58 / 74 / 90 percent of the reference speed (33 m/s cap) | 25 s |
| Rush drop (green) | a point 380 to 760 m of blocks away, GPS turn by turn | seconds | gold `6 + m / 17`, silver x 1.25, bronze x 1.6 | bronze x 1.2, 90 s at most |
| Heat escape (red) | the gate sets 1, 2 or 3 stars | seconds to lose them | out-of-sight time (12, 18, 25 s) + 12 / 26 / 45 s | 90 s |
| Wrecking spree (orange) | streets with sidewalks; a prop 1, a ram 2, a wreck 3 | things smashed | gold `round(40 x 0.3 x dense)` (12), silver 65, bronze 40 percent | 40 s, ends at gold |

Sample (Miami Beach): Ocean Dr near-miss run 2 / 3 / 5; a 420 m trap 61 / 77 / 91 mph; a jump with
a 95 m run-up 52 / 76 / 106 ft; a 600 m drop 0:41 / 0:51 / 1:06 (gold first); two stars 0:30 /
0:44 / 1:03.

While it runs: one line in the prompt strip ("Passes 2/3 · 0:31", "Trap 320 ft · silver 77 mph",
"0:24 · gold 0:41"); a trap shows the next medal above the speed the car is doing, a rush drop
and a heat escape the best medal the clock still allows (gold, then silver, then bronze; 0.13.0), the white trap line or the green drop gate in the world, and for a rush
drop the GPS pill. The result is one line in the top stack ("Silver! 84 mph (gold 91 mph)"), a
chime or the fail tone, a 3 frame hold for a medal and the slow motion beat for gold. Points:
1,000 / 2,000 / 3,000, +500 for a new best; no medal, no points. The flow run is banked.
RETRY (the offer cell above MORE, 9 s) puts the car back 14 to 40 m before the gate, standing
still, traffic on the spot removed, stars cleared: about 3 s from tap to gate. Leaving the car
or wrecking it ends the event. The first gate (a near-miss run with bronze 2) stands 115 m ahead
of the region's start place; the first one-star heat escape and the first jump are within
800 m of it. Jump ramps are added to the stunt system's ramps (they keep their stunt medals; no start pillar
of their own, the gate marks them; every ramp is one vertex-colored draw, so the extra ramps in
view cost no calls: Downtown 209 / 293k, Beach 123 / 241k).

## c. Records

Pause, then the Records tile: two taps from play. One scrolling page:
- 12 tiles: best flow run here and overall, gold / silver / bronze here, event medals, flow
  banked, top multiplier, top speed, longest event jump, close passes, things smashed,
  vehicles driven (of 26), distance here in miles.
- Closest medals: three events (tried without a medal first, then untried, then bronze, then
  silver), each with its best, its next target and a Route button that puts the GPS on the gate.
- By region: gold, silver, bronze, best flow run and miles for the five regions and overall
  (only the region being played is loaded; the others show what the save holds).
- Medals by event: every gate of the region by template with its medal, best value or gold
  target, and Route.

## d. Daily Three

Three of the region's events a day, one easy (trap or jump), one skill (near-miss run or rush
drop), one mayhem (heat escape or wrecking spree), picked by `createRng(day x 2654435761 xor
hash(region))` where day is yyyymmdd of the phone's LOCAL date, read once when the game is
built (`createDaily(game, { now })`, injectable; the simulation never sees a clock). Each has
one twist, the three kinds dealt in a seeded order: a vehicle class (one of 8: "in a Redtail"),
the weather (rain, fog, gray skies), the time of day (midnight, dawn, noon, sunset). Pause,
Daily Three, Go puts the player before the gate in a fresh car of the class, or sets the
weather or the hour: about 5 s from the tap to the run. Finishing it with any medal while the
twist holds ticks it (it also counts when the player gets there on their own). Streak: "Days
played" grows by one on the first daily of a day and never falls or resets; a missed day costs
nothing. No reward is ever withheld for missing days.

## e. The first five minutes

A new game: parked on Ocean Drive (each region's start street). Ocean Drive is one lane between
two rows of parked cars with a traffic light every block, so the first run would be a queue and
a ram: until the first medal, moving traffic 70 to 170 m ahead in the player's lane is taken
away (and the queue at the gate once, as the run starts), and a queue standing 40 to 70 m ahead
at a light goes before the player reaches it. The parked cars stay: they are what the player
passes close. So the run also pays passes on moving cars, three slow cars (6 m/s, 13 mph) are
staged in the lane 50, 90 and 135 m past the gate when the player comes within 45 m of it from
behind (so at least traffic's own 90 m spawn distance ahead) (each approach, a RETRY too); the lane clearing keeps them while they move (0.13.0). Until the police beat a bump or a fast stretch does not call the police (the
first play-through got a star from a bump at 7 s, before anything had explained the police). One line at a time in the top stack, 9 words at most, the GPS on the
beat's gate. Beats wait for what the player does; a beat's line comes again after 35 s without
progress.

| time | beat | line | ends when |
|---|---|---|---|
| 0:00 | run | "Hold GAS. Drive through the blue gate." (115 m ahead) | the near-miss run starts (by 0:20) |
| 0:20 | first run | "Pass cars close: 2 for bronze", then "Pass close. Every pass counts." | a medal on any event; without one: "No medal yet. Tap RETRY." |
| by 2:00 | medal | "First medal! Gates glow on the map." | the line is up |
| 2:10 | police | "Red gate next: it calls the police." (one star, under 800 m) | any escape; "Police! Break their line of sight." on the first star |
| 3:00 | ramp | "You lost them. That pays big.", "Purple gate: hit the ramp fast." | a jump lands; "Brake flips, steer rolls. Land flat." |
| 4:00 | garage | "Last stop: a garage. Paint is free." (the nearest) | within 40 m of it: "You are set. Three dailies wait in Pause." |

Once each, when they first happen: "Flow x2: everything pays double.", "Stop anywhere to bank
your flow." Pause, Skip intro ends it; Pause, Replay intro starts it again from where the
player is. The step is saved. The old one-line control hints for cars wait until it is over.

## f. Customization

Free, no currency, for any car, kept per vehicle class and put on whatever car of that class the
player gets into. Pause, Customize (the menu steps aside to the right 46 percent so the car
shows), and the same screen from a garage's screen.
- Paint: the color it came in, or 16 colors. Finish: gloss, metallic, matte, satin; Pearl at 5
  event medals, Chrome at 15, Candy at 10 golds.
- Wheels (rim finish): factory, black, white, bronze, red; Gold at 10 medals.
- Window tint: clear, light, dark, limo. Decal: none, twin white, twin black, center red, center gold.
The base set (16 + 4 + 5 + 4 + 5 options) is open from the start. A look is a paint code on the
mesh (color, finish, decal); finishes are material numbers and the stripes, the rim tint and
the glass tint are uniforms of the existing shaders: no new shader program, no new draw call.

## g. Screen budget (748x360, "OSD kills the display")

- Flow meter: no new element. It is the old combo pill under the score ("+2,450  x3") with a
  4 px bar along its bottom edge in the tier color; on screens 300 px high or less, where that
  pill is dropped, the same bar runs along the bottom of the score pill.
- Event status: the existing prompt strip. Start, result, intro lines: the existing top stack.
- RETRY: the existing offer cell (BOOST hides while it shows, 9 s). Edge flashes: 0.3 to 0.5 s.
- Nothing new is permanent and nothing enters the keep-out rect. `scripts/ui-test.mjs` checks
  the meter, the event line and RETRY at 915x412, 780x360, 748x360, 748x285 and 690x280.

## h. Checked against the owner's rules

| rule | how it is kept |
|---|---|
| Fun, not points for sale; no money, shop, purchases, ads | points and medals only; every look is free |
| Everything available from the start | all 30 gates, all vehicles, the base looks; three finishes and one wheel open with medals, as the brief allows |
| No network, offline | the daily seed is the local date; nothing is fetched |
| Violence allowed, blood, no dismemberment, no sexual content | takedowns, rams and wrecking pay; nothing new is shown |
| Cannot die by default | a crash costs flow, never the player; Hard is unchanged |
| Original content | invented event and paint names; real street names only as places |

## i. Cut, and why

- Drift zones (the seventh template of the brief): a thumb on glass cannot hold a slide through a
  marked bend; drifts still pay into Flow. Six templates were asked for.
- Missions, money, shop, unlock trees: against the standing rules (PLAN_V3 2.9 item 7).
- A result card and a countdown for street events: they cover the view and slow the retry.
- Weekly challenge, online boards: scope, and no network.
- New sounds: the brief asks for existing ones; four UI tones carry the loop.
- Wheel shapes: the wheel meshes are shared geometry; looks change the rim finish only.
- Outfits for the character (MARKET.md): not in this brief.
- Per-prop markers for the wrecking spree: every breakable prop counts instead.
