// Service worker cache name and failed installs (0.14.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { swVersion } from '../scripts/build.mjs';

const template = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('the cache version covers the service worker template itself', () => {
  const files = [['index.html', Buffer.from('a')], ['game.js', Buffer.from('b')]];
  const v = swVersion(template, files);
  assert.match(v, /^[0-9a-f]{12}$/);
  assert.equal(swVersion(template, files), v, 'stable');
  assert.notEqual(swVersion(template + '\n// edit', files), v, 'a sw.js edit alone changes the name');
  assert.notEqual(swVersion(template, [['index.html', Buffer.from('a')], ['game.js', Buffer.from('c')]]), v);
});

// Runs the worker's install event against a fake cache store.
async function install(existing) {
  const stores = new Map(existing ? [['rustwater-t', { files: ['old'] }]] : []);
  const deleted = [];
  const listeners = {};
  const src = template.replace("'__VERSION__'", "'t'").replace('const FILES = __FILES__;', 'const FILES = ' + JSON.stringify(['./', 'game.js']) + ';');
  const ctx = {
    self: { addEventListener: (n, f) => { listeners[n] = f; }, location: { origin: 'https://x' }, registration: { scope: 'https://x/' } },
    caches: {
      keys: async () => [...stores.keys()],
      open: async (k) => { if (!stores.has(k)) stores.set(k, { files: [] }); return { addAll: async () => { throw new Error('offline'); }, put: async () => {} }; },
      delete: async (k) => { deleted.push(k); return stores.delete(k); },
    },
    Request: class { constructor(u) { this.url = u; } },
    URL,
    fetch: async () => ({ ok: false }),
  };
  vm.runInNewContext(src, ctx);
  let pending;
  listeners.install({ waitUntil: (p) => { pending = p; } });
  await assert.rejects(pending, /offline/);
  return { deleted, stores };
}

test('a failed install drops a cache it created, never one that already existed', async () => {
  const fresh = await install(false);
  assert.deepEqual(fresh.deleted, ['rustwater-t']);
  const live = await install(true);
  assert.deepEqual(live.deleted, []);
  assert.ok(live.stores.has('rustwater-t'));
});
