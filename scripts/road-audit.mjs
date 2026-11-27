// Developer helper (0.15 roads diagnosis, docs/ROADS.md): node-only
// measurements of how much a street changes along its length and at
// junctions, on top of scripts/street-align.mjs. Reads the cities the
// game builds (createMiamiCity); changes nothing.
// usage: node scripts/road-audit.mjs [region,...] [--json] [--list=<metric>]
//        node scripts/road-audit.mjs --png=<file>:<region>:<x>:<z>:<side>
//          (a top view from scripts/aerial-review.mjs: per ground kind under
//          each pixel, the share drawn green (lawn) or pale (sidewalk))
// Metrics (per region):
// - cont: a named street running on (same name, under 35 degrees) through
//   a bend or a junction: pairs; width change over 1 and 3 m; total lane
//   change; turn lane change; parking change; class change; one-way kind
//   change (a divided half against a two-way block); cross-section changes
//   per km of named street; the causes of the width changes over 1 m.
// - widths: per class, the curb-to-curb widths in use (km each).
// - jog: same streets through a junction: lateral offset of the data's node
//   lines (raw) and of the drawn centers (curb midpoints) over 1 m.
// - median: divided runs: a median that starts or stops at a joint
//   (raised median on one block, none on the next).
// - paint: gores whose two arms are one street (chevrons drawn inside one
//   road where a pair parts or meets); edges whose two stop bars lie under
//   3 m apart; paint signature changes along a street.
// - junction: ring area (m2) distribution; nodes per junction; fans.
// - blocks: junction-to-junction runs of driven streets (not service):
//   median, p90; runs under 25 m.
// - paint also counts contradictions: lane lines the lanes do not have
//   (badDash), a center line on a one-way (badCenter), a marked two-way
//   road with no center line (noCenter); absent means 0.
// - slivers: meters of curb with a strip of non-road under 2 m wide and
//   more road beyond it (lawn, sidewalk or median between two surfaces).
// - overlap: meters of strip center inside another strip's curbs, away
//   from junctions (two surfaces drawn over each other).
// - pairs: divided runs (one-way halves of one name); bubbles: runs whose
//   both ends meet a two-way block of the same name.
// Takes about 6 s for the five regions; no browser.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createMiamiCity } from '../src/world/miami.js';
import { REGION_IDS } from '../src/world/regions.js';
import { ringArea, curbsAt, junctionsAt, inJunctionArea } from '../src/world/junctions.js';
const junctionsNear = (geo, x, z) => { const L = junctionsAt(geo, x, z); if (L) for (const J of L) if (inJunctionArea(J, x, z)) return true; return false; };
import { paintLines, divideOf } from '../src/world/roadprofile.js';
import { groundOf } from '../src/world/ground.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL('../src/world/data/' + f, import.meta.url), 'utf8'));
const opt = (n) => { const a = process.argv.find((s) => s.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const RUN_COS = Math.cos((35 * Math.PI) / 180);
const skip = (e) => e.lanesF === undefined || e.causeway || e.ped;
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (v) => Math.round(v * 10) / 10;

function sig(e) {
  const P = paintLines(e, []);
  const k = [];
  for (let i = 1; i < P.length; i += 2) k.push(P[i]);
  return k.sort().join('+') || 'none';
}

export function auditRoads(c) {
  const geo = c.roadGeo, N = c.nodes, E = c.edges;
  const out = {};
  // ---- Street continuity (bends and junctions).
  const cont = { pairs: 0, w1: 0, w3: 0, lanes: 0, turn: 0, park: 0, cls: 0, kind: 0, paint: 0, causes: {}, worst: [] };
  const jog = { through: 0, raw1: 0, drawn1: 0, both: 0, rawMax: 0, drawnMax: 0, worst: [] };
  const med = { joints: 0, toggles: 0, list: [] };
  const seenPair = new Set();
  const visit = (e, f, n, ue, uf, x, z, inJ) => {
    const key = e.id < f.id ? e.id * 1e6 + f.id : f.id * 1e6 + e.id;
    if (seenPair.has(key)) return;
    seenPair.add(key);
    cont.pairs++;
    const dw = Math.abs(e.width - f.width);
    const le = e.lanesF + e.lanesB, lf = f.lanesF + f.lanesB;
    const kind = e.oneway !== f.oneway;
    if (dw > 1) cont.w1++;
    if (dw > 3) cont.w3++;
    if (!kind && le !== lf) cont.lanes++;
    if (!kind && !!e.center !== !!f.center) cont.turn++;
    if (!kind && (e.parkL > 0) + (e.parkR > 0) !== (f.parkL > 0) + (f.parkR > 0)) cont.park++;
    if (e.cls !== f.cls) cont.cls++;
    if (kind) {
      cont.kind++;
      // A divided half against a two-way block: the lanes of the half's
      // direction should match (2 + 2 splits into 2 and 2).
      const one = e.oneway ? e : f, two = e.oneway ? f : e;
      if (one.lanesF !== two.lanesF) cont.kindLanes = (cont.kindLanes || 0) + 1;
      if (one.pair >= 0 && one.median > 0) cont.kindMedian = (cont.kindMedian || 0) + 1;
    }
    if (!kind && sig(e) !== sig(f)) cont.paint++;
    if (dw > 1) {
      const cause = kind ? 'pair/two-way' : e.cls !== f.cls ? 'class ' + [e.cls, f.cls].sort().join('/') : le !== lf ? 'lanes' : e.center !== f.center ? 'turn lane' : 'parking';
      cont.causes[cause] = (cont.causes[cause] || 0) + 1;
      if (cont.worst.length < 400) cont.worst.push({ x: Math.round(x), z: Math.round(z), name: e.name, a: `${e.cls} ${e.width}${e.oneway ? 'o' : ''}`, b: `${f.cls} ${f.width}${f.oneway ? 'o' : ''}`, dw: r1(dw) });
    }
    // Median toggles (divided halves on both sides).
    if (e.oneway && f.oneway && e.pair >= 0 && f.pair >= 0) {
      med.joints++;
      if ((e.median > 0) !== (f.median > 0)) {
        med.toggles++;
        if (med.list.length < 400) med.list.push({ x: Math.round(x), z: Math.round(z), name: e.name, m: [e.median, f.median] });
      }
    }
    // Jogs (only through junctions, same kind).
    if (inJ && !kind) {
      jog.through++;
      const na = N[ue.node], nb = N[uf.node];
      // Arm P leaves along (ue.ux, ue.uz); right normal (-uz, ux).
      const rx = -ue.uz, rz = ue.ux;
      const raw = Math.abs((nb.x - na.x) * rx + (nb.z - na.z) * rz);
      // Drawn: the divide (center line of a two-way road, left lane edge
      // of a one-way) at each mouth, as world points (as test/streetaudit.js).
      const mid = (A) => {
        const ee = A.e, d = A.end ? ee.length - geo.trim[A.q] : geo.trim[A.q];
        const C = curbsAt(geo, ee, d);
        const base = (ee.off || 0) + geo.eoff[ee.id] - ee.width / 2;
        const o = C.l + ((divideOf(ee) + geo.eoff[ee.id] - base) * (C.r - C.l)) / ee.width;
        const nn = N[A.node];
        return [nn.x - ee.uz * o, nn.z + ee.ux * o];
      };
      const pa = mid(ue), pb = mid(uf);
      const drawn = Math.abs((pb[0] - pa[0]) * rx + (pb[1] - pa[1]) * rz);
      const t = e.oneway ? 'oneway' : 'twoway';
      jog[t] = jog[t] || { n: 0, raw1: 0, drawn1: 0, added: 0 };
      jog[t].n++;
      if (raw > 1) jog[t].raw1++;
      if (drawn > 1) jog[t].drawn1++;
      if (drawn > 1 && raw <= 1) jog[t].added++;
      if (raw > 1) jog.raw1++;
      if (drawn > 1) jog.drawn1++;
      if (raw > 1 && drawn > 1) jog.both++;
      jog.rawMax = Math.max(jog.rawMax, raw);
      jog.drawnMax = Math.max(jog.drawnMax, drawn);
      if (drawn > 1 && jog.worst.length < 400) jog.worst.push({ x: Math.round(x), z: Math.round(z), name: e.name, t, raw: r1(raw), drawn: r1(drawn), eoff: [r1(geo.eoff[e.id]), r1(geo.eoff[f.id])], off: [r1(e.off || 0), r1(f.off || 0)], w: [e.width, f.width], div: [r1(divideOf(e)), r1(divideOf(f))] });
    }
  };
  const armOf = (q) => {
    const e = E[q >> 1], end = q & 1, s = end ? -1 : 1;
    return { q, e, end, node: end ? e.b : e.a, ux: e.ux * s, uz: e.uz * s };
  };
  for (const n of N) {
    if (!n.edges || n.edges.length !== 2 || geo.nodeJ[n.id] >= 0) continue;
    const e = E[n.edges[0]], f = E[n.edges[1]];
    if (e === f || skip(e) || skip(f) || !e.name || e.name !== f.name) continue;
    const A = armOf(2 * e.id + (e.b === n.id ? 1 : 0)), B = armOf(2 * f.id + (f.b === n.id ? 1 : 0));
    if (-(A.ux * B.ux + A.uz * B.uz) < RUN_COS) continue;
    visit(e, f, n, A, B, n.x, n.z, false);
  }
  for (const J of geo.junctions) {
    const arms = Array.from(J.arms, armOf);
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const P = arms[i], Q = arms[j];
        if (skip(P.e) || skip(Q.e) || !P.e.name || P.e.name !== Q.e.name) continue;
        if (-(P.ux * Q.ux + P.uz * Q.uz) < RUN_COS) continue;
        if (P.e.oneway && Q.e.oneway && P.end === Q.end) continue;
        visit(P.e, Q.e, null, P, Q, J.x, J.z, true);
      }
    }
  }
  let namedLen = 0;
  for (const e of E) if (!skip(e) && e.name) namedLen += e.length;
  cont.namedKm = r1(namedLen / 1000);
  cont.changesPerKm = r1((cont.w1) / (namedLen / 1000));
  out.cont = cont;
  out.jog = jog;
  out.median = med;
  // ---- Widths per class.
  const widths = {};
  for (const e of E) {
    if (skip(e)) continue;
    const k = e.cls + (e.oneway ? ' oneway' : '');
    const m = (widths[k] = widths[k] || {});
    m[e.width] = (m[e.width] || 0) + e.length / 1000;
  }
  for (const k in widths) {
    const m = widths[k];
    widths[k] = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, km]) => `${w}m:${r1(km)}km`).join(' ');
  }
  out.widths = widths;
  // ---- Paint.
  const paint = { gores: 0, goresSameStreet: 0, goreList: [], stopClash: 0, sigs: {} };
  for (const J of geo.junctions) {
    if (!J.gores) continue;
    for (let k = 0; k < J.gores.length; k++) {
      const G = J.gores[k];
      if (!G) continue;
      paint.gores++;
      // The two arms of the gore: the junction's arms k and k + 1 (ring
      // order); judged by names of all arms leaving within 25 degrees.
      const arms = Array.from(J.arms, armOf);
      const A = arms[k % arms.length], B = arms[(k + 1) % arms.length];
      if (A && B && A.e.name && A.e.name === B.e.name) {
        paint.goresSameStreet++;
        if (paint.goreList.length < 200) paint.goreList.push({ x: Math.round(J.x), z: Math.round(J.z), name: A.e.name });
      }
    }
  }
  for (const e of E) {
    if (skip(e) || geo.inner[e.id]) continue;
    const s = sig(e);
    // Contradictions: lane lines that the lanes do not have, a center line
    // on a one-way, no center line on a marked two-way road.
    const dashes = s.split('+').filter((k) => k === 'dash').length;
    const want = Math.max(0, e.lanesF - 1) + Math.max(0, e.lanesB - 1);
    if (s !== 'none' && dashes !== want) paint.badDash = (paint.badDash || 0) + 1;
    if (e.oneway && /yellow2|turn/.test(s)) paint.badCenter = (paint.badCenter || 0) + 1;
    if (!e.oneway && s !== 'none' && !/yellow2|turn/.test(s)) paint.noCenter = (paint.noCenter || 0) + 1;
    paint.sigs[s] = r1((paint.sigs[s] || 0) + e.length / 1000);
    const qa = 2 * e.id, qb = qa + 1;
    if (geo.ctrl[qa] && geo.ctrl[qb]) {
      const span = e.length - geo.trim[qa] - geo.trim[qb];
      if (span >= 12 && span - 2 * 4.65 < 3) paint.stopClash++;
    }
  }
  out.paint = paint;
  // ---- Junction areas.
  const areas = [], nodesPer = [];
  let fans = 0, hulls = 0, hullArea = 0;
  const big = [];
  for (const J of geo.junctions) {
    const a = Math.abs(ringArea(J.ring));
    areas.push(a);
    nodesPer.push(J.nodes.length);
    if (J.fan) fans++;
    if (J.hullRing) { hulls = (hulls || 0) + 1; hullArea += a; }
    if (a > 1500) big.push({ x: Math.round(J.x), z: Math.round(J.z), area: Math.round(a), nodes: J.nodes.length, arms: J.arms.length });
  }
  big.sort((p, q) => q.area - p.area);
  out.junction = {
    count: areas.length, fans, hulls, hullAreaP: Math.round(hullArea / Math.max(1, hulls)), areaP50: Math.round(pct(areas, 0.5)), areaP90: Math.round(pct(areas, 0.9)), areaMax: Math.round(pct(areas, 1)),
    over800: areas.filter((a) => a > 800).length, over1500: big.length, multiNode: nodesPer.filter((n) => n > 1).length,
    nodes4plus: nodesPer.filter((n) => n >= 4).length, biggest: big.slice(0, 12),
  };
  // ---- Blocks: chain edges through degree-2 nodes, junction to junction.
  const isJ = (id) => geo.nodeJ[id] >= 0 || (N[id].edges && N[id].edges.length !== 2);
  const used = new Uint8Array(E.length);
  const runs = [];
  for (const e of E) {
    if (used[e.id] || skip(e) || e.cls === 'service') continue;
    // Walk both ways.
    let len = 0;
    const stack = [e.id];
    used[e.id] = 1;
    while (stack.length) {
      const k = stack.pop(), f = E[k];
      len += f.length;
      for (const nid of [f.a, f.b]) {
        if (isJ(nid)) continue;
        for (const g of N[nid].edges) if (!used[g] && !skip(E[g]) && E[g].cls !== 'service') { used[g] = 1; stack.push(g); }
      }
    }
    runs.push(len);
  }
  out.blocks = { runs: runs.length, p50: Math.round(pct(runs, 0.5)), p90: Math.round(pct(runs, 0.9)), under25: runs.filter((r) => r < 25).length, over250: runs.filter((r) => r > 250).length };
  // ---- Slivers: a strip of non-road under 2 m wide between this strip's
  // curb and more road beyond it (lawn, sidewalk or median left between two
  // carriageways, or between a strip and a junction), every 2 m along each
  // strip, both curbs, from the physics ground (baseAt, which the meshes
  // follow: see --png). Meters of curb with such a sliver, per kind.
  const G = groundOf(c);
  const sl = { m: 0, land: 0, walk: 0, median: 0, pairM: 0, list: [] };
  for (const e of E) {
    if (skip(e) || geo.inner[e.id]) continue;
    const a = N[e.a], t0 = geo.trim[2 * e.id], t1 = e.length - geo.trim[2 * e.id + 1];
    for (let d = t0 + 1; d < t1 - 1; d += 2) {
      const C = curbsAt(geo, e, d);
      for (let side = 0; side < 2; side++) {
        const o0 = side ? C.r : C.l, s = side ? 1 : -1;
        const px = (o) => a.x + e.ux * d - e.uz * o, pz = (o) => a.z + e.uz * d + e.ux * o;
        let kind = -1, w = 0, back = false;
        for (let k = 1; k <= 8; k++) {
          const o = o0 + s * 0.25 * k, g = G.baseAt(px(o), pz(o));
          if (g === 1) { if (kind >= 0) back = true; break; }
          if (kind < 0) kind = g;
          w = 0.25 * k;
        }
        if (!back || kind < 0) continue;
        sl.m += 2;
        if (kind === 0) sl.land += 2; else if (kind === 2) sl.walk += 2; else sl.median += 2;
        if (e.pair >= 0) sl.pairM += 2;
        if (sl.list.length < 300 && !(sl.m % 40)) sl.list.push({ x: Math.round(px(o0 + s * w / 2)), z: Math.round(pz(o0 + s * w / 2)), name: e.name, kind, w });
      }
    }
  }
  out.slivers = sl;
  // ---- Overlaps: points of a strip (every 4 m on its center, outside every
  // junction) that also lie inside another strip's curbs: two road
  // surfaces drawn at one height over each other (z-fighting, crossing
  // lane paint). Not an edge sharing a node with it (a bend's miter).
  const ov = { m: 0, edges: 0, list: [] };
  const near = [];
  for (const e of E) {
    if (skip(e) || geo.inner[e.id] || e.bridge) continue;
    const a = N[e.a], t0 = geo.trim[2 * e.id], t1 = e.length - geo.trim[2 * e.id + 1];
    let hit = false;
    for (let d = t0 + 2; d < t1 - 2; d += 4) {
      const C = curbsAt(geo, e, d), o = (C.l + C.r) / 2;
      const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
      if (geo.nodeJ && junctionsNear(geo, x, z)) continue;
      c.edgesNear(x, z, 25, near);
      for (let i = 0; i < near.length; i++) {
        const f = E[near[i]];
        if (f === e || skip(f) || f.bridge || geo.inner[f.id] || f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue;
        const fa = N[f.a], df = (x - fa.x) * f.ux + (z - fa.z) * f.uz;
        if (df < geo.trim[2 * f.id] || df > f.length - geo.trim[2 * f.id + 1]) continue;
        const s = -(x - fa.x) * f.uz + (z - fa.z) * f.ux, Cf = curbsAt(geo, f, df);
        if (s > Cf.l + 0.3 && s < Cf.r - 0.3) {
          ov.m += 4;
          hit = true;
          if (ov.list.length < 100 && !(ov.m % 80)) ov.list.push({ x: Math.round(x), z: Math.round(z), a: e.name, b: f.name });
          break;
        }
      }
    }
    if (hit) ov.edges++;
  }
  out.overlap = ov;
  // ---- Divided runs: one-way edges of one name that pair up, joined at
  // shared nodes (either half). A run that meets a two-way block of its
  // own name is a split ("bubble" when both of its ends do so).
  const pu = new Int32Array(E.length).fill(-1);
  const pf = (v) => { while (pu[v] !== v) { pu[v] = pu[pu[v]]; v = pu[v]; } return v; };
  for (const e of E) if (!skip(e) && e.oneway && e.pair >= 0) pu[e.id] = e.id;
  for (const e of E) if (pu[e.id] >= 0 && pu[e.pair] >= 0) { const ra = pf(e.id), rb = pf(e.pair); if (ra !== rb) pu[ra] = rb; }
  for (const n of N) {
    const L = n.edges.filter((k) => pu[k] >= 0);
    for (let i = 1; i < L.length; i++) if (E[L[i]].name === E[L[0]].name) { const ra = pf(L[0]), rb = pf(L[i]); if (ra !== rb) pu[ra] = rb; }
  }
  const runLen = new Map(), runTwo = new Map(), runMed = new Map();
  for (const e of E) {
    if (pu[e.id] < 0) continue;
    const r = pf(e.id);
    runLen.set(r, (runLen.get(r) || 0) + e.length / 2);
    if (e.median > 0) runMed.set(r, (runMed.get(r) || 0) + e.length / 2);
    for (const nid of [e.a, e.b]) for (const k of N[nid].edges) { const f = E[k]; if (!skip(f) && !f.oneway && f.name === e.name) runTwo.set(r, (runTwo.get(r) || 0) + 1); }
  }
  const rl = [...runLen.values()];
  let bubbles = 0, bubbles60 = 0, flatRuns = 0;
  for (const [r, len] of runLen) {
    if ((runTwo.get(r) || 0) >= 2) { bubbles++; if (len < 60) bubbles60++; }
    if (!(runMed.get(r) > 0)) flatRuns++;
  }
  out.pairs = { runs: rl.length, p50: Math.round(pct(rl, 0.5)), under60: rl.filter((v) => v < 60).length, bubbles, bubblesUnder60: bubbles60, noMedianRuns: flatRuns };
  return out;
}

// ---- Pixel audit of an aerial PNG.
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; }
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y ? px[dst - stride + i] : 0, cc = y && i >= bpp ? px[dst - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
      px[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
function pixelAudit(spec) {
  const [file, region, sx, sz, sside] = spec.split(':');
  const c = createMiamiCity(read(region + '.json'), { region });
  const G = groundOf(c);
  const img = decodePng(fs.readFileSync(file));
  const side = +sside, x0 = +sx - side / 2, z0 = +sz - side / 2, m = side / img.w;
  const tally = {};
  for (let j = 0; j < img.h; j += 2) {
    for (let i = 0; i < img.w; i += 2) {
      const x = x0 + (i + 0.5) * m, z = z0 + (j + 0.5) * m;
      const s = G.baseAt(x, z);
      const o = (j * img.w + i) * img.bpp, R = img.px[o], Gc = img.px[o + 1], B = img.px[o + 2];
      const green = Gc > R + 18 && Gc > B + 30;
      const pale = R > 175 && Gc > 165 && B > 140 && Math.abs(R - B) < 60 && !(R > 235 && Gc > 235 && B > 235);
      const gray = R > 55 && R < 135 && Math.abs(R - Gc) < 12 && Math.abs(Gc - B) < 16;
      const t = (tally[s] = tally[s] || { n: 0, green: 0, pale: 0, gray: 0 });
      t.n++;
      if (green) t.green++;
      if (pale) t.pale++;
      if (gray) t.gray++;
    }
  }
  const area = (n) => Math.round(n * 4 * m * m);
  const res = {};
  for (const s in tally) res['ground' + s] = { m2: area(tally[s].n), greenM2: area(tally[s].green), paleM2: area(tally[s].pale), asphaltM2: area(tally[s].gray) };
  return res;
}

if (import.meta.url === 'file://' + process.argv[1] || process.argv[1].endsWith('road-audit.mjs')) {
  const png = opt('png');
  if (png) {
    console.log(JSON.stringify(pixelAudit(png)));
  } else {
    const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const ids = args[0] ? args[0].split(',') : REGION_IDS;
    const list = opt('list');
    const all = {};
    for (const id of ids) {
      const c = createMiamiCity(read(id + '.json'), { region: id });
      const r = auditRoads(c);
      all[id] = r;
      if (list) { console.log(id, JSON.stringify(list.split('.').reduce((o, k) => o && o[k], r), null, 0)); continue; }
      if (process.argv.includes('--json')) continue;
      const { worst, ...cont } = r.cont;
      console.log(`\n== ${id}`);
      console.log('cont', JSON.stringify(cont));
      const { worst: jw, ...jog } = r.jog;
      console.log('jog', JSON.stringify(jog));
      console.log('median', JSON.stringify({ joints: r.median.joints, toggles: r.median.toggles }));
      const { goreList, ...paint } = r.paint;
      console.log('paint', JSON.stringify(paint));
      const { biggest, ...junc } = r.junction;
      console.log('junction', JSON.stringify(junc), 'biggest', JSON.stringify(biggest.slice(0, 4)));
      console.log('blocks', JSON.stringify(r.blocks));
      console.log('slivers', JSON.stringify({ ...r.slivers, list: undefined }), 'overlap', JSON.stringify({ ...r.overlap, list: undefined }));
      console.log('pairs', JSON.stringify(r.pairs));
      console.log('widths', JSON.stringify(r.widths));
      void worst; void jw; void goreList;
    }
    if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 1));
  }
}
