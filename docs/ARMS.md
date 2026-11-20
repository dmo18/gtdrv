# Arms interface (explosives, craft weapons, tank, fighter, police heli, chases)

Extends docs/COMBAT.md and docs/CRAFT.md; same rules: cartoon only (sparks,
flash, knock-down, fade; never blood, gore or dismemberment), fixed 1/60 s
steps, `createRng` only, no allocation per frame, pure logic in node-testable
files, every toy available from the start. All names are invented.

## 1. Grenades and sticky bombs (on foot)
Weapons table rows (src/core/weapons.js; both in the on-foot SWAP cycle):
| id | name | type | blast r | x | rate/s | range m | mag | reload s | other |
|---|---|---|---|---|---|---|---|---|---|
| fizz | Fizzpop Can | thrown | 5 | 1 | 1 | 6..25 | 1 | 0.8 | fuse 2.2 s, bounces 0.35 (as now) |
| sticky | Barnacle Charge | sticky | 6 | 1.4 | 1.5 | 6..18 | 1 | 0.6 | sticks, detonated by button |
`x` is the new per-weapon `blastScale`: blast damage = 120 x scale x
(1 - d/r) for actors, x 1.5 more for craft (COMBAT.md formula, scaled).
- Throw: for `thrown` and `sticky` weapons FIRE no longer fires on press.
  Hold FIRE = aim with a preview arc; release = throw. The finger may slide
  off FIRE to aim (task 26 slide-to-aim). Range follows camera pitch:
  pitch -0.2..0.6 maps linearly to the weapon's range span. Lift the finger
  over the weapon icon (SWAP) to cancel.
- Preview: `game.combat.predictThrow(actor, dx, dy, dz, weaponId, out)` fills
  `out.pts` (caller's Float32Array 3 x 24), `out.n`, landing `out.hx, hy,
  hz`, `out.kind`; same integrator as the projectile step, stops at first
  contact. combatfx draws a dashed line plus a landing ring.
- Sticky: flies like a thrown can; on first contact with ground, wall or a
  craft it stops and sticks (people: it bounces off, never sticks). On a
  craft it stores `craft` and a hull-local offset and rides along; a
  removed craft drops it (fizzles). Pool of 4 placed charges per player
  (`game.combat.stickies`); throwing a 5th detonates the oldest. A charge
  fizzles after 120 s, on player respawn, or 400 m from the player.
- DETONATE button: shown (pulsing) whenever the player owns a placed
  charge, on foot and in every craft mode. Tap = all charges blow, 0.08 s
  apart, through the normal explosion queue and chain cap.
  `game.combat.detonateStickies(owner)` returns the count.
- Caps: 3 thrown cans in flight per player; AI never uses sticky.

## 2. Craft weapons (mounts)
Craft weapons are mounts, not in the on-foot cycle: `MOUNTS` table in
weapons.js, listed per spec as `spec.mounts = ['slot0', 'slot1', 'drop']`
ids. `createCraftArms(spec)` gives `craft.arms = { ids, mag: {}, cool: {},
reloadT: {}, reloading: {} }` (per-mount timers; same rhythm rules:
unlimited reserves, auto-reload when empty). Combat creates it lazily the
first time a craft with `spec.mounts` is used.
| id | name | on | type | dmg | rate/s | spread | range m | mag | reload s | other |
|---|---|---|---|---|---|---|---|---|---|---|
| cannon | Thudder | tank slot0 | shell | 220 + blast r 6 x1.3 | 0.4 | 0.3 deg | 300 | 1 | 2.5 | 90 m/s (AI 45), drop g x 0.3 |
| coax | Rattlecoax | tank slot1 | hitscan | 14 | 10 | 2.5 deg | 60 | 50 | 2.0 | along the gun |
| nosegun | Hailbox | fighter slot0 | hitscan | 18 | 15 | 1.5 deg | 220 | 120 | 2.0 | along the nose |
| chingun | Chatter Pod | police heli slot0 | hitscan | 10 | 8 | 3 deg | 120 | 60 | 2.0 | swivels 40 deg |
| missile | Gullseeker | fighter slot1 | missile | 260 + blast r 7 x1.3 | 1 | 0 | 600 | 2 | 3.0 | 95 m/s, turn 2.4 rad/s, life 6 s |
| bomb | Pelican Drop | fighter drop (6), heavyheli drop (4) | bomb | blast r 11 x1.6 | 3 | - | - | 6 / 4 | 5.0 | ballistic |
API (src/systems/combat.js):
- `fireMount(craft, slot, dx, dy, dz, shooter = null, target = null)`:
  slot 0, 1 or 'drop'. `shooter` is the actor credited (player walker or AI
  object; null = the craft). Returns true when fired. Emits `shot` with the
  mount id as `weapon` (same payload as COMBAT.md) and `launch` for shells,
  missiles and bombs.
- Projectile types added to the pool of 24: `shell` (rocket with drop),
  `missile` (homes on `pr.target`: turns its velocity toward the target's
  centre at most `turn` rad/s; flies straight if no target or the target is
  wrecked; detonates on hit, proximity 2.5 m, or life end), `bomb` (starts
  with the craft's velocity, gravity, detonates on any contact; sea =
  `splash` plus a small water burst, no damage). Per-type live caps:
  missiles 4, bombs 6, shells 4, thrown 6; a full type cap means the
  trigger clicks (no fire, no allocation).
- `predictDrop(craft, out)`: impact point of a bomb released now (same
  integrator), for the HUD ring.
- `spec.armor` (optional): damage multipliers by kind applied in
  `damageCraft` after `CRAFT_MULT`, e.g. `{ bullet: 0.04, melee: 0,
  ram: 0.15, blast: 0.6, fire: 0.3 }`. Missing = 1.
- Own blasts: a blast from the player's own munition hits the player's own
  craft x 0.25 and never downs the player in a craft.
- `playerControls`: in a craft with `spec.mounts`, held `fire` = slot 0,
  `fire2` = slot 1, tapped `drop` = one bomb. Car and boat drive-by as now.

### Seeker and lock-on in flight (src/core/seeker.js, pure)
`createSeeker()`, `stepSeeker(s, craft, candidates, dt, wantCycle)`: looks
in an 18 deg cone around the nose, out to the slot-1 range. Candidate order
as COMBAT.md lock tiers (attackers, crew, police, crewed craft; police
helis count as police; civilian craft only within 4 deg of the nose). A
candidate held in the cone for 0.8 s becomes `locked`; it breaks after
1.0 s outside the cone or line of sight. LOCK tap (task 26's button, same
icon) cycles to the next candidate and restarts the 0.8 s. Missiles fired
while locked home; without a lock they fly straight. Nose and chin guns
bend up to 6 deg (chin gun 40 deg) toward the locked or seeking target.
Events: `lock` {craft, target, state: 'seek'|'locked'|'lost'}.

### Touch in armed aircraft (task 31 builds every craft layout)
Stick (left) and THRUST/BRAKE or UP/DOWN pedals (right) stay as now. An arc
of buttons above the pedals, reachable by the right thumb: GUN (big, hold),
MSL (tap; ring fills while seeking, solid when locked), BOMB (tap; count
pip), LOCK (tap = cycle). Only buttons for the craft's mounts appear.
Police heli adds SIREN (toggles siren and light bar; the car horn action
'horn'). DETONATE joins when charges exist. Left-handed mirrors all.
Fighter keeps thrust when the pedal is released (see 4), so the thumb can
leave THRUST. Keyboard (tests): G fire, Z fire2, B drop, T lock, V
detonate, H horn/siren.
HUD (combathud.js): nose pipper; seeker box shrinking over 0.8 s, red with
LOCK when locked; off-screen arrow to the seeker target; magazine pips and
reload rings. combatfx draws the bomb impact ring in the world.

## 3. Tank: craft kind `tank` (src/entities/tank.js)
Spec table `TANK_SPECS` (ids start at 300000): `rustback` "Rustback":
length 7.2, width 3.6, height 2.6, health 1000, maxSpeed 13 (reverse 5),
accel 3.2, brake 6, turnRate 0.9 rad/s at rest (0.55 at full speed),
traverse 1.6 rad/s, gunPitch -0.14..0.35 rad, mounts ['cannon', 'coax'],
armor `{ bullet: 0.04, melee: 0, ram: 0.15, blast: 0.6, fire: 0.3 }`,
colors sand 0xb9a77a, slate 0x5d6670, moss 0x5e6b45, rust 0x8a4b32; police
livery: slate with white band. Shared fields as CRAFT.md (y 0, pitch and
roll small visual sway) plus:
- `turretYaw` (rad, relative to hull), `gunPitch`, `pturretYaw`,
  `pgunPitch` (previous, for drawing).
- `aimYaw`, `aimPitch`: wanted world yaw and gun pitch, written by the
  player's aim or an AI before the step; the turret slews toward them at
  `traverse`, the gun at 0.8 rad/s. `aimSet` false = hold current.
- `trackL`, `trackR` (m/s, for animation and sound), `trackPhase` (m),
  `yawRate`, `recoil` 0..1 (decays 3/s), `crewAI` (null or AI object),
  `bailed` (bool). Ammo and reload live in `craft.arms` (section 2).
Physics (`stepTank(t, controls, dt, world)`), controls as CRAFT.md:
`throttle` = forward demand, `brake` = brake, then reverse once stopped,
`steer` = turn demand (right positive). |speed| < 1 m/s and steer = pivot
turn on the spot. No sideways slip: lateral velocity is killed each step
except blast impulses (decay 8 m/s^2). Collides with buildings, trees and
lamps as two circles r = width/2 at +-length/4 (`resolveCircle`, y 1);
the shoreline is a wall (keeps land side, causeway is land). Never NaN.
Crush (`collideTank(t, other)`, pure, called by game.js's pair loop for
any tank pair): tank vs car pushes the car the whole separation (tank
loses 10% speed). Tank above 2 m/s overlapping a car by more than half its
width, car length under 7 m: sets `other.crushedBy = t`; the armor system
applies `damage(car, car.spec.health, t, 'ram')` (wrecked) and sets
`crushed = true` (vehiclemesh squashes the body to 45% height, dark tint).
Longer cars and tanks are only pushed (ram damage 30 per m/s closing).
People: peds.js already records bumps for any craft, so a moving tank
knocks people down through the COMBAT.md ram rule (never crushed, they
tumble aside and get up). Benches and signs have no collision: the tank
rolls through (`crush`, target null). Lamps and trees stay solid (merged
static meshes; flattening them is out of this wave).
Touch (twin-stick): left stick drives tank-relative (up = forward demand,
down = brake/reverse, sideways = turn; pivot when |y| < 0.2). Right half
drag aims: camera yaw and pitch set `aimYaw/aimPitch`, the turret follows
at traverse rate. Buttons: CANNON (big, tap, reload ring), COAX (hold),
LOCK, ENTER, VIEW. Why not car steering: pivot turns and a separate turret
need two analogue axes plus aim; the wheel, tilt and slider styles cannot
pivot, and the right thumb must aim, not pedal. Tanks are slow, so stick
throttle is precise enough.
Aim assist: shots bend to a target in a 6 deg cone; LOCK (COMBAT.md
tiers, 35 deg cone) makes the turret slew by itself, so the right thumb
only taps CANNON. HUD: camera cross (wanted) and gun circle (barrel now)
merge when on target.
Camera (chasecam view `tank`): behind the turret, not the hull: dist 11,
height 4.5, look height 2, FOV 62; VIEW cycles to far (16 m) and gunner
(on the barrel, FOV 50). Drag orbits as for on-foot aiming. Shake on firing.
Entering: ENTER as any craft. Parked tanks sleep like parked cars. A
police tank whose health falls under 35% stops, its crew bail out as two
officers, and it becomes enterable (steal it). Missions may spawn crew
tanks (`SPAWN what: 'tank'`, task 28).
Places (src/world/citygen.js, appended after all rng use, explicit
colours, so the rest of the seeded city is unchanged):
- Ironbank Depot: east end of the Gullwing airfield islet, x from
  islet.x0 + 520 to islet.x1 - 40, z from runway.z1 + 12 to islet.z1 - 24
  (clear of the tower and the Airfield Dock lane). Concrete `apron`
  surface, two hangar sheds (warehouse kind), a small office, blast walls
  as thin buildings h 2.5, a 14 m gate facing west. Holds 2 tanks
  (`city.tankSpots`), 2 fighters and 1 police heli (`aircraftSpots`, spec
  'fighter' and 'patrolheli'). POI `{ type: 'depot', label: 'Ironbank
  Depot' }`; `city.depot` = rect.
- One Rustback in the easternmost Cinder Row open car park (a `lot: true`
  parking spot in the industrial district, chosen by position, not rng);
  parking spots within 6 m of it are removed.
- Police roof pad: `city.roofPads` gets the midtown building with a
  footprint of at least 16 x 16 m and h 12..30 nearest (0, 0); fallback the
  docks helipad. One 'patrolheli' spot on it (y = roof; aircraft `place`
  already lands on roofs).
fleet.js fills `tankSpots` like aircraft spots. Minimap: other tanks a
square with a barrel tick, police helis a flashing rotor dot, depot POI
icon. Audio: rig `tracks`, `shot` cannon boom, `crush`.

## 4. Fighter and police helicopter (src/entities/aircraft.js specs)
- `fighter` "Gannetfang" (plane): length 13.4, span 9.6, height 3.6,
  health 700, maxSpeed 130, stallSpeed 30, thrust 14, maxBank 85 deg,
  maxClimb 70 deg, rollRate 4.6, pitchRate 3.1, turnGain 3.4, hitRadius
  1.9, mounts ['nosegun', 'missile', 'bomb'], armor { bullet: 0.3 },
  `engine: 'turbine'`, colors gull grey 0x9aa3ab, sea blue 0x2f4d6b, sand
  0xc8b88a, night 0x2a2d33. Arcade assists, flags read by stepPlane:
  `noStall: true` (never sets `stalled`; below 1.1 x stallSpeed the nose
  eases down and thrust rises to hold it), `cruise: 0.45` (airborne
  throttle floor when THRUST is released; BRAKE still slows to 1.1 x
  stall), roll levels itself at 1.5 rad/s with the stick centred. Takes off
  in about 3 s on the runway. No ejection (land or crash; a crash downs the
  player, who respawns with nothing lost).
- `patrolheli` "Lampwatch" (heli): length 10.2, rotor 9.6, height 3.2,
  health 360, maxSpeed 46, climbRate 10, accel 10, yawRate 1.6, blades 4,
  mounts ['chingun'], `police: true`, colors navy 0x1d2f52 with white and an
  orange band. `craft.siren` (bool) and `craft.spot` (0..1 beam on,
  automatic at night or while hunting) are fields; SIREN toggles siren.
  Flown by the player like any heli; seen stealing one = heat +1.
- `heavyheli` Oxbarrow gains mounts ['drop'] (4 bombs). Other aircraft
  stay unarmed.
Police heli AI (src/systems/helipilot.js, pure; flies through the real
`stepAircraft` by writing controls): states `arrive` (spawn 350 m out at
80 m, out of view), `orbit` (circle the target at 55..70 m radius, 35..50 m
above the highest roof within 40 m, nose and beam on target), `strafe`
(heat 4+, every 8..12 s a straight pass with 1.2 s bursts), `evade`
(health under 40%: back off to 120 m), `leave` (heat 0 or lost: climb,
fly away, despawn out of view), `crash` (health 0: spin with smoke 3 s,
explode on ground or sea contact). Roof avoidance: sample `heightAt` at
3 points ahead and climb to max + 15 m. Gunner: hit chance 0.25 x (1 -
d/120) x 1/(1 + playerSpeed/10) x aimRamp; never in its first 3 s or at a
downed player. It "calls in" while it sees the player: police get the
position and the heat cooldown does not run. Fallback if real-physics
flying proves unstable: `kinematic: true` AI mode that moves the craft
directly with the same limits.

## 5. Escalating chases (task 34, src/systems/police.js)
Heat 1..5 (MAX_HEAT 5, cooldowns 12, 18, 25, 32, 40 s). Reaching 5: more
points at 4 (two police craft destroyed, or a police heli). Live units:
| level | chase cars | officers | roadblocks | helis | heavy |
|---|---|---|---|---|---|
| 1 | 1 | - | - | - | - |
| 2 | 2 | 2 | - | - | - |
| 3 | 3 | 4 | - | 1 | - |
| 4 | 3 | 4 | 1 (2 cars) | 1 (2 if player airborne or at sea) | - |
| 5 | 3 | 4 | 1 | 2 | 1 police Rustback (land only) |
Caps: police craft 8 live, officers 4, at most one heavy shooter (tank or
strafing heli) firing at a time, three attack slots as COMBAT.md.
- Air and sea: at level 3+, being airborne or at sea no longer pauses heat
  while a heli sees the player; helis follow. Ground units still drop out.
- Heli sight: 160 m with a clear `trace` line. Escape a heli: break line of
  sight in tall streets, outrun it (fighter, fast car), shoot it down
  (2 Gull Lobber rockets, about 6 s of Buzzbox, 1 Gullseeker), or swap
  craft unseen: 4 s unseen in a different craft than last seen makes the
  cooldown run twice as fast.
- Tank (heat 5): drives with police `chaseStep` controls (steer = turn
  demand); armor.js `tankGunnerStep` aims: one shell per 6 s, only with
  line of sight, 1.2 s telegraph (turret on target, red aim line, `aim`
  tone), AI shell speed 45 m/s, never under 15 m (it rams instead), never
  at the player on foot unless the player hurt it. A shell hitting the
  player's craft does at most 45% of that craft's max health. Escape: it
  is slow (13 m/s), cannot go to sea or air; or blow it up (3 charges, 6
  rockets) or wait for its crew to bail and steal it. Heat under 5: it
  drives off and despawns out of view.
- Fun rules: no unavoidable death; downed or busted = fade, respawn at a
  quiet road, heat 0, nothing lost (COMBAT.md). Missions cap heat with
  `heatCap`. Police setting off = no police units of any kind.

## 6. Phone budgets (street view, level 5 on screen)
- Draw calls: baseline 370; whole sandbox under 420. New craft at most 4
  calls near (tank: hull+turret, tracks, lights; heli: body, rotor, light
  bar, beam), 2 beyond 120 m (beam, tracks detail, light bar hidden).
  Fighter 3. combatfx +3 (arc line, instanced rings and blinkers, missile
  trail reuses the smoke pool).
- Triangles: tank 1200..2500, fighter 1000..2000, heli 900..1800; new toys
  add at most 40k per frame.
- Live: actors 36; projectiles 24 (type caps in 2); stickies 4; live
  explosions 4, rate 3 per 0.5 s, queue 8 (a bomb that finds the queue full
  makes a small puff); burning craft 4; police craft 8.
- Step time on the phone: combat + armor + helipilot under 2.5 ms in a
  level-5 chase with 20 actors; whole sim under 4 ms. No new textures, no
  real lights (beam is a fake additive cone plus a ground pool), shadows
  only within 60 m.

## 7. Events, sound, effects, meshes
New events (one shared payload each): `launch` {shooter, craft, weapon,
x,y,z} (missile whoosh, shell boom, bomb release clunk); `bombFall`
{index, x,y,z, vy} (whistle, falling pitch); `lock` (tones); `sticky`
{x,y,z, on} (beep, blinking light); `detonate` {count} (click); `crush`
{tank, target, x,z} (crunch, sparks); `aim` {craft, target} (tank
telegraph tone and line); `siren` {craft, on}. `explosion` gains `size`
('small' r < 7, 'big' r < 10, 'huge'), driving boom, shake and fireball.
Engine loops by `spec.engine`: 'tracks' (diesel rumble by track speed,
clank pulses, pivot squeal), 'turbine' (whine, afterburner roar above
throttle 0.9); helis keep the rotor rig, the police heli adds the siren
loop. All generated in code (audio.js, banks.js).
Meshes: original low-poly, CRAFT.md origin and axes, shared caches,
vehiclemats.js materials (clearcoat paint for fighter and heli, matte
standard for the tank, rubber tracks, emissive lamps). Rustback: low
wedge hull with side skirts, rounded turret set back, long barrel with a
muzzle collar (separate nodes for turret yaw and gun pitch), tread bands
whose shared-texture offset follows `trackPhase` (no new texture). Gannetfang: single-seat, blended delta wing with forward
canards, twin canted fins, a belly bomb rack shown while bombs remain.
Lampwatch: bubble cockpit, chin pod, skids, light bar on the tail boom,
spotlight cone under the nose. No real-world shapes, markings or names.

## 8. As built by task 31 (plug-in points for tasks 32 and 33)
- Files: `src/core/weapons.js` (`sticky`, `blastScale`, `rangeMin`, `MOUNTS`,
  `createCraftArms`, `mountFor`, `tryMount`, `stepCraftArms`, `mountReload`),
  `src/core/seeker.js`, `src/systems/combat.js`, `src/ui/armsctl.js` (every
  armed-craft button), `src/ui/touch.js` (`slot` option, mode `tank`),
  tests `test/arms.test.js`, `test/seeker.test.js`.
- Slots: slot 0 and 1 are the non-bomb mounts of `spec.mounts` in order;
  'drop' is the bomb mount ('drop' in a mounts list means 'bomb'). Bomb
  magazine: plane 6, heli 4, or `spec.bombs`. `game.combat.armsOf(craft)`
  creates `craft.arms` lazily; combat steps every craft's mount timers.
- Throw: elevation fixed at 0.6 rad (45 degrees would outlast the 2.2 s
  fuse at 25 m); the flat reach follows the aim pitch as in section 1.
  `game.combat.preview` / `dropPreview` hold the live arc and bomb ring.
  Cancel: lift FIRE over SWAP or the more button (input `cancel`), or tap
  SWAP while aiming. AI `fire()` with thrown weapons uses the same rule.
- Craft hooks: `CRAFT_HOOKS` in combat.js, keyed by spec id then kind, are
  registered empty for `tank`, `fighter`, `patrolheli`. Fill any of
  `controls(game, craft, input, dt)` (called each step the player is
  aboard, before firing; the tank turret aim and its LOCK go here),
  `aim(game, craft, slot, mountId, out)` (write the unit fire direction,
  return true), `muzzle(game, craft, slot, mountId, out)` (write the world
  muzzle point, return true), `fired(game, craft, slot, mountId)`.
  Defaults: aim along the nose (plane pitch; heli 0.12 rad down), bent up
  to `MOUNTS[id].bend` toward the seeker target; muzzle at the nose tip,
  bombs under the belly; no bombs while on the ground or water.
- The seeker runs for the player's armed planes and helis (not tanks).
  Missiles home only when fired while `seeker.state === 'locked'`.
- Touch: plane/heli arc slots `gun`, `msl`, `bomb`, `alock`; tank slots
  `cannon`, `coax`, `tlock` (input `fire`, `fire2`, `lock`); `det`
  (DETONATE, every mode); SIREN (input `horn`) in the more fan for police
  craft. Buttons show only for the craft's mounts. Tank mode: the left
  stick writes throttle (up), brake (down) and steer (sideways); the right
  half drags the camera. Game.js sets the touch mode from `craft.kind`, so
  `kind: 'tank'` needs nothing else. Minimal button budget: 6 at once,
  except the armed-aircraft arc (up to 9: pedals, EXIT, more, pause, GUN,
  MSL, BOMB, LOCK) and DETONATE (+1) while charges exist.
- Extra events: `bounce` {x,y,z, v, weapon} (can or charge bouncing);
  `sticky` also carries `beep` (true for a blink, speeding up from 1.1 s
  to 0.25 s between beeps over 21 s) and `index`; `explosion.puff` marks a
  harmless puff; `siren` from police.js stays a boolean, a craft's SIREN
  sends {craft, on}; `splash` gets a third argument, strength (3 = bomb).
- Not built here (cut for budget): the 'tracks' and 'turbine' engine rigs
  and the two tutorial hints (audio.js, banks.js and tutorial.js are hub
  files: a short follow-up task, not 32 or 33).

## 9. As built by task 33 (fighter, police heli, heli pilot)
- Specs `fighter` (Gannetfang: `noStall`, `cruise`, `autoLevel`, `afterburner`
  flags; `craft.afterburner` 0..1) and `patrolheli` (Lampwatch: `craft.siren`,
  `spotOn` wanted, `spot` 0..1 drawn, `spotAim` + `spotX/Y/Z` aim point);
  Oxbarrow gains mounts ['drop']. Meshes add the afterburner glow, a belly
  rack (hidden when bombs run out), a flashing light bar and a fake beam cone.
- Spots: one fighter on the west apron, one police heli beside the airfield
  pads (citygen, appended, no rng); task 32 adds the depot and roof ones.
- Pilot: `src/systems/helipilot.js` (system `game.helipilot`). Task 34 calls
  `spawnPoliceHeli(game, { target, x, z, y | dist, angle, order, seed })` and
  `setOrder(pilot, 'orbit'|'strafe'|'hover'|'retreat'|'leave'|'land', opts)`;
  reads `pilot.state`, `pilot.sees` (3D line within 160 m), `pilot.dist`; sets
  `pilot.weaponsFree`. Real `stepAircraft` physics (no kinematic fallback was
  needed). Orbit: the nose follows the circle (this heli model cannot crab),
  the beam stays on the target; the gunner fires only on strafe passes.
  The pilot pre-sets `craft.exploded` so combat does not blow the heli up in
  mid-air; it spins down and the pilot calls `combat.explode` on contact.
- Input `spot` (SPOT in the more fan, police helis) via `CRAFT_HOOKS.patrolheli.controls`;
  events `spotlight` (craft, on) and `shockRing` (craft). Over an aircraft arc
  the more fan wraps after 3 items. Sounds: src/audio/turbine.js (`abroar`,
  `spotClick`, `shockThump`); the existing siren loop covers police craft.
