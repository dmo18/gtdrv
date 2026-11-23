// What every Miami region must have (docs/PLAN_V2.md 3.3 content floor and
// 3.7): built with createMiamiCity(data, { region }) and wired with
// attachExplore, the same as the game. Counts are pinned per region.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { regionCity, allRegionCities, REGION_IDS } from './regionfixture.js';
import { regionFor, inRegion, START_EDGE, DEFAULT_REGION } from '../src/world/regions.js';
import { GARAGE_DEFS } from '../src/world/garages.js';
import { ADVENTURE_DEFS, adventureInRegion, attachExplore } from '../src/world/adventures.js';
import { SECRET_IDS } from '../src/world/secrets.js';
import { MIAMI_SPOTS } from '../src/world/miami-spots.js';
import { regionSecretSpec, attachRegionContent } from '../src/world/regioncontent.js';
import { regionServiceSpots } from '../src/systems/service.js';

// Counts measured 2026-11-23 (a change here means the content changed:
// find out why before re-pinning). ramps: street plus dock; helipads: all.
const COUNTS = {
  'miami-downtown': { garages: 5, adventures: 8, courses: 14, routes: 2, secrets: 6, ramps: 6, piers: 4, service: 20 },
  'miami-beach': { garages: 2, adventures: 3, courses: 3, routes: 1, secrets: 1, ramps: 2, piers: 1, service: 1 },
  'miami-north': { garages: 4, adventures: 2, courses: 6, routes: 0, secrets: 3, ramps: 4, piers: 2, service: 3 },
  'miami-west': { garages: 2, adventures: 1, courses: 2, routes: 0, secrets: 0, ramps: 2, piers: 1, service: 6 },
  'miami-south': { garages: 1, adventures: 2, courses: 3, routes: 0, secrets: 0, ramps: 2, piers: 1, service: 1 },
};

test('content counts per region are pinned', () => {
  for (const [id, c] of allRegionCities()) {
    const got = {
      garages: c.garages.length, adventures: c.adventures.length, courses: c.courses.length, routes: c.routes.length,
      secrets: c.secretSpots.length, ramps: c.rampSpots.length, piers: c.piers.length, service: regionServiceSpots(c).length,
    };
    assert.deepEqual(got, COUNTS[id], id);
  }
});

test('the content floor: start, garages, adventures, courses, a pier with boats, a helipad with a helicopter, two ramps', () => {
  for (const [id, c] of allRegionCities()) {
    const r = regionFor(id);
    const crop = r.crop;
    // A start place on a named street, with a start view, 300 m or more from every edge.
    assert.ok(c.startView, id + ' start view');
    assert.equal(c.startView.spawn.x, c.spawn.x);
    assert.equal(c.startView.spawn.z, c.spawn.z);
    assert.ok(c.startView.spawn.street && c.startView.camera && c.startView.traffic >= 6 && c.startView.parked >= 6, id);
    for (const d of [c.spawn.x - crop.x0, crop.x1 - c.spawn.x, c.spawn.z - crop.z0, crop.z1 - c.spawn.z]) assert.ok(d >= START_EDGE, id + ' start near an edge');
    assert.ok(c.onRoad(c.spawn.x, c.spawn.z) || c.edgesNear(c.spawn.x, c.spawn.z, 12, []).length > 0, id + ' start on a road');
    // Garages, adventures, courses, routes inside the crop.
    assert.ok(c.garages.length >= 1 && c.adventures.length >= 1 && c.courses.length >= 1, id);
    // A pier on the main land with boats beside it.
    const main = c.piers.filter((p) => p.label !== 'Airfield Dock');
    assert.ok(main.length >= 1, id + ' pier');
    const near = (p, q, m) => q.x > p.x0 - m && q.x < p.x1 + m && q.z > p.z0 - m && q.z < p.z1 + m;
    for (const p of main) assert.ok(c.boatSpots.filter((b) => near(p, b, 50)).length >= 2, id + ' boats at ' + p.label);
    // A helipad on the mainland with a helicopter on it.
    const af = c.airfield && c.airfield.islet;
    const onIslet = (q) => !!af && q.x > af.x0 && q.x < af.x1 && q.z > af.z0 && q.z < af.z1;
    const pads = c.helipads.filter((h) => !onIslet(h));
    assert.ok(pads.length >= 1, id + ' helipad');
    for (const h of pads) {
      if (id === DEFAULT_REGION) continue; // Watson Island's pad has no helicopter today
      assert.ok(c.aircraftSpots.some((a) => a.spec === 'heli' && Math.hypot(a.x - h.x, a.z - h.z) < 1), id + ' a helicopter on the pad');
    }
    // Two stunt ramps.
    assert.ok(c.rampSpots.length >= 2, id + ' ramps');
    // The beach and the south shore have a seaplane at the pier.
    if (id === 'miami-beach' || id === 'miami-south') {
      const sea = c.aircraftSpots.filter((a) => a.spec === 'seaplane');
      assert.ok(sea.length >= 1, id + ' seaplane');
      assert.ok(sea.every((a) => c.shoreDist(a.x, a.z) < -15), id + ' seaplane afloat');
    }
    // Craft text names this region's places, not Downtown's.
    assert.ok(c.texts && c.texts.craft && c.texts.fleet && c.texts.boot, id + ' texts');
    if (id !== DEFAULT_REGION) assert.ok(!/Bayfront Marina|Saltyard/.test(c.texts.craft + c.texts.fleet), id + ' texts of another region');
  }
});

test('everything placed is inside its region and on the right ground', () => {
  for (const [id, c] of allRegionCities()) {
    const r = regionFor(id);
    for (const g of c.garages) assert.ok(inRegion(r, g.x, g.z, 20), id + ' ' + g.id);
    for (const a of c.adventures) {
      assert.ok(inRegion(r, a.giver.x, a.giver.z, 20), id + ' ' + a.id + ' giver');
      for (const s of a.steps) assert.ok(inRegion(r, s.x, s.z, 20), id + ' ' + a.id + ' step');
    }
    for (const s of c.secretSpots) assert.ok(inRegion(r, s.x, s.z, 40), id + ' ' + s.id);
    for (const p of c.piers) assert.ok(inRegion(r, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, 40), id + ' ' + p.label);
    for (const k of c.rampSpots) {
      assert.ok(inRegion(r, k.x, k.z, 40), id + ' ' + k.id);
      assert.ok(k.water ? c.shoreDist(k.x, k.z) < 0 : c.isLand(k.x, k.z), id + ' ' + k.id + ' on its ground');
    }
    for (const q of c.courses.concat(c.routes)) {
      assert.ok(inRegion(r, q.start.x, q.start.z, 20), id + ' ' + q.id + ' start');
    }
  }
});

test('every garage, adventure, secret and course is in a region; none is offered where it is not held', () => {
  const garages = new Set(), advs = new Set(), secrets = new Set(), courses = new Set();
  for (const [id, c] of allRegionCities()) {
    for (const g of c.garages) garages.add(g.id);
    for (const a of c.adventures) {
      advs.add(a.id);
      assert.ok(adventureInRegion(ADVENTURE_DEFS.find((d) => d.id === a.id), regionFor(id)), id + ' offers ' + a.id + ' it does not hold');
    }
    for (const s of c.secretSpots) secrets.add(s.id);
    for (const q of c.courses) courses.add(q.id);
    // Held by the table but not placed: only a generated spot may have failed, never silently a hand one.
    for (const d of GARAGE_DEFS) if (inRegion(regionFor(id), d.x, d.z, 60)) assert.ok(c.garages.some((g) => g.id === d.id), id + ' lost ' + d.id);
    for (const d of ADVENTURE_DEFS) if (adventureInRegion(d, regionFor(id))) assert.ok(c.adventures.some((a) => a.id === d.id), id + ' lost ' + d.id);
  }
  assert.equal(garages.size, GARAGE_DEFS.length, 'all twelve garages are in a region');
  assert.equal(advs.size, ADVENTURE_DEFS.length, 'all sixteen adventures are in a region');
  assert.equal(secrets.size, SECRET_IDS.length, 'all six secrets are in a region');
  for (const id of ['street-glasswell', 'street-fernside', 'street-rim', 'boat-saltyard', 'sky-threader']) assert.ok(courses.has(id), id);
});

test('Roads End is the South only; Palm Island Sprint is Downtown only; the Beach has its Mile', () => {
  for (const [id, c] of allRegionCities()) {
    assert.equal(c.adventures.some((a) => a.id === 'a-roads-end'), id === 'miami-south', id);
    assert.equal(c.courses.some((q) => q.id === 'boat-saltyard'), id === 'miami-downtown', id);
    assert.equal(c.routes.some((q) => q.id === 'street-x-beach'), id === 'miami-beach', id);
    assert.equal(c.routes.some((q) => q.id === 'street-x-keys'), id === 'miami-downtown', id);
    assert.equal(c.routes.some((q) => q.id === 'boat-x-river'), id === 'miami-downtown', id);
  }
  const south = regionCity('miami-south');
  const re = south.adventures.find((a) => a.id === 'a-roads-end');
  assert.ok(south.garages.some((g) => g.id === re.reward.garage), 'its reward garage is in the South');
});

test('the Ghostwake garage and the secrets a region holds', () => {
  assert.ok(regionCity('miami-downtown').secretGarage && regionCity('miami-west').secretGarage, 'Downtown and West');
  for (const id of ['miami-beach', 'miami-north', 'miami-south']) assert.equal(regionCity(id).secretGarage, null, id);
  assert.deepEqual(regionCity('miami-north').secretSpots.map((s) => s.id), ['roof-garden', 'tag-alley', 'lone-ride']);
  assert.deepEqual(regionCity('miami-beach').secretSpots.map((s) => s.id), ['rustlamp']);
  for (const id of REGION_IDS) {
    const spec = regionSecretSpec(regionFor(id));
    for (const k of Object.keys(spec)) if (k !== 'garage') assert.ok(regionCity(id).secretSpots.some((s) => s.id === k), id + ' ' + k);
  }
  assert.ok(MIAMI_SPOTS.secrets);
});

test('region content is deterministic, and attaching twice changes nothing', () => {
  const pick = (c) => JSON.stringify([c.piers, c.boatSpots, c.helipads, c.aircraftSpots, c.rampSpots, c.garages, c.adventures, c.courses, c.routes, c.startView, c.secretSpots, c.texts]);
  for (const id of ['miami-beach', 'miami-west']) {
    const a = regionCity(id);
    assert.ok(a.regionContent && (id === DEFAULT_REGION || a.regionDressed));
    const once = pick(a);
    attachExplore(a);
    attachRegionContent(a);
    assert.equal(pick(a), once, id + ' attached twice');
    const b = createMiamiCity(JSON.parse(fs.readFileSync(new URL('../src/world/data/' + id + '.json', import.meta.url), 'utf8')), { region: id });
    attachExplore(b);
    assert.equal(pick(b), once, id + ' rebuilt');
  }
});

test('travel pad labels: the picker name cut at "and", no markers without a page', async () => {
  const { padLabel, createTravelMarkers } = await import('../src/render/markers.js');
  assert.equal(padLabel('Miami Beach and the Islands'), 'To Miami Beach');
  assert.equal(padLabel('Downtown and the Bay'), 'To Downtown');
  assert.equal(padLabel(regionFor('miami-south').name), 'To The Roads');
  const c = regionCity('miami-downtown');
  assert.ok(c.travelPads.length >= 1, 'Downtown has travel pads');
  assert.equal(createTravelMarkers({ add() {}, remove() {} }, c), null, 'node: no document, nothing drawn');
  assert.equal(createTravelMarkers(null, c), null);
});

test('one start place a region: regions.js start, REGION_STARTS, travel regionStart and the built spawn agree', async () => {
  const { REGION_STARTS } = await import('../src/world/regioncontent.js');
  const { regionStart } = await import('../src/core/travel.js');
  for (const id of REGION_IDS) {
    const st = regionFor(id).start;
    if (id === DEFAULT_REGION) {
      assert.equal(st, null, 'Downtown starts at MIAMI_SPOTS.spawn');
      assert.equal(REGION_STARTS[id], undefined);
      assert.deepEqual(regionStart(id), { x: MIAMI_SPOTS.spawn.x, z: MIAMI_SPOTS.spawn.z, heading: MIAMI_SPOTS.spawn.heading });
    } else {
      assert.equal(REGION_STARTS[id], st, id + ': REGION_STARTS is regions.js start itself');
      assert.deepEqual(regionStart(id), { x: st.x, z: st.z, heading: st.heading }, id);
    }
    // The spawn the game uses (snapped to the street) is the table point
    // that travel writes (to 0.1 m), on the same street, facing the same way.
    // Downtown's table point (MIAMI_SPOTS.spawn, hand content that the
    // start-view and service tests measure from) lies 42 m off its street:
    // a Travel-list arrival there is moved onto the built start place by
    // session.arrive(null), so only the street is checked for it.
    const c = regionCity(id), s = regionStart(id);
    const d = Math.hypot(c.spawn.x - s.x, c.spawn.z - s.z);
    if (id !== DEFAULT_REGION) {
      assert.ok(d < 0.5, `${id}: spawn ${d.toFixed(1)} m from regionStart`);
      assert.ok(Math.cos(c.spawn.heading - s.heading) > 0.999, id + ' heading');
    } else assert.ok(d < 60, `${id}: spawn ${d.toFixed(1)} m from regionStart`);
    const street = st ? st.street : MIAMI_SPOTS.spawn.street;
    assert.ok(c.edgesNear(c.spawn.x, c.spawn.z, 1, []).some((e) => c.edges[e].name === street), id + ' on ' + street);
  }
});
