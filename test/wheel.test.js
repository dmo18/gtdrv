import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wheelIndex, isHold, placeWheel, HOLD_MS, DEAD_PX, CANCEL_PX, WHEEL_KEEP, WHEEL_CANCEL,
} from '../src/ui/wheel.js';
import { WEAPON_IDS } from '../src/core/weapons.js';

const N = WEAPON_IDS.length;

test('wheelIndex: every angle in the ring maps to one of the weapons', () => {
  const seen = new Set();
  for (let deg = 0; deg < 360; deg += 1) {
    const a = deg * Math.PI / 180;
    const i = wheelIndex(Math.sin(a) * 70, -Math.cos(a) * 70, N);
    assert.ok(Number.isInteger(i) && i >= 0 && i < N, `deg ${deg} -> ${i}`);
    seen.add(i);
  }
  assert.equal(seen.size, N);
  for (const n of [1, 2, 3, 5, 8]) {
    for (let deg = 0; deg < 360; deg += 7) {
      const a = deg * Math.PI / 180;
      const i = wheelIndex(Math.sin(a) * 60, -Math.cos(a) * 60, n);
      assert.ok(i >= 0 && i < n);
    }
  }
});

test('wheelIndex: slice 0 is up, slices run clockwise', () => {
  assert.equal(wheelIndex(0, -70, N), 0);
  assert.equal(wheelIndex(0, 70, 4), 2); // straight down of four
  assert.equal(wheelIndex(70, 0, 4), 1); // right
  assert.equal(wheelIndex(-70, 0, 4), 3); // left
  // slice centres land on their own index
  for (let i = 0; i < N; i++) {
    const a = i * 2 * Math.PI / N;
    assert.equal(wheelIndex(Math.sin(a) * 70, -Math.cos(a) * 70, N), i);
  }
});

test('wheelIndex: dead zone keeps the weapon, outer ring cancels', () => {
  assert.equal(wheelIndex(0, 0, N), WHEEL_KEEP);
  assert.equal(wheelIndex(DEAD_PX - 1, 0, N), WHEEL_KEEP);
  assert.equal(wheelIndex(0, -(DEAD_PX + 1), N), 0);
  assert.equal(wheelIndex(CANCEL_PX - 1, 0, N) >= 0, true);
  assert.equal(wheelIndex(CANCEL_PX + 1, 0, N), WHEEL_CANCEL);
  assert.equal(wheelIndex(0, 400, N), WHEEL_CANCEL);
  assert.equal(wheelIndex(NaN, 5, N), WHEEL_KEEP);
  assert.equal(wheelIndex(50, 0, 0), WHEEL_KEEP);
});

test('tap versus hold: under 250 ms is a tap, 250 ms or more is a hold', () => {
  assert.equal(HOLD_MS, 250);
  assert.equal(isHold(0), false);
  assert.equal(isHold(120), false);
  assert.equal(isHold(249), false);
  assert.equal(isHold(250), true);
  assert.equal(isHold(900), true);
});

test('placeWheel: stays on screen and clear of FIRE and pause', () => {
  const W = 780, H = 360, r = 108;
  const fire = { l: W - 126, t: H - 124, r: W - 26, b: H - 24 };
  const pause = { l: W - 64, t: 8, r: W - 8, b: 64 };
  const out = { x: 0, y: 0 };
  for (const [cx, cy] of [[W - 244, H - 122], [W - 244, H - 314], [W - 244, 40], [W - 30, 200], [10, 10]]) {
    placeWheel(cx, cy, r, W, H, [fire, pause], out);
    assert.ok(out.x >= r && out.x <= W - r && out.y >= r && out.y <= H - r, JSON.stringify(out));
    for (const q of [fire, pause]) {
      const nx = Math.min(q.r, Math.max(q.l, out.x)), ny = Math.min(q.b, Math.max(q.t, out.y));
      assert.ok(Math.hypot(out.x - nx, out.y - ny) >= r - 0.001, `overlap at ${cx},${cy}`);
    }
  }
});
