// Release gate: fails unless the version files agree and the version code went up.
// Usage: node scripts/release-check.mjs            check (npm run release:check)
//        node scripts/release-check.mjs --record   write release/last.json (npm run release:record)
// Set RELEASE_ROOT to run against another directory (used for testing).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export function parseProperties(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

/** Returns a list of problem strings (empty means the gate passes). */
export function checkRelease({ version, androidVersion, props, last, html }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) problems.push(`package.json version "${version}" is not x.y.z`);
  if (androidVersion !== version) problems.push(`android/package.json version "${androidVersion}" differs from package.json "${version}"`);
  if (props.VERSION_NAME !== version) problems.push(`version.properties VERSION_NAME "${props.VERSION_NAME}" differs from package.json "${version}"`);
  const code = Number(props.VERSION_CODE);
  if (!Number.isInteger(code) || code < 1) problems.push(`version.properties VERSION_CODE "${props.VERSION_CODE}" is not a positive integer`);
  else if (!(last && Number.isInteger(last.code))) problems.push('release/last.json has no integer "code"');
  else if (code <= last.code) problems.push(`VERSION_CODE ${code} must be greater than the last published code ${last.code} (version ${last.version}); bump it`);
  if (html == null) problems.push('dist/index.html not found; run npm run build first');
  else if (!html.includes(version)) problems.push(`dist/index.html does not contain version ${version}; the splash screen is stale, rebuild`);
  return problems;
}

function load(root) {
  const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  let html = null;
  try { html = readFileSync(join(root, 'dist/index.html'), 'utf8'); } catch { /* missing */ }
  return {
    version: readJson('package.json').version,
    androidVersion: readJson('android/package.json').version,
    props: parseProperties(readFileSync(join(root, 'android/native/version.properties'), 'utf8')),
    last: readJson('release/last.json'),
    html,
  };
}

function main() {
  const root = resolve(process.env.RELEASE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const data = load(root);
  if (process.argv.includes('--record')) {
    const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
    const rec = { version: data.version, code: Number(data.props.VERSION_CODE), commit };
    mkdirSync(join(root, 'release'), { recursive: true });
    writeFileSync(join(root, 'release/last.json'), JSON.stringify(rec, null, 2) + '\n');
    console.log(`recorded release ${rec.version} code ${rec.code} commit ${rec.commit}`);
    return;
  }
  console.log(`version ${data.version}, version code ${data.props.VERSION_CODE} (last published: ${data.last.version}, code ${data.last.code})`);
  const problems = checkRelease(data);
  if (problems.length) {
    console.error('RELEASE CHECK FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('release check OK');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
