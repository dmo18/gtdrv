// Bumps the version everywhere it lives.
// Usage: node scripts/bump-version.mjs patch|minor|major   (npm run bump -- patch)
// Updates package.json, android/package.json, package-lock.json (only if it
// carries the old version), and android/native/version.properties
// (VERSION_NAME, and VERSION_CODE + 1). Set RELEASE_ROOT to run on a copy.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KINDS = ['patch', 'minor', 'major'];

/** Pure: returns the next x.y.z; throws on a bad kind or version. */
export function bumpVersion(version, kind) {
  if (!KINDS.includes(kind)) throw new Error(`argument must be one of ${KINDS.join(', ')}, got "${kind}"`);
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  if (!m) throw new Error(`version "${version}" is not x.y.z`);
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === 'major') { a += 1; b = 0; c = 0; } else if (kind === 'minor') { b += 1; c = 0; } else c += 1;
  return `${a}.${b}.${c}`;
}

/** Pure: rewrites VERSION_NAME and VERSION_CODE (+1) in a properties text. */
export function bumpProps(text, newVersion) {
  const code = /^(\s*VERSION_CODE\s*=\s*)(\d+)(\s*)$/m;
  const name = /^(\s*VERSION_NAME\s*=\s*)(.*?)(\s*)$/m;
  if (!code.test(text)) throw new Error('VERSION_CODE not found in version.properties');
  if (!name.test(text)) throw new Error('VERSION_NAME not found in version.properties');
  return String(text)
    .replace(code, (_, p, n, s) => `${p}${Number(n) + 1}${s}`)
    .replace(name, (_, p, _o, s) => `${p}${newVersion}${s}`);
}

/** Pure: sets "version" on a json text (top level, and packages[""] for lock files) if it equals oldVersion. */
export function bumpJsonText(text, oldVersion, newVersion, { force = false } = {}) {
  const j = JSON.parse(text);
  if (!force && j.version !== oldVersion) return null;
  j.version = newVersion;
  if (j.packages && j.packages[''] && (force || j.packages[''].version === oldVersion)) j.packages[''].version = newVersion;
  return JSON.stringify(j, null, 2) + '\n';
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !KINDS.includes(args[0])) {
    console.error(`usage: node scripts/bump-version.mjs ${KINDS.join('|')}`);
    process.exit(1);
  }
  const root = resolve(process.env.RELEASE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const rd = (p) => readFileSync(join(root, p), 'utf8');
  const wr = (p, t) => writeFileSync(join(root, p), t);
  const old = JSON.parse(rd('package.json')).version;
  const next = bumpVersion(old, args[0]);
  // Compute everything first so a failure leaves no half-bumped tree.
  const out = {};
  out['package.json'] = bumpJsonText(rd('package.json'), old, next, { force: true });
  out['android/package.json'] = bumpJsonText(rd('android/package.json'), old, next, { force: true });
  const props = rd('android/native/version.properties');
  out['android/native/version.properties'] = bumpProps(props, next);
  for (const lock of ['package-lock.json', 'android/package-lock.json']) {
    try {
      const t = bumpJsonText(rd(lock), old, next);
      if (t) out[lock] = t;
      else console.log(`${lock}: version differs from ${old}, left alone`);
    } catch { /* no lock file */ }
  }
  for (const [p, t] of Object.entries(out)) wr(p, t);
  const code = /VERSION_CODE\s*=\s*(\d+)/.exec(out['android/native/version.properties'])[1];
  console.log(`bumped ${old} -> ${next}, VERSION_CODE ${code}`);
  console.log('next: npm run build, then npm run gate');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
