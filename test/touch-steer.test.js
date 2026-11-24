// Touch steering maths for the wheel style (src/ui/wheel.js): a relative drag,
// horizontal travel or rotation about the wheel center (the larger), never the
// absolute position. And the drive-by weapon list for SWAP while driving.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dragSteer, createDragSteer, driveWeapons, nextInList, DRAG_FULL_PX, ROT_FULL_DEG, ROT_CORE_PX, WHEEL_SLACK,
} from '../src/ui/wheel.js';
import { WEAPONS, WEAPON_IDS, createArms } from '../src/core/weapons.js';
import { pickWeapon } from '../src/ui/combathud.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Drive a tracker along a path of points; returns the raw value after each.
function run(path, center = [100, 100], sens = 1) {
  const t = createDragSteer();
  const out = [t.down(path[0][0], path[0][1], center[0], center[1])];
  for (let i = 1; i < path.length; i++) out.push(t.move(path[i][0], path[i][1], sens));
  return { t, out };
}
const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);

test('touch-down never steers, wherever the thumb lands (no absolute angle)', () => {
  for (const [x, y] of [[100, 100], [168, 100], [100, 30], [30, 170], [260, 40]]) {
    const t = createDragSteer();
    assert.equal(t.down(x, y, 100, 100), 0);
    assert.equal(t.raw, 0);
  }
});

// Task PLANTED (deliberate): full input at 80 px of travel, was 55 (the
// owner found the wheel loose). The wheel center is far away here so the
// travel alone is measured (no rotation).
test('horizontal travel: 80 px is full input at sensitivity 1, scaled by sensitivity', () => {
  assert.equal(DRAG_FULL_PX, 80);
  const far = [100, 2000];
  let r = run(line(90, 105, 130, 105, 5), far);
  assert.ok(near(r.out.at(-1), 0.5), String(r.out.at(-1)));
  r = run(line(90, 105, 170, 105, 16), far);
  assert.ok(near(r.out.at(-1), 1));
  r = run(line(90, 105, 90 + 40 / 1.5, 105, 5), far, 1.5);
  assert.ok(near(r.out.at(-1), 0.5, 1e-9));
  r = run(line(90, 105, 90 - 80, 105, 16), far, 0.5);
  assert.ok(near(r.out.at(-1), -0.5));
});

test('below the wheel center a slide right steers right, never left', () => {
  const r = run(line(60, 160, 160, 160, 20));
  for (let i = 1; i < r.out.length; i++) assert.ok(r.out[i] >= r.out[i - 1] && r.out[i] >= 0, `${i}: ${r.out[i]}`);
  assert.equal(r.out.at(-1), 1);
});

test('crossing the center does not jump; the value rises smoothly', () => {
  const r = run(line(40, 101, 160, 101, 24));
  for (let i = 1; i < r.out.length; i++) {
    assert.ok(r.out[i] >= r.out[i - 1], `${i}`);
    assert.ok(r.out[i] - r.out[i - 1] <= 5 / DRAG_FULL_PX + 1e-9, `step ${i} jumps ${r.out[i] - r.out[i - 1]}`);
  }
});

test('rotation about the center: dragging down the right side turns right, up the right side left', () => {
  const pts = [];
  for (let a = -60; a <= 0; a += 5) pts.push([100 + Math.cos(a * Math.PI / 180) * 60, 100 + Math.sin(a * Math.PI / 180) * 60]);
  const down = run(pts).out.at(-1);
  assert.ok(down > 0.9, String(down)); // 60 degrees clockwise = full right
  const up = run(pts.slice().reverse()).out.at(-1);
  assert.ok(up < -0.9, String(up));
  assert.equal(ROT_FULL_DEG, 60);
});

test('whichever is larger: rotation leads only when it agrees with the horizontal travel', () => {
  assert.equal(dragSteer(10, 30, 0), 0.5); // agree: rotation (0.5) beats travel (0.18)
  assert.ok(near(dragSteer(10, -30, 0), 10 / DRAG_FULL_PX)); // disagree: travel wins
  assert.equal(dragSteer(0, 30, 20), 0.5); // a mostly vertical move may rotate alone
  assert.equal(dragSteer(1, -30, 1), 1 / DRAG_FULL_PX); // a mostly sideways one may not
  assert.ok(near(dragSteer(DRAG_FULL_PX, 0, 0, 1), 1));
});

test('inside the core the rotation holds; full lock clamps and turning back answers at once', () => {
  const t = createDragSteer();
  t.down(100, 100 - ROT_CORE_PX + 2, 100, 100);
  assert.equal(t.move(100, 100 + ROT_CORE_PX - 2), 0); // straight down through the core: no rotation, no travel
  t.down(50, 150, 100, 100);
  for (let x = 50; x <= 250; x += 10) t.move(x, 150);
  assert.equal(t.raw, 1);
  t.move(240, 150);
  assert.ok(t.raw < 1 && t.raw > 0.7, String(t.raw));
  assert.equal(t.up(), 0);
  assert.equal(t.move(300, 150), 0); // lifted: moves do nothing
});

// Task GRIP: pushing past full lock stores at most WHEEL_SLACK of extra
// travel, so the first move back answers at once and a return to the
// touch-down point is near the center again.
test('past full lock: at most 10 percent of travel is stored; reversing reduces the steer at once', () => {
  const t = createDragSteer();
  t.down(100, 300, 100, 100); // far below the wheel center: horizontal travel counts
  for (let x = 100; x <= 100 + 1.5 * DRAG_FULL_PX; x += 4) t.move(x, 300);
  assert.equal(t.raw, 1);
  assert.ok(t.acc <= 1 + WHEEL_SLACK + 1e-12, `stored ${t.acc}`);
  const x1 = 100 + 1.5 * DRAG_FULL_PX;
  t.move(x1 - DRAG_FULL_PX * WHEEL_SLACK - 1, 300);
  assert.ok(t.raw < 1, 'a move back answers once past the 8 px slack');
  t.move(x1 - DRAG_FULL_PX / 2, 300); // back 40 px
  assert.ok(Math.abs(t.raw - (1 + WHEEL_SLACK - 0.5)) < 1e-9 && 1 - t.raw > 0.39, `steer ${t.raw} after 40 px back`);
  t.move(x1 - DRAG_FULL_PX * (1 + WHEEL_SLACK), 300); // back by full travel plus the slack: centered
  assert.ok(Math.abs(t.raw) < 1e-9, `centered ${t.raw}`);
  // The same on the other side, and the stop holds however far the thumb goes.
  for (let x = 100; x >= -400; x -= 10) t.move(x, 300);
  assert.equal(t.raw, -1);
  assert.ok(t.acc >= -1 - WHEEL_SLACK - 1e-12);
  t.move(-400 + DRAG_FULL_PX * WHEEL_SLACK + 1, 300);
  assert.ok(t.raw > -1, 'answers as soon as the slack is spent');
});

test('drive-by weapons for SWAP while driving are the ones marked driveBy', () => {
  const list = driveWeapons(WEAPONS, WEAPON_IDS);
  assert.ok(list.length >= 2);
  for (const id of list) assert.equal(WEAPONS[id].driveBy, true);
  for (const id of WEAPON_IDS) if (WEAPONS[id].driveBy) assert.ok(list.includes(id));
  assert.equal(nextInList(list, list[0]), list[1]);
  assert.equal(nextInList(list, list.at(-1)), list[0]);
  assert.equal(nextInList(list, 'wrench'), list[0]);
  assert.equal(nextInList([], 'x'), null);
});

test('the weapon wheel in a car sets the drive-by gun and announces it; foot weapons are refused', () => {
  const sent = [];
  const walker = { arms: createArms('pistol') };
  const game = { player: { walker, vehicle: { kind: 'car' } }, events: { emit: (n, e) => sent.push([n, e.weapon, e.actor]) } };
  const list = driveWeapons(WEAPONS, WEAPON_IDS);
  const other = list.find((id) => id !== walker.arms.lastGun);
  assert.equal(pickWeapon(game, other), true);
  assert.equal(walker.arms.lastGun, other);
  assert.equal(walker.arms.weapon, 'pistol'); // the weapon on foot is kept
  assert.deepEqual(sent, [['weaponSwitch', other, walker]]);
  const notDrive = WEAPON_IDS.find((id) => !WEAPONS[id].driveBy);
  assert.equal(pickWeapon(game, notDrive), false);
  assert.equal(pickWeapon(game, other), false); // already that one
  game.player.vehicle = { kind: 'plane' };
  assert.equal(pickWeapon(game, list[0]), false);
  // on foot it goes through the combat system
  let picked = null;
  game.player.vehicle = null;
  game.combat = { pickWeapon: (id) => { picked = id; return true; } };
  assert.equal(pickWeapon(game, 'smg'), true);
  assert.equal(picked, 'smg');
});
