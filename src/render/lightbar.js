// Light bars and beacons of the service vehicles and the police car
// (docs/REVAMP.md 6.11): one mesh per vehicle (a single draw call) whose
// lamps pick a cell of a tiny 8-cell strip by their u coordinate. The lit
// state of a phase is a shared material per bar kind and lamp set, so a
// phase change swaps the material: nothing is made per vehicle or per
// frame. Phases come from lightbarPhase (src/entities/servicevehicles.js),
// counted in game time. Under prefers-reduced-motion the bar holds a
// steady "all lit at half brightness".
//
// Lamp slot i uses strip cell i; cell 7 is the dark housing. Car local
// frame: x forward, y up, z to the car's right (seen from the front, the
// viewer's left): "L" lamps sit at +z, as the police bar always had them.
import * as THREE from 'three';
import { LIGHTBARS, LAMP_COLORS, lightbarPhase } from '../entities/servicevehicles.js';

export { lightbarPhase };

const HOUSING = 0x16171a;
const UNLIT = { red: 0x5a1012, blue: 0x101c5a, white: 0xb8bcc4, amber: 0x6a4208 };
const tmp = new THREE.Color();

function stripTex(cells) {
  const d = new Uint8Array(8 * 4);
  for (let i = 0; i < 8; i++) {
    tmp.setHex(cells[i] || 0);
    d[i * 4] = Math.round(tmp.r * 255);
    d[i * 4 + 1] = Math.round(tmp.g * 255);
    d[i * 4 + 2] = Math.round(tmp.b * 255);
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, 8, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const baseMaps = new Map();
function baseMap(id) {
  let t = baseMaps.get(id);
  if (!t) {
    const cells = new Array(8).fill(HOUSING);
    LIGHTBARS[id].slots.forEach(([, col], i) => { cells[i] = UNLIT[col]; });
    t = stripTex(cells);
    t.colorSpace = THREE.SRGBColorSpace;
    baseMaps.set(id, t);
  }
  return t;
}

// Shared material of bar `id` with the lamps of `mask` lit (half: at half
// brightness). Cached: a handful per bar kind.
const mats = new Map();
export function lightbarMaterial(id, mask, half = false) {
  const key = id + ':' + mask + (half ? 'h' : '');
  let m = mats.get(key);
  if (!m) {
    const b = LIGHTBARS[id];
    const cells = new Array(8).fill(0);
    b.slots.forEach(([, col], i) => {
      if (mask & (1 << i)) {
        tmp.setHex(LAMP_COLORS[col]);
        if (half) tmp.multiplyScalar(0.5);
        cells[i] = tmp.getHex();
      }
    });
    m = new THREE.MeshStandardMaterial({ map: baseMap(id), emissiveMap: stripTex(cells), emissive: 0xffffff, emissiveIntensity: 1.25, metalness: 0.1, roughness: 0.3 });
    m.name = 'rw-lightbar-' + key;
    mats.set(key, m);
  }
  return m;
}
export const lightbarMaterialCount = () => mats.size;

// ---- geometry ------------------------------------------------------------------
// Lamp parts: [slot or -1 for housing, sx, sy, sz, x, y, z, round].
function build(parts) {
  const pos = [], nor = [], uvs = [], idx = [];
  let base = 0;
  for (const [slot, sx, sy, sz, x, y, z, round] of parts) {
    const g = round ? new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 10, 1) : new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    const u = ((slot < 0 ? 7 : slot) + 0.5) / 8;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uvs.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(base + i);
    base += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// Bar geometry for bar `id`, mounted by its own numbers (`m`): the police
// bar is built about its roof mount (origin at the roof), the service
// bars in the body's frame (origin at the ground centre).
//   police: m = { head: [x, y, z] } (headlamp anchor for the wig-wag)
//   others: m = { L, W, H, cabX, cabY } (cab roof centre x and height)
const geoCache = new Map();
export function lightbarGeometry(id, m) {
  const key = id + ':' + JSON.stringify(m);
  let g = geoCache.get(key);
  if (g) return g;
  const p = [];
  if (id === 'police') {
    p.push([-1, 0.28, 0.045, 1.16, 0, 0.022, 0]);
    p.push([0, 0.24, 0.08, 0.52, 0, 0.075, 0.28]);
    p.push([1, 0.24, 0.08, 0.52, 0, 0.075, -0.28]);
    // Wig-wag lamps in the headlamp lenses (relative to the roof mount).
    const [hx, hy, hz] = m.head;
    p.push([2, 0.03, 0.07, 0.2, hx - m.roofX, hy - m.roofY, hz]);
    p.push([3, 0.03, 0.07, 0.2, hx - m.roofX, hy - m.roofY, -hz]);
  } else if (id === 'ambulance') {
    const { W, H, boxX0, boxX1, cabX, cabY } = m;
    const y = H + 0.06, zz = W / 2 - 0.16;
    for (const s of [1, -1]) {
      p.push([0, 0.2, 0.12, 0.2, boxX1 - 0.15, y, s * zz]);
      p.push([1, 0.2, 0.12, 0.2, boxX0 + 0.15, y, s * zz]);
      // Corner lamps also face the sides, low on the box.
      p.push([0, 0.18, 0.16, 0.03, boxX1 - 0.18, H - 0.3, s * (W / 2 + 0.012)]);
      p.push([1, 0.18, 0.16, 0.03, boxX0 + 0.18, H - 0.3, s * (W / 2 + 0.012)]);
    }
    p.push([-1, 0.3, 0.05, 1.1, cabX, cabY + 0.025, 0]);
    p.push([2, 0.24, 0.1, 0.5, cabX, cabY + 0.1, 0]);
    // Grille flashers.
    p.push([0, 0.03, 0.08, 0.16, m.noseX, m.noseY, 0.32]);
    p.push([1, 0.03, 0.08, 0.16, m.noseX, m.noseY, -0.32]);
  } else if (id === 'firetruck') {
    const { W, cabX, cabY, sideX0, sideX1, sideY } = m;
    p.push([-1, 0.34, 0.06, W * 0.86, cabX, cabY + 0.03, 0]);
    p.push([0, 0.28, 0.12, W * 0.36, cabX, cabY + 0.12, W * 0.24]);
    p.push([1, 0.28, 0.12, W * 0.36, cabX, cabY + 0.12, -W * 0.24]);
    p.push([4, 0.2, 0.12, 0.16, cabX, cabY + 0.12, 0]);
    for (const x of [sideX0, sideX1]) {
      p.push([2, 0.2, 0.14, 0.03, x, sideY, W / 2 + 0.015]);
      p.push([3, 0.2, 0.14, 0.03, x, sideY, -W / 2 - 0.015]);
    }
    // Rear corner lamps, the same halves as the sides.
    p.push([2, 0.03, 0.18, 0.14, m.rearX, m.rearY, W / 2 - 0.12]);
    p.push([3, 0.03, 0.18, 0.14, m.rearX, m.rearY, -W / 2 + 0.12]);
  } else if (id === 'garbage') {
    const { cabX, cabY } = m;
    for (const s of [1, -1]) {
      p.push([-1, 0.2, 0.06, 0.2, cabX, cabY + 0.03, s * 0.7]);
      p.push([s > 0 ? 0 : 1, 0.16, 0.18, 0.16, cabX, cabY + 0.15, s * 0.7, true]);
    }
    p.push([0, 0.03, 0.1, 0.1, m.rearX, m.rearY, m.W / 2 - 0.15]);
    p.push([1, 0.03, 0.1, 0.1, m.rearX, m.rearY, -m.W / 2 + 0.15]);
  } else if (id === 'towtruck') {
    const { W, cabX, cabY } = m;
    const span = W * 0.82, seg = span / 4;
    p.push([-1, 0.3, 0.06, span + 0.08, cabX, cabY + 0.03, 0]);
    for (let i = 0; i < 4; i++) p.push([i, 0.24, 0.11, seg - 0.04, cabX, cabY + 0.11, span / 2 - seg * (i + 0.5)]);
  }
  g = build(p);
  geoCache.set(key, g);
  return g;
}

// Triangle count of a bar (tests).
export const lightbarTris = (g) => (g && g.index ? g.index.count / 3 : 0);

// The lamp state for vehicle v now: siren bars follow v.siren, beacons
// follow v.beacon (src/systems/service.js). Returns the shared material.
const PH = { mask: 0, phase: 0, half: false };
export function lightbarState(id, v, time, reduced) {
  const on = !v.wrecked && (id === 'garbage' || id === 'towtruck' ? !!v.beacon : !!v.siren);
  if (!on) return lightbarMaterial(id, 0);
  lightbarPhase(id, time, reduced, PH);
  return lightbarMaterial(id, PH.mask, PH.half);
}
export const lastPhase = PH;
