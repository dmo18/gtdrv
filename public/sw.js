/* global __FILES__ */
/* Rustwater service worker. Offline cache for the game's own files only.
 * Same-origin requests only; it never contacts any other site.
 * The build fills in VERSION (a hash of the files) and FILES (the list). */
const VERSION = '__VERSION__';
const CACHE = 'rustwater-' + VERSION;
const FILES = __FILES__;

// Optional files (icons and artwork) never decide whether the game installs.
// Everything else is needed to play and is cached all together or not at all.
const OPTIONAL = /\.(png|svg|ico|webp|jpe?g)$/i;
const mk = (f) => new Request(f, { cache: 'reload' });

async function install() {
  const cache = await caches.open(CACHE);
  try {
    // One atomic step: a missing or failing play file rejects the install.
    await cache.addAll(FILES.filter((f) => !OPTIONAL.test(f)).map(mk));
  } catch (err) {
    // Drop the partial cache; the previous version's cache is untouched
    // (activate removes old caches only after an install succeeds).
    await caches.delete(CACHE);
    throw err;
  }
  // Optional files one by one; a 404 or a network error is ignored.
  await Promise.all(
    FILES.filter((f) => OPTIONAL.test(f)).map(async (f) => {
      try {
        const r = mk(f);
        const res = await fetch(r);
        if (res && res.ok) await cache.put(r, res);
      } catch {
        /* optional */
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  // New versions wait until the page asks for them (see src/pwa.js) so a
  // running game never has its files swapped underneath it.
  event.waitUntil(install());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rustwater-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other origins
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = await cache.match(new URL('index.html', self.registration.scope).href);
        if (page) return page;
      }
      return fetch(req);
    }),
  );
});
