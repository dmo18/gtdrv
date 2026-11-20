# Combat interface (actors, weapons, damage)

Cartoon handling, always: hits show sparks, a flash and a knock-down;
a person who is out lies still, then fades. Never blood, gore,
dismemberment or sexual content. Logic lives in src/systems/combat.js
and src/core/weapons.js (pure, node-testable); drawing in
src/render/combatfx.js; buttons in src/ui/touch.js. Fixed 1/60 s steps,
`createRng` only, no allocation per frame (pools, shared payloads).

## Actors
`game.actors` holds every live person. Owners (peds, crew, police,
game for the player) push on spawn and remove on recycle. Fields added
to the existing walker (onfoot.js `createWalker`) and ped (`createPed`):
- `hp`, `maxHp`: player 100, civ 30, crew 60, officer 70.
- `team`: `'player' | 'civ' | 'crew' | 'police'`.
- `life`: `'ok' | 'down' | 'getup' | 'out'`; `lifeT` seconds in it.
- `fade` 0..1 (1 = gone, owner recycles), `hitT` flash timer (0.15 s),
  `kx, kz` knock-back velocity (decays at 6 m/s^2), `lastHitBy`.
- `height` 1.8 (hits test y in 0..height). Existing `x, z, y, heading,
  radius, px, pz` are reused as is. Peds keep `state` for walking AI.
States: hit while ok: `hp -= amount`, `hitT`. hp <= 0, a blast, or a
car at closing speed > 4 m/s: `down` (kx, kz from the push). In
`down`: hp > 0 goes to `getup` after 1.6 s, then `ok` after 0.6 s;
hp <= 0 goes to `out`, lies 3 s, `fade` rises over 1 s. Down and out
actors ignore further hits and do not move by themselves.

## Damage entry point
`damage(game, target, amount, source, kind)`; target is an actor or a
craft; source is an actor, craft or null; kind is `'bullet' | 'melee'
| 'blast' | 'ram' | 'fire'`. Returns the damage applied. Craft:
`health -= amount * MULT[kind]` (bullet 0.5, melee 0.1, blast 1,
ram 1, fire 1), sets `wrecked` at 0. Combat never edits step files.
Events (one shared payload object per name, read it, do not keep it):
- `shot` {shooter, weapon, x,y,z, dx,dy,dz, hx,hy,hz, hitKind:
  'actor'|'craft'|'wall'|'ground'|'none'}: muzzle flash, tracer, sound.
- `hit` {target, source, amount, kind, x,y,z}: sparks, flash, thud.
- `down` {target, source, kind}; `out` {target, source}.
- `explosion` {x,y,z, radius, source, depth}: fireball, shake, boom.
- `burning` {craft, on}: smoke and flames loop on the craft.
- `reload` {actor, weapon}; `weaponSwitch` {actor, weapon}; `empty`.
- `playerDown`, `respawn` {x,z}; `takedown` {target, source, kind}
  (score listens; source is the player or the player's craft).

## Weapons (src/core/weapons.js, invented names)
| id | name | type | dmg | rate/s | spread | range m | mag | reload s | other |
|---|---|---|---|---|---|---|---|---|---|
| wrench | Pipe Wrench | melee | 34 | 1.6 | 60 deg arc | 1.8 | - | - | knock-down on 2nd hit |
| pistol | Pocket Rattler | hitscan | 25 | 4 | 1.5 deg | 45 | 12 | 1.1 | drive-by ok |
| smg | Buzzbox | hitscan | 12 | 12 | 4 deg | 35 | 30 | 1.6 | drive-by ok |
| scatter | Barnyard Thumper | hitscan x8 | 9 | 1.2 | 9 deg | 18 | 6 | 2.2 | pushes back |
| lobber | Gull Lobber | rocket | 100 + blast | 0.6 | 0 | 150 | 1 | 2.0 | 40 m/s, blast r 6 |
| fizz | Fizzpop Can | thrown | blast | 1 | arc | 25 | 1 | 0.8 | fuse 2.2 s, bounces, blast r 5 |
All carried at once, reserves unlimited (magazines only set rhythm).
Auto-reload when empty. Blast damage = 120 x (1 - d/r)^1 for actors,
x 1.5 for craft; actors inside r go `down` regardless.

## Hit detection
- Hitscan: ray from the muzzle (actor y + 1.4, or the craft's window
  side) along aim plus spread from the rng. Walls: `collision.raycast`
  in x,z; it is a wall hit if the ray's y at that distance is below
  `collision.heightAt`. Ground: y <= 0. Actors: 2D segment-circle with
  `radius`, then y within 0..height. Craft: segment-circle with
  `radius`, y within y..y+spec.height. Nearest hit wins.
- Projectiles: pool of 24, stepped each 1/60 s as a segment against the
  same tests. Rockets detonate on any hit or at range; Fizzpop bounces
  (restitution 0.35) and detonates on fuse; sea contact: `splash`, dud.
- Player in a craft is not hit directly; the craft takes the damage.
  A craft exploding with the player in it downs the player.

## Burning and explosions
Craft below 25% health burn (`burning` on): lose 3% of max per s and
explode after 6 s or at 0. Explosion: blast r 8, damage as above,
pushes craft (impulse 12 m/s at centre), sets `wrecked`, dark tint.
Chain: a blast can ignite or explode other craft, depth capped at 2
and at most 3 explosions per 0.5 s (extra ones are queued 0.3 s).
Wrecks are cleared by the existing fleet/traffic cleanup.

## Touch controls (on foot)
Left stick walks (unchanged). Right-side drag turns the camera; the
aim is the camera's centre. Buttons (right thumb, mirrored when
left-handed): FIRE (big; hold = automatic), LOCK (tap toggles lock-on),
SWAP (tap = next weapon; name toast 1 s), RUN and ENTER stay. Tap the
ammo counter to reload early. Keyboard (tests): F fire, Q lock, E swap,
R reload.
Aim assist without lock: shots bend toward the best target inside an
8 deg cone (14 deg within 8 m) and in range with line of sight; drag
speed drops 40% while the crosshair is over a target. Lock-on picks,
in order: actors attacking the player, crew, police, crewed craft;
civilians only if already under the crosshair. Swipe on the drag area
flicks to the next target. Lock breaks after 1.5 s out of range or
sight. Melee needs no aim: it hits the nearest target in its arc.
HUD (combathud.js): crosshair (red over a target, ring when locked),
weapon name and icon, magazine count, a slim health bar; hidden in
craft except during drive-by.

## Drive-by (cars and boats only; aircraft: later list)
In a car or boat a small FIRE button appears above the pedals. While
held: pistol or SMG (the last of the two used) fires toward the
camera's look direction; the camera drag already orbits in chase
view. Auto-aim uses a 20 deg cone, 35 m. Driving stays on the stick
and pedals; firing never steers.

## Camera
Aiming (FIRE held or locked) on foot: over the right shoulder,
distance 3.2 m, offset 0.6 m, FOV 55, eases in 0.2 s; the walker faces
the camera heading and moves at walk speed. Lock-on keeps the target
near centre with a soft follow (time constant 0.25 s). Blasts within
30 m add a short shake scaled by distance.

## Police (police.js)
Heat facts gain: shot fired with a civ within 40 m or seen by police
+0.3; civ hit +0.6; civ down +1; officer hit +1; officer down +1.5;
explosion seen +1; craft destroyed +0.7. Hurting crew adds heat only if
police see it (+0.3). Levels up to 4 (cooldowns 12, 18, 25, 32 s):
1 cars follow (as now); 2 officers step out when close or stopped and
shoot pistols; 3 more cars, ramming, SMGs; 4 roadblocks (two cop cars
across the road graph ahead of the player). Busted or downed: fade,
respawn, heat reset; no fines. The police setting off means no cops.

## Rival crew (crew.js)
States: `patrol` (idle at a hangout or drive using traffic drivers) ->
`alert` (heard a shot within 50 m, or sees a hostile player within
35 m with line of sight) -> `engage` (move to cover: sample 8
directions on a 6 m ring, pick a point whose raycast to the player
hits a wall; shoot bursts of 3 to 5) -> `chase` (player over 30 m away
in a craft: board the nearest crew car and use police `chaseStep`) ->
`flee` (hp under 25%, 25% chance). Hit chance per shot =
0.55 x (1 - d/range) x 1/(1 + playerSpeed/8) x aimRamp (0 to 1 over
0.8 s of aiming) x difficulty (0.8). Misses still draw a tracer near
the player. At most 3 attack slots at once across crew and officers.
Damage to the player x 0.6. Missions mark crew hostile; outside
missions crew are hostile only after the player attacks them.

## Pedestrians (peds.js)
A shot within 40 m or a down within 25 m: `fleeing` from the source
for 6 s (existing state). Hit by a car above 4 m/s: down, damage
4 x closing speed. Out peds fade, then their slot respawns out of view.
Traffic drivers leave burning or shot craft and flee as peds (27).

## Player downed
`playerDown`, 2.5 s down, 1 s fade, `respawn` at the nearest road
node over 60 m from hostiles and police, hp full, heat 0, nothing lost.
During a mission this opens the retry card (MISSIONS.md).
Health regenerates at 10/s after 5 s without damage.

## Caps (phone)
Actors 36 (peds 22, crew 8, officers 4, player); projectiles 24;
live explosions 4; burning craft 4; scorch decals 24 (one instanced
mesh); tracers 32 and sparks in the existing effect pools. combatfx
adds at most 4 draw calls. No per-shot allocation. Target step time
under 2 ms in a 20-actor fight on the phone.

## Sound and effect names
Audio listens to `shot` (by weapon id), `hit` (kind), `down`,
`explosion`, `burning`, `reload`, `empty`, `weaponSwitch`,
`playerDown`. Effects listen to `shot`, `hit`, `explosion`, `burning`,
`down`, `out`. All sounds are generated in code.
