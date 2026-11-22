// The Miami building look (src/render/miamilook.js): pure, seeded, by
// neighbourhood; the procedural island keeps its own look.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lookOf, unit } from '../src/render/miamilook.js';

const city = (place) => ({ map: 'miami', placeOf: () => place });
const bld = (h, style = 'office', vseed = 12345) => ({ x0: 0, z0: 0, x1: 20, z1: 20, h, style, color: 0x808080, tint: 0x808080, vseed, street: 2, block: 1 });

test('the island keeps its own look', () => {
  assert.equal(lookOf({ placeOf: () => 'Brickell' }, bld(80)), null);
  assert.equal(lookOf(null, bld(80)), null);
});

test('the look is the same every time for a building', () => {
  const c = city('Little Havana');
  const a = lookOf(c, bld(9, 'brick', 777));
  const b = lookOf({ ...c }, { ...bld(9, 'brick', 777) });
  assert.deepEqual({ ...a }, { ...b });
  assert.ok(unit(5, 1) >= 0 && unit(5, 1) < 1);
});

test('neighbourhoods get their own styles', () => {
  const styles = (place, h, base = 'office') => {
    const s = new Set();
    for (let i = 1; i < 200; i++) s.add(lookOf(city(place), bld(h, base, i * 7919)).style);
    return s;
  };
  const brickell = styles('Brickell', 90);
  assert.ok(brickell.has('glass') && brickell.has('stucco'), 'glass and white condo towers');
  assert.ok(!brickell.has('havana'));
  const havana = styles('Little Havana', 9, 'brick');
  assert.ok(havana.has('havana'), 'arched low-rise stucco');
  assert.ok(!havana.has('brick'));
  const beach = [...Array(50).keys()].map((i) => lookOf(city('Miami Beach'), bld(12, 'stucco', i + 1)));
  assert.ok(beach.every((L) => L.deco && L.style === 'stucco'), 'deco on the beach');
});

test('colours are valid and vary between buildings', () => {
  const seen = new Set();
  for (let i = 1; i < 100; i++) {
    const L = lookOf(city('Shenandoah'), bld(8, 'stucco', i * 104729));
    for (const k of ['wall', 'tint', 'trim', 'roof']) assert.ok(Number.isInteger(L[k]) && L[k] >= 0 && L[k] <= 0xffffff, k);
    seen.add(L.wall);
  }
  assert.ok(seen.size > 20);
});

test('sheds, houses and containers keep their kind', () => {
  const c = city('Dodge Island');
  assert.equal(lookOf(c, bld(8, 'shed', 3)).style, 'shed');
  assert.equal(lookOf(c, bld(6, 'house', 4)).style, 'house');
  assert.equal(lookOf(c, bld(3, 'container', 5)).style, 'container');
});
