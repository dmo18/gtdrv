// Free customization (docs/LOOP.md section f): paint, finish, wheels, window
// tint and a decal for any car, kept per vehicle class. No currency: the
// base set is open from the start; a few finishes and one wheel open with
// medals. Pure data and rules (no DOM, no three.js).
export const PAINTS = [
  ['Signal red', 0xc21f1f], ['Sunset orange', 0xe2622a], ['Taxi yellow', 0xe8b820], ['Lime', 0x7fc41f],
  ['Palm green', 0x1f7a44], ['Teal', 0x16877f], ['Sky blue', 0x3f9be0], ['Royal blue', 0x1f3fa8],
  ['Violet', 0x6a3fc0], ['Hot pink', 0xe0408c], ['White', 0xf0f0ee], ['Silver', 0xa9aeb4],
  ['Gunmetal', 0x4a4f57], ['Black', 0x121316], ['Sand', 0xc9b48a], ['Burgundy', 0x6e1524],
];
// Finishes: [name, metalness, roughness, clearcoat, clearcoat roughness, medals needed, of which gold].
// The clearcoat is never 0, so every finish shares one shader program.
export const FINISHES = [
  ['Gloss', 0.12, 0.38, 1, 0.06, 0, 0],
  ['Metallic', 0.6, 0.3, 1, 0.05, 0, 0],
  ['Matte', 0.05, 0.85, 0.04, 0.6, 0, 0],
  ['Satin', 0.3, 0.55, 0.3, 0.3, 0, 0],
  ['Pearl', 0.45, 0.22, 1, 0.02, 5, 0],
  ['Chrome', 1, 0.06, 1, 0.02, 15, 0],
  ['Candy', 0.8, 0.16, 1, 0.01, 0, 10],
];
// Wheels: [name, rim color (multiplies the alloy), medals needed].
export const WHEELS = [
  ['Factory', 0xffffff, 0],
  ['Black', 0x24262a, 0],
  ['White', 0xf4f4f0, 0],
  ['Bronze', 0xb07a3c, 0],
  ['Red', 0xc22222, 0],
  ['Gold', 0xe2b53a, 10],
];
// Window tint: [name, glass darkness 0..1].
export const TINTS = [['Clear', 0], ['Light', 0.35], ['Dark', 0.6], ['Limo', 0.85]];
// Decals: [name, stripe color or -1 for none, kind]. Drawn by the paint shader on the top faces.
export const DECALS = [['None', -1, 0], ['Twin white', 0xf2f2f0, 1], ['Twin black', 0x101114, 1], ['Center red', 0xc21f1f, 2], ['Center gold', 0xe2b53a, 2]];
export const LOOK_KEYS = ['paint', 'finish', 'wheels', 'tint', 'decal'];
const SIZE = { paint: PAINTS.length, finish: FINISHES.length, wheels: WHEELS.length, tint: TINTS.length, decal: DECALS.length };
export const LOOK_SIZE = SIZE;
export const MAX_LOOKS = 40; // vehicle classes with a saved look

// paint -1: the car keeps the color it came in.
export const defaultLook = () => ({ paint: -1, finish: 0, wheels: 0, tint: 0, decal: 0 });
export const isDefaultLook = (l) => !l || (l.paint < 0 && !l.finish && !l.wheels && !l.tint && !l.decal);

// Is option `i` of `key` open with this many medals (any) and gold medals?
export function unlocked(key, i, medals = 0, golds = 0) {
  if (key === 'finish') return !!FINISHES[i] && medals >= FINISHES[i][5] && golds >= FINISHES[i][6];
  if (key === 'wheels') return !!WHEELS[i] && medals >= WHEELS[i][2];
  return i >= (key === 'paint' ? -1 : 0) && i < SIZE[key];
}
// What a locked option needs, as the menu says it.
export function lockText(key, i) {
  if (key === 'finish' && FINISHES[i]) return FINISHES[i][6] ? FINISHES[i][6] + ' gold medals' : FINISHES[i][5] + ' medals';
  if (key === 'wheels' && WHEELS[i]) return WHEELS[i][2] + ' medals';
  return '';
}

// A look read from storage: whole numbers in range, anything else the default.
export function sanitizeLook(raw) {
  const l = defaultLook();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return l;
  for (const k of LOOK_KEYS) {
    const v = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : undefined;
    if (Number.isInteger(v) && v >= (k === 'paint' ? -1 : 0) && v < SIZE[k]) l[k] = v;
  }
  return l;
}

// The paint code a mesh carries: the 24 bit color plus the finish and the
// decal in the bits above (render/vehiclemats.js reads it back). A plain
// color (finish 0, no decal) is its own code, so every other car is as before.
export const CODE_FINISH = 0x1000000, CODE_DECAL = 0x10000000;
export function paintCode(rgb, finish = 0, decal = 0) {
  return (rgb & 0xffffff) + (finish & 15) * CODE_FINISH + (decal & 7) * CODE_DECAL;
}
export const codeRgb = (code) => code % CODE_FINISH;
export const codeFinish = (code) => Math.floor(code / CODE_FINISH) % 16;
export const codeDecal = (code) => Math.floor(code / CODE_DECAL) % 8;
