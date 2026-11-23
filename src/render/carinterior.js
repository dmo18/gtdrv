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
// can be (`fromSpec` says which).
export function eyePoint(spec, cab) {
  if (cab.eye) return cab.eye;
  if (validEye(spec.eye) && spec.eye.z < 0 && inCabin(cab, spec.eye)) {
    cab.eye = { x: spec.eye.x, y: spec.eye.y, z: spec.eye.z, fromSpec: true };
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
  cab.eye = { x, y, z, fromSpec: false };
  return cab.eye;
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
const _col = new THREE.Color();
class Kit {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  get tris() { return this.i.length / 3; }
  vert(x, y, z, nx, ny, nz, hex, shade = 1) {
    _col.setHex(hex);
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(_col.r * shade, _col.g * shade, _col.b * shade);
    return this.p.length / 3 - 1;
  }
  // A flat quad a b c d (either winding: the material is double sided).
  quad(a, b, c, d, hex, shade = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, hex, shade);
    this.vert(b[0], b[1], b[2], nx, ny, nz, hex, shade);
    this.vert(c[0], c[1], c[2], nx, ny, nz, hex, shade);
    this.vert(d[0], d[1], d[2], nx, ny, nz, hex, shade);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  // A box on three axes (unit vectors u, v, w) around a center.
  obox(cx, cy, cz, u, v, w, su, sv, sw, hex, skip = '') {
    const P = (a, b, c) => [cx + u[0] * a * su / 2 + v[0] * b * sv / 2 + w[0] * c * sw / 2, cy + u[1] * a * su / 2 + v[1] * b * sv / 2 + w[1] * c * sw / 2, cz + u[2] * a * su / 2 + v[2] * b * sv / 2 + w[2] * c * sw / 2];
    if (!skip.includes('u')) this.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), hex, 0.95);
    if (!skip.includes('U')) this.quad(P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), hex, 0.95);
    if (!skip.includes('v')) this.quad(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), hex);
    if (!skip.includes('V')) this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), hex, 0.8);
    if (!skip.includes('w')) this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), hex, 0.9);
    if (!skip.includes('W')) this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), hex, 0.9);
  }
  box(cx, cy, cz, sx, sy, sz, hex, skip = '') {
    this.obox(cx, cy, cz, X, Y, Z, sx, sy, sz, hex, skip);
  }
  // A bar from p0 to p1 with a cross-section w x d; `side` points to the
  // bar's flat face.
  bar(p0, p1, side, w, d, hex) {
    const t = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const k = side[0] * t[0] + side[1] * t[1] + side[2] * t[2];
    const a = norm([side[0] - t[0] * k, side[1] - t[1] * k, side[2] - t[2] * k]);
    const b = cross(t, a);
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    this.obox((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, t, a, b, len, d, w, hex, 'uU');
  }
  // A torus around the origin in the xy plane (smooth normals).
  torus(R, r, segU, segV, hex, mark = null) {
    const base = this.p.length / 3;
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      const h = mark && Math.abs(Math.atan2(Math.sin(u - Math.PI / 2), Math.cos(u - Math.PI / 2))) < mark.half ? mark.hex : hex;
      for (let j = 0; j <= segV; j++) {
        const v = (j / segV) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        this.vert((R + r * cv) * cu, (R + r * cv) * su, r * sv, cv * cu, cv * su, sv, h);
      }
    }
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = base + i * (segV + 1) + j, b = a + segV + 1;
        this.i.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  // A capped cylinder along z from z0 to z1 around (x, y).
  cyl(x, y, z0, z1, r, seg, hex, cap = true) {
    const base = this.p.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      this.vert(x + c * r, y + s * r, z0, c, s, 0, hex, 0.9);
      this.vert(x + c * r, y + s * r, z1, c, s, 0, hex, 0.9);
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
        this.vert(x + Math.cos(a) * r, y + Math.sin(a) * r, z1, 0, 0, 1, hex);
      }
      for (let i = 0; i < seg; i++) this.i.push(c0, ring + i, ring + i + 1);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// Interior colors (dark, original, no brand marks).
const COL = {
  dash: 0x26272a, dashTop: 0x1b1c1e, binnacle: 0x141517, trim: 0x3a3b3e, door: 0x34353a, doorTop: 0x232427,
  liner: 0x8e8a82, pillar: 0x45433f, seat: 0x2f2c29, seatSide: 0x3b3733, floor: 0x1c1c1c, console: 0x222326,
  vent: 0x0d0e0f, mirror: 0x9aaab8, mirrorFrame: 0x151617, rim: 0x151515, spoke: 0x2c2d30, hub: 0x1f2022, mark: 0xc9b48a,
  strip: 0x6d6f73, screen: 0x0c1620,
};

// Where the parts sit for one cabin and eye (car local). Exported for the
// tests (wheel hub, cluster).
export function interiorLayout(cab, eye) {
  const s = cab.at(eye.x);
  const roof = s.roofY != null ? s.roofY - 0.035 : null;
  const hw = Math.max(0.45, s.hwBelt - 0.03); // door panel half width
  const dashLipX = Math.min(eye.x + 0.6, cab.wsX - 0.18);
  const dashLipY = Math.min(eye.y - 0.27, cab.wsY + 0.03);
  const wheelX = eye.x + 0.45, wheelY = eye.y - 0.33;
  const clusterX = Math.min(eye.x + 0.7, cab.wsX - 0.1), clusterY = eye.y - 0.2;
  return { s, roof, hw, dashLipX, dashLipY, wheelX, wheelY, wheelR: 0.185, tilt: 24 * Math.PI / 180, clusterX, clusterY, clusterW: 0.34, clusterH: 0.136 };
}

function buildShell(cab, eye, lay) {
  const k = new Kit();
  const { s, hw } = lay;
  const ez = eye.z;
  const wsX = cab.wsX, wsY = cab.wsY;
  const floor = cab.floorY;
  const rearX = Math.max(cab.rearX + 0.15, eye.x - 1.6);
  const belt = s.beltY - 0.005;
  // Dashboard: a top from the glass back to the lip (5 strips across),
  // the lip face and the lower dash down to the knees.
  const NZ = 8;
  const dashW = Math.min(hw, cab.hwBase + 0.02);
  const lipY = lay.dashLipY;
  for (let i = 0; i < NZ; i++) {
    const z0 = -dashW + (2 * dashW * i) / NZ, z1 = -dashW + (2 * dashW * (i + 1)) / NZ;
    const glassY = wsY - 0.01;
    k.quad([wsX - 0.01, glassY, z0], [wsX - 0.01, glassY, z1], [lay.dashLipX + 0.08, lipY + 0.015, z1], [lay.dashLipX + 0.08, lipY + 0.015, z0], COL.dashTop);
    k.quad([lay.dashLipX + 0.08, lipY + 0.015, z0], [lay.dashLipX + 0.08, lipY + 0.015, z1], [lay.dashLipX, lipY, z1], [lay.dashLipX, lipY, z0], COL.dash, 1.1);
    k.quad([lay.dashLipX, lipY, z0], [lay.dashLipX, lipY, z1], [lay.dashLipX + 0.004, lipY - 0.018, z1], [lay.dashLipX + 0.004, lipY - 0.018, z0], COL.strip);
    k.quad([lay.dashLipX + 0.004, lipY - 0.018, z0], [lay.dashLipX + 0.004, lipY - 0.018, z1], [lay.dashLipX + 0.05, lipY - 0.2, z1], [lay.dashLipX + 0.05, lipY - 0.2, z0], COL.dash, 0.85);
    k.quad([lay.dashLipX + 0.05, lipY - 0.2, z0], [lay.dashLipX + 0.05, lipY - 0.2, z1], [lay.dashLipX + 0.22, floor + 0.12, z1], [lay.dashLipX + 0.22, floor + 0.12, z0], COL.dash, 0.6);
  }
  // Dash ends against the doors.
  for (const sg of [-1, 1]) {
    const z = sg * dashW;
    k.quad([wsX - 0.01, wsY - 0.01, z], [lay.dashLipX, lipY, z], [lay.dashLipX + 0.22, floor + 0.12, z], [wsX - 0.01, floor + 0.12, z], COL.dash, 0.7);
  }
  // Vents: two in the middle, one at each end.
  for (const vz of [-0.12, 0.12, -dashW + 0.1, dashW - 0.1]) {
    k.quad([lay.dashLipX - 0.002, lipY - 0.03, vz - 0.06], [lay.dashLipX - 0.002, lipY - 0.03, vz + 0.06], [lay.dashLipX + 0.006, lipY - 0.075, vz + 0.06], [lay.dashLipX + 0.006, lipY - 0.075, vz - 0.06], COL.vent);
  }
  // Gauge binnacle: a hood over the cluster in front of the driver.
  const bx0 = lay.clusterX - 0.07, bx1 = lay.clusterX + 0.16;
  const bTop = lay.clusterY + lay.clusterH / 2 + 0.035;
  const bw = lay.clusterW / 2 + 0.035;
  const NB = 10;
  let prev = null;
  for (let i = 0; i <= NB; i++) {
    const a = Math.PI * (i / NB);
    const z = ez - Math.cos(a) * bw;
    const h = Math.sin(a) ** 0.45;
    const y = lipY + (bTop - lipY) * h;
    // Visor edge (toward the driver), crown, back down to the dash top.
    const cur = [[bx0, y - 0.012 * h, z], [bx0 + 0.04, y, z], [bx1, lipY + (bTop - lipY) * h * 0.55, z]];
    if (prev) {
      k.quad(prev[0], cur[0], cur[1], prev[1], COL.binnacle, 1.15);
      k.quad(prev[1], cur[1], cur[2], prev[2], COL.binnacle);
    }
    prev = cur;
  }
  // The cluster's back wall and the sides of its well.
  k.quad([lay.clusterX + 0.025, lipY - 0.02, ez - bw], [lay.clusterX + 0.025, lipY - 0.02, ez + bw], [lay.clusterX + 0.025, bTop, ez + bw], [lay.clusterX + 0.025, bTop, ez - bw], COL.vent);
  for (const sg of [-1, 1]) {
    const z = ez + sg * bw;
    k.quad([bx0, lipY, z], [lay.clusterX + 0.025, lipY - 0.02, z], [lay.clusterX + 0.025, lipY + 0.02, z], [bx0, lipY + 0.01, z], COL.binnacle, 0.7);
  }
  // Center stack and console to the seats.
  k.box(lay.dashLipX + 0.06, lipY - 0.18, 0, 0.16, 0.3, 0.24, COL.console, 'U');
  k.quad([lay.dashLipX - 0.021, lipY - 0.035, -0.1], [lay.dashLipX - 0.021, lipY - 0.035, 0.1], [lay.dashLipX - 0.021, lipY - 0.15, 0.1], [lay.dashLipX - 0.021, lipY - 0.15, -0.1], COL.screen);
  // Climate knobs under the screen, a gear selector on the console.
  for (const kz of [-0.06, 0, 0.06]) k.box(lay.dashLipX - 0.03, lipY - 0.19, kz, 0.02, 0.03, 0.03, COL.strip);
  k.box(eye.x + 0.28, floor + 0.43, 0, 0.06, 0.14, 0.04, COL.trim);
  k.box(eye.x + 0.28, floor + 0.51, 0, 0.07, 0.04, 0.05, COL.strip);
  const consoleTop = floor + 0.36;
  k.box((lay.dashLipX + eye.x - 0.25) / 2, (consoleTop + floor) / 2, 0, lay.dashLipX - eye.x + 0.25, consoleTop - floor, 0.22, COL.console, 'u');
  // Floor.
  k.quad([wsX, floor, -hw], [wsX, floor, hw], [rearX, floor, hw], [rearX, floor, -hw], COL.floor);
  // Doors: the door top (belt), the inner panel with an armrest, both sides
  // from the dash to the cabin rear.
  for (const sg of [-1, 1]) {
    const zo = sg * (s.hwBelt + 0.005), zi = sg * hw, zp = sg * (hw - 0.05);
    const x0 = wsX - 0.02, x1 = rearX;
    k.quad([x0, belt, zo], [x1, belt, zo], [x1, belt, zi], [x0, belt, zi], COL.doorTop, 1.05);
    k.quad([x0, belt, zi], [x1, belt, zi], [x1, belt - 0.06, zp], [x0, belt - 0.06, zp], COL.trim);
    k.quad([x0, belt - 0.06, zp], [x1, belt - 0.06, zp], [x1, floor, zp], [x0, floor, zp], COL.door, 0.85);
    // Armrest.
    k.box(eye.x - 0.05, belt - 0.22, sg * (hw - 0.09), 0.5, 0.05, 0.09, COL.trim);
    // Door grab handle, window switches, speaker grille, map pocket.
    k.box(eye.x + 0.25, belt - 0.12, sg * (hw - 0.055), 0.12, 0.03, 0.012, 0x55585c);
    k.box(eye.x + 0.05, belt - 0.195, sg * (hw - 0.09), 0.12, 0.012, 0.05, 0x111214);
    k.box(eye.x + 0.38, floor + 0.2, sg * (hw - 0.05), 0.2, 0.16, 0.012, 0x1a1b1d);
    k.box(eye.x + 0.1, floor + 0.12, sg * (hw - 0.07), 0.45, 0.1, 0.04, COL.trim, 'U');
  }
  // A-pillars along the windshield edges, the header, the headliner.
  const roofY = lay.roof != null ? lay.roof : null;
  const hTop = roofY != null ? Math.min(roofY, cab.rfY - 0.02) : cab.rfY - 0.02;
  for (const sg of [-1, 1]) {
    const p0 = [wsX - 0.03, wsY + 0.01, sg * (cab.hwBase - 0.01)];
    const p1 = [cab.rfX - 0.02, hTop, sg * (cab.hwHead - 0.02)];
    k.bar(p0, p1, [-0.3, 0.4, -sg], 0.085, 0.05, COL.pillar);
  }
  if (roofY != null) {
    const hwR = Math.max(cab.hwHead, s.hwTop) - 0.01;
    k.bar([cab.rfX - 0.03, hTop - 0.02, -hwR], [cab.rfX - 0.03, hTop - 0.02, hwR], [-1, -0.4, 0], 0.08, 0.04, COL.liner);
    const NR = 4;
    for (let i = 0; i < NR; i++) {
      const xa = cab.rfX - 0.05 - ((cab.rfX - 0.05 - rearX) * i) / NR, xb = cab.rfX - 0.05 - ((cab.rfX - 0.05 - rearX) * (i + 1)) / NR;
      k.quad([xa, roofY, -hwR], [xa, roofY, hwR], [xb, roofY, hwR], [xb, roofY, -hwR], COL.liner, 0.95 - i * 0.04);
    }
    // Side rails down to the side glass top, B- and C-pillars.
    for (const sg of [-1, 1]) {
      k.quad([cab.rfX - 0.05, roofY, sg * hwR], [rearX, roofY, sg * hwR], [rearX, s.topY, sg * (s.hwTop + 0.01)], [cab.rfX - 0.05, s.topY, sg * (s.hwTop + 0.01)], COL.pillar, 0.9);
      const bxp = eye.x - 0.42;
      k.bar([bxp, belt, sg * (s.hwBelt - 0.02)], [bxp, roofY, sg * (s.hwTop - 0.02)], [0, 0, -sg], 0.12, 0.05, COL.pillar);
      k.bar([rearX + 0.08, belt, sg * (s.hwBelt - 0.02)], [rearX + 0.2, roofY, sg * (s.hwTop - 0.02)], [0, 0, -sg], 0.24, 0.05, COL.pillar);
    }
    // Rear-view mirror: stem, frame, glass, angled toward the driver.
    // On the glass a little below its top edge, at least 0.42 m ahead of the eye.
    const t = Math.min(0.6, Math.max(0.16, (eye.x + 0.48 - cab.rfX) / Math.max(0.1, cab.wsX - cab.rfX)));
    const gx = cab.rfX + t * (cab.wsX - cab.rfX), gy = cab.rfY - t * (cab.rfY - cab.wsY);
    const mx = gx - 0.06, my = Math.max(gy - 0.07, eye.y + 0.05);
    k.bar([gx + 0.005, gy, 0], [mx + 0.012, my + 0.02, 0], [0, 0, 1], 0.025, 0.02, COL.mirrorFrame);
    const yaw = Math.atan2(-ez, mx - eye.x) * 0.5;
    const u = [Math.sin(yaw), 0, Math.cos(yaw)], w = [Math.cos(yaw), 0, -Math.sin(yaw)];
    k.obox(mx, my, 0, u, Y, w, 0.25, 0.07, 0.03, COL.mirrorFrame);
    k.obox(mx - 0.016 * w[0], my, -0.016 * w[2], u, Y, w, 0.225, 0.052, 0.002, COL.mirror);
    // Sun visors folded up against the headliner.
    for (const sg of [-1, 1]) k.box(cab.rfX - 0.12, roofY - 0.015, sg * hwR * 0.5, 0.16, 0.02, hwR * 0.8, COL.liner, '');
  }
  // Seats: driver's (seen when looking down and back), passenger's, rear bench.
  // The driver's own seat is only its cushion (its back and headrest
  // would fill the view when the head turns).
  const seat = (sx, sz, w, own) => {
    const cy = floor + 0.24;
    k.box(sx + 0.06, cy, sz, 0.5, 0.12, w, COL.seat);
    if (own) return;
    const back0 = [sx - 0.2, cy + 0.05, sz], back1 = [sx - 0.3, eye.y - 0.08, sz];
    k.bar(back0, back1, [1, 0, 0], w, 0.12, COL.seat);
    // Side bolsters on the cushion and the back, the headrest.
    for (const b of [-1, 1]) {
      k.box(sx + 0.06, cy + 0.06, sz + b * (w / 2 - 0.04), 0.46, 0.06, 0.08, COL.seatSide);
      k.bar([back0[0] + 0.04, back0[1], sz + b * (w / 2 - 0.04)], [back1[0] + 0.04, back1[1] - 0.1, sz + b * (w / 2 - 0.04)], [1, 0, 0], 0.08, 0.1, COL.seatSide);
    }
    k.box(sx - 0.31, eye.y + 0.0, sz, 0.09, 0.14, 0.24, COL.seatSide);
  };
  // Pedals under the dash in front of the driver.
  for (const pz of [-0.1, 0.02, 0.13]) k.obox(lay.dashLipX + 0.16, floor + 0.12, ez + pz, [0.5, 0.87, 0], [-0.87, 0.5, 0], Z, 0.1, 0.012, pz > 0.1 ? 0.06 : 0.08, 0x2a2a2a);
  seat(eye.x - 0.02, ez, 0.5, true);
  seat(eye.x - 0.02, -ez, 0.5, false);
  if (eye.x - rearX > 1.05) {
    const rx = rearX + 0.35;
    k.box(rx, floor + 0.22, 0, 0.45, 0.12, hw * 1.9, COL.seat);
    const top = Math.min(belt + 0.12, (roofY || belt + 0.3) - 0.15);
    k.bar([rx - 0.18, floor + 0.28, 0], [rx - 0.28, top, 0], [1, 0, 0], hw * 1.9, 0.1, COL.seat);
    for (const hz of [-0.55, 0, 0.55]) k.box(rx - 0.29, top + 0.07, hz * hw, 0.08, 0.12, 0.22, COL.seatSide);
  }
  return k;
}

function buildWheel(lay) {
  const k = new Kit();
  // In the wheel's own frame: rim in the xy plane, +z toward the driver.
  k.torus(lay.wheelR, 0.019, 48, 8, COL.rim, { half: 0.1, hex: COL.mark });
  // Three spokes: 3, 9 and 6 o'clock.
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const c = Math.cos(a), s = Math.sin(a);
    k.bar([c * 0.05, s * 0.05, 0.012], [c * (lay.wheelR - 0.01), s * (lay.wheelR - 0.01), 0], [-s, c, 0], 0.045, 0.014, COL.spoke);
  }
  // Hub and horn pad, the column behind.
  k.cyl(0, 0, -0.01, 0.035, 0.062, 16, COL.hub);
  k.cyl(0, 0, -0.3, -0.01, 0.034, 8, COL.spoke, false);
  return k;
}

// Gauge face: tach on the left, speedometer (mph) on the right.
const DIAL = { start: (225 * Math.PI) / 180, sweep: (270 * Math.PI) / 180, mph: 160, rpm: 8, red: 6.5 };
let faceTex = null;
function gaugeTexture() {
  if (faceTex !== null) return faceTex;
  faceTex = false;
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return faceTex;
  try {
    const cv = doc.createElement('canvas');
    cv.width = 512; cv.height = 204;
    const g = cv.getContext('2d');
    if (!g) return faceTex;
    g.fillStyle = '#0a0b0d';
    g.fillRect(0, 0, 512, 204);
    const dial = (cx, cy, r, max, step, minor, label, red) => {
      g.fillStyle = '#121418';
      g.beginPath(); g.arc(cx, cy, r + 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3c4047'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.stroke();
      for (let v = 0; v <= max + 1e-6; v += minor) {
        const a = DIAL.start - (v / max) * DIAL.sweep;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const r0 = major ? r - 16 : r - 9;
        g.strokeStyle = red != null && v >= red ? '#e0412f' : '#e9e9e4';
        g.lineWidth = major ? 4 : 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r, cy - Math.sin(a) * r);
        g.stroke();
        if (major) {
          g.fillStyle = red != null && v >= red ? '#e0412f' : '#f2f2ee';
          g.font = 'bold 25px sans-serif';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(v), cx + Math.cos(a) * (r - 35), cy - Math.sin(a) * (r - 35));
        }
      }
      g.fillStyle = '#9ea3aa';
      g.font = 'bold 15px sans-serif';
      g.fillText(label, cx, cy - r * 0.36);
    };
    dial(128, 102, 88, DIAL.rpm, 1, 0.5, 'x1000 RPM', DIAL.red);
    dial(384, 102, 88, DIAL.mph, 20, 10, 'MPH', null);
    faceTex = new THREE.CanvasTexture(cv);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    faceTex.anisotropy = 4;
  } catch {
    faceTex = false;
  }
  return faceTex;
}

let mats = null;
function materials() {
  if (mats) return mats;
  const tex = gaugeTexture();
  mats = {
    // A little self light: the cabin is in the roof's shade and the bounce
    // light fills it.
    shell: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x1a1a1a }),
    face: new THREE.MeshBasicMaterial(tex ? { map: tex, toneMapped: false } : { color: 0x15171a }),
    needle: new THREE.MeshBasicMaterial({ color: 0xff5a1e, toneMapped: false, side: THREE.DoubleSide }),
    // Draws nothing, casts the car's shadow.
    shadow: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  };
  return mats;
}

let needleGeo = null;
function needleGeometry(len) {
  if (needleGeo) return needleGeo;
  needleGeo = new THREE.BufferGeometry();
  needleGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.008, -0.0025, 0, len, -0.0008, 0, len, 0.0008, 0, -0.008, 0.0025, 0], 3));
  needleGeo.setIndex([0, 1, 2, 0, 2, 3]);
  return needleGeo;
}

// Build the interior for one car (spec, cabin, eye). Returns the group to
// add to the car's rig, its parts and `update(vehicle)`.
export function buildInterior(spec, cab, eye) {
  const lay = interiorLayout(cab, eye);
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
  // Gauge cluster face looking at the eye, two needles.
  const cluster = new THREE.Group();
  cluster.position.set(lay.clusterX, lay.clusterY, eye.z);
  cluster.lookAt(eye.x, eye.y, eye.z);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(lay.clusterW, lay.clusterH), m.face);
  cluster.add(face);
  const dialR = (88 / 512) * lay.clusterW;
  const ng = needleGeometry(dialR * 0.86);
  const tach = new THREE.Mesh(ng, m.needle);
  tach.position.set(((128 / 512) - 0.5) * lay.clusterW, 0, 0.004);
  const speedo = new THREE.Mesh(ng, m.needle);
  speedo.position.set(((384 / 512) - 0.5) * lay.clusterW, 0, 0.004);
  cluster.add(tach, speedo);
  group.add(cluster);
  // The interior draws after the world's opaque pass would not help: it
  // is opaque and near; keep it out of shadows (no flicker inside).
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
  const tris = shellKit.tris + wheelKit.tris + 2 + 4;
  const state = { wheelDeg: 0, mph: 0, rpm: 0 };
  return {
    group, shell, wheel, spinner, mount, cluster, tach, speedo, layout: lay, tris, state,
    update(v) {
      const steer = Math.max(-1, Math.min(1, (v && v.steer) || 0));
      state.wheelDeg = steer * WHEEL_MAX_DEG;
      // Turning right is clockwise as the driver sees it (+z faces him).
      spinner.rotation.z = (-state.wheelDeg * Math.PI) / 180;
      const mph = Math.abs((v && v.speed) || 0) * 2.23694;
      state.mph = mph;
      state.rpm = Math.max(0, Math.min(1, (v && v.rpm) || 0));
      speedo.rotation.z = DIAL.start - Math.min(1, mph / DIAL.mph) * DIAL.sweep;
      tach.rotation.z = DIAL.start - Math.min(1, (state.rpm * 7) / DIAL.rpm) * DIAL.sweep;
    },
  };
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
