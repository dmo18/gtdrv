import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, bumpProps, bumpJsonText } from '../scripts/bump-version.mjs';

test('bumpVersion patch, minor, major', () => {
  assert.equal(bumpVersion('0.5.9', 'patch'), '0.5.10');
  assert.equal(bumpVersion('0.5.9', 'minor'), '0.6.0');
  assert.equal(bumpVersion('0.5.9', 'major'), '1.0.0');
});

test('bumpVersion refuses a dirty argument or version', () => {
  for (const k of ['', 'patch ', 'PATCH', 'x', undefined, '1.2.3']) assert.throws(() => bumpVersion('1.0.0', k));
  assert.throws(() => bumpVersion('1.0', 'patch'));
  assert.throws(() => bumpVersion('1.0.0-rc1', 'patch'));
});

test('bumpProps raises the code by one and sets the name', () => {
  const out = bumpProps('VERSION_CODE=6\nVERSION_NAME=0.5.0\n', '0.5.1');
  assert.equal(out, 'VERSION_CODE=7\nVERSION_NAME=0.5.1\n');
  assert.throws(() => bumpProps('VERSION_NAME=1.0.0\n', '1.0.1'));
});

test('bumpJsonText only touches a lock that carries the old version', () => {
  const lock = JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } });
  assert.equal(bumpJsonText(lock, '0.5.0', '0.5.1'), null);
  const cur = JSON.stringify({ version: '0.5.0', packages: { '': { version: '0.5.0' } } });
  const j = JSON.parse(bumpJsonText(cur, '0.5.0', '0.5.1'));
  assert.equal(j.version, '0.5.1');
  assert.equal(j.packages[''].version, '0.5.1');
});
