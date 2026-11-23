// Turns each building footprint from the city data into a believable
// building: a facade style picked by district and height, a ground
// floor of shops, setbacks and rooftop plant on towers, porches on
// houses, roller doors on sheds. Everything lands in shared builders.
import { createRng } from '../core/rng.js';
import { SIDEWALK } from '../world/citygen.js';
import { SHOP_NAMES } from './textures.js';
import { lookOf } from './miamilook.js';
import { softStrip } from './lotmesh.js';

export function shade(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
}
export function mixHex(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

const AWNINGS = [0xb5382f, 0x2f6b4f, 0x2c4a7a, 0xe0b040, 0x6a2a4a, 0xd8d2c0, 0x1f6f78, 0xc86a2a];
const ROOFS = [0xb0614c, 0x868a92, 0x94705a, 0x6d8496, 0x63666c];
const ROOF_FLAT = [0x77736b, 0x56585c, 0x8f8c84, 0x6a6660];
const STONE = 0xb9b4a8;
const WHITE = 0xffffff;

// The four sides of a rectangle, each with a local frame: `a` runs
// along the wall (left to right seen from outside), `o` points out.
// m: 1 north, 2 south, 4 west, 8 east (matches building.street).
export function sidesOf(x0, z0, x1, z1) {
  return [
    { m: 2, ax: x0, az: z1, tx: 1, tz: 0, nx: 0, nz: 1, L: x1 - x0 },
    { m: 1, ax: x1, az: z0, tx: -1, tz: 0, nx: 0, nz: -1, L: x1 - x0 },
    { m: 8, ax: x1, az: z1, tx: 0, tz: -1, nx: 1, nz: 0, L: z1 - z0 },
    { m: 4, ax: x0, az: z0, tx: 0, tz: 1, nx: -1, nz: 0, L: z1 - z0 },
  ];
}
const px = (s, a, o) => s.ax + s.tx * a + s.nx * o;
const pz = (s, a, o) => s.az + s.tz * a + s.nz * o;

// Upright picture on a wall: from a0 to a1 along side s, `o` out from it.
function panel(b, s, a0, a1, y0, y1, o, color, r, sh = 1) {
  b.wall(px(s, a0, o), pz(s, a0, o), px(s, a1, o), pz(s, a1, o), y0, y1, color, r.u0, r.v0, r.u1, r.v1, sh);
}
// Axis-aligned box given in a side's frame.
function frameBox(b, s, a0, a1, o0, o1, y0, y1, color, top = color, s0 = 1, s1 = s0) {
  const xa = px(s, a0, o0), xb = px(s, a1, o1), za = pz(s, a0, o0), zb = pz(s, a1, o1);
  b.box(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), y0, y1, color, top, s0, s1);
}
// Wall section in a side's frame with explicit texture span.
function span(b, s, a0, a1, y0, y1, o, color, u0, v0, u1, v1, s0 = 1, s1 = s0) {
  b.wall(px(s, a0, o), pz(s, a0, o), px(s, a1, o), pz(s, a1, o), y0, y1, color, u0, v0, u1, v1, s0, s1);
}

// Windowed walls: a whole number of bays and floors on every side so
// windows are never cut off. The textures hold 4 bays by 4 floors.
// The texture repeats every whole unit, so whole-number offsets change
// nothing by day; the night shader reads them back as a building number
// (v / 64) and a wall number (u / 16), so each building and floor gets
// its own pattern of lit windows. Taken from the position, not the
// shared random stream, so the rest of the city is unchanged.
function facadeKey(x, z, k) {
  let h = (Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663) ^ (k * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0);
}
function facadeWalls(fb, x0, z0, x1, z1, y0, y1, color, bay, floorH, rng, s0 = 1, s1 = 1) {
  const floors = Math.max(1, Math.round((y1 - y0) / floorH));
  const vo = rng.int(0, 3) / 4 + 64 * (facadeKey(x0, z0, Math.round(y0)) & 15);
  let k = 0;
  for (const s of sidesOf(x0, z0, x1, z1)) {
    const n = Math.max(1, Math.round(s.L / bay));
    const uo = rng.int(0, 3) / 4 + 16 * (facadeKey(x1, z1, ++k) & 63);
    span(fb, s, 0, s.L, y0, y1, 0, color, uo, vo, uo + n / 4, vo + floors / 4, s0, s1);
  }
  return floors;
}

// Flat roof sunk behind a parapet, with plant on top.
function flatRoof(C, b, x0, z0, x1, z1, y, capColor, rng, opts = {}) {
  const P = C.plain.at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
  const e = opts.cornice || 0;
  const drop = 0.7, pw = 0.35;
  const pickRoof = rng.pick(ROOF_FLAT);
  const roofCol = opts.roofCol || pickRoof;
  P.flat(x0 + pw, z0 + pw, x1 - pw, z1 - pw, y - drop, roofCol, 0.9);
  P.innerWalls(x0 + pw, z0 + pw, x1 - pw, z1 - pw, y - drop, y, capColor, 0.55, 0.85);
  P.ring(x0 - e, z0 - e, x1 + e, z1 + e, pw + e, y, capColor);
  if (e > 0) P.walls(x0 - e, z0 - e, x1 + e, z1 + e, y - 0.6, y, capColor, 1, 1, 0.8, 1);
  if (opts.tile) tileCoping(C, b, x0 - e, z0 - e, x1 + e, z1 + e, y, opts.tile);
  if (opts.rail) railing(C, b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, y, 1.0);
  const w = x1 - x0, d = z1 - z0;
  const ry = y - drop;
  if (Math.min(w, d) < 7) return;
  if (opts.plant && Math.min(w, d) > 16) {
    // Mechanical penthouse behind louvred screens.
    const ix = w * 0.28, iz = d * 0.28;
    P.box(x0 + ix, z0 + iz, x1 - ix, z1 - iz, ry, ry + 4.2, shade(capColor, 0.86), 0x8c8e90, 0.75, 1);
    P.walls(x0 + ix - 0.1, z0 + iz - 0.1, x1 - ix + 0.1, z1 - iz + 0.1, ry + 3.6, ry + 4.4, capColor, 1, 1, 1, 1);
  }
  // Stair bulkhead in a corner.
  const bx = rng.chance(0.5) ? x0 + 1.4 : x1 - 4.6, bz = rng.chance(0.5) ? z0 + 1.4 : z1 - 5.2;
  P.box(bx, bz, bx + 3.2, bz + 3.8, ry, ry + 2.7, shade(capColor, 0.85), shade(roofCol, 0.9), 0.7, 1);
  // Air handlers.
  const n = Math.min(5, Math.max(1, Math.floor((w * d) / 150)));
  for (let i = 0; i < n; i++) {
    const ax = rng.range(x0 + 1.5, x1 - 4), az = rng.range(z0 + 1.5, z1 - 3.5);
    if (ax < bx + 3.6 && ax + 2.2 > bx - 0.4 && az < bz + 4.2 && az + 1.5 > bz - 0.4) continue;
    P.box(ax, az, ax + rng.range(1.6, 2.4), az + rng.range(1.2, 1.6), ry, ry + rng.range(0.9, 1.5), 0xb4b6b8, 0x8e9092, 0.65, 1);
  }
  if (opts.tank && Math.min(w, d) > 11) {
    // Timber water tank on legs.
    const tx = (x0 + x1) / 2 + rng.range(-2, 2), tz = (z0 + z1) / 2 + rng.range(-2, 2);
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) P.box(tx + ox - 0.08, tz + oz - 0.08, tx + ox + 0.08, tz + oz + 0.08, ry, ry + 1.8, 0x3c3c40);
    P.cyl(tx, tz, ry + 1.8, ry + 4.3, 1.45, 1.45, 8, 0x7a5a40, false, 0.75, 1);
    P.cyl(tx, tz, ry + 4.3, ry + 5.2, 1.6, 0.05, 8, 0x4c4a48);
  }
  if (opts.mast) {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, mh = opts.mast;
    P.box(mx - 2.2, mz - 2.2, mx + 2.2, mz + 2.2, ry, ry + 3.4, 0x8c9096, 0x6c7076, 0.7, 1);
    P.cyl(mx, mz, ry + 3.4, ry + 3.4 + mh, 0.22, 0.06, 5, 0xd8d8d8);
    C.glows.push({ x: mx, y: ry + 3.5 + mh, z: mz, r: 1, g: 0.12, b: 0.08, size: 2.6 });
    C.glow.at(mx, mz).box(mx - 0.15, mz - 0.15, mx + 0.15, mz + 0.15, ry + 3.3 + mh, ry + 3.6 + mh, 0xff3020);
  }
}

// Shop signs and awnings along one street-facing side.
function shopRow(C, b, s, gf, rng) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const D = C.detail.at(cx, cz), P = C.plain.at(cx, cz);
  const n = Math.max(1, Math.floor(s.L / 8));
  const slot = s.L / n;
  for (let i = 0; i < n; i++) {
    const mid = (i + 0.5) * slot;
    if (rng.chance(0.82)) {
      const w = Math.min(5.6, slot - 1.6), h = Math.min(1.05, w / 4);
      const r = C.R['sign' + rng.int(0, SHOP_NAMES.length - 1)];
      panel(D, s, mid - w / 2, mid + w / 2, gf - 0.12 - h, gf - 0.12, 0.1, WHITE, r);
    }
    if (rng.chance(0.45)) {
      const w = Math.min(slot - 1.2, 6.5), col = rng.pick(AWNINGS);
      const a0 = mid - w / 2, a1 = mid + w / 2, yT = gf - 1.25, yB = gf - 1.85, out = 1.25;
      const k = Math.hypot(out, yT - yB);
      const ny = out / k, nh = (yT - yB) / k;
      // Sloping top, its underside, the front valance and the two cheeks.
      P.quad(px(s, a0, out), yB, pz(s, a0, out), px(s, a1, out), yB, pz(s, a1, out), px(s, a1, 0.02), yT, pz(s, a1, 0.02), px(s, a0, 0.02), yT, pz(s, a0, 0.02), col, s.nx * nh, ny, s.nz * nh);
      P.quad(px(s, a1, out), yB, pz(s, a1, out), px(s, a0, out), yB, pz(s, a0, out), px(s, a0, 0.02), yT, pz(s, a0, 0.02), px(s, a1, 0.02), yT, pz(s, a1, 0.02), shade(col, 0.5), -s.nx * nh, -ny, -s.nz * nh);
      span(P, s, a0, a1, yB - 0.22, yB, out, shade(col, 0.85), 0, 0, 1, 1);
      P.tri(px(s, a1, out), yB, pz(s, a1, out), px(s, a1, 0.02), yB, pz(s, a1, 0.02), px(s, a1, 0.02), yT, pz(s, a1, 0.02), shade(col, 0.8), s.tx, 0, s.tz);
      P.tri(px(s, a0, 0.02), yB, pz(s, a0, 0.02), px(s, a0, out), yB, pz(s, a0, out), px(s, a0, 0.02), yT, pz(s, a0, 0.02), shade(col, 0.8), -s.tx, 0, -s.tz);
    }
  }
}

function tower(C, b) {
  const rng = createRng(b.vseed);
  const { x0, z0, x1, z1, h } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = C.plain.at(cx, cz);
  // The real Miami map: a look from the neighborhood (miamilook.js).
  const L = lookOf(C.city, b);
  const style = L ? L.style : b.style;
  const F = C[style].at(cx, cz);
  const minDim = Math.min(x1 - x0, z1 - z0);
  const gf = Math.min(style === 'glass' ? 5.2 : 4.2, h * 0.45);
  const tint = L ? L.tint : b.tint;
  const bay = style === 'glass' ? 3 : style === 'office' ? 3.4 : style === 'stucco' || style === 'havana' ? 3.6 : 3.1;
  const floorH = style === 'glass' ? 3.7 : style === 'office' ? 3.5 : style === 'havana' ? 3.6 : 3.25;
  const trim = L ? L.trim : style === 'glass' ? 0x7c8288 : style === 'brick' ? STONE : style === 'stucco' ? mixHex(tint, WHITE, 0.6) : mixHex(tint, 0xc0c0c0, 0.5);

  // Ground floor: shopfronts onto streets, blank service walls behind.
  const S = C.shopfront.at(cx, cz);
  for (const s of sidesOf(x0, z0, x1, z1)) {
    if ((b.street & s.m) && s.L >= 5 && b.block >= 0) {
      const n = Math.max(1, Math.round(s.L / 4));
      const uo = rng.int(0, 3) / 4;
      span(S, s, 0, s.L, 0.16, gf, 0, trim, uo, 0, uo + n / 4, 1, 0.68, 1);
      shopRow(C, b, s, gf, rng);
    } else {
      span(P, s, 0, s.L, 0.16, gf, 0, L ? shade(tint, 0.86) : shade(trim, 0.72), 0, 0, 1, 1, 0.55, 0.92);
    }
  }
  if (style === 'brick' || style === 'stucco' || style === 'havana') P.walls(x0 - 0.12, z0 - 0.12, x1 + 0.12, z1 + 0.12, gf - 0.05, gf + 0.3, trim, 1, 1, 0.85, 1);
  if (L) groundFloor(C, b, L, style, gf, trim, tint, rng);

  // Upper storeys, stepping back on tall towers.
  const tiers = [];
  if (h > 45 && minDim > 17 && (style === 'glass' || style === 'office')) {
    const i1 = rng.range(2, 3.4), i2 = i1 + rng.range(1.6, 3);
    const y1 = h * rng.range(0.5, 0.68), y2 = h * rng.range(0.84, 0.93);
    tiers.push({ i: 0, y0: gf, y1 });
    if (minDim - 2 * i2 > 8 && rng.chance(0.75)) tiers.push({ i: i1, y0: y1, y1: y2 }, { i: i2, y0: y2, y1: h });
    else tiers.push({ i: i1, y0: y1, y1: h });
  } else tiers.push({ i: 0, y0: gf, y1: h });

  let floors = 1;
  tiers.forEach((t, k) => {
    const ax0 = x0 + t.i, az0 = z0 + t.i, ax1 = x1 - t.i, az1 = z1 - t.i;
    floors = facadeWalls(F, ax0, az0, ax1, az1, t.y0, t.y1, tint, bay, floorH, rng, k === 0 ? 1 : 0.8, 1);
    if (L) relief(C, b, L, style, ax0, az0, ax1, az1, t.y0, t.y1, floors, bay, trim, tint, k === 0);
    if (k < tiers.length - 1) {
      const nx = tiers[k + 1].i - t.i;
      P.ring(ax0, az0, ax1, az1, nx + 0.05, t.y1, L ? L.roof : rng.pick(ROOF_FLAT), 1, 0.6);
      P.walls(ax0 - 0.08, az0 - 0.08, ax1 + 0.08, az1 + 0.08, t.y1 - 0.4, t.y1 + 0.25, trim, 1, 1, 0.9, 1);
      if (L) railing(C, b, ax0 + nx, az0 + nx, ax1 - nx, az1 - nx, t.y1, 1.05);
    } else if (L && L.tile && minDim < 16 && h < 16) {
      hipRoof(C, b, ax0, az0, ax1, az1, t.y1, terracotta(b), trim);
    } else {
      flatRoof(C, b, ax0, az0, ax1, az1, t.y1, trim, rng, {
        cornice: style === 'brick' ? 0.28 : style === 'stucco' || style === 'havana' ? 0.15 : 0.04,
        tank: (style === 'brick' && h < 40 && rng.chance(0.5)) || (L && h > 12 && h < 45 && (b.vseed & 7) === 3),
        mast: h > 72 ? h * rng.range(0.1, 0.2) : 0,
        roofCol: L ? L.roof : 0,
        tile: L && L.tile ? terracotta(b) : 0,
        rail: L && h >= 20 && !L.tile,
        plant: L && h > 45,
      });
    }
  });
  if (L && L.deco) deco(C, b, L, gf, h, floors, trim, tint);
  if (L && L.balconies) balconies(C, b, L, tiers, gf, h, floors, trim);

  // Hotel balconies with solid white fronts.
  if (style === 'stucco' && !L) {
    const fh = (h - gf) / floors;
    const sides = sidesOf(x0, z0, x1, z1).filter((s) => s.L >= 8 && (b.street ? b.street & s.m : s.m === 2));
    const col = mixHex(tint, WHITE, 0.75);
    for (const s of sides.slice(0, 2)) {
      for (let f = 1; f < Math.min(floors, 10); f++) {
        const y = gf + f * fh, a0 = 0.9, a1 = s.L - 0.9, o = 1.15;
        span(P, s, a0, a1, y - 0.12, y + 1.0, o, col, 0, 0, 1, 1, 0.9, 1);
        P.wall(px(s, a1, o - 0.08), pz(s, a1, o - 0.08), px(s, a0, o - 0.08), pz(s, a0, o - 0.08), y, y + 1.0, shade(col, 0.8));
        P.wall(px(s, a1, o), pz(s, a1, o), px(s, a1, 0), pz(s, a1, 0), y - 0.12, y + 1.0, shade(col, 0.92));
        P.wall(px(s, a0, 0), pz(s, a0, 0), px(s, a0, o), pz(s, a0, o), y - 0.12, y + 1.0, shade(col, 0.92));
        // Slab underside (seen from the street) and top.
        P.quad(px(s, a0, 0), y - 0.12, pz(s, a0, 0), px(s, a1, 0), y - 0.12, pz(s, a1, 0), px(s, a1, o), y - 0.12, pz(s, a1, o), px(s, a0, o), y - 0.12, pz(s, a0, o), shade(col, 0.6), 0, -1, 0);
        P.quad(px(s, a0, o), y, pz(s, a0, o), px(s, a1, o), y, pz(s, a1, o), px(s, a1, 0), y, pz(s, a1, 0), px(s, a0, 0), y, pz(s, a0, 0), shade(col, 0.75), 0, 1, 0);
      }
    }
  }

  if (b.billboard) billboard(C, b, h);
}

// ---- Miami map structure (only with a look from miamilook.js) ----------

const terracotta = (b) => [0xb8583a, 0xc0684a, 0xa85034, 0xc4785a][b.vseed & 3];

// One face from 3 or 4 points (counter-clockwise seen from the front),
// its normal from the points, texture in meters / k along a and up b.
function face(B, p, color, k = 1.5, s = 1) {
  const [a, b2, c] = p;
  const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const el = Math.hypot(ux, uy, uz) || 1;
  const ex = ux / el, ey = uy / el, ez = uz / el;
  // v axis: in the face, across the first edge.
  const fx = ny * ez - nz * ey, fy = nz * ex - nx * ez, fz = nx * ey - ny * ex;
  const uv = (q) => [((q[0] - a[0]) * ex + (q[1] - a[1]) * ey + (q[2] - a[2]) * ez) / k, ((q[0] - a[0]) * fx + (q[1] - a[1]) * fy + (q[2] - a[2]) * fz) / k];
  if (p.length === 3) {
    const A = uv(a), Bv = uv(b2), Cv = uv(c);
    B.tri(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2], color, nx, ny, nz, A[0], A[1], Bv[0], Bv[1], Cv[0], Cv[1], s);
  } else {
    const d = p[3];
    const A = uv(a), Bv = uv(b2), Cv = uv(c), D = uv(d);
    B.quadUv(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2], d[0], d[1], d[2], color, nx, ny, nz, A[0], A[1], Bv[0], Bv[1], Cv[0], Cv[1], D[0], D[1], s);
  }
}

// A thin slab out from a wall (canopy, balcony, eyebrow): front, top
// (unless noTop: a balcony's floor is hidden by its railing) and the
// underside seen from the street.
function slab(P, s, a0, a1, o, y0, y1, color, under, noTop = false) {
  span(P, s, a0, a1, y0, y1, o, color, 0, 0, 1, 1, 0.92, 1);
  if (!noTop) P.quad(px(s, a0, o), y1, pz(s, a0, o), px(s, a1, o), y1, pz(s, a1, o), px(s, a1, 0), y1, pz(s, a1, 0), px(s, a0, 0), y1, pz(s, a0, 0), color, 0, 1, 0);
  P.quad(px(s, a0, 0), y0, pz(s, a0, 0), px(s, a1, 0), y0, pz(s, a1, 0), px(s, a1, o), y0, pz(s, a1, o), px(s, a0, o), y0, pz(s, a0, o), under, 0, -1, 0);
}

// An upright fin or pier standing out `o` from the wall: front and sides.
function fin(P, s, a0, a1, o, y0, y1, color, s0 = 0.9) {
  span(P, s, a0, a1, y0, y1, o, color, 0, 0, 1, 1, s0, 1);
  P.wall(px(s, a1, o), pz(s, a1, o), px(s, a1, 0), pz(s, a1, 0), y0, y1, shade(color, 0.9), 0, 0, 1, 1, s0, 1);
  P.wall(px(s, a0, 0), pz(s, a0, 0), px(s, a0, o), pz(s, a0, o), y0, y1, shade(color, 0.9), 0, 0, 1, 1, s0, 1);
}

// Stone plinth all round; an entrance canopy on taller buildings.
function groundFloor(C, b, L, style, gf, trim, tint) {
  const { x0, z0, x1, z1 } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = C.plain.at(cx, cz), TR = (C.trim || C.plain).at(cx, cz);
  const stone = style === 'glass' || style === 'office' ? 0x8a8e92 : shade(mixHex(tint, 0x9a948a, 0.55), 0.82);
  TR.walls(x0 - 0.08, z0 - 0.08, x1 + 0.08, z1 + 0.08, 0.16, 0.55, stone, 1, 1, 0.62, 0.9);
  TR.ring(x0 - 0.08, z0 - 0.08, x1 + 0.08, z1 + 0.08, 0.1, 0.55, shade(stone, 1.12));
  if (b.h < 24) return;
  let best = null;
  for (const s of sidesOf(x0, z0, x1, z1)) if ((b.street & s.m) && s.L >= 10 && (!best || s.L > best.L)) best = s;
  if (!best) return;
  const w = Math.min(best.L * 0.5, 14), mid = best.L / 2;
  slab(P, best, mid - w / 2, mid + w / 2, 2.8, gf - 0.1, gf + 0.32, trim, shade(trim, 0.55));
  for (const a of [mid - w / 2 + 0.3, mid + w / 2 - 0.5]) frameBox(P, best, a, a + 0.2, 2.45, 2.65, 0.16, gf - 0.1, shade(trim, 0.8));
}

// Fins, piers, corner pilasters and floor lines on one tier.
// Trim: no cast shadow (C.trim, when the caller has it).
function relief(C, b, L, style, x0, z0, x1, z1, y0, y1, floors, bay, trim, tint, first) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const P = (C.trim || C.plain).at(cx, cz);
  const sides = sidesOf(x0, z0, x1, z1);
  const fh = (y1 - y0) / floors;
  if (style === 'glass' || style === 'office') {
    const glass = style === 'glass';
    const every = L.fins || 0;
    const col = glass ? trim : shade(tint, 1.04);
    const w = glass ? 0.08 : 0.22, o = glass ? 0.42 : 0.32;
    for (const s of sides) {
      const n = Math.max(1, Math.round(s.L / bay));
      const st = s.L / n;
      if (every) for (let i = every; i < n; i += every) fin(P, s, i * st - w, i * st + w, o, y0, y1, col);
      // Corner piers.
      fin(P, s, -0.05, glass ? 0.35 : 0.6, glass ? 0.2 : 0.36, y0, y1, glass ? shade(trim, 0.92) : col);
    }
    // A spandrel ledge every few floors on glass towers.
    if (glass) for (let f = 4; f < floors; f += 4) P.walls(x0 - 0.12, z0 - 0.12, x1 + 0.12, z1 + 0.12, y0 + f * fh - 0.06, y0 + f * fh + 0.22, shade(trim, 0.95), 1, 1, 0.85, 1);
    return;
  }
  // Stucco, Havana and brick: corner pilasters and a string course per floor.
  for (const s of sides) fin(P, s, -0.06, 0.55, 0.16, first ? 0.55 : y0, y1, trim);
  if (L.balconies) return;
  const top = Math.min(floors, 14);
  for (let f = 1; f < top; f++) {
    const y = y0 + f * fh;
    P.walls(x0 - 0.07, z0 - 0.07, x1 + 0.07, z1 + 0.07, y - 0.05, y + 0.16, trim, 1, 1, 0.82, 1);
  }
}

// Railing panels (one atlas picture each, see-through) round a roof.
function railing(C, b, x0, z0, x1, z1, y, hgt) {
  const D = C.detail.at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
  const r = C.R.railing;
  if (!r) return;
  for (const s of sidesOf(x0, z0, x1, z1)) {
    const n = Math.max(1, Math.round(s.L / 9));
    const st = s.L / n;
    for (let i = 0; i < n; i++) panel(D, s, i * st, (i + 1) * st, y, y + hgt, 0, 0xa8aeb4, r);
  }
}

// Terracotta tile coping round a flat roof (mission style).
function tileCoping(C, b, x0, z0, x1, z1, y, col) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const RF = C.roofing.at(cx, cz), P = C.plain.at(cx, cz);
  const oi = -0.2, oo = 0.6, yi = y + 0.42, yo = y + 0.02;
  for (const s of sidesOf(x0, z0, x1, z1)) {
    const P0 = [px(s, -oo, oo), yo, pz(s, -oo, oo)], P1 = [px(s, s.L + oo, oo), yo, pz(s, s.L + oo, oo)];
    const P2 = [px(s, s.L - oi, oi), yi, pz(s, s.L - oi, oi)], P3 = [px(s, oi, oi), yi, pz(s, oi, oi)];
    face(RF, [P0, P1, P2, P3], col, 0.9);
    // Underside (dark) and the edge.
    P.quad(P3[0], yo - 0.14, P3[2], P2[0], yo - 0.14, P2[2], P1[0], yo - 0.14, P1[2], P0[0], yo - 0.14, P0[2], shade(col, 0.45), 0, -1, 0);
    span(P, s, -oo, s.L + oo, yo - 0.14, yo, oo, shade(col, 0.8), 0, 0, 1, 1);
  }
}

// Hipped roof of tiles on a small low-rise building.
function hipRoof(C, b, x0, z0, x1, z1, y, col, trim) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const RF = C.roofing.at(cx, cz), P = C.plain.at(cx, cz);
  const e = 0.5;
  const X0 = x0 - e, Z0 = z0 - e, X1 = x1 + e, Z1 = z1 + e;
  const w = X1 - X0, d = Z1 - Z0;
  const rh = Math.min(3.4, Math.min(w, d) * 0.3);
  const top = y + rh;
  P.walls(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, y - 0.35, y, trim, 1, 1, 0.9, 1);
  // Eaves underside, seen from the street.
  for (const s of sidesOf(x0, z0, x1, z1)) {
    const o = e + 0.02, yb = y - 0.02;
    P.quad(px(s, -e, 0), yb, pz(s, -e, 0), px(s, s.L + e, 0), yb, pz(s, s.L + e, 0), px(s, s.L + e, o), yb, pz(s, s.L + e, o), px(s, -e, o), yb, pz(s, -e, o), shade(col, 0.42), 0, -1, 0);
  }
  if (w >= d) {
    const r0 = X0 + d / 2, r1 = X1 - d / 2, m = (Z0 + Z1) / 2;
    face(RF, [[X0, y, Z1], [X1, y, Z1], [r1, top, m], [r0, top, m]], col);
    face(RF, [[X1, y, Z0], [X0, y, Z0], [r0, top, m], [r1, top, m]], col, 1.5, 0.86);
    face(RF, [[X1, y, Z1], [X1, y, Z0], [r1, top, m]], col, 1.5, 0.93);
    face(RF, [[X0, y, Z0], [X0, y, Z1], [r0, top, m]], col, 1.5, 0.9);
  } else {
    const r0 = Z0 + w / 2, r1 = Z1 - w / 2, m = (X0 + X1) / 2;
    face(RF, [[X1, y, Z1], [X1, y, Z0], [m, top, r0], [m, top, r1]], col, 1.5, 0.93);
    face(RF, [[X0, y, Z0], [X0, y, Z1], [m, top, r1], [m, top, r0]], col, 1.5, 0.88);
    face(RF, [[X0, y, Z1], [X1, y, Z1], [m, top, r1]], col);
    face(RF, [[X1, y, Z0], [X0, y, Z0], [m, top, r0]], col, 1.5, 0.86);
  }
}

// Art-deco details on the street fronts: eyebrow ledges over the
// windows, a center fin rising over the roof, speed-line bands.
function deco(C, b, L, gf, h, floors, trim, tint) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const P = (C.trim || C.plain).at(cx, cz);
  const all = sidesOf(b.x0, b.z0, b.x1, b.z1);
  const sides = all.filter((s) => (b.street & s.m) && s.L >= 7).slice(0, 2);
  if (!sides.length) sides.push(all[0]);
  const fh = (h - gf) / floors;
  const accent = mixHex(shade(tint, 0.72), (b.vseed & 1) ? 0x2a8a8a : 0xd8604a, 0.35);
  for (const s of sides) {
    for (let f = 0; f < floors; f++) {
      const y = gf + f * fh + fh * 0.8 + 0.06;
      slab(P, s, 0.25, s.L - 0.25, 0.55, y, y + 0.12, trim, shade(trim, 0.6));
    }
    for (let k = 0; k < 3; k++) span(P, s, 0.1, s.L - 0.1, h - 1.5 + k * 0.38, h - 1.32 + k * 0.38, 0.06, accent, 0, 0, 1, 1);
    if (s.L >= 10) {
      const mid = s.L / 2, w = Math.min(3.2, s.L * 0.22);
      fin(P, s, mid - w / 2, mid + w / 2, 0.4, gf, h + 2.2, trim);
      fin(P, s, mid - w * 0.28, mid + w * 0.28, 0.5, h + 2.2, h + 3.6, trim);
      frameBox(P, s, mid - w / 2, mid + w / 2, -0.6, 0.4, h + 2.2, h + 2.3, trim);
      frameBox(P, s, mid - w * 0.28, mid + w * 0.28, -0.4, 0.5, h + 3.6, h + 3.7, trim);
      // An accent stripe up the fin.
      span(P, s, mid - 0.18, mid + 0.18, gf + 0.5, h + 3.3, 0.53, accent, 0, 0, 1, 1);
    }
  }
}

// Balconies: a slab on every floor with a glass railing.
function balconies(C, b, L, tiers, gf, h, floors, trim) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const P = C.plain.at(cx, cz), D = C.detail.at(cx, cz);
  const r = C.R.rail;
  const under = shade(trim, 0.58), glassCol = 0xb8d4dc;
  for (const t of tiers) {
    const nf = Math.max(1, Math.round((t.y1 - t.y0) / 3.25));
    const fh = (t.y1 - t.y0) / nf;
    const all = sidesOf(b.x0 + t.i, b.z0 + t.i, b.x1 - t.i, b.z1 - t.i);
    // The street fronts (or, on a full condo tower, the two longest
    // sides when it has no street front): at most two sides.
    let sides = all.filter((s) => s.L >= 8 && (b.street & s.m));
    if (!sides.length && L.balconies === 2) sides = all.slice().sort((p, q) => q.L - p.L).slice(0, 2);
    if (!sides.length) sides = [all.reduce((a, q) => (q.L > a.L ? q : a))];
    sides = sides.slice(0, 2);
    const maxF = Math.min(nf, 40);
    for (const s of sides) {
      const a0 = 0.8, a1 = s.L - 0.8, o = 1.5;
      for (let f = 1; f < maxF; f++) {
        const y = t.y0 + f * fh;
        slab(P, s, a0, a1, o, y - 0.2, y, trim, under, true);
        if (r) panel(D, s, a0, a1, y, y + 1.05, o - 0.05, glassCol, r);
      }
    }
  }
}

// A lit hoarding on posts at the roof edge.
function billboard(C, b, y) {
  const s = sidesOf(b.x0, b.z0, b.x1, b.z1).find((q) => q.m === b.billboard.side);
  if (!s) return;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const P = C.plain.at(cx, cz), D = C.detail.at(cx, cz);
  const w = Math.min(12, s.L - 2), hgt = w / 2, mid = s.L / 2, o = -0.9;
  for (const a of [mid - w * 0.35, mid + w * 0.35]) {
    const x = px(s, a, o - 0.3), z = pz(s, a, o - 0.3);
    P.box(x - 0.14, z - 0.14, x + 0.14, z + 0.14, y - 0.7, y + 1.6 + hgt, 0x3c3e42);
  }
  panel(D, s, mid - w / 2, mid + w / 2, y + 1.4, y + 1.4 + hgt, o, WHITE, C.R['bill' + b.billboard.ad]);
  P.wall(px(s, mid + w / 2, o - 0.12), pz(s, mid + w / 2, o - 0.12), px(s, mid - w / 2, o - 0.12), pz(s, mid - w / 2, o - 0.12), y + 1.4, y + 1.4 + hgt, 0x55585c);
  span(P, s, mid - w / 2 - 0.1, mid + w / 2 + 0.1, y + 1.25, y + 1.4, o + 0.02, 0x2c2e32, 0, 0, 1, 1);
}

function house(C, b) {
  const rng = createRng(b.vseed);
  const { x0, z0, x1, z1, h } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = C.plain.at(cx, cz), D = C.detail.at(cx, cz), W = C.siding.at(cx, cz), RF = C.roofing.at(cx, cz);
  const base = 0.6;
  const L = lookOf(C.city, b);
  const tint = L ? L.wall : mixHex(b.color, WHITE, 0.25);
  P.walls(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, 0.16, base, 0x8f8b84, 1, 1, 0.55, 0.9);
  W.walls(x0, z0, x1, z1, base, h, tint, 2.4, 2.4, 0.86, 1);

  // Pitched roof along the longer side, with shingles.
  const pickRoof = rng.pick(ROOFS);
  const roof = L ? L.roof : pickRoof;
  const rh = Math.min(3, Math.min(x1 - x0, z1 - z0) * 0.3), e = 0.5, k3 = 1 / 3;
  const ex0 = x0 - e, ex1 = x1 + e, ez0 = z0 - e, ez1 = z1 + e;
  const yE = h - 0.12;
  if (x1 - x0 >= z1 - z0) {
    const mz = (ez0 + ez1) / 2, sl = Math.hypot(rh, mz - ez0), ny = (mz - ez0) / sl, nz = rh / sl;
    const u1 = (ex1 - ex0) * k3, v1 = sl * k3;
    RF.quadUv(ex0, yE, ez1, ex1, yE, ez1, ex1, yE + rh, mz, ex0, yE + rh, mz, roof, 0, ny, nz, 0, 0, u1, 0, u1, v1, 0, v1);
    RF.quadUv(ex1, yE, ez0, ex0, yE, ez0, ex0, yE + rh, mz, ex1, yE + rh, mz, roof, 0, ny, -nz, 0, 0, u1, 0, u1, v1, 0, v1, 0.85);
    const g = 1 / 2.4;
    W.tri(x1, h, z1, x1, h, z0, x1, yE + rh, mz, tint, 1, 0, 0, z1 * g, h * g, z0 * g, h * g, mz * g, (h + rh) * g);
    W.tri(x0, h, z0, x0, h, z1, x0, yE + rh, mz, tint, -1, 0, 0, z0 * g, h * g, z1 * g, h * g, mz * g, (h + rh) * g);
    P.box(x0 + (x1 - x0) * 0.25 - 0.35, mz - 1.6, x0 + (x1 - x0) * 0.25 + 0.35, mz - 0.9, h, h + rh + 0.5, 0x8a5a48, 0x4a3a34, 0.8, 1);
  } else {
    const mx = (ex0 + ex1) / 2, sl = Math.hypot(rh, mx - ex0), ny = (mx - ex0) / sl, nx = rh / sl;
    const u1 = (ez1 - ez0) * k3, v1 = sl * k3;
    RF.quadUv(ex1, yE, ez1, ex1, yE, ez0, mx, yE + rh, ez0, mx, yE + rh, ez1, roof, nx, ny, 0, 0, 0, u1, 0, u1, v1, 0, v1);
    RF.quadUv(ex0, yE, ez0, ex0, yE, ez1, mx, yE + rh, ez1, mx, yE + rh, ez0, roof, -nx, ny, 0, 0, 0, u1, 0, u1, v1, 0, v1, 0.85);
    const g = 1 / 2.4;
    const top = yE + rh;
    W.tri(x0, h, z1, x1, h, z1, mx, top, z1, tint, 0, 0, 1, x0 * g, h * g, x1 * g, h * g, mx * g, (h + rh) * g);
    W.tri(x1, h, z0, x0, h, z0, mx, top, z0, tint, 0, 0, -1, x1 * g, h * g, x0 * g, h * g, mx * g, (h + rh) * g);
    P.box(mx - 1.6, z0 + (z1 - z0) * 0.25 - 0.35, mx - 0.9, z0 + (z1 - z0) * 0.25 + 0.35, h, h + rh + 0.5, 0x8a5a48, 0x4a3a34, 0.8, 1);
  }

  // Windows on every wall; the front also gets the door and a porch.
  const sides = sidesOf(x0, z0, x1, z1);
  const front = sides.find((s) => b.street & s.m) || sides[0];
  const floors = h >= 6.6 ? 2 : 1;
  const sh = (h - base) / floors;
  for (const s of sides) {
    const n = Math.max(1, Math.floor((s.L - 1.2) / 3));
    const step = s.L / n;
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < n; i++) {
        const mid = (i + 0.5) * step;
        const y = base + f * sh;
        if (s === front && f === 0 && i === (n >> 1)) {
          panel(D, s, mid - 0.55, mid + 0.55, base, base + 2.15, 0.05, mixHex(roof, WHITE, 0.35), C.R.door);
          // Porch: deck, steps, posts and a little roof.
          frameBox(P, s, mid - 1.7, mid + 1.7, 0, 1.5, 0.16, base, 0x9a958c, 0xa8a297, 0.6, 1);
          frameBox(P, s, mid - 0.8, mid + 0.8, 1.5, 1.9, 0.16, base - 0.22, 0x9a958c, 0xa8a297, 0.6, 1);
          for (const a of [mid - 1.6, mid + 1.5]) frameBox(P, s, a, a + 0.1, 1.38, 1.48, base, base + 2.35, 0xf2f0ea);
          frameBox(P, s, mid - 1.85, mid + 1.85, 0, 1.65, base + 2.35, base + 2.5, 0xf2f0ea, roof);
          continue;
        }
        if (s.L < 3.2) continue;
        panel(D, s, mid - 0.55, mid + 0.55, y + 0.95, y + 2.3, 0.05, WHITE, C.R['hwin' + rng.int(0, 2)]);
      }
    }
  }

  // Yard: hedge or picket fence with a gap at the front path.
  const blk = b.block >= 0 ? C.city.blocks[b.block] : null;
  if (!blk) return;
  const lim = SIDEWALK + 0.4;
  const yx0 = Math.max(blk.x0 + lim, x0 - 2.3), yz0 = Math.max(blk.z0 + lim, z0 - 2.3);
  const yx1 = Math.min(blk.x1 - lim, x1 + 2.3), yz1 = Math.min(blk.z1 - lim, z1 + 2.3);
  const kind = rng.next();
  const nF = Math.max(1, Math.floor((front.L - 1.2) / 3));
  const doorA = ((nF >> 1) + 0.5) * (front.L / nF);
  // Front path from the porch to the sidewalk.
  {
    const gap = front.m === 1 ? z0 - blk.z0 : front.m === 2 ? blk.z1 - z1 : front.m === 4 ? x0 - blk.x0 : blk.x1 - x1;
    const len = gap - SIDEWALK;
    if (len > 2) {
      const xa = px(front, doorA - 0.7, 1.9), xb = px(front, doorA + 0.7, len), za = pz(front, doorA - 0.7, 1.9), zb = pz(front, doorA + 0.7, len);
      C.decal.at(cx, cz).flatRect(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), 0.175, 0xd8d4cc, C.DR.slab);
    }
  }
  if (kind > 0.8) return;
  const hedge = kind < 0.45;
  const hedgeCol = rng.pick([0x3f7a3a, 0x4a8a44, 0x38703a]);
  for (const s of sidesOf(yx0, yz0, yx1, yz1)) {
    // Stretch of this yard side that the front path cuts through.
    const runs = [];
    if (s.m === front.m) {
      const off = s.m === 2 ? x0 - yx0 : s.m === 1 ? yx1 - x1 : s.m === 8 ? yz1 - z1 : z0 - yz0;
      const d = off + doorA;
      runs.push([0, d - 1.2], [d + 1.2, s.L]);
    } else runs.push([0, s.L]);
    for (const [a0, a1] of runs) {
      if (a1 - a0 < 0.6) continue;
      if (hedge) {
        // A low hedge with a soft top (render/lotmesh.js softStrip), not a box.
        const ax = px(s, a0, -0.25), az = pz(s, a0, -0.25), bx = px(s, a1, -0.25), bz = pz(s, a1, -0.25);
        softStrip(P, (ax + bx) / 2, (az + bz) / 2, Math.atan2(bz - az, bx - ax), Math.hypot(bx - ax, bz - az), 0.55, 0.16, 0.8 + (b.vseed % 5) * 0.025, hedgeCol, 1.6, 0.35);
      } else {
        const r = C.R.fence;
        const n = Math.max(1, Math.round((a1 - a0) / 2));
        const st = (a1 - a0) / n;
        for (let i = 0; i < n; i++) panel(D, s, a0 + i * st, a0 + (i + 1) * st, 0.16, 1.16, 0, WHITE, r);
      }
    }
  }
}

function shed(C, b) {
  const rng = createRng(b.vseed);
  const { x0, z0, x1, z1, h } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = C.plain.at(cx, cz), D = C.detail.at(cx, cz), K = C.corrugated.at(cx, cz);
  const hangar = b.style === 'hangar';
  const L = lookOf(C.city, b);
  const tint = L && !hangar ? L.wall : mixHex(b.color, WHITE, 0.3);
  const base = 1.1;
  P.walls(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 0.16, base, 0x8f8c86, 1, 1, 0.5, 0.9);
  const sides = sidesOf(x0, z0, x1, z1);
  for (const s of sides) span(K, s, 0, s.L, base, h, 0, tint, 0, 0, s.L / 4, 1, 0.9, 1);
  // Low-pitched roof.
  const rh = Math.min(2.4, Math.min(x1 - x0, z1 - z0) * 0.09);
  const roofTint = mixHex(tint, 0xd0d4d8, 0.6);
  const e = 0.4;
  if (x1 - x0 >= z1 - z0) {
    const mz = cz, sl = Math.hypot(rh, mz - z0 + e), ny = (mz - z0 + e) / sl, nz = rh / sl, u1 = (x1 - x0) / 4;
    K.quadUv(x0 - e, h, z1 + e, x1 + e, h, z1 + e, x1 + e, h + rh, mz, x0 - e, h + rh, mz, roofTint, 0, ny, nz, 0, 0, u1, 0, u1, 1, 0, 1);
    K.quadUv(x1 + e, h, z0 - e, x0 - e, h, z0 - e, x0 - e, h + rh, mz, x1 + e, h + rh, mz, roofTint, 0, ny, -nz, 0, 0, u1, 0, u1, 1, 0, 1, 0.85);
    K.tri(x1, h, z1, x1, h, z0, x1, h + rh, mz, tint, 1, 0, 0, 0, 0, (z1 - z0) / 4, 0, (z1 - z0) / 8, 0.2);
    K.tri(x0, h, z0, x0, h, z1, x0, h + rh, mz, tint, -1, 0, 0, 0, 0, (z1 - z0) / 4, 0, (z1 - z0) / 8, 0.2);
  } else {
    const mx = cx, sl = Math.hypot(rh, mx - x0 + e), ny = (mx - x0 + e) / sl, nx = rh / sl, u1 = (z1 - z0) / 4;
    K.quadUv(x1 + e, h, z1 + e, x1 + e, h, z0 - e, mx, h + rh, z0 - e, mx, h + rh, z1 + e, roofTint, nx, ny, 0, 0, 0, u1, 0, u1, 1, 0, 1);
    K.quadUv(x0 - e, h, z0 - e, x0 - e, h, z1 + e, mx, h + rh, z1 + e, mx, h + rh, z0 - e, roofTint, -nx, ny, 0, 0, 0, u1, 0, u1, 1, 0, 1, 0.85);
    K.tri(x0, h, z1, x1, h, z1, mx, h + rh, z1, tint, 0, 0, 1, 0, 0, (x1 - x0) / 4, 0, (x1 - x0) / 8, 0.2);
    K.tri(x1, h, z0, x0, h, z0, mx, h + rh, z0, tint, 0, 0, -1, 0, 0, (x1 - x0) / 4, 0, (x1 - x0) / 8, 0.2);
  }
  // Doors: roller shutters onto the street, or one big hangar door.
  if (hangar) {
    const s = sides.find((q) => q.m === 1);
    panel(D, s, 5, s.L - 5, 0.16, h - 1.6, 0.06, 0xd8dcdf, C.R.roller, 0.95);
    return;
  }
  const facing = sides.filter((s) => (b.street & s.m) && s.L > 9);
  if (!facing.length) facing.push(sides.reduce((a, q) => (q.L > a.L ? q : a)));
  for (const s of facing.slice(0, 2)) {
    const n = Math.max(1, Math.floor(s.L / 13));
    const step = s.L / n;
    for (let i = 0; i < n; i++) {
      const mid = (i + 0.5) * step;
      panel(D, s, mid - 2.1, mid + 2.1, 0.16, Math.min(4.6, h - 1.5), 0.06, mixHex(tint, WHITE, 0.5), C.R.roller);
      if (i === 0 && step > 9) panel(D, s, mid + 2.8, mid + 3.8, 0.16, 2.3, 0.06, 0x9aa0a6, C.R.door);
    }
    if (s === facing[0] && s.L > 14 && h > 8) {
      const w = Math.min(9, s.L - 4);
      panel(D, s, s.L / 2 - w / 2, s.L / 2 + w / 2, h - 0.6 - w / 4, h - 0.6, 0.08, WHITE, C.R['sign' + rng.int(0, SHOP_NAMES.length - 1)]);
    }
  }
}

function brickWarehouse(C, b) {
  const rng = createRng(b.vseed);
  const { x0, z0, x1, z1, h } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = C.plain.at(cx, cz), D = C.detail.at(cx, cz);
  const tint = mixHex(rng.pick([0xb0705a, 0x9c5f4c, 0xa87f66]), WHITE, 0.1);
  P.walls(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, 0.16, 1.0, 0x8a8782, 1, 1, 0.5, 0.9);
  facadeWalls(C.brick.at(cx, cz), x0, z0, x1, z1, 1.0, h, tint, 3.3, 3.6, rng);
  flatRoof(C, b, x0, z0, x1, z1, h, STONE, rng, { cornice: 0.2, tank: rng.chance(0.4) });
  const sides = sidesOf(x0, z0, x1, z1);
  const facing = sides.filter((s) => (b.street & s.m) && s.L > 9);
  for (const s of facing.slice(0, 2)) {
    const n = Math.max(1, Math.floor(s.L / 12));
    for (let i = 0; i < n; i++) {
      const mid = (i + 0.5) * (s.L / n);
      panel(D, s, mid - 1.9, mid + 1.9, 0.16, 4.2, 0.06, 0xb9c0c4, C.R.roller);
    }
  }
  if (b.billboard) billboard(C, b, h);
}

function container(C, b) {
  const { x0, z0, x1, z1, h } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const K = C.corrugated.at(cx, cz), D = C.detail.at(cx, cz);
  const stack = Math.max(1, Math.round(h / 2.6));
  const tint = mixHex(b.color, WHITE, 0.18);
  const y0 = 0.16;
  for (const s of sidesOf(x0, z0, x1, z1)) {
    span(K, s, 0, s.L, y0, y0 + h, 0, tint, 0, 0, s.L / 2.4, stack, 0.7, 1);
    if (s.L < 4) for (let k = 0; k < stack; k++) panel(D, s, 0.05, s.L - 0.05, y0 + k * 2.6 + 0.05, y0 + (k + 1) * 2.6 - 0.05, 0.03, tint, C.R.cdoor);
  }
  C.plain.at(cx, cz).flat(x0, z0, x1, z1, y0 + h, shade(b.color, 0.8));
}

export function addBuilding(C, b) {
  if (b.style === 'house') house(C, b);
  else if (b.style === 'container') container(C, b);
  else if (b.style === 'shed' || b.style === 'hangar') shed(C, b);
  else if (b.kind === 'warehouse') brickWarehouse(C, b);
  else tower(C, b);
  // Contact shadow on the ground all round the footprint.
  if (b.style !== 'container') C.ao.at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2).aoSkirt(b.x0, b.z0, b.x1, b.z1, b.h > 20 ? 2.4 : 1.5, 0.17, 0.52);
  else C.ao.at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2).aoSkirt(b.x0, b.z0, b.x1, b.z1, 0.8, 0.17, 0.55);
}
