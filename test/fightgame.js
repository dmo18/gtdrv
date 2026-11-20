// Test harness for fights (crew, officers, traffic): a small game object
// on the real generated city, or on a flat test yard with chosen boxes.
// Not a test file itself (the runner only picks up *.test.js).
import { generateCity } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { createWalker } from '../src/entities/onfoot.js';
import { createCombat, canBeHit } from '../src/systems/combat.js';
import { createArms } from '../src/core/weapons.js';

export const DT = 1 / 60;

let realCity = null, realCol = null;
export function cityAndCollision() {
  if (!realCity) {
    realCity = generateCity();
    realCol = createCollisionWorld();
    for (const b of realCity.buildings) realCol.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
  }
  return { city: realCity, collision: realCol };
}

// A flat yard: no roads, every point is ground. boxes: [[x0, z0, x1, z1, h]].
export function yard(boxes = []) {
  const collision = createCollisionWorld();
  for (const b of boxes) collision.addBox(b[0], b[1], b[2], b[3], b[4] ?? 3, 'building');
  const nodes = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) nodes.push({ id: nodes.length, x: i * 50, z: j * 50, edges: [] });
  const city = {
    nodes, edges: [], blocks: [], spawn: { x: 0, z: 0, heading: 0 },
    isGround: () => true, shoreDist: () => 500, onRoad: () => false, districtOf: () => 'midtown',
  };
  return { city, collision };
}

export function makeFightGame({ seed = 1, city, collision, px = 0, pz = 0 } = {}) {
  if (!city) ({ city, collision } = cityAndCollision());
  const walker = createWalker(px, pz, 0);
  const vehicles = [];
  const game = {
    city, collision, events: createEvents(), rng: createRng(seed + 7), vehicles, actors: [], time: 0,
    seaY: -0.6,
    world: { collision, city, crafts: vehicles, time: 0 },
    player: { mode: 'foot', vehicle: null, walker, x: px, z: pz, y: 0, heading: 0, health: 100, wanted: 0 },
    progress: { settings: { police: true }, stats: {} },
    toasts: [],
    hud: { toast: (t) => game.toasts.push(t) },
    scoreLog: [],
    score: { add: (pts, why) => { game.scoreLog.push([pts, why]); return pts; } },
    addVehicle(v) {
      vehicles.push(v);
      return v;
    },
    removeVehicle(v) {
      const i = vehicles.indexOf(v);
      if (i >= 0) vehicles.splice(i, 1);
      v.removed = true;
    },
  };
  walker.arms = createArms('pistol');
  createCombat(game, { seed });
  return game;
}

// Keep the player record in step with the walker (game.js does this).
export function syncPlayer(game) {
  const p = game.player;
  if (p.vehicle) {
    p.x = p.vehicle.x;
    p.z = p.vehicle.z;
    p.heading = p.vehicle.heading;
  } else {
    p.x = p.walker.x;
    p.z = p.walker.z;
    p.heading = p.walker.heading;
  }
}

// The player fights back: shoots the nearest visible hostile in range.
export function playerShoots(game, range = 40) {
  const p = game.player, w = p.walker;
  if (p.vehicle || !canBeHit(w)) return null;
  let best = null, bd = range;
  for (const a of game.actors) {
    if (a === w || (a.team !== 'crew' && a.team !== 'police') || !canBeHit(a) || a.fade > 0) continue;
    const d = Math.hypot(a.x - w.x, a.z - w.z);
    if (d < bd && game.collision.lineClear(w.x, w.z, a.x, a.z)) {
      bd = d;
      best = a;
    }
  }
  if (!best) return null;
  const dx = best.x - w.x, dz = best.z - w.z, dy = 1.0 - 1.4;
  w.heading = Math.atan2(dz, dx);
  game.combat.fire(w, dx, dy, dz, null, null);
  return best;
}

// Step everything in game order: systems, then combat (as game.js does).
export function step(game, systems, n = 1, each = null) {
  for (let k = 0; k < n; k++) {
    game.time += DT;
    game.world.time = game.time;
    if (each) each(game, k);
    syncPlayer(game);
    for (const s of systems) s.fixedUpdate(DT);
    game.combat.fixedUpdate(DT);
    syncPlayer(game);
  }
}
