# Combat interface (actors, weapons, damage)

Violent but not graphic: hits show sparks, a flash and a small red blood
burst; a person who is killed falls, bleeds a pool onto the ground, lies
still and fades. Blood is allowed; dismemberment and sexual content never.
Destroyed vehicles explode, break into debris chunks and vanish. Logic lives in src/systems/combat.js
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
States: hit while ok: `hp -= amount`, `hitT`. For everyone except the
player a bullet, a blast or a car at closing speed > 4 m/s is lethal in
one hit (hp set to 0, `down`, kx, kz from the push); a wrench kills on
its 2nd hit. Dead means dead: `down` goes to `out` after 1.6 s, the body
lies 3 s, then `fade` rises over 1 s. There is no get-up for anyone but
the player. Down and out actors ignore further hits and do not move by
themselves. The player cannot die (`RULES.invulnerable`) and has
unlimited ammo; with the rule off the player keeps hp, `getup` and
respawn.

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

## Occupants (police cars, police heli)
A craft may carry `occ` (hp per seat, seat 0 = driver) and
`occDown(craft, seat, source, kind)` (set by its owner; police.js sets
both on every patrol, chase and roadblock car and on police helis:
`police.crewUp(craft)`). Rules in `damageCraft`:
- a `bullet` that hits the car at least 30% up its height (the cabin; the
  wheels and engine line do not count) hurts the first live seat by the full
  bullet damage, so a pistol needs 3 hits per officer, a Buzzbox 6;
- a `blast` hurts every live seat for 60% of the craft damage;
- a wreck (`health` 0, or the blast that wrecks it) kills every live seat.
A dead seat calls `occDown`: police.js takes a body actor from a pool of 4
(`police.bodies`, team `police`, state `dead`), places it beside the car (a
helicopter: on the ground below), and hits it with a lethal `damage` of the
same kind, so the normal `hit`, `down`, `takedown`, blood pool, score and
heat (officer down +1.5) all follow. When no seat is left the car goes
`role: 'dead'`, stops and is no longer police business (the chase asks for a
new car, so the force keeps responding). Officers on foot give their seat up
when killed. Actor cap is 40 (36 + the 4 bodies).

## Blast throw
`detonate` throws what it hurts (own RNG stream, never the fight's dice):
- cars (not planes, helis or boats; the player's own craft is never tossed):
  `tvy = (2.5 + 5.5 k) x f` m/s with `k = 1 - d/r`, `f` from mass (tank and
  heavy craft 0.12), so a live car hops up to about 3 m and rocks (`tRoll`,
  `tPitch`) and lands level; the craft that just blew up pops 2 to 3 m and
  a wreck can flip over (half or full turn, `tRollEnd`) and stays flipped
  until removed. `craft.y` carries the height, so hit tests follow;
- people the blast kills get `ky` (3.5 to 12 m/s up), `spinV` and tumble
  as a ragdoll (see "Ragdolls" below), then lie where they land;
- props: combatfx throws up to 5 small chunks from `city.furniture`
  (bins, benches, hydrants) within 1.2 r (the static street meshes stay).
Blast size by craft (`craftBlast`): car 8 (heavy car 9), tank 12 x1.5,
fighter 11 x1.3, other plane 10 x1.3, heli 10 x1.2. `explosion` carries
`radius`, `size`, `scale` and `puff` for audio and effects.

## Ragdolls
`src/core/ragdoll.js` (pure; drawing in `src/render/ragdoll.js`, called by
`layDown`). Knocked down by `blast` or `ram` (never the player, never
bullets or melee): the actor gets a slot from a pool of `RAGDOLL_MAX` = 12;
when all are busy the old fall pose is used. One rigid body (centre at the
hips, 0.9 m) with velocity, yaw, pitch (+PI/2 on the back) and roll,
gravity and a ground clamp at the body's lowest point, one small bounce,
ground friction and a spring that topples it flat; ten limb angles on
under-damped springs lag the spin and get kicked on impact. It settles
`RAG_T` = 0.8 s after first touching down (at most 2 x RAG_T, 3 s overall);
then `ragDone`, `ragYaw`, `ragPitch` keep the lying pose and the slot is
freed. While live it writes `x`, `z` (body centre), `y` (lowest point),
`ky` and `spin`; walls push it back and it stops at the shoreline. Start
spin comes from the push in the body's frame; a blast adds `ky` and spins
it the same way. A car hit (`ram`, RAM_MIN 4 m/s): thrown up
`RAM_THROW_UP + RAM_THROW_PER x speed` (1.2 + 0.32 per m/s, cap 8) with
`RAM_CARRY` = 0.6 of the car's velocity, turning head first over the
bonnet. Own seeded stream (`seed ^ 0x2a6d`). `resetActor` clears it.

## Burning and explosions
Craft below 25% health burn (`burning` on): lose 3% of max per s and
explode after 6 s or at 0. Explosion: blast r 8, damage as above,
pushes craft (impulse 12 m/s at centre), sets `wrecked`, dark tint.
Chain: a blast can ignite or explode other craft, depth capped at 2
and at most 3 explosions per 0.5 s (extra ones are queued 0.3 s).
Wrecks: `explosion` carries the destroyed `craft` (else null). 3 s
(`WRECK_T`) after the blast the hull is removed through
`game.removeVehicle` (so `game.vehicles`, minimap, traffic and parked
spawners stay consistent). If the player is still aboard they are
ejected first, so a removed wreck never leaves them stuck. A wreck that
cannot explode (chain depth cap, tank crush) is removed on the same
timer. Buildings are not destructible. Blasts also throw people in
range outward and kill them.

## Blood and debris (combatfx.js)
- `hit` on a person: 2 to 5 red droplets and one small ground spatter.
- `down` with hp 0: a bigger burst (largest for blasts), a pool decal
  under the body that grows over 1.6 s and fades by 20 s, plus spatters.
- Decals: one instanced mesh, ring buffers of 16 pools and 24 spatters
  (oldest slot is reused). Droplets use the shared particle pools,
  capped by `quality`.
- Wreck debris: one pooled instanced mesh, 48 chunks at most (ring).
  Each wreck throws 6 to 10 boxes (dark metal, vehicle colour, 2 to 3
  tyres for cars) that fly out, tumble, bounce once, shrink and vanish
  within 3.6 s. A flat scorch decal remains.

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

## Explosion look (combatfx.js)
Per blast, from the two shared particle pools (no new draw call): a one
step white flash plus a warm second sprite and a flat ground glow (fake
light, no real light); a layered fireball (hot core, orange body that
cools to red-brown, red billows that fade to black: colour over life via
`tintP`); a fast bright shock ring and a dust ring with a dust skirt;
sparks and glowing embers with gravity; a smoke column that keeps feeding
for 2.4 s plus 0.08 s per metre of radius and lives 6 to 10 s per puff,
growing and thinning; a scorch decal (about 100 s, then 25 s fade, 24
slots). Camera shake `(1 - d/(45 + 5 r))^2 x (12 + 2.6 r)` through
`chase.kick`, off when `settings.reduceMotion` or the OS asks for reduced
motion (the flash also halves). Particle counts scale with `game.quality`.
Missiles leave a white-to-grey trail that lingers 2.4 s with a hot nozzle
and sparks.

## Caps (phone)
Actors 40 (peds 22, crew 8, officers 4, bodies 4, player); projectiles 24;
live explosions 4; burning craft 4; tumbling ragdolls 12; scorch decals 24 (one instanced
mesh); tracers 32 and sparks in the existing effect pools. combatfx
adds at most 4 draw calls. No per-shot allocation. Target step time
under 2 ms in a 20-actor fight on the phone.

## Sound and effect names
Audio listens to `shot` (by weapon id), `hit` (kind), `down`,
`explosion`, `burning`, `reload`, `empty`, `weaponSwitch`,
`playerDown`. Effects listen to `shot`, `hit`, `explosion`, `burning`,
`down`, `out`. All sounds are generated in code.
