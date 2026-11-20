// Registers the offline service worker. Only for production builds served
// over http(s), never inside the Android wrapper (it already bundles the
// files), and never during the automated browser checks unless asked
// with ?pwa. Safe to import in node: it touches nothing at import time.

export function shouldRegister(env) {
  const { prod, nav, loc, cap } = env;
  if (!prod || !nav || !('serviceWorker' in nav)) return false;
  if (cap) return false;
  if (loc.protocol !== 'https:' && loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1') return false;
  const q = new URLSearchParams(loc.search);
  if (q.has('pwa')) return true;
  return !nav.webdriver && !q.has('autostart');
}

// onUpdate(apply) is called when a newer version is ready; calling apply()
// activates it and reloads. main.js applies it straight away only while the
// title screen is still showing.
export function registerServiceWorker(onUpdate) {
  /* global __PROD__ */
  const prod = typeof __PROD__ !== 'undefined' && __PROD__;
  if (typeof window === 'undefined') return;
  if (!shouldRegister({ prod, nav: navigator, loc: location, cap: window.Capacitor })) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js', { scope: './' })
      .then((reg) => {
        const offer = (worker) => {
          if (!onUpdate) return;
          onUpdate(() => {
            let reloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              if (reloaded) return;
              reloaded = true;
              location.reload();
            });
            worker.postMessage('skip-waiting');
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          });
        });
      })
      .catch(() => {
        /* offline support is optional */
      });
  });
}
