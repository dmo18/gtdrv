// Survival (docs/PLAN_V4.md task 4, scripts/survival.mjs): a clumsy player
// in Miami Beach with the game's traffic, people, parked cars, police and
// combat round them (a shorter session than the script's 10 minutes: 4
// minutes at the wheel, with the 60 mph run, then 2 on foot). In the
// default mode the car is never wrecked and never burns and the player
// never dies; in Hard no bump, person or parked car kills the player, no
// car under 15 mph knocks them down, bumps under 20 mph take under a third
// of the car, and at most one wreck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../scripts/collision-sweep.mjs';
import { runSurvival } from '../scripts/survival.mjs';
import { RULES } from '../src/core/weapons.js';

const W = buildWorld('miami-beach');
const deathsBy = (r, re) => Object.entries(r.deathCauses).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);

test('default mode: a clumsy drive and walk never wrecks, burns or kills', () => {
  const r = runSurvival(W, { seed: 1, hard: false, minutes: 5.5, walkMinutes: 2 });
  assert.ok(r.km > 2, `drove ${r.km} km`);
  assert.ok(r.crashes + r.carContacts > 3, `met things (${r.crashes} crashes, ${r.carContacts} car contacts)`);
  assert.equal(r.carWrecks, 0, 'wrecks');
  assert.equal(r.carExplosions, 0, 'explosions');
  assert.equal(r.playerDeaths, 0, 'deaths');
  assert.ok(r.minCarHealth >= 0.15, `car health floor (${r.minCarHealth})`);
  assert.equal(RULES.invulnerable, true, 'the rule is restored');
});

test('Hard: no death from bumps, people or parked cars; no knock-down by a car under 15 mph; at most one wreck', () => {
  const r = runSurvival(W, { seed: 2, hard: true, minutes: 5.5, walkMinutes: 2 });
  assert.equal(deathsBy(r, /^ram|crash|^\?/), 0, `deaths by contact: ${JSON.stringify(r.deathCauses)}`);
  assert.equal(r.knockdownsByCarUnder15, 0, 'knocked down by a slow car');
  assert.ok(r.carWrecks <= 1, `${r.carWrecks} wrecks (${JSON.stringify(r.wreckCauses)})`);
  // Bumps under 20 mph took 0.65 of a car over four 10 minute Hard Beach runs.
  assert.ok(r.damage.crashUnder20 <= 0.3, `bumps under 20 mph took ${r.damage.crashUnder20} of the car`);
});
