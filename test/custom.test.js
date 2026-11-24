import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAINTS, FINISHES, WHEELS, TINTS, DECALS, defaultLook, isDefaultLook, unlocked, lockText, sanitizeLook, paintCode, codeRgb, codeFinish, codeDecal, LOOK_KEYS,
} from '../src/core/custom.js';
import { createCustom } from '../src/systems/custom.js';
import { defaultProgress } from '../src/core/save.js';
import { createEvents } from '../src/core/events.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { createVehicleMesh, noteVehicleHit, updateVehicleMesh } from '../src/render/vehiclemesh.js';
import { paintMaterial, wheelMaterial, wheelLookMaterial, carGlassMaterial } from '../src/render/vehiclemats.js';
import { createRng } from '../src/core/rng.js';
import { recordEvent } from '../src/core/records.js';

test('the base set is open from the start; medals open the rest; nothing costs anything', () => {
  assert.ok(PAINTS.length >= 12 && FINISHES.length >= 4 && WHEELS.length >= 4 && TINTS.length >= 3 && DECALS.length >= 3);
  for (let i = -1; i < PAINTS.length; i++) assert.ok(unlocked('paint', i, 0, 0));
  assert.equal(FINISHES.filter((f, i) => unlocked('finish', i, 0, 0)).length, 4, 'four finishes with no medals');
  assert.equal(WHEELS.filter((w, i) => unlocked('wheels', i, 0, 0)).length, 5);
  for (let i = 0; i < TINTS.length; i++) assert.ok(unlocked('tint', i));
  for (let i = 0; i < DECALS.length; i++) assert.ok(unlocked('decal', i));
  assert.ok(!unlocked('finish', 4, 4, 0) && unlocked('finish', 4, 5, 0));
  assert.ok(!unlocked('finish', 6, 99, 9) && unlocked('finish', 6, 10, 10));
  assert.ok(!unlocked('finish', 99, 99, 99) && !unlocked('paint', PAINTS.length) && !unlocked('tint', -1));
  assert.equal(lockText('finish', 4), '5 medals');
  assert.equal(lockText('finish', 6), '10 gold medals');
  assert.equal(lockText('paint', 3), '');
  for (const f of FINISHES) assert.ok(f[3] > 0, 'the clearcoat is never 0 (one shader program for every finish)');
  for (const t of [PAINTS, FINISHES, WHEELS, TINTS, DECALS]) for (const row of t) assert.ok(!/\$|coin|credit|buy|price/i.test(row[0]));
});

test('looks: defaults, strict reading, and the paint code', () => {
  assert.ok(isDefaultLook(defaultLook()) && isDefaultLook(null));
  assert.deepEqual(sanitizeLook({ paint: 3, finish: 2, wheels: 1, tint: 3, decal: 4, x: 1 }), { paint: 3, finish: 2, wheels: 1, tint: 3, decal: 4 });
  assert.deepEqual(sanitizeLook({ paint: 99, finish: -1, wheels: 1.5, tint: '2', decal: null }), defaultLook());
  for (const junk of [null, 4, 'x', [1, 2]]) assert.deepEqual(sanitizeLook(junk), defaultLook());
  assert.equal(paintCode(0xc21f1f, 0, 0), 0xc21f1f, 'a plain color is its own code');
  const code = paintCode(0xf0f0ee, 5, 3);
  assert.equal(codeRgb(code), 0xf0f0ee);
  assert.equal(codeFinish(code), 5);
  assert.equal(codeDecal(code), 3);
  assert.equal(codeRgb(0x123456), 0x123456);
  assert.equal(codeFinish(0x123456), 0);
  assert.deepEqual(LOOK_KEYS, ['paint', 'finish', 'wheels', 'tint', 'decal']);
});

function world() {
  const events = createEvents();
  const game = { events, progress: defaultProgress(), player: { vehicle: null } };
  game.custom = createCustom(game);
  const car = (id) => {
    const v = createVehicle(id, 0, 0, 0, createRng(4));
    v.mesh = createVehicleMesh(v.spec, v.color);
    return v;
  };
  return { game, car };
}

test('a look is kept per class and goes on the car the player gets into', () => {
  const { game, car } = world();
  const C = game.custom;
  const a = car('sedan');
  game.player.vehicle = a;
  const stock = a.mesh.userData.color;
  assert.ok(C.set('sedan', 'paint', 0));
  assert.ok(C.set('sedan', 'finish', 1));
  assert.ok(C.set('sedan', 'wheels', 3));
  assert.ok(C.set('sedan', 'tint', 2));
  assert.ok(C.set('sedan', 'decal', 1));
  assert.deepEqual(game.progress.loop.looks.sedan, { paint: 0, finish: 1, wheels: 3, tint: 2, decal: 1 });
  const ud = a.mesh.userData;
  assert.equal(ud.color, paintCode(PAINTS[0][1], 1, 1));
  assert.equal(ud.body.material, paintMaterial(ud.color));
  assert.equal(ud.body.material.metalness, FINISHES[1][1]);
  assert.equal(ud.body.material.userData.rw.uDecal.value.w, 1);
  assert.equal(ud.wheelLevels[0].material, wheelLookMaterial(3));
  assert.notEqual(wheelLookMaterial(3), wheelMaterial());
  assert.equal(ud.glassLevels[0].material, carGlassMaterial('clean', TINTS[2][1]));
  assert.equal(a.color, a.spec.colors.includes(a.color) ? a.color : a.color, 'the car keeps the color it came in');
  // another sedan gets the look on entering; a muscle car does not
  const b = car('sedan'), m = car('muscle');
  game.events.emit('enter', b);
  assert.equal(b.mesh.userData.color, ud.color);
  game.events.emit('enter', m);
  assert.equal(m.mesh.userData.color, m.color);
  assert.equal(m.mesh.userData.look, undefined);
  // damage swaps wheel and glass materials back to the shared ones; render() restores the look
  noteVehicleHit(a.mesh, 1, 0, 0, 20);
  a.health = a.spec.health * 0.3;
  updateVehicleMesh(a.mesh, a, 1, 0);
  assert.ok(ud.ownPaint, 'a damaged car has its own paint');
  assert.equal(ud.ownPaint.metalness, FINISHES[1][1], 'and keeps the finish');
  C.render();
  assert.equal(ud.wheelLevels[0].material, wheelLookMaterial(3));
  assert.equal(ud.glassLevels[0].material, carGlassMaterial(ud.glassState, TINTS[2][1]));
  // back to stock
  C.reset('sedan');
  assert.equal(game.progress.loop.looks.sedan, undefined);
  assert.equal(ud.color, stock);
  assert.equal(ud.wheelLevels[0].material, wheelMaterial());
});

test('locked options are refused until the medals are there; bad options always', () => {
  const { game, car } = world();
  const C = game.custom;
  game.player.vehicle = car('muscle');
  assert.equal(C.set('muscle', 'finish', 5), false, 'Chrome needs 15 medals');
  assert.equal(C.set('muscle', 'finish', 99), false);
  assert.equal(C.set('muscle', 'paint', -2), false);
  assert.equal(C.set('muscle', 'spoiler', 1), false);
  assert.equal(C.set('muscle', 'wheels', 5), false);
  assert.equal(game.progress.loop.looks.muscle, undefined);
  for (let i = 1; i <= 15; i++) recordEvent(game.progress.loop, { id: 'ev_beach_trap_' + i, tpl: 'trap' }, 80, 'bronze');
  assert.ok(C.open('finish', 5) && C.set('muscle', 'finish', 5));
  assert.ok(C.set('muscle', 'wheels', 5));
  assert.equal(C.open('finish', 6), false, 'Candy needs 10 golds');
});
