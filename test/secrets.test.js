import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/world/citygen.js';
import {
  findSecrets, discover, hintFor, inReach, emptySecrets, secretsDone, garageGeometry,
  SECRET_IDS, DISCOVER_R, SECRETS_SEED,
} from '../src/world/secrets.js';
import { sanitizeProgress, defaultProgress, loadProgress, saveProgress, SAVE_KEY } from '../src/core/save.js';
import { VEHICLE_SPECS, createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createCollisionWorld } from '../src/world/collision.js';

const city = generateCity();
const layout = findSecrets(city);

test('six secrets, one per id, found deterministically from the seed', () => {
  assert.equal(layout.spots.length, 6);
  assert.deepEqual(layout.spots.map((s) => s.id), SECRET_IDS);
  const again = findSecrets(generateCity());
  assert.deepEqual(again, layout);
  assert.equal(SECRETS_SEED, 4417);
  const other = findSecrets(city, 99);
  assert.notDeepEqual(other.spots.map((s) => [s.x, s.z]), layout.spots.map((s) => [s.x, s.z]));
  assert.equal(other.spots.length, 6);
});

test('all six are on the main island: not in the sea, not on the airfield', () => {
  const { islet, runway, apron } = city.airfield;
  const inside = (r, x, z, m = 30) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
  for (const s of layout.spots) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z), s.id);
    assert.ok(city.mainShore(s.x, s.z) > 0, s.id + ' on the island');
    assert.ok(city.isLand(s.x, s.z), s.id + ' on land');
    assert.notEqual(city.districtOf(s.x, s.z), 'airfield', s.id);
    for (const r of [islet, runway, apron]) assert.ok(!inside(r, s.x, s.z), s.id + ' clear of the airfield');
  }
});

test('they are spread out and none sits inside a building (except the roof)', () => {
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const a = layout.spots[i], b = layout.spots[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 3 * DISCOVER_R, a.id + ' / ' + b.id);
    }
  }
  for (const s of layout.spots) {
    if (s.kind === 'rooftop') continue;
    const hit = city.buildings.some((b) => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1);
    assert.ok(!hit, s.id + ' not inside a building');
  }
  const roof = layout.spots.find((s) => s.kind === 'rooftop');
  assert.ok(roof.minY > 3 && roof.minY < roof.roofY);
  assert.ok(city.buildings.some((b) => b.h === roof.roofY && roof.x > b.x0 && roof.x < b.x1));
});

test('the garage stands on open ground, clear of buildings, the sea and the airfield', () => {
  const g = layout.garage;
  assert.ok(g, 'a garage was found');
  assert.ok(city.mainShore(g.x, g.z) > 10);
  assert.notEqual(city.districtOf(g.x, g.z), 'airfield');
  const f = g.footprint;
  for (const b of city.buildings) {
    const hit = f.x0 < b.x1 && f.x1 > b.x0 && f.z0 < b.z1 && f.z1 > b.z0;
    assert.ok(!hit, 'garage overlaps a building');
  }
  // The car stands inside the walls, nose toward the door.
  assert.ok(g.carX > f.x0 && g.carX < f.x1 && g.carZ > f.z0 && g.carZ < f.z1);
  const geo = garageGeometry(0, 0, Math.PI / 2);
  assert.ok(Math.abs(geo.carZ + 4.5) < 1e-9 && Math.abs(geo.carX) < 1e-9);
});

test('discovery fires once per secret, within reach only', () => {
  const st = emptySecrets();
  const s = layout.spots[0];
  assert.equal(discover(st, layout.spots, s.x + DISCOVER_R + 1, 0, s.z), null);
  assert.equal(st.found.length, 0);
  const first = discover(st, layout.spots, s.x + DISCOVER_R - 1, 0, s.z);
  assert.equal(first.id, s.id);
  assert.deepEqual(st.found, [s.id]);
  assert.equal(discover(st, layout.spots, s.x, 0, s.z), null, 'not twice');
  assert.deepEqual(st.found, [s.id]);
});

test('the rooftop needs height; the sixth find unlocks the car', () => {
  const st = emptySecrets();
  const roof = layout.spots.find((s) => s.kind === 'rooftop');
  assert.ok(!inReach(roof, roof.x, 0, roof.z));
  assert.equal(discover(st, layout.spots, roof.x, 0, roof.z), null);
  assert.equal(discover(st, layout.spots, roof.x, roof.roofY + 1, roof.z).id, roof.id);
  for (const s of layout.spots) {
    assert.equal(st.ghostwake, false);
    discover(st, layout.spots, s.x, s.minY == null ? 0 : s.roofY, s.z);
  }
  assert.equal(st.found.length, 6);
  assert.ok(secretsDone(st));
  assert.equal(st.ghostwake, true);
});

test('the map hint appears only after a find, is off the spot, and ends with the set', () => {
  const st = emptySecrets();
  assert.equal(hintFor(st, layout.spots), null);
  discover(st, layout.spots, layout.spots[0].x, 0, layout.spots[0].z);
  const h = hintFor(st, layout.spots);
  assert.ok(h && h.id === layout.spots[1].id);
  const d = Math.hypot(h.x - layout.spots[1].x, h.z - layout.spots[1].z);
  assert.ok(d > DISCOVER_R && d < 100, 'a neighbourhood, not the spot');
  st.found = SECRET_IDS.slice();
  assert.equal(hintFor(st, layout.spots), null);
});

test('the sanitiser keeps known ids once each and rejects the rest', () => {
  assert.deepEqual(defaultProgress().secrets, { found: [], ghostwake: false });
  const p = sanitizeProgress({ version: 3, secrets: { found: ['rustlamp', 'rustlamp', 'bogus', 7, null, '__proto__', 'lone-ride'], ghostwake: true } });
  assert.deepEqual(p.secrets.found, ['rustlamp', 'lone-ride']);
  assert.equal(p.secrets.ghostwake, false, 'the car needs all six, whatever the flag says');
  const all = sanitizeProgress({ secrets: { found: SECRET_IDS, ghostwake: false } });
  assert.equal(all.secrets.ghostwake, true);
  for (const bad of [null, 5, 'x', [], { found: 'rustlamp' }, { found: { 0: 'rustlamp' } }]) {
    assert.deepEqual(sanitizeProgress({ secrets: bad }).secrets, { found: [], ghostwake: false });
  }
});

test('old saves without secrets load clean, and secrets survive a save round trip', () => {
  const old = sanitizeProgress({ version: 3, score: { total: 120 } });
  assert.deepEqual(old.secrets, { found: [], ghostwake: false });
  assert.equal(old.score.total, 120);
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const p = defaultProgress();
  p.secrets.found.push('the-gullet', 'tag-alley');
  assert.ok(saveProgress(storage, p));
  assert.deepEqual(loadProgress(storage).secrets.found, ['the-gullet', 'tag-alley']);
  mem.set(SAVE_KEY, JSON.stringify({ version: 3, secrets: { found: ['evil'] } }));
  assert.deepEqual(loadProgress(storage).secrets.found, []);
});

test('Ghostwake: a sports-car chassis about 10 percent quicker at the top', () => {
  const g = VEHICLE_SPECS.ghostwake, s = VEHICLE_SPECS.sports;
  assert.ok(g && g.pedSafe === true && g.glow);
  assert.ok(g.maxSpeed / s.maxSpeed > 1.08 && g.maxSpeed / s.maxSpeed < 1.12);
  const top = (id) => {
    const v = createVehicle(id, 0, 0, 0);
    const w = { collision: createCollisionWorld() };
    for (let i = 0; i < 60 * 60; i++) stepVehicle(v, { throttle: 1, steer: 0, brake: 0 }, 1 / 60, w);
    return v.speed;
  };
  const a = top('ghostwake'), b = top('sports');
  assert.ok(a > b * 1.05, `ghostwake ${a.toFixed(1)} vs sports ${b.toFixed(1)}`);
});

test('the system: toast and score once, the sixth unlocks and parks Ghostwake, door opens near', async () => {
  const { createSecrets } = await import('../src/systems/secrets.js');
  const { createEvents } = await import('../src/core/events.js');
  const { createRng } = await import('../src/core/rng.js');
  const toasts = [], awards = [], vehicles = [];
  const markers = [];
  const game = {
    city, events: createEvents(), rng: createRng(5), progress: defaultProgress(),
    collision: createCollisionWorld(), vehicles, garage: [],
    player: { x: 0, y: 0, z: 0 },
    hud: { toast: (t) => toasts.push(t) },
    score: { add: (p, why) => awards.push([p, why]) },
    map: { addMarker: (m) => markers.push(m), removeMarker: (m) => markers.splice(markers.indexOf(m), 1) },
    addVehicle: (v) => vehicles.push(v),
  };
  const sys = createSecrets(game);
  const run = (n) => { for (let i = 0; i < n; i++) sys.fixedUpdate(1 / 60); };
  const [a, ...rest] = sys.spots;
  run(30);
  assert.equal(sys.count(), 0);
  assert.equal(markers.length, 0, 'no hint before the first find');
  game.player.x = a.x + 3;
  game.player.z = a.z;
  run(60);
  run(60);
  assert.equal(sys.count(), 1);
  assert.equal(awards.length, 1, 'one bonus, not two');
  assert.equal(toasts.length, 1);
  assert.equal(markers.length, 1, 'a faint hint after the first find');
  for (const s of rest) {
    game.player.x = s.x;
    game.player.z = s.z;
    game.player.y = s.minY == null ? 0 : s.roofY;
    run(20);
  }
  assert.equal(sys.count(), 6);
  assert.ok(sys.unlocked());
  assert.ok(toasts.some((t) => t.includes('Ghostwake unlocked')));
  assert.equal(vehicles.filter((v) => v.spec.id === 'ghostwake').length, 1);
  run(300);
  assert.equal(vehicles.filter((v) => v.spec.id === 'ghostwake').length, 1, 'never a second car');
  const g = sys.garage;
  game.player.x = g.ox + 5 * Math.cos(g.heading);
  game.player.z = g.oz + 5 * Math.sin(g.heading);
  run(120);
  assert.equal(sys.doorOpen, 1);
  game.player.x = 0;
  game.player.z = 0;
  run(120);
  assert.equal(sys.doorOpen, 0);
});

// ---- Regions (docs/PLAN_V2.md 3.2): a region holds the secrets inside it
// and builds those alone; no secret moves, the Ghostwake garage is in Downtown
// and West. ----
import { regionCity, allRegionCities } from './regionfixture.js';
import { regionFor, inRegion, PLACE_MARGIN } from '../src/world/regions.js';
import { placeSecrets } from '../src/world/secrets.js';
import { regionSecretSpec } from '../src/world/regioncontent.js';
import { MIAMI_SPOTS } from '../src/world/miami-spots.js';

const SECRETS = {
  'miami-downtown': SECRET_IDS,
  'miami-beach': ['rustlamp'],
  'miami-north': ['roof-garden', 'tag-alley', 'lone-ride'],
  'miami-west': [],
  'miami-south': [],
};

test('regions: the partial spec holds the secrets 40 m inside; the six keep their ids and places in every region that holds them', () => {
  for (const [id, c] of allRegionCities()) {
    const spec = regionSecretSpec(regionFor(id));
    assert.deepEqual(Object.keys(spec).filter((k) => k !== 'garage').sort(), SECRETS[id].slice().sort(), id + ' spec');
    assert.deepEqual(c.secretSpots.map((s) => s.id), SECRET_IDS.filter((k) => SECRETS[id].includes(k)), id + ' built');
    assert.equal(!!c.secretGarage, id === 'miami-downtown' || id === 'miami-west', id + ' Ghostwake garage');
    for (const s of c.secretSpots) assert.ok(inRegion(regionFor(id), s.x, s.z, PLACE_MARGIN), `${id} ${s.id} inside`);
    for (const k of Object.keys(spec)) {
      const s = spec[k];
      if (s.region) assert.ok([[s.region.x0, s.region.z0], [s.region.x1, s.region.z1]].every(([x, z]) => inRegion(regionFor(id), x, z, PLACE_MARGIN)), id + ' ' + k);
      else assert.ok(inRegion(regionFor(id), s.x, s.z, PLACE_MARGIN), id + ' ' + k);
    }
  }
  const all = new Set(Object.values(SECRETS).flat());
  assert.equal(all.size, 6, 'every secret is in some region');
  // Wynwood's roof and alley are in both Downtown and North: the same alley, and a
  // roof of the same rect (the pick among equal roofs can differ by a block).
  const dt = regionCity('miami-downtown'), nt = regionCity('miami-north');
  for (const [k, max] of [['tag-alley', 1], ['lone-ride', 1], ['roof-garden', 150]]) {
    const a = dt.secretSpots.find((s) => s.id === k), b = nt.secretSpots.find((s) => s.id === k);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < max, k + ' is one place in both');
  }
});

test('regions: placed secrets are on open ground, apart, the roof and alley are real, notes are the Miami ones', () => {
  for (const [id, c] of allRegionCities()) {
    const list = c.secretSpots;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) assert.ok(Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z) > 3 * DISCOVER_R, `${id} ${list[i].id} / ${list[j].id}`);
    }
    for (const s of list) {
      assert.equal(s.note || MIAMI_SPOTS.secretNotes[s.id], MIAMI_SPOTS.secretNotes[s.id], id + ' ' + s.id);
      if (s.kind === 'rooftop') {
        assert.ok(s.minY > 3 && s.minY < s.roofY);
        assert.ok(c.buildings.some((b) => b.h === s.roofY && s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1), id + ' roof');
        continue;
      }
      assert.ok(!c.buildings.some((b) => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1), `${id} ${s.id} inside a building`);
    }
    if (c.secretGarage) {
      const f = c.secretGarage.footprint;
      assert.ok(!c.buildings.some((b) => f.x0 < b.x1 && f.x1 > b.x0 && f.z0 < b.z1 && f.z1 > b.z0), id + ' garage overlaps a building');
      assert.ok(c.mainShore(c.secretGarage.x, c.secretGarage.z) > 10, id + ' garage inland');
      assert.ok(inRegion(regionFor(id), c.secretGarage.x, c.secretGarage.z, 20), id + ' garage inside');
    }
  }
});

test('regions: a partial spec places only its ids; a region leaves out one it cannot place, the whole box throws', () => {
  const north = regionCity('miami-north');
  const one = placeSecrets(north, { 'lone-ride': MIAMI_SPOTS.secrets['lone-ride'] });
  assert.deepEqual(one.spots.map((s) => s.id), ['lone-ride']);
  assert.equal(one.garage, null);
  assert.deepEqual(placeSecrets(north, {}).spots, []);
  // A shore secret pointed at a spot with no shore: left out in a region...
  const spec = { 'drowned-box': { x: -3000, z: -2600 } };
  assert.deepEqual(placeSecrets(north, spec).spots, []);
  // ...and an error on the whole box.
  assert.throws(() => placeSecrets({ ...north, region: null }, spec), /no place for drowned-box/);
});
