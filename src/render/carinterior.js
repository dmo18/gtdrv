// First-person car views (docs/PLAN_V3.md 2.8): the measured cabin of a
// car body, the driver's eye point, the Hood camera point and the cockpit
// interior kit (dashboard, gauge cluster, steering wheel, A-pillars,
// rear-view mirror, door tops and panels, headliner, seats), about 1,500
// triangles in four draws. In the cockpit the car's own exterior is
// hidden except the hood and fenders (the body triangles ahead of the
// windshield base); an invisible copy of the body still casts the car's
// shadow.
//
// Car local frame (vehiclemesh.js): origin on the ground at the car
// center, +x forward, +y up, +z to the right. The driver sits on the
// LEFT (American), so the eye has z < 0.
//
// The measuring and the eye point are pure (node tests); the gauge face
// texture needs a canvas and falls back to a plain face without one.
import * as THREE from 'three';
import { CLS } from './vehiclemats.js';

// Default eye per body kind when the spec has no `eye` ({x, y, z}, car
// local, meters). back: meters behind the windshield base; below: meters
// under the roof skin over the eye; side: share of the car width to the
// left of the center line (capped so the head keeps 0.3 m to the side
// glass); header: at least this far behind the windshield's top edge.
export const EYE_DEFAULTS = {
  sedan: { back: 1.05, header: 0.36, below: 0.27, side: 0.215 },
  hatch: { back: 1.0, header: 0.36, below: 0.27, side: 0.215 },
  coupe: { back: 1.02, header: 0.36, below: 0.235, side: 0.22 },
  suv: { back: 1.0, header: 0.36, below: 0.3, side: 0.21 },
  crossover: { back: 1.0, header: 0.36, below: 0.29, side: 0.21 },
  pickup: { back: 1.0, header: 0.36, below: 0.3, side: 0.21 },
  wagon: { back: 1.05, header: 0.36, below: 0.27, side: 0.215 },
  van: { back: 0.85, header: 0.4, below: 0.34, side: 0.21 },
  truck: { back: 0.85, header: 0.4, below: 0.36, side: 0.2 },
  bus: { back: 0.9, header: 0.5, below: 0.45, side: 0.3 },
  default: { back: 1.0, header: 0.36, below: 0.27, side: 0.215 },
};
export const MIN_CLEAR = 0.15; // eye to any body shell surface (m; the cabin parts hide in the cockpit)
export const WHEEL_MAX_DEG = 90; // steering wheel turn at full input
// The cockpit camera (chasecam.js VIEWS.car 'Cockpit'): vertical FOV in
// degrees, looking level from the eye. The kit is framed for it.
export const COCKPIT_FOV = 78;

// How each class looks from the driver's seat (docs/PLAN_V3.md section
// 13, AIR): angles in degrees from the level line of sight. dash: the
// dash top where it meets the glass (the eye is raised or moved forward
// until the body's cowl is no higher, or the dash is built up to it);
// header: lower edge of the roof header (35 degrees keeps it under 8
// percent of the frame); wheelTop / wheelBot: the rim's top and bottom
// edge (the whole wheel stays in frame); tilt: column angle from upright;
// lip: how far the dash lip sits ahead of the eye (m); face: dash face
// height under the lip (m); fwd: the eye may move this far forward.
export const LOOKS = {
  low: { dash: -18, header: 36, wheelR: 0.185, rimR: 0.024, tilt: 22, wheelTop: -7, wheelBot: -36.5, spokes: 3, lip: 0.74, face: 0.2, fwd: 0.12 },
  tall: { dash: -17, header: 36, wheelR: 0.19, rimR: 0.025, tilt: 24, wheelTop: -6.5, wheelBot: -36.5, spokes: 3, lip: 0.74, face: 0.3, fwd: 0.1 },
  big: { dash: -21, header: 36, wheelR: 0.245, rimR: 0.022, tilt: 56, wheelTop: -15, wheelBot: -35.5, spokes: 4, lip: 0.8, face: 0.32, fwd: 0 },
};
const LOOK_OF = { suv: 'tall', crossover: 'tall', pickup: 'tall', van: 'tall', bus: 'big', truck: 'big' };
export const lookOf = (spec) => LOOKS[LOOK_OF[spec && spec.body] || 'low'];
const DEG = Math.PI / 180;

// ---- measuring -------------------------------------------------------------------
const cabinCache = new Map();

// Body and glass geometry of a car mesh (vehiclemesh.js userData), or
// the biggest meshes under the rig when the layout ever changes.
export function carGeometry(mesh) {
  const ud = (mesh && mesh.userData) || {};
  let body = ud.body && ud.body.geometry;
  let glass = ud.glassLevels && ud.glassLevels[0] && ud.glassLevels[0].geometry;
  if (!glass && ud.glass && ud.glass.levels && ud.glass.levels[0]) glass = ud.glass.levels[0].object.geometry;
  if (!body && ud.rig) {
    let best = 0;
    ud.rig.traverse((o) => {
      const n = o.isMesh && o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0;
      if (n > best) { best = n; body = o.geometry; }
    });
  }
  return { body: body || null, glass: glass || null };
}

// The cabin of one spec measured from its body and glass: windshield
// base (wsX, wsY) and top (rfX, rfY), cabin rear, roof height, belt line
// and half widths at the eye, floor height. Cached per spec id and
// geometry.
export function measureCabin(spec, body, glass) {
  const key = spec.id + ':' + (body ? body.uuid : '-') + ':' + (glass ? glass.uuid : '-');
  let c = cabinCache.get(key);
  if (c) return c;
  const W = spec.width, H = spec.height, L = spec.length;
  const minY = 0.35 * H;
  const mid = 0.22 * W;
  const gp = glass && glass.attributes.position;
  const bp = body && body.attributes.position;
  // Windshield base: the frontmost glass point near the center line.
  let wsX = -Infinity, wsY = 0;
  if (gp) {
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
      if (Math.abs(z) > mid || y < minY) continue;
      if (x > wsX + 1e-4 || (Math.abs(x - wsX) <= 1e-4 && y < wsY)) { wsX = x; wsY = y; }
    }
  }
  if (!Number.isFinite(wsX)) { wsX = L * 0.18; wsY = H * 0.6; }
  // Windshield top: the highest glass point in the windshield's reach.
  let rfX = wsX - 0.8, rfY = -Infinity;
  if (gp) {
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
      if (Math.abs(z) > mid || x > wsX + 0.01 || x < wsX - 1.6 || y < wsY) continue;
      if (y > rfY + 0.02 || (y > rfY - 0.02 && x > rfX)) { rfY = Math.max(rfY, y); rfX = x; }
    }
  }
  if (!Number.isFinite(rfY)) { rfY = H * 0.97; rfX = wsX - 0.9; }
  // Cabin rear: the rearmost glass point near the center line.
  let rearX = Infinity;
  if (gp) {
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
      if (Math.abs(z) > mid || y < minY) continue;
      if (x < rearX) rearX = x;
    }
  }
  if (!Number.isFinite(rearX) || rearX > rfX - 0.4) rearX = rfX - 1.4;
  c = { spec, W, H, L, wsX, wsY, rfX, rfY, rearX, body, glass, at: null };
  // Heights and widths at a station x (the eye's): roof skin, belt line,
  // glass half width at the belt and at the top.
  c.at = (x0) => {
    let roofY = -Infinity;
    if (bp) {
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
        if (Math.abs(z) > 0.2 * W || Math.abs(x - x0) > 0.25 || y < rfY - 0.2) continue;
        if (y > roofY) roofY = y;
      }
    }
    let beltY = Infinity, topY = -Infinity, hwBelt = 0, hwTop = 0;
    if (gp) {
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i), y = gp.getY(i), z = Math.abs(gp.getZ(i));
        if (z < 0.3 * W || Math.abs(x - x0) > 0.25 || y < minY) continue;
        if (y < beltY) beltY = y;
        if (y > topY) topY = y;
      }
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i), y = gp.getY(i), z = Math.abs(gp.getZ(i));
        if (z < 0.3 * W || Math.abs(x - x0) > 0.25 || y < minY) continue;
        if (y < beltY + 0.06 && z > hwBelt) hwBelt = z;
        if (y > topY - 0.06 && z > hwTop) hwTop = z;
      }
    }
    if (!Number.isFinite(beltY)) { beltY = wsY + 0.02; topY = rfY; hwBelt = W / 2 - 0.08; hwTop = W / 2 - 0.2; }
    const open = !Number.isFinite(roofY) || roofY < topY - 0.05;
    return { roofY: open ? null : roofY, beltY, topY, hwBelt, hwTop: hwTop || hwBelt - 0.12 };
  };
  c.floorY = Math.max(0.22, Math.min(wsY - 0.5, (spec.wheelRadius || 0.33) * 0.95));
  // Windshield half widths at the base and the top (for the A-pillars).
  let hwBase = 0, hwHead = 0;
  if (gp) {
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), y = gp.getY(i), z = Math.abs(gp.getZ(i));
      if (y < minY) continue;
      if (x > wsX - 0.12 && y < wsY + 0.12 && z > hwBase) hwBase = z;
      if (x > rfX - 0.1 && x < rfX + 0.25 && y > rfY - 0.08 && z > hwHead) hwHead = z;
    }
  }
  c.hwBase = hwBase || W / 2 - 0.12;
  c.hwHead = hwHead || W / 2 - 0.25;
  // Hood: the highest body point ahead of the windshield base, and the
  // body's front end.
  let hoodY = 0, noseX = wsX;
  if (bp) {
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i);
      if (x <= wsX + 0.05) continue;
      if (y > hoodY && Math.abs(bp.getZ(i)) < 0.3 * W) hoodY = y;
      if (x > noseX) noseX = x;
    }
  }
  c.hoodY = hoodY;
  c.noseX = noseX;
  c.hoodLength = noseX - wsX;
  cabinCache.set(key, c);
  return c;
}

const validEye = (e) => !!e && Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z);

// Is a point inside the measured cabin box (behind the windshield base,
// ahead of the rear glass, above the belt line, under the roof, inside
// the side glass)?
export function inCabin(cab, p) {
  const s = cab.at(p.x);
  const roof = s.roofY != null ? s.roofY : s.topY + 0.1;
  return p.x < cab.wsX && p.x > cab.rearX && p.y > s.beltY && p.y < roof && Math.abs(p.z) < s.hwBelt;
}

// The driver's eye ({x, y, z}, car local): `spec.eye` when the spec has
// one inside the cabin on the left, else the per-kind default fitted to
// the measured cabin and moved clear of the body by MIN_CLEAR where it
// can be (`fromSpec` says which). Either is then framed for the cockpit
// (frameEye).
export function eyePoint(spec, cab) {
  if (cab.eye) return cab.eye;
  if (validEye(spec.eye) && spec.eye.z < 0 && inCabin(cab, spec.eye)) {
    cab.eye = frameEye(spec, cab, { x: spec.eye.x, y: spec.eye.y, z: spec.eye.z, fromSpec: true });
    return cab.eye;
  }
  const d = EYE_DEFAULTS[spec.body] || EYE_DEFAULTS.default;
  let x = Math.max(Math.min(cab.wsX - d.back, cab.rfX - d.header), cab.rearX + 0.5);
  const s = cab.at(x);
  let z = -Math.min(spec.width * d.side, Math.max(0.2, Math.min(s.hwBelt - 0.33, s.hwTop - 0.2)));
  const roof = s.roofY != null ? s.roofY : s.topY + 0.05;
  let y = Math.max(s.beltY + 0.2, roof - d.below);
  // Clear of the body shell (the cabin parts are hidden in the cockpit):
  // the nearest point of a small grid around the default that keeps
  // MIN_CLEAR plus a margin, else the clearest one.
  if (cab.body && bodyClearance(cab.body, x, y, z, true) < MIN_CLEAR + 0.02) {
    let best = null, bestC = -1, bestFar = null, bestD = Infinity;
    for (let i = -3; i <= 6; i++) {
      for (let j = -6; j <= 1; j++) {
        for (let k = -1; k <= 3; k++) {
          const px = x + i * 0.03, py = y + j * 0.025, pz = z + k * 0.03;
          if (pz > -0.18) continue;
          const c = bodyClearance(cab.body, px, py, pz, true);
          const dd = Math.hypot(px - x, (py - y) * 1.5, pz - z);
          if (c > bestC) { bestC = c; best = [px, py, pz]; }
          if (c >= MIN_CLEAR + 0.02 && dd < bestD) { bestD = dd; bestFar = [px, py, pz]; }
        }
      }
    }
    [x, y, z] = bestFar || best;
  }
  cab.eye = frameEye(spec, cab, { x, y, z, fromSpec: false });
  return cab.eye;
}

// Cockpit framing: the dash line (the body's cowl) at most LOOKS.dash
// below the level line of sight, so the windshield fills the frame. The
// eye moves forward a little, then up, staying in the cabin and clear of
// the body shell (the largest move that keeps both).
export function frameEye(spec, cab, e) {
  const lk = lookOf(spec);
  const t = Math.tan(-lk.dash * DEG);
  if (e.y - cab.wsY >= (cab.wsX - e.x) * t) return e;
  const x1 = Math.min(e.x + lk.fwd, Math.max(e.x, cab.wsX - (e.y - cab.wsY) / t));
  const y1 = Math.max(e.y, cab.wsY + (cab.wsX - x1) * t);
  const ok = (k) => {
    const p = { x: e.x + (x1 - e.x) * k, y: e.y + (y1 - e.y) * k, z: e.z };
    return inCabin(cab, p) && cab.at(p.x).roofY != null && p.y < cab.at(p.x).roofY - 0.06 &&
      (!cab.body || bodyClearance(cab.body, p.x, p.y, p.z, true) >= MIN_CLEAR + 0.02);
  };
  let lo = 0, hi = 1;
  if (ok(1)) lo = 1;
  else for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  if (lo === 0) return e;
  return { x: e.x + (x1 - e.x) * lo, y: e.y + (y1 - e.y) * lo, z: e.z, fromSpec: e.fromSpec };
}

// The Hood camera point: on the center line at the windshield base, at
// the driver's eye height.
export function hoodPoint(cab, eye) {
  return { x: cab.wsX + 0.02, y: eye.y, z: 0 };
}

// Closest distance from a point to any triangle of a geometry (m).
export function bodyClearance(geo, px, py, pz, skipCabin = false) {
  const p = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
  const cls = skipCabin && geo.attributes.aCls ? geo.attributes.aCls.array : null;
  const n = idx ? idx.length : p.length / 3;
  let best = Infinity;
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    if (cls && cls[a] === CLS.CABIN) continue;
    // Cheap reject on the bounding box.
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    if (Math.min(ax, bx, cx) - px > best || px - Math.max(ax, bx, cx) > best) continue;
    if (Math.min(ay, by, cy) - py > best || py - Math.max(ay, by, cy) > best) continue;
    if (Math.min(az, bz, cz) - pz > best || pz - Math.max(az, bz, cz) > best) continue;
    const d = pointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
    if (d < best) best = d;
  }
  return best;
}

// Distance from a point to a triangle (Ericson, Real-Time Collision
// Detection 5.1.5).
export function pointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; } else if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
    } else {
      const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
      qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---- the front shell: hood and fenders -----------------------------------------
const shellCache = new Map();
// The body triangles ahead of the windshield base (hood, fenders, nose,
// mirrors), cabin parts left out. Shares the body's attribute buffers.
export function frontShell(body, cab) {
  const key = body.uuid + ':' + cab.wsX.toFixed(3);
  let g = shellCache.get(key);
  if (g) return g;
  const p = body.attributes.position.array;
  const cls = body.attributes.aCls ? body.attributes.aCls.array : null;
  const src = body.index ? body.index.array : null;
  const n = src ? src.length : p.length / 3;
  const keep = [];
  const cut = cab.wsX - 0.02;
  for (let t = 0; t < n; t += 3) {
    const a = src ? src[t] : t, b = src ? src[t + 1] : t + 1, c = src ? src[t + 2] : t + 2;
    if (cls && (cls[a] === CLS.CABIN || cls[a] === CLS.GLASS || cls[a] === CLS.SHADOW)) continue;
    const mx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3;
    if (mx > cut) keep.push(a, b, c);
  }
  g = new THREE.BufferGeometry();
  for (const name of Object.keys(body.attributes)) g.setAttribute(name, body.attributes[name]);
  g.setIndex(keep);
  g.computeBoundingSphere();
  shellCache.set(key, g);
  return g;
}

// ---- the interior kit ------------------------------------------------------------
// One texture atlas (canvas, 1024 x 512) serves the whole cockpit: the
// gauge cluster, the center screen, a stitched seam, vent slats, a soft
// leather grain, a plain white block (vertex color only) and the needle
// color. Regions in canvas pixels [x0, y0, x1, y1].
export const ATLAS = {
  w: 1024, h: 512,
  cluster: [0, 0, 640, 256], screen: [640, 0, 1024, 256],
  stitch: [0, 256, 512, 288], vent: [0, 288, 256, 416], grain: [512, 256, 1024, 512],
  white: [272, 304, 496, 496], needle: [8, 424, 56, 472],
};
// The two dials on the cluster (pixels): rpm on the left, mph on the right.
export const DIAL = { start: (225 * Math.PI) / 180, sweep: (270 * Math.PI) / 180, mph: 140, rpm: 8, red: 6.5, r: 112, rpmC: [130, 128], mphC: [510, 128] };
const uvRect = (r) => [r[0] / ATLAS.w, 1 - r[3] / ATLAS.h, r[2] / ATLAS.w, 1 - r[1] / ATLAS.h];
const UV = {};
for (const k of ['cluster', 'screen', 'stitch', 'vent', 'grain', 'white', 'needle']) UV[k] = uvRect(ATLAS[k]);
const UVW = [(UV.white[0] + UV.white[2]) / 2, (UV.white[1] + UV.white[3]) / 2];

const _col = new THREE.Color();
class Kit {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.parts = {}; this.part = null; }
  get tris() { return this.i.length / 3; }
  // Name the triangles that follow (tests measure the pillars, header, wheel).
  begin(name) {
    this.end();
    this.part = [this.tris, this.tris];
    (this.parts[name] || (this.parts[name] = [])).push(this.part);
  }
  end() { if (this.part) this.part[1] = this.tris; this.part = null; }
  vert(x, y, z, nx, ny, nz, hex, shade = 1, u = UVW[0], v = UVW[1]) {
    _col.setHex(hex);
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(_col.r * shade, _col.g * shade, _col.b * shade);
    this.u.push(u, v);
    return this.p.length / 3 - 1;
  }
  // A flat quad a b c d (either winding: the material is double sided);
  // `uv` maps a->(u0,v0), b->(u1,v0), c->(u1,v1), d->(u0,v1).
  quad(a, b, c, d, hex, shade = 1, uv = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const r = uv || null;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, hex, shade, r ? r[0] : UVW[0], r ? r[1] : UVW[1]);
    this.vert(b[0], b[1], b[2], nx, ny, nz, hex, shade, r ? r[2] : UVW[0], r ? r[1] : UVW[1]);
    this.vert(c[0], c[1], c[2], nx, ny, nz, hex, shade, r ? r[2] : UVW[0], r ? r[3] : UVW[1]);
    this.vert(d[0], d[1], d[2], nx, ny, nz, hex, shade, r ? r[0] : UVW[0], r ? r[3] : UVW[1]);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  // A box on three axes (unit vectors u, v, w) around a center.
  obox(cx, cy, cz, u, v, w, su, sv, sw, hex, skip = '', uv = null) {
    const P = (a, b, c) => [cx + u[0] * a * su / 2 + v[0] * b * sv / 2 + w[0] * c * sw / 2, cy + u[1] * a * su / 2 + v[1] * b * sv / 2 + w[1] * c * sw / 2, cz + u[2] * a * su / 2 + v[2] * b * sv / 2 + w[2] * c * sw / 2];
    if (!skip.includes('u')) this.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), hex, 0.95, uv);
    if (!skip.includes('U')) this.quad(P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), hex, 0.95, uv);
    if (!skip.includes('v')) this.quad(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), hex, 1, uv);
    if (!skip.includes('V')) this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), hex, 0.8, uv);
    if (!skip.includes('w')) this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), hex, 0.9, uv);
    if (!skip.includes('W')) this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), hex, 0.9, uv);
  }
  box(cx, cy, cz, sx, sy, sz, hex, skip = '', uv = null) {
    this.obox(cx, cy, cz, X, Y, Z, sx, sy, sz, hex, skip, uv);
  }
  // A bar from p0 to p1, w0 wide at p0 and w1 at p1, d deep; `side`
  // points to the bar's flat face (the one that shows).
  bar(p0, p1, side, w0, d, hex, w1 = w0, uv = null) {
    const t = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const k = side[0] * t[0] + side[1] * t[1] + side[2] * t[2];
    const a = norm([side[0] - t[0] * k, side[1] - t[1] * k, side[2] - t[2] * k]);
    const b = cross(t, a);
    const C = (p, w, sa, sb) => [p[0] + a[0] * sa * d / 2 + b[0] * sb * w / 2, p[1] + a[1] * sa * d / 2 + b[1] * sb * w / 2, p[2] + a[2] * sa * d / 2 + b[2] * sb * w / 2];
    this.quad(C(p0, w0, 1, -1), C(p0, w0, 1, 1), C(p1, w1, 1, 1), C(p1, w1, 1, -1), hex, 1, uv);
    this.quad(C(p0, w0, -1, -1), C(p0, w0, -1, 1), C(p1, w1, -1, 1), C(p1, w1, -1, -1), hex, 0.8, uv);
    this.quad(C(p0, w0, -1, 1), C(p0, w0, 1, 1), C(p1, w1, 1, 1), C(p1, w1, -1, 1), hex, 0.9, uv);
    this.quad(C(p0, w0, -1, -1), C(p0, w0, 1, -1), C(p1, w1, 1, -1), C(p1, w1, -1, -1), hex, 0.9, uv);
  }
  // A torus around the origin in the xy plane (smooth normals); vertices
  // within `mark.half` radians of 12 o'clock take mark.hex.
  torus(R, r, segU, segV, hex, mark = null, uv = null) {
    const base = this.p.length / 3;
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      const h = mark && Math.abs(Math.atan2(Math.sin(u - Math.PI / 2), Math.cos(u - Math.PI / 2))) < mark.half ? mark.hex : hex;
      for (let j = 0; j <= segV; j++) {
        const v = (j / segV) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        const tu = uv ? uv[0] + (uv[2] - uv[0]) * (i / segU) : UVW[0], tv = uv ? uv[1] + (uv[3] - uv[1]) * (j / segV) : UVW[1];
        this.vert((R + r * cv) * cu, (R + r * cv) * su, r * sv, cv * cu, cv * su, sv, h, 1, tu, tv);
      }
    }
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = base + i * (segV + 1) + j, b = a + segV + 1;
        this.i.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  // A capped cylinder along z from z0 to z1 around (x, y), radii rx, ry.
  cyl(x, y, z0, z1, rx, ry, seg, hex, cap = true, shade = 0.9) {
    const base = this.p.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      this.vert(x + c * rx, y + s * ry, z0, c, s, 0, hex, shade);
      this.vert(x + c * rx, y + s * ry, z1, c, s, 0, hex, shade);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    if (cap) {
      const c0 = this.vert(x, y, z1, 0, 0, 1, hex);
      const ring = this.p.length / 3;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        this.vert(x + Math.cos(a) * rx, y + Math.sin(a) * ry, z1, 0, 0, 1, hex);
      }
      for (let i = 0; i < seg; i++) this.i.push(c0, ring + i, ring + i + 1);
    }
  }
  geometry() {
    this.end();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Interior colors (original, no brand marks): a two-tone cabin, charcoal
// upper and warm gray lower.
const COL = {
  top: 0x2a2b2e, upper: 0x323337, lower: 0x77726a, lowerDark: 0x5e5a53, seam: 0x1c1c1e, stitch: 0xd8d2c4,
  binnacle: 0x1d1e21, pillar: 0x4a4842, liner: 0xa8a399, door: 0x6f6a62, doorTop: 0x2c2d30, trim: 0x3d3e42,
  seat: 0x34312e, seatSide: 0x403c37, floor: 0x1e1e1e, console: 0x2b2c30, knob: 0x8d9095, chrome: 0xb9bcc0,
  mirror: 0xa8b8c6, mirrorFrame: 0x18191b, rim: 0x232325, spoke: 0x3a3b3f, hub: 0x26272a, mark: 0xc9b48a,
};

// Where the parts sit for one cabin and eye (car local). Exported for the
// tests (wheel, cluster, header).
export function interiorLayout(cab, eye, spec = cab.spec) {
  const lk = lookOf(spec);
  const s = cab.at(eye.x);
  const tan = (a) => Math.tan(a * DEG);
  const hw = Math.max(0.45, s.hwBelt - 0.03); // door panel half width
  // Dash line where the dash meets the glass (built up to the line when
  // the body's cowl is lower, as in trucks and buses).
  const gX = cab.wsX - 0.01;
  const gY = Math.max(cab.wsY - 0.01, eye.y + (gX - eye.x) * tan(lk.dash));
  // Steering wheel: center and column tilt so the rim's outer top and
  // bottom edges sit at wheelTop and wheelBot.
  const R = lk.wheelR, Re = R + lk.rimR, t = lk.tilt * DEG;
  const A = tan(lk.wheelTop), B = tan(lk.wheelBot);
  const wd = (2 * Re * Math.cos(t) - (A + B) * Re * Math.sin(t)) / (A - B);
  const wheelX = eye.x + wd, wheelY = eye.y + A * (wd + Re * Math.sin(t)) - Re * Math.cos(t);
  // Gauge cluster: behind the rim's top, seen through the wheel.
  const big = lk === LOOKS.big;
  const clusterW = big ? 0.44 : 0.4, clusterH = clusterW * 0.4;
  const cd = Math.min(wd + (big ? 0.22 : 0.15), gX - eye.x - 0.12);
  const clusterX = eye.x + cd;
  const clusterY = eye.y + cd * tan(lk.wheelTop - 2.2) - clusterH / 2;
  // Dash lip: under the cluster in front of the driver, curving closer
  // toward the passenger side; its edge reads as one level line.
  const lipAng = Math.min(lk.dash - 5, Math.atan2(clusterY - clusterH / 2 - 0.03 - eye.y, cd) / DEG);
  const lipNear = Math.min(cd + 0.03, gX - eye.x - 0.12), lipFar = Math.min(lk.lip, lipNear);
  const lipD = (z) => lipNear - (lipNear - lipFar) * smooth((z - eye.z - 0.3) / 0.55);
  const lipY = (z) => eye.y + lipD(z) * tan(lipAng);
  // Roof header: its lower edge at `header` degrees above the line of sight.
  const hd = Math.max(0.32, Math.min(1.4, cab.rfX - eye.x));
  const headerX = eye.x + hd, headerY = eye.y + hd * tan(lk.header);
  return {
    look: lk, s, hw, gX, gY, lipD, lipY, lipAng, headerX, headerY,
    dashW: Math.min(hw, cab.hwBase + 0.02),
    wheelX, wheelY, wheelR: R, rimR: lk.rimR, tilt: t,
    clusterX, clusterY, clusterW, clusterH,
  };
}

function buildShell(cab, eye, lay) {
  const k = new Kit();
  const { s, hw, look: lk, dashW } = lay;
  const ex = eye.x, ey = eye.y, ez = eye.z;
  const gX = lay.gX, gY = lay.gY;
  const floor = cab.floorY;
  const rearX = Math.max(cab.rearX + 0.15, ex - 1.6);
  const belt = s.beltY - 0.005;
  const roofY = lay.headerY + 0.045;
  const G = UV.grain;

  // ---- dash: a soft top from the glass to the lip, a rolled lip with a
  // stitched seam, the lighter lower face down to the knees.
  k.begin('dash');
  const NZ = 14;
  const row = (z) => {
    const lx = ex + lay.lipD(z), ly = lay.lipY(z);
    const midX = (gX + lx) / 2, midY = Math.max(gY, ly) + 0.012; // a gentle crown
    return [
      [gX, gY, z], [midX, midY, z], [lx + 0.03, ly + 0.012, z], // top
      [lx + 0.005, ly + 0.002, z], [lx, ly - 0.02, z], // the rolled lip
      [lx + 0.002, ly - 0.032, z], // stitched seam below the roll
      [lx + 0.03, ly - lk.face, z], // lower face
      [lx + 0.24, Math.max(floor + 0.15, ly - lk.face - 0.3), z], // knee roll to the firewall
    ];
  };
  let prev = row(-dashW);
  for (let i = 1; i <= NZ; i++) {
    const z = -dashW + (2 * dashW * i) / NZ;
    const cur = row(z);
    const gu = [G[0] + (G[2] - G[0]) * ((i - 1) / NZ), G[1], G[0] + (G[2] - G[0]) * (i / NZ), G[3]];
    k.quad(prev[0], cur[0], cur[1], prev[1], COL.top, 1.0, gu);
    k.quad(prev[1], cur[1], cur[2], prev[2], COL.top, 1.06, gu);
    k.quad(prev[2], cur[2], cur[3], prev[3], COL.upper, 1.2, gu);
    k.quad(prev[3], cur[3], cur[4], prev[4], COL.upper, 1.0, gu);
    k.quad(prev[4], cur[4], cur[5], prev[5], 0xffffff, 0.85, UV.stitch);
    k.quad(prev[5], cur[5], cur[6], prev[6], COL.lower, 1.0, gu);
    k.quad(prev[6], cur[6], cur[7], prev[7], COL.lowerDark, 0.8, gu);
    prev = cur;
  }
  // Dash ends against the doors.
  for (const sg of [-1, 1]) {
    const r = row(sg * dashW);
    k.quad(r[0], r[2], r[6], [gX, r[6][1], r[0][2]], COL.upper, 0.75);
    k.quad([gX, r[6][1], r[0][2]], r[6], r[7], [gX, r[7][1], r[0][2]], COL.lowerDark, 0.7);
  }
  // Vents: one at each end, two over the center screen (slats in the atlas).
  const vent = (z, w, h, drop) => {
    const lx = ex + lay.lipD(z) + 0.012, ly = lay.lipY(z) - drop;
    k.quad([lx - 0.004, ly, z - w / 2], [lx - 0.004, ly, z + w / 2], [lx + 0.012, ly - h, z + w / 2], [lx + 0.012, ly - h, z - w / 2], 0xffffff, 0.9, UV.vent);
  };
  vent(-dashW + 0.1, 0.12, 0.06, 0.045);
  vent(dashW - 0.1, 0.12, 0.06, 0.045);
  vent(-0.07, 0.11, 0.05, 0.045);
  vent(0.07, 0.11, 0.05, 0.045);
  // Glove box: a seam outline and a latch on the passenger side.
  {
    const gz0 = Math.max(0.2, dashW * 0.35), gz1 = dashW - 0.12;
    const lx = ex + lay.lipD((gz0 + gz1) / 2), ly = lay.lipY((gz0 + gz1) / 2);
    const P = (y, z) => { const f = (ly - y - 0.032) / (lk.face - 0.032); return [lx + 0.002 + 0.028 * f - 0.003, y, z]; };
    const y0 = ly - 0.07, y1 = ly - lk.face + 0.025;
    k.quad(P(y0, gz0), P(y0, gz1), P(y0 - 0.006, gz1), P(y0 - 0.006, gz0), COL.seam);
    k.quad(P(y1 + 0.006, gz0), P(y1 + 0.006, gz1), P(y1, gz1), P(y1, gz0), COL.seam);
    k.quad(P(y0, gz0), P(y0, gz0 + 0.006), P(y1, gz0 + 0.006), P(y1, gz0), COL.seam);
    k.quad(P(y0, gz1 - 0.006), P(y0, gz1), P(y1, gz1), P(y1, gz1 - 0.006), COL.seam);
    const m = P(y0 - 0.03, (gz0 + gz1) / 2);
    k.box(m[0] - 0.004, m[1], m[2], 0.012, 0.014, 0.07, COL.chrome);
  }
  // ---- instrument binnacle: a hood over the cluster in front of the driver.
  k.begin('binnacle');
  const cx = lay.clusterX, cyTop = lay.clusterY + lay.clusterH / 2, cyBot = lay.clusterY - lay.clusterH / 2;
  const bw = lay.clusterW / 2 + 0.035;
  const bTop = cyTop + 0.03, baseY = Math.max(lay.lipY(ez) + 0.012, cyBot - 0.02);
  const NB = 8;
  let pr = null;
  for (let i = 0; i <= NB; i++) {
    const a = Math.PI * (i / NB);
    const z = ez - Math.cos(a) * bw;
    const h = Math.pow(Math.sin(a), 0.4);
    const y = baseY + (bTop - baseY) * h;
    const cur = [[cx - 0.075, y - 0.014 * h, z], [cx - 0.05, y, z], [cx + 0.16, baseY + (bTop - baseY) * h * 0.5, z]];
    if (pr) {
      k.quad(pr[0], cur[0], cur[1], pr[1], COL.binnacle, 1.25);
      k.quad(pr[1], cur[1], cur[2], pr[2], COL.top, 1.05, G);
    }
    pr = cur;
  }
  // The well around the dials: back wall and floor.
  k.quad([cx + 0.012, cyBot - 0.02, ez - bw], [cx + 0.012, cyBot - 0.02, ez + bw], [cx + 0.012, bTop, ez + bw], [cx + 0.012, bTop, ez - bw], COL.seam);
  k.quad([cx - 0.075, baseY, ez - bw], [cx - 0.075, baseY, ez + bw], [cx + 0.012, cyBot - 0.02, ez + bw], [cx + 0.012, cyBot - 0.02, ez - bw], COL.binnacle, 0.8);
  // Column shroud from the dash face to the wheel.
  k.begin('column');
  const ct = [Math.cos(lay.tilt), -Math.sin(lay.tilt), 0];
  const hubBack = [lay.wheelX + ct[0] * 0.07, lay.wheelY + ct[1] * 0.07, ez];
  const colEnd = [ex + lay.lipD(ez) + 0.06, lay.wheelY + ct[1] * (ex + lay.lipD(ez) + 0.06 - lay.wheelX) / ct[0], ez];
  k.bar(hubBack, colEnd, [0, 1, 0], 0.085, 0.075, COL.seam, 0.11);
  // ---- center stack: panel, screen frame, climate knobs, console.
  k.begin('stack');
  const sx = ex + lay.lipD(0), sy = lay.lipY(0);
  k.box(sx + 0.03, sy - 0.2, 0, 0.06, 0.3, 0.3, COL.trim, 'u');
  for (const kz of [-0.075, 0, 0.075]) k.obox(sx - 0.005, sy - 0.31, kz, X, Y, Z, 0.03, 0.03, 0.04, kz === 0 ? COL.trim : COL.knob, 'u');
  const consoleTop = floor + 0.36;
  k.box((sx + 0.06 + ex - 0.25) / 2, (consoleTop + floor) / 2, 0, sx + 0.06 - ex + 0.25, consoleTop - floor, 0.22, COL.console, 'u');
  k.box(ex + 0.22, consoleTop + 0.07, 0, 0.06, 0.14, 0.04, COL.trim);
  k.box(ex + 0.22, consoleTop + 0.15, 0, 0.07, 0.04, 0.05, COL.chrome);
  k.quad([gX + 0.05, floor, -hw], [gX + 0.05, floor, hw], [rearX, floor, hw], [rearX, floor, -hw], COL.floor);
  // ---- doors: the door top (belt), the inner panel with an armrest, both
  // sides from the dash to the cabin rear.
  k.begin('doors');
  for (const sg of [-1, 1]) {
    const zo = sg * (s.hwBelt + 0.01), zi = sg * hw, zp = sg * (hw - 0.04);
    const x0 = gX + 0.02, x1 = rearX;
    k.quad([x0, belt, zo], [x1, belt, zo], [x1, belt, zi], [x0, belt, zi], COL.doorTop, 1.1, G);
    k.quad([x0, belt, zi], [x1, belt, zi], [x1, belt - 0.05, zp], [x0, belt - 0.05, zp], COL.upper, 1.0, G);
    k.quad([x0, belt - 0.05, zp], [x1, belt - 0.05, zp], [x1, belt - 0.07, zp], [x0, belt - 0.07, zp], 0xffffff, 0.8, UV.stitch);
    k.quad([x0, belt - 0.07, zp], [x1, belt - 0.07, zp], [x1, floor, zp], [x0, floor, zp], COL.door, 0.9, G);
    k.box(ex - 0.05, belt - 0.22, sg * (hw - 0.08), 0.5, 0.05, 0.08, COL.trim);
    k.box(ex + 0.25, belt - 0.12, sg * (hw - 0.05), 0.12, 0.03, 0.012, COL.chrome);
    k.box(ex + 0.38, floor + 0.2, sg * (hw - 0.045), 0.2, 0.16, 0.012, COL.seam);
  }
  // ---- A-pillars (slim, tapering up), the header band, the headliner.
  k.begin('pillars');
  const hx = lay.headerX, hy = lay.headerY;
  for (const sg of [-1, 1]) {
    const p0 = [gX - 0.02, gY + 0.005, sg * (cab.hwBase - 0.015)];
    const p1 = [hx, hy + 0.01, sg * (cab.hwHead - 0.02)];
    k.bar(p0, p1, norm([ex - (p0[0] + p1[0]) / 2, ey - (p0[1] + p1[1]) / 2, ez - (p0[2] + p1[2]) / 2]), 0.05, 0.035, COL.pillar, 0.034);
  }
  k.begin('header');
  const hwR = Math.max(cab.hwHead, s.hwTop) + 0.01;
  k.quad([hx, hy, -hwR], [hx, hy, hwR], [hx - 0.012, roofY, hwR], [hx - 0.012, roofY, -hwR], COL.liner, 0.9);
  k.quad([hx, hy, -hwR], [hx, hy, hwR], [hx + 0.04, hy + 0.02, hwR], [hx + 0.04, hy + 0.02, -hwR], COL.pillar, 0.8);
  k.begin('liner');
  k.quad([hx - 0.012, roofY, -hwR], [hx - 0.012, roofY, hwR], [rearX, roofY, hwR], [rearX, roofY, -hwR], COL.liner, 0.95, G);
  for (const sg of [-1, 1]) {
    // Roof rail down to the side glass, B- and C-pillars.
    const zr = sg * hwR, zg = sg * (s.hwTop + 0.02);
    const gy = Math.max(belt + 0.3, roofY - 0.06);
    k.quad([hx - 0.012, roofY, zr], [rearX, roofY, zr], [rearX, gy, zg], [hx - 0.012, gy, zg], COL.liner, 0.85);
    const bxp = ex - 0.42;
    k.bar([bxp, belt, sg * (s.hwBelt - 0.02)], [bxp, gy, sg * (s.hwTop - 0.0)], [0, 0, -sg], 0.11, 0.05, COL.pillar);
    k.bar([rearX + 0.08, belt, sg * (s.hwBelt - 0.02)], [rearX + 0.2, gy, sg * (s.hwTop - 0.0)], [0, 0, -sg], 0.22, 0.05, COL.pillar);
  }
  // Rear-view mirror: a small one on a stem from the header, angled to the driver.
  k.begin('mirror');
  const mx = hx + 0.1, my = hy - 0.075;
  k.bar([hx + 0.02, hy + 0.005, 0], [mx + 0.01, my + 0.02, 0], [0, 0, 1], 0.02, 0.018, COL.mirrorFrame);
  const yaw = Math.atan2(-ez, mx - ex) * 0.5;
  const u = [Math.sin(yaw), 0, Math.cos(yaw)], w = [Math.cos(yaw), 0, -Math.sin(yaw)];
  k.obox(mx, my, 0, u, Y, w, 0.13, 0.042, 0.025, COL.mirrorFrame);
  k.obox(mx - 0.013 * w[0], my, -0.013 * w[2], u, Y, w, 0.116, 0.03, 0.002, COL.mirror, 'uUvVW');
  // ---- seats: the driver's cushion, the passenger's seat, a rear bench.
  k.begin('seats');
  const seat = (sx0, sz, sw, own) => {
    const cy = floor + 0.24;
    k.box(sx0 + 0.06, cy, sz, 0.5, 0.12, sw, COL.seat, '', G);
    if (own) return;
    const back0 = [sx0 - 0.2, cy + 0.05, sz], back1 = [sx0 - 0.3, ey - 0.08, sz];
    k.bar(back0, back1, [1, 0, 0], sw, 0.12, COL.seat, sw, G);
    for (const b of [-1, 1]) k.box(sx0 + 0.06, cy + 0.06, sz + b * (sw / 2 - 0.04), 0.46, 0.06, 0.08, COL.seatSide);
    k.box(sx0 - 0.31, ey + 0.0, sz, 0.09, 0.14, 0.24, COL.seatSide);
  };
  seat(ex - 0.02, ez, 0.5, true);
  seat(ex - 0.02, -ez, 0.5, false);
  if (ex - rearX > 1.05) {
    const rx = rearX + 0.35;
    k.box(rx, floor + 0.22, 0, 0.45, 0.12, hw * 1.9, COL.seat, '', G);
    const top = Math.min(belt + 0.12, roofY - 0.15);
    k.bar([rx - 0.18, floor + 0.28, 0], [rx - 0.28, top, 0], [1, 0, 0], hw * 1.9, 0.1, COL.seat, hw * 1.9, G);
  }
  k.end();
  return k;
}

// The steering wheel in its own frame: rim in the xy plane, +z toward
// the driver. Three spokes (four on buses and trucks), a padded hub.
function buildWheel(lay) {
  const k = new Kit();
  const R = lay.wheelR, r = lay.rimR, four = lay.look.spokes === 4;
  k.begin('rim');
  k.torus(R, r, 40, 8, COL.rim, { half: 0.09, hex: COL.mark }, UV.grain);
  k.begin('spokes');
  const angs = four ? [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4] : [-0.12, Math.PI + 0.12, -Math.PI / 2];
  for (const a of angs) {
    const c = Math.cos(a), s = Math.sin(a);
    const wide = !four && a === -Math.PI / 2;
    k.bar([c * 0.05, s * 0.05, 0.018], [c * (R - r * 0.6), s * (R - r * 0.6), 0], [0, 0, 1], wide ? 0.075 : 0.06, 0.016, COL.spoke, wide ? 0.05 : 0.036);
    // A thin bright edge along the spoke's top face.
    k.bar([c * 0.055, s * 0.055, 0.027], [c * (R - r * 1.2), s * (R - r * 1.2), 0.012], [0, 0, 1], 0.006, 0.003, COL.chrome);
  }
  k.begin('hub');
  // Hub: a rounded pad (elliptic on cars), a ring around it, the column.
  const px = four ? 0.06 : 0.072, py = four ? 0.06 : 0.058;
  k.cyl(0, 0, -0.005, 0.03, px, py, 16, COL.hub);
  k.cyl(0, 0, 0.03, 0.046, px * 0.86, py * 0.84, 16, COL.spoke, true, 1.1);
  k.cyl(0, 0, -0.16, -0.005, 0.035, 0.035, 8, COL.seam, false);
  k.end();
  return k;
}

// ---- the atlas -------------------------------------------------------------------
// Paints the cockpit atlas onto a 2D context (1024 x 512). Pure canvas
// calls, so the tests can record them.
export function paintAtlas(g) {
  const fill = (c, r) => { g.fillStyle = c; g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); };
  fill('#ffffff', [0, 0, ATLAS.w, ATLAS.h]);
  // Leather grain: soft light speckle (multiplied by the vertex colors).
  const gr = ATLAS.grain;
  fill('#f4f4f4', gr);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2600; i++) {
    const v = 214 + Math.floor(rnd() * 40);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(gr[0] + rnd() * (gr[2] - gr[0]), gr[1] + rnd() * (gr[3] - gr[1]), 1 + rnd() * 3, 1 + rnd() * 2);
  }
  // Stitched seam: a dark welt with light thread dashes along it.
  const st = ATLAS.stitch;
  fill('#3a3a3c', st);
  g.fillStyle = '#26262a';
  g.fillRect(st[0], st[1], st[2] - st[0], 6);
  g.fillRect(st[0], st[3] - 6, st[2] - st[0], 6);
  g.fillStyle = '#d9d2c2';
  for (let x = st[0] + 2; x < st[2]; x += 14) g.fillRect(x, st[1] + 14, 8, 4);
  // Vent: dark louvres with lit slat edges.
  const vt = ATLAS.vent;
  fill('#121314', vt);
  g.fillStyle = '#3c3e42';
  for (let y = vt[1] + 8; y < vt[3] - 6; y += 16) g.fillRect(vt[0] + 8, y, vt[2] - vt[0] - 16, 5);
  g.strokeStyle = '#6b6e73';
  g.lineWidth = 6;
  g.strokeRect(vt[0] + 3, vt[1] + 3, vt[2] - vt[0] - 6, vt[3] - vt[1] - 6);
  fill('#ff6a1f', ATLAS.needle);
  fill('#ffffff', ATLAS.white);
  // Gauge cluster.
  const cl = ATLAS.cluster;
  fill('#08090b', cl);
  const dial = (cx, cy, max, step, minor, label, unit, red) => {
    const r = DIAL.r;
    const grd = typeof g.createRadialGradient === 'function' ? g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r + 8) : null;
    if (grd) { grd.addColorStop(0, '#1d2127'); grd.addColorStop(1, '#0b0c0f'); }
    g.fillStyle = grd || '#14171b';
    g.beginPath(); g.arc(cx, cy, r + 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#a7adb5'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cy, r + 7, 0, Math.PI * 2); g.stroke();
    if (red != null) {
      g.strokeStyle = '#c8321f'; g.lineWidth = 10;
      g.beginPath();
      g.arc(cx, cy, r - 6, -(DIAL.start - (red / max) * DIAL.sweep), -(DIAL.start - DIAL.sweep));
      g.stroke();
    }
    for (let v = 0; v <= max + 1e-6; v += minor) {
      const a = DIAL.start - (v / max) * DIAL.sweep;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const r0 = major ? r - 20 : r - 10;
      g.strokeStyle = red != null && v >= red ? '#ff5a3c' : '#f1f1ec';
      g.lineWidth = major ? 5 : 2.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (r - 1), cy - Math.sin(a) * (r - 1));
      g.stroke();
      if (major) {
        g.fillStyle = red != null && v >= red ? '#ff5a3c' : '#ffffff';
        g.font = 'bold 30px sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(v), cx + Math.cos(a) * (r - 42), cy - Math.sin(a) * (r - 42));
      }
    }
    g.fillStyle = '#c7ccd3';
    g.font = 'bold 22px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, cx, cy + r * 0.42);
    if (unit) { g.font = '15px sans-serif'; g.fillText(unit, cx, cy + r * 0.64); }
  };
  dial(DIAL.rpmC[0], DIAL.rpmC[1], DIAL.rpm, 1, 0.5, 'RPM', 'x1000', DIAL.red);
  dial(DIAL.mphC[0], DIAL.mphC[1], DIAL.mph, 20, 10, 'MPH', null, null);
  // Between the dials: gear, a fuel bar and a temperature bar.
  const mx = (DIAL.rpmC[0] + DIAL.mphC[0]) / 2;
  g.fillStyle = '#7ad3ff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('D', mx, 92);
  g.fillStyle = '#2b3036'; g.fillRect(mx - 44, 150, 88, 10); g.fillRect(mx - 44, 182, 88, 10);
  g.fillStyle = '#e8e8e2'; g.fillRect(mx - 44, 150, 62, 10);
  g.fillStyle = '#8fd18a'; g.fillRect(mx - 44, 182, 40, 10);
  // Center screen: a dark glass panel with an invented map and tiles.
  const sc = ATLAS.screen;
  fill('#0b1118', sc);
  g.fillStyle = '#16222e'; g.fillRect(sc[0] + 14, sc[1] + 14, 236, 228);
  g.strokeStyle = '#2f4a5e'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(sc[0] + 20, sc[1] + 190); g.lineTo(sc[0] + 120, sc[1] + 120); g.lineTo(sc[0] + 244, sc[1] + 140); g.stroke();
  g.beginPath(); g.moveTo(sc[0] + 90, sc[1] + 20); g.lineTo(sc[0] + 130, sc[1] + 236); g.stroke();
  g.strokeStyle = '#4fb3ff'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(sc[0] + 108, sc[1] + 236); g.lineTo(sc[0] + 120, sc[1] + 120); g.lineTo(sc[0] + 200, sc[1] + 132); g.stroke();
  for (let i = 0; i < 3; i++) {
    g.fillStyle = ['#1f3346', '#2a2f3a', '#1f3a2f'][i];
    g.fillRect(sc[0] + 264, sc[1] + 14 + i * 78, 106, 70);
    g.fillStyle = '#9fb3c6';
    g.fillRect(sc[0] + 280, sc[1] + 40 + i * 78, 74, 8);
  }
}

let atlasTex = null;
function atlasTexture() {
  if (atlasTex !== null) return atlasTex;
  atlasTex = false;
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return atlasTex;
  try {
    const cv = doc.createElement('canvas');
    cv.width = ATLAS.w; cv.height = ATLAS.h;
    const g = cv.getContext('2d');
    if (!g) return atlasTex;
    paintAtlas(g);
    atlasTex = new THREE.CanvasTexture(cv);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = 4;
    atlasTex.generateMipmaps = true;
  } catch {
    atlasTex = false;
  }
  return atlasTex;
}

let mats = null;
function materials() {
  if (mats) return mats;
  const tex = atlasTexture();
  mats = {
    // One lit material for the cabin and the wheel (vertex colors times
    // the atlas), a little self light: the cabin is in the roof's shade.
    shell: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x161616, map: tex || null }),
    // Unlit for the dials, needles and screen (they glow).
    face: new THREE.MeshBasicMaterial(tex ? { map: tex, toneMapped: false } : { color: 0x15171a }),
    // Draws nothing, casts the car's shadow.
    shadow: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  };
  return mats;
}

// The glowing parts in one mesh, car local: the cluster face, the center
// screen and the two needles (their 8 vertices move every frame).
function buildFace(cab, eye, lay) {
  const P = [], U = [], I = [];
  const quad = (a, b, c, d, uv) => {
    const i0 = P.length / 3;
    P.push(...a, ...b, ...c, ...d);
    U.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  };
  // Cluster plane: faces the eye; u to the driver's right, v up.
  const c = [lay.clusterX, lay.clusterY, eye.z];
  const f = norm([eye.x - c[0], eye.y - c[1], 0]);
  const cu = [0, 0, 1], cv = cross(f, cu);
  const at = (x, y, dz = 0) => [c[0] + cu[0] * x + cv[0] * y + f[0] * dz, c[1] + cu[1] * x + cv[1] * y + f[1] * dz, c[2] + cu[2] * x + cv[2] * y + f[2] * dz];
  const W = lay.clusterW, H = lay.clusterH;
  quad(at(-W / 2, -H / 2), at(W / 2, -H / 2), at(W / 2, H / 2), at(-W / 2, H / 2), UV.cluster);
  // Center screen on the stack, tipped toward the driver.
  const sx = eye.x + lay.lipD(0) - 0.004, sy = lay.lipY(0) - 0.11, sw = 0.24, sh = 0.15;
  const yaw = Math.atan2(-eye.z, sx - eye.x) * 0.4;
  const zx = Math.sin(yaw), zz = Math.cos(yaw);
  quad([sx - zx * sw / 2, sy - sh, -zz * sw / 2], [sx + zx * sw / 2, sy - sh, zz * sw / 2], [sx + zx * sw / 2 - 0.02, sy, zz * sw / 2], [sx - zx * sw / 2 - 0.02, sy, -zz * sw / 2], UV.screen);
  // Needles: 4 vertices each, filled in by setNeedle.
  const n0 = P.length / 3;
  for (let k = 0; k < 2; k++) quad(at(0, 0), at(0, 0), at(0, 0), at(0, 0), UV.needle);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  const px = W / ATLAS.cluster[2]; // meters per atlas pixel
  const centers = [[(DIAL.rpmC[0] - ATLAS.cluster[2] / 2) * px, (ATLAS.cluster[3] / 2 - DIAL.rpmC[1]) * px], [(DIAL.mphC[0] - ATLAS.cluster[2] / 2) * px, (ATLAS.cluster[3] / 2 - DIAL.mphC[1]) * px]];
  const len = DIAL.r * px * 0.88;
  const pos = g.attributes.position;
  // Needle k at angle a (radians, counterclockwise from 3 o'clock on the dial).
  const setNeedle = (k, a) => {
    const [ox, oy] = centers[k];
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = [[-0.012, -0.0035], [len, -0.001], [len, 0.001], [-0.012, 0.0035]];
    for (let j = 0; j < 4; j++) {
      const x = ox + ca * pts[j][0] - sa * pts[j][1], y = oy + sa * pts[j][0] + ca * pts[j][1];
      const i = (n0 + k * 4 + j) * 3;
      pos.array[i] = c[0] + cu[0] * x + cv[0] * y + f[0] * 0.004;
      pos.array[i + 1] = c[1] + cu[1] * x + cv[1] * y + f[1] * 0.004;
      pos.array[i + 2] = c[2] + cu[2] * x + cv[2] * y + f[2] * 0.004;
    }
    pos.needsUpdate = true;
  };
  return { geometry: g, setNeedle, tris: I.length / 3, dialCenters: centers.map(([x, y]) => at(x, y)) };
}

// Build the interior for one car (spec, cabin, eye). Returns the group to
// add to the car's rig, its parts and `update(vehicle)`.
export function buildInterior(spec, cab, eye) {
  const lay = interiorLayout(cab, eye, spec);
  const m = materials();
  const group = new THREE.Group();
  group.name = 'rw-interior';
  const shellKit = buildShell(cab, eye, lay);
  const shell = new THREE.Mesh(shellKit.geometry(), m.shell);
  group.add(shell);
  // Steering wheel: a mount facing the driver along the tilted column,
  // a spinner inside it that turns with the input.
  const mount = new THREE.Group();
  mount.position.set(lay.wheelX, lay.wheelY, eye.z);
  // +z of the mount: from the hub up the column toward the driver.
  mount.lookAt(lay.wheelX - Math.cos(lay.tilt), lay.wheelY + Math.sin(lay.tilt), eye.z);
  const spinner = new THREE.Group();
  mount.add(spinner);
  const wheelKit = buildWheel(lay);
  const wheel = new THREE.Mesh(wheelKit.geometry(), m.shell);
  spinner.add(wheel);
  group.add(mount);
  // Dials, needles and the screen.
  const faceKit = buildFace(cab, eye, lay);
  const face = new THREE.Mesh(faceKit.geometry, m.face);
  group.add(face);
  // The interior is opaque and near; keep it out of shadows (no flicker inside).
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
  const tris = shellKit.tris + wheelKit.tris + faceKit.tris;
  const state = { wheelDeg: 0, mph: 0, rpm: 0, speedAngle: 0, rpmAngle: 0 };
  const it = {
    group, shell, wheel, spinner, mount, face, layout: lay, tris, state,
    parts: shellKit.parts, wheelParts: wheelKit.parts, dialCenters: faceKit.dialCenters,
    textured: !!m.shell.map,
    update(v) {
      const steer = Math.max(-1, Math.min(1, (v && v.steer) || 0));
      state.wheelDeg = steer * WHEEL_MAX_DEG;
      // Turning right is clockwise as the driver sees it (+z faces him).
      spinner.rotation.z = (-state.wheelDeg * Math.PI) / 180;
      const mph = Math.abs((v && v.speed) || 0) * 2.23694;
      state.mph = mph;
      state.rpm = Math.max(0, Math.min(1, (v && v.rpm) || 0));
      state.speedAngle = DIAL.start - Math.min(1, mph / DIAL.mph) * DIAL.sweep;
      state.rpmAngle = DIAL.start - Math.min(1, (state.rpm * 7) / DIAL.rpm) * DIAL.sweep;
      faceKit.setNeedle(0, state.rpmAngle);
      faceKit.setNeedle(1, state.speedAngle);
    },
  };
  it.update(null);
  return it;
}

// ---- attaching to a car mesh ----------------------------------------------------
// Puts the interior into a car's rig and hides the exterior (every mesh
// under the rig, through its layer mask so LOD switching cannot bring it
// back) except a front shell (hood and fenders). Returns a handle whose
// `detach()` restores the car exactly.
const interiors = new Map();
export function attachInterior(vehicle) {
  const mesh = vehicle && vehicle.mesh;
  const ud = mesh && mesh.userData;
  if (!ud || !ud.rig) return null;
  const spec = vehicle.spec || ud.spec;
  const geo = carGeometry(mesh);
  const cab = measureCabin(spec, geo.body, geo.glass);
  const eye = eyePoint(spec, cab);
  const key = spec.id + ':' + (geo.body ? geo.body.uuid : '-') + ':' + eye.x.toFixed(3) + eye.y.toFixed(3) + eye.z.toFixed(3);
  let it = interiors.get(key);
  if (!it) {
    it = buildInterior(spec, cab, eye);
    interiors.set(key, it);
  }
  const hidden = [];
  ud.rig.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
      hidden.push(o, o.layers.mask);
      o.layers.mask = 0;
    }
  });
  const m = materials();
  const bodyMesh = ud.body || null;
  let front = null, shadow = null;
  if (geo.body) {
    front = new THREE.Mesh(frontShell(geo.body, cab), bodyMesh ? bodyMesh.material : m.shell);
    front.receiveShadow = !!(bodyMesh && bodyMesh.receiveShadow);
    front.castShadow = false;
    shadow = new THREE.Mesh(geo.body, m.shadow);
    shadow.castShadow = true;
    shadow.renderOrder = -1;
    ud.rig.add(front, shadow);
    front.updateMatrix();
    shadow.updateMatrix();
  }
  ud.rig.add(it.group);
  it.update(vehicle);
  return {
    vehicle, mesh, interior: it, cab, eye, front, shadow,
    update(v) {
      // A damaged car swaps its paint: keep the hood in step.
      if (front && bodyMesh && front.material !== bodyMesh.material) front.material = bodyMesh.material;
      it.update(v);
    },
    detach() {
      ud.rig.remove(it.group);
      if (front) ud.rig.remove(front, shadow);
      for (let i = 0; i < hidden.length; i += 2) hidden[i].layers.mask = hidden[i + 1];
      hidden.length = 0;
    },
  };
}
