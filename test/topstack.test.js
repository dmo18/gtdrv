import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopStack, toastKind } from '../src/ui/hud.js';

// The top center stack rules of docs/REVAMP.md 6.12 (pure logic, no DOM).
const shown = (st) => st.rows.map((r) => (r.kind ? r.kind + ':' + r.text : ''));

test('toast kinds: given, or taken from the text for callers that pass none', () => {
  assert.equal(toastKind('x', 'hint'), 'hint');
  assert.equal(toastKind('The police want a word!'), 'police');
  assert.equal(toastKind('You lost them!  +500'), 'police');
  assert.equal(toastKind('Pulled over! Off with a warning.'), 'police');
  assert.equal(toastKind('Wrecked  +250'), 'score');
  assert.equal(toastKind('Near miss  +50  x2'), 'score');
  assert.equal(toastKind('Respawned'), 'info');
  assert.equal(toastKind('Secret found: The Old Lighthouse  3 of 6  +250 and a very long explanation that is not a score line'), 'info');
});

test('HG-3: everything at once leaves police in row 1 and the hint in row 2; the objective returns after the police toast', () => {
  const st = createTopStack();
  st.add('district', 'Little Havana', 3);
  st.add('objective', 'First Light', 4);
  st.setWanted(true); // five stars
  st.add('district', 'Allapattah', 3); // never while wanted
  st.add('police', 'Pulled over', 2);
  st.add('score', 'Wrecked  +250', 1.6);
  st.add('hint', 'Hold GAS to drive', 4.5);
  st.add('info', 'Camera: far', 1);
  assert.deepEqual(shown(st), ['police:Pulled over', 'hint:Hold GAS to drive']);
  for (let i = 0; i < 130; i++) st.tick(1 / 60); // 2.17 s: the police toast has ended
  assert.deepEqual(shown(st), ['objective:First Light', 'hint:Hold GAS to drive']);
  for (let i = 0; i < 60 * 8; i++) st.tick(1 / 60);
  assert.deepEqual(shown(st), ['', ''], 'everything ended; nothing is kept forever');
});

test('row 1: a lower item waits at most 3 s behind a higher one, a banner is never shown late', () => {
  const st = createTopStack();
  st.add('police', 'You lost them', 5);
  st.add('objective', 'Objective', 4);
  st.add('district', 'Downtown', 3);
  assert.equal(st.rows[0].kind, 'police');
  for (let i = 0; i < 60 * 3.2; i++) st.tick(1 / 60);
  assert.equal(st.rows[0].kind, 'police', 'still the police toast');
  for (let i = 0; i < 60 * 2; i++) st.tick(1 / 60);
  assert.equal(st.rows[0].kind, '', 'the objective line waited too long and was dropped; the banner never came');
  // A higher item replaces a lower one at once.
  st.add('district', 'Downtown', 3);
  st.add('objective', 'New objective', 4);
  assert.deepEqual(shown(st), ['objective:New objective', '']);
});

test('row 2: a hint beats toasts; score toasts are dropped under it; one other toast waits; a toast replaces another after 0.6 s', () => {
  const st = createTopStack();
  st.add('score', 'A  +10', 1.6);
  st.add('score', 'B  +20', 1.6);
  assert.equal(st.rows[1].text, 'A  +10', 'before 0.6 s the new toast waits');
  for (let i = 0; i < 40; i++) st.tick(1 / 60); // 0.67 s
  assert.equal(st.rows[1].text, 'B  +20', 'then it takes the row');
  st.add('hint', 'A hint', 4.5);
  assert.equal(st.rows[1].kind, 'hint');
  st.add('score', 'C  +30', 1.6); // dropped
  st.add('info', 'First', 2);
  st.add('info', 'Second', 2); // the newest waiting toast wins
  for (let i = 0; i < 60 * 4.6; i++) st.tick(1 / 60);
  assert.deepEqual(shown(st), ['', 'info:Second']);
});

test('no hint while wanted or within 3 s of a police toast', () => {
  const st = createTopStack();
  assert.equal(st.canHint(), true);
  st.setWanted(true);
  assert.equal(st.canHint(), false);
  st.setWanted(false);
  st.add('police', 'Officers on foot!', 2);
  assert.equal(st.canHint(), false);
  for (let i = 0; i < 60 * 4; i++) st.tick(1 / 60);
  assert.equal(st.canHint(), true);
});
