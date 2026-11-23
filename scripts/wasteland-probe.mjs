// Developer helper (docs/PLAN_V3.md 13, LOTS): flicker and pop probe, in
// node (no browser). Builds a region's real-map renderer with stand-in
// textures, drives a camera along a road route, samples 200 frames and
// reports:
//   pop    a near tile shown, or a tree changing its shape, within 60 m of
//          the camera at the frame it happens (streamed with the game's
//          per-frame budget, 3 ms, not flushed);
//   depth  ground layers that overlap within 1.5 cm of each other (two
//          upward faces over one point, from different triangles): the
//          pairs that z-fight. Sampled on a 0.5 m lattice inside every
//          upward triangle under 0.3 m of the near tiles round 12 of the
//          frames, by the meshes' names.
// usage: node scripts/wasteland-probe.mjs [region=miami-downtown] [--frames=200] [--roads]
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { buildRealCity } from '../src/render/realcity.js';
import { createLotCarField, LOT_CAR_CAP } from '../src/render/lotmesh.js';

const id = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'miami-downtown';
const FR = +(process.argv.find((a) => a.startsWith('--frames=')) || '--frames=200').slice(9);
const city = createMiamiCity(JSON.parse(fs.readFileSync(`src/world/data/${id}.json`, 'utf8')), { region: id });
const rect = { u0: 0, u1: 1, v0: 0, v1: 1, w: 64, h: 64 };
const rects = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? rect : undefined) });
const tex = new Proxy({}, { get: (o, k) => (k === 'decals' || k === 'details' ? { rects } : {}) });
// --roads: without the block middles (citymesh addBlock, drawn over the
// lots of every rectangular block), as LOTS asked ROADS to change it.
const warn = console.warn;
console.warn = () => {};
const group = buildRealCity(city, createCollisionWorld(), { textures: tex });
console.warn = warn;
const st = group.userData.stream;
const matKey = new Map();
for (const [k, v] of Object.entries(group.userData.materials || {})) if (v && v.isMaterial) matKey.set(v, k);
if (process.argv.includes('--roads')) {
  for (const t of st.tiles) t.blocks.length = 0;
  st.reset();
}
const trees = st.trees();

// The route: from the spawn, edge after edge, never back, preferring
// straight on; FR frames, 7.5 m apart (20 m/s, a frame every 0.375 s).
const route = [];
{
  let n = city.nodes[city.edges[city.edgesNear(city.spawn.x, city.spawn.z, 30, [])[0]].a];
  let prev = -1, hd = null;
  const seen = new Set();
  while (route.length < FR * 7.5 + 50) {
    let best = null, bs = -Infinity;
    for (const k of n.edges) {
      const e = city.edges[k];
      if (k === prev || e.bridge || seen.has(k)) continue;
      const o = city.nodes[e.a === n.id ? e.b : e.a];
      const h = Math.atan2(o.z - n.z, o.x - n.x);
      const s = hd === null ? e.length : Math.cos(h - hd) * 10 + e.length * 0.01;
      if (s > bs) { bs = s; best = { e, o, h }; }
    }
    if (!best) break;
    seen.add(best.e.id);
    const L = Math.hypot(best.o.x - n.x, best.o.z - n.z);
    for (let d = 0; d < L; d += 1) route.push([n.x + (best.o.x - n.x) * (d / L), n.z + (best.o.z - n.z) * (d / L), best.h]);
    prev = best.e.id; hd = best.h; n = best.o;
  }
}
const cam = { isCamera: false, position: { x: route[0][0], y: 3, z: route[0][1] } };
st.flush(cam);
const pops = [], treePops = [], carPops = [];
// The parked cars of the lots (systems/parked.js asks the field a few
// times a second; here at every update): a car that comes into the field
// within 60 m of the camera, in front of it, is a pop.
const field = createLotCarField(city, { cap: LOT_CAR_CAP });
let carSet = null;
function carEvents(f, hx, hz, fx, fz) {
  field.update(cam.position.x, cam.position.z, fx, fz, 13);
  const now = new Set();
  for (let i = 0; i < field.n; i++) now.add(Math.round(field.x[i] * 2) * 100003 + Math.round(field.z[i] * 2));
  if (carSet) {
    for (let i = 0; i < field.n; i++) {
      const key = Math.round(field.x[i] * 2) * 100003 + Math.round(field.z[i] * 2);
      if (carSet.has(key)) continue;
      const dx = field.x[i] - cam.position.x, dz = field.z[i] - cam.position.z, d = Math.hypot(dx, dz);
      if (d < 60 && dx * fx + dz * fz > 0.6 * d) carPops.push(`frame ${f}: parked car ${d.toFixed(0)} m`);
    }
  }
  carSet = now;
  void hx; void hz;
}
const lastLod = new Map();
const depth = new Map();
let checked = 0;
const conflicts = new Map();
function depthCheck() {
  // Upward ground faces of the shown tiles within 80 m.
  const cells = new Map();
  const cx = cam.position.x, cz = cam.position.z;
  for (const t of st.tiles) {
    if (!t.group || !t.shown) continue;
    for (const m of t.meshes) {
      if (!m.visible && !t.small.includes(m)) continue;
      const g = m.geometry, P = g.attributes.position && g.attributes.position.array, I = g.index && g.index.array;
      if (!P || !I) continue;
      const name = (m.name ? m.name + ':' : '') + (matKey.get(m.material) || 'mat');
      // Layers drawn with a depth offset of their own (paint, decals,
      // contact shadows) or without depth writes cannot fight: skipped.
      const mt = m.material;
      if (mt && ((mt.polygonOffset && mt.polygonOffsetFactor < 0) || mt.depthWrite === false || mt.transparent)) continue;
      if (name === 'shadow-proxy') continue;
      for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
        const ya = P[a + 1], yb = P[b + 1], yc = P[c + 1];
        if (Math.abs(ya) > 0.3 || Math.abs(yb) > 0.3 || Math.abs(yc) > 0.3) continue;
        if (Math.abs(ya - yb) > 0.005 || Math.abs(ya - yc) > 0.005) continue; // flat ones only
        const x0 = Math.min(P[a], P[b], P[c]), x1 = Math.max(P[a], P[b], P[c]), z0 = Math.min(P[a + 2], P[b + 2], P[c + 2]), z1 = Math.max(P[a + 2], P[b + 2], P[c + 2]);
        if (x1 < cx - 80 || x0 > cx + 80 || z1 < cz - 80 || z0 > cz + 80) continue;
        const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], qx = P[c], qz = P[c + 2];
        const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
        if (Math.abs(det) < 1e-6) continue;
        for (let x = Math.ceil(x0 * 2) / 2; x <= x1; x += 0.5) {
          for (let z = Math.ceil(z0 * 2) / 2; z <= z1; z += 0.5) {
            const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / det, l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / det, l3 = 1 - l1 - l2;
            if (l1 < 0.02 || l2 < 0.02 || l3 < 0.02) continue;
            const key = Math.round(x * 2) * 100003 + Math.round(z * 2);
            let L = cells.get(key);
            if (!L) cells.set(key, (L = []));
            L.push(ya, name, k);
          }
        }
      }
    }
  }
  for (const [key, L] of cells) {
    checked++;
    for (let i = 0; i < L.length; i += 3) {
      for (let j = i + 3; j < L.length; j += 3) {
        if (L[i + 1] === L[j + 1] && L[i + 2] === L[j + 2]) continue;
        const dy = Math.abs(L[i] - L[j]);
        if (dy < 0.015) {
          const pair = [L[i + 1], L[j + 1]].sort().join(' / ') + ` (${(Math.min(L[i], L[j])).toFixed(3)}, dy ${dy.toFixed(3)})`;
          conflicts.set(pair, (conflicts.get(pair) || 0) + 1);
          if (!depth.has(pair)) depth.set(pair, key);
        }
      }
    }
  }
}
function treeEvents(f) {
  if (!trees) return;
  for (const [k, e] of trees.tiles) {
    if (!e.shown) continue;
    let prev = lastLod.get(k);
    if (!prev || prev.length !== e.n) { lastLod.set(k, Uint8Array.from(e.lod)); continue; }
    for (let i = 0; i < e.n; i++) {
      if (e.lod[i] !== prev[i]) {
        const d = Math.hypot(e.px[i] - cam.position.x, e.pz[i] - cam.position.z);
        if (d < 60) treePops.push(`frame ${f}: tree ${d.toFixed(0)} m ${prev[i]}->${e.lod[i]}`);
        prev[i] = e.lod[i];
      }
    }
  }
}
const step = Math.floor((route.length - 1) / FR);
for (let f = 0; f < FR; f++) {
  const p = route[Math.min(route.length - 1, f * step)];
  // The chase camera: 7 m behind the car, 3 m up.
  cam.position.x = p[0] - Math.cos(p[2]) * 7;
  cam.position.z = p[1] - Math.sin(p[2]) * 7;
  const was = st.tiles.map((t) => t.shown);
  st.stats.speed = 20;
  // 25 updates a sample (0.3 m apart: a 60 fps frame at 18 m/s), events
  // counted at each.
  const q = route[Math.min(route.length - 1, Math.max(0, f * step - step))];
  for (let s = 1; s <= 25; s++) {
    const t = s / 25, hx = q[0] + (p[0] - q[0]) * t, hz = q[1] + (p[1] - q[1]) * t;
    cam.position.x = hx - Math.cos(p[2]) * 7;
    cam.position.z = hz - Math.sin(p[2]) * 7;
    st.update(cam, 3);
    treeEvents(f);
    if (s % 5 === 0) carEvents(f, hx, hz, Math.cos(p[2]), Math.sin(p[2]));
  }
  st.tiles.forEach((t, k) => {
    if (t.shown && !was[k]) {
      const dx = Math.max(t.x0 - cam.position.x, 0, cam.position.x - t.x1), dz = Math.max(t.z0 - cam.position.z, 0, cam.position.z - t.z1);
      const d = Math.hypot(dx, dz);
      if (d < 60) pops.push(`frame ${f}: tile ${k} shown at ${d.toFixed(0)} m`);
    }
  });
  if (f % Math.floor(FR / 12) === 0) depthCheck();
}
const top = [...conflicts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(JSON.stringify({
  region: id, frames: FR, routeM: route.length, built: st.stats.built,
  tilePops: pops.length, treePops: treePops.length, carPops: carPops.length, popSamples: [...pops, ...treePops, ...carPops].slice(0, 8),
  depthPointsChecked: checked, depthConflicts: [...conflicts.values()].reduce((a, b) => a + b, 0), byPair: Object.fromEntries(top),
}, null, 1));
