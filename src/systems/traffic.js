// AI traffic: cars that follow the lanes of the road graph, turn at
// junctions, stop for red lights, give way and keep their distance.
//
// The core (createDriver / placeDriver / driveStep) is pure logic and is
// tested in node. createTraffic is the game system that spawns and
// despawns traffic around the player.
//
// Each driver keeps a short local path as a polyline: the lane of the
// edge it is on (A -> B), a curve through the next junction (B -> C) and
// the lane of the following edge (C -> D). When the car gets onto C -> D
// the route moves one hop on and the polyline is rebuilt.
import { lanePoint as lanePointBase, lanesPerDirection, laneOffset, signalState, canDrive } from '../world/citygen.js';
import { createVehicle, steerLock, VEHICLE_SPECS } from '../entities/vehicle.js';
import { beginSpawnStep, takeSpawn, spawnsLeft, belowLiveCap, createWarmer, SPAWNER } from '../core/spatial.js';
import { exitPosition } from '../entities/onfoot.js';
import { clamp, createRng } from '../core/rng.js';
import { createYield, stepYield, curbShift, collectSirens, PULL_SPEED } from '../core/yield.js';
import { pickTrafficService, onCallDraw, TRAFFIC_RULES } from '../entities/servicevehicles.js';
import { stopDistance } from '../world/junctions.js';

// A lane point, on a real map moved with its edge's drawn strip (a one-way
// drawn over another is drawn aside: world/junctions.js `eoff`).
function lanePoint(city, e, from, d, lane, out) {
  lanePointBase(city, e, from, d, lane, out);
  const sh = city.roadGeo ? city.roadGeo.eoff[e.id] : 0;
  if (sh) { out.x -= e.uz * sh; out.z += e.ux * sh; }
  return out;
}

const K = 12; // interior samples of the junction path
const NPTS = K + 4; // A, B, K samples, C, D
const NSEG = NPTS - 1;
const IB = 1;
const IC = K + 2;

const STRAIGHT = 0, RIGHT = 1, LEFT = 2, UTURN = 3;

export const LANE_SPEED = { street: 11, avenue: 16, causeway: 18 };
const TURN_SPEED = [0, 4.5, 5.5, 3.5];
const DECEL = 3; // comfortable deceleration for speed planning (m/s^2)
const STOP_DECEL = 3.5;
const MIN_GAP = 3.5; // standstill gap to the car ahead (m)
const STOPLINE_BACK = 1; // stop line sits this far before the junction box
const LEFT_R = 11; // left turns are wide so opposing left turns pass
// Traffic stays off the airfield causeway for now: where it meets the
// islet, city.shoreDist dips below 2 m and the vehicle's keep-on-land
// push stops cars dead. Raise this once that seam is fixed.
const CAUSEWAY_WEIGHT = 0;

const laneSpeedOf = (e) => (e.causeway ? LANE_SPEED.causeway : e.avenue ? LANE_SPEED.avenue : LANE_SPEED.street);
// Lanes of an edge driven away from node `from` (docs/MAP.md "Edge contract").
const lanesFrom = (e, from) => lanesPerDirection(e, e.a === from);
// A stop sign at node n for traffic arriving on edge e (world/miami.js:
// the minor approaches, or all of them where none is a main road).
const STOP_WAIT = 0.8; // s at a standstill on the line
function stopSignFor(city, n, e) {
  if (!n.stop || n.signal) return false;
  if (!e.avenue) return true;
  for (let i = 0; i < n.edges.length; i++) if (!city.edges[n.edges[i]].avenue) return false;
  return true;
}
const extAt = (node, e) => (e.horizontal ? node.hx : node.hz);
const otherEnd = (e, from) => (e.a === from ? e.b : e.a);

// Scratch objects (no allocations per step).
const LP = { x: 0, z: 0, heading: 0 };
const EXIT = { x: 0, z: 0, ok: false };
const LA = { x: 0, z: 0, ux: 0, uz: 0 };
const PR = { along: 0, lat: 0, ux: 0, uz: 0 };

export function createDriver(city, rng) {
  return {
    city, rng,
    // Stagger offset for the sparse checks; seeded so runs are repeatable.
    id: Math.floor(rng.next() * 1e9),
    speedFactor: rng.range(0.93, 1.04),
    // Route: hop 0 (current), hop 1 (after the next junction), hop 2.
    e0: -1, f0: -1, l0: 0, e1: -1, f1: -1, l1: 0, e2: -1, f2: -1,
    t1: STRAIGHT, t2: STRAIGHT,
    px: new Float64Array(NPTS), pz: new Float64Array(NPTS), cum: new Float64Array(NPTS),
    ux: new Float64Array(NSEG), uz: new Float64Array(NSEG), slen: new Float64Array(NSEG),
    stopS: 0, turnSpeed: 5, rmin: 6,
    seg: 0, s: 0, lat: 0, latAbs: 0,
    tick: 0,
    // Results of the sparse scan.
    obsGap: Infinity, obsSpeed: 0, obsAlong: Infinity, obsVeh: null,
    boxBusy: false, oncoming: false, exitBlocked: false,
    // Timers and state.
    yieldTime: 0, oncomingTime: 0, blockedTime: 0, waitTime: 0, noProgress: 0, nextAround: 6, pause: 0,
    nudge: 0, // small sideways shift away from things beside the lane
    mode: 0, // 0 normal, 1 backing up, 2 steering around
    modeTime: 0, tries: 0, aroundVeh: null, offset: 0, override: 0,
    junctions: 0, targetSpeed: 0, inJunction: false,
    stopDone: false, stopWait: 0, // the stop sign of the junction ahead
    stuck: false, dead: false,
    yld: createYield(), yShift: 0, // giving way to a siren (src/core/yield.js)
  };
}

function turnType(city, ea, fa, eb, fb) {
  const A = city.edges[ea], Bd = city.edges[eb];
  const a0 = city.nodes[fa], a1 = city.nodes[otherEnd(A, fa)];
  const b0 = city.nodes[fb], b1 = city.nodes[otherEnd(Bd, fb)];
  const hx = (a1.x - a0.x) / A.length, hz = (a1.z - a0.z) / A.length;
  const gx = (b1.x - b0.x) / Bd.length, gz = (b1.z - b0.z) / Bd.length;
  const dot = hx * gx + hz * gz;
  if (dot > 0.7) return STRAIGHT;
  if (dot < -0.7) return UTURN;
  return hx * gz - hz * gx > 0 ? RIGHT : LEFT;
}

// Random next edge out of `node`, arriving along `edgeId`. No U-turns
// unless it is a dead end; going straight is a little more likely.
function pickNext(dr, edgeId, nodeId) {
  const city = dr.city;
  const n = city.nodes[nodeId];
  if (n.edges.length <= 1) return edgeId;
  const from = otherEnd(city.edges[edgeId], nodeId);
  let total = 0;
  for (let i = 0; i < n.edges.length; i++) {
    const id = n.edges[i];
    if (id === edgeId) continue;
    total += weightOf(dr, edgeId, from, id, nodeId);
  }
  let r = dr.rng.next() * total;
  let last = edgeId;
  for (let i = 0; i < n.edges.length; i++) {
    const id = n.edges[i];
    if (id === edgeId) continue;
    const w = weightOf(dr, edgeId, from, id, nodeId);
    if (w <= 0) continue;
    last = id;
    r -= w;
    if (r <= 0) return id;
  }
  if (last === edgeId) {
    // Only excluded roads lead on: a legal one anyway (a one-way is never
    // entered against its direction), else back the way it came where
    // that is legal, else anything rather than stand.
    for (let i = 0; i < n.edges.length; i++) if (n.edges[i] !== edgeId && canDrive(city.edges[n.edges[i]], nodeId) && !city.edges[n.edges[i]].causeway) return n.edges[i];
    if (canDrive(city.edges[edgeId], nodeId)) return edgeId;
    for (let i = 0; i < n.edges.length; i++) if (n.edges[i] !== edgeId) return n.edges[i];
  }
  return last;
}

function weightOf(dr, ea, fa, eb, fb) {
  const e = dr.city.edges[eb];
  // One-way streets only along their direction (real traffic keeps the law).
  if (!canDrive(e, fb)) return 0;
  let w = turnType(dr.city, ea, fa, eb, fb) === STRAIGHT ? 1.7 : 1;
  if (e.causeway) w *= CAUSEWAY_WEIGHT;
  return w;
}

// The lane on edge `edgeId` driven away from `from`: lane 0 is the inner
// (left) lane, so left turns and U-turns take it and right turns the
// outer one; straight on keeps the lane it had where it can.
function laneFor(dr, edgeId, from, turnOut, prevLane, prevEdge) {
  const e = dr.city.edges[edgeId];
  const n = lanesFrom(e, from);
  if (n < 2) return 0;
  if (turnOut === RIGHT) return n - 1;
  if (turnOut === LEFT || turnOut === UTURN) return 0;
  if (prevEdge >= 0 && prevLane < n) return prevLane;
  return Math.min(n - 1, Math.floor(dr.rng.next() * n));
}

function setPt(dr, i, x, z) {
  dr.px[i] = x;
  dr.pz[i] = z;
}

// Build the polyline for hops 0 and 1.
function buildPath(dr) {
  const city = dr.city;
  const e0 = city.edges[dr.e0], e1 = city.edges[dr.e1];
  const F = city.nodes[dr.f0], T = city.nodes[dr.f1];
  const N2 = city.nodes[otherEnd(e1, dr.f1)];
  lanePoint(city, e0, dr.f0, Math.min(extAt(F, e0), e0.length * 0.3), dr.l0, LP);
  setPt(dr, 0, LP.x, LP.z);
  lanePoint(city, e0, dr.f0, e0.length - extAt(T, e0), dr.l0, LP);
  let bx = LP.x, bz = LP.z;
  const h0x = Math.cos(LP.heading), h0z = Math.sin(LP.heading);
  lanePoint(city, e1, dr.f1, extAt(T, e1), dr.l1, LP);
  let cx = LP.x, cz = LP.z;
  const h1x = Math.cos(LP.heading), h1z = Math.sin(LP.heading);
  lanePoint(city, e1, dr.f1, e1.length - Math.min(extAt(N2, e1), e1.length * 0.3), dr.l1, LP);
  const dx = LP.x, dz = LP.z;
  const t = dr.t1;
  let back = 0; // how far the curve starts before the box edge

  if (t === UTURN) {
    // Keyhole: tangent out to a circle beyond the node, round it to the
    // left, and tangent back into the opposite lane.
    const R = Math.max(dr.rmin, 7);
    const qx = T.x + h0x * (R * 0.7), qz = T.z + h0z * (R * 0.7);
    const a0 = tangentAngle(bx, bz, qx, qz, R, h0x, h0z, 1);
    const a1 = tangentAngle(cx, cz, qx, qz, R, h0x, h0z, -1);
    // Going left means the position angle decreases.
    let sweep = a0 - a1;
    while (sweep <= 0) sweep += Math.PI * 2;
    for (let i = 0; i < K; i++) {
      const a = a0 - (sweep * i) / (K - 1);
      setPt(dr, IB + 1 + i, qx + Math.cos(a) * R, qz + Math.sin(a) * R);
    }
  } else {
    let k0, k1;
    if (t === STRAIGHT) {
      const L = Math.hypot(cx - bx, cz - bz);
      k0 = k1 = L / 3;
    } else {
      // Corner where the two lane lines meet.
      const wx = cx - bx, wz = cz - bz;
      const den = h0x * h1z - h0z * h1x;
      let dB = (wx * h1z - wz * h1x) / den;
      let dC = (wx * h0z - wz * h0x) / den;
      const rWant = t === LEFT ? Math.max(LEFT_R, dr.rmin, Math.min(dB, dC) * 1.25) : dr.rmin;
      const ox = bx + h0x * dB, oz = bz + h0z * dB; // corner
      if (dB < rWant) {
        back = rWant - dB;
        dB = rWant;
        bx = ox - h0x * dB;
        bz = oz - h0z * dB;
      }
      if (dC < rWant) {
        dC = rWant;
        cx = ox + h1x * dC;
        cz = oz + h1z * dC;
      }
      k0 = 0.5523 * dB;
      k1 = 0.5523 * dC;
    }
    const p1x = bx + h0x * k0, p1z = bz + h0z * k0;
    const p2x = cx - h1x * k1, p2z = cz - h1z * k1;
    for (let i = 0; i < K; i++) {
      const u = (i + 1) / (K + 1), w = 1 - u;
      const b0 = w * w * w, b1 = 3 * w * w * u, b2 = 3 * w * u * u, b3 = u * u * u;
      setPt(dr, IB + 1 + i, b0 * bx + b1 * p1x + b2 * p2x + b3 * cx, b0 * bz + b1 * p1z + b2 * p2z + b3 * cz);
    }
  }
  setPt(dr, IB, bx, bz);
  setPt(dr, IC, cx, cz);
  setPt(dr, IC + 1, dx, dz);
  dr.cum[0] = 0;
  for (let i = 0; i < NSEG; i++) {
    const ex = dr.px[i + 1] - dr.px[i], ez = dr.pz[i + 1] - dr.pz[i];
    const L = Math.hypot(ex, ez);
    dr.slen[i] = L;
    dr.ux[i] = L > 1e-9 ? ex / L : h0x;
    dr.uz[i] = L > 1e-9 ? ez / L : h0z;
    dr.cum[i + 1] = dr.cum[i] + L;
  }
  dr.stopS = dr.cum[IB] + back - STOPLINE_BACK;
  // On a real map, the painted stop bar (world/junctions.js): the car's
  // front stops at it, however far the junction reaches.
  const bar = stopDistance(city, dr.e0, dr.f1);
  if (bar > 0) dr.stopS = Math.min(dr.stopS, dr.cum[IB] + back + extAt(T, e0) - bar);
  const ts = TURN_SPEED[t];
  dr.turnSpeed = t === STRAIGHT ? Math.min(laneSpeedOf(e0), laneSpeedOf(e1)) : ts;
}

// Angle (around q) of the tangent point from p to the circle (q, R) on
// the right (side = 1) or left (side = -1) of direction h.
function tangentAngle(px, pz, qx, qz, R, hx, hz, side) {
  const vx = px - qx, vz = pz - qz;
  const d = Math.max(Math.hypot(vx, vz), R + 0.01);
  const base = Math.atan2(vz, vx);
  const al = Math.acos(R / d);
  const a = base + al, b = base - al;
  // Lateral (right of h) coordinate of each tangent point.
  const ra = -hz * Math.cos(a) + hx * Math.sin(a);
  const rb = -hz * Math.cos(b) + hx * Math.sin(b);
  return (side > 0 ? ra > rb : ra < rb) ? a : b;
}

// Put the driver on edge `edgeId`, driving away from node `from`, `d`
// meters along, in `lane` (-1 = choose). Places `v` there if given.
export function placeDriver(dr, v, edgeId, from, d = 0, lane = -1) {
  const city = dr.city;
  if (v) {
    const s = v.spec;
    const ang = steerLock(s, 5);
    dr.rmin = Math.max(5.5, (1.1 * s.wheelBase) / Math.tan(ang));
  }
  dr.e0 = edgeId;
  dr.f0 = from;
  dr.f1 = otherEnd(city.edges[edgeId], from);
  dr.e1 = pickNext(dr, edgeId, dr.f1);
  dr.t1 = turnType(city, dr.e0, dr.f0, dr.e1, dr.f1);
  dr.l0 = lane >= 0 ? Math.min(lane, lanesFrom(city.edges[edgeId], from) - 1) : laneFor(dr, edgeId, from, dr.t1, 0, -1);
  dr.f2 = otherEnd(city.edges[dr.e1], dr.f1);
  dr.e2 = pickNext(dr, dr.e1, dr.f2);
  dr.t2 = turnType(city, dr.e1, dr.f1, dr.e2, dr.f2);
  dr.l1 = laneFor(dr, dr.e1, dr.f1, dr.t2, dr.l0, dr.e0);
  dr.stopDone = false;
  dr.stopWait = 0;
  buildPath(dr);
  dr.seg = 0;
  dr.mode = 0;
  dr.offset = 0;
  dr.aroundVeh = null;
  dr.obsGap = Infinity;
  dr.obsVeh = null;
  dr.yieldTime = 0;
  dr.oncomingTime = 0;
  if (v) {
    lanePoint(city, city.edges[edgeId], from, d, dr.l0, LP);
    v.x = v.px = LP.x;
    v.z = v.pz = LP.z;
    v.heading = v.pheading = LP.heading;
    project(dr, v.x, v.z);
  }
  return dr;
}

function advance(dr) {
  const city = dr.city;
  dr.e0 = dr.e1;
  dr.f0 = dr.f1;
  dr.l0 = dr.l1;
  dr.t1 = dr.t2;
  dr.e1 = dr.e2;
  dr.f1 = dr.f2;
  dr.f2 = otherEnd(city.edges[dr.e1], dr.f1);
  dr.e2 = pickNext(dr, dr.e1, dr.f2);
  dr.t2 = turnType(city, dr.e1, dr.f1, dr.e2, dr.f2);
  dr.l1 = laneFor(dr, dr.e1, dr.f1, dr.t2, dr.l0, dr.e0);
  dr.stopDone = false;
  dr.stopWait = 0;
  buildPath(dr);
  dr.seg = 0;
  dr.junctions++;
  dr.yieldTime = 0;
  dr.oncomingTime = 0;
  dr.boxBusy = false;
  dr.oncoming = false;
  dr.exitBlocked = false;
}

// Closest point on the polyline near the current segment.
function project(dr, x, z) {
  let best = Infinity, bj = dr.seg, bt = 0;
  const j0 = Math.max(0, dr.seg - 1), j1 = Math.min(NSEG - 1, dr.seg + 3);
  for (let j = j0; j <= j1; j++) {
    const ax = dr.px[j], az = dr.pz[j], ux = dr.ux[j], uz = dr.uz[j];
    let t = (x - ax) * ux + (z - az) * uz;
    if (t < 0) t = 0;
    else if (t > dr.slen[j]) t = dr.slen[j];
    const qx = ax + ux * t - x, qz = az + uz * t - z;
    const d2 = qx * qx + qz * qz;
    if (d2 <= best + 1e-9) {
      best = d2;
      bj = j;
      bt = t;
    }
  }
  dr.seg = bj;
  dr.s = dr.cum[bj] + bt;
  const ux = dr.ux[bj], uz = dr.uz[bj];
  const qx = x - (dr.px[bj] + ux * bt), qz = z - (dr.pz[bj] + uz * bt);
  dr.lat = qx * -uz + qz * ux;
  dr.latAbs = Math.sqrt(best);
}

// Point `sa` meters along the path (extrapolates past the end).
function pointAt(dr, sa, out) {
  let j = dr.seg;
  while (j < NSEG - 1 && dr.cum[j + 1] < sa) j++;
  const t = sa - dr.cum[j];
  out.ux = dr.ux[j];
  out.uz = dr.uz[j];
  out.x = dr.px[j] + out.ux * t;
  out.z = dr.pz[j] + out.uz * t;
  return out;
}

// Project an arbitrary point onto the path ahead of the car, within
// `range` meters. Returns false when it is not near the path ahead.
function projectAhead(dr, x, z, range, out) {
  let best = Infinity;
  const sMax = dr.s + range;
  for (let j = dr.seg; j < NSEG; j++) {
    if (dr.cum[j] > sMax) break;
    const ax = dr.px[j], az = dr.pz[j], ux = dr.ux[j], uz = dr.uz[j];
    let t = (x - ax) * ux + (z - az) * uz;
    if (t < 0) t = 0;
    else if (t > dr.slen[j]) t = dr.slen[j];
    const qx = x - (ax + ux * t), qz = z - (az + uz * t);
    const d2 = qx * qx + qz * qz;
    if (d2 < best) {
      best = d2;
      out.along = dr.cum[j] + t;
      out.lat = qx * -uz + qz * ux;
      out.ux = ux;
      out.uz = uz;
    }
  }
  return best < 64 && out.along <= sMax;
}

// Re-attach to the nearest lane (after being shoved off the route).
// Edges to look at near (x, z): a real map's edge grid (city.edgesNear,
// ids in ascending order, as a full scan would visit them), else every
// edge (null). Grows the radius until something is found.
const NEAR_IDS = [];
const byId = (a, b) => a - b;
export function edgesAround(city, x, z, r, out = NEAR_IDS) {
  if (!city.edgesNear) return null;
  for (let k = 0; k < 3; k++, r *= 4) {
    city.edgesNear(x, z, r, out);
    if (out.length) {
      out.sort(byId);
      return out;
    }
  }
  return null;
}

function attachNearest(dr, v) {
  const city = dr.city;
  let best = Infinity, be = -1, bf = -1, bl = 0;
  const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
  const ids = edgesAround(city, v.x, v.z, 60);
  const n = ids ? ids.length : city.edges.length;
  for (let j = 0; j < n; j++) {
    const i = ids ? ids[j] : j;
    const e = city.edges[i];
    for (let k = 0; k < 2; k++) {
      const from = k ? e.b : e.a;
      const a = city.nodes[from], b = city.nodes[otherEnd(e, from)];
      const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
      const d = clamp((v.x - a.x) * ux + (v.z - a.z) * uz, 0, e.length);
      if (!canDrive(e, from)) continue;
      const lanes = lanesFrom(e, from);
      for (let l = 0; l < lanes; l++) {
        lanePoint(city, e, from, d, l, LP);
        const dist = Math.hypot(v.x - LP.x, v.z - LP.z);
        const cost = dist + 6 * (1 - (fx * ux + fz * uz));
        if (cost < best) {
          best = cost;
          be = i; bf = from; bl = l;
        }
      }
    }
  }
  if (be < 0) return false;
  placeDriver(dr, null, be, bf, 0, bl);
  project(dr, v.x, v.z);
  return true;
}

// The sparse check: obstacles on the path ahead, the junction box, and
// oncoming traffic for a left turn.
function scan(dr, v, ctx) {
  const list = ctx.vehicles;
  const city = dr.city;
  const T = city.nodes[dr.f1];
  const e0 = city.edges[dr.e0];
  const sp = Math.max(0, v.speed);
  const halfL = v.spec.length / 2, halfW = v.spec.width / 2;
  const range = Math.min(70, 10 + halfL + sp * 1.2 + (sp * sp) / (2 * DECEL));
  const r2 = (range + 8) * (range + 8);
  const distLine = dr.stopS - dr.s - halfL;
  const approaching = distLine > -0.5 && distLine < 30;
  const h0x = dr.ux[0], h0z = dr.uz[0];
  // Time to reach the junction box, measured like it is for others below.
  const mtx = v.x - T.x, mtz = v.z - T.z;
  const myDbo = Math.max(0, Math.abs(mtx) - T.hx, Math.abs(mtz) - T.hz);
  const myTime = myDbo / Math.max(sp, 1);
  // Too late to stop comfortably: carry on.
  const committed = distLine < (sp * sp) / (2 * 6);
  let gap = Infinity, gSpeed = 0, gAlong = Infinity, gVeh = null;
  let boxBusy = false, oncoming = false, nudge = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === v || o.removed || (o.y || 0) > 2.5) continue;
    const rx = o.x - v.x, rz = o.z - v.z;
    if (rx * rx + rz * rz > r2 && !approaching) continue;
    const os = o.spec;
    const oL = os ? os.length : 4, oW = os ? os.width : 2;
    if (rx * rx + rz * rz <= r2 && projectAhead(dr, o.x, o.z, range, PR)) {
      const around = o === dr.aroundVeh && dr.mode !== 0;
      const ch = Math.abs(Math.cos(o.heading) * PR.ux + Math.sin(o.heading) * PR.uz);
      const sh = Math.sqrt(Math.max(0, 1 - ch * ch));
      const oHalfL = ch * oL / 2 + sh * oW / 2;
      const oHalfW = sh * oL / 2 + ch * oW / 2;
      // While steering around, the car being passed is judged against
      // where this car really is, and may be approached closer.
      const lat = around ? PR.lat - dr.lat : PR.lat - dr.offset;
      const need = oHalfW + halfW + 0.1;
      // Something just beside the lane (a parked car): edge away from it.
      if (!around && PR.along > dr.s - halfL && PR.along < dr.s + 25 && Math.abs(o.speed) < 1 &&
        Math.abs(lat) >= need && Math.abs(lat) < need + 0.6) {
        const n = (lat > 0 ? -1 : 1) * (need + 0.6 - Math.abs(lat));
        if (Math.abs(n) > Math.abs(nudge)) nudge = n;
      }
      if (Math.abs(lat) < need && PR.along > dr.s + 0.5) {
        let g = PR.along - dr.s - halfL - oHalfL;
        if (around && dr.mode === 2) g += MIN_GAP - 0.8;
        // Deadlock breaker: two cars waiting on each other.
        if (o.ai && o.ai.obsVeh === v && dr.waitTime > 1.5 && o.ai.waitTime > 1.5 && v.id < o.id) {
          dr.override = 2;
        }
        if (dr.override > 0 && o.ai && o.ai.obsVeh === v) g = Infinity;
        if (g < gap) {
          gap = g;
          gSpeed = o.vx * PR.ux + o.vz * PR.uz;
          gAlong = PR.along - oHalfL;
          gVeh = o;
        }
      }
    }
    if (approaching) {
      const tx = o.x - T.x, tz = o.z - T.z;
      const inBox = Math.abs(tx) < T.hx + 0.5 && Math.abs(tz) < T.hz + 0.5;
      // Bend nodes (degree two, real maps) are not junctions: no giving way.
      if (!T.signal && !T.bend) {
        if (inBox) boxBusy = true;
        else if (o.kind === 'car' && Math.abs(o.speed) > 1) {
          // Someone else about to enter first? First come, first served.
          const dbo = Math.max(Math.abs(tx) - T.hx, Math.abs(tz) - T.hz);
          const td = Math.hypot(tx, tz) || 1;
          const closing = -(o.vx * tx + o.vz * tz) / td;
          // Only crossing traffic: same or opposite direction is not a conflict.
          const along = Math.abs(Math.cos(o.heading) * h0x + Math.sin(o.heading) * h0z) > 0.7;
          if (!committed && dbo < 30 && closing > 1 && !along) {
            const oTime = Math.max(0, dbo) / Math.max(closing, 1);
            if (oTime < myTime - 0.3 || (Math.abs(oTime - myTime) <= 0.3 && o.id < v.id)) boxBusy = true;
          }
        }
      }
      if (dr.t1 === LEFT && !T.bend && o.kind === 'car' && !(o.ai && o.ai.t1 === LEFT && o.ai.f1 === dr.f1)) {
        const fo = Math.cos(o.heading) * h0x + Math.sin(o.heading) * h0z;
        const along = tx * h0x + tz * h0z;
        const side = tx * -h0z + tz * h0x; // right of my travel direction
        if (fo < -0.7 && along > -extAt(T, e0) - 1 && along < 50 && side < 0.5 && side > -(e0.width / 2 + 1) &&
          (o.speed > 0.8 || inBox)) oncoming = true;
      }
    }
  }
  dr.obsGap = gap;
  dr.obsSpeed = gSpeed;
  dr.obsAlong = gAlong;
  dr.obsVeh = gVeh;
  dr.boxBusy = boxBusy;
  dr.oncoming = oncoming;
  dr.nudge = nudge;
  // Do not enter the junction when the exit is queued up.
  dr.exitBlocked = gVeh !== null && gAlong > dr.cum[IB] && gSpeed < 1.5 && gAlong < dr.cum[IC] + 2 * halfL + 3;
  // Steering around: done once the obstacle is well behind.
  if (dr.mode === 2 && dr.aroundVeh) {
    const a = dr.aroundVeh;
    const rel = (a.x - v.x) * Math.cos(v.heading) + (a.z - v.z) * Math.sin(v.heading);
    if (a.removed || rel < -(halfL + a.spec.length / 2 + 2)) {
      dr.mode = 0;
      dr.aroundVeh = null;
    }
  }
}

// Fill v.controls for one simulation step.
export function driveStep(dr, v, dt, ctx = {}) {
  let c = v.controls;
  if (!c) c = v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  if (v.wrecked || dr.dead) {
    dr.dead = true;
    c.steer = 0;
    c.throttle = 0;
    c.brake = 0;
    c.handbrake = true;
    return c;
  }
  if (dr.e0 < 0) attachNearest(dr, v);
  if (v.impact > 3) {
    dr.pause = Math.max(dr.pause, 1.2 + dr.rng.next() * 1.5);
    dr.mode = 0;
    dr.aroundVeh = null;
  }
  project(dr, v.x, v.z);
  for (let k = 0; k < 2 && dr.seg >= IC; k++) {
    advance(dr);
    project(dr, v.x, v.z);
  }
  if (dr.latAbs > 9) {
    attachNearest(dr, v);
    if (dr.latAbs > 15) dr.stuck = true;
  }

  const sp = v.speed;
  // Sparse checks, staggered between drivers.
  if ((dr.tick + dr.id) % 3 === 0 && ctx.vehicles) scan(dr, v, ctx);
  else if (dr.obsGap < Infinity) dr.obsGap -= (sp - dr.obsSpeed) * dt;
  dr.tick++;
  if (dr.override > 0) dr.override -= dt;

  const city = dr.city;
  const T = city.nodes[dr.f1];
  const e0 = city.edges[dr.e0];
  const halfL = v.spec.length / 2;
  const s = dr.s;
  dr.inJunction = s > dr.cum[IB] && s < dr.cum[IC];

  // --- Target speed. ---
  let vt = laneSpeedOf(e0) * dr.speedFactor;
  const ts = dr.turnSpeed * (dr.t1 === STRAIGHT ? dr.speedFactor : 1);
  if (s < dr.cum[IB]) vt = Math.min(vt, Math.sqrt(ts * ts + 2 * DECEL * (dr.cum[IB] - s)));
  else if (s < dr.cum[IC]) vt = Math.min(vt, ts);

  // Stop line: lights, giving way, oncoming traffic, queued exit.
  const distLine = dr.stopS - s - halfL;
  let mustStop = false;
  if (distLine > -0.3) {
    const light = signalState(T, e0.horizontal, ctx.time || 0);
    if (light === 'red') mustStop = distLine > (sp * sp) / (2 * 8);
    else if (light === 'amber') mustStop = distLine > (sp * sp) / (2 * 5);
    if (dr.boxBusy && dr.yieldTime < 3) {
      mustStop = true;
      if (sp < 0.5 && distLine < 2) dr.yieldTime += dt;
    }
    if (dr.oncoming && dr.oncomingTime < 8) {
      mustStop = true;
      if (sp < 0.5 && distLine < 2) dr.oncomingTime += dt;
    }
    if (dr.exitBlocked) mustStop = true;
    // A stop sign: a full stop on the line, then on (giving way as above).
    if (!dr.stopDone && stopSignFor(city, T, e0)) {
      if (sp < 0.4 && distLine < 2.5) {
        dr.stopWait += dt;
        if (dr.stopWait >= STOP_WAIT) dr.stopDone = true;
      }
      if (!dr.stopDone) mustStop = true;
    }
  }
  if (mustStop) vt = Math.min(vt, distLine <= 0.3 ? 0 : Math.sqrt(2 * STOP_DECEL * (distLine - 0.3)));

  // A siren vehicle behind or coming: pull over and wait (src/core/yield.js).
  // Never stopped inside a junction, nor when about to enter one at speed.
  const yl = dr.yld;
  stepYield(yl, v, ctx.sirens, dt, dr.id);
  const yFree = dr.mode === 0 && !dr.inJunction;
  const yOn = yl.on && yFree;
  const yStop = yFree && !(sp > 1 && s < dr.cum[IB] && dr.cum[IB] - s - halfL < 14);
  if (yOn) dr.yShift = curbShift(e0.width || 9, laneOffset(e0, dr.l0, dr.f0 === e0.a), v.spec.width / 2, !!e0.avenue && dr.l0 === 0);

  // Car (or anything) ahead on the path.
  let obsLimited = false;
  if (dr.obsGap < Infinity) {
    const u = Math.max(0, dr.obsSpeed);
    const g = dr.obsGap - MIN_GAP;
    const vf = g <= 0 ? 0 : Math.min(Math.sqrt(u * u + 2 * 4 * g), u + 0.7 * g);
    if (vf < vt) {
      vt = vf;
      obsLimited = true;
    }
  }
  if (dr.override > 0) vt = Math.max(Math.min(vt, 1.5), Math.min(1.5, laneSpeedOf(e0)));

  // Pulling over: slow to a walk, stop once at the curb; then wait out the delay.
  const yHold = !yl.on && yl.hold > 0 && yStop;
  if ((yOn && yStop) || yHold) {
    vt = yHold || dr.lat > dr.yShift - 0.35 ? 0 : Math.min(vt, PULL_SPEED);
    dr.blockedTime = 0;
    dr.waitTime = 0;
  }

  // Blocked: wait, back up a little, then try to steer around.
  // Waiting in a queue behind another working driver does not count.
  const ov = dr.obsVeh;
  const queued = ov && ov.ai && !ov.ai.stuck && !ov.ai.dead && ov.ai.mode === 0;
  if (obsLimited && vt < 0.5 && Math.abs(sp) < 0.5) dr.waitTime += dt;
  else dr.waitTime = 0;
  if (obsLimited && vt < 0.5 && Math.abs(sp) < 0.5 && !mustStop && !queued && dr.mode === 0) dr.blockedTime += dt;
  else if (sp > 2 && dr.mode === 0) {
    dr.blockedTime = 0;
    dr.nextAround = 6;
  }
  if (dr.blockedTime > 20) dr.stuck = true;
  // Wants to go but is not getting anywhere (wedged against something).
  if (vt > 3 && Math.abs(sp) < 0.5 && dr.pause <= 0) {
    dr.noProgress += dt;
    if (dr.noProgress > 20) dr.stuck = true;
  } else dr.noProgress = 0;
  if (dr.mode === 0 && dr.blockedTime > dr.nextAround && ov && Math.abs(dr.obsSpeed) < 0.3) {
    dr.mode = 1;
    dr.modeTime = 0;
    dr.aroundVeh = ov;
    dr.tries = 0;
    dr.nextAround = dr.blockedTime + 6;
  }
  dr.modeTime += dt;
  let reverse = false;
  if (dr.mode === 1) {
    if (dr.obsGap > MIN_GAP + 7 || dr.modeTime > 4) {
      dr.mode = 2;
      dr.modeTime = 0;
    } else reverse = true;
  }
  // Wide vehicles keep a little left of the lane center.
  let offTarget = -Math.max(0, v.spec.width / 2 - 0.95) + clamp(dr.nudge, -0.6, 0.6);
  if (yOn) offTarget = Math.max(offTarget, dr.yShift);
  if (dr.mode === 2 || (dr.mode === 1 && dr.tries > 0)) offTarget = -3.5;
  if (dr.mode === 2) {
    vt = Math.min(vt, 3);
    if (Math.abs(sp) < 0.3 && vt < 0.5 && dr.modeTime > 1.5 && dr.tries < 3) {
      // Wedged beside it: back up again and have another go.
      dr.mode = 1;
      dr.modeTime = 0;
      dr.tries++;
    } else if (dr.modeTime > 15) {
      dr.mode = 0;
      dr.aroundVeh = null;
    }
  }
  const rate = dr.mode === 0 && !yOn ? 1.5 : 3;
  dr.offset += clamp(offTarget - dr.offset, -rate * dt, rate * dt);
  if (dr.mode === 0 && dr.offset === 0 && dr.blockedTime === 0) dr.aroundVeh = null;

  if (dr.pause > 0) {
    dr.pause -= dt;
    vt = 0;
  }
  dr.targetSpeed = vt;

  // --- Steering: pure pursuit toward a look-ahead point. ---
  const L = clamp(3.5 + 0.45 * Math.abs(sp), 4.5, 11);
  pointAt(dr, s + L, LA);
  const tx = LA.x - LA.uz * dr.offset, tz = LA.z + LA.ux * dr.offset;
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const dx = tx - v.x, dz = tz - v.z;
  const lx = dx * ch + dz * sh;
  const ly = -dx * sh + dz * ch;
  const spec = v.spec;
  const maxAng = steerLock(spec, sp);
  let steer;
  if (lx < 0.5) steer = ly >= 0 ? 1 : -1;
  else {
    const kappa = (2 * ly) / (lx * lx + ly * ly);
    steer = Math.atan(kappa * spec.wheelBase) / maxAng;
  }
  // Backing up with the wheels turned right swings the nose out left.
  c.steer = clamp(reverse ? 0.6 : steer, -1, 1);

  // --- Pedals. ---
  c.throttle = 0;
  c.brake = 0;
  c.handbrake = false;
  if (reverse) {
    if (sp > 0.3) c.handbrake = true;
    else c.brake = 0.3;
    return c;
  }
  const err = vt - sp;
  if (vt < 0.3 && sp < 1) {
    c.handbrake = true;
  } else if (err > 0.05) {
    c.throttle = clamp(err * 0.4, 0, 1);
  } else if (err < -0.6) {
    // Gain scaled to the car's own brake, so a firm stop asks for the same pedal in every car.
    if (sp > 1) c.brake = clamp(-err * 0.35, 0, 1);
    else c.handbrake = true;
  }
  return c;
}

// --- The game system. ---

// The fleet of docs/FLEET.md by district: SUVs, crossovers and pickups
// about half of the traffic; taxis downtown and at the beach, where
// convertibles and sports cars are common too; box trucks, cargo vans and
// semis in the docks and industrial areas. Buses join on arterials
// (pickBus). Retired and never drawn: the hatchback, the one-box van, the
// cab-over truck (their ids now carry the compact sedan, the cargo van and
// the box truck).
export const MIX = {
  downtown: ['taxi', 'taxi', 'taxi', 'sedan', 'sedan', 'midsize', 'midsize', 'compact', 'suv', 'suv', 'suv', 'suv', 'crossover', 'crossover', 'crossover', 'crossover', 'crewcab', 'crewcab', 'minivan', 'van', 'truck', 'sports'],
  midtown: ['midsize', 'midsize', 'sedan', 'compact', 'taxi', 'suv', 'suv', 'suv', 'crossover', 'crossover', 'crossover', 'crewcab', 'crewcab', 'crewcab', 'minivan', 'minivan', 'van', 'truck', 'muscle', 'convertible'],
  residential: ['midsize', 'midsize', 'compact', 'compact', 'sedan', 'suv', 'suv', 'suv', 'crossover', 'crossover', 'crossover', 'crewcab', 'crewcab', 'pickup', 'minivan', 'minivan', 'muscle', 'convertible', 'van', 'sports'],
  docks: ['crewcab', 'crewcab', 'pickup', 'pickup', 'suv', 'crossover', 'van', 'van', 'truck', 'truck', 'semi', 'semi', 'midsize'],
  industrial: ['truck', 'truck', 'truck', 'semi', 'semi', 'van', 'van', 'van', 'crewcab', 'crewcab', 'pickup', 'pickup', 'suv', 'crossover', 'midsize'],
  beach: ['convertible', 'convertible', 'convertible', 'sports', 'sports', 'sports', 'taxi', 'taxi', 'taxi', 'muscle', 'suv', 'suv', 'crossover', 'crossover', 'crewcab', 'midsize', 'compact', 'minivan'],
  park: ['suv', 'suv', 'crossover', 'crossover', 'midsize', 'minivan', 'compact', 'crewcab'],
  airfield: ['van', 'van', 'crewcab', 'suv', 'midsize', 'truck', 'crossover'],
};

// Buses on arterials (primary, secondary and trunk roads, the grid's
// avenues): one spawn in BUS_SHARE there is a bus, at most BUS_MAX alive;
// the school bus by day on school days' hours, the city bus at any hour.
const ARTERIAL = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
export const BUS_SHARE = 0.12, BUS_MAX = 2, SCHOOL_HOURS = [6.5, 17];
export function isArterial(e) {
  return !!(e && (ARTERIAL.has(e.cls) || e.avenue));
}
export function pickBus(rng, clock, edge, alive) {
  if (!isArterial(edge) || alive >= BUS_MAX) return null;
  if (rng.next() >= BUS_SHARE) return null;
  const school = clock >= SCHOOL_HOURS[0] && clock < SCHOOL_HOURS[1];
  return school && rng.next() < 0.4 ? 'schoolbus' : 'citybus';
}

const SPAWN_MIN = 90, SPAWN_MAX = 220;
const DESPAWN = 280, OUT_OF_VIEW = 120;
const CLEARANCE = 12;

export function createTraffic(game, { max = 14 } = {}) {
  const city = game.city;
  const cars = [];
  const wrecks = []; // cars their drivers left: cleared once out of view
  const near = [];
  const sirens = [];
  const ctx = { time: 0, vehicles: game.vehicles, sirens };
  let nearTimer = 0, spawnTimer = 0;
  // Service vehicles in traffic (docs/REVAMP.md 6.11): their own seeded
  // draw per spawn, so the ordinary mix keeps its random sequence.
  const svcRng = createRng(61101);
  const svcAlive = [];
  // Buses: their own seeded draw too.
  const busRng = createRng(61102);
  // Every car body is built once in the first seconds of play (one every
  // six steps), so the first ambulance or fire truck later is no hitch.
  const warmer = createWarmer(Object.keys(VEHICLE_SPECS).map((id) => ['car', VEHICLE_SPECS[id]]), 6, 2);

  const cap = () => {
    const q = game.quality;
    return typeof q === 'number' && q > 0 ? Math.max(1, Math.round(max * Math.min(q, 1.5))) : max;
  };

  function release(v) {
    v.ai = null;
    v.traffic = false;
    v.controls = null;
    if (v.onCall) { v.siren = false; v.onCall = false; }
  }

  // The driver gets out and runs as a pedestrian (task 27): pulled out
  // by a hijacking player, or bailing from a shot, burning or wrecked car.
  function bailOut(v, fromX, fromZ) {
    const peds = game.peds;
    exitPosition(v, game.world || { collision: game.collision, city }, EXIT);
    if (peds && peds.spawnFleeing) {
      const x = EXIT.ok ? EXIT.x : v.x, z = EXIT.ok ? EXIT.z : v.z;
      peds.spawnFleeing(x, z, fromX, fromZ);
    }
    if (game.events && game.events.emit) game.events.emit('driverBailed', v);
  }

  const nearIds = [];
  function refreshNear(px, pz) {
    near.length = 0;
    // Only edges within reach (the edge grid on a real map).
    const ids = city.edgesNear ? city.edgesNear(px, pz, SPAWN_MAX, nearIds).sort(byId) : null;
    const n = ids ? ids.length : city.edges.length;
    for (let j = 0; j < n; j++) {
      const i = ids ? ids[j] : j;
      const e = city.edges[i];
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
      const t = clamp((px - a.x) * ux + (pz - a.z) * uz, 0, e.length);
      const d = Math.hypot(a.x + ux * t - px, a.z + uz * t - pz);
      if (d < SPAWN_MAX) {
        // Edge reaches the spawn ring if its far end is far enough.
        const far = Math.max(Math.hypot(a.x - px, a.z - pz), Math.hypot(b.x - px, b.z - pz));
        if (far > SPAWN_MIN) near.push(i);
      }
    }
  }

  function trySpawn() {
    if (!near.length) return;
    const p = game.player, rng = game.rng;
    const pv = p.vehicle;
    let fx, fz;
    if (pv && Math.hypot(pv.vx || 0, pv.vz || 0) > 2) {
      const l = Math.hypot(pv.vx, pv.vz);
      fx = pv.vx / l;
      fz = pv.vz / l;
    } else {
      fx = Math.cos(p.heading || 0);
      fz = Math.sin(p.heading || 0);
    }
    let best = -Infinity, be = -1, bf = -1, bd = 0, bl = 0;
    for (let k = 0; k < 8; k++) {
      const e = city.edges[near[rng.int(0, near.length - 1)]];
      if (e.causeway && CAUSEWAY_WEIGHT <= 0) continue;
      const from = e.oneway ? e.a : rng.next() < 0.5 ? e.a : e.b;
      const to = otherEnd(e, from);
      const d0 = extAt(city.nodes[from], e) + 12, d1 = e.length - extAt(city.nodes[to], e) - 22;
      if (d1 <= d0) continue;
      const d = rng.range(d0, d1);
      const lane = rng.int(0, lanesFrom(e, from) - 1);
      lanePoint(city, e, from, d, lane, LP);
      const qx = LP.x, qz = LP.z;
      const dist = Math.hypot(qx - p.x, qz - p.z);
      if (dist < SPAWN_MIN || dist > SPAWN_MAX) continue;
      let clear = true;
      const vs = game.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const o = vs[i];
        if ((o.y || 0) > 5) continue;
        const ox = o.x - qx, oz = o.z - qz;
        if (ox * ox + oz * oz < CLEARANCE * CLEARANCE) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const ahead = ((qx - p.x) * fx + (qz - p.z) * fz) / dist;
      const col = game.collision;
      const hidden = col && col.lineClear ? !col.lineClear(p.x, p.z, qx, qz) : false;
      const score = ahead + (hidden ? 1.5 : 0) + rng.next() * 0.2;
      if (score > best) {
        best = score;
        be = e.id; bf = from; bd = d; bl = lane;
      }
    }
    if (be < 0 || !takeSpawn(game)) return;
    const e = city.edges[be];
    lanePoint(city, e, bf, bd, bl, LP);
    const kinds = MIX[city.districtOf(LP.x, LP.z)] || MIX.midtown;
    svcAlive.length = 0;
    for (let i = 0; i < cars.length; i++) if (cars[i].spec.service && !cars[i].removed) svcAlive.push(cars[i]);
    const svc = pickTrafficService(svcRng, game.clock, svcAlive, LP.x, LP.z, city.inCore ? city.inCore(LP.x, LP.z) : true);
    let buses = 0;
    for (let i = 0; i < cars.length; i++) if (cars[i].spec.body === 'bus' && !cars[i].removed) buses++;
    const bus = svc ? null : pickBus(busRng, game.clock, e, buses);
    const v = createVehicle(svc || bus || rng.pick(kinds), LP.x, LP.z, LP.heading, rng);
    const dr = createDriver(city, rng);
    placeDriver(dr, v, be, bf, bd, bl);
    // One in four ambulance or fire truck spawns is on call: siren and
    // lamps on, faster, and traffic gives way (src/core/yield.js).
    if (svc && onCallDraw(svc, svcRng.next())) {
      v.siren = true;
      v.onCall = true;
      dr.speedFactor *= TRAFFIC_RULES.onCallSpeed;
    }
    const v0 = Math.min(laneSpeedOf(e) * dr.speedFactor, v.spec.maxSpeed * 0.8);
    v.vx = Math.cos(v.heading) * v0;
    v.vz = Math.sin(v.heading) * v0;
    v.speed = v0;
    v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    v.ai = dr;
    v.driver = dr;
    v.traffic = true;
    v.asleep = false;
    game.addVehicle(v);
    cars.push(v);
  }

  // The designed first view (docs/REVAMP.md 6.8): `n` moving cars on the
  // start street ahead of the spawn, half with the player's direction and
  // half oncoming, placed from the spawn alone (no rng but the game's, drawn
  // in a fixed order). Returns how many were placed.
  const SEED_LP = { x: 0, z: 0, heading: 0 };
  const SEED_STEP = 17, SEED_SLIDE = [0, 7, -7, 14, -14, 21]; // m
  const START_GAP = 8.5; // no two start cars closer than this (m)
  const ONEWAY_SEED = [10, 19, 28, 37, 46, -11, 55, 64]; // m ahead of the spawn
  function seedStart(n) {
    const sv = city.startView;
    if (!sv || !sv.spawn || !(n > 0)) return 0;
    const sp = sv.spawn, rng = game.rng;
    const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
    // The edge of the start street the spawn is on.
    let be = null, bd = Infinity, bt = 0;
    const ids = edgesAround(city, sp.x, sp.z, 40, nearIds);
    const ne = ids ? ids.length : city.edges.length;
    for (let j = 0; j < ne; j++) {
      const e = city.edges[ids ? ids[j] : j];
      if (e.name !== sp.street) continue;
      const a = city.nodes[e.a];
      const t = clamp((sp.x - a.x) * e.ux + (sp.z - a.z) * e.uz, 0, e.length);
      const d = Math.hypot(a.x + e.ux * t - sp.x, a.z + e.uz * t - sp.z);
      if (d < bd) { bd = d; be = e; bt = t; }
    }
    if (!be || bd > 12) return 0;
    // `with` the player's heading: leave from node a when the edge runs that way.
    const same = be.ux * fx + be.uz * fz >= 0;
    const fwdFrom = same ? be.a : be.b, backFrom = same ? be.b : be.a;
    const spAlong = same ? bt : be.length - bt; // spawn distance from fwdFrom
    let placed = 0;
    for (let i = 0; i < n; i++) {
      // A one-way start street: everyone with the traffic.
      const oncoming = i % 2 === 1 && !be.oneway;
      const from = oncoming ? backFrom : fwdFrom;
      if (!canDrive(be, from)) continue;
      const dMin = extAt(city.nodes[from], be) + 12, dMax = be.length - extAt(city.nodes[oncoming ? fwdFrom : backFrom], be) - 22;
      // Spread along the street ahead of the spawn; if a spot is taken or
      // off the street, slide it along until one is free (never within
      // START_GAP of another car, so the first view has no queue).
      // A one-way start street: one car every 9 m ahead, all with the
      // traffic, the sixth between the title camera and the spawn.
      const base = be.oneway ? ONEWAY_SEED[i % ONEWAY_SEED.length] : 14 + Math.floor(i / 2) * SEED_STEP + (oncoming ? 8 : 0);
      let d = -1, qx = 0, qz = 0, lane = 0;
      for (let k = 0; k < SEED_SLIDE.length && d < 0; k++) {
        const ahead = base + SEED_SLIDE[k];
        const dd = oncoming ? be.length - (spAlong + ahead) : spAlong + ahead;
        if (dd < dMin || dd > dMax) continue;
        // One lane on a one-way start street (a column, not a jam abreast).
        lane = k === 0 ? (be.oneway ? lanesFrom(be, from) - 1 : rng.int(0, lanesFrom(be, from) - 1)) : lane;
        lanePoint(city, be, from, dd, lane, SEED_LP);
        qx = SEED_LP.x;
        qz = SEED_LP.z;
        let clear = true;
        for (let m = 0; m < game.vehicles.length; m++) {
          const o = game.vehicles[m];
          if ((o.x - qx) * (o.x - qx) + (o.z - qz) * (o.z - qz) < START_GAP * START_GAP) { clear = false; break; }
        }
        if (clear) d = dd;
      }
      if (d < 0) continue;
      const kinds = MIX[city.districtOf(qx, qz)] || MIX.midtown;
      const v = createVehicle(rng.pick(kinds), qx, qz, SEED_LP.heading, rng);
      const dr = createDriver(city, rng);
      placeDriver(dr, v, be.id, from, d, lane);
      const v0 = Math.min(laneSpeedOf(be) * dr.speedFactor, v.spec.maxSpeed * 0.8);
      v.vx = Math.cos(v.heading) * v0;
      v.vz = Math.sin(v.heading) * v0;
      v.speed = v0;
      v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
      v.ai = dr;
      v.driver = dr;
      v.traffic = true;
      v.asleep = false;
      game.addVehicle(v);
      cars.push(v);
      placed++;
    }
    return placed;
  }

  // Staged cars (the first run, docs/LOOP.md section e): a slow moving car
  // in the lane at each of `dists` m along (dx, dz) from (x, z), driving
  // that way at `speed` m/s (lane speed scaled down, so it keeps to it
  // after turns too). Marked `staged`, so the intro's lane clearing keeps
  // them. Skips a spot off a street, at a junction or next to another car.
  // Returns how many were placed. Called once per first run, not per step.
  const STAGE_LP = { x: 0, z: 0, heading: 0 };
  const STAGE_GAP = 14, STAGE_PARKED = 2.6; // m: clearance to a driven car, to a parked one
  const STAGE_TRIES = 4, STAGE_SLIDE = 12; // m
  // A staged car needs a way past it, and one lane between two rows of
  // parked cars has none. The car moves on at 6 m/s while the player closes
  // up (up to 70 m by the time it is passed), so the side of the lane with
  // fewer parked cars (strip 1.2 to 4.2 m out, from 6 m behind the car to
  // 70 m ahead of it) is cleared of them: a bay to pass in. The other row stays.
  // STAGE_APART: m between two staged cars, so the pass of one ends before the next begins.
  const STAGE_SIDE_A = 1.2, STAGE_SIDE_B = 4.2, STAGE_BAY = [-6, 70], STAGE_APART = 30;
  function stageBay(lp) {
    const hx = Math.cos(lp.heading), hz = Math.sin(lp.heading);
    let n1 = 0, nm = 0;
    for (let pass = 0; pass < 2; pass++) {
      let best = 0;
      if (pass === 1) best = n1 <= nm ? 1 : -1;
      for (let m = game.vehicles.length - 1; m >= 0; m--) {
        const o = game.vehicles[m];
        if (!o.parked || o.home || o.svcHome || o.staged || o === game.player.vehicle) continue;
        const rx = o.x - lp.x, rz = o.z - lp.z;
        const al = rx * hx + rz * hz;
        if (al < STAGE_BAY[0] || al > STAGE_BAY[1]) continue;
        const lat = -rx * hz + rz * hx; // right of the lane's way is +
        const side = lat > STAGE_SIDE_A && lat < STAGE_SIDE_B ? 1 : lat < -STAGE_SIDE_A && lat > -STAGE_SIDE_B ? -1 : 0;
        if (!side) continue;
        if (pass === 0) { if (side > 0) n1++; else nm++; } else if (side === best) game.removeVehicle(o);
      }
    }
  }
  function stageAhead(x, z, dx, dz, dists, speed = 6) {
    const rng = game.rng;
    let placed = 0, full = false;
    for (let k = 0; k < dists.length && !full; k++) {
      // a spot that is taken, off the street or at a junction slides on a little
      for (let tr = 0; tr < STAGE_TRIES; tr++) {
        const dk = dists[k] + tr * STAGE_SLIDE;
        const qx = x + dx * dk, qz = z + dz * dk;
        const ids = edgesAround(city, qx, qz, 30, nearIds);
        const ne = ids ? ids.length : city.edges.length;
        let be = null, bd = 12, bt = 0;
        for (let j = 0; j < ne; j++) {
          const e = city.edges[ids ? ids[j] : j];
          if (Math.abs(e.ux * dx + e.uz * dz) < 0.9) continue;
          const a = city.nodes[e.a];
          const t = clamp((qx - a.x) * e.ux + (qz - a.z) * e.uz, 0, e.length);
          const d = Math.hypot(a.x + e.ux * t - qx, a.z + e.uz * t - qz);
          if (d < bd) { bd = d; be = e; bt = t; }
        }
        if (!be) continue;
        const fwd = be.ux * dx + be.uz * dz >= 0;
        const from = fwd ? be.a : be.b;
        if (!canDrive(be, from)) continue;
        const along = fwd ? bt : be.length - bt;
        const d0 = extAt(city.nodes[from], be) + 8, d1 = be.length - extAt(city.nodes[otherEnd(be, from)], be) - 14;
        if (along < d0 || along > d1) continue;
        lanePoint(city, be, from, along, 0, STAGE_LP);
        let clear = true;
        for (let m = 0; m < game.vehicles.length; m++) {
          const o = game.vehicles[m];
          // parked cars line the curb beside the lane: only one on the spot itself blocks it
          const r = o.staged ? STAGE_APART : o.parked || !(o.ai || o.driver) ? STAGE_PARKED : STAGE_GAP;
          if ((o.x - STAGE_LP.x) * (o.x - STAGE_LP.x) + (o.z - STAGE_LP.z) * (o.z - STAGE_LP.z) < r * r) { clear = false; break; }
        }
        if (!clear) continue;
        // Within the traffic cap (the street view's draw budget): at the cap,
        // the ordinary traffic car farthest from the player makes way.
        let live = 0, far = null, fd = -1;
        for (let m = 0; m < cars.length; m++) {
          const o = cars[m];
          if (o.removed) continue;
          live++;
          if (o.staged || o.driver !== o.ai) continue;
          const d = (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z);
          if (d > fd) { fd = d; far = o; }
        }
        if (live >= cap()) {
          if (!far) { full = true; break; }
          game.removeVehicle(far);
        }
        const kinds = MIX[city.districtOf(STAGE_LP.x, STAGE_LP.z)] || MIX.midtown;
        const v = createVehicle(rng.pick(kinds), STAGE_LP.x, STAGE_LP.z, STAGE_LP.heading, rng);
        const dr = createDriver(city, rng);
        dr.speedFactor = Math.min(1, speed / laneSpeedOf(be));
        placeDriver(dr, v, be.id, from, along, -1);
        const v0 = Math.min(laneSpeedOf(be) * dr.speedFactor, v.spec.maxSpeed * 0.8);
        v.vx = Math.cos(v.heading) * v0;
        v.vz = Math.sin(v.heading) * v0;
        v.speed = v0;
        v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
        v.ai = dr;
        v.driver = dr;
        v.traffic = true;
        v.staged = true;
        v.asleep = false;
        game.addVehicle(v);
        cars.push(v);
        stageBay(STAGE_LP);
        placed++;
        break;
      }
    }
    return placed;
  }

  return {
    name: 'traffic',
    cars,
    wrecks,
    seedStart,
    stageAhead,
    get count() {
      return cars.length;
    },
    fixedUpdate(dt) {
      beginSpawnStep(game, SPAWNER.traffic);
      warmer.step(game);
      const p = game.player;
      ctx.time = game.time;
      ctx.vehicles = game.vehicles;
      collectSirens(game.vehicles, sirens);
      const idle = city.shoreDist(p.x, p.z) < -120 || (p.y || 0) > 150;
      for (let i = wrecks.length - 1; i >= 0; i--) {
        const v = wrecks[i];
        if (v.removed || v.driver) {
          wrecks.splice(i, 1);
          continue;
        }
        const dx = v.x - p.x, dz = v.z - p.z;
        if (dx * dx + dz * dz > OUT_OF_VIEW * OUT_OF_VIEW) {
          game.removeVehicle(v);
          wrecks.splice(i, 1);
        }
      }
      for (let i = cars.length - 1; i >= 0; i--) {
        const v = cars[i];
        if (v.removed) {
          cars.splice(i, 1);
          continue;
        }
        if (v.driver === 'player' || p.vehicle === v) {
          // Hijacked with the driver still inside: pulled out, runs off.
          if (v.ai && !v.ai.dead) bailOut(v, p.x, p.z);
          release(v);
          cars.splice(i, 1);
          continue;
        }
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        const dr = v.ai;
        // Shot at, burning, wrecked or on a tow hook: stop, get out and run.
        if (v.combatHit || v.burning || v.wrecked || v.towed) {
          dr.dead = true;
          driveStep(dr, v, dt, ctx); // handbrake on
          if (Math.abs(v.speed) < 2.5 || v.wrecked) {
            const src = v.lastHitBy;
            bailOut(v, src && Number.isFinite(src.x) ? src.x : v.x, src && Number.isFinite(src.z) ? src.z : v.z);
            release(v);
            v.driver = null;
            v.bailed = true;
            cars.splice(i, 1);
            wrecks.push(v);
          }
          continue;
        }
        if (d > DESPAWN || ((dr.stuck || dr.dead || v.wrecked) && d > OUT_OF_VIEW)) {
          game.removeVehicle(v);
          release(v);
          cars.splice(i, 1);
          continue;
        }
        if (idle) {
          const c = v.controls;
          c.steer = 0;
          c.throttle = 0;
          c.brake = 0;
          c.handbrake = true;
          continue;
        }
        driveStep(dr, v, dt, ctx);
      }
      if (idle) return;
      nearTimer -= dt;
      if (nearTimer <= 0) {
        nearTimer = 1;
        refreshNear(p.x, p.z);
      }
      spawnTimer -= dt;
      // At most a couple of spawns a step across the game and no more than
      // the live cap (core/spatial.js): when the gate is full this step the
      // spawn waits for the next one.
      if (spawnTimer <= 0 && cars.length < cap() && belowLiveCap(game) && spawnsLeft(game) > 0) {
        spawnTimer = cars.length < cap() / 2 ? 0.15 : 0.4;
        trySpawn();
      }
    },
  };
}
