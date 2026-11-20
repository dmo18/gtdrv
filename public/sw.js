/* Rustwater service worker. Offline cache for the game's own files only.
 * Same-origin requests only; it never contacts any other site.
 * The build fills in VERSION (a hash of the files) and FILES (the list). */
const VERSION = '__VERSION__';
const CACHE = 'rustwater-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  // New versions wait until the page asks for them (see src/pwa.js) so a
  // running game never has its files swapped underneath it.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
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
