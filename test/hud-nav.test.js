// NAV in the objective system (src/systems/objective.js): the turn strip lines,
// the distance steps, and the red "Get out!" prompt on the burning event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents } from '../src/core/events.js';
import { createObjective, navLines, navBucket } from '../src/systems/objective.js';

test('turn strip lines: "In 300 ft, turn right" over "onto Alton Rd"', () => {
  const out = {};
  const tr = { toTurn: 91.44, next: () => ({ kind: 'right', name: 'Alton Rd' }) };
  navLines(tr, out);
  assert.deepEqual([out.kind, out.l1, out.l2], ['right', 'In 300 ft, turn right', 'onto Alton Rd']);
  tr.toTurn = 8;
  navLines(tr, out);
  assert.equal(out.l1, 'Turn right');
  tr.next = () => ({ kind: 'arrive', name: 'Lincoln Rd' });
  tr.toTurn = 700;
  navLines(tr, out);
  assert.deepEqual([out.l1, out.l2], ['In 0.4 mi, arrive', 'at Lincoln Rd']);
  // the bucket changes only when the shown distance does
  assert.equal(navBucket(91.4), navBucket(91.6));
  assert.notEqual(navBucket(91.4), navBucket(120));
  assert.equal(navBucket(10), -1);
});

test('a burning player car shows "Get out!" and it clears when out or put out', () => {
  const events = createEvents();
  const alerts = [];
  const car = { burning: true };
  const game = { events, player: { x: 0, z: 0, vehicle: car, mode: 'car' }, hud: { setAlert: (t) => alerts.push(t) } };
  const o = createObjective(game);
  events.emit('burning', { craft: { burning: true }, on: true }); // someone else's car
  assert.deepEqual(alerts, []);
  events.emit('burning', { craft: car, on: true });
  assert.deepEqual(alerts, ['Get out!']);
  game.player.vehicle = null; // got out
  o.render(0, 1 / 60);
  assert.deepEqual(alerts, ['Get out!', null]);
  game.player.vehicle = car;
  events.emit('burning', { craft: car, on: true });
  events.emit('burning', { craft: car, on: false });
  assert.deepEqual(alerts, ['Get out!', null, 'Get out!', null]);
});
