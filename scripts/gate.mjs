// Runs the publish gate in order and stops at the first failure.
// Usage: npm run gate            lint, test, release:check (after build), smoke --extra
//        npm run gate -- --ui    also runs the ui-test (about 8 minutes)
import { spawnSync } from 'node:child_process';

const ui = process.argv.includes('--ui');
const node = process.execPath;
const steps = [
  ['lint', 'npx', ['eslint', '.']],
  ['test', node, ['--test', 'test/*.test.js']],
  ['build', node, ['scripts/build.mjs']],
  ['release:check', node, ['scripts/release-check.mjs']],
  ['smoke --extra', node, ['scripts/smoke.mjs', '--extra']],
];
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
if (!ui) console.log('ui-test         skipped (add --ui)');
console.log(failed ? 'GATE FAILED' : 'GATE PASSED');
process.exit(failed ? 1 : 0);
