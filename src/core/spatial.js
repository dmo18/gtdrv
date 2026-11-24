// Shared spatial helpers for the systems that keep the world filled around
// the player (docs/PLAN_V2.md 5.3 H1): a uniform grid index over points or
// boxes, so a timer no longer walks a whole-city list, and a per-step spawn
// gate, so no step creates more than a couple of vehicles or people.
// Pure: no three.js, no DOM. Queries allocate nothing (the caller passes
// the output array) and return ids in ascending order, the order a full
// scan of the list would visit them, so results stay deterministic.

const KEY_SPAN = 1 << 15; // cells per axis kept apart in a numeric key

function cellKey(cx, cz) {
  return (cx + (KEY_SPAN >> 1)) * KEY_SPAN + (cz + (KEY_SPAN >> 1));
}

const byNumber = (a, b) => a - b;

// A grid over boxes (a point is a box of zero size). `n` items, `boxOf(i,
// out)` fills out.x0, z0, x1, z1 for item i. Each item is listed in every
// cell its box touches (compact arrays, built once).
export function createGridIndex(n, boxOf, cell = 64) {
  const x0 = new Float64Array(n), z0 = new Float64Array(n), x1 = new Float64Array(n), z1 = new Float64Array(n);
  const B = { x0: 0, z0: 0, x1: 0, z1: 0 };
  const counts = new Map();
  const inv = 1 / cell;
  for (let i = 0; i < n; i++) {
    B.x0 = B.z0 = B.x1 = B.z1 = NaN;
    boxOf(i, B);
    const ax = Math.min(B.x0, B.x1), bx = Math.max(B.x0, B.x1);
    const az = Math.min(B.z0, B.z1), bz = Math.max(B.z0, B.z1);
    x0[i] = ax; z0[i] = az; x1[i] = bx; z1[i] = bz;
    if (!(Number.isFinite(ax) && Number.isFinite(az) && Number.isFinite(bx) && Number.isFinite(bz))) continue;
    for (let cx = Math.floor(ax * inv); cx <= Math.floor(bx * inv); cx++) {
      for (let cz = Math.floor(az * inv); cz <= Math.floor(bz * inv); cz++) {
        const k = cellKey(cx, cz);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }
  // Compact storage: cell key -> [start, count] into one id array.
  const start = new Map();
  let total = 0;
  for (const [k, c] of counts) {
    start.set(k, total);
    total += c;
  }
  const ids = new Int32Array(total);
  const fill = new Map();
  for (let i = 0; i < n; i++) {
    const ax = x0[i], az = z0[i], bx = x1[i], bz = z1[i];
    if (!(Number.isFinite(ax) && Number.isFinite(az) && Number.isFinite(bx) && Number.isFinite(bz))) continue;
    for (let cx = Math.floor(ax * inv); cx <= Math.floor(bx * inv); cx++) {
      for (let cz = Math.floor(az * inv); cz <= Math.floor(bz * inv); cz++) {
        const k = cellKey(cx, cz);
        const f = fill.get(k) || 0;
        ids[start.get(k) + f] = i;
        fill.set(k, f + 1);
      }
    }
  }
  const len = new Map();
  for (const [k, c] of counts) len.set(k, c);
  const stamp = new Int32Array(n);
  let query = 0;

  // Squared distance from (x, z) to the box of item i.
  function dist2(i, x, z) {
    const dx = x < x0[i] ? x0[i] - x : x > x1[i] ? x - x1[i] : 0;
    const dz = z < z0[i] ? z0[i] - z : z > z1[i] ? z - z1[i] : 0;
    return dx * dx + dz * dz;
  }

  // Ids of the items whose box comes within r of (x, z), ascending, into
  // `out` (cleared first). Returns out.
  function near(x, z, r, out) {
    out.length = 0;
    if (!(r >= 0) || !Number.isFinite(x) || !Number.isFinite(z)) return out;
    query++;
    if (query > 0x3fffffff) { stamp.fill(0); query = 1; }
    const r2 = r * r;
    const c0x = Math.floor((x - r) * inv), c1x = Math.floor((x + r) * inv);
    const c0z = Math.floor((z - r) * inv), c1z = Math.floor((z + r) * inv);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = cellKey(cx, cz);
        const s = start.get(k);
        if (s === undefined) continue;
        const e = s + len.get(k);
        for (let j = s; j < e; j++) {
          const i = ids[j];
          if (stamp[i] === query) continue;
          stamp[i] = query;
          if (dist2(i, x, z) <= r2) out.push(i);
        }
      }
    }
    if (out.length > 1) out.sort(byNumber);
    return out;
  }

  // The item nearest (x, z) within maxR that `accept(i)` allows (all when
  // no filter), or -1. Ties go to the lower id. Searches outward in rings.
  function nearest(x, z, maxR, accept) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return -1;
    query++;
    if (query > 0x3fffffff) { stamp.fill(0); query = 1; }
    const ccx = Math.floor(x * inv), ccz = Math.floor(z * inv);
    const rings = Math.ceil((maxR > 0 ? maxR : cell) * inv) + 1;
    let best = -1, bd = maxR > 0 ? maxR * maxR : Infinity;
    for (let ring = 0; ring <= rings; ring++) {
      // Every box not yet seen lies at least (ring - 1) cells away.
      if (best >= 0 && ring > 1 && ((ring - 1) * cell) * ((ring - 1) * cell) > bd) break;
      for (let cx = ccx - ring; cx <= ccx + ring; cx++) {
        const edge = cx === ccx - ring || cx === ccx + ring;
        for (let cz = ccz - ring; cz <= ccz + ring; cz += edge ? 1 : 2 * ring) {
          const k = cellKey(cx, cz);
          const s = start.get(k);
          if (s !== undefined) {
            const e = s + len.get(k);
            for (let j = s; j < e; j++) {
              const i = ids[j];
              if (stamp[i] === query) continue;
              stamp[i] = query;
              const d = dist2(i, x, z);
              if (d < bd || (d === bd && best >= 0 && i < best)) {
                if (accept && !accept(i)) continue;
                bd = d;
                best = i;
              }
            }
          }
          if (ring === 0) break;
        }
      }
    }
    return best;
  }

  return { n, cell, near, nearest, dist2 };
}

// A grid over points: xOf(i), zOf(i).
export function createPointIndex(n, xOf, zOf, cell = 64) {
  return createGridIndex(n, (i, b) => {
    b.x0 = b.x1 = xOf(i);
    b.z0 = b.z1 = zOf(i);
  }, cell);
}

// ---------------------------------------------------------------------------
// Spawn gate: at most SPAWNS_PER_STEP vehicles or people made in one fixed
// step, across every system that shares the game. Each spawning system
// calls beginSpawnStep(game, bit) at the top of its fixedUpdate with its own
// bit (SPAWNER); a new step starts when game.time has moved on or when a
// system that already began comes round again (so a test that calls one
// system on its own, without advancing time, still gets a fresh step each
// call). Deterministic: no wall clock.
// ---------------------------------------------------------------------------
export const SPAWNS_PER_STEP = 2;
// Most live vehicles the ambient spawners (parked, traffic, service homes,
// patrols) fill the world up to (docs/PLAN_V2.md section 4, 0.7.0).
export const LIVE_CAP = 80;
export const SPAWNER = { parked: 1, peds: 2, fleet: 4, traffic: 8, police: 16, crew: 32, service: 64 };

export function spawnGate(game) {
  let g = game && game.spawnGate;
  if (!g) {
    g = { t: NaN, seen: 0, used: 0, max: SPAWNS_PER_STEP, total: 0, steps: 0 };
    if (game) game.spawnGate = g;
  }
  return g;
}

export function beginSpawnStep(game, bit) {
  const g = spawnGate(game);
  const t = game ? game.time : NaN;
  if ((g.seen & bit) || (Number.isFinite(t) && t !== g.t)) {
    g.seen = 0;
    g.used = 0;
    g.steps++;
  }
  g.t = t;
  g.seen |= bit;
  return g;
}

// Spawns still allowed this step.
export function spawnsLeft(game) {
  const g = spawnGate(game);
  return Math.max(0, g.max - g.used);
}

// Take `n` spawns (default 1) when that many are left; true when taken.
export function takeSpawn(game, n = 1) {
  const g = spawnGate(game);
  if (g.used + n > g.max) return false;
  g.used += n;
  g.total += n;
  return true;
}

// Room for another ambient vehicle (below the live cap, less `reserve`).
export function belowLiveCap(game, reserve = 0) {
  const vs = game && game.vehicles;
  return !vs || vs.length < LIVE_CAP - reserve;
}

// ---------------------------------------------------------------------------
// Meshes built ahead: the mesh code caches its geometry per spec, so the
// first craft of a spec is the dear one. A warmer builds one mesh of each
// listed [kind, spec, color] (and throws it away) every `every` steps from
// step `phase` on, so the first real spawn of that spec later costs little.
// Only where the game draws (game.scene and game.kinds); steps are counted,
// never timed. While the title screen is up (game.titleCam.active) it builds
// one a step, so the list is done before Start is tapped instead of over the
// first seconds of play (docs/PERF.md, 0.12.0).
// ---------------------------------------------------------------------------
export function createWarmer(list, every = 6, phase = 2) {
  let n = 0, next = 0;
  return {
    get done() {
      return next >= list.length;
    },
    step(game) {
      if (next >= list.length) return false;
      n++;
      const behindTitle = !!(game && game.titleCam && game.titleCam.active);
      if (n < phase || (!behindTitle && (n - phase) % every !== 0)) return false;
      const kinds = game && game.scene && game.kinds;
      if (!kinds) {
        next = list.length;
        return false;
      }
      const [kind, spec, color] = list[next++];
      const k = kinds[kind];
      if (!k || typeof k.createMesh !== 'function' || !spec) return false;
      k.createMesh(spec, color === undefined ? (spec.colors ? spec.colors[0] : 0x888888) : color);
      return true;
    },
  };
}
