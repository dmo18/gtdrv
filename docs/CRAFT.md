# Craft interface (cars, boats, aircraft)

Everything the player can ride is a "craft": a plain state object that
the game keeps in `game.vehicles`. All kinds share these fields so the
game, camera, minimap, audio and AI can treat them alike.

Shared state fields
- `id` unique int. Cars use `nextId` in vehicle.js; boats start at
  100000, aircraft at 200000, so ids never clash.
- `kind`: `'car' | 'boat' | 'plane' | 'heli'`
- `spec`: entry from that kind's SPECS table. Every spec has `id`,
  `label` (invented name, never a real brand or model), `length`,
  `width`, `height`, `health`, `colors`, `maxSpeed` (m/s).
- `x, z` position (meters; x east, z south), `y` height of the craft's
  ground-contact point above ground/sea level (cars: always 0).
- `heading` (0 faces +x; increasing turns toward +z, i.e. clockwise
  seen from above = a right turn), `pitch` (nose up positive, radians),
  `roll` (right side down positive, radians).
- `px, pz, py, pheading, ppitch, proll`: values before the current
  step, for smooth drawing. The step function must set these at its
  start.
- `vx, vz, vy` velocity, `speed` signed forward speed (m/s).
- `throttle, brake` last applied (0..1), `health`, `wrecked` (bool),
  `impact` (closing speed of a collision this step, else 0),
  `driver` (null | 'player' | an AI object), `radius` bounding radius,
  `color` hex.

Step functions: `step<Kind>(craft, controls, dt, world)`
- `controls` (may be null = nobody aboard):
  `{ steer -1..1 (right positive), throttle 0..1, brake 0..1,
     handbrake bool, pitch -1..1 (stick pushed up the screen = +1) }`
- `world = { collision, waterCollision, city, time }`
  - `collision.resolveCircle(x, z, r, y)` pushes a circle out of
    buildings/trees taller than `y`; returns shared
    `{ x, z, nx, nz, hit, depth }`.
  - `collision.heightAt(x, z)` roof height at a point (0 if open).
  - `collision.raycast(x, z, dx, dz, maxDist)`.
  - `waterCollision`: same API, holds piers and buoys (things only
    boats hit).
  - `city.shoreDist(x, z)`: meters inside the shoreline; positive on
    land (main island, airfield islet, causeway), negative at sea.
  - `city.isGround(x, z)`: true on land or on a pier.
  - `time`: simulated seconds.
  - Cars also read `steerMode`: `'proportional'` (the player's input
    object) means steer is a share of the speed-dependent lock; absent
    (AI) means steer x `steerMax / (1 + |speed| / 20)` is the wanted wheel
    angle. Both are clipped to the same lock, which shrinks with speed so
    full input asks for about 0.85 (sim) / all (arcade) of lateral grip.
  - `setHandlingMode('arcade' | 'sim')` / `getHandlingMode()` in
    vehicle.js pick the handling of every car (saved as
    `settings.handling`, applied by economy.applySettings). Arcade has
    about 2.5..2.8 g of lateral grip, more lock (also at speed), quicker
    steering, a yaw-rate assist and a firmer stability assist; braking,
    traction, gears and the AI angle mapping are the same in both. AI
    planners still use the bicycle relation tan(angle) = wheelBase * kappa,
    which arcade follows more closely.
- Fixed step dt = 1/60. No allocations in step functions. Never NaN.

Car-only fields (src/entities/vehicle.js)
- Specs add `drive` (`'fwd' | 'rwd' | 'awd'`), `gears` (4..6), `power`
  (kW), `firstGear` (m/s at the redline in 1st), `cgFront` (front weight
  share). `accel` is informative; `brake` is the pedal's decel request
  (the tires and ABS limit it); `steerMax` is the lock at walking pace.
- `gear`: 0 = reverse, 1..spec.gears forward (automatic, brief torque dip
  while `shiftT > 0`). `rpm`: engine speed as a share of the redline,
  0..1 (idle about 0.14), for the engine sound.
- `steer` smoothed input, `steerAngle` front wheel angle (rad).
- `pitch`/`roll`: body dive/squat and lean from damped springs (visual).
  `suspension` 0..1: extra travel after an impact, decays in ~1 s.
- `slip` 0..1 tire squeal / skid amount, `spin` wheelspin 0..1, `abs`
  true while ABS is working, `accelX`/`accelY` body-frame acceleration.
- Game logic files must not import three.js or touch the DOM.

Mesh functions (three.js), per kind:
`create<Kind>Mesh(spec, color)` returns a THREE.Group with origin at
the craft's ground-contact center, nose along local +x, up +y.
`update<Kind>Mesh(mesh, craft, alpha, time)` places it, interpolating
previous to current state. A heading h maps to `rotation.y = -h`.
Cars: see src/render/vehiclemesh.js. Boats, aircraft and tanks are
built with src/render/hullkit.js (smooth lofts, lathes, airfoil panels,
swept tubes, flat plates; pure shape maths in craftmath.js): one merged,
vertex-colored geometry per part with a surface class (aCls) and a rig
attribute, drawn with one PBR "skin" per craft (vehiclemats class patch
plus a shared triplanar panel / rivet / grime / camo texture). The skin's
vertex shader moves rigged parts from per-craft uniforms (ailerons,
elevators, rudders, flaps, retracting gear, rotor and prop blades, road
wheels, scrolling track links) and hides fired stores, so a near craft is
2..4 draw calls: body, see-through canopy glass, blur disc / spray, plus
the afterburner, light bar and beam where they apply. A THREE.LOD swaps
in a coarse body far away. Wear follows health, wrecks are sooted, hits
flash (`craft.hitT`). `aircraftStats`, `boatStats`, `tankStats` report
triangles; `scripts/craft-shots.mjs` renders close-ups to docs/preview.

## Weather
`stepVehicle` and `stepBoat` read `world.weather` (rain, wind, windDir) when
present; with no weather or clear weather physics is identical to dry.

## Siren and lights (cars)

A car whose spec has `police` or `emergency` gets a SIREN button (touch input
`siren`, on the LOCK rect of docs/REVAMP.md 6.5). Tapping it toggles `v.siren`:
the light bar flashes and the siren loop plays. It starts off and goes off when
the player leaves the car. While it is on and the car moves over 4 m/s, AI cars
ahead pull over and stop (src/core/yield.js) and pedestrians on the road step
to the curb; both carry on shortly after the car has passed.
