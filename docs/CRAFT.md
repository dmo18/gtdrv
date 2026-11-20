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
- `x, z` position (metres; x east, z south), `y` height of the craft's
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
  - `city.shoreDist(x, z)`: metres inside the shoreline; positive on
    land (main island, airfield islet, causeway), negative at sea.
  - `city.isGround(x, z)`: true on land or on a pier.
  - `time`: simulated seconds.
- Fixed step dt = 1/60. No allocations in step functions. Never NaN.
- Game logic files must not import three.js or touch the DOM.

Mesh functions (three.js), per kind:
`create<Kind>Mesh(spec, color)` returns a THREE.Group with origin at
the craft's ground-contact centre, nose along local +x, up +y.
`update<Kind>Mesh(mesh, craft, alpha, time)` places it, interpolating
previous to current state. A heading h maps to `rotation.y = -h`.
Use MeshLambertMaterial, vertex colours, merged geometry, shared
module-level material caches (see src/render/vehiclemesh.js).
