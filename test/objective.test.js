import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveAngle, createObjective } from '../src/systems/objective.js';

test('arrow points ahead, right, left and behind', () => {
  assert.ok(Math.abs(objectiveAngle(0, 0, 0, 10, 0)) < 1e-9, 'ahead (heading 0 faces +x)');
  assert.ok(Math.abs(objectiveAngle(0, 0, 0, 0, 10) - 90) < 1e-9, 'toward +z is to the right');
  assert.ok(Math.abs(objectiveAngle(0, 0, 0, 0, -10) + 90) < 1e-9, 'left');
  assert.ok(Math.abs(Math.abs(objectiveAngle(0, 0, 0, -10, 0)) - 180) < 1e-9, 'behind');
  assert.ok(Math.abs(objectiveAngle(0, 0, Math.PI / 2, 0, 10)) < 1e-9, 'camera turned toward the target');
});

test('objective follows the active race checkpoint, then the waypoint, in node', () => {
  const game = {
    player: { x: 0, z: 0 }, camHeading: 0, paused: false, waypoint: null,
    activities: { active: { course: { name: 'Dock Dash', checkpoints: [{ x: 5, z: 5 }, { x: 40, z: 0 }] }, index: 1 } },
  };
  const o = createObjective(game, null);
  o.render();
  assert.equal(o.visible, true);
  assert.ok(Math.abs(o.distance - 40) < 1e-9);
  game.activities = { active: null };
  o.render();
  assert.equal(o.visible, false);
  game.waypoint = { x: 0, z: 30 };
  o.render();
  assert.equal(o.visible, true);
  assert.ok(Math.abs(o.angle - 90) < 1e-9);
});
