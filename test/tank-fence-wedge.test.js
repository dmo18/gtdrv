// Regression for the collision sweep finding (miami-west, lot:fence, tank,
// at x -3012.5, z -233.7, heading 0): the tank drives along a fence that
// converges on a building face, so its rear circle is held by the building
// while the front circle is pushed into the fence, 0.62 m deep at 7, 16 and
// 29 mph (limit 0.30 m). Each body circle is resolved on its own in
// entities/tank.js, so nothing stops the tank before the wedge closes.
// 0.15: the junction rings (WP2) moved that yard's fence (the approach is
// blocked now), so the fixture is the same kind of wedge in the region: a
// fence at x -2027.5, z 756.75 that converges on a building face (0.54
// and 0.57 m at 16 and 29 mph without the WEDGE_DEPTH check, 0.24 and 0.22
// with it). Every fence is a candidate (the sweep's 40 do not hold it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, collectTargets, runOne, CRAFTS, PEN_MAX } from '../scripts/collision-sweep.mjs';

test('tank into the fence wedge in miami-west stays within 0.30 m at 7, 16 and 29 mph', () => {
  const W = buildWorld('miami-west');
  const targets = collectTargets(W, Infinity).get('lot:fence');
  let T = null;
  for (const mk of targets.make) {
    let ts = mk();
    if (!ts) continue;
    if (!Array.isArray(ts)) ts = [ts];
    for (const q of ts) if (Math.abs(q.px + 2027.5) < 1 && Math.abs(q.pz - 756.75) < 1) T = q;
  }
  assert.ok(T, 'the fixture fence exists');
  for (const u of CRAFTS.tank.speeds) {
    const r = runOne(W, CRAFTS.tank, T, 1, 0, u);
    assert.ok(r, 'approach is clear');
    assert.ok(r.maxPen <= PEN_MAX, `${u} m/s: ${r.maxPen.toFixed(2)} m into the fence`);
  }
});
