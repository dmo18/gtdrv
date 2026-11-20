import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { shouldRegister } from '../src/pwa.js';

const pub = new URL('../public/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

test('manifest has the required fields', () => {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'orientation', 'background_color', 'theme_color', 'icons']) {
    assert.ok(manifest[k], `missing ${k}`);
  }
  assert.equal(manifest.name, 'Rustwater');
  assert.equal(manifest.orientation, 'landscape');
  assert.ok(manifest.categories.includes('games'));
  assert.deepEqual(manifest.display_override.slice(0, 2), ['fullscreen', 'standalone']);
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test('manifest icons exist and cover 48 to 512, maskable and monochrome', () => {
  const sizes = new Set();
  const purposes = new Set();
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(pub, icon.src)), `missing file ${icon.src}`);
    purposes.add(icon.purpose);
    if (icon.type === 'image/png') {
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.equal(w, h);
      const png = readFileSync(join(pub, icon.src));
      assert.equal(png.readUInt32BE(16), w, `${icon.src} real width`);
      assert.equal(png.readUInt32BE(20), h, `${icon.src} real height`);
      if (icon.purpose === 'any') sizes.add(w);
    }
  }
  for (const s of [48, 72, 96, 144, 192, 512]) assert.ok(sizes.has(s), `no ${s}px icon`);
  assert.ok(purposes.has('maskable'));
  assert.ok(purposes.has('monochrome'));
});

test('store artwork has the sizes Google Play asks for', () => {
  const root = new URL('../store/', import.meta.url).pathname;
  const dims = (f) => {
    const b = readFileSync(join(root, f));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(dims('icon-512.png'), [512, 512]);
  assert.deepEqual(dims('feature-graphic-1024x500.png'), [1024, 500]);
  const shots = readdirSync(root).filter((f) => /^screenshot-\d+\.png$/.test(f));
  assert.ok(shots.length >= 8, `need 8 screenshots, have ${shots.length}`);
  for (const f of shots) {
    const [w, h] = dims(f);
    assert.ok(Math.min(w, h) >= 320 && Math.max(w, h) <= 3840 && Math.max(w, h) <= 2 * Math.min(w, h), `${f} ${w}x${h}`);
  }
});

test('index.html links the manifest and icons and keeps a strict CSP', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
  assert.ok(existsSync(join(pub, 'apple-touch-icon.png')));
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  for (const d of ["default-src 'self'", "manifest-src 'self'", "worker-src 'self'", "connect-src 'none'", "object-src 'none'"]) {
    assert.ok(csp.includes(d), `CSP lacks ${d}`);
  }
  assert.ok(!/unsafe-eval|https?:\/\/|\*/.test(csp), 'CSP must not allow other origins or eval');
});

test('service worker template is same-origin only and has build slots', () => {
  const sw = readFileSync(join(pub, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'__VERSION__'"));
  assert.ok(sw.includes('__FILES__'));
  assert.ok(sw.includes('url.origin !== self.location.origin'));
  assert.ok(!/https?:\/\//.test(sw.replace(/\/\*[\s\S]*?\*\//, '')), 'no absolute URLs');
});

test('privacy policy page exists and makes no tracking claims it cannot keep', () => {
  const p = readFileSync(join(pub, 'privacy.html'), 'utf8');
  assert.match(p, /<title>Rustwater privacy policy<\/title>/);
  assert.ok(!/<script|https?:\/\/(?!github)/.test(p), 'policy page has no scripts or external links');
});

test('no em or en dashes in the packaging files', () => {
  for (const f of ['manifest.webmanifest', 'privacy.html', 'sw.js']) {
    assert.ok(!/[–—]/.test(readFileSync(join(pub, f), 'utf8')), f);
  }
});

test('service worker registration is guarded', () => {
  const base = { prod: true, nav: { serviceWorker: {}, webdriver: false }, loc: { protocol: 'https:', hostname: 'x.github.io', search: '' }, cap: undefined };
  assert.equal(shouldRegister(base), true);
  assert.equal(shouldRegister({ ...base, prod: false }), false);
  assert.equal(shouldRegister({ ...base, cap: {} }), false, 'not inside the Android wrapper');
  assert.equal(shouldRegister({ ...base, nav: { serviceWorker: {}, webdriver: true } }), false, 'not in automated browsers');
  assert.equal(shouldRegister({ ...base, nav: { webdriver: false } }), false, 'no service worker support');
  assert.equal(shouldRegister({ ...base, loc: { ...base.loc, search: '?autostart' } }), false);
  assert.equal(shouldRegister({ ...base, nav: { serviceWorker: {}, webdriver: true }, loc: { ...base.loc, search: '?pwa' } }), true);
  assert.equal(shouldRegister({ ...base, loc: { protocol: 'http:', hostname: 'example.com', search: '' } }), false);
});
