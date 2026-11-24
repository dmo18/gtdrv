// Miami Beach familiarity checklist (docs/PLAN_V4.md task 9). Builds the
// Beach region from the OSM data in the repo (no network) and checks about
// 50 real streets and places against what the owner, who lived there,
// would expect: name present, neighbors, lanes, one-way status, width in
// feet, median only where real, sidewalk. `node scripts/beach-checklist.mjs`
// prints one line per item and exits 1 on any failure; test/beach-checklist.test.js
// imports `runChecklist` and pins the verified items.
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';

const FT = 3.28084;

// kind: 'two' two-way, 'one' one-way, 'mixed' either, 'ped' pedestrian mall.
// ft: [min, max] curb to curb of the typical (median) edge. lanes: [min, max]
// driving lanes of the typical edge (both ways). median: allowed share of
// edges with a raised median (0 = none). nb: names that must meet the street.
// ord: numbered cross streets must come in order along the street.
export const STREETS = [
  { name: 'Ocean Drive', kind: 'mixed', ft: [26, 44], lanes: [1, 3], median: 0, parking: true, nb: ['5th Street', '1st Street', '15th Street', 'South Pointe Drive'], ord: true, lopsided: 1, note: 'tagged one-way south from 5th to 15th in OSM; the brief says two-way, kept as mapped' },
  { name: 'Collins Avenue', kind: 'two', ft: [22, 60], lanes: [2, 4], median: 0.1, lopsided: 0.1, nb: ['5th Street', '17th Street', '41st Street', 'Lincoln Road', '15th Street'] },
  { name: 'Washington Avenue', kind: 'mixed', ft: [22, 50], lanes: [2, 4], median: 0.1, nb: ['5th Street', '17th Street', '15th Street', 'Lincoln Road', 'Española Way'], ord: true },
  { name: 'Lincoln Road', kind: 'ped', ft: [10, 30], lanes: [1, 2], median: 0.1, sidewalkMin: 3, lopsided: 1, axis: 'x', seq: ['Alton Road', 'Lenox Avenue', 'Michigan Avenue', 'Jefferson Avenue', 'Meridian Avenue', 'Pennsylvania Avenue', 'Washington Avenue', 'Collins Avenue'], nb: ['Collins Avenue', 'Washington Avenue', 'Alton Road'], note: 'mall between Washington and Alton; plain street west of Alton and east of Collins' },
  { name: 'Alton Road', kind: 'mixed', ft: [20, 75], lanes: [2, 6], median: 0.4, lopsided: 0.1, nb: ['5th Street', '17th Street', '15th Street', 'Lincoln Road', 'Dade Boulevard'], ord: true },
  { name: 'West Avenue', kind: 'two', ft: [26, 44], lanes: [2, 3], median: 0, nb: ['5th Street', '17th Street', '15th Street', 'Lincoln Road'], ord: true },
  { name: 'Meridian Avenue', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['5th Street', '17th Street', '15th Street', 'Lincoln Road'], ord: true },
  { name: 'Michigan Avenue', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Lincoln Road', '17th Street', '15th Street'], ord: true },
  { name: 'Jefferson Avenue', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Lincoln Road', '17th Street', '15th Street'], ord: true },
  { name: 'Euclid Avenue', kind: 'two', ft: [30, 44], lanes: [2, 2], median: 0, nb: ['16th Street', '15th Street', '5th Street'], ord: true },
  { name: 'Pennsylvania Avenue', kind: 'two', ft: [22, 44], lanes: [2, 2], median: 0, nb: ['Lincoln Road', 'Española Way'], ord: true },
  { name: 'Drexel Avenue', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0.3, nb: ['16th Street', '15th Street', 'Española Way'], ord: true },
  { name: 'Lenox Avenue', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Lincoln Road', '15th Street', '17th Street'] },
  { name: 'Prairie Avenue', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Dade Boulevard', '41st Street'] },
  { name: 'North Bay Road', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: [] },
  { name: 'Pine Tree Drive', kind: 'mixed', ft: [22, 80], lanes: [2, 6], median: 0.7, nb: ['41st Street'] },
  { name: 'Indian Creek Drive', kind: 'one', ft: [22, 60], lanes: [2, 4], median: 0.3, nb: ['41st Street'], note: 'the southbound carriageway beside Collins Avenue' },
  { name: 'Española Way', kind: 'ped', ft: [10, 30], lanes: [1, 2], median: 0, sidewalkMin: 3, nb: ['Washington Avenue', 'Collins Avenue', 'Drexel Avenue', 'Pennsylvania Avenue'], note: 'pedestrian paving between Washington and Drexel' },
  { name: '5th Street', kind: 'mixed', ft: [22, 90], lanes: [2, 6], median: 0.95, nb: ['Alton Road', 'West Avenue', 'Meridian Avenue', 'Washington Avenue', 'Collins Avenue', 'Ocean Drive'], note: 'the data pairs the one-way carriageways of 5th Street, a planted median between them' },
  { name: '6th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Alton Road', 'Washington Avenue'] },
  { name: '7th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Alton Road', 'Washington Avenue'] },
  { name: '8th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '9th Street', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '10th Street', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '11th Street', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '12th Street', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '13th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '14th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '15th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0.2, nb: ['Washington Avenue', 'Collins Avenue'] },
  { name: '16th Street', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Washington Avenue'] },
  { name: '17th Street', kind: 'two', ft: [22, 75], lanes: [2, 5], median: 0, nb: ['Washington Avenue', 'Collins Avenue', 'Alton Road', 'West Avenue', 'Meridian Avenue'], axis: 'x', seq: ['West Avenue', 'Alton Road', 'Michigan Avenue', 'Meridian Avenue', 'Washington Avenue', 'Collins Avenue'] },
  { name: '18th Street', kind: 'two', ft: [22, 44], lanes: [2, 3], median: 0, nb: ['Alton Road'] },
  { name: '19th Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0.4, nb: [] },
  { name: '20th Street', kind: 'mixed', ft: [22, 50], lanes: [1, 4], median: 0, nb: [] },
  { name: '23rd Street', kind: 'two', ft: [22, 60], lanes: [2, 4], median: 0, nb: [] },
  { name: '41st Street', kind: 'two', ft: [30, 75], lanes: [3, 6], median: 0, nb: ['Collins Avenue', 'Pine Tree Drive', 'Alton Road'], note: 'Arthur Godfrey Road, the Julia Tuttle link; wide in reality' },
  { name: 'Dade Boulevard', kind: 'two', ft: [30, 65], lanes: [2, 5], median: 0, nb: ['Alton Road', 'Purdy Avenue'] },
  { name: 'Venetian Way', kind: 'mixed', ft: [22, 60], lanes: [2, 4], median: 0.3, lopsided: 0.25, nb: ['Dade Boulevard', 'Purdy Avenue'] },
  { name: 'Julia Tuttle Causeway', kind: 'one', ft: [22, 60], lanes: [2, 4], median: 0.2, nb: ['41st Street', 'North Bay Road'], note: 'I-195 deck, one carriageway each way' },
  { name: 'MacArthur Causeway', kind: 'one', ft: [22, 80], lanes: [2, 5], median: 0.9, nb: ['5th Street', 'Fountain Street'], note: 'one carriageway each way (US 41 / I-395)' },
  { name: 'South Pointe Drive', kind: 'mixed', ft: [22, 60], lanes: [1, 4], median: 0.2, nb: ['Washington Avenue', 'Collins Avenue', 'Ocean Drive'] },
  { name: 'Fountain Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0.7, nb: [] },
  { name: '1st Street', kind: 'mixed', ft: [22, 44], lanes: [1, 3], median: 0.5, nb: ['Collins Avenue', 'Washington Avenue'] },
];

// Places: a park, a landmark or a district label by name, near a point.
export const PLACES = [
  { name: 'Flamingo Park', src: 'park', near: [4169, -507], r: 600 },
  { name: 'South Pointe Park', src: 'park', near: [4428, 1471], r: 300 },
  { name: 'Lummus Park', src: 'park', near: [5060, -58], r: 300 },
  { name: 'Collins Park', src: 'park', near: [5122, -1887], r: 300 },
  { name: 'Washington Park', src: 'park', near: [4551, 952], r: 300 },
  { name: 'Española Way', src: 'label', near: [4709, -763], r: 80 },
  { name: 'South Beach', src: 'label', near: [4682, 620], r: 200 },
  { name: 'Miami Beach', src: 'label', near: [4476, -1437], r: 200 },
  { name: 'Mary & Howard Frank Plaza', src: 'label', near: [4688, -1313], r: 200 },
  { name: 'Jackie Gleason Theater of the Performing Arts', src: 'label', near: [4645, -1390], r: 200 },
  { name: 'Lincoln Theatre-New World Symphony Building', src: 'label', near: [4590, -1199], r: 200 },
  { name: 'Venetian Islands', src: 'label', near: [1692, -1339], r: 300 },
];

const readJson = (f) => JSON.parse(fs.readFileSync(new URL('../src/world/data/' + f, import.meta.url), 'utf8'));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const numOf = (n) => { const m = /^(?:West |East |North |South )?(\d+)(?:st|nd|rd|th) Street$/.exec(n); return m ? +m[1] : 0; };

export function loadBeach() {
  const data = readJson('miami-beach.json');
  const city = createMiamiCity(data, { region: 'miami-beach' });
  return { data, city };
}

// The facts of one street: its edges, typical (median) values, neighbors.
export function facts(city, name) {
  const want = norm(name);
  const edges = city.edges.filter((e) => e.name && norm(e.name) === want);
  const at = new Map();
  for (const e of city.edges) for (const n of [e.a, e.b]) { let l = at.get(n); if (!l) at.set(n, (l = [])); l.push(e); }
  const nbr = new Set();
  const ends = [];
  for (const e of edges) {
    for (const n of [e.a, e.b]) {
      for (const o of at.get(n)) if (o.name && norm(o.name) !== want) nbr.add(norm(o.name));
    }
    // Along-street position: z for north-south, x for east-west streets.
    ends.push({ e, mx: (city.nodes[e.a].x + city.nodes[e.b].x) / 2, mz: (city.nodes[e.a].z + city.nodes[e.b].z) / 2 });
  }
  const len = edges.reduce((s, e) => s + e.length, 0);
  const drive = edges.map((e) => e.lanesF + e.lanesB);
  const widths = edges.map((e) => e.width * FT);
  const ow = edges.filter((e) => e.oneway).length;
  const lenOf = (f) => edges.filter(f).reduce((s, e) => s + e.length, 0);
  return {
    name, edges, len, n: edges.length, nbr, ends,
    lanes: edges.length ? median(drive) : 0,
    ft: edges.length ? median(widths) : 0,
    maxFt: edges.length ? Math.max(...widths) : 0,
    onewayShare: edges.length ? lenOf((e) => e.oneway) / len : 0,
    ow, medianShare: edges.length ? lenOf((e) => e.median > 0) / len : 0,
    sidewalk: edges.length ? median(edges.map((e) => e.sidewalk || 0)) : 0,
    pedShare: edges.length ? lenOf((e) => e.ped) / len : 0,
    parkShare: edges.length ? lenOf((e) => e.parkL > 0 || e.parkR > 0) / len : 0,
    // Two-way length with more lanes one way than the other (a lane count
    // that flips with the way's direction is a mapping artifact).
    lopsided: edges.length ? lenOf((e) => !e.oneway && e.lanesF !== e.lanesB) / len : 0,
  };
}

// Numbered cross streets met along a street, in travel order along its
// main axis; returns the sequence of street numbers (West/East merged).
export function crossOrder(city, f) {
  const at = new Map();
  for (const e of city.edges) for (const n of [e.a, e.b]) { let l = at.get(n); if (!l) at.set(n, (l = [])); l.push(e); }
  const horiz = f.ends.length ? (Math.max(...f.ends.map((o) => o.mx)) - Math.min(...f.ends.map((o) => o.mx))) > (Math.max(...f.ends.map((o) => o.mz)) - Math.min(...f.ends.map((o) => o.mz))) : false;
  const seen = new Map();
  for (const { e } of f.ends) {
    for (const n of [e.a, e.b]) {
      for (const o of at.get(n)) {
        const k = numOf(o.name || '');
        if (!k) continue;
        const p = horiz ? city.nodes[n].x : -city.nodes[n].z;
        if (!seen.has(k)) seen.set(k, p);
      }
    }
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map((s) => s[0]);
}

// Count inversions of the sequence (a numbered street met out of order).
export function inversions(seq) {
  let bad = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) bad++;
  return bad;
}

// Coordinate along `axis` ('x' west to east, 'z' north to south is z
// negated) of the first node that streets f and g share (or touch by name).
export function meetPos(city, f, g, axis) {
  const nodes = new Set();
  for (const e of g.edges) { nodes.add(e.a); nodes.add(e.b); }
  for (const { e } of f.ends) {
    for (const n of [e.a, e.b]) if (nodes.has(n)) return axis === 'x' ? city.nodes[n].x : -city.nodes[n].z;
  }
  return NaN;
}

export function checkStreet(city, spec) {
  const f = facts(city, spec.name);
  const fails = [];
  if (f.n === 0 || f.len < 100) fails.push(`missing (${f.n} edges, ${Math.round(f.len)} m)`);
  else {
    for (const nb of spec.nb) if (!f.nbr.has(norm(nb))) fails.push(`does not meet ${nb}`);
    const [fl, fh] = spec.ft;
    if (f.ft < fl || f.ft > fh) fails.push(`typical width ${f.ft.toFixed(0)} ft outside ${fl}-${fh}`);
    if (f.lanes < spec.lanes[0] || f.lanes > spec.lanes[1]) fails.push(`typical ${f.lanes} lanes outside ${spec.lanes.join('-')}`);
    if (spec.kind === 'two' && f.onewayShare > 0.35) fails.push(`one-way share ${(f.onewayShare * 100).toFixed(0)} % on a two-way street`);
    if (spec.kind === 'one' && f.onewayShare < 0.65) fails.push(`one-way share ${(f.onewayShare * 100).toFixed(0)} % on a one-way street`);
    if (spec.kind === 'ped' && f.pedShare < 0.1) fails.push('no pedestrian paving');
    if (spec.kind !== 'ped' && f.pedShare > 0.05 && spec.name !== 'Lincoln Road') fails.push('pedestrian paving on a street');
    if (f.medianShare > spec.median + 1e-9) fails.push(`median on ${(f.medianShare * 100).toFixed(0)} % of its length (allowed ${(spec.median * 100).toFixed(0)} %)`);
    if (f.sidewalk < (spec.sidewalkMin || 1.8) && spec.kind !== 'one') fails.push(`sidewalk ${f.sidewalk} m`);
    if (spec.parking && f.parkShare < 0.5) fails.push(`curb parking on only ${(f.parkShare * 100).toFixed(0)} % of its length`);
    if (f.lopsided > (spec.lopsided ?? 0.15)) fails.push(`${(f.lopsided * 100).toFixed(0)} % of its length has unequal lanes each way`);
    if (spec.seq) {
      const pos = spec.seq.map((n) => { const g = facts(city, n); return g.edges.length ? meetPos(city, f, g, spec.axis) : NaN; });
      for (let i = 0; i < pos.length; i++) if (Number.isNaN(pos[i])) fails.push(`${spec.seq[i]} does not meet it`);
      for (let i = 1; i < pos.length; i++) if (pos[i] <= pos[i - 1]) fails.push(`${spec.seq[i]} is not after ${spec.seq[i - 1]}`);
    }
    if (spec.ord) {
      const seq = crossOrder(city, f);
      const bad = inversions(seq);
      if (bad > 0) fails.push(`numbered cross streets out of order: ${seq.join(' ')}`);
    }
  }
  return { spec, f, fails };
}

export function checkPlace(data, spec) {
  let hit = null;
  const d2 = (x, z) => (x - spec.near[0]) ** 2 + (z - spec.near[1]) ** 2;
  if (spec.src === 'label') {
    for (const l of data.labels) if (norm(l.name) === norm(spec.name) && d2(l.x, l.z) <= spec.r * spec.r) hit = l;
  } else if (data.parks) {
    // Parks carry no name in `parks`; the names come from the park label table.
    for (const p of data.parks) {
      if (p.name !== spec.name) continue;
      let x = 0, z = 0, sx = 0, sz = 0;
      for (let i = 0; i < p.p.length; i += 2) { x += p.p[i]; z += p.p[i + 1]; sx += x; sz += z; }
      const k = p.p.length / 2;
      hit = { x: sx / k / 10, z: sz / k / 10 };
    }
    if (hit && d2(hit.x, hit.z) > spec.r * spec.r) hit = null;
  }
  return { spec, hit, fails: hit ? [] : [`${spec.name} not found within ${spec.r} m of ${spec.near.join(',')}`] };
}

export function runChecklist() {
  const { data, city } = loadBeach();
  return { streets: STREETS.map((s) => checkStreet(city, s)), places: PLACES.map((p) => checkPlace(data, p)), city, data };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runChecklist();
  let bad = 0;
  for (const { spec, f, fails } of r.streets) {
    const status = fails.length ? 'FAIL' : 'ok  ';
    bad += fails.length ? 1 : 0;
    console.log(`${status} ${spec.name.padEnd(24)} ${Math.round(f.len).toString().padStart(5)} m  ${f.lanes} lanes  ${f.ft.toFixed(0).padStart(3)} ft (max ${f.maxFt.toFixed(0)})  one-way ${(f.onewayShare * 100).toFixed(0).padStart(3)} %  median ${(f.medianShare * 100).toFixed(0).padStart(3)} %  sidewalk ${f.sidewalk}  park ${(f.parkShare * 100).toFixed(0)} %${fails.length ? '\n       ' + fails.join('\n       ') : ''}`);
  }
  for (const { spec, fails } of r.places) {
    bad += fails.length ? 1 : 0;
    console.log(`${fails.length ? 'FAIL' : 'ok  '} ${spec.name}${fails.length ? ' ' + fails.join('; ') : ''}`);
  }
  console.log(`${r.streets.length + r.places.length} items, ${bad} failing`);
  process.exit(bad ? 1 : 0);
}
