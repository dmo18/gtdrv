import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProperties, checkRelease } from '../scripts/release-check.mjs';

const ok = () => ({
  version: '0.3.2',
  androidVersion: '0.3.2',
  props: { VERSION_NAME: '0.3.2', VERSION_CODE: '5' },
  last: { version: '0.3.1', code: 4, commit: 'abc' },
  html: '<div>v0.3.2</div>',
});

test('parseProperties reads keys and skips comments', () => {
  const p = parseProperties('# c\nVERSION_CODE=4\r\nVERSION_NAME = 0.3.1\n');
  assert.deepEqual(p, { VERSION_CODE: '4', VERSION_NAME: '0.3.1' });
});

test('a consistent bump passes', () => {
  assert.deepEqual(checkRelease(ok()), []);
});

test('android package version mismatch fails', () => {
  const d = ok(); d.androidVersion = '0.3.1';
  assert.equal(checkRelease(d).length, 1);
});

test('VERSION_NAME mismatch fails', () => {
  const d = ok(); d.props.VERSION_NAME = '0.3.1';
  assert.match(checkRelease(d)[0], /VERSION_NAME/);
});

test('VERSION_CODE must be strictly greater than last published', () => {
  const d = ok(); d.props.VERSION_CODE = '4';
  assert.match(checkRelease(d)[0], /greater/);
  d.props.VERSION_CODE = 'x';
  assert.match(checkRelease(d)[0], /positive integer/);
});

test('splash version must be in built html', () => {
  const d = ok(); d.html = '<div>v0.3.1</div>';
  assert.match(checkRelease(d)[0], /splash/);
  d.html = null;
  assert.match(checkRelease(d)[0], /build/);
});
