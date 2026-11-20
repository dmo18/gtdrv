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
import { lanePoint, lanesPerDirection, signalState } from '../world/citygen.js';
import { createVehicle } from '../entities/vehicle.js';
import { clamp } from '../core/rng.js';

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

const laneSpeedOf = (e) => (e.causeway ? LANE_SPEED.causeway : e.avenue ? LANE_SPEED.avenue : LANE_SPEED.street);
const extAt = (node, e) => (e.horizontal ? node.hx : node.hz);
const otherEnd = (e, from) => (e.a === from ? e.b : e.a);

// Scratch objects (no allocations per step).
const LP = { x: 0, z: 0, heading: 0 };
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
    yieldTime: 0, oncomingTime: 0, blockedTime: 0, waitTime: 0, nextAround: 6, pause: 0,
    nudge: 0, // small sideways shift away from things beside the lane
    mode: 0, // 0 normal, 1 backing up, 2 steering around
    modeTime: 0, aroundVeh: null, offset: 0, override: 0,
    junctions: 0, targetSpeed: 0, inJunction: false,
    stuck: false, dead: false,
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
    last = id;
    r -= weightOf(dr, edgeId, from, id, nodeId);
    if (r <= 0) return id;
  }
  return last;
}

function weightOf(dr, ea, fa, eb, fb) {
  const e = dr.city.edges[eb];
  let w = turnType(dr.city, ea, fa, eb, fb) === STRAIGHT ? 1.7 : 1;
  if (e.causeway) w *= 0.5; // keep most traffic in town
  return w;
}

function laneFor(dr, edgeId, turnOut, prevLane, prevEdge) {
  const e = dr.city.edges[edgeId];
  if (lanesPerDirection(e) < 2) return 0;
  if (turnOut === RIGHT) return 1;
  if (turnOut === LEFT || turnOut === UTURN) return 0;
  if (prevEdge >= 0 && lanesPerDirection(dr.city.edges[prevEdge]) > 1) return prevLane;
  return dr.rng.next() < 0.5 ? 0 : 1;
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
// metres along, in `lane` (-1 = choose). Places `v` there if given.
export function placeDriver(dr, v, edgeId, from, d = 0, lane = -1) {
  const city = dr.city;
  if (v) {
    const s = v.spec;
    const ang = s.steerMax / (1 + 5 / 20);
    dr.rmin = Math.max(5.5, (1.1 * s.wheelBase) / Math.tan(ang));
  }
  dr.e0 = edgeId;
  dr.f0 = from;
  dr.f1 = otherEnd(city.edges[edgeId], from);
  dr.e1 = pickNext(dr, edgeId, dr.f1);
  dr.t1 = turnType(city, dr.e0, dr.f0, dr.e1, dr.f1);
  dr.l0 = lane >= 0 ? Math.min(lane, lanesPerDirection(city.edges[edgeId]) - 1) : laneFor(dr, edgeId, dr.t1, 0, -1);
  dr.f2 = otherEnd(city.edges[dr.e1], dr.f1);
  dr.e2 = pickNext(dr, dr.e1, dr.f2);
  dr.t2 = turnType(city, dr.e1, dr.f1, dr.e2, dr.f2);
  dr.l1 = laneFor(dr, dr.e1, dr.t2, dr.l0, dr.e0);
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
  dr.l1 = laneFor(dr, dr.e1, dr.t2, dr.l0, dr.e0);
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

// Point `sa` metres along the path (extrapolates past the end).
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
// `range` metres. Returns false when it is not near the path ahead.
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
function attachNearest(dr, v) {
  const city = dr.city;
  let best = Infinity, be = -1, bf = -1, bl = 0;
  const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
  for (let i = 0; i < city.edges.length; i++) {
    const e = city.edges[i];
    for (let k = 0; k < 2; k++) {
      const from = k ? e.b : e.a;
      const a = city.nodes[from], b = city.nodes[otherEnd(e, from)];
      const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
      const d = clamp((v.x - a.x) * ux + (v.z - a.z) * uz, 0, e.length);
      const lanes = lanesPerDirection(e);
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
      const around = o === dr.aroundVeh && dr.mode === 2;
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
        if (around) g += MIN_GAP - 0.8;
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
      if (!T.signal) {
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
      if (dr.t1 === LEFT && o.kind === 'car' && !(o.ai && o.ai.t1 === LEFT && o.ai.f1 === dr.f1)) {
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
  }
  if (mustStop) vt = Math.min(vt, distLine <= 0.3 ? 0 : Math.sqrt(2 * STOP_DECEL * (distLine - 0.3)));

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
  if (dr.mode === 0 && dr.blockedTime > dr.nextAround && ov && Math.abs(dr.obsSpeed) < 0.3) {
    dr.mode = 1;
    dr.modeTime = 0;
    dr.aroundVeh = ov;
    dr.nextAround = dr.blockedTime + 6;
  }
  dr.modeTime += dt;
  let reverse = false;
  if (dr.mode === 1) {
    if (dr.obsGap > MIN_GAP + 3.5 || dr.modeTime > 2.5) {
      dr.mode = 2;
      dr.modeTime = 0;
    } else reverse = true;
  }
  // Wide vehicles keep a little left of the lane centre.
  let offTarget = -Math.max(0, v.spec.width / 2 - 0.95) + clamp(dr.nudge, -0.6, 0.6);
  if (dr.mode === 2) {
    offTarget = -3.2;
    vt = Math.min(vt, 3);
    if (dr.modeTime > 15) {
      dr.mode = 0;
      dr.aroundVeh = null;
    }
  }
  dr.offset += clamp(offTarget - dr.offset, -1.5 * dt, 1.5 * dt);
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
  const maxAng = spec.steerMax / (1 + Math.abs(sp) / 20);
  let steer;
  if (lx < 0.5) steer = ly >= 0 ? 1 : -1;
  else {
    const kappa = (2 * ly) / (lx * lx + ly * ly);
    steer = Math.atan(kappa * spec.wheelBase) / maxAng;
  }
  c.steer = clamp(reverse ? 0 : steer, -1, 1);

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
    if (sp > 1) c.brake = clamp(-err * 0.35, 0, 1);
    else c.handbrake = true;
  }
  return c;
}

// --- The game system. ---

const MIX = {
  downtown: ['sedan', 'taxi', 'taxi', 'sedan', 'compact', 'sports', 'van'],
  midtown: ['sedan', 'compact', 'taxi', 'van', 'pickup', 'compact', 'muscle'],
  residential: ['compact', 'sedan', 'pickup', 'sedan', 'muscle', 'van'],
  docks: ['pickup', 'truck', 'van', 'truck', 'pickup', 'sedan'],
  industrial: ['truck', 'pickup', 'van', 'pickup', 'compact', 'truck'],
  beach: ['sports', 'compact', 'muscle', 'sedan', 'compact'],
  park: ['compact', 'sedan'],
  airfield: ['van', 'pickup', 'sedan'],
};

const SPAWN_MIN = 90, SPAWN_MAX = 220;
const DESPAWN = 280, OUT_OF_VIEW = 120;
const CLEARANCE = 12;

export function createTraffic(game, { max = 14 } = {}) {
  const city = game.city;
  const cars = [];
  const near = [];
  const ctx = { time: 0, vehicles: game.vehicles };
  let nearTimer = 0, spawnTimer = 0;

  const cap = () => {
    const q = game.quality;
    return typeof q === 'number' && q > 0 ? Math.max(1, Math.round(max * Math.min(q, 1.5))) : max;
  };

  function release(v) {
    v.ai = null;
    v.traffic = false;
    v.controls = null;
  }

  function refreshNear(px, pz) {
    near.length = 0;
    for (let i = 0; i < city.edges.length; i++) {
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
      const from = rng.next() < 0.5 ? e.a : e.b;
      const to = otherEnd(e, from);
      const d0 = extAt(city.nodes[from], e) + 12, d1 = e.length - extAt(city.nodes[to], e) - 22;
      if (d1 <= d0) continue;
      const d = rng.range(d0, d1);
      const lane = rng.int(0, lanesPerDirection(e) - 1);
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
    if (be < 0) return;
    const e = city.edges[be];
    lanePoint(city, e, bf, bd, bl, LP);
    const kinds = MIX[city.districtOf(LP.x, LP.z)] || MIX.midtown;
    const v = createVehicle(rng.pick(kinds), LP.x, LP.z, LP.heading, rng);
    const dr = createDriver(city, rng);
    placeDriver(dr, v, be, bf, bd, bl);
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

  return {
    name: 'traffic',
    cars,
    get count() {
      return cars.length;
    },
    fixedUpdate(dt) {
      const p = game.player;
      ctx.time = game.time;
      ctx.vehicles = game.vehicles;
      const idle = city.shoreDist(p.x, p.z) < -120 || (p.y || 0) > 150;
      for (let i = cars.length - 1; i >= 0; i--) {
        const v = cars[i];
        if (v.removed) {
          cars.splice(i, 1);
          continue;
        }
        if (v.driver === 'player' || p.vehicle === v) {
          release(v);
          cars.splice(i, 1);
          continue;
        }
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        const dr = v.ai;
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
      if (spawnTimer <= 0 && cars.length < cap()) {
        spawnTimer = cars.length < cap() / 2 ? 0.15 : 0.4;
        trySpawn();
      }
    },
  };
}
