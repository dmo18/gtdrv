// Task 3 (docs/PLAN_V4.md), 0.12.6 steering lock-in. Owner, many times:
// "steering is too loose; a fully rotated wheel barely changed the
// trajectory". Full lock held at 15, 30, 50 and 70 mph (thumb driver
// module, test/thumbdriver.js fullWheel) for every driveable spec, in
// Arcade, at all three presets: steady radius, lateral g and rear slip must
// sit inside a US-car envelope. No spin-out: the rear never slides past
// SLIP_MAX without the handbrake.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/entities/vehicle.js';
import { PRESETS } from '../src/core/handlingpreset.js';
import { fullWheel } from './thumbdriver.js';

const FT = 3.2808;
export const SLIP_MAX = 8; // degrees of rear slip in a steady full-lock turn
// Radius ceilings (feet) by speed; cars (sedan and coupe bodies) and the rest.
export const ENVELOPE = {
  car: { 15: 30, 30: 40, 50: 90, 70: 165, g: [1.1, 3.3] },
  big: { 15: 40, 30: 55, 50: 130, 70: 260, g: [0.4, 3.3] },
};
const CAR_BODIES = ['sedan', 'coupe'];

function drive(preset) {
  V.setHandlingMode('arcade');
  V.setHandlingPreset(preset);
  const out = [];
  try {
    for (const id of Object.keys(V.VEHICLE_SPECS)) {
      const spec = V.VEHICLE_SPECS[id];
      if (spec.service) continue;
      for (const mph of [15, 30, 50, 70]) out.push({ id, body: spec.body, mph, ...fullWheel(V, id, mph, 2.5) });
    }
  } finally { V.setHandlingPreset('standard'); V.setHandlingMode('arcade'); }
  return out;
}

const table = {};
for (const p of PRESETS) test(`full lock envelope, Arcade / ${p}: every spec at 15, 30, 50, 70 mph`, () => {
  table[p] = drive(p);
  const lines = [];
  for (const r of table[p]) {
    const env = CAR_BODIES.includes(r.body) ? ENVELOPE.car : ENVELOPE.big;
    const ft = r.radius * FT, want = Math.round(r.mph / 5) * 5;
    lines.push(`${r.id}@${r.mph.toFixed(0)}=${ft.toFixed(0)}ft/${r.g.toFixed(2)}g`);
    // A slow truck cannot reach its speed row: only rows it reaches count at the row's own ceiling.
    const row = [15, 30, 50, 70].reduce((a, b) => (Math.abs(b - r.mph) < Math.abs(a - r.mph) ? b : a));
    const ceil = env[row] * (r.mph < row - 2 ? Math.pow(r.mph / row, 2) : 1);
    assert.ok(ft <= ceil + 0.5, `${p} ${r.id} at ${want} mph: radius ${ft.toFixed(0)} ft over ${ceil.toFixed(0)}`);
    if (r.mph >= 29) assert.ok(r.g >= env.g[0], `${p} ${r.id} at ${want} mph: ${r.g.toFixed(2)} g, turns too little`);
    assert.ok(r.g <= env.g[1], `${p} ${r.id} at ${want} mph: ${r.g.toFixed(2)} g, too hard`);
    assert.ok(r.slip <= SLIP_MAX, `${p} ${r.id} at ${want} mph: rear slip ${r.slip.toFixed(1)} deg, spin-out`);
  }
  console.log(`# ${p}: ${lines.join(' ')}`);
});

test('sedan, Arcade / Standard: 30 mph full lock under 120 ft, 60 mph still turns, presets ordered Sharp < Standard < Relaxed', () => {
  const at = (p, id, mph) => table[p].find((r) => r.id === id && Math.abs(r.mph - mph) < 2);
  for (const id of ['compact', 'sedan', 'midsize', 'taxi', 'police']) {
    const r = at('standard', id, 30);
    assert.ok(r.radius * FT < 120, `${id} 30 mph ${(r.radius * FT).toFixed(0)} ft`);
    const f = at('standard', id, 70);
    assert.ok(f.g >= 1.8 && f.radius * FT < 160, `${id} 70 mph ${(f.radius * FT).toFixed(0)} ft, ${f.g.toFixed(2)} g`);
  }
  for (const id of Object.keys(V.VEHICLE_SPECS)) {
    if (V.VEHICLE_SPECS[id].service) continue;
    for (const mph of [30, 50, 70]) {
      const a = at('sharp', id, mph), b = at('standard', id, mph), c = at('relaxed', id, mph);
      if (!a || !b || !c || a.mph < mph - 2) continue;
      assert.ok(a.radius <= b.radius + 0.05 && b.radius <= c.radius + 0.05, `${id} ${mph} mph: ${a.radius.toFixed(1)} / ${b.radius.toFixed(1)} / ${c.radius.toFixed(1)} m`);
    }
  }
});
