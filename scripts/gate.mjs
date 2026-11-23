// Runs the publish gate in order and stops at the first failure.
// Usage: npm run gate            lint, test, release:check (after build), smoke --extra, touch-test
//        npm run gate -- --ui    also runs the ui-test (about 8 minutes)
//        npm run gate -- --regions  also loads and drives every Miami region
//                                (scripts/smoke-regions.mjs, PLAN_V2 5.4)
import { spawnSync } from 'node:child_process';

const ui = process.argv.includes('--ui');
const regions = process.argv.includes('--regions');
const node = process.execPath;
const steps = [
  ['lint', 'npx', ['eslint', '.']],
  ['test', node, ['--test', 'test/*.test.js']],
  ['build', node, ['scripts/build.mjs']],
  ['release:check', node, ['scripts/release-check.mjs']],
  ['smoke --extra', node, ['scripts/smoke.mjs', '--extra']],
  // multi-touch steering at the owner's phone sizes: no lost, stolen, reversed or stuck steer (docs/UI.md)
  ['touch-test', node, ['scripts/touch-test.mjs']],
];
if (regions) steps.push(['smoke regions', node, ['scripts/smoke-regions.mjs', '--no-build']]);
if (ui) steps.push(['ui-test', node, ['scripts/ui-test.mjs']]);

const rows = [];
let failed = false;
for (const [name, cmd, args] of steps) {
  const t0 = Date.now();
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: cmd === 'npx' });
  const ok = r.status === 0;
  rows.push([name, ok ? 'pass' : 'FAIL', `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  if (!ok) { failed = true; break; }
}
console.log('\nstep            result  time');
for (const [n, s, t] of rows) console.log(`${n.padEnd(15)} ${s.padEnd(7)} ${t}`);
if (!regions) console.log('smoke regions   skipped (add --regions)');
if (!ui) console.log('ui-test         skipped (add --ui)');
console.log(failed ? 'GATE FAILED' : 'GATE PASSED');
process.exit(failed ? 1 : 0);
