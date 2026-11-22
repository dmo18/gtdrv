// How a building on the real Miami map should look, worked out from its
// neighbourhood (city.placeOf), its height and a seeded hash of the
// building: a facade style, a wall colour from a Miami palette (pastel
// stucco, white, sand, coral, teal glass, grey concrete), a trim colour
// and the extra structure buildings.js adds (fins, balconies, deco
// eyebrows, tile copings). Pure: no three.js, runs in node tests. The
// city data is never changed; the result is cached per building.
//
// The procedural island (city.map unset) keeps its own look: lookOf
// returns null there.

// Neighbourhoods by character.
const TOWERS = new Set(['Downtown Miami', 'Brickell', 'Brickell Key', 'Park West', 'Edgewater', 'Margaret Pace Park', 'Bayfront Park', 'Museum Park', 'Midtown', 'Miami']);
const DECO = new Set(['Miami Beach', 'Venetian Islands', 'Hibiscus Island', 'Palm Island', 'Fisher Island']);
const LOWRISE = new Set(['Little Havana', 'Shenandoah', 'Bay Heights', 'The Roads', 'Brickell Hammock', 'Overtown', 'Civic Center', 'Allapattah', 'Wynwood', 'Design District', 'Virginia Key', 'Watson Island']);
const PORT = new Set(['Dodge Island']);

// Palettes (sRGB hex).
const GLASS = [0x5f9fb4, 0x6fb4be, 0x7fa8c4, 0x4f8aa6, 0x86bccb, 0x9cb4c6, 0x5c8fa0, 0x7ab0b0];
const CONDO = [0xf4f2ec, 0xeeeae0, 0xf2ede2, 0xe8e6e0, 0xe6dccb, 0xf0f0ee];
const CONCRETE = [0xd4d0c8, 0xc8c6c0, 0xbfc2c4, 0xdcd6cc, 0xb8b6b0];
const PASTEL = [0xf4c4bc, 0xbfe4d2, 0xa9dcd6, 0xf5e4a8, 0xd9cbe6, 0xf7d2b0, 0xf4f0e6, 0xf2b8a6, 0xc4dcec];
const STUCCO = [0xead8b4, 0xf0b098, 0xe9b9a2, 0xf2dea4, 0xbcdcc6, 0xbfd6e6, 0xf3ede0, 0xf6cfb0, 0xe4c49a, 0xd8e4c4, 0xf2c6c6];
const WARM_BRICK = [0xb4705a, 0xa86450, 0xbc8268];
const SHED = [0xd8d8d2, 0xc4ccd0, 0xb8c4c8, 0xd6cfc0, 0x9eb0b8];

export function hash32(n) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
// 0..1 from a building seed and a salt.
export function unit(seed, salt) {
  return hash32(seed * 31 + salt * 1013904223) / 4294967296;
}
const pick = (arr, u) => arr[Math.min(arr.length - 1, (u * arr.length) | 0)];

function mix(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
// A small per-building shift in brightness and warmth, so a row of the
// same palette entry is never uniform.
function vary(hex, u) {
  const f = 0.94 + u * 0.1;
  const w = (u - 0.5) * 10;
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) * f + w)) | 0;
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) * f)) | 0;
  const b = Math.max(0, Math.min(255, (hex & 255) * f - w)) | 0;
  return (r << 16) | (g << 8) | b;
}

const cache = new WeakMap();

// {style, wall, tint, trim, fins, balconies, deco, tile, roof} or null.
export function lookOf(city, b) {
  if (!city || city.map !== 'miami') return null;
  let L = cache.get(b);
  if (L) return L;
  L = computeLook(city, b);
  cache.set(b, L);
  return L;
}

function computeLook(city, b) {
  const s = b.vseed | 0;
  const u = (k) => unit(s, k);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const place = (city.placeOf && city.placeOf(cx, cz)) || '';
  const L = { style: b.style, wall: b.color, tint: b.tint, trim: 0xf2f0ea, fins: 0, balconies: 0, deco: false, tile: false, roof: 0xd6d4ce, place };
  const st = b.style;
  if (st === 'container' || st === 'hangar' || b.depot) return L;
  if (st === 'house') {
    L.wall = vary(pick(STUCCO, u(1)), u(2));
    L.tint = L.wall;
    L.roof = pick([0xb4583c, 0xa8603e, 0xc07050, 0x9a5a48, 0x8a8e94], u(3));
    return L;
  }
  if (st === 'shed') {
    L.wall = vary(pick(SHED, u(1)), u(2));
    L.tint = L.wall;
    return L;
  }
  const tall = b.h >= 30;
  if (TOWERS.has(place) && tall) {
    const r = u(4);
    if (r < 0.52) {
      L.style = 'glass';
      L.tint = vary(pick(GLASS, u(5)), u(6));
      L.trim = pick([0xe8eaec, 0xb8c0c6, 0x8c969e], u(7));
      L.fins = u(8) < 0.6 ? (u(9) < 0.5 ? 1 : 2) : 0;
    } else if (r < 0.88) {
      // A white condo tower with a balcony on every floor.
      L.style = 'stucco';
      L.tint = vary(pick(CONDO, u(5)), u(6));
      L.trim = 0xffffff;
      L.balconies = 2;
    } else {
      L.style = 'office';
      L.tint = vary(pick(CONCRETE, u(5)), u(6));
      L.trim = 0xe6e4de;
      L.fins = 1;
    }
  } else if (DECO.has(place) && b.h < 26) {
    L.style = 'stucco';
    L.tint = vary(pick(PASTEL, u(5)), u(6));
    L.trim = u(7) < 0.7 ? 0xfbfaf6 : mix(L.tint, 0x404040, 0.25);
    L.deco = true;
  } else if (DECO.has(place) || (TOWERS.has(place) && b.h >= 18)) {
    L.style = u(4) < 0.75 ? 'stucco' : 'glass';
    L.tint = L.style === 'glass' ? vary(pick(GLASS, u(5)), u(6)) : vary(pick(CONDO, u(5)), u(6));
    L.trim = 0xffffff;
    L.balconies = L.style === 'stucco' ? 1 : 0;
    L.fins = L.style === 'glass' ? 1 : 0;
  } else if (PORT.has(place)) {
    L.style = 'office';
    L.tint = vary(pick(CONCRETE, u(5)), u(6));
  } else if (place === 'Wynwood' && st === 'brick') {
    L.tint = vary(pick(WARM_BRICK, u(5)), u(6));
    L.trim = 0xe8e0d0;
  } else {
    // Low-rise stucco: Little Havana, Shenandoah and the like.
    const r = u(4);
    L.style = b.h <= 16 && r < 0.6 ? 'havana' : r < 0.85 ? 'stucco' : 'office';
    L.tint = L.style === 'office' ? vary(pick(CONCRETE, u(5)), u(6)) : vary(pick(STUCCO, u(5)), u(6));
    L.trim = u(7) < 0.75 ? 0xf8f6f0 : mix(L.tint, 0xffffff, 0.55);
    L.tile = L.style === 'havana' && u(8) < 0.7;
    if (LOWRISE.has(place) && b.h > 20) L.balconies = 1;
  }
  L.wall = L.tint;
  L.roof = pick([0xd8d6d0, 0xc8c6c0, 0xb8b4ac, 0xe0ded8], u(10));
  return L;
}
