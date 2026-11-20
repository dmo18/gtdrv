# Missions and score interface

All missions are open from the start, in any order; the numbers are
the story order. Nothing is ever lost. Engine: src/systems/missions.js
(pure core, guarded DOM card); content: src/world/missiondata.js
(plain data, no code). Score: src/systems/score.js (pure).

## Mission schema
```
{ id: 'm1', title, giver: 'brine', blurb,      // map and Records text
  start: { at: ANCHOR, radius: 9, on: ['foot','car'] },
  heatCap: 2,                                   // police level limit, 0 = none
  briefing: [{ who: 'brine', text }],           // cards before objective 1
  objectives: [{ type, text, checkpoint: true, timeLimit, spawn: [SPAWN],
                 say: [{ who, text }], ...type params }],
  par: { time: 240, score: 4000 } }             // for the result card
```
ANCHOR is resolved against the seeded city at load, never raw x,z:
`{ district: 'docks', place: 'pier'|'road'|'roof'|'park'|'runway'|
'helipad'|'beach', nth: 0 }`. SPAWN: `{ what: 'crew'|'car'|'boat'|
'plane'|'heli'|'crate', spec, at: ANCHOR, n, tag, hostile, drive:
'flee'|'patrol'|'chase'|'route' }`. Tags let objectives name targets.

## Objective types
- `goto` {at, radius, on?}: reach a place (on foot or in a kind).
- `ride` {kind | spec}: get into a craft (spawned with a tag if needed).
- `chase` {tag, mode: 'catch'|'wreck'|'keepWithin', dist, time}:
  target drives a route; fail if it gets over `lose` m away for 8 s.
- `escape` {heat | tag, dist}: lose the police, or get `dist` from
  tagged pursuers.
- `deliver` {tag?, to, timeLimit, maxDamage}: bring yourself or a
  tagged craft or crate there in time and intact enough.
- `destroy` {tag}: all tagged craft wrecked. `defeat` {tag}: all
  tagged actors out.
- `protect` {tag, until: objective index | time}: tagged actor or
  craft must survive.
- `stunt` {jump: m | airtime: s | drift: points | rings: [ANCHOR]}.
- `survive` {time}. `pickup` {tag}: walk or drive over crates.

## Fail, retry, skip
Fail when: player downed, a `protect` target lost, time out, a chase
target lost, the needed craft left for 20 s. A card shows the reason
with RETRY (default, auto after 4 s) and QUIT. Retry restarts at the
last `checkpoint` objective: despawn mission things, re-run that
objective's spawns onward, put the player at the checkpoint in the
craft it needs. Score from before the checkpoint is kept. After 3 fails
at one checkpoint a SKIP button appears (skipped part scores 0).

## Using what exists
Start zones and markers reuse src/render/markers.js and
`game.map.addMarker` (mission colour `#ff4d6d`, numbered). Activities
hide their starts while a mission runs and a mission cannot start in a
race. Objective text uses the activities panel style; the target arrow
uses the checkpoint marker. Briefing cards: initials in a coloured
circle, name, one or two short lines, tap to advance (auto 4 s);
mid-mission `say` lines appear as a phone ping toast with the sender's
name. Tutorial hints add one combat hint and one mission hint.
Events: `missionStart` {id}, `objective` {id, index}, `missionFail`
{id, reason}, `missionDone` {id, score, time, newBest}.

## Score
`score.add(points, reason, x, z)` is the only way to score. Earn:
- Missions: objective 300 to 800 each, finish 2000, time under par
  +10 points per second saved, no fail +1000.
- Races and courses: gold 3000, silver 2000, bronze 1000, finished 500;
  new best time +500.
- Stunts: airtime in a car 100/s (min 0.5 s), jump distance 10/m;
  drift 50/s (slip > 0.35 above 12 m/s); near miss 150 (passing traffic
  within 1.2 m above 20 m/s); low flying under 15 m above 40 m/s 40/s;
  heli landing on a roof 300.
- Combat: crew takedown 100, officer takedown 0, civilian 0; craft
  destroyed 250 (crew craft 400); chain explosion x2 on that blast;
  several takedowns within 3 s +50 each; escape police 500 x level.
Combo: each scoring event within 4 s of the last adds 0.5 to the
multiplier (x1 to x5). Pending points bank when 4 s pass quietly; a
crash over 8 m/s, being downed or busted loses the pending points.
HUD shows score, pending x combo, and toasts reasons.

Saved (progress version 2): `score: { total, session best,
best: { combo, jump, airtime, drift, nearMiss }, missions: { id:
{ best, time, done } }, courses: { id: best } }`; `medals`, `bestTimes`,
`stats`, `settings` stay. Migration from version 1: drop `money` and
`owned` (everything is free now), add `total = money x 10`, keep
`medals` including the `hint_` flags. Load validates every field
(finite numbers clamped to 0..1e9, known ids only, size caps); a bad
save loads as defaults without crashing.

## The story: "Tide's Out"
The Velvet Anchors, an over-dressed crew of dockside show-offs led by
Marla "Big Tide" Quillon, want to be the only fun on Rustwater. You
side with Auntie Brine (sandwich kiosk, Marrow Street, ex-ferry
captain), Pip Varga (tow-truck mechanic, Cinder Row) and Teodor "Toad"
Lisk (nervous banner pilot, Gullwing Airfield).

1. Crust Fund (foot, car; Fernside to Marrow Street). Anchors pinch
   Brine's sandwich van. Goto the Fernside cul-de-sac, defeat 3 crew
   (wrench or pistol), ride the van, deliver it to the kiosk (damage
   under 50%). Fail: downed, van wrecked. Score: takedowns, combo,
   delivery time.
2. Glitter Grab (car; Glasswell). Steal the Anchors' glitter-cannon
   truck from a Glasswell car park, escape heat 2, deliver to Pip in
   Cinder Row. Fail: truck wrecked. Score: near misses, drift, escape.
3. Saltyard Splash (boat; Saltyard to Pale Shore). Chase an Anchors
   speedboat through the marina, wreck it (ram or shoot), then escape
   two crew boats. Fail: target passes the outer buoys. Score: chase
   time, boat jumps, destroyed craft.
4. Gull Drop (plane; Gullwing, Greenmere, Pale Shore, Glasswell).
   Toad is too scared to fly: take his plane and drop party crates
   through three low rings in 3 minutes. Fail: time out, crash. Score:
   rings, low flying, time under par.
5. Scrapyard Scrap (foot, car; Cinder Row). Protect Pip's tow truck
   while you wreck 5 Anchors cars with the Gull Lobber or by ramming.
   Fail: tow truck wrecked. Score: chain explosions, craft destroyed.
6. Rotor Rumble (heli, foot; Glasswell). Land on a roof to pick up Pip,
   keep within 60 m of the Anchors' getaway van for 45 s, land in
   front of it, defeat its 4 crew. Fail: van lost, downed. Score: roof
   landing, takedowns, time.
7. Fireworks Fiasco (car; Greenmere to Pale Shore). The Anchors lit
   the fireworks truck early. Deliver it to the beach in 90 s while it
   burns (health drains), crew cars chase; the Pale Shore ramp is an
   optional bonus. Fail: truck explodes. Score: jump, near misses,
   seconds to spare.
8. Big Tide (boat, foot, then boat or heli; Pale Shore pier). Boat to
   Marla's pier party, defeat 8 crew in two waves, then chase her yacht
   and wreck it (any boat or heli). She splashes into the sea, shouts
   that this is "not over, probably", and swims off; the fireworks go up
   for you. Fail: downed, yacht reaches the open sea. Score: everything,
   plus finale bonus 5000.
