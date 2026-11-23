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

// 0.10.1 (docs/PLAN_V3.md 13, CONTROLS): one compact turn pill, only for a goal the player chose or accepted.
test('turn pill: "300 ft · Alton Rd", the verb at the turn, "U-turn · street", the arrival', async () => {
  const { navPill } = await import('../src/systems/objective.js');
  const out = {};
  const tr = { toTurn: 91.44, next: () => ({ kind: 'right', name: 'Alton Rd' }) };
  navPill(tr, out);
  assert.deepEqual([out.kind, out.text, out.soon], ['right', '300 ft · Alton Rd', true]);
  tr.toTurn = 8;
  assert.equal(navPill(tr, out).text, 'Turn right · Alton Rd');
  tr.next = () => ({ kind: 'uturn', name: 'S Miami Ave' });
  tr.toTurn = 40;
  assert.equal(navPill(tr, out).text, 'U-turn · S Miami Ave');
  assert.equal(navPill(tr, out, true).text, 'Turn around · S Miami Ave'); // on foot
  tr.next = () => ({ kind: 'arrive', name: 'Lincoln Rd' });
  tr.toTurn = 700;
  assert.equal(navPill(tr, out).text, '0.4 mi · Lincoln Rd');
  tr.next = () => ({ kind: 'left', name: '' });
  tr.toTurn = 300;
  assert.equal(navPill(tr, out).text, '1,000 ft · turn left'.replace('1,000 ft', navPill(tr, out).text.split(' · ')[0]));
  assert.ok(!/\n/.test(out.text));
});

test('turn by turn only for a map destination, an activity or a mission; never a tracked adventure or the Phone check', async () => {
  const { wantsTurnByTurn, UTURN_WAIT_S } = await import('../src/systems/objective.js');
  assert.equal(wantsTurnByTurn('waypoint', false), true);
  assert.equal(wantsTurnByTurn('activity', false), true);
  assert.equal(wantsTurnByTurn('mission', false), true);
  assert.equal(wantsTurnByTurn('adventure', false), false);
  assert.equal(wantsTurnByTurn('waypoint', true), false);
  assert.equal(wantsTurnByTurn('', false), false);
  assert.equal(UTURN_WAIT_S, 3);
});
